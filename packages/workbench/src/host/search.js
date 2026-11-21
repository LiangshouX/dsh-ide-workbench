/**
 * Project-wide file index and text search.
 *
 * Three paths answer a search, in this order:
 *
 *   1. the git path (`git grep`) - a repository, with the .gitignore rules;
 *   2. the external scanner (`ripgrep`) - every other workspace, and the
 *      fallback of the git path;
 *   3. the built-in walk - the last resort, and the only path that needs
 *      nothing but the file system.
 *
 * The two fast paths print the lines around a hit, so the context of a hit
 * costs no second read of the file. The walk reads the files itself - but
 * concurrently, and with a bounded amount of memory in flight: a serial read
 * of every file was 94 % of the time of a search (5.2 s of 6.3 s on a
 * 20 000 file tree).
 *
 * The three paths answer the SAME question (PRD-v8 FIND-04): the same
 * filters, the same excludes, the same hits. A query that answers
 * differently depending on which path served it is what makes a search feel
 * broken.
 *
 * The rules that keep a big repository from breaking the search:
 *
 *   - every path honours the abort of the request. The client aborts the
 *     scan of the keystroke before on every keystroke; a scan that keeps
 *     running would pile up one `git grep` per keystroke (FIND-03);
 *   - a path that runs into its timeout is NOT an error: the next path takes
 *     over, and an answer that is partial says so (FIND-03);
 *   - a path that timed out never falls back to the SLOWER walk - the answer
 *     it has is partial, and the walk would be slower than the path that
 *     just timed out;
 *   - the output of the fast paths is read line by line: a scan that stops at
 *     the cap of the hits must not buffer a multi-megabyte stdout first.
 */
import { open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ApiError } from './wire.js'
import { runGit } from './git.js'
import { toRelative } from './workspace.js'
import {
  buildScannerArgs, parseScanRecord, resolveScannerBinary, runScanner, SCANNER_TIMEOUT_MS,
} from './scanner.js'

/** Directories never walked by the fallback. */
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt',
  '.cache', '.turbo', '.parcel-cache', 'target', 'vendor', '__pycache__',
])
/**
 * The directories that are noise for a code search.
 *
 * They are the directories of `SKIP_DIRS`, and they are skipped at ANY depth:
 * the walk skips them while it walks, the scanner skips them with a glob, and
 * the git path skips them with a pathspec - so all three answer the same.
 */
const DEFAULT_EXCLUDES = [...SKIP_DIRS]
/** A single source file larger than this is never searched. */
const MAX_SEARCH_BYTES = 2 << 20
/** Hard cap on the fallback walk. */
const MAX_FILES = 50_000
/** Hard cap on returned matches. */
const MAX_RESULTS = 2000
/** Context lines kept above and below a hit (PRD-v5 §6.3). */
const CONTEXT_LINES = 5
/** Hits of one file that are reported. */
const MAX_MATCHES_PER_FILE = 200
/** Hits of one file that keep their context lines. */
const MAX_CONTEXT_HITS_PER_FILE = 200
/** The whole search payload must stay under this size. */
const MAX_PAYLOAD_BYTES = 2 << 20
/** The shortest preview kept when the payload budget bites. */
const MIN_PREVIEW_CHARS = 40
/** How many files the walk reads at the same time. */
const READ_CONCURRENCY = 32
/** How many bytes of file content may be in flight at the same time. */
const READ_BUDGET_BYTES = 32 << 20
/** The budget of the whole search: the answer comes within it. */
const SEARCH_TIMEOUT_MS = 30_000
/**
 * The timeout of the git fast path.
 *
 * `git grep --untracked` walks the whole work tree and is the slowest of the
 * three paths (14-18x the tracked-only scan on a 20 000 file tree). The
 * scanner is faster, so the git path gets the smaller share of the budget:
 * a repository that is too big for it is answered by the scanner.
 */
const GIT_TIMEOUT_MS = 10_000
/** The time the last-resort walk gets when the budget is already spent. */
const MIN_WALK_MS = 5_000

function isRepo(env) {
  return env?.isRepo === true || (typeof env?.repoRoot === 'string' && env.repoRoot !== '')
}

/** Was the failure the timeout of a git call? */
function isGitTimeout(error) {
  return error instanceof ApiError && error.code === 'git-timeout'
}

/** Repository-relative path → workspace-relative path. */
function mapPath(env, path) {
  const normalized = String(path).split('\\').join('/')
  return env.prefix === '' || env.prefix === undefined ? normalized : `${env.prefix}/${normalized}`
}

/**
 * The path of a scanner output, relative to the workspace.
 *
 * The scanner prints the path the way the file system spells it (`.\src\a.ts`
 * on Windows), the walk and the git path speak forward slashes.
 *
 * @param {string} path the path of the scanner output
 * @returns {string} the workspace-relative path
 */
