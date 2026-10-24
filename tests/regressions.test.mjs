import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkbenchStore } from '../src/client/store.js'

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
    projects: [{ path: ROOT, isRoot: true, isRepo: true }],
    settings: {
      editor: { openMode: 'auto', editableMaxBytes: 1 << 20, markdownPreview: true },
      shortcuts: {},
    },
  }
  return store
}

const entry = (name, rel) => ({
  name,
  path: `${ROOT}\\${rel.split('/').join('\\')}`,
  rel,
  isDir: false,
  isSymlink: false,
  hidden: false,
  size: 10,
  mtimeMs: 0,
  ext: name.includes('.') ? name.slice(name.lastIndexOf('.')) : '',
})

const dirEntry = (name) => ({
  name,
  path: `${ROOT}\\${name}`,
  rel: name,
  isDir: true,
  isSymlink: false,
  hidden: false,
  size: 0,
  mtimeMs: 0,
  ext: '',
})

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

const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms))

test('a restored tree loads every expanded folder instead of leaving rows on "loading"', async () => {
  const store = fakeStore()
  store.state.dirs = new Map()
  store.state.expanded = new Set([ROOT, `${ROOT}\\src`])
  const calls = []
  const restore = mockFetch({
    'fs.tree': (body) => body.path === ROOT
      ? { entries: [dirEntry('src')], truncated: false }
      : { entries: [entry('main.ts', 'src/main.ts')], truncated: false },
  }, calls)
  try {
    await store.loadRestoredTree()
    assert.deepEqual(calls.map(call => call.body.path).sort(), [ROOT, `${ROOT}\\src`].sort())
    assert.equal(store.state.dirs.get(ROOT)?.loading, false)
    assert.equal(store.state.dirs.get(`${ROOT}\\src`)?.loading, false)
    assert.equal(store.state.dirs.get(`${ROOT}\\src`)?.entries?.length, 1)
  } finally {
    restore()
    store.persist.cancel()
  }
})

test('a failed folder listing is retryable instead of loading forever', async () => {
  const store = fakeStore()
  let fail = true
  const restore = mockFetch({
    'fs.tree': () => {
      if (fail) throw Object.assign(new Error('boom'), { code: 'fs-error' })
      return { entries: [entry('a.ts', 'a.ts')], truncated: false }
    },
  })
  try {
    await store.loadDir(ROOT)
    assert.equal(store.state.dirs.get(ROOT)?.error, 'boom')
    assert.equal(store.state.dirs.get(ROOT)?.loading, false)

    fail = false
    await store.loadDir(ROOT, { force: true })
    assert.equal(store.state.dirs.get(ROOT)?.error, null)
    assert.equal(store.state.dirs.get(ROOT)?.entries?.length, 1)
  } finally {
    restore()
    store.persist.cancel()
  }
})

test('a superseded folder listing cannot overwrite the newer generation', async () => {
  const store = fakeStore()
  let releaseFirst
  const first = new Promise(resolve => { releaseFirst = resolve })
  let call = 0
  const restore = mockFetch({
    'fs.tree': async () => {
      call += 1
      if (call === 1) return first
      return { entries: [entry('new.ts', 'new.ts')], truncated: false }
    },
  })
  try {
    const stale = store.loadDir(ROOT)
    const fresh = store.loadDir(ROOT, { force: true })
    await fresh
    assert.equal(store.state.dirs.get(ROOT)?.entries?.[0]?.name, 'new.ts')
    releaseFirst({ entries: [entry('old.ts', 'old.ts')], truncated: false })
    await stale
    assert.equal(store.state.dirs.get(ROOT)?.entries?.[0]?.name, 'new.ts')
  } finally {
    restore()
    store.persist.cancel()
  }
})

test('saving a CRLF file does not report a false external change', async () => {
  const store = fakeStore()
  const tab = {
    id: 'file:a',
    kind: 'file',
    path: `${ROOT}\\src\\app.js`,
    rel: 'src/app.js',
    name: 'app.js',
    loading: false,
    payload: { kind: 'text', content: 'a\nb\n', eol: '\r\n', encoding: 'utf-8', size: 4, mtimeMs: 100, truncated: false },
    draft: 'a\nb\nc\n',
    dirty: true,
    editing: true,
    resetToken: 0,
  }
  store.state.tabs = [tab]
  store.state.activeId = tab.id
  store.state.status = { ...store.state.status, isRepo: true, entries: [] }
  const restore = mockFetch({
    'fs.write': () => ({ path: 'src/app.js', size: 12, mtimeMs: 200, encoding: 'utf-8' }),
    'git.status': () => ({
      isRepo: true,
      branch: 'main',
      detached: false,
      entries: [{ path: 'src/app.js', xy: '.M', untracked: false, conflict: false, staged: false, unstaged: true }],
    }),
    // The file on disk uses CRLF even though the editor buffer is LF.
    'fs.read': () => ({
      kind: 'text', content: 'a\r\nb\r\nc\r\n', encoding: 'utf-8', size: 12, mtimeMs: 200, truncated: false,
    }),
    'git.log': () => ({ commits: [], hasMore: false }),
    'git.branches': () => ({ branches: ['main'] }),
    'git.messages': () => ({ messages: [] }),
  })
  try {
    await store.saveTab(tab.id)
    await store.refreshStatus()
    await tick()
    const latest = store.state.tabs[0]
    assert.equal(latest.conflict, null)
    assert.equal(latest.dirty, false)
    assert.equal(latest.payload.content, 'a\nb\nc\n')
  } finally {
    restore()
    store.persist.cancel()
  }
})

