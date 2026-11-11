/**
 * Git CLI adapter.
 *
 * Every call is an argv array (never a shell string) executed with the
 * repository root as cwd, so quoting, spaces and CJK paths need no escaping.
 * Output is parsed from machine-friendly formats:
 *   - `status --porcelain=v2 -z --untracked-files=all` (NUL separated, no quoting)
 *   - `log -z` custom field separators
 *   - `diff --numstat -z`
 */
import { spawn } from 'node:child_process'
import { ApiError } from './wire.js'

/** How long one read-only git call may take. */
const READ_TIMEOUT_MS = 30_000
/** Push / pull may talk to a remote (credential manager included). */
const REMOTE_TIMEOUT_MS = 180_000

/**
 * How many git CLI processes this host has started.
 *
 * The counter backs the PRD §1.3 development metrics; it is a plain integer
 * in the host process and never reaches the UI on its own.
 */
let gitProcesses = 0

/** The number of git CLI processes started so far. */
export function gitProcessCount() {
  return gitProcesses
}

/**
 * One command failure with the raw stderr preserved for the UI.
 */
export class GitError extends Error {
  constructor(args, code, stderr, stdout) {
    super(stderr.trim() || stdout.trim() || `git ${args.join(' ')} failed (${code})`)
    this.name = 'GitError'
    this.code = code
    this.stderr = stderr
    this.stdout = stdout
  }
}

/**
 * Run git and resolve with its captured output.
 * @param {{ gitPath?: string, root: string }} env command environment
 * @param {string[]} args argv after the executable
 * @param {{ input?: string, timeoutMs?: number, allowFailure?: boolean, env?: Record<string, string> }} [options]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function runGit(env, args, options = {}) {
  const { input, timeoutMs = READ_TIMEOUT_MS, allowFailure = false } = options
  const executable = env.gitPath && env.gitPath.trim() !== '' ? env.gitPath.trim() : 'git'
  const argv = [
    '-c', 'core.quotepath=false',
    '-c', 'color.ui=false',
    '-c', 'advice.detachedHead=false',
    // A global `status.showUntrackedFiles=normal` folds every untracked
    // directory into a single `? dir/` record; the file tree needs the files
    // themselves, so the configuration must not win here (GIT-01).
    '-c', 'status.showUntrackedFiles=all',
    ...args,
  ]
  return new Promise((resolve, reject) => {
    let child
    try {
      gitProcesses += 1
      child = spawn(executable, argv, {
        cwd: env.root,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_PAGER: 'cat',
          GIT_OPTIONAL_LOCKS: '0',
          LC_ALL: 'C.UTF-8',
          LANG: 'C.UTF-8',
          ...options.env,
        },
      })
    } catch (error) {
      reject(new ApiError('git-unavailable', `cannot start git (${error instanceof Error ? error.message : String(error)})`, 503))
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new ApiError('git-timeout', `git ${args[0] ?? ''} timed out after ${timeoutMs}ms`, 504))
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new ApiError(
        error.code === 'ENOENT' ? 'git-unavailable' : 'git-error',
        error.code === 'ENOENT'
          ? `git executable not found: ${executable}`
          : `git failed to start: ${error.message}`,
        error.code === 'ENOENT' ? 503 : 500,
      ))
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const exit = code ?? -1
      if (exit !== 0 && !allowFailure) {
        reject(new GitError(args, exit, stderr, stdout))
        return
      }
      resolve({ code: exit, stdout, stderr })
    })
    if (input !== undefined) {
      child.stdin.end(input)
    } else {
      child.stdin.end()
    }
  })
}

/** Whether a directory is inside a git work tree; returns the toplevel or null. */
export async function repoRootOf(env) {
  try {
    const { stdout } = await runGit(env, ['rev-parse', '--show-toplevel'])
    const root = stdout.trim()
    return root === '' ? null : root
  } catch {
    return null
  }
}

/**
 * How many status entries one snapshot accepts.
 *
 * `git status --untracked-files=all` lists every untracked file, and the
 * client polls the status every two seconds. A repository with a huge
 * untracked tree (a build output, a `node_modules`) would therefore make
 * every tick build - and ship - a list of hundreds of thousands of entries.
 * The limit is high enough for a normal repository (a few ten thousands of
 * changed files is already extreme) and low enough to keep one snapshot
 * bounded (PRD-v5 supplement §11 risk #1).
 */