export function scannerPath(path) {
  let normalized = String(path).split('\\').join('/')
  while (normalized.startsWith('./')) normalized = normalized.slice(2)
  return normalized
}

/**
 * One recursive workspace walk, used outside git repositories.
 * @param {string} root the workspace root
 * @param {{maxFiles?: number}} [options] the cap of the walk
 * @returns {Promise<{files: string[], truncated: boolean}>} the files and
 *   whether the walk stopped at the file cap
 */
async function walkFiles(root, options = {}) {
  const maxFiles = Number.isSafeInteger(options.maxFiles) && options.maxFiles > 0
    ? options.maxFiles
    : MAX_FILES
  const output = []
  let truncated = false
  const walk = async (dir) => {
    if (output.length >= maxFiles) {
      truncated = true
      return
    }
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (output.length >= maxFiles) {
        truncated = true
        return
      }
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await walk(join(dir, entry.name))
      } else if (entry.isFile()) {
        output.push(toRelative(root, join(dir, entry.name)))
      }
    }
  }
  await walk(root)
  return { files: output.map(path => `${path}`), truncated }
}

/**
 * The order of the file index.
 *
 * The order is the code-unit order of the path: a total order, and therefore
 * a predictable one. `localeCompare` would promise the ICU collation of the
 * locale of the machine - locale dependent, and about six times slower than a
 * plain comparison (PRD-v5 PERF-02). The sort never promised a collation,
 * only that it is stable and predictable, so the plain order is the honest
 * choice: it is also the same order on every machine.
 *
 * The comparison is a total order, so `Array.prototype.sort` (stable since
 * V8 7.0) keeps the input order of equal entries. The list is deduplicated
 * before it is sorted, so no two entries are equal anyway and the order does
 * not depend on the order git or the filesystem reported the paths in.
 *
 * @param {string} left the first path
 * @param {string} right the second path
 * @returns {number} -1, 0 or 1
 */
function comparePaths(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

/**
 * The patterns of the caller, cleaned up.
 *
 * @param {unknown} value the raw value of the option
 * @returns {string[]} the patterns, without the empty ones
 */
function normalizePatterns(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const pattern of value) {
    if (typeof pattern !== 'string') continue
    const trimmed = pattern.trim().split('\\').join('/')
    if (trimmed === '') continue
    out.push(trimmed)
  }
  return out
}

/** Does a pattern hold a wildcard? */
function isGlob(pattern) {
  return /[*?[\]]/.test(pattern)
}

/**
 * The matcher of one glob.
 *
 * `*` stays inside one segment, `**` crosses the segments, `?` is one
 * character. The matcher is built once per pattern and then used for every
 * path of the search.
 *
 * @param {string} pattern the glob
 * @returns {RegExp} the matcher of the glob
 */
function globMatcher(pattern) {
  let source = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          // `**/` may also match nothing at all.
          source += '(?:.*/)?'
          index += 2
        } else {
          source += '.*'
          index += 1
        }
        continue
      }
      source += '[^/]*'
      continue
    }
    if (char === '?') {
      source += '[^/]'
      continue
    }
    source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`${source}$`)
}

/**
 * Does a path match one pattern of the caller?
 *
 * A pattern is either a plain path prefix (`src`, `src/`) or a glob
 * (`*.ts`, `src/**\/*.ts`, `**\/dist/**`).
 *
 * The plain prefix matches the path itself and the paths UNDER it - and
 * nothing else: `src` must not match `src-old/a.ts`. The old rule was a
 * plain `startsWith`, which matched `src-old/a.ts` as well - and a glob that
 * looks supported but matches nothing is worse than a wrong answer.
 *
 * A glob without a separator is a FILE MASK: `*.ts` matches every file of
 * the project whose name ends in `.ts`, at any depth - the way the user
 * reads it.
 *
 * @param {string} path the workspace-relative path (forward slashes)
 * @param {string} pattern the pattern of the caller
 * @returns {boolean} whether the path matches
 */
export function matchesPattern(path, pattern) {
  if (typeof path !== 'string' || path === '') return false
  if (typeof pattern !== 'string' || pattern === '') return false
  const value = pattern.split('\\').join('/')
  if (!isGlob(value)) {
    const prefix = value.replace(/\/+$/, '')
    if (prefix === '') return true
    return path === prefix || path.startsWith(`${prefix}/`)
  }
  const matcher = globMatcher(value)
  if (value.includes('/')) return matcher.test(path)
  // A file mask: the name of the file is what the mask talks about.
  const slash = path.lastIndexOf('/')
  return matcher.test(slash < 0 ? path : path.slice(slash + 1))
}

/**
 * Does a path match any of the patterns?
 *
 * @param {string} path the workspace-relative path (forward slashes)
 * @param {string[]} patterns the patterns of the caller
 * @returns {boolean} whether the path matches one of them
 */
