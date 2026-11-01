/**
 * The findings of the review round 5 (PRD-v5.1, `docs/prd/v5.1/PRD-v5.1-代码检视报告-第五轮.md`).
 *
 * The fourth round's fix for the teardown window used the WRONG criterion:
 * it decided with the number of the ACCOUNT whether a session still holds
 * memory - and the account can say "this server has taken its whole
 * ceiling" while the server is running perfectly well. Such a session was
 * not charged at all, the margin degenerated into the bare free memory of
 * the machine, and the valve stayed silent on a machine that was already
 * oversold (M1).
 *
 * The message of the release was replaced by another sentence that was false
 * in the normal band: the trigger is "the margin is below the floor", and
 * the sentence described the margin being NEGATIVE (M2).
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
  return join(tmpdir(), `iwb-round5-${name}`)
}

/**
 * A manager with a clock the test moves.
 * @param {object} options the options of the fixture
 * @returns {object} the fixture, its machine and its clock
 */
function machineFixture(options = {}) {
  const machine = { freeMB: options.freeMB ?? 3414 }
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

// ── M1: a session that runs must be charged, even when the account is full ─

test('a session whose account is full is still charged for its room', async () => {
  // The account says "this server has taken its whole ceiling" after the
  // foreign memory of the machine was booked on it. The session is running
  // perfectly well - and it may still take 1448 MB more. Skipping it (the
  // criterion of the fourth round) left its room unaccounted, the margin
  // became the bare free memory of the machine, and the valve stayed silent
  // while the machine was already oversold (review R5, M1).
  const fixture = machineFixture({ freeMB: 3414, lsp: { pressureYield: false } })
  const { manager } = fixture
  const root = rootOf('account-full')
  await manager.start({ root })
  ready(fixture.handle())
  await sleep(150)

  // Another program takes 1614 MB: the difference fits the room of the
  // server, so it is booked on it - and the account says "at the ceiling".
  fixture.machine.freeMB -= 1614
  await fixture.tick(61000)

  const resources = await manager.resources({ root })
  assert.equal(resources.measuredMB, 2048, 'the account believes the server filled its ceiling')
  assert.equal(resources.reservedBytes, 0, 'and reserves nothing for it any more')
  assert.equal(resources.safeAvailableMB, 186, 'the margin still charges the room of the server')
  assert.ok(resources.safeAvailableMB < resources.hardFloorMB, 'the margin is below the floor')
})

test('the valve fires when the account of a running server is full', async () => {
  // The same machine with the valve on: the margin is below the floor, so
  // the machine gives the memory back (MEM-12).
  const fixture = machineFixture({ freeMB: 3414 })
  const { manager } = fixture
  const root = rootOf('account-full-valve')
  await manager.start({ root })
  ready(fixture.handle())
  await sleep(150)

  fixture.machine.freeMB -= 1614
  await fixture.tick(61000)

  assert.ok(
    await waitFor(() => manager.stateOf(root).state === 'suspended', 4000),
    'the valve released the server',
  )
})

// ── M2: the message of the release has to be true ──────────────────────────

test('the message of a pressure release carries the numbers that made it true', async () => {
  // The trigger is "the margin of the machine fell below the floor". A
  // sentence about the condition ("the machine had less memory left than the
  // servers may still take") is only true when the margin is NEGATIVE - and
  // the valve fires the whole band below the floor, where it is false
  // (review R5, M2). The numbers belong into the message.
  const machine = { freeMB: 8000 }
  const fixture = makeManager({
    lsp: { idleTimeoutMs: 600000, requestTimeoutMs: 100 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: machine.freeMB * MB }),
  })
  const { manager } = fixture
  const root = rootOf('message')
  await manager.start({ root })
  ready(fixture.handle())
  await sleep(100)
  // Now the machine runs out of memory.
  machine.freeMB = 300
  assert.ok(
    await waitFor(() => manager.stateOf(root).state === 'suspended', 4000),
    'the valve released the server',
  )

  const detail = manager.stateOf(root).detail ?? ''
  const numbers = /the machine had (-?\d+) MB of memory left for the running language servers - below the (\d+) MB floor/.exec(detail)
  assert.ok(numbers !== null, `the message carries the margin and the floor: ${detail}`)
  const margin = Number(numbers[1])
  const floor = Number(numbers[2])
  assert.ok(margin < floor, 'the margin really is below the floor (the sentence is true)')
  assert.equal(floor, 256, 'the floor is the one of the settings')
})

test('the message does not claim that the machine ran out of memory', async () => {
  const source = await readFile(join(root, 'src', 'host', 'lsp.js'), 'utf8')
  assert.ok(!source.includes('the machine ran out of memory'), 'the message does not claim more than the truth')
  assert.ok(!source.includes('the machine ran out of free memory'), 'and it does not say it twice')
  assert.ok(
    !source.includes('less memory left than the language servers may still take'),
    'and it does not describe another condition',
  )
})