export const MAX_STATUS_ENTRIES = 20_000

/**
 * Parse `git status --porcelain=v2 --branch -z`.
 *
 * The records are read one at a time instead of splitting the whole output
 * into an array: a huge untracked tree would otherwise make the parser build
 * an array of hundreds of thousands of strings before it even looks at the
 * first entry. The scan stops at `limit` entries and says so (`truncated`),
 * so the client can tell the user that the list is incomplete.
 * @param {string} buffer the NUL separated status output
 * @param {{ limit?: number }} [options] the entry limit
 * @returns {{ branch: string|undefined, detached: boolean, oid: string|undefined,
 *   upstream: string|undefined, ahead: number|undefined, behind: number|undefined,
 *   entries: Array<{ path: string, xy: string, untracked: boolean, conflict: boolean,
 *     ignored?: boolean, ignoredDir?: boolean }>,
 *   truncated: boolean }}
 */
export function parseStatusV2(buffer, options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : MAX_STATUS_ENTRIES
  const result = {
    branch: undefined,
    detached: false,
    oid: undefined,
    upstream: undefined,
    ahead: undefined,
    behind: undefined,
    entries: [],
    /** True when the entry list hit the limit and the rest was dropped. */
    truncated: false,
  }
  /**
   * Add one entry to the result.
   * @param {{ path: string, xy: string, untracked: boolean, conflict: boolean }} entry
   * @returns {boolean} false when the limit is reached (the scan stops)
   */
  const push = (entry) => {
    if (result.entries.length >= limit) {
      result.truncated = true
      return false
    }
    result.entries.push(entry)
    return true
  }
  let cursor = 0
  while (cursor < buffer.length) {
    const end = buffer.indexOf('\0', cursor)
    let record
    if (end < 0) {
      // A last record without its NUL terminator: git always writes one,
      // but a cut-off output must not lose its last line.
      record = buffer.slice(cursor)
      cursor = buffer.length
    } else {
      record = buffer.slice(cursor, end)
      cursor = end + 1
    }
    if (record === '') continue
    if (record.startsWith('# branch.oid ')) {
      const value = record.slice('# branch.oid '.length)
      if (value !== '(initial)') result.oid = value
      continue
    }
    if (record.startsWith('# branch.head ')) {
      const value = record.slice('# branch.head '.length)
      if (value === '(detached)') result.detached = true
      else result.branch = value
      continue
    }
    if (record.startsWith('# branch.upstream ')) {
      result.upstream = record.slice('# branch.upstream '.length)
      continue
    }
    if (record.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(record)
      if (match) {
        result.ahead = Number(match[1])
        result.behind = Number(match[2])
      }
      continue
    }
    if (record.startsWith('1 ')) {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const xy = record.slice(2, 4)
      const fields = record.slice(2).split(' ')
      const path = fields.slice(7).join(' ')
      if (path !== '' && !push({ path, xy, untracked: false, conflict: false })) return result
      continue
    }
    if (record.startsWith('2 ')) {
      // 2 <XY> ... <X><score> <path>\0<original path>
      const xy = record.slice(2, 4)
      const fields = record.slice(2).split(' ')
      const path = fields.slice(8).join(' ')
      // The original path of the rename is the next record: it must be
      // skipped, or a file whose name starts with "? " would be read as an
      // untracked entry.
      const originalEnd = buffer.indexOf('\0', cursor)
      cursor = originalEnd < 0 ? buffer.length : originalEnd + 1
      if (path !== '' && !push({ path, xy, untracked: false, conflict: false })) return result
      continue
    }
    if (record.startsWith('u ')) {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const xy = record.slice(2, 4)
      const fields = record.slice(2).split(' ')
      const path = fields.slice(9).join(' ')
      if (path !== '' && !push({ path, xy, untracked: false, conflict: true })) return result
      continue
    }
    if (record.startsWith('? ')) {
      if (!push({ path: record.slice(2), xy: '??', untracked: true, conflict: false })) return result
      continue
    }
    if (record.startsWith('! ')) {
      // `--ignored=matching` lists ignored paths here, not as untracked.
      // Porcelain writes an ignored DIRECTORY with a trailing slash
      // (`target/`), while an ignored file has none. The client keys the
      // ignored set by the plain path, so the slash is dropped here — both
      // sides must speak the same key (R6). The directory is marked, because
      // the client has to know that the whole subtree below it is ignored:
      // git does not descend into an ignored directory, so no entry of the
      // subtree ever reaches the client.
      const raw = record.slice(2)
      const isDir = raw.endsWith('/')
      const path = isDir ? raw.replace(/\/+$/, '') : raw
      if (!push({ path, xy: '!!', untracked: false, conflict: false, ignored: true, ignoredDir: isDir })) return result
    }
  }
  return result
}

