/**
 * Workspace file operations (Project tool window).
 *
 * Every path crosses the same fence as the read/write API: canonical root +
 * `resolveInside`, so a crafted name can neither climb out lexically nor land
 * inside a directory the caller did not name. Operations never follow a
 * symlink for the *source* they mutate.
 *
 * All operations are batch-friendly and return per-path results; the caller
 * reports failures instead of aborting the whole batch.
 */
import { spawn } from 'node:child_process'
import {
  appendFile, cp, lstat, mkdir, readFile, rename, rm, writeFile,
} from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path'
import { ApiError } from './wire.js'
import { resolveInside, toRelative } from './workspace.js'

/** Characters no portable file name may contain. */
const ILLEGAL_NAME = /[<>:"/\\|?*\u0000-\u001F]/
/** Windows reserved device names (case-insensitive, extension ignored). */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Throw unless `name` is one legal path segment. */
export function validateEntryName(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ApiError('bad-request', 'name must not be empty')
  }
  const value = name.trim()
  if (value === '.' || value === '..') throw new ApiError('bad-request', 'name must not be a dot path')
  if (ILLEGAL_NAME.test(value)) throw new ApiError('bad-request', 'name contains an illegal character')
  if (process.platform === 'win32') {
    if (/[. ]$/.test(value)) throw new ApiError('bad-request', 'name must not end with a dot or space')
    if (RESERVED.test(value.split('.')[0] ?? '')) throw new ApiError('bad-request', 'name is a reserved device name')
  }
  return value
}

async function statOrNull(path) {
  try {
    return await lstat(path)
  } catch {
    return null
  }
}

/** Resolve one existing directory inside the workspace. */
async function requireDirectory(root, path) {
  const absolute = resolveInside(root, path)
  const info = await statOrNull(absolute)
  if (info === null) throw new ApiError('not-found', `folder not found: ${toRelative(root, absolute)}`, 404)
  if (!info.isDirectory()) throw new ApiError('bad-request', `not a folder: ${toRelative(root, absolute)}`)
  return absolute
}

/** Join one validated child name under an absolute parent and fence it. */
function joinInside(root, parent, name) {
  const absolute = join(parent, name)
  resolveInside(root, absolute)
  return absolute
}

/** `name-copy`, `name-copy-2`, … for a file (suffix before the extension). */
function copyName(name, isDir, attempt = 1) {
  const suffix = attempt === 1 ? '-copy' : `-copy-${attempt}`
  if (isDir) return `${name}${suffix}`
  const ext = extname(name)
  const stem = ext === '' ? name : name.slice(0, -ext.length)
  return `${stem}${suffix}${ext}`
}

/** First free copy path next to `source`. */
async function uniqueCopyPath(source) {
  const info = await lstat(source)
  const name = basename(source)
  for (let attempt = 1; attempt < 1000; attempt += 1) {
    const candidate = join(dirname(source), copyName(name, info.isDirectory(), attempt))
    if ((await statOrNull(candidate)) === null) return candidate
  }
  throw new ApiError('exists', 'cannot find a free copy name')
}

/**
 * Create one file or directory. The parent must already exist.
 * @param {string} root canonical workspace root
 * @param {{ parent: string, name: string, isDir?: boolean, content?: string }} input
 */
export async function createEntry(root, input) {
  const name = validateEntryName(input.name)
  const parent = await requireDirectory(root, input.parent)
  const dest = joinInside(root, parent, name)
  if ((await statOrNull(dest)) !== null) {
    throw new ApiError('exists', `"${toRelative(root, dest)}" already exists`)
  }
  const isDir = input.isDir === true
  if (isDir) {
    await mkdir(dest)
  } else {
    const content = typeof input.content === 'string' ? input.content : ''
    // `wx` keeps a race from silently overwriting a file created meanwhile.
    await writeFile(dest, content, { encoding: 'utf8', flag: 'wx' })
  }
  return { path: toRelative(root, dest), isDir }
}

/**
 * Rename one entry in place (same parent directory).
 * @param {string} root canonical workspace root
 * @param {{ path: string, name: string }} input
 */
export async function renameEntry(root, input) {
  const name = validateEntryName(input.name)
  const source = resolveInside(root, input.path)
  const info = await statOrNull(source)
  if (info === null) throw new ApiError('not-found', 'path not found', 404)
  if (info.isSymbolicLink()) throw new ApiError('forbidden', 'refusing to rename a symlink', 403)
  const dest = joinInside(root, dirname(source), name)
  if (dest === source) return { path: toRelative(root, source), target: toRelative(root, source) }
  if ((await statOrNull(dest)) !== null) {
    throw new ApiError('exists', `"${toRelative(root, dest)}" already exists`)
  }
  await rename(source, dest)
  return { path: toRelative(root, source), target: toRelative(root, dest) }
}

/**
 * Duplicate one entry next to itself (`name-copy`).
 * @param {string} root canonical workspace root
 * @param {{ path: string }} input
 */
export async function duplicateEntry(root, input) {
  const source = resolveInside(root, input.path)
  const info = await statOrNull(source)
  if (info === null) throw new ApiError('not-found', 'path not found', 404)
  if (info.isSymbolicLink()) throw new ApiError('forbidden', 'refusing to duplicate a symlink', 403)
  const dest = await uniqueCopyPath(source)
  await cp(source, dest, { recursive: true, force: false, errorOnExist: true })
  return { path: toRelative(root, source), target: toRelative(root, dest) }
}

