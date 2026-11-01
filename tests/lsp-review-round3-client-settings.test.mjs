/**
 * The client side of the review round 3 (PRD-v5.1, round 3).
 *
 * Two things:
 *
 *   - R3: the rollback of a failed settings write put the WHOLE `lsp` section
 *     back. A change of another field in the same round trip (the settings
 *     page moved the budget share, say) was wiped with it - the store said
 *     0.25 while the user had just written 0.5. The rollback has to touch
 *     the maps of the failed write and nothing else.
 *   - R1 (client half): the host publishes `safeAvailableBytes` - the memory
 *     the machine has left when the running servers are charged with their
 *     CONFIRMED footprint (the share measured in the few seconds of the start
 *     window, without the increments of the later re-measurements). The
 *     pressure valve works with that number, the gate and the panel with the
 *     accounting one. The panel shows it when the two differ.
 *
 * The cases below were red before the fixes.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { WorkbenchStore } from '../src/client/store.js'
import { en } from '../src/client/i18n.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MB = 1024 * 1024

// The bundle touches browser globals at import time; the decisions themselves
// never read the DOM.
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

/** The bundled workbench (the JSX has to be compiled before it can run). */
async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'review-round3-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
export { memoryFacts, LspDiagnosticsModal } from './src/client/Workbench.jsx'
`,
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'review-round3-entry.jsx',
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
    return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
  })()
  return modulePromise
}

const ROOT = 'C:\\work\\demo'

/** Wait for the pending promises of the store. */
const tick = (ms = 10) => new Promise(resolve => { setTimeout(resolve, ms) })

/**
 * A store with one workspace root.
 * @param {any} lsp the `lsp` section of the settings, as it is
 * @returns {any} the store
 */
function fakeStore(lsp) {
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new WorkbenchStore(ctx, key => key)
  store.state = {
    ...store.state,
    workspaceRoot: ROOT,
    root: ROOT,
    phase: 'ready',
    settings: { editor: {}, shortcuts: {}, lsp },
    projects: [
      { path: ROOT, name: 'demo', isRoot: true, isRepo: false, indexState: 'unknown', indexedAt: null },
    ],
  }
  return store
}

/**
 * One host stub whose settings route refuses the write.
 * @param {any} store the store the stub belongs to
 * @returns {any} the stub
 */
function hostStub(store) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/').pop()
    const body = init?.body === undefined ? {} : JSON.parse(init.body)
    calls.push({ method, body })
    if (method === 'settings.update') {
      // The document of the profile cannot be written (a read-only profile, a
      // full disk, a host that is on its way down).
      return {
        ok: false,
        status: 500,
        async json() { return { ok: false, error: { code: 'io', message: 'the profile is read-only' } } },
      }
    }
    let value = {}
    if (method === 'lsp.shutdown') value = { ok: true }
    else if (method === 'lsp.start') value = { state: 'starting' }
    else value = { isRepo: false, entries: [], commits: [], shells: [], projects: [] }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  return { calls, restore() { globalThis.fetch = original } }
}

/**
 * Collect the warnings of the console while a test runs.
 * @returns {{warnings: string[], restore: () => void}} the collector
 */
function collectWarnings() {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => { warnings.push(args.map(arg => String(arg)).join(' ')) }
  return { warnings, restore() { console.warn = original } }
}

/**
 * A translator over the English dictionary.
 * @param {string} key the key of the text
 * @returns {string} the text
 */
function translator(key) {
  return typeof en[key] === 'string' ? en[key] : key
}

/**
 * The state the diagnostics panel reads.
 * @param {any} resources the memory snapshot of the host
 * @returns {any} the state
 */
function panelState(resources) {
  return {
    lsp: {
      state: 'ready',
      languageId: 'typescript',
      detail: '',
      servers: { missing: [] },
      stderrLines: [],
      consecutiveFailures: 0,
      consecutiveTimeouts: 0,
      lastFailure: null,
      resources,
    },
  }
}

// ── R3: the rollback touches the maps of the failed write and nothing else ──

test('a failed write does not wipe a change of another field', async (t) => {
  // The settings page moved the budget share while the write of the decision
  // was in flight. The rollback of the failed write must not touch it: the
  // user would see their own change disappear (review R3).
  const store = fakeStore({
    enabled: true,
    indexOnOpen: 'ask',
    budgetRatio: 0.25,
    workspaceDefaults: {},
    memoryWarnedRoots: { [ROOT]: 'conservative' },
  })
  const host = hostStub(store)
  const collected = collectWarnings()
  t.after(() => {
    store.persist.cancel()
    host.restore()
    collected.restore()
  })
  const pending = store.restartLsp()
  // Another field of the same section changes in the same round trip.
  store.set({
    settings: {
      ...store.state.settings,
      lsp: { ...store.state.settings.lsp, budgetRatio: 0.5 },
    },
  })
  await pending
  await tick(20)
  assert.equal(store.state.settings.lsp.budgetRatio, 0.5, 'the other change stays')
  assert.equal(store.state.settings.lsp.workspaceDefaults[ROOT], undefined, 'the decision is back')
  assert.equal(store.state.settings.lsp.memoryWarnedRoots[ROOT], 'conservative', 'the refusal is back')
  assert.ok(collected.warnings.length > 0, 'the failure is still written down')
})

test('a failed write removes a map that was not there before', async (t) => {
  // A document of an older profile has no `workspaceDefaults` at all. The
  // failed write must not leave an empty map behind: the map was not there
  // before, and the host does not know it either.
  const store = fakeStore({ enabled: true, indexOnOpen: 'ask', budgetRatio: 0.25 })
  const host = hostStub(store)
  t.after(() => {
    store.persist.cancel()
    host.restore()
  })
  await store.restartLsp()
  await tick(20)
  assert.equal(
    store.state.settings.lsp.workspaceDefaults,
    undefined,
    'the map that was not there before is gone again',
  )
  assert.equal(store.state.settings.lsp.budgetRatio, 0.25, 'the other fields stay')
})

test('a successful write keeps the decision', async (t) => {
  // The normal path is untouched.
  const store = fakeStore({
    enabled: true,
    indexOnOpen: 'ask',
    workspaceDefaults: {},
    memoryWarnedRoots: { [ROOT]: 'conservative' },
  })
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/').pop()
    const body = init?.body === undefined ? {} : JSON.parse(init.body)
    if (method === 'settings.update') {
      return { ok: true, status: 200, async json() { return { ok: true, value: { value: { lsp: body.patch?.lsp ?? {} } } } } }
    }
    const value = method === 'lsp.shutdown' ? { ok: true } : (method === 'lsp.start' ? { state: 'starting' } : {})
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  t.after(() => {
    store.persist.cancel()
    globalThis.fetch = original
  })
  await store.restartLsp()
  await tick(20)
  assert.equal(store.state.settings.lsp.workspaceDefaults[ROOT], 'build', 'the decision is kept')
  assert.notEqual(store.state.settings.lsp.memoryWarnedRoots[ROOT], 'conservative', 'the refusal is gone')
})

// ── R1 (client half): the pressure margin in the panel ─────────────────────

test('the snapshot is replaced when the pressure margin moves', async (t) => {
  // The margin is the free memory of the machine minus the confirmed
  // footprint of the running servers, so it falls while the available memory
  // stays the same. A field that is displayed and not watched would freeze
  // the row on the numbers of the first poll (the same defect as A3).
  const store = fakeStore({ enabled: true, indexOnOpen: 'ask', workspaceDefaults: {} })
  const snapshot = {
    availableBytes: 1206 * MB,
    safeAvailableBytes: 900 * MB,
    reservedBytes: 1614 * MB,
    measuredBytes: 434 * MB,
    worstCaseBytes: 4338 * MB,
    budgetUsedBytes: 2048 * MB,
    needMB: 651,
    canIndex: true,
    tight: false,
  }
  let current = snapshot
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/').pop()
    const value = method === 'lsp.status'
      ? { enabled: true, state: 'ready', languageId: 'typescript', indexedRoots: [], resources: current }
      : {}
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  t.after(() => {
    store.persist.cancel()
    globalThis.fetch = original
  })
  await store.refreshLspStatus()
  assert.equal(store.state.lsp.resources.safeAvailableBytes, 900 * MB)
  // The margin moves, everything else stays.
  current = { ...snapshot, safeAvailableBytes: 640 * MB }
  await store.refreshLspStatus()
  assert.equal(store.state.lsp.resources.safeAvailableBytes, 640 * MB, 'the margin moved')
})


test('the memory facts carry the pressure margin', async () => {
  const mod = await loadModule()
  const store = { t: translator }
  const facts = mod.memoryFacts(store, {
    availableBytes: 1206 * MB,
    safeAvailableBytes: 900 * MB,
    needMB: 651,
    reservedBytes: 0,
  })
  assert.equal(facts.availableMB, 1206, 'the accounting number')
  assert.equal(facts.safeAvailableMB, 900, 'the pressure margin')
})

test('the pressure margin is not shown when it is the same number', async () => {
  const mod = await loadModule()
  const store = { t: translator }
  const facts = mod.memoryFacts(store, {
    availableBytes: 1206 * MB,
    safeAvailableBytes: 1206 * MB,
    needMB: 651,
    reservedBytes: 0,
  })
  assert.equal(facts.safeAvailableMB, null, 'a row that says the same thing twice is noise')
})

test('the diagnostics panel shows the pressure margin', async () => {
  const mod = await loadModule()
  const store = { t: translator }
  const html = renderToStaticMarkup(React.createElement(mod.LspDiagnosticsModal, {
    store,
    state: panelState({
      availableBytes: 1206 * MB,
      safeAvailableBytes: 900 * MB,
      needMB: 651,
      reservedBytes: 0,
    }),
    onOpenSettings: () => {},
    onClose: () => {},
  }))
  assert.match(html, /Pressure margin/, 'the row has its label')
  assert.match(html, /900 MB/, 'and the number of the host')
})

test('the diagnostics panel says nothing about the pressure margin when it is the same', async () => {
  const mod = await loadModule()
  const store = { t: translator }
  const html = renderToStaticMarkup(React.createElement(mod.LspDiagnosticsModal, {
    store,
    state: panelState({
      availableBytes: 1206 * MB,
      safeAvailableBytes: 1206 * MB,
      needMB: 651,
      reservedBytes: 0,
    }),
    onOpenSettings: () => {},
    onClose: () => {},
  }))
  assert.doesNotMatch(html, /Pressure margin/, 'no row when the two numbers are the same')
})

test('the diagnostics panel says nothing about the pressure margin without the host number', async () => {
  const mod = await loadModule()
  const store = { t: translator }
  const html = renderToStaticMarkup(React.createElement(mod.LspDiagnosticsModal, {
    store,
    state: panelState({
      availableBytes: 1206 * MB,
      needMB: 651,
      reservedBytes: 0,
    }),
    onOpenSettings: () => {},
    onClose: () => {},
  }))
  assert.doesNotMatch(html, /Pressure margin/, 'a host that does not know the number gets no row')
})
