/**
 * The index decision matrix of PRD-v5 §2.3.
 *
 * The store owns the decision (it knows the index state, the settings and the
 * free memory); the dialog only renders it and forwards the answer. Both
 * halves are covered here: the matrix runs against the store, the wording and
 * the buttons run against the rendered workbench.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { WorkbenchStore } from '../src/client/store.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The bundle touches browser globals at import time; the decision flow itself
// never reads the DOM.
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
  value: { clipboard: { writeText: async () => {}, readText: async () => '' } },
})
globalThis.ResizeObserver = class { observe() {} disconnect() {} }

let modulePromise

async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    // The bundle must live inside the package so Node resolves react and
    // react-dom from this package's node_modules (externalized below).
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'idx-decision-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
export { Workbench } from './src/client/Workbench.jsx'
export { lspStatusView } from './src/client/Workbench.jsx'
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
    const imported = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
    return imported
  })()
  return modulePromise
}

const ROOT = 'C:\\work\\demo'
const CHILD = 'C:\\work\\demo\\api'

/**
 * One host stub: every plugin route answers with a fixture, and the calls are
 * recorded so the test can see which route was asked.
 * @param {{canIndex?: boolean, lspState?: string, lspDetail?: string}} [options]
 */
function hostStub(options = {}) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/').pop()
    const body = init?.body === undefined ? {} : JSON.parse(init.body)
    calls.push({ method, body })
    let value = {}
    if (method === 'lsp.resources') {
      value = {
        totalBytes: 16 * 1024 * 1024 * 1024,
        freeBytes: 8 * 1024 * 1024 * 1024,
        thresholdBytes: 2 * 1024 * 1024 * 1024,
        memoryLimitBytes: 2 * 1024 * 1024 * 1024,
        canIndex: options.canIndex !== false,
      }
    } else if (method === 'lsp.start') value = { state: 'starting' }
    else if (method === 'lsp.status') {
      value = {
        enabled: true,
        state: options.lspState ?? 'idle',
        languageId: options.lspLanguageId ?? '',
        serverId: '',
        source: null,
        detail: options.lspDetail ?? null,
        indexedRoots: [],
      }
    } else if (method === 'lsp.index') value = { state: 'idle', progress: '', startedAt: 0, cancellable: false }
    else if (method === 'lsp.servers') value = { available: [], missing: [] }
    else if (method === 'workspace.projects') value = { workspace: body.root, projects: [] }
    else if (method === 'git.status') value = { isRepo: false, entries: [], detached: false }
    else if (method === 'git.log') value = { commits: [], hasMore: false }
    else if (method === 'fs.tree') value = { entries: [], truncated: false }
    else if (method === 'settings.update') value = { value: {} }
    else value = { shells: [], names: [], messages: [] }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  return {
    calls,
    methods: () => calls.map(call => call.method),
    restore() { globalThis.fetch = original },
  }
}

/**
 * A store with one workspace root and one first-level folder.
 * @param {{root?: object, child?: object}} [overrides] per-project overrides
 * @param {object} [lspSettings] the `lsp` section of the settings
 */
function fakeStore(overrides = {}, lspSettings = {}) {
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
      lsp: {
        enabled: true,
        indexOnOpen: 'ask',
        memoryLimitMB: 2048,
        freeMemoryThresholdMB: 2048,
        cancelAfterMs: 60000,
        indexedRoots: {},
        ...lspSettings,
      },
    },
    projects: [
      {
        path: ROOT, name: 'demo', isRoot: true, isRepo: false, indexState: 'unknown', indexedAt: null,
        ...overrides.root,
      },
      {
        path: CHILD, name: 'api', isRoot: false, isRepo: true, indexState: 'unknown', indexedAt: null,
        ...overrides.child,
      },
    ],
  }
  return store
}

/** Let the pending promise chain of the store settle. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

/** Release the timers a test may have armed. */
function cleanup(store) {
  if (store.toastTimer !== null) clearTimeout(store.toastTimer)
  store.persist.cancel()
}

// ── the matrix (PRD-v5 §2.3) ─────────────────────────────────────────────

