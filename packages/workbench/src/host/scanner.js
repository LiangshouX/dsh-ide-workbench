/**
 * The external scanner of the project-wide search.
 *
 * ripgrep reads a workspace two to five times faster than the built-in walk
 * (measured on a 20 000 file tree: 1.3 s instead of 6.3 s), and it prints the
 * lines around a hit - so the context of a hit costs nothing instead of a
 * second read of every matched file.
 *
 * The scanner is an ACCELERATOR, never a requirement: when the machine has no
 * ripgrep, the built-in walk answers the search. The plugin therefore does not
 * depend on a native binary - the binary is looked up on the PATH, in the
 * resources of the host application (the DSH harness ships one) and in the
 * own node_modules, and the walk stays the fallback. A published plugin must
 * not carry a platform binary that the publish flow cannot ship.
 *
 * The output of ripgrep and of `git grep` has the same shape, so one parser
 * serves both:
 *
 *   `path:LINE:COLUMN:text`   a hit
 *   `path-LINE-text`           a line of the context around a hit
 *   `--`                       the separator between two files
 *
 * The column of a tool is a BYTE offset while the client counts characters,
 * so the column is computed again from the text of the line - and the byte
 * offset of the tool is used to tell a hit from a context line that happens
 * to look like one.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

/** How long one scanner run may take. */
export const SCANNER_TIMEOUT_MS = 30_000

/** The context lines the scanner prints around a hit. */
export const SCANNER_CONTEXT_LINES = 5

/** A hit of the scanner output. */
const HIT_LINE = /^(.*):(\d+):(\d+):(.*)$/
/** A context line of the scanner output. */
const CONTEXT_LINE = /^(.*)-(\d+)-(.*)$/
/** The line a scanner prints for a binary file. */
const BINARY_LINE = /^(.*): binary file matches \(found .*byte around offset \d+\)$/

/**
 * The first match of the pattern in one line.
 *
 * The pattern is the one of the built-in walk, so the column of the hit is
 * the same in both paths (the client places the caret with it).
 *
 * @param {RegExp} pattern the search pattern
 * @param {string} text the text of the line
 * @returns {{column: number, byteOffset: number}|null} the match
 */
function firstMatch(pattern, text) {
  if (pattern === undefined || pattern === null) return null
  pattern.lastIndex = 0
  const match = pattern.exec(text)
  if (match === null) return null
  return {
    // The column of the client: the characters before the match.
    column: match.index + 1,
    // The offset of the tool: the bytes before the match.
    byteOffset: Buffer.byteLength(text.slice(0, match.index), 'utf8'),
  }
}

/**
 * Parse one line of a scanner output.
 *
 * @param {string} line the line, without its terminator
 * @param {RegExp} [pattern] the search pattern
 * @returns {{kind: 'hit'|'context'|'binary', path: string, line: number,
 *   column: number, text: string}|null} the entry, `null` for a separator
 */
export function parseScanLine(line, pattern) {
  if (line === '' || line === '--') return null
  const binary = BINARY_LINE.exec(line)
  if (binary !== null) return { kind: 'binary', path: binary[1], line: 1, column: 1, text: '' }
  const hit = HIT_LINE.exec(line)
  if (hit !== null) {
    const text = hit[4]
    const found = firstMatch(pattern, text)
    // The byte offset of the tool tells a hit from a context line that looks
    // like one (a log line with a timestamp, for example). When the pattern
    // does not match the text at all, the line is a context line.
    if (found !== null && found.byteOffset === Number(hit[3]) - 1) {
      return { kind: 'hit', path: hit[1], line: Number(hit[2]), column: found.column, text }
    }
  }
  const context = CONTEXT_LINE.exec(line)
  if (context !== null) {
    return { kind: 'context', path: context[1], line: Number(context[2]), column: 1, text: context[3] }
  }
  return null
}

