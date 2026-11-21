/**
 * The poll of the client must not wake the panels.
 *
 * The store wrote the status on every poll - the timestamp of the snapshot
 * moved, the state object was replaced, every subscriber of the workbench
 * woke up, and the whole panel was rebuilt every two seconds. The host now
 * answers "nothing changed" instead of shipping the snapshot again, and the
 * client writes NOTHING for such an answer.
 *
 * The gates are behavioural and free of any clock: they count the writes and
 * the notifications.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

// The client bundle publishes the development counters on `window`; the module
// needs a window to attach them to.
globalThis.window = globalThis

const { WorkbenchStore } = await import('../src/client/store.js')
const ROOT = 'C:\\work\\demo'

/** A store with a workspace, without the host. */
function fakeStore() {
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new WorkbenchStore(ctx, key => key)
  store.state = {
    ...store.state,
    workspaceRoot: ROOT,
    root: ROOT,
    phase: 'ready',
    statusAt: 0,
    dirs: new Map([[ROOT, { entries: [], loading: false }]]),
    settings: { editor: {}, shortcuts: {} },
  }
  return store
}

/** Install a fetch mock; `routes` maps method → (body) => value. */
function mockFetch(routes, calls = []) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/ide-workbench/api/')[1]
    const body = JSON.parse(init.body)
    calls.push({ method, body })
    const route = routes[method]
    if (route === undefined) throw new Error(`unexpected ${method}`)
    const value = await route(body)
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  return () => { globalThis.fetch = original }
}

test('a poll that finds nothing changed writes nothing', async (t) => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch({
    'git.status': () => ({ unchanged: true, revision: 7 }),
    'settings.update': () => ({ value: {} }),
  }, calls)
  t.after(() => {
    store.deactivate()
    restore()
  })
  let notified = 0
  store.subscribe(() => { notified += 1 })
  const before = store.getSnapshot()
  await store.refreshStatus({ silent: true })
  // Nothing was written: the state object is the very same one, and nobody
  // was woken. A poll that writes rebuilds the whole workbench every two
  // seconds.
  assert.equal(store.getSnapshot(), before, 'the state must not be replaced')
  assert.equal(notified, 0, 'the subscribers must not be woken')
  assert.equal(store.statusRevision, 7, 'the client keeps the revision of the host')
  store.persist.cancel()
})

test('the background poll names the revision it holds', async (t) => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch({
    'git.status': () => ({ unchanged: true, revision: 7 }),
    'settings.update': () => ({ value: {} }),
  }, calls)
  t.after(() => {
    store.deactivate()
    restore()
  })
  await store.refreshStatus({ silent: true })
  const status = calls.find(call => call.method === 'git.status')
  assert.ok(status !== undefined)
  assert.equal(status.body.since, 0, 'the first poll holds no revision yet')
  // The client learned the revision of the host.
  await store.refreshStatus({ silent: true })
  const second = calls.filter(call => call.method === 'git.status')[1]
  assert.equal(second.body.since, 7, 'the poll names the revision it holds')
  store.persist.cancel()
})

test('an explicit refresh asks for a new snapshot', async (t) => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch({
    'git.status': () => ({ isRepo: true, entries: [], subprocesses: 1, revision: 3 }),
    'settings.update': () => ({ value: {} }),
  }, calls)
  t.after(() => {
    store.deactivate()
    restore()
  })
  await store.refreshStatus({ silent: true })
  await store.refreshStatus({ initial: false })
  await store.refreshStatus({ silent: true, force: true })
  const requests = calls.filter(call => call.method === 'git.status')
  assert.equal(requests.length, 3)
  // The background poll may take the snapshot the host already has.
  assert.equal(requests[0].body.since, 0)
  // An explicit refresh wants the state of THIS moment: it must not name the
  // revision it holds, or it would take a stale snapshot.
  assert.equal('since' in requests[1].body, false, 'an explicit refresh takes no revision')
  assert.equal('since' in requests[2].body, false, 'a forced refresh takes no revision')
  store.persist.cancel()
})

test('a snapshot that says the same thing keeps the object of the panels', async (t) => {
  const store = fakeStore()
  const calls = []
  const snapshot = { isRepo: true, entries: [{ path: 'a.ts', xy: '.M', staged: false, unstaged: true }], revision: 5 }
  const restore = mockFetch({
    'git.status': () => snapshot,
    'settings.update': () => ({ value: {} }),
  }, calls)
  t.after(() => {
    store.deactivate()
    restore()
  })
  await store.refreshStatus({ initial: true })
  const first = store.state.status
  await store.refreshStatus({ initial: true })
  assert.equal(store.state.status, first, 'the panels keep their object')
  store.persist.cancel()
})
