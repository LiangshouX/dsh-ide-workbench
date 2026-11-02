import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The client bundle publishes the development counters on `window`; the module
// needs a window to attach them to.
globalThis.window = globalThis

const { StoreCache, WorkbenchStore, perfCounters } = await import('../src/client/store.js')
const { listDirectory } = await import('../src/host/workspace.js')
const { gitProcessCount, status: gitStatus } = await import('../src/host/git.js')

const ROOT = 'C:\\work\\demo'

/** Minimal store without booting the host. */
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
    settings: {
      editor: { openMode: 'auto', editableMaxBytes: 1 << 20, markdownPreview: true },
      shortcuts: {},
    },
  }
  return store
}

/** Install a fetch mock; `routes` maps method → (body) => value (or throws). */
function mockFetch(routes, calls = []) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/ide-workbench/api/')[1]
    const body = JSON.parse(init.body)
    calls.push({ method, body })
    const route = routes[method]
    if (route === undefined) throw new Error(`unexpected ${method}`)
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

const tick = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms))

test('an equal-value patch replaces nothing and notifies nobody', () => {
  const store = fakeStore()
  let notified = 0
  store.subscribe(() => { notified += 1 })
  const before = store.getSnapshot()
  store.set({ filter: '' })
  // The state object is untouched, so no subscriber is woken.
  assert.equal(store.getSnapshot(), before)
  assert.equal(notified, 0)
  store.set({ filter: 'src' })
  assert.equal(notified, 1)
  assert.equal(store.state.filter, 'src')
  // The same value again is still nothing.
  store.set({ filter: 'src' })
  assert.equal(notified, 1)
  store.persist.cancel()
})

test('a patch that changes one key notifies exactly once', () => {
  const store = fakeStore()
  let notified = 0
  store.subscribe(() => { notified += 1 })
  store.set({ quickOpen: true, quickOpenQuery: '', quickOpenIndex: 0 })
  assert.equal(notified, 1)
  store.set({ quickOpen: true })
  assert.equal(notified, 1)
  store.set({ quickOpen: false })
  assert.equal(notified, 2)
  store.persist.cancel()
})

test('a slice subscription only notifies when the selected slice changes', () => {
  const store = fakeStore()
  let notified = 0
  store.subscribeSlice(state => state.filter, () => { notified += 1 })
  store.set({ filter: 'src' })
  assert.equal(notified, 1)
  // The same slice value: the subscriber is woken, but it does not notify.
  store.set({ filter: 'src' })
  assert.equal(notified, 1)
  // An unrelated field leaves the slice alone.
  store.set({ quickOpen: true })
  assert.equal(notified, 1)
  store.set({ filter: 'lib' })
  assert.equal(notified, 2)
  store.persist.cancel()
})

test('the notify counter follows the state changes', () => {
  const store = fakeStore()
  const before = perfCounters.notify
  store.set({ filter: 'src' })
  store.set({ filter: 'src' })
  assert.equal(perfCounters.notify, before + 1)
  store.persist.cancel()
})

test('at most three workspace stores stay resident', () => {
  const cache = new StoreCache({ limit: 3 })
  const deactivated = []
  for (let index = 0; index < 10; index += 1) {
    cache.set(`workspace:${index}`, { deactivate: () => { deactivated.push(index) } }, `s${index}`)
  }
  assert.equal(cache.size, 3)
  // The seven oldest workspaces were deactivated before they were dropped.
  assert.equal(deactivated.length, 7)
  assert.deepEqual(deactivated, [0, 1, 2, 3, 4, 5, 6])
  assert.ok(cache.stores.has('workspace:9'))
})

test('a workspace with a mounted Session keeps its store', () => {
  const cache = new StoreCache({ limit: 3, isMounted: sessionId => sessionId === 's0' })
  for (let index = 0; index < 10; index += 1) {
    cache.set(`workspace:${index}`, { deactivate: () => {} }, `s${index}`)
  }
  assert.equal(cache.size, 3)
  assert.ok(cache.stores.has('workspace:0'))
})

test('a second Session of the same workspace is known before the eviction', () => {
  const mounted = new Set(['s2'])
  const cache = new StoreCache({ limit: 1, isMounted: sessionId => mounted.has(sessionId) })
  const store = { deactivate: () => {} }
  // Both Sessions share one workspace key: the store is created once.
  cache.set('workspace:shared', store, 's1')
  // The second Session asks for the same store; it must be recorded too.
  assert.equal(cache.get('workspace:shared'), store)
  cache.claim('workspace:shared', 's2')
  // A second workspace pushes the cache over its limit, but the shared store
  // survives: its second Session is still mounted.
  cache.set('workspace:other', { deactivate: () => {} }, 's3')
  assert.ok(cache.stores.has('workspace:shared'), 'the mounted Session keeps the store')
  // Once neither Session is mounted, the store may go.
  mounted.delete('s2')
  cache.set('workspace:third', { deactivate: () => {} }, 's4')
  assert.equal(cache.stores.has('workspace:shared'), false, 'the unused store is evicted')
})

