/**
 * MEM-03 and SET-01: the health of the semantic features and the shutdown of
 * the language server (PRD-v5 supplement §2.4, §4.2, §0.4 #3).
 *
 * The health is the client's own answer to "is the semantic analysis really
 * working?": the host knows the state of its process, but it cannot see a
 * request that timed out. The session counts the failures of the *semantic*
 * requests only - a document that cannot be synced says nothing about the
 * features - and publishes the counters into the `lsp` slice of the store.
 *
 * SET-01: when the feature is switched off, the language server of the host
 * has to die right away and not after its ten minute idle timeout.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import {
  configureLsp,
  lspClient,
  lspHealth,
  resetLspHealth,
  shutdownLsp,
} from '../src/client/lsp-session.js'

/**
 * One fake WebSocket.
 *
 * The client sends its `initialize` request as soon as the socket is open;
 * the fake answers it, so the request never runs into its 30 second timeout.
 * Every other request is answered by `FakeSocket.answer`, which the test
 * replaces to produce a result or a failure.
 */
class FakeSocket {
  constructor(url) {
    this.url = url
    this.readyState = 1
    this.sent = []
    this.handlers = new Map()
    FakeSocket.instances.push(this)
    queueMicrotask(() => this.emit('open', {}))
  }

  addEventListener(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type).add(handler)
  }

  emit(type, event) {
    for (const handler of this.handlers.get(type) ?? []) handler(event)
  }

  send(text) {
    this.sent.push(text)
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {
      return
    }
    if (parsed?.method === 'initialize') {
      this.emit('message', {
        data: JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { capabilities: {} } }),
      })
      return
    }
    const answer = FakeSocket.answer(parsed)
    if (answer === null) return
    this.emit('message', { data: JSON.stringify(answer) })
  }

  close() { this.readyState = 3 }
}
FakeSocket.instances = []
/** The answer of the fake server; `null` means "no answer at all". */
FakeSocket.answer = () => null

/** The WebSocket of the tests, so no socket ever leaves the process. */
const originalWebSocket = globalThis.WebSocket
globalThis.WebSocket = FakeSocket

