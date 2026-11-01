/**
 * The machine-level budget of the language servers (PRD-v5.1 §3.4, MEM-08).
 *
 * The per-server gate answers ONE question: "may the next server start".
 * It cannot answer the question that ends in the swap: "may three servers
 * grow to their ceilings AT THE SAME TIME".
 *
 * The budget is the last gate for that: the sum of the ceilings of the
 * running servers never exceeds `min(totalBytes × budgetRatio,
 * budgetCapMB)`. A quarter of the machine is the default share, and the
 * absolute cap keeps a big machine from handing out a budget that no
 * project ever needs.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeManager, sleep } from './lsp-fixtures.mjs'

const MB = 1024 * 1024

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-budget-${name}`)
}

test('the budget is a quarter of the machine and at most 4 GB', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3 }),
  })
  const resources = await manager.resources({ root: rootOf('budget') })
  // 16 GB × 25% = 4 GB, and the cap is 4 GB as well.
  assert.equal(resources.budgetBytes, 4096 * MB)
  assert.equal(resources.budgetUsedBytes, 0, 'nothing runs yet')
})

test('the cap wins on a big machine', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 64 * 1024 ** 3, freeBytes: 32 * 1024 ** 3 }),
  })
  const resources = await manager.resources({ root: rootOf('cap') })
  // 64 GB × 25% = 16 GB, but the cap is 4 GB.
  assert.equal(resources.budgetBytes, 4096 * MB)
})

test('the third language server is refused by the budget', async () => {
  // The acceptance of MEM-08 (PRD-v5.1 §6.1): on a 16 GB machine the sum
  // of the ceilings never exceeds 4 GB, and the third TypeScript index is
  // refused right after the second one.
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 16 * 1024 ** 3 }),
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

test('force does not skip the budget', async () => {
  // `force` is the permission for the TIGHT band of the memory gate: the
  // user answered "may this server start although the memory is tight".
  // The budget is not a question about the memory of THIS server, and the
  // machine-level cap is never skipped (PRD-v5.1 §4.2).
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 16 * 1024 ** 3 }),
  })
  await manager.start({ root: rootOf('forced-first') })
  await manager.start({ root: rootOf('forced-second') })
  const third = await manager.start({ root: rootOf('forced-third'), force: true })
  assert.equal(third.state, 'degraded')
  assert.equal(spawned.length, 2, 'the budget is not skipped by force')
  assert.match(third.detail, /budget/i)
})

test('the budget is free again when a server is released', async () => {
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 16 * 1024 ** 3 }),
  })
  await manager.start({ root: rootOf('used-first') })
  await manager.start({ root: rootOf('used-second') })
  assert.equal((await manager.resources({ root: rootOf('used-other') })).budgetUsedBytes, 4096 * MB)

  await manager.shutdown({ root: rootOf('used-first') })
  const resources = await manager.resources({ root: rootOf('used-other') })
  assert.equal(resources.budgetUsedBytes, 2048 * MB, 'the released server gave its share back')

  const third = await manager.start({ root: rootOf('used-third') })
  assert.equal(third.state, 'building', 'the budget has room again')
  assert.equal(spawned.length, 3)
})

test('the limit of the user caps the number of running servers', async () => {
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 512, maxConcurrentIndexes: 1 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 16 * 1024 ** 3 }),
  })
  const first = await manager.start({ root: rootOf('limit-first') })
  const second = await manager.start({ root: rootOf('limit-second') })
  assert.equal(first.state, 'building')
  assert.equal(second.state, 'degraded', 'the second index is refused')
  assert.equal(spawned.length, 1)
  assert.match(second.detail, /concurrent/i)
})

test('a limit of zero leaves the decision to the budget', async () => {
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 512, maxConcurrentIndexes: 0 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 16 * 1024 ** 3 }),
  })
  await manager.start({ root: rootOf('unlimited-first') })
  await manager.start({ root: rootOf('unlimited-second') })
  assert.equal(spawned.length, 2, 'the budget allows both')
})

test('the budget is not skipped by force when a crashed server is restarted', async () => {
  // The restart paths follow the same rule as the start (PRD-v5.1 §4.2):
  // the machine-level budget is never skipped, not even by a session the
  // user forced.
  //
  // The scenario is the real one: a server dies and gives its share of
  // the budget back, another server takes that share, and the restart
  // arrives into a full budget.
  const { manager, spawned, handle } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    restartBackoffMs: 400,
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 16 * 1024 ** 3 }),
  })
  const dying = rootOf('crash-first')
  const other = rootOf('crash-second')
  const third = rootOf('crash-third')
  await manager.start({ root: dying, force: true })
  await manager.start({ root: other, force: true })
  assert.equal(spawned.length, 2, 'the budget is full')

  // The server dies: it gives its share of the budget back.
  handle().exit(134)
  await sleep(50)
  // Another server takes that share.
  const started = await manager.start({ root: third })
  assert.equal(started.state, 'building', 'the share of the dead server was free')
  assert.equal(spawned.length, 3)

  // The restart arrives into a full budget.
  await sleep(600)
  const status = await manager.status({ root: dying })
  assert.equal(status.state, 'degraded', 'the restart was refused')
  assert.match(status.detail, /budget/i, 'the detail names the budget')
  assert.equal(spawned.length, 3, 'no fourth process was started')
})

test('a restarted server is counted by the gate again', async () => {
  // A crashed session leaves the set of the sessions of the manager, and
  // the restart reuses the same session object: the running server has to
  // be counted again, or the gate would not see its memory.
  const { manager, handle } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    restartBackoffMs: 10,
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 16 * 1024 ** 3 }),
  })
  const root = rootOf('counted')
  await manager.start({ root })
  assert.equal((await manager.resources({ root: rootOf('counted-other') })).reservedBytes, (2048 - 434) * MB)

  handle().exit(134)
  await sleep(200)

  const resources = await manager.resources({ root: rootOf('counted-other') })
  assert.equal(resources.reservedBytes, (2048 - 434) * MB, 'the restarted server holds its memory again')
  assert.equal(resources.budgetUsedBytes, 2048 * MB, 'and its share of the budget')
})
