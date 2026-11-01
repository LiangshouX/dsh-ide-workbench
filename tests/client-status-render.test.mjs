/**
 * The client half of the PRD-v5 retrofit: VIS-01/02/03/04, STALE-03,
 * IDLE-01 and MEM-04.
 *
 * The status bar is the only place where the state of the semantic analysis
 * reaches the user, and it used to say the *same* sentence for four
 * different states: "basic mode". A server that was released to save
 * memory, a server that never ran, a server that could not be started and a
 * server that broke all looked like a fault - and the user could not tell
 * them apart. This file locks the four texts and the four tones apart, the
 * buttons that belong to them, the elapsed time of a session that is coming
 * up, the control events of the transport, the budget of a waking request
 * and the idle policy of the settings page.
 *
 * The workbench and the settings page are `.jsx` files, which Node cannot
 * import: esbuild turns them into a module inside the package, so `react`
 * resolves from the package's own `node_modules`. The package has no jsdom,
 * so the render is a `renderToStaticMarkup` (the same harness as
 * `tests/perf-slice-project.test.mjs` and `tests/render.test.mjs`).
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, rm, readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { en, zh } from '../src/client/i18n.js'
import { createLspTransport, isControlEvent } from '../src/client/lsp-transport.js'
import {
  configureLsp,
  lspClient,
  requestBudgetOf,
  semanticDefinitionAvailable,
  semanticStateAllowed,
  semanticUsagesAvailable,
  shutdownLsp,
} from '../src/client/lsp-session.js'
import { BUILD_REQUEST_TIMEOUT_MS } from '../src/host/settings-defaults.js'

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

/** A fixed moment, so the elapsed time of the tests is exact. */
const NOW = 1700000000000

let modulePromise

/**
 * The client modules of the test, bundled.
 *
 * One bundle carries the status view of the workbench and the settings page:
 * both are `.jsx` files with the same import graph.
 * @returns {Promise<object>} the bundled module
 */
async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'client-status-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: [
          "export { lspStatusView, formatWaited, waitedFor, showRebuildButton, showReconnectButton, showCancelButton, memoryFacts, LspDiagnosticsModal } from './src/client/Workbench.jsx'",
          "export { SettingsForm } from './src/client/SettingsPanel.jsx'",
        ].join('\n'),
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'client-status-entry.jsx',
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
 * A translator over one locale table.
 *
 * The real `t` of the store does not interpolate either - the caller does
 * that - so the tables can be used as they are.
 * @param {Record<string, string>} table the locale table
 * @returns {(key: string) => string} the translator
 */
function translator(table) {
  return (key) => (typeof table[key] === 'string' ? table[key] : key)
}

/**
 * The workbench snapshot of one semantic-analysis state.
 * @param {object} [lsp] the `lsp` slice
 * @param {object} [extra] the other fields of the state
 * @returns {object} the snapshot
 */
function snapshot(lsp = {}, extra = {}) {
  return {
    lsp: {
      state: 'ready',
      languageId: 'typescript',
      detail: '',
      servers: { missing: [] },
      ...lsp,
    },
    settings: { lsp: { enabled: true } },
    ...extra,
  }
}

/**
 * Run a piece of code with a frozen clock.
 *
 * The elapsed time of the status text is the difference between the host's
 * start stamp and the clock of the client, so the test has to own the clock.
 * @param {() => any} run the code
 * @returns {any} whatever the code returned
 */
function withClock(run) {
  const original = Date.now
  Date.now = () => NOW
  try {
    return run()
  } finally {
    Date.now = original
  }
}

/**
 * Wait until one condition holds.
 * @param {() => boolean} predicate the condition
 * @param {number} [timeoutMs] how long to wait
 * @returns {Promise<boolean>} true when the condition held
 */
async function waitUntil(predicate, timeoutMs = 3000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true
    await new Promise(resolve => { setTimeout(resolve, 5) })
  }
  return predicate()
}

// ── the four states of the semantic analysis ──────────────────────────────
//
// The host owns the state machine, but the *meaning* of a state reaches the
// user through the status bar alone. Four states that share one sentence are
// four states the user cannot tell apart - and one of them (the release of
// the server) is not a fault at all.