/** Parse `--numstat -z` into a path → line-count map. */
export function parseNumstat(output) {
  const map = new Map()
  const records = output.split('\0')
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === '') continue
    const firstTab = record.indexOf('\t')
    const secondTab = record.indexOf('\t', firstTab + 1)
    if (firstTab < 0 || secondTab < 0) continue
    const added = record.slice(0, firstTab)
    const deleted = record.slice(firstTab + 1, secondTab)
    const path = record.slice(secondTab + 1)
    if (path === '') {
      // rename: the next record carries the path
      continue
    }
    if (added === '-' || deleted === '-') map.set(path, { binary: true })
    else map.set(path, { additions: Number(added) || 0, deletions: Number(deleted) || 0 })
  }
  return map
}

/**
 * One repository status snapshot, shaped for the three Commit groups.
 *
 * The snapshot costs one `git status` subprocess. The two `git diff --numstat`
 * calls that add the per-file line counts are only made when the Commit
 * window asks for them.
 *
 * The ignored entries are ALWAYS asked for (`--ignored=matching`): the
 * setting only decides whether the client *shows* them, and a client that
 * never receives them cannot grey an ignored folder at all (R6). The
 * `ignored` option is therefore accepted but no longer gates the git flag.
 *
 * The entry list is bounded: a repository with a huge untracked tree would
 * otherwise make every poll tick build a list of hundreds of thousands of
 * entries (PRD-v5 supplement §11 risk #1).
 * @param {{ gitPath?: string, root: string, repoRoot?: string | null }} env
 * @param {{ ignored?: boolean, numstat?: boolean, limit?: number }} [options]
 */
export async function status(env, options = {}) {
  /** The git processes this snapshot spawned (PRD §1.3 counter). */
  let subprocesses = 0
  const run = (repo, args) => {
    subprocesses += 1
    return runGit(repo, args)
  }
  // The host route resolves the repository toplevel before it calls us, so
  // asking git again would add a second subprocess to every poll tick.
  const known = typeof env.repoRoot === 'string' && env.repoRoot !== '' ? env.repoRoot : null
  let root = known
  if (root === null) {
    subprocesses += 1
    root = await repoRootOf(env)
  }
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : MAX_STATUS_ENTRIES
  if (root === null) {
    return { isRepo: false, entries: [], root: null, truncated: false, entryLimit: limit, subprocesses }
  }
  const repo = { ...env, root }
  // `--untracked-files=all` lists every untracked file on its own; the default
  // ('normal') reports a whole untracked directory as one `? dir/` record, and
  // the file tree can then only colour the directory, never the files in it.
  const args = ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']
  // The ignored entries are always asked for. The setting only decides
  // whether the client SHOWS them, and without the entries the tree cannot
  // tell an ignored folder from a normal one (R6). `--ignored=matching`
  // reports the ignored DIRECTORIES as one entry each, so the list does not
  // grow with the size of the ignored tree.
  args.push('--ignored=matching')
  const statusResult = await run(repo, args)
  const parsed = parseStatusV2(statusResult.stdout, { limit })
  let unstagedNumstat = new Map()
  let stagedNumstat = new Map()
  if (options.numstat !== false) {
    try {
      const unstaged = await run(repo, ['diff', '--numstat', '-z', '--no-renames'])
      unstagedNumstat = parseNumstat(unstaged.stdout)
      const staged = await run(repo, ['diff', '--cached', '--numstat', '-z', '--no-renames'])
      stagedNumstat = parseNumstat(staged.stdout)
    } catch {
      // A status snapshot without line counts is still useful.
    }
  }
  const entries = parsed.entries.map((entry) => {
    const x = entry.xy[0] ?? '.'
    const y = entry.xy[1] ?? '.'
    return {
      path: entry.path,
      xy: entry.xy,
      untracked: entry.untracked === true && entry.ignored !== true,
      conflict: entry.conflict,
      ignored: entry.ignored === true,
      // Only an ignored directory carries the flag: the client has to know
      // that the whole subtree below it is ignored (R6). The field stays
      // away from the other entries, so the payload does not grow with the
      // size of the status.
      ...(entry.ignoredDir === true ? { ignoredDir: true } : {}),
      staged: entry.conflict || (!entry.untracked && !entry.ignored && x !== '.' && x !== '?'),
      unstaged: entry.conflict || (!entry.untracked && !entry.ignored && y !== '.' && y !== '?'),
      stagedLines: stagedNumstat.get(entry.path),
      unstagedLines: unstagedNumstat.get(entry.path),
    }
  })
  return {
    isRepo: true,
    root,
    branch: parsed.branch,
    detached: parsed.detached,
    oid: parsed.oid,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    entries,
    /** True when the repository had more entries than the parser accepts. */
    truncated: parsed.truncated === true,
    /** The entry limit the parser applied. */
    entryLimit: limit,
    subprocesses,
  }
}