/**
 * The paths that may hold a ripgrep binary.
 *
 * The PATH comes first (an explicit installation wins), then the resources of
 * the host application (the DSH harness ships ripgrep with its editor), then
 * the own node_modules (when the user installed `@vscode/ripgrep`).
 *
 * @param {{env?: Record<string, string|undefined>, platform?: string,
 *   resourcesPath?: string}} [options] the environment of the lookup
 * @returns {string[]} the candidates, in the order they are tried
 */
export function scannerCandidates(options = {}) {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const resourcesPath = options.resourcesPath ?? process.resourcesPath ?? ''
  const names = platform === 'win32' ? ['rg.exe'] : ['rg']
  const candidates = []
  // An explicit setting wins: the user may point the plugin at a ripgrep of
  // their own.
  const configured = env.DSH_RIPGREP_PATH
  if (typeof configured === 'string' && configured !== '') candidates.push(configured)
  const separator = platform === 'win32' ? ';' : ':'
  for (const dir of String(env.PATH ?? '').split(separator)) {
    if (dir === '') continue
    for (const name of names) candidates.push(join(dir, name))
  }
  if (resourcesPath !== '') {
    const tails = platform === 'win32'
      ? [
          'app.asar.unpacked/dsh/node_modules/@vscode/ripgrep-win32-x64/bin/rg.exe',
          'app.asar.unpacked/node_modules/@vscode/ripgrep-win32-x64/bin/rg.exe',
        ]
      : [
          'app.asar.unpacked/dsh/node_modules/@vscode/ripgrep/bin/rg',
          'app.asar.unpacked/node_modules/@vscode/ripgrep/bin/rg',
        ]
    for (const tail of tails) candidates.push(join(resourcesPath, ...tail.split('/')))
  }
  candidates.push(...nodeModuleScanners(platform))
  return candidates
}

/**
 * The ripgrep of an own `@vscode/ripgrep` installation.
 * @param {string} platform the platform
 * @returns {string[]} the candidates
 */
function nodeModuleScanners(platform) {
  const require = createRequire(import.meta.url)
  const names = platform === 'win32'
    ? ['@vscode/ripgrep-win32-x64/bin/rg.exe']
    : ['@vscode/ripgrep/bin/rg']
  const found = []
  for (const name of names) {
    try {
      const resolved = require.resolve(name)
      if (typeof resolved === 'string' && resolved !== '') found.push(resolved)
    } catch {
      // Not installed: the built-in walk is the fallback.
    }
  }
  return found
}

/** The binary of the last lookup (`null` when there is none). */
let cachedBinary = null
/** Whether the lookup already ran. */
let binaryResolved = false

/**
 * The ripgrep binary of this machine, or `null` when there is none.
 *
 * The lookup is done once: the search runs on every keystroke of the query,
 * and the PATH does not change while the IDE is open.
 *
 * @param {{exists?: (path: string) => boolean, cache?: boolean}} [options]
 * @returns {string|null} the absolute path of the binary
 */
export function resolveScannerBinary(options = {}) {
  const cache = options.cache !== false
  if (cache && binaryResolved) return cachedBinary
  const exists = options.exists ?? existsSync
  let found = null
  for (const candidate of scannerCandidates(options)) {
    if (!exists(candidate)) continue
    found = candidate
    break
  }
  if (cache) {
    cachedBinary = found
    binaryResolved = true
  }
  return found
}

/** Forget the cached binary (the tests resolve it again). */
export function resetScannerCache() {
  cachedBinary = null
  binaryResolved = false
}

/**
 * The arguments of one scanner run.
 *
 * The flags mirror the built-in walk, so both paths find the same files:
 * the hidden files are searched (the walk searches them), the ignore rules
 * are off outside a repository (the walk honours none) and on inside one (the
 * git path honours the .gitignore), and the generated/vendor directories are
 * skipped at any depth.
 *
 * @param {string} query the search term
 * @param {{caseSensitive?: boolean, wholeWord?: boolean, regexp?: boolean,
 *   isRepo?: boolean, excludes?: string[], contextLines?: number}} [options]
 * @returns {string[]} the argv after the executable
 */
