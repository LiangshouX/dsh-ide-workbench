/**
 * The freshness of the client status (PRD-v5 §2, §1.5, §3.3, §7.2).
 *
 *   STALE-01 — `deactivate()` does not stop the language-server poll: a
 *              workbench that is not the visible surface still has to know
 *              whether the server is alive.
 *   STALE-02 — a failed poll marks the status as stale instead of keeping
 *              the old value.
 *   STALE-03 — the progress is read in the states whose cancel the host
 *              accepts (`starting`, `building`, `restarting`).
 *   VIS-04   — a fault is announced once per fault episode, and `suspended`
 *              is not a fault.
 *   PERF-01  — the status object keeps its identity while the repository
 *              does not change, so the panels do not re-render every 2s.
 *
 * The last section is about the CLIENT session: the link between the browser
 * and the language server. The host says that the server process is up, the
 * client says whether that link works, and the two never check each other -
 * so the status bar believed the host and said "ready" while the semantic
 * features were completely dead.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkbenchStore } from '../src/client/store.js'
import {
  configureLsp,
  lspClient,
  navLabels,
  reconnectLsp,
  setLspEnabled,
  shutdownLsp,
} from '../src/client/lsp-session.js'
import { BUILD_REQUEST_TIMEOUT_MS } from '../src/host/settings-defaults.js'

const ROOT = 'C:\\work\\demo'
const OTHER_ROOT = 'C:\\work\\other'

/** Wait for the pending promises of the store. */
const tick = (ms = 10) => new Promise(resolve => { setTimeout(resolve, ms) })

/** A store with a project root, without booting the host. */
function fakeStore(options = {}) {
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new WorkbenchStore(ctx, key => key)
  store.state = {
    ...store.state,
    workspaceRoot: ROOT,
    root: options.root ?? ROOT,
    gitRepoRoot: ROOT,
    phase: 'ready',
    statusAt: 1234,
    dirs: new Map([[ROOT, { entries: [], loading: false }]]),
    settings: { editor: { openMode: 'auto', editableMaxBytes: 1 << 20 }, shortcuts: {} },
  }
  return store
}

/** A store that records the toasts it shows. */
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

/** The routes every store needs to answer the calls of a poll. */
function lspRoutes(state, extra = {}) {
  return {
    'lsp.status': () => ({ state, enabled: true, languageId: '', detail: 'because' }),
    'lsp.servers': () => ({ available: [], missing: [], disabled: [] }),
    ...extra,
  }
}

/**
 * A fake document for the tests that need one.
 *
 * The store registers its visibility listener on the document, so the fake
 * has to offer `addEventListener` and `removeEventListener` as well. It is
 * installed as `globalThis.document` and removed again by the test.
 */
function fakeDocument(visibilityState = 'visible') {
  const listeners = new Map()
  return {
    visibilityState,
    baseURI: 'http://dsh.internal/',
    addEventListener(type, handler) {
      const list = listeners.get(type) ?? []
      list.push(handler)
      listeners.set(type, list)
    },
    removeEventListener(type, handler) {
      const list = listeners.get(type) ?? []
      const index = list.indexOf(handler)
      if (index >= 0) list.splice(index, 1)
      listeners.set(type, list)
    },
    /** Fire one event. */
    emit(type) {
      for (const handler of [...(listeners.get(type) ?? [])]) handler()
    },
    /** How many listeners of one type are registered. */
    count(type) {
      return (listeners.get(type) ?? []).length
    },
  }
}

// ── STALE-01 ──────────────────────────────────────────────────────────────

test('deactivate() keeps the language-server poll running', async (t) => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch(lspRoutes('ready'), calls)
  t.after(() => {
    store.dispose()
    restore()
  })
  store.activate()
  await tick(20)
  assert.notEqual(store.lspPollTimer, null, 'the poll timer is running')
  store.deactivate()
  assert.notEqual(store.lspPollTimer, null, 'deactivate() does not stop the language-server poll')
  const before = calls.filter(call => call.method === 'lsp.status').length
  // The poll runs every two seconds; wait for one more tick of it.
  await tick(2300)
  assert.ok(
    calls.filter(call => call.method === 'lsp.status').length > before,
    'the poll keeps asking the host after deactivate()',
  )
})

