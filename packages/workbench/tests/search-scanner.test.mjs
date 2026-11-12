/**
 * The external scanner of the project-wide search.
 *
 * The scanner is an accelerator: when the machine has no ripgrep, the
 * built-in walk answers the search. These tests pin the three things that
 * make it safe to use one:
 *
 *   - the arguments mirror the walk (the same files, the same flags);
 *   - the parser tells a hit from a context line, even when the text of the
 *     line looks like a hit;
 *   - the scanner and the walk find the SAME hits.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildScannerArgs, parseScanLine, resolveScannerBinary, resetScannerCache, runScanner, scannerCandidates,
} from '../src/host/scanner.js'
import { buildPattern, groupScanEntries, scannerPath, searchFiles } from '../src/host/search.js'

async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'iwb-scanner-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** A tree with a hit in the middle of two files. */
async function sampleTree(t) {
  const root = await temp(t)
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'a.ts'), 'one\ntwo\nneedle here\nfour\nfive\nsix\nseven\n')
  await writeFile(join(root, 'src', 'c.ts'), 'alpha\nneedle\nbeta\n')
  await writeFile(join(root, 'b.txt'), 'nothing here\n')
  return root
}

// ── the arguments ───────────────────────────────────────────────────────────

test('the scanner arguments mirror the walk', () => {
  const args = buildScannerArgs('needle', { excludes: ['node_modules', 'dist'] })
  // A literal query, a case insensitive search, the hidden files, no ignore
  // file (the walk honours none) and the directories the walk skips.
  assert.ok(args.includes('--fixed-strings'))
  assert.ok(args.includes('--ignore-case'))
  assert.ok(!args.includes('--word-regexp'))
  assert.ok(args.includes('--hidden'))
  assert.ok(args.includes('--no-ignore'))
  assert.ok(args.includes('--glob'))
  assert.ok(args.includes('!**/node_modules/**'))
  assert.ok(args.includes('!**/dist/**'))
  // The context comes with the hits.
  assert.equal(args[args.indexOf('--context') + 1], '5')
  // The query is a value, never a flag - and the path is explicit: without
  // one ripgrep would read STDIN and wait for ever.
  assert.equal(args[args.length - 3], '-e')
  assert.equal(args[args.length - 2], 'needle')
  assert.equal(args[args.length - 1], '.')
})

test('the scanner arguments follow the flags of the search', () => {
  const exact = buildScannerArgs('needle', { caseSensitive: true, wholeWord: true, regexp: true, isRepo: true })
  assert.ok(exact.includes('--word-regexp'))
  assert.ok(!exact.includes('--ignore-case'))
  assert.ok(!exact.includes('--fixed-strings'))
  // Inside a repository the .gitignore rules count, like the git path.
  assert.ok(!exact.includes('--no-ignore'))
})

// ── the parser ──────────────────────────────────────────────────────────────

test('the parser knows a hit, a context line and the separator', () => {
  const pattern = buildPattern('needle', {})
  assert.deepEqual(parseScanLine('a.txt:3:5:the needle here', pattern), {
    kind: 'hit', path: 'a.txt', line: 3, column: 5, text: 'the needle here',
  })
  assert.deepEqual(parseScanLine('a.txt-2-before', pattern), {
    kind: 'context', path: 'a.txt', line: 2, column: 1, text: 'before',
  })
  assert.equal(parseScanLine('--', pattern), null)
  assert.equal(parseScanLine('', pattern), null)
})

test('the parser knows a binary file', () => {
  const pattern = buildPattern('needle', {})
  const entry = parseScanLine('a.bin: binary file matches (found "\\0" byte around offset 0)', pattern)
  assert.equal(entry.kind, 'binary')
  assert.equal(entry.path, 'a.bin')
})

test('the column of a hit counts the characters, not the bytes', () => {
  const pattern = buildPattern('needle', {})
  // Four CJK characters are twelve bytes: the tool reports the byte offset,
  // the client wants the character.
  const entry = parseScanLine('a.txt:1:13:你好世界needle', pattern)
  assert.equal(entry.kind, 'hit')
  assert.equal(entry.column, 5)
})

