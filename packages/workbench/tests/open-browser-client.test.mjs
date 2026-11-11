/**
 * R11 - the client side of "open in the default browser".
 *
 * Two rules live in the editor area:
 * - a document with unsaved edits is not handed to the browser (the browser
 *   reads the file from disk), and the refusal is a message;
 * - the sidebar preview asks the host's registry which viewers can take the
 *   address instead of naming one viewer.
 *
 * The actions are exported so the rules can be checked without a browser.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// The workspace hoists the packages to the root of the repository: the
// terminal stylesheet is resolved, not guessed.
const moduleRequire = createRequire(import.meta.url)

// The bundle touches browser globals at import time; the actions themselves
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
  createRange: () => ({ style: {}, remove() {} }),
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

async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'open-browser-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
export { openInDefaultBrowserAction, openInSidebarPreviewAction } from './src/client/EditorArea.jsx'
`,
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'open-browser-entry.jsx',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: ['node20'],
      external: ['react', 'react-dom', 'react-dom/server', '@deepseek-ai/dsh-client-ui-primitives'],
      alias: {
        '@xterm/xterm/css/xterm.css': moduleRequire.resolve('@xterm/xterm/css/xterm.css'),
        '@xterm/xterm': join(root, 'tests/stubs/xterm.js'),
        '@xterm/addon-fit': join(root, 'tests/stubs/addon-fit.js'),
        'virtual:pdf-worker': join(root, 'tests/stubs/pdf-worker.js'),
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

/**
 * A store that records what the actions ask of it.
 * @param {{dirty?: boolean, candidates?: Array<{kind: string}>}} [options]
 */
function fakeStore({ dirty = false, candidates = [] } = {}) {
  const toasts = []
  const opened = []
  const sidebarOpened = []
  const resources = []
  const ctx = {
    sidebarRightTabs: { candidates: () => candidates },
    sidebarRight: {
      mounted: { getSnapshot: () => 'session-1' },
      openResource: (address, options) => { resources.push({ address, options }) },
    },
  }
  const store = {
    ctx,
    t: (key) => key,
    state: { workspaceRoot: 'C:\\work\\demo' },
    toast: (kind, text, detail) => { toasts.push({ kind, text, detail }) },
    isPathDirty: () => dirty,
    openInDefaultBrowser: (path) => { opened.push(path); return Promise.resolve(true) },
    openInSidebar: (path) => { sidebarOpened.push(path); return true },
  }
  return { store, toasts, opened, sidebarOpened, resources }
}

const HTML_TAB = { id: 'file:index.html', kind: 'file', path: 'C:\\work\\demo\\index.html', rel: 'index.html', name: 'index.html', dirty: false }

test('a saved document is handed to the default browser', async () => {
  const mod = await loadModule()
  const { store, toasts, opened } = fakeStore()
  mod.openInDefaultBrowserAction(store, HTML_TAB)()
  assert.deepEqual(opened, ['C:\\work\\demo\\index.html'])
  assert.deepEqual(toasts, [])
})

test('a document with unsaved edits is not opened, and the user is told', async () => {
  const mod = await loadModule()
  const { store, toasts, opened } = fakeStore({ dirty: true })
  mod.openInDefaultBrowserAction(store, { ...HTML_TAB, dirty: true })()
  assert.deepEqual(opened, [], 'the browser is not asked to open an unsaved buffer')
  assert.equal(toasts.length, 1)
  assert.equal(toasts[0].kind, 'error')
  assert.equal(toasts[0].text, 'browser.unsavedChanges')
})

test('the sidebar preview asks the registry which viewer can take the address', async () => {
  const mod = await loadModule()
  const { store, resources, sidebarOpened } = fakeStore({
    candidates: [{ kind: 'html' }, { kind: 'ide-workbench' }],
  })
  mod.openInSidebarPreviewAction(store, HTML_TAB)()
  assert.equal(resources.length, 1, 'the probed viewer opens the document')
  assert.equal(resources[0].options.kind, 'html')
  assert.match(resources[0].address, /^dsh-resource:\/\/file\/session\/session-1\//)
  assert.deepEqual(sidebarOpened, [], 'the store fallback is not needed')
})

test('the sidebar preview falls back to the store when no viewer is ranked', async () => {
  const mod = await loadModule()
  const { store, resources, sidebarOpened } = fakeStore({ candidates: [] })
  mod.openInSidebarPreviewAction(store, HTML_TAB)()
  assert.deepEqual(resources, [])
  assert.deepEqual(sidebarOpened, ['C:\\work\\demo\\index.html'])
})