test('the four states of the semantic analysis have four different texts and tones', async () => {
  const { lspStatusView } = await loadModule()
  const store = { t: translator(en) }

  const views = ['degraded', 'failed', 'idle', 'suspended']
    .map(state => lspStatusView(store, snapshot({ state })))

  assert.equal(new Set(views.map(view => view.text)).size, 4, 'the four texts differ')
  // The tones are the ones of the specification: the basic mode is yellow, a
  // server that did not start is red, and the two states in which nothing is
  // broken are grey.
  assert.deepEqual(
    views.map(view => view.tone),
    ['warn', 'error', 'idle', 'idle'],
    'the four tones are the ones of the specification',
  )

  const [degraded, failed, idle, suspended] = views
  assert.equal(degraded.text, en['lsp.status.degraded'], 'the basic mode keeps its text')
  assert.equal(degraded.tone, 'warn', 'the basic mode is the yellow dot')
  assert.equal(failed.text, en['lsp.status.failed'], 'a server that did not start says so')
  assert.equal(failed.tone, 'error', 'a server that did not start is the red dot')
  assert.equal(idle.text, en['lsp.status.idle'], 'a server that never ran says so')
  assert.equal(idle.tone, 'idle', 'a server that never ran is the grey dot')
  assert.equal(suspended.text, en['lsp.status.suspended'], 'a released server says so')
  assert.equal(suspended.tone, 'idle', 'a released server is the grey dot')

  assert.notEqual(suspended.text, degraded.text, 'a released server is not the basic mode')
  assert.notEqual(idle.text, degraded.text, 'an idle server is not the basic mode')
  assert.notEqual(failed.text, degraded.text, 'a failed server is not the basic mode')
})

test('the four states have four different texts in Chinese too', async () => {
  const { lspStatusView } = await loadModule()
  const store = { t: translator(zh) }

  const views = ['degraded', 'failed', 'idle', 'suspended']
    .map(state => lspStatusView(store, snapshot({ state })))

  assert.equal(new Set(views.map(view => view.text)).size, 4, 'the four texts differ')
  assert.equal(views[1].text, zh['lsp.status.failed'])
  assert.equal(views[2].text, zh['lsp.status.idle'])
  assert.equal(views[3].text, zh['lsp.status.suspended'])
})

test('a status the client could not refresh wins over every other state', async () => {
  const { lspStatusView } = await loadModule()
  const store = { t: translator(en) }

  // A poll that failed leaves the client with a value that may be minutes
  // old: the status bar has to say that it does not know, not repeat the
  // "starting" of ten minutes ago.
  for (const state of ['ready', 'starting', 'building', 'degraded', 'failed', 'idle', 'suspended']) {
    const view = lspStatusView(store, snapshot({ state }, { lspStatusStale: true }))
    assert.equal(view.text, en['lsp.status.unknown'], `${state} is hidden by the stale flag`)
    assert.equal(view.tone, 'idle', `${state} is the grey dot while the state is unknown`)
  }
})

test('the rebuild button belongs to the released and to the broken server', async () => {
  const { showRebuildButton } = await loadModule()

  // The release of the server is not a fault, but the user still wants the
  // index back without walking into the diagnostics panel (PRD-v5 §1.4).
  assert.equal(showRebuildButton('idle', {}), true, 'an idle server offers the rebuild')
  assert.equal(showRebuildButton('suspended', {}), true, 'a released server offers the rebuild')
  assert.equal(showRebuildButton('degraded', {}), true, 'the basic mode offers the rebuild')
  assert.equal(showRebuildButton('failed', {}), true, 'a failed server offers the rebuild')
  assert.equal(showRebuildButton('cancelled', {}), true, 'a cancelled build offers the rebuild')
  assert.equal(showRebuildButton('ready', {}), false, 'a working server needs no rebuild')
  assert.equal(showRebuildButton('building', {}), false, 'a running build needs no rebuild')
  // A rebuild that runs already owns the button.
  assert.equal(showRebuildButton('suspended', { rebuilding: true }), false, 'no second rebuild')
})

test('the cancel button belongs to a session that is coming up', async () => {
  const { showCancelButton } = await loadModule()

  // The host can cancel a build that is still starting or restarting, so the
  // UI used to withhold a capability the host already had (PRD-v5 §2.4).
  assert.equal(showCancelButton('starting', true), true, 'a starting session can be cancelled')
  assert.equal(showCancelButton('restarting', true), true, 'a restarting session can be cancelled')
  assert.equal(showCancelButton('building', true), true, 'a running build can be cancelled')
  assert.equal(showCancelButton('starting', false), false, 'the host says no')
  assert.equal(showCancelButton('ready', true), false, 'a ready server has nothing to cancel')
  assert.equal(showCancelButton('suspended', true), false, 'a released server has nothing to cancel')
})