/**
 * The unified diff of one path.
 * @param {{ gitPath?: string, root: string }} env
 * @param {string} path repo-relative path
 * @param {boolean} staged index-vs-HEAD when true, worktree-vs-index otherwise
 */
export async function diff(env, path, staged) {
  const args = ['diff', '--no-color', '--no-ext-diff', '--unified=3']
  if (staged) args.push('--cached')
  args.push('--', path)
  const { stdout } = await runGit(env, args, { allowFailure: true })
  return stdout
}

/** Stage the given paths. */
export async function stage(env, paths) {
  if (paths.length === 0) throw new ApiError('bad-request', 'no paths')
  await runGit(env, ['add', '--', ...paths])
}

/**
 * Diff one path against a revision (Change View "Last Revision"/"Latest").
 * `latest` resolves the upstream; when the branch has none it falls back to
 * HEAD so the view still shows the local change.
 * @param {{ gitPath?: string, root: string }} env
 * @param {string} path repo-relative path
 * @param {string} rev 'head' | 'latest' | any git revision
 */
export async function diffRev(env, path, rev) {
  const argsFor = ref => ['diff', '--no-color', '--no-ext-diff', '--unified=3', ref, '--', path]
  const base = rev === 'latest' || rev === 'upstream' ? '@{upstream}' : (rev === 'head' ? 'HEAD' : rev)
  if (base === '@{upstream}') {
    try {
      const result = await runGit(env, argsFor(base))
      return result.stdout
    } catch {
      const result = await runGit(env, argsFor('HEAD'), { allowFailure: true })
      return result.stdout
    }
  }
  const result = await runGit(env, argsFor(base), { allowFailure: true })
  return result.stdout
}

/** Unstage the given paths (new files leave the index and stay untracked). */
export async function unstage(env, paths) {
  if (paths.length === 0) throw new ApiError('bad-request', 'no paths')
  await runGit(env, ['reset', '-q', 'HEAD', '--', ...paths])
}

/** Discard worktree *and index* changes of the given paths (rollback). */
export async function discard(env, paths) {
  if (paths.length === 0) throw new ApiError('bad-request', 'no paths')
  // `--worktree` alone leaves a staged modification in the index (the file
  // then still shows as `M ` after a "rollback"). Restore both sides to HEAD.
  await runGit(env, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...paths])
}

/**
 * Apply a caller-built patch to the index (used by line/hunk staging).
 * @param {'stage'|'unstage'} direction
 */
export async function applyPatch(env, patch, direction) {
  if (typeof patch !== 'string' || patch.trim() === '') throw new ApiError('bad-request', 'empty patch')
  const args = ['apply', '--cached', '--unidiff-zero', '--recount', '--whitespace=nowarn']
  if (direction === 'unstage') args.push('-R')
  await runGit(env, args, { input: patch, allowFailure: false })
}

/** Commit the index, optionally amending. Returns the new short hash. */
export async function commit(env, message, amend) {
  if (typeof message !== 'string' || message.trim() === '') {
    throw new ApiError('git-empty-message', 'commit message is empty')
  }
  const args = ['commit', '--file', '-', '--cleanup=strip']
  if (amend) args.push('--amend')
  const result = await runGit(env, args, { input: message })
  let hash
  try {
    const head = await runGit(env, ['rev-parse', '--short', 'HEAD'])
    hash = head.stdout.trim()
  } catch {
    hash = undefined
  }
  return { stdout: result.stdout, stderr: result.stderr, hash }
}

