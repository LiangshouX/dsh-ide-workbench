/**
 * R4 — the frozen "current folder" bar of the Project tree.
 *
 *   - the tree rows are absolutely positioned (the tree is virtualised), so
 *     the bar is a layer of its own and its content is rebuilt from the row
 *     model;
 *   - the bar points at the WHOLE CHAIN of folders the viewport starts in,
 *     and it follows the scroll;
 *   - the fold marker folds that folder, every step of the chain jumps to
 *     its folder;
 *   - the bar is a navigation bar: it never joins the selection;
 *   - no bar on a short tree, none in the flat quick-file list.
 *
 * The panel is mounted with `renderToStaticMarkup`, the same harness as
 * `tests/tree-twisty.test.mjs` (this package has no jsdom). Static markup
 * carries no event handlers, so `React.createElement` is wrapped to keep every
 * created element: the props can then be driven directly.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, readFile, rm } from 'node:fs/promises'
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
    const outfile = join(dir, 'sticky-entry.mjs')
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
const ROW_HEIGHT = 22

/** One file-tree entry as the host would report it. */
function entry(name, path, rel, isDir) {
  return { name, path, rel, isDir, isSymlink: false, hidden: false, size: 0, mtimeMs: 0, ext: '' }
}

/**
 * A project with one folder that holds ten files: enough rows to scroll.
 */
function baseState() {
  const files = []
  for (let index = 0; index < 10; index += 1) {
    files.push(entry(`f${index}.ts`, `${SRC}\\f${index}.ts`, `src/f${index}.ts`, false))
  }
  return {
    root: ROOT,
    dirs: new Map([
      [ROOT, { loading: false, entries: [entry('src', SRC, 'src', true)] }],
      [SRC, { loading: false, entries: files }],
    ]),
    expanded: new Set([ROOT, SRC]),
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
    gitRepoRoot: '',
  }
}

/** A store double that records every call the panel makes. */
function baseStore(state) {
  const calls = []
  const record = (name, ...args) => { calls.push({ name, args }) }
  return {
    t: key => key,
    state,
    calls,
    getSnapshot: () => state,
    subscribe: () => () => {},
    setSelection: (...args) => record('setSelection', ...args),
    toggleSelection: () => {},
    selectRange: () => {},
    clearSelection: () => {},
    openFile: () => {},
    toggleDir: (...args) => record('toggleDir', ...args),
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
    openSearchPopup: () => {},
    sendToChat: () => {},
    openRootPicker: () => {},
    openProjectPicker: () => {},
    showTool: () => {},
    setSelectedPath: (...args) => record('setSelectedPath', ...args),
    loadDir: () => {},
    toast: (...args) => record('toast', ...args),
  }
}

/** Mount the panel at a given scroll offset. */
function renderPanel(state, scrollTop = 0) {
  created.length = 0
  const store = baseStore(state)
  const html = renderToStaticMarkup(React.createElement(ProjectPanel, { store, state, initialScrollTop: scrollTop }))
  return { html, store, elements: created.slice() }
}

/** The frozen bar of the rendered panel, if there is one. */
function stickyBarOf(elements) {
  // The children are created before their parent, so the bar is the element
  // with the plain class - not the item inside it.
  return elements.find(element => element?.props?.className === 'iwb-tree-sticky')
}

/** The twisty of the frozen bar. */
function twistyOf(bar) {
  const children = bar.props.children
  const list = Array.isArray(children) ? children : [children]
  return list.find(child => typeof child?.props?.className === 'string'
    && child.props.className.includes('iwb-tree-twisty'))
}

/** The children of the frozen bar, with the fragments opened up. */
function barChildren(bar) {
  const children = bar.props.children
  const list = Array.isArray(children) ? children : [children]
  const out = []
  for (const child of list) {
    if (child === null || child === undefined || typeof child !== 'object') continue
    const grand = child.props?.children
    if (grand !== undefined && (Array.isArray(grand) || typeof grand === 'object')) {
      const inner = Array.isArray(grand) ? grand : [grand]
      for (const item of inner) {
        if (item !== null && item !== undefined && typeof item === 'object') out.push(item)
      }
      continue
    }
    out.push(child)
  }
  return out
}

/** The clickable folder of the frozen bar. */
function itemOf(bar) {
  return barChildren(bar).find(child => typeof child?.props?.className === 'string'
    && child.props.className.includes('iwb-tree-sticky-item'))
}