test('the poll of a deactivated store still writes the status into the store', async (t) => {
  const store = fakeStore()
  const restore = mockFetch(lspRoutes('ready'))
  t.after(() => {
    store.dispose()
    restore()
  })
  store.activate()
  await tick(20)
  store.deactivate()
  await store.refreshLspStatus()
  assert.equal(store.state.lsp.state, 'ready', 'the status is not frozen on the old value')
  assert.equal(store.state.lspStatusStale, false)
})

// ── STALE-02 ──────────────────────────────────────────────────────────────

test('a failed status poll marks the status as stale', async (t) => {
  const store = fakeStore()
  let broken = true
  const restore = mockFetch({
    'lsp.status': () => {
      if (broken) throw new Error('the host is gone')
      return { state: 'ready', enabled: true }
    },
  })
  t.after(() => {
    store.dispose()
    restore()
  })
  await store.refreshLspStatus()
  assert.equal(store.state.lspStatusStale, true, 'the status is unknown after a failed poll')
  broken = false
  await store.refreshLspStatus()
  assert.equal(store.state.lspStatusStale, false, 'a successful poll clears the flag')
})

test('an unusable status answer marks the status as stale', async (t) => {
  const store = fakeStore()
  const restore = mockFetch({ 'lsp.status': () => null })
  t.after(() => {
    store.dispose()
    restore()
  })
  await store.refreshLspStatus()
  assert.equal(store.state.lspStatusStale, true)
})

// ── STALE-02 (the minimised window) ───────────────────────────────────────

test('a poll that is skipped for a hidden document does not mark the status as stale', async (t) => {
  const doc = fakeDocument('hidden')
  globalThis.document = doc
  const store = fakeStore()
  const calls = []
  const restore = mockFetch(lspRoutes('ready'), calls)
  t.after(() => {
    store.dispose()
    restore()
    delete globalThis.document
  })
  await store.pollLspStatus()
  assert.equal(
    calls.filter(call => call.method === 'lsp.status').length,
    0,
    'a hidden document does not poll',
  )
  assert.equal(
    store.state.lspStatusStale,
    false,
    'a skipped poll says nothing about the server, so it is not stale',
  )
  assert.equal(store.state.lsp.state, 'idle', 'the old snapshot is kept')
})

test('a failed poll marks the status as stale even when the document is visible', async (t) => {
  const doc = fakeDocument('visible')
  globalThis.document = doc
  const store = fakeStore()
  const restore = mockFetch({
    'lsp.status': () => { throw new Error('the host is gone') },
  })
  t.after(() => {
    store.dispose()
    restore()
    delete globalThis.document
  })
  await store.pollLspStatus()
  assert.equal(store.state.lspStatusStale, true, 'a failed poll is a stale status')
})

test('a visible document refreshes the language-server status at once', async (t) => {
  const doc = fakeDocument('hidden')
  globalThis.document = doc
  const store = fakeStore()
  const calls = []
  const restore = mockFetch(lspRoutes('ready'), calls)
  t.after(() => {
    store.dispose()
    restore()
    delete globalThis.document
  })
  await store.pollLspStatus()
  assert.equal(calls.filter(call => call.method === 'lsp.status').length, 0)
  // The window comes back: the browser throttled the timer of the hidden
  // page, so the status must not wait for the next (throttled) tick.
  doc.visibilityState = 'visible'
  doc.emit('visibilitychange')
  await tick(20)
  assert.ok(
    calls.some(call => call.method === 'lsp.status'),
    'the status is asked for again as soon as the window is visible',
  )
  assert.equal(store.state.lsp.state, 'ready', 'the mirrored status is current again')
  assert.equal(store.state.lspStatusStale, false)
})

test('a document that becomes hidden does not refresh the status', async (t) => {
  const doc = fakeDocument('visible')
  globalThis.document = doc
  const store = fakeStore()
  const calls = []
  const restore = mockFetch(lspRoutes('ready'), calls)
  t.after(() => {
    store.dispose()
    restore()
    delete globalThis.document
  })
  doc.visibilityState = 'hidden'
  doc.emit('visibilitychange')
  await tick(20)
  assert.equal(
    calls.filter(call => call.method === 'lsp.status').length,
    0,
    'a hidden window is not polled',
  )
})