/** Push the current branch to its upstream. */
export async function push(env) {
  const result = await runGit(env, ['push'], { timeoutMs: REMOTE_TIMEOUT_MS })
  return { stdout: result.stdout, stderr: result.stderr }
}

const LOG_FIELD = '\x1f'
const LOG_RECORD = '\x1e'

/** Parse the custom `git log` record stream. */
function parseLog(stdout) {
  const commits = []
  for (const record of stdout.split(LOG_RECORD)) {
    const text = record.replace(/^\n+/, '')
    if (text.trim() === '') continue
    const fields = text.split(LOG_FIELD)
    if (fields.length < 8) continue
    const [hash, shortHash, parents, author, email, date, refs, ...rest] = fields
    commits.push({
      hash,
      shortHash,
      parents: parents === '' ? [] : parents.split(' ').filter(Boolean),
      author,
      email,
      date,
      refs: refs === '' ? [] : refs.split(', ').map(item => item.trim()).filter(Boolean),
      subject: rest.join(LOG_FIELD).trim(),
    })
  }
  return commits
}

/**
 * One page of history.
 * @param {{ gitPath?: string, root: string }} env
 * @param {{ skip?: number, count?: number, branch?: string, author?: string, query?: string,
 *   since?: string, regex?: boolean }} options
 */
export async function log(env, options = {}) {
  const count = Math.min(Math.max(options.count ?? 200, 1), 500)
  const skip = Math.max(options.skip ?? 0, 0)
  const args = [
    'log',
    `--pretty=format:%H${LOG_FIELD}%h${LOG_FIELD}%P${LOG_FIELD}%an${LOG_FIELD}%ae${LOG_FIELD}%ai${LOG_FIELD}%D${LOG_FIELD}%s${LOG_RECORD}`,
    '--date=iso',
    '--topo-order',
    `--max-count=${count}`,
  ]
  if (skip > 0) args.push(`--skip=${skip}`)
  if (options.branch && options.branch !== '') args.push(options.branch)
  else args.push('--all')
  if (options.author && options.author !== '') args.push(`--author=${options.author}`)
  if (options.query && options.query !== '') {
    // A literal query must not be interpreted as a regex: typing `[` in the
    // filter used to exit 128 and blank the whole history.
    if (options.regex !== true) args.push('--fixed-strings')
    args.push(`--grep=${options.query}`, '--regexp-ignore-case')
  }
  if (options.since && options.since !== '') args.push(`--since=${options.since}`)
  if (options.path && options.path !== '') args.push('--', options.path)
  const { stdout } = await runGit(env, args)
  return parseLog(stdout)
}

