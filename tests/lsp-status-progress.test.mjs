/**
 * The status bar must leave "updating the index" when the build is over.
 *
 * The store mirrors the host's language-server state and copies the previous
 * snapshot over the next one. `progress` came from `lsp.index` while a build
 * ran, and it was never cleared: once the server reached "ready", the stale
 * value kept the status bar at "正在更新索引…" for good. A repository that was
 * already indexed looked stuck.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { WorkbenchStore } from '../src/client/store.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The workbench bundle touches browser globals at import time.
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

let modulePromise

async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'lsp-status-progress-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `export { lspStatusView } from './src/client/Workbench.jsx'\n`,
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'lsp-status-progress-entry.jsx',
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

/** A store whose root is set and whose settings carry the lsp section. */
function fakeStore() {
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new WorkbenchStore(ctx, key => key)
  store.state = {
    ...store.state,
    workspaceRoot: ROOT,
    root: ROOT,
    phase: 'ready',
    settings: { editor: {}, shortcuts: {}, lsp: { enabled: true } },
  }
  return store
}

/**
 * Install a fetch mock that answers the language-server endpoints.
 * @param {{ status: object, index?: object }} answers the host answers
 * @param {Array<object>} calls the recorded calls
 * @returns {() => void} the restore function
 */
function mockFetch(answers, calls) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/ide-workbench/api/')[1]
    calls.push({ method, body: JSON.parse(init.body) })
    const value = method === 'lsp.status'
      ? answers.status
      : method === 'lsp.index'
        ? (answers.index ?? { state: 'idle', progress: '', startedAt: 0, cancellable: false })
        : method === 'lsp.servers'
          ? { available: [], missing: [] }
          : { value: {} }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  return () => { globalThis.fetch = original }
}

test('the progress of a build is cleared once the server is ready', async () => {
  const store = fakeStore()
  const calls = []
  // First answer: a build is running. Second: it is done.
  const restore = mockFetch({
    status: { enabled: true, state: 'building', languageId: 'typescript', indexedRoots: [] },
    index: { state: 'building', progress: 'building', startedAt: 1700000000000, cancellable: true },
  }, calls)
  try {
    await store.refreshLspStatus()
    assert.equal(store.state.lsp.state, 'building')
    assert.equal(store.state.lsp.progress, 'building', 'the build reports its progress')
    assert.equal(store.state.lsp.cancellable, true)
  } finally {
    restore()
  }

  const restore2 = mockFetch({
    status: { enabled: true, state: 'ready', languageId: 'typescript', indexedRoots: [ROOT] },
  }, calls)
  try {
    await store.refreshLspStatus()
    assert.equal(store.state.lsp.state, 'ready')
    assert.equal(store.state.lsp.progress, '', 'the progress of the finished build is gone')
    assert.equal(store.state.lsp.startedAt, 0, 'the start time of the finished build is gone')
    assert.equal(store.state.lsp.cancellable, false, 'the cancel button is gone')
  } finally {
    restore2()
  }
})

test('a ready server is shown as ready, never as "updating"', async () => {
  const mod = await loadModule()
  const t = key => key
  // A stale progress value must not change the label of a ready server.
  const view = mod.lspStatusView({ t }, {
    lsp: { enabled: true, state: 'ready', progress: 'building', languageId: 'typescript' },
    settings: { lsp: { enabled: true } },
  })
  assert.equal(view.key, 'ready')
  assert.equal(view.text, 'lsp.status.ready')
  assert.equal(view.tone, 'ok')
})

test('a finished build leaves the status bar at "ready"', async () => {
  const store = fakeStore()
  const calls = []
  const mod = await loadModule()
  const restore = mockFetch({
    status: { enabled: true, state: 'building', languageId: 'typescript', indexedRoots: [] },
    index: { state: 'building', progress: 'building', startedAt: 1700000000000, cancellable: true },
  }, calls)
  try {
    await store.refreshLspStatus()
  } finally {
    restore()
  }
  const restore2 = mockFetch({
    status: { enabled: true, state: 'ready', languageId: 'typescript', indexedRoots: [ROOT] },
  }, calls)
  try {
    await store.refreshLspStatus()
  } finally {
    restore2()
  }
  const view = mod.lspStatusView({ t: key => key }, { lsp: store.state.lsp, settings: store.state.settings })
  assert.equal(view.key, 'ready', 'the status bar left the build')
  assert.equal(view.text, 'lsp.status.ready')
})

test('a running build still shows the build', async () => {
  const store = fakeStore()
  const calls = []
  const mod = await loadModule()
  const restore = mockFetch({
    status: { enabled: true, state: 'building', languageId: 'typescript', indexedRoots: [] },
    index: { state: 'building', progress: 'building', startedAt: 1700000000000, cancellable: false },
  }, calls)
  try {
    await store.refreshLspStatus()
  } finally {
    restore()
  }
  const view = mod.lspStatusView({ t: key => key }, { lsp: store.state.lsp, settings: store.state.settings })
  assert.equal(view.key, 'building')
  assert.equal(view.text, 'lsp.status.building')
  assert.equal(view.tone, 'warn')
})