test('the visibility listener is removed when the store is disposed', async (t) => {
  const doc = fakeDocument('visible')
  globalThis.document = doc
  const store = fakeStore()
  t.after(() => {
    delete globalThis.document
  })
  assert.equal(doc.count('visibilitychange'), 1, 'the listener is registered once')
  store.dispose()
  assert.equal(doc.count('visibilitychange'), 0, 'a disposed store keeps no listener')
})

// ── STALE-03 ──────────────────────────────────────────────────────────────

test('the index is read in the states whose cancel the host accepts', async (t) => {
  for (const state of ['starting', 'building', 'restarting']) {
    const store = fakeStore()
    const calls = []
    const restore = mockFetch(lspRoutes(state, {
      'lsp.index': () => ({ state, progress: 'indexing', startedAt: 1000, cancellable: true }),
    }), calls)
    await store.refreshLspStatus()
    assert.ok(
      calls.some(call => call.method === 'lsp.index'),
      `lsp.index is fetched in the ${state} state`,
    )
    assert.equal(store.state.lsp.cancellable, true, `the cancel is offered in ${state}`)
    assert.equal(store.state.lsp.progress, 'indexing')
    assert.equal(store.state.lsp.startedAt, 1000)
    restore()
  }
})

test('the index is not read in the states without a running build', async (t) => {
  for (const state of ['ready', 'idle', 'suspended']) {
    const store = fakeStore()
    const calls = []
    const restore = mockFetch(lspRoutes(state, {
      'lsp.index': () => ({ state, progress: 'indexing', startedAt: 1000, cancellable: true }),
    }), calls)
    await store.refreshLspStatus()
    assert.equal(
      calls.some(call => call.method === 'lsp.index'),
      false,
      `lsp.index is not fetched in the ${state} state`,
    )
    assert.equal(store.state.lsp.progress, '', 'the progress of the last build is cleared')
    assert.equal(store.state.lsp.startedAt, 0)
    assert.equal(store.state.lsp.cancellable, false)
    restore()
  }
})

// ── VIS-04 ────────────────────────────────────────────────────────────────

test('a fault is announced once, no matter how many signals report it', async (t) => {
  const { store, toasts } = recordingStore()
  const restore = mockFetch(lspRoutes('crashed'))
  t.after(() => {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.dispose()
    restore()
  })
  // The control event arrives first ...
  store.lspControl({ type: 'crash', root: ROOT, detail: 'the server died' })
  assert.equal(toasts.length, 1, 'the control event shows the toast')
  assert.equal(toasts[0].kind, 'error')
  assert.equal(toasts[0].text, 'lsp.crashedToast')
  // ... and the poll reports the same crash.
  await store.refreshLspStatus()
  assert.equal(toasts.length, 1, 'the poll does not repeat the toast')
  await store.refreshLspStatus()
  assert.equal(toasts.length, 1, 'the next poll does not repeat it either')
})

test('the crash, restart and degradation chain is one fault episode', async (t) => {
  const { store, toasts } = recordingStore()
  let state = 'crashed'
  const restore = mockFetch({
    'lsp.status': () => ({ state, enabled: true, detail: 'the server died' }),
  })
  t.after(() => {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.dispose()
    restore()
  })
  await store.refreshLspStatus()
  assert.equal(toasts.length, 1, 'the crash is announced')
  state = 'restarting'
  await store.refreshLspStatus()
  assert.equal(toasts.length, 1, 'the restart is not a fault')
  state = 'degraded'
  await store.refreshLspStatus()
  assert.equal(toasts.length, 1, 'the degradation belongs to the same episode')
})

