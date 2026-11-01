/**
 * The footprint of a language server (PRD-v5.1 §3.1/§3.2, MEM-05/MEM-06).
 *
 * The gate used to charge every running language server its WHOLE CEILING
 * on top of the free memory of the machine. But `os.freemem()` has already
 * subtracted the real footprint of those servers: every running server was
 * counted twice, once as consumed and once as permission.
 *
 * That is the whole defect the user reported: the machine had 2648 MB
 * free, the index of the repository really needs 621 MB, and the gate said
 * "not enough resources".
 *
 * The accounting is now:
 *
 *   headroom_i = max(0, ceiling_i - measured_i)
 *   available  = free - Σ headroom_i
 *
 * and the measurement is the difference of two readings of the free memory
 * (the difference method of MEM-06): there is no process-level API on the
 * path, because Windows has none that Node can reach without a child
 * process per server per round.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeManager, sleep } from './lsp-fixtures.mjs'

const MB = 1024 * 1024

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-measure-${name}`)
}

/**
 * A memory probe that walks through a list of free amounts.
 *
 * The list is in megabytes, and the last value is repeated when the list is
 * exhausted: the probe is read more often than the measurement needs.
 * @param {number[]} steps the free memory of the machine, in megabytes
 * @returns {() => { totalBytes: number, freeBytes: number }}
 */
function scriptedProbe(steps) {
  let index = 0
  return () => {
    const step = steps[Math.min(index, steps.length - 1)]
    index += 1
    return { totalBytes: 16 * 1024 ** 3, freeBytes: step * MB }
  }
}

test('the reservation is the headroom of the server and not its ceiling', async () => {
  // The server measured 606 MB of its 2048 MB ceiling, so it may still
  // take 1442 MB - and only that is charged against the next server.
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: scriptedProbe([2648, 2648, 2042, 2648]),
  })
  const root = rootOf('headroom')
  await manager.start({ root })
  const resources = await manager.resources({ root: rootOf('other') })
  assert.equal(resources.measuredMB, 606, 'the footprint of the server was measured')
  assert.equal(resources.reservedBytes, 1442 * MB, 'the reservation is the headroom')
  assert.equal(resources.availableBytes, (2648 - 1442) * MB)
})

test('the scenario of the user: 2648 MB free and a 606 MB index leave 1206 MB', async () => {
  // The acceptance of MEM-05 (PRD-v5.1 §6.1).
  //
  // The old formula answered 600 MB (2648 - 2048) and refused the start.
  // The new one answers 1206 MB (2648 - (2048 - 606)).
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: scriptedProbe([2648, 2648, 2042, 2648, 2648]),
  })
  const first = await manager.start({ root: rootOf('p7b-first') })
  assert.equal(first.state, 'building')
  assert.equal(spawned.length, 1)

  const resources = await manager.resources({ root: rootOf('p7b-second') })
  assert.equal(resources.availableBytes, 1206 * MB, 'the machine is asked for 1206 MB, not for 600 MB')
  assert.equal(resources.belowHardFloor, false, 'the machine is not out of memory')
})

test('a measurement inside the noise band falls back to the estimate of the registry', async () => {
  // The difference of two readings is not a language server when it is a
  // few megabytes: something else on the machine allocated memory at the
  // same time, and the measurement cannot be attributed to the server.
  const { manager, warnings } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: scriptedProbe([2648, 2648, 2645, 2648]),
  })
  await manager.start({ root: rootOf('noise') })
  const resources = await manager.resources({ root: rootOf('other') })
  assert.equal(resources.measuredMB, 434, 'the measured 434 MB of a TypeScript index is used')
  assert.equal(resources.reservedBytes, (2048 - 434) * MB)
  assert.ok(
    warnings.some(warning => /could not be measured/.test(warning)),
    'the host log says that the measurement was void',
  )
})

