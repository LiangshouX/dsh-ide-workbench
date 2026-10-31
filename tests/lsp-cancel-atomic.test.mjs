import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { decodeChunks, makeManager, makeSink, sleep } from './lsp-fixtures.mjs'

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-${name}`)
}

/** One `textDocument/didOpen` notification of the browser client. */
function didOpen(uri = 'file:///workspace/app.ts') {
  return JSON.stringify({
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: { textDocument: { uri, languageId: 'typescript', version: 1, text: 'const answer = 42\n' } },
  })
}

test('cancelling stops the process and reports the cancelled state', async () => {
  const { manager, handle } = makeManager()
  const root = rootOf('cancel-state')
  await manager.start({ root })
  const result = await manager.cancelIndex({ root })
  assert.deepEqual(result, { state: 'cancelled' })
  assert.equal(handle().terminateCalls, 1, 'the process is terminated once')
  assert.equal((await manager.status({ root })).state, 'cancelled')
})

test('cancelling closes every document that was open', async () => {
  const { manager, handle } = makeManager()
  const root = rootOf('cancel-docs')
  const sink = makeSink()
  manager.attachSink(root, sink)
  await manager.start({ root })
  manager.relayToServer(root, didOpen('file:///workspace/app.ts'))
  manager.relayToServer(root, didOpen('file:///workspace/other.ts'))
  await sleep(10)

  await manager.cancelIndex({ root })

  // The language server is told that no document stays open.
  const payloads = decodeChunks(handle().stdinChunks)
  const closes = payloads.filter(payload => payload.includes('"textDocument/didClose"'))
  assert.equal(closes.length, 2, 'both documents are closed')
  assert.ok(closes.some(payload => payload.includes('file:///workspace/app.ts')))
  assert.ok(closes.some(payload => payload.includes('file:///workspace/other.ts')))

  // The client is told which documents the server let go of.
  const closed = sink.events.filter(event => event.type === 'didClose').map(event => event.uri)
  assert.deepEqual(closed.sort(), ['file:///workspace/app.ts', 'file:///workspace/other.ts'])
})

test('cancelling three times in a row does not fail and does not kill twice', async () => {
  const { manager, handle } = makeManager()
  const root = rootOf('cancel-thrice')
  await manager.start({ root })
  const results = []
  for (let attempt = 0; attempt < 3; attempt += 1) {
    results.push(await manager.cancelIndex({ root }))
  }
  for (const result of results) assert.deepEqual(result, { state: 'cancelled' })
  assert.equal(handle().terminateCalls, 1)
  assert.equal((await manager.status({ root })).state, 'cancelled')
})

test('cancelling does not touch the editor state of the user', async () => {
  const { manager } = makeManager()
  const root = rootOf('cancel-editor')
  const sink = makeSink()
  manager.attachSink(root, sink)
  await manager.start({ root })
  manager.relayToServer(root, didOpen())
  await sleep(10)

  await manager.cancelIndex({ root })

  // The host only reports document level facts; it never closes a tab, never
  // moves the cursor and never throws away a draft.
  for (const event of sink.events) {
    assert.ok(['state', 'didClose', 'cancelled'].includes(event.type), `unexpected event ${event.type}`)
    if (event.type === 'didClose') assert.equal(typeof event.uri, 'string')
  }
  const states = sink.events.filter(event => event.type === 'state').map(event => event.state)
  assert.deepEqual(states, ['starting', 'building', 'cancelling', 'cancelled'])
})

test('a cancelled root can be started again', async () => {
  const { manager, spawned } = makeManager()
  const root = rootOf('cancel-restart')
  await manager.start({ root })
  await manager.cancelIndex({ root })
  const restarted = await manager.start({ root })
  assert.equal(restarted.state, 'building')
  assert.equal(spawned.length, 2)
})
