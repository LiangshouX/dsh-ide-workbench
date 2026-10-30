/**
 * Workspace filesystem + shell discovery helpers.
 *
 * Every path crossing the wire is either the workspace root or a path with a
 * lexically verified containment check, so a crafted `path` cannot walk out of
 * the project the user opened.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { lstat, open, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ApiError } from './wire.js'

/** Image extensions served inline as data URLs. */
const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
}

/** File read cap for the editor/preview (bytes). */
const MAX_TEXT_BYTES = 2 << 20
/** Image inline cap (bytes). */
const MAX_IMAGE_BYTES = 8 << 20
/** Per-directory listing cap. */
const MAX_ENTRIES = 5000

/** Canonicalize and verify one workspace root. */
export async function canonicalRoot(input) {
  if (typeof input !== 'string' || input.trim() === '') throw new ApiError('bad-request', 'missing workspace root')
  if (!isAbsolute(input)) throw new ApiError('bad-request', 'workspace root must be absolute')
  let real
  try {
    real = await realpath(input)
  } catch {
    throw new ApiError('not-found', `workspace root does not exist: ${input}`, 404)
  }
  const info = await stat(real)
  if (!info.isDirectory()) throw new ApiError('bad-request', `workspace root is not a directory: ${input}`)
  return real
}

/** Resolve one in-workspace path; absolute inputs must stay inside the root. */
export function resolveInside(root, input) {
  if (typeof input !== 'string' || input === '') throw new ApiError('bad-request', 'missing path')
  const absolute = isAbsolute(input) ? resolve(input) : resolve(root, input)
  const rel = relative(root, absolute)
  if (rel === '') return absolute
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new ApiError('forbidden', 'path is outside the workspace', 403)
  }
  return absolute
}

/** POSIX-style workspace-relative path (stable across platforms). */
export function toRelative(root, absolute) {
  return relative(root, absolute).split(sep).join('/')
}

/** Upper bound on the subdirectory list shown by the project picker. */
const MAX_PROJECTS = 400

/**
 * The folders that can serve as an IDE project root: the workspace root plus
 * its first-level directories. Hidden folders and `node_modules` are skipped;
 * `isRepo` marks a folder that owns a `.git` entry (file or directory).
 * @param {string} root workspace root (absolute)
 */
export async function listProjectCandidates(root) {
  const absolute = await canonicalRoot(root)
  const projects = [{
    path: absolute,
    name: basename(absolute) || absolute,
    isRepo: existsSync(join(absolute, '.git')),
    isRoot: true,
  }]
  let entries
  try {
    entries = await readdir(absolute, { withFileTypes: true })
  } catch {
    return { workspace: absolute, projects }
  }
  const children = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const child = join(absolute, entry.name)
    children.push({
      path: child,
      name: entry.name,
      isRepo: existsSync(join(child, '.git')),
      isRoot: false,
    })
  }
  children.sort((left, right) => collator.compare(left.name, right.name))
  return { workspace: absolute, projects: [...projects, ...children.slice(0, MAX_PROJECTS)] }
}

/** Human ordering: directories first, then numeric-aware name order. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** How many stat calls may run at the same time. */
const STAT_CONCURRENCY = 16

/**
 * Map over items with a bounded number of concurrent calls.
 *
 * The tree only needs the extra `stat` of the few symlinked entries, so they
 * are resolved in parallel — but never all at once, so a directory full of
 * links cannot flood the file descriptor table.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} mapper
 * @returns {Promise<R[]>}
 */
async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length)
  let cursor = 0
  const size = Math.max(1, Math.min(limit, items.length))
  const workers = []
  for (let worker = 0; worker < size; worker += 1) {
    workers.push((async () => {
      while (cursor < items.length) {
        const index = cursor
        cursor += 1
        results[index] = await mapper(items[index], index)
      }
    })())
  }
  await Promise.all(workers)
  return results
}

/** The filesystem calls `listDirectory` makes; the tests replace them. */
const listingFs = { readdir, stat }

