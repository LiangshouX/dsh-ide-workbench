/**
 * The memory gate of the host (PRD-v5 §5.2–§5.4, PRD-v5.1 §3.1–§3.4,
 * MEM-01/MEM-02/MEM-03/MEM-05/MEM-08).
 *
 * The gate decides whether a language server may start. Three defects made
 * it useless:
 *
 *   - the estimate of a language server was 256 MB, a number that measured
 *     the idle wrapper process and not the index it builds (the measured
 *     footprint of a real index is 400-600 MB, median 434 MB),
 *   - the gate only looked at the free memory of the machine and never
 *     knew how many language servers this process had already started, and
 *   - on Windows `os.freemem()` counts the standby cache as free memory.
 *
 * AND THE GATE COUNTED EVERY RUNNING SERVER TWICE (MEM-05): the free
 * memory of the machine has ALREADY subtracted the real footprint of the
 * running servers, and the gate subtracted their WHOLE CEILING on top of
 * it. A server that used 606 MB of its 2048 MB ceiling was charged 2048
 * MB - and the machine with 2648 MB of free memory was told that it could
 * not afford an index that really needs 621 MB.
 *
 * The accounting is now:
 *
 *   reserved  = Σ max(0, ceiling_i - measured_i)      (the headroom)
 *   available = freeBytes - reserved
 *
 * and the machine-level budget (MEM-08) caps the sum of the ceilings of
 * all running servers, so that three servers cannot grow into the swap at
 * the same time.
 *
 * The gate has two bands that refuse a start, and they are not the same:
 * the TIGHT band is the user's decision (the user may start the server
 * anyway), and the HARD FLOOR means "this machine cannot run the server at
 * all" - it is never skipped, not even by a forced start (P2-3).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LSP_REGISTRY } from '../src/host/lsp.js'
import { makeManager, sleep, waitFor } from './lsp-fixtures.mjs'

const MB = 1024 * 1024

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-gate-${name}`)
}

test('the estimate of the TypeScript server is the measured index footprint', () => {
  // The 256 MB of the earlier versions measured the idle wrapper process,
  // not the index: a real index measured 400-600 MB (median 434 MB for 300
  // modules, 606 MB for 600 modules). The estimate was 1.4-2.4 times too
  // low, and the gate let the machine run out of memory.
  assert.equal(LSP_REGISTRY.typescript.memoryBaselineMB, 434)
  assert.equal(LSP_REGISTRY.javascript.memoryBaselineMB, 434)
})

test('the estimate of the TypeScript server is its baseline times the headroom', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3 }),
  })
  const resources = await manager.resources({ root: rootOf('estimate') })
  assert.equal(resources.baselineMB, 434)
  assert.equal(resources.needMB, 651, '434 MB times the headroom of 1.5')
})

test('the running servers are charged for their headroom and not for their ceiling', async () => {
  // The measurement was void here (the free memory of the probe does not
  // change), so the estimate of the registry is used: 434 MB of 2048 MB.
  // The reservation is the 1614 MB the server may still grow into - and
  // not the 2048 MB of its ceiling.
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3 }),
  })
  const root = rootOf('running')
  await manager.start({ root })
  const resources = await manager.resources({ root: rootOf('other') })
  assert.equal(resources.measuredMB, 434, 'the footprint of the server')
  assert.equal(resources.reservedBytes, (2048 - 434) * MB, 'the headroom of the server')
  assert.equal(resources.availableBytes, resources.freeBytes - (2048 - 434) * MB)
})

test('the third index is refused because the machine-level budget is used up', async () => {
  // A machine with 16 GB: the budget of the language servers is a quarter
  // of the machine and at most 4 GB, so two TypeScript servers (2 GB each)
  // fit and a third one does not.
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 4 * 1024 ** 3 }),
  })
  const first = await manager.start({ root: rootOf('first') })
  const second = await manager.start({ root: rootOf('second') })
  const third = await manager.start({ root: rootOf('third') })

  assert.equal(first.state, 'building')
  assert.equal(second.state, 'building')
  assert.equal(third.state, 'degraded', 'the third index is refused')
  assert.equal(spawned.length, 2, 'no third process is started')
  assert.match(third.detail, /budget/i, 'the detail names the budget')
})

test('the reservation is given back when the server is stopped', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3 }),
  })
  const root = rootOf('released')
  await manager.start({ root })
  assert.equal((await manager.resources({ root: rootOf('other') })).reservedBytes, (2048 - 434) * MB)

  await manager.shutdown({ root })
  assert.equal((await manager.resources({ root: rootOf('other') })).reservedBytes, 0, 'the memory is free again')
})

test('the standby cache is not free memory', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 800 * MB,
      // The measurement of PRD-v5 §5.4: 652 MB of standby cache were
      // counted as available - exactly the cost of one medium index.
      standbyBytes: 652 * MB,
    }),
  })
  const root = rootOf('standby')
  const resources = await manager.resources({ root })
  assert.equal(resources.standbyBytes, 652 * MB)
  assert.equal(resources.availableBytes, 148 * MB, 'the standby cache is subtracted')
  assert.equal(resources.belowHardFloor, true, 'the machine is out of memory')
})

test('a machine whose free memory is the standby cache alone starts no server', async () => {
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 700 * MB, standbyBytes: 652 * MB }),
  })
  const root = rootOf('standby-start')
  const result = await manager.start({ root })
  assert.equal(result.state, 'degraded')
  assert.equal(spawned.length, 0, 'no process is started')
  assert.match(result.detail, /48 MB/, 'the detail names the memory that is really free')
})

test('a machine without a standby number is not charged for one', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 800 * MB }),
  })
  const resources = await manager.resources({ root: rootOf('no-standby') })
  assert.equal(resources.standbyBytes, 0)
  assert.equal(resources.availableBytes, 800 * MB)
})

test('the reservation is given back when the index is cancelled', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3 }),
  })
  const root = rootOf('cancel')
  await manager.start({ root })
  assert.equal((await manager.resources({ root: rootOf('other') })).reservedBytes, (2048 - 434) * MB)

  await manager.cancelIndex({ root })
  assert.equal((await manager.resources({ root: rootOf('other') })).reservedBytes, 0, 'the memory is free again')
})

test('a session that replaces another one does not hold the memory twice', async () => {
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 2048, idleTimeoutMs: 150 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3 }),
  })
  const root = rootOf('replaced')
  await manager.start({ root })
  await sleep(300)
  assert.equal((await manager.status({ root })).state, 'suspended')
  assert.equal((await manager.resources({ root: rootOf('other') })).reservedBytes, 0, 'the released server holds no memory')

  // The wake replaces the released session with a new one.
  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0', id: 7, method: 'textDocument/definition',
    params: { textDocument: { uri: 'file:///workspace/app.ts' }, position: { line: 1, character: 2 } },
  }))
  assert.ok(await waitFor(() => spawned.length === 2), 'the server was started again')
  assert.equal(
    (await manager.resources({ root: rootOf('other') })).reservedBytes,
    (2048 - 434) * MB,
    'exactly one server holds the memory',
  )
})

test('the crash of a server gives its memory back', async () => {
  const { manager, handle } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    restartBackoffMs: 10,
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3 }),
  })
  const root = rootOf('crash')
  await manager.start({ root })
  assert.equal((await manager.resources({ root: rootOf('other') })).reservedBytes, (2048 - 434) * MB)

  handle().exit(134)
  await sleep(150)

  const resources = await manager.resources({ root: rootOf('other') })
  assert.ok(resources.reservedBytes <= (2048 - 434) * MB, 'the dead server holds no more memory than a live one')
})

test('a forced start does not ignore the hard floor', async () => {
  // `force` is the permission for the TIGHT band: the user was asked and
  // said "start anyway". The hard floor means "this machine cannot run the
  // server at all", and it is never skipped - least of all by the
  // 【重新建立索引】 button, which passes `force` without asking anything
  // (PRD-v5 §5.4, P2-3).
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 64 * MB }),
  })
  const root = rootOf('forced-low')
  const result = await manager.start({ root, force: true })
  assert.equal(result.state, 'degraded')
  assert.equal(spawned.length, 0, 'no process may be created')
  assert.match(result.detail, /not enough free memory/i, 'the detail names the cause')
  assert.match(result.detail, /64 MB/, 'the detail names the available memory')
})

test('a forced start ignores the tight band', async () => {
  // The tight band is the user's decision, and the user decided.
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 300 * MB }),
  })
  const root = rootOf('forced-tight')
  const result = await manager.start({ root, force: true })
  assert.equal(result.state, 'building')
  assert.equal(spawned.length, 1)
})

test('a forced session is not restarted below the hard floor', async () => {
  // The crash site follows the same rule as the start site: a machine that
  // cannot run the server cannot run it a second time either.
  let freeBytes = 8 * 1024 ** 3
  const { manager, spawned, handle } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    restartBackoffMs: 10,
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes }),
  })
  const root = rootOf('forced-crash-low')
  await manager.start({ root, force: true })
  assert.equal(spawned.length, 1)

  // The machine runs out of memory - the crash may well have been the
  // out-of-memory killer.
  freeBytes = 64 * MB
  handle().exit(134)
  await sleep(150)

  assert.equal(spawned.length, 1, 'no second process is started')
  const status = await manager.status({ root })
  assert.equal(status.state, 'degraded')
  assert.match(status.detail, /not enough free memory/i, 'the cause is the memory')
})

test('a forced session is restarted in the tight band', async () => {
  // The tight band is what a forced start is allowed to ignore, and the
  // restart budget of a forced session is untouched by it.
  let freeBytes = 8 * 1024 ** 3
  const { manager, spawned, handle } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    restartBackoffMs: 10,
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes }),
  })
  const root = rootOf('forced-crash-tight')
  await manager.start({ root, force: true })
  assert.equal(spawned.length, 1)

  handle().exit(134)
  await sleep(150)

  assert.equal(spawned.length, 2, 'the decision of the user survives the crash')
})

test('the machine is asked for the available memory and not for the free memory', async () => {
  // The gate and the message have to agree: the gate decides with the
  // available memory, so the message may only name that number (MEM-09).
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 2000 * MB }),
  })
  await manager.start({ root: rootOf('wording') })
  const result = await manager.start({ root: rootOf('wording-other') })
  assert.equal(result.state, 'degraded')
  assert.match(result.detail, /386 MB available/, 'the message names the available memory')
  assert.doesNotMatch(result.detail, /2000 MB/, 'the free memory is not the number that decides')
})

test('the snapshot tells the two bands apart', async () => {
  // MEM-07: the typical band says what happens when the server keeps the
  // footprint it has today, the worst band says what happens when it
  // grows to the permission it was given.
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 2000 * MB }),
  })
  await manager.start({ root: rootOf('bands') })
  const resources = await manager.resources({ root: rootOf('bands-other') })
  assert.equal(resources.availableBytes, (2000 - 1614) * MB, 'the typical band')
  assert.equal(resources.worstCaseBytes, resources.availableBytes - 2048 * MB, 'the worst band')
  assert.equal(resources.worstCase, true, 'the machine would run out of memory in the worst case')
  assert.equal(resources.decision, 'tight', 'the worst case never refuses a start')
  assert.equal(resources.belowHardFloor, false, 'the machine is not out of memory')
})