/** Every clickable folder of the frozen bar, in the order of the chain. */
function itemsOf(bar) {
  return barChildren(bar).filter(child => typeof child?.props?.className === 'string'
    && child.props.className.includes('iwb-tree-sticky-item'))
}

/** A click event with the DOM bubbling contract. */
function createEvent(detail = 1) {
  return {
    detail,
    stopped: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
    stopPropagation() { this.stopped = true },
  }
}

let ProjectPanel

test('the frozen bar names the folder the viewport sits in', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = baseState()
  // The tree reads: `src` (row 0), then the ten files. Scrolling past the
  // `src` row puts the viewport inside the folder.
  const { html, elements } = renderPanel(state, ROW_HEIGHT * 3)
  const bar = stickyBarOf(elements)
  assert.ok(bar !== undefined, 'the frozen bar is rendered')
  assert.match(html, /iwb-tree-sticky/)
  assert.match(html, /iwb-tree-sticky-item/)
  // The bar is a navigation bar, not a tree row: it never joins the tree.
  assert.doesNotMatch(bar.props.className, /iwb-tree-row/)
  assert.match(html, />src</)
})

test('the frozen bar follows the scroll and names the folder of the viewport', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = baseState()
  const rows = mod.flatten(state, state.filter, false, new Set(), 'tree')
  const paths = new Set(rows.map(row => row.entry.path))

  // The first row is the folder `src`: its parent is the project root, which
  // is not a row - there is nothing to freeze yet.
  assert.equal(mod.currentFolderPathOf(rows, 0, paths, ROOT), null)

  // Scrolled into the folder, the bar points at that folder - one level.
  assert.equal(mod.currentFolderPathOf(rows, ROW_HEIGHT * 3, paths, ROOT), SRC)
  // The name of a folder that contains a file is not a chain either.
  const single = mod.currentFolderPathOf(rows, ROW_HEIGHT * 5, paths, ROOT)
  assert.equal(single, SRC)
})

test('no frozen bar on a tree that is not scrolled', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = baseState()
  const { html, elements } = renderPanel(state, 0)
  assert.equal(stickyBarOf(elements), undefined, 'the bar is hidden at the top')
  assert.doesNotMatch(html, /iwb-tree-sticky/)
})

test('the frozen bar is hidden in the flat quick-file list', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = baseState()
  state.filterMode = 'files'
  state.filter = 'f3'
  state.fileIndex = ['src/f3.ts']
  const { html, elements } = renderPanel(state, ROW_HEIGHT * 3)
  assert.equal(stickyBarOf(elements), undefined, 'the quick list has no hierarchy')
  assert.doesNotMatch(html, /iwb-tree-sticky/)
})

test('the frozen bar shows in the default file mode, where the tree is shown', async () => {
  // The 'files' mode only changes WHAT THE FILTER SEARCHES IN - the panel
  // shows the TREE until a filter is typed. The bar must not be switched off
  // with the mode, or it would never appear in the default configuration.
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = baseState()
  state.filterMode = 'files'
  state.filter = ''
  const { html, elements } = renderPanel(state, ROW_HEIGHT * 3)
  const bar = stickyBarOf(elements)
  assert.ok(bar !== undefined, 'the frozen bar is rendered in the default mode')
  assert.match(html, /iwb-tree-sticky/)
  assert.match(html, />src</)
})

test('the fold marker of the frozen bar folds that folder once', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = baseState()
  const { store, elements } = renderPanel(state, ROW_HEIGHT * 3)
  const bar = stickyBarOf(elements)
  assert.ok(bar !== undefined)
  const twisty = twistyOf(bar)
  assert.ok(twisty !== undefined, 'the bar carries a fold marker')

  const event = createEvent(1)
  twisty.props.onClick(event)
  const toggles = store.calls.filter(call => call.name === 'toggleDir')
  assert.equal(toggles.length, 1, 'the folder is folded once')
  assert.deepEqual(toggles[0].args, [SRC])
  assert.equal(event.stopped, true, 'the fold marker stops the click')
  assert.equal(store.calls.filter(call => call.name === 'setSelectedPath').length, 0,
    'the fold marker does not jump')

  // A double click sends two clicks plus a dblclick: only the first click
  // may fold, and the dblclick must not reach the bar.
  const second = createEvent(2)
  twisty.props.onClick(second)
  assert.equal(store.calls.filter(call => call.name === 'toggleDir').length, 1,
    'the second click of a double click does not fold again')
  let dblStopped = false
  twisty.props.onDoubleClick({ stopPropagation() { dblStopped = true } })
  assert.equal(dblStopped, true, 'the dblclick does not reach the bar')
})

