import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The bundle touches browser globals at import time; the shortcut handler
// itself never reads the DOM.
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
    const outfile = join(dir, 'shortcuts-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
export { createEditorKeyHandler } from './src/client/EditorArea.jsx'
export { editorKeymap } from './src/client/CodeEditor.jsx'
export { defaultKeymap, historyKeymap } from '@codemirror/commands'
`,
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'shortcuts-entry.jsx',
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

/** A keyboard event stub that records whether the handler consumed it. */
function keyEvent(init) {
  return {
    key: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    prevented: 0,
    stopped: 0,
    preventDefault() { this.prevented += 1 },
    stopPropagation() { this.stopped += 1 },
    ...init,
  }
}

/** The document-area handler wired to a recording store. */
function makeHandler(createEditorKeyHandler, overrides = {}) {
  const calls = []
  const store = {
    state: { active: true },
    t: key => key,
    openSearchTab() { calls.push('openSearchTab') },
  }
  const handler = createEditorKeyHandler(store, {
    textTab: true,
    previewTab: false,
    findOpenRef: { current: false },
    previewFindRef: { current: false },
    editorApi: null,
    setFindOpen: value => calls.push(`findOpen:${value}`),
    setPreviewFind: value => calls.push(`previewFind:${value}`),
    ...overrides,
  })
  return { handler, calls }
}

test('Ctrl+Shift+R opens the global Find in Files view', async () => {
  const mod = await loadModule()
  const { handler, calls } = makeHandler(mod.createEditorKeyHandler)
  const event = keyEvent({ key: 'R', ctrlKey: true, shiftKey: true })
  handler(event)
  assert.deepEqual(calls, ['openSearchTab'])
  assert.equal(event.prevented, 1)
})

test('Ctrl+Shift+F no longer opens the global Find in Files view', async () => {
  const mod = await loadModule()
  const { handler, calls } = makeHandler(mod.createEditorKeyHandler)
  const event = keyEvent({ key: 'F', ctrlKey: true, shiftKey: true })
  handler(event)
  assert.deepEqual(calls, [])
  assert.equal(event.prevented, 0)
})

test('bare Ctrl+F stays the in-file find', async () => {
  const mod = await loadModule()
  const { handler, calls } = makeHandler(mod.createEditorKeyHandler)
  const event = keyEvent({ key: 'f', ctrlKey: true })
  handler(event)
  assert.deepEqual(calls, ['findOpen:true'])
  assert.equal(event.prevented, 1)
})

test('Ctrl+Alt+F stays the documented fallback alias', async () => {
  const mod = await loadModule()
  const { handler, calls } = makeHandler(mod.createEditorKeyHandler)
  const event = keyEvent({ key: 'f', ctrlKey: true, altKey: true })
  handler(event)
  assert.deepEqual(calls, ['openSearchTab'])
  assert.equal(event.prevented, 1)
})

test('the global find shortcut is ignored inside the Find in Files view', async () => {
  const mod = await loadModule()
  const target = new globalThis.HTMLElement()
  target.closest = selector => (selector === '.iwb-search' ? { tagName: 'DIV' } : null)
  const { handler, calls } = makeHandler(mod.createEditorKeyHandler)
  const event = keyEvent({ key: 'R', ctrlKey: true, shiftKey: true, target })
  handler(event)
  assert.deepEqual(calls, [])
  assert.equal(event.prevented, 0)
})

/**
 * The keymap of the editor buffer, with the callbacks it would call.
 * @returns {{entries: Array<object>, calls: Array<string>}} the entries and the calls they made
 */
function editorKeymapFixture(mod) {
  const calls = []
  const entries = mod.editorKeymap({
    onSaveRef: { current: () => { calls.push('save') } },
    onFindRef: { current: () => { calls.push('find') } },
    onFindInFilesRef: { current: () => { calls.push('findInFiles') } },
    readOnly: false,
  })
  return { entries, calls }
}

test('the editor keymap does not bind the legacy Ctrl+Shift+F', async () => {
  const mod = await loadModule()
  const { entries } = editorKeymapFixture(mod)
  const keys = entries.map(entry => String(entry.key).toLowerCase())
  assert.ok(!keys.includes('mod-shift-f'))
  // The fallback alias and the in-file find stay bound.
  assert.ok(keys.includes('mod-alt-f'))
  assert.ok(keys.includes('mod-f'))
})

test('no binding of the installed keymap opens the global find on Ctrl+Shift+F', async () => {
  const mod = await loadModule()
  const { entries } = editorKeymapFixture(mod)
  // The keymap CodeMirror really installs: ours plus the package keymaps.
  const installed = [...entries, ...mod.defaultKeymap, ...mod.historyKeymap]
  const bound = installed
    .flatMap(entry => [entry.key, entry.mac])
    .filter(key => typeof key === 'string')
    .map(key => key.toLowerCase())
  assert.ok(!bound.includes('mod-shift-f'))
  // Only the fallback alias may open the global view.
  const globalKeys = bound.filter(key => key === 'mod-shift-f' || key === 'mod-alt-f' || key === 'mod-shift-r')
  assert.deepEqual(globalKeys, ['mod-alt-f'])
})

test('the editor keymap still opens the global find through the Ctrl+Alt+F alias', async () => {
  const mod = await loadModule()
  const { entries, calls } = editorKeymapFixture(mod)
  entries.find(entry => entry.key === 'Mod-Alt-f').run()
  assert.deepEqual(calls, ['findInFiles'])
})

test('the editor keymap still opens the in-file find through Ctrl+F', async () => {
  const mod = await loadModule()
  const { entries, calls } = editorKeymapFixture(mod)
  entries.find(entry => entry.key === 'Mod-f').run()
  assert.deepEqual(calls, ['find'])
})

test('the editor installs the exported keymap and knows no Mod-Shift-f', async () => {
  const source = await readFile(join(root, 'src/client/CodeEditor.jsx'), 'utf8')
  assert.match(source, /keymap\.of\(\[\s*\.\.\.editorKeymap\(/)
  assert.doesNotMatch(source, /Mod-Shift-f/)
})
