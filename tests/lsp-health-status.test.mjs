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
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  configureLsp,
  lspClient,
  lspHealth,
  resetLspHealth,
  shutdownLsp,
} from '../src/client/lsp-session.js'
import { makeManager, sleep, waitFor } from './lsp-fixtures.mjs'
import { encodeFrame } from '../src/host/lsp-frame.js'

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-health-${name}`)
}

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
      // A server that refuses the handshake: the client has to recover from
      // it, because a rejected handshake promise rejects every later
      // request as well.
      if (FakeSocket.failHandshake === true) {
        this.emit('message', {
          data: JSON.stringify({ jsonrpc: '2.0', id: parsed.id, error: { code: -1, message: 'the server is not ready' } }),
        })
        return
      }
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
/** When true the fake server refuses the handshake. */
FakeSocket.failHandshake = false

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

// ── the host side of the health: the first request of a session is patient ─
//
// The counter of the host ("the requests the server did not answer in time")
// is the truth the client cannot see. It must not turn the silence of a
// server that is still building its program into a crash: the first
// *semantic* request of a session waits for the program build of the project
// - more than ten minutes on a large project (PRD-v5 §0.2 #3). The watchdog
// is patient until the server has answered one request that is not the
// handshake; from then on the configured timeout applies and a server that
// stops answering is killed.

test('the first request of a session is patient, the next ones are not', async () => {
  const { manager, spawned, workers, handle } = makeManager({ lsp: { requestTimeoutMs: 400 } })
  const root = rootOf('first-request-budget')
  await manager.start({ root })

  // The first request that is never answered: the server may still be
  // building its program, so it is not counted.
  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'textDocument/definition', params: {},
  }))
  await sleep(900)

  assert.equal(manager.stateOf(root).timeouts, 0, 'the first request was not counted')
  assert.equal(spawned.length, 1, 'the language server was not killed')
  assert.equal(handle().terminateCalls, 0, 'the process was not terminated')

  // Now the server answers a request that is not the handshake: from now on
  // the configured timeout applies.
  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0', id: 2, method: 'textDocument/definition', params: {},
  }))
  workers[0].postMessage({
    type: 'stdout',
    data: encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 2, result: null })),
  })
  assert.equal(
    await waitFor(() => manager.stateOf(root).state === 'ready'),
    true,
    'the answer of the server was processed',
  )

  // A request that is never answered is counted from now on.
  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0', id: 3, method: 'textDocument/definition', params: {},
  }))
  assert.equal(
    await waitFor(() => manager.stateOf(root).timeouts >= 1),
    true,
    'the timeout of a server that has answered once is counted',
  )
})

// ── the host side of the budget: one definition for the two sides ──────────
//
// The host and the client have to agree on what "an answer" is. The client
// counts only the answers to the *semantic* requests (see
// `src/host/semantic-methods.js`), and the host has to use the same list: if
// the host shortened the budget because of an answer the client does not
// count, the host would kill the very server the client is still waiting for
// (review T3).
//
// The tests below watch the observable effect of the counter: while the
// budget is the long one (the server has not answered a semantic request
// yet), an unanswered request is NOT counted as a timeout.

test('the answer to a request that is not semantic does not shorten the budget', async () => {
  const { manager, spawned, workers } = makeManager({ lsp: { requestTimeoutMs: 40 } })
  const root = rootOf('non-semantic-answer')
  await manager.start({ root })

  // A request that is not one of the semantic methods. The server answers
  // it, but the answer says nothing about the semantic features - the
  // client does not count it either.
  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'workspace/executeCommand', params: {},
  }))
  workers[0].postMessage({
    type: 'stdout',
    data: encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null })),
  })
  await sleep(50)

  // The budget is still the long one: the first semantic request of a
  // session waits for the program build of the project.
  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0', id: 2, method: 'textDocument/definition', params: {},
  }))
  await sleep(400)

  assert.equal(
    manager.stateOf(root).timeouts,
    0,
    'the answer of the command did not shorten the budget',
  )
  assert.equal(spawned.length, 1, 'the language server was not killed')

  // The difference is the semantics and nothing else: the answer of a
  // *semantic* request does shorten the budget - the request that is still
  // outstanding from before is counted from now on.
  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0', id: 3, method: 'textDocument/hover', params: {},
  }))
  workers[0].postMessage({
    type: 'stdout',
    data: encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 3, result: null })),
  })
  assert.equal(
    await waitFor(() => manager.stateOf(root).timeouts >= 1),
    true,
    'the answer of the semantic request shortened the budget',
  )
})

// ── the status bar says "ready" while the program is still being built ────
//
// The readiness heuristic flips to "ready" about ten milliseconds after the
// server answers the `initialize` - but the first semantic request of a
// project waits for the program build of the whole project (more than ten
// minutes on a large project). The status bar has to say what it waits for
// (review T7).

test('the status says that the program is being built while a semantic request is outstanding', async () => {
  const { manager, workers } = makeManager()
  const root = rootOf('building-program')
  await manager.start({ root })

  assert.equal(
    manager.stateOf(root).buildingProgram,
    false,
    'nothing is being built before the first request',
  )

  // The first semantic request: the server has to build the program of the
  // whole project before it can answer it.
  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'textDocument/definition', params: {},
  }))
  assert.equal(
    manager.stateOf(root).buildingProgram,
    true,
    'the program of the project is being built',
  )

  // The server answers it: the program is built now and the requests after
  // this one are incremental (and quick).
  workers[0].postMessage({
    type: 'stdout',
    data: encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null })),
  })
  assert.equal(
    await waitFor(() => manager.stateOf(root).buildingProgram === false),
    true,
    'the program is built',
  )
})

test('a request that is not semantic does not build the program', async () => {
  const { manager } = makeManager()
  const root = rootOf('building-program-command')
  await manager.start({ root })

  // A command of the workspace: the server has to answer it, but it does
  // not make the server build its program.
  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'workspace/executeCommand', params: {},
  }))
  await sleep(50)

  assert.equal(
    manager.stateOf(root).buildingProgram,
    false,
    'a command of the workspace does not build the program',
  )
})

test('a notification does not build the program', async () => {
  const { manager } = makeManager()
  const root = rootOf('building-program-notification')
  await manager.start({ root })

  // A notification is never answered - that is normal in LSP - so it cannot
  // be the sign of a program build.
  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0', method: 'textDocument/didChange', params: {},
  }))
  await sleep(50)

  assert.equal(
    manager.stateOf(root).buildingProgram,
    false,
    'a notification does not build the program',
  )
})

// ── the timeout counter belongs to the process that died ──────────────────
//
// The counter of the unanswered requests is reset for every new process, and
// so is the timeout counter: two timeouts of the process that crashed must
// not make the FIRST timeout of the new process kill it (review T2).

test('the timeout counter of a crashed server does not survive the restart', async () => {
  const { manager, spawned, handle } = makeManager({ restartBackoffMs: 10 })
  const root = rootOf('timeout-counter-reset')
  await manager.start({ root })

  // Two timeouts of the process that is about to die.
  manager.noteTimeout(root)
  manager.noteTimeout(root)
  assert.equal(manager.stateOf(root).timeouts, 2, 'the two timeouts were counted')

  // The server crashes and is started again.
  handle().exit(134)
  assert.equal(
    await waitFor(() => spawned.length === 2),
    true,
    'the language server was started again',
  )

  // The counter belongs to the process that died: the new one starts at
  // zero, so its first timeout does not reach the limit yet.
  assert.equal(
    await waitFor(() => manager.stateOf(root).timeouts === 0),
    true,
    'the counter of the dead process is gone',
  )
})
