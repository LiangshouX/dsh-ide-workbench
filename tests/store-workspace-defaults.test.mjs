/**
 * The workspace-scoped default state of the semantic analysis (PRD-v5.1).
 *
 * Four defects of PRD-v5.1 are covered here, all of them in the client:
 *
 *   - WS-04: the decision of the user ("index this project" / "keep it in the
 *     basic mode") was kept in the memory of the store, so it was forgotten
 *     when the store was evicted and after every restart of DSH. It now
 *     lives in the settings document (`lsp.workspaceDefaults`), and it
 *     OUTRANKS the global policy `lsp.indexOnOpen`.
 *   - MEM-09: the popup and the toast showed the free memory of the machine
 *     while the gate judged the start by the AVAILABLE memory. Two screens,
 *     one question, two answers.
 *   - MEM-10: the answer "start anyway" was remembered as a permission, so
 *     every later tight moment started the server forced - and the restore
 *     path inherited the permission across workspace switches and restarts.
 *   - MEM-07: the diagnostics panel showed one number where the user needs
 *     two: the typical case and the worst case.
 *   - CONC-05: the badge of the project picker said "indexed" even after the
 *     server was reclaimed.
 *
 * The last group of cases covers the migration of the host settings: the new
 * keys have to arrive in an old document, and a hand-edited value has to be
 * repaired instead of being carried into the runtime.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { WorkbenchStore } from '../src/client/store.js'
import { DEFAULT_SETTINGS, migrateLspSettings } from '../src/host/settings-store.js'
import { DEFAULT_LSP_SETTINGS } from '../src/host/settings-defaults.js'
import { en } from '../src/client/i18n.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The bundle touches browser globals at import time; the decisions themselves
// never read the DOM.
globalThis.window = {
  innerWidth: 1440,
  innerHeight: 900,
  location: { href: 'http://localhost/' },
  addEventListener() {},
  removeEventListener() {},
}
globalThis.self = globalThis.window
globalThis.HTMLElement = class HTMLElement {}
globalThis.Element = class Element {}
const elementStub = () => ({
  style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false },
  setAttribute() {}, removeAttribute() {}, remove() {}, appendChild() {}, insertBefore() {},
  addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
  querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  getContext: () => null,
})
globalThis.document = {
  baseURI: 'http://localhost/',
  documentElement: { ...elementStub(), style: {} },
  head: { appendChild() {} },
  body: { style: {}, appendChild() {}, removeChild() {} },
  createElement: elementStub,
  createElementNS: elementStub,
  createTextNode: () => ({ style: {}, remove() {} }),
  createRange: () => ({ setStart() {}, setEnd() {}, getBoundingClientRect: () => ({ top: 0, left: 0 }), getClientRects: () => [] }),
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener() {},
  removeEventListener() {},
}
globalThis.window.getComputedStyle = () => ({ getPropertyValue: () => '', fontSize: '13px' })
globalThis.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
globalThis.window.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0)
globalThis.window.cancelAnimationFrame = (handle) => clearTimeout(handle)
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { clipboard: { writeText: async () => {}, readText: () => '' } },
})
globalThis.ResizeObserver = class { observe() {} disconnect() {} }

let modulePromise

/** The bundled workbench (the JSX has to be compiled before it can be run). */
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
export { Workbench } from './src/client/Workbench.jsx'
export { lspStatusView, memoryFacts } from './src/client/Workbench.jsx'
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
      alias: {
        '@xterm/xterm/css/xterm.css': join(root, 'node_modules/@xterm/xterm/css/xterm.css'),
        '@xterm/xterm': join(root, 'tests/stubs/xterm.js'),
        '@xterm/addon-fit': join(root, 'tests/stubs/addon-fit.js'),
      },
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

const ROOT = 'C:\\work\\demo'
const CHILD = 'C:\\work\\demo\\api'
const OTHER = 'C:\\work\\other'

/**
 * The texts of PRD-v5.1 that the locale file does not carry yet.
 *
 * The lead owns `src/client/i18n.js`; these are the exact texts and the
 * placeholder names the client interpolates. The tests use them locally, so
 * they check the LOGIC (the numbers of the host reach the sentence) without
 * depending on a dictionary that is written in parallel.
 */