function matchesAny(path, patterns) {
  for (const pattern of patterns) {
    if (matchesPattern(path, pattern)) return true
  }
  return false
}

/**
 * Is a path inside one of the directories that are noise?
 *
 * The walk skips such a DIRECTORY, so a file that is named `out` is not
 * noise - only a directory below the path is.
 *
 * @param {string} path the workspace-relative path (forward slashes)
 * @returns {boolean} whether the path is noise
 */
export function isNoisePath(path) {
  if (typeof path !== 'string' || path === '') return false
  const parts = path.split('/')
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (SKIP_DIRS.has(parts[index])) return true
  }
  return false
}

/**
 * The filter of the paths of one search.
 *
 * The SAME filter is applied by the three paths: the noise directories, the
 * include patterns and the exclude patterns. A query must not answer
 * differently depending on which path served it (PRD-v8 FIND-04).
 *
 * @param {{include?: string[], exclude?: string[]}} options the options
 * @returns {(path: string) => boolean} the filter
 */
function pathFilter(options) {
  const include = normalizePatterns(options.include)
  const exclude = normalizePatterns(options.exclude)
  return (path) => {
    if (isNoisePath(path)) return false
    if (include.length > 0 && !matchesAny(path, include)) return false
    if (exclude.length > 0 && matchesAny(path, exclude)) return false
    return true
  }
}

/**
 * List every project file (workspace-relative, forward slashes).
 * @param {{ root: string, workspaceRoot: string, prefix?: string, isRepo?: boolean }} env
 * @param {{maxFiles?: number, git?: Function, signal?: AbortSignal}} [options] the cap of the walk
 * @returns {Promise<{files: string[], tookMs: number, truncated: boolean}>}
 */
export async function listFiles(env, options = {}) {
  const started = Date.now()
  const maxFiles = Number.isSafeInteger(options.maxFiles) && options.maxFiles > 0
    ? options.maxFiles
    : MAX_FILES
  if (isRepo(env)) {
    const run = typeof options.git === 'function' ? options.git : runGit
    try {
      const result = await run(env, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        allowFailure: true,
        signal: options.signal,
      })
      if (result.code === 0) {
        const all = [...new Set(result.stdout.split('\0').filter(Boolean).map(path => mapPath(env, path)))]
          .sort(comparePaths)
        // The index of a huge repository is capped - and the answer says so:
        // a silent cap looks like a search that found nothing.
        const truncated = all.length > maxFiles
        return {
          files: truncated ? all.slice(0, maxFiles) : all,
          tookMs: Date.now() - started,
          truncated,
        }
      }
    } catch (error) {
      // A git that times out is not an answer: the walk takes over. The file
      // index is the base of the tree search - it must not fail with it.
      if (!isGitTimeout(error)) throw error
    }
  }
  const walked = await walkFiles(env.workspaceRoot ?? env.root, options)
  const files = [...new Set(walked.files)].sort(comparePaths)
  return { files, tookMs: Date.now() - started, truncated: walked.truncated }
}

/** Escape a literal string for a regular expression. */
export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Build the search regular expression (throws on a bad user pattern). */
export function buildPattern(query, options = {}) {
  const source = options.regexp === true ? String(query) : escapeRegExp(query)
  const word = options.wholeWord === true ? `\\b(?:${source})\\b` : source
  try {
    return new RegExp(word, options.caseSensitive === true ? 'g' : 'gi')
  } catch (error) {
    throw new ApiError('bad-pattern', error instanceof Error ? error.message : String(error))
  }
}

function previewOf(line) {
  const text = line.replace(/\r$/, '').trim()
  return text.length > 240 ? `${text.slice(0, 240)}…` : text
}

/**
 * The text of one context line.
 *
 * The indentation is kept — it carries meaning in code — but the carriage
 * return of a CRLF file is dropped.
 * @param {string} line the raw line
 * @returns {string} the line as the client shows it
 */
function contextLine(line) {
  return line.replace(/\r$/, '')
}

/**
 * The lines of a file.
 *
 * A file that ends with a newline has no last line: the empty tail of the
 * split is not a line of the file and must not show up as context.
 *
 * @param {string} text the file content
 * @returns {string[]} the lines, without their line terminators
 */
