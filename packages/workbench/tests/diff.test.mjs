import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPatch, diffChromeWidth, diffInnerWidth, diffLineWidth, diffPaneWidths, hunkChangeIndexes, parseUnifiedDiff, sideBySideRows, unifiedRows, wordLevelDefault } from '../src/client/diff.js'

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

/* ── the horizontal measure of the diff surfaces ─────────────────────────────
   The rows are absolutely positioned, so each inner element gets its width
   from diff.js: the unified view from diffInnerWidth, and each pane of the
   side-by-side view from diffPaneWidths. These tests pin the numbers the
   viewer writes into the styles. */

test('an empty diff keeps the inner surface at the width of the panel', () => {
  const width = diffInnerWidth([])
  assert.equal(width.chars, 0)
  assert.equal(width.width, '100%')
  const panes = diffPaneWidths([])
  assert.equal(panes.left.width, '100%')
  assert.equal(panes.right.width, '100%')
  // A missing or malformed row list is not a reason to throw in the renderer.
  assert.equal(diffInnerWidth(null).width, '100%')
  assert.equal(diffInnerWidth(undefined).width, '100%')
  assert.equal(diffPaneWidths(null).left.width, '100%')
})

test('the unified surface is the widest visible line plus the chrome', () => {
  const rows = unifiedRows(parseUnifiedDiff(SAMPLE).files[0])
  const width = diffInnerWidth(rows)
  // The hunk header (`@@ -1,3 +1,4 @@`) is longer than every line, but it is
  // chrome: it carries an ellipsis and must not widen the scroll surface.
  assert.equal(width.chars, 'line1'.length)
  assert.equal(width.chromePx, 150)
  assert.equal(width.width, 'max(100%, calc(5ch + 150px))')
})

test('each side-by-side pane is measured from its own longest line', () => {
  const rows = [
    { kind: 'change', left: { text: 'a'.repeat(12) }, right: { text: 'b'.repeat(30) } },
    { kind: 'change', left: { text: 'c'.repeat(20) }, right: { text: 'd'.repeat(4) } },
    { kind: 'context', left: { text: 'same' }, right: { text: 'same' } },
  ]
  const panes = diffPaneWidths(rows)
  // The panes are separate scroll surfaces: no side reserves the width of the
  // other one, so a short right side does not force the left one to scroll.
  assert.equal(panes.left.chars, 20)
  assert.equal(panes.right.chars, 30)
  assert.equal(panes.left.width, 'max(100%, calc(20ch + 91px))')
  assert.equal(panes.right.width, 'max(100%, calc(30ch + 91px))')
  // The chrome of one pane cell is the sum of the widths of styles.js.
  assert.equal(diffChromeWidth('side'), 22 + 44 + 24 + 1)
  assert.equal(diffChromeWidth('unified'), 22 + 2 * 44 + 16 + 24)
})

test('a line that exists on one side only does not widen the other pane', () => {
  const rows = [
    { kind: 'change', left: { text: 'short' }, right: { text: 'x'.repeat(200) } },
    // An added line (no left cell) and a deleted one (no right cell).
    { kind: 'change', left: null, right: { text: 'y'.repeat(120) } },
    { kind: 'change', left: { text: 'z'.repeat(80) }, right: null },
  ]
  const panes = diffPaneWidths(rows)
  assert.equal(panes.left.chars, 80, 'the left pane only measures text it shows')
  assert.equal(panes.right.chars, 200, 'the right pane only measures text it shows')
})

test('a very long line widens the surface instead of being clipped', () => {
  const rows = unifiedRows(parseUnifiedDiff(SAMPLE).files[0])
  rows.push({ kind: 'add', text: 'x'.repeat(5000) })
  const width = diffInnerWidth(rows)
  assert.equal(width.chars, 5000)
  assert.equal(width.width, 'max(100%, calc(5000ch + 150px))')
})

test('full-width glyphs count as two columns of the monospace grid', () => {
  // The measure counts characters, it does not measure the font: a CJK glyph
  // is about two Latin cells wide in a monospace font, so it is counted as
  // two. A glyph wider than the table predicts can still overrun the reserved
  // width, but no row clips its text - the browser's own overflow keeps the
  // tail reachable through the scrollbar.
  assert.equal(diffLineWidth('中文abc'), 2 + 2 + 3)
  assert.equal(diffLineWidth('plain'), 5)
  const rows = [
    { kind: 'add', text: '中文abc' },
    { kind: 'context', text: 'plain' },
  ]
  assert.equal(diffInnerWidth(rows).chars, 7)
})

test('a tab advances the measure to the next four-column stop', () => {
  // The scroll surface sets `tab-size: 4`, so the measure has to assume the
  // same stop: a tab is not one column, it fills to the next multiple of four.
  assert.equal(diffLineWidth('\tx'), 4 + 1)
  assert.equal(diffLineWidth('ab\tc'), 2 + 2 + 1)
  assert.equal(diffLineWidth(''), 0)
})

test('word-level highlighting starts on unless the settings turn it off', () => {
  // The feature is on by default (V6). A settings document that has not
  // loaded yet, or an old document without the key, must NOT count as "off":
  // only the explicit boolean false of a user who switched 'Aa' off does.
  assert.equal(wordLevelDefault(null), true)
  assert.equal(wordLevelDefault(undefined), true)
  assert.equal(wordLevelDefault({}), true)
  assert.equal(wordLevelDefault({ git: {} }), true, 'an old document has no wordLevel key')
  assert.equal(wordLevelDefault({ git: { wordLevel: true } }), true)
  assert.equal(wordLevelDefault({ git: { wordLevel: false } }), false)
  // A value that is not the boolean false is not a decision to disable it.
  assert.equal(wordLevelDefault({ git: { wordLevel: 'false' } }), true)
})
