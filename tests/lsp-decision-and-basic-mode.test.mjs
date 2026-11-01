/**
 * The findings of the code review of the first round (PRD-v5.1, A2 and A4).
 *
 * A2: the host published TWO answers for one snapshot. The `decision` field
 * carried the worst band ("what the machine would have left if the server
 * grew to its ceiling"), and the `tight` flag that the gate itself reads
 * did not. So the client asked the user "the memory is tight" while the
 * host started the server anyway - the one thing the two sides must never
 * do (two sides that judge the same snapshot differently give the user two
 * different answers).
 *
 * The worst band is INFORMATIONAL: with a 2 GB ceiling almost every machine
 * hits it, and enforcing it would ask the user about a hypothetical that
 * nobody can act on. What keeps the machine out of the swap is the
 * machine-level budget (MEM-08) and the pressure valve (MEM-12).
 *
 * A4: the host and the client used TWO markers for the basic mode, with
 * opposite priorities. The client read `workspaceDefaults` first, the host
 * read `memoryWarnedRoots` only - so after a click on 【重新建立索引】 the
 * client said "index this project" and the host said "do not touch it",
 * and the semantic features of the project were dead for ever.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeFrame } from '../src/host/lsp-frame.js'
import { makeManager, sleep, waitFor } from './lsp-fixtures.mjs'

const MB = 1024 * 1024

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-review-${name}`)
}

/**
 * One request that needs a language server.
 * @param {number} id the JSON-RPC id
 * @returns {string} the payload
 */
function definitionOf(id) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'textDocument/definition',
    params: { textDocument: { uri: 'file:///workspace/app.ts' }, position: { line: 1, character: 2 } },
  })
}

/**
 * A manager with one running server that is released by the idle exit.
 * @param {object} [options] the options of the fixture
 * @returns {object} the fixture
 */
function makeFixture(options = {}) {
  return makeManager({
    ...options,
    lsp: { idleTimeoutMs: 150, requestTimeoutMs: 100, ...(options.lsp ?? {}) },
  })
}

// ── A2: one answer for one snapshot ─────────────────────────────────────────

test('the decision and the flag of the gate are the same answer', async () => {
  // The scenario of the review: available 2000 MB, need 651 MB, soft 1302 MB,
  // floor 256 MB, ceiling 2048 MB. The worst band is hit (2000 - 2048 is
  // negative), and the decision used to say "tight" while the gate said
  // "there is room".
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 3614 * MB }),
  })
  const root = rootOf('decision')
  await manager.start({ root })
  const resources = await manager.resources({ root: rootOf('decision-other') })
  assert.equal(resources.availableBytes, 2000 * MB, 'the scenario of the review')
  assert.equal(resources.worstCase, true, 'the worst band is hit')
  assert.equal(resources.worstCaseBytes, -48 * MB, 'and it is reported')
  assert.equal(resources.decision, 'ok', 'the worst band does not refuse the start')
  assert.equal(resources.tight, resources.decision === 'tight', 'the flag is the decision')
})

test('a tight machine is tight in both fields', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 2500 * MB }),
  })
  const root = rootOf('decision-tight')
  await manager.start({ root })
  const resources = await manager.resources({ root: rootOf('decision-tight-other') })
  assert.equal(resources.decision, 'tight')
  assert.equal(resources.tight, true, 'the flag is the decision')
})

test('a machine without memory is low in both fields', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 64 * MB }),
  })
  const root = rootOf('decision-low')
  const resources = await manager.resources({ root })
  assert.equal(resources.decision, 'low')
  assert.equal(resources.tight, false)
  assert.equal(resources.belowHardFloor, true)
})

test('the host starts a server that the client would not ask about', async () => {
  // The two sides read the same snapshot now, so the host does what the
  // client shows: the server starts, and the worst case is a note in the
  // diagnostics panel.
  const { manager, spawned } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 3614 * MB }),
  })
  const result = await manager.start({ root: rootOf('decision-start') })
  assert.equal(result.state, 'building')
  assert.equal(spawned.length, 1)
})

// ── A4: one marker for the basic mode ───────────────────────────────────────

/**
 * Start a server, let the idle exit release it, and ask for it again.
 * @param {object} fixture the fixture of the case
 * @param {string} root the project root
 * @returns {Promise<number>} the number of start attempts
 */
async function releasedAndAskedAgain(fixture, root) {
  const { manager, spawned, handle } = fixture
  await manager.start({ root })
  handle().stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })))
  await sleep(80)
  assert.equal((await manager.status({ root })).state, 'ready')
  await sleep(280)
  assert.equal((await manager.status({ root })).state, 'suspended', 'the server was released')
  manager.relayToServer(root, definitionOf(7))
  await waitFor(() => spawned.length >= 2, 500)
  return spawned.length
}

test('the decision of the user wins over the memory answer of the older documents', async () => {
  // A4: the user chose the basic mode (the memory answer) and later turned
  // the semantic analysis on again (the workspace default). The host has to
  // read the newer word - or the server can never wake up again.
  const root = rootOf('workspace-wins')
  const fixture = makeFixture({
    lsp: {
      idleTimeoutMs: 150,
      requestTimeoutMs: 100,
      workspaceDefaults: { [root]: 'build' },
      memoryWarnedRoots: { [root]: 'conservative' },
    },
  })
  const attempts = await releasedAndAskedAgain(fixture, root)
  assert.equal(attempts, 2, 'the server was woken again')
})

test('the workspace default puts the project into the basic mode', async () => {
  const root = rootOf('workspace-conservative')
  const fixture = makeFixture({
    lsp: { idleTimeoutMs: 150, requestTimeoutMs: 100, workspaceDefaults: { [root]: 'conservative' } },
  })
  const attempts = await releasedAndAskedAgain(fixture, root)
  assert.equal(attempts, 1, 'the server stays away')
})

test('the memory answer of the older documents still puts the project into the basic mode', async () => {
  const root = rootOf('memory-conservative')
  const fixture = makeFixture({
    lsp: { idleTimeoutMs: 150, requestTimeoutMs: 100, memoryWarnedRoots: { [root]: 'conservative' } },
  })
  const attempts = await releasedAndAskedAgain(fixture, root)
  assert.equal(attempts, 1, 'the server stays away')
})

test('the global policy never keeps the project in the basic mode', async () => {
  const root = rootOf('policy-never')
  const fixture = makeFixture({
    lsp: { idleTimeoutMs: 150, requestTimeoutMs: 100, indexOnOpen: 'never' },
  })
  const attempts = await releasedAndAskedAgain(fixture, root)
  assert.equal(attempts, 1, 'the server stays away')
})

test('the workspace default outranks the global policy', async () => {
  // The user turned the semantic analysis on for this project, and the
  // global policy says "never index": the decision of the user wins.
  const root = rootOf('workspace-outranks-policy')
  const fixture = makeFixture({
    lsp: {
      idleTimeoutMs: 150,
      requestTimeoutMs: 100,
      indexOnOpen: 'never',
      workspaceDefaults: { [root]: 'build' },
    },
  })
  const attempts = await releasedAndAskedAgain(fixture, root)
  assert.equal(attempts, 2, 'the server was woken again')
})
