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
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkbenchStore } from '../src/client/store.js'

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
  assert.equal(toasts[0].detail, 'the restart budget is used up')
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