// ── the client session (the link to the language server) ───────────────────
//
// The host says that the language server PROCESS is up, the client says
// whether the link between the browser and the server works. The two never
// check each other, and the status bar believed the host: it said "ready"
// while the semantic features were completely dead - the menu was greyed out
// and the hovering did nothing.

test('the dead client session wins over the ready server of the host', async () => {
  const { lspStatusView } = await loadModule()
  const store = { t: translator(en) }

  const view = lspStatusView(store, snapshot({
    state: 'ready',
    clientState: 'failed',
    clientDetail: 'the handshake timed out',
  }))
  assert.equal(view.key, 'sessionFailed', 'the dead session is not "ready"')
  assert.equal(view.text, en['lsp.status.sessionFailed'])
  assert.equal(view.tone, 'error', 'a dead session is red')
  assert.equal(view.action, 'diagnostics')
  assert.equal(view.detail, 'the handshake timed out', 'the reason is in the tooltip')

  // It wins over every other state of the host too: the features do not
  // work whatever the host says about its process.
  for (const state of ['degraded', 'failed', 'crashed', 'cancelled', 'idle', 'suspended', 'building']) {
    const other = lspStatusView(store, snapshot({ state, clientState: 'failed' }))
    assert.equal(other.key, 'sessionFailed', `the dead session wins over ${state}`)
  }
})

test('the connecting client session is not shown as ready', async () => {
  const { lspStatusView } = await loadModule()
  const store = { t: translator(en) }

  const view = lspStatusView(store, snapshot({ state: 'ready', clientState: 'starting' }))
  assert.equal(view.key, 'sessionConnecting', 'the handshake is not resolved yet')
  assert.equal(view.text, en['lsp.status.sessionConnecting'])
  assert.equal(view.tone, 'idle', 'connecting is grey, not green')

  // A server that is not ready yet keeps its own text: the host knows more
  // about the build than the client does.
  const building = lspStatusView(store, snapshot({ state: 'building', clientState: 'starting' }))
  assert.equal(building.key, 'building', 'the state of the host is kept')
})

test('the reconnect button belongs to the dead session alone', async () => {
  const { showReconnectButton, showRebuildButton } = await loadModule()

  assert.equal(showReconnectButton('sessionFailed'), true, 'the dead session offers the reconnect')
  assert.equal(showReconnectButton('ready'), false)
  assert.equal(showReconnectButton('degraded'), false)
  assert.equal(showReconnectButton('sessionConnecting'), false, 'a connecting session needs no reconnect')
  // The two buttons are exclusive: rebuilding the index of a healthy server
  // would not repair the link between the browser and the server.
  assert.equal(showRebuildButton('sessionFailed', {}), false, 'the dead session offers no rebuild')
  assert.equal(showRebuildButton('degraded', {}), true, 'the rebuild still belongs to the host')
})

test('the status of a starting session says how long the user waits', async () => {
  const { lspStatusView, formatWaited, waitedFor } = await loadModule()
  const store = { t: translator(en) }

  const view = withClock(() => lspStatusView(store, snapshot({ state: 'starting', startedAt: NOW - 134000 })))
  assert.equal(view.text, 'Semantic analysis: starting… (waited 2 min 14 s)')
  assert.equal(view.key, 'starting')

  const chinese = { t: translator(zh) }
  const zhView = withClock(() => lspStatusView(chinese, snapshot({ state: 'starting', startedAt: NOW - 134000 })))
  assert.equal(zhView.text, '语义分析：启动中…（已等待 2 分 14 秒）')

  const restarting = withClock(() => lspStatusView(store, snapshot({ state: 'restarting', startedAt: NOW - 134000 })))
  assert.equal(restarting.text, 'Semantic analysis: restarting… (waited 2 min 14 s)')

  // The helper is the readable form of the same two numbers.
  assert.equal(formatWaited(2, 14), '2 min 14 s')
  assert.equal(formatWaited(2, 14, 'zh'), '2 分 14 秒')
  assert.deepEqual(waitedFor(134000), { minutes: 2, seconds: 14 })
  assert.deepEqual(waitedFor(0), { minutes: 0, seconds: 0 })
})

test('a session without a start time says what the host does, not that it waits', async () => {
  const { lspStatusView } = await loadModule()
  const store = { t: translator(en) }

  const view = lspStatusView(store, snapshot({ state: 'starting' }))
  assert.equal(view.text, en['lsp.status.starting'])
  const restarting = lspStatusView(store, snapshot({ state: 'restarting' }))
  assert.equal(restarting.text, en['lsp.status.restarting'])
})

