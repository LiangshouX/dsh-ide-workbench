/**
 * PERF-02 — the Project panel subscribes to a store slice (PRD-v4 §1.2).
 *
 *   - the slice selector returns exactly the fields the panel reads;
 *   - a change inside the slice re-renders the panel, a change outside it
 *     does not;
 *   - the tree still follows expand / collapse / filter / status changes.
 *
 * The panel is mounted with `renderToStaticMarkup`, the same harness as
 * `tests/render.test.mjs` and `tests/tree-twisty.test.mjs` (this package has
 * no jsdom). A server render is one mount per call, so the "did it
 * re-render?" decision of `useStoreSlice` is exercised through its own
 * contract — `shallowEqual` over the slice — and the wiring itself is
 * checked against the panel source.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, rm, readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { shallowEqual } from '../src/client/hooks.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// A tiny DOM surface: module-level browser references must not explode even
// though SSR itself never touches them.
globalThis.window = {
  innerWidth: 1440,
  innerHeight: 900,
  location: { href: 'http://localhost/' },
  addEventListener() {},
  removeEventListener() {},
}
globalThis.self = globalThis.window
globalThis.document = {
  baseURI: 'http://localhost/',
  documentElement: { style: {} },
  head: { appendChild() {} },
  body: { style: {}, appendChild() {}, removeChild() {} },
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
}
globalThis.ResizeObserver = class { observe() {} disconnect() {} }

let modulePromise

async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'slice-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      entryPoints: ['src/client/ProjectPanel.jsx'],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: ['node20'],
      external: ['react', 'react-dom', 'react-dom/server'],
      jsx: 'transform',
      define: { 'process.env.NODE_ENV': '"production"' },
      outfile,
      logLevel: 'silent',
    })
    return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
  })()
  return modulePromise
}

const ROOT = 'C:\\work\\demo'
const SRC = `${ROOT}\\src`

/** One file-tree entry as the host would report it. */
function entry(name, path, rel, isDir) {
  return { name, path, rel, isDir, isSymlink: false, hidden: false, size: 0, mtimeMs: 0, ext: '' }
}

/** A small project: one folder with one file, plus a file at the root. */
function baseState() {
  return {
    root: ROOT,
    dirs: new Map([
      [ROOT, {
        loading: false,
        entries: [entry('src', SRC, 'src', true), entry('a.ts', `${ROOT}\\a.ts`, 'a.ts', false)],
      }],
      [SRC, {
        loading: false,
        entries: [entry('main.ts', `${SRC}\\main.ts`, 'src/main.ts', false)],
      }],
    ]),
    expanded: new Set([ROOT]),
    status: { isRepo: true, branch: 'main', entries: [] },
    settings: { shortcuts: {}, project: { showIgnored: false, singleClickOpen: false, excluded: [] } },
    filter: '',
    filterMode: 'tree',
    fileIndex: [],
    fileIndexLoading: false,
    fileIndexError: null,
    selectedPath: '',
    selectedPaths: new Set(),
    tabs: [],
    activeId: '',
    treeFocusTick: 0,
    clipboard: null,
    localeTick: 0,
    // Fields the panel does NOT read — a change here must not re-render it.
    toast: null,
    terminal: { sessions: [] },
    git: { commits: [] },
    quickOpen: false,
    layout: { left: 'project' },
    commit: { buckets: {} },
  }
}

/** A store double: it hands out its snapshot and accepts a subscription. */
function baseStore(state) {
  const store = {
    t: key => key,
    state,
    getSnapshot: () => state,
    subscribe: () => () => {},
    setSelection: () => {},
    toggleSelection: () => {},
    selectRange: () => {},
    clearSelection: () => {},
    openFile: () => {},
    toggleDir: () => {},
    setFilter: () => {},
    setFilterMode: () => {},
    setFileClipboard: () => {},
    pasteEntries: () => {},
    duplicateEntries: () => {},
    requestDelete: () => {},
    renameEntry: () => {},
    createEntry: () => {},
    moveEntries: () => {},
    expandAll: () => {},
    collapseAll: () => {},
    sync: () => {},
    addTerminal: () => {},
    openInSidebar: () => {},
    openInIde: () => {},
    reveal: () => {},
    stage: () => {},
    openDiff: () => {},
    showHistory: () => {},
    openQuickOpen: () => {},
    openSearchTab: () => {},
    sendToChat: () => {},
    openRootPicker: () => {},
    openProjectPicker: () => {},
    showTool: () => {},
    setSelectedPath: () => {},
    loadDir: () => {},
    toast: () => {},
  }
  return store
}

