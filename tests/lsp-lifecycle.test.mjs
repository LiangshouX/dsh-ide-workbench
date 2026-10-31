import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeFrame } from '../src/host/lsp-frame.js'
import { assertTransition, canTransition, rootKey } from '../src/host/lsp.js'
import { makeManager, makeSink, sleep } from './lsp-fixtures.mjs'

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-${name}`)
}

test('a language server walks from idle through starting and building to ready', async () => {
  const { manager, handle } = makeManager({ readyDelayMs: 10 })
  const root = rootOf('walk')
  const sink = makeSink()
  manager.attachSink(root, sink)

  assert.equal((await manager.status({ root })).state, 'idle')
  const started = await manager.start({ root })
  assert.equal(started.state, 'building')

  // The language server answers; a moment later the host calls it ready.
  handle().stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })))
  await sleep(60)

  assert.equal((await manager.status({ root })).state, 'ready')
  const states = sink.events.filter(event => event.type === 'state').map(event => event.state)
  assert.deepEqual(states, ['starting', 'building', 'ready'])
})

test('an illegal state transition is refused', () => {
  assert.equal(canTransition('idle', 'starting'), true)
  assert.equal(canTransition('starting', 'building'), true)
  assert.equal(canTransition('building', 'ready'), true)
  assert.equal(canTransition('cancelled', 'building'), false)
  assert.equal(canTransition('degraded', 'building'), false)
  assert.equal(canTransition('ready', 'building'), false)
  assert.throws(() => assertTransition('cancelled', 'building'))
  assert.throws(() => assertTransition('degraded', 'building'))
})

test('a cancelled root cannot go straight back to building', async () => {
  const { manager } = makeManager()
  const root = rootOf('illegal')
  await manager.start({ root })
  await manager.cancelIndex({ root })
  assert.equal((await manager.status({ root })).state, 'cancelled')
  assert.throws(() => manager.transition(root, 'building'))
  assert.throws(() => manager.transition(root, 'ready'))
})

test('a degraded root cannot go straight back to building', async () => {
  const { manager } = makeManager({
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 64 * 1024 ** 2 }),
  })
  const root = rootOf('degraded')
  await manager.start({ root })
  assert.equal((await manager.status({ root })).state, 'degraded')
  assert.throws(() => manager.transition(root, 'building'))
})

test('starting a running language server does not start a second one', async () => {
  const { manager, spawned } = makeManager()
  const root = rootOf('idempotent-start')
  const first = await manager.start({ root })
  const second = await manager.start({ root })
  const third = await manager.start({ root, languageId: 'typescript' })
  assert.equal(first.state, 'building')
  assert.equal(second.state, 'building')
  assert.equal(third.state, 'building')
  assert.equal(spawned.length, 1, 'the process is started exactly once')
})

test('indexing a root that is already running does not start a second one', async () => {
  const { manager, spawned } = makeManager()
  const root = rootOf('idempotent-index')
  await manager.index({ root })
  await manager.index({ root })
  assert.equal(spawned.length, 1)
})

test('cancelling twice is answered with the same result and kills the process once', async () => {
  const { manager, handle } = makeManager()
  const root = rootOf('idempotent-cancel')
  await manager.start({ root })
  const first = await manager.cancelIndex({ root })
  const second = await manager.cancelIndex({ root })
  const third = await manager.cancelIndex({ root })
  assert.deepEqual(first, { state: 'cancelled' })
  assert.deepEqual(second, { state: 'cancelled' })
  assert.deepEqual(third, { state: 'cancelled' })
  assert.equal(handle().terminateCalls, 1)
})

test('cancelling a root that was never started is answered like a cancel', async () => {
  const { manager } = makeManager()
  assert.deepEqual(await manager.cancelIndex({ root: rootOf('never') }), { state: 'cancelled' })
})

test('the index snapshot names the state, the progress and the start time', async () => {
  const { manager } = makeManager({ lsp: { cancelAfterMs: 0 } })
  const root = rootOf('snapshot')
  const snapshot = await manager.index({ root })
  assert.equal(snapshot.state, 'building')
  assert.equal(snapshot.progress, 'building')
  assert.equal(snapshot.cancellable, true)
  assert.equal(typeof snapshot.startedAt, 'number')
})

test('the cancel button waits for the cancel delay of the settings', async () => {
  const { manager } = makeManager({ lsp: { cancelAfterMs: 60_000 } })
  const root = rootOf('cancel-after')
  const snapshot = await manager.index({ root })
  assert.equal(snapshot.state, 'building')
  assert.equal(snapshot.cancellable, false, 'the build may not be cancelled yet')
})

test('a switched off language server reports that it is disabled', async () => {
  const { manager } = makeManager({ lsp: { enabled: false } })
  const root = rootOf('disabled')
  const status = await manager.status({ root })
  assert.equal(status.enabled, false)
  assert.equal(status.state, 'disabled')
  await assert.rejects(() => manager.start({ root }), /disabled/i)
})

test('the live states name every root that has a session', async () => {
  const { manager } = makeManager()
  const root = rootOf('live')
  assert.equal(manager.liveStates().has(rootKey(root)), false)
  await manager.start({ root })
  const states = manager.liveStates()
  assert.equal(states.get(rootKey(root)), 'building')
})

test('a root without a language server reports that it is idle', async () => {
  const { manager } = makeManager()
  const status = await manager.status({ root: rootOf('idle') })
  assert.equal(status.state, 'idle')
  assert.equal(status.enabled, true)
  assert.equal(status.languageId, null)
  assert.equal(status.serverId, null)
  assert.equal(status.source, null)
  assert.deepEqual(status.indexedRoots, [])
})
