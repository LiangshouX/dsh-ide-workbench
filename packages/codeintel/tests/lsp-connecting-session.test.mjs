/**
 * The client session state machine and the handshake retry.
 *
 * Two findings of the connection-state review are pinned down here:
 *
 *   - **F1**: the state machine of the client session had three values
 *     (`starting` / `ready` / `failed`), so "the session is over" had to be
 *     reported as "the session is starting". The status bar then said
 *     "connecting" while there was nothing to connect, and it offered no way
 *     out (neither the rebuild nor the reconnect button). The fourth value
 *     `idle` means "there is no session" - and it is what the three paths
 *     that end a session report (the project was put into the basic mode,
 *     the store was dropped, the feature was switched off).
 *
 *   - **F2**: the retry of a failed handshake never looked at the state of
 *     the host. The host says that its language server is alive (`starting`,
 *     `building`, `restarting`) - the client counted its own budget anyway
 *     and declared the session dead after 126 seconds. And when the host says
 *     that there is no language server at all, the client waited those 126
 *     seconds for a handshake that cannot be answered.
 *
 * The module is a singleton: `currentClient`, `sessionKey` and
 * `handshakeRetries` are module variables, so the scenarios run in ONE
 * process, one after the other, and every scenario resets the module (the
 * way the probes of the review do it).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  configureLsp,
  lspClientSessionState,
  releaseLspForStore,
  semanticUnavailableFor,
  setLspEnabled,
  shutdownLsp,
} from '../src/client/lsp-session.js'
import { loadLspLibrary } from '../src/client/lsp-lib.js'
import { en, zh } from '../src/client/i18n.js'
// The library of the language-server client is loaded lazily: the plugin may
// be installed alone, and the session needs the library to build its client.
await loadLspLibrary()

/** The project root of the scenarios. */
const ROOT = 'C:\\work\\demo'

/** Whether the fake socket refuses the handshake. */
let refuseHandshake = false

/**
 * Wait for the pending promises of the session.
 *
 * One turn of the event loop is enough: the promises of the session settle
 * in microtasks, and the scenarios that use the fake clock need a real turn
 * of the event loop (a mocked `setTimeout` would never fire).
 * @returns {Promise<void>}
 */
const tick = () => new Promise(resolve => { setImmediate(resolve) })

/**
 * One fake WebSocket for the client session.
 *
 * It answers the handshake - or refuses it, when the case wants a handshake
 * that fails. A refused handshake is what a broken relay looks like from the
 * client: the library rejects the promise of the session, and the session
 * schedules its retry.
 */
class FakeSocket {
  constructor(url) {
    this.url = url
    this.readyState = 1
    this.sent = []
    this.handlers = new Map()
    queueMicrotask(() => this.emit('open', {}))
  }

  addEventListener(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type).add(handler)
  }

  emit(type, event) {
    for (const handler of this.handlers.get(type) ?? []) handler(event)
  }

  send(text) {
    this.sent.push(text)
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {
      return
    }
    if (parsed?.id === undefined) return
    if (parsed.method === 'initialize' && refuseHandshake) {
      // The handshake fails: the library rejects the promise of the session.
      this.emit('message', {
        data: JSON.stringify({
          jsonrpc: '2.0',
          id: parsed.id,
          error: { code: -1, message: 'the handshake failed' },
        }),
      })
      return
    }
    const result = parsed.method === 'initialize' ? { capabilities: {} } : null
    this.emit('message', {
      data: JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result }),
    })
  }

  close() { this.readyState = 3 }
}

/**
 * One store of a workspace.
 *
 * The store carries the state of the HOST (`state.lsp.state`) - that is what
 * the client looks at when a handshake fails - and it records the states the
 * client reports (`lspSessionState`).
 * @param {{ hostState?: string, decision?: string }} [options] the state of the
 *   host and the decision of the workbench about the index
 * @returns {any} the store
 */