test('a fault after a recovery is announced again', async (t) => {
  const { store, toasts } = recordingStore()
  let state = 'crashed'
  const restore = mockFetch({
    'lsp.status': () => ({ state, enabled: true, detail: 'the server died' }),
  })
  t.after(() => {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.dispose()
    restore()
  })
  await store.refreshLspStatus()
  assert.equal(toasts.length, 1)
  state = 'ready'
  await store.refreshLspStatus()
  assert.equal(toasts.length, 1, 'the recovery shows no toast')
  state = 'crashed'
  await store.refreshLspStatus()
  assert.equal(toasts.length, 2, 'the new fault is announced again')
})

test('a suspended server is not a fault', async (t) => {
  const { store, toasts } = recordingStore()
  const restore = mockFetch(lspRoutes('suspended'))
  t.after(() => {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.dispose()
    restore()
  })
  await store.refreshLspStatus()
  store.lspControl({ type: 'state', root: ROOT, state: 'suspended' })
  assert.equal(toasts.length, 0, 'the idle release of the server shows no toast')
  assert.equal(store.state.lsp.state, 'suspended')
})

test('a degraded control event shows the toast of the degradation', async (t) => {
  const { store, toasts } = recordingStore()
  t.after(() => {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.dispose()
  })
  store.lspControl({ type: 'degraded', root: ROOT, detail: 'the restart budget is used up' })
  assert.equal(toasts.length, 1)
  assert.equal(toasts[0].kind, 'error')
  // A degradation is not an exit: the server may be switched off in the
  // settings, missing, or refused for lack of memory. "The language server
  // exited" would be a lie in those cases, so the degradation has its own
  // title (PRD-v5 §1.5 VIS-04).
  assert.equal(toasts[0].text, 'lsp.degradedToast')
  assert.notEqual(toasts[0].text, 'lsp.crashedToast', 'the degradation does not claim that the server exited')
  // The body of the toast is localized: the host has no locale, so its
  // detail is an English technical sentence that must not be the text the
  // user reads.
  assert.equal(toasts[0].detail, 'lsp.crashedGeneric', 'the body is the localized advice')
  assert.notEqual(toasts[0].detail, 'the restart budget is used up', 'the raw detail is not the body')
  // The technical reason stays reachable: it is the detail of the mirrored
  // status, and the status bar shows it in its tooltip.
  assert.equal(store.state.lsp.detail, 'the restart budget is used up', 'the raw detail is kept')
})

test('the body of a degradation is the localized advice of its reason', async (t) => {
  const cases = [
    ['3 request timeouts, the restart budget is used up', 'lsp.crashedTimeout'],
    ['the machine ran out of memory', 'lsp.crashedMemory'],
    ['out of memory while the program was built', 'lsp.crashedMemory'],
    ['the restart budget is used up', 'lsp.crashedGeneric'],
  ]
  for (const [detail, advice] of cases) {
    const { store, toasts } = recordingStore()
    const restore = mockFetch(lspRoutes('degraded'))
    store.lspControl({ type: 'degraded', root: ROOT, detail })
    assert.equal(toasts.length, 1, 'the degradation is announced')
    assert.equal(toasts[0].text, 'lsp.degradedToast', 'the title is the degradation')
    assert.equal(toasts[0].detail, advice, `the reason "${detail}" is classified as ${advice}`)
    assert.ok(
      !toasts[0].detail.includes(detail),
      'the body of the toast is not the English detail of the host',
    )
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.dispose()
    restore()
  }
})

test('a degradation reported by the poll has a localized body too', async (t) => {
  const { store, toasts } = recordingStore()
  const restore = mockFetch({
    'lsp.status': () => ({
      state: 'degraded',
      enabled: true,
      detail: 'the language server stopped unexpectedly (3 request timeouts)',
    }),
  })
  t.after(() => {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.dispose()
    restore()
  })
  await store.refreshLspStatus()
  assert.equal(toasts.length, 1)
  assert.equal(toasts[0].text, 'lsp.degradedToast')
  assert.equal(toasts[0].detail, 'lsp.crashedTimeout', 'the timeout is classified as a timeout')
})

