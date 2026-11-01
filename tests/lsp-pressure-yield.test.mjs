/**
 * The memory pressure valve (PRD-v5.1 §3.8, MEM-12) and the order of the
 * yield (PRD-v5.1 §4.4, CONC-03/CONC-04).
 *
 * The valve is the last defence against the swap, and it used to be OFF:
 * the default policy ('after') did not even install the pressure timer, so
 * the host never gave the memory back when the machine got tight. The
 * promise "never let the machine run into swap" had no fallback at all.
 *
 * The valve is now independent of the idle policy:
 *
 *   - 'never' does NOT exempt it: "never" means "not because of idleness",
 *     not "not even when the machine is dying";
 *   - 'pressureYield: false' is the one and only way to switch it off.
 *
 * And the yield ends in `suspended` and not in `degraded` (CONC-04): the
 * machine did not break, it asked for its memory back.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeFrame } from '../src/host/lsp-frame.js'
import { makeManager, sleep, waitFor } from './lsp-fixtures.mjs'

const MB = 1024 * 1024

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-pressure-${name}`)
}

/**
 * A manager whose machine can be squeezed.
 *
 * The idle timeout is long on purpose: the idle release would compete with
 * the pressure valve for the same session, and the case is about the
 * valve. The request timeout is small, so the watchdog of the session -
 * which carries the pressure check - ticks often.
 * @param {object} [options] the options of the fixture
 * @returns {object} the fixture and the switch of the machine
 */
function pressureFixture(options = {}) {
  let freeBytes = options.freeBytes ?? 8 * 1024 ** 3
  const fixture = makeManager({
    ...options,
    lsp: { idleTimeoutMs: 600000, requestTimeoutMs: 100, ...(options.lsp ?? {}) },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes }),
  })
  return {
    ...fixture,
    squeeze() { freeBytes = 32 * MB },
    relax() { freeBytes = 8 * 1024 ** 3 },
  }
}

/**
 * Let one server answer a request, so that it becomes "ready".
 * @param {object} handle the handle of the fake process
 */
function ready(handle) {
  handle.stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })))
}

/**
 * Let the machine breathe again as soon as a server is released.
 *
 * A machine that stays below the hard floor releases every server it has:
 * the valve gives the memory back, and the machine has it again.
 * @param {object} fixture the fixture of the case
 * @param {number} index the number of the spawned process
 */
function recoverOnRelease(fixture, index) {
  const entry = fixture.spawned[index]
  if (entry === undefined) return
  const handle = entry.handle
  const original = handle.terminate.bind(handle)
  handle.terminate = () => {
    fixture.relax()
    return original()
  }
}

test('the pressure valve is on with the default policy', async () => {
  // The default policy ('after') used to leave the machine without any
  // defence at all: the pressure timer was not even installed.
  const fixture = pressureFixture()
  const { manager, handle } = fixture
  const root = rootOf('default')
  await manager.start({ root })
  ready(handle())
  await sleep(50)
  assert.equal(manager.stateOf(root).state, 'ready')

  fixture.squeeze()
  assert.ok(await waitFor(() => manager.stateOf(root).state === 'suspended', 4000), 'the server was released')
  assert.equal(handle().terminateCalls, 1, 'the process is gone')
  assert.match(manager.stateOf(root).detail, /ran out of free memory/i, 'the valve did it, not the idle timer')
})

test('the policy never does not exempt the pressure valve', async () => {
  // "Never" means "not because of idleness", not "not even when the
  // machine is dying" (MEM-12, requirement 4).
  const fixture = pressureFixture({ lsp: { idlePolicy: 'never' } })
  const { manager, handle } = fixture
  const root = rootOf('never')
  await manager.start({ root })
  ready(handle())
  await sleep(50)
  assert.equal(manager.stateOf(root).idleArmed, false, 'there is no idle timer')

  fixture.squeeze()
  assert.ok(await waitFor(() => manager.stateOf(root).state === 'suspended', 4000), 'the valve released the server')
})

test('the switch pressureYield switches the valve off', async () => {
  const fixture = pressureFixture({ lsp: { pressureYield: false } })
  const { manager, handle } = fixture
  const root = rootOf('off')
  await manager.start({ root })
  ready(handle())
  await sleep(50)

  fixture.squeeze()
  await sleep(1500)
  assert.equal(manager.stateOf(root).state, 'ready', 'the valve is off')
  assert.equal(handle().terminateCalls, 0, 'the process keeps running')
})

test('the yield ends in suspended and not in degraded', async () => {
  // CONC-04: the release is not a failure. `degraded` means "something
  // broke", and its cause would decide whether a later payload may try
  // again - a yield is neither.
  const fixture = pressureFixture()
  const { manager, handle } = fixture
  const root = rootOf('suspended')
  await manager.start({ root })
  ready(handle())
  await sleep(50)

  fixture.squeeze()
  assert.ok(await waitFor(() => manager.stateOf(root).state === 'suspended', 4000))
  const status = await manager.status({ root })
  assert.equal(status.state, 'suspended')
  assert.notEqual(status.state, 'degraded')
  assert.match(status.detail, /ran out of/i, 'the message names the reason')
})

