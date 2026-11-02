/**
 * Find Usages: the semantic entry and its always-available text fallback
 * (PRD-v5 §5.2, §5.3, §6.4, §7.1).
 *
 * The semantic entry lives in the editor's context menu, which the plugin
 * owns. What this file pins down is the contract that menu is built on: the
 * availability the editor reads, the wording it shows, the text fallback and
 * the label every text hit carries.
 *
 * The text search itself is the engine of the IDE workbench: the plugin
 * asks for it through the contract (`contract.host.searchFiles`), so the
 * plugin never reads a file of the project on its own.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { CodeIntelStore } from '../src/client/store.js'
import { DEFAULT_SETTINGS } from '../src/host/settings-store.js'
import { matchesShortcut } from '../src/client/util.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The bundle touches browser globals at import time; the usages flow itself
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
  value: { clipboard: { writeText: async () => {}, readText: async () => '' } },
})
globalThis.ResizeObserver = class { observe() {} disconnect() {} }

let modulePromise

async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    // The bundle must live inside the package so Node resolves react and
    // react-dom from this package's node_modules (externalized below).
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'find-usages-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
export { SearchPopup } from './src/client/SearchPopup.jsx'
export { navLabels } from './src/client/lsp-session.js'
`,
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'find-usages-entry.jsx',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: ['node20'],
      external: ['react', 'react-dom', 'react-dom/server', '@deepseek-ai/dsh-client-ui-primitives'],
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

/**
 * The search engine of the IDE workbench, as the contract delivers it.
 *
 * The plugin asks the core for the hits; the stub answers with two hits of
 * one file and records every call.
 * @returns {{calls: any[], searchFiles: Function}} the stub
 */
function engineStub() {
  const calls = []
  const searchFiles = async (options) => {
    calls.push(options)
    return {
      files: [{
        path: 'src/a.ts',
        matches: [
          { line: 3, column: 7, preview: 'const needle = 1' },
          { line: 9, column: 3, preview: 'needle()' },
        ],
      }],
      truncated: false,
      tookMs: 8,
    }
  }
  return { calls, searchFiles }
}

/**
 * A store of the plugin with a contract.
 * @param {{searchFiles?: Function}} [options] the engine of the contract
 * @returns {any} the store
 */
function fakeStore(options = {}) {
  const store = new CodeIntelStore({ t: key => key })
  store.state = {
    ...store.state,
    root: 'C:\\work\\demo',
    settings: {
      shortcuts: { ...DEFAULT_SETTINGS.shortcuts },
      lsp: { enabled: true, indexOnOpen: 'ask', indexedRoots: {} },
    },
  }
  store.contract = {
    host: {
      getProjectRoot: () => 'C:\\work\\demo',
      searchFiles: options.searchFiles ?? (async () => ({ files: [] })),
    },
  }
  return store
}

// ── the semantic entry (PRD-v5 §7.1) ──────────────────────────────────────

test('the semantic Find Usages entry is greyed out while no server runs', () => {
  const store = fakeStore()
  store.state.lsp = { ...store.state.lsp, enabled: true, state: 'idle' }
  const navigation = store.semanticNavigation()
  // The entry is disabled, not hidden, and it says why.
  assert.equal(navigation.findUsages.enabled, false)
  assert.equal(navigation.findUsages.reason, 'nav.semanticUnavailable')
  // The text entry stays available in every state.
  assert.equal(navigation.findUsagesText.enabled, true)
})

test('the semantic Find Usages entry is enabled once the server is ready', () => {
  const store = fakeStore()
  store.state.lsp = { ...store.state.lsp, enabled: true, state: 'ready' }
  const navigation = store.semanticNavigation()
  assert.equal(navigation.findUsages.enabled, true)
  assert.equal(navigation.findUsages.reason, '')
  assert.equal(navigation.findUsagesText.enabled, true)
})

test('a disabled semantic analysis keeps the text entry available', () => {
  const store = fakeStore()
  store.state.lsp = { ...store.state.lsp, enabled: false, state: 'disabled' }
  const navigation = store.semanticNavigation()
  assert.equal(navigation.findUsages.enabled, false)
  assert.equal(navigation.findUsagesText.enabled, true)
})

test('the editor navigation menu carries the semantic and the text wording', async () => {
  const mod = await loadModule()
  const labels = mod.navLabels()
  assert.equal(labels.goToDefinition, 'nav.goToDefinition')
  assert.equal(labels.findUsages, 'nav.findUsages')
  assert.equal(labels.findUsagesText, 'nav.findUsagesText')
  // The reason why the semantic entries are greyed out belongs to the state
  // of the client session - one of the four texts of the plugin.
  assert.ok([
    'nav.semanticUnavailable',
    'nav.semanticSessionUnavailable',
    'nav.semanticSessionConnecting',
    'nav.semanticSessionIdle',
  ].includes(labels.semanticUnavailable), `the reason is one of the four: ${labels.semanticUnavailable}`)
})