test('a hot workspace comes back without a single git call', async (t) => {
  const store = fakeStore()
  store.state.statusAt = 1234
  const calls = []
  const restore = mockFetch({
    'git.status': () => ({ isRepo: true, entries: [], subprocesses: 1 }),
    'settings.update': () => ({ value: {} }),
  }, calls)
  t.after(() => {
    store.deactivate()
    restore()
  })
  store.activate()
  await tick(30)
  assert.deepEqual(calls.filter(call => call.method === 'git.status'), [])
  // The cached snapshot is reused and marked stale for the background poll.
  assert.equal(store.state.statusStale, true)
  store.persist.cancel()
})

test('a cold workspace fetches its status once', async (t) => {
  const store = fakeStore()
  store.state.statusAt = 0
  const calls = []
  const restore = mockFetch({
    'git.status': () => ({ isRepo: true, entries: [], subprocesses: 1 }),
    'settings.update': () => ({ value: {} }),
  }, calls)
  t.after(() => {
    store.deactivate()
    restore()
  })
  store.activate()
  await tick(30)
  assert.equal(calls.filter(call => call.method === 'git.status').length, 1)
  store.persist.cancel()
})

test('the status call asks for the line counts only while the Commit window shows', async (t) => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch({
    'git.status': () => ({ isRepo: true, entries: [], subprocesses: 1 }),
    'settings.update': () => ({ value: {} }),
  }, calls)
  t.after(() => {
    store.deactivate()
    restore()
  })
  await store.refreshStatus({ force: true })
  assert.equal(calls[0].body.numstat, false)
  store.showTool('commit')
  await store.refreshStatus({ force: true })
  assert.equal(calls[1].body.numstat, true)
  store.persist.cancel()
})

test('committing forces a fresh status snapshot first', async () => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch({
    'git.status': () => ({ isRepo: true, entries: [], subprocesses: 1 }),
    'git.commit': () => ({ hash: 'abc1234' }),
    'git.messages': () => ({ messages: [] }),
    'git.log': () => ({ commits: [], hasMore: false }),
    'settings.update': () => ({ value: {} }),
  }, calls)
  try {
    await store.commit('a message', false, false)
    const methods = calls.map(call => call.method)
    const status = methods.indexOf('git.status')
    const commit = methods.indexOf('git.commit')
    assert.ok(status >= 0 && commit >= 0)
    assert.ok(status < commit, 'the status is refreshed before the commit')
  } finally {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.persist.cancel()
    restore()
  }
})

test('the directory listing reads one directory without statting every entry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'iwb-tree-'))
  try {
    await mkdir(join(dir, 'sub'))
    for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) {
      await writeFile(join(dir, name), name)
    }
    try {
      await symlink(join(dir, 'sub'), join(dir, 'link'), 'junction')
    } catch {
      // A host without symlink support still lists the plain files.
    }
    const counts = { readdir: 0, stat: 0, lstat: 0 }
    const counting = {
      readdir: async (...args) => { counts.readdir += 1; return fsp.readdir(...args) },
      stat: async (...args) => { counts.stat += 1; return fsp.stat(...args) },
      lstat: async (...args) => { counts.lstat += 1; return fsp.lstat(...args) },
    }
    const listing = await listDirectory(dir, dir, { fs: counting })
    assert.equal(counts.readdir, 1)
    // The tree does not read the size or the mtime of an entry, so no entry
    // is stat'ed; only a symlink still costs one call.
    assert.equal(counts.lstat, 0)
    assert.equal(counts.stat, listing.entries.some(entry => entry.isSymlink) ? 1 : 0)
    assert.equal(listing.entries.length, 6)
    for (const entry of listing.entries) {
      assert.equal(entry.size, undefined)
      assert.equal(entry.mtimeMs, undefined)
    }
    // A symlink to a directory is still a directory row.
    const link = listing.entries.find(entry => entry.name === 'link')
    if (link !== undefined) assert.equal(link.isDir, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('one status snapshot costs one git subprocess without the line counts', async (t) => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
  } catch {
    t.skip('git is not installed')
    return
  }
  const dir = await mkdtemp(join(tmpdir(), 'iwb-status-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'IDE Test')
    git('config', 'user.email', 'ide@test.local')
    git('config', 'commit.gpgsign', 'false')
    await writeFile(join(dir, 'a.txt'), 'a\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'base')
    const root = await fsp.realpath(dir)
    const env = { root, gitPath: '', repoRoot: root }
    const before = gitProcessCount()
    const plain = await gitStatus(env, { ignored: false, numstat: false })
    assert.equal(plain.subprocesses, 1)
    assert.equal(gitProcessCount() - before, 1)
    // The Commit window asks for the line counts: two more subprocesses.
    const counted = await gitStatus(env, { ignored: false, numstat: true })
    assert.equal(counted.subprocesses, 3)
    assert.equal(gitProcessCount() - before, 4)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the development counters are exposed, and a production build disables them', async () => {
  assert.notEqual(perfCounters, null)
  assert.equal(globalThis.window.__iwbPerf, perfCounters)
  const original = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    const production = await import('../src/client/store.js?production')
    assert.equal(production.perfCounters, null)
  } finally {
    if (original === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = original
  }
})
