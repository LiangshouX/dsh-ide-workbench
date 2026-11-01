/**
 * Two holes of the semantic-analysis diagnostics panel.
 *
 * 1. THE MEMORY ROW BLINKS TO A DASH. The panel read the memory snapshot the
 *    client fetched itself (the `lsp.resources` route answers for every root),
 *    and the two-second poll then threw it away: the host carries a snapshot
 *    only when there IS a server ("no server, no estimate"), and the mirror
 *    treated "the host has nothing to say" as "there is nothing". The row
 *    showed the numbers for a moment and then a dash.
 *
 * 2. "USE THE BASIC MODE" DID NOTHING. The button stopped the server on the
 *    host, but it did not record the DECISION: the client session still
 *    believed the project wanted a language server, and the next semantic
 *    request woke it again (IDLE-02). The server came back, and the click
 *    looked like it had never happened.
 *
 * Both are the client's business: the host answers both questions correctly.
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
    const outfile = join(dir, 'diagnostics-memory-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: "export { LspDiagnosticsModal, memoryFacts } from './src/client/Workbench.jsx'",
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'diagnostics-memory-entry.jsx',
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

/**
 * A translator over one locale table.
 * @param {Record<string, string>} table the locale table
 * @returns {(key: string) => string} the translator
 */
function translator(table) {
  return (key) => (typeof table[key] === 'string' ? table[key] : key)
}

/** The project the cases work on. */
const ROOT = 'C:\\work\\demo'

/**
 * A store with one project.
 * @param {object} [lsp] the `lsp` section of the settings
 * @returns {any} the store
 */
function fakeStore(lsp = {}) {
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
    projects: [{ path: ROOT, name: 'demo', isRoot: true, isRepo: false, indexState: 'unknown', indexedAt: null }],
  }
  return store
}

/**
 * One host stub.
 *
 * The `lsp.status` answer carries NO snapshot - that is what the host does
 * when there is no server ("no server, no estimate"), and it is the case in
 * which the memory row used to blink to a dash.
 * @param {any} store the store the stub belongs to
 * @returns {any} the stub
 */
function hostStub(store) {
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
        freeBytes: 2648 * 1024 * 1024,
        availableBytes: 1206 * 1024 * 1024,
        thresholdBytes: 256 * 1024 * 1024,
        hardFloorMB: 256,
        canIndex: true,
        decision: 'ok',
        tight: false,
        needMB: 651,
        languageId: 'typescript',
      }
    } else if (method === 'lsp.status') {
      // The host has no server for this root: no snapshot travels with it.
      value = { enabled: true, state: 'idle', languageId: '', serverId: '', source: null, detail: null, indexedRoots: [], liveRoots: [] }
    } else if (method === 'lsp.index') value = { state: 'idle', progress: '', startedAt: 0, cancellable: false }
    else if (method === 'lsp.servers') value = { available: [], missing: [] }
    else if (method === 'settings.update') {
      if (document === null) {
        const settings = JSON.parse(JSON.stringify(store.state.settings ?? {}))
        document = { editor: {}, shortcuts: {}, ...settings, lsp: { enabled: true, indexOnOpen: 'ask', workspaceDefaults: {}, ...(settings.lsp ?? {}) } }
      }
      const patch = body.patch ?? {}
      document = { ...document, ...patch, lsp: { ...(document.lsp ?? {}), ...(patch.lsp ?? {}) } }
      value = { value: document }
    } else value = { shells: [], names: [], messages: [] }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  return {
    calls,
    methods: () => calls.map(call => call.method),
    updates: () => calls.filter(call => call.method === 'settings.update'),
    restore() { globalThis.fetch = original },
  }
}

/** Release the timers a test may have armed. */
function cleanup(store) {
  if (store.toastTimer !== null) clearTimeout(store.toastTimer)
  store.persist.cancel()
}

// ── the memory row of the diagnostics panel ─────────────────────────────────

test('the memory snapshot survives a poll that carries none', async (t) => {
  // The panel fetched the snapshot itself when it opened. The poll that
  // follows carries none - the host has no server - and the mirror threw the
  // numbers away, so the row blinked to a dash.
  const store = fakeStore()
  const host = hostStub(store)
  t.after(() => {
    cleanup(store)
    host.restore()
  })

  await store.loadLspResources()
  assert.ok(store.state.lsp.resources !== null, 'the panel has the numbers')

  await store.refreshLspStatus()
  assert.ok(
    store.state.lsp.resources !== null,
    'a poll without a snapshot must not throw the numbers away',
  )
  assert.equal(store.state.lsp.resources.needMB, 651, 'the numbers are still the ones of the host')
})