/** The fetch of the tests, so no host route is ever called for real. */
const originalFetch = globalThis.fetch
let hostCalls = []
globalThis.fetch = async (url, init) => {
  const method = String(url).split('/').pop()
  const body = init?.body === undefined ? {} : JSON.parse(init.body)
  hostCalls.push({ method, body })
  if (method === 'fs.read') {
    const value = { kind: 'text', content: 'const other = 1\nconst second = 2\n' }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  return { ok: true, status: 200, async json() { return { ok: true, value: { ok: true } } } }
}

after(() => {
  globalThis.WebSocket = originalWebSocket
  globalThis.fetch = originalFetch
  shutdownLsp()
})

/**
 * A workbench store that notifies its subscribers like the real one.
 * @param {object} [options]
 * @returns {{store: any, notify: () => void, sets: any[]}} the store
 */
function fakeStore(options = {}) {
  const listeners = new Set()
  const sets = []
  const store = {
    state: {
      root: options.root ?? 'C:/work/demo',
      tabs: [],
      settings: { lsp: { enabled: options.enabled ?? true }, shortcuts: {} },
      lsp: {
        state: 'ready',
        consecutiveFailures: 0,
        consecutiveTimeouts: 0,
        lastFailure: null,
      },
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(patch) {
      sets.push(patch)
      store.state = { ...store.state, ...patch }
      for (const listener of [...listeners]) listener()
    },
    toast() {},
    t(key) { return key },
  }
  return {
    store,
    sets,
    notify() {
      for (const listener of [...listeners]) listener()
    },
  }
}

/**
 * Start a session and wait until its socket is open.
 * @param {any} store the workbench store
 * @returns {Promise<void>} the promise of the wait
 */
async function startSession(store) {
  configureLsp(store)
  await new Promise(resolve => { setTimeout(resolve, 20) })
}

/**
 * The answer of the fake server for one request.
 * @param {{id: number, method: string}} request the request
 * @returns {any} the answer, or `null` for no answer
 */
function failureAnswer(message) {
  return request => ({
    jsonrpc: '2.0',
    id: request.id,
    error: { code: -1, message },
  })
}

/**
 * Run one request of the client and swallow its failure.
 * @param {string} method the method of the request
 * @returns {Promise<void>} the promise of the request
 */
async function request(method) {
  const client = lspClient()
  assert.ok(client !== null, 'the session has a client')
  await client.request(method, {}).then(() => {}, () => {})
}

test('the health of a session without a client is empty and never throws', () => {
  const health = lspHealth()
  assert.equal(health.consecutiveFailures, 0)
  assert.equal(health.consecutiveTimeouts, 0)
  assert.equal(health.lastFailure, null)
})

test('a failed semantic request is counted', async () => {
  const { store } = fakeStore()
  await startSession(store)
  resetLspHealth()
  FakeSocket.answer = failureAnswer('boom')

  await request('textDocument/references')

  const health = lspHealth()
  assert.equal(health.consecutiveFailures, 1)
  assert.equal(health.consecutiveTimeouts, 0)
  assert.equal(health.lastFailure.message, 'boom')
  assert.ok(Number.isFinite(health.lastFailure.at), 'the failure carries a time')
})

test('the failures of the semantic requests add up', async () => {
  const { store } = fakeStore()
  await startSession(store)
  resetLspHealth()
  FakeSocket.answer = failureAnswer('boom')

  await request('textDocument/definition')
  await request('textDocument/references')
  await request('textDocument/hover')

  assert.equal(lspHealth().consecutiveFailures, 3)
})

test('a timeout is counted on its own', async () => {
  const { store } = fakeStore()
  await startSession(store)
  resetLspHealth()
  FakeSocket.answer = failureAnswer('Request timed out')

  await request('textDocument/references')
  await request('textDocument/references')

  const health = lspHealth()
  assert.equal(health.consecutiveFailures, 2)
  assert.equal(health.consecutiveTimeouts, 2)
})

test('a failure that has nothing to do with the semantics is not counted', async () => {
  const { store } = fakeStore()
  await startSession(store)
  resetLspHealth()
  FakeSocket.answer = failureAnswer('the document could not be synced')

  await request('textDocument/formatting')

  assert.equal(lspHealth().consecutiveFailures, 0)
  assert.equal(lspHealth().lastFailure, null)
})

test('one successful semantic request resets the counter', async () => {
  const { store } = fakeStore()
  await startSession(store)
  resetLspHealth()
  FakeSocket.answer = failureAnswer('boom')

  await request('textDocument/references')
  assert.equal(lspHealth().consecutiveFailures, 1)

  FakeSocket.answer = request => ({ jsonrpc: '2.0', id: request.id, result: [] })
  await request('textDocument/references')

  assert.equal(lspHealth().consecutiveFailures, 0)
  assert.equal(lspHealth().consecutiveTimeouts, 0)
  // The last failure stays: it is the history of the diagnostic panel.
  assert.equal(lspHealth().lastFailure.message, 'boom')
})

test('the health is published into the lsp slice of the store', async () => {
  const { store, sets } = fakeStore()
  await startSession(store)
  resetLspHealth()
  FakeSocket.answer = failureAnswer('boom')

  await request('textDocument/references')

  const published = sets.filter(patch => patch.lsp !== undefined)
  assert.ok(published.length > 0, 'the store was told about the health')
  const last = published[published.length - 1].lsp
  assert.equal(last.consecutiveFailures, 1)
  assert.equal(last.consecutiveTimeouts, 0)
  assert.equal(last.lastFailure.message, 'boom')
  // The other fields of the slice survive the write.
  assert.equal(last.state, 'ready')
})

test('the counters start at zero again when the project changes', async () => {
  const { store, notify } = fakeStore()
  await startSession(store)
  resetLspHealth()
  FakeSocket.answer = failureAnswer('boom')

  await request('textDocument/references')
  assert.equal(lspHealth().consecutiveFailures, 1)

  store.state = { ...store.state, root: 'C:/work/other' }
  notify()
  await new Promise(resolve => { setTimeout(resolve, 20) })

  assert.equal(lspHealth().consecutiveFailures, 0, 'the failures of the old project are gone')
  assert.equal(lspHealth().lastFailure, null)
})

test('switching the feature off stops the language server of the host', async () => {
  const { store, notify } = fakeStore()
  await startSession(store)
  hostCalls = []

  store.state = { ...store.state, settings: { lsp: { enabled: false }, shortcuts: {} } }
  notify()
  await new Promise(resolve => { setTimeout(resolve, 20) })

  const shutdown = hostCalls.find(call => call.method === 'lsp.shutdown')
  assert.ok(shutdown !== undefined, 'the host was asked to stop the language server')
  assert.equal(shutdown.body.root, 'C:/work/demo')
  assert.equal(lspClient(), null, 'the client is gone')
})

test('a host that cannot stop the language server does not break the switch', async () => {
  const { store, notify } = fakeStore()
  await startSession(store)
  const original = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('the host is not reachable')
  }
  try {
    store.state = { ...store.state, settings: { lsp: { enabled: false }, shortcuts: {} } }
    notify()
    await new Promise(resolve => { setTimeout(resolve, 20) })
    assert.equal(lspClient(), null, 'the client is gone anyway')
  } finally {
    globalThis.fetch = original
  }
})

test('the health survives the status poll of the store', async () => {
  const { store, notify } = fakeStore()
  await startSession(store)
  resetLspHealth()
  FakeSocket.answer = failureAnswer('boom')

  // The poll of the store takes a snapshot of the slice...
  const snapshot = { ...store.state.lsp }
  await request('textDocument/references')
  assert.equal(store.state.lsp.consecutiveFailures, 1)

  // ...and writes it back after the answer of the host arrived.
  store.state = { ...store.state, lsp: { ...snapshot, state: 'ready' } }
  notify()

  assert.equal(store.state.lsp.consecutiveFailures, 1, 'the health was written back')
})

test('the position of a reference in a file that is not open can be mapped', async () => {
  const { store } = fakeStore()
  await startSession(store)
  const client = lspClient()
  assert.ok(client !== null, 'the session has a client')

  // The file is not open in an editor - the workspace read it for the panel.
  const file = await client.workspace.requestFile('file:///C:/work/demo/src/other.ts')
  assert.ok(file !== null)

  const mapping = client.workspaceMapping()
  // The library would throw here: the file was not open when the mapping
  // was created.
  const offset = mapping.mapPosition('file:///C:/work/demo/src/other.ts', { line: 1, character: 6 }, 1)
  // The second line starts at the "const" of "const second = 2".
  assert.equal(offset, 'const other = 1\nconst second = 2\n'.indexOf('second'))
})