test('an unknown control event is ignored', async (t) => {
  const { store, toasts } = recordingStore()
  t.after(() => {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.dispose()
  })
  const mirrored = store.state.lsp.state
  // The host sends these over the same socket; only the crash and the
  // degradation are faults.
  store.lspControl({ type: 'state', root: ROOT, state: 'ready' })
  store.lspControl({ type: 'ready', root: ROOT })
  store.lspControl({ type: 'idle', root: ROOT })
  store.lspControl({ type: 'didClose', uri: 'file:///work/demo/a.ts' })
  store.lspControl({ type: 'cancelled', root: ROOT })
  assert.equal(toasts.length, 0, 'no toast for an informational event')
  assert.equal(store.state.lsp.state, mirrored, 'the poll owns the mirrored status')
  assert.deepEqual(store.state.tabs, [], 'the editor state is untouched')
})

test('a control event of another project is ignored', async (t) => {
  const { store, toasts } = recordingStore()
  t.after(() => {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.dispose()
  })
  store.lspControl({ type: 'crash', root: OTHER_ROOT, detail: 'the server died' })
  assert.equal(toasts.length, 0, 'a fault of a background project is noise')
})

test('a broken toast does not break the control event', async (t) => {
  const { store } = recordingStore()
  t.after(() => {
    store.dispose()
  })
  store.toast = () => { throw new Error('the toast is broken') }
  assert.doesNotThrow(
    () => store.lspControl({ type: 'crash', root: ROOT, detail: 'the server died' }),
    'the control event never throws',
  )
})

// ── IDLE-02 (the navigation menu) ─────────────────────────────────────────

test('the semantic navigation stays available while the server sleeps', async (t) => {
  const store = fakeStore()
  t.after(() => {
    store.dispose()
  })
  const stateOf = (state) => {
    store.state.lsp = { ...store.state.lsp, state }
    return store.semanticNavigation().findUsages
  }
  assert.equal(stateOf('ready').enabled, true, 'a running server is available')
  assert.equal(stateOf('suspended').enabled, true, 'a sleeping server wakes up on demand')
  assert.equal(stateOf('suspended').reason, '', 'a sleeping server has no reason to show')
  assert.equal(stateOf('idle').enabled, false, 'a server that never ran cannot be woken')
  assert.equal(stateOf('degraded').enabled, false, 'a fault is not available')
  assert.equal(stateOf('failed').enabled, false, 'a failed start is not available')
  assert.equal(stateOf('disabled').enabled, false, 'the feature is switched off')
})

// ── PERF-01 ───────────────────────────────────────────────────────────────

test('the status object keeps its identity while the repository does not change', async (t) => {
  const store = fakeStore()
  const restore = mockFetch({
    'git.status': () => ({ isRepo: true, branch: 'main', entries: [], subprocesses: 1 }),
  })
  t.after(() => {
    store.dispose()
    restore()
  })
  await store.refreshStatus({ force: true })
  const first = store.state.status
  await store.refreshStatus({ force: true })
  assert.equal(store.state.status, first, 'the status object is the same one')
  assert.equal(store.state.status.entries, first.entries, 'the entry list is the same one')
  await store.refreshStatus({ force: true })
  assert.equal(store.state.status, first)
})

test('the status object changes when a file changes', async (t) => {
  const store = fakeStore()
  let entries = []
  const restore = mockFetch({
    'git.status': () => ({ isRepo: true, branch: 'main', entries, subprocesses: 1 }),
  })
  t.after(() => {
    store.dispose()
    restore()
  })
  await store.refreshStatus({ force: true })
  const first = store.state.status
  entries = [{
    path: 'a.txt',
    xy: '??',
    untracked: true,
    staged: false,
    unstaged: false,
    ignored: false,
  }]
  await store.refreshStatus({ force: true })
  assert.notEqual(store.state.status, first, 'a new file is a new snapshot')
  assert.equal(store.state.status.entries.length, 1)
})

