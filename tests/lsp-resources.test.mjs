import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeManager } from './lsp-fixtures.mjs'

const MB = 1024 * 1024

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-${name}`)
}

test('free memory below the hard floor means the index cannot be built', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048, freeMemoryThresholdMB: 512 },
    readMemory: () => ({ totalBytes: 16 * 1024 * MB, freeBytes: 100 * MB }),
  })
  const resources = await manager.resources({ root: rootOf('low') })
  assert.equal(resources.canIndex, false)
  assert.equal(resources.freeBytes, 100 * MB)
  assert.equal(resources.memoryLimitMB, 2048)
  // Below the hard floor even the user may not start it.
  assert.equal(resources.belowHardFloor, true)
})

test('free memory above the estimate means the index can be built', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048, freeMemoryThresholdMB: 512 },
    readMemory: () => ({ totalBytes: 16 * 1024 * MB, freeBytes: 6 * 1024 * MB }),
  })
  const resources = await manager.resources({ root: rootOf('enough') })
  assert.equal(resources.canIndex, true)
  assert.equal(resources.totalBytes, 16 * 1024 * MB)
})

test('the threshold comes from the estimate, not from the conservative fallback', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 512, freeMemoryThresholdMB: 4096 },
    readMemory: () => ({ totalBytes: 16 * 1024 * MB, freeBytes: 8 * 1024 * MB }),
  })
  const resources = await manager.resources({ root: rootOf('threshold') })
  // TypeScript: a 256 MB baseline times the 1.5 headroom factor.
  assert.equal(resources.needMB, 384)
  assert.equal(resources.thresholdBytes, 384 * MB)
  assert.equal(resources.memoryLimitMB, 512)
  assert.equal(resources.canIndex, true)
})

test('the memory limit is a ceiling, not a floor', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 8192, freeMemoryThresholdMB: 512 },
    readMemory: () => ({ totalBytes: 16 * 1024 * MB, freeBytes: 4 * 1024 * MB }),
  })
  const resources = await manager.resources({ root: rootOf('limit') })
  assert.equal(resources.thresholdBytes, 384 * MB)
  assert.equal(resources.canIndex, true)
})

test('a language server is not started when the memory is not enough', async () => {
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 2048, freeMemoryThresholdMB: 512 },
    readMemory: () => ({ totalBytes: 16 * 1024 * MB, freeBytes: 100 * MB }),
  })
  const root = rootOf('nostart')
  const result = await manager.start({ root })
  assert.equal(result.state, 'degraded')
  assert.equal(spawned.length, 0, 'no process may be created')
  const status = await manager.status({ root })
  assert.equal(status.state, 'degraded')
  assert.match(status.detail, /100 MB/, 'the detail names the free memory')
  assert.match(status.detail, /384 MB/, 'the detail names the memory that is needed')
})

test('a language server is started when the memory is enough', async () => {
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 2048, freeMemoryThresholdMB: 512 },
    readMemory: () => ({ totalBytes: 16 * 1024 * MB, freeBytes: 8 * 1024 * MB }),
  })
  const result = await manager.start({ root: rootOf('start') })
  assert.equal(result.state, 'building')
  assert.equal(spawned.length, 1)
})

test('the memory limit of one language can be overridden in the settings', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048, freeMemoryThresholdMB: 512, servers: { typescript: { memoryLimitMB: 3072 } } },
    readMemory: () => ({ totalBytes: 16 * 1024 * MB, freeBytes: 8 * 1024 * MB }),
  })
  const root = rootOf('override')
  await manager.start({ root, languageId: 'typescript' })
  const resources = await manager.resources({ root })
  assert.equal(resources.memoryLimitMB, 3072)
})