const PENDING_TEXTS = {
  'lsp.diagnostics.memoryWorstText': 'If this server takes its ceiling of {ceiling} MB, the machine will be left with {left} MB.',
  'lsp.workspaceBasicModeToast': 'This workspace has not turned on the semantic analysis. You can turn it on for a project.',
  'lsp.workspaceConservativeToast': 'You chose the basic mode for this project. You can turn the semantic analysis on for it at any time.',
  'lsp.status.workspaceOff': 'Semantic analysis: not enabled for this project',
  'lsp.workspaceOffHint': 'You chose the basic mode for this project. You can turn the semantic analysis on for it at any time.',
  'project.indexedReclaimed': 'Indexed (reclaimed)',
  'project.indexedReclaimedHint': 'This folder was indexed before, but no language server is running for it now.',
}

/**
 * A translator over one locale table, with the texts of PRD-v5.1 added.
 * @param {Record<string, string>} table the locale table
 * @returns {(key: string) => string} the translator
 */
function translator(table) {
  return (key) => {
    if (typeof PENDING_TEXTS[key] === 'string') return PENDING_TEXTS[key]
    return typeof table[key] === 'string' ? table[key] : key
  }
}

/** Wait for the pending promises of the store. */
const tick = (ms = 10) => new Promise(resolve => { setTimeout(resolve, ms) })

/**
 * A store with one workspace root and one first-level folder.
 * @param {{root?: object, child?: object}} [overrides] per-project overrides
 * @param {any} [lsp] the `lsp` section of the settings
 * @returns {any} the store
 */
function fakeStore(overrides = {}, lsp = {}) {
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new WorkbenchStore(ctx, key => key)
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
      { path: ROOT, name: 'demo', isRoot: true, isRepo: false, indexState: 'unknown', indexedAt: null, ...overrides.root },
      { path: CHILD, name: 'api', isRoot: false, isRepo: true, indexState: 'unknown', indexedAt: null, ...overrides.child },
    ],
  }
  return store
}

/**
 * One host stub: every route answers with a fixture, and the calls are
 * recorded so the test can see which route was asked.
 *
 * The settings document of the stub is a real one: the host merges a patch
 * into its document and answers with the WHOLE document, and the store adopts
 * that answer - a stub that answered with a fragment would empty the settings
 * of the store.
 * @param {any} store the store the stub belongs to
 * @param {{decision?: string, canIndex?: boolean, availableBytes?: number, freeBytes?: number}} [options]
 */
function hostStub(store, options = {}) {
  const calls = []
  let document = null
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/').pop()
    const body = init?.body === undefined ? {} : JSON.parse(init.body)
    calls.push({ method, body })
    let value = {}
    if (method === 'lsp.resources') {
      value = {
        totalBytes: 16 * 1024 * 1024 * 1024,
        // The free memory of the machine - the number the popup used to show.
        freeBytes: options.freeBytes ?? 2648 * 1024 * 1024,
        // The memory a new server may really use - the number the gate
        // judges the start by.
        availableBytes: options.availableBytes ?? 600 * 1024 * 1024,
        thresholdBytes: 256 * 1024 * 1024,
        hardFloorMB: 256,
        memoryLimitBytes: 2 * 1024 * 1024 * 1024,
        canIndex: options.canIndex !== false,
        decision: options.decision ?? 'ok',
        tight: options.decision === 'tight',
        needMB: options.needMB ?? 651,
        languageId: 'typescript',
        // The worst band of PRD-v5.1 MEM-07.
        ceilingMB: 2048,
        worstCase: true,
        worstCaseBytes: -842 * 1024 * 1024,
        measuredMB: 606,
        budgetBytes: 4096 * 1024 * 1024,
        budgetUsedBytes: 2048 * 1024 * 1024,
      }
    } else if (method === 'lsp.start') value = { state: 'starting', forced: body.force === true }
    else if (method === 'lsp.status') {
      value = { enabled: true, state: 'idle', languageId: '', serverId: '', source: null, detail: null, indexedRoots: [], liveRoots: [] }
    } else if (method === 'lsp.index') value = { state: 'idle', progress: '', startedAt: 0, cancellable: false }
    else if (method === 'lsp.servers') value = { available: [], missing: [] }
    else if (method === 'workspace.projects') value = { workspace: body.root, projects: [] }
    else if (method === 'git.status') value = { isRepo: false, entries: [], detached: false }
    else if (method === 'git.log') value = { commits: [], hasMore: false }
    else if (method === 'fs.tree') value = { entries: [], truncated: false }
    else if (method === 'settings.update') {
      // The document of the host starts as the one of the store: the store
      // adopts the answer of every update.
      if (document === null) {
        const settings = JSON.parse(JSON.stringify(store.state.settings ?? {}))
        document = {
          editor: {},
          shortcuts: {},
          ...settings,
          lsp: { enabled: true, indexOnOpen: 'ask', workspaceDefaults: {}, ...(settings.lsp ?? {}) },
        }
      }
      const patch = body.patch ?? {}
      document = { ...document, ...patch, lsp: { ...(document.lsp ?? {}), ...(patch.lsp ?? {}) } }
      // The route answers with the WHOLE document - that is what the store
      // adopts after an update.
      value = { value: document }
    } else value = { shells: [], names: [], messages: [] }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  return {
    calls,
    methods: () => calls.map(call => call.method),
    starts: () => calls.filter(call => call.method === 'lsp.start'),
    updates: () => calls.filter(call => call.method === 'settings.update'),
    restore() { globalThis.fetch = original },
  }
}

