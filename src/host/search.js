/**
 * Project-wide file index and text search.
 *
 * The repository is the fast path: `git ls-files`/`git grep` respect
 * `.gitignore`, skip binaries and are fast enough for a 10k-file project.
 * A non-repository workspace falls back to a bounded directory walk.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ApiError } from './wire.js'
import { runGit } from './git.js'
import { toRelative } from './workspace.js'

/** Directories never walked by the fallback. */
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt',
  '.cache', '.turbo', '.parcel-cache', 'target', 'vendor', '__pycache__',
])
/** Pathspec excludes for the git grep fast path. */
const DEFAULT_EXCLUDES = [
  'dist/**', 'build/**', 'out/**', 'node_modules/**', 'coverage/**',
  '.next/**', '.nuxt/**', '.cache/**', '.turbo/**', '.parcel-cache/**',
  'target/**', 'vendor/**', '__pycache__/**',
]
/** A single source file larger than this is never searched. */
const MAX_SEARCH_BYTES = 2 << 20
/** Hard cap on the fallback walk. */
const MAX_FILES = 50_000
/** Hard cap on returned matches. */
const MAX_RESULTS = 2000
/** Context lines kept above and below a hit (PRD-v5 §6.3). */
const CONTEXT_LINES = 5
/** Hits of one file that keep their context lines. */
const MAX_CONTEXT_HITS_PER_FILE = 200
/** The whole search payload must stay under this size. */
const MAX_PAYLOAD_BYTES = 2 << 20
/** The shortest preview kept when the payload budget bites. */
const MIN_PREVIEW_CHARS = 40

function isRepo(env) {
  return env?.isRepo === true || (typeof env?.repoRoot === 'string' && env.repoRoot !== '')
}

/** Repository-relative path → workspace-relative path. */
function mapPath(env, path) {
  const normalized = String(path).split('\\').join('/')
  return env.prefix === '' || env.prefix === undefined ? normalized : `${env.prefix}/${normalized}`
}

/** One recursive workspace walk, used outside git repositories. */
async function walkFiles(root, prefix = '') {
  const output = []
  const walk = async (dir) => {
    if (output.length >= MAX_FILES) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (output.length >= MAX_FILES) return
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await walk(join(dir, entry.name))
      } else if (entry.isFile()) {
        const absolute = join(dir, entry.name)
        output.push(toRelative(root, absolute))
      }
    }
  }
  await walk(root)
  return output.map(path => `${prefix}${path}`)
}

/**
 * List every project file (workspace-relative, forward slashes).
 * @param {{ root: string, workspaceRoot: string, prefix?: string, isRepo?: boolean }} env
 */
