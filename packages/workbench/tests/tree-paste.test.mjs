/**
 * The tree of the Project window: the paste and the fold.
 *
 *   - a selected folder receives the paste INSIDE itself (the gesture of the
 *     user: one folder is picked, Ctrl+V is pressed);
 *   - a selected file receives the paste in its own folder;
 *   - without a selection the paste lands in the project root;
 *   - the context menu pastes into the same folder as the keyboard - ONE
 *     rule for the two, so they can never disagree;
 *   - the menu NAMES the folder the paste lands in;
 *   - a paste that runs can be stopped;
 *   - the toolbar folds every folder.
 *
 * The panel is mounted with `renderToStaticMarkup`, the same harness as
 * `tests/tree-twisty.test.mjs`: static markup carries no event handlers, so
 * `React.createElement` is wrapped to keep every created element - the rows
 * and their props stay reachable without a browser DOM.
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
// The tree asks `target instanceof HTMLElement` before it reads a key: the
// browser always has it, the server render of the harness does not.
globalThis.HTMLElement = class {}

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
    const outfile = join(dir, 'tree-paste-entry.mjs')
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
const OTHER = `${ROOT}\\other.ts`

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
        entries: [entry('src', SRC, 'src', true), entry('other.ts', OTHER, 'other.ts', false)],
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
    clipboard: null,
    pasteBusy: false,
    gitRepoRoot: '',
  }
}

/** A store double that records every call the panel makes. */
function baseStore(state) {
  const calls = []
  const record = (name, ...args) => { calls.push({ name, args }) }
  const store = {
    t: key => key,
    state,
    calls,
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
    cancelPaste: (...args) => record('cancelPaste', ...args),
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
    openSearchPopup: () => record('openSearchPopup'),
    sendToChat: (...args) => record('sendToChat', ...args),
    openRootPicker: () => record('openRootPicker'),
    openProjectPicker: () => record('openProjectPicker'),
    showTool: (...args) => record('showTool', ...args),
    setSelectedPath: (...args) => record('setSelectedPath', ...args),
    loadDir: (...args) => record('loadDir', ...args),
    expandPaths: (...args) => record('expandPaths', ...args),
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

/** The body of the tree - the element that owns the keyboard. */
function treeBodyOf(elements) {
  return elements.find(element => typeof element?.props?.className === 'string'
    && element.props.className.includes('iwb-panel-body')
    && element.props.className.includes('iwb-tree'))
}

/** Every tree row element, in creation order. */
function rowsOf(elements) {
  return elements.filter(element => typeof element?.props?.className === 'string'
    && element.props.className.includes('iwb-tree-row'))
}

/** A key event of the tree. */
function keyEvent(key, modifiers = {}) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    preventDefault() {},
    stopPropagation() {},
    ...modifiers,
  }
}

/** The clipboard of the panel: one file, ready to be pasted. */
function withClipboard(state) {
  state.clipboard = { paths: [OTHER], cut: false }
  return state
}

let ProjectPanel

test('a selected folder receives the paste inside itself', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = withClipboard(baseState())
  // The gesture of the user: the folder is picked (one click), then Ctrl+V.
  state.selectedPath = SRC
  state.selectedPaths = new Set([SRC])
  const store = baseStore(state)
  const { elements } = renderPanel(store, state)

  const body = treeBodyOf(elements)
  assert.ok(body !== undefined, 'the tree owns the keyboard')
  body.props.onKeyDown(keyEvent('v', { ctrlKey: true }))

  const pastes = store.calls.filter(call => call.name === 'pasteEntries')
  assert.equal(pastes.length, 1, 'the paste runs once')
  assert.equal(pastes[0].args[0], SRC, 'the paste lands IN the selected folder')
})

test('a selected file receives the paste in its own folder', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = withClipboard(baseState())
  state.selectedPath = MAIN
  state.selectedPaths = new Set([MAIN])
  const store = baseStore(state)
  const { elements } = renderPanel(store, state)

  treeBodyOf(elements).props.onKeyDown(keyEvent('v', { ctrlKey: true }))

  const pastes = store.calls.filter(call => call.name === 'pasteEntries')
  assert.equal(pastes.length, 1)
  assert.equal(pastes[0].args[0], SRC, 'the paste lands in the folder of the file')
})

test('without a selection the paste lands in the project root', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = withClipboard(baseState())
  const store = baseStore(state)
  const { elements } = renderPanel(store, state)

  treeBodyOf(elements).props.onKeyDown(keyEvent('v', { ctrlKey: true }))

  const pastes = store.calls.filter(call => call.name === 'pasteEntries')
  assert.equal(pastes.length, 1)
  assert.equal(pastes[0].args[0], ROOT)
})