/** Release the timers a test may have armed. */
function cleanup(store) {
  if (store.toastTimer !== null) clearTimeout(store.toastTimer)
  store.persist.cancel()
}

// ── WS-04: the workspace-scoped default ─────────────────────────────────────

test('the decision of the user is written to the settings document', async (t) => {
  const store = fakeStore()
  const host = hostStub(store)
  t.after(() => {
    cleanup(store)
    host.restore()
  })
  const pending = store.selectProject(CHILD)
  await tick()
  assert.ok(store.state.indexDecision !== null, 'the dialog is open')
  store.resolveIndexDecision('build')
  await pending
  // The decision lives in the document, not in the memory of the store: the
  // store is evicted after three workspaces, and DSH is restarted every day.
  assert.equal(store.state.settings.lsp.workspaceDefaults[CHILD], 'build')
  const update = host.updates().find(call => call.body.patch?.lsp?.workspaceDefaults !== undefined)
  assert.ok(update !== undefined, 'the host is told about the decision')
  assert.equal(update.body.patch.lsp.workspaceDefaults[CHILD], 'build')
})

test('a decision of the user survives the store and the restart', () => {
  // A new store reads the document of the old one: the decision of the user
  // is not lost when the store is evicted.
  const store = fakeStore({}, { workspaceDefaults: { [CHILD]: 'build' } })
  assert.equal(store.lspIndexDecision(CHILD), 'build')
  assert.equal(store.lspWorkspaceDefault(CHILD), 'build')
})

test('the basic mode of the user outranks the "always index" policy', () => {
  // WS-04 requirement 2: the workspace-scoped default is more specific than
  // the global policy, so a project whose user chose the basic mode is not
  // indexed behind their back.
  const store = fakeStore({}, { indexOnOpen: 'always', workspaceDefaults: { [ROOT]: 'conservative' } })
  assert.equal(store.lspIndexDecision(ROOT), 'conservative')
})

test('the "build" decision of the user outranks the "ask" policy', () => {
  const store = fakeStore({}, { indexOnOpen: 'ask', workspaceDefaults: { [ROOT]: 'build' } })
  assert.equal(store.lspIndexDecision(ROOT), 'build')
})

test('the master switch still wins over everything', () => {
  const store = fakeStore({}, { enabled: false, workspaceDefaults: { [ROOT]: 'build' } })
  assert.equal(store.lspIndexDecision(ROOT), 'conservative')
})

test('a decision the policy derived is not written to the document', async (t) => {
  // The automatic start of the "always index" policy is not a decision of the
  // user. Written to the document it would take the choice away from the
  // user for ever (WS-04 requirement 4).
  const store = fakeStore({}, { indexOnOpen: 'always' })
  const host = hostStub(store)
  t.after(() => {
    cleanup(store)
    host.restore()
  })
  const pending = store.selectProject(CHILD)
  await tick()
  await pending
  assert.equal(host.starts().length, 1, 'the policy starts the server')
  assert.deepEqual(store.state.settings.lsp.workspaceDefaults, {}, 'but the document stays empty')
})

