/**
 * The index decision of the code intelligence plugin (PRD-v5 §2.3).
 *
 * The plugin owns the index of a project: it asks the user before it builds
 * one, it remembers what the user said, and it asks again when the machine
 * is too tight for the estimate of the language.
 *
 * The hierarchy is fixed (PRD-v5.1 WS-04):
 *
 *   1. the master switch: the feature is off, so nothing is started;
 *   2. the workspace-scoped default of the user: it outranks the policy in
 *      both directions;
 *   3. the policy `indexOnOpen` ('ask', 'always', 'never');
 *   4. the memory gate: a machine below the floor degrades, a tight machine
 *      asks the user;
 *   5. the dialog of the index decision.
 *
 * The project SWITCH itself belongs to the core - the plugin follows the
 * project of the contract and never changes it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { CodeIntelStore } from '../src/client/store.js'
import { en } from '../src/client/i18n.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const ROOT = 'C:\\work\\demo'
const CHILD = 'C:\\work\\demo\\packages\\app'

let modulePromise

/**
 * The dialogs of the plugin, bundled.
 * @returns {Promise<object>} the bundled module
 */
async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'idx-decision-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
export { IndexDecision, MemoryDecision } from './src/client/decision.jsx'
`,
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'idx-decision-entry.jsx',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: ['node20'],
      external: ['react', 'react-dom', 'react-dom/server', '@deepseek-ai/dsh-client-ui-primitives'],
      loader: { '.css': 'text' },
      jsx: 'transform',
      define: { 'process.env.NODE_ENV': '"production"' },
      outfile,
      logLevel: 'silent',
    })
    return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
  })()
  return modulePromise
}

/**
 * A store with a project root, without booting the host.
 * @param {object} [lsp] the `lsp` section of the settings
 * @returns {any} the store
 */
function fakeStore(lsp = {}) {
  const store = new CodeIntelStore({ t: key => en[key] ?? key })
  store.state = {
    ...store.state,
    root: ROOT,
    settings: {
      shortcuts: {},
      lsp: { enabled: true, indexOnOpen: 'ask', ...lsp },
    },
  }
  return store
}

/**
 * Install a fetch mock; `routes` maps method → (body) => value (or throws).
 * @param {Record<string, Function>} [routes] the routes of the stub
 * @param {any[]} [calls] the recorded calls
 * @returns {() => void} restore the real fetch
 */
function mockFetch(routes = {}, calls = []) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/dsh-codeintel/api/')[1]
    const body = init?.body === undefined ? {} : JSON.parse(init.body)
    calls.push({ method, body })
    const route = routes[method]
    if (route === undefined) {
      return { ok: true, status: 200, async json() { return { ok: true, value: {} } } }
    }
    try {
      const value = await route(body)
      return { ok: true, status: 200, async json() { return { ok: true, value } } }
    } catch (error) {
      return {
        ok: false,
        status: 500,
        async json() { return { ok: false, error: { code: error.code ?? 'error', message: error.message } } },
      }
    }
  }
  return () => { globalThis.fetch = original }
}

/** Wait for the pending promises of the store. */
const tick = (ms = 10) => new Promise(resolve => { setTimeout(resolve, ms) })

/** The memory snapshot of a machine with enough memory. */
const ROOMY = { freeBytes: 8 * 1024 ** 3, availableBytes: 8 * 1024 ** 3, needMB: 400, canIndex: true }

/** The memory snapshot of a machine whose memory is tight. */
const TIGHT = { freeBytes: 100 * 1024 * 1024, availableBytes: 100 * 1024 * 1024, needMB: 200, canIndex: true, tight: true }

/** The memory snapshot of a machine below the floor. */
const LOW = { freeBytes: 100 * 1024 ** 2, availableBytes: 100 * 1024 ** 2, thresholdBytes: 384 * 1024 * 1024, needMB: 200, canIndex: false, decision: 'low' }

// ── the dialog ─────────────────────────────────────────────────────────────

test('an unindexed project asks before it builds an index', async (t) => {
  const store = fakeStore()
  const restore = mockFetch({ 'lsp.resources': () => ROOMY })
  t.after(() => {
    store.dispose()
    restore()
  })
  const pending = store.decideIndex(CHILD)
  await tick(20)
  assert.notEqual(store.state.indexDecision, null, 'the dialog is open')
  assert.equal(store.state.indexDecision.path, CHILD)
  store.resolveIndexDecision('build')
  assert.equal(await pending, 'build', 'the user wants the index')
})

test('the answer "basic mode" keeps the conservative mode', async (t) => {
  const store = fakeStore()
  const restore = mockFetch({ 'lsp.resources': () => ROOMY })
  t.after(() => {
    store.dispose()
    restore()
  })
  const pending = store.decideIndex(CHILD)
  await tick(20)
  store.resolveIndexDecision('conservative')
  assert.equal(await pending, 'conservative')
  assert.equal(
    store.state.settings.lsp.workspaceDefaults[CHILD],
    'conservative',
    'the decision of the user is remembered',
  )
})

test('cancelling the index decision changes nothing', async (t) => {
  const store = fakeStore()
  const restore = mockFetch({ 'lsp.resources': () => ROOMY })
  t.after(() => {
    store.dispose()
    restore()
  })
  const pending = store.decideIndex(CHILD)
  await tick(20)
  store.resolveIndexDecision('cancel')
  assert.equal(await pending, 'cancel')
  assert.equal(
    store.state.settings.lsp.workspaceDefaults?.[CHILD],
    undefined,
    'a cancelled decision is not written down',
  )
})

test('the dialog offers build, basic mode and cancel', async () => {
  const mod = await loadModule()
  // The keys are shown as they are: the test pins the wording of the
  // dictionary, not the text of one language.
  const store = new CodeIntelStore({ t: key => key })
  store.set({ indexDecision: { path: CHILD, name: 'app', language: 'typescript', needMB: 400 } })
  const html = renderToStaticMarkup(React.createElement(mod.IndexDecision, { store, state: store.state }))
  assert.match(html, /index\.decision\.title/)
  assert.match(html, /index\.decision\.build/)
  assert.match(html, /index\.decision\.conservative/)
  assert.match(html, /index\.decision\.cancel/)
})

// ── the memory gate ────────────────────────────────────────────────────────

test('a tight budget asks the user before the server starts', async (t) => {
  const store = fakeStore()
  const restore = mockFetch({ 'lsp.resources': () => TIGHT })
  t.after(() => {
    store.dispose()
    restore()
  })
  const pending = store.decideIndex(CHILD)
  await tick(20)
  assert.notEqual(store.state.memoryDecision, null, 'the memory warning is open')
  assert.equal(store.state.memoryDecision.needMB, 200)
  store.resolveMemoryDecision('start')
  assert.equal(await pending, 'build-forced', 'the user forced the start')
})

test('the answer "start anyway" forces this start only, and the next tight moment asks again', async (t) => {
  const store = fakeStore()
  const restore = mockFetch({ 'lsp.resources': () => TIGHT })
  t.after(() => {
    store.dispose()
    restore()
  })
  const first = store.decideIndex(CHILD)
  await tick(20)
  store.resolveMemoryDecision('start')
  assert.equal(await first, 'build-forced')
  // The permission is NOT remembered: the next tight moment asks again
  // (PRD-v5.1 MEM-10).
  assert.equal(
    store.state.settings.lsp.memoryWarnedRoots?.[CHILD],
    undefined,
    'the permission to force is not remembered',
  )
  const second = store.decideIndex(CHILD)
  await tick(20)
  assert.notEqual(store.state.memoryDecision, null, 'the next tight moment asks again')
  store.resolveMemoryDecision('conservative')
  assert.equal(await second, 'conservative')
})

test('the answer "basic mode" is remembered as "do not ask again"', async (t) => {
  const store = fakeStore()
  const restore = mockFetch({ 'lsp.resources': () => TIGHT })
  t.after(() => {
    store.dispose()
    restore()
  })
  const first = store.decideIndex(CHILD)
  await tick(20)
  store.resolveMemoryDecision('conservative')
  assert.equal(await first, 'conservative')
  assert.equal(
    store.state.settings.lsp.workspaceDefaults[CHILD],
    'conservative',
    'the refusal of the user is remembered',
  )
  // The next tight moment does not ask again.
  const second = store.decideIndex(CHILD)
  await tick(20)
  assert.equal(store.state.memoryDecision, null, 'the question is not asked again')
  assert.equal(await second, 'conservative')
})

test('a machine without enough memory degrades with the threshold, not the estimate', async (t) => {
  const store = fakeStore()
  const toasts = []
  const show = store.toast.bind(store)
  store.toast = (kind, text, detail) => { toasts.push({ kind, text, detail }); show(kind, text, detail) }
  const restore = mockFetch({ 'lsp.resources': () => LOW })
  t.after(() => {
    store.dispose()
    restore()
  })
  const decision = await store.decideIndex(CHILD)
  assert.equal(decision, 'conservative', 'the project stays in the basic mode')
  assert.equal(toasts.length, 1, 'the user is told why')
  // The number of the toast is the one the gate judged by.
  assert.match(toasts[0].text, /384/, 'the threshold is the number of the gate')
})

// ── the policies ───────────────────────────────────────────────────────────

test('the "never index" policy keeps the conservative mode without a question', async (t) => {
  const store = fakeStore({ indexOnOpen: 'never' })
  const restore = mockFetch({ 'lsp.resources': () => ROOMY })
  t.after(() => {
    store.dispose()
    restore()
  })
  assert.equal(await store.decideIndex(CHILD), 'conservative')
  assert.equal(store.state.indexDecision, null, 'nobody was asked')
})

test('the "always index" policy builds the index without a question', async (t) => {
  const store = fakeStore({ indexOnOpen: 'always' })
  const restore = mockFetch({ 'lsp.resources': () => ROOMY })
  t.after(() => {
    store.dispose()
    restore()
  })
  assert.equal(await store.decideIndex(CHILD), 'build')
  assert.equal(store.state.indexDecision, null, 'nobody was asked')
})

test('a disabled semantic analysis never starts a language server', async (t) => {
  const store = fakeStore({ enabled: false })
  const restore = mockFetch({ 'lsp.resources': () => ROOMY })
  t.after(() => {
    store.dispose()
    restore()
  })
  assert.equal(await store.decideIndex(CHILD), 'conservative')
  assert.equal(store.state.indexDecision, null, 'nobody was asked')
})

test('an indexed folder is opened without a question', async (t) => {
  const store = fakeStore({ indexedRoots: { [CHILD]: { at: 1, languageId: 'typescript' } } })
  const restore = mockFetch({ 'lsp.resources': () => ROOMY })
  t.after(() => {
    store.dispose()
    restore()
  })
  assert.equal(await store.decideIndex(CHILD), 'build')
  assert.equal(store.state.indexDecision, null, 'nobody was asked')
})

test('a remembered "basic mode" keeps the conservative mode', async (t) => {
  const store = fakeStore({ workspaceDefaults: { [CHILD]: 'conservative' } })
  const restore = mockFetch({ 'lsp.resources': () => ROOMY })
  t.after(() => {
    store.dispose()
    restore()
  })
  assert.equal(await store.decideIndex(CHILD), 'conservative')
  assert.equal(store.state.indexDecision, null, 'nobody was asked')
})