function fakeStore(options = {}) {
  const listeners = new Set()
  const store = {
    state: {
      root: ROOT,
      settings: { editor: {}, shortcuts: {}, lsp: { enabled: true, requestTimeoutMs: 45000 } },
      // The state of the host: 'building' means the language server is alive
      // and building its program, 'idle' means there is none at all, and an
      // empty string means that the store has not polled the host yet.
      lsp: { state: options.hostState ?? '' },
    },
    /** The decision of the workbench about the index of the project. */
    decision: options.decision ?? 'build',
    /** The states the client reported. */
    reported: [],
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    /** Tell the session that the state of the store changed. */
    notify() { for (const listener of [...listeners]) listener() },
    lspIndexDecision() { return store.decision },
    lspSessionState(state, detail, since) {
      store.reported.push({ state, detail, since })
    },
    t(key) { return key },
  }
  return store
}

/**
 * Run one scenario with a client session.
 *
 * The socket and the host are doubles, and the module is reset afterwards:
 * the next scenario has to find a clean session.
 * @param {() => Promise<void>} run the code of the scenario
 * @returns {Promise<void>}
 */
async function withSession(run) {
  const originalWebSocket = globalThis.WebSocket
  const originalFetch = globalThis.fetch
  globalThis.WebSocket = FakeSocket
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() { return { ok: true, value: null } },
  })
  refuseHandshake = false
  try {
    await run()
  } finally {
    configureLsp(null)
    shutdownLsp()
    setLspEnabled(true)
    globalThis.WebSocket = originalWebSocket
    globalThis.fetch = originalFetch
    refuseHandshake = false
  }
}

// ── F1: the state machine has a fourth value: "there is no session" ─────────

test('a session that ends reports that there is no session', async () => {
  await withSession(async () => {
    const store = fakeStore()
    configureLsp(store)
    await tick()
    assert.equal(lspClientSessionState().state, 'ready', 'the session is up')

    // The user puts the project into the basic mode: the session ends.
    store.decision = 'conservative'
    store.notify()
    await tick()
    assert.equal(
      lspClientSessionState().state,
      'idle',
      'there is no session any more - and that is not "connecting"',
    )
    assert.ok(
      store.reported.some(entry => entry.state === 'idle'),
      'the store is told that the session is gone',
    )
  })
})

test('a released store reports that there is no session', async () => {
  await withSession(async () => {
    const store = fakeStore()
    configureLsp(store)
    await tick()
    assert.equal(lspClientSessionState().state, 'ready', 'the session is up')

    // The store is dropped from the cache of the workspaces.
    releaseLspForStore(store)
    await tick()
    assert.equal(
      lspClientSessionState().state,
      'idle',
      'the session of the dropped store is gone',
    )
    assert.ok(
      store.reported.some(entry => entry.state === 'idle'),
      'the store is told that the session is gone',
    )
  })
})

test('a session that is switched off reports that there is no session', async () => {
  await withSession(async () => {
    const store = fakeStore()
    configureLsp(store)
    await tick()
    assert.equal(lspClientSessionState().state, 'ready', 'the session is up')

    // The semantic features are switched off.
    store.state = {
      ...store.state,
      settings: { ...store.state.settings, lsp: { ...store.state.settings.lsp, enabled: false } },
    }
    store.notify()
    await tick()
    assert.equal(
      lspClientSessionState().state,
      'idle',
      'the feature is off: there is no session',
    )
  })
})

// ── F2: the retry of a failed handshake looks at the host ───────────────────

test('a handshake that fails while the host says the server is alive does not spend the budget', async (t) => {
  // The retry waits two seconds between the attempts, and the scenarios must
  // not spend real time on it.
  t.mock.timers.enable({ apis: ['setTimeout'] })
  await withSession(async () => {
    refuseHandshake = true
    // The host says that its language server is building the program of the
    // project: the process is alive, the handshake will be answered as soon
    // as the host forwards it.
    const store = fakeStore({ hostState: 'building' })
    configureLsp(store)
    await tick()
    assert.equal(lspClientSessionState().state, 'starting', 'the session is connecting')

    // More failures than the client allows itself (three retries).
    for (let round = 0; round < 4; round += 1) {
      t.mock.timers.tick(2000)
      await tick()
    }
    assert.equal(
      lspClientSessionState().state,
      'starting',
      'the server is alive: the client waits for it instead of giving up',
    )
  })
})

