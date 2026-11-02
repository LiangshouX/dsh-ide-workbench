/**
 * The findings of the review round 2 (PRD-v5.1, `docs/prd/v5.1/PRD-v5.1-代码检视报告-第二轮.md`).
 *
 * Two of them are on the client side:
 *
 *   - N4: the comment of `memoryFacts` claimed a row "measured" that the
 *     diagnostics panel does not render. The rewrite of round 1 (A6) had
 *     replaced a stale sentence with a sentence about something that does not
 *     exist - worse than stale.
 *   - N5: the write of the settings document was swallowed by
 *     `.catch(() => {})`. The correctness of round 1's A4 ("both maps in ONE
 *     patch, 'build' overwrites the memory answer") depends on that write
 *     reaching the host - and a failed write left the client saying "index
 *     this project" while the document of the host still said "basic mode".
 *     The two sides diverged again, and nothing was written down.
 *
 * Every case below was red before the fix.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CodeIntelStore } from '../src/client/store.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = 'C:\\work\\demo'
const CHILD = 'C:\\work\\demo\\api'

/** Wait for the pending promises of the store. */
const tick = (ms = 10) => new Promise(resolve => { setTimeout(resolve, ms) })

/**
 * A store with one workspace root.
 * @param {any} [lsp] the `lsp` section of the settings
 * @returns {any} the store
 */
function fakeStore(lsp = {}) {
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new CodeIntelStore(ctx, key => key)
  store.state = {
    ...store.state,
    workspaceRoot: ROOT,
    root: ROOT,
    phase: 'ready',
    settings: {
      editor: { openMode: 'auto', editableMaxBytes: 1 << 20 },
      shortcuts: {},
      lsp: { enabled: true, indexOnOpen: 'ask', workspaceDefaults: {}, ...lsp },
    },
    projects: [
      { path: ROOT, name: 'demo', isRoot: true, isRepo: false, indexState: 'unknown', indexedAt: null },
      { path: CHILD, name: 'api', isRoot: false, isRepo: true, indexState: 'unknown', indexedAt: null },
    ],
  }
  return store
}

/**
 * One host stub whose settings route can refuse the write.
 * @param {any} store the store the stub belongs to
 * @param {{failSettings?: boolean}} [options] whether the write fails
 * @returns {any} the stub
 */
function hostStub(store, options = {}) {
  const calls = []
  let document = null
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/').pop()
    const body = init?.body === undefined ? {} : JSON.parse(init.body)
    calls.push({ method, body })
    if (method === 'settings.update' && options.failSettings === true) {
      // The host refuses the write: the document of the profile cannot be
      // changed (a read-only profile, a full disk, a host that is on its way
      // down).
      return {
        ok: false,
        status: 500,
        async json() { return { ok: false, error: { code: 'io', message: 'the profile is read-only' } } },
      }
    }
    let value = {}
    if (method === 'settings.update') {
      if (document === null) document = JSON.parse(JSON.stringify(store.state.settings ?? {}))
      const patch = body.patch ?? {}
      document = { ...document, ...patch, lsp: { ...(document.lsp ?? {}), ...(patch.lsp ?? {}) } }
      value = { value: document }
    } else if (method === 'lsp.shutdown') value = { ok: true }
    else if (method === 'lsp.start') value = { state: 'starting' }
    else value = { isRepo: false, entries: [], commits: [], shells: [], projects: [] }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  return {
    calls,
    restore() { globalThis.fetch = original },
  }
}

/**
 * Collect the warnings of the console while a test runs.
 * @returns {{warnings: string[], restore: () => void}} the collector
 */
function collectWarnings() {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => { warnings.push(args.map(arg => String(arg)).join(' ')) }
  return { warnings, restore() { console.warn = original } }
}

// ── N5: a failed write takes the change back ───────────────────────────────

test('a failed settings write takes the decision back', async (t) => {
  // The user asked for a language server, the client said "index it", and the
  // document of the host did not take the change. The client has to go back
  // to what the document says - otherwise the two sides drift apart and the
  // user wonders why the button does nothing (review N5).
  const store = fakeStore({ memoryWarnedRoots: { [ROOT]: 'conservative' } })
  const host = hostStub(store, { failSettings: true })
  const collected = collectWarnings()
  t.after(() => {
    host.restore()
    collected.restore()
  })
  await store.restartLsp()
  await tick(20)
  assert.equal(
    store.state.settings.lsp.workspaceDefaults[ROOT],
    undefined,
    'the decision is back to what the document of the host says',
  )
  assert.equal(
    store.state.settings.lsp.memoryWarnedRoots[ROOT],
    'conservative',
    'and the refusal is back as well',
  )
  assert.ok(collected.warnings.length > 0, 'the failure is written down')
  assert.match(collected.warnings.join('\n'), /\[lsp\]/, 'the warning names the feature')
})

test('a failed settings write of the memory answer takes the change back', async (t) => {
  // The same for the other map: the two writes report a failure the same
  // way, so they cannot drift apart.
  const store = fakeStore()
  const host = hostStub(store, { failSettings: true })
  const collected = collectWarnings()
  t.after(() => {
    host.restore()
    collected.restore()
  })
  const pending = store.decideIndex(CHILD)
  await tick(20)
  // The memory question is not asked (the snapshot is fine), so the decision
  // of the index dialog is the one that writes.
  assert.ok(store.state.indexDecision !== null, 'the index dialog is open')
  store.resolveIndexDecision('conservative')
  await pending
  await tick(20)
  assert.equal(store.state.settings.lsp.workspaceDefaults[CHILD], undefined, 'the decision is back')
  assert.ok(collected.warnings.length > 0, 'the failure is written down')
})

test('a successful settings write keeps the decision', async (t) => {
  // The normal path is untouched: the decision stays, and nothing is logged.
  const store = fakeStore({ memoryWarnedRoots: { [ROOT]: 'conservative' } })
  const host = hostStub(store)
  const collected = collectWarnings()
  t.after(() => {
    host.restore()
    collected.restore()
  })
  await store.restartLsp()
  await tick(20)
  assert.equal(store.state.settings.lsp.workspaceDefaults[ROOT], 'build', 'the decision is kept')
  assert.notEqual(
    store.state.settings.lsp.memoryWarnedRoots[ROOT],
    'conservative',
    'and the refusal is gone',
  )
  assert.deepEqual(collected.warnings, [], 'a successful write says nothing')
})

// ── N4: the comment of the memory row ──────────────────────────────────────

test('the comment of the memory row does not claim a row that does not exist', async () => {
  // The panel renders four rows: available, needs, reserved and the worst
  // case. There is no "measured" row - the memory the running servers have
  // taken is already subtracted from the free memory of the machine.
  const source = await readFile(join(root, 'src', 'client', 'status.jsx'), 'utf8')
  assert.ok(
    !source.includes('is reported as "measured"'),
    'the comment does not name a row that the panel does not render',
  )
  assert.ok(
    source.includes('has NO row of its own'),
    'it says what really happens to the measured memory',
  )
  assert.ok(
    source.includes('neither their usage nor their ceiling'),
    'and what the reservation really is',
  )
})