test('a measurement that is negative is void', async () => {
  // The machine gave memory away while the server was started: the
  // difference cannot be the footprint of the server.
  const { manager, warnings } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: scriptedProbe([2648, 2648, 3000, 3000]),
  })
  await manager.start({ root: rootOf('negative') })
  const resources = await manager.resources({ root: rootOf('other') })
  assert.equal(resources.measuredMB, 434, 'the estimate of the registry is used')
  assert.ok(
    warnings.some(warning => /gave memory away/.test(warning)),
    'the host log names the reason',
  )
})

test('the measured footprint is reported in the snapshot', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: scriptedProbe([2648, 2648, 2042, 2648]),
  })
  await manager.start({ root: rootOf('reported') })
  const resources = await manager.resources({ root: rootOf('other') })
  assert.equal(resources.measuredBytes, 606 * MB, 'the bytes and the megabytes agree')
  assert.equal(resources.measuredMB, 606)
})

test('the reservation is given back when the server is released', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: scriptedProbe([2648, 2648, 2042, 2648]),
  })
  const root = rootOf('release')
  await manager.start({ root })
  assert.equal((await manager.resources({ root: rootOf('other') })).reservedBytes, 1442 * MB)

  await manager.shutdown({ root })
  const after = await manager.resources({ root: rootOf('other') })
  assert.equal(after.reservedBytes, 0, 'the memory is free again')
  assert.equal(after.measuredBytes, 0, 'the measurement belongs to the process')
})

test('the difference of the machine is counted once, not once per session', async () => {
  // A1: the free memory of the machine is ONE number, and the difference
  // of two readings of it is ONE difference. Two sessions that keep a
  // baseline each would count the same drop twice, the sum of the
  // measurements would be twice the real footprint, and the gate would let
  // the machine run into the swap.
  let freeBytes = 8000 * MB
  let clock = 0
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048, requestTimeoutMs: 100 },
    now: () => Date.now() + clock,
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes }),
  })
  const first = rootOf('two-first')
  const second = rootOf('two-second')
  await manager.start({ root: first })
  await manager.start({ root: second })
  await sleep(120)

  // Both measurements were void (the probe does not change while the
  // process starts), so both sessions stand at the estimate of the
  // registry: 434 MB each.
  const before = await manager.resources({ root: rootOf('two-other') })
  assert.equal(before.measuredMB, 868, 'two sessions of 434 MB')

  // The machine loses 1500 MB - the servers grow while they build the
  // program of their projects.
  freeBytes = 6500 * MB
  clock += 61000
  await sleep(120)

  const after = await manager.resources({ root: rootOf('two-other') })
  assert.equal(after.measuredMB, 868 + 1500, 'the difference is counted ONCE')
  assert.equal(after.reservedBytes, (2048 - 1184) * 2 * MB, 'the reservations follow')
  assert.equal(after.availableBytes, 6500 * MB - after.reservedBytes)
})

test('a difference that no server can take is left to the machine', async () => {
  // The server stands at its ceiling: it cannot grow any more, so it is
  // not a candidate. The difference of the machine was not its - another
  // program took it - and the last value stays.
  let freeBytes = 8000 * MB
  let clock = 0
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048, requestTimeoutMs: 100 },
    now: () => Date.now() + clock,
    // The spawn window measures 2048 MB - the whole ceiling of the server.
    readMemory: scriptedProbe([8000, 8000, 5952, 8000]),
  })
  const root = rootOf('no-grower')
  await manager.start({ root })
  await sleep(120)
  const before = await manager.resources({ root: rootOf('no-grower-other') })
  assert.equal(before.measuredMB, 2048, 'the server stands at its ceiling')

  freeBytes = 6500 * MB
  clock += 61000
  await sleep(120)
  const after = await manager.resources({ root: rootOf('no-grower-other') })
  assert.equal(after.measuredMB, 2048, 'the value of the server did not change')
  assert.equal(after.reservedBytes, 0, 'the server cannot grow any more')
})
