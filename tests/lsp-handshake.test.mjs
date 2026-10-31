/**
 * Regression tests for the buffered client handshake.
 *
 * The browser opens its WebSocket long before the language server exists:
 * the workbench connects, the client sends its `initialize`, and only later
 * does the user pick a project. The host used to drop that handshake, so the
 * language server was never initialized, the session stayed in "building"
 * and every request (a `Ctrl+click` for example) ran into its 30 second
 * timeout.
 *
 * The host now holds the client payloads until a language server can take
 * them, and it keeps the handshake of the browser for the next process.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Handshake } from '../src/host/lsp-worker.js'
import { makeManager, makeSink, sleep } from './lsp-fixtures.mjs'

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-${name}`)
}

/**
 * The `initialize` request of the browser.
 * @param {number} [id] the id of the request
 * @returns {string} the payload
 */
function initializeText(id = 1) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: { processId: null, rootUri: 'file:///workspace', capabilities: {} },
  })
}

/**
 * One `textDocument/didOpen` notification.
 * @param {string} [uri] the URI of the document
 * @returns {string} the payload
 */
function didOpenText(uri = 'file:///workspace/app.ts') {
  return JSON.stringify({
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: {
      textDocument: { uri, languageId: 'typescript', version: 1, text: 'const a = 1\n' },
    },
  })
}

/**
 * The client payloads one worker received.
 * @param {any} worker the fake worker
 * @returns {any[]} the payloads of the browser
 */
function clientPayloads(worker) {
  return worker.posted.filter(message => message.type === 'send' && message.origin === 'client')
}

test('a handshake that arrives before the language server is held instead of dropped', () => {
  const { manager, workers } = makeManager()
  const root = rootOf('handshake-held')
  // The relay attaches the client first: the socket exists long before the
  // language server does.
  manager.attachSink(root, makeSink())

  const init = initializeText()
  assert.equal(manager.relayToServer(root, init), false, 'there is no language server yet')
  assert.equal(workers.length, 0, 'no worker exists, so nothing could be lost')
})

test('the held handshake is replayed when the language server starts', async () => {
  const { manager, workers } = makeManager()
  const root = rootOf('handshake-replay')
  manager.attachSink(root, makeSink())

  const init = initializeText()
  assert.equal(manager.relayToServer(root, init), false, 'the handshake arrives too early')

  await manager.start({ root })

  assert.equal(workers.length, 1, 'the language server got a worker')
  const payloads = clientPayloads(workers[0])
  assert.equal(payloads.length, 1, 'the held handshake is the only payload of the worker')
  assert.deepEqual(
    payloads[0],
    { type: 'send', text: init, origin: 'client' },
    'the handshake reaches the language server unchanged',
  )
})

test('the held payloads are replayed in the order they arrived', async () => {
  const { manager, workers } = makeManager()
  const root = rootOf('handshake-order')
  manager.attachSink(root, makeSink())

  const init = initializeText()
  const open = didOpenText()
  manager.relayToServer(root, init)
  manager.relayToServer(root, open)

  await manager.start({ root })

  const payloads = clientPayloads(workers[0]).map(message => message.text)
  assert.deepEqual(payloads, [init, open], 'the handshake comes before the document')
})

test('a payload of a running language server is not buffered', async () => {
  const { manager, workers } = makeManager()
  const root = rootOf('handshake-direct')
  manager.attachSink(root, makeSink())
  await manager.start({ root })

  const open = didOpenText()
  assert.equal(manager.relayToServer(root, open), true, 'the language server is running')

  const payloads = clientPayloads(workers[0])
  assert.equal(payloads.length, 1)
  assert.deepEqual(payloads[0], { type: 'send', text: open, origin: 'client' })
})

