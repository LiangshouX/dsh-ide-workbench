/**
 * The state `suspended` (PRD-v5 §1.2, VIS-01).
 *
 * "The language server was released on purpose" and "the language server
 * failed" are two different facts, and the state machine has to tell them
 * apart: the client shows a grey "asleep" for the first one and a yellow
 * "conservative" for the second one.
 *
 * The state machine is strict, so the edges are the contract: a release
 * may lead to a new start (the wake) and to a shutdown, but never back to
 * "ready" - the server that was released is gone.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeFrame } from '../src/host/lsp-frame.js'
import { assertTransition, canTransition } from '../src/host/lsp.js'
import { makeManager, sleep } from './lsp-fixtures.mjs'

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-suspended-${name}`)
}

test('a ready language server may be released', () => {
  assert.equal(canTransition('ready', 'suspended'), true)
  assert.doesNotThrow(() => assertTransition('ready', 'suspended'))
})

test('a building language server may be released', () => {
  assert.equal(canTransition('building', 'suspended'), true)
  assert.doesNotThrow(() => assertTransition('building', 'suspended'))
})

test('a released language server may be started again', () => {
  assert.equal(canTransition('suspended', 'starting'), true)
  assert.doesNotThrow(() => assertTransition('suspended', 'starting'))
})

test('a released language server may be shut down or degraded', () => {
  assert.equal(canTransition('suspended', 'idle'), true)
  assert.equal(canTransition('suspended', 'degraded'), true)
})

test('a released language server does not become ready again', () => {
  // The server that was released is gone: there is no way back into "ready"
  // without a new process. A state machine that allows it would let a
  // session report a server that does not exist.
  assert.equal(canTransition('suspended', 'ready'), false)
  assert.throws(() => assertTransition('suspended', 'ready'), /illegal language server state transition/)
})

test('the idle release ends in suspended and not in idle', async () => {
  const { manager, handle } = makeManager({ lsp: { idleTimeoutMs: 150, autoExit: true } })
  const root = rootOf('idle-exit')
  await manager.start({ root })
  handle().stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })))
  await sleep(80)
  assert.equal((await manager.status({ root })).state, 'ready')

  await sleep(280)

  const status = await manager.status({ root })
  assert.equal(status.state, 'suspended', 'the release is not a failure')
  assert.notEqual(status.state, 'idle')
})

test('the release says that the memory was reclaimed and not that something broke', async () => {
  const { manager, handle } = makeManager({ lsp: { idleTimeoutMs: 150, autoExit: true } })
  const root = rootOf('detail')
  await manager.start({ root })
  handle().stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })))
  await sleep(280)

  const status = await manager.status({ root })
  assert.match(status.detail, /released/i)
  assert.match(status.detail, /reclaim/i)
  assert.match(status.detail, /not a failure/i)
})

test('the progress label of the released state is its own name', async () => {
  const { manager, handle } = makeManager({ lsp: { idleTimeoutMs: 150, autoExit: true } })
  const root = rootOf('progress')
  await manager.start({ root })
  handle().stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })))
  await sleep(280)

  const state = manager.stateOf(root)
  assert.equal(state.state, 'suspended')
  assert.equal(state.progress, 'suspended')
})

test('the clients are told that the server was released', async () => {
  const { manager, handle } = makeManager({ lsp: { idleTimeoutMs: 150, autoExit: true } })
  const root = rootOf('event')
  const events = []
  manager.attachSink(root, { send: () => {}, control: event => events.push(event) })
  await manager.start({ root })
  handle().stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })))
  await sleep(280)

  const states = events.filter(event => event.type === 'state').map(event => event.state)
  assert.ok(states.includes('suspended'), 'the state change is reported')
  assert.ok(events.some(event => event.type === 'suspended'), 'the release carries its own event')
})
