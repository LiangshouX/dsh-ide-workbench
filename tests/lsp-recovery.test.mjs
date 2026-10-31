import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeFrame } from '../src/host/lsp-frame.js'
import { makeManager, makeSink, sleep, waitFor } from './lsp-fixtures.mjs'
import { crashAdviceFor } from '../src/client/store.js'

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-${name}`)
}

test('a language server that exits with an error is restarted once', async () => {
  const { manager, spawned, handle } = makeManager({ restartBackoffMs: 10 })
  const root = rootOf('crash-exit')
  const sink = makeSink()
  manager.attachSink(root, sink)
  await manager.start({ root })

  handle().exit(134)
  await sleep(150)

  assert.equal(spawned.length, 2, 'the language server is started again exactly once')
  assert.equal((await manager.status({ root })).state, 'building')
  const crash = sink.events.find(event => event.type === 'crash')
  assert.ok(crash, 'the crash is reported to the client')
  // The detail is the FACT. The host used to add "a common cause is not
  // enough memory" to every crash - and the most common cause is a request
  // that took too long, which has nothing to do with the memory. The advice
  // is picked by the reason (see `crashAdviceFor`).
  assert.doesNotMatch(crash.detail, /memory/i, 'the crash does not blame the memory')
  assert.match(crash.detail, /exited unexpectedly/i, 'the detail says what happened')
  assert.equal(crashAdviceFor('3 request timeouts', key => key), 'lsp.crashedTimeout')
  assert.equal(crashAdviceFor('the server ran out of memory', key => key), 'lsp.crashedMemory')
  assert.equal(crashAdviceFor('something else', key => key), 'lsp.crashedGeneric')
})

test('a language server whose output stream closes is treated as crashed', async () => {
  const { manager, spawned, handle } = makeManager({ restartBackoffMs: 10 })
  const root = rootOf('crash-eof')
  await manager.start({ root })

  handle().stdout.end()
  await sleep(150)

  assert.equal(spawned.length, 2)
  assert.notEqual((await manager.status({ root })).state, 'crashed')
})

test('a language server that stops answering is treated as crashed', async () => {
  const { manager, spawned } = makeManager({ restartBackoffMs: 10 })
  const root = rootOf('crash-timeout')
  await manager.start({ root })

  // Two timeouts are not enough; the third one is.
  manager.noteTimeout(root)
  manager.noteTimeout(root)
  await sleep(20)
  assert.equal(spawned.length, 1, 'the server survives two timeouts')
  manager.noteTimeout(root)
  await sleep(150)

  assert.equal(spawned.length, 2, 'the language server is started again exactly once')
})

test('a language server that crashes twice is not started again', async () => {
  const { manager, spawned, handle } = makeManager({ restartBackoffMs: 10 })
  const root = rootOf('crash-twice')
  const sink = makeSink()
  manager.attachSink(root, sink)
  await manager.start({ root })

  handle().exit(134)
  await sleep(150)
  assert.equal(spawned.length, 2)

  handle(1).exit(134)
  await sleep(150)

  assert.equal(spawned.length, 2, 'there is no second automatic restart')
  const status = await manager.status({ root })
  assert.equal(status.state, 'degraded')
  // The detail is the fact; the advice follows the reason.
  assert.match(status.detail, /already used once/i)
})

test('the process identity changes when the language server is restarted', async () => {
  // The client cannot see the process: the WebSocket between the browser and
  // the host stays open when the language server crashes (only the server
  // process is replaced). The identity is how the client learns that the
  // server behind the socket is a new one - and that it has to build the
  // program of the project again (review T1).
  const { manager, spawned, handle } = makeManager({ restartBackoffMs: 10 })
  const root = rootOf('process-identity')
  await manager.start({ root })

  const first = manager.stateOf(root).processId
  assert.equal(first, 1, 'the first process has the identity 1')

  // The identity is stable while the process lives: the client may only
  // reset its request budget when the number moves.
  assert.equal(
    manager.stateOf(root).processId,
    first,
    'the identity does not change within one process',
  )
  assert.equal(
    (await manager.status({ root })).processId,
    first,
    'the status of the host carries the same identity',
  )

  handle().exit(134)
  assert.equal(
    await waitFor(() => spawned.length === 2),
    true,
    'the language server was started again',
  )

  assert.equal(
    await waitFor(() => manager.stateOf(root).processId === 2),
    true,
    'the new process has its own identity',
  )
  assert.equal(
    (await manager.status({ root })).processId,
    2,
    'the status of the host carries the new identity',
  )
})

test('a root without a language server has no process identity', () => {
  const { manager } = makeManager()
  assert.equal(
    manager.stateOf(rootOf('process-identity-none')).processId,
    0,
    'a root without a server has no identity',
  )
})

test('the process identity does not go backwards when the session is replaced', async () => {
  // The identity is the fact the client watches to learn that the server
  // behind the WebSocket is a new one. It may never go backwards: a session
  // that is replaced (after a cancel, for example) starts a new process, and
  // the client has to see that.
  const { manager, spawned } = makeManager({ restartBackoffMs: 10, graceMs: 20 })
  const root = rootOf('process-identity-session')
  await manager.start({ root })
  assert.equal(manager.stateOf(root).processId, 1, 'the first process has the identity 1')

  await manager.cancelIndex({ root })
  await manager.start({ root })

  assert.equal(spawned.length, 2, 'a second process was started')
  assert.equal(
    manager.stateOf(root).processId,
    2,
    'the identity of the project moved on',
  )
})

test('a crashed language server is not restarted when the memory is not enough', async () => {
  let freeBytes = 8 * 1024 ** 3
  const { manager, spawned, handle } = makeManager({
    restartBackoffMs: 10,
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes }),
  })
  const root = rootOf('crash-no-memory')
  await manager.start({ root })

  // The crash was an out-of-memory kill: the machine is out of memory now.
  freeBytes = 64 * 1024 ** 2
  handle().exit(134)
  await sleep(150)

  assert.equal(spawned.length, 1, 'no restart without free memory')
  const status = await manager.status({ root })
  assert.equal(status.state, 'degraded')
  assert.match(status.detail, /64 MB/, 'the message names the free memory')
  assert.match(status.detail, /384 MB/, 'the message names the memory that is needed')
})

test('the documents of the user are opened again after a restart', async () => {
  const { manager, spawned, handle } = makeManager({ restartBackoffMs: 10 })
  const root = rootOf('crash-reopen')
  await manager.start({ root })
  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: { textDocument: { uri: 'file:///workspace/app.ts', languageId: 'typescript', version: 1, text: 'const a = 1\n' } },
  }))
  await sleep(10)

  handle().exit(134)
  await sleep(150)

  const payloads = handle(1).stdinChunks.map(chunk => chunk.toString('utf8'))
  assert.ok(payloads.length > 0, 'the restarted server is addressed')
  const reopened = payloads.find(payload => payload.includes('textDocument/didOpen'))
  assert.ok(reopened, 'the document is opened again')
  assert.ok(reopened.includes('file:///workspace/app.ts'))
})

test('the restarted language server becomes ready again', async () => {
  const { manager, spawned, handle } = makeManager({ restartBackoffMs: 10, readyDelayMs: 10 })
  const root = rootOf('crash-ready')
  await manager.start({ root })
  handle().exit(134)
  await sleep(150)

  handle(1).stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })))
  await sleep(80)
  assert.equal((await manager.status({ root })).state, 'ready')
})

test('a language server that dies after a restart is not swallowed', async () => {
  // D7: `session.exited` was set to true on the crash path and never reset,
  // so the death of the *new* process was swallowed and the host believed
  // the server was still running.
  const { manager, spawned, handle } = makeManager({ restartBackoffMs: 10, readyDelayMs: 10 })
  const root = rootOf('crash-silent-death')
  await manager.start({ root })

  handle().exit(134)
  await sleep(150)
  assert.equal(spawned.length, 2, 'the language server was started again')

  // The new process dies as well: its stdout ends.
  handle(1).stdout.end()
  await sleep(150)

  const status = await manager.status({ root })
  assert.notEqual(
    status.state,
    'building',
    'the session does not stay in "building" while the server is dead',
  )
  assert.notEqual(status.state, 'ready', 'the session does not claim to be ready')
})

// ── the host has to survive every crash ───────────────────────────────────
//
// A plugin that leaks an unhandled rejection takes the whole DSH host down
// (the harness treats it as a fatal load failure), and a throw inside a
// timer callback is an *uncaught* exception, which ends the process just as
// hard. These tests watch for both.

/**
 * Watch for the two ways a plugin can kill the host.
 * @returns {{ stop: () => string[], failures: string[] }}
 */
function watchHost() {
  const failures = []
  const onUnhandled = reason => { failures.push(`unhandled rejection: ${String(reason)}`) }
  const onUncaught = error => { failures.push(`uncaught exception: ${String(error)}`) }
  process.on('unhandledRejection', onUnhandled)
  process.on('uncaughtException', onUncaught)
  return {
    failures,
    stop() {
      process.off('unhandledRejection', onUnhandled)
      process.off('uncaughtException', onUncaught)
      return failures
    },
  }
}

test('a crash of the language server does not leak an unhandled rejection', async () => {
  const watcher = watchHost()
  try {
    const { manager, handle } = makeManager({ restartBackoffMs: 10, graceMs: 20 })
    const root = rootOf('crash-host')
    await manager.start({ root })

    handle().exit(134)
    await sleep(200)
    handle(1).exit(134)
    await sleep(200)

    assert.deepEqual(watcher.stop(), [], 'the host did not see a rejected promise')
  } finally {
    watcher.stop()
  }
})

test('a cancel while the language server restarts does not kill the host', async () => {
  const watcher = watchHost()
  try {
    // The process takes a while to start: the session may change its state
    // in that window, and the restart must not drag it back into a build it
    // has left (the illegal transition that ended the DSH host once).
    const { manager, handle, warnings } = makeManager({ restartBackoffMs: 10, spawnDelayMs: 60, graceMs: 20 })
    const root = rootOf('crash-cancel-race')
    await manager.start({ root })

    handle().exit(134)
    await sleep(40)
    await manager.cancelIndex({ root })
    await sleep(250)

    assert.deepEqual(watcher.stop(), [], 'the host did not see a rejected promise')
    const status = await manager.status({ root })
    assert.equal(status.state, 'cancelled', 'the cancel won over the restart')
    assert.deepEqual(
      warnings.filter(warning => /failed/.test(warning)),
      [],
      'the restart gave up quietly instead of failing a step',
    )
  } finally {
    watcher.stop()
  }
})

test('an illegal state change is reported and does not kill the host', async () => {
  const watcher = watchHost()
  try {
    const { manager } = makeManager()
    const root = rootOf('crash-transition')
    await manager.start({ root })

    // 'building' → 'starting' is not a legal transition: the manager
    // refuses it instead of corrupting the state machine.
    assert.throws(
      () => manager.transition(root, 'starting'),
      /illegal language server state transition/,
      'the caller learns about the illegal transition',
    )
    await sleep(50)
    assert.deepEqual(watcher.stop(), [], 'the host did not see an uncaught exception')
  } finally {
    watcher.stop()
  }
})

// ── a broken pipe may not kill the host ───────────────────────────────────
//
// The EPIPE of a language server that is already gone arrives ASYNCHRONOUSLY
// through the 'error' event of the stdin stream: the write has returned by
// then, so the try/catch around it cannot catch anything. A stream without an
// 'error' listener turns that error into an *uncaught exception* - and an
// uncaught exception in the host ends the whole DSH process (the crash the
// user saw when the project was switched or a build was chosen).

test('writing to a dead server\'s stdin does not kill the host', async () => {
  const uncaught = []
  const onUncaught = error => { uncaught.push(error) }
  process.on('uncaughtException', onUncaught)
  try {
    const { manager, handle } = makeManager({ failStdin: true, restartBackoffMs: 10 })
    const root = rootOf('epipe')
    await manager.start({ root })

    // A frame that is written into the pipe of a server that is already gone.
    manager.relayToServer(root, JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params: {},
    }))
    // The error of the stream arrives in a later turn of the event loop.
    await sleep(100)

    assert.deepEqual(uncaught.map(String), [], 'the host did not see an uncaught exception')
    assert.ok(
      handle().stdin.listenerCount('error') > 0,
      'the manager listens for the error of the stdin stream',
    )
  } finally {
    process.off('uncaughtException', onUncaught)
  }
})

test('a frame that arrives after the server was stopped is not written into the dead pipe', async () => {
  const { manager, workers, handle } = makeManager({ graceMs: 20 })
  const root = rootOf('dead-pipe')
  await manager.start({ root })
  const dead = handle()

  await manager.cancelIndex({ root })

  // The frame worker is a thread: it answers in a later turn of the event
  // loop, so a frame can still be on its way while the process dies. Such a
  // frame must not be written into the pipe of the dead process - the write
  // into a broken pipe is what ended the host.
  workers[0].emit('message', { type: 'stdin', data: Buffer.from('a late frame') })
  await sleep(50)

  const chunks = dead.stdinChunks.map(chunk => chunk.toString('utf8'))
  assert.equal(
    chunks.some(chunk => chunk.includes('a late frame')),
    false,
    'the dead pipe was not written into',
  )
})

test('the frames of the worker of the previous generation do not reach the new server', async () => {
  const { manager, spawned, workers, handle } = makeManager({ restartBackoffMs: 10 })
  const root = rootOf('generation-fence')
  await manager.start({ root })

  // The server dies and is started again.
  handle().exit(134)
  await sleep(150)
  assert.equal(spawned.length, 2, 'the language server was started again')
  assert.equal(workers[0].terminated, true, 'the worker of the old generation was stopped')

  // A frame of the old worker that arrives after the restart. It belongs to
  // the previous generation: the new server must never see it - a
  // `didChange` with a stale version is a protocol violation, and the pipe of
  // the old process may be broken already.
  workers[0].emit('message', { type: 'stdin', data: Buffer.from('a frame of the old generation') })
  await sleep(50)

  const chunks = handle(1).stdinChunks.map(chunk => chunk.toString('utf8'))
  assert.equal(
    chunks.some(chunk => chunk.includes('a frame of the old generation')),
    false,
    'the frame of the old worker did not reach the new server',
  )
})
