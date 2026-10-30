import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, rm, readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// A tiny DOM surface is enough for module-level browser references; SSR itself
// does not touch it because no effects run.
globalThis.window = {
  innerWidth: 1440,
  innerHeight: 900,
  location: { href: 'http://localhost/' },
  addEventListener() {},
  removeEventListener() {},
}
globalThis.self = globalThis.window
globalThis.HTMLElement = class HTMLElement {}
globalThis.Element = class Element {}
const elementStub = () => ({
  style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false },
  setAttribute() {}, removeAttribute() {}, remove() {}, appendChild() {}, insertBefore() {},
  addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
  querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  getContext: () => null,
})
globalThis.document = {
  baseURI: 'http://localhost/',
  documentElement: { ...elementStub(), style: {} },
  head: { appendChild() {} },
  body: { style: {}, appendChild() {}, removeChild() {} },
  createElement: elementStub,
  createElementNS: elementStub,
  createTextNode: () => ({ style: {}, remove() {} }),
  createRange: () => ({ setStart() {}, setEnd() {}, getBoundingClientRect: () => ({ top: 0, left: 0 }), getClientRects: () => [] }),
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener() {},
  removeEventListener() {},
}
globalThis.window.getComputedStyle = () => ({ getPropertyValue: () => '', fontSize: '13px' })
globalThis.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
globalThis.window.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0)
globalThis.window.cancelAnimationFrame = (handle) => clearTimeout(handle)
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { clipboard: { writeText: async () => {}, readText: async () => '' } },
})
globalThis.ResizeObserver = class { observe() {} disconnect() {} }

const ENTRY = `
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkbenchStore } from './src/client/store.js'
import { EditorArea, selectEditorSlice } from './src/client/EditorArea.jsx'
import { SearchView, searchSlice } from './src/client/SearchView.jsx'
import { DiffView, diffSlice } from './src/client/DiffView.jsx'
import { FindBar } from './src/client/FindBar.jsx'
import { shallowEqual } from './src/client/hooks.js'

export { selectEditorSlice, shallowEqual, FindBar, searchSlice, diffSlice }

const t = key => key

/* A state prop that throws on any read: a migrated panel must never touch it. */
function throwingState() {
  return new Proxy({}, {
    get(_target, property) {
      throw new Error('the state prop must not be read: ' + String(property))
    },
  })
}

export function createStore(overrides = {}) {
  const ctx = {
    locale: { subscribe: () => () => {}, bind: () => t },
    layout: { selectPanel: () => {} },
  }
  const store = new WorkbenchStore(ctx, t)
  store.state = {
    ...store.state,
    phase: 'ready',
    active: true,
    workspaceRoot: 'C:/work/demo',
    root: 'C:/work/demo',
    projects: [{ path: 'C:/work/demo', name: 'demo', isRoot: true, isRepo: true }],
    workspaces: [],
    status: { isRepo: true, branch: 'main', detached: false, entries: [] },
    settings: { shortcuts: { project: 'Alt+1', commit: 'Alt+0' }, editor: { fontSize: 13 } },
    layout: { left: null, leftWidth: 300, bottom: null, bottomHeight: 200 },
    ...overrides,
  }
  return store
}

export function fileTab(overrides = {}) {
  return {
    id: 'file:C:/work/demo/src/main.ts',
    kind: 'file',
    path: 'C:/work/demo/src/main.ts',
    rel: 'src/main.ts',
    name: 'main.ts',
    preview: false,
    pinned: true,
    loading: false,
    error: null,
    payload: { kind: 'text', content: 'const a = 1\\n', encoding: 'utf-8', size: 12, truncated: false },
    scrollTop: 0,
    ...overrides,
  }
}

export function diffTab(overrides = {}) {
  return {
    id: 'diff:worktree:a.ts',
    kind: 'diff',
    path: 'C:/work/demo/a.ts',
    rel: 'a.ts',
    name: 'a.ts',
    staged: false,
    untracked: false,
    preview: false,
    pinned: true,
    loading: false,
    error: null,
    payload: {
      untracked: false,
      diff: 'diff --git a/a.ts b/a.ts\\nindex 1111111..2222222 100644\\n--- a/a.ts\\n+++ b/a.ts\\n@@ -1,2 +1,3 @@\\n const a = 1\\n-const b = 2\\n+const b = 3\\n+const c = 4\\n',
    },
    mode: 'side',
    scrollTop: 0,
    ...overrides,
  }
}

export function renderEditor(store) {
  return renderToStaticMarkup(React.createElement(EditorArea, { store }))
}

export function renderEditorWithoutState(store) {
  return renderToStaticMarkup(React.createElement(EditorArea, { store, state: throwingState() }))
}

export function renderSearchView(store) {
  return renderToStaticMarkup(React.createElement(SearchView, { store, state: throwingState() }))
}

export function renderDiffView(store, tab) {
  return renderToStaticMarkup(React.createElement(DiffView, { store, state: throwingState(), tab }))
}

export function renderFindBar() {
  const editor = { find: () => ({ total: 0, active: -1, error: null }), clear: () => {} }
  return renderToStaticMarkup(React.createElement(FindBar, {
    store: { t }, editor, readOnly: true, onClose: () => {},
  }))
}
`