test('the handshake of the browser is kept and replayed after a crash', async () => {
  const { manager, workers, handle } = makeManager({ restartBackoffMs: 10 })
  const root = rootOf('handshake-restart')
  manager.attachSink(root, makeSink())
  await manager.start({ root })

  // The worker tells the host which payload was the handshake of the browser.
  const init = initializeText()
  workers[0].emit('message', { type: 'handshake', text: init })
  assert.equal(clientPayloads(workers[0]).length, 0, 'the handshake was not sent to the server yet')

  // A document is open, so the restart has to open it again.
  manager.relayToServer(root, didOpenText())
  await sleep(10)

  handle().exit(134)
  await sleep(150)

  assert.equal(workers.length, 2, 'the language server was started again')
  const replayed = clientPayloads(workers[1])
  assert.equal(replayed.length, 1, 'the new process is initialized again')
  assert.deepEqual(
    replayed[0],
    { type: 'send', text: init, origin: 'client' },
    'the new process receives the handshake of the browser',
  )

  // The handshake comes first: a language server that was not initialized
  // would ignore every document that follows.
  const posted = workers[1].posted.filter(message => message.type === 'send')
  const reopen = posted.find(message => message.origin === 'host')
  assert.ok(reopen !== undefined, 'the document is opened again')
  assert.match(reopen.text, /textDocument\/didOpen/)
  assert.ok(
    posted.indexOf(reopen) > posted.findIndex(message => message.origin === 'client'),
    'the document comes after the handshake',
  )
})

test('the buffer of the waiting payloads is bounded', async () => {
  const { manager, workers } = makeManager()
  const root = rootOf('handshake-bounded')
  manager.attachSink(root, makeSink())

  // The host keeps at most 64 payloads: the browser cannot fill the memory
  // of the host with a socket that stays open.
  const payloads = []
  for (let index = 0; index < 70; index += 1) {
    const text = JSON.stringify({ jsonrpc: '2.0', method: 'textDocument/didChange', params: { index } })
    payloads.push(text)
    manager.relayToServer(root, text)
  }

  await manager.start({ root })

  const replayed = clientPayloads(workers[0]).map(message => message.text)
  assert.equal(replayed.length, 64, 'the buffer is bounded')
  assert.equal(replayed[0], payloads[6], 'the oldest payloads are dropped')
  assert.equal(replayed[replayed.length - 1], payloads[69], 'the newest payload is kept')
})

test('the worker forwards only the first initialize request', () => {
  const handshake = new Handshake()
  const first = initializeText(1)
  const second = initializeText(2)

  assert.equal(handshake.noteForwarded(first), true, 'the first handshake reaches the server')
  assert.equal(handshake.noteForwarded(second), false, 'a second handshake is not forwarded')
  assert.deepEqual(handshake.duplicates, [2], 'the second handshake is remembered')

  // The server answers the first handshake.
  const answered = handshake.noteServerPayload(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: { capabilities: { definitionProvider: true } },
  }))
  assert.equal(answered, true, 'the answer of the server is remembered')

  const pending = handshake.takePendingAnswers()
  assert.equal(pending.length, 1, 'the absorbed handshake is answered')
  assert.deepEqual(
    JSON.parse(pending[0]),
    { jsonrpc: '2.0', id: 2, result: { capabilities: { definitionProvider: true } } },
    'the answer carries the id of the second handshake and the capabilities of the server',
  )
})

test('a payload that is not a handshake is never forwarded as one', () => {
  const handshake = new Handshake()
  assert.equal(handshake.noteForwarded(didOpenText()), false, 'a document is not a handshake')
  assert.equal(handshake.requestId, null, 'no handshake was seen')
  assert.deepEqual(handshake.duplicates, [])
})

test('the worker answers no handshake when there was no duplicate', () => {
  const handshake = new Handshake()
  assert.equal(handshake.noteForwarded(initializeText(1)), true)
  assert.deepEqual(handshake.takePendingAnswers(), [], 'there is nothing to answer before the server replies')

  handshake.noteServerPayload(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } }))
  assert.deepEqual(handshake.takePendingAnswers(), [], 'there is nothing to answer without a duplicate')
})
