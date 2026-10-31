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

test('free memory below the threshold means the index cannot be built', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048, freeMemoryThresholdMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 * MB, freeBytes: 512 * MB }),
  })
  const resources = await manager.resources({ root: rootOf('low') })
  assert.equal(resources.canIndex, false)
  assert.equal(resources.freeBytes, 512 * MB)
  assert.equal(resources.memoryLimitMB, 2048)
})

test('free memory above the threshold means the index can be built', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048, freeMemoryThresholdMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 * MB, freeBytes: 6 * 1024 * MB }),
  })
  const resources = await manager.resources({ root: rootOf('enough') })
  assert.equal(resources.canIndex, true)
  assert.equal(resources.totalBytes, 16 * 1024 * MB)
})

test('the threshold is the larger of the memory limit and the free memory threshold', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 512, freeMemoryThresholdMB: 4096 },
    readMemory: () => ({ totalBytes: 16 * 1024 * MB, freeBytes: 8 * 1024 * MB }),
  })
  const resources = await manager.resources({ root: rootOf('threshold') })
  assert.equal(resources.thresholdBytes, 4096 * MB)
  assert.equal(resources.memoryLimitMB, 512)
  assert.equal(resources.canIndex, true)
})

test('the memory limit alone can raise the threshold', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 8192, freeMemoryThresholdMB: 512 },
    readMemory: () => ({ totalBytes: 16 * 1024 * MB, freeBytes: 4 * 1024 * MB }),
  })
  const resources = await manager.resources({ root: rootOf('limit') })
  assert.equal(resources.thresholdBytes, 8192 * MB)
  assert.equal(resources.canIndex, false)
})

test('a language server is not started when the memory is not enough', async () => {
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 2048, freeMemoryThresholdMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 * MB, freeBytes: 100 * MB }),
  })
  const root = rootOf('nostart')
  const result = await manager.start({ root })
  assert.equal(result.state, 'degraded')
  assert.equal(spawned.length, 0, 'no process may be created')
  const status = await manager.status({ root })
  assert.equal(status.state, 'degraded')
  assert.match(status.detail, /100 MB/, 'the detail names the free memory')
  assert.match(status.detail, /2048 MB/, 'the detail names the memory that is needed')
})

test('a language server is started when the memory is enough', async () => {
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 2048, freeMemoryThresholdMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 * MB, freeBytes: 8 * 1024 * MB }),
  })
  const result = await manager.start({ root: rootOf('start') })
  assert.equal(result.state, 'building')
  assert.equal(spawned.length, 1)
})

test('the memory limit of one language can be overridden in the settings', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048, freeMemoryThresholdMB: 2048, servers: { typescript: { memoryLimitMB: 3072 } } },
    readMemory: () => ({ totalBytes: 16 * 1024 * MB, freeBytes: 8 * 1024 * MB }),
  })
  const root = rootOf('override')
  await manager.start({ root, languageId: 'typescript' })
  const resources = await manager.resources({ root })
  assert.equal(resources.memoryLimitMB, 3072)
})
