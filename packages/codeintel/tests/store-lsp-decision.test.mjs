/**
 * The index decision of the store of the plugin (review P1-2).
 *
 * The client session asked the host for a language server for EVERY project
 * with the global switch on - even for the projects the user had sent to the
 * basic mode. The host never started a server, the handshake was held for
 * ever, the client gave up after four rounds and turned the status bar red
 * with a toast: a false alarm for a decision the user had made on purpose.
 *
 * The store owns the decision now:
 *   - `lspIndexDecision(root)` tells the session what the workbench wants;
 *   - a failure of the client session is only announced when the host has a
 *     server that could fail;
 *   - the 【重新连接】 button does not start a server the user refused.
 *
 * The decision itself lives in the settings document of the plugin: the
 * workspace-scoped default of the user outranks the global policy, and the
 * remembered answer of a tight memory budget keeps the project in the basic
 * mode (PRD-v5.1 WS-04 / MEM-10).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { CodeIntelStore } from '../src/client/store.js'

const ROOT = 'C:\\work\\demo'
const OTHER_ROOT = 'C:\\work\\other'

/** Wait for the pending promises of the store. */
const tick = (ms = 10) => new Promise(resolve => { setTimeout(resolve, ms) })

/** The settings of a plugin with the semantic features switched on. */
function lspSettings(extra = {}) {
  return {
    shortcuts: { goToDefinition: 'F12', findUsages: 'Alt+F7', findUsagesText: 'Alt+F8', complete: 'Ctrl+Space' },
    lsp: { enabled: true, indexOnOpen: 'ask', ...extra },
  }
}

/**
 * A store with a project root, without booting the host.
 * @param {{settings?: any}} [options] the settings of the store
 * @returns {any} the store
 */
function fakeStore(options = {}) {
  const store = new CodeIntelStore({ t: key => key })
  store.state = {
    ...store.state,
    root: ROOT,
    settings: options.settings === undefined ? lspSettings() : options.settings,
  }
  return store
}

/**
 * A store that records the toasts it shows.
 * @param {{settings?: any}} [options] the settings of the store
 * @returns {{store: any, toasts: any[]}} the store and the recorded toasts
 */
function recordingStore(options = {}) {
  const store = fakeStore(options)
  const toasts = []
  const show = store.toast.bind(store)
  store.toast = (kind, text, detail, action) => {
    toasts.push({ kind, text, detail: detail ?? '' })
    show(kind, text, detail, action)
  }
  return { store, toasts }
}

/**
 * Install a fetch mock; `routes` maps method → (body) => value (or throws).
 * @param {Record<string, Function>} [routes] the routes of the stub
 * @param {any[]} [calls] the recorded calls
 * @returns {() => void} restore the real fetch
 */
function mockFetch(routes = {}, calls = []) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/dsh-codeintel/api/')[1]
    const body = init?.body === undefined ? {} : JSON.parse(init.body)
    calls.push({ method, body })
    const route = routes[method]
    if (route === undefined) {
      return { ok: true, status: 200, async json() { return { ok: true, value: {} } } }
    }
    try {
      const value = await route(body)
      return { ok: true, status: 200, async json() { return { ok: true, value } } }
    } catch (error) {
      return {
        ok: false,
        status: 500,
        async json() { return { ok: false, error: { code: error.code ?? 'error', message: error.message } } },
      }
    }
  }
  return () => { globalThis.fetch = original }
}

// ── the decision ──────────────────────────────────────────────────────────

test('a project without a decision is unknown', () => {
  const store = fakeStore()
  assert.equal(store.lspIndexDecision(ROOT), 'unknown')
  assert.equal(store.lspIndexDecision(''), 'unknown', 'an empty root asks nothing')
})

test('the policy "never index" keeps every project in the basic mode', () => {
  const store = fakeStore({ settings: lspSettings({ indexOnOpen: 'never' }) })
  assert.equal(store.lspIndexDecision(ROOT), 'conservative')
})

test('the master switch keeps every project in the basic mode', () => {
  const store = fakeStore({ settings: lspSettings({ enabled: false }) })
  assert.equal(store.lspIndexDecision(ROOT), 'conservative')
})

