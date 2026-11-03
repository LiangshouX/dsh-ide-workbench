/**
 * The IDE behaviour of the two search entries: the text that is selected is
 * the text that gets looked for.
 *
 * Ctrl+F and Ctrl+Shift+R open a search field with the selection already in
 * it. The rules are pinned here because they are the ones that make the
 * feature feel right: a single-line selection is the seed as-is, a multi-line
 * selection cannot be searched line by line (the host greps per line), so its
 * first non-empty line is what the field takes, and an empty selection never
 * clears what the user typed.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { findSeed, selectedText } from '../src/client/util.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const clientDir = join(root, 'src/client')

test('a single-line selection is the seed as it is', () => {
  assert.equal(findSeed('writeFileSync'), 'writeFileSync')
  // The ends are trimmed, the spacing inside the line is not: the search is
  // literal and `"   "` must keep its three spaces.
  assert.equal(findSeed('  const a = "   "  '), 'const a = "   "')
})

test('a multi-line selection seeds with its first non-empty line', () => {
  // A per-line search cannot look for a block: taking the whole thing would
  // make every hit impossible.
  assert.equal(findSeed('\n\n  first line  \nsecond line\n'), 'first line')
  assert.equal(findSeed('one\r\ntwo\r\n'), 'one')
})

test('an empty selection is not a seed', () => {
  assert.equal(findSeed(''), '')
  assert.equal(findSeed('   \n\t\n '), '')
  assert.equal(findSeed(undefined), '')
  assert.equal(findSeed(null), '')
  assert.equal(findSeed(42), '')
})

test('an absurdly long line is cut so the field stays usable', () => {
  const seed = findSeed('x'.repeat(1000))
  assert.equal(seed.length, 400)
})

test('the page selection helper normalizes what it reads', () => {
  const original = globalThis.window
  try {
    globalThis.window = { getSelection: () => ({ toString: () => '  needle  ' }) }
    assert.equal(selectedText(), 'needle')
    globalThis.window = { getSelection: () => ({ toString: () => '' }) }
    assert.equal(selectedText(), '')
    globalThis.window = { getSelection: () => null }
    assert.equal(selectedText(), '')
    // Without a window (server-side render, unit test) there is no selection.
    delete globalThis.window
    assert.equal(selectedText(), '')
  } finally {
    if (original === undefined) delete globalThis.window
    else globalThis.window = original
  }
})

test('Ctrl+F seeds the find bar and Ctrl+Shift+R seeds the popup', async () => {
  const editor = await readFile(join(clientDir, 'EditorArea.jsx'), 'utf8')
  // The editor selection first (it is the exact buffer text), the page
  // selection as the fallback (the rendered Markdown preview, or a selection
  // outside the document pane).
  assert.match(editor, /const seedFind = \(\) => \{\s*\n\s*const hint = nextHint\(editorApi\?\.getSelection\?\.\(\) \|\| selectedText\(\)\)/)
  assert.match(editor, /const seedPreviewFind = \(\) => \{\s*\n\s*const hint = nextHint\(selectedText\(\)\)/)
  // The global search reads the selection at the moment the shortcut fires.
  assert.match(editor, /store\.openSearchPopup\(selectedText\(\)\)/)
  const index = await readFile(join(clientDir, 'index.jsx'), 'utf8')
  assert.match(index, /store\.openSearchPopup\(selectedText\(\)\)/)
})

test('the find bars re-seed on a new request and keep the typed query otherwise', async () => {
  const findBar = await readFile(join(clientDir, 'FindBar.jsx'), 'utf8')
  assert.match(findBar, /const \[query, setQuery\] = useState\(seed\?\.text \?\? ''\)/)
  // The nonce marks the request: the same word selected twice still re-seeds.
  assert.match(findBar, /\}, \[seed\?\.nonce\]\)/)
  const domBar = await readFile(join(clientDir, 'DomFindBar.jsx'), 'utf8')
  assert.match(domBar, /const \[query, setQuery\] = useState\(seed\?\.text \?\? ''\)/)
  assert.match(domBar, /\}, \[seed\?\.nonce\]\)/)
  // The editor hands the hint down to both bars.
  const editor = await readFile(join(clientDir, 'EditorArea.jsx'), 'utf8')
  assert.match(editor, /seed: findHint/)
  assert.match(editor, /previewSeed: previewHint/)
  const markdown = await readFile(join(clientDir, 'MarkdownView.jsx'), 'utf8')
  assert.match(markdown, /React\.createElement\(DomFindBar, \{ containerRef, t, seed,/)
})

test('a tab switch does not leave the find bar without an editor', async () => {
  // The API of the editor is reported by the editor itself: it mounts with a
  // new one and calls `onReady(null)` when it is destroyed. The reset effect
  // of the editor area runs AFTER the effects of its children, so a
  // `setEditorApi(null)` there would wipe the API of the editor that has just
  // mounted - and Ctrl+F would silently do nothing until the next switch.
  const editor = await readFile(join(clientDir, 'EditorArea.jsx'), 'utf8')
  const reset = /useEffect\(\(\) => \{\s*\n\s*setFindOpen\(false\)\s*\n\s*setPreviewFind\(false\)([\s\S]*?)\n  \}, \[active\?\.id\]\)/.exec(editor)
  assert.ok(reset !== null, 'the tab switch resets the find bars')
  assert.doesNotMatch(reset[1], /setEditorApi\(null\)/)
  const codeEditor = await readFile(join(clientDir, 'CodeEditor.jsx'), 'utf8')
  assert.match(codeEditor, /return \(\) => \{[\s\S]{0,120}?onReadyRef\.current\?\.\(null\)/)
})
