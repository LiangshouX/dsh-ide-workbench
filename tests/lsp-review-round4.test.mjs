/**
 * The findings of the review round 4 (PRD-v5.1, `docs/prd/v5.1/PRD-v5.1-代码检视报告-第四轮.md`).
 *
 * The third round's fix gave the pressure valve its own number - the
 * CONFIRMED margin of the machine - and the fourth round found the two
 * places where that number was still too kind, plus two smaller ones:
 *
 *   - N1: the confirmed footprint was the drop of the free memory in the
 *     spawn window. That window is a window of the MACHINE, not a
 *     measurement OF the server: another program may allocate in it, and
 *     the confirmed number believed it. The valve was still blind on a
 *     machine that was really oversold.
 *   - N2: a session that is on its way out holds no reservation, but its
 *     ceiling stays until the process is really gone (up to 2.5 s). The
 *     confirmed margin charged that dying server with its whole ceiling
 *     and took a healthy server with it.
 *   - N3: the warning of the valve said that a server was released BEFORE
 *     the victim was chosen - and the check runs every second, so a
 *     machine that could not release anybody produced that line for ever.
 *   - N4: the reason the user sees said that the machine ran out of
 *     memory, while the machine may still have gigabytes to spare.
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
  return join(tmpdir(), `iwb-round4-${name}`)
}

// ── N1: the confirmed footprint must not believe a polluted spawn window ────

test('the confirmed footprint refuses to believe a polluted spawn window', async () => {
  // The spawn window is the only window in which the server itself is the
  // main cause of the change of the free memory - but it is still a window
  // of the machine, and another program may allocate in it. A drop that is
  // bigger than the typical footprint of the language is more likely another
  // program's than the server's, and the confirmed number refuses to believe
  // it (review R4, N1).
  const machine = { freeMB: 2900 }
  const fixture = makeManager({
    lsp: { idleTimeoutMs: 600000, requestTimeoutMs: 100, pressureYield: false },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: machine.freeMB * MB }),
    // The server takes 600 MB and another program takes 1400 MB in the same
    // window: the host sees a drop of 2000 MB - and the drop FITS the room
    // of the server, so nothing tells the host that it was not its memory.
    onSpawn: () => { machine.freeMB -= 2000 },
  })
  const { manager } = fixture
  const root = rootOf('spawn-window')
  await manager.start({ root })
  ready(fixture.handle())
  await sleep(100)

  const resources = await manager.resources({ root })
  assert.equal(machine.freeMB, 900, 'the machine lost the memory of the window')
  assert.equal(resources.measuredMB, 2000, 'the drop of the window was booked on the server')
  assert.ok(resources.availableBytes > 256 * MB, 'the account still says that there is room')
  // The confirmed margin counts the typical footprint of the language (434
  // MB for TypeScript), not the 2000 MB of the drop: the server may still
  // take 1614 MB, and the machine has 900 MB.
  assert.equal(resources.safeAvailableMB, 0, 'the confirmed margin does not believe the drop')
})

test('the valve fires when another program took the memory in the spawn window', async () => {
  // The same machine with the valve on: the confirmed margin is below the
  // hard floor, so the machine gives the memory back (MEM-12).
  const machine = { freeMB: 2900 }
  const fixture = makeManager({
    lsp: { idleTimeoutMs: 600000, requestTimeoutMs: 100 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: machine.freeMB * MB }),
    // The server takes 600 MB and another program takes 1400 MB in the same
    // window: the host sees a drop of 2000 MB, and the machine is left with
    // 900 MB for a server that may still grow into 2048 MB.
    onSpawn: () => { machine.freeMB -= 2000 },
  })
  const { manager } = fixture
  const root = rootOf('spawn-window-valve')
  await manager.start({ root })
  ready(fixture.handle())
  await sleep(100)

  assert.ok(
    await waitFor(() => manager.stateOf(root).state === 'suspended', 4000),
    'the valve released the server',
  )
})

// ── N2: a server that is dying must not be charged with its ceiling ────────

test('a server that is on its way out does not take a healthy server with it', async () => {
  // The reservation of a session is given back as soon as its process is on
  // its way out, but its ceiling stays until the process is really gone (up
  // to 2.5 s). The confirmed margin must not charge that dying server with
  // its whole ceiling: the margin would collapse by its confirmed
  // footprint and the valve would release a server that did not have to go
  // (review R4, N2).
  const fixture = makeManager({
    lsp: { idleTimeoutMs: 600000, requestTimeoutMs: 100 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 3528 * MB }),
    // The fake process takes its time to die, and the host waits for it with
    // the grace of the production settings: the window stays open for 2.5
    // seconds - long enough for the pressure check (one second) to run
    // inside it.
    terminateDelayMs: 3000,
    graceMs: 2000,
  })
  const { manager } = fixture
  const healthy = rootOf('healthy')
  const dying = rootOf('dying')
  // The healthy server is the OLDER one: it is the victim of the LRU order,
  // and it is the one that must not be released.
  await manager.start({ root: healthy })
  await sleep(120)
  await manager.start({ root: dying })
  ready(fixture.handle(0))
  ready(fixture.handle(1))
  await sleep(100)

  const before = await manager.resources({ root: healthy })
  assert.equal(before.safeAvailableMB, 300, 'the margin is just above the hard floor')

  // The second server goes away: its reservation is given back at once, its
  // ceiling stays until the process is really gone.
  const closing = manager.shutdown({ root: dying })
  await sleep(1600)
  assert.equal(manager.stateOf(healthy).state, 'ready', 'the healthy server was not released')
  const during = await manager.resources({ root: healthy })
  assert.ok(during.safeAvailableMB >= before.safeAvailableMB, 'the margin did not collapse')
  await closing
})

// ── N3: the valve must not claim a release that did not happen ─────────────

test('the valve says that nobody could be released, and it says it once', async () => {
  // Every session builds its program: CONC-03 says that a building project
  // is never released. The machine is short of memory and nothing can be
  // done about it - and the log has to say THAT, once, not "a server was
  // released" every second (review R4, N3).
  const machine = { freeMB: 8000 }
  const fixture = makeManager({
    lsp: { idleTimeoutMs: 600000, requestTimeoutMs: 100 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: machine.freeMB * MB }),
  })
  const { manager } = fixture
  const root = rootOf('no-victim')
  await manager.start({ root })
  ready(fixture.handle())
  await sleep(100)
  // Now the machine runs out of memory: the valve fires every second.
  machine.freeMB = 32
  // A semantic request that is never answered: the program is built.
  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0', id: 7, method: 'textDocument/definition',
    params: { textDocument: { uri: 'file:///workspace/app.ts' }, position: { line: 1, character: 2 } },
  }))
  await sleep(1600)

  const lines = fixture.warnings.filter(line => /below the hard floor/.test(line))
  assert.equal(lines.length, 1, 'the episode is reported once, not every second')
  assert.match(lines[0], /no language server may be released/, 'and it says that nobody could go')
  assert.ok(!lines[0].includes('was released'), 'it does not claim that a server was released')
})

// ── N4: the reason the user sees must be the truth ─────────────────────────

test('the reason of a pressure release does not claim that the machine ran out of memory', async () => {
  // What ran out is the MARGIN of the machine - the free memory minus what
  // the running servers may still take - and that margin can be gone while
  // the machine still has gigabytes of free memory (review R4, N4).
  //
  // The sentence that replaced it was false in the normal band, so the
  // message carries the NUMBERS now (review R5, M2) - the truth of the
  // sentence is checked in `tests/lsp-review-round5.test.mjs`.
  const source = await readFile(join(root, 'src', 'host', 'lsp.js'), 'utf8')
  assert.ok(!source.includes('the machine ran out of memory'), 'the message does not claim more than the truth')
  assert.ok(!source.includes('the machine ran out of free memory'), 'and it does not say it twice')
  assert.ok(
    source.includes('MB of memory left for the running language servers'),
    'it says what actually happened',
  )
})
