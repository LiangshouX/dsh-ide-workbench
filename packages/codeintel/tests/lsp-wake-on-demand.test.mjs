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
 *
 * The wake has to work more than once: the memory gate may refuse the
 * start, and the refusal must not end the semantic features of the project
 * for the rest of the session.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeFrame } from '../src/host/lsp-frame.js'
import { decodeChunks, makeManager, makeSink, sleep, waitFor } from './lsp-fixtures.mjs'

/** One megabyte in bytes. */
const MB = 1024 * 1024

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

/**
 * Wait until one root reaches a state.
 *
 * The wake is asynchronous: the payload is relayed, the settings are read
 * and the memory gate runs before the session changes its state. A test
 * that looks at the state right after the relay would look at the state
 * before the wake.
 * @param {object} manager the manager
 * @param {string} root the project root
 * @param {string} state the wanted state
 * @returns {Promise<boolean>}
 */
async function waitForState(manager, root, state) {
  return waitFor(() => manager.stateOf(root).state === state)
}

/**
 * The number of start attempts one root saw.
 *
 * Every attempt walks the session into `starting`, so the state events are
 * the honest counter of the attempts - a refused attempt starts no process
 * and would be invisible in the number of spawned processes.
 * @param {object} sink the sink of the client
 * @returns {number}
 */
function startAttempts(sink) {
  return sink.events.filter(event => event.type === 'state' && event.state === 'starting').length
}

/**
 * The number of degradation events one root sent to its clients.
 * @param {object} sink the sink of the client
 * @returns {number}
 */
function degradations(sink) {
  return sink.events.filter(event => event.type === 'degraded').length
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

// ── the wake has to work more than once ────────────────────────────────────
//
// The wake used to work exactly once. The idle release suspended the
// session, the first payload woke it, and the memory gate refused the
// start: the session became `degraded`, and every later payload was
// ignored - the user had to rebuild the index by hand (PRD-v5 §3.3,
// IDLE-02). The user is never asked, so the server simply stayed away.
//
// The host therefore has to know *why* a session degraded, and it has to
// let a later payload retry the degradations that are worth a retry: the
// memory of the machine changes, a missing server does not.

test('a wake that the memory gate refused is tried again after the backoff', async () => {
  let freeBytes = 8 * 1024 ** 3
  let clock = 0
  const fixture = makeManager({
    lsp: { idleTimeoutMs: 150, autoExit: true },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes }),
    now: () => Date.now() + clock,
  })
  const { manager, spawned } = fixture
  const root = rootOf('memory-retry')
  await releaseByIdle(fixture, root)
  assert.equal(spawned.length, 1)

  // The machine is tight now: the wake degrades instead of starting.
  freeBytes = 1000 * MB
  manager.relayToServer(root, definitionOf(7))
  assert.ok(await waitForState(manager, root, 'degraded'), 'the wake degraded')
  assert.equal(spawned.length, 1, 'no server was started')

  // The user freed the memory and the next payload tries again.
  freeBytes = 8 * 1024 ** 3
  clock += 61000
  fixture.document.lsp.idleTimeoutMs = 600000
  manager.relayToServer(root, definitionOf(8))
  assert.ok(await waitFor(() => spawned.length === 2), 'the server was started again')
  assert.equal((await manager.status({ root })).state, 'building')
})

test('a payload inside the backoff does not start a second attempt', async () => {
  let freeBytes = 8 * 1024 ** 3
  let clock = 0
  const fixture = makeManager({
    lsp: { idleTimeoutMs: 150, autoExit: true },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes }),
    now: () => Date.now() + clock,
  })
  const { manager, spawned } = fixture
  const root = rootOf('memory-backoff')
  const sink = makeSink()
  manager.attachSink(root, sink)
  await releaseByIdle(fixture, root)
  sink.events.length = 0

  // The first wake is refused by the memory gate.
  freeBytes = 1000 * MB
  manager.relayToServer(root, definitionOf(7))
  assert.ok(await waitForState(manager, root, 'degraded'), 'the wake degraded')
  assert.equal(startAttempts(sink), 1, 'the first payload tried once')

  // The next payload is inside the backoff window: the machine did not get
  // more memory, so no second attempt is made.
  manager.relayToServer(root, definitionOf(8))
  await sleep(200)
  assert.equal(startAttempts(sink), 1, 'the second payload did not start a second attempt')
  assert.equal(spawned.length, 1, 'no server was started')
})

