/**
 * The outline of a markdown document is a popover (PRD-v8 §6.5, OUT-01).
 *
 * Until now the only way out of it was the button that opened it: a reader
 * who had scrolled to the middle of a document had to find that button
 * again, in a corner of the window, to get the outline out of the way. A
 * popover closes when the reader clicks outside of it.
 *
 * The package has no DOM, so the contract is asserted at the SOURCE level -
 * the same way `tests/perf-hot-path.test.mjs` pins the shape of the bundle.
 * The three facts that make the feature work:
 *
 *   1. the outline element carries the ref, so a click inside it is not a
 *      click "outside";
 *   2. a pointer press ANYWHERE in the document closes it;
 *   3. the button that OPENS it carries a class of its own, so pressing it
 *      is not a click "outside" either - its own handler does the closing.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const view = await readFile(join(root, 'src/client/MarkdownView.jsx'), 'utf8')
const area = await readFile(join(root, 'src/client/EditorArea.jsx'), 'utf8')

test('the outline is closed by a press outside of it', () => {
  // The listener listens on the DOCUMENT, in the capture phase: a press that
  // some other component stops must still close the outline.
  assert.match(view, /addEventListener\('pointerdown', onPointerDown, true\)/,
    'the outline watches the whole document')
  assert.match(view, /removeEventListener\('pointerdown', onPointerDown, true\)/,
    'the listener is taken down with the outline')
  assert.match(view, /onToggleOutline\(\)/,
    'a press outside closes the outline')
})

test('a press inside the outline is not a press outside', () => {
  // The outline element carries the ref, and the handler asks it whether the
  // press landed inside.
  assert.match(view, /ref: outlineRef/,
    'the outline element carries the ref')
  assert.match(view, /outlineRef\.current\?\.contains\(target\) === true/,
    'the handler asks the outline whether the press was inside')
  assert.match(view, /target\.closest\?\.\('\.iwb-outline-toggle'\) !== null/,
    'the button that opens the outline is not "outside" of it')
})

test('Escape closes the outline too', () => {
  assert.match(view, /event\.key === 'Escape'/, 'Escape closes the outline')
  assert.match(view, /addEventListener\('keydown', onKeyDown, true\)/,
    'the key is watched on the document')
})

test('the button that opens the outline carries a class of its own', () => {
  // Without the class the handler would treat the press on the button as a
  // press "outside", and the outline would close and open again in the same
  // gesture.
  assert.match(area, /className: `iwb-iconbtn iwb-outline-toggle /,
    'the toggle button of the outline is marked')
})