function splitLines(text) {
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * The lines around one hit.
 * @param {string[]} lines every line of the file
 * @param {number} index zero-based index of the hit line
 * @returns {{before: string[], after: string[]}} the context lines
 */
function contextAround(lines, index) {
  return {
    before: lines.slice(Math.max(0, index - CONTEXT_LINES), index).map(contextLine),
    after: lines.slice(index + 1, index + 1 + CONTEXT_LINES).map(contextLine),
  }
}

/**
 * Add one hit to the group of its file.
 *
 * Every hit carries the lines around it, so the client can show the hit in
 * its context. The context is empty for a binary file (there is nothing
 * readable around the hit) and for the hits the payload budget took away.
 *
 * @param {{path: string, matches: object[]}} entry the group of the file
 * @param {number} line one-based line number
 * @param {number} column one-based column
 * @param {string} preview the hit line, trimmed
 * @param {{before: string[], after: string[]}|null} [context] the lines around the hit
 * @param {boolean} [binary] true when the hit is inside a binary file
 */
function addMatch(entry, line, column, preview, context = null, binary = false) {
  if (entry.matches.length >= MAX_MATCHES_PER_FILE) return
  const match = { line, column, preview, before: [], after: [] }
  if (binary === true) {
    // A binary file has no readable lines: the client says so instead of
    // showing a preview.
    match.binary = true
  } else if (context !== null && entry.matches.length < MAX_CONTEXT_HITS_PER_FILE) {
    match.before = context.before
    match.after = context.after
  }
  entry.matches.push(match)
}

/**
 * The size of the search payload in bytes.
 * @param {Array<object>} files the result groups
 * @returns {number} the serialized size
 */
function payloadSize(files) {
  return Buffer.byteLength(JSON.stringify(files), 'utf8')
}

/**
 * Drop the context lines of the later hits until the payload fits the budget.
 *
 * The context is the first thing to go: the hit and its preview stay, so a
 * trimmed hit is still a hit — it just cannot show the lines around it.
 *
 * @param {Array<{path: string, matches: object[]}>} files the result groups
 * @param {number} [limitBytes] the payload budget
 * @returns {Array<{path: string, matches: object[]}>} the same groups
 */
export function trimContextToBudget(files, limitBytes = MAX_PAYLOAD_BYTES) {
  let size = payloadSize(files)
  if (size <= limitBytes) return files
  for (let fileIndex = files.length - 1; fileIndex >= 0 && size > limitBytes; fileIndex -= 1) {
    const matches = files[fileIndex].matches
    for (let matchIndex = matches.length - 1; matchIndex >= 0 && size > limitBytes; matchIndex -= 1) {
      const match = matches[matchIndex]
      if (match.before.length === 0 && match.after.length === 0) continue
      const before = match.before
      const after = match.after
      match.before = []
      match.after = []
      // The two empty arrays replace the filled ones in the payload.
      size -= Buffer.byteLength(JSON.stringify(before), 'utf8') + Buffer.byteLength(JSON.stringify(after), 'utf8') - 4
    }
  }
  // The previews alone can still exceed the budget (a huge result set of very
  // long lines): shorten them as well.
  for (let fileIndex = files.length - 1; fileIndex >= 0 && size > limitBytes; fileIndex -= 1) {
    const matches = files[fileIndex].matches
    for (let matchIndex = matches.length - 1; matchIndex >= 0 && size > limitBytes; matchIndex -= 1) {
      const match = matches[matchIndex]
      if (match.preview.length <= MIN_PREVIEW_CHARS) continue
      const shortened = `${match.preview.slice(0, MIN_PREVIEW_CHARS)}…`
      size -= Buffer.byteLength(match.preview, 'utf8') - Buffer.byteLength(shortened, 'utf8')
      match.preview = shortened
    }
  }
  return files
}

/**
 * Map over items with a bounded number of concurrent calls.
 *
 * The workspace is read by many files at once, but never without a limit: a
 * tree of 20 000 files must not open 20 000 handles at the same time.
 *
 * The same helper lives in `host/workspace.js` for the tree; it is not
 * exported there, and this module must not depend on a file it does not own.
 *
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

/**
 * The budget of the bytes that may be in flight.
 *
 * The concurrency limit bounds the number of files; the budget bounds their
 * size. A workspace of huge files would otherwise fill the memory of the
 * host with the content it is searching.
 */
class ByteBudget {
  /** @param {number} limit the bytes that may be in flight */
  constructor(limit) {
    this.limit = limit
    this.used = 0
    this.waiters = []
  }

  /**
   * Wait until `size` bytes fit into the budget.
   * @param {number} size the bytes of one file
   * @param {AbortSignal} [signal] the signal of the request
   * @returns {Promise<boolean>} false when the request was aborted
   */
  async reserve(size, signal) {
    const wanted = Math.min(size, this.limit)
    while (this.used + wanted > this.limit) {
      if (signal?.aborted === true) return false
      await new Promise(resolve => { this.waiters.push(resolve) })
    }
    if (signal?.aborted === true) return false
    this.used += wanted
    return true
  }

  /**
   * Give the bytes of one file back.
   * @param {number} size the bytes of one file
   */
  release(size) {
    this.used -= Math.min(size, this.limit)
    const next = this.waiters.shift()
    if (next !== undefined) next()
  }
}

/**
 * Read one file of the workspace, with a bounded size.
 *
 * The file is measured before it is read: a file that is too big is not
 * searched (as before), and it never fills the memory of the host.
 *
 * @param {string} absolute the absolute path of the file
 * @param {ByteBudget} budget the budget of the bytes in flight
 * @param {AbortSignal} [signal] the signal of the request
 * @returns {Promise<Buffer|null>} the content, `null` when the file cannot be
 *   read, is too big or the request was aborted
 */
async function readSearchableFile(absolute, budget, signal) {
  let handle = null
  try {
    handle = await open(absolute, 'r')
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_SEARCH_BYTES) return null
    if (signal?.aborted === true) return null
    const reserved = await budget.reserve(info.size, signal)
    if (!reserved) return null
    try {
      const buffer = Buffer.allocUnsafe(info.size)
      let read = 0
      while (read < info.size) {
        const { bytesRead } = await handle.read(buffer, read, info.size - read, read)
        if (bytesRead <= 0) break
        read += bytesRead
      }
      return buffer.subarray(0, read)
    } finally {
      budget.release(info.size)
    }
  } catch {
    // The file vanished or cannot be read: it is not searched.
    return null
  } finally {
    if (handle !== null) {
      try {
        await handle.close()
      } catch {
        // The handle is gone anyway.
      }
    }
  }
}

