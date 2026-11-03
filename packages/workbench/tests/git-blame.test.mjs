/**
 * Git blame tests (V6 "Git Blame annotate").
 *
 * The porcelain format is the whole contract of the feature: the panel shows
 * exactly what the parser made of one `git blame --porcelain` answer. The
 * format has two traps the fixtures below pin down:
 *   - the commit metadata is printed once per commit and inherited by every
 *     later line of it (a header may carry NO metadata block at all);
 *   - the line's own text is a TAB-prefixed record, which is what tells a
 *     complete line from a cut-off answer.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MAX_BLAME_LINES, blame, parseBlame } from '../src/host/git.js'

const HASH_A = '1111111111111111111111111111111111111111'
const HASH_B = '2222222222222222222222222222222222222222'
const HASH_C = '3333333333333333333333333333333333333333'
const ZERO = '0000000000000000000000000000000000000000'

/** One metadata block, without the content record. */
function meta(hash, fields) {
  return [
    ...(hash === undefined ? [] : [`${hash} ${fields.origLine ?? 1} ${fields.finalLine ?? 1} ${fields.groupSize ?? 1}`]),
    `author ${fields.author}`,
    `author-mail <${fields.mail ?? 'a@example.com'}>`,
    `author-time ${fields.authorTime}`,
    'author-tz +0000',
    `summary ${fields.summary}`,
    `filename ${fields.filename ?? 'src/a.ts'}`,
  ]
}

test('porcelain: a header without a metadata block inherits the previous commit', () => {
  const output = [
    ...meta(HASH_A, { author: 'Alice', authorTime: 1700000000, summary: 'first commit', finalLine: 1, groupSize: 2 }),
    '\tconst a = 1',
    // The second line of the same group carries the header only.
    `${HASH_A} 2 2`,
    '\tconst b = 2',
  ].join('\n')
  const parsed = parseBlame(output)
  assert.equal(parsed.lines.length, 2)
  assert.deepEqual(parsed.lines[0], {
    line: 1,
    hash: HASH_A,
    shortHash: HASH_A.slice(0, 8),
    author: 'Alice',
    authorTime: 1700000000,
    summary: 'first commit',
    committed: true,
  })
  // The omitted metadata is inherited, not lost.
  assert.equal(parsed.lines[1].line, 2)
  assert.equal(parsed.lines[1].hash, HASH_A)
  assert.equal(parsed.lines[1].author, 'Alice')
  assert.equal(parsed.lines[1].summary, 'first commit')
  // One commit entry, shared by both lines.
  assert.deepEqual(Object.keys(parsed.commits), [HASH_A])
  assert.equal(parsed.commits[HASH_A].author, 'Alice')
  assert.equal(parsed.truncated, false)
})

test('porcelain: metadata of one commit is printed once, later headers inherit it', () => {
  const output = [
    ...meta(HASH_A, { author: 'Alice', authorTime: 1700000000, summary: 'first commit', finalLine: 1, groupSize: 1 }),
    '\tone',
    ...meta(HASH_B, { author: 'Bob Builder', authorTime: 1700003600, summary: 'second commit', finalLine: 2 }),
    '\ttwo',
    `${HASH_B} 3 3 1`,
    '\tthree',
    `${HASH_A} 4 4 1`,
    '\tfour',
  ].join('\n')
  const parsed = parseBlame(output)
  assert.deepEqual(parsed.lines.map(line => line.author), ['Alice', 'Bob Builder', 'Bob Builder', 'Alice'])
  assert.deepEqual(parsed.lines.map(line => line.line), [1, 2, 3, 4])
  assert.deepEqual(Object.keys(parsed.commits).sort(), [HASH_A, HASH_B].sort())
})

test('porcelain: an uncommitted line is marked and named, whatever git printed', () => {
  const output = [
    ...meta(HASH_A, { author: 'Alice', authorTime: 1700000000, summary: 'base', finalLine: 1 }),
    '\tkept',
    // git prints its pseudo-author for a worktree line; the parser owns the
    // answer, so the panel never depends on the locale of the message.
    ...meta(ZERO, { author: 'Not Committed Yet', authorTime: 1700007200, summary: 'Version of src/a.ts from src/a.ts', finalLine: 2 }),
    '\tedited in the worktree',
  ].join('\n')
  const parsed = parseBlame(output)
  const line = parsed.lines[1]
  assert.equal(line.committed, false)
  assert.equal(line.author, 'Not Committed Yet')
  assert.equal(line.hash, ZERO)
  assert.equal(line.summary, '')
  assert.equal(parsed.commits[ZERO].committed, false)
  // A header without any metadata is still an uncommitted line.
  const bare = parseBlame(`${ZERO} 1 1\n\tbrand new`)
  assert.equal(bare.lines[0].committed, false)
  assert.equal(bare.lines[0].author, 'Not Committed Yet')
  assert.equal(bare.lines[0].authorTime, 0)
})

