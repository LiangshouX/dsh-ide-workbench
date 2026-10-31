/**
 * Regression tests for the findings of the code review.
 *
 * The review of the code intelligence work (docs/PRD-v5-代码检视报告.md) found
 * a handful of defects that the previous test suite did not catch. Every test
 * in this file guards one of them:
 *
 *   - the held handshake has to reach the *stdin* of the language server, not
 *     only the worker (N1: the tests asserted on the wrong layer, so the
 *     whole path could break unnoticed),
 *   - the watchdog counts requests, not ticks (N2: one slow request killed
 *     the server after three seconds),
 *   - a session that ends does not leave its timers behind (N3),
 *   - a second `initialize` never reaches the server (N4),
 *   - the handshake survives a full queue of waiting payloads (N5),
 *   - the paths of the live states are compared the same way everywhere (N6),
 *   - a language that is turned off in the settings is never started (N7).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Worker } from 'node:worker_threads'
import { FrameDecoder, encodeFrame } from '../src/host/lsp-frame.js'
import { samePath } from '../src/host/workspace.js'
import { rootKey } from '../src/host/lsp.js'
import { makeManager, makeSink, sleep, waitFor, decodeChunks } from './lsp-fixtures.mjs'

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-review-${name}`)
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

// ── N1: the handshake has to reach the stdin of the language server ────────

test('the held handshake reaches the stdin of the language server', async () => {
  const { manager, handle } = makeManager()
  const root = rootOf('n1-stdin')
  manager.attachSink(root, makeSink())

  // The browser connects before the language server exists.
  manager.relayToServer(root, initializeText())
  await manager.start({ root })

  const frames = decodeChunks(handle().stdinChunks)
  assert.equal(frames.length, 1, 'the handshake is written to the server')
  assert.match(frames[0], /"method":"initialize"/, 'the handshake is the initialize request')
})

test('the payloads that waited for the server reach its stdin in order', async () => {
  const { manager, handle } = makeManager()
  const root = rootOf('n1-order')
  manager.attachSink(root, makeSink())

  manager.relayToServer(root, initializeText())
  manager.relayToServer(root, didOpenText())
  await manager.start({ root })

  const frames = decodeChunks(handle().stdinChunks)
  assert.equal(frames.length, 2, 'both payloads reach the server')
  assert.match(frames[0], /"method":"initialize"/, 'the handshake comes first')
  assert.match(frames[1], /textDocument\/didOpen/, 'the document comes second')
})

test('a handshake that arrives while the server runs reaches the stdin too', async () => {
  const { manager, handle } = makeManager()
  const root = rootOf('n1-direct')
  manager.attachSink(root, makeSink())
  await manager.start({ root })

  manager.relayToServer(root, initializeText())
  await sleep(20)

  const frames = decodeChunks(handle().stdinChunks)
  assert.equal(frames.length, 1)
  assert.match(frames[0], /"method":"initialize"/)
})

// ── N2: the watchdog counts requests, not ticks ────────────────────────────

test('one slow request does not kill the language server', async () => {
  const { manager, spawned } = makeManager({ lsp: { requestTimeoutMs: 40 } })
  const root = rootOf('n2-slow')
  await manager.start({ root })

  // A request that is never answered.
  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0', id: 9, method: 'textDocument/definition', params: {},
  }))
  await sleep(400)

  assert.equal(spawned.length, 1, 'the server is still the one process')
  const status = await manager.status({ root })
  assert.notEqual(status.state, 'degraded', 'the server was not killed by one slow request')
  assert.notEqual(status.state, 'crashed')
})

test('three unanswered requests kill the language server', async () => {
  const { manager, spawned } = makeManager({ lsp: { requestTimeoutMs: 40 } })
  const root = rootOf('n2-reset')
  await manager.start({ root })

  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'textDocument/definition', params: {},
  }))
  // The watchdog counts the stall when its next tick finds the request past
  // its deadline. The case waits for the counter instead of guessing how
  // long that takes: a busy machine may delay the tick by a lot.
  assert.equal(await waitFor(() => manager.stateOf(root).timeouts >= 1), true, 'the first stall was counted')
  assert.equal(spawned.length, 1, 'one stall does not kill the server')

  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0', id: 2, method: 'textDocument/definition', params: {},
  }))
  assert.equal(await waitFor(() => manager.stateOf(root).timeouts >= 2), true, 'the second stall was counted')
  assert.equal(spawned.length, 1, 'two stalls do not kill the server')

  // A third stall: three counted requests are the limit.
  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0', id: 3, method: 'textDocument/definition', params: {},
  }))
  assert.equal(await waitFor(() => spawned.length === 2), true, 'the third stalled request restarts the server')
})

test('the timeout counter is reset when the server answers again', async () => {
  // The reset is a second half of the timeout semantics: only *consecutive*
  // unanswered requests may kill the server. Three slow requests that are
  // each answered in between must leave the server alone - and this test has
  // to make the server answer, or the reset never runs.
  const { manager, spawned, workers } = makeManager({ lsp: { requestTimeoutMs: 40 } })
  const root = rootOf('n2-counter-reset')
  await manager.start({ root })

  for (let round = 1; round <= 3; round += 1) {
    manager.relayToServer(root, JSON.stringify({
      jsonrpc: '2.0', id: round, method: 'textDocument/definition', params: {},
    }))
    await sleep(150)
    // The server answers the request - through the worker, the way a real
    // server's stdout reaches the manager.
    workers[0].postMessage({
      type: 'stdout',
      data: encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: round, result: null })),
    })
    await sleep(30)
  }

  assert.equal(spawned.length, 1, 'the server answered every request and was never killed')
  const status = await manager.status({ root })
  assert.notEqual(status.state, 'degraded', 'the session is not degraded')
  assert.notEqual(status.state, 'crashed')
})

test('the timeout message does not claim a streak of timeouts', async () => {
  const { manager } = makeManager({ lsp: { requestTimeoutMs: 40 } })
  const root = rootOf('n2-message')
  await manager.start({ root })

  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'textDocument/definition', params: {},
  }))
  await sleep(400)

  const status = await manager.status({ root })
  assert.doesNotMatch(status.detail ?? '', /consecutive/, 'the message does not say "consecutive"')
})

// ── N3: a session that ends does not leave its timers behind ───────────────

/**
 * Count the timers that are still pending.
 *
 * The manager arms an idle timer and a watchdog for every session. A cancel,
 * a crash or an idle exit has to take them down with it, otherwise the host
 * keeps a wake-up per second alive for a session that does not exist.
 * @returns {() => number} the counter and the way to stop it
 */