/**
 * List one directory level.
 *
 * The listing comes from one `readdir(withFileTypes)` call: the tree does not
 * read the size or the mtime of an entry, so no per-entry `lstat` is needed
 * (a 5k-file directory used to cost 5k serial stats). Only a symlink needs
 * one extra `stat`, to learn whether it points at a directory.
 * @param {string} root canonical workspace root
 * @param {string} path absolute path inside the workspace
 * @param {{ showHidden?: boolean, fs?: { readdir: Function, stat: Function } }} [options]
 */
export async function listDirectory(root, path, options = {}) {
  const showHidden = options.showHidden !== false
  const fs = options.fs ?? listingFs
  const dir = resolveInside(root, path)
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    throw new ApiError('fs-error', `cannot read directory: ${error instanceof Error ? error.message : String(error)}`, 404)
  }
  const output = []
  let truncated = false
  for (const entry of entries) {
    const name = entry.name
    if (name === '.git' || name === '.DS_Store') continue
    const hidden = name.startsWith('.')
    if (hidden && !showHidden) continue
    const absolute = join(dir, name)
    const isSymlink = entry.isSymbolicLink()
    output.push({
      name,
      path: absolute,
      rel: toRelative(root, absolute),
      isDir: entry.isDirectory(),
      isSymlink,
      hidden,
      ext: '',
    })
    if (output.length >= MAX_ENTRIES) {
      truncated = true
      break
    }
  }
  const links = output.filter(entry => entry.isSymlink)
  if (links.length > 0) {
    const resolved = await mapLimit(links, STAT_CONCURRENCY, async (entry) => {
      try {
        const target = await fs.stat(entry.path)
        return target.isDirectory()
      } catch {
        // broken link: keep it visible as a file row
        return false
      }
    })
    links.forEach((entry, index) => { entry.isDir = resolved[index] })
  }
  for (const entry of output) {
    entry.ext = entry.isDir ? '' : extname(entry.name).toLowerCase()
  }
  output.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return collator.compare(a.name, b.name)
  })
  return { path: dir, rel: toRelative(root, dir), entries: output, truncated }
}

/** Decode a text buffer using its BOM when present (UTF-8 otherwise). */
function decodeText(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return { encoding: 'utf-8-bom', content: buffer.subarray(3).toString('utf8') }
  }
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return { encoding: 'utf-16le', content: buffer.subarray(2).toString('utf16le') }
  }
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    const swapped = Buffer.from(buffer.subarray(2))
    swapped.swap16()
    return { encoding: 'utf-16be', content: swapped.toString('utf16le') }
  }
  return { encoding: 'utf-8', content: buffer.toString('utf8') }
}

/** Heuristic binary detection (NUL in the first 8 KiB). */
function looksBinary(buffer) {
  const probe = buffer.subarray(0, 8192)
  for (let index = 0; index < probe.length; index += 1) {
    if (probe[index] === 0) return true
  }
  return false
}

/**
 * Read one file for the editor / preview.
 * @param {string} root canonical workspace root
 * @param {string} path absolute path inside the workspace
 */
