/**
 * The editing fidelity of the buffer ("the content is 100 % faithful").
 *
 * The principle of the workbench: in edit mode the file shows exactly what the
 * user typed. No extension may swallow a character, re-format a line or
 * change the indentation of what the user typed.
 *
 * The defect this file guards against is concrete: typing `###` at the start
 * of a line swallowed the characters and converted the line - the cause was
 * the completion of the language server, which the library of the completion
 * applies BY ITSELF when a "commit character" (`#`, `*`, `+`, `/`, `.`) is
 * typed, with the range the SERVER computed on its own copy of the document.
 *
 * The file has two layers:
 *
 *   1. the RULES of the guard (`editor-fidelity.js`), tested without a
 *      browser: a transaction that rewrites the text of the user is refused,
 *      a gesture of the user is not;
 *   2. the STACK of the client, mounted as a real editor in jsdom: the
 *      document AND the visible text keep every character. The jsdom of the
 *      research sandbox lives OUTSIDE the repository, so the second layer is
 *      SKIPPED when it cannot be found - the first layer always runs.
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

let modulePromise

/**
 * The editor of the client and the CodeMirror packages, in ONE bundle.
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
    const outfile = join(dir, 'editor-fidelity-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
export { editorExtensions, languageKeyForPath, loadLanguageForPath } from './src/client/CodeEditor.jsx'
export { fidelityCheck, fidelityGuard } from './src/client/editor-fidelity.js'
export { EditorState } from '@codemirror/state'
export { EditorView } from '@codemirror/view'
export { history } from '@codemirror/commands'
export { autocompletion, startCompletion, completionStatus } from '@codemirror/autocomplete'
`,
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'editor-fidelity-entry.jsx',
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

/**
 * The jsdom of the research sandbox - if it is there.
 *
 * The sandbox lives OUTSIDE the repository (`qa-sandbox`), and its jsdom must
 * not become a dependency of the package. So the DOM layer of this file is
 * skipped when the sandbox is not around: the rules of the guard (the first
 * layer) always run.
 * @returns {Promise<any>} the jsdom module, or `null`
 */
async function loadJsdom() {
  const candidates = [
    // The research sandbox of the repository (the sibling of the worktree).
    resolve(root, '..', '..', '..', 'qa-sandbox', 'node_modules', 'jsdom'),
    // A jsdom of the package itself (a developer may have one).
    resolve(root, 'node_modules', 'jsdom'),
  ]
  for (const candidate of candidates) {
    try {
      const entry = join(candidate, 'lib', 'api.js')
      const module = await import(pathToFileURL(entry).href)
      if (module?.JSDOM !== undefined) return module
    } catch {
      /* the next candidate */
    }
  }
  return null
}

/**
 * The DOM of jsdom, installed as the globals of the process.
 *
 * The stubs of the other tests are not enough for a real editor: jsdom has a
 * real DOM, and only the measurements have to be faked.
 * @param {any} jsdom the jsdom module
 * @returns {any} the window of the DOM
 */
function installDom(jsdom) {
  const dom = new jsdom.JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', {
    pretendToBeVisual: true,
  })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.Element = dom.window.Element
  globalThis.Node = dom.window.Node
  globalThis.Range = dom.window.Range
  globalThis.MutationObserver = dom.window.MutationObserver
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  globalThis.IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return [] }
  }
  globalThis.self = dom.window
  // jsdom has no layout: the range must still answer, or the measuring of
  // CodeMirror throws. The values are irrelevant - only the text matters.
  dom.window.Range.prototype.getClientRects = () => []
  dom.window.Range.prototype.getBoundingClientRect = () => ({
    top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
  })
  dom.window.Element.prototype.getBoundingClientRect = () => ({
    top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
  })
  for (const key of [
    'Window', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'PointerEvent',
    'DragEvent', 'ClipboardEvent', 'InputEvent', 'CompositionEvent', 'DOMRect', 'NodeFilter',
    'SVGElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Selection', 'getSelection',
    'CSS', 'DOMParser', 'XMLSerializer',
  ]) {
    if (dom.window[key] !== undefined) globalThis[key] = dom.window[key]
  }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: dom.window.navigator,
  })
  return dom.window
}

/**
 * Type one character the way the browser does it.
 *
 * The browser sends the `keydown` BEFORE the text is inserted - and that is
 * the moment the completion of the library applies itself (a commit
 * character). The text itself arrives with the user event `input.type`.
 * @param {any} view the editor
 * @param {string} text the character
 * @returns {string} the document after the keystroke
 */
function typeChar(view, text) {
  const selection = view.state.selection.main
  const from = selection.from
  const to = selection.to
  if (typeof view.contentDOM?.dispatchEvent === 'function') {
    const event = new globalThis.KeyboardEvent('keydown', {
      key: text, bubbles: true, cancelable: true, composed: true,
    })
    view.contentDOM.dispatchEvent(event)
  }
  view.dispatch(view.state.update({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    userEvent: 'input.type',
  }))
  return view.state.doc.toString()
}