test('the least used language server is released first', async () => {
  // CONC-03: the order is from "given up first" to "given up last".
  const fixture = pressureFixture()
  const { manager } = fixture
  const older = rootOf('older')
  const newer = rootOf('newer')
  await manager.start({ root: older })
  await sleep(120)
  await manager.start({ root: newer })
  ready(fixture.spawned[0].handle)
  ready(fixture.spawned[1].handle)
  await sleep(50)
  recoverOnRelease(fixture, 0)
  recoverOnRelease(fixture, 1)

  fixture.squeeze()
  assert.ok(await waitFor(() => manager.stateOf(older).state === 'suspended', 4000), 'the older server went')
  await sleep(120)
  assert.equal(manager.stateOf(newer).state, 'ready', 'the newer one stays')
})

test('the focused root is released last', async () => {
  // The client that is attached to a root is the client the user is
  // working with: that root is released last of all.
  const fixture = pressureFixture()
  const { manager } = fixture
  const older = rootOf('focus-older')
  const focused = rootOf('focused')
  await manager.start({ root: older })
  await sleep(120)
  await manager.start({ root: focused })
  ready(fixture.spawned[0].handle)
  ready(fixture.spawned[1].handle)
  await sleep(50)
  recoverOnRelease(fixture, 0)
  recoverOnRelease(fixture, 1)
  manager.attachSink(focused, { send: () => {}, control: () => {} })

  fixture.squeeze()
  assert.ok(await waitFor(() => manager.stateOf(older).state === 'suspended', 4000), 'the unfocused server went')
  await sleep(120)
  assert.equal(manager.stateOf(focused).state, 'ready', 'the focused root stays')
})

test('a server that builds its program is never released', async () => {
  // The idle timer is not armed while the program is built (IDLE-04), so a
  // building project looks like the MOST idle one - and it is the one that
  // must not be touched.
  const fixture = pressureFixture()
  const { manager } = fixture
  const older = rootOf('build-older')
  const building = rootOf('building')
  await manager.start({ root: older })
  await sleep(120)
  await manager.start({ root: building })
  ready(fixture.spawned[0].handle)
  ready(fixture.spawned[1].handle)
  await sleep(50)
  recoverOnRelease(fixture, 0)
  recoverOnRelease(fixture, 1)
  // A semantic request that is never answered: the program is built.
  manager.relayToServer(building, JSON.stringify({
    jsonrpc: '2.0', id: 7, method: 'textDocument/definition',
    params: { textDocument: { uri: 'file:///workspace/app.ts' }, position: { line: 1, character: 2 } },
  }))
  await sleep(60)
  assert.equal(manager.stateOf(building).buildingProgram, true, 'the program is built')

  fixture.squeeze()
  assert.ok(await waitFor(() => manager.stateOf(older).state === 'suspended', 4000), 'the other server went')
  await sleep(120)
  assert.notEqual(manager.stateOf(building).state, 'suspended', 'the building server stays')
})

test('the valve fires when another program took the memory', async () => {
  // N1: the difference between two readings is the growth of EVERYTHING on
  // the machine. Another program that eats 7 GB while the language server
  // starts must not be booked on the server: the reservation would
  // collapse, the available memory would look huge, and the valve would
  // stay silent while the machine is out of memory.
  const steps = [7400, 7400, 400]
  let index = 0
  const { manager, handle, warnings } = makeManager({
    lsp: { idleTimeoutMs: 600000, requestTimeoutMs: 100 },
    readMemory: () => {
      const step = steps[Math.min(index, steps.length - 1)]
      index += 1
      return { totalBytes: 16 * 1024 ** 3, freeBytes: step * MB }
    },
  })
  const root = rootOf('foreign')
  const started = await manager.start({ root })
  assert.equal(started.state, 'building', 'the machine had room when the server started')
  ready(handle())

  // The measurement was void: the estimate of the registry is used, so the
  // reservation is 1614 MB and the machine has 400 MB left.
  const resources = await manager.resources({ root: rootOf('foreign-other') })
  assert.equal(resources.measuredMB, 434, 'the difference was not the memory of the server')
  assert.equal(resources.availableBytes, 0, 'the machine has no memory left')

  assert.ok(
    await waitFor(() => manager.stateOf(root).state === 'suspended', 4000),
    'the valve fired: the server was released',
  )
  assert.ok(
    warnings.some(warning => /cannot take more than/.test(warning)),
    'the host log says that the difference was not the memory of the server',
  )
})
