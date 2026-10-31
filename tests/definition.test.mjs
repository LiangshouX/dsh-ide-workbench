import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { WorkbenchWorkspace } from '../src/client/lsp-workspace.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The bundle touches browser globals at import time; the identifier helpers
// themselves never read the DOM.
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
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'definition-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
export { identifierAt, handleCtrlClick, wordAtCursor, revealPosition } from './src/client/CodeEditor.jsx'
export { EditorState } from '@codemirror/state'
export { javascript } from '@codemirror/lang-javascript'
`,
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'definition-entry.jsx',
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

/** The document the identifier tests work on. */
const SOURCE = [
  'const alpha = 1', // 0: "const alpha = 1"
  '// a comment', // 1
  'const text = "a string"', // 2
  'const pi = 3.14', // 3
].join('\n')

/**
 * A state with the JavaScript grammar.
 * @param {any} mod the bundled module
 * @returns {any} the state
 */
function jsState(mod) {
  return mod.EditorState.create({ doc: SOURCE, extensions: [mod.javascript()] })
}

/**
 * An editor stub: the handler only needs the state, a position and a
 * dispatch.
 * @param {any} state the editor state
 * @param {number} pos the position of the pointer
 * @returns {any} the editor stub
 */
function fakeView(state, pos) {
  const dispatched = []
  return {
    state,
    dispatched,
    posAtCoords: () => pos,
    dispatch: (transaction) => dispatched.push(transaction),
    // No language server is attached to the stub.
    plugin: () => null,
  }
}

/**
 * A mouse event stub that records whether the default was prevented.
 * @param {object} [init] the properties of the event
 * @returns {any} the event
 */
function mouseEvent(init = {}) {
  return {
    clientX: 10,
    clientY: 10,
    ctrlKey: false,
    metaKey: false,
    prevented: 0,
    preventDefault() { this.prevented += 1 },
    ...init,
  }
}

test('an identifier is recognized', async () => {
  const mod = await loadModule()
  const state = jsState(mod)
  // "alpha" of the first line.
  assert.equal(mod.identifierAt(state, 6), 'alpha')
  // The name of the second constant.
  assert.equal(mod.identifierAt(state, SOURCE.indexOf('text')), 'text')
})

test('whitespace, punctuation, a comment and a string are no identifiers', async () => {
  const mod = await loadModule()
  const state = jsState(mod)
  // The space between "const" and "alpha".
  assert.equal(mod.identifierAt(state, 5), null)
  // The "=" of the assignment.
  assert.equal(mod.identifierAt(state, SOURCE.indexOf('=')), null)
  // Inside the comment of the second line.
  assert.equal(mod.identifierAt(state, SOURCE.indexOf('a comment') + 2), null)
  // Inside the string of the third line.
  assert.equal(mod.identifierAt(state, SOURCE.indexOf('a string') + 2), null)
  // Behind the end of the document.
  assert.equal(mod.identifierAt(state, SOURCE.length + 10), null)
})

test('a Ctrl+click on an identifier jumps to the definition', async () => {
  const mod = await loadModule()
  const state = jsState(mod)
  const view = fakeView(state, 6)
  const event = mouseEvent({ ctrlKey: true })
  let jumped = 0
  const handled = mod.handleCtrlClick(event, view, {
    trigger: () => { jumped += 1; return true },
    requirePlugin: false,
  })
  assert.equal(handled, true)
  // The default has to be prevented, otherwise the mouse starts a selection.
  assert.equal(event.prevented, 1)
  assert.equal(jumped, 1)
  // The cursor is put on the symbol before the jump.
  assert.equal(view.dispatched.length, 1)
  assert.equal(view.dispatched[0].selection.anchor, 6)
})

test('a Ctrl+click without a modifier does nothing', async () => {
  const mod = await loadModule()
  const state = jsState(mod)
  const view = fakeView(state, 6)
  const event = mouseEvent()
  let jumped = 0
  const handled = mod.handleCtrlClick(event, view, {
    trigger: () => { jumped += 1; return true },
    requirePlugin: false,
  })
  assert.equal(handled, false)
  assert.equal(event.prevented, 0)
  assert.equal(jumped, 0)
  assert.equal(view.dispatched.length, 0)
})

test('a Ctrl+click on whitespace, a comment or a string does nothing', async () => {
  const mod = await loadModule()
  const state = jsState(mod)
  for (const pos of [5, SOURCE.indexOf('='), SOURCE.indexOf('a comment') + 2, SOURCE.indexOf('a string') + 2]) {
    const view = fakeView(state, pos)
    const event = mouseEvent({ ctrlKey: true })
    let jumped = 0
    const handled = mod.handleCtrlClick(event, view, {
      trigger: () => { jumped += 1; return true },
      requirePlugin: false,
    })
    assert.equal(handled, false, `position ${pos} is not an identifier`)
    assert.equal(event.prevented, 0)
    assert.equal(jumped, 0)
    assert.equal(view.dispatched.length, 0)
  }
})

test('without a language server the click keeps its normal meaning', async () => {
  const mod = await loadModule()
  const state = jsState(mod)
  const view = fakeView(state, 6)
  const event = mouseEvent({ ctrlKey: true })
  const handled = mod.handleCtrlClick(event, view, { trigger: () => true })
  assert.equal(handled, false)
  assert.equal(event.prevented, 0)
})

test('the word around the cursor is found without a grammar', async () => {
  const mod = await loadModule()
  const state = mod.EditorState.create({ doc: 'const alpha = 1\n' })
  assert.equal(mod.wordAtCursor(state, 8), 'alpha')
  // The word the cursor touches is found, even when the cursor sits behind
  // it - that is the word the user is working on.
  assert.equal(mod.wordAtCursor(state, 5), 'const')
  // Without a word there is nothing.
  const blank = mod.EditorState.create({ doc: '   \n' })
  assert.equal(mod.wordAtCursor(blank, 1), null)
})

test('a cross file definition opens the file in the workbench', async () => {
  const calls = []
  const store = {
    state: { root: 'C:/work/demo', tabs: [] },
    openFile(path, options) { calls.push({ kind: 'openFile', path, options }) },
    toast(level, text, detail) { calls.push({ kind: 'toast', level, text, detail }) },
    t(key) { return key },
  }
  const client = { didOpen() {}, didClose() {} }
  const view = { state: { doc: { toString: () => '' } } }
  const workspace = new WorkbenchWorkspace(client, store, {
    viewRegistry: { waitForEditorView: async () => view },
  })
  const result = await workspace.displayFile('file:///C:/work/demo/src/other.ts')
  assert.equal(result, view)
  const opened = calls.find(call => call.kind === 'openFile')
  assert.ok(opened !== undefined)
  assert.equal(opened.path, 'C:\\work\\demo\\src\\other.ts')
})

test('a definition outside the project is not opened', async () => {
  const calls = []
  const store = {
    state: { root: 'C:/work/demo', tabs: [] },
    openFile(path, options) { calls.push({ kind: 'openFile', path, options }) },
    toast(level, text, detail) { calls.push({ kind: 'toast', level, text, detail }) },
    t(key) { return key },
  }
  const client = { didOpen() {}, didClose() {} }
  const workspace = new WorkbenchWorkspace(client, store, {
    viewRegistry: { waitForEditorView: async () => ({ state: { doc: { toString: () => '' } } }) },
  })
  const result = await workspace.displayFile('file:///C:/elsewhere/secret.ts')
  assert.equal(result, null)
  assert.equal(calls.find(call => call.kind === 'openFile'), undefined)
  assert.ok(calls.find(call => call.kind === 'toast') !== undefined)
})

test('the reveal position carries the column', async () => {
  const mod = await loadModule()
  const state = mod.EditorState.create({ doc: 'const alpha = 1\nconst beta = 2\n' })
  const second = state.doc.line(2)
  // Without a column the position is the start of the line.
  assert.equal(mod.revealPosition(state, 2, null), second.from)
  assert.equal(mod.revealPosition(state, 2, undefined), second.from)
  // With a column the cursor lands inside the line.
  assert.equal(mod.revealPosition(state, 2, 7), second.from + 6)
  // A column behind the end of the line is clamped to the end of the text.
  assert.equal(mod.revealPosition(state, 2, 99), second.from + second.text.length)
  // A line that does not exist is clamped to the last one.
  const last = state.doc.line(state.doc.lines)
  assert.equal(mod.revealPosition(state, 99, 1), last.from)
  // No line at all means no reveal.
  assert.equal(mod.revealPosition(state, 0, 1), null)
})
