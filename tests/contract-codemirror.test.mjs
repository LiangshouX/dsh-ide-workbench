/**
 * The contract test of the ONE CodeMirror runtime (PRD-v6 §3.5, spike S1).
 *
 * Two plugins, one editor. The extensions of CodeMirror are checked with
 * `instanceof`, and the ids of the state fields come from a module level
 * counter - two copies of `@codemirror/state` in the page therefore break
 * the editor:
 *
 *   "Unrecognized extension value in extension set (...). This sometimes
 *    happens because multiple instances of @codemirror/state are loaded,
 *    breaking instanceof checks."  (@codemirror/state)
 *
 * The core therefore owns the runtime and the codeintel reaches it through
 * a Proxy shim. This test builds the two halves the way the two plugins are
 * built and proves that:
 *
 *   1. the codeintel loads while the runtime is NOT bound - the "codeintel
 *      alone" case must show a guidance, not a crash (DEG-01, B1);
 *   2. using a capability before the binding fails with a READABLE error;
 *   3. after the core published the runtime the codeintel works;
 *   4. an extension the codeintel built is accepted by an EditorState the
 *      core created - the `instanceof` check must not fail;
 *   5. `instanceof` works across the boundary.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const shimDirectory = resolve(root, 'packages', 'codeintel', 'src', 'client', 'vendor')
const CM_PACKAGES = ['state', 'view', 'language', 'autocomplete', 'lint', 'commands', 'search']

/** The core half: it owns the real packages and publishes the runtime. */
const CORE_SOURCE = `
import * as state from '@codemirror/state'
import * as view from '@codemirror/view'
import * as language from '@codemirror/language'
import * as autocomplete from '@codemirror/autocomplete'
import * as lint from '@codemirror/lint'
globalThis[Symbol.for('dsh.ide-workbench.codemirror')] = { state, view, language, autocomplete, lint }
export function makeState(extra) { return state.EditorState.create({ extensions: extra }) }
export { state, view }
`

/** The codeintel half: every CodeMirror package is aliased to the shim. */
const INTEL_SOURCE = `
import { EditorState, StateField } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Workspace } from '@codemirror/lsp-client'
export function buildExtension() {
  return [
    StateField.define({ create: () => 1, update: (v) => v }),
    EditorView.editable.of(true),
    typeof Workspace === 'function' ? [] : [],
  ]
}
export { StateField, EditorState }
`

/** The wrapper the DSH client module loader uses. */
const wrap = (bundle) => `(function(require){
  var module = { exports: {} };
  var exports = module.exports;
${bundle}
  return module.exports;
})`

/**
 * A sandbox with just enough DOM for the modules to be loaded.
 * @returns {any} the sandbox
 */
function makeSandbox() {
  const element = () => ({
    style: {},
    classList: { add () {}, remove () {}, contains: () => false },
    setAttribute () {}, appendChild () {}, removeChild () {},
    addEventListener () {}, removeEventListener () {},
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
  })
  const sandbox = {
    console,
    document: {
      createElement: element, createTextNode: () => ({}), createRange: () => ({}),
      documentElement: element(), body: element(),
      addEventListener () {}, removeEventListener () {},
    },
    navigator: { userAgent: 'node', platform: 'linux', maxTouchPoints: 0 },
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: () => {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    MutationObserver: class { observe () {} disconnect () {} },
    ResizeObserver: class { observe () {} disconnect () {} },
  }
  sandbox.globalThis = sandbox
  sandbox.window = sandbox
  sandbox.self = sandbox
  return sandbox
}

/**
 * Build the two halves and load them into one sandbox.
 * @returns {Promise<{intel: any, core: any, context: any}>} the loaded halves
 */
async function loadBoth() {
  const alias = {}
  for (const name of CM_PACKAGES) alias[`@codemirror/${name}`] = resolve(shimDirectory, `cm-${name}.js`)

  const core = await build({
    absWorkingDir: root,
    stdin: { contents: CORE_SOURCE, resolveDir: root, loader: 'js' },
    bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'warning',
  })
  const intel = await build({
    absWorkingDir: root,
    stdin: { contents: INTEL_SOURCE, resolveDir: root, loader: 'js' },
    bundle: true, format: 'cjs', platform: 'browser', write: false, alias, logLevel: 'warning',
  })

  const context = vm.createContext(makeSandbox())
  const run = (bundle) => vm.runInContext(`(${wrap(bundle)})({})`, context)
  // The codeintel is loaded FIRST: the order of the plugins must not matter.
  const intelExports = run(intel.outputFiles[0].text)
  const coreExports = run(core.outputFiles[0].text)
  return { intel: intelExports, core: coreExports, context }
}

/**
 * Build the codeintel half alone and load it into a fresh sandbox.
 * @returns {Promise<{intel: any, context: any}>} the loaded half
 */
async function loadIntelAlone() {
  const alias = {}
  for (const name of CM_PACKAGES) alias[`@codemirror/${name}`] = resolve(shimDirectory, `cm-${name}.js`)
  const intel = await build({
    absWorkingDir: root,
    stdin: { contents: INTEL_SOURCE, resolveDir: root, loader: 'js' },
    bundle: true, format: 'cjs', platform: 'browser', write: false, alias, logLevel: 'warning',
  })
  const context = vm.createContext(makeSandbox())
  const intelExports = vm.runInContext(`(${wrap(intel.outputFiles[0].text)})({})`, context)
  return { intel: intelExports, context }
}

test('the codeintel loads while the runtime is not bound', async () => {
  const { intel } = await loadIntelAlone()
  assert.equal(typeof intel.buildExtension, 'function')
})

test('an unbound capability throws a readable error', async () => {
  const { intel } = await loadIntelAlone()
  assert.throws(() => intel.buildExtension(), /not bound/)
})

test('the core publishes the runtime', async () => {
  const { context } = await loadBoth()
  const kind = vm.runInContext("typeof globalThis[Symbol.for('dsh.ide-workbench.codemirror')]", context)
  assert.equal(kind, 'object')
})

test('the core accepts the extension of the codeintel', async () => {
  const { intel, core } = await loadBoth()
  const extension = intel.buildExtension()
  assert.doesNotThrow(() => core.makeState(extension))
})

test('instanceof works across the boundary', async () => {
  const { intel, context } = await loadBoth()
  const state = vm.runInContext("globalThis[Symbol.for('dsh.ide-workbench.codemirror')].state", context)
  const field = intel.StateField.define({ create: () => 1, update: (v) => v })
  assert.ok(field instanceof state.StateField)
})
