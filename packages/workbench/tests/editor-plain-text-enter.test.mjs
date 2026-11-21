/**
 * The Enter of a file WITHOUT a grammar must not move the indentation.
 *
 * The defect: CodeMirror binds Enter to `insertNewlineAndIndent`, which
 * copies the leading whitespace of the current line onto the new one. The
 * whitespace the user types afterwards lands on TOP of it, so the
 * indentation grows with every line and a list the user aligned by hand
 * ("` ** 1`", "` ** 2`") comes out as a staircase.
 *
 * The promise of the workbench is that the text of the user is 100 % faithful
 * (see `editor-fidelity.js`), and the indentation of what the user typed is
 * part of that text - so the core binds Enter itself for a file without a
 * grammar. A file WITH a grammar keeps the rules of its grammar.
 *
 * The test needs no browser: the binding is a function of the state, and the
 * state is enough to decide.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const moduleRequire = createRequire(import.meta.url)

let modulePromise

/**
 * The editor of the client and the CodeMirror packages, in ONE bundle.
 *
 * The extensions of CodeMirror are checked with `instanceof`, so the state of
 * the test and the state of the editor have to come from the same copy.
 * @returns {Promise<object>} the module
 */
async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'editor-plain-text-enter-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
export { plainTextEnter, editorKeymapRest } from './src/client/CodeEditor.jsx'
export { EditorState } from '@codemirror/state'
export { language } from '@codemirror/language'
export { markdown } from '@codemirror/lang-markdown'
`,
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'editor-plain-text-enter-entry.jsx',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: ['node20'],
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
 * A view that is only a state and a dispatch: the binding of Enter needs
 * nothing else, and a real view would need a DOM.
 * @param {any} state the state of the editor
 * @returns {any} the fake view
 */
function fakeView(state) {
  const view = {
    state,
    // CodeMirror dispatches a TRANSACTION; a spec is accepted as well.
    dispatch: transaction => {
      view.state = transaction.state ?? view.state.update(transaction)
    },
  }
  return view
}

test('Enter in a file without a grammar does not copy the indentation', async () => {
  const { plainTextEnter, EditorState } = await loadModule()
  const doc = ' ** 1\n ** 2'
  // The cursor sits at the end of the buffer, as it does after typing.
  const state = EditorState.create({ doc, selection: { anchor: doc.length } })
  const view = fakeView(state)
  const handled = plainTextEnter().run(view)
  assert.equal(handled, true, 'the binding of the core must handle the Enter')
  assert.equal(
    view.state.doc.toString(),
    ' ** 1\n ** 2\n',
    'the new line must not inherit the whitespace of the line above',
  )
})

test('Enter in a file with a grammar is left to the grammar', async () => {
  const { plainTextEnter, EditorState, markdown } = await loadModule()
  const state = EditorState.create({ doc: ' ** 1', extensions: [markdown()] })
  const view = fakeView(state)
  const handled = plainTextEnter().run(view)
  assert.equal(handled, false, 'the rules of the grammar must win')
  assert.equal(view.state.doc.toString(), ' ** 1', 'the document must not change')
})

test('the binding of the core comes before the default keymap of CodeMirror', async () => {
  const { editorKeymapRest } = await loadModule()
  const entries = editorKeymapRest()
  const enter = entries.find(entry => entry.key === 'Enter')
  assert.ok(enter !== undefined, 'the keymap must bind Enter')
  const defaultIndex = entries.findIndex(entry => entry.key === 'Enter' && entry.run?.name === 'insertNewlineAndIndent')
  const ownIndex = entries.indexOf(enter)
  if (defaultIndex >= 0) {
    assert.ok(ownIndex < defaultIndex, 'the binding of the core must win over the default')
  }
})
