/**
 * The findings of the review round 3 (PRD-v5.1, `docs/prd/v5.1/PRD-v5.1-代码检视报告-第三轮.md`).
 *
 *   - R1: the difference method cannot say whose growth it was. A difference
 *     that FITS the room of the servers is booked on them - so the account
 *     stays where it was while the machine loses the memory to another
 *     program, and the pressure valve (MEM-12), which watched that account,
 *     never fired while the machine was really out of memory.
 *   - R2: three comments and the implementation record promised a protection
 *     that does not exist ("the valve watches the raw free memory as well"),
 *     and `#measuredBytes` had the direction of the bound backwards.
 *
 * The fix gives the valve its own number: the CONFIRMED margin of the
 * machine, counted from the footprint that was measured while the server was
 * starting. The account stays the number of the gate and of the panel.
 *
 * Every case below was red before the fix.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { encodeFrame } from '../src/host/lsp-frame.js'
import { makeManager, sleep, waitFor } from './lsp-fixtures.mjs'

const MB = 1024 * 1024
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * A manager whose machine can be squeezed, with a clock the test moves.
 *
 * The clock is moved by hand because the measurement round (one minute) and
 * the pressure check (one second) run on it - a test that waits for a real
 * minute would be a test nobody runs.
 * @param {object} [options] the options of the fixture
 * @returns {object} the fixture, the machine and the clock
 */
function machineFixture(options = {}) {
  const machine = { freeMB: options.freeMB ?? 2900 }
  const clock = { value: Date.now() }
  const fixture = makeManager({
    ...options,
    lsp: { idleTimeoutMs: 600000, requestTimeoutMs: 100, ...(options.lsp ?? {}) },
    now: () => clock.value,
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: machine.freeMB * MB }),
  })
  return {
    ...fixture,
    machine,
    clock,
    /**
     * Move the clock on and let the watchdog of the session tick.
     * @param {number} ms how far the clock moves
     * @returns {Promise<void>}
     */
    async tick(ms) {
      clock.value += ms
      await sleep(150)
    },
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
 * The root of one case. Every case uses its own: the manager keeps the
 * roots of the machine in module state.
 * @param {string} name the name of the case
 * @returns {string} the root
 */
function rootOf(name) {
  return join(tmpdir(), `iwb-round3-${name}`)
}

// ── R1: the valve counts the confirmed margin ───────────────────────────────

test('the account is inflated by a difference that was not the memory of the server', async () => {
  // The difference between two readings is the growth of EVERYTHING on the
  // machine. A difference of 1400 MB FITS the room of the server
  // (2048 - 434 = 1614 MB), so the host books it on the server - and the
  // account of the machine stays where it was while the machine really lost
  // the memory. The valve used to watch that account, so it stayed silent.
  const fixture = machineFixture({ freeMB: 2900, lsp: { pressureYield: false } })
  const { manager } = fixture
  const root = rootOf('account')
  await manager.start({ root })
  ready(fixture.handle())
  await sleep(150)

  // Another program takes 1400 MB of the machine.
  fixture.machine.freeMB -= 1400
  await fixture.tick(61000)

  const resources = await manager.resources({ root })
  assert.equal(resources.measuredMB, 1834, 'the difference was booked on the server')
  assert.ok(resources.availableBytes > 256 * MB, 'the account still says that there is room')
  assert.equal(resources.safeAvailableBytes, 0, 'the confirmed margin says that there is none')
  assert.ok(
    resources.safeAvailableBytes <= resources.availableBytes,
    'the confirmed margin is never bigger than the account',
  )
})

test('the valve releases the server when another program took the memory that fits the room', async () => {
  // The same machine with the valve on: the confirmed margin is below the
  // hard floor, so the machine gives the memory back (MEM-12).
  const fixture = machineFixture({ freeMB: 2900 })
  const { manager } = fixture
  const root = rootOf('valve')
  await manager.start({ root })
  ready(fixture.handle())
  await sleep(150)

  fixture.machine.freeMB -= 1400
  await fixture.tick(61000)

  assert.ok(
    await waitFor(() => manager.stateOf(root).state === 'suspended', 4000),
    'the valve released the server',
  )
  assert.ok(
    fixture.warnings.some(warning => /below the hard floor/.test(warning)),
    'the host log says why the memory was given back',
  )
})

test('the valve leaves a machine that still has room alone', async () => {
  // The same difference on a machine with room: the confirmed margin is far
  // above the hard floor, and the valve must not touch anything.
  const fixture = machineFixture({ freeMB: 8000 })
  const { manager } = fixture
  const root = rootOf('healthy')
  await manager.start({ root })
  ready(fixture.handle())
  await sleep(150)

  fixture.machine.freeMB -= 1400
  await fixture.tick(61000)

  const resources = await manager.resources({ root })
  assert.equal(manager.stateOf(root).state, 'ready', 'the server is still there')
  assert.ok(resources.safeAvailableBytes > 256 * MB, 'the confirmed margin is above the floor')
  assert.ok(resources.safeAvailableBytes <= resources.availableBytes, 'and it is never the bigger one')
})

test('the valve counts the confirmed footprint and not the measured one', async () => {
  // A server that really grew is not credited by the valve: the difference
  // method cannot say whose growth it was, so the confirmed margin is that
  // much too low - and the valve fires early instead of late.
  const fixture = machineFixture({ freeMB: 2900 })
  const { manager } = fixture
  const root = rootOf('confirmed')
  await manager.start({ root })
  ready(fixture.handle())
  await sleep(150)

  const before = await manager.resources({ root })
  assert.equal(before.measuredMB, 434, 'the measurement of the spawn window was void')
  assert.equal(
    before.safeAvailableBytes,
    before.freeBytes - (2048 - 434) * MB,
    'the confirmed margin counts the confirmed footprint',
  )
})

// ── R2: the comments must not promise what does not exist ───────────────────

test('the host does not promise a protection that does not exist', async () => {
  const source = await readFile(join(root, 'src', 'host', 'lsp.js'), 'utf8')
  assert.ok(
    !source.includes('watches the raw free memory'),
    'the valve does not watch the raw free memory - and it must not say that it does',
  )
  assert.ok(
    !source.includes('the bound is conservative in the direction that matters for the gate'),
    'the direction of the bound is not written backwards any more: the measured value is too big, so the reservation is too small',
  )
  assert.ok(source.includes('the CONFIRMED margin'), 'the valve says what it watches')
})

test('the implementation record does not describe a mechanism that does not exist', async () => {
  const record = await readFile(join(root, 'docs', 'prd', 'v5.1', 'PRD-v5.1-实施进展.md'), 'utf8')
  assert.ok(
    !record.includes('同时**盯 `availableBytes` 与**裸 `freeBytes`**'),
    'the record does not promise the valve watches the raw free memory',
  )
  assert.ok(record.includes('确认口径'), 'the record says what the valve counts')
})
