/**
 * Regression tests for the request budget of the client (review S6).
 *
 * The library `@codemirror/lsp-client` reads `client.timeout` when it
 * *creates* a request, so the budget has to be written into the client
 * before the request is built.
 *
 * The budget follows the answered semantic requests of the session: the
 * first one is the request that makes the language server build the program
 * of the whole project, and PRD-v5 §0.2 #3 measured that at more than ten
 * minutes. Until it is answered, every request gets the long budget of
 * `BUILD_REQUEST_TIMEOUT_MS`; afterwards the configured timeout applies
 * again.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { configureLsp, isClientDeadline, lspClient, shutdownLsp } from '../src/client/lsp-session.js'
import { BUILD_REQUEST_TIMEOUT_MS } from '../src/host/settings-defaults.js'

/**
 * One fake WebSocket.
 *
 * It answers every request, so no request ever runs into its timeout - a
 * timeout would be an unhandled rejection at the end of the test run, and
 * the budget of ten minutes would keep the process alive for ten minutes.
 */
class FakeSocket {
  constructor(url) {
    this.url = url
    this.readyState = 1
    this.sent = []
    /** The budget that was in effect when a message was sent. */
    this.budgets = []
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
    // The budget in effect when the request was created: the library reads
    // `client.timeout` exactly here.
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
    const result = parsed.method === 'initialize' ? { capabilities: {} } : null
    this.emit('message', {
      data: JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result }),
    })
  }

  close() { this.readyState = 3 }
}
FakeSocket.instances = []

/** The WebSocket of the tests, so no socket ever leaves the process. */
const originalWebSocket = globalThis.WebSocket
globalThis.WebSocket = FakeSocket

after(() => {
  globalThis.WebSocket = originalWebSocket
  shutdownLsp()
})

/**
 * One workbench store with a language server that is ready.
 * @param {object} [options]
 * @param {number} [options.requestTimeoutMs] the configured request timeout
 * @returns {{store: any}} the store
 */
function fakeStore(options = {}) {
  return {
    store: {
      state: {
        root: 'C:/work/demo',
        settings: { lsp: { enabled: true, requestTimeoutMs: options.requestTimeoutMs ?? 45000 } },
        lsp: { state: 'ready', consecutiveFailures: 0, consecutiveTimeouts: 0, lastFailure: null },
      },
      set(patch) {
        this.state = { ...this.state, ...patch }
      },
      subscribe() {
        return () => {}
      },
      toast() {},
      t(key) {
        return key
      },
    },
  }
}

/**
 * The budget that was in effect when one method was sent.
 * @param {string} method the LSP method
 * @returns {number | null} the timeout in milliseconds
 */
function budgetOf(method) {
  const socket = FakeSocket.instances[FakeSocket.instances.length - 1]
  const entry = [...socket.budgets].reverse().find(item => item.method === method)
  return entry === undefined ? null : entry.timeout
}

/**
 * The parameters of one hover request.
 * @returns {any} the parameters
 */
function hoverParams() {
  return { textDocument: { uri: 'file:///C:/work/demo/src/app.ts' }, position: { line: 0, character: 0 } }
}

test('the client starts with the long budget', async () => {
  const { store } = fakeStore()
  configureLsp(store)
  const client = lspClient()
  assert.ok(client !== null, 'the session started a client')
  assert.equal(client.timeout, BUILD_REQUEST_TIMEOUT_MS, 'the first request may take ten minutes')
  await client.request('textDocument/hover', hoverParams())
})

test('the first semantic request gets the long budget', async () => {
  const { store } = fakeStore()
  configureLsp(store)
  const client = lspClient()

  await client.request('textDocument/hover', hoverParams())

  assert.equal(budgetOf('textDocument/hover'), BUILD_REQUEST_TIMEOUT_MS, 'the first semantic request may take ten minutes')
  assert.equal(client.timeout, BUILD_REQUEST_TIMEOUT_MS)
})

test('after the first answered semantic request the configured timeout applies', async () => {
  const { store } = fakeStore()
  configureLsp(store)
  const client = lspClient()

  await client.request('textDocument/hover', hoverParams())
  await client.request('textDocument/definition', hoverParams())

  assert.equal(budgetOf('textDocument/hover'), BUILD_REQUEST_TIMEOUT_MS, 'the first semantic request may take ten minutes')
  assert.equal(budgetOf('textDocument/definition'), 45000, 'the second one uses the configured timeout')
  assert.equal(client.timeout, 45000)
})

test('a request that is not semantic does not change the counter', async () => {
  const { store } = fakeStore()
  configureLsp(store)
  const client = lspClient()

  // The handshake of the library is not a semantic request, and neither is
  // any other request of the protocol.
  await client.request('workspace/executeCommand', { command: 'noop' })
  await client.request('textDocument/completion', hoverParams())

  assert.equal(budgetOf('workspace/executeCommand'), BUILD_REQUEST_TIMEOUT_MS, 'the other request got the long budget too')
  assert.equal(
    budgetOf('textDocument/completion'),
    BUILD_REQUEST_TIMEOUT_MS,
    'the counter did not move: the first semantic request may still take ten minutes',
  )
})

test('a request the server answered with an error counts as an answer', async () => {
  const { store } = fakeStore()
  configureLsp(store)
  const client = lspClient()

  // The server answers with an error: the request WAS answered, so the
  // program of the project is built and the next request is a short one.
  // The host counts the same thing, and the two sides have to agree - if the
  // host switched to the short budget while the client still waited with the
  // long one, the host would kill the very server the client waits for.
  const socket = FakeSocket.instances[FakeSocket.instances.length - 1]
  const originalSend = socket.send.bind(socket)
  socket.send = (text) => {
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
    if (parsed?.method === 'textDocument/hover') {
      socket.emit('message', {
        data: JSON.stringify({ jsonrpc: '2.0', id: parsed.id, error: { code: -1, message: 'boom' } }),
      })
      return
    }
    originalSend(text)
  }

  await assert.rejects(() => client.request('textDocument/hover', hoverParams()))
  await client.request('textDocument/definition', hoverParams())

  assert.equal(
    budgetOf('textDocument/definition'),
    45000,
    'the server answered, so the configured timeout is the right budget again',
  )
})

test('the deadline of the client does not count as an answer', () => {
  // The library gives up on a request with exactly this error
  // (`new Error("Request timed out")`), and it is the one rejection that
  // means the server did NOT answer: the program of the project may still be
  // building, so the long budget has to stay in effect.
  //
  // The library's own deadline cannot be reached in a test without waiting
  // for it (ten minutes), so the rule is pinned where it lives.
  assert.equal(isClientDeadline(new Error('Request timed out')), true, "the client's own deadline")
  assert.equal(isClientDeadline(new Error('request timed out')), true, 'the deadline, in lower case')

  // The server answered with an error: that is an answer.
  assert.equal(isClientDeadline({ code: -1, message: 'boom' }), false, 'the error of the server')
  assert.equal(isClientDeadline(new Error('boom')), false, 'an ordinary failure')

  // A server whose error message mentions a timeout is not the client's own
  // deadline: the check is exact on purpose.
  assert.equal(isClientDeadline(new Error('the operation timed out')), false, 'a message that mentions a timeout')
})