let modulePromise

async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    // The bundle must live inside the package so Node resolves react and
    // react-dom from this package's node_modules (externalized below).
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'perf-slice-editor-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: { contents: ENTRY, resolveDir: root, loader: 'jsx', sourcefile: 'perf-slice-editor-entry.jsx' },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: ['node20'],
      external: ['react', 'react-dom', 'react-dom/server', '@deepseek-ai/dsh-client-ui-primitives'],
      alias: {
        '@xterm/xterm/css/xterm.css': join(root, 'node_modules/@xterm/xterm/css/xterm.css'),
        '@xterm/xterm': join(root, 'tests/stubs/xterm.js'),
        '@xterm/addon-fit': join(root, 'tests/stubs/addon-fit.js'),
      },
      loader: { '.css': 'text' },
      jsx: 'transform',
      define: { 'process.env.NODE_ENV': '"production"' },
      outfile,
      logLevel: 'silent',
    })
    const imported = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
    return imported
  })()
  return modulePromise
}

test('the editor slice exposes exactly the fields the panel reads', async () => {
  const mod = await loadModule()
  const store = mod.createStore()
  const slice = mod.selectEditorSlice(store.state)
  assert.deepEqual(Object.keys(slice).sort(), [
    'activeId', 'confirm', 'fontSize', 'projects', 'root', 'shortcuts', 'status', 'tabs',
  ])
  assert.equal(slice.tabs, store.state.tabs)
  assert.equal(slice.activeId, store.state.activeId)
  assert.equal(slice.fontSize, 13)
  assert.equal(slice.shortcuts, store.state.settings.shortcuts)
  assert.equal(slice.root, store.state.root)
  assert.equal(slice.projects, store.state.projects)
  assert.equal(slice.confirm, null)
  // Without an open tab the welcome screen is on screen, so it reads the
  // git status.
  assert.equal(slice.status, store.state.status)
})

test('a change inside the slice re-renders the editor, a change outside does not', async () => {
  const mod = await loadModule()
  const store = mod.createStore()
  const tab = mod.fileTab()
  const withTab = { ...store.state, tabs: [tab], activeId: tab.id }
  const before = mod.selectEditorSlice(withTab)

  // Outside the slice: a toast, a terminal chunk, a commit-panel write, a
  // git status poll, a search update, a tree load - none of them is read by
  // the editor.
  const outside = [
    { ...withTab, toast: { kind: 'info', text: 'saved' } },
    { ...withTab, terminal: { ...withTab.terminal, sessions: [{ id: 't1' }] } },
    { ...withTab, commit: { ...withTab.commit, checked: new Set(['a.ts']) } },
    { ...withTab, status: { ...withTab.status, branch: 'other' } },
    { ...withTab, search: { ...withTab.search, results: [{ path: 'a.ts', matches: [] }] } },
    { ...withTab, dirs: new Map([['C:/work/demo', { loading: false, entries: [] }]]) },
  ]
  for (const state of outside) {
    assert.equal(mod.shallowEqual(before, mod.selectEditorSlice(state)), true)
  }

  // Inside the slice: the tabs and the active tab are the editor's own data.
  const inside = [
    { ...withTab, tabs: [...withTab.tabs, mod.fileTab({ id: 'file:C:/work/demo/a.ts' })] },
    { ...withTab, activeId: 'file:C:/work/demo/a.ts' },
  ]
  for (const state of inside) {
    assert.equal(mod.shallowEqual(before, mod.selectEditorSlice(state)), false)
  }
})

test('the git status only reaches the editor while the welcome screen is up', async () => {
  const mod = await loadModule()
  const store = mod.createStore()
  const welcome = mod.selectEditorSlice(store.state)
  const polled = mod.selectEditorSlice({ ...store.state, status: { ...store.state.status, branch: 'other' } })
  assert.equal(mod.shallowEqual(welcome, polled), false)

  const tab = mod.fileTab()
  const withTab = { ...store.state, tabs: [tab], activeId: tab.id }
  const reading = mod.selectEditorSlice(withTab)
  const stillReading = mod.selectEditorSlice({ ...withTab, status: { ...withTab.status, branch: 'other' } })
  assert.equal(mod.shallowEqual(reading, stillReading), true)
})