/** Mount the panel with a store that owns `state`. */
function renderPanel(state, propState = state) {
  const store = baseStore(state)
  return renderToStaticMarkup(React.createElement(ProjectPanel, { store, state: propState }))
}

/** A different value for one field, keeping its type. */
function changedValue(value) {
  if (value === null || value === undefined) return { changed: true }
  if (Array.isArray(value)) return [...value, 'extra']
  if (value instanceof Map) return new Map([...value, ['extra', null]])
  if (value instanceof Set) return new Set([...value, 'extra'])
  if (typeof value === 'object') return { ...value, changed: true }
  if (typeof value === 'boolean') return !value
  if (typeof value === 'number') return value + 1
  return `${value}-changed`
}

let ProjectPanel
let projectSlice

test('the slice selector returns exactly the fields the panel reads', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  projectSlice = mod.projectSlice

  const state = baseState()
  const slice = projectSlice(state)
  const expected = [
    'dirs', 'expanded', 'root', 'filter', 'filterMode', 'fileIndex', 'fileIndexLoading',
    'fileIndexError', 'status', 'settings', 'selectedPath', 'selectedPaths', 'tabs',
    'activeId', 'treeFocusTick', 'clipboard',
  ]
  assert.deepEqual(Object.keys(slice).sort(), [...expected].sort())

  // Every slice field carries the value of the matching state field.
  for (const field of expected) assert.equal(slice[field], state[field], field)

  // Source-level guard: the panel must not read the raw state any more, and
  // every field it reads has to be part of the slice (PRD §11 row 16).
  const source = await readFile(join(root, 'src/client/ProjectPanel.jsx'), 'utf8')
  const body = source.slice(source.indexOf('export function ProjectPanel'))
  assert.doesNotMatch(body, /(?<![\w.])state\./, 'the panel must not read the raw state')
  const read = new Set([...body.matchAll(/\bslice\.([a-zA-Z]+)/g)].map(match => match[1]))
  // `dirs` and `expanded` are read by `flatten(slice, …)` and
  // `flattenInputs(slice, …)`. The language is not a slice field at all:
  // `useStoreSlice` invalidates the slice when the store's locale tick
  // changes, so every panel follows the host language.
  const indirect = new Set(['dirs', 'expanded'])
  for (const field of read) {
    assert.ok(expected.includes(field), `${field} is read but missing from the slice`)
  }
  for (const field of expected) {
    assert.ok(read.has(field) || indirect.has(field), `${field} is in the slice but never read`)
  }
})

test('a field inside the slice re-renders the panel, a field outside it does not', async () => {
  const mod = await loadModule()
  projectSlice = mod.projectSlice

  const state = baseState()
  const before = projectSlice(state)

  // Every field of the slice must be able to trigger a re-render.
  for (const field of Object.keys(before)) {
    const changed = { ...state, [field]: changedValue(state[field]) }
    assert.equal(shallowEqual(before, projectSlice(changed)), false, `${field} must trigger a re-render`)
  }

  // Writes the panel does not read must not wake it up.
  for (const field of ['toast', 'terminal', 'git', 'quickOpen', 'layout', 'commit', 'search', 'confirm', 'cursor']) {
    const changed = { ...state, [field]: changedValue(state[field]) }
    assert.equal(shallowEqual(before, projectSlice(changed)), true, `${field} must not trigger a re-render`)
  }
})

test('the panel renders the store slice, not the state prop', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel

  const state = baseState()
  // A stale prop: the panel must show the store's tree, not the prop's.
  const stale = baseState()
  stale.root = 'C:\\work\\other'
  stale.dirs = new Map()

  const html = renderPanel(state, stale)
  assert.match(html, /a\.ts/)
  assert.match(html, /src/)
  assert.doesNotMatch(html, /other/)
})

test('the tree still follows expand, collapse, filter and status changes', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel

  const collapsed = baseState()
  assert.doesNotMatch(renderPanel(collapsed), /main\.ts/)

  const expanded = baseState()
  expanded.expanded = new Set([ROOT, SRC])
  assert.match(renderPanel(expanded), /main\.ts/)

  const filtered = baseState()
  filtered.filter = 'main'
  filtered.filterMode = 'tree'
  assert.doesNotMatch(renderPanel(filtered), />a\.ts</)

  const ignored = baseState()
  ignored.status = { isRepo: true, branch: 'main', entries: [{ path: 'a.ts', xy: '!!', ignored: true }] }
  assert.doesNotMatch(renderPanel(ignored), /iwb-tree-name[^>]*>a\.ts</)

  const modified = baseState()
  modified.status = { isRepo: true, branch: 'main', entries: [{ path: 'a.ts', xy: '.M', untracked: false }] }
  assert.match(renderPanel(modified), /iwb-git-modified/)
})