// ── the memory row of the diagnostics panel ────────────────────────────────
//
// The row used to show the free memory of the machine and the estimate of
// the next server: "2732 MB / 651 MB". Two numbers, and neither of them said
// what it was. Worse, the free memory is not the number the host judges the
// start by - the host subtracts what the running language servers have
// reserved (MEM-02), so the row said "plenty of memory" while the gate said
// "tight". The row now shows the three numbers that answer the question.

test('the memory row shows what is available, what is needed and what is reserved', async () => {
  const { memoryFacts } = await loadModule()
  const store = { t: translator(en) }

  const facts = memoryFacts(store, {
    freeBytes: 2732 * 1024 * 1024,
    availableBytes: 684 * 1024 * 1024,
    reservedBytes: 2048 * 1024 * 1024,
    needMB: 651,
  })

  assert.equal(facts.availableMB, 684, 'the available memory is the one the gate uses')
  assert.equal(facts.needMB, 651)
  assert.equal(facts.reservedMB, 2048)
  // The three numbers are named: a row of bare numbers says nothing about
  // which is which, and the whole point of the row is to answer "is there
  // enough memory for the semantic features".
  assert.match(facts.text, /Available 684 MB/)
  assert.match(facts.text, /Needs 651 MB/)
  assert.match(facts.text, /Reserved 2048 MB/)
})

test('the memory row leaves the reservation out when there is none', async () => {
  const { memoryFacts } = await loadModule()
  const store = { t: translator(en) }

  const facts = memoryFacts(store, {
    freeBytes: 2732 * 1024 * 1024,
    availableBytes: 2732 * 1024 * 1024,
    reservedBytes: 0,
    needMB: 651,
  })

  // "Reserved 0 MB" is noise: a row that always carries it trains the user
  // to skip the part that matters.
  assert.doesNotMatch(facts.text, /Reserved/)
  assert.match(facts.text, /Available 2732 MB · Needs 651 MB/)
})

test('the memory row falls back to the free memory when the host reports no reservation', async () => {
  const { memoryFacts } = await loadModule()
  const store = { t: translator(en) }

  // A host without the reservation accounting (an older build) still has to
  // render a sensible row.
  const facts = memoryFacts(store, { freeBytes: 2732 * 1024 * 1024, needMB: 651 })
  assert.equal(facts.availableMB, 2732)
  assert.equal(facts.reservedMB, 0)
})

test('the memory row says nothing when the host reported no memory at all', async () => {
  const { memoryFacts } = await loadModule()
  const store = { t: translator(en) }

  const facts = memoryFacts(store, null)
  assert.equal(facts.text, '—')
  assert.equal(facts.availableMB, null)
})

test('the memory row names the three numbers in Chinese too', async () => {
  const { memoryFacts } = await loadModule()
  const store = { t: translator(zh) }

  const facts = memoryFacts(store, {
    freeBytes: 2732 * 1024 * 1024,
    availableBytes: 684 * 1024 * 1024,
    reservedBytes: 2048 * 1024 * 1024,
    needMB: 651,
  })
  assert.equal(facts.text, '可用 684 MB · 需要 651 MB · 已预留 2048 MB')
})

// ── the diagnostics panel ─────────────────────────────────────────────────
//
// The toast tells the user in one localized sentence, and its generic answer
// says «the details are in the diagnostics panel». The panel therefore has to
// carry the reason the host reported - it is the only place where the exact
// technical reason is readable.

test('the diagnostics panel shows the reason the host reported', async () => {
  const { LspDiagnosticsModal } = await loadModule()
  const store = { t: translator(en) }
  const state = snapshot({
    state: 'degraded',
    detail: 'the language server stopped unexpectedly (3 request timeouts); the automatic restart budget (1) is used up',
  })

  const html = renderToStaticMarkup(React.createElement(LspDiagnosticsModal, {
    store,
    state,
    onOpenSettings: () => {},
    onClose: () => {},
  }))

  assert.match(html, /the automatic restart budget/, 'the reason of the host is shown')
  assert.match(html, /lsp\.diagnostics\.reason|Latest failure|Reason/, 'the row has a label')
})

test('the diagnostics panel says nothing about a reason when there is none', async () => {
  const { LspDiagnosticsModal } = await loadModule()
  const store = { t: translator(en) }
  const state = snapshot({ state: 'ready', detail: '' })

  const html = renderToStaticMarkup(React.createElement(LspDiagnosticsModal, {
    store,
    state,
    onOpenSettings: () => {},
    onClose: () => {},
  }))

  assert.doesNotMatch(html, /lsp\.diagnostics\.reason/, 'the row is not there without a reason')
})

