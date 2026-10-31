/**
 * The Find in Files popup (PRD-v5 supplement, FIND-01 / FIND-02).
 *
 * The results used to live in a tab of the editor area. The popup floats
 * above the editor instead, so a search never takes a tab away from the code
 * the user is working on.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { WorkbenchStore } from '../src/client/store.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The bundle touches browser globals at import time; the popup flow itself
// never reads the DOM.
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
  value: { clipboard: { writeText: async () => {}, readText: () => '' } },
})
globalThis.ResizeObserver = class { observe() {} disconnect() {} }

let modulePromise

async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'search-popup-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
export { Workbench } from './src/client/Workbench.jsx'
export { SearchPopup } from './src/client/SearchPopup.jsx'
`,
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'search-popup-entry.jsx',
      },
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

const ROOT = 'C:\\work\\demo'

/**
 * One host stub: every plugin route answers with a fixture, and the calls are
 * recorded so the test can see which route was asked.
 */
function hostStub() {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/').pop()
    const body = init?.body === undefined ? {} : JSON.parse(init.body)
    calls.push({ method, body })
    let value = {}
    if (method === 'fs.search') {
      value = {
        files: [
          {
            path: 'src/app.ts',
            matches: [
              { line: 11, column: 3, preview: 'const needle = 1', before: ['// a', 'const b = 2'], after: ['console.log(needle)'] },
              { line: 47, column: 9, preview: 'return needle', before: [], after: [] },
            ],
          },
          {
            path: 'src/other.ts',
            matches: [{ line: 6, column: 1, preview: 'import { needle } from "./app"', before: [], after: [] }],
          },
        ],
        truncated: false,
        tookMs: 12,
      }
    } else if (method === 'lsp.resources') {
      value = { totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3, thresholdBytes: 384 * 1024 * 1024, canIndex: true }
    } else if (method === 'lsp.status') {
      value = { enabled: true, state: 'idle', languageId: '', indexedRoots: [] }
    } else if (method === 'lsp.servers') value = { available: [], missing: [] }
    else if (method === 'workspace.projects') value = { workspace: body.root, projects: [] }
    else if (method === 'git.status') value = { isRepo: false, entries: [], detached: false }
    else if (method === 'git.log') value = { commits: [], hasMore: false }
    else if (method === 'fs.tree') value = { entries: [], truncated: false }
    else value = { shells: [], names: [], messages: [] }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  return {
    calls,
    methods: () => calls.map(call => call.method),
    restore() { globalThis.fetch = original },
  }
}

/** A store with one workspace root. */
function fakeStore() {
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new WorkbenchStore(ctx, key => key)
  store.state = {
    ...store.state,
    workspaceRoot: ROOT,
    root: ROOT,
    phase: 'ready',
    settings: { editor: { openMode: 'auto' }, shortcuts: {}, lsp: { enabled: true, indexOnOpen: 'ask' } },
    projects: [],
  }
  return store
}

/** Let the pending promise chain of the store settle. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

/** Release the timers a test may have armed. */
function cleanup(store) {
  if (store.toastTimer !== null) clearTimeout(store.toastTimer)
  store.persist.cancel()
}

// ── the store flow ─────────────────────────────────────────────────────────