test('the migrated panels are memo-wrapped and rendered without a state prop', async () => {
  const source = await readFile(join(root, 'src/client/Workbench.jsx'), 'utf8')
  // Every panel that subscribes to its own slice is memo-wrapped and gets
  // the store only; the whole snapshot is no longer pushed into them.
  for (const panel of ['EditorArea', 'ProjectPanel', 'CommitPanel', 'GitPanel', 'TerminalPanel']) {
    assert.match(source, new RegExp(`React\\.memo\\(${panel}\\)`))
  }
  assert.match(source, /React\.createElement\(MemoEditorArea, \{ store \}\)/)
  assert.match(source, /React\.createElement\(MemoProjectPanel, \{ store \}\)/)
  assert.match(source, /React\.createElement\(MemoCommitPanel, \{ store \}\)/)
  assert.match(source, /React\.createElement\(MemoGitPanel, \{ store \}\)/)
  assert.match(source, /React\.createElement\(MemoTerminalPanel, \{ store, visible:/)
  // The panels must not receive the whole state any more.
  assert.doesNotMatch(source, /React\.createElement\((EditorArea|ProjectPanel|CommitPanel|GitPanel|TerminalPanel), \{ store, state/)
})

test('the editor still renders the tab bar, the breadcrumb and the toolbar', async () => {
  const mod = await loadModule()
  const store = mod.createStore()
  const tab = mod.fileTab({ rel: 'src/components/Button.tsx', path: 'C:/work/demo/src/components/Button.tsx', name: 'Button.tsx' })
  store.state.tabs = [tab]
  store.state.activeId = tab.id
  const html = mod.renderEditor(store)
  assert.match(html, /iwb-tabbar/)
  assert.match(html, /iwb-breadcrumb/)
  // Three segments: the middle one is marked so a narrow pane can collapse it.
  assert.match(html, /iwb-crumb-mid/)
  assert.match(html, /iwb-crumb-more/)
  assert.match(html, /Button\.tsx/)
})

test('the editor still renders the conflict modal', async () => {
  const mod = await loadModule()
  const store = mod.createStore()
  const tab = mod.fileTab({ conflict: { at: 1700000000000, message: 'editor.conflictBody' } })
  store.state.tabs = [tab]
  store.state.activeId = tab.id
  const html = mod.renderEditor(store)
  assert.match(html, /iwb-editor-scoped-backdrop/)
  assert.doesNotMatch(html, /iwb-conflict-chip/)
  assert.match(html, /editor\.reloadFromDisk/)
  assert.match(html, /editor\.overwriteDisk/)
})

test('the find bar still renders', async () => {
  const mod = await loadModule()
  const html = mod.renderFindBar()
  assert.match(html, /iwb-findbar/)
  assert.match(html, /iwb-find-input/)
  const source = await readFile(join(root, 'src/client/EditorArea.jsx'), 'utf8')
  assert.match(source, /React\.createElement\(FindBar/)
})

test('the migrated views never read a state prop', async () => {
  const mod = await loadModule()
  const store = mod.createStore()
  // A state prop that throws on any read: a migrated view must not touch it.
  const editorHtml = mod.renderEditorWithoutState(store)
  assert.match(editorHtml, /iwb-editor/)

  const searchHtml = mod.renderSearchView(store)
  assert.match(searchHtml, /iwb-search/)

  const diffHtml = mod.renderDiffView(store, mod.diffTab())
  assert.match(diffHtml, /iwb-diff/)
})

test('the search and diff views have their own slices', async () => {
  const mod = await loadModule()
  const store = mod.createStore()
  assert.deepEqual(Object.keys(mod.searchSlice(store.state)), ['search'])
  assert.deepEqual(Object.keys(mod.diffSlice(store.state)), ['commitMode'])
  assert.equal(mod.searchSlice(store.state).search, store.state.search)
  assert.equal(mod.diffSlice(store.state).commitMode, store.state.commit.mode)

  const searchSource = await readFile(join(root, 'src/client/SearchView.jsx'), 'utf8')
  assert.match(searchSource, /useStoreSlice\(store, searchSlice, shallowEqual\)/)
  assert.match(searchSource, /export function SearchView\(\{ store \}\)/)
  // The selector is the only reader of the snapshot (`store.state` reads are
  // always fresh and do not count).
  assert.equal((searchSource.match(/(?<!store\.)state\./g) ?? []).length, 1)
  const diffSource = await readFile(join(root, 'src/client/DiffView.jsx'), 'utf8')
  assert.match(diffSource, /useStoreSlice\(store, diffSlice, shallowEqual\)/)
  assert.match(diffSource, /export function DiffView\(\{ store, tab \}\)/)
  assert.equal((diffSource.match(/(?<!store\.)state\./g) ?? []).length, 1)

  // The editor hands them the store only - no synthesized state object.
  const editorSource = await readFile(join(root, 'src/client/EditorArea.jsx'), 'utf8')
  assert.match(editorSource, /React\.createElement\(SearchView, \{ store \}\)/)
  assert.match(editorSource, /React\.createElement\(DiffView, \{ store, tab: active \}\)/)
  assert.doesNotMatch(editorSource, /searchState|diffState/)
})
