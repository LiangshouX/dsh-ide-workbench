import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
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
import { Workbench } from './src/client/Workbench.jsx'
import { EditorArea, buildConflictDialog } from './src/client/EditorArea.jsx'

const t = key => key

function baseStore() {
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
    workspaces: [{ id: 'w1', path: 'C:/work/demo', title: 'demo', updatedAt: '2026-10-21T00:00:00Z' }],
    status: { isRepo: false, branch: undefined, entries: [] },
    terminal: { sessions: [], shells: [] },
    git: { ...store.state.git, error: 'fatal: not a git repository', loading: false, commits: [] },
    settings: { ...(store.state.settings ?? {}), shortcuts: {}, editor: { fontSize: 13 } },
  }
  return store
}

export function createConflictFixture() {
  const store = baseStore()
  const tab = {
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
    editing: true,
    dirty: true,
    draft: 'const a = 1\\n',
    conflict: { at: 1700000000000, message: 'editor.conflictBody' },
  }
  store.state.tabs = [tab]
  store.state.activeId = tab.id
  // The Terminal/Git dock is open, so the layout is exercised too.
  store.state.layout = { left: null, leftWidth: 300, bottom: 'git', bottomHeight: 200 }
  // The Git window works against its own repository (GIT-01).
  store.state.gitRepoRoot = 'C:/work/demo/repo-a'
  store.state.gitRepos = [{ path: 'C:/work/demo/repo-a', name: 'repo-a' }]
  const calls = []
  store.reloadTab = id => { calls.push({ kind: 'reload', id }) }
  store.saveTab = (id, options) => { calls.push({ kind: 'save', id, options }) }
  return { store, state: store.state, tab, calls }
}

export function renderEditor(fixture) {
  return renderToStaticMarkup(React.createElement(EditorArea, { store: fixture.store, state: fixture.state }))
}

export function renderWorkbench(fixture) {
  return renderToStaticMarkup(React.createElement(Workbench, { store: fixture.store }))
}