test('a context line that looks like a hit stays a context line', () => {
  const pattern = buildPattern('error', {})
  // A log line with a timestamp has the shape of a hit. The byte offset of
  // the tool tells the two apart.
  const entry = parseScanLine('app.log-10-2024:12:34: error at startup', pattern)
  assert.equal(entry.kind, 'context')
  assert.equal(entry.path, 'app.log')
  assert.equal(entry.line, 10)
  assert.equal(entry.text, '2024:12:34: error at startup')
})

// ── the lookup of the binary ────────────────────────────────────────────────

test('the scanner is looked up on the PATH, in the resources and in node_modules', () => {
  resetScannerCache()
  const candidates = scannerCandidates({
    env: { PATH: '/usr/bin', DSH_RIPGREP_PATH: '/opt/rg' },
    platform: 'linux',
    resourcesPath: '/opt/app/resources',
  })
  // An explicit setting wins.
  assert.equal(candidates[0], '/opt/rg')
  assert.ok(candidates.includes(join('/usr/bin', 'rg')))
  assert.ok(candidates.some(candidate => candidate.includes('app.asar.unpacked')))
  // A machine without a scanner: the walk is the fallback.
  assert.equal(resolveScannerBinary({ env: { PATH: '' }, platform: 'linux', resourcesPath: '', exists: () => false, cache: false }), null)
  // A machine with one: the first candidate that exists wins.
  const found = resolveScannerBinary({
    env: { PATH: '/usr/bin' },
    platform: 'linux',
    resourcesPath: '',
    exists: candidate => candidate === join('/usr/bin', 'rg'),
    cache: false,
  })
  assert.equal(found, join('/usr/bin', 'rg'))
  resetScannerCache()
})

// ── the runner ──────────────────────────────────────────────────────────────

test('the runner hands the output line by line to the caller', async () => {
  const lines = []
  const result = await runScanner(process.execPath, ['-e', 'console.log("one");console.log("two")'], {
    cwd: process.cwd(),
    onLine: (line) => { lines.push(line); return true },
  })
  assert.equal(result.code, 0)
  assert.deepEqual(lines, ['one', 'two'])
})

test('the runner stops when the caller says so', async () => {
  const lines = []
  const result = await runScanner(process.execPath, ['-e', 'console.log("one");console.log("two");console.log("three")'], {
    cwd: process.cwd(),
    onLine: (line) => { lines.push(line); return false },
  })
  assert.equal(result.stopped, true)
  assert.deepEqual(lines, ['one'])
})

// ── the scanner and the walk ────────────────────────────────────────────────

/**
 * A scanner that behaves like ripgrep.
 *
 * The real ripgrep is not installed everywhere, so the test carries one: it
 * prints the hits and their context in the format of ripgrep, which is what
 * the parser has to read.
 */
const STUB_SOURCE = `
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
const query = args[args.indexOf('-e') + 1] ?? ''
const contextAt = args.indexOf('--context')
const context = contextAt >= 0 ? Number(args[contextAt + 1]) : 0
const ignoreCase = args.includes('--ignore-case')
const root = process.cwd()
const files = []
const walk = (dir) => {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.isFile()) files.push(full)
  }
}
walk(root)
for (const file of files.sort()) {
  const rel = path.relative(root, file).split(path.sep).join('/')
  const lines = fs.readFileSync(file, 'utf8').split('\\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const needle = ignoreCase ? query.toLowerCase() : query
  const hits = []
  lines.forEach((text, index) => {
    const haystack = ignoreCase ? text.toLowerCase() : text
    const at = haystack.indexOf(needle)
    if (at < 0) return
    hits.push({ line: index + 1, column: Buffer.byteLength(text.slice(0, at), 'utf8') + 1, text })
  })
  if (hits.length === 0) continue
  const wanted = new Set()
  for (const hit of hits) {
    const last = Math.min(lines.length, hit.line + context)
    for (let line = Math.max(1, hit.line - context); line <= last; line += 1) wanted.add(line)
  }
  process.stdout.write('--\\n')
  for (const line of [...wanted].sort((a, b) => a - b)) {
    const hit = hits.find(entry => entry.line === line)
    const text = lines[line - 1] ?? ''
    if (hit) process.stdout.write(rel + ':' + hit.line + ':' + hit.column + ':' + text + '\\n')
    else process.stdout.write(rel + '-' + line + '-' + text + '\\n')
  }
}
`

