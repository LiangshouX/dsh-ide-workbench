/**
 * Find in Files is a POPUP, not a tab (PRD-v5 supplement FIND-01 / FIND-02).
 *
 * The tab version was restored by the split: the results took a tab away from
 * the code the user was working on. The popup floats over the workbench, is
 * mounted by the workbench root (so it exists even with no document open),
 * and the search data stays the one slice it always was.
 *
 * These checks are about the wiring the SSR tests and the store tests cannot
 * see: which component owns the feature, which slice it reads, and that the
 * tab-shaped pieces are gone.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const clientDir = join(root, 'src/client')

const popup = await readFile(join(clientDir, 'SearchPopup.jsx'), 'utf8')
const workbench = await readFile(join(clientDir, 'Workbench.jsx'), 'utf8')
const editor = await readFile(join(clientDir, 'EditorArea.jsx'), 'utf8')
const styles = await readFile(join(clientDir, 'styles.js'), 'utf8')

test('the workbench root owns the popup, so it needs no open document', () => {
  assert.match(workbench, /import \{ SearchPopup \} from '\.\/SearchPopup\.jsx'/)
  assert.match(workbench, /React\.createElement\(SearchPopup, \{ store \}\)/)
  // The editor area no longer renders the results.
  assert.doesNotMatch(editor, /SearchView/)
  assert.doesNotMatch(editor, /kind === 'search'/)
})

test('the old tab view is gone for good', async () => {
  await assert.rejects(stat(join(clientDir, 'SearchView.jsx')))
  // The tab-shaped styles are gone with it; the popup has its own.
  for (const marker of ['.iwb-search-results', '.iwb-search-hit', '.iwb-search-file-head', '.iwb-search-input']) {
    assert.ok(!styles.includes(marker), `the core stylesheet must not carry ${marker}`)
  }
})

test('the popup reads the search slice and never the whole snapshot', () => {
  assert.match(popup, /export function searchPopupSlice\(state\) \{\s*\n\s*return \{ search: state\.search, popup: state\.searchPopup \}/)
  assert.match(popup, /useStoreSlice\(store, searchPopupSlice, shallowEqual\)/)
  // Closed means: nothing rendered, nothing subscribed to render.
  assert.match(popup, /if \(open !== true\) return null/)
})

test('the seed of a run comes from the store on every open', () => {
  // The generation marks the open: the field takes the query and the flags of
  // that moment and never keeps the values of an earlier run.
  assert.match(popup, /const generation = popup\.generation \?\? 0/)
  assert.match(popup, /const live = store\.state\?\.search \?\? search \?\? \{\}/)
  assert.match(popup, /setQuery\(live\.query \?\? ''\)/)
  assert.match(popup, /const \[seeded, setSeeded\] = useState\(false\)/)
  assert.match(popup, /if \(seeded !== true\) return undefined/)
})

test('a hit opens its line and closes the popup', () => {
  assert.match(popup, /store\.openSearchResult\(path, line, column\)/)
  // The store closes the popup before it opens the file: the popup is a
  // one-shot tool and the file is what has to be in front.
  const store = readFile(join(clientDir, 'store.js'), 'utf8')
  return store.then((source) => {
    assert.match(source, /openSearchResult\(rel, line, column\) \{[\s\S]{0,400}?this\.closeSearchPopup\(\)/)
    assert.match(source, /openSearchPopup\(query = ''\) \{/)
    assert.match(source, /closeSearchPopup\(\) \{/)
    assert.match(source, /moveSearchSelection\(delta\) \{/)
  })
})

test('the popup carries the keyboard of a modal', () => {
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'F8']) {
    assert.ok(popup.includes(`'${key}'`), `the popup handles ${key}`)
  }
  // The container owns the keys (a click on a file row moves the focus out of
  // the input), and a handled key never travels on to the workbench.
  assert.match(popup, /onContainerKeyDown/)
  assert.match(popup, /event\.stopPropagation\(\)/)
  // Esc closes, and so does a click on the backdrop or the ✕.
  assert.match(popup, /store\.closeSearchPopup\(\)/)
  assert.match(popup, /if \(event\.target === event\.currentTarget\) store\.closeSearchPopup\(\)/)
})

test('the preview shows the context the host sends with every hit', () => {
  assert.match(popup, /const before = Array\.isArray\(match\.before\) \? match\.before : \[\]/)
  assert.match(popup, /const after = Array\.isArray\(match\.after\) \? match\.after : \[\]/)
  // A binary hit says so instead of printing an empty line of code.
  assert.match(popup, /const binary = match\.binary === true/)
  assert.match(popup, /t\('search\.popup\.binary'\)/)
})

test('the popup has its own stylesheet and it is the core that owns it', () => {
  for (const marker of [
    '.iwb-search-popup-backdrop',
    '.iwb-search-popup {',
    '.iwb-search-popup-file',
    '.iwb-search-popup-preview',
    '.iwb-search-popup-line.iwb-hit',
  ]) {
    assert.ok(styles.includes(marker), `the core stylesheet must carry ${marker}`)
  }
  // The same skeleton as Quick Open: one z-index for every popup of the
  // workbench, so the search cannot land under a modal.
  assert.match(styles, /\.iwb-search-popup-backdrop \{ padding-top: 4vh; \}/)
  assert.match(styles, /\.iwb-quick-backdrop \{[^}]*z-index: 70;/)
})