/**
 * The hits of one file of the walk.
 *
 * One hit per line: the fast paths (git grep and ripgrep) report the first
 * hit of a line only, and the three paths have to agree.
 *
 * @param {Buffer} buffer the content of the file
 * @param {string} path the workspace-relative path
 * @param {RegExp} pattern the search pattern
 * @param {number} limit how many hits are still missing
 * @returns {{path: string, matches: object[]}|null} the group of the file
 */
function scanBuffer(buffer, path, pattern, limit) {
  // A NUL byte means the file is binary: there is nothing readable around a
  // hit, but the user still wants to know that the file matched. The walk
  // reads the whole file; the external scanner stops at the NUL, so a binary
  // file whose NUL comes before the match is reported by the walk only.
  const binary = buffer.subarray(0, 8192).includes(0)
  const lines = splitLines(buffer.toString('utf8'))
  const entry = { path, matches: [] }
  for (let index = 0; index < lines.length; index += 1) {
    pattern.lastIndex = 0
    const match = pattern.exec(lines[index])
    if (match === null) continue
    addMatch(
      entry,
      index + 1,
      match.index + 1,
      binary ? '' : previewOf(lines[index]),
      binary ? null : contextAround(lines, index),
      binary,
    )
    if (binary) break
    if (limit !== undefined && entry.matches.length >= limit) break
  }
  if (entry.matches.length === 0) return null
  return entry
}

/**
 * The lines around one hit of a scanner run.
 *
 * The scanner prints the context of a hit, so the lines around it are known
 * without reading the file again.
 *
 * @param {Map<number, string>} context the lines of the file, by number
 * @param {number} line the line of the hit
 * @returns {{before: string[], after: string[]}} the context lines
 */
function contextOfScan(context, line) {
  const before = []
  for (let at = Math.max(1, line - CONTEXT_LINES); at < line; at += 1) {
    const text = context.get(at)
    if (text !== undefined) before.push(contextLine(text))
  }
  const after = []
  for (let at = line + 1; at <= line + CONTEXT_LINES; at += 1) {
    const text = context.get(at)
    if (text !== undefined) after.push(contextLine(text))
  }
  return { before, after }
}

/**
 * Group the entries of a scanner run into the result groups.
 *
 * @param {Array<{kind: string, path: string, line: number, column: number, text: string}>} entries
 * @param {(path: string) => string} mapPath the mapping of the path
 * @returns {{files: Array<{path: string, matches: object[]}>}} the groups
 */
export function groupScanEntries(entries, mapPath) {
  /** @type {Map<string, {path: string, hits: object[], context: Map<number, string>}>} */
  const files = new Map()
  for (const entry of entries) {
    const path = mapPath(entry.path)
    let file = files.get(path)
    if (file === undefined) {
      file = { path, hits: [], context: new Map() }
      files.set(path, file)
    }
    if (entry.kind === 'context') {
      // The context of a hit is a line of the file: it is kept, so the hit
      // can show the lines around it.
      if (!file.context.has(entry.line)) file.context.set(entry.line, entry.text)
      continue
    }
    if (file.hits.length >= MAX_MATCHES_PER_FILE) continue
    if (entry.kind === 'binary') {
      file.hits.push({ line: entry.line, column: entry.column, preview: '', before: [], after: [], binary: true })
      continue
    }
    file.hits.push({ line: entry.line, column: entry.column, preview: previewOf(entry.text), before: [], after: [] })
    // The line of a hit is a line of the file too: it is the context of the
    // hits around it.
    file.context.set(entry.line, entry.text)
  }
  const result = []
  for (const file of files.values()) {
    if (file.hits.length === 0) continue
    const matches = []
    for (const hit of file.hits) {
      if (hit.binary !== true && matches.length < MAX_CONTEXT_HITS_PER_FILE) {
        const context = contextOfScan(file.context, hit.line)
        hit.before = context.before
        hit.after = context.after
      }
      matches.push(hit)
    }
    result.push({ path: file.path, matches })
  }
  result.sort((left, right) => comparePaths(left.path, right.path))
  return { files: result }
}