export { buildConflictDialog }
`

let modulePromise

async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    // The bundle must live inside the package so Node resolves react and
    // react-dom from this package's node_modules (externalized below).
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'editor-conflict-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: { contents: ENTRY, resolveDir: root, loader: 'jsx', sourcefile: 'editor-conflict-entry.jsx' },
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

/** The index just after the closing tag of the element with this class. */
function elementEnd(html, className) {
  const marker = `class="${className}"`
  const index = html.indexOf(marker)
  if (index === -1) return -1
  let depth = 1
  let cursor = html.indexOf('>', index) + 1
  while (depth > 0 && cursor < html.length) {
    const nextOpen = html.indexOf('<div', cursor)
    const nextClose = html.indexOf('</div>', cursor)
    if (nextClose === -1) return html.length
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1
      cursor = nextOpen + 4
      continue
    }
    depth -= 1
    cursor = nextClose + 6
  }
  return cursor
}

test('an external change renders a centered modal, not the toolbar chip', async () => {
  const mod = await loadModule()
  const fixture = mod.createConflictFixture()
  const html = mod.renderEditor(fixture)
  assert.match(html, /iwb-editor-scoped-backdrop/)
  assert.doesNotMatch(html, /iwb-conflict-chip/)
  // The dialog lives inside the document pane, so it centers on the document
  // window instead of the whole workbench root.
  const editorStart = html.indexOf('class="iwb-editor"')
  const modal = html.indexOf('iwb-editor-scoped-backdrop')
  assert.ok(editorStart >= 0 && modal > editorStart)
  assert.ok(modal < elementEnd(html, 'iwb-editor'))
})

test('the conflict modal offers both actions', async () => {
  const mod = await loadModule()
  const fixture = mod.createConflictFixture()
  const html = mod.renderEditor(fixture)
  assert.match(html, /editor\.reloadFromDisk/)
  assert.match(html, /editor\.overwriteDisk/)

  const dialog = mod.buildConflictDialog(fixture.store, fixture.tab)
  assert.equal(dialog.title, 'editor.conflictTitle')
  const reload = dialog.actions.find(action => action.key === 'reload')
  const overwrite = dialog.actions.find(action => action.key === 'overwrite')
  assert.ok(reload !== undefined && overwrite !== undefined)
  reload.action()
  overwrite.action()
  assert.deepEqual(fixture.calls, [
    { kind: 'reload', id: fixture.tab.id },
    { kind: 'save', id: fixture.tab.id, options: { force: true } },
  ])
})

test('a tab without a conflict renders no dialog', async () => {
  const mod = await loadModule()
  const fixture = mod.createConflictFixture()
  fixture.tab.conflict = null
  const html = mod.renderEditor(fixture)
  assert.doesNotMatch(html, /iwb-editor-scoped-backdrop/)
  assert.equal(mod.buildConflictDialog(fixture.store, fixture.tab), null)
})

test('the Terminal/Git dock spans the whole workbench width', async () => {
  const mod = await loadModule()
  const fixture = mod.createConflictFixture()
  const html = mod.renderWorkbench(fixture)
  const centerEnd = elementEnd(html, 'iwb-center')
  const dock = html.indexOf('class="iwb-bottom')
  assert.ok(centerEnd > 0 && dock > centerEnd)
  // The dock sits above the status bar and below the body.
  assert.ok(dock > html.indexOf('class="iwb-body"'))
  assert.ok(dock < html.indexOf('class="iwb-statusbar"'))
})

test('the breadcrumb keeps one line and marks the collapsible middle', async () => {
  const mod = await loadModule()
  const fixture = mod.createConflictFixture()
  fixture.tab.rel = 'src/components/Button.tsx'
  fixture.tab.path = 'C:/work/demo/src/components/Button.tsx'
  fixture.tab.name = 'Button.tsx'
  const html = mod.renderEditor(fixture)
  const start = html.indexOf('class="iwb-breadcrumb"')
  const crumb = html.slice(start, html.indexOf('</div>', start))
  // The middle segment is marked so a narrow pane can collapse it, one
  // ellipsis takes its place and the file name always stays visible.
  assert.match(crumb, /class="iwb-crumb-mid">components</)
  assert.equal((crumb.match(/iwb-crumb-more/g) ?? []).length, 1)
  assert.match(crumb, /<b>Button\.tsx<\/b>/)
  // The full path stays in the title for the hover.
  assert.match(crumb, /title="C:\/work\/demo\/src\/components\/Button\.tsx"/)
})

test('a short path has no ellipsis and no duplicate separator', async () => {
  const mod = await loadModule()
  const fixture = mod.createConflictFixture()
  fixture.tab.rel = 'src/main.ts'
  fixture.tab.path = 'C:/work/demo/src/main.ts'
  fixture.tab.name = 'main.ts'
  const html = mod.renderEditor(fixture)
  const start = html.indexOf('class="iwb-breadcrumb"')
  const crumb = html.slice(start, html.indexOf('</div>', start))
  assert.doesNotMatch(crumb, /iwb-crumb-more/)
  assert.equal((crumb.match(/iwb-sep/g) ?? []).length, 1)
})

test('the dock header offers the Git repository picker', async () => {
  const mod = await loadModule()
  const fixture = mod.createConflictFixture()
  const html = mod.renderWorkbench(fixture)
  assert.match(html, /iwb-branch-switch/)
  assert.match(html, /repo-a/)
  // The picker belongs to the Git window, so it is disabled for other tools.
  const button = html.slice(html.indexOf('iwb-branch-switch'), html.indexOf('iwb-branch-switch') + 220)
  assert.doesNotMatch(button, /disabled/)
})

test('the repository picker is disabled while the Git window is not active', async () => {
  const mod = await loadModule()
  const fixture = mod.createConflictFixture()
  fixture.state.layout = { ...fixture.state.layout, bottom: 'terminal' }
  const html = mod.renderWorkbench(fixture)
  const button = html.slice(html.indexOf('iwb-branch-switch'), html.indexOf('iwb-branch-switch') + 220)
  assert.match(button, /disabled/)
})