// ── the control events of the host ────────────────────────────────────────//
// The host puts its own events on the same socket as the JSON-RPC messages.
// The library would fail on them, so the transport takes them out of the
// stream (PRD-v5 §1.5).

test('a control event is told apart from a JSON-RPC payload', () => {
  const event = isControlEvent('{"type":"degraded","detail":"the server died"}')
  assert.ok(event !== null, 'a control event is recognized')
  assert.equal(event.type, 'degraded')
  assert.equal(event.detail, 'the server died')

  assert.equal(isControlEvent('{"jsonrpc":"2.0","id":1,"result":{}}'), null, 'JSON-RPC is not a control event')
  assert.equal(isControlEvent('{"jsonrpc":"2.0","type":"x"}'), null, 'JSON-RPC stays JSON-RPC')
  assert.equal(isControlEvent('not json at all'), null, 'a broken payload is not a control event')
  assert.equal(isControlEvent('[]'), null, 'an array is not a control event')
  assert.equal(isControlEvent('null'), null, 'null is not a control event')
  assert.equal(isControlEvent(''), null, 'nothing is not a control event')
})

/**
 * A fake socket for the transport.
 *
 * The transport opens its socket with the first message it sends, so the
 * test grabs the instance afterwards.
 */
class FakeSocket {
  constructor(url) {
    this.url = url
    this.readyState = 1
    this.listeners = new Map()
    FakeSocket.instances.push(this)
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(handler)
  }

  emit(type, event) {
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler(event)
  }

  send() {}

  close() { this.readyState = 3 }
}
FakeSocket.instances = []

test('a control event never reaches the language-server library', () => {
  FakeSocket.instances = []
  const controls = []
  const seen = []
  const transport = createLspTransport({
    url: 'ws://127.0.0.1:1/lsp',
    WebSocketImpl: FakeSocket,
    onControl: event => { controls.push(event) },
  })
  transport.subscribe(value => { seen.push(value) })
  try {
    transport.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }))
    const socket = FakeSocket.instances[0]
    assert.ok(socket !== undefined, 'the socket was opened')

    socket.emit('message', { data: JSON.stringify({ type: 'degraded', detail: 'the server died' }) })
    assert.equal(controls.length, 1, 'the control event was routed to the store')
    assert.equal(controls[0].type, 'degraded')
    assert.equal(controls[0].detail, 'the server died')
    assert.deepEqual(seen, [], 'the library never saw the control event')

    // A JSON-RPC payload still belongs to the library.
    socket.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) })
    assert.equal(seen.length, 1, 'the library got its payload')

    // A payload that is not JSON belongs to the library as well: it owns the
    // error message of a broken stream.
    socket.emit('message', { data: 'not json at all' })
    assert.equal(seen.length, 2)
    assert.equal(seen[1], 'not json at all')
  } finally {
    transport.close()
  }
})

test('a broken control handler does not break the transport', () => {
  FakeSocket.instances = []
  const errors = []
  const seen = []
  const transport = createLspTransport({
    url: 'ws://127.0.0.1:1/lsp',
    WebSocketImpl: FakeSocket,
    onControl: () => { throw new Error('the store is broken') },
    onError: error => { errors.push(error) },
  })
  transport.subscribe(value => { seen.push(value) })
  try {
    transport.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }))
    const socket = FakeSocket.instances[0]
    socket.emit('message', { data: JSON.stringify({ type: 'crash' }) })
    assert.equal(errors.length, 1, 'the failure was reported')
    assert.deepEqual(seen, [], 'the control event did not reach the library')
    // The transport still works.
    socket.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) })
    assert.equal(seen.length, 1)
  } finally {
    transport.close()
  }
})

// ── the session: a released server is recoverable ─────────────────────────
//
// The host wakes a released server up on the first payload (PRD-v5 §3.3).
// The client has to agree on both points: the semantic commands must stay
// enabled, and the waking request needs the long budget - the host waits
// with it, because the woken server builds the program of the project from
// scratch.

/**
 * The fake socket of the session.
 *
 * The client sends its `initialize` request as soon as the socket is open;
 * the fake answers it, so the request never runs into its timeout. The
 * capabilities of the answer are the ones the semantic commands need.
 */
class SessionSocket {
  constructor(url) {
    this.url = url
    this.readyState = 1
    this.sent = []
    this.handlers = new Map()
    SessionSocket.instances.push(this)
    queueMicrotask(() => this.emit('open', {}))
  }

