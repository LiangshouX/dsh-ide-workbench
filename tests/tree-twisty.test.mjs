/**
 * Project tree regressions (PRD-v4 §10.1).
 *
 *   - clicking a directory twisty toggles the folder;
 *   - double clicking the directory name still toggles it;
 *   - the twisty click never selects the row (stopPropagation is required);
 *   - the tree memo reacts to every tree mutation (expand / collapse / filter
 *     / status colour) and only to those.
 *
 * The panel is mounted with `renderToStaticMarkup`, the same harness as
 * `tests/render.test.mjs`. Static markup carries no event handlers, so
 * `React.createElement` is wrapped to keep every created element: the row
 * props can then be driven directly, without a browser DOM.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

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

// ── element recorder ────────────────────────────────────────────────────
// `renderToStaticMarkup` drops event handlers, so every element React creates
// is kept here; the tree rows and their props stay reachable afterwards.
const created = []
const originalCreateElement = React.createElement
React.createElement = (type, props, ...children) => {
  const element = originalCreateElement(type, props, ...children)
  created.push(element)
  return element
}

let modulePromise

async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'tree-entry.mjs')
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
const MAIN = `${SRC}\\main.ts`

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
        entries: [entry('main.ts', MAIN, 'src/main.ts', false)],
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
    gitRepoRoot: '',
  }
}

/** A store double that records every call the panel makes. */
function baseStore(state) {
  const calls = []
  const record = (name, ...args) => { calls.push({ name, args }) }
  const store = {
    t: key => key,
    state: { clipboard: null },
    calls,
    // The panel subscribes to a store slice (PERF-02), so the store has to
    // hand out its snapshot and accept a subscription.
    getSnapshot: () => state,
    subscribe: () => () => {},
    setSelection: (...args) => record('setSelection', ...args),
    toggleSelection: (...args) => record('toggleSelection', ...args),
    selectRange: (...args) => record('selectRange', ...args),
    clearSelection: () => record('clearSelection'),
    openFile: (...args) => record('openFile', ...args),
    toggleDir: (...args) => record('toggleDir', ...args),
    setFilter: (...args) => record('setFilter', ...args),
    setFilterMode: (...args) => record('setFilterMode', ...args),
    setFileClipboard: (...args) => record('setFileClipboard', ...args),
    pasteEntries: (...args) => record('pasteEntries', ...args),
    duplicateEntries: (...args) => record('duplicateEntries', ...args),
    requestDelete: (...args) => record('requestDelete', ...args),
    renameEntry: (...args) => record('renameEntry', ...args),
    createEntry: (...args) => record('createEntry', ...args),
    moveEntries: (...args) => record('moveEntries', ...args),
    expandAll: (...args) => record('expandAll', ...args),
    collapseAll: (...args) => record('collapseAll', ...args),
    sync: (...args) => record('sync', ...args),
    addTerminal: (...args) => record('addTerminal', ...args),
    openInSidebar: (...args) => record('openInSidebar', ...args),
    openInIde: (...args) => record('openInIde', ...args),
    reveal: (...args) => record('reveal', ...args),
    stage: (...args) => record('stage', ...args),
    openDiff: (...args) => record('openDiff', ...args),
    showHistory: (...args) => record('showHistory', ...args),
    openQuickOpen: () => record('openQuickOpen'),
    openSearchTab: () => record('openSearchTab'),
    sendToChat: (...args) => record('sendToChat', ...args),
    openRootPicker: () => record('openRootPicker'),
    openProjectPicker: () => record('openProjectPicker'),
    showTool: (...args) => record('showTool', ...args),
    setSelectedPath: (...args) => record('setSelectedPath', ...args),
    loadDir: (...args) => record('loadDir', ...args),
    toast: () => {},
  }
  return store
}

/** Mount the panel and return its markup plus the recorded elements. */
function renderPanel(store, state) {
  created.length = 0
  const html = renderToStaticMarkup(React.createElement(ProjectPanel, { store, state }))
  return { html, elements: created.slice() }
}

/** Every tree row element, in creation order. */
function rowsOf(elements) {
  return elements.filter(element => typeof element?.props?.className === 'string'
    && element.props.className.includes('iwb-tree-row'))
}

/** The memoized row elements — the props `React.memo` compares. */
function memoRows(elements) {
  const memo = Symbol.for('react.memo')
  return elements.filter(element => element?.type?.$$typeof === memo)
}