test('porcelain: the content record may contain tabs and spaces', () => {
  const output = [
    ...meta(HASH_A, { author: 'Alice', authorTime: 1700000000, summary: 'indent', finalLine: 1 }),
    '\t  const a = 1',
    ...meta(HASH_B, { author: 'Bob', authorTime: 1700000000, summary: 'fix: keep\tthe tab and the spaces  ', finalLine: 2 }),
    '\t\tif (x) {',
  ].join('\n')
  const parsed = parseBlame(output)
  assert.equal(parsed.lines.length, 2)
  // The metadata of the second line keeps its inner whitespace verbatim: a
  // summary is free text, and only its first token is the key.
  assert.equal(parsed.lines[1].summary, 'fix: keep\tthe tab and the spaces  ')
  assert.equal(parsed.lines[1].author, 'Bob')
})

test('porcelain: a cut-off answer never invents a line', () => {
  // The output ends in the middle of a record: the header and the metadata are
  // there, the content record is not, so that line did not complete.
  const unterminated = [
    ...meta(HASH_A, { author: 'Alice', authorTime: 1700000000, summary: 'base', finalLine: 1 }),
    '\tconst a = 1',
    ...meta(HASH_B, { author: 'Bob', authorTime: 1700000000, summary: 'tail', finalLine: 2 }),
  ].join('\n')
  const parsed = parseBlame(unterminated)
  assert.equal(parsed.lines.length, 1)
  assert.equal(parsed.lines[0].author, 'Alice')

  // The last record without its trailing newline is still a line.
  const noFinalNewline = `${meta(HASH_A, { author: 'Alice', authorTime: 1700000000, summary: 'base', finalLine: 1 }).join('\n')}\n\tlast line without newline`
  const last = parseBlame(noFinalNewline)
  assert.equal(last.lines.length, 1)
  assert.equal(last.lines[0].line, 1)

  // An empty answer is an empty answer, not a broken panel.
  assert.deepEqual(parseBlame(''), { lines: [], commits: {}, truncated: false })
})

test('porcelain: the line cap stops the parse and says so', () => {
  const records = []
  for (let index = 0; index < 5; index += 1) {
    const hash = String(index + 1).repeat(40)
    records.push(`${hash} 1 ${index + 1} 1`, `author A${index}`, `author-time ${1700000000 + index}`, `summary s${index}`, 'filename src/a.ts', `\tline ${index}`)
  }
  const parsed = parseBlame(records.join('\n'), { limit: 3 })
  assert.equal(parsed.lines.length, 3)
  assert.equal(parsed.truncated, true)
  // Only the commits of the lines that made it into the answer are reported.
  assert.equal(Object.keys(parsed.commits).length, 3)

  // The default cap is the exported bound: a file of that size is already
  // extreme, and the panel says the annotation was cut.
  assert.ok(MAX_BLAME_LINES >= 10_000 && MAX_BLAME_LINES <= 100_000, `${MAX_BLAME_LINES} lines`)
  assert.equal(parseBlame(records.join('\n')).truncated, false)
})

test('porcelain: CRLF buffers, boundary commits and out-of-order groups', () => {
  const output = [
    // A boundary commit carries a caret in front of the hash.
    `^${HASH_B} 1 5 1`,
    'author Bob',
    'author-time 1700000000',
    'summary boundary commit',
    'filename src/a.ts',
    '\tlast',
    `${HASH_A} 1 1 1`,
    'author Alice',
    'author-time 1700000000',
    'summary first',
    'filename src/a.ts',
    '\tfirst',
  ].join('\r\n')
  const parsed = parseBlame(output)
  // The panel groups consecutive rows: the reading order is the line number.
  assert.deepEqual(parsed.lines.map(line => line.line), [1, 5])
  assert.deepEqual(parsed.lines.map(line => line.author), ['Alice', 'Bob'])
  assert.equal(parsed.lines[1].hash, HASH_B)
})

test('blame: a real repository annotates the worktree, and an uncommitted file is empty', async (t) => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
  } catch {
    t.skip('git is not installed')
    return
  }
  const dir = await mkdtemp(join(tmpdir(), 'iwb-git-blame-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'Blame Test')
    git('config', 'user.email', 'blame@test.local')
    git('config', 'commit.gpgsign', 'false')
    await writeFile(join(dir, 'tracked.txt'), 'one\ntwo\nthree\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'the base commit')
    // The worktree changes only the middle line: that line is not committed.
    await writeFile(join(dir, 'tracked.txt'), 'one\nTWO\nthree\n')

    const env = { root: dir, gitPath: '' }
    const parsed = await blame(env, 'tracked.txt')
    assert.equal(parsed.lines.length, 3)
    assert.deepEqual(parsed.lines.map(line => line.line), [1, 2, 3])
    assert.deepEqual(parsed.lines.map(line => line.committed), [true, false, true])
    assert.equal(parsed.lines[0].author, 'Blame Test')
    assert.equal(parsed.lines[0].summary, 'the base commit')
    assert.equal(parsed.lines[0].authorTime > 0, true)
    assert.ok(parsed.commits[parsed.lines[0].hash] !== undefined)
    assert.equal(parsed.lines[1].author, 'Not Committed Yet')

    // A path with no committed version is "no annotation", not an error.
    await writeFile(join(dir, 'untracked.txt'), 'new\n')
    assert.deepEqual(await blame(env, 'untracked.txt'), { lines: [], commits: {}, truncated: false })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
