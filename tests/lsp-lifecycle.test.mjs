import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeFrame } from '../src/host/lsp-frame.js'
import { assertTransition, canTransition, rootKey, scopeRootOf } from '../src/host/lsp.js'
import { makeManager, makeSink, sleep } from './lsp-fixtures.mjs'

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-${name}`)
}

/**
 * A workspace with two sub-projects (PRD-v5 §4.2).
 *
 * The workspace itself is no project: the language server would merge the
 * sub-projects into one program (measured: 2,335 files / 84 MB for six
 * projects).
 * @param {string} name the name of the fixture
 * @returns {string} the absolute path of the workspace
 */
function workspaceOf(name) {
  const workspace = mkdtempSync(join(tmpdir(), `iwb-lsp-scope-${name}-`))
  mkdirSync(join(workspace, 'app'))
  writeFileSync(join(workspace, 'app', 'package.json'), '{}\n')
  writeFileSync(join(workspace, 'app', 'index.ts'), 'export const a = 1\n')
  mkdirSync(join(workspace, 'tools'))
  writeFileSync(join(workspace, 'tools', 'package.json'), '{}\n')
  return workspace
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

test('the scope of the program is the nearest sub-project', () => {
  const workspace = workspaceOf('nearest')
  assert.equal(scopeRootOf(workspace), join(workspace, 'app'), 'the workspace is not a project itself')
  assert.equal(scopeRootOf(workspace, 'project'), join(workspace, 'app'))
  assert.equal(scopeRootOf(workspace, 'root'), workspace, 'the policy may keep the whole root')
})

test('a root that is a project of its own is the scope', () => {
  const workspace = workspaceOf('own')
  assert.equal(scopeRootOf(join(workspace, 'app')), join(workspace, 'app'))
  assert.equal(scopeRootOf(join(workspace, 'app'), 'project'), join(workspace, 'app'))
})

test('a root without any project keeps itself', () => {
  const root = rootOf('no-project')
  assert.equal(scopeRootOf(root), root)
})

test('the language server is started in the scope of the program', async () => {
  const workspace = workspaceOf('cwd')
  const { manager, spawned } = makeManager()
  await manager.start({ root: workspace })
  assert.equal(spawned[0].spec.cwd, join(workspace, 'app'), 'the server is started in the scope')
  const status = await manager.status({ root: workspace })
  assert.equal(status.scopeRoot, join(workspace, 'app'), 'the status shows what is indexed')
})

test('the scope of the program may be the whole root', async () => {
  const workspace = workspaceOf('whole')
  const { manager, spawned } = makeManager({ lsp: { indexScope: 'root' } })
  await manager.start({ root: workspace })
  assert.equal(spawned[0].spec.cwd, workspace)
  const status = await manager.status({ root: workspace })
  assert.equal(status.scopeRoot, workspace)
})

test('the cancel window counts from the moment the server is started', async () => {
  // The start time belongs to the transition into "starting": the client
  // shows how long the build has been running, and the time the process
  // needed to start belongs to that window (PRD-v5 §2.4).
  const { manager } = makeManager({ spawnDelayMs: 300 })
  const root = rootOf('started-at')
  const starting = manager.start({ root })
  await sleep(40)
  const state = manager.stateOf(root)
  assert.equal(state.state, 'starting')
  assert.equal(typeof state.startedAt, 'number', 'the window is open while the process starts')
  await starting
})

test('a restart may be cancelled as well', async () => {
  const { manager, handle } = makeManager({ lsp: { cancelAfterMs: 0 }, restartBackoffMs: 400 })
  const root = rootOf('restart-cancel')
  await manager.start({ root })

  handle().exit(134)
  await sleep(80)
  const snapshot = await manager.index({ root })
  assert.equal(snapshot.state, 'restarting')
  assert.equal(snapshot.cancellable, true, 'the restart builds the program again')
})
