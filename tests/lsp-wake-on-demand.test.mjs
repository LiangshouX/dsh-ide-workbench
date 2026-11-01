/**
 * The wake after an idle release (PRD-v5 §3.3, IDLE-02/IDLE-03).
 *
 * The idle release gave the memory of the language server back to the
 * machine. The user must not have to rebuild the index by hand: the first
 * payload that needs the server starts it again, and the payload is
 * answered as soon as the new process exists.
 *
 * Two rules make the wake safe:
 *
 *   - the payload is not written into a worker that does not exist. It
 *     waits in the queue of the root and is replayed when the process is
 *     there (the same way the handshake is).
 *   - a project the user put into the basic mode on purpose is not woken.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeFrame } from '../src/host/lsp-frame.js'
import { decodeChunks, makeManager, sleep, waitFor } from './lsp-fixtures.mjs'

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-wake-${name}`)
}

/**
 * One payload that needs a language server.
 * @param {number} id the JSON-RPC id
 * @returns {string} the payload
 */
function definitionOf(id) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'textDocument/definition',
    params: { textDocument: { uri: 'file:///workspace/app.ts' }, position: { line: 1, character: 2 } },
  })
}

/**
 * One payload that opens a document.
 * @param {string} uri the URI of the document
 * @returns {string} the payload
 */
function didOpenOf(uri) {
  return JSON.stringify({
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: { textDocument: { uri, languageId: 'typescript', version: 1, text: 'const a = 1\n' } },
  })
}

/**
 * Start a server, let it become ready and let the idle timer release it.
 * @param {object} fixture the manager fixture
 * @param {string} root the project root
 * @returns {Promise<void>}
 */
async function releaseByIdle(fixture, root) {
  const { manager, handle } = fixture
  await manager.start({ root })
  handle().stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })))
  await sleep(80)
  assert.equal((await manager.status({ root })).state, 'ready')
  await sleep(280)
  assert.equal((await manager.status({ root })).state, 'suspended', 'the server was released')
}

test('the first payload after the idle release starts the server again', async () => {
  const fixture = makeManager({ lsp: { idleTimeoutMs: 150, autoExit: true } })
  const { manager, spawned } = fixture
  const root = rootOf('start')
  await releaseByIdle(fixture, root)
  assert.equal(spawned.length, 1)

  manager.relayToServer(root, definitionOf(7))

  assert.ok(await waitFor(() => spawned.length === 2), 'the server was started again')
  const status = await manager.status({ root })
  assert.equal(status.state, 'building')
})

test('the payload is replayed once the new process exists', async () => {
  const fixture = makeManager({ lsp: { idleTimeoutMs: 150, autoExit: true } })
  const { manager, spawned } = fixture
  const root = rootOf('replay')
  await releaseByIdle(fixture, root)

  manager.relayToServer(root, definitionOf(7))
  assert.ok(await waitFor(() => spawned.length === 2), 'the server was started again')

  const payloads = decodeChunks(spawned[1].handle.stdinChunks)
  assert.ok(payloads.some(payload => payload.includes('textDocument/definition')), 'the request reached the new server')
})

test('the payload is not written into a worker that does not exist', async () => {
  const fixture = makeManager({ lsp: { idleTimeoutMs: 150, autoExit: true } })
  const { manager, spawned, workers } = fixture
  const root = rootOf('noworker')
  await releaseByIdle(fixture, root)

  manager.relayToServer(root, definitionOf(7))
  assert.ok(await waitFor(() => spawned.length === 2), 'the server was started again')

  // The worker of the released server is gone: a payload that was written
  // into it would be lost for ever.
  assert.equal(workers[0].terminated, true, 'the worker of the released server is gone')
  const old = workers[0].posted.filter(message => message.type === 'send')
  assert.equal(old.some(message => message.text.includes('textDocument/definition')), false)
  const fresh = workers[1].posted.filter(message => message.type === 'send')
  assert.ok(fresh.some(message => message.text.includes('textDocument/definition')), 'the new worker got the payload')
})

test('several payloads in the same tick start exactly one server', async () => {
  const fixture = makeManager({ lsp: { idleTimeoutMs: 150, autoExit: true } })
  const { manager, spawned } = fixture
  const root = rootOf('concurrent')
  await releaseByIdle(fixture, root)

  manager.relayToServer(root, definitionOf(7))
  manager.relayToServer(root, definitionOf(8))
  manager.relayToServer(root, definitionOf(9))
  await sleep(200)

  assert.equal(spawned.length, 2, 'one server, not three')
})

test('the document table of the host survives the idle release', async () => {
  const fixture = makeManager({ lsp: { idleTimeoutMs: 150, autoExit: true } })
  const { manager, spawned } = fixture
  const root = rootOf('documents')
  await releaseByIdle(fixture, root)

  // The document was open before the release: the host keeps it, so the
  // wake can announce it to the new server.
  manager.relayToServer(root, didOpenOf('file:///workspace/app.ts'))
  await sleep(40)
  manager.relayToServer(root, definitionOf(7))
  assert.ok(await waitFor(() => spawned.length === 2), 'the server was started again')

  const payloads = decodeChunks(spawned[1].handle.stdinChunks)
  const opens = payloads.filter(payload => payload.includes('textDocument/didOpen'))
  assert.equal(opens.length, 1, 'the document is opened exactly once')
  assert.ok(opens[0].includes('file:///workspace/app.ts'), 'it is the document of the user')
})

test('the process identity keeps counting up over the wake', async () => {
  const fixture = makeManager({ lsp: { idleTimeoutMs: 150, autoExit: true } })
  const { manager, spawned } = fixture
  const root = rootOf('process')
  await releaseByIdle(fixture, root)
  const before = (await manager.status({ root })).processId
  assert.equal(before, 1)

  manager.relayToServer(root, definitionOf(7))
  assert.ok(await waitFor(() => spawned.length === 2), 'the server was started again')

  const after = (await manager.status({ root })).processId
  assert.equal(after, 2, 'the client sees a new process and resets its budget')
})

test('a project in the basic mode is not woken', async () => {
  const root = rootOf('conservative')
  const fixture = makeManager({
    lsp: {
      idleTimeoutMs: 150,
      autoExit: true,
      // The user answered the memory question with "use the basic mode".
      memoryWarnedRoots: { [root]: 'conservative' },
    },
  })
  const { manager, spawned } = fixture
  await releaseByIdle(fixture, root)

  manager.relayToServer(root, definitionOf(7))
  await sleep(200)

  assert.equal(spawned.length, 1, 'the server stays away')
  assert.equal((await manager.status({ root })).state, 'suspended')
})

test('a project that was not put into the basic mode is woken', async () => {
  const root = rootOf('accepted')
  const fixture = makeManager({
    lsp: {
      idleTimeoutMs: 150,
      autoExit: true,
      memoryWarnedRoots: { [root]: 'accepted' },
    },
  })
  const { manager, spawned } = fixture
  await releaseByIdle(fixture, root)

  manager.relayToServer(root, definitionOf(7))
  assert.ok(await waitFor(() => spawned.length === 2), 'the server was started again')
})
