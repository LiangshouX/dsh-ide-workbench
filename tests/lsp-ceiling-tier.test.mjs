/**
 * The ceiling of a language server (PRD-v5.1 §3.7, MEM-11).
 *
 * The ceiling of a server is a PERMISSION (`maxTsServerMemory`), not an
 * expectation: the measured footprint of a TypeScript index is 434 MB (the
 * median) and 606 MB for a big project, while the flat 2048 MB of the
 * registry was the worst case of the worst case. A number that was never
 * going to be reached cannot be the unit of the accounting (MEM-05), the
 * base of the worst case (MEM-07) and the exposure of the machine at the
 * same time.
 *
 * The tiers:
 *
 *   small  (<= 400 source files)   1024 MB
 *   medium (<= 1000 source files)  1536 MB
 *   large  (> 1000 source files)   2048 MB
 *
 * A size of ZERO is not a small project: it is a project whose size could
 * not be measured. Such a project keeps the default ceiling - lowering the
 * ceiling without knowing why is how a big project ends up without an
 * index (PRD-v5.1 §8 risk 2).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ceilingMBOf, ceilingTierOf, projectSizeOf } from '../src/host/lsp.js'
import { makeManager } from './lsp-fixtures.mjs'

const MB = 1024 * 1024

/**
 * A project with a number of source files.
 * @param {number} count the number of source files
 * @returns {string} the absolute path of the project
 */
function projectOf(count) {
  const directory = mkdtempSync(join(tmpdir(), 'iwb-lsp-tier-'))
  for (let index = 0; index < count; index += 1) {
    writeFileSync(join(directory, `file${index}.ts`), '')
  }
  return directory
}

test('the tiers of the ceiling', () => {
  assert.equal(ceilingTierOf(1), 'small')
  assert.equal(ceilingTierOf(400), 'small')
  assert.equal(ceilingTierOf(401), 'medium')
  assert.equal(ceilingTierOf(1000), 'medium')
  assert.equal(ceilingTierOf(1001), 'large')
})

test('a size of zero is unknown and not small', () => {
  // The project may not exist, may not be readable, or may hold no source
  // files at all. None of that is evidence of a small project.
  assert.equal(ceilingTierOf(0), 'unknown')
  assert.equal(ceilingTierOf(-1), 'unknown')
  assert.equal(ceilingTierOf(Number.NaN), 'unknown')
})

test('a small project gets 1024 MB', () => {
  const directory = projectOf(5)
  assert.equal(projectSizeOf(directory), 5)
  assert.equal(ceilingMBOf('typescript', directory, {}), 1024)
})

test('a medium project gets 1536 MB', () => {
  const directory = projectOf(500)
  assert.equal(ceilingMBOf('typescript', directory, {}), 1536)
})

test('a large project gets 2048 MB', () => {
  const directory = projectOf(1001)
  assert.equal(ceilingMBOf('typescript', directory, {}), 2048)
})

test('a project whose size is unknown keeps the default ceiling', () => {
  const missing = join(tmpdir(), 'iwb-lsp-tier-does-not-exist')
  assert.equal(projectSizeOf(missing), 0)
  assert.equal(ceilingMBOf('typescript', missing, {}), 2048, 'the ceiling of the registry')
})

test('the javascript entry behaves like the typescript one', () => {
  // The two entries are aliases of ONE server (`typescript-language-server`),
  // so the ceiling of one has to be the ceiling of the other.
  const directory = projectOf(5)
  assert.equal(ceilingMBOf('javascript', directory, {}), ceilingMBOf('typescript', directory, {}))
  assert.equal(ceilingMBOf('javascript', projectOf(1001), {}), 2048)
})

test('the override of the user wins over the tier', () => {
  // The escape hatch that keeps a big project working when the tier
  // guessed wrong.
  const directory = projectOf(5)
  const lsp = { servers: { typescript: { memoryLimitMB: 3072 } } }
  assert.equal(ceilingMBOf('typescript', directory, lsp), 3072)
})

test('the global limit is a cap over the tier', () => {
  const directory = projectOf(1200)
  assert.equal(ceilingMBOf('typescript', directory, { memoryLimitMB: 1024 }), 1024)
})

test('the tier never raises the ceiling of a language', () => {
  // The YAML server keeps its 512 MB - a project size may not give a
  // language more memory than it ever had.
  const directory = projectOf(1001)
  assert.equal(ceilingMBOf('yaml', directory, {}), 512)
})

test('the ceiling of the running server is the tiered one', async () => {
  const directory = projectOf(5)
  const { manager, workers } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3 }),
  })
  await manager.start({ root: directory })
  assert.equal(workers[0].workerData.memoryLimitMB, 1024, 'the server was told the tiered ceiling')
  const resources = await manager.resources({ root: directory })
  assert.equal(resources.ceilingMB, 1024, 'the snapshot reports the ceiling of the decision')
})
