import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeFrame } from '../src/host/lsp-frame.js'
import { makeManager, sleep } from './lsp-fixtures.mjs'

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-${name}`)
}

test('a language server that was idle for too long exits', async () => {
  const { manager, spawned, handle } = makeManager({ lsp: { idleTimeoutMs: 150, autoExit: true } })
  const root = rootOf('idle-exit')
  await manager.start({ root })
  handle().stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })))
  await sleep(80)
  assert.equal((await manager.status({ root })).state, 'ready')

  await sleep(280)

  assert.equal(handle().terminateCalls, 1, 'the process is terminated')
  assert.equal((await manager.status({ root })).state, 'idle')
  assert.equal(spawned.length, 1)
})

test('the idle exit does not clear the indexed roots', async () => {
  const { manager, handle, document } = makeManager({ lsp: { idleTimeoutMs: 150, autoExit: true } })
  const root = rootOf('idle-indexed')
  await manager.start({ root })
  handle().stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })))
  await sleep(80)
  assert.equal((await manager.status({ root })).state, 'ready')
  assert.ok(document.lsp.indexedRoots[root], 'the root is remembered as indexed')

  await sleep(280)

  const indexed = await manager.indexedRoots()
  assert.ok(indexed[root], 'the badge of an indexed root survives the idle exit')
  assert.equal(typeof indexed[root].at, 'number')
  assert.equal(indexed[root].languageId, 'typescript')
})

test('the documents are closed before the language server exits', async () => {
  const { manager, handle } = makeManager({ lsp: { idleTimeoutMs: 150, autoExit: true } })
  const root = rootOf('idle-docs')
  await manager.start({ root })
  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: { textDocument: { uri: 'file:///workspace/app.ts', languageId: 'typescript', version: 1, text: '' } },
  }))
  await sleep(280)

  const payloads = handle().stdinChunks.map(chunk => chunk.toString('utf8'))
  assert.ok(payloads.some(payload => payload.includes('textDocument/didClose')))
})

test('a language server is started again after the idle exit', async () => {
  const { manager, spawned, handle } = makeManager({ lsp: { idleTimeoutMs: 150, autoExit: true } })
  const root = rootOf('idle-restart')
  await manager.start({ root })
  handle().stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })))
  await sleep(280)
  assert.equal((await manager.status({ root })).state, 'idle')

  const restarted = await manager.start({ root })
  assert.equal(restarted.state, 'building')
  assert.equal(spawned.length, 2)
})

test('the memory is checked again before the language server is started again', async () => {
  let freeBytes = 8 * 1024 ** 3
  const { manager, spawned } = makeManager({
    lsp: { idleTimeoutMs: 150, autoExit: true },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes }),
  })
  const root = rootOf('idle-memory')
  await manager.start({ root })
  await sleep(280)
  assert.equal((await manager.status({ root })).state, 'idle')

  freeBytes = 32 * 1024 ** 2
  const restarted = await manager.start({ root })
  assert.equal(restarted.state, 'degraded')
  assert.equal(spawned.length, 1, 'no process is started without free memory')
})

test('the idle exit can be switched off', async () => {
  const { manager, handle } = makeManager({ lsp: { idleTimeoutMs: 30, autoExit: false } })
  const root = rootOf('idle-off')
  await manager.start({ root })
  await sleep(280)
  assert.equal(handle().terminateCalls, 0, 'the process keeps running')
  assert.notEqual((await manager.status({ root })).state, 'idle')
})