test('the status object changes when the branch or the file status changes', async (t) => {
  const store = fakeStore()
  let branch = 'main'
  let entries = []
  const restore = mockFetch({
    'git.status': () => ({ isRepo: true, branch, entries, subprocesses: 1 }),
  })
  t.after(() => {
    store.dispose()
    restore()
  })
  await store.refreshStatus({ force: true })
  const first = store.state.status
  // The path set did not change - the branch did.
  branch = 'feature'
  await store.refreshStatus({ force: true })
  assert.notEqual(store.state.status, first, 'the branch is part of the snapshot')
  const second = store.state.status
  // The path set did not change - the status of the file did.
  entries = [{
    path: 'a.txt',
    xy: 'M.',
    untracked: false,
    staged: true,
    unstaged: false,
    ignored: false,
  }]
  await store.refreshStatus({ force: true })
  assert.notEqual(store.state.status, second, 'the per-file status is part of the snapshot')
})

test('the snapshot timestamp moves while the status object stays', async (t) => {
  const store = fakeStore()
  const restore = mockFetch({
    'git.status': () => ({ isRepo: true, branch: 'main', entries: [], subprocesses: 1 }),
  })
  t.after(() => {
    store.dispose()
    restore()
  })
  await store.refreshStatus({ force: true })
  const first = store.state.status
  const at = store.state.statusAt
  await new Promise(resolve => { setTimeout(resolve, 5) })
  await store.refreshStatus({ force: true })
  assert.equal(store.state.status, first, 'the status object did not move')
  assert.ok(store.state.statusAt > at, 'the snapshot is as fresh as the poll says')
})

// ── the rebuild button (MEM-04) ───────────────────────────────────────────

/** The memory snapshot of a machine whose free memory is tight. */
const TIGHT_RESOURCES = {
  freeBytes: 100 * 1024 * 1024,
  needMB: 200,
  canIndex: true,
  tight: true,
}

/**
 * A store whose memory snapshot is the given one.
 * @param {object|null} resources the snapshot the client holds
 * @returns {any} the store
 */
function storeWithResources(resources) {
  const store = fakeStore()
  store.state = { ...store.state, lsp: { ...store.state.lsp, resources } }
  return store
}

test('the rebuild button starts the server anyway when the memory is tight', async (t) => {
  const store = storeWithResources(TIGHT_RESOURCES)
  const calls = []
  const restore = mockFetch(lspRoutes('degraded'), calls)
  t.after(() => {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.dispose()
    restore()
  })
  await store.restartLsp()
  const start = calls.find(call => call.method === 'lsp.start')
  assert.ok(start, 'the server is started again')
  assert.equal(
    start.body.force,
    true,
    'the memory was the blocker, so the start is forced («仍然启动» = start anyway)',
  )
  const shutdown = calls.find(call => call.method === 'lsp.shutdown')
  assert.ok(
    calls.indexOf(shutdown) < calls.indexOf(start),
    'the old session is shut down before the new one starts',
  )
})

test('the rebuild button does not force the start when the memory is not the blocker', async (t) => {
  for (const resources of [
    { ...TIGHT_RESOURCES, tight: false },
    null,
  ]) {
    const store = storeWithResources(resources)
    const calls = []
    const restore = mockFetch(lspRoutes('degraded'), calls)
    await store.restartLsp()
    const start = calls.find(call => call.method === 'lsp.start')
    assert.ok(start, 'the server is started again')
    assert.equal(
      start.body.force,
      false,
      'a missing server or a crash must not bypass the memory gate',
    )
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.dispose()
    restore()
  }
})

// ── the scope of the program (SCOPE-01) ────────────────────────────────────

test('the mirrored status carries the scope root of the program', async (t) => {
  const store = fakeStore()
  const restore = mockFetch({
    'lsp.status': () => ({
      state: 'ready',
      enabled: true,
      scopeRoot: 'C:\\work\\demo\\packages\\app',
    }),
  })
  t.after(() => {
    store.dispose()
    restore()
  })
  await store.refreshLspStatus()
  assert.equal(
    store.state.lsp.scopeRoot,
    'C:\\work\\demo\\packages\\app',
    'the scope root of the host is mirrored',
  )
})

test('the mirrored scope root is null when the host reports none', async (t) => {
  const store = fakeStore()
  const restore = mockFetch(lspRoutes('ready'))
  t.after(() => {
    store.dispose()
    restore()
  })
  await store.refreshLspStatus()
  assert.equal(store.state.lsp.scopeRoot, null, 'the field is null, never undefined')
  assert.equal(typeof store.state.lsp.scopeRoot, 'object')
})

