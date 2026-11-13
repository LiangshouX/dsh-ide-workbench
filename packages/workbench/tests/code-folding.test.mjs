/**
 * The code folding of the editor (R3).
 *
 * The folding APIs of CodeMirror were in the bundle all along - what was
 * missing was the installation: the extension array of the editor carried
 * neither `codeFolding()` nor `foldGutter()`, so the `foldState` field was
 * never there and not a single line of a JSON file or of a class could be
 * folded.
 *
 * This file pins down:
 *   - the installation (the field goes in ONCE, at mount time);
 *   - what becomes foldable (the JSON objects and arrays, the class body, the
 *     method body, the function body);
 *   - the shortcuts (IntelliJ style - `Ctrl+Shift+-` / `Ctrl+Shift+=` - written
 *     the way CodeMirror reads them, never with a `+` in the key);
 *   - the two surfaces that must NOT fold (the large-file read-only view and
 *     the rendered markdown).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const clientDir = join(root, 'src/client')
const moduleRequire = createRequire(import.meta.url)

// The bundle touches browser globals at import time; nothing here reads the
// DOM beyond that.
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
  value: { clipboard: { writeText: async () => {}, readText: async () => '' }, userAgent: 'node' },
})
globalThis.ResizeObserver = class { observe() {} disconnect() {} }

let modulePromise

/**
 * The editor and the folding APIs of CodeMirror, in ONE bundle.
 *
 * Bundling them together is not a detail: the extensions of CodeMirror are
 * checked with `instanceof`, so the state of the test and the state of the
 * editor have to come from the same copy of the library.
 * @returns {Promise<object>} the module
 */