  addEventListener(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type).add(handler)
  }

  emit(type, event) {
    for (const handler of [...(this.handlers.get(type) ?? [])]) handler(event)
  }

  send(text) {
    this.sent.push(text)
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {
      return
    }
    if (parsed?.method === 'initialize') {
      this.emit('message', {
        data: JSON.stringify({
          jsonrpc: '2.0',
          id: parsed.id,
          result: { capabilities: { referencesProvider: {}, definitionProvider: {} } },
        }),
      })
      return
    }
    const answer = SessionSocket.answer(parsed)
    if (answer === null) return
    this.emit('message', { data: JSON.stringify(answer) })
  }

  close() { this.readyState = 3 }
}
SessionSocket.instances = []
/** The answer of the fake server; `null` means "no answer at all". */
SessionSocket.answer = () => null

const originalWebSocket = globalThis.WebSocket
globalThis.WebSocket = SessionSocket
const originalFetch = globalThis.fetch
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  async json() { return { ok: true, value: { ok: true } } },
})

after(() => {
  globalThis.WebSocket = originalWebSocket
  globalThis.fetch = originalFetch
  shutdownLsp()
})

/**
 * A workbench store for the session.
 * @returns {object} the store
 */
function sessionStore() {
  const listeners = new Set()
  const store = {
    state: {
      root: 'C:/work/demo',
      tabs: [],
      settings: { lsp: { enabled: true, requestTimeoutMs: 30000 }, shortcuts: {} },
      lsp: {
        state: 'ready',
        processId: 0,
        consecutiveFailures: 0,
        consecutiveTimeouts: 0,
        lastFailure: null,
      },
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(patch) {
      store.state = { ...store.state, ...patch }
      for (const listener of [...listeners]) listener()
    },
    toast() {},
    t(key) { return key },
    lspControl() {},
  }
  return store
}

/**
 * Put the store into another semantic-analysis state.
 * @param {object} store the store
 * @param {string} state the state of the host
 */
function setLspState(store, state) {
  store.state = { ...store.state, lsp: { ...store.state.lsp, state } }
}

test('the semantic commands stay enabled while the server sleeps', async () => {
  const store = sessionStore()
  configureLsp(store)
  assert.equal(await waitUntil(() => semanticUsagesAvailable()), true, 'the session is up')

  // A released server is recoverable: the host wakes it up on the first
  // payload, so the commands must not be greyed out.
  setLspState(store, 'suspended')
  assert.equal(semanticUsagesAvailable(), true, 'find usages works on a released server')
  assert.equal(semanticDefinitionAvailable(), true, 'go to definition works on a released server')

  // An idle server was never started for this root: the host would not wake
  // it, so the commands stay off.
  setLspState(store, 'idle')
  assert.equal(semanticUsagesAvailable(), false, 'find usages needs a server')

  // A fault is a fault.
  setLspState(store, 'degraded')
  assert.equal(semanticUsagesAvailable(), false, 'the basic mode has no semantic features')
  setLspState(store, 'failed')
  assert.equal(semanticDefinitionAvailable(), false, 'a failed server has no semantic features')

  assert.equal(semanticStateAllowed('ready'), true)
  assert.equal(semanticStateAllowed('suspended'), true)
  assert.equal(semanticStateAllowed('idle'), false)
  assert.equal(semanticStateAllowed('degraded'), false)
  assert.equal(semanticStateAllowed('failed'), false)
  assert.equal(semanticStateAllowed('disabled'), false)
})

test('the request that wakes a released server gets the long budget', async () => {
  const store = sessionStore()
  configureLsp(store)
  const client = lspClient()
  assert.ok(client !== null, 'the session has a client')

  // One answered semantic request: from now on the short budget is the right
  // one for a server that is up and answering.
  SessionSocket.answer = request => ({ jsonrpc: '2.0', id: request.id, result: [] })
  await client.request('textDocument/references', {}).then(() => {}, () => {})
  setLspState(store, 'ready')
  assert.equal(requestBudgetOf(store), 30000, 'a working server gets the configured budget')

  // The server was released: the next request wakes it, and the woken server
  // builds the program of the project from scratch. The host waits with the
  // long budget (a new process has not answered a semantic request yet), so
  // the client has to wait with it as well.
  setLspState(store, 'suspended')
  assert.equal(
    requestBudgetOf(store),
    BUILD_REQUEST_TIMEOUT_MS,
    'the waking request gets the long budget',
  )
})

// ── the idle policy of the settings page ──────────────────────────────────
//
// One dropdown says when the server lets go: never, after an idle time, or
// only when the machine runs short of memory (PRD-v5 §3.2). The old
// "exit the server when idle" switch is gone, and the number of the seconds
// before the cancel button appears is reachable (MEM-04).

/**
 * A store for the settings page.
 * @returns {object} the store
 */
function panelStore() {
  return {
    t: key => key,
    updateSettings: async () => {},
    loadLspServers: async () => {},
    loadLspResources: async () => {},
  }
}

/**
 * The state of the workbench the settings page reads.
 * @param {object} [lsp] the `lsp` section of the settings
 * @returns {object} the state
 */
function panelState(lsp = {}) {
  return {
    settings: {
      git: { path: '', colors: true, commitTemplate: '' },
      idea: { path: '' },
      webstorm: { path: '' },
      vscode: { path: '' },
      terminal: { shell: 'auto', copyOnSelect: false, fontSize: 13, shellName: 'pwsh' },
      project: { alwaysSelectOpened: true, showHidden: true, showIgnored: false, singleClickOpen: false },
      commit: { groupByDirectory: false },
      delete: { useRecycleBin: true },
      editor: { fontSize: 13, highlight: true, openMode: 'auto', editableMaxBytes: 1 << 20, markdownPreview: true },
      links: { chatFiles: 'ide' },
      shortcuts: {},
      lsp: {
        enabled: true,
        indexOnOpen: 'ask',
        memoryLimitMB: 2048,
        freeMemoryThresholdMB: 512,
        memoryHeadroom: 1.5,
        memoryHardFloorMB: 256,
        idleTimeoutMs: 600000,
        cancelAfterMs: 60000,
        requestTimeoutMs: 30000,
        idlePolicy: 'after',
        autoExit: true,
        autoRestart: true,
        servers: {},
        ...lsp,
      },
    },
    terminal: { shells: [{ id: 'pwsh', label: 'PowerShell' }] },
    lsp: { state: 'idle', servers: { available: [], missing: [], disabled: [] }, resources: null },
  }
}

test('the settings page has one dropdown for the idle policy', async () => {
  const { SettingsForm } = await loadModule()
  const html = renderToStaticMarkup(React.createElement(SettingsForm, { store: panelStore(), state: panelState() }))

  assert.match(html, /settings\.lspIdlePolicy/, 'the dropdown has a label')
  assert.match(html, /value="never"/, 'the dropdown offers "never"')
  assert.match(html, /value="after"/, 'the dropdown offers "after an idle time"')
  assert.match(html, /value="onMemoryPressure"/, 'the dropdown offers "only under memory pressure"')
  // The old switch is gone: the dropdown replaced it.
  assert.doesNotMatch(html, /settings\.lspAutoExit/, 'the idle switch is gone')
})

test('the settings page warns what "never exit" costs', async () => {
  const { SettingsForm } = await loadModule()
  const html = renderToStaticMarkup(React.createElement(SettingsForm, {
    store: panelStore(),
    state: panelState({ idlePolicy: 'never' }),
  }))

  assert.match(html, /settings\.lspIdlePolicyNeverWarning/, 'the warning is shown')
  // The warning names the price: the language server stays resident.
  assert.match(en['settings.lspIdlePolicyNeverWarning'], /1\.8\s*–\s*2\.2\s*GB/, 'the warning names the footprint')
  assert.match(zh['settings.lspIdlePolicyNeverWarning'], /1\.8\s*–\s*2\.2\s*GB/, 'the warning names the footprint')
})

test('the settings page has a field for the cancel threshold', async () => {
  const { SettingsForm } = await loadModule()
  const html = renderToStaticMarkup(React.createElement(SettingsForm, { store: panelStore(), state: panelState() }))

  assert.match(html, /settings\.lspCancelAfter/, 'the cancel threshold has a label')
  // The field is in seconds: the host keeps milliseconds.
  assert.match(html, /value="60"/, 'the threshold is shown in seconds')
})

test('the settings page shows the memory the host judges the start by', async () => {
  const { SettingsForm } = await loadModule()
  const state = panelState()
  state.lsp.resources = {
    languageId: 'typescript',
    freeBytes: 2732 * 1024 * 1024,
    availableBytes: 684 * 1024 * 1024,
    reservedBytes: 2048 * 1024 * 1024,
    needMB: 651,
    thresholdBytes: 651 * 1024 * 1024,
    hardFloorMB: 256,
    tight: true,
    canIndex: true,
  }
  const html = renderToStaticMarkup(React.createElement(SettingsForm, {
    // The real text, not the key: the numbers live in the placeholders of
    // the sentence, so a store that returns the key would hide them.
    store: { ...panelStore(), t: translator(en) },
    state,
  }))

  // The number is the available one - the gate's own number - and not the
  // free memory of the machine, which is 2048 MB higher here.
  assert.match(html, /684/, 'the available memory is shown')
  assert.doesNotMatch(html, /2732/, 'the free memory of the machine is not the number that decides')
  // The reservation gets its own line, and it says what it is.
  assert.match(html, /have reserved 2048 MB/, 'the reservation is explained')
  assert.match(en['settings.lspMemoryReserved'], /ceiling/i, 'the reservation says that it is the ceiling')
})

test('the idle policy of the page agrees with the switch of the document', async () => {
  const { SettingsForm } = await loadModule()
  // A document written before the policy existed says `autoExit: false`. The
  // host honours that switch over the policy - the server never lets go - so
  // a page that showed "after an idle time" would promise something the host
  // does not do (PRD-v5 §3.2).
  const html = renderToStaticMarkup(React.createElement(SettingsForm, {
    store: panelStore(),
    state: panelState({ autoExit: false, idlePolicy: 'after' }),
  }))
  assert.match(html, /<option value="never" selected=""/, 'the dropdown shows "never exit"')
  assert.match(html, /settings\.lspIdlePolicyNeverWarning/, 'the price of "never exit" is shown')
})

test('the dropdown writes the switch with the policy', async () => {
  const { SettingsForm } = await loadModule()
  // The switch travels with the policy: the host reads the switch, so a
  // document that keeps `autoExit: false` while the policy says "after" would
  // contradict itself.
  const source = await readFile(join(root, 'src/client/SettingsPanel.jsx'), 'utf8')
  assert.match(source, /autoExit: event\.target\.value !== 'never'/, 'the switch is written with the policy')
})

// ── the dictionaries ──────────────────────────────────────────────────────
//
// A key that exists in one table only is a bug: the interface falls back to
// the key itself, and the user reads "lsp.status.suspended".

test('both dictionaries carry every key of the other one', () => {
  const enKeys = Object.keys(en)
  const zhKeys = Object.keys(zh)
  assert.deepEqual(zhKeys.filter(key => !enKeys.includes(key)), [], 'the Chinese table has no extra key')
  assert.deepEqual(enKeys.filter(key => !zhKeys.includes(key)), [], 'every key has a Chinese text')
})

test('both dictionaries carry the new keys of the retrofit', () => {
  const keys = [
    'lsp.status.degraded',
    'lsp.status.failed',
    'lsp.status.idle',
    'lsp.status.suspended',
    'lsp.status.unknown',
    'lsp.status.starting',
    'lsp.status.startingWait',
    'lsp.status.restarting',
    'lsp.status.restartingWait',
    'settings.lspIdlePolicy',
    'settings.lspIdlePolicyShort',
    'settings.lspIdlePolicyHint',
    'settings.lspIdlePolicyNever',
    'settings.lspIdlePolicyAfter',
    'settings.lspIdlePolicyMemory',
    'settings.lspIdlePolicyNeverWarning',
    'settings.lspCancelAfter',
    'settings.lspCancelAfterShort',
    'settings.lspCancelAfterHint',
    // The client session: the link between the browser and the server.
    'lsp.status.sessionFailed',
    'lsp.status.sessionConnecting',
    'lsp.reconnect',
    'lsp.sessionFailedToast',
    'nav.semanticSessionUnavailable',
  ]
  for (const key of keys) {
    assert.equal(typeof en[key], 'string', `the English text of ${key} is missing`)
    assert.notEqual(en[key].trim(), '', `the English text of ${key} is empty`)
    assert.equal(typeof zh[key], 'string', `the Chinese text of ${key} is missing`)
    assert.notEqual(zh[key].trim(), '', `the Chinese text of ${key} is empty`)
  }
})

test('the waited-time texts carry the two numbers of the elapsed time', () => {
  assert.match(en['lsp.status.startingWait'], /\{minutes\}/)
  assert.match(en['lsp.status.startingWait'], /\{seconds\}/)
  assert.match(en['lsp.status.restartingWait'], /\{minutes\}/)
  assert.match(en['lsp.status.restartingWait'], /\{seconds\}/)
  assert.match(zh['lsp.status.startingWait'], /\{minutes\}/)
  assert.match(zh['lsp.status.startingWait'], /\{seconds\}/)
  assert.match(zh['lsp.status.restartingWait'], /\{minutes\}/)
  assert.match(zh['lsp.status.restartingWait'], /\{seconds\}/)
})