test('the restore path starts the server without a force', async (t) => {
  // The restore path cannot ask the user, so it has no permission to skip
  // the tight band of the gate (MEM-10).
  const store = fakeStore({}, { indexOnOpen: 'always' })
  const host = hostStub(store)
  t.after(() => {
    cleanup(store)
    host.restore()
  })
  await store.setRoot(OTHER)
  await tick(30)
  const starts = host.starts()
  assert.equal(starts.length, 1, 'the host is asked to start the server')
  assert.equal(starts[0].body.root, OTHER)
  assert.equal(starts[0].body.force, false, 'the start is not forced')
})

test('the basic mode is explained when the workbench enters a workspace', async (t) => {
  // Silence looks like a broken feature: the restore path does not ask, so
  // it has to say why the workbench is in the basic mode.
  const store = fakeStore()
  const host = hostStub(store)
  t.after(() => {
    cleanup(store)
    host.restore()
  })
  await store.setRoot(OTHER)
  await tick(30)
  assert.equal(host.starts().length, 0, 'nothing is started')
  assert.ok(store.state.toast !== null, 'the user is told')
  assert.match(store.state.toast.text, /lsp\.workspaceBasicModeToast/)
})

test('the explanation names the choice of the user when there is one', async (t) => {
  const store = fakeStore({}, { workspaceDefaults: { [OTHER]: 'conservative' } })
  const host = hostStub(store)
  t.after(() => {
    cleanup(store)
    host.restore()
  })
  await store.setRoot(OTHER)
  await tick(30)
  assert.match(store.state.toast.text, /lsp\.workspaceConservativeToast/)
})

// ── MEM-10: the permission to force is not inherited ───────────────────────

test('the answer "start anyway" is not remembered as a permission', async (t) => {
  const store = fakeStore()
  const host = hostStub(store, { decision: 'tight' })
  t.after(() => {
    cleanup(store)
    host.restore()
  })
  const pending = store.selectProject(CHILD)
  await tick()
  assert.ok(store.state.memoryDecision !== null, 'the user is asked')
  store.resolveMemoryDecision('start')
  await pending
  // The memory of the map is "do not ask me again" - never "you may force".
  assert.notEqual(
    store.state.settings.lsp.memoryWarnedRoots?.[CHILD],
    'accepted',
    'the permission to force is not written down',
  )
  const start = host.starts()[0]
  assert.equal(start.body.force, true, 'but the start of this moment is forced')
})

test('the next tight moment asks again', async (t) => {
  const store = fakeStore()
  const host = hostStub(store, { decision: 'tight' })
  t.after(() => {
    cleanup(store)
    host.restore()
  })
  const first = store.selectProject(CHILD)
  await tick()
  store.resolveMemoryDecision('start')
  await first
  // The project is left and opened again while the memory is still tight.
  store.state = { ...store.state, root: ROOT }
  const second = store.selectProject(CHILD)
  await tick()
  assert.ok(store.state.memoryDecision !== null, 'the user is asked again')
  store.resolveMemoryDecision('conservative')
  await second
  assert.equal(host.starts().length, 1, 'and nothing is started behind their back')
})

test('the answer "basic mode" is remembered as "do not ask again"', async (t) => {
  const store = fakeStore()
  const host = hostStub(store, { decision: 'tight' })
  t.after(() => {
    cleanup(store)
    host.restore()
  })
  const pending = store.selectProject(CHILD)
  await tick()
  store.resolveMemoryDecision('conservative')
  await pending
  assert.equal(store.state.settings.lsp.memoryWarnedRoots[CHILD], 'conservative')
  assert.equal(host.starts().length, 0, 'no server is started')
})

test('a legacy "accepted" is read as "conservative"', () => {
  // A document written before PRD-v5.1 remembered a permission to force the
  // start. The new semantics have no such memory, so the old value degrades
  // to the safe one: the project falls back to the basic mode instead of
  // silently force-starting.
  const store = fakeStore({}, { memoryWarnedRoots: { [ROOT]: 'accepted' } })
  assert.equal(store.lspIndexDecision(ROOT), 'conservative')
})

test('a legacy "accepted" starts nothing on the restore path', async (t) => {
  const store = fakeStore({}, { indexOnOpen: 'always', memoryWarnedRoots: { [OTHER]: 'accepted' } })
  const host = hostStub(store)
  t.after(() => {
    cleanup(store)
    host.restore()
  })
  await store.setRoot(OTHER)
  await tick(30)
  assert.equal(host.starts().length, 0, 'the remembered permission starts nothing')
})

// ── MEM-09: one number for the available memory ────────────────────────────