test('a touched file with identical content is not an external change', async () => {
  const store = fakeStore()
  store.state.active = true
  const tab = {
    id: 'file:a',
    kind: 'file',
    path: `${ROOT}\\a.txt`,
    rel: 'a.txt',
    name: 'a.txt',
    loading: false,
    payload: { kind: 'text', content: 'same\n', eol: '\n', encoding: 'utf-8', size: 5, mtimeMs: 100, truncated: false },
    draft: 'same\n',
    dirty: false,
    editing: true,
    resetToken: 0,
    conflict: null,
  }
  store.state.tabs = [tab]
  store.state.activeId = tab.id
  const restore = mockFetch({
    'git.status': () => ({ isRepo: true, entries: [], detached: false }),
    'fs.stat': () => ({ path: 'a.txt', size: 5, mtimeMs: 300, isDirectory: false }),
    'fs.read': () => ({ kind: 'text', content: 'same\n', encoding: 'utf-8', size: 5, mtimeMs: 300, truncated: false }),
  })
  try {
    await store.pollStatus()
    const latest = store.state.tabs[0]
    assert.equal(latest.conflict, null)
    assert.equal(latest.payload.mtimeMs, 300)
  } finally {
    restore()
    store.persist.cancel()
  }
})

test('a real external edit still raises the conflict chip', async () => {
  const store = fakeStore()
  store.state.active = true
  const tab = {
    id: 'file:a',
    kind: 'file',
    path: `${ROOT}\\a.txt`,
    rel: 'a.txt',
    name: 'a.txt',
    loading: false,
    payload: { kind: 'text', content: 'mine\n', eol: '\n', encoding: 'utf-8', size: 5, mtimeMs: 100, truncated: false },
    draft: 'mine changed\n',
    dirty: true,
    editing: true,
    resetToken: 0,
  }
  store.state.tabs = [tab]
  store.state.activeId = tab.id
  const restore = mockFetch({
    'git.status': () => ({ isRepo: true, entries: [], detached: false }),
    'fs.stat': () => ({ path: 'a.txt', size: 5, mtimeMs: 300, isDirectory: false }),
    'fs.read': () => ({ kind: 'text', content: 'theirs\n', encoding: 'utf-8', size: 7, mtimeMs: 300, truncated: false }),
  })
  try {
    await store.pollStatus()
    assert.equal(store.state.tabs[0].conflict?.message, 'editor.conflictBody')
  } finally {
    restore()
    store.persist.cancel()
  }
})

test('reload from disk replaces the draft and rebuilds the editor', async () => {
  const store = fakeStore()
  const tab = {
    id: 'file:a',
    kind: 'file',
    path: `${ROOT}\\a.txt`,
    rel: 'a.txt',
    name: 'a.txt',
    loading: false,
    payload: { kind: 'text', content: 'old\n', eol: '\n', encoding: 'utf-8', size: 4, mtimeMs: 100, truncated: false },
    draft: 'unsaved draft\n',
    dirty: true,
    editing: true,
    resetToken: 2,
    conflict: { at: 1, message: 'editor.conflictBody' },
  }
  store.state.tabs = [tab]
  store.state.activeId = tab.id
  const restore = mockFetch({
    'fs.read': () => ({ kind: 'text', content: 'disk\n', encoding: 'utf-8', size: 5, mtimeMs: 400, truncated: false }),
  })
  try {
    await store.reloadTab(tab.id)
    const latest = store.state.tabs[0]
    assert.equal(latest.draft, 'disk\n')
    assert.equal(latest.payload.content, 'disk\n')
    assert.equal(latest.dirty, false)
    assert.equal(latest.conflict, null)
    assert.equal(latest.resetToken, 3)
  } finally {
    restore()
    store.persist.cancel()
  }
})

test('markdown opens in the rendered preview unless editing is forced', () => {
  const store = fakeStore()
  assert.equal(store.defaultEditing(200, `${ROOT}\\README.md`), false)
  assert.equal(store.defaultEditing(200, `${ROOT}\\a.ts`), true)
  store.state.settings.editor.markdownPreview = false
  assert.equal(store.defaultEditing(200, `${ROOT}\\README.md`), true)
  store.state.settings.editor.markdownPreview = true
  store.state.settings.editor.openMode = 'editable'
  assert.equal(store.defaultEditing(200, `${ROOT}\\README.md`), true)
  store.state.settings.editor.openMode = 'readonly'
  assert.equal(store.defaultEditing(200, `${ROOT}\\a.ts`), false)
})

test('opening a markdown file lands in the read-only preview by default', async () => {
  const store = fakeStore()
  const restore = mockFetch({
    'fs.read': () => ({ kind: 'text', content: '# Title\n', encoding: 'utf-8', size: 8, mtimeMs: 1, truncated: false }),
    'fs.tree': () => ({ entries: [], truncated: false }),
  })
  try {
    store.openFile(`${ROOT}\\README.md`)
    await tick(20)
    const tab = store.state.tabs.find(item => item.kind === 'file')
    assert.equal(tab.editing, false)
    assert.equal(tab.view, 'preview')
  } finally {
    restore()
    store.persist.cancel()
  }
})

test('dirty compares CRLF drafts by normalized text', () => {
  const store = fakeStore()
  store.state.tabs = [{
    id: 'file:a',
    kind: 'file',
    path: `${ROOT}\\a.txt`,
    payload: { kind: 'text', content: 'a\nb\n' },
    draft: 'a\r\nb\r\n',
    dirty: false,
  }]
  store.updateDraft('file:a', 'a\r\nb\r\n')
  assert.equal(store.state.tabs[0].dirty, false)
  assert.equal(store.state.tabs[0].draft, 'a\nb\n')
  store.updateDraft('file:a', 'a\nb\nc\n')
  assert.equal(store.state.tabs[0].dirty, true)
  store.updateDraft('file:a', 'a\nb\n')
  assert.equal(store.state.tabs[0].dirty, false)
})
