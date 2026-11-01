/**
 * The unload of the host: stop every language server and sweep the jdtls
 * workspaces of the roots the plugin does not know any more (PRD-v5.1 §4.3,
 * JS-03).
 *
 * Why this file exists: `shutdownAll()` runs once, when the plugin unloads,
 * and it is the only place that DELETES a jdtls workspace - which is the
 * index cache of a project, hundreds of megabytes of Eclipse state. Two
 * mistakes are expensive there:
 *
 *   - sweeping with an empty known-root set makes every valid cache look like
 *     an orphan;
 *   - sweeping with only the roots that happened to be OPEN in this process
 *     deletes the cache of every project the user did not open today.
 *
 * So the manager has to hand the sweep the UNION of the live roots and the
 * roots the settings persisted. The sweep itself belongs to
 * `java-runtime.js` (covered by `lsp-java-runtime.test.mjs`); this suite only
 * proves the union and the injectability of the removal seam, so it never
 * touches the profile directory of the real machine.
 *
 * Node's test runner runs every file in its own process, so clearing the
 * module-level root map here cannot disturb another suite.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { shutdownAll } from '../src/host/lsp.js'
import { makeManager } from './lsp-fixtures.mjs'

/**
 * The root key the manager is expected to pass to the sweep.
 * @param {string} root the absolute root
 * @returns {string}
 */
function rootKeyLike(root) {
  const slashed = String(root).replace(/\\/g, '/')
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed
}

/**
 * One injected Java runtime whose sweep only records its input.
 * @returns {object} the double
 */
function fakeJavaRuntime() {
  const sweeps = []
  return {
    sweeps,
    javaServerPlan() {
      return { ok: false, reason: 'jdtls-missing', hint: 'no jdtls in this test', jdkCandidates: [] }
    },
    sweepJavaWorkspaces(knownRoots) {
      sweeps.push(knownRoots)
      return []
    },
  }
}

test('the unload sweeps with the persisted roots, normalised to root keys', () => {
  const javaRuntime = fakeJavaRuntime()

  shutdownAll({ knownRoots: ['D:\\a\\app'], javaRuntime })

  assert.equal(javaRuntime.sweeps.length, 1, 'the sweep is called exactly once')
  const known = javaRuntime.sweeps[0]
  assert.ok(Array.isArray(known), 'the sweep receives a list of roots')
  assert.ok(known.includes('d:/a/app'), `the root key is passed: ${JSON.stringify(known)}`)
})

test('the unload unions the roots of this process with the persisted ones', async () => {
  const root = mkdtempSync(join(tmpdir(), 'iwb-javaShutdown-'))
  const javaRuntime = fakeJavaRuntime()
  const { manager } = makeManager({ javaRuntime })
  try {
    // A real session of this process: the bundled TypeScript server is
    // spawned through the fixture, so no language server is needed on disk.
    await manager.start({ root })
    shutdownAll({ knownRoots: ['D:\\a\\app'], javaRuntime })

    assert.equal(javaRuntime.sweeps.length, 1, 'the sweep is called exactly once')
    const known = javaRuntime.sweeps[0]
    assert.ok(known.includes('d:/a/app'), `the persisted root survives the unload: ${JSON.stringify(known)}`)
    assert.ok(
      known.includes(rootKeyLike(root)),
      `the root of this process is included: ${JSON.stringify(known)}`,
    )
  } finally {
    // Whatever happened above, no live root may survive into the real sweep
    // of the next test.
    try { shutdownAll({ javaRuntime }) } catch { /* the unload must not throw */ }
    rmSync(root, { recursive: true, force: true })
  }
})

test('the unload without an injected runtime does not throw', () => {
  // The production default: the real Java runtime. The known-root set is
  // empty here (the test above cleared the map), and the sweep refuses to run
  // on an empty set - so nothing on disk can be touched by this test.
  shutdownAll({ javaRuntime: fakeJavaRuntime() })
  assert.doesNotThrow(() => shutdownAll())
  assert.doesNotThrow(() => shutdownAll({ knownRoots: [] }))
})
