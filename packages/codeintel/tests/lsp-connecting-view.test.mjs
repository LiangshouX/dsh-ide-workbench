/**
 * The status bar of the "connecting" line (PRD-v5.1,专项检视「连接状态」).
 *
 * Two symptoms, one cause: the state machine of the CLIENT session had no
 * state for "there is no session", so "the session ended" was shown as
 * "the session is connecting".
 *
 *   - the status bar said "semantic analysis: connecting…" while there was
 *     nothing to connect - and offered NO button at all, so the user had no
 *     way out for up to ten minutes;
 *   - a handshake that is not answered left the bar on "connecting…" for 126
 *     seconds, with no progress and no button.
 *
 * The fix has three parts, and the cases below cover each of them:
 *
 *   - the bar tells the truth: a client session that does not exist is its
 *     own state (`sessionIdle`), and it never falls into the "ready" branch
 *     (the host has a server, the browser has no session - "ready" would be
 *     a lie too). When the host has NO server, the host's own word wins.
 *   - there is always a way out: the reconnect button is offered whenever the
 *     problem is on the client side, and the two buttons stay exclusive.
 *   - the time the bar shows is the CLIENT's waiting time, not the age of
 *     the host's session.
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
import { en } from '../src/client/i18n.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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
    const outfile = join(dir, 'connecting-view-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
export { lspStatusView, showRebuildButton, showReconnectButton, showCancelButton, LspStatus } from './src/client/status.jsx'
`,
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'connecting-view-entry.jsx',
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

/**
 * A translator over the English dictionary.
 * @param {string} key the key of the text
 * @returns {string} the text
 */
function translator(key) {
  return typeof en[key] === 'string' ? en[key] : key
}

/**
 * The status view of a snapshot.
 * @param {any} mod the bundled module
 * @param {object} lsp the `lsp` slice of the state
 * @returns {any} the view
 */
function viewOf(mod, lsp) {
  const store = { t: translator }
  return mod.lspStatusView(store, { lsp, settings: { lsp: { enabled: true } } })
}

// ── ① the bar tells the truth about a missing session ──────────────────────

test('a missing client session is its own state', async () => {
  const mod = await loadModule()
  // The host says the server is up, the browser has no session: "ready"
  // would be a lie, and "connecting…" is worse - nothing is connecting.
  const view = viewOf(mod, { state: 'ready', clientState: 'idle', languageId: 'typescript' })
  assert.equal(view.key, 'sessionIdle')
  assert.ok(typeof en['lsp.status.sessionIdle'] === 'string', 'the text is in the dictionary')
  assert.equal(view.text, en['lsp.status.sessionIdle'], 'the bar says the text of the dictionary')
  assert.equal(view.tone, 'warn', 'a feature the user switched off is not a fault')
})

test('the host has the last word when it has no server', async () => {
  const mod = await loadModule()
  for (const hostState of ['idle', 'suspended', 'degraded', 'crashed', 'failed', 'cancelled']) {
    const view = viewOf(mod, { state: hostState, clientState: 'idle', languageId: 'typescript' })
    assert.notEqual(view.key, 'sessionIdle', `the host state ${hostState} keeps its own word`)
  }
})

test('the connecting state stays the connecting state', async () => {
  const mod = await loadModule()
  const view = viewOf(mod, { state: 'ready', clientState: 'starting', languageId: 'typescript' })
  assert.equal(view.key, 'sessionConnecting')
})

// ── ② there is always a way out ────────────────────────────────────────────

test('the reconnect button is offered when the problem is on the client side', async () => {
  const mod = await loadModule()
  for (const clientState of ['failed', 'starting', 'idle']) {
    assert.equal(
      mod.showReconnectButton('sessionConnecting', clientState),
      true,
      `the client state ${clientState} has the reconnect button`,
    )
  }
  // The two cells that exist because of the client session offer it on their
  // own: the rule does not depend on the client state being read twice.
  assert.equal(mod.showReconnectButton('sessionConnecting'), true, 'the connecting cell offers it')
  assert.equal(mod.showReconnectButton('sessionIdle'), true, 'the missing-session cell offers it')
  assert.equal(mod.showReconnectButton('ready', 'ready'), false, 'a working session has no button')
})

test('the two buttons stay exclusive', async () => {
  const mod = await loadModule()
  for (const clientState of ['failed', 'starting', 'idle']) {
    assert.equal(
      mod.showRebuildButton('degraded', { clientState }),
      false,
      `the client state ${clientState} has no rebuild button`,
    )
  }
  // The host's own states keep the rebuild button when the client session is
  // fine.
  assert.equal(mod.showRebuildButton('degraded', { clientState: 'ready' }), true)
  assert.equal(mod.showRebuildButton('suspended', { clientState: 'ready' }), true)
  assert.equal(mod.showRebuildButton('idle', { clientState: 'ready' }), true)
})

test('the status bar offers the reconnect button while it is connecting', async () => {
  const mod = await loadModule()
  const view = viewOf(mod, { state: 'ready', clientState: 'starting', languageId: 'typescript' })
  const button = mod.showReconnectButton(view.key, 'starting')
  assert.equal(button, true, 'the user has a way out of the wait')
})

// ── ③ the time the bar shows is the client's waiting time ──────────────────

test('the store keeps the waiting start of the client session', () => {
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new CodeIntelStore(ctx, translator)
  const since = Date.now() - 60000
  store.lspSessionState('starting', '', since)
  assert.equal(store.state.lsp.clientSince, since, 'the client reported when it started waiting')
})

test('the bar shows the waiting time of the client', async () => {
  const mod = await loadModule()
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new CodeIntelStore(ctx, translator)
  // The host session is young, the client has been waiting for a minute.
  store.state = {
    ...store.state,
    lsp: { ...store.state.lsp, state: 'ready', startedAt: Date.now() - 5000 },
  }
  store.lspSessionState('starting', '', Date.now() - 60000)
  const view = mod.lspStatusView(store, { ...store.state, lsp: store.state.lsp })
  assert.match(view.detail, /1 min/, 'the bar counts the waiting of the client')
})

test('the bar falls back to the age of the host session', async () => {
  const mod = await loadModule()
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new CodeIntelStore(ctx, translator)
  store.state = {
    ...store.state,
    lsp: { ...store.state.lsp, state: 'ready', startedAt: Date.now() - 5000 },
  }
  // The client does not know when it started waiting.
  store.lspSessionState('starting', '', 0)
  const view = mod.lspStatusView(store, { ...store.state, lsp: store.state.lsp })
  assert.doesNotMatch(view.detail, /1 min/, 'the bar does not invent a waiting time')
  assert.match(view.detail, /5 s/, 'it uses the age of the host session')
})