test('a changed scope root updates the mirrored status', async (t) => {
  let scopeRoot = 'C:\\work\\demo'
  const store = fakeStore()
  const restore = mockFetch({
    'lsp.status': () => ({ state: 'ready', enabled: true, scopeRoot }),
  })
  t.after(() => {
    store.dispose()
    restore()
  })
  await store.refreshLspStatus()
  const first = store.state.lsp
  assert.equal(first.scopeRoot, 'C:\\work\\demo')
  scopeRoot = 'C:\\work\\demo\\packages\\app'
  await store.refreshLspStatus()
  assert.notEqual(store.state.lsp, first, 'a new scope is a new snapshot')
  assert.equal(store.state.lsp.scopeRoot, 'C:\\work\\demo\\packages\\app')
})

// ── the client session (the link to the language server) ───────────────────
//
// The host says that the language server PROCESS is up; the client says
// whether the link between the browser and the server works. The two never
// check each other, and the status bar believed the host: it said "ready"
// while the semantic features were completely dead.

/**
 * One fake WebSocket for the client session.
 *
 * It answers every request, so no request ever runs into its timeout - a
 * timeout would be an unhandled rejection at the end of the test run, and
 * the budget of ten minutes would keep the process alive for ten minutes.
 */
class FakeSocket {
  constructor(url) {
    this.url = url
    this.readyState = 1
    this.sent = []
    this.handlers = new Map()
    FakeSocket.instances.push(this)
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
    const result = parsed.method === 'initialize' ? { capabilities: {} } : null
    this.emit('message', {
      data: JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result }),
    })
  }

  close() { this.readyState = 3 }
}
FakeSocket.instances = []

/**
 * Run one piece of code with a fake WebSocket and a client session.
 *
 * The session is a module of its own, so the socket and the session are
 * installed for the case and removed again afterwards.
 * @param {(store: any) => Promise<void>} run the code of the case
 * @returns {Promise<void>}
 */
async function withSession(run) {
  const originalWebSocket = globalThis.WebSocket
  globalThis.WebSocket = FakeSocket
  try {
    await run()
  } finally {
    // The store is unbound and the client is stopped, and the feature is
    // switched on again: `shutdownLsp()` alone would leave the session off
    // for good, and the next case would find no client at all.
    configureLsp(null)
    shutdownLsp()
    setLspEnabled(true)
    globalThis.WebSocket = originalWebSocket
  }
}

/**
 * The store of a session: the settings carry a language server that is on.
 * @returns {any} the store
 */
function sessionStore() {
  const store = fakeStore()
  store.state = {
    ...store.state,
    settings: {
      editor: { openMode: 'auto', editableMaxBytes: 1 << 20 },
      shortcuts: {},
      lsp: { enabled: true, requestTimeoutMs: 45000 },
    },
  }
  return store
}

test('the state of the client session is mirrored into the store', async (t) => {
  const { store, toasts } = recordingStore()
  t.after(() => {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.dispose()
  })
  assert.equal(store.state.lsp.clientState, 'starting', 'the session starts')
  assert.equal(store.state.lsp.clientDetail, '')
  store.lspSessionState('ready')
  assert.equal(store.state.lsp.clientState, 'ready')
  store.lspSessionState('failed', 'the handshake timed out')
  assert.equal(store.state.lsp.clientState, 'failed')
  assert.equal(store.state.lsp.clientDetail, 'the handshake timed out', 'the reason is mirrored')
  assert.equal(toasts.length, 1, 'the failure is announced')
})

test('a dead client session is announced with one toast per episode', async (t) => {
  const { store, toasts } = recordingStore()
  t.after(() => {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.dispose()
  })
  store.lspSessionState('failed', 'the handshake timed out')
  assert.equal(toasts.length, 1, 'the failure is announced')
  assert.equal(toasts[0].kind, 'error')
  assert.equal(toasts[0].text, 'lsp.sessionFailedToast', 'the toast is localized')
  store.lspSessionState('failed', 'the handshake timed out')
  assert.equal(toasts.length, 1, 'the same episode does not toast again')
  // The session works again: the next failure is a new episode.
  store.lspSessionState('ready')
  assert.equal(toasts.length, 1, 'the recovery shows no toast')
  store.lspSessionState('failed', 'the handshake timed out')
  assert.equal(toasts.length, 2, 'the new failure is announced again')
})

