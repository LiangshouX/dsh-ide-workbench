import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeFrame } from '../src/host/lsp-frame.js'
import { makeManager, makeSink, sleep } from './lsp-fixtures.mjs'

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
  assert.match(crash.detail, /memory/i, 'the message says that memory is a common cause')
  assert.match(crash.detail, /lower the memory limit/i, 'the message says what the user can do')
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
  assert.match(status.detail, /lower the memory limit/i)
  assert.match(status.detail, /conservative mode/i)
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
  assert.match(status.detail, /2048 MB/, 'the message names the memory that is needed')
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