test('the search opens a popup and never takes a tab away', async () => {
  const host = hostStub()
  const store = fakeStore()
  try {
    store.openSearchPopup('needle')
    await flush()
    assert.equal(store.state.searchPopup.open, true)
    assert.equal(store.state.tabs.length, 0, 'a search must not open a tab')
    assert.equal(store.state.activeId, null)
    // The host was asked for the query.
    const search = host.calls.find(call => call.method === 'fs.search')
    assert.ok(search !== undefined)
    assert.equal(search.body.query, 'needle')
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('the hits of the popup are one flat list over the files', async () => {
  const host = hostStub()
  const store = fakeStore()
  try {
    store.openSearchPopup('needle')
    await flush()
    const hits = store.searchHits()
    assert.equal(hits.length, 3)
    assert.equal(hits[0].path, 'src/app.ts')
    assert.equal(hits[0].line, 11)
    assert.equal(hits[2].path, 'src/other.ts')
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('the popup selects a file, not a hit', async () => {
  const host = hostStub()
  const store = fakeStore()
  try {
    store.openSearchPopup('needle')
    await flush()
    // The upper half is a list of files: the selection walks the files.
    assert.equal(store.state.searchPopup.index, 0)
    assert.equal(store.selectedSearchFile().path, 'src/app.ts')
    store.moveSearchSelection(1)
    assert.equal(store.state.searchPopup.index, 1)
    assert.equal(store.selectedSearchFile().path, 'src/other.ts')
    // The selection wraps around.
    store.moveSearchSelection(1)
    assert.equal(store.state.searchPopup.index, 0)
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('a single click only selects the file, nothing is opened', async () => {
  const host = hostStub()
  const store = fakeStore()
  try {
    store.openSearchPopup('needle')
    await flush()
    store.moveSearchSelection(1)
    assert.equal(store.state.searchPopup.index, 1)
    assert.equal(store.state.tabs.length, 0, 'a preview must not open a file')
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('opening a hit closes the popup and opens the file', async () => {
  const host = hostStub()
  const store = fakeStore()
  try {
    store.openSearchPopup('needle')
    await flush()
    store.openSearchResult('src/app.ts', 47)
    assert.equal(store.state.searchPopup.open, false)
    const tab = store.state.tabs.find(item => item.rel === 'src/app.ts')
    assert.ok(tab !== undefined, 'the file was opened')
    assert.equal(tab.revealLine, 47, 'the cursor lands on the hit')
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('the popup can be closed without opening anything', async () => {
  const host = hostStub()
  const store = fakeStore()
  try {
    store.openSearchPopup('needle')
    await flush()
    store.closeSearchPopup()
    assert.equal(store.state.searchPopup.open, false)
    assert.equal(store.state.tabs.length, 0)
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('the text version of Find Usages uses the same popup', async () => {
  const host = hostStub()
  const store = fakeStore()
  try {
    await store.findUsagesText('needle')
    assert.equal(store.state.searchPopup.open, true)
    assert.equal(store.state.tabs.length, 0)
    assert.equal(store.state.search.textMatch, true)
  } finally {
    cleanup(store)
    host.restore()
  }
})

// ── the rendered popup ─────────────────────────────────────────────────────

test('the upper half lists the files, the lower half previews the selected one', async () => {
  const mod = await loadModule()
  const host = hostStub()
  const store = fakeStore()
  try {
    store.openSearchPopup('needle')
    await flush()
    const html = renderToStaticMarkup(React.createElement(mod.Workbench, { store }))
    assert.match(html, /iwb-search-popup/)
    // One row per file, with its match count.
    assert.match(html, /iwb-search-popup-file/)
    assert.match(html, /app\.ts/)
    assert.match(html, /other\.ts/)
    // The preview of the selected file shows the lines around the hit.
    assert.match(html, /iwb-search-popup-preview/)
    assert.match(html, /const b = 2/)
    assert.match(html, /const needle = 1/)
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('the file list does not repeat the hits under every file', async () => {
  const mod = await loadModule()
  const host = hostStub()
  const store = fakeStore()
  try {
    store.openSearchPopup('needle')
    await flush()
    const html = renderToStaticMarkup(React.createElement(mod.Workbench, { store }))
    const list = html.slice(html.indexOf('iwb-search-popup-list'), html.indexOf('iwb-search-popup-preview'))
    // The upper half carries the file names, not the matched lines.
    assert.match(list, /app\.ts/)
    assert.doesNotMatch(list, /const needle = 1/)
    assert.doesNotMatch(list, /import \{ needle \}/)
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('the popup floats above the modals', async () => {
  const source = await readFile(join(root, 'src/client/styles.js'), 'utf8')
  const quick = /\.iwb-quick-backdrop\s*\{[^}]*z-index:\s*(\d+)/.exec(source)
  const modal = /\.iwb-modal-backdrop\s*\{[^}]*z-index:\s*(\d+)/.exec(source)
  assert.ok(quick !== null, 'the Quick Open backdrop has a z-index')
  assert.ok(modal !== null, 'the modal backdrop has a z-index')
  assert.ok(
    Number(quick[1]) > Number(modal[1]),
    'the search popup has to be above every modal',
  )
})

test('the popup source opens the file on a double click only', async () => {
  const source = await readFile(join(root, 'src/client/SearchPopup.jsx'), 'utf8')
  assert.match(source, /onDoubleClick/, 'a double click opens the file')
  assert.match(source, /onClick: \(\) => store\.set\(\{ searchPopup/, 'a single click only selects')
})