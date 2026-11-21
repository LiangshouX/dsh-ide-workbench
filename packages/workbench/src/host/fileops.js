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
  appendFile, copyFile, lstat, mkdir, readFile, readdir, readlink, rename, rm, symlink, writeFile,
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
function joinInside(root, parent, names) {
  const parts = Array.isArray(names) ? names : [names]
  const absolute = join(parent, ...parts)
  resolveInside(root, absolute)
  return absolute
}

/**
 * Split a name into its path segments.
 *
 * A single segment is the classic case and keeps its exact behaviour. A
 * multi-segment name is a relative path below the parent: every segment is
 * validated on its own, so a dot segment and an illegal character are still
 * refused - the walk out of the project is impossible.
 *
 * @param {string} name the name of the entry, or a relative path below the parent
 * @returns {string[]} the validated segments of the path
 */
export function splitEntryPath(name) {
  const raw = typeof name === 'string' ? name.trim() : ''
  if (raw === '') throw new ApiError('bad-request', 'name must not be empty')
  if (!/[\\/]/.test(raw)) return [validateEntryName(raw)]
  const segments = []
  for (const part of raw.split(/[\\/]/)) {
    // A dot segment would climb out of the parent and an empty one would name
    // nothing: the single-segment contract reports both as an illegal
    // character, and a path has to answer the same way.
    if (part === '' || part === '.' || part === '..') {
      throw new ApiError('bad-request', `name contains an illegal character: "${part}"`)
    }
    segments.push(validateEntryName(part))
  }
  return segments
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
 *
 * The name may be a relative path below the parent (`a/b/c/Foo.java`): every
 * segment is validated on its own, the result stays inside the workspace and
 * the folders of the chain are created when they do not exist yet.
 *
 * @param {string} root canonical workspace root
 * @param {{ parent: string, name: string, isDir?: boolean, content?: string }} input
 */
export async function createEntry(root, input) {
  const segments = splitEntryPath(input.name)
  const parent = await requireDirectory(root, input.parent)
  const dest = joinInside(root, parent, segments)
  if ((await statOrNull(dest)) !== null) {
    throw new ApiError('exists', `"${toRelative(root, dest)}" already exists`)
  }
  const isDir = input.isDir === true
  if (segments.length > 1) {
    // The chain of folders does not exist yet: create it, so a path can be
    // created in one call instead of one call per folder.
    try {
      await mkdir(dirname(dest), { recursive: true })
    } catch (error) {
      throw new ApiError('bad-request', `could not create the folder: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
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
 * @param {{ path: string, signal?: AbortSignal }} input
 */
export async function duplicateEntry(root, input) {
  const source = resolveInside(root, input.path)
  const info = await statOrNull(source)
  if (info === null) throw new ApiError('not-found', 'path not found', 404)
  if (info.isSymbolicLink()) throw new ApiError('forbidden', 'refusing to duplicate a symlink', 403)
  const dest = await uniqueCopyPath(source)
  const copied = await copyTree(source, dest, {
    budget: createCopyBudget(input.budget),
    signal: input.signal,
  })
  if (copied.failures.length > 0) {
    throw new ApiError('bad-request', copied.failures[0].message)
  }
  if (copied.truncated) {
    throw new ApiError('too-large', 'the copy budget of this workspace is used up', 413)
  }
  return { path: toRelative(root, source), target: toRelative(root, dest) }
}

/** Whether `child` is `parent` itself or inside it. */
function isInside(parent, child) {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`))
}

/**
 * How many entries one paste may copy.
 *
 * A paste of a huge folder must not turn the plugin into a slideshow: the
 * copy runs in the host, and the host is the application the user is
 * working in. The budget therefore caps how much ONE paste may copy - and
 * the copy that hits it says so. It never pretends to be complete: a
 * truncated answer is reported, not hidden (the rule of the workbench).
 *
 * The number is a backstop, not a quota: an ordinary tree never reaches it.
 */
export const COPY_ENTRY_BUDGET = 100_000

/**
 * How many bytes one paste may copy (4 GiB).
 *
 * The budget is checked BEFORE a file is copied, so a file is never copied
 * in half - a truncated FILE would be a broken file, and a broken file is
 * worse than a missing one.
 *
 * The number is written as a product, not as a shift: a JavaScript shift
 * works on 32 bits, so `4 << 30` is zero and every paste would be refused.
 */
export const COPY_BYTE_BUDGET = 4 * 1024 * 1024 * 1024

/** How many entries are copied between two yields to the event loop. */
const COPY_YIELD_EVERY = 64

/**
 * The budget of one paste: how many entries and how many bytes it may copy.
 *
 * One budget is shared by every entry of a paste, so a batch of folders
 * cannot buy itself more than one folder would.
 *
 * @param {{ maxEntries?: number, maxBytes?: number }} [options]
 * @returns {{ entries: number, bytes: number, maxEntries: number, maxBytes: number, truncated: boolean }}
 */
export function createCopyBudget(options = {}) {
  return {
    entries: 0,
    bytes: 0,
    maxEntries: Number.isSafeInteger(options.maxEntries) ? options.maxEntries : COPY_ENTRY_BUDGET,
    maxBytes: Number.isSafeInteger(options.maxBytes) ? options.maxBytes : COPY_BYTE_BUDGET,
    truncated: false,
  }
}

/** The message of a thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Copy one file or one folder tree into a destination.
 *
 * The walk is ITERATIVE: a deep tree cannot blow the stack. It yields to the
 * event loop every few entries, so the host keeps answering the other
 * requests while a big tree is copied, and a signal can stop it. Everything
 * that did not happen is reported: an entry that could not be read or
 * copied, and a copy that hit the budget.
 *
 * A symlink is copied as a symlink - it is never followed, so a link into
 * another tree cannot smuggle a whole folder into the copy.
 *
 * @param {string} source the absolute path of the source
 * @param {string} dest the absolute path of the destination
 * @param {{ budget?: ReturnType<typeof createCopyBudget>, signal?: AbortSignal }} [options]
 * @returns {Promise<{ entries: number, bytes: number, truncated: boolean,
 *   failures: Array<{ path: string, message: string }> }>}
 */
export async function copyTree(source, dest, options = {}) {
  const budget = options.budget ?? createCopyBudget()
  const signal = options.signal
  const failures = []
  const stopped = () => {
    if (signal !== undefined && signal !== null && signal.aborted === true) {
      throw new ApiError('cancelled', 'the copy was cancelled', 499)
    }
  }
  stopped()

  const info = await lstat(source)
  if (!info.isDirectory()) {
    // One file: the budget is asked before a byte is written.
    if (budget.entries >= budget.maxEntries || budget.bytes + info.size > budget.maxBytes) {
      budget.truncated = true
      failures.push({ path: source, message: 'the copy budget of this paste is used up' })
      return { entries: 0, bytes: 0, truncated: true, failures }
    }
    await copyFile(source, dest)
    budget.entries += 1
    budget.bytes += info.size
    return { entries: 1, bytes: info.size, truncated: false, failures }
  }

  await mkdir(dest, { recursive: true })
  // The folders that still have to be walked.
  const stack = [{ from: source, to: dest }]
  let entries = 0
  let bytes = 0
  let sinceYield = 0
  while (stack.length > 0) {
    stopped()
    const { from, to } = stack.pop()
    let listing
    try {
      listing = await readdir(from, { withFileTypes: true })
    } catch (error) {
      failures.push({ path: from, message: messageOf(error) })
      continue
    }
    for (const item of listing) {
      stopped()
      const childFrom = join(from, item.name)
      const childTo = join(to, item.name)
      if (item.isDirectory()) {
        if (budget.entries >= budget.maxEntries) {
          budget.truncated = true
          break
        }
        try {
          await mkdir(childTo, { recursive: true })
          stack.push({ from: childFrom, to: childTo })
          budget.entries += 1
          entries += 1
        } catch (error) {
          failures.push({ path: childFrom, message: messageOf(error) })
        }
        continue
      }
      // A file (or a link): its size is known before it is copied, so the
      // budget can refuse it before a byte is written.
      let size = 0
      try {
        size = (await lstat(childFrom)).size
      } catch (error) {
        failures.push({ path: childFrom, message: messageOf(error) })
        continue
      }
      if (budget.entries >= budget.maxEntries || budget.bytes + size > budget.maxBytes) {
        budget.truncated = true
        failures.push({ path: childFrom, message: 'the copy budget of this paste is used up' })
        break
      }
      try {
        if (item.isSymbolicLink()) {
          await symlink(await readlink(childFrom), childTo)
        } else {
          await copyFile(childFrom, childTo)
        }
        budget.entries += 1
        budget.bytes += size
        entries += 1
        bytes += size
      } catch (error) {
        failures.push({ path: childFrom, message: messageOf(error) })
      }
      sinceYield += 1
      if (sinceYield >= COPY_YIELD_EVERY) {
        sinceYield = 0
        // The host has to keep answering while a big tree is copied.
        await new Promise(resolve => setImmediate(resolve))
      }
    }
    if (budget.truncated) break
  }
  return { entries, bytes, truncated: budget.truncated, failures }
}

/**
 * Move or copy entries into one target directory.
 * @param {string} root canonical workspace root
 * @param {{ paths: string[], target: string, copy?: boolean,
 *   conflict?: 'error'|'skip'|'rename'|'overwrite',
 *   signal?: AbortSignal, budget?: object }} input
 */
export async function moveEntries(root, input) {
  const target = await requireDirectory(root, input.target)
  const conflict = input.conflict ?? 'error'
  const copy = input.copy === true
  const signal = input.signal
  const budget = createCopyBudget(input.budget)
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
        // The copy of a folder may be huge: it runs with a budget, it can be
        // stopped, and it reports what it did not copy.
        const copied = await copyTree(source, dest, { budget, signal })
        results.push({
          path: display,
          target: toRelative(root, dest),
          ok: true,
          copied: copied.entries,
          bytes: copied.bytes,
          truncated: copied.truncated,
          failures: copied.failures,
        })
      } else {
        try {
          await rename(source, dest)
        } catch (error) {
          if (error?.code !== 'EXDEV') throw error
          // Cross-device move: copy then delete (never leave two copies).
          await copyTree(source, dest, { budget, signal })
          await rm(source, { recursive: true, force: true })
        }
        results.push({ path: display, target: toRelative(root, dest), ok: true })
      }
    } catch (error) {
      // A cancelled paste stops the whole batch: the user asked for it.
      if (error instanceof ApiError && error.code === 'cancelled') throw error
      results.push({
        path: display,
        ok: false,
        code: error instanceof ApiError ? error.code : (error?.code ?? 'fs-error'),
        message: messageOf(error),
      })
    }
  }
  return { results, truncated: budget.truncated }
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