/**
 * The external scanner path.
 *
 * The scanner prints the context of every hit, so the matched files are not
 * read again - the re-read was 425 ms per 1000 matched files, and the whole
 * workspace when the query hits everywhere.
 *
 * @param {{root: string, workspaceRoot?: string, isRepo?: boolean}} env
 * @param {string} query the search term
 * @param {{caseSensitive?: boolean, wholeWord?: boolean, regexp?: boolean,
 *   include?: string[], exclude?: string[], maxResults?: number,
 *   signal?: AbortSignal, scanner?: string|false, scannerTimeoutMs?: number,
 *   deadline?: number}} options
 * @returns {Promise<{files: Array<{path: string, matches: object[]}>, truncated: boolean,
 *   aborted?: boolean, timedOut?: boolean}|null>}
 *   `null` when the machine has no scanner
 */
async function searchWithScanner(env, query, options) {
  // The binary of the scanner: the one of the machine, or the one the caller
  // names (the tests run against a known binary). `false` forbids the
  // scanner, so the walk can be measured on its own.
  if (options.scanner === false) return null
  // An aborted request has no reader left: the scan does not start.
  if (options.signal?.aborted === true) return null
  const binary = typeof options.scanner === 'string' && options.scanner !== ''
    ? options.scanner
    : resolveScannerBinary()
  if (binary === null) return null
  const root = env.workspaceRoot ?? env.root
  const args = buildScannerArgs(query, {
    caseSensitive: options.caseSensitive,
    wholeWord: options.wholeWord,
    regexp: options.regexp,
    isRepo: isRepo(env),
    excludes: [...SKIP_DIRS],
    contextLines: CONTEXT_LINES,
  })
  const maxResults = options.maxResults ?? MAX_RESULTS
  const entries = []
  let hits = 0
  let truncated = false
  const result = await runScanner(binary, args, {
    cwd: root,
    signal: options.signal,
    // The scanner never gets more than the rest of the budget of the search.
    timeoutMs: scannerTimeout(options),
    onLine: (line) => {
      const entry = parseScanRecord(line)
      if (entry === null) return true
      if (entry.kind === 'hit') {
        hits += 1
        // One hit more than the cap: the answer knows that it stopped.
        if (hits > maxResults) {
          truncated = true
          return false
        }
      }
      entries.push(entry)
      return true
    },
  })
  // The request is gone: the answer is not wanted any more, and the walk must
  // not start either.
  if (result.aborted === true) return { files: [], truncated: false, aborted: true }
  const accept = pathFilter(options)
  // A scanner that TIMED OUT has an answer - a partial one. It must not fall
  // back to the walk: the walk is slower than the scanner that just ran into
  // its timeout, so the fallback would make the search slower, not faster.
  if (result.timedOut === true) {
    const grouped = groupScanEntries(entries, scannerPath)
    return { files: grouped.files.filter(file => accept(file.path)), truncated: true, timedOut: true }
  }
  // A scanner that failed (a pattern it does not understand) is not an
  // answer: the walk takes over. A scan that was stopped at the cap IS an
  // answer - the child was killed on purpose.
  if (!result.stopped && result.code !== 0 && result.code !== 1) return null
  const grouped = groupScanEntries(entries, scannerPath)
  const files = grouped.files.filter(file => accept(file.path))
  return { files, truncated }
}

/**
 * The timeout of the scanner run.
 *
 * The scanner never gets more than the rest of the budget of the search: a
 * scan that would answer after the budget is spent is a scan that answers
 * too late.
 *
 * @param {{scannerTimeoutMs?: number, deadline?: number}} options the options
 * @returns {number} the timeout in milliseconds
 */
function scannerTimeout(options) {
  const own = Number.isSafeInteger(options.scannerTimeoutMs) && options.scannerTimeoutMs > 0
    ? options.scannerTimeoutMs
    : SCANNER_TIMEOUT_MS
  if (typeof options.deadline !== 'number') return own
  return Math.max(1, Math.min(own, options.deadline - Date.now()))
}

