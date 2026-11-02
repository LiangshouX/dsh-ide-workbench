/**
 * The completion of the code intelligence plugin (COMP-01) and the semantic
 * key bindings (NAV-01, NAV-02, NAV-03).
 *
 * The plugin brings its OWN completion: the core of the workbench keeps its
 * editor free of any completion (PRD-v6 §2.2, acceptance R8), and the
 * plugin declares the slot `autocomplete` with the priority 100 - so the
 * completion appears exactly when the plugin is installed.
 *
 * The bindings of the plugin are handed to the core through the seam of the
 * contract; the core puts them before its own default keymap, so a
 * registered shortcut can never be swallowed by `Enter` or `Tab`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The bundle touches browser globals at import time; the completion helpers
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

/**
 * The client modules of the plugin, bundled.
 *
 * The bundle carries the extension slots and the key bindings of the plugin;
 * both are the ones the plugin hands to the editor of the core.
 * @returns {Promise<object>} the bundled module
 */
async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'completion-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
export { codeintelExtensionSlots, codeintelKeymap } from './src/client/extensions.js'
export { loadLspLibrary } from './src/client/lsp-lib.js'
export { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
export { EditorState, StateField } from '@codemirror/state'
`,
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'completion-entry.jsx',
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

test('the plugin declares the local completion in a slot of its own', async () => {
  const mod = await loadModule()
  const slots = mod.codeintelExtensionSlots()
  const autocomplete = slots.find(slot => slot.key === 'autocomplete')
  assert.ok(autocomplete !== undefined, 'the plugin declares the completion')
  assert.equal(autocomplete.priority, 100, 'the plugin claims the slot')
  // The completion really installs its state: the extension carries a state
  // field, and a document built with it is accepted by CodeMirror.
  const flat = autocomplete.extensions.flat(Infinity)
  assert.ok(flat.some(extension => extension instanceof mod.StateField), 'the completion installs a state field')
  const state = mod.EditorState.create({ doc: 'const a = 1\n', extensions: autocomplete.extensions })
  assert.equal(state.doc.toString(), 'const a = 1\n')
})

test('the plugin brings its own automatic closing of the brackets', async () => {
  const mod = await loadModule()
  const slots = mod.codeintelExtensionSlots()
  const brackets = slots.find(slot => slot.key === 'closeBrackets')
  assert.ok(brackets !== undefined, 'the plugin declares the brackets')
  assert.equal(brackets.priority, 100, 'the plugin wins over the core')
  const flat = brackets.extensions.flat(Infinity)
  assert.ok(flat.some(extension => extension instanceof mod.StateField), 'the brackets install a state')
})

test('the navigation keys are the documented ones', async () => {
  const mod = await loadModule()
  // The semantic commands belong to the library of the language server, and
  // the library is loaded lazily.
  await mod.loadLspLibrary()
  const entries = mod.codeintelKeymap()
  const keys = entries.map(entry => entry.key)
  assert.ok(keys.includes('F12'), `F12 is bound: ${keys.join(', ')}`)
  assert.ok(keys.includes('Alt-F7'), `Alt+F7 is bound: ${keys.join(', ')}`)
  assert.ok(keys.includes('Alt-F8'), `Alt+F8 is bound: ${keys.join(', ')}`)
  assert.ok(keys.includes('Ctrl-Space'), `Ctrl+Space is bound: ${keys.join(', ')}`)
  // The rename and format keys of the language server stay free: F2 renames
  // a file and Shift-Alt-f updates the references of the workbench.
  assert.ok(!keys.includes('F2'))
  assert.ok(!keys.includes('Shift-Alt-f'))
  // Shift+F12 is the "hide all" key of the workbench.
  assert.ok(!keys.includes('Shift-F12'))
})

test('the completion package is an explicit dependency', async () => {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  assert.ok(pkg.devDependencies['@codemirror/autocomplete'] !== undefined)
  assert.ok(pkg.devDependencies['@codemirror/lsp-client'] !== undefined)
})
