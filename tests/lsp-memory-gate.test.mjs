/**
 * The memory gate of the host (PRD-v5 §5.2–§5.4, MEM-01/MEM-02/MEM-03).
 *
 * Three defects made the gate useless:
 *
 *   - the estimate of a language server was 256 MB, a number that measured
 *     the idle wrapper process and not the index it builds (the measured
 *     footprint of a real index is 400-600 MB, median 434 MB),
 *   - the gate only looked at the free memory of the machine and never
 *     knew how many language servers this process had already started, and
 *   - on Windows `os.freemem()` counts the standby cache as free memory.
 *
 * The gate must never let the machine run into swap: the servers that are
 * already running are counted, and the standby cache is not free memory.
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

test('the servers that are already running are counted', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3 }),
  })
  const root = rootOf('running')
  await manager.start({ root })
  const resources = await manager.resources({ root: rootOf('other') })
  assert.equal(resources.reservedBytes, 2048 * MB, 'the running server holds its ceiling')
  assert.equal(resources.availableBytes, resources.freeBytes - 2048 * MB)
})

test('the third index is refused because the first two are counted', async () => {
  // A machine with 16 GB and 4 GB of free memory: two language servers
  // (2 GB each) fit, a third one would push the machine into the swap.
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
  assert.match(third.detail, /not enough free memory/i)
})

test('the reservation is given back when the server is stopped', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3 }),
  })
  const root = rootOf('released')
  await manager.start({ root })
  assert.equal((await manager.resources({ root: rootOf('other') })).reservedBytes, 2048 * MB)

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
  assert.equal((await manager.resources({ root: rootOf('other') })).reservedBytes, 2048 * MB)

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
  assert.equal((await manager.resources({ root: rootOf('other') })).reservedBytes, 2048 * MB, 'exactly one server holds the memory')
})

test('the crash of a server gives its memory back', async () => {
  const { manager, handle } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    restartBackoffMs: 10,
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3 }),
  })
  const root = rootOf('crash')
  await manager.start({ root })
  assert.equal((await manager.resources({ root: rootOf('other') })).reservedBytes, 2048 * MB)

  handle().exit(134)
  await sleep(150)

  const resources = await manager.resources({ root: rootOf('other') })
  assert.ok(resources.reservedBytes <= 2048 * MB, 'the dead server holds no more memory than a live one')
})