/**
 * The git grep fast path. Returns null when git cannot serve the request.
 * @param {{root: string, workspaceRoot?: string, prefix?: string}} env
 * @param {string} query the search term
 * @param {{caseSensitive?: boolean, wholeWord?: boolean, regexp?: boolean,
 *   include?: string[], exclude?: string[], maxResults?: number,
 *   signal?: AbortSignal, git?: Function, gitTimeoutMs?: number,
 *   deadline?: number}} options
 * @returns {Promise<{files: Array<{path: string, matches: object[]}>, truncated: boolean,
 *   aborted?: boolean}|null>}
 */
async function searchWithGit(env, query, options) {
  // An aborted request has no reader left: the scan does not start.
  if (options.signal?.aborted === true) return null
  // A REGULAR EXPRESSION is not the dialect of `git grep -E`: the POSIX of git
  // has no `\d` (it is a literal `d` there) and its classes are not the ones
  // of the RegExp of JS. The git path would answer with the hits of another
  // language - so it only serves the LITERAL searches, and the scanner (or
  // the walk) answers the rest (FIND-04).
  if (options.regexp === true) return null
  const base = ['grep', '--no-color', '-n', '-I', '--column', '--untracked']
  // The path is separated from the rest of the line by a NUL byte: the parser
  // then knows the path exactly, and the shape of the rest tells a hit from a
  // context line - without asking the pattern.
  base.push('-z')
  if (options.caseSensitive !== true) base.push('-i')
  if (options.wholeWord === true) base.push('-w')
  // The context comes with the hits: git grep prints the lines around a hit,
  // so the matched files do not have to be read again.
  base.push('-C', String(CONTEXT_LINES))
  base.push('-F', '-e', query, '--')
  // Generated/vendor trees are noise for a code search. The fallback walk
  // already skips them; keep the fast git path consistent - at ANY depth, the
  // way the walk skips them.
  base.push(...DEFAULT_EXCLUDES.map(name => `:(exclude,glob)**/${name}/**`))
  // A plain prefix is a pathspec of git as well - a glob is not (the pathspec
  // of git has a syntax of its own), so a glob is filtered in JS.
  const include = normalizePatterns(options.include)
  for (const pattern of include) {
    if (!isGlob(pattern)) base.push(pattern)
  }
  const maxResults = options.maxResults ?? MAX_RESULTS
  const entries = []
  let hits = 0
  let truncated = false
  const run = typeof options.git === 'function' ? options.git : runGit
  let result
  try {
    result = await run(env, base, {
      allowFailure: true,
      // The request of the client: an outdated scan must not keep a
      // `git grep` running over the whole work tree (FIND-03).
      signal: options.signal,
      timeoutMs: gitTimeout(options),
      // The output is read line by line: a scan that stops at the cap must
      // not buffer a multi-megabyte stdout first.
      onLine: (line) => {
        const entry = parseScanRecord(line)
        if (entry === null) return true
        if (entry.kind === 'hit') {
          hits += 1
          if (hits > maxResults) {
            truncated = true
            return false
          }
        }
        entries.push(entry)
        return true
      },
    })
  } catch (error) {
    // A git that times out is not an answer - and it is not an error either:
    // the next path takes over. A bad pattern is the input of the user and
    // stays an error.
    if (isGitTimeout(error)) return null
    throw error
  }
  // The request is gone: the answer is not wanted any more, and the next path
  // must not start either.
  if (result?.aborted === true) return { files: [], truncated: false, aborted: true }
  if (result.code === 1) return { files: [], truncated: false } // no match
  if (result.code !== 0) {
    // A bad user regex is an input error; anything else may be an old git
    // without --untracked/--column, so let the caller fall back to the walk.
    if (/fatal:|error:/i.test(result.stderr) && /regex|pattern|invalid/i.test(result.stderr)) {
      throw new ApiError('bad-pattern', result.stderr.trim())
    }
    return null
  }
  const grouped = groupScanEntries(entries, path => mapPath(env, path))
  const accept = pathFilter(options)
  return { files: grouped.files.filter(file => accept(file.path)), truncated }
}

/**
 * The timeout of the git fast path.
 *
 * @param {{gitTimeoutMs?: number, deadline?: number}} options the options
 * @returns {number} the timeout in milliseconds
 */
function gitTimeout(options) {
  const own = Number.isSafeInteger(options.gitTimeoutMs) && options.gitTimeoutMs > 0
    ? options.gitTimeoutMs
    : GIT_TIMEOUT_MS
  if (typeof options.deadline !== 'number') return own
  return Math.max(1, Math.min(own, options.deadline - Date.now()))
}

/**
 * The built-in walk: every file of the workspace, read concurrently.
 * @param {{root: string, workspaceRoot?: string}} env
 * @param {string} query the search term
 * @param {{caseSensitive?: boolean, wholeWord?: boolean, regexp?: boolean,
 *   include?: string[], exclude?: string[], maxResults?: number,
 *   signal?: AbortSignal}} options
 * @returns {Promise<{files: Array<{path: string, matches: object[]}>, truncated: boolean}>}
 */