test('the memory row of the panel shows the numbers after the poll', async () => {
  const { LspDiagnosticsModal, memoryFacts } = await loadModule()
  const store = fakeStore()
  const host = hostStub(store)
  try {
    await store.loadLspResources()
    await store.refreshLspStatus()
    const resources = store.state.lsp.resources
    assert.ok(resources !== null, 'the store still has the snapshot')

    const facts = memoryFacts(store, resources)
    assert.notEqual(facts.text, '—', 'the row has numbers, not a dash')

    const html = renderToStaticMarkup(React.createElement(LspDiagnosticsModal, {
      store: { ...store, t: translator(en) },
      state: { lsp: { ...store.state.lsp, state: 'idle', detail: '' }, settings: { lsp: { enabled: true } } },
      onOpenSettings: () => {},
      onClose: () => {},
    }))
    assert.match(html, /1206/, 'the available memory is in the panel')
    assert.doesNotMatch(html, /可用<\/span><\/div><div[^>]*>—/, 'the row is not a dash')
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('a poll that carries a snapshot still updates the numbers', async (t) => {
  // The mirror is not "frozen": a snapshot that arrives replaces the old one.
  const store = fakeStore()
  const host = hostStub(store)
  t.after(() => {
    cleanup(store)
    host.restore()
  })
  await store.loadLspResources()
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/').pop()
    if (method !== 'lsp.status') return original(url, init)
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          value: {
            enabled: true, state: 'ready', languageId: 'typescript', serverId: '', source: null,
            detail: null, indexedRoots: [], liveRoots: [],
            resources: {
              freeBytes: 2648 * 1024 * 1024,
              availableBytes: 999 * 1024 * 1024,
              needMB: 651,
              canIndex: true,
              tight: false,
            },
          },
        }
      },
    }
  }
  await store.refreshLspStatus()
  assert.equal(
    Math.round((store.state.lsp.resources?.availableBytes ?? 0) / (1024 * 1024)),
    999,
    'the newer snapshot replaced the older one',
  )
})

// ── the "use the basic mode" button ────────────────────────────────────────

test('"use the basic mode" puts the project into the basic mode', async (t) => {
  const store = fakeStore()
  const host = hostStub(store)
  t.after(() => {
    cleanup(store)
    host.restore()
  })

  await store.degradeLsp()

  assert.ok(host.methods().includes('lsp.shutdown'), 'the host was told to stop the server')
  assert.equal(
    store.lspIndexDecision(ROOT),
    'conservative',
    'the project stays in the basic mode - otherwise the next request wakes the server again',
  )
})

test('"use the basic mode" is remembered over a workspace switch and a restart', async (t) => {
  const store = fakeStore()
  const host = hostStub(store)
  t.after(() => {
    cleanup(store)
    host.restore()
  })

  await store.degradeLsp()
  assert.equal(
    store.state.settings.lsp.workspaceDefaults[ROOT],
    'conservative',
    'the decision of the user is written to the document',
  )
  const update = host.updates().find(call => call.body.patch?.lsp?.workspaceDefaults !== undefined)
  assert.ok(update !== undefined, 'the host is told about the decision')
  assert.equal(update.body.patch.lsp.workspaceDefaults[ROOT], 'conservative')

  // A new store reads the document of the old one: the decision is not lost
  // when the store is evicted, and not lost when DSH is restarted.
  const restored = fakeStore({ workspaceDefaults: { [ROOT]: 'conservative' } })
  assert.equal(restored.lspIndexDecision(ROOT), 'conservative')
})

test('the basic mode of the user outranks the "always index" policy', async (t) => {
  const store = fakeStore({ indexOnOpen: 'always' })
  const host = hostStub(store)
  t.after(() => {
    cleanup(store)
    host.restore()
  })

  await store.degradeLsp()
  assert.equal(store.lspIndexDecision(ROOT), 'conservative', 'the policy does not index it behind their back')
})

test('"rebuild the index" is the way back out of the basic mode', async (t) => {
  const store = fakeStore({ workspaceDefaults: { [ROOT]: 'conservative' } })
  const host = hostStub(store)
  t.after(() => {
    cleanup(store)
    host.restore()
  })

  await store.restartLsp()
  assert.equal(store.lspIndexDecision(ROOT), 'build', 'the user asked for a server')
  assert.equal(store.state.settings.lsp.workspaceDefaults[ROOT], 'build', 'and the document says so')
})