test('the handshake gets a short budget and the semantic requests the long one', async () => {
  await withSession(async () => {
    const store = sessionStore()
    configureLsp(store)
    const client = lspClient()
    assert.ok(client !== null, 'the session started a client')
    // The budget that was in effect when the request was CREATED: the
    // library reads `client.timeout` exactly there.
    const budgets = []
    const original = client.requestInner.bind(client)
    client.requestInner = (method, params, mapped) => {
      budgets.push({ method, timeout: client.timeout })
      return original(method, params, mapped)
    }
    // A new handshake: the reconnect repeats it.
    reconnectLsp()
    const handshake = budgets.find(entry => entry.method === 'initialize')
    assert.ok(handshake, 'the handshake was repeated')
    assert.equal(
      handshake.timeout,
      30000,
      'the handshake must not wait for the budget of the program build',
    )
    // The semantic request is the one that builds the program: it needs the
    // long budget.
    await client.request('textDocument/hover', {
      textDocument: { uri: 'file:///C:/work/demo/a.ts' },
      position: { line: 0, character: 0 },
    })
    const hover = budgets.find(entry => entry.method === 'textDocument/hover')
    assert.equal(
      hover.timeout,
      BUILD_REQUEST_TIMEOUT_MS,
      'the program build may take ten minutes',
    )
  })
})

test('the session reports its state to the store', async () => {
  await withSession(async () => {
    const store = sessionStore()
    configureLsp(store)
    // The handshake is not resolved yet: the session is starting.
    assert.equal(store.state.lsp.clientState, 'starting', 'the session is starting')
    await tick(20)
    assert.equal(store.state.lsp.clientState, 'ready', 'the handshake resolved')
  })
})

test('the menu says why the semantic entries are greyed out', async () => {
  await withSession(async () => {
    const store = sessionStore()
    configureLsp(store)
    assert.equal(
      navLabels().semanticUnavailable,
      'nav.semanticSessionUnavailable',
      'the session is not ready: the reason is the session, not the server',
    )
    await tick(20)
    assert.equal(
      navLabels().semanticUnavailable,
      'nav.semanticUnavailable',
      'the session is ready: the old reason is the right one again',
    )
  })
})

test('the reconnect repeats the handshake and restarts the server of the host', async (t) => {
  await withSession(async () => {
    const store = recordingStore().store
    const calls = []
    const restore = mockFetch(lspRoutes('ready'), calls)
    t.after(() => {
      if (store.toastTimer !== null) clearTimeout(store.toastTimer)
      store.dispose()
      restore()
    })
    configureLsp(store)
    await tick(20)
    const socket = FakeSocket.instances[FakeSocket.instances.length - 1]
    const handshakesBefore = socket.sent.filter(text => String(text).includes('"initialize"')).length
    // The states of the session are recorded: the reconnect has to start the
    // session again, and the handshake has to resolve again.
    const states = []
    const report = store.lspSessionState.bind(store)
    store.lspSessionState = (state, detail) => {
      states.push(state)
      report(state, detail)
    }
    await store.reconnectLsp()
    const handshakes = socket.sent.filter(text => String(text).includes('"initialize"')).length
    assert.ok(handshakes > handshakesBefore, 'the client sends a new handshake')
    assert.ok(states.includes('starting'), 'the session is connecting again')
    assert.ok(states.includes('ready'), 'the new handshake resolved')
    assert.equal(store.state.lsp.clientState, 'ready', 'the session works again')
    const methods = calls.map(call => call.method)
    assert.ok(methods.includes('lsp.shutdown'), 'the old server is stopped')
    assert.ok(methods.includes('lsp.start'), 'a new server is started')
    assert.ok(
      methods.indexOf('lsp.shutdown') < methods.indexOf('lsp.start'),
      'the old server is stopped before the new one starts',
    )
  })
})
