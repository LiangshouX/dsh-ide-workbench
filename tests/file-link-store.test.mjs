/**
 * Chat file links that name a relative path (PRD-v4 §7.6.2 / §7.7).
 *
 * A chat link may address a file of the IDE project root without saying so:
 * the absolute reading either lands outside the DSH workspace or outside the
 * project. The store then tries the relative candidates — IDE project root,
 * Session cwd, workspace root — and opens the first one that exists.
 *
 * The workspace fence is mandatory: a candidate outside the workspace is
 * never opened, whatever the link says.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkbenchStore } from '../src/client/store.js'

const WORKSPACE = 'C:\\work\\demo'
const PROJECT = 'C:\\work\\demo\\src'

/** A store with an explicit workspace, project root and Session cwd. */
function fakeStore(options = {}) {
  const ctx = {
    locale: { subscribe: () => () => {} },
    sessions: {
      list: {
        getSnapshot: () => ({ byId: { s1: { cwd: options.sessionCwd ?? WORKSPACE } } }),
      },
    },
  }
  const store = new WorkbenchStore(ctx, key => key)
  store.state = {
    ...store.state,
    workspaceRoot: options.workspaceRoot ?? WORKSPACE,
    root: options.root ?? PROJECT,
    phase: 'ready',
    projects: [
      { path: options.workspaceRoot ?? WORKSPACE, isRoot: true, isRepo: true },
      { path: options.root ?? PROJECT, isRoot: false, isRepo: true },
    ],
    settings: { editor: { openMode: 'auto', editableMaxBytes: 1 << 20 }, shortcuts: {} },
  }
  return store
}

/**
 * Install a fetch mock.
 * @param {{ stat?: (body: object) => boolean }} [options] `stat` answers
 *   whether the file of one `{ root, path }` pair exists.
 */
function mockFetch(options = {}, calls = []) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/ide-workbench/api/')[1]
    const body = JSON.parse(init.body)
    calls.push({ method, body })
    if (method === 'fs.stat') {
      const exists = options.stat === undefined ? true : options.stat(body)
      if (!exists) {
        return {
          ok: false,
          status: 404,
          async json() { return { ok: false, error: { code: 'not-found', message: 'file not found' } } },
        }
      }
      return { ok: true, status: 200, async json() { return { ok: true, value: { path: body.path, size: 1, mtimeMs: 1, isDirectory: false } } } }
    }
    const value = method === 'fs.tree'
      ? { entries: [], truncated: false }
      : method === 'settings.update'
        ? { value: {} }
        : { kind: 'text', content: 'export const a = 1\n', size: 23, encoding: 'utf-8', truncated: false }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  return () => { globalThis.fetch = original }
}

const stats = calls => calls.filter(call => call.method === 'fs.stat')

test('an ambiguous link path opens the file of the IDE project root', async () => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch({
    stat: body => body.root === PROJECT && body.path === 'docs/PRD-v4.md',
  }, calls)
  try {
    // The chat wrote the link with a leading slash: `s1//docs/PRD-v4.md`.
    const result = await store.openExternalFile('dsh-resource://file/session/s1//docs/PRD-v4.md')
    assert.equal(result.status, 'opened')
    assert.equal(result.absolute, 'C:\\work\\demo\\src\\docs\\PRD-v4.md')
    // The project root is the first base of PRD-v4 §7.4.
    assert.equal(stats(calls).length, 1)
    assert.equal(stats(calls)[0].body.root, PROJECT)
    assert.equal(stats(calls)[0].body.path, 'docs/PRD-v4.md')
    assert.equal(store.state.tabs.length, 1)
    assert.equal(store.state.tabs[0].path, 'C:\\work\\demo\\src\\docs\\PRD-v4.md')
  } finally {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.persist.cancel()
    restore()
  }
})

test('a plain relative link opens the file of the IDE project root', async () => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch({
    stat: body => body.root === PROJECT && body.path === 'docs/PRD-v4.md',
  }, calls)
  try {
    // The link resolves against the Session cwd, which is the workspace root,
    // so the file sits outside the IDE project (PRD-v4 §7.7).
    const result = await store.openExternalFile('dsh-resource://file/session/s1/docs/PRD-v4.md')
    assert.equal(result.status, 'opened')
    assert.equal(result.absolute, 'C:\\work\\demo\\src\\docs\\PRD-v4.md')
    assert.equal(stats(calls).length, 1)
    assert.equal(stats(calls)[0].body.root, PROJECT)
  } finally {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.persist.cancel()
    restore()
  }
})

test('a relative link outside the workspace is refused', async () => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch({}, calls)
  try {
    const result = await store.openExternalFile('dsh-resource://file/session/s1/../outside/a.ts')
    assert.equal(result.status, 'outside-workspace')
    // No candidate was probed: the link escapes the workspace.
    assert.deepEqual(stats(calls), [])
    assert.equal(store.state.toast, null)
    assert.deepEqual(store.state.tabs, [])
  } finally {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.persist.cancel()
    restore()
  }
})

test('a POSIX absolute path inside the workspace is not rewritten', async () => {
  const store = fakeStore({ workspaceRoot: '/work/demo', root: '/work/demo', sessionCwd: '/work/demo' })
  const calls = []
  const restore = mockFetch({}, calls)
  try {
    const result = await store.openExternalFile('dsh-resource://file/session/s1//work/demo/a.ts')
    assert.equal(result.status, 'opened')
    assert.equal(result.absolute, '/work/demo/a.ts')
    // The absolute reading was inside the workspace, so it wins untouched.
    assert.deepEqual(stats(calls), [])
  } finally {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.persist.cancel()
    restore()
  }
})

test('a link that names nothing falls back to the default sidebar', async () => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch({ stat: () => false }, calls)
  try {
    const result = await store.openExternalFile('dsh-resource://file/session/s1//docs/missing.md')
    assert.equal(result.status, 'outside-workspace')
    // Every candidate was probed and none existed.
    assert.equal(stats(calls).length, 2)
    assert.equal(store.state.toast, null)
    assert.deepEqual(store.state.tabs, [])
  } finally {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.persist.cancel()
    restore()
  }
})

test('an absolute drive-letter path behaves exactly as before', async () => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch({}, calls)
  try {
    const result = await store.openExternalFile('dsh-resource://file/session/s1/C:/other/a.ts')
    assert.equal(result.status, 'outside-workspace')
    assert.equal(result.absolute, 'C:\\other\\a.ts')
    // A drive-letter path is unambiguous: no candidate is probed.
    assert.deepEqual(stats(calls), [])
    assert.equal(store.state.toast, null)
  } finally {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.persist.cancel()
    restore()
  }
})

test('a candidate outside the workspace is never opened', async () => {
  const store = fakeStore({ workspaceRoot: 'C:\\work\\demo', root: 'C:\\work\\demo\\src' })
  const calls = []
  // Every candidate exists, but the Session cwd sits outside the workspace.
  const restore = mockFetch({ stat: () => true }, calls)
  try {
    const result = await store.openExternalFile('dsh-resource://file/session/s1//docs/PRD-v4.md')
    assert.equal(result.status, 'opened')
    // The project root candidate is inside the workspace and wins.
    assert.equal(stats(calls)[0].body.root, PROJECT)
    assert.ok(result.absolute.startsWith(WORKSPACE))
  } finally {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.persist.cancel()
    restore()
  }
})