function countPendingTimers() {
  const live = new Set()
  const realSetTimeout = globalThis.setTimeout
  const realSetInterval = globalThis.setInterval
  const realClearTimeout = globalThis.clearTimeout
  const realClearInterval = globalThis.clearInterval
  globalThis.setTimeout = (fn, ms, ...a) => { const t = realSetTimeout(fn, ms, ...a); live.add(t); return t }
  globalThis.setInterval = (fn, ms, ...a) => { const t = realSetInterval(fn, ms, ...a); live.add(t); return t }
  globalThis.clearTimeout = (t) => { live.delete(t); return realClearTimeout(t) }
  globalThis.clearInterval = (t) => { live.delete(t); return realClearInterval(t) }
  const pending = () => {
    let count = 0
    for (const timer of live) {
      if (timer._destroyed !== true) count += 1
    }
    return count
  }
  const restore = () => {
    globalThis.setTimeout = realSetTimeout
    globalThis.setInterval = realSetInterval
    globalThis.clearTimeout = realClearTimeout
    globalThis.clearInterval = realClearInterval
    for (const timer of live) {
      realClearTimeout(timer)
      realClearInterval(timer)
    }
    live.clear()
  }
  return { pending, restore }
}

test('a cancelled index leaves no timer behind', async () => {
  const { pending, restore } = countPendingTimers()
  try {
    const { manager } = makeManager({ graceMs: 20 })
    const root = rootOf('n3-cancel')
    await manager.start({ root })
    assert.equal(pending(), 2, 'the running session owns an idle timer and a watchdog')

    await manager.cancelIndex({ root })
    await sleep(700)
    assert.equal(pending(), 0, 'the cancel took the timers with it')
  } finally {
    restore()
  }
})

test('a crashed language server leaves no timer behind', async () => {
  const { pending, restore } = countPendingTimers()
  try {
    const { manager, handle } = makeManager({ graceMs: 20, restartBackoffMs: 10 })
    const root = rootOf('n3-crash')
    await manager.start({ root })

    handle().exit(134)
    await sleep(150)
    // The restart arms new timers, the crash must not leave the old ones.
    assert.ok(pending() <= 2, 'the crashed session left no timer behind')
  } finally {
    restore()
  }
})

test('a session that is replaced leaves no timer behind', async () => {
  const { pending, restore } = countPendingTimers()
  try {
    const { manager } = makeManager({ graceMs: 20 })
    const root = rootOf('n3-replaced')
    for (let round = 0; round < 3; round += 1) {
      await manager.start({ root })
      await manager.cancelIndex({ root })
      await sleep(700)
    }
    assert.equal(pending(), 0, 'three start/cancel rounds leave no timer behind')
  } finally {
    restore()
  }
})

// ── N4: a second initialize never reaches the server ───────────────────────

/**
 * Start the real frame worker in a thread and collect what it writes.
 * @returns {Promise<{ worker: Worker, stdin: string[], messages: string[], stop: () => void }>}
 */
