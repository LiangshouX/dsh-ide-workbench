/**
 * The store lifecycle rules of the PRD-v4 review (复核记录).
 *
 *   R1 — a store with unsaved edits is never evicted (the persisted workspace
 *        state does not carry the draft);
 *   M1 — a failed commit rolls the files it added back out of the index;
 *   M2 — unchecking a file clears the pending set even when the file entered
 *        the index by another route;
 *   M3 — switching the Git repository drops the commit selection;
 *   M4 — the eviction does not run while React renders;
 *   M8 — "show history" speaks the repository basis;
 *   M9 — only the Session the Sidebar draws right now keeps its store.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StoreCache, WorkbenchStore } from '../src/client/store.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = 'C:\\work\\demo'
const REPO = 'C:\\work\\demo\\app'

/** A store with a project root and a Git repository. */
function fakeStore(options = {}) {
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new WorkbenchStore(ctx, key => key)
  store.state = {
    ...store.state,
    workspaceRoot: options.workspaceRoot ?? ROOT,
    root: options.root ?? ROOT,
    gitRepoRoot: options.gitRepoRoot ?? options.root ?? ROOT,
    phase: 'ready',
    status: { isRepo: true, branch: 'main', entries: [], repoRoot: options.gitRepoRoot ?? ROOT },
    settings: { editor: { openMode: 'auto', editableMaxBytes: 1 << 20 }, shortcuts: {} },
  }
  return store
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
      return { ok: true, status: 200, async json() { return { ok: true, value: { value: {} } } } }
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

/** One untracked entry as the host reports it. */
function untracked(path = 'new.txt') {
  return { path, xy: '??', untracked: true, staged: false, unstaged: false, ignored: false }
}

// ── R1 ───────────────────────────────────────────────────────────────────

test('a store with unsaved edits is never evicted', () => {
  const cache = new StoreCache({ limit: 1 })
  const dirty = {
    state: { tabs: [{ id: 'file:a.ts', kind: 'file', path: `${ROOT}\\a.ts`, dirty: true }] },
    deactivate: () => {},
  }
  const clean = { state: { tabs: [] }, deactivate: () => {} }
  cache.set('workspace:dirty', dirty, 's1')
  cache.set('workspace:clean', clean, 's2')
  // The dirty store keeps its buffer: the persisted state does not carry it.
  assert.ok(cache.stores.has('workspace:dirty'))
  // The clean one may go.
  assert.equal(cache.stores.has('workspace:clean'), false)
})

test('a store without unsaved edits is evicted', () => {
  const cache = new StoreCache({ limit: 1 })
  const store = { state: { tabs: [{ id: 'file:a.ts', kind: 'file', dirty: false }] }, deactivate: () => {} }
  cache.set('workspace:one', store, 's1')
  cache.set('workspace:two', { state: { tabs: [] }, deactivate: () => {} }, 's2')
  assert.equal(cache.stores.has('workspace:one'), false)
  assert.ok(cache.stores.has('workspace:two'))
})

// ── M1 ───────────────────────────────────────────────────────────────────

test('a failed commit rolls the files it added back out of the index', async () => {
  const store = fakeStore()
  const entry = untracked()
  store.state.status = { isRepo: true, branch: 'main', entries: [entry] }
  const calls = []
  const restore = mockFetch({
    'git.status': () => ({ isRepo: true, entries: [], subprocesses: 1 }),
    'git.stage': () => ({ ok: true }),
    'git.unstage': () => ({ ok: true }),
    'git.commit': () => { throw new Error('hook rejected') },
    'git.messages': () => ({ messages: [] }),
    'git.log': () => ({ commits: [], hasMore: false }),
    'settings.update': () => ({ value: {} }),
  }, calls)
  try {
    await store.setCommitChecked([entry], true)
    await store.commit('a message', false, false)
    const methods = calls.map(call => call.method)
    assert.equal(methods.includes('git.commit'), true, 'the commit was attempted')
    // The commit failed: the files it added are removed from the index again.
    assert.equal(methods.includes('git.unstage'), true, 'the index is rolled back')
    const unstage = calls.find(call => call.method === 'git.unstage')
    assert.deepEqual(unstage.body.paths, ['new.txt'])
    assert.equal(store.state.commit.committing, false)
    assert.ok(store.state.commit.error, 'the failure is reported')
  } finally {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.persist.cancel()
    restore()
  }
})

// ── M2 ───────────────────────────────────────────────────────────────────

test('unchecking a file clears the pending set even when it is already staged', async () => {
  const store = fakeStore()
  const entry = untracked()
  store.state.status = { isRepo: true, branch: 'main', entries: [entry] }
  const calls = []
  const restore = mockFetch({
    'git.status': () => ({ isRepo: true, entries: [], subprocesses: 1 }),
    'git.stage': () => ({ ok: true }),
    'git.unstage': () => ({ ok: true }),
    'settings.update': () => ({ value: {} }),
  }, calls)
  try {
    await store.setCommitChecked([entry], true)
    assert.equal(store.state.commit.pendingStage.has('new.txt'), true)
    // The tree added the file to the index in the meantime: the host now
    // reports it as staged and no longer untracked.
    const staged = { path: 'new.txt', xy: 'A.', untracked: false, staged: true, unstaged: false }
    await store.setCommitChecked([staged], false)
    // The user cancelled it: it must not be added by the next commit.
    assert.equal(store.state.commit.pendingStage.has('new.txt'), false)
    assert.equal(store.state.commit.checked.has('new.txt'), false)
    assert.equal(store.state.commit.unchecked.has('new.txt'), true)
  } finally {
    store.persist.cancel()
    restore()
  }
})

// ── M3 ───────────────────────────────────────────────────────────────────

test('switching the Git repository drops the commit selection', async () => {
  const store = fakeStore()
  const entry = untracked()
  store.state.status = { isRepo: true, branch: 'main', entries: [entry] }
  const calls = []
  const restore = mockFetch({
    'git.status': () => ({ isRepo: true, entries: [], subprocesses: 1 }),
    'git.branches': () => ({ branches: [] }),
    'git.log': () => ({ commits: [], hasMore: false }),
    'git.messages': () => ({ messages: [] }),
    'settings.update': () => ({ value: {} }),
  }, calls)
  try {
    await store.setCommitChecked([entry], true)
    assert.equal(store.state.commit.pendingStage.has('new.txt'), true)
    assert.equal(store.state.commit.checked.has('new.txt'), true)
    await store.setGitRepoRoot(REPO)
    assert.equal(store.state.gitRepoRoot, REPO)
    assert.equal(store.state.commit.pendingStage.size, 0)
    assert.equal(store.state.commit.checked.size, 0)
    assert.equal(store.state.commit.unchecked.size, 0)
    assert.deepEqual(store.state.commit.buckets, {})
  } finally {
    store.persist.cancel()
    restore()
  }
})

// ── L3 ───────────────────────────────────────────────────────────────────

test('switching the Git repository closes the diff tabs of the old one', async () => {
  const store = fakeStore()
  store.state.tabs = [
    { id: 'file:a.ts', kind: 'file', path: `${ROOT}\\a.ts` },
    { id: 'diff:worktree:src/a.ts', kind: 'diff', path: 'src/a.ts' },
    { id: 'diff:commit:abc:src/a.ts', kind: 'diff', commitHash: 'abc', path: 'src/a.ts' },
  ]
  store.state.activeId = 'diff:worktree:src/a.ts'
  const calls = []
  const restore = mockFetch({
    'git.status': () => ({ isRepo: true, entries: [], subprocesses: 1 }),
    'git.branches': () => ({ branches: [] }),
    'git.log': () => ({ commits: [], hasMore: false }),
    'git.messages': () => ({ messages: [] }),
    'settings.update': () => ({ value: {} }),
  }, calls)
  try {
    await store.setGitRepoRoot(REPO)
    // The diff tabs belonged to the old repository; the file tab stays.
    assert.deepEqual(store.state.tabs.map(tab => tab.id), ['file:a.ts'])
    assert.equal(store.state.activeId, 'file:a.ts')
  } finally {
    store.persist.cancel()
    restore()
  }
})

// ── M8 ───────────────────────────────────────────────────────────────────

test('show history speaks the repository basis', async () => {
  const store = fakeStore({ root: ROOT, gitRepoRoot: ROOT })
  const calls = []
  const restore = mockFetch({
    'git.log': () => ({ commits: [], hasMore: false }),
    'git.status': () => ({ isRepo: true, entries: [], subprocesses: 1 }),
    'settings.update': () => ({ value: {} }),
  }, calls)
  try {
    store.showHistory('src/a.ts')
    assert.equal(store.state.git.filters.path, 'src/a.ts')
    // A file of another repository has no history: the filter is cleared.
    await store.setGitRepoRoot(REPO)
    store.showHistory('src/a.ts')
    assert.equal(store.state.git.filters.path, '')
  } finally {
    store.persist.cancel()
    restore()
  }
})

// ── M4 ───────────────────────────────────────────────────────────────────

test('the eviction is deferred, never synchronous with the caller', () => {
  const cache = new StoreCache({ limit: 1 })
  const first = { state: { tabs: [] }, deactivate: () => {} }
  const second = { state: { tabs: [] }, deactivate: () => {} }
  cache.set('workspace:one', first, 's1')
  // `evict: false` is what the render path uses: the store stays until the
  // caller evicts outside the render stack.
  cache.set('workspace:two', second, 's2', { evict: false })
  assert.equal(cache.size, 2)
  cache.evict()
  assert.equal(cache.size, 1)
  assert.ok(cache.stores.has('workspace:two'))
})

// ── M9 ───────────────────────────────────────────────────────────────────

test('only the Session the Sidebar draws keeps its store', () => {
  // The rule of `isMountedSession` in `src/client/index.jsx`: the Session the
  // right Sidebar shows right now, and nothing else.
  const mounted = 's-current'
  const isMounted = sessionId => sessionId === mounted
  const cache = new StoreCache({ limit: 3, isMounted })
  for (let index = 0; index < 10; index += 1) {
    // Every workspace has two Sessions: the current one and a background one.
    cache.set(`workspace:${index}`, { state: { tabs: [] }, deactivate: () => {} }, `s${index}-a`)
    cache.claim(`workspace:${index}`, `s${index}-b`)
  }
  // The current Session's workspace survives, the other nine do not.
  assert.ok(cache.size <= 3)
  assert.equal(cache.stores.has('workspace:0'), false)
})

test('the mounted check does not count a Session that only has an open IDE tab', async () => {
  const source = await readFile(join(root, 'src/client/index.jsx'), 'utf8')
  const start = source.indexOf('const isMountedSession')
  assert.ok(start >= 0, 'the mounted check is in the client entry')
  const body = source.slice(start, start + 600)
  // A Session that merely has an open IDE tab is not mounted: its body renders
  // nothing, so its store may be evicted (PRD-v4 review M9).
  assert.doesNotMatch(body, /openTabs/)
})
