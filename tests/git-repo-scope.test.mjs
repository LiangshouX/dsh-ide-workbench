/**
 * GIT-01: the Git window may read another repository than the Project tree.
 *
 * Switching the repository of the Git window changes neither the file tree,
 * nor the project root, nor the open tabs — only the git calls follow the new
 * root.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkbenchStore } from '../src/client/store.js'

const ROOT = 'C:\\work\\demo'
const REPO_B = 'C:\\work\\repo-b'

/** A store with a project root, a tab and a Git repository. */
function fakeStore() {
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new WorkbenchStore(ctx, key => key)
  store.state = {
    ...store.state,
    workspaceRoot: ROOT,
    root: ROOT,
    gitRepoRoot: ROOT,
    projects: [
      { path: ROOT, name: 'demo', isRepo: true, isRoot: true },
      { path: REPO_B, name: 'repo-b', isRepo: true, isRoot: false },
    ],
    gitRepos: [{ path: ROOT, name: 'demo' }, { path: REPO_B, name: 'repo-b' }],
    tabs: [{ id: 'file:a.ts', kind: 'file', path: `${ROOT}\\a.ts` }],
    activeId: 'file:a.ts',
    dirs: new Map([[ROOT, { entries: [], loading: false }]]),
    expanded: new Set([ROOT]),
    phase: 'ready',
    settings: { editor: { openMode: 'auto', editableMaxBytes: 1 << 20 }, shortcuts: {} },
  }
  return store
}

/** Install a fetch mock that records every call. */
function mockFetch(calls = []) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/ide-workbench/api/')[1]
    const body = JSON.parse(init.body)
    calls.push({ method, body })
    const value = method === 'git.status'
      ? { isRepo: true, branch: 'main', entries: [], subprocesses: 1 }
      : method === 'git.branches'
        ? { branches: [] }
        : method === 'git.log'
          ? { commits: [], hasMore: false }
          : method === 'git.messages'
            ? { messages: [] }
            : method === 'workspace.projects'
              ? {
                workspace: ROOT,
                projects: [
                  { path: ROOT, name: 'demo', isRepo: true, isRoot: true },
                  { path: REPO_B, name: 'repo-b', isRepo: true, isRoot: false },
                ],
              }
              : { value: {} }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  return () => { globalThis.fetch = original }
}

test('switching the Git repository keeps the file tree and the tabs', async () => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch(calls)
  try {
    await store.setGitRepoRoot(REPO_B)
    // The file tree, the project root and the tabs are untouched.
    assert.equal(store.state.root, ROOT)
    assert.equal(store.state.workspaceRoot, ROOT)
    assert.equal(store.state.activeId, 'file:a.ts')
    assert.deepEqual(store.state.tabs.map(tab => tab.id), ['file:a.ts'])
    assert.equal(store.state.dirs.size, 1)
    assert.deepEqual([...store.state.expanded], [ROOT])
    // The Git window reads the new repository.
    assert.equal(store.state.gitRepoRoot, REPO_B)
    // Every git call of the new repository uses the new root.
    calls.length = 0
    await store.loadBranches()
    assert.ok(calls.length > 0)
    assert.ok(calls.every(call => call.body.root === REPO_B))
  } finally {
    store.persist.cancel()
    restore()
  }
})

test('the commit and the history follow the Git repository', async () => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch(calls)
  try {
    await store.setGitRepoRoot(REPO_B)
    calls.length = 0
    await store.loadLog(true)
    await store.loadBranches()
    const methods = calls.map(call => call.method)
    assert.ok(methods.includes('git.log'))
    assert.ok(methods.includes('git.branches'))
    assert.ok(calls.every(call => call.body.root === REPO_B))
  } finally {
    store.persist.cancel()
    restore()
  }
})

test('the file tree keeps its own root for the filesystem calls', async () => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch(calls)
  try {
    await store.setGitRepoRoot(REPO_B)
    calls.length = 0
    await store.loadFileIndex(true)
    assert.ok(calls.length > 0)
    // The file index belongs to the project, not to the Git repository.
    assert.ok(calls.every(call => call.body.root === ROOT))
  } finally {
    store.persist.cancel()
    restore()
  }
})

test('the Git repository defaults to the project root', () => {
  const store = fakeStore()
  assert.equal(store.gitRoot, ROOT)
  assert.equal(store.gitRoot, store.state.gitRepoRoot)
})

test('the repository candidates come from the project list', async () => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch(calls)
  try {
    await store.loadProjects(ROOT)
    assert.deepEqual(store.state.gitRepos, [
      { path: ROOT, name: 'demo' },
      { path: REPO_B, name: 'repo-b' },
    ])
  } finally {
    store.persist.cancel()
    restore()
  }
})

test('jump to source never opens a file of another repository', async () => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch(calls)
  try {
    await store.setGitRepoRoot(REPO_B)
    store.jumpToSource('src/a.ts')
    // The file belongs to the other repository: the editor is fenced to the
    // project root, so the wrong file is never opened.
    assert.deepEqual(store.state.tabs.map(tab => tab.id), ['file:a.ts'])
    assert.equal(store.state.toast?.kind, 'error')
    assert.match(store.state.toast?.detail ?? '', new RegExp(REPO_B.replace(/\\/g, '\\\\')))
  } finally {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.persist.cancel()
    restore()
  }
})

test('jump to source opens a file of the project repository', async () => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch(calls)
  try {
    store.jumpToSource('src/a.ts')
    assert.equal(store.state.toast, null)
    assert.equal(store.state.tabs.length, 2)
    assert.equal(store.state.tabs[1].path, `${ROOT}\\src\\a.ts`)
  } finally {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.persist.cancel()
    restore()
  }
})
