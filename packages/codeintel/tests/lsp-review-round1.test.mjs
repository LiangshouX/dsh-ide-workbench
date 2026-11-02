/**
 * The findings of the review round 1 (PRD-v5.1, `docs/prd/v5.1/PRD-v5.1-代码检视报告-第一轮.md`).
 *
 * Five of the six findings are on the client side, and all of them are
 * regressions of this round:
 *
 *   - A2: the host published two fields about the same question (`decision`
 *     and `tight`), and they answered differently for a whole round. The
 *     popup read one of them, the settings page the other - so the same
 *     snapshot was "the user has to decide" on one screen and "may start" on
 *     the other. The client now reads ONE field, and both screens use the
 *     same helper.
 *   - A3: the condition that replaces the mirrored snapshot watched the
 *     available memory only. When a server GROWS, the available memory stays
 *     exactly the same (the free memory drops by Δ and the reservation drops
 *     by Δ too) - so the panel froze on the numbers of the first poll.
 *   - A4: the client and the host read two different markers for "this
 *     project is in the basic mode", in opposite orders. After the user
 *     clicked 【重新建立索引】 the client said "index it" and the host said
 *     "basic mode" - so the server was started once and never woken again.
 *   - A5: the settings page accepted a budget share of 0, and the host falls
 *     back to 0.25 for it: the page showed 0 and the machine used a quarter.
 *   - A6: the comment of `memoryFacts` still described the old semantics of
 *     `reservedBytes` (the ceiling of the running servers instead of the
 *     room they may still grow into).
 *
 * Every case below was red before the fix.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { CodeIntelStore, memoryDecisionOf } from '../src/client/store.js'
import { en } from '../src/client/i18n.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MB = 1024 * 1024

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

/** The bundled settings page (the JSX has to be compiled before it can run). */
async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'review-round1-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
export { SettingsForm } from './src/client/settings.jsx'
export { clampBudgetRatio } from './src/client/settings.jsx'
`,
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'review-round1-entry.jsx',
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

/** Wait for the pending promises of the store. */
const tick = (ms = 10) => new Promise(resolve => { setTimeout(resolve, ms) })

/**
 * A store with one workspace root and one first-level folder.
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
 * The memory snapshot of the host.
 * @param {any} [overrides] the fields that differ
 * @returns {any} the snapshot
 */
function snapshotOf(overrides = {}) {
  return {
    totalBytes: 16 * 1024 * MB,
    freeBytes: 8000 * MB,
    availableBytes: 6386 * MB,
    reservedBytes: 1614 * MB,
    measuredBytes: 434 * MB,
    measuredMB: 434,
    thresholdBytes: 256 * MB,
    hardFloorMB: 256,
    memoryLimitMB: 2048,
    ceilingMB: 2048,
    canIndex: true,
    needMB: 651,
    baselineMB: 434,
    headroom: 1.5,
    decision: 'ok',
    tight: false,
    belowHardFloor: false,
    worstCase: false,
    worstCaseBytes: 4338 * MB,
    budgetBytes: 4096 * MB,
    budgetUsedBytes: 2048 * MB,
    languageId: 'typescript',
    ...overrides,
  }
}

/**
 * One host stub whose memory snapshot can change between two polls.
 * @param {any} store the store the stub belongs to
 * @param {any} [snapshot] the first snapshot
 * @returns {any} the stub
 */
function hostStub(store, snapshot = snapshotOf()) {
  const calls = []
  let current = snapshot
  let document = null
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/').pop()
    const body = init?.body === undefined ? {} : JSON.parse(init.body)
    calls.push({ method, body })
    let value = {}
    if (method === 'lsp.status') {
      value = { enabled: true, state: 'ready', languageId: 'typescript', indexedRoots: [], liveRoots: [], resources: current }
    } else if (method === 'lsp.resources') value = current
    else if (method === 'lsp.start') value = { state: 'starting' }
    else if (method === 'lsp.shutdown') value = { ok: true }
    else if (method === 'settings.update') {
      if (document === null) document = JSON.parse(JSON.stringify(store.state.settings ?? {}))
      const patch = body.patch ?? {}
      document = { ...document, ...patch, lsp: { ...(document.lsp ?? {}), ...(patch.lsp ?? {}) } }
      value = { value: document }
    } else value = { isRepo: false, entries: [], commits: [], shells: [], projects: [] }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  return {
    calls,
    /** The snapshot of the next poll. */
    setSnapshot(next) { current = next },
    restore() { globalThis.fetch = original },
  }
}

/**
 * A store for the settings page: it records the patches the page sends.
 * @returns {any} the store
 */
function panelStore() {
  const patches = []
  return {
    t: key => key,
    patches,
    updateSettings: async patch => { patches.push(patch); return { ok: true } },
    loadLspServers: async () => {},
    loadLspResources: async () => {},
  }
}

/**
 * The state the settings page reads.
 * @param {any} [resources] the memory snapshot of the host
 * @returns {any} the state
 */
function panelState(resources = null) {
  return {
    settings: {
      editor: { fontSize: 13 },
      shortcuts: {},
      lsp: {
        enabled: true,
        indexOnOpen: 'ask',
        memoryLimitMB: 2048,
        memoryHeadroom: 1.5,
        memoryHardFloorMB: 256,
        freeMemoryThresholdMB: 512,
        idleTimeoutMs: 600000,
        requestTimeoutMs: 30000,
        cancelAfterMs: 60000,
        idlePolicy: 'after',
        autoExit: true,
        autoRestart: true,
        servers: {},
        budgetRatio: 0.25,
        budgetCapMB: 4096,
        maxConcurrentIndexes: 0,
        pressureYield: true,
      },
    },
    lsp: { state: 'idle', servers: { available: [], missing: [] }, resources },
    terminal: { shells: [{ id: 'pwsh', label: 'PowerShell' }] },
  }
}

// ── A2: one field for the answer of the host ───────────────────────────────

test('the decision of the host is read from one field', () => {
  // The two fields of the host answered differently for a round: the
  // `decision` carried the worst band, the flag did not. The client reads
  // the `decision` - the authority - and the flag is only the fallback for a
  // host that does not publish it.
  assert.equal(memoryDecisionOf({ decision: 'tight', tight: false }), 'tight')
  assert.equal(memoryDecisionOf({ decision: 'ok', tight: true }), 'ok')
  assert.equal(memoryDecisionOf({ decision: 'low', tight: false }), 'low')
  // An older host: the flag, and then `canIndex`.
  assert.equal(memoryDecisionOf({ tight: true }), 'tight')
  assert.equal(memoryDecisionOf({ canIndex: false }), 'low')
  assert.equal(memoryDecisionOf({}), 'ok')
  assert.equal(memoryDecisionOf(null), 'ok')
})

test('the popup asks the user when the host says the memory is tight', async (t) => {
  const store = fakeStore()
  const host = hostStub(store, snapshotOf({ decision: 'tight', tight: false }))
  t.after(() => {
    host.restore()
  })
  const pending = store.decideIndex(CHILD)
  await tick(20)
  assert.ok(store.state.memoryDecision !== null, 'the user is asked')
  assert.equal(store.state.memoryDecision.needMB, 651)
  store.resolveMemoryDecision('conservative')
  await pending
})

test('the popup does not ask when the host says the memory is enough', async (t) => {
  // The same snapshot in the other direction: the flag says "tight", the
  // authority says "ok". The client follows the authority - the host is
  // going to start the server anyway.
  const store = fakeStore()
  const host = hostStub(store, snapshotOf({ decision: 'ok', tight: true }))
  t.after(() => {
    host.restore()
  })
  const pending = store.decideIndex(CHILD)
  await tick(20)
  assert.equal(store.state.memoryDecision, null, 'the user is not asked about the memory')
  // The index question is a different one - it is asked because the policy
  // says "ask", not because the memory is tight.
  assert.ok(store.state.indexDecision !== null, 'the index question is asked')
  store.resolveIndexDecision('build')
  await pending
  assert.ok(host.calls.some(call => call.method === 'lsp.start'), 'the server starts')
})

test('the settings page says the same word as the popup', async () => {
  const mod = await loadModule()
  // The snapshot of the review: the authority says "tight", the flag says
  // "not tight". The page read the flag and said "can start" while the
  // dialog asked the user to decide.
  const store = panelStore()
  store.t = key => (typeof en[key] === 'string' ? en[key] : key)
  const html = renderToStaticMarkup(React.createElement(mod.SettingsForm, {
    store,
    state: panelState(snapshotOf({ decision: 'tight', tight: false })),
  }))
  assert.match(html, /\(tight\)/, 'the page says the same word as the dialog')
  assert.doesNotMatch(html, /\(can start\)/)
})

test('the settings page shows the worst case of the snapshot', async () => {
  const mod = await loadModule()
  // The worst case is information, not a verdict: the host reports it and
  // never blocks on it. It belongs where the user looks at the live numbers.
  const html = renderToStaticMarkup(React.createElement(mod.SettingsForm, {
    store: panelStore(),
    state: panelState(snapshotOf({ ceilingMB: 2048, worstCaseBytes: -842 * MB })),
  }))
  assert.match(html, /lsp\.diagnostics\.memoryWorstText/)
})

// ── A3: the snapshot is replaced when the server grows ─────────────────────

test('the snapshot is replaced when the server grows', async (t) => {
  // When a server grows, the free memory drops by Δ and the reservation
  // (= ceiling − measured) drops by Δ as well - so the AVAILABLE memory stays
  // exactly the same. A comparison of the available memory alone froze the
  // panel on the numbers of the first poll (review A3).
  const store = fakeStore()
  const first = snapshotOf()
  const host = hostStub(store, first)
  t.after(() => {
    host.restore()
  })
  await store.refreshLspStatus()
  assert.equal(store.state.lsp.resources.measuredBytes, 434 * MB)

  // The server grew by 600 MB: the reservation and the worst case move,
  // the available memory does not.
  host.setSnapshot(snapshotOf({
    freeBytes: 7400 * MB,
    availableBytes: 6386 * MB,
    measuredBytes: 1034 * MB,
    measuredMB: 1034,
    reservedBytes: 1014 * MB,
    worstCaseBytes: 3738 * MB,
  }))
  await store.refreshLspStatus()
  assert.equal(store.state.lsp.resources.measuredBytes, 1034 * MB, 'the measured footprint moved')
  assert.equal(store.state.lsp.resources.reservedBytes, 1014 * MB, 'the reservation moved')
  assert.equal(store.state.lsp.resources.worstCaseBytes, 3738 * MB, 'the worst case moved')
})

test('a snapshot that jitters by a few kilobytes does not replace the old one', async (t) => {
  // The free memory of the machine moves by a few kilobytes on every poll.
  // A byte-level comparison would replace the snapshot every two seconds and
  // wake the whole workbench for a number that did not move.
  const store = fakeStore()
  const host = hostStub(store, snapshotOf())
  t.after(() => {
    host.restore()
  })
  await store.refreshLspStatus()
  const before = store.state.lsp.resources
  host.setSnapshot(snapshotOf({ freeBytes: 8000 * MB + 4096 }))
  await store.refreshLspStatus()
  assert.equal(store.state.lsp.resources, before, 'the snapshot is kept')
})

// ── A4: the rebuild takes the refusal back ─────────────────────────────────

test('the rebuild takes the refusal of the user back', async (t) => {
  // The user once sent this project to the basic mode, and now asked for a
  // language server. The refusal has to go: the host read the memory answer
  // and refused to wake the server, so the semantic features stayed dead
  // after the next idle exit (review A4).
  const store = fakeStore({ memoryWarnedRoots: { [ROOT]: 'conservative' } })
  const host = hostStub(store)
  t.after(() => {
    host.restore()
  })
  await store.restartLsp()
  assert.notEqual(
    store.state.settings.lsp.memoryWarnedRoots[ROOT],
    'conservative',
    'the refusal is gone',
  )
  assert.equal(store.state.settings.lsp.workspaceDefaults[ROOT], 'build', 'the project wants a server')
  const update = host.calls.find(call => call.method === 'settings.update')
  assert.ok(update !== undefined, 'the host is told about it')
  assert.notEqual(
    update.body.patch.lsp.memoryWarnedRoots[ROOT],
    'conservative',
    'and the refusal leaves the document as well',
  )
})

test('a decision of "build" takes the refusal back as well', async (t) => {
  // The index dialog says the same thing as the rebuild button: the user
  // wants a server for this project.
  const store = fakeStore({ memoryWarnedRoots: { [ROOT]: 'conservative' } })
  const host = hostStub(store)
  t.after(() => {
    host.restore()
  })
  const pending = store.decideIndex(CHILD)
  await tick(20)
  store.resolveIndexDecision('build')
  await pending
  assert.notEqual(
    store.state.settings.lsp.memoryWarnedRoots[CHILD],
    'conservative',
    'the refusal is gone',
  )
})

test('a decision of "conservative" keeps the refusal', async (t) => {
  // The other way round: the user wants the basic mode, so the refusal stays
  // - and the two markers say the same thing.
  const store = fakeStore()
  const host = hostStub(store, snapshotOf({ decision: 'tight' }))
  t.after(() => {
    host.restore()
  })
  const pending = store.decideIndex(CHILD)
  await tick(20)
  store.resolveMemoryDecision('conservative')
  await pending
  assert.equal(store.state.settings.lsp.memoryWarnedRoots[CHILD], 'conservative')
  assert.equal(store.state.settings.lsp.workspaceDefaults[CHILD], 'conservative')
})

// ── A5: the budget share may not be zero ───────────────────────────────────

test('the budget share is raised to the smallest share the host accepts', async () => {
  const mod = await loadModule()
  // The host only takes a ratio greater than zero and falls back to 0.25 for
  // anything else: a 0 in the field would be a lie (review A5).
  assert.equal(mod.clampBudgetRatio('0'), 0.05, 'a typed zero is raised')
  assert.equal(mod.clampBudgetRatio('-1'), 0.05, 'a negative share is raised')
  assert.equal(mod.clampBudgetRatio('0.5'), 0.5, 'a valid share survives')
  assert.equal(mod.clampBudgetRatio('2'), 1, 'a share above one is capped')
  assert.equal(mod.clampBudgetRatio(''), 0.25, 'an empty field falls back to the default')
  assert.equal(mod.clampBudgetRatio('nonsense'), 0.25)
})

test('the settings page refuses a budget share of zero', async () => {
  const mod = await loadModule()
  const html = renderToStaticMarkup(React.createElement(mod.SettingsForm, {
    store: panelStore(),
    state: panelState(),
  }))
  assert.match(html, /min="0\.05"/, 'the field does not accept zero any more')
})

// ── A6: the comment of the reservation ─────────────────────────────────────

test('the comment of the reservation describes the new semantics', async () => {
  // The reservation changed with MEM-05: it is the room the running servers
  // may still grow into (ceiling − measured), not their ceiling. The
  // comment is the most visible description of the number (review A6).
  const source = await readFile(join(root, 'src', 'client', 'status.jsx'), 'utf8')
  assert.ok(
    !source.includes('their ceiling, not the memory they actually'),
    'the old description of the reservation is gone',
  )
  assert.ok(source.includes('may STILL GROW INTO'), 'the new one is there')
})