/**
 * The text the user SEES: one entry per rendered line.
 * @param {any} view the editor
 * @returns {string} the visible text
 */
function visibleTextOf(view) {
  const lines = view.contentDOM.querySelectorAll('.cm-line')
  const out = []
  for (const line of lines) out.push(line.textContent)
  return out.join('\n')
}

/**
 * A state with the guard of the fidelity.
 * @param {any} mod the module of the test
 * @param {string} doc the document
 * @returns {any} the state
 */
function guardedState(mod, doc = '') {
  return mod.EditorState.create({ doc, extensions: [mod.fidelityGuard()] })
}

// ── the rules of the guard (no browser needed) ─────────────────────────────────

test('typing keeps every character of the line', async () => {
  const mod = await loadModule()
  let state = guardedState(mod, '')
  for (const character of '###') {
    state = state.update({
      changes: { from: state.doc.length, to: state.doc.length, insert: character },
      selection: { anchor: state.doc.length + 1 },
      userEvent: 'input.type',
    }).state
  }
  assert.equal(state.doc.toString(), '###', 'the document keeps the three hashes')
})

test('a completion that reaches over the text of the user is refused', async () => {
  const mod = await loadModule()
  // The state after the user typed `###`: the cursor is behind the hashes.
  let state = guardedState(mod, '')
  for (const character of '###') {
    state = state.update({
      changes: { from: state.doc.length, to: state.doc.length, insert: character },
      selection: { anchor: state.doc.length + 1 },
      userEvent: 'input.type',
    }).state
  }
  // The library applies the open completion BY ITSELF: the range comes from
  // the server (its own copy of the document) and it covers the characters
  // the user has just typed.
  const next = state.update({
    changes: { from: 0, to: 3, insert: '# heading' },
    selection: { anchor: 9 },
    userEvent: 'input.complete',
  }).state
  assert.equal(next.doc.toString(), '###', 'the hashes are still there')
})

test('a completion of the word at the cursor is allowed', async () => {
  const mod = await loadModule()
  let state = guardedState(mod, '')
  for (const character of 'fo') {
    state = state.update({
      changes: { from: state.doc.length, to: state.doc.length, insert: character },
      selection: { anchor: state.doc.length + 1 },
      userEvent: 'input.type',
    }).state
  }
  // The user accepts the completion with Enter: the range is the word.
  const next = state.update({
    changes: { from: 0, to: 2, insert: 'foo' },
    selection: { anchor: 3 },
    userEvent: 'input.complete',
  }).state
  assert.equal(next.doc.toString(), 'foo', 'the completion was applied')
})

test('a programmatic change may not replace the text the user did not select', async () => {
  const mod = await loadModule()
  const state = guardedState(mod, 'alpha')
  // A plugin rewrites the line - without any gesture of the user.
  const next = state.update({
    changes: { from: 0, to: 5, insert: 'beta' },
    selection: { anchor: 4 },
  }).state
  assert.equal(next.doc.toString(), 'alpha', 'the text of the user is still there')
})

test('a programmatic change may replace the text the user selected', async () => {
  const mod = await loadModule()
  const state = guardedState(mod, 'alpha').update({ selection: { anchor: 1, head: 4 } }).state
  const next = state.update({
    changes: { from: 1, to: 4, insert: 'X' },
    selection: { anchor: 2 },
  }).state
  assert.equal(next.doc.toString(), 'aXa', 'the selected text was replaced')
})

test('a deletion, a paste and an insertion are allowed', async () => {
  const mod = await loadModule()
  const state = guardedState(mod, 'alpha')
  const deleted = state.update({
    changes: { from: 1, to: 3 },
    userEvent: 'delete.backward',
  }).state
  assert.equal(deleted.doc.toString(), 'aha', 'the two characters are gone')
  const pasted = state.update({
    changes: { from: 0, to: 0, insert: '# ' },
    userEvent: 'input.paste',
  }).state
  assert.equal(pasted.doc.toString(), '# alpha', 'the paste is there')
  const inserted = state.update({
    changes: { from: 0, to: 0, insert: 'x' },
  }).state
  assert.equal(inserted.doc.toString(), 'xalpha', 'a programmatic insertion is allowed')
})

test('the undo of the history is allowed', async () => {
  const mod = await loadModule()
  let state = guardedState(mod, '')
  state = state.update({
    changes: { from: 0, to: 0, insert: 'hello' },
    userEvent: 'input.type',
  }).state
  const undone = state.update({
    changes: { from: 0, to: 5, insert: '' },
    userEvent: 'undo',
  }).state
  assert.equal(undone.doc.toString(), '', 'the undo took the text away')
})

test('the guard does not know about languages: it holds for a file without a grammar', async () => {
  const mod = await loadModule()
  // A file without a grammar has no word at all - and then a completion may
  // only INSERT, never replace.
  const state = guardedState(mod, '')
  const typed = state.update({
    changes: { from: 0, to: 0, insert: '###' },
    selection: { anchor: 3 },
    userEvent: 'input.type',
  }).state
  const rewritten = typed.update({
    changes: { from: 0, to: 3, insert: '# heading' },
    userEvent: 'input.complete',
  }).state
  assert.equal(rewritten.doc.toString(), '###')
})