/** Local branch names plus the current one. */
export async function branches(env) {
  const [current, list] = await Promise.all([
    runGit(env, ['branch', '--show-current'], { allowFailure: true }),
    runGit(env, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
  ])
  return {
    current: current.stdout.trim() || undefined,
    names: list.stdout.split('\n').map(item => item.trim()).filter(Boolean),
  }
}

/** Check out a branch, or detach at a commit. */
export async function checkout(env, ref) {
  if (typeof ref !== 'string' || ref.trim() === '') throw new ApiError('bad-request', 'invalid ref')
  const isHash = /^[0-9a-f]{7,40}$/i.test(ref)
  const args = isHash ? ['checkout', '--detach', ref] : ['checkout', ref]
  const result = await runGit(env, args, { allowFailure: true })
  if (result.code !== 0) {
    throw new ApiError('git-checkout-failed', (result.stderr || result.stdout).trim() || 'checkout failed')
  }
  return { stdout: result.stdout, stderr: result.stderr }
}

/** Revert one commit into a new commit. */
export async function revert(env, hash) {
  if (!/^[0-9a-f]{7,40}$/i.test(hash ?? '')) throw new ApiError('bad-request', 'invalid commit hash')
  const result = await runGit(env, ['revert', '--no-edit', hash], { allowFailure: true })
  if (result.code !== 0) {
    throw new ApiError('git-revert-failed', (result.stderr || result.stdout).trim() || 'revert failed')
  }
  return { stdout: result.stdout, stderr: result.stderr }
}

/** Single commit metadata (full body included). */
export async function commitDetail(env, hash) {
  if (!/^[0-9a-f]{7,40}$/i.test(hash ?? '')) throw new ApiError('bad-request', 'invalid commit hash')
  const format = ['%H', '%h', '%P', '%an', '%ae', '%ai', '%D', '%s', '%B'].join(LOG_FIELD)
  const { stdout } = await runGit(env, ['show', '-s', `--format=${format}`, hash])
  const fields = stdout.split(LOG_FIELD)
  // A merge commit has no patch by default. `--first-parent -m` asks for the
  // diff against the first parent, which is what the details pane shows.
  const patch = await runGit(env, ['show', '--no-color', '--no-ext-diff', '--format=', '--unified=3', '--first-parent', '-m', hash], { allowFailure: true })
  return {
    hash: fields[0] ?? hash,
    shortHash: fields[1] ?? hash.slice(0, 7),
    parents: (fields[2] ?? '').split(' ').filter(Boolean),
    author: fields[3] ?? '',
    email: fields[4] ?? '',
    date: fields[5] ?? '',
    refs: (fields[6] ?? '').split(', ').map(item => item.trim()).filter(Boolean),
    subject: fields[7] ?? '',
    body: (fields[8] ?? '').trim(),
    diff: patch.stdout,
  }
}

/**
 * How many annotated lines one blame answer carries.
 *
 * `git blame --porcelain` prints a metadata block for every *commit*, and one
 * header plus one content record for every line, so a generated file of a
 * hundred thousand lines would answer with megabytes of JSON. The editor opens
 * a file of that size read-only anyway, and the annotate panel is read by
 * scrolling: the cap keeps one answer bounded and says that it was cut.
 */
export const MAX_BLAME_LINES = 20_000

/** A blame of one huge file may take a moment on a cold object store. */
const BLAME_TIMEOUT_MS = 20_000

/** The all-zero SHA-1 git prints for a line that is not committed yet. */
const UNCOMMITTED_BLAME_HASH = '0000000000000000000000000000000000000000'

/** The author git shows for a line that lives only in the worktree. */
const UNCOMMITTED_AUTHOR = 'Not Committed Yet'

/** The `^` marks a boundary commit in the header of the porcelain output. */
const BLAME_HEADER = /^\^?([0-9a-fA-F]{40}) (\d+) (\d+)(?: (\d+))?$/

/**
 * Parse `git blame --porcelain` output.
 *
 * The format is line oriented. One record starts with
 * `<sha> <orig-line> <final-line> [<group-size>]`; the commit metadata follows
 * only the FIRST record of a commit, and git then reuses it - a later header
 * of the same commit carries no metadata block at all. The parser therefore
 * keeps the metadata of every sha it has seen and lets the following headers
 * inherit it. The line's own text follows as a TAB-prefixed record; that
 * record is the marker that the current line is complete, which is what makes
 * a cut-off (unterminated) output survive without a phantom line.
 * @param {string} output the porcelain output
 * @param {{ limit?: number }} [options] the line cap
 * @returns {{ lines: Array<{ line: number, hash: string, shortHash: string, author: string,
 *   authorTime: number, summary: string, committed: boolean }>,
 *   commits: Record<string, { hash: string, shortHash: string, author: string,
 *   authorTime: number, summary: string, committed: boolean }>,
 *   truncated: boolean }}
 */
export function parseBlame(output, options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : MAX_BLAME_LINES
  const result = { lines: [], commits: {}, truncated: false }
  /** The metadata of every sha seen so far: porcelain repeats none of it. */
  const known = new Map()
  /** The header of the line being read; null between lines. */
  let header = null
  /** The metadata object the current header belongs to. */
  let commit = null
  for (const raw of String(output ?? '').split('\n')) {
    // Windows git writes '\n' on a pipe, but a caller may hand us a CRLF
    // buffer; a stray CR would make every header unparseable.
    const record = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (record === '') continue
    if (record.charCodeAt(0) === 9) {
      // The content of the line announced above: the line is complete now.
      if (header === null || commit === null) continue
      if (result.lines.length >= limit) {
        result.truncated = true
        break
      }
      const committed = commit.committed === true
      // An uncommitted line has no commit of its own: git prints the
      // pseudo-author "Not Committed Yet", and so does the panel.
      const author = committed ? commit.author : UNCOMMITTED_AUTHOR
      const summary = committed ? commit.summary : ''
      result.lines.push({
        line: header.finalLine,
        hash: commit.hash,
        shortHash: commit.shortHash,
        author,
        authorTime: commit.authorTime,
        summary,
        committed,
      })
      if (result.commits[commit.hash] === undefined) {
        result.commits[commit.hash] = {
          hash: commit.hash, shortHash: commit.shortHash, author, authorTime: commit.authorTime, summary, committed,
        }
      }
      header = null
      commit = null
      continue
    }
    const match = BLAME_HEADER.exec(record)
    if (match !== null) {
      const hash = match[1].toLowerCase()
      header = { hash, finalLine: Number(match[3]) }
      // The metadata was printed with the first record of this commit; every
      // later record (and the next line of the same group) inherits it.
      commit = known.get(hash) ?? null
      if (commit === null) {
        commit = {
          hash,
          shortHash: hash.slice(0, 8),
          author: '',
          authorTime: 0,
          summary: '',
          committed: hash !== UNCOMMITTED_BLAME_HASH,
        }
        known.set(hash, commit)
      }
      continue
    }
    if (header === null || commit === null) continue
    // A metadata record: the key is the first token, the value the rest of
    // the line (a summary and a file name may both contain spaces).
    const space = record.indexOf(' ')
    const key = space < 0 ? record : record.slice(0, space)
    const value = space < 0 ? '' : record.slice(space + 1)
    if (key === 'author') commit.author = value
    else if (key === 'author-time') {
      const seconds = Number(value)
      commit.authorTime = Number.isFinite(seconds) ? seconds : 0
    } else if (key === 'summary') commit.summary = value
    // `author-mail`, `author-tz`, `committer*`, `filename` and `previous` are
    // part of the format but not of the answer: the panel shows the author,
    // the time, the hash and the summary of the line.
  }
  // The panel groups consecutive rows, and git may print the groups of one
  // commit in a different order: the line number is the reading order.
  result.lines.sort((left, right) => left.line - right.line)
  return result
}

/**
 * Annotate one file with the commit of every line.
 *
 * The worktree is annotated (no `-w`): whitespace-only edits are real edits
 * for the panel, and hiding them would blame a different commit than the one
 * the file shows. A path without a committed version yet (an untracked file,
 * or a file added to the index but never committed) is a normal answer - no
 * commit information - not an error.
 * @param {{ gitPath?: string, root: string }} env
 * @param {string} repoPath repository-relative path
 * @param {{ limit?: number }} [options]
 */
export async function blame(env, repoPath, options = {}) {
  if (typeof repoPath !== 'string' || repoPath === '') throw new ApiError('bad-request', 'no path')
  const result = await runGit(env, ['blame', '--porcelain', '--', repoPath], {
    timeoutMs: BLAME_TIMEOUT_MS,
    allowFailure: true,
  })
  if (result.code !== 0) {
    if (/no such path|no such ref|unknown revision|has no commits yet/i.test(result.stderr)) {
      return { lines: [], commits: {}, truncated: false }
    }
    throw new GitError(['blame', '--porcelain', '--', repoPath], result.code, result.stderr, result.stdout)
  }
  return parseBlame(result.stdout, { limit: options.limit })
}

/** Two-ended diff (commit..commit, branch..branch). */
export async function diffRefs(env, a, b) {
  const result = await runGit(env, ['diff', '--no-color', '--no-ext-diff', '--unified=3', a, b], { allowFailure: true })
  return result.stdout
}

/** One file's diff inside one commit (first parent for merges). */
export async function commitFileDiff(env, hash, path) {
  if (!/^[0-9a-f]{7,40}$/i.test(hash ?? '')) throw new ApiError('bad-request', 'invalid commit hash')
  const result = await runGit(env, [
    'show', '--no-color', '--no-ext-diff', '--format=', '--unified=3', '--first-parent', '-m', hash, '--', path,
  ], { allowFailure: true })
  return result.stdout
}

/** File content at a revision. */
export async function showFile(env, rev, path) {
  if (!/^[0-9a-f]{7,40}$/i.test(rev ?? '')) throw new ApiError('bad-request', 'invalid revision')
  const result = await runGit(env, ['show', `${rev}:${path}`], { allowFailure: true })
  if (result.code !== 0) return null
  return result.stdout
}

/** The last N commit messages (the Commit window's history dropdown). */
export async function recentMessages(env, count = 10) {
  const { stdout } = await runGit(env, ['log', `--max-count=${count}`, '--pretty=format:%B%x00'], { allowFailure: true })
  return stdout.split('\0').map(item => item.trim()).filter(Boolean)
}