/** The twisty of one row (the file rows keep an empty spacer instead). */
function twistyOf(row) {
  const children = row.props.children
  const list = Array.isArray(children) ? children : [children]
  return list.find(child => typeof child?.props?.className === 'string'
    && child.props.className.includes('iwb-tree-twisty'))
}

/** A click event with the DOM bubbling contract. */
function createEvent() {
  return {
    stopped: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
    stopPropagation() { this.stopped = true },
  }
}

/** Click the twisty and let the event bubble to the row when it is not stopped. */
function clickTwisty(twisty, row) {
  const event = createEvent()
  twisty.props.onClick(event)
  if (!event.stopped && typeof row.props.onClick === 'function') row.props.onClick(event)
  return event
}

let ProjectPanel

test('the tree twisty toggles the folder without selecting the row', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = baseState()
  const store = baseStore(state)
  const { elements } = renderPanel(store, state)

  const dirRow = rowsOf(elements).find(row => row.props.title === 'src')
  assert.ok(dirRow !== undefined, 'the folder row is rendered')
  const twisty = twistyOf(dirRow)
  assert.ok(twisty !== undefined, 'the folder row keeps its twisty')
  // The pointer cursor is a stylesheet contract (styles.js).
  assert.match(twisty.props.className, /iwb-tree-twisty-click/)

  const event = clickTwisty(twisty, dirRow)

  const toggles = store.calls.filter(call => call.name === 'toggleDir')
  assert.equal(toggles.length, 1, 'the twisty toggles the folder once')
  assert.deepEqual(toggles[0].args, [SRC])
  assert.equal(event.stopped, true, 'the twisty stops the click before the row')
  assert.equal(store.calls.filter(call => call.name === 'setSelection').length, 0,
    'the row is not selected by a twisty click')
})

test('double clicking the folder name still toggles the folder', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = baseState()
  const store = baseStore(state)
  const { elements } = renderPanel(store, state)

  const dirRow = rowsOf(elements).find(row => row.props.title === 'src')
  assert.ok(dirRow !== undefined)
  const event = createEvent()
  dirRow.props.onDoubleClick(event)

  const toggles = store.calls.filter(call => call.name === 'toggleDir')
  assert.equal(toggles.length, 1)
  assert.deepEqual(toggles[0].args, [SRC])
})

test('a file row keeps the empty twisty spacer and never toggles', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = baseState()
  const store = baseStore(state)
  const { elements } = renderPanel(store, state)

  const fileRow = rowsOf(elements).find(row => row.props.title === 'a.ts')
  assert.ok(fileRow !== undefined)
  const twisty = twistyOf(fileRow)
  assert.ok(twisty !== undefined, 'the file row keeps the spacer span')
  assert.equal(twisty.props.className, 'iwb-tree-twisty')
  assert.equal(twisty.props.onClick, undefined, 'the spacer is inert')
  assert.equal(store.calls.filter(call => call.name === 'toggleDir').length, 0)
})

test('the locate-file button reveals the active file in the tree', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = baseState()
  const store = baseStore(state)
  state.tabs = [{ id: 'file:main', kind: 'file', path: MAIN, rel: 'src/main.ts', name: 'main.ts' }]
  state.activeId = 'file:main'
  const { elements } = renderPanel(store, state)

  const button = elements.find(element => element?.props?.title === 'project.locateFile')
  assert.ok(button !== undefined, 'the locate button is rendered')
  assert.equal(button.props.disabled, false)

  button.props.onClick(createEvent())
  const shown = store.calls.filter(call => call.name === 'showTool')
  assert.equal(shown.length, 1)
  assert.deepEqual(shown[0].args, ['project'])
  const located = store.calls.filter(call => call.name === 'setSelectedPath')
  assert.equal(located.length, 1)
  assert.deepEqual(located[0].args, [MAIN])
})

test('the locate-file button is disabled without an active file tab', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = baseState()
  const store = baseStore(state)
  const { elements } = renderPanel(store, state)

  const button = elements.find(element => element?.props?.title === 'project.locateFile')
  assert.ok(button !== undefined)
  assert.equal(button.props.disabled, true)
})

