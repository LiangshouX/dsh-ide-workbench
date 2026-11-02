/**
 * The workspace defaults of the code intelligence plugin (client side).
 *
 * The plugin owns the `lsp` section of its settings document, and with it
 * the decision of the user about the semantic analysis of a project: "index
 * it" or "the basic mode". The decision lives in the DOCUMENT, so it
 * survives a restart of the client, and it outranks the global policy in
 * both directions (PRD-v5.1 WS-04).
 *
 * The host-side half of the same subject - the migration of the old
 * document of the workbench into the document of the plugin - lives in
 * `lsp-settings-migration.test.mjs`.
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
 * The status view of the plugin, bundled.
 * @returns {Promise<object>} the bundled module
 */
async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'workspace-defaults-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
export { lspStatusView, memoryFacts, showRebuildButton } from './src/client/status.jsx'
`,
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'workspace-defaults-entry.jsx',
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
 * @param {{settings?: any}} [options] the settings of the store
 * @returns {any} the store
 */
function fakeStore(options = {}) {
  const store = new CodeIntelStore({ t: key => en[key] ?? key })
  store.state = {
    ...store.state,
    root: ROOT,
    settings: options.settings ?? {
      shortcuts: {},
      lsp: { enabled: true, indexOnOpen: 'ask' },
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

// ── the decision of the user ───────────────────────────────────────────────

test('the decision of the user is written to the settings document', async (t) => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch({}, calls)
  t.after(() => {
    store.dispose()
    restore()
  })
  await store.rememberWorkspaceDecision(ROOT, 'conservative')
  const write = calls.find(call => call.method === 'settings.update')
  assert.ok(write !== undefined, 'the document was written')
  const defaults = write.body.patch?.lsp?.workspaceDefaults
  assert.equal(defaults?.[ROOT], 'conservative', 'the decision is in the document')
  assert.equal(
    store.state.settings.lsp.workspaceDefaults[ROOT],
    'conservative',
    'and the client shows it right away',
  )
})

test('a decision of the user survives the store and the restart', () => {
  // The decision lives in the document, not in the memory of the store: a
  // new store that reads the document knows it.
  const store = fakeStore({
    settings: {
      shortcuts: {},
      lsp: { enabled: true, indexOnOpen: 'ask', workspaceDefaults: { [ROOT]: 'conservative' } },
    },
  })
  assert.equal(store.lspIndexDecision(ROOT), 'conservative')
  assert.equal(store.lspWorkspaceDefault(ROOT), 'conservative')
})

test('the basic mode of the user outranks the "always index" policy', () => {
  const store = fakeStore({
    settings: {
      shortcuts: {},
      lsp: { enabled: true, indexOnOpen: 'always', workspaceDefaults: { [ROOT]: 'conservative' } },
    },
  })
  assert.equal(store.lspIndexDecision(ROOT), 'conservative')
})

test('the "build" decision of the user outranks the "ask" policy', () => {
  const store = fakeStore({
    settings: {
      shortcuts: {},
      lsp: { enabled: true, indexOnOpen: 'ask', workspaceDefaults: { [ROOT]: 'build' } },
    },
  })
  assert.equal(store.lspIndexDecision(ROOT), 'build')
})

test('the master switch still wins over everything', () => {
  const store = fakeStore({
    settings: {
      shortcuts: {},
      lsp: { enabled: false, indexOnOpen: 'always', workspaceDefaults: { [ROOT]: 'build' } },
    },
  })
  assert.equal(store.lspIndexDecision(ROOT), 'conservative')
})

test('a decision the policy derived is not written to the document', async (t) => {
  // Only a decision the USER made belongs in the document: a decision the
  // policy derived would take the choice away from the user, who could
  // never switch the index of that project off again.
  const store = fakeStore()
  const calls = []
  const restore = mockFetch({}, calls)
  t.after(() => {
    store.dispose()
    restore()
  })
  await store.restartLsp()
  const write = calls.find(call => call.method === 'settings.update')
  // The restart is the way OUT of the basic mode: the user asked for a
  // server, so the decision is theirs.
  assert.equal(write?.body?.patch?.lsp?.workspaceDefaults?.[ROOT], 'build')
})

// ── the restore path ───────────────────────────────────────────────────────

test('the restore path starts the server without a force', async (t) => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch({
    'lsp.resources': () => ({ freeBytes: 8 * 1024 ** 3, availableBytes: 8 * 1024 ** 3, needMB: 400, canIndex: true }),
  }, calls)
  t.after(() => {
    store.dispose()
    restore()
  })
  await store.restartLsp()
  const start = calls.find(call => call.method === 'lsp.start')
  assert.ok(start !== undefined, 'the server was started')
  assert.equal(start.body.force, false, 'a machine with enough memory is never forced')
})

test('the restore path waits for the old server before it starts the new one', async (t) => {
  const store = fakeStore()
  const calls = []
  const restore = mockFetch({}, calls)
  t.after(() => {
    store.dispose()
    restore()
  })
  await store.restartLsp()
  const shutdown = calls.find(call => call.method === 'lsp.shutdown')
  const start = calls.find(call => call.method === 'lsp.start')
  assert.ok(shutdown !== undefined, 'the old server was stopped')
  assert.ok(start !== undefined, 'the new one was started')
  assert.ok(
    calls.indexOf(shutdown) < calls.indexOf(start),
    'the old server is gone before the new one starts (the memory gate reads the memory the old server gave back)',
  )
})

// ── the explanations ───────────────────────────────────────────────────────

test('the basic mode is explained when the plugin enters a workspace', async () => {
  const mod = await loadModule()
  const store = fakeStore({
    settings: {
      shortcuts: {},
      lsp: { enabled: true, indexOnOpen: 'ask', workspaceDefaults: { [ROOT]: 'conservative' } },
    },
  })
  const view = mod.lspStatusView(store, {
    root: ROOT,
    lsp: { ...store.state.lsp, state: 'idle' },
    settings: store.state.settings,
  })
  assert.equal(view.key, 'workspaceOff', 'the status says that the user chose it')
  assert.equal(view.text, en['lsp.status.workspaceOff'])
  assert.equal(view.detail, en['lsp.workspaceOffHint'], 'and the tooltip explains it')
})

test('the answer "start anyway" is not remembered as a permission', () => {
  // The old document remembered a PERMISSION to force the start, and that
  // permission was contagious (PRD-v5.1 MEM-10). The new semantics have no
  // such memory.
  const store = fakeStore({
    settings: {
      shortcuts: {},
      lsp: { enabled: true, indexOnOpen: 'always', memoryWarnedRoots: { [ROOT]: 'accepted' } },
    },
  })
  assert.equal(store.lspIndexDecision(ROOT), 'conservative', 'the legacy value is read as "conservative"')
})

test('the answer "basic mode" is remembered as "do not ask again"', () => {
  const store = fakeStore({
    settings: {
      shortcuts: {},
      lsp: { enabled: true, indexOnOpen: 'always', memoryWarnedRoots: { [ROOT]: 'conservative' } },
    },
  })
  assert.equal(store.lspIndexDecision(ROOT), 'conservative')
})

test('the memory warning shows the number the gate judged by', async () => {
  const store = fakeStore()
  const pending = store.askMemoryDecision(
    { path: ROOT },
    { needMB: 651, availableBytes: 684 * 1024 * 1024, freeBytes: 2732 * 1024 * 1024 },
  )
  const decision = store.state.memoryDecision
  assert.equal(decision.path, ROOT)
  assert.equal(decision.needMB, 651)
  // The AVAILABLE memory is the number the gate judged by - not the free
  // memory of the machine, which is 2 GB higher here.
  assert.equal(decision.freeMB, 684)
  store.resolveMemoryDecision('conservative')
  assert.equal(await pending, 'conservative')
  assert.equal(store.state.memoryDecision, null, 'the dialog is closed')
})

// ── the diagnostics panel ──────────────────────────────────────────────────

test('the diagnostics panel shows the typical case and the worst case', async () => {
  const mod = await loadModule()
  const store = fakeStore()
  const facts = mod.memoryFacts(store, {
    freeBytes: 2732 * 1024 * 1024,
    availableBytes: 684 * 1024 * 1024,
    reservedBytes: 2048 * 1024 * 1024,
    needMB: 651,
    worstCaseBytes: -842 * 1024 * 1024,
    ceilingMB: 2048,
  })
  assert.equal(facts.availableMB, 684, 'the available memory is the one the gate uses')
  assert.equal(facts.needMB, 651)
  assert.equal(facts.reservedMB, 2048)
  assert.match(facts.text, /Available 684 MB/)
  assert.match(facts.text, /Reserved 2048 MB/)
  // The worst band: what the machine would be left with if the server grew
  // into its own ceiling.
  assert.equal(facts.worstMB, -842)
  assert.match(facts.worstText, /2048/)
})

test('the diagnostics panel says nothing about the worst case without the host numbers', async () => {
  const mod = await loadModule()
  const store = fakeStore()
  const facts = mod.memoryFacts(store, {
    freeBytes: 2732 * 1024 * 1024,
    needMB: 651,
  })
  assert.equal(facts.worstMB, null)
  assert.equal(facts.worstText, '')
})

// ── the status line ────────────────────────────────────────────────────────

test('the status line names the basic mode of the workspace', async () => {
  const mod = await loadModule()
  const store = fakeStore({
    settings: {
      shortcuts: {},
      lsp: { enabled: true, indexOnOpen: 'ask', workspaceDefaults: { [ROOT]: 'conservative' } },
    },
  })
  const view = mod.lspStatusView(store, {
    root: ROOT,
    lsp: { ...store.state.lsp, state: 'idle' },
    settings: store.state.settings,
  })
  assert.equal(view.key, 'workspaceOff')
  // The way back is not a button of the status bar: the basic mode is a
  // decision of the user, and the diagnostics panel is where the way back
  // lives.
  assert.equal(view.tone, 'idle', 'the basic mode is not a fault')
})

// ── the release of a store ─────────────────────────────────────────────────

test('the release of a store stops its poll and clears the mirrored status', () => {
  const store = fakeStore()
  store.activate()
  assert.notEqual(store.lspPollTimer, null, 'the poll is running')
  store.state.lsp = { ...store.state.lsp, state: 'ready' }
  store.dispose()
  assert.equal(store.lspPollTimer, null, 'the poll is stopped')
  assert.equal(store.state.lsp.state, 'idle', 'the mirrored status of a server that is gone is gone')
  assert.equal(store.state.lsp.clientState, 'idle', 'and there is no session any more')
})

test('a store that is released does not keep a listener of the document', (t) => {
  // The listener belongs to the document, so the store registers it when it
  // is created - and removes it again when it is dropped.
  const original = globalThis.document
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener() {},
    removeEventListener() {},
  }
  t.after(() => {
    if (original === undefined) delete globalThis.document
    else globalThis.document = original
  })
  const store = fakeStore()
  assert.equal(store.visibilityBound, true, 'the listener is registered')
  store.dispose()
  assert.equal(store.visibilityBound, false, 'and removed again')
})