test('a profile without the semantic section has no decision', () => {
  // A profile without the section did not decide anything: the caller
  // decides then. (In a real profile the section always exists.)
  const store = fakeStore({ settings: { shortcuts: {} } })
  assert.equal(store.lspIndexDecision(ROOT), 'unknown')
  const empty = fakeStore({ settings: null })
  assert.equal(empty.lspIndexDecision(ROOT), 'unknown')
})

test('the remembered memory answer keeps the project in the basic mode', () => {
  const store = fakeStore({
    settings: lspSettings({ memoryWarnedRoots: { [ROOT]: 'conservative' } }),
  })
  assert.equal(store.lspIndexDecision(ROOT), 'conservative')
  assert.equal(
    store.lspIndexDecision(OTHER_ROOT),
    'unknown',
    'the answer of one project says nothing about another',
  )
})

test('the workspace-scoped default of the user wins over the policy', () => {
  // The user sent the project to the basic mode: the global policy
  // ("always") may not start a server behind their back (WS-04).
  const store = fakeStore({
    settings: lspSettings({ indexOnOpen: 'always', workspaceDefaults: { [ROOT]: 'conservative' } }),
  })
  assert.equal(store.lspIndexDecision(ROOT), 'conservative')
  // The other way round: the user wants the index, so the policy "never"
  // does not keep the project in the basic mode.
  const other = fakeStore({
    settings: lspSettings({ indexOnOpen: 'never', workspaceDefaults: { [ROOT]: 'build' } }),
  })
  assert.equal(other.lspIndexDecision(ROOT), 'build')
})

test('a legacy "start anyway" does not force the project any more', () => {
  // The old document remembered a PERMISSION to force the start, and that
  // permission was contagious (PRD-v5.1 MEM-10). The new semantics have no
  // such memory, so the legacy value is read as 'conservative'.
  const store = fakeStore({
    settings: lspSettings({ memoryWarnedRoots: { [ROOT]: 'accepted' } }),
  })
  assert.equal(store.lspIndexDecision(ROOT), 'conservative')
})

// ── the toast of a dead client session ────────────────────────────────────

test('a dead client session is announced while the host has a server', () => {
  const { store, toasts } = recordingStore()
  store.state.lsp = { ...store.state.lsp, state: 'ready' }
  store.lspSessionState('failed', 'the handshake failed')
  assert.equal(toasts.length, 1, 'the failure of the session is announced')
  assert.equal(toasts[0].kind, 'error')
})

test('a dead client session is no fault while the host has no server', () => {
  for (const state of ['idle', 'disabled', 'degraded', 'crashed', 'suspended', 'cancelled', 'failed']) {
    const { store, toasts } = recordingStore()
    store.state.lsp = { ...store.state.lsp, state }
    store.lspSessionState('failed', 'the handshake failed')
    assert.equal(toasts.length, 0, `the host state ${state} is the truth, not the client session`)
    assert.equal(
      store.lspSessionFaultNotified,
      false,
      'the episode flag is not set, so a real fault later is still announced',
    )
  }
})

test('a dead client session is announced once per episode', () => {
  const { store, toasts } = recordingStore()
  store.state.lsp = { ...store.state.lsp, state: 'ready' }
  store.lspSessionState('failed', 'the handshake failed')
  assert.equal(toasts.length, 1)
  store.lspSessionState('failed', 'the handshake failed again')
  assert.equal(toasts.length, 1, 'the toast is not repeated')
  // A working session starts a new episode.
  store.lspSessionState('starting')
  store.lspSessionState('failed', 'the handshake failed again')
  assert.equal(toasts.length, 2, 'the new episode is announced')
})

// ── the reconnect button ──────────────────────────────────────────────────

test('the reconnect does not start a server the user refused', async (t) => {
  const store = fakeStore({ settings: lspSettings({ indexOnOpen: 'never' }) })
  const calls = []
  const restore = mockFetch({}, calls)
  t.after(() => {
    store.dispose()
    restore()
  })
  await store.reconnectLsp()
  assert.equal(
    calls.some(call => call.method === 'lsp.restart'),
    false,
    'the button may not start a language server behind the back of the user',
  )
})

test('the reconnect starts the server of a project that wanted one', async (t) => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch({}, calls)
  t.after(() => {
    store.dispose()
    restore()
  })
  await store.reconnectLsp()
  assert.ok(
    calls.some(call => call.method === 'lsp.start'),
    'the way out of a dead session still works',
  )
})
