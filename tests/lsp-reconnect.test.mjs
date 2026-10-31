import test from 'node:test'
import assert from 'node:assert/strict'
import { Handshake } from '../src/host/lsp-worker.js'
import { createLspTransport } from '../src/client/lsp-transport.js'

/** A WebSocket double that the test drives by hand. */
class FakeSocket {
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.sent = []
    this.listeners = new Map()
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(handler)
  }

  emit(type, event = {}) {
    for (const handler of this.listeners.get(type) ?? []) handler(event)
  }

  send(data) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
    this.emit('close', { code: 1006, reason: 'gone' })
  }

  open() {
    this.readyState = 1
    this.emit('open', {})
  }
}

test('the first handshake is forwarded to the server', () => {
  const handshake = new Handshake()
  const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
  assert.equal(handshake.noteForwarded(request), true)
  assert.equal(handshake.requestId, 1)
  // Without a cached result the request has to reach the server.
  assert.equal(handshake.answerFor(request), null)
})

test('the capabilities of the server are cached from its answer', () => {
  const handshake = new Handshake()
  const request = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'initialize', params: {} })
  handshake.noteForwarded(request)
  const response = JSON.stringify({
    jsonrpc: '2.0', id: 7, result: { capabilities: { definitionProvider: true } },
  })
  assert.equal(handshake.noteServerPayload(response), true)
  assert.deepEqual(handshake.result, { capabilities: { definitionProvider: true } })
})

test('a second handshake is answered from the cache instead of the server', () => {
  const handshake = new Handshake()
  handshake.noteForwarded(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }))
  handshake.noteServerPayload(JSON.stringify({
    jsonrpc: '2.0', id: 1, result: { capabilities: { referencesProvider: true } },
  }))
  // The browser reconnects and asks again with a new id.
  const again = JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'initialize', params: {} })
  const answer = handshake.answerFor(again)
  assert.ok(answer !== null)
  const parsed = JSON.parse(answer)
  assert.equal(parsed.id, 42)
  assert.deepEqual(parsed.result, { capabilities: { referencesProvider: true } })
})

test('the cache ignores the traffic that is not the handshake', () => {
  const handshake = new Handshake()
  handshake.noteForwarded(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'initialize', params: {} }))
  // A response with another id is not the answer to the handshake.
  assert.equal(handshake.noteServerPayload(JSON.stringify({ jsonrpc: '2.0', id: 99, result: { capabilities: {} } })), false)
  // A response without capabilities is not the answer either.
  assert.equal(handshake.noteServerPayload(JSON.stringify({ jsonrpc: '2.0', id: 3, result: {} })), false)
  assert.equal(handshake.result, null)
})

test('a payload that is not JSON never breaks the handshake', () => {
  const handshake = new Handshake()
  assert.equal(handshake.noteForwarded('not json'), false)
  assert.equal(handshake.noteServerPayload('not json'), false)
  assert.equal(handshake.answerFor('not json'), null)
})

test('the transport reports the first opening and every reopening', async () => {
  const sockets = []
  class Impl extends FakeSocket {
    constructor(url) {
      super(url)
      sockets.push(this)
    }
  }
  const events = []
  const transport = createLspTransport({
    url: 'ws://localhost/ide-workbench/ws/lsp',
    WebSocketImpl: Impl,
    onOpen: info => events.push(info.reopened),
  })
  transport.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }))
  assert.equal(sockets.length, 1)
  sockets[0].open()
  assert.deepEqual(events, [false])
  // The socket dies and the transport reconnects.
  sockets[0].close()
  await new Promise(resolve => setTimeout(resolve, 600))
  assert.equal(sockets.length, 2)
  sockets[1].open()
  assert.deepEqual(events, [false, true])
  transport.close()
})

test('the transport flushes the messages that were queued while it was down', async () => {
  const sockets = []
  class Impl extends FakeSocket {
    constructor(url) {
      super(url)
      sockets.push(this)
    }
  }
  const transport = createLspTransport({
    url: 'ws://localhost/ide-workbench/ws/lsp',
    WebSocketImpl: Impl,
  })
  transport.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }))
  assert.equal(transport.queued, 1)
  sockets[0].open()
  assert.equal(transport.queued, 0)
  assert.deepEqual(sockets[0].sent, [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })])
  transport.close()
})
