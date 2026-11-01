/**
 * The index decision of the client store (review P1-2).
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
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkbenchStore } from '../src/client/store.js'

const ROOT = 'C:\\work\\demo'
const OTHER_ROOT = 'C:\\work\\other'

/** Wait for the pending promises of the store. */
const tick = (ms = 10) => new Promise(resolve => { setTimeout(resolve, ms) })

/** The settings of a workbench with the semantic features switched on. */
function lspSettings(extra = {}) {
  return {
    editor: { openMode: 'auto', editableMaxBytes: 1 << 20 },
    shortcuts: {},
    lsp: { enabled: true, indexOnOpen: 'ask', ...extra },
  }
}

/**
 * A store with a project root, without booting the host.
 * @param {{settings?: any}} [options] the settings of the store
 * @returns {any} the store
 */
function fakeStore(options = {}) {
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new WorkbenchStore(ctx, key => key)
  store.state = {
    ...store.state,
    workspaceRoot: ROOT,
    root: ROOT,
    gitRepoRoot: ROOT,
    phase: 'ready',
    statusAt: 1234,
    dirs: new Map([[ROOT, { entries: [], loading: false }]]),
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

/** Install a fetch mock; `routes` maps method → (body) => value (or throws). */
function mockFetch(routes = {}, calls = []) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/ide-workbench/api/')[1]
    const body = JSON.parse(init.body)
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

/**
 * The routes the store needs to answer the calls of a project switch.
 *
 * The host answers a settings update with the whole settings document, and
 * the store takes it - so the route has to answer with the settings of the
 * store, or the semantic section would be gone after the switch.
 * @param {any} settings the settings document of the store
 * @param {Record<string, Function>} [extra] more routes
 * @returns {Record<string, Function>} the routes
 */
function switchRoutes(settings, extra = {}) {
  return {
    'lsp.resources': () => ({ canIndex: true, freeBytes: 8 * 1024 ** 3, needMB: 400 }),
    'lsp.status': () => ({ state: 'idle', enabled: true }),
    'lsp.start': () => ({ state: 'building' }),
    'git.status': () => ({ isRepo: true, branch: 'main', entries: [], subprocesses: 1 }),
    'git.log': () => ({ commits: [], hasMore: false }),
    'git.branches': () => ({ branches: [] }),
    'git.messages': () => ({ messages: [] }),
    'settings.get': () => ({ file: 'settings.json', value: settings }),
    'settings.update': () => ({ value: settings }),
    'fs.tree': () => ({ entries: [], truncated: false }),
    ...extra,
  }
}

/**
 * Switch to another project and answer the index decision.
 * @param {any} store the store
 * @param {string} choice the answer of the user
 * @returns {Promise<void>}
 */
async function switchWithDecision(store, choice) {
  store.state.projects = [{ path: OTHER_ROOT, name: 'other' }]
  const switching = store.selectProject(OTHER_ROOT)
  await tick(20)
  assert.ok(store.state.indexDecision !== null, 'the decision dialog is open')
  store.resolveIndexDecision(choice)
  await switching
}

// ── the decision ──────────────────────────────────────────────────────────

test('a project without a decision is unknown', () => {
  const store = fakeStore()
  assert.equal(store.lspIndexDecision(ROOT), 'unknown')
  assert.equal(store.lspIndexDecision(''), 'unknown', 'an empty root asks nothing')
})

test('a project the user sent to the basic mode stays conservative', async (t) => {
  const store = fakeStore()
  const restore = mockFetch(switchRoutes(store.state.settings))
  t.after(() => {
    store.dispose()
    restore()
  })
  await switchWithDecision(store, 'conservative')
  assert.equal(store.state.root, OTHER_ROOT, 'the project was switched')
  assert.equal(
    store.lspIndexDecision(OTHER_ROOT),
    'conservative',
    'the decision of the user is remembered for the project',
  )
  assert.equal(
    store.lspIndexDecision(ROOT),
    'unknown',
    'the decision of one project says nothing about another',
  )
})

test('a project the user sent to the basic mode keeps its decision over a switch', async (t) => {
  const store = fakeStore()
  const restore = mockFetch(switchRoutes(store.state.settings))
  t.after(() => {
    store.dispose()
    restore()
  })
  await switchWithDecision(store, 'conservative')
  // The `lsp` slice is reset on every switch - the decision may not live
  // there.
  assert.equal(store.state.lsp.state, 'idle')
  assert.equal(store.lspIndexDecision(OTHER_ROOT), 'conservative')
})

test('a project the user wants to index says build', async (t) => {
  const store = fakeStore()
  const restore = mockFetch(switchRoutes(store.state.settings))
  t.after(() => {
    store.dispose()
    restore()
  })
  await switchWithDecision(store, 'build')
  assert.equal(store.lspIndexDecision(OTHER_ROOT), 'build')
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
  const store = fakeStore({ settings: { editor: {}, shortcuts: {} } })
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
  const restore = mockFetch(switchRoutes(store.state.settings), calls)
  t.after(() => {
    store.dispose()
    restore()
  })
  await store.reconnectLsp()
  assert.equal(
    calls.some(call => call.method === 'lsp.start'),
    false,
    'the button may not start a language server behind the back of the user',
  )
})

test('the reconnect starts the server of a project that wanted one', async (t) => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch(switchRoutes(store.state.settings), calls)
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