/**
 * Scan the tree with a scanner and group the answer.
 *
 * The scanner is a file, not an inline script: the arguments of the scanner
 * start with a dash, and node would read them as its own.
 *
 * @param {string} binary the scanner to run
 * @param {string} root the tree
 * @param {string} query the search term
 * @returns {Promise<{files: object[], code: number, stderr: string}>} the answer
 */
async function scanWith(binary, extraArgs, root, query) {
  const pattern = buildPattern(query, {})
  const entries = []
  const args = buildScannerArgs(query, { excludes: [], contextLines: 5 })
  const result = await runScanner(binary, [...extraArgs, ...args], {
    cwd: root,
    onLine: (line) => {
      const entry = parseScanLine(line, pattern)
      if (entry !== null) entries.push(entry)
      return true
    },
  })
  return { ...groupScanEntries(entries, scannerPath), code: result.code, stderr: result.stderr }
}

/**
 * Scan the tree with the stub and group the answer.
 * @param {string} root the tree
 * @param {string} query the search term
 * @returns {Promise<{files: object[]}>} the answer
 */
async function scanWithStub(root, query) {
  const home = await mkdtemp(join(tmpdir(), 'iwb-scanner-stub-'))
  const script = join(home, 'scanner-stub.cjs')
  await writeFile(script, STUB_SOURCE)
  try {
    return await scanWith(process.execPath, [script], root, query)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

test('the scanner and the walk find the same hits', async (t) => {
  const root = await sampleTree(t)
  const env = { root, workspaceRoot: root, prefix: '', isRepo: false }
  const walked = await searchFiles(env, { query: 'needle', scanner: false })
  const scanned = await scanWithStub(root, 'needle')
  assert.deepEqual(scanned.files, walked.files)
  // The context is the same too: the lines around the hit.
  assert.deepEqual(scanned.files[0].matches[0].before, ['one', 'two'])
  assert.deepEqual(scanned.files[0].matches[0].after, ['four', 'five', 'six', 'seven'])
})

test('the scanner of the machine finds the same hits as the walk', async (t) => {
  const root = await sampleTree(t)
  const env = { root, workspaceRoot: root, prefix: '', isRepo: false }
  resetScannerCache()
  const binary = resolveScannerBinary()
  if (binary === null) {
    t.skip('no ripgrep on this machine (set DSH_RIPGREP_PATH to run it)')
    return
  }
  const scanned = await scanWith(binary, [], root, 'needle')
  // The scanner has to run: a scanner that fails must not look like a walk.
  assert.equal(scanned.code, 0, `the scanner failed: ${scanned.stderr}`)
  const walked = await searchFiles(env, { query: 'needle', scanner: false })
  assert.deepEqual(scanned.files, walked.files)
})

test('the scanner of the machine answers the search', async (t) => {
  const root = await temp(t)
  resetScannerCache()
  const binary = resolveScannerBinary()
  if (binary === null) {
    t.skip('no ripgrep on this machine (set DSH_RIPGREP_PATH to run it)')
    return
  }
  await writeFile(join(root, 'small.ts'), 'needle\n')
  // A file that is too big for the walk: the scanner reads it, the walk does
  // not - so the two answers differ, and the difference proves that the
  // scanner answered.
  await writeFile(join(root, 'huge.ts'), `${'x'.repeat(1024)}\n`.repeat(2200) + 'needle\n')
  const env = { root, workspaceRoot: root, prefix: '', isRepo: false }
  const walked = await searchFiles(env, { query: 'needle', scanner: false })
  const scanned = await searchFiles(env, { query: 'needle', scanner: binary })
  assert.deepEqual(walked.files.map(file => file.path), ['small.ts'])
  assert.deepEqual(scanned.files.map(file => file.path), ['huge.ts', 'small.ts'])
})

test('a machine without a scanner answers with the walk', async (t) => {
  const root = await sampleTree(t)
  const env = { root, workspaceRoot: root, prefix: '', isRepo: false }
  const result = await searchFiles(env, { query: 'needle', scanner: false })
  assert.equal(result.files.length, 2)
  assert.deepEqual(result.files.map(file => file.path), ['src/a.ts', 'src/c.ts'])
})
