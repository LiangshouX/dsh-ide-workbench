/**
 * The paste of the project tree, as the store carries it out.
 *
 *   - a folder is refused when it would be pasted into itself - before a
 *     single byte is written;
 *   - the store says that it is busy while the copy runs, so the tree can
 *     show it;
 *   - the copy can be stopped, and the stop reaches the host that is doing
 *     the copying;
 *   - the pasted entry is selected, so the user sees where it landed;
 *   - the index of the project is invalidated, so the tree search finds the
 *     new entries.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkbenchStore } from '../src/client/store.js'

const ROOT = 'C:\\work\\demo'
const SRC = `${ROOT}\\src`
const DEST = `${ROOT}\\dest`
const FILE = `${ROOT}\\a.txt`

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

/**
 * A host double.
 *
 * `handler` answers the method; it may wait for the signal of the request -
 * that is how a copy that runs long is simulated.
 */
function mockHost(handler) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/').pop()
    const body = init.body === undefined ? null : JSON.parse(init.body)
    calls.push({ method, body, signal: init.signal })
    const value = await handler(method, body, init.signal)
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  return {
    calls,
    restore() { globalThis.fetch = original },
  }
}

/** The answer of a host that has nothing to say. */
function quietHost(method) {
  if (method === 'fs.tree') return { entries: [], truncated: false }
  if (method === 'git.status') return { unchanged: true }
  if (method === 'fs.move') {
    return { results: [{ path: 'a.txt', target: 'dest/a-copy.txt', ok: true, copied: 2, bytes: 10 }] }
  }
  return null
}

test('a folder is refused when it would be pasted into itself', async () => {
  const store = fakeStore()
  const toasts = []
  store.toast = (kind, title, detail) => toasts.push({ kind, title, detail })
  const host = mockHost(() => { throw new Error('the host must not be asked') })
  try {
    store.setFileClipboard([SRC], false)
    toasts.length = 0
    const done = await store.pasteEntries(SRC, { entries: [{ path: SRC, isDir: true }] })
    assert.equal(done, false, 'the paste did not happen')
    assert.equal(host.calls.length, 0, 'nothing was written')
    assert.equal(toasts.length, 1, 'the user is told why')
    assert.equal(toasts[0].kind, 'error')
  } finally {
    host.restore()
    store.persist.cancel()
  }
})

test('a folder is refused when it would be pasted into its own subfolder', async () => {
  const store = fakeStore()
  store.toast = () => {}
  const host = mockHost(() => { throw new Error('the host must not be asked') })
  try {
    store.setFileClipboard([SRC], false)
    const done = await store.pasteEntries(`${SRC}\\inner`, { entries: [{ path: SRC, isDir: true }] })
    assert.equal(done, false)
    assert.equal(host.calls.length, 0, 'nothing was written')
  } finally {
    host.restore()
    store.persist.cancel()
  }
})

test('the store says that it is busy while the copy runs, and is quiet afterwards', async () => {
  const store = fakeStore()
  let release = null
  const host = mockHost(async (method, body, signal) => {
    if (method === 'fs.move') {
      await new Promise((resolve) => { release = resolve })
    }
    return quietHost(method)
  })
  try {
    store.setFileClipboard([FILE], false)
    const pending = store.pasteEntries(DEST, { entries: [{ path: FILE, isDir: false }] })
    assert.equal(store.state.pasteBusy, true, 'the tree knows that a paste is running')
    release()
    await pending
    assert.equal(store.state.pasteBusy, false, 'the tree is quiet again')
  } finally {
    host.restore()
    store.persist.cancel()
  }
})

test('a paste can be stopped, and the stop reaches the host', async () => {
  const store = fakeStore()
  const host = mockHost(async (method, body, signal) => {
    if (method === 'fs.move') {
      // The copy runs until the request is aborted - like a copy of a huge
      // folder in the host.
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        }, { once: true })
      })
    }
    return quietHost(method)
  })
  try {
    store.setFileClipboard([FILE], false)
    const pending = store.pasteEntries(DEST, { entries: [{ path: FILE, isDir: false }] })
    assert.equal(store.state.pasteBusy, true)

    store.cancelPaste()
    const done = await pending
    assert.equal(done, false, 'the paste did not finish')
    assert.equal(store.state.pasteBusy, false, 'the tree is quiet again')
    const move = host.calls.find(call => call.method === 'fs.move')
    assert.ok(move !== undefined, 'the host was asked to copy')
    assert.equal(move.signal.aborted, true, 'the signal of the request is aborted')
  } finally {
    host.restore()
    store.persist.cancel()
  }
})

test('the pasted entry is selected, so the user sees where it landed', async () => {
  const store = fakeStore()
  const host = mockHost(quietHost)
  try {
    store.setFileClipboard([FILE], false)
    const done = await store.pasteEntries(DEST, { entries: [{ path: FILE, isDir: false }] })
    assert.equal(done, true, 'the paste happened')
    assert.equal(store.state.selectedPath, `${DEST}\\a-copy.txt`, 'the pasted entry is selected')
    // The index of the project does not know the new entry yet: the search
    // would not find it. It is invalidated, not rebuilt - nobody asked for
    // a search, and a big project must not pay for a full scan.
    assert.equal(store.state.fileIndexRoot, '', 'the index of the project is invalidated')
  } finally {
    host.restore()
    store.persist.cancel()
  }
})

test('the store knows a folder of its own tree, even without the panel', async () => {
  const store = fakeStore()
  store.toast = () => {}
  // The tree has listed the folder: it is a key of the tree.
  store.state.dirs = new Map([[SRC, { loading: false, entries: [] }]])
  const host = mockHost(() => { throw new Error('the host must not be asked') })
  try {
    store.setFileClipboard([SRC], false)
    // No `entries` from the panel: the store reads the tree itself.
    const done = await store.pasteEntries(SRC)
    assert.equal(done, false, 'the folder is refused even without the hint of the panel')
    assert.equal(host.calls.length, 0, 'nothing was written')
  } finally {
    host.restore()
    store.persist.cancel()
  }
})

test('a cut empties the clipboard, a copy keeps it', async () => {
  const store = fakeStore()
  const host = mockHost(quietHost)
  try {
    store.setFileClipboard([FILE], true)
    await store.pasteEntries(DEST, { entries: [{ path: FILE, isDir: false }] })
    assert.equal(store.state.clipboard, null, 'a cut empties the clipboard')

    store.setFileClipboard([`${ROOT}\\b.txt`], false)
    await store.pasteEntries(DEST, { entries: [{ path: `${ROOT}\\b.txt`, isDir: false }] })
    assert.notEqual(store.state.clipboard, null, 'a copy keeps the clipboard')
  } finally {
    host.restore()
    store.persist.cancel()
  }
})