test('clicking the folder of the frozen bar jumps to it', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = baseState()
  const { store, elements } = renderPanel(state, ROW_HEIGHT * 3)
  const bar = stickyBarOf(elements)
  // The LAST step of the chain is the folder the viewport is in.
  const items = itemsOf(bar)
  const item = items[items.length - 1]
  assert.ok(item !== undefined, 'the bar carries the folder')

  item.props.onClick(createEvent())
  const jumps = store.calls.filter(call => call.name === 'setSelectedPath')
  assert.equal(jumps.length, 1)
  assert.deepEqual(jumps[0].args, [SRC])
  assert.equal(store.calls.filter(call => call.name === 'toggleDir').length, 0,
    'jumping does not fold the folder')
})

test('the frozen bar carries the whole chain from the root', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = baseState()
  const { store, elements } = renderPanel(state, ROW_HEIGHT * 3)
  const bar = stickyBarOf(elements)
  assert.ok(bar !== undefined)
  // The chain of the viewport: the project root and the folder it sits in.
  const items = itemsOf(bar)
  assert.equal(items.length, 2, 'the root and the current folder')
  assert.deepEqual(items.map(item => item.props.children), ['demo', 'src'])
  // The root brings the tree back to the top; it is not a row.
  items[0].props.onClick(createEvent())
  assert.equal(store.calls.filter(call => call.name === 'setSelectedPath').length, 0,
    'the root is not selected')
  // The folder of the viewport is selected.
  items[1].props.onClick(createEvent())
  const jumps = store.calls.filter(call => call.name === 'setSelectedPath')
  assert.equal(jumps.length, 1)
  assert.deepEqual(jumps[0].args, [SRC])
})

test('the frozen bar covers the padding of the scroll container', async () => {
  // A sticky element stops at the edge of the padding of its scroll
  // container, so the bar used to float a few pixels below the panel header.
  // It covers that padding instead: the negative margin lifts it to the
  // header, and the negative margin below cancels its own height so the rows
  // do not move.
  const styles = await readFile(join(root, 'src/client/styles.js'), 'utf8')
  const tree = /\.iwb-tree \{([^}]*)\}/.exec(styles)
  assert.ok(tree !== null, 'the tree rule is in the stylesheet')
  const padding = /padding:\s*(\d+)px 0 \d+px/.exec(tree[1])
  assert.ok(padding !== null, 'the tree has a padding on top')
  const bar = /\.iwb-tree-sticky \{([^}]*)\}/.exec(styles)
  assert.ok(bar !== null, 'the frozen bar is in the stylesheet')
  const margin = /margin:\s*-(\d+)px 0 -(\d+)px/.exec(bar[1])
  assert.ok(margin !== null, 'the bar lifts itself over the padding')
  const height = /height:\s*(\d+)px/.exec(bar[1])
  assert.ok(height !== null, 'the bar has a height')
  assert.equal(Number(margin[1]), Number(padding[1]),
    'the bar covers exactly the padding of the scroll container')
  assert.equal(Number(margin[2]), Number(height[1]),
    'the bar cancels its own height, so the rows do not move')
})

test('a short panel elides the middle of the chain, then the root', async () => {  const mod = await loadModule()
  const chain = [
    { path: null, label: 'demo', title: 'demo' },
    { path: 'a', label: 'a', title: 'a' },
    { path: 'b', label: 'b', title: 'b' },
    { path: 'c', label: 'c', title: 'c' },
  ]
  const labels = width => mod.fitFolderChain(chain, width).map(step => step.label)
  // The whole chain fits.
  assert.deepEqual(labels(1200), ['demo', 'a', 'b', 'c'])
  // The middle goes first.
  assert.deepEqual(labels(138), ['demo', '…', 'c'])
  // The project root goes with it.
  assert.deepEqual(labels(90), ['…', 'c'])
  // The step that is dropped has no path: it is not clickable.
  assert.equal(mod.fitFolderChain(chain, 90)[0].path, null)
  // The last step is never dropped: it is the folder the viewport is in.
  assert.equal(mod.fitFolderChain(chain, 10)[1].label, 'c')
})
