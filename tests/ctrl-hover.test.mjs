/**
 * The Ctrl+hover jump hint (NAV-01).
 *
 * JetBrains promises the target before the click: holding the modifier turns
 * the identifier under the pointer blue and underlines it. The editor gets the
 * same hint through a decoration mark, and this file pins down both halves:
 * the range that is marked, and the stylesheet that gives it its look.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The bundle touches browser globals at import time; nothing here reads the
// DOM.
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
    const outfile = join(dir, 'ctrl-hover-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
export { identifierRangeAt, identifierAt } from './src/client/CodeEditor.jsx'
export { ctrlHoverField, setCtrlHover, currentCtrlHover } from './src/client/CodeEditor.jsx'
export { EditorState } from '@codemirror/state'
export { javascript } from '@codemirror/lang-javascript'
`,
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'ctrl-hover-entry.jsx',
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

/** The document the range tests work on. */
const SOURCE = [
  'const alpha = 1',
  '// a comment',
  'const pi = 3.14',
].join('\n')

/** A state with the JavaScript grammar and the hint field. */
function jsState(mod) {
  return mod.EditorState.create({
    doc: SOURCE,
    extensions: [mod.javascript(), mod.ctrlHoverField],
  })
}

test('the range of an identifier covers exactly the word', async () => {
  const mod = await loadModule()
  const state = jsState(mod)
  const range = mod.identifierRangeAt(state, 6)
  assert.deepEqual(range, { from: 6, to: 11 })
  assert.equal(state.doc.sliceString(range.from, range.to), 'alpha')
  // The name of the second constant.
  const second = mod.identifierRangeAt(state, SOURCE.indexOf('pi'))
  assert.equal(state.doc.sliceString(second.from, second.to), 'pi')
})

test('a comment, a space and a number are no identifier', async () => {
  const mod = await loadModule()
  const state = jsState(mod)
  assert.equal(mod.identifierRangeAt(state, 5), null, 'the space before the name')
  assert.equal(mod.identifierRangeAt(state, SOURCE.indexOf('//') + 3), null, 'inside the comment')
  assert.equal(mod.identifierRangeAt(state, SOURCE.indexOf('=')), null, 'the assignment')
})

test('the hint starts empty', async () => {
  const mod = await loadModule()
  const state = jsState(mod)
  assert.equal(mod.currentCtrlHover(state), null)
})

test('the hint is put on the symbol and taken away again', async () => {
  const mod = await loadModule()
  const state = jsState(mod)
  const marked = state.update({ effects: mod.setCtrlHover.of({ from: 6, to: 11 }) }).state
  assert.deepEqual(mod.currentCtrlHover(marked), { from: 6, to: 11 })

  const cleared = marked.update({ effects: mod.setCtrlHover.of(null) }).state
  assert.equal(mod.currentCtrlHover(cleared), null)
})

test('the hint decoration carries the class the stylesheet colours', async () => {
  const mod = await loadModule()
  const state = jsState(mod)
  const marked = state.update({ effects: mod.setCtrlHover.of({ from: 6, to: 11 }) }).state
  const decorations = marked.field(mod.ctrlHoverField)
  const first = decorations.iter()
  assert.equal(first.value.spec.class, 'iwb-ctrl-hover-symbol')
})

test('the hint follows the text when the document changes above it', async () => {
  const mod = await loadModule()
  const state = jsState(mod)
  const marked = state.update({ effects: mod.setCtrlHover.of({ from: 6, to: 11 }) }).state
  // One character is inserted at the very beginning: the word moved by one.
  const shifted = marked.update({ changes: { from: 0, insert: 'x' } }).state
  assert.deepEqual(mod.currentCtrlHover(shifted), { from: 7, to: 12 })
})

test('the stylesheet targets the classes the library really renders', async () => {
  const source = await readFile(join(root, 'src/client/styles.js'), 'utf8')
  // The hover card is `.cm-lsp-hover-tooltip`; styling `.cm-lsp-hover` alone
  // matched nothing and left the card with the library's own colours.
  assert.match(source, /\.cm-lsp-hover-tooltip/)
  assert.match(source, /\.cm-lsp-signature-tooltip/)
  assert.match(source, /\.iwb-ctrl-hover-symbol/)
  // The selected completion row has to set both halves of the contrast.
  const selected = /\.cm-tooltip-autocomplete > ul > li\[aria-selected\] \{[^}]*\}/.exec(source)
  assert.ok(selected !== null, 'the selected completion row is styled')
  assert.match(selected[0], /background/)
  assert.match(selected[0], /color/)
})
