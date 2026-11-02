/**
 * One program, one language server (PRD-v5.1 §4.2, CONC-01).
 *
 * The packages of a pnpm workspace - or the projects of a solution-style
 * `tsconfig.json` - are ONE program for the language server. Two servers
 * for them would hold the same symbols twice, spend the memory twice, and
 * the two programs may disagree about the types of the same file.
 *
 * The host therefore starts ONE server for the roots of one program, and
 * the decision is CONSERVATIVE: when the host is not sure, the roots are
 * merged. One missing index is better than two duplicate ones.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { programKeyOf } from '../src/host/lsp.js'
import { makeManager } from './lsp-fixtures.mjs'

/**
 * A pnpm workspace with a number of packages.
 * @param {number} count the number of packages
 * @returns {{ workspace: string, packages: string[] }}
 */
function workspaceOf(count) {
  const workspace = mkdtempSync(join(tmpdir(), 'iwb-lsp-ws-'))
  writeFileSync(join(workspace, 'package.json'), JSON.stringify({
    name: 'workspace',
    private: true,
    workspaces: ['packages/*'],
  }))
  writeFileSync(join(workspace, 'tsconfig.json'), JSON.stringify({
    references: Array.from({ length: count }, (unused, index) => ({ path: `packages/p${index}` })),
  }))
  const packages = []
  for (let index = 0; index < count; index += 1) {
    const directory = join(workspace, 'packages', `p${index}`)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: `p${index}` }))
    writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { composite: true } }))
    packages.push(directory)
  }
  return { workspace, packages }
}

/**
 * A project of its own.
 * @returns {string} the absolute path of the project
 */
function projectOf() {
  const directory = mkdtempSync(join(tmpdir(), 'iwb-lsp-project-'))
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }))
  return directory
}

test('the packages of a workspace share one program', () => {
  const { workspace, packages } = workspaceOf(3)
  const keys = packages.map(directory => programKeyOf(directory))
  assert.equal(new Set(keys).size, 1, 'the three packages are one program')
  assert.equal(keys[0], programKeyOf(workspace), 'the workspace root is the same program')
})

test('two roots that share a configuration share one program', () => {
  const project = projectOf()
  const key = programKeyOf(project)
  assert.equal(programKeyOf(join(project, 'src')), key, 'a sub-directory belongs to the project')
})

test('two projects of their own have their own program', () => {
  const first = projectOf()
  const second = projectOf()
  assert.notEqual(programKeyOf(first), programKeyOf(second))
})

test('a workspace with three packages starts one language server', async () => {
  // The acceptance of CONC-01 (PRD-v5.1 §6.1): one tsserver process tree.
  const { packages } = workspaceOf(3)
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 16 * 1024 ** 3 }),
  })
  const first = await manager.start({ root: packages[0] })
  const second = await manager.start({ root: packages[1] })
  const third = await manager.start({ root: packages[2] })

  assert.equal(first.state, 'building', 'the first package is indexed')
  assert.equal(second.state, 'idle', 'the second package shares the program')
  assert.equal(third.state, 'idle', 'the third package shares the program')
  assert.equal(spawned.length, 1, 'one language server for the whole workspace')
  assert.match(second.detail, /same program/i, 'the message says why')
})

test('two projects of their own still get two language servers', async () => {
  const first = projectOf()
  const second = projectOf()
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 16 * 1024 ** 3 }),
  })
  await manager.start({ root: first })
  await manager.start({ root: second })
  assert.equal(spawned.length, 2, 'two independent programs, two servers')
})

test('the host reports the program of a root', async () => {
  const { workspace, packages } = workspaceOf(2)
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 16 * 1024 ** 3 }),
  })
  await manager.start({ root: packages[0] })
  const status = await manager.status({ root: packages[0] })
  assert.equal(typeof status.programKey, 'string')
  assert.equal(status.programKey, programKeyOf(workspace))
  assert.equal(manager.programKey(packages[1]), status.programKey)
})