test('the memory warning shows the number the gate judged by', async (t) => {
  const store = fakeStore()
  const host = hostStub(store, { decision: 'tight' })
  t.after(() => {
    cleanup(store)
    host.restore()
  })
  const pending = store.selectProject(CHILD)
  await tick()
  // The machine has 2648 MB free, but the gate judges the start by the 600 MB
  // that are really available. The popup has to say the same number.
  assert.equal(store.state.memoryDecision.freeMB, 600)
  store.resolveMemoryDecision('conservative')
  await pending
})

test('the low memory toast names the available memory', async (t) => {
  const store = fakeStore()
  store.t = translator(en)
  const host = hostStub(store, { decision: 'low', canIndex: false })
  t.after(() => {
    cleanup(store)
    host.restore()
  })
  await store.selectProject(CHILD)
  assert.ok(store.state.toast !== null, 'the user is told')
  assert.match(store.state.toast.text, /600 MB/)
  assert.doesNotMatch(store.state.toast.text, /2648 MB/)
})

// ── MEM-07: two bands in the diagnostics panel ─────────────────────────────

test('the diagnostics panel shows the typical case and the worst case', async () => {
  const mod = await loadModule()
  const store = { t: translator(en) }
  const facts = mod.memoryFacts(store, {
    freeBytes: 2648 * 1024 * 1024,
    availableBytes: 1206 * 1024 * 1024,
    reservedBytes: 1442 * 1024 * 1024,
    needMB: 651,
    ceilingMB: 2048,
    worstCase: true,
    worstCaseBytes: -842 * 1024 * 1024,
  })
  assert.equal(facts.availableMB, 1206)
  assert.equal(facts.needMB, 651)
  assert.match(facts.text, /1206 MB/)
  assert.match(facts.text, /651 MB/)
  // The worst band: the numbers come from the host, the client does not
  // compute them a second time.
  assert.equal(facts.worstMB, -842)
  assert.match(facts.worstText, /2048/)
  assert.match(facts.worstText, /-842/)
})

test('the diagnostics panel says nothing about the worst case without the host numbers', async () => {
  const mod = await loadModule()
  const store = { t: translator(en) }
  const facts = mod.memoryFacts(store, { availableBytes: 1206 * 1024 * 1024, needMB: 651 })
  assert.equal(facts.worstMB, null)
  assert.equal(facts.worstText, '')
})

// ── CONC-05: the badge of the project picker has two states ────────────────

test('an indexed project with a running server carries the plain badge', async () => {
  const mod = await loadModule()
  const store = fakeStore({ child: { indexState: 'indexed', indexedAt: 1700000000000 } })
  store.state.projectPicker = true
  store.state.root = CHILD
  store.state.lsp = { ...store.state.lsp, state: 'ready', liveRoots: [CHILD] }
  const html = renderToStaticMarkup(React.createElement(mod.Workbench, { store }))
  assert.match(html, /iwb-project-index-badge/)
  assert.match(html, /project\.indexed/)
  assert.doesNotMatch(html, /project\.indexedReclaimed/)
})

test('an indexed project whose server was reclaimed carries the reclaimed badge', async () => {
  const mod = await loadModule()
  const store = fakeStore({ child: { indexState: 'indexed', indexedAt: 1700000000000 } })
  store.state.projectPicker = true
  store.state.root = CHILD
  // The server was released: the historical fact is still true, but the index
  // is not there any more.
  store.state.lsp = { ...store.state.lsp, state: 'suspended', liveRoots: [] }
  const html = renderToStaticMarkup(React.createElement(mod.Workbench, { store }))
  assert.match(html, /iwb-project-index-badge/)
  assert.match(html, /project\.indexedReclaimed/)
  assert.match(html, /title="project\.indexedReclaimedHint"/)
})

// ── the status line of a workspace in the basic mode ───────────────────────

test('the status line names the basic mode of the workspace', async () => {
  const mod = await loadModule()
  const store = fakeStore({}, { workspaceDefaults: { [ROOT]: 'conservative' } })
  const view = mod.lspStatusView(store, { ...store.state, lsp: { ...store.state.lsp, state: 'idle', clientState: 'ready' } })
  assert.equal(view.text, 'lsp.status.workspaceOff')
})

// ── WS-02 / WS-03: the order of the shutdown and the release ───────────────