export async function readFileForPreview(root, path) {
  const absolute = resolveInside(root, path)
  let info
  try {
    info = await stat(absolute)
  } catch {
    throw new ApiError('not-found', `file not found: ${toRelative(root, absolute)}`, 404)
  }
  if (info.isDirectory()) throw new ApiError('bad-request', 'path is a directory')
  const ext = extname(absolute).toLowerCase()
  const relativePath = toRelative(root, absolute)
  const mime = IMAGE_TYPES[ext]
  if (mime !== undefined) {
    if (info.size > MAX_IMAGE_BYTES) {
      return { kind: 'binary', size: info.size, mtimeMs: info.mtimeMs, path: relativePath }
    }
    const bytes = await readFile(absolute)
    return {
      kind: 'image',
      mime,
      size: info.size,
      mtimeMs: info.mtimeMs,
      dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
      path: relativePath,
    }
  }
  if (info.size > MAX_TEXT_BYTES) {
    // Read only the front slice: a huge file must never be loaded whole just
    // to show a read-only preview.
    const handle = await open(absolute, 'r')
    let slice
    try {
      const buffer = Buffer.alloc(MAX_TEXT_BYTES)
      const { bytesRead } = await handle.read(buffer, 0, MAX_TEXT_BYTES, 0)
      slice = buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
    if (looksBinary(slice)) {
      return { kind: 'binary', size: info.size, mtimeMs: info.mtimeMs, path: relativePath }
    }
    const decoded = decodeText(slice)
    return {
      kind: 'text',
      content: decoded.content,
      encoding: decoded.encoding,
      size: info.size,
      mtimeMs: info.mtimeMs,
      truncated: true,
      path: relativePath,
    }
  }
  const buffer = await readFile(absolute)
  if (looksBinary(buffer)) {
    return { kind: 'binary', size: info.size, mtimeMs: info.mtimeMs, path: relativePath }
  }
  const decoded = decodeText(buffer)
  return {
    kind: 'text',
    content: decoded.content,
    encoding: decoded.encoding,
    size: info.size,
    mtimeMs: info.mtimeMs,
    truncated: false,
    path: relativePath,
  }
}

/** File write cap for the editor (bytes). */
const MAX_WRITE_BYTES = 8 << 20

/** Encode editor text back into the encoding it was read with. */
export function encodeText(content, encoding) {
  const text = String(content ?? '')
  switch (encoding) {
    case 'utf-8-bom':
      return Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')])
    case 'utf-16le':
      return Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')])
    case 'utf-16be': {
      const le = Buffer.from(text, 'utf16le')
      le.swap16()
      return Buffer.concat([Buffer.from([0xFE, 0xFF]), le])
    }
    default:
      return Buffer.from(text, 'utf8')
  }
}

/**
 * Save one editor buffer atomically in place.
 *
 * The path must already exist inside the workspace and must not be a symlink:
 * the editor never creates files, so a missing target is an error rather than
 * an implicit directory escape through a link.
 * @param {string} root canonical workspace root
 * @param {string} path absolute path inside the workspace
 * @param {string} content new text
 * @param {string} [encoding] encoding reported by the read
 * @param {{ expectedMtimeMs?: number }} [options] optimistic-concurrency guard
 */
export async function writeFileText(root, path, content, encoding = 'utf-8', options = {}) {
  const absolute = resolveInside(root, path)
  let info
  try {
    info = await lstat(absolute)
  } catch {
    throw new ApiError('not-found', `file not found: ${toRelative(root, absolute)}`, 404)
  }
  if (info.isSymbolicLink()) throw new ApiError('forbidden', 'refusing to write through a symlink', 403)
  if (info.isDirectory()) throw new ApiError('bad-request', 'path is a directory')
  if (Number.isFinite(options.expectedMtimeMs) && Math.abs(info.mtimeMs - options.expectedMtimeMs) > 0.5) {
    // The file changed after the editor read it. Refuse the write instead of
    // silently clobbering the other program's edit.
    throw new ApiError('stale-file', `file changed on disk since it was opened (mtime ${info.mtimeMs})`, 409)
  }
  const buffer = encodeText(content, encoding)
  if (buffer.length > MAX_WRITE_BYTES) {
    throw new ApiError('too-large', `file exceeds the ${MAX_WRITE_BYTES} byte write limit`, 413)
  }
  const temp = `${absolute}.dsh-iwb-${process.pid}-${Date.now()}.tmp`
  try {
    await writeFile(temp, buffer)
    await rename(temp, absolute)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw new ApiError('fs-error', `cannot save file: ${error instanceof Error ? error.message : String(error)}`, 500)
  }
  const after = await stat(absolute)
  return { size: after.size, mtimeMs: after.mtimeMs, encoding, path: toRelative(root, absolute) }
}

/** Reveal a path in the OS file manager (detached, no output). */
export function revealInExplorer(absolute) {
  const platform = process.platform
  let command
  let args
  if (platform === 'win32') {
    command = 'explorer.exe'
    args = [`/select,${absolute}`]
  } else if (platform === 'darwin') {
    command = 'open'
    args = ['-R', absolute]
  } else {
    command = 'xdg-open'
    args = [dirname(absolute)]
  }
  try {
    // `windowsHide` must stay off on Windows: with CREATE_NO_WINDOW,
    // explorer.exe accepts `/select` and silently opens nothing.
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: platform !== 'win32',
    })
    child.unref()
    return true
  } catch {
    return false
  }
}