test('the editor installs the guard, and it installs it in the right place', async () => {
  const source = await readFile(join(clientDir, 'CodeEditor.jsx'), 'utf8')
  // The comments talk about the guard as well - only the code counts.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.match(code, /fidelityGuard\(\)/, 'the guard is installed')
  // The order matters: after `indentOnInput()` (whose change of the leading
  // whitespace must not be touched) and before the extensions of the seam.
  const guard = code.indexOf('fidelityGuard()')
  const indent = code.indexOf('indentOnInput()')
  const seam = code.indexOf('extensionCompartment.of(')
  assert.ok(indent >= 0 && guard > indent, 'the guard comes after the indentation')
  assert.ok(seam > guard, 'the guard comes before the extensions of the plugins')
})

test('the find bar replaces with a gesture of the user', async () => {
  const source = await readFile(join(clientDir, 'CodeEditor.jsx'), 'utf8')
  // The replacement of the find bar rewrites a range the user did not
  // select - so it has to carry a user event, or the guard of the fidelity
  // would refuse it and the "replace" button would do nothing.
  const matches = source.match(/userEvent: 'input\.replace'/g) ?? []
  assert.equal(matches.length, 2, 'the replace and the replace-all of the find bar')
})

// ── the stack of the client, in a real editor (jsdom) ─────────────────────────

test('the stack of the client keeps every character of the line', async (t) => {
  const jsdom = await loadJsdom()
  if (jsdom === null) {
    t.skip('the jsdom of the research sandbox is not around - the DOM layer is skipped')
    return
  }
  installDom(jsdom)
  const mod = await loadModule()
  const cases = [
    { path: 'notes.txt', text: '###' },
    { path: 'notes.txt', text: '# ' },
    { path: 'app.properties', text: '###' },
    { path: 'README.md', text: '###' },
    { path: 'main.py', text: '###' },
    { path: 'conf.yaml', text: '###' },
    { path: 'notes.txt', text: '*' },
    { path: 'notes.txt', text: '+' },
    { path: 'notes.txt', text: '/' },
    { path: 'notes.txt', text: '.' },
  ]
  for (const { path, text } of cases) {
    const language = await mod.loadLanguageForPath(path)
    const view = new mod.EditorView({
      state: mod.EditorState.create({
        doc: '',
        extensions: [...mod.editorExtensions({}), language],
      }),
      parent: globalThis.document.getElementById('host'),
    })
    for (const character of text) typeChar(view, character)
    assert.equal(view.state.doc.toString(), text, `the document of ${path} keeps ${JSON.stringify(text)}`)
    assert.equal(visibleTextOf(view), text, `the visible text of ${path} keeps ${JSON.stringify(text)}`)
    view.destroy()
  }
})

test('the stack of the client keeps the characters inside a line with content', async (t) => {
  const jsdom = await loadJsdom()
  if (jsdom === null) {
    t.skip('the jsdom of the research sandbox is not around - the DOM layer is skipped')
    return
  }
  installDom(jsdom)
  const mod = await loadModule()
  const view = new mod.EditorView({
    state: mod.EditorState.create({
      doc: 'alpha',
      extensions: [...mod.editorExtensions({}), await mod.loadLanguageForPath('README.md')],
    }),
    parent: globalThis.document.getElementById('host'),
  })
  view.dispatch({ selection: { anchor: 5 } })
  for (const character of '###') typeChar(view, character)
  assert.equal(view.state.doc.toString(), 'alpha###')
  assert.equal(visibleTextOf(view), 'alpha###')
  view.destroy()
})

test('a destructive completion may not rewrite the line of the user', async (t) => {
  const jsdom = await loadJsdom()
  if (jsdom === null) {
    t.skip('the jsdom of the research sandbox is not around - the DOM layer is skipped')
    return
  }
  installDom(jsdom)
  const mod = await loadModule()
  const view = new mod.EditorView({
    state: mod.EditorState.create({
      doc: '',
      extensions: [...mod.editorExtensions({}), await mod.loadLanguageForPath('notes.txt')],
    }),
    parent: globalThis.document.getElementById('host'),
  })
  // The user types the hashes.
  for (const character of '###') typeChar(view, character)
  assert.equal(view.state.doc.toString(), '###')
  // The library applies the open completion BY ITSELF when a commit character
  // is typed. The transaction it dispatches replaces the range of the SERVER
  // (its own copy of the document - which is behind) with the text of the
  // server: the characters of the user are swallowed and the line is
  // converted. The guard of the fidelity has to refuse it.
  view.dispatch(view.state.update({
    changes: { from: 0, to: 3, insert: '# heading' },
    selection: { anchor: 9 },
    userEvent: 'input.complete',
  }))
  assert.equal(view.state.doc.toString(), '###', 'the characters of the user are still there')
  assert.equal(visibleTextOf(view), '###', 'and they are on the screen')
  view.destroy()
})
