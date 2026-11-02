import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_STATUS_ENTRIES, parseNumstat, parseStatusV2 } from '../src/host/git.js'
import { resolveInside, toRelative } from '../src/host/workspace.js'

function statusText(lines) {
  return `${lines.join('\0')}\0`
}

test('parses porcelain v2 branch headers and entries', () => {
  const text = statusText([
    '# branch.oid 1234567890abcdef',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -3',
    '1 .M N... 100644 100644 100644 aaa bbb src/a.ts',
    '? new file.txt',
    'u UU N... 100644 100644 100644 100644 h1 h2 h3 conflict.ts',
  ])
  const parsed = parseStatusV2(text)
  assert.equal(parsed.branch, 'main')
  assert.equal(parsed.upstream, 'origin/main')
  assert.equal(parsed.ahead, 2)
  assert.equal(parsed.behind, 3)
  assert.equal(parsed.entries.length, 3)
  assert.deepEqual(parsed.entries[0], { path: 'src/a.ts', xy: '.M', untracked: false, conflict: false })
  assert.equal(parsed.entries[1].untracked, true)
  assert.equal(parsed.entries[1].path, 'new file.txt')
  assert.equal(parsed.entries[2].conflict, true)
  assert.equal(parsed.entries[2].path, 'conflict.ts')
})

test('detached HEAD is reported explicitly', () => {
  const parsed = parseStatusV2(statusText(['# branch.oid abc', '# branch.head (detached)']))
  assert.equal(parsed.detached, true)
  assert.equal(parsed.branch, undefined)
})

test('parses numstat including binary rows', () => {
  const map = parseNumstat('3\t1\tsrc/a.ts\0-\t-\timage.png\0')
  assert.deepEqual(map.get('src/a.ts'), { additions: 3, deletions: 1 })
  assert.deepEqual(map.get('image.png'), { binary: true })
})

test('the status parser stops at the entry limit and says so', () => {
  // A repository with a huge untracked tree would make every poll tick build
  // a list of hundreds of thousands of entries, so the parser takes a limit
  // and reports that it cut the list short (PRD-v5 supplement §11 risk #1).
  const lines = ['# branch.oid abc', '# branch.head main', '# branch.upstream origin/main']
  for (let index = 0; index < 50; index += 1) lines.push(`? file-${index}.txt`)
  const parsed = parseStatusV2(statusText(lines), { limit: 10 })
  assert.equal(parsed.entries.length, 10)
  assert.equal(parsed.truncated, true)
  // The branch facts are printed before the entries, so they survive the cut.
  assert.equal(parsed.branch, 'main')
  assert.equal(parsed.upstream, 'origin/main')
})

test('a status that fits into the limit is not truncated', () => {
  const parsed = parseStatusV2(statusText(['# branch.head main', '? a.txt']), { limit: 10 })
  assert.equal(parsed.truncated, false)
  assert.equal(parsed.entries.length, 1)
  assert.equal(parsed.entries[0].path, 'a.txt')
})

test('the entry limit of the status is generous for a normal repository', () => {
  // A few ten thousands of changed files is already extreme; the limit only
  // exists to keep one snapshot bounded.
  assert.ok(MAX_STATUS_ENTRIES >= 10_000, `${MAX_STATUS_ENTRIES} entries`)
  assert.ok(MAX_STATUS_ENTRIES <= 100_000, `${MAX_STATUS_ENTRIES} entries`)
})

test('resolveInside refuses traversal', () => {
  const root = process.platform === 'win32' ? 'C:\\work\\repo' : '/work/repo'
  assert.throws(() => resolveInside(root, root + (process.platform === 'win32' ? '\\..\\secret' : '/../secret')))
  const inside = resolveInside(root, 'src/a.ts')
  assert.ok(inside.startsWith(root))
  assert.equal(toRelative(root, inside), 'src/a.ts')
})