async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'code-folding-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
export { editorKeymap, editorKeymapRest } from './src/client/CodeEditor.jsx'
export { EditorState } from '@codemirror/state'
export { history, undoDepth } from '@codemirror/commands'
export {
  codeFolding, foldGutter, foldState, foldable, foldedRanges, foldEffect, unfoldEffect,
  foldAll, unfoldAll, foldKeymap, ensureSyntaxTree,
} from '@codemirror/language'
export { json } from '@codemirror/lang-json'
export { javascript } from '@codemirror/lang-javascript'
`,
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'code-folding-entry.jsx',
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
    return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
  })()
  return modulePromise
}

/** A JSON document with a nested object and a nested array. */
const JSON_DOC = [
  '{',
  '  "name": "workbench",',
  '  "nested": {',
  '    "deep": true',
  '  },',
  '  "list": [',
  '    1,',
  '    2',
  '  ]',
  '}',
  '',
].join('\n')

/** A document with a class, a method and a function. */
const JS_DOC = [
  'class Workbench {',
  '  open() {',
  '    return 1',
  '  }',
  '}',
  '',
  'function helper() {',
  '  return 2',
  '}',
  '',
].join('\n')

/**
 * The parse of a document, finished.
 *
 * The parser of CodeMirror works on a time budget: the tree of a document is
 * only complete when the budget was not exceeded. Under a loaded machine
 * (the test files run next to each other) the first parse of a document can
 * be cut short - and an incomplete tree has no fold ranges. So the test
 * asks for the whole tree first, with a budget that a short document never
 * needs.
 * @param {any} state the editor state
 * @param {Function} ensureSyntaxTree the `ensureSyntaxTree` of CodeMirror
 * @returns {any} the tree of the document
 */
function parsed(state, ensureSyntaxTree) {
  const tree = ensureSyntaxTree(state, state.doc.length, 5000)
  assert.notEqual(tree, null, 'the document is parsed')
  return tree
}

/**
 * The lines of a document that can be folded.
 * @param {any} state the editor state
 * @param {Function} foldable the `foldable` of CodeMirror
 * @param {Function} ensureSyntaxTree the `ensureSyntaxTree` of CodeMirror
 * @returns {Array<{line: number, text: string, range: object}>} the foldable lines
 */
function foldableLines(state, foldable, ensureSyntaxTree) {
  parsed(state, ensureSyntaxTree)
  const lines = []
  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number)
    const range = foldable(state, line.from, line.to)
    if (range !== null && range !== undefined) lines.push({ line: number, text: line.text, range })
  }
  return lines
}

/**
 * A view that is just enough for the fold commands.
 *
 * `foldAll` and `unfoldAll` need the state, the line blocks and the dispatch
 * of a view - nothing that touches the DOM.
 * @param {any} state the editor state
 * @returns {object} the view
 */
function makeView(state) {
  const view = {
    state,
    lineBlockAt(pos) {
      const line = view.state.doc.lineAt(Math.min(pos, view.state.doc.length))
      return { from: line.from, to: line.to }
    },
    dispatch(transaction) {
      view.state = transaction.state ?? view.state.update(transaction).state
    },
  }
  return view
}

test('the editor installs the folding extensions once, at mount time', async () => {
  const source = await readFile(join(clientDir, 'CodeEditor.jsx'), 'utf8')
  // The comments talk about the extensions as well - only the code counts.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  // `codeFolding()` adds the `foldState` field: a second copy of it would
  // throw the state of the editor away, so it is installed exactly once, in
  // the extension list of the mount effect.
  assert.equal((code.match(/codeFolding\(\)/g) ?? []).length, 1, 'the folding field is installed once')
  assert.match(code, /foldGutter\(\)/, 'the fold gutter is installed')
  // The gutter sits next to the line numbers; the annotate column of the
  // blame is further to the left (it uses `Prec.high`).
  const list = code.slice(code.indexOf('export function editorExtensions'))
  assert.match(list, /return \[\s*lineNumbers\(\)/, 'the list starts with the line numbers')
  assert.match(list, /codeFolding\(\),\s*foldGutter\(\),/)
})

test('the fold state field is installed, so a line can be folded at all', async () => {
  const mod = await loadModule()
  const state = mod.EditorState.create({
    doc: JSON_DOC,
    extensions: [mod.codeFolding(), mod.foldGutter(), mod.json()],
  })
  assert.notEqual(state.field(mod.foldState, false), undefined, 'the field of the folding is there')
})

test('a JSON object and a JSON array are foldable', async () => {
  const mod = await loadModule()
  const state = mod.EditorState.create({
    doc: JSON_DOC,
    extensions: [mod.codeFolding(), mod.foldGutter(), mod.json()],
  })
  const lines = foldableLines(state, mod.foldable, mod.ensureSyntaxTree)
  const texts = lines.map(entry => entry.text.trim())
  assert.ok(texts.includes('{'), 'the whole object is foldable')
  assert.ok(texts.includes('"nested": {'), 'the nested object is foldable')
  assert.ok(texts.includes('"list": ['), 'the nested array is foldable')
  // The range of a fold covers the whole block, not only the first line.
  const whole = lines.find(entry => entry.text.trim() === '{')
  assert.ok(whole.range.to > whole.range.from + 1, 'the range spans the block')
})

test('a class body, a method body and a function body are foldable', async () => {
  const mod = await loadModule()
  const state = mod.EditorState.create({
    doc: JS_DOC,
    extensions: [mod.codeFolding(), mod.foldGutter(), mod.javascript()],
  })
  const texts = foldableLines(state, mod.foldable, mod.ensureSyntaxTree).map(entry => entry.text.trim())
  assert.ok(texts.includes('class Workbench {'), 'the body of the class is foldable')
  assert.ok(texts.includes('open() {'), 'the body of the method is foldable')
  assert.ok(texts.includes('function helper() {'), 'the body of the function is foldable')
})

test('folding leaves the document alone and does not break the undo history', async () => {
  const mod = await loadModule()
  const state = mod.EditorState.create({
    doc: JSON_DOC,
    extensions: [mod.history(), mod.codeFolding(), mod.foldGutter(), mod.json()],
  })
  // One edit, so there is something to undo.
  const edited = state.update({ changes: { from: 0, to: 0, insert: ' ' } }).state
  assert.equal(mod.undoDepth(edited), 1)
  parsed(edited, mod.ensureSyntaxTree)
  const line = edited.doc.line(1)
  const range = mod.foldable(edited, line.from, line.to)
  const folded = edited.update({ effects: mod.foldEffect.of(range) }).state
  assert.equal(folded.doc.toString(), edited.doc.toString(), 'the document is untouched')
  assert.equal(mod.undoDepth(folded), 1, 'the folding is not an edit of the document')
  // And it can be undone again: the history is still the one of the edit.
  assert.equal(mod.foldedRanges(folded).size, 1, 'the range is folded')
})

test('Ctrl+Shift+- folds everything and Ctrl+Shift+= unfolds everything again', async () => {
  const mod = await loadModule()
  const entries = mod.editorKeymap({
    onSaveRef: { current: () => {} },
    onFindRef: { current: () => {} },
    onFindInFilesRef: { current: () => {} },
    readOnly: false,
  })
  const fold = entries.find(entry => entry.key === 'Ctrl-Shift--')
  const unfold = entries.find(entry => entry.key === 'Ctrl-Shift-=')
  assert.ok(fold !== undefined, 'the fold-all binding is there')
  assert.ok(unfold !== undefined, 'the unfold-all binding is there')

  const state = mod.EditorState.create({
    doc: JSON_DOC,
    extensions: [mod.codeFolding(), mod.foldGutter(), mod.json()],
  })
  parsed(state, mod.ensureSyntaxTree)
  const view = makeView(state)
  assert.equal(fold.run(view), true, 'the binding reports that it did something')
  assert.ok(mod.foldedRanges(view.state).size > 0, 'the document is folded')
  assert.equal(unfold.run(view), true)
  assert.equal(mod.foldedRanges(view.state).size, 0, 'the document is unfolded again')
})

test('the fold keys are written the way CodeMirror reads them', async () => {
  const mod = await loadModule()
  const entries = mod.editorKeymap({
    onSaveRef: { current: () => {} },
    onFindRef: { current: () => {} },
    onFindInFilesRef: { current: () => {} },
    readOnly: false,
  })
  const keys = entries.map(entry => String(entry.key))
  // A `+` in the key is poison: CodeMirror splits a binding on `-`, and the
  // shortcut normalisation of the workbench splits on `+`.
  assert.ok(keys.every(key => !key.includes('+')), 'no key of the editor holds a plus')
  assert.ok(keys.includes('Ctrl-Shift--'))
  assert.ok(keys.includes('Ctrl-Shift-='))
  // The macOS spelling of the same gesture is the command key.
  const mac = entries.map(entry => (entry.mac === undefined ? '' : String(entry.mac)))
  assert.ok(mac.includes('Cmd-Shift--'))
  assert.ok(mac.includes('Cmd-Shift-='))
  assert.ok(mac.every(key => !key.includes('+')), 'no mac key of the editor holds a plus')
})

test('the folding of a single range is bound to Ctrl+Shift+[ and Ctrl+Shift+]', async () => {
  const mod = await loadModule()
  const rest = mod.editorKeymapRest()
  const keys = rest.map(entry => String(entry.key))
  assert.ok(keys.includes('Ctrl-Shift-['), 'the range at the cursor can be folded')
  assert.ok(keys.includes('Ctrl-Shift-]'), 'the range at the cursor can be unfolded')
  // The "fold all" of the document is not bound twice.
  assert.ok(!keys.includes('Ctrl-Shift--'))
  assert.ok(!keys.includes('Ctrl-Shift-='))
})

test('the shortcuts belong to the editor, not to a global handler', async () => {
  const source = await readFile(join(clientDir, 'CodeEditor.jsx'), 'utf8')
  // The bindings live in the keymap of the buffer, so they fire exactly when
  // the editor has the focus - there is no global listener in the editor.
  assert.doesNotMatch(source, /addEventListener\(\s*['"]keydown['"]/)
  assert.match(source, /key: 'Ctrl-Shift--'/)
  assert.match(source, /key: 'Ctrl-Shift-='/)
})

test('the colours of the fold gutter follow the host theme', async () => {
  const styles = await readFile(join(clientDir, 'styles.js'), 'utf8')
  // `foldGutter()` installs CodeMirror's own class - the stylesheet of the
  // core owns it, and every colour comes from a theme token.
  assert.match(styles, /\.cm-foldGutter\s*\{[^}]*color:\s*var\(--iwb-[a-z-]+\)/)
  assert.match(styles, /\.cm-foldPlaceholder\s*\{[^}]*var\(--iwb-[a-z-]+\)/)
  const foldRules = styles.slice(styles.indexOf('.cm-foldGutter'))
  assert.doesNotMatch(foldRules.slice(0, 600), /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'no hard-coded colour in the folding rules')
})

test('the large-file read-only view and the rendered markdown do not fold', async () => {
  // The large-file view is not CodeMirror - it is a virtualised list of
  // lines. It stays as it is.
  const codeView = await readFile(join(clientDir, 'CodeView.jsx'), 'utf8')
  assert.doesNotMatch(codeView, /codeFolding|foldGutter|foldState/)
  // The rendered markdown is a DOM view, not an editor.
  const markdown = await readFile(join(clientDir, 'MarkdownView.jsx'), 'utf8')
  assert.doesNotMatch(markdown, /codeFolding|foldGutter|foldState/)
})