export async function listFiles(env) {
  const started = Date.now()
  if (isRepo(env)) {
    const result = await runGit(env, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { allowFailure: true })
    if (result.code === 0) {
      const files = [...new Set(result.stdout.split('\0').filter(Boolean).map(path => mapPath(env, path)))]
        .sort((left, right) => left.localeCompare(right))
      return { files, tookMs: Date.now() - started }
    }
  }
  const files = await walkFiles(env.workspaceRoot ?? env.root)
  return { files: [...new Set(files)].sort((left, right) => left.localeCompare(right)), tookMs: Date.now() - started }
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
 * @param {Map<string, {path: string, matches: object[]}>} groups the result groups
 * @param {string} path workspace-relative path of the file
 * @param {number} line one-based line number
 * @param {number} column one-based column
 * @param {string} preview the hit line, trimmed
 * @param {{before: string[], after: string[]}|null} [context] the lines around the hit
 * @param {boolean} [binary] true when the hit is inside a binary file
 */
function addMatch(groups, path, line, column, preview, context = null, binary = false) {
  let entry = groups.get(path)
  if (entry === undefined) {
    entry = { path, matches: [] }
    groups.set(path, entry)
  }
  if (entry.matches.length >= 200) return
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
 * Attach the lines around every hit of every file.
 *
 * `git grep` reports one line at a time, so the context can only come from
 * the file itself. The file is read once per file — never once per hit.
 *
 * @param {{root: string, workspaceRoot?: string}} env the workspace environment
 * @param {Map<string, {path: string, matches: object[]}>} groups the result groups
 */
async function attachContext(env, groups) {
  for (const entry of groups.values()) {
    const absolute = join(env.workspaceRoot ?? env.root, entry.path)
    let buffer
    try {
      buffer = await readFile(absolute)
    } catch {
      // The file vanished or cannot be read: the hit stays, without context.
      continue
    }
    if (buffer.length > MAX_SEARCH_BYTES) continue
    if (buffer.subarray(0, 8192).includes(0)) {
      // A binary file has no readable lines around the hit.
      for (const match of entry.matches) {
        match.binary = true
        match.before = []
        match.after = []
      }
      continue
    }
    const lines = splitLines(buffer.toString('utf8'))
    let withContext = 0
    for (const match of entry.matches) {
      if (withContext >= MAX_CONTEXT_HITS_PER_FILE) break
      const index = match.line - 1
      if (index < 0 || index >= lines.length) continue
      const context = contextAround(lines, index)
      match.before = context.before
      match.after = context.after
      withContext += 1
    }
  }
}

/** The git grep fast path. Returns null when git cannot serve the request. */
function parseGitGrep(env, stdout, groups) {
  for (const raw of stdout.split('\n')) {
    if (raw === '') continue
    const match = /^(.+?):(\d+):(\d+):(.*)$/.exec(raw)
    if (match === null) continue
    addMatch(groups, mapPath(env, match[1]), Number(match[2]), Number(match[3]), previewOf(match[4]))
  }
}

async function searchWithGit(env, query, options) {
  const base = ['grep', '--no-color', '-n', '-I', '--column', '--untracked']
  if (options.caseSensitive !== true) base.push('-i')
  if (options.wholeWord === true) base.push('-w')
  base.push(options.regexp === true ? '-E' : '-F', '-e', query, '--')
  const include = Array.isArray(options.include) ? options.include.filter(Boolean) : []
  if (include.length > 0) base.push(...include)
  // Generated/vendor trees are noise for a code search. The fallback walk
  // already skips them; keep the fast git path consistent.
  else base.push(...DEFAULT_EXCLUDES.map(path => `:(exclude)${path}`))
  const result = await runGit(env, base, { allowFailure: true })
  if (result.code === 1) return [] // no match
  if (result.code !== 0) {
    // A bad user regex is an input error; anything else may be an old git
    // without --untracked/--column, so let the caller fall back to the walk.
    if (/fatal:|error:/i.test(result.stderr) && /regex|pattern|invalid/i.test(result.stderr)) {
      throw new ApiError('bad-pattern', result.stderr.trim())
    }
    return null
  }
  const groups = new Map()
  parseGitGrep(env, result.stdout, groups)
  await attachContext(env, groups)
  return [...groups.values()]
}

async function searchWithWalk(env, query, options) {
  const pattern = buildPattern(query, options)
  const { files } = await listFiles(env)
  const include = Array.isArray(options.include) ? options.include.filter(Boolean) : []
  const exclude = Array.isArray(options.exclude) ? options.exclude.filter(Boolean) : []
  const groups = new Map()
  const maxResults = options.maxResults ?? MAX_RESULTS
  let total = 0
  for (const path of files) {
    if (total >= maxResults) break
    if (include.length > 0 && !include.some(prefix => path.startsWith(prefix))) continue
    if (exclude.some(prefix => path.startsWith(prefix))) continue
    const absolute = join(env.workspaceRoot ?? env.root, path)
    let buffer
    try {
      buffer = await readFile(absolute)
    } catch {
      continue
    }
    if (buffer.length > MAX_SEARCH_BYTES) continue
    // A NUL byte means the file is binary: there is nothing readable around a
    // hit, but the user still wants to know that the file matched.
    const binary = buffer.subarray(0, 8192).includes(0)
    const lines = splitLines(buffer.toString('utf8'))
    for (let index = 0; index < lines.length; index += 1) {
      pattern.lastIndex = 0
      let match
      while ((match = pattern.exec(lines[index])) !== null) {
        addMatch(
          groups,
          path,
          index + 1,
          match.index + 1,
          binary ? '' : previewOf(lines[index]),
          binary ? null : contextAround(lines, index),
          binary,
        )
        total += 1
        // One hit is enough for a binary file: its content is not readable.
        if (binary) break
        if (total >= maxResults) break
        if (match[0] === '') pattern.lastIndex += 1
      }
      if (binary) break
      if (total >= maxResults) break
    }
  }
  return [...groups.values()]
}

/**
 * Search every project text file.
 * @param {{ root: string, workspaceRoot: string, prefix?: string, isRepo?: boolean, gitPath?: string }} env
 * @param {{ query: string, caseSensitive?: boolean, wholeWord?: boolean, regexp?: boolean,
 *   include?: string[], exclude?: string[], maxResults?: number }} options
 */
export async function searchFiles(env, options = {}) {
  const started = Date.now()
  const query = typeof options.query === 'string' ? options.query : ''
  if (query === '') return { files: [], truncated: false, tookMs: 0 }
  buildPattern(query, options) // validate before crossing the git/fallback boundary
  const maxResults = Math.min(Math.max(options.maxResults ?? MAX_RESULTS, 1), MAX_RESULTS)
  let files = null
  if (isRepo(env)) files = await searchWithGit(env, query, { ...options, maxResults })
  if (files === null) files = await searchWithWalk(env, query, { ...options, maxResults })
  let seen = 0
  const truncated = files.some((file) => {
    seen += file.matches.length
    return seen > maxResults
  })
  if (seen > maxResults) {
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