async function searchWithWalk(env, query, options) {
  const pattern = buildPattern(query, options)
  const index = await listFiles(env, {
    maxFiles: options.maxFiles,
    git: options.git,
    signal: options.signal,
  })
  const files = index.files
  const accept = pathFilter(options)
  const maxResults = options.maxResults ?? MAX_RESULTS
  const signal = options.signal
  // The walk is the last resort: it gets the rest of the budget of the
  // search - and a little more, because it is the only path that always
  // answers.
  const deadline = typeof options.deadline === 'number'
    ? Math.max(options.deadline, Date.now() + MIN_WALK_MS)
    : undefined
  const budget = new ByteBudget(Number.isSafeInteger(options.readBudgetBytes) && options.readBudgetBytes > 0
    ? options.readBudgetBytes
    : READ_BUDGET_BYTES)
  // The reader of one file. The tests replace it (the same seam the tree has
  // for its listing), so the pool can be observed without a slow disk.
  const read = typeof options.read === 'function' ? options.read : readSearchableFile
  const groups = new Array(files.length)
  let total = 0
  let stopped = false
  // The files are read at the same time - a serial read of 20 000 files was
  // 5.2 s of the 6.3 s of a search. The order of the answer is the order of
  // the index, not the order the reads finished in.
  await mapLimit(files, READ_CONCURRENCY, async (path, at) => {
    if (stopped) return
    if (signal?.aborted === true) {
      stopped = true
      return
    }
    // The budget of the search is spent: the walk stops and the answer says
    // that it is partial. A search that cannot answer in time must say so -
    // never pretend that it found nothing.
    if (deadline !== undefined && Date.now() > deadline) {
      stopped = true
      return
    }
    if (!accept(path)) return
    const absolute = join(env.workspaceRoot ?? env.root, path)
    const buffer = await read(absolute, budget, signal)
    if (buffer === null || buffer === undefined) return
    const entry = scanBuffer(buffer, path, pattern, maxResults - total)
    if (entry === null) return
    groups[at] = entry
    total += entry.matches.length
    if (total >= maxResults) stopped = true
  })
  const result = groups.filter(entry => entry !== undefined)
  return { files: result, truncated: stopped || index.truncated === true }
}

/**
 * Search every project text file.
 *
 * The answer is honest about what it could not do: a path that ran into its
 * timeout says so (`truncated`), and the search that was aborted answers
 * nothing at all - the client drops it anyway.
 *
 * @param {{ root: string, workspaceRoot: string, prefix?: string, isRepo?: boolean, gitPath?: string }} env
 * @param {{ query: string, caseSensitive?: boolean, wholeWord?: boolean, regexp?: boolean,
 *   include?: string[], exclude?: string[], maxResults?: number, signal?: AbortSignal,
 *   timeoutMs?: number }} options
 * @returns {Promise<{files: object[], truncated: boolean, tookMs: number}>}
 */
export async function searchFiles(env, options = {}) {
  const started = Date.now()
  const query = typeof options.query === 'string' ? options.query : ''
  if (query === '') return { files: [], truncated: false, tookMs: 0 }
  buildPattern(query, options) // validate before crossing the git/fallback boundary
  const maxResults = Math.min(Math.max(options.maxResults ?? MAX_RESULTS, 1), MAX_RESULTS)
  // The budget of the whole search: the fast paths share it, and the walk
  // gets what is left (plus a little).
  const budget = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : SEARCH_TIMEOUT_MS
  const deadline = started + budget
  let result = null
  // A repository answers with git grep: it knows the .gitignore rules, and
  // its output carries the context of a hit.
  if (isRepo(env)) result = await searchWithGit(env, query, { ...options, maxResults, deadline })
  // Every other workspace answers with the external scanner, and the walk is
  // the fallback of both.
  if (result === null) result = await searchWithScanner(env, query, { ...options, maxResults, deadline })
  if (result === null) result = await searchWithWalk(env, query, { ...options, maxResults, deadline })
  if (result === null) result = { files: [], truncated: false }
  // The request was aborted: the answer is not wanted any more.
  if (result.aborted === true) return { files: [], truncated: false, tookMs: Date.now() - started }
  let files = result.files
  let truncated = result.truncated === true
  let seen = 0
  for (const file of files) seen += file.matches.length
  if (seen > maxResults) {
    truncated = true
    let left = maxResults
    files = files.map(file => {
      if (left <= 0) return { ...file, matches: [] }
      const matches = file.matches.slice(0, left)
      left -= matches.length
      return { ...file, matches }
    }).filter(file => file.matches.length > 0)
  }
  // The context lines are the bulk of the payload; they are dropped from the
  // later hits when the whole answer would not fit into the budget.
  trimContextToBudget(files)
  return { files, truncated, tookMs: Date.now() - started }
}
