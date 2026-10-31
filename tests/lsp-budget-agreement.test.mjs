/**
 * The host and the client have to agree on the request budget.
 *
 * The host counts the unanswered requests (three of them kill the language
 * server) and the client decides how long it waits for an answer. Both use
 * the same rule - *a request is only a timeout after ten minutes while the
 * server has not answered a semantic request yet* - and both use the same
 * list of methods (`src/host/semantic-methods.js`).
 *
 * When the two disagree, the user sees the wrong one: the host kills the very
 * server the client is still waiting for, or the client gives up with
 * "Request timed out" while the host is patient. That asymmetry is the whole
 * point of this file (review T1 and T3).
 *
 * The two sides are driven by the SAME events - one request, one answer - and
 * observed the way the user experiences them:
 *   - the host: an unanswered request is counted as a timeout, or it is not;
 *   - the client: the budget that the NEXT request would get.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeManager, sleep } from './lsp-fixtures.mjs'
import { encodeFrame } from '../src/host/lsp-frame.js'
import { configureLsp, lspClient, resetLspHealth, shutdownLsp } from '../src/client/lsp-session.js'
import { SEMANTIC_METHODS } from '../src/host/semantic-methods.js'
import { BUILD_REQUEST_TIMEOUT_MS } from '../src/host/settings-defaults.js'

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-agreement-${name}`)
}

/**
 * One fake WebSocket.
 *
 * It records the budget that was in effect when a message was sent: the
 * library reads `client.timeout` exactly there, so that is the budget the
 * user would really wait.
 *
 * A request that is not semantic is answered right away; a semantic one is
 * answered only when the test says so - that is how the test drives the
 * client through the same sequence as the host.
 */
class FakeSocket {
  constructor(url) {
    this.url = url
    this.readyState = 1
    /** The budget that was in effect when a message was sent. */
    this.budgets = []
    /** The requests that are waiting for an answer. */
    this.pending = []
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
    this.budgets.push({ method: null, timeout: lspClient()?.timeout ?? null })
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {
      return
    }
    const index = this.budgets.length - 1
    this.budgets[index].method = typeof parsed?.method === 'string' ? parsed.method : null
    if (parsed?.id === undefined) return
    const entry = { id: parsed.id, method: parsed.method ?? null }
    if (SEMANTIC_METHODS.has(entry.method)) {
      this.pending.push(entry)
      return
    }
    this.answerEntry(entry)
  }

  /**
   * Answer one request.
   * @param {{id: number, method: string | null}} entry the request
   */
  answerEntry(entry) {
    const result = entry.method === 'initialize' ? { capabilities: {} } : null
    this.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', id: entry.id, result }) })
  }

  /**
   * Answer the last request of a method that is still waiting.
   * @param {string} method the LSP method
   * @returns {boolean} whether a request was answered
   */
  answerPending(method) {
    const index = this.pending.findLastIndex(entry => entry.method === method)
    if (index < 0) return false
    const [entry] = this.pending.splice(index, 1)
    this.answerEntry(entry)
    return true
  }

  close() { this.readyState = 3 }
}
FakeSocket.instances = []

const originalWebSocket = globalThis.WebSocket
globalThis.WebSocket = FakeSocket

after(() => {
  globalThis.WebSocket = originalWebSocket
  shutdownLsp()
})

/**
 * One workbench store with a language server that is ready.
 *
 * Every case gets its OWN project root: the session counts the answered
 * semantic requests per session, and a new project is what resets that count
 * in production. Without it the counters of one case would leak into the next
 * one - the module state of the client is global.
 * @param {string} root the project root of this case
 * @param {number} [requestTimeoutMs] the configured request timeout
 * @returns {any} the store
 */
