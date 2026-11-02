import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPatch, hunkChangeIndexes, parseUnifiedDiff, sideBySideRows, unifiedRows } from '../src/client/diff.js'

const SAMPLE = `diff --git a/a.txt b/a.txt
index 1111111..2222222 100644
--- a/a.txt
+++ b/a.txt
@@ -1,3 +1,4 @@
 line1
-old2
+new2
+new3
 line3
`

test('parses one file with numbers, counts and hunk lines', () => {
  const parsed = parseUnifiedDiff(SAMPLE)
  assert.equal(parsed.files.length, 1)
  const file = parsed.files[0]
  assert.equal(file.oldPath, 'a.txt')
  assert.equal(file.newPath, 'a.txt')
  assert.equal(file.additions, 2)
  assert.equal(file.deletions, 1)
  assert.equal(file.hunks.length, 1)
  const lines = file.hunks[0].lines
  assert.deepEqual(lines.map(line => line.type), [' ', '-', '+', '+', ' '])
  assert.equal(lines[1].oldNo, 2)
  assert.equal(lines[2].newNo, 2)
  assert.equal(lines[3].newNo, 3)
})

test('unified rows and hunk change indexes agree', () => {
  const file = parseUnifiedDiff(SAMPLE).files[0]
  const rows = unifiedRows(file)
  assert.equal(rows[0].kind, 'hunk')
  assert.deepEqual(hunkChangeIndexes(file, 0), [1, 2, 3])
  assert.equal(rows.length, 6)
})

test('side-by-side pairs deletions and additions', () => {
  const file = parseUnifiedDiff(SAMPLE).files[0]
  const rows = sideBySideRows(file)
  const change = rows.find(row => row.kind === 'change')
  assert.equal(change.left.text, 'old2')
  assert.equal(change.right.text, 'new2')
  const extras = rows.filter(row => row.kind === 'change')
  assert.equal(extras.length, 2)
  assert.equal(extras[1].left, null)
  assert.equal(extras[1].right.text, 'new3')
})

test('patch keeps only selected additions (unselected ones vanish)', () => {
  const file = parseUnifiedDiff(SAMPLE).files[0]
  const patch = buildPatch(file, new Set([3]))
  assert.match(patch, /^\+\+\+ b\/a\.txt$/m)
  assert.match(patch, /^@@ -1,3 \+1,4 @@$/m)
  assert.match(patch, /^ line1$/m)
  assert.match(patch, /^ old2$/m)
  assert.match(patch, /^\+new3$/m)
  assert.doesNotMatch(patch, /^-old2$/m)
  assert.doesNotMatch(patch, /^\+new2$/m)
})

test('patch with the deletion selection removes the line', () => {
  const file = parseUnifiedDiff(SAMPLE).files[0]
  const patch = buildPatch(file, new Set([1]))
  assert.match(patch, /^-old2$/m)
  assert.match(patch, /^ line1$/m)
  assert.doesNotMatch(patch, /^\+new2$/m)
  assert.doesNotMatch(patch, /^\+new3$/m)
  assert.match(patch, /^@@ -1,3 \+1,2 @@$/m)
})

test('empty selection produces no patch', () => {
  const file = parseUnifiedDiff(SAMPLE).files[0]
  assert.equal(buildPatch(file, new Set()), '')
})

test('parses a new-file diff', () => {
  const text = `diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
`
  const file = parseUnifiedDiff(text).files[0]
  assert.equal(file.isNew, true)
  assert.equal(file.oldPath, '')
  assert.equal(file.additions, 2)
  const patch = buildPatch(file, new Set([0, 1]))
  assert.match(patch, /^@@ -0,0 \+1,2 @@$/m)
  assert.match(patch, /^\+hello$/m)
})