/** Candidate shell executables for this platform. */
export function shellCandidates() {
  const candidates = []
  const add = (id, label, path) => {
    if (typeof path === 'string' && path !== '' && existsSync(path) && !candidates.some(item => item.id === id)) {
      candidates.push({ id, label, path })
    }
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? ''
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    const whereCandidates = [
      ['pwsh', 'PowerShell 7', ['C:\\Program Files\\PowerShell\\7\\pwsh.exe', join(localAppData, 'Microsoft\\WindowsApps\\pwsh.exe')]],
      ['powershell', 'Windows PowerShell', ['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe']],
      ['cmd', 'Command Prompt', ['C:\\Windows\\System32\\cmd.exe']],
      ['git-bash', 'Git Bash', [
        join(programFiles, 'Git\\bin\\bash.exe'),
        join(programFilesX86, 'Git\\bin\\bash.exe'),
        join(localAppData, 'Programs\\Git\\bin\\bash.exe'),
      ]],
    ]
    for (const [id, label, paths] of whereCandidates) add(id, label, paths.find(candidate => existsSync(candidate)))
  } else {
    add('zsh', 'zsh', '/bin/zsh')
    add('bash', 'bash', '/bin/bash')
    const fromEnv = process.env.SHELL
    if (typeof fromEnv === 'string' && fromEnv !== '') add(fromEnv.split('/').pop() ?? 'shell', fromEnv, fromEnv)
  }
  return candidates
}

/** argv for one shell profile, tuned for interactive use. */
export function shellArgv(id, path) {
  if (process.platform === 'win32') {
    if (id === 'pwsh') return [path, '-NoLogo']
    if (id === 'powershell') return [path, '-NoLogo']
    if (id === 'git-bash') return [path, '--login', '-i']
    return [path]
  }
  return [path, '-l']
}

/**
 * Run one user-configured command in the project root (pre-commit tasks:
 * tests / cleanup / import optimisation). The command string is trusted
 * configuration edited in Settings, and its combined output is returned for
 * the inline error panel. Never used for git itself.
 * @param {string} root absolute working directory
 * @param {string} command shell command line
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ code: number, output: string }>}
 */
export function runCommand(root, command, options = {}) {
  const timeoutMs = options.timeoutMs ?? 600_000
  return new Promise((resolve) => {
    let output = ''
    let settled = false
    const finish = (code) => {
      if (settled) return
      settled = true
      resolve({ code, output: output.slice(0, 200_000) })
    }
    let child
    try {
      child = spawn(command, {
        cwd: root,
        shell: true,
        windowsHide: true,
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      })
    } catch (error) {
      resolve({ code: -1, output: error instanceof Error ? error.message : String(error) })
      return
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* already gone */ }
      finish(124)
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => { output += chunk })
    child.stderr?.on('data', (chunk) => { output += chunk })
    child.on('error', (error) => {
      clearTimeout(timer)
      output += `\n${error instanceof Error ? error.message : String(error)}`
      finish(-1)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      finish(code ?? -1)
    })
  })
}

/** Environment for an interactive terminal (UTF-8 everywhere). */
export function terminalEnv() {  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.PYTHONUTF8 = '1'
  env.PYTHONIOENCODING = 'utf-8'
  env.LANG = env.LANG ?? 'en_US.UTF-8'
  env.LC_ALL = env.LC_ALL ?? 'en_US.UTF-8'
  delete env.ELECTRON_RUN_AS_NODE
  return env
}