test('a handshake that fails while the host says the server is ready does not spend the budget', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  await withSession(async () => {
    refuseHandshake = true
    // The host says that its language server is READY: the server is plainly
    // alive, so the client must not declare the session dead while it waits
    // for an answer that the relay did not pass on.
    const store = fakeStore({ hostState: 'ready' })
    configureLsp(store)
    await tick()
    assert.equal(lspClientSessionState().state, 'starting', 'the session is connecting')

    for (let round = 0; round < 4; round += 1) {
      t.mock.timers.tick(2000)
      await tick()
    }
    assert.equal(
      lspClientSessionState().state,
      'starting',
      'the server is alive: the client waits for it instead of giving up',
    )
  })
})

test('a handshake that fails while the host says there is no server fails at once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  await withSession(async () => {
    refuseHandshake = true
    // The host says that there is no language server at all: no handshake can
    // be answered, so there is nothing to wait for.
    const store = fakeStore({ hostState: 'idle' })
    configureLsp(store)
    await tick()
    assert.equal(
      lspClientSessionState().state,
      'failed',
      'the session cannot come: the client says so at once',
    )
    assert.match(
      lspClientSessionState().detail,
      /idle/,
      'the reason names the state of the host',
    )

    // No retry is armed: the client does not wait for a server that does not
    // exist.
    t.mock.timers.tick(60000)
    await tick()
    assert.equal(lspClientSessionState().state, 'failed', 'the client stays dead')
    assert.equal(
      store.reported.filter(entry => entry.state === 'failed').length,
      1,
      'the failure is reported once',
    )
  })
})

test('a handshake that fails while the host says nothing keeps the old behaviour', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  // The states the client cannot read: the store has not polled the host yet,
  // the server crashed, or the host reports something the client does not
  // know. The client cannot tell whether there is a server, so it counts its
  // own budget as it always did - and an unknown state is NOT "there is no
  // language server".
  for (const hostState of ['', 'crashed', 'something-new']) {
    await withSession(async () => {
      refuseHandshake = true
      const store = fakeStore({ hostState })
      configureLsp(store)
      await tick()
      assert.equal(lspClientSessionState().state, 'starting', 'the session is connecting')

      for (let round = 0; round < 4; round += 1) {
        t.mock.timers.tick(2000)
        await tick()
      }
      assert.equal(
        lspClientSessionState().state,
        'failed',
        'without a word from the host the client spends its own budget',
      )
    })
  }
})

// ── the waiting time of the client (the host only knows the age of its own) ─

test('the client reports when it started waiting', async () => {
  await withSession(async () => {
    const store = fakeStore()
    configureLsp(store)
    await tick()
    const connecting = store.reported.find(entry => entry.state === 'starting')
    assert.ok(connecting !== undefined, 'the session reported that it is connecting')
    assert.ok(
      Number.isFinite(connecting.since) && connecting.since > 0,
      'the report carries the moment the client started waiting',
    )
    assert.ok(
      connecting.since <= Date.now(),
      'the moment is in the past',
    )

    // The handshake resolved: there is nothing to wait for any more.
    const ready = store.reported.find(entry => entry.state === 'ready')
    assert.ok(ready !== undefined, 'the session reported that it is ready')
    assert.equal(ready.since, 0, 'the waiting is over: the report says so')
  })
})

// ── the reason of the greyed-out menu for a session that does not exist ──────

test('a session that does not exist has its own reason in the menu', async () => {
  assert.equal(
    semanticUnavailableFor('idle'),
    'nav.semanticSessionIdle',
    'the menu says that there is no session - not that one is connecting',
  )
  assert.equal(
    typeof en['nav.semanticSessionIdle'] === 'string' && en['nav.semanticSessionIdle'] !== '',
    true,
    'the English text exists',
  )
  assert.equal(
    typeof zh['nav.semanticSessionIdle'] === 'string' && zh['nav.semanticSessionIdle'] !== '',
    true,
    'the Chinese text exists',
  )
})
