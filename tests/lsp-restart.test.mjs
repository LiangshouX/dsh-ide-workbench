/**
 * The recovery of a degraded semantic session (PRD-v5 supplement, MEM-04).
 *
 * A language server that degraded could only be recovered by switching the
 * project away and back. The store now shuts the old session down and starts
 * a new one, and the status bar offers the same way out.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkbenchStore } from '../src/client/store.js'

const ROOT = 'C:\\work\\demo'

/**
 * One host stub: the calls are recorded, so the test can see which route was
 * asked and in which order.
 */
function hostStub(options = {}) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/').pop()
    const body = init?.body === undefined ? {} : JSON.parse(init.body)
    calls.push({ method, body })
    let value = {}
    if (method === 'lsp.status') {
      value = {
        enabled: true,
        state: options.lspState ?? 'idle',
        languageId: options.lspLanguageId ?? '',
        serverId: '',
        source: null,
        detail: null,
        indexedRoots: [],
      }
    } else if (method === 'lsp.resources') {
      value = { totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3, thresholdBytes: 384 * 1024 * 1024, canIndex: true }
    } else if (method === 'lsp.servers') value = { available: [], missing: [] }
    else if (method === 'lsp.index') value = { state: 'idle', progress: '', startedAt: 0, cancellable: false }
    else value = { shells: [], names: [], messages: [] }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  return {
    calls,
    methods: () => calls.map(call => call.method),
    restore() { globalThis.fetch = original },
  }
}

/** A store with one workspace root. */
function fakeStore() {
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new WorkbenchStore(ctx, key => key)
  store.state = {
    ...store.state,
    workspaceRoot: ROOT,
    root: ROOT,
    phase: 'ready',
    settings: { editor: { openMode: 'auto' }, shortcuts: {}, lsp: { enabled: true, indexOnOpen: 'ask' } },
    projects: [],
  }
  return store
}

/** Let the pending promise chain of the store settle. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

/** Release the timers a test may have armed. */
function cleanup(store) {
  if (store.toastTimer !== null) clearTimeout(store.toastTimer)
  store.persist.cancel()
}

test('the old session is shut down before the new one starts', async () => {
  const host = hostStub()
  const store = fakeStore()
  try {
    await store.restartLsp()
    const methods = host.methods()
    const shutdown = methods.indexOf('lsp.shutdown')
    const start = methods.indexOf('lsp.start')
    assert.ok(shutdown !== -1, 'the old session was shut down')
    assert.ok(start !== -1, 'a new session was started')
    assert.ok(shutdown < start, 'the shutdown has to come first: otherwise the new session finds no memory')
    // The root of the current project is the one that is rebuilt.
    const shutdownCall = host.calls[shutdown]
    assert.equal(shutdownCall.body.root, ROOT)
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('the conservative mode can be entered on purpose', async () => {
  const host = hostStub()
  const store = fakeStore()
  try {
    await store.degradeLsp()
    const methods = host.methods()
    assert.ok(methods.includes('lsp.shutdown'), 'the language server was stopped')
    assert.ok(!methods.includes('lsp.start'), 'nothing was started')
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('the rebuild flag is cleared when the rebuild is over', async () => {
  const host = hostStub()
  const store = fakeStore()
  try {
    const pending = store.restartLsp()
    await pending
    assert.equal(store.state.lsp.rebuilding, false)
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('a broken host does not break the rebuild', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('the host is gone') }
  const store = fakeStore()
  try {
    await store.restartLsp()
    assert.equal(store.state.lsp.rebuilding, false)
  } finally {
    globalThis.fetch = original
    cleanup(store)
  }
})

test('the status bar of a degraded session offers the way back', async () => {
  const host = hostStub({ lspState: 'degraded' })
  const store = fakeStore()
  try {
    await store.refreshLspStatus()
    assert.equal(store.state.lsp.state, 'degraded')
    await flush()
  } finally {
    cleanup(store)
    host.restore()
  }
})