test('a wake that the missing server degraded is not retried', async () => {
  let clock = 0
  const fixture = makeManager({
    lsp: { idleTimeoutMs: 150, autoExit: true },
    now: () => Date.now() + clock,
  })
  const { manager, spawned, document } = fixture
  const root = rootOf('not-installed')
  const sink = makeSink()
  manager.attachSink(root, sink)
  await releaseByIdle(fixture, root)
  sink.events.length = 0

  // The language server is not installed any more: the wake degrades.
  document.lsp.servers = { typescript: { command: 'iwb-language-server-that-is-not-installed' } }
  manager.relayToServer(root, definitionOf(7))
  assert.ok(await waitForState(manager, root, 'degraded'), 'the wake degraded')
  assert.equal(spawned.length, 1, 'no server was started')

  // A later payload does not try again: the user has to install the server,
  // and a retry would only repeat the same refusal.
  clock += 61000
  manager.relayToServer(root, definitionOf(8))
  await sleep(200)
  assert.equal(startAttempts(sink), 1, 'the missing server is not retried')
  assert.equal(spawned.length, 1, 'the server stays away')
})

test('the payload of a failed wake is replayed after the successful retry', async () => {
  let freeBytes = 8 * 1024 ** 3
  let clock = 0
  const fixture = makeManager({
    lsp: { idleTimeoutMs: 150, autoExit: true },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes }),
    now: () => Date.now() + clock,
  })
  const { manager, spawned } = fixture
  const root = rootOf('replay-retry')
  await releaseByIdle(fixture, root)

  // The payloads of the user arrive while the machine is tight: they wait
  // in the queue of the root.
  freeBytes = 1000 * MB
  manager.relayToServer(root, didOpenOf('file:///workspace/app.ts'))
  manager.relayToServer(root, definitionOf(7))
  assert.ok(await waitForState(manager, root, 'degraded'), 'the wake degraded')
  assert.equal(spawned.length, 1, 'no server was started')

  // The retry succeeds: the queue is replayed to the new process.
  freeBytes = 8 * 1024 ** 3
  clock += 61000
  fixture.document.lsp.idleTimeoutMs = 600000
  manager.relayToServer(root, definitionOf(8))
  assert.ok(await waitFor(() => spawned.length === 2), 'the server was started again')

  const payloads = decodeChunks(spawned[1].handle.stdinChunks)
  const opens = payloads.filter(payload => payload.includes('textDocument/didOpen'))
  assert.equal(opens.length, 1, 'the document is opened exactly once')
  const failed = payloads.filter(payload => payload.includes('"id":7'))
  assert.equal(failed.length, 1, 'the payload of the failed wake is replayed exactly once')
})

test('a degradation that does not change the state is announced once', async () => {
  let freeBytes = 8 * 1024 ** 3
  let clock = 0
  const fixture = makeManager({
    lsp: { idleTimeoutMs: 150, autoExit: true },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes }),
    now: () => Date.now() + clock,
  })
  const { manager } = fixture
  const root = rootOf('one-event')
  const sink = makeSink()
  manager.attachSink(root, sink)
  await releaseByIdle(fixture, root)
  sink.events.length = 0

  // The first wake is refused by the memory gate: the client learns about
  // the degradation.
  freeBytes = 1000 * MB
  manager.relayToServer(root, definitionOf(7))
  assert.ok(await waitFor(() => degradations(sink) === 1), 'the degradation is announced')

  // The next attempt (after the backoff) fails in the same way: the state
  // of the root does not change, so it is not a new fault either.
  clock += 61000
  manager.relayToServer(root, definitionOf(8))
  await sleep(200)
  assert.equal(startAttempts(sink), 2, 'the second attempt was made')
  assert.equal(degradations(sink), 1, 'the client is not told about the same fault twice')
})

