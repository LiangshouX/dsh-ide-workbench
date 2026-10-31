import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeManager, sleep } from './lsp-fixtures.mjs'
import { DEFAULT_BASELINE_MB, DEFAULT_LSP_SETTINGS, LSP_REGISTRY } from '../src/host/lsp.js'
import { DEFAULT_SETTINGS, migrateLspSettings } from '../src/host/settings-store.js'

const MB = 1024 * 1024

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-memory-${name}`)
}

/**
 * A project root of one language, detected by its marker file.
 * @param {string} name the name of the root
 * @param {string} marker the marker file of the language
 * @returns {string} the absolute path of the root
 */
function rootWithMarker(name, marker) {
  const root = mkdtempSync(join(tmpdir(), `iwb-lsp-memory-${name}-`))
  writeFileSync(join(root, marker), '')
  return root
}

/**
 * A memory probe with a fixed amount of free memory.
 * @param {number} freeMB the free memory in megabytes
 * @returns {() => { totalBytes: number, freeBytes: number }}
 */
function freeOf(freeMB) {
  return () => ({ totalBytes: 16 * 1024 * MB, freeBytes: freeMB * MB })
}

test('the registry knows the memory baseline of every language', () => {
  const expected = {
    typescript: 256,
    javascript: 256,
    python: 192,
    yaml: 64,
    java: 512,
    go: 256,
    rust: 512,
    cpp: 384,
  }
  for (const [languageId, baselineMB] of Object.entries(expected)) {
    assert.equal(LSP_REGISTRY[languageId].memoryBaselineMB, baselineMB, languageId)
  }
})

test('the defaults of the lsp section carry the graded thresholds', () => {
  assert.equal(DEFAULT_LSP_SETTINGS.freeMemoryThresholdMB, 512)
  assert.equal(DEFAULT_LSP_SETTINGS.memoryHeadroom, 1.5)
  assert.equal(DEFAULT_LSP_SETTINGS.memoryHardFloorMB, 256)
})

test('the status carries the memory snapshot, so the numbers are live', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048, freeMemoryThresholdMB: 512 },
    readMemory: freeOf(2850),
  })
  const root = rootOf('status-snapshot')
  // Without a server there is nothing to estimate: the snapshot is empty.
  const idle = await manager.status({ root })
  assert.equal(idle.resources, null, 'no server, no estimate')
  await manager.start({ root, languageId: 'typescript' })
  const running = await manager.status({ root })
  assert.ok(running.resources !== null, 'a running server reports its memory')
  assert.equal(running.resources.needMB, 384, 'TypeScript: 256 MB baseline times 1.5')
  assert.equal(running.resources.freeBytes, 2850 * MB)
  assert.equal(running.resources.canIndex, true)
})

test('the estimate of a language is its baseline times the headroom', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: freeOf(4096),
  })
  const resources = await manager.resources({ root: rootOf('typescript') })
  assert.equal(resources.baselineMB, 256)
  assert.equal(resources.headroom, 1.5)
  assert.equal(resources.needMB, 384)
  assert.equal(resources.thresholdBytes, 384 * MB)
  assert.equal(resources.hardFloorMB, 256)
  assert.equal(resources.canIndex, true)
  assert.equal(resources.tight, false)
})

test('a yaml project needs a fraction of the memory a typescript project needs', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: freeOf(4096),
  })
  const yaml = await manager.resources({ root: rootWithMarker('yaml', 'docker-compose.yml') })
  assert.equal(yaml.languageId, 'yaml')
  assert.equal(yaml.baselineMB, 64)
  assert.equal(yaml.needMB, 96)
})

test('the estimate of the root is the one of the language that would start', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: freeOf(4096),
  })
  // The root of the fixture has no marker file, so the host detects
  // TypeScript - the same detection the start path uses.
  const resources = await manager.resources({ root: rootOf('detect') })
  assert.equal(resources.languageId, 'typescript')
  assert.equal(resources.baselineMB, 256)
})

test('the conservative fallback never blocks a language that has an estimate', async () => {
  // SET-03: the free-memory threshold is no longer a gate.
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 2048, freeMemoryThresholdMB: 4096 },
    readMemory: freeOf(1024),
  })
  const resources = await manager.resources({ root: rootOf('fallback') })
  assert.equal(resources.thresholdBytes, 384 * MB)
  assert.equal(resources.canIndex, true)
  const result = await manager.start({ root: rootOf('fallback') })
  assert.equal(result.state, 'building')
  assert.equal(spawned.length, 1)
})

test('the estimate never asks for more than the ceiling allows', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 128, servers: { typescript: { memoryLimitMB: 128 } } },
    readMemory: freeOf(4096),
  })
  const resources = await manager.resources({ root: rootOf('ceiling') })
  assert.equal(resources.needMB, 192)
})

test('the baseline of a language can be overridden in the settings', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048, servers: { typescript: { memoryBaselineMB: 512 } } },
    readMemory: freeOf(4096),
  })
  const resources = await manager.resources({ root: rootOf('baseline') })
  assert.equal(resources.baselineMB, 512)
  assert.equal(resources.needMB, 768)
})

test('a language without a baseline of its own uses the default estimate', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: freeOf(4096),
  })
  const resources = await manager.resources({ root: rootOf('unknown') })
  assert.equal(resources.baselineMB, 256)
  assert.equal(DEFAULT_BASELINE_MB, 256)
})

test('the servers report the baseline of their language', async () => {
  const { manager } = makeManager()
  const servers = await manager.servers({})
  const available = servers.available.filter(entry => entry.languageId === 'yaml')
  assert.equal(available.length, 1)
  assert.equal(available[0].memoryBaselineMB, 64)
})

test('the machine is tight between the hard floor and twice the estimate', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: freeOf(300),
  })
  const resources = await manager.resources({ root: rootOf('tight') })
  assert.equal(resources.belowHardFloor, false)
  assert.equal(resources.tight, true)
  assert.equal(resources.canIndex, false)
})

test('a tight machine does not start a server on its own', async () => {
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: freeOf(300),
  })
  const root = rootOf('tight-start')
  const result = await manager.start({ root })
  assert.equal(result.state, 'degraded')
  assert.equal(spawned.length, 0, 'no process may be created without the user')
  assert.match(result.detail, /300 MB/, 'the detail names the free memory')
  assert.match(result.detail, /384 MB/, 'the detail names the expected memory')
})

test('a forced start ignores the tight memory', async () => {
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: freeOf(300),
  })
  const root = rootOf('forced')
  const result = await manager.start({ root, force: true })
  assert.equal(result.state, 'building')
  assert.equal(spawned.length, 1)
})

test('a forced start ignores the hard floor as well', async () => {
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: freeOf(64),
  })
  const root = rootOf('forced-low')
  const result = await manager.start({ root, force: true })
  assert.equal(result.state, 'building')
  assert.equal(spawned.length, 1)
})

test('a machine below the hard floor never starts a server', async () => {
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: freeOf(100),
  })
  const root = rootOf('low')
  const result = await manager.start({ root })
  assert.equal(result.state, 'degraded')
  assert.equal(spawned.length, 0)
  assert.match(result.detail, /100 MB/)
  assert.match(result.detail, /384 MB/)
})

test('a machine with enough memory starts the server', async () => {
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: freeOf(2048),
  })
  const root = rootOf('enough')
  const result = await manager.start({ root })
  assert.equal(result.state, 'building')
  assert.equal(spawned.length, 1)
})

test('the start answer carries the memory snapshot of the pre-check', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: freeOf(300),
  })
  const result = await manager.start({ root: rootOf('snapshot') })
  assert.equal(result.resources.tight, true)
  assert.equal(result.resources.needMB, 384)
})

test('the headroom and the hard floor come from the settings', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048, memoryHeadroom: 2, memoryHardFloorMB: 512 },
    readMemory: freeOf(4096),
  })
  const resources = await manager.resources({ root: rootOf('configured') })
  assert.equal(resources.headroom, 2)
  assert.equal(resources.hardFloorMB, 512)
  assert.equal(resources.needMB, 512)
  assert.equal(resources.thresholdBytes, 512 * MB)
})

test('a crashed server of a forced session is restarted even without memory', async () => {
  let freeBytes = 8 * 1024 * MB
  const { manager, spawned, handle } = makeManager({
    restartBackoffMs: 10,
    readMemory: () => ({ totalBytes: 16 * 1024 * MB, freeBytes }),
  })
  const root = rootOf('forced-crash')
  await manager.start({ root, force: true })
  assert.equal(spawned.length, 1)

  freeBytes = 64 * MB
  handle().exit(134)
  await sleep(150)

  assert.equal(spawned.length, 2, 'the decision of the user survives the crash')
})

test('a crashed server of a tight machine is not restarted', async () => {
  let freeBytes = 8 * 1024 * MB
  const { manager, spawned, handle } = makeManager({
    restartBackoffMs: 10,
    readMemory: () => ({ totalBytes: 16 * 1024 * MB, freeBytes }),
  })
  const root = rootOf('tight-crash')
  await manager.start({ root })
  assert.equal(spawned.length, 1)

  freeBytes = 300 * MB
  handle().exit(134)
  await sleep(150)

  assert.equal(spawned.length, 1, 'the tight memory needs the user again')
  const status = await manager.status({ root })
  assert.equal(status.state, 'degraded')
  assert.match(status.detail, /300 MB/)
  assert.match(status.detail, /384 MB/)
})

test('the migration fills the new memory fields of an old document', () => {
  const value = { lsp: { freeMemoryThresholdMB: 2048 } }
  migrateLspSettings(value)
  assert.equal(value.lsp.freeMemoryThresholdMB, 512, 'the legacy hard gate becomes the fallback')
  assert.equal(value.lsp.memoryHeadroom, 1.5)
  assert.equal(value.lsp.memoryHardFloorMB, 256)
  assert.deepEqual(value.lsp.memoryWarnedRoots, {})
})

test('the migration keeps a free-memory threshold the user chose', () => {
  const value = { lsp: { freeMemoryThresholdMB: 4096 } }
  migrateLspSettings(value)
  assert.equal(value.lsp.freeMemoryThresholdMB, 4096)
})

test('the defaults of the settings carry the new memory fields', () => {
  assert.equal(DEFAULT_SETTINGS.lsp.freeMemoryThresholdMB, 512)
  assert.equal(DEFAULT_SETTINGS.lsp.memoryHeadroom, 1.5)
  assert.equal(DEFAULT_SETTINGS.lsp.memoryHardFloorMB, 256)
  assert.deepEqual(DEFAULT_SETTINGS.lsp.memoryWarnedRoots, {})
})
