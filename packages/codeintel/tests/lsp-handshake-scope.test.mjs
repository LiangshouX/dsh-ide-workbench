/**
 * The handshake of the client belongs to the host (P1-1).
 *
 * The `rootUri` of the handshake is what decides the program of the language
 * server - the `cwd` of the process does not. A client that rebuilds itself
 * (or that asks for another scope) sends a new handshake, and the server
 * that is started LATER has to be initialized with the handshake the client
 * is using NOW. With the old handshake kept for ever, the index scope
 * silently reverted to the old one on the next restart.
 *
 * The host has to own the handshake, because the worker cannot report it:
 * the worker absorbs a second `initialize` (a second one would be a
 * protocol violation) and it reports only the FIRST one - and that report
 * arrives asynchronously, so it may arrive after a newer handshake was
 * recorded.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { decodeChunks, makeManager, makeSink, sleep, waitFor } from './lsp-fixtures.mjs'

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-handshake-${name}`)
}

/**
 * The `initialize` request of the browser.
 * @param {number} [id] the id of the request
 * @param {string} [rootUri] the root of the project the client announces
 * @returns {string} the payload
 */
function initializeText(id = 1, rootUri = 'file:///workspace') {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: { processId: null, rootUri, capabilities: {} },
  })
}

test('a handshake that arrives while the server runs is the one a restarted server is initialized with', async () => {
  // The worker absorbs the second handshake - it answers it from its cache
  // and never forwards it - so the host never learns about it from the
  // worker. The host has to record it itself.
  const { manager, spawned, handle } = makeManager({ restartBackoffMs: 10 })
  const root = rootOf('running')
  manager.attachSink(root, makeSink())
  await manager.start({ root })

  // The first handshake reaches the server: the worker forwards it.
  manager.relayToServer(root, initializeText(1, 'file:///workspace/old'))
  await sleep(20)

  // The client asks for another scope while the server runs. The worker
  // absorbs it - a second `initialize` is a protocol violation - and it
  // never reports it to the host.
  manager.relayToServer(root, initializeText(2, 'file:///workspace/sub-project'))
  await sleep(20)

  // The second handshake must not reach the running server.
  const first = decodeChunks(handle().stdinChunks)
  assert.equal(first.filter(frame => frame.includes('"method":"initialize"')).length, 1, 'the server is initialized once')

  // The server crashes and is started again.
  handle().exit(134)
  assert.ok(await waitFor(() => spawned.length === 2), 'the language server was started again')

  const frames = decodeChunks(spawned[1].handle.stdinChunks)
  const handshakes = frames.filter(frame => frame.includes('"method":"initialize"'))
  assert.equal(handshakes.length, 1, 'the new server is initialized exactly once')
  assert.match(handshakes[0], /workspace\/sub-project/, 'the newest handshake is the one that reached the server')
})

test('a late handshake message of the worker does not overwrite the newer handshake', async () => {
  // The message of the worker is asynchronous: it can arrive after the host
  // recorded a newer handshake, and it carries the OLD text. The newest
  // handshake wins - the host owns it.
  const { manager, spawned, workers, handle } = makeManager({ restartBackoffMs: 10 })
  const root = rootOf('late')
  manager.attachSink(root, makeSink())
  await manager.start({ root })

  manager.relayToServer(root, initializeText(1, 'file:///workspace/old'))
  await sleep(20)
  manager.relayToServer(root, initializeText(2, 'file:///workspace/new'))
  await sleep(20)

  // The worker reports its handshake late.
  workers[0].emit('message', { type: 'handshake', text: initializeText(1, 'file:///workspace/old') })

  handle().exit(134)
  assert.ok(await waitFor(() => spawned.length === 2), 'the language server was started again')

  const frames = decodeChunks(spawned[1].handle.stdinChunks)
  const handshakes = frames.filter(frame => frame.includes('"method":"initialize"'))
  assert.equal(handshakes.length, 1)
  assert.match(handshakes[0], /workspace\/new/, 'the late message did not overwrite the newer handshake')
})

test('the handshake of a server that starts later is the one of the client', async () => {
  // The path of the review-fixes test (the server is not running yet): the
  // handshake waits in the queue and is replayed to the new process.
  const { manager, handle } = makeManager()
  const root = rootOf('queued')
  manager.attachSink(root, makeSink())

  manager.relayToServer(root, initializeText(1, 'file:///workspace/queued'))
  await manager.start({ root })

  const frames = decodeChunks(handle().stdinChunks)
  const handshakes = frames.filter(frame => frame.includes('"method":"initialize"'))
  assert.equal(handshakes.length, 1)
  assert.match(handshakes[0], /workspace\/queued/)
})