function fakeStore(root, requestTimeoutMs = 45000) {
  const listeners = new Set()
  return {
    state: {
      root,
      settings: { lsp: { enabled: true, requestTimeoutMs } },
      lsp: { state: 'ready', consecutiveFailures: 0, consecutiveTimeouts: 0, lastFailure: null, processId: 1 },
    },
    set(patch) {
      this.state = { ...this.state, ...patch }
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    toast() {},
    t(key) { return key },
  }
}

/**
 * The parameters of one request.
 * @returns {any} the parameters
 */
function params() {
  return { textDocument: { uri: 'file:///C:/work/demo/src/app.ts' }, position: { line: 0, character: 0 } }
}

/** The probe method: not a semantic one, so it does not move the counters. */
const PROBE = 'textDocument/probe'

/**
 * Ask the client for one probe request and read the mode it was given.
 * @returns {Promise<'long' | 'short'>} the mode
 */
async function probeClient() {
  const client = lspClient()
  await client.request(PROBE, params())
  const socket = FakeSocket.instances[FakeSocket.instances.length - 1]
  const entry = [...socket.budgets].reverse().find(item => item.method === PROBE)
  return entry === undefined || entry.timeout === BUILD_REQUEST_TIMEOUT_MS ? 'long' : 'short'
}

/**
 * The mode of the host's budget: 'long' while the server may still be
 * building its program, 'short' after it has answered.
 *
 * The observable is the timeout counter: while the budget is the long one, an
 * unanswered request is NOT counted.
 * @param {any} manager the language server manager
 * @param {string} root the project root
 * @param {number} id the id of the probe request
 * @returns {Promise<'long' | 'short'>} the mode
 */
async function probeHost(manager, root, id) {
  const before = manager.stateOf(root).timeouts
  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0', id, method: 'textDocument/definition', params: {},
  }))
  await sleep(300)
  return manager.stateOf(root).timeouts === before ? 'long' : 'short'
}

/**
 * Let the server answer one request of the host.
 * @param {any} workers the workers of the manager
 * @param {number} id the id of the request
 */
function answerHost(workers, id) {
  workers[0].postMessage({
    type: 'stdout',
    data: encodeFrame(JSON.stringify({ jsonrpc: '2.0', id, result: null })),
  })
}

test('the host and the client are patient in the same way', async () => {
  const { manager, workers } = makeManager({ lsp: { requestTimeoutMs: 40 } })
  const root = rootOf('both-patient')
  await manager.start({ root })

  const store = fakeStore('C:/work/patient')
  configureLsp(store)
  // The counters of the client belong to ONE session: a case starts from
  // zero, so it does not depend on what the case before it did.
  resetLspHealth()
  const client = lspClient()

  // One semantic request that the server does not answer yet.
  const pending = client.request('textDocument/definition', params())
  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'textDocument/definition', params: {},
  }))
  await sleep(100)

  // Before any answer: both sides wait for ten minutes.
  assert.equal(await probeHost(manager, root, 2), 'long', 'the host is patient')
  assert.equal(await probeClient(), 'long', 'the client is patient')

  // The server answers it: from now on the configured timeout applies.
  answerHost(workers, 1)
  const socket = FakeSocket.instances[FakeSocket.instances.length - 1]
  assert.equal(socket.answerPending('textDocument/definition'), true, 'the client request was answered')
  await pending
  await sleep(50)

  assert.equal(await probeHost(manager, root, 3), 'short', 'the host is strict')
  assert.equal(await probeClient(), 'short', 'the client is strict')
})

test('an answer that is not semantic changes neither side', async () => {
  // The invariant of review T3: a request that is not semantic must not
  // shorten the budget on either side. If the host shortened it and the
  // client did not, the host would kill the very server the client is still
  // waiting for.
  const { manager, workers } = makeManager({ lsp: { requestTimeoutMs: 40 } })
  const root = rootOf('non-semantic')
  await manager.start({ root })

  const store = fakeStore('C:/work/non-semantic')
  configureLsp(store)
  resetLspHealth()
  const client = lspClient()

  // A request that is not semantic, answered by the server.
  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'workspace/executeCommand', params: {},
  }))
  answerHost(workers, 1)
  await sleep(50)

  await client.request('workspace/executeCommand', params())
  await sleep(50)

  assert.equal(await probeHost(manager, root, 2), 'long', 'the host is still patient')
  assert.equal(await probeClient(), 'long', 'the client is still patient')
})