export function buildScannerArgs(query, options = {}) {
  const args = [
    '--color=never',
    '--line-number',
    '--column',
    '--no-heading',
    '--with-filename',
    '--context', String(options.contextLines ?? SCANNER_CONTEXT_LINES),
    // A long line must not be cut: the client shows the whole hit. The value
    // belongs to the flag (`--flag=value`): ripgrep reads a separate word as
    // a file name.
    '--max-columns=0',
    // The noise of an unreadable directory must not reach the answer.
    '--no-messages',
    '--hidden',
  ]
  if (options.caseSensitive !== true) args.push('--ignore-case')
  if (options.wholeWord === true) args.push('--word-regexp')
  if (options.regexp !== true) args.push('--fixed-strings')
  // Outside a repository the walk honours no ignore file, so the scanner must
  // not either; inside one the git path honours the .gitignore, so the
  // scanner does too.
  if (options.isRepo !== true) args.push('--no-ignore')
  for (const dir of Array.isArray(options.excludes) ? options.excludes : []) {
    if (typeof dir !== 'string' || dir === '') continue
    args.push('--glob', `!**/${dir}/**`)
  }
  // `-e` and not the positional form: a query that starts with a dash is a
  // query, not a flag.
  args.push('-e', String(query))
  // The path is explicit: without one ripgrep searches STDIN when it is not
  // a terminal (and waits for the input of a pipe for ever).
  args.push('.')
  return args
}

/**
 * Run the scanner and hand its output line by line to the caller.
 *
 * The output is not collected: the caller decides what to keep, and a scan
 * that is stopped (the result cap, an aborted request) never reads the rest
 * of a multi-megabyte output.
 *
 * @param {string} binary the absolute path of the scanner
 * @param {string[]} args the argv after the executable
 * @param {{cwd: string, signal?: AbortSignal, timeoutMs?: number,
 *   onLine?: (line: string) => boolean}} options
 * @returns {Promise<{code: number, stderr: string, stopped: boolean,
 *   aborted: boolean, timedOut: boolean}>}
 */
export function runScanner(binary, args, options = {}) {
  const { cwd, signal, timeoutMs = SCANNER_TIMEOUT_MS, onLine } = options
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(binary, args, {
        cwd,
        windowsHide: true,
        env: { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' },
      })
    } catch (error) {
      resolve({
        code: -1,
        stderr: error instanceof Error ? error.message : String(error),
        stopped: false,
        aborted: false,
        timedOut: false,
        failed: true,
      })
      return
    }
    let stderr = ''
    let stopped = false
    let aborted = false
    let timedOut = false
    let settled = false
    let timer = null
    const finish = (code) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      if (signal !== undefined && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onAbort)
      }
      resolve({ code, stderr, stopped, aborted, timedOut })
    }
    const onAbort = () => {
      if (settled) return
      aborted = true
      child.kill()
      finish(-1)
    }
    timer = setTimeout(() => {
      if (settled) return
      // A scan that ran into the timeout did not answer: the caller has to
      // know that the answer is missing, not that it is complete.
      timedOut = true
      child.kill()
      finish(-1)
    }, timeoutMs)
    if (signal !== undefined) {
      if (signal.aborted === true) {
        onAbort()
        return
      }
      if (typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', onAbort, { once: true })
      }
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    let pending = ''
    child.stdout.on('data', (chunk) => {
      // A scan that was stopped reads nothing more: the child may still have
      // written before the kill reached it.
      if (stopped) return
      pending += chunk
      let at = pending.indexOf('\n')
      while (at !== -1) {
        const line = pending.slice(0, at)
        pending = pending.slice(at + 1)
        if (onLine !== undefined && onLine(line) === false) {
          stopped = true
          child.kill()
          return
        }
        at = pending.indexOf('\n')
      }
    })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => {
      stderr += error instanceof Error ? error.message : String(error)
      finish(-1)
    })
    child.on('close', (code) => { finish(code ?? -1) })
  })
}