async function startRealWorker() {
  const worker = new Worker(new URL('../src/host/lsp-worker.js', import.meta.url), { workerData: {} })
  const decoder = new FrameDecoder()
  const stdin = []
  const messages = []
  worker.on('message', (message) => {
    if (message.type === 'stdin') {
      for (const text of decoder.push(Buffer.from(message.data))) stdin.push(text)
      return
    }
    if (message.type === 'message') messages.push(message.text)
  })
  await new Promise((ok) => worker.once('online', ok))
  return {
    worker,
    stdin,
    messages,
    stop() { worker.terminate() },
  }
}

test('the worker writes only one initialize to the server', async () => {
  const frame = await startRealWorker()
  try {
    frame.worker.postMessage({ type: 'send', text: initializeText(1), origin: 'client' })
    frame.worker.postMessage({ type: 'send', text: initializeText(2), origin: 'client' })
    await sleep(300)

    assert.equal(frame.stdin.length, 1, 'the server is initialized once')
    assert.match(frame.stdin[0], /"id":1/, 'the first handshake is the one that is forwarded')
  } finally {
    frame.stop()
  }
})

test('the worker answers a second initialize from the cached capabilities', async () => {
  const frame = await startRealWorker()
  try {
    frame.worker.postMessage({ type: 'send', text: initializeText(1), origin: 'client' })
    frame.worker.postMessage({ type: 'send', text: initializeText(2), origin: 'client' })
    await sleep(200)

    // The server answers the first handshake.
    const answer = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { capabilities: { definitionProvider: true } } })
    frame.worker.postMessage({
      type: 'stdout',
      data: Buffer.from(`Content-Length: ${answer.length}\r\n\r\n${answer}`, 'utf8'),
    })
    await sleep(200)

    assert.equal(frame.stdin.length, 1, 'the second handshake did not reach the server')
    const ids = frame.messages.map(text => JSON.parse(text).id)
    assert.deepEqual(ids, [1, 2], 'the client gets an answer for both handshakes')
  } finally {
    frame.stop()
  }
})

test('a handshake that the server already answered is not written to it again', async () => {
  const frame = await startRealWorker()
  try {
    frame.worker.postMessage({ type: 'send', text: initializeText(1), origin: 'client' })
    await sleep(150)
    const answer = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } })
    frame.worker.postMessage({
      type: 'stdout',
      data: Buffer.from(`Content-Length: ${answer.length}\r\n\r\n${answer}`, 'utf8'),
    })
    await sleep(150)

    const before = frame.stdin.length
    frame.worker.postMessage({ type: 'send', text: initializeText(7), origin: 'client' })
    await sleep(200)
    assert.equal(frame.stdin.length, before, 'the third handshake did not reach the server')
    assert.ok(frame.messages.some(text => JSON.parse(text).id === 7), 'the client got its answer')
  } finally {
    frame.stop()
  }
})

// ── N5: the handshake survives a full queue ────────────────────────────────

test('the handshake survives a queue of waiting payloads', async () => {
  const { manager, handle } = makeManager()
  const root = rootOf('n5-queue')
  manager.attachSink(root, makeSink())

  manager.relayToServer(root, initializeText())
  for (let index = 0; index < 70; index += 1) {
    manager.relayToServer(root, JSON.stringify({
      jsonrpc: '2.0', method: 'textDocument/didChange', params: { index },
    }))
  }
  await manager.start({ root })

  const frames = decodeChunks(handle().stdinChunks)
  assert.ok(
    frames.some(frame => frame.includes('"method":"initialize"')),
    'the handshake was not dropped by the bounded queue',
  )
})

// ── N6: the paths are compared the same way everywhere ─────────────────────