test('an unindexed sub-directory asks before it builds an index', async () => {
  const host = hostStub()
  const store = fakeStore()
  try {
    const pending = store.selectProject(CHILD)
    await flush()
    // The dialog is open, and the project did not change yet.
    assert.ok(store.state.indexDecision !== null)
    assert.equal(store.state.indexDecision.path, CHILD)
    assert.equal(store.state.indexDecision.isRoot, false)
    assert.equal(store.state.root, ROOT)
    // Nothing was started behind the dialog.
    assert.ok(!host.methods().includes('lsp.start'))
    // The answer closes the flow; the cancel is checked in its own test.
    store.resolveIndexDecision('cancel')
    await pending
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('building the index switches the project and starts the language server', async () => {
  const host = hostStub()
  const store = fakeStore()
  try {
    const pending = store.selectProject(CHILD)
    await flush()
    store.resolveIndexDecision('build')
    await pending
    assert.equal(store.state.root, CHILD)
    assert.ok(host.methods().includes('lsp.start'))
    assert.equal(store.state.indexDecision, null)
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('cancelling the index decision keeps the current project', async () => {
  const host = hostStub()
  const store = fakeStore()
  try {
    const pending = store.selectProject(CHILD)
    await flush()
    store.resolveIndexDecision('cancel')
    await pending
    // No switch, no server: the cancel means "do not touch anything".
    assert.equal(store.state.root, ROOT)
    assert.ok(!host.methods().includes('lsp.start'))
    assert.equal(store.state.indexDecision, null)
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('the conservative mode switches the project without a language server', async () => {
  const host = hostStub()
  const store = fakeStore()
  try {
    const pending = store.selectProject(CHILD)
    await flush()
    store.resolveIndexDecision('conservative')
    await pending
    assert.equal(store.state.root, CHILD)
    assert.ok(!host.methods().includes('lsp.start'))
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('an indexed folder is opened without a question', async () => {
  const host = hostStub()
  const store = fakeStore({ child: { indexState: 'indexed', indexedAt: 1700000000000 } })
  try {
    const pending = store.selectProject(CHILD)
    await flush()
    // No dialog at all: the indexed path has no extra step (risk #26).
    assert.equal(store.state.indexDecision, null)
    await pending
    assert.equal(store.state.root, CHILD)
    assert.ok(host.methods().includes('lsp.start'))
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('the profile settings also mark a folder as indexed', async () => {
  const host = hostStub()
  const store = fakeStore({}, { indexedRoots: { [CHILD]: { at: 1700000000000, languageId: 'typescript' } } })
  try {
    const pending = store.selectProject(CHILD)
    await flush()
    assert.equal(store.state.indexDecision, null)
    await pending
    assert.equal(store.state.root, CHILD)
    assert.ok(host.methods().includes('lsp.start'))
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('a machine without enough memory degrades without a question', async () => {
  const host = hostStub({ canIndex: false })
  const store = fakeStore()
  try {
    await store.selectProject(CHILD)
    // No dialog: every answer would fail the same way (PRD-v5 §2.2).
    assert.equal(store.state.indexDecision, null)
    assert.equal(store.state.root, CHILD)
    assert.ok(!host.methods().includes('lsp.start'))
    // The hint names the numbers and what the user can do about it.
    assert.match(store.state.toast?.text ?? '', /lsp\.lowMemory/)
    assert.match(store.state.toast?.detail ?? '', /lsp\.lowMemoryHint/)
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('the "never index" policy keeps the conservative mode without a question', async () => {
  const host = hostStub()
  const store = fakeStore({}, { indexOnOpen: 'never' })
  try {
    await store.selectProject(CHILD)
    assert.equal(store.state.indexDecision, null)
    assert.equal(store.state.root, CHILD)
    assert.ok(!host.methods().includes('lsp.start'))
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('the "always index" policy builds the index without a question', async () => {
  const host = hostStub()
  const store = fakeStore({}, { indexOnOpen: 'always' })
  try {
    await store.selectProject(CHILD)
    assert.equal(store.state.indexDecision, null)
    assert.equal(store.state.root, CHILD)
    assert.ok(host.methods().includes('lsp.start'))
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('a disabled semantic analysis never starts a language server', async () => {
  const host = hostStub()
  const store = fakeStore({}, { enabled: false })
  try {
    await store.selectProject(CHILD)
    assert.equal(store.state.indexDecision, null)
    assert.equal(store.state.root, CHILD)
    assert.ok(!host.methods().includes('lsp.start'))
  } finally {
    cleanup(store)
    host.restore()
  }
})

// ── the dialog (PRD-v5 §2.3, §7) ──────────────────────────────────────────

/**
 * The rendered index decision dialog.
 * @param {object} mod the bundled workbench
 * @param {object} decision the pending decision
 * @returns {string} the markup of the workbench
 */
function decisionHtml(mod, decision) {
  const store = fakeStore()
  store.state.indexDecision = decision
  return renderToStaticMarkup(React.createElement(mod.Workbench, { store }))
}

/** The buttons of the decision dialog. */
function decisionButtons(html) {
  const start = html.indexOf('iwb-index-decision')
  assert.notEqual(start, -1, 'the decision dialog is not rendered')
  const modal = html.slice(start)
  return modal.match(/<button[^>]*>/g) ?? []
}

test('the dialog of an unindexed sub-directory offers build and basic mode', async () => {
  const mod = await loadModule()
  const html = decisionHtml(mod, { path: CHILD, name: 'api', isRoot: false, isRepo: true })
  assert.match(html, /index\.decision\.title/)
  assert.match(html, /index\.decision\.body/)
  assert.match(html, /index\.decision\.build/)
  assert.match(html, /index\.decision\.conservative/)
  // A sub-directory needs no root warning and no cancel button.
  assert.doesNotMatch(html, /index\.decision\.rootWarning/)
  assert.doesNotMatch(html, /index\.decision\.rootRepo/)
  assert.doesNotMatch(html, /index\.decision\.buildRoot/)
  assert.doesNotMatch(html, /index\.decision\.cancel/)
  // Both buttons are usable.
  const buttons = decisionButtons(html)
  assert.equal(buttons.length, 2)
  for (const button of buttons) assert.ok(!button.includes('disabled'))
})

test('the dialog of a workspace root that is not a repository carries the full warning', async () => {
  const mod = await loadModule()
  const html = decisionHtml(mod, { path: ROOT, name: 'demo', isRoot: true, isRepo: false })
  assert.match(html, /index\.decision\.rootTitle/)
  assert.match(html, /index\.decision\.rootWarning/)
  // The downgraded wording of a real repository is not used here.
  assert.doesNotMatch(html, /index\.decision\.rootRepo/)
  // Three buttons: index here, basic mode, cancel.
  assert.match(html, /index\.decision\.buildRoot/)
  assert.match(html, /index\.decision\.conservative/)
  assert.match(html, /index\.decision\.cancel/)
  const buttons = decisionButtons(html)
  assert.equal(buttons.length, 3)
  for (const button of buttons) assert.ok(!button.includes('disabled'))
})

test('the dialog of a workspace root that is a repository uses the milder warning', async () => {
  const mod = await loadModule()
  const html = decisionHtml(mod, { path: ROOT, name: 'demo', isRoot: true, isRepo: true })
  assert.match(html, /index\.decision\.rootTitle/)
  assert.match(html, /index\.decision\.rootRepo/)
  assert.doesNotMatch(html, /index\.decision\.rootWarning/)
  assert.match(html, /index\.decision\.buildRoot/)
  assert.match(html, /index\.decision\.conservative/)
  assert.match(html, /index\.decision\.cancel/)
  const buttons = decisionButtons(html)
  assert.equal(buttons.length, 3)
})

test('the decision dialog is a modal, and Escape means cancel', async () => {
  const mod = await loadModule()
  const html = decisionHtml(mod, { path: CHILD, name: 'api', isRoot: false, isRepo: true })
  // A real modal: it takes the focus and blocks the surface below it.
  assert.match(html, /iwb-modal-backdrop/)
  assert.match(html, /role="dialog"/)
  assert.match(html, /aria-modal="true"/)
  // The Escape key and the backdrop both resolve as "cancel", which leaves
  // the project untouched (the store test above proves the effect).
  const source = await readFile(join(root, 'src/client/Workbench.jsx'), 'utf8')
  assert.match(source, /event\.key !== 'Escape'/)
  assert.match(source, /resolveIndexDecision\('cancel'\)/)
})

// ── the indexed badge (PRD-v5 §2.1) ───────────────────────────────────────

test('the project picker marks an indexed folder with its own badge', async () => {
  const mod = await loadModule()
  const store = fakeStore({ child: { indexState: 'indexed', indexedAt: 1700000000000 } })
  store.state.projectPicker = true
  // The folder is a repository, it was indexed and it is the current one:
  // all three badges sit on the same row.
  store.state.root = CHILD
  const html = renderToStaticMarkup(React.createElement(mod.Workbench, { store }))
  assert.match(html, /iwb-project-index-badge/)
  assert.match(html, /project\.indexed/)
  // The tooltip says what the badge really means.
  assert.match(html, /title="project\.indexedHint"/)
  // The badge order is fixed: [Git] → [Indexed] → [Current].
  const git = html.indexOf('iwb-project-repo-badge')
  const indexed = html.indexOf('iwb-project-index-badge')
  const current = html.indexOf('iwb-project-current-badge')
  assert.ok(git >= 0 && indexed > git && current > indexed, 'the three badges keep their order')
})

test('a folder that was never indexed carries no badge', async () => {
  const mod = await loadModule()
  const store = fakeStore()
  store.state.projectPicker = true
  const html = renderToStaticMarkup(React.createElement(mod.Workbench, { store }))
  assert.doesNotMatch(html, /iwb-project-index-badge/)
})

// ── the status bar (PRD-v5 §4.3, §2.4) ───────────────────────────────────

test('the status bar names the seven semantic-analysis states', async () => {
  const mod = await loadModule()
  const store = fakeStore()
  const view = state => mod.lspStatusView(store, { ...store.state, lsp: { ...store.state.lsp, ...state } })
  const cases = [
    [{ enabled: false, state: 'disabled' }, 'lsp.status.disabled', 'idle'],
    [{ enabled: true, state: 'starting' }, 'lsp.status.starting', 'idle'],
    [{ enabled: true, state: 'building' }, 'lsp.status.building', 'warn'],
    [{ enabled: true, state: 'ready' }, 'lsp.status.ready', 'ok'],
    [{ enabled: true, state: 'degraded' }, 'lsp.status.degraded', 'idle'],
    [{ enabled: true, state: 'crashed' }, 'lsp.status.crashed', 'error'],
    [{ enabled: true, state: 'cancelled' }, 'lsp.status.cancelled', 'idle'],
  ]
  for (const [lsp, text, tone] of cases) {
    const result = view(lsp)
    assert.equal(result.text, text)
    assert.equal(result.tone, tone)
  }
  // A language without a server is named in the status.
  const missing = mod.lspStatusView(store, {
    ...store.state,
    lsp: {
      ...store.state.lsp,
      state: 'degraded',
      languageId: 'python',
      servers: { available: [], missing: [{ languageId: 'python', command: 'pyright', hint: 'install it' }] },
    },
  })
  assert.equal(missing.key, 'missing')
  assert.equal(missing.text, 'lsp.status.missing')
  assert.equal(missing.action, 'settings')
})

test('the status bar offers the cancel button only for a long build', async () => {
  const mod = await loadModule()
  const store = fakeStore()
  const html = state => {
    const fresh = fakeStore()
    fresh.state.lsp = { ...fresh.state.lsp, ...state }
    return renderToStaticMarkup(React.createElement(mod.Workbench, { store: fresh }))
  }
  // A build that just started: no button yet.
  assert.doesNotMatch(html({ state: 'building', startedAt: Date.now() }), /iwb-lsp-cancel/)
  // A build that runs longer than the patience: the button is there.
  assert.match(html({ state: 'building', startedAt: Date.now() - 120000 }), /iwb-lsp-cancel/)
  // No build at all: no button.
  assert.doesNotMatch(html({ state: 'ready', startedAt: Date.now() - 120000 }), /iwb-lsp-cancel/)
})

test('a crash is announced once, not on every poll', async () => {
  const host = hostStub({ lspState: 'crashed', lspDetail: 'the server exited' })
  const store = fakeStore()
  try {
    await store.refreshLspStatus()
    assert.equal(store.state.lsp.state, 'crashed')
    assert.match(store.state.toast?.text ?? '', /lsp\.crashedToast/)
    // The next poll repeats the state, but the toast must not repeat.
    store.set({ toast: null })
    await store.refreshLspStatus()
    assert.equal(store.state.toast, null)
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('the degraded state explains itself in the tooltip', async () => {
  const mod = await loadModule()
  const store = fakeStore()
  const result = mod.lspStatusView(store, {
    ...store.state,
    lsp: { ...store.state.lsp, state: 'degraded', detail: 'the server does not support this' },
  })
  assert.equal(result.text, 'lsp.status.degraded')
  assert.equal(result.detail, 'the server does not support this')
})
