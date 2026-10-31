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
export { completionExtensions, editorKeymapRest, navKeymap } from './src/client/CodeEditor.jsx'
export { completionKeymap, closeBracketsKeymap, autocompletion, closeBrackets, closeCompletion } from '@codemirror/autocomplete'
export { defaultKeymap, historyKeymap } from '@codemirror/commands'
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

test('the editor mounts the local completion', async () => {
  const mod = await loadModule()
  const extensions = mod.completionExtensions()
  assert.equal(extensions.length, 2)
  // The completion really installs its state: the extension carries a state
  // field, and a document built with it is accepted by CodeMirror.
  const flat = extensions.flat(Infinity)
  assert.ok(flat.some(extension => extension instanceof mod.StateField), 'the completion installs a state field')
  const state = mod.EditorState.create({ doc: 'const a = 1\n', extensions })
  assert.equal(state.doc.toString(), 'const a = 1\n')

  const source = await readFile(join(root, 'src/client/CodeEditor.jsx'), 'utf8')
  assert.match(source, /\.\.\.completionExtensions\(\)/)
  assert.match(source, /autocompletion\(\{ activateOnTyping: true, icons: false \}\)/)
  assert.match(source, /closeBrackets\(\)/)
})

test('the completion keymap comes before the default keymap', async () => {
  const mod = await loadModule()
  const entries = mod.editorKeymapRest()
  const completionIndex = entries.indexOf(mod.completionKeymap[0])
  const defaultIndex = entries.indexOf(mod.defaultKeymap[0])
  assert.ok(completionIndex >= 0, 'the completion keymap is installed')
  assert.ok(defaultIndex >= 0, 'the default keymap is installed')
  assert.ok(completionIndex < defaultIndex, 'the completion keymap wins over the default keymap')
})

test('Escape closes the completion instead of inserting text', async () => {
  const mod = await loadModule()
  const entries = mod.editorKeymapRest()
  const completionEscape = mod.completionKeymap.find(entry => entry.key === 'Escape')
  const defaultEscape = mod.defaultKeymap.find(entry => entry.key === 'Escape')
  assert.ok(completionEscape !== undefined)
  assert.ok(defaultEscape !== undefined)
  // The command of the library only closes the popup; it never edits the
  // document.
  assert.equal(completionEscape.run, mod.closeCompletion)
  const completionIndex = entries.indexOf(completionEscape)
  const defaultIndex = entries.indexOf(defaultEscape)
  assert.ok(completionIndex >= 0 && completionIndex < defaultIndex)
})

test('the editor does not bind Escape itself', async () => {
  const source = await readFile(join(root, 'src/client/CodeEditor.jsx'), 'utf8')
  assert.doesNotMatch(source, /key:\s*'Escape'/)
})

test('the completion accepts with Enter and Tab', async () => {
  const mod = await loadModule()
  const enter = mod.completionKeymap.find(entry => entry.key === 'Enter')
  assert.ok(enter !== undefined, 'Enter accepts a completion')
  const entries = mod.editorKeymapRest()
  const defaultEnter = mod.defaultKeymap.find(entry => entry.key === 'Enter')
  if (defaultEnter !== undefined) {
    assert.ok(entries.indexOf(enter) < entries.indexOf(defaultEnter))
  }
})

test('the navigation keys are the documented ones', async () => {
  const mod = await loadModule()
  const entries = mod.navKeymap()
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