test('the flatten memo depends on every input the tree reads', async () => {
  const mod = await loadModule()
  const state = baseState()
  const ignored = new Set()
  const inputs = mod.flattenInputs(state, false, ignored, 'tree')

  assert.equal(inputs.length, 8)
  assert.equal(inputs[0], state.dirs, 'dirs')
  assert.equal(inputs[1], state.expanded, 'expanded')
  assert.equal(inputs[2], state.root, 'root')
  assert.equal(inputs[3], state.filter, 'filter')
  assert.equal(inputs[4], state.gitRepoRoot, 'gitRepoRoot')
  assert.equal(inputs[5], false, 'showIgnored')
  assert.equal(inputs[6], ignored, 'status.ignored')
  assert.equal(inputs[7], 'tree', 'filterMode')
})

test('every tree mutation changes the rows and its memo input', async () => {
  const mod = await loadModule()
  const base = baseState()
  const ignored = new Set()
  const rowsOf_ = state => mod.flatten(state, state.filter, false, ignored, 'tree').map(row => row.key)

  const before = rowsOf_(base)

  // Expand: the folder's child appears and `expanded` is a new Set.
  const expanded = { ...base, expanded: new Set([ROOT, SRC]) }
  assert.notDeepEqual(rowsOf_(expanded), before)
  assert.notEqual(mod.flattenInputs(expanded, false, ignored, 'tree')[1], mod.flattenInputs(base, false, ignored, 'tree')[1])

  // Collapse: the child disappears again.
  assert.deepEqual(rowsOf_(base), before)

  // Filter: only matching files stay.
  const filtered = { ...base, filter: 'main' }
  assert.notDeepEqual(rowsOf_(filtered), before)
  assert.notEqual(mod.flattenInputs(filtered, false, ignored, 'tree')[3], mod.flattenInputs(base, false, ignored, 'tree')[3])

  // Status colour: an ignored entry disappears from the tree.
  const statusIgnored = new Set(['a.ts'])
  const withIgnored = mod.flatten(base, base.filter, false, statusIgnored, 'tree').map(row => row.key)
  assert.notDeepEqual(withIgnored, before)
  assert.notEqual(statusIgnored, ignored, 'the ignored set is a new reference')
})

test('the rendered tree follows expand, collapse, filter and status changes', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel

  const collapsed = baseState()
  const collapsedHtml = renderPanel(baseStore(collapsed), collapsed).html
  assert.doesNotMatch(collapsedHtml, /main\.ts/)

  const expanded = baseState()
  expanded.expanded = new Set([ROOT, SRC])
  const expandedHtml = renderPanel(baseStore(expanded), expanded).html
  assert.match(expandedHtml, /main\.ts/)

  const filtered = baseState()
  filtered.filter = 'main'
  filtered.filterMode = 'tree'
  const filteredHtml = renderPanel(baseStore(filtered), filtered).html
  assert.doesNotMatch(filteredHtml, />a\.ts</)

  const ignored = baseState()
  ignored.status = { isRepo: true, branch: 'main', entries: [{ path: 'a.ts', xy: '!!', ignored: true }] }
  const ignoredHtml = renderPanel(baseStore(ignored), ignored).html
  assert.doesNotMatch(ignoredHtml, /iwb-tree-name[^>]*>a\.ts</)
})

test('a status change re-colours its row, and the rows share one callback set', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const before = baseState()
  const store = baseStore(before)

  const beforeRow = rowsOf(renderPanel(store, before).elements).find(row => row.props.title === 'a.ts')
  assert.ok(beforeRow !== undefined)
  assert.doesNotMatch(beforeRow.props.className, /iwb-git-modified/)

  const after = baseState()
  after.status = { isRepo: true, branch: 'main', entries: [{ path: 'a.ts', xy: '.M', untracked: false }] }
  const afterRow = rowsOf(renderPanel(baseStore(after), after).elements).find(row => row.props.title === 'a.ts')
  assert.ok(afterRow !== undefined)
  assert.match(afterRow.props.className, /iwb-git-modified/, 'the status colour reaches the row')

  // PERF-04: the rows must share one set of callbacks. A callback created per
  // row (or a callback that captures the rows) would give every row its own
  // identity and defeat the memo.
  const rows = memoRows(created)
  assert.ok(rows.length >= 2, 'the tree has several rows')
  for (const name of ['onRowClick', 'onRowDoubleClick', 'onContextMenu', 'onDragStart', 'onDragOver', 'onDrop', 'onDragEnd', 'onToggleDir']) {
    const identities = new Set(rows.map(row => row.props[name]))
    assert.equal(identities.size, 1, `${name} is shared by every row`)
  }
})
