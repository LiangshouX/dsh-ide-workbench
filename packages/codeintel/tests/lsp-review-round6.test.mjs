/**
 * The findings of the review round 6 (PRD-v5.1, `docs/prd/v5.1/PRD-v5.1-代码检视报告-第六轮.md`).
 *
 *   - N1: the trigger is decided in BYTES and the message printed the
 *     ROUNDED megabytes, so a margin of 255.6 MB was printed as "256 MB"
 *     next to a floor of "256 MB" - equal, not below. The sentence of the
 *     message has to be true in every band.
 *   - N2: the fix of the round before turned "the valve wanted to release
 *     and could not" into a silent no-op - the machine was still tight and
 *     nothing was written down. That is the first sign of a valve that does
 *     not work.
 *   - N3: the client called the refusal of the budget of MEM-08 "the machine
 *     ran out of memory, close other programs" - but the budget is the share
 *     of the ceilings the running servers hold, and closing other programs
 *     does not give it back.
 *   - N4: a mangled character in the record of the round before.
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
import { pressureDetailOf, PRESSURE_YIELD_DETAIL } from '../src/host/lsp.js'
import { crashAdviceFor } from '../src/client/store.js'
import { makeManager, sleep } from './lsp-fixtures.mjs'

const MB = 1024 * 1024
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Let one server answer a request, so that it becomes "ready".
 * @param {object} handle the handle of the fake process
 */
function ready(handle) {
  handle.stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })))
}

// ── N1: the numbers of the message must not lose the comparison ─────────────

test('the margin is printed down and the floor up, so the sentence stays true', () => {
  // The margin of 255.6 MB is below the floor of 256 MB - but printed with
  // a rounding it says "256 MB ... below the 256 MB floor", which is equal,
  // not below (review R6, N1).
  const detail = pressureDetailOf(PRESSURE_YIELD_DETAIL, {
    safeAvailableBytes: Math.floor(255.6 * MB),
    hardFloorMB: 256,
  })
  const numbers = /the machine had (-?\d+) MB of memory left .* below the (\d+) MB floor/.exec(detail)
  assert.ok(numbers !== null, `the message carries the numbers: ${detail}`)
  assert.ok(Number(numbers[1]) < Number(numbers[2]), `the sentence is true: ${detail}`)
  assert.equal(numbers[1], '255', 'the margin is printed down, never up')
  assert.equal(numbers[2], '256', 'the floor is printed as it is')
})

test('the sentence stays true for every margin below the floor', () => {
  for (const marginMB of [0, 1, 100, 255, 255.4, 255.6, 255.99]) {
    const detail = pressureDetailOf(PRESSURE_YIELD_DETAIL, {
      safeAvailableBytes: Math.floor(marginMB * MB),
      hardFloorMB: 256,
    })
    const numbers = /the machine had (-?\d+) MB of memory left .* below the (\d+) MB floor/.exec(detail)
    assert.ok(numbers !== null, `the message carries the numbers: ${detail}`)
    assert.ok(
      Number(numbers[1]) < Number(numbers[2]),
      `the sentence is true for a margin of ${marginMB} MB: ${detail}`,
    )
  }
})

// ── N2: a release that did not happen must leave a trace ───────────────────

test('a release that did not happen is written down', async () => {
  // The idle timer and the pressure valve fire at the same time: the first
  // one starts the release, the second one picks the same session as its
  // victim and finds it "being released already". Nothing is released - and
  // the machine is still tight, which is the first sign that the valve of
  // MEM-12 does not work (review R6, N2).
  const machine = { freeMB: 8000 }
  const fixture = makeManager({
    lsp: { idleTimeoutMs: 100, requestTimeoutMs: 100 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: machine.freeMB * MB }),
    // The process takes its time to die, and the host waits for it with the
    // grace of the production settings: the release stays in flight long
    // enough for the pressure check (one second) to run inside it.
    terminateDelayMs: 3000,
    graceMs: 2000,
  })
  const { manager } = fixture
  const root = join(tmpdir(), 'iwb-round6-no-release')
  await manager.start({ root })
  ready(fixture.handle())
  await sleep(100)
  // Now the machine runs out of memory: even without the reservation of the
  // dying server the margin is below the hard floor.
  machine.freeMB = 100
  await sleep(1600)

  const lines = fixture.warnings.filter(line => /below the hard floor/.test(line))
  assert.ok(lines.length > 0, 'the pressure left a trace')
  assert.ok(
    lines.some(line => line.includes('no language server was released')),
    'the trace says that nothing was released: ' + JSON.stringify(lines),
  )
  assert.ok(
    !lines.some(line => line.includes('the least used language server was released')),
    'and no line claims a release that did not happen',
  )
})

// ── N3: the advice of the client must follow the reason ───────────────────

test('the refusal of the budget is not told to the user as a lack of memory', () => {
  // The budget of MEM-08 is the share of the ceilings the running servers
  // hold - not the free memory of the machine. Closing other programs does
  // not give it back (review R6, N3).
  const detail = 'the memory budget of the language servers is used up (4096 MB of 4096 MB are held by the running servers, and this one would need 2048 MB). Release a language server, or raise the budget in the settings.'
  const advice = crashAdviceFor(detail, key => key)
  assert.equal(advice, 'lsp.crashedBudget', 'the advice is about the budget')
  assert.notEqual(advice, 'lsp.crashedMemory', 'and not about the free memory of the machine')
})

// ── N4: the record must not carry a mangled character ──────────────────────

test('the documents of the round do not carry a mangled character', async () => {
  const files = [
    join(root, '..', '..', 'docs', 'prd', 'v5.1', 'PRD-v5.1-实施进展.md'),
    join(root, '..', '..', 'docs', 'prd', 'v5.1', 'PRD-v5.1-实施契约.md'),
    join(root, '..', '..', 'docs', 'prd', 'v5.1', 'PRD-v5.1.md'),
  ]
  for (const file of files) {
    const text = await readFile(file, 'utf8')
    assert.ok(!text.includes('\uFFFD'), `no mangled character in ${file}`)
  }
})