test('the keyboard copies and cuts the selection', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = baseState()
  state.selectedPath = SRC
  state.selectedPaths = new Set([SRC])
  const store = baseStore(state)
  const { elements } = renderPanel(store, state)
  const body = treeBodyOf(elements)

  body.props.onKeyDown(keyEvent('c', { ctrlKey: true }))
  body.props.onKeyDown(keyEvent('x', { ctrlKey: true }))

  const copies = store.calls.filter(call => call.name === 'setFileClipboard')
  assert.equal(copies.length, 2)
  assert.deepEqual(copies[0].args, [[SRC], false], 'Ctrl+C copies')
  assert.deepEqual(copies[1].args, [[SRC], true], 'Ctrl+X cuts')
})

test('the context menu and the keyboard share ONE paste rule', async () => {
  // The context menu cannot be opened in a server render (it is a state of
  // the panel), so the rule is checked where it lives: the target is
  // computed ONCE, by the pure module, and both the menu and the keyboard
  // paste into it. Two rules would be two answers to "where does it go?".
  const source = await readFile(join(root, 'src/client/ProjectPanel.jsx'), 'utf8')
  const rules = source.match(/pasteTargetOf\(/g) ?? []
  assert.equal(rules.length, 1, 'the paste target is computed in one place')
  const uses = source.match(/runPaste\(pasteTarget\)/g) ?? []
  assert.equal(uses.length, 2, 'the menu and the keyboard paste into the same folder')
  // The menu NAMES the folder the paste lands in: the user has to know
  // where the entry will appear before it does.
  assert.match(source, /title: interpolate\(t\('project\.pasteInto'\)/,
    'the menu names the folder of the paste')
})

test('the toolbar folds every folder of the tree', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = baseState()
  const store = baseStore(state)
  const { elements } = renderPanel(store, state)

  const button = elements.find(element => element?.props?.title === 'project.collapseAll')
  assert.ok(button !== undefined, 'the fold button is in the toolbar')
  assert.equal(button.props.disabled, undefined, 'the button is never disabled')

  button.props.onClick()

  const folds = store.calls.filter(call => call.name === 'collapseAll')
  assert.equal(folds.length, 1, 'the tree is folded')
})

test('a paste that runs shows the busy bar and can be stopped', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = withClipboard(baseState())
  state.selectedPath = SRC
  state.selectedPaths = new Set([SRC])
  // The paste is running: the tree has to say that it is busy, and to offer
  // the cancel.
  state.pasteBusy = true
  const store = baseStore(state)
  const { elements } = renderPanel(store, state)

  const busy = elements.find(element => element?.props?.className === 'iwb-tree-busy')
  assert.ok(busy !== undefined, 'the panel says that it is busy')
  const cancel = busy.props.children.find(child => child?.props?.className === 'iwb-textbtn iwb-small')
  assert.ok(cancel !== undefined, 'the busy bar can be stopped')

  cancel.props.onClick()
  const stops = store.calls.filter(call => call.name === 'cancelPaste')
  assert.equal(stops.length, 1, 'the paste is stopped')
})

test('the paste of the tree carries the entries of the CLIPBOARD, not of the selection', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = withClipboard(baseState())
  // The clipboard holds the file at the root; the selection is the FOLDER
  // the paste lands in. The two are not the same list - and the guard that
  // refuses a folder pasted into itself must look at the clipboard.
  state.clipboard = { paths: [OTHER], cut: false }
  state.selectedPath = SRC
  state.selectedPaths = new Set([SRC])
  const store = baseStore(state)
  const { elements } = renderPanel(store, state)

  treeBodyOf(elements).props.onKeyDown(keyEvent('v', { ctrlKey: true }))

  const pastes = store.calls.filter(call => call.name === 'pasteEntries')
  assert.equal(pastes.length, 1)
  assert.equal(pastes[0].args[0], SRC, 'the paste lands in the selected folder')
  const options = pastes[0].args[1]
  assert.ok(Array.isArray(options.entries), 'the entries travel with the paste')
  // The CLIPBOARD, not the selection: the folder that receives the paste is
  // not one of the copied entries.
  assert.equal(options.entries.length, 1)
  assert.equal(options.entries[0].path, OTHER)
  assert.equal(options.entries[0].isDir, false, 'the copied entry is a file')
})
