/**
 * R5 — the store side of the multi-level creation path.
 *
 * The new-file / new-directory dialog may offer a full relative path that is
 * resolved against the project root, with the missing intermediate
 * directories created automatically. The store hands that path to the host as
 * one relative name, and refuses a path that leaves the project root before
 * anything is written.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { relativeSegments, WorkbenchStore } from '../src/client/store.js'

const ROOT = 'C:\\work\\demo'

/** One host stub: it answers the routes a test names and records the calls. */
function mockHost(routes = {}) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/ide-workbench/api/')[1] ?? ''
    const body = init?.body === undefined ? {} : JSON.parse(init.body)
    calls.push({ method, body })
    const route = routes[method]
    const value = typeof route === 'function' ? await route(body) : (route ?? null)
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  return { calls, restore() { globalThis.fetch = original } }
}

const GIT_STATUS = { isRepo: true, branch: 'main', detached: false, entries: [], ahead: 0, behind: 0 }

function fakeStore() {
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new WorkbenchStore(ctx, key => key)
  store.state = {
    ...store.state,
    workspaceRoot: ROOT,
    root: ROOT,
    phase: 'ready',
    settings: { editor: { openMode: 'auto', editableMaxBytes: 1 << 20 }, shortcuts: {} },
  }
  return store
}

/** The host answers a creation with the path it created, relative to the root. */
function createRoutes(path) {
  return {
    'fs.create': { path, isDir: false },
    'fs.read': { kind: 'text', content: '', encoding: 'utf-8', size: 0, mtimeMs: 1 },
    'fs.tree': { entries: [], truncated: false },
    'git.status': GIT_STATUS,
    'settings.update': { ok: true },
  }
}

test('a relative path is read as its segments, or refused', () => {
  assert.deepEqual(relativeSegments('a/b/c.md'), ['a', 'b', 'c.md'])
  assert.deepEqual(relativeSegments('a\\b\\c.md'), ['a', 'b', 'c.md'])
  assert.deepEqual(relativeSegments(' c.md '), ['c.md'])
  // Everything that leaves the project root is refused.
  assert.equal(relativeSegments('../escape.md'), null)
  assert.equal(relativeSegments('a/../../escape.md'), null)
  assert.equal(relativeSegments('/etc/passwd'), null)
  assert.equal(relativeSegments('C:\\Windows\\system32'), null)
  assert.equal(relativeSegments('//server/share'), null)
  assert.equal(relativeSegments('a//b'), null)
  assert.equal(relativeSegments('a/./b'), null)
  assert.equal(relativeSegments('a/'), null)
  assert.equal(relativeSegments(''), null)
  assert.equal(relativeSegments(undefined), null)
})

test('the default creation is the direct parent and one name segment', async () => {
  const store = fakeStore()
  const host = mockHost(createRoutes('src/c.md'))
  try {
    await store.createEntry(`${ROOT}\\src`, { name: 'c.md' })
    const create = host.calls.find(call => call.method === 'fs.create')
    assert.ok(create !== undefined, 'the host was asked to create the entry')
    // Byte for byte the call of today: the parent is the folder of the tree,
    // the name is the one segment.
    assert.deepEqual(create.body, {
      root: ROOT,
      parent: `${ROOT}\\src`,
      name: 'c.md',
      isDir: false,
      content: '',
    })
    assert.equal(store.state.toast, null)
  } finally {
    host.restore()
    store.persist.cancel()
  }
})

test('a relative path becomes the name, and the root becomes the parent', async () => {
  const store = fakeStore()
  const host = mockHost(createRoutes('a/b/c.md'))
  try {
    await store.createEntry(`${ROOT}\\src`, { name: 'c.md', relPath: 'a/b/c.md' })
    const create = host.calls.find(call => call.method === 'fs.create')
    assert.ok(create !== undefined, 'the host was asked to create the entry')
    // The path is relative to the project root: the host creates the missing
    // intermediate directories itself.
    assert.deepEqual(create.body, {
      root: ROOT,
      parent: ROOT,
      name: 'a/b/c.md',
      isDir: false,
      content: '',
    })
    // The tree walks down to the new entry.
    assert.ok(store.state.expanded.has(`${ROOT}\\a`), 'the chain is expanded')
    assert.ok(store.state.expanded.has(`${ROOT}\\a\\b`), 'the chain is expanded')
  } finally {
    host.restore()
    store.persist.cancel()
  }
})

test('a relative directory plus a name is the same path', async () => {
  const store = fakeStore()
  const host = mockHost(createRoutes('a/b/c.md'))
  try {
    await store.createEntry(`${ROOT}\\src`, { name: 'c.md', relDir: 'a/b' })
    const create = host.calls.find(call => call.method === 'fs.create')
    assert.ok(create !== undefined, 'the host was asked to create the entry')
    assert.deepEqual(create.body, {
      root: ROOT,
      parent: ROOT,
      name: 'a/b/c.md',
      isDir: false,
      content: '',
    })
  } finally {
    host.restore()
    store.persist.cancel()
  }
})

test('a relative directory without a name creates nothing', async () => {
  const store = fakeStore()
  const host = mockHost(createRoutes('a/b'))
  try {
    // The directory alone does not say what to create.
    const created = await store.createEntry(`${ROOT}\\src`, { relDir: 'a/b' })
    assert.equal(created, false)
    assert.equal(store.state.toast?.kind, 'error')
    assert.equal(store.state.toast?.text, 'project.pathInvalid')
    assert.equal(host.calls.find(call => call.method === 'fs.create'), undefined)
  } finally {
    host.restore()
    store.persist.cancel()
  }
})

test('a path that leaves the project root is refused, and nothing is written', async () => {
  const store = fakeStore()
  const host = mockHost(createRoutes('escape.md'))
  try {
    for (const relPath of ['../escape.md', 'a/../../escape.md', '/etc/passwd', 'C:\\Windows', 'a//b']) {
      const created = await store.createEntry(`${ROOT}\\src`, { name: 'escape.md', relPath })
      assert.equal(created, false, `the path ${relPath} is refused`)
      assert.equal(store.state.toast?.kind, 'error')
      assert.equal(store.state.toast?.text, 'project.pathInvalid')
      assert.equal(store.state.toast?.detail, relPath)
    }
    // Nothing reached the host.
    assert.equal(host.calls.find(call => call.method === 'fs.create'), undefined)
  } finally {
    host.restore()
    store.persist.cancel()
  }
})