// ── the text entry (PRD-v5 §5.3) ──────────────────────────────────────────

test('the text version of Find Usages always works and searches the whole word', async () => {
  const engine = engineStub()
  const store = fakeStore({ searchFiles: engine.searchFiles })
  await store.findUsagesText('needle')
  // The results live in the popup, not in a tab: a search must not take a
  // tab away from the code (FIND-01).
  assert.equal(store.state.searchPopup.open, true)
  // The search slice describes a text match.
  assert.equal(store.state.search.query, 'needle')
  assert.equal(store.state.search.wholeWord, true)
  assert.equal(store.state.search.caseSensitive, false)
  assert.equal(store.state.search.regexp, false)
  assert.equal(store.state.search.textMatch, true)
  // The engine of the core was asked for exactly that.
  assert.equal(engine.calls.length, 1)
  assert.equal(engine.calls[0].query, 'needle')
  assert.equal(engine.calls[0].wholeWord, true)
  assert.equal(engine.calls[0].caseSensitive, false)
  assert.equal(engine.calls[0].regexp, false)
  assert.equal(store.state.search.results.length, 1)
})

test('a plain Find in Files run is not labelled as a text match', async () => {
  const engine = engineStub()
  const store = fakeStore({ searchFiles: engine.searchFiles })
  await store.runSearch('needle')
  assert.equal(store.state.search.textMatch, false)
})

test('every text-match hit carries the "text match" label', async () => {
  const mod = await loadModule()
  const store = fakeStore()
  store.state.search = {
    ...store.state.search,
    query: 'needle',
    textMatch: true,
    loading: false,
    results: [{
      path: 'src/a.ts',
      matches: [
        { line: 3, column: 7, preview: 'const needle = 1' },
        { line: 9, column: 3, preview: 'needle()' },
      ],
    }],
  }
  store.state.searchPopup = { open: true, index: 0, generation: 1 }
  const html = renderToStaticMarkup(React.createElement(mod.SearchPopup, { store, state: store.state }))
  // The banner of the popup...
  assert.match(html, /iwb-search-textmatch/)
  // ...and the wording of the label.
  assert.match(html, /nav\.textMatch/)
})

test('the usages popup counts its hits with the usages wording', async () => {
  const mod = await loadModule()
  const store = fakeStore()
  store.state.search = {
    ...store.state.search,
    query: 'needle',
    textMatch: true,
    loading: false,
    results: [{ path: 'src/a.ts', matches: [{ line: 3, column: 7, preview: 'const needle = 1' }] }],
  }
  store.state.searchPopup = { open: true, index: 0, generation: 1 }
  const html = renderToStaticMarkup(React.createElement(mod.SearchPopup, { store, state: store.state }))
  assert.match(html, /nav\.usagesCount|nav\.noUsages/)
})

// ── the keys (PRD-v5 §6.4) ───────────────────────────────────────────────

test('the navigation shortcuts match the documented defaults', () => {
  assert.equal(DEFAULT_SETTINGS.shortcuts.findUsages, 'Alt+F7')
  assert.equal(DEFAULT_SETTINGS.shortcuts.findUsagesText, 'Alt+F8')
  assert.equal(DEFAULT_SETTINGS.shortcuts.goToDefinition, 'F12')
  assert.equal(DEFAULT_SETTINGS.shortcuts.complete, 'Ctrl+Space')
})

test('the navigation shortcuts match their key events', () => {
  const shortcuts = DEFAULT_SETTINGS.shortcuts
  assert.equal(matchesShortcut(shortcuts.findUsages, { key: 'F7', altKey: true }), true)
  assert.equal(matchesShortcut(shortcuts.findUsagesText, { key: 'F8', altKey: true }), true)
  assert.equal(matchesShortcut(shortcuts.goToDefinition, { key: 'F12' }), true)
  assert.equal(matchesShortcut(shortcuts.complete, { key: ' ', ctrlKey: true }), true)
  // The semantic key does not trigger the text one, and the other way round.
  assert.equal(matchesShortcut(shortcuts.findUsages, { key: 'F8', altKey: true }), false)
  assert.equal(matchesShortcut(shortcuts.findUsagesText, { key: 'F7', altKey: true }), false)
})
