/**
 * PERF-07: a cold workspace must not replay everything.
 *
 * Entering a workspace that was visited before used to read every open file
 * from disk (up to 24 reads) and list the root plus every expanded folder
 * (up to 201 listings). Now only the focused file and the root level are read
 * on entry; the rest follows when the user asks for it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkbenchStore } from '../src/client/store.js'

const ROOT = 'C:\\work\\demo'
const SRC = `${ROOT}\\src`

/** The workspace state the host hands back for this project. */
const SETTINGS = {
  projectRoots: { [ROOT]: ROOT },
  workspaceState: {
    [ROOT]: {
      expanded: [ROOT, SRC],
      tabs: [
        { path: `${ROOT}\\a.ts`, rel: 'a.ts' },
        { path: `${ROOT}\\b.ts`, rel: 'b.ts' },
      ],
      activePath: `${ROOT}\\a.ts`,
      layout: { left: 'project', bottom: null },
    },
  },
}

/** A store whose workspace state holds two tabs and one expanded folder. */
function fakeStore() {
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new WorkbenchStore(ctx, key => key)
  store.state = {
    ...store.state,
    workspaceRoot: ROOT,
    root: ROOT,
    phase: 'ready',
    dirs: new Map(),
    expanded: new Set(),
    settings: {
      editor: { openMode: 'auto', editableMaxBytes: 1 << 20 },
      shortcuts: {},
      workspaceState: SETTINGS.workspaceState,
    },
  }
  return store
}

/** Install a fetch mock that counts the file and directory calls. */
function mockFetch(calls = []) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/ide-workbench/api/')[1]
    const body = JSON.parse(init.body)
    calls.push({ method, body })
    const value = method === 'settings.get'
      ? { file: 'settings.json', value: SETTINGS }
      : method === 'workspace.list'
        ? { items: [{ id: 'w1', path: ROOT, title: 'demo', updatedAt: 0 }], defaultRoot: ROOT, defaultDirectory: ROOT }
        : method === 'workspace.projects'
          ? { workspace: ROOT, projects: [{ path: ROOT, name: 'demo', isRepo: true, isRoot: true }] }
          : method === 'fs.read'
            ? { kind: 'text', content: 'export const a = 1\n', size: 18, encoding: 'utf-8', truncated: false }
            : method === 'fs.tree'
              ? { entries: [], truncated: false }
              : method === 'git.status'
                ? { isRepo: true, branch: 'main', entries: [], subprocesses: 1 }
                : { value: {} }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  return () => { globalThis.fetch = original }
}

const treeCalls = calls => calls.filter(call => call.method === 'fs.tree')
const readCalls = calls => calls.filter(call => call.method === 'fs.read')
const tick = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms))

test('a cold workspace lists the root and reads only the focused file', async () => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch(calls)
  try {
    await store.init()
    await tick(40)
    // One listing: the root level.
    assert.equal(treeCalls(calls).length, 1)
    assert.equal(treeCalls(calls)[0].body.path, ROOT)
    // One read: the file the editor shows. The second tab waits.
    assert.equal(readCalls(calls).length, 1)
    assert.equal(readCalls(calls)[0].body.path, `${ROOT}\\a.ts`)
    // Both tabs are restored, but only the focused one has content.
    assert.equal(store.state.tabs.length, 2)
    const other = store.state.tabs.find(tab => tab.id === `file:${ROOT}\\b.ts`)
    assert.ok(other !== undefined, 'the second tab is restored')
    assert.equal(other.content, null)
  } finally {
    store.persist.cancel()
    restore()
  }
})

test('an unfocused tab is read when it is focused', async () => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch(calls)
  try {
    await store.init()
    await tick(40)
    calls.length = 0
    store.activateTab(`file:${ROOT}\\b.ts`)
    await tick(20)
    assert.equal(readCalls(calls).length, 1)
    assert.equal(readCalls(calls)[0].body.path, `${ROOT}\\b.ts`)
  } finally {
    store.persist.cancel()
    restore()
  }
})

test('the restored folders are listed in the background', async () => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch(calls)
  try {
    await store.init()
    // The entry itself only lists the root.
    await tick(40)
    assert.equal(treeCalls(calls).length, 1)
    // The expanded folder follows a moment later, so the tree fills in.
    await tick(300)
    const paths = treeCalls(calls).map(call => call.body.path)
    assert.ok(paths.includes(SRC), 'the restored folder is listed')
  } finally {
    if (store.restoredTimer !== null) clearTimeout(store.restoredTimer)
    store.persist.cancel()
    restore()
  }
})