test('the restore path waits for the old server before it starts the new one', async (t) => {
  // WS-02: the gate of the new server must not see the reservation of the
  // old one - the shutdown has to be answered before the start is asked.
  const store = fakeStore({}, { indexOnOpen: 'always' })
  const host = hostStub(store)
  t.after(() => {
    cleanup(store)
    host.restore()
  })
  await store.setRoot(OTHER)
  await tick(30)
  const methods = host.methods()
  const shutdown = methods.indexOf('lsp.shutdown')
  const start = methods.indexOf('lsp.start')
  assert.ok(shutdown >= 0, 'the old server is stopped')
  assert.ok(start >= 0, 'the new server is started')
  assert.ok(shutdown < start, 'and the stop comes first')
  assert.equal(host.calls[shutdown].body.root, ROOT, 'it is the root that was left')
  assert.equal(host.calls[start].body.root, OTHER, 'and the new root starts')
})

test('the release of a store stops its poll and clears the mirrored status', () => {
  // WS-03: a store that nobody watches any more must not keep saying
  // "semantic analysis: ready".
  const store = fakeStore()
  store.state.lsp = { ...store.state.lsp, state: 'ready', clientState: 'ready' }
  store.lspPollTimer = setInterval(() => {}, 1000)
  store.releaseLsp()
  assert.equal(store.lspPollTimer, null, 'the poll of the status stops')
  assert.equal(store.state.lsp.state, 'idle', 'the mirrored status is cleared')
  assert.equal(store.state.lsp.clientState, 'idle', 'the client session is gone as well')
  // The release may come twice: the second call must not throw.
  store.releaseLsp()
  assert.equal(store.state.lsp.state, 'idle')
})

// ── the migration of the host settings ──────────────────────────────────────

test('the new keys arrive in an old document', () => {
  const document = { version: 5, lsp: { enabled: true, indexOnOpen: 'ask' } }
  migrateLspSettings(document)
  assert.equal(document.lsp.budgetRatio, DEFAULT_LSP_SETTINGS.budgetRatio)
  assert.equal(document.lsp.budgetCapMB, DEFAULT_LSP_SETTINGS.budgetCapMB)
  assert.equal(document.lsp.maxConcurrentIndexes, DEFAULT_LSP_SETTINGS.maxConcurrentIndexes)
  assert.equal(document.lsp.pressureYield, DEFAULT_LSP_SETTINGS.pressureYield)
  assert.deepEqual(document.lsp.workspaceDefaults, {})
  // The old values survive the migration.
  assert.equal(document.lsp.indexOnOpen, 'ask')
})

test('a hand-edited budget is repaired', () => {
  const document = {
    version: 5,
    lsp: { budgetRatio: 'half', budgetCapMB: -1, maxConcurrentIndexes: -3, pressureYield: 'yes' },
  }
  migrateLspSettings(document)
  assert.equal(document.lsp.budgetRatio, DEFAULT_SETTINGS.lsp.budgetRatio)
  assert.equal(document.lsp.budgetCapMB, DEFAULT_SETTINGS.lsp.budgetCapMB)
  assert.equal(document.lsp.maxConcurrentIndexes, DEFAULT_SETTINGS.lsp.maxConcurrentIndexes)
  assert.equal(document.lsp.pressureYield, DEFAULT_SETTINGS.lsp.pressureYield)
})

test('a budget the user chose survives the migration', () => {
  const document = { version: 5, lsp: { budgetRatio: 0.5, budgetCapMB: 2048, maxConcurrentIndexes: 2, pressureYield: false } }
  migrateLspSettings(document)
  assert.equal(document.lsp.budgetRatio, 0.5)
  assert.equal(document.lsp.budgetCapMB, 2048)
  assert.equal(document.lsp.maxConcurrentIndexes, 2)
  assert.equal(document.lsp.pressureYield, false)
})

test('a hand-edited workspace default map is repaired', () => {
  const document = { version: 5, lsp: { workspaceDefaults: 'nonsense' } }
  migrateLspSettings(document)
  assert.deepEqual(document.lsp.workspaceDefaults, {})
})

test('the workspace default map of the user survives the migration', () => {
  const document = { version: 5, lsp: { workspaceDefaults: { 'C:\\work\\demo': 'conservative' } } }
  migrateLspSettings(document)
  assert.deepEqual(document.lsp.workspaceDefaults, { 'C:\\work\\demo': 'conservative' })
})