/** Whether `child` is `parent` itself or inside it. */
function isInside(parent, child) {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`))
}

/**
 * Move or copy entries into one target directory.
 * @param {string} root canonical workspace root
 * @param {{ paths: string[], target: string, copy?: boolean,
 *   conflict?: 'error'|'skip'|'rename'|'overwrite' }} input
 */
export async function moveEntries(root, input) {
  const target = await requireDirectory(root, input.target)
  const conflict = input.conflict ?? 'error'
  const copy = input.copy === true
  const results = []
  for (const raw of input.paths) {
    const source = resolveInside(root, raw)
    const display = toRelative(root, source)
    try {
      const info = await statOrNull(source)
      if (info === null) throw new ApiError('not-found', 'path not found', 404)
      if (info.isSymbolicLink()) throw new ApiError('forbidden', 'refusing to move a symlink', 403)
      if (isInside(source, target)) {
        throw new ApiError('forbidden', copy
          ? 'cannot copy an entry into itself'
          : 'cannot move an entry into itself or its own subfolder')
      }
      let dest = join(target, basename(source))
      if (dest === source) throw new ApiError('forbidden', 'the entry already lives in that folder')
      const existing = await statOrNull(dest)
      if (existing !== null) {
        if (conflict === 'skip') {
          results.push({ path: display, ok: false, skipped: true })
          continue
        }
        if (conflict === 'rename') dest = await uniqueCopyPath(dest)
        else if (conflict === 'overwrite') await rm(dest, { recursive: true, force: true })
        else throw new ApiError('exists', `"${toRelative(root, dest)}" already exists`)
      }
      if (copy) {
        await cp(source, dest, { recursive: true, force: false, errorOnExist: true })
      } else {
        try {
          await rename(source, dest)
        } catch (error) {
          if (error?.code !== 'EXDEV') throw error
          // Cross-device move: copy then delete (never leave two copies).
          await cp(source, dest, { recursive: true, force: false, errorOnExist: true })
          await rm(source, { recursive: true, force: true })
        }
      }
      results.push({ path: display, target: toRelative(root, dest), ok: true })
    } catch (error) {
      results.push({
        path: display,
        ok: false,
        code: error instanceof ApiError ? error.code : (error?.code ?? 'fs-error'),
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { results }
}

/** Send one path to the OS recycle bin (Windows). Returns whether it worked. */
function trashViaPowerShell(absolute, isDir) {
  if (process.platform !== 'win32') return Promise.resolve(false)
  const method = isDir ? 'DeleteDirectory' : 'DeleteFile'
  const literal = absolute.replace(/'/g, "''")
  const script = "Add-Type -AssemblyName Microsoft.VisualBasic; "
    + `[Microsoft.VisualBasic.FileIO.FileSystem]::${method}('${literal}','OnlyErrorDialogs','SendToRecycleBin')`
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
    } catch {
      resolve(false)
      return
    }
    child.on('error', () => resolve(false))
    child.on('close', code => resolve(code === 0))
  })
}

/**
 * Delete entries. With `trash`, a failed recycle-bin call is reported instead
 * of silently falling back to a permanent delete; the caller must explicitly
 * retry with `trash: false`.
 * @param {string} root canonical workspace root
 * @param {{ paths: string[], trash?: boolean, allowPermanent?: boolean }} input
 */
export async function deleteEntries(root, input) {
  const trash = input.trash === true
  const allowPermanent = input.allowPermanent === true
  const results = []
  for (const raw of input.paths) {
    const source = resolveInside(root, raw)
    const display = toRelative(root, source)
    try {
      if (source === root) throw new ApiError('forbidden', 'refusing to delete the project root')
      const info = await statOrNull(source)
      if (info === null) throw new ApiError('not-found', 'path not found', 404)
      if (info.isSymbolicLink()) throw new ApiError('forbidden', 'refusing to delete a symlink', 403)
      let trashed = false
      if (trash) {
        trashed = await trashViaPowerShell(source, info.isDirectory())
        if (!trashed && !allowPermanent) {
          throw new ApiError('trash-failed', `could not move "${display}" to the recycle bin`, 409)
        }
      }
      if (!trashed) await rm(source, { recursive: true, force: false })
      results.push({ path: display, ok: true, trashed })
    } catch (error) {
      results.push({
        path: display,
        ok: false,
        code: error instanceof ApiError ? error.code : (error?.code ?? 'fs-error'),
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { results }
}

/**
 * Append one path to the repository's `.gitignore` (unless already covered
 * verbatim). The file stays at the repository root so git actually honors it.
 *
 * `path` is the absolute path of the file and `repoRoot` the absolute root of
 * the repository it belongs to; a path relative to that repository is still
 * accepted. Both must name the same repository — the entry is written
 * relative to it, because a "../" entry would never match the file
 * (PRD-v4 review R3).
 * @param {string} root canonical workspace root
 * @param {{ path: string, repoRoot?: string }} input
 */
export async function appendIgnore(root, input) {
  const repoRoot = typeof input.repoRoot === 'string' && input.repoRoot !== ''
    ? resolveInside(root, input.repoRoot)
    : root
  const absolute = isAbsolute(input.path)
    ? resolveInside(root, input.path)
    : resolveInside(root, resolvePath(repoRoot, input.path))
  const relative = toRelative(repoRoot, absolute)
  // The entry has to name a path inside the repository.
  if (relative === '' || relative === '..' || relative.startsWith('../')) {
    throw new ApiError('bad-request', 'path is outside the repository')
  }
  const line = `/${relative}`
  const file = join(repoRoot, '.gitignore')
  let existing = ''
  try {
    existing = await readFile(file, 'utf8')
  } catch {
    existing = ''
  }
  const lines = existing.split(/\r?\n/)
  if (lines.includes(line)) return { changed: false, line, file: toRelative(root, file) }
  const prefix = existing === '' || existing.endsWith('\n') ? '' : '\n'
  await appendFile(file, `${prefix}${line}\n`, 'utf8')
  return { changed: true, line, file: toRelative(root, file) }
}