test('a live state is found for the same folder in another spelling', () => {
  const root = rootOf('n6-path')
  const key = rootKey(root)
  const native = root.replace(/\//g, '\\')
  assert.equal(
    samePath(key, native),
    true,
    'the normalized key of the manager matches the native path of the client',
  )
})

// ── N7: a language that is turned off is never started ─────────────────────

test('a language that is turned off in the settings is not started', async () => {
  const { manager, spawned } = makeManager({ lsp: { servers: { typescript: { enabled: false } } } })
  const root = rootOf('n7-disabled')
  manager.attachSink(root, makeSink())

  const status = await manager.start({ root, languageId: 'typescript' })
  assert.equal(spawned.length, 0, 'no process was started')
  assert.equal(status.state, 'degraded')
  assert.match(status.detail ?? '', /turned off/i)
})

test('the registry reports a language that is turned off as disabled', async () => {
  const { manager } = makeManager({ lsp: { servers: { typescript: { enabled: false } } } })
  const registry = await manager.servers()
  assert.ok(
    registry.disabled.some(entry => entry.languageId === 'typescript'),
    'the language is listed as disabled',
  )
  assert.ok(
    !registry.available.some(entry => entry.languageId === 'typescript'),
    'the language is not listed as available',
  )
  assert.ok(
    !registry.missing.some(entry => entry.languageId === 'typescript'),
    'the language is not listed as missing either',
  )
})

// ── M1: the cancel is idempotent in every state (PRD §2.4) ─────────────────

test('cancelling a degraded session answers instead of failing', async () => {
  // The client polls the status every two seconds: it can still show
  // "building" while the host has already degraded the session (a crash or
  // not enough memory). Clicking the cancel button in that window must not
  // be an error.
  const { manager, spawned } = makeManager({
    lsp: { servers: { typescript: { command: 'no-such-language-server-xyz' } } },
  })
  const root = rootOf('m1-degraded')
  await manager.start({ root, languageId: 'typescript' })

  const before = await manager.status({ root })
  assert.equal(before.state, 'degraded', 'the session is degraded')

  const result = await manager.cancelIndex({ root })
  assert.deepEqual(result, { state: 'cancelled' }, 'the cancel answers with the same result')
  assert.equal(spawned.length, 0, 'the degraded session had no process to kill')
})

test('two concurrent cancels kill the process once and both answer', async () => {
  // The first cancel waits for the process to die; a second click in that
  // window must not be an illegal state change - and it must not answer
  // before the process is really gone (PRD §2.4: "取消返回时，进程树中
  // 不得再有该语言服务器").
  const { manager, handle } = makeManager({ terminateDelayMs: 300 })
  const root = rootOf('m1-concurrent')
  await manager.start({ root })

  const first = manager.cancelIndex({ root })
  await sleep(50)
  let exitedWhenSecondReturned = null
  const second = manager.cancelIndex({ root }).then(() => {
    exitedWhenSecondReturned = handle().exited
  })

  assert.deepEqual(await first, { state: 'cancelled' })
  await second
  assert.deepEqual(await first, { state: 'cancelled' })
  assert.equal(handle().terminateCalls, 1, 'the process is killed exactly once')
  assert.equal(
    exitedWhenSecondReturned,
    true,
    'the second cancel only answers when the process is gone',
  )
})

test('a cancel that arrives while the server starts leaves no process behind', async () => {
  // The cancel waits for a process that does not exist yet - the process
  // that is started a moment later must not survive it (PRD §2.4: no
  // language server is left behind after a cancel).
  const { manager, spawned, handle } = makeManager({ spawnDelayMs: 120 })
  const root = rootOf('m1-start-race')
  manager.attachSink(root, makeSink())

  const starting = manager.start({ root })
  await sleep(40)
  const result = await manager.cancelIndex({ root })
  assert.deepEqual(result, { state: 'cancelled' })

  // The start must not drag the cancelled session back into a build.
  await starting
  await sleep(200)
  assert.equal(spawned.length, 1, 'the process was started')
  assert.equal(handle().terminateCalls, 1, 'and it was stopped right away')
  assert.equal((await manager.status({ root })).state, 'cancelled')
})

test('a notification whose text contains a handshake is not a handshake', async () => {
  // The host recognizes the handshake without parsing the payload. A
  // notification that *contains* a handshake must not be mistaken for one -
  // and the real handshake has to be the first thing the server sees (the
  // review's robustness note).
  const { manager, handle } = makeManager()
  const root = rootOf('m1-fake-handshake')
  manager.attachSink(root, makeSink())

  // A didChange whose *text* contains a whole initialize request.
  const withText = JSON.stringify({
    jsonrpc: '2.0',
    method: 'textDocument/didChange',
    params: {
      textDocument: { uri: 'file:///workspace/app.ts', languageId: 'typescript', version: 1 },
      contentChanges: [{ text: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' }],
    },
  })
  // A didChange that carries an object with a "method" key of its own.
  const withNestedMethod = JSON.stringify({
    jsonrpc: '2.0',
    method: 'textDocument/didChange',
    params: {
      textDocument: { uri: 'file:///workspace/other.ts', languageId: 'typescript', version: 1 },
      contentChanges: [{ text: 'x' }],
      extra: { method: 'initialize', params: {} },
    },
  })
  assert.equal(manager.relayToServer(root, withText), false, 'there is no server yet')
  manager.relayToServer(root, withNestedMethod)
  manager.relayToServer(root, initializeText())

  await manager.start({ root })

  const frames = decodeChunks(handle().stdinChunks)
  assert.equal(frames.length, 3, 'every payload reaches the server')
  assert.match(frames[0], /"method":"initialize"/, 'the real handshake comes first')
  assert.match(frames[1], /textDocument\/didChange/)
  assert.match(frames[2], /textDocument\/didChange/)
})
