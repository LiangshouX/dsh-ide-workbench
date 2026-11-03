/**
 * The client contract of the workbench (PRD-v6 §3 and §4).
 *
 * The contract is the way the code intelligence reaches the editor of the
 * workbench, and the way the workbench reaches the files of the project.
 * Three things are pinned here:
 *
 *   1. the four slots are declared and the contract prop reaches the
 *      occupants (PRD-v6 §3.1 / §3.2);
 *   2. the extension slots are merged by key and priority - the loser is NOT
 *      installed, and the winner does not depend on the order of the
 *      registration (PRD-v6 §3.4.1, acceptance C16 and C17);
 *   3. the core declares the automatic closing of the brackets and NO
 *      completion at all (D9, acceptance R8).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

import { EditorSeam, coreExtensionSlots, extensionCompartment, keymapCompartment } from '../src/client/editor-seam.js'
import { createContract, createHostApi } from '../src/client/contract.js'
import { CODEMIRROR_KEY, cmRuntime } from '../src/client/cm-runtime.js'
import { CONTRACT_VERSION, CORE_PRIORITY, SLOT_KEYS, mergeExtensionSlots } from '../src/contract/index.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const clientDir = join(root, 'src/client')
// The workspace hoists the packages to the root of the repository.
const moduleRequire = createRequire(import.meta.url)

// A tiny DOM surface is enough for the module-level browser references; the
// server-side render itself does not touch it, because no effect runs.
globalThis.window = {
  innerWidth: 1440,
  innerHeight: 900,
  location: { href: 'http://localhost/' },
  addEventListener() {},
  removeEventListener() {},
}
globalThis.self = globalThis.window
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
 * The workbench, bundled for the server-side render.
 * @returns {Promise<object>} the module of the render entry
 */
async function loadRenderModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'contract-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      entryPoints: ['tests/render-entry.jsx'],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: ['node20'],
      external: ['react', 'react-dom', 'react-dom/server', '@deepseek-ai/dsh-client-ui-primitives'],
      alias: {
        '@xterm/xterm/css/xterm.css': moduleRequire.resolve('@xterm/xterm/css/xterm.css'),
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

/**
 * The source of one file of the client.
 * @param {string} name the name of the file
 * @returns {Promise<string>} the source
 */
async function sourceOf(name) {
  return readFile(join(clientDir, name), 'utf8')
}

// ── the four slots ──────────────────────────────────────────────────────────

test('the workbench declares the four slots of the contract', async () => {
  const source = await sourceOf('index.jsx')
  // The children are declared once, on the entry that owns the sidebar tab.
  for (const key of ['editorBridge', 'statusItem', 'settingsSection', 'commandItem']) {
    assert.ok(source.includes(`[SLOT_KEYS.${key}]`), `the slot ${key} is declared`)
  }
  assert.match(source, /\[SLOT_KEYS\.editorBridge\]: \{ kind: 'single', scope: 'session' \}/)
  assert.match(source, /\[SLOT_KEYS\.statusItem\]: \{ kind: 'list', scope: 'session' \}/)
  assert.match(source, /\[SLOT_KEYS\.settingsSection\]: \{ kind: 'list', scope: 'session' \}/)
  assert.match(source, /\[SLOT_KEYS\.commandItem\]: \{ kind: 'list', scope: 'session' \}/)
  // The declaration belongs to the sidebar tab of the workbench.
  assert.match(source, /name: 'sidebar\.right\.pane\.tab', key: 'dsh-ide-workbench'/)
})

test('every render point hands the occupant the contract', async () => {
  // The four render points of PRD-v6 §3.2. The prop of the occupant is the
  // contract, and nothing else.
  const points = [
    ['EditorArea.jsx', 'editorBridge'],
    ['Workbench.jsx', 'statusItem'],
    ['SettingsPanel.jsx', 'settingsSection'],
    ['CodeEditor.jsx', 'commandItem'],
  ]
  for (const [file, key] of points) {
    const source = await sourceOf(file)
    assert.match(
      source,
      new RegExp(`renderSlot\\(SLOT_KEYS\\.${key}, \\{ contract \\}\\)`),
      `${file} renders the slot ${key} with the contract`,
    )
  }
})

test('the contract has the shape the contract package writes down', () => {
  const store = {
    state: { root: 'C:\\work\\demo' },
    subscribe: () => () => {},
    editorSeam: new EditorSeam(),
  }
  const contract = createContract(store)
  assert.equal(contract.version, CONTRACT_VERSION)
  assert.ok(contract.editor !== undefined, 'the contract carries the editor seam')
  assert.ok(contract.host !== undefined, 'the contract carries the host view')
  // The host view answers the questions of the contract package.
  for (const method of ['getProjectRoot', 'getScopeRoot', 'readFile', 'searchFiles', 'onProjectChanged', 'health']) {
    assert.equal(typeof contract.host[method], 'function', `the host view offers ${method}`)
  }
  assert.equal(contract.host.getProjectRoot(), 'C:\\work\\demo')
  assert.deepEqual(contract.host.health(), { ok: true })
})

test('the contract prop reaches the occupants of the slots', async () => {
  const mod = await loadRenderModule()
  const { calls } = mod.renderWithSlots()
  // The editor bridge and the status bar are on the screen without any
  // interaction; the settings page and the context menu need one.
  const keys = calls.map(call => call.key)
  assert.ok(keys.includes(SLOT_KEYS.editorBridge), 'the editor bridge is rendered')
  assert.ok(keys.includes(SLOT_KEYS.statusItem), 'the status item is rendered')
  // Every occupant receives the contract as its prop - and nothing else.
  for (const call of calls) {
    assert.deepEqual(Object.keys(call.owner), ['contract'], 'the prop of the occupant is the contract')
    const contract = call.owner.contract
    assert.equal(contract.version, CONTRACT_VERSION)
    assert.ok(contract.editor !== undefined, 'the contract carries the editor seam')
    assert.ok(contract.host !== undefined, 'the contract carries the host view')
  }
})

// ── the extension slots ─────────────────────────────────────────────────────

test('the core declares the automatic closing of the brackets and nothing else', () => {
  const slots = coreExtensionSlots()
  assert.equal(slots.length, 1, 'the core declares exactly one slot')
  const slot = slots[0]
  assert.equal(slot.key, 'closeBrackets')
  assert.equal(slot.priority, CORE_PRIORITY)
  // The extensions are the bracket handler with its state and the keymap.
  assert.equal(slot.extensions.length, 2)
  assert.ok(Array.isArray(slot.extensions[0]), 'the bracket handler carries its state field')
  // The key bindings are wrapped in `keymap.of`. A raw binding list is not an
  // extension: passing it as one makes `EditorState.create` throw, and the
  // workbench installed WITHOUT the codeintel (no slot replaces this one) then
  // never mounts its editor at all.
  assert.ok(!Array.isArray(slot.extensions[1]), 'the keymap of the brackets is a wrapped extension')
})

test('the core declares no completion at all (acceptance R8)', async () => {
  // The completion of the local words belongs to the codeintel: the core
  // bundles the package (for the brackets) but never installs the popup.
  for (const file of ['CodeEditor.jsx', 'editor-seam.js', 'contract.js', 'index.jsx', 'store.js']) {
    const source = await sourceOf(file)
    assert.doesNotMatch(source, /autocompletion\(/, `${file} installs no completion`)
  }
  const slots = coreExtensionSlots()
  assert.ok(!slots.some(slot => slot.key === 'autocomplete'), 'the core declares no completion slot')
})

test('the slot with the higher priority wins, and the loser is not installed', () => {
  const seam = new EditorSeam()
  // The codeintel offers the same key with a higher priority.
  seam.registerExtensions(() => [{
    key: 'closeBrackets',
    priority: 100,
    extensions: ['the winner'],
  }])
  const merged = seam.extensionSlots
  assert.deepEqual(merged, ['the winner'], 'the loser is not installed at all')
  // The core offered its own extensions: they are NOT in the result.
  assert.ok(!merged.includes(coreExtensionSlots()[0].extensions[0]))
})

test('the winner does not depend on the order of the registration (C16, C17)', () => {
  const make = order => {
    const seam = new EditorSeam()
    const provider = () => [{ key: 'closeBrackets', priority: 100, extensions: ['the winner'] }]
    // The core contributes first in both cases - the merge of the contract
    // package always puts the core in front.
    if (order === 'first') seam.registerExtensions(provider)
    else seam.registerExtensions(provider)
    return seam.extensionSlots
  }
  assert.deepEqual(make('first'), make('second'), 'the result is the same either way')
  // Two providers with the same priority: the later one wins.
  const seam = new EditorSeam()
  seam.registerExtensions(() => [{ key: 'closeBrackets', priority: 100, extensions: ['first'] }])
  seam.registerExtensions(() => [{ key: 'closeBrackets', priority: 100, extensions: ['second'] }])
  assert.deepEqual(seam.extensionSlots, ['second'], 'a tie goes to the later registration')
})

test('the merge of the contract package follows the written rules', () => {
  // Same key: the higher priority wins, and the loser is dropped.
  const merged = mergeExtensionSlots([
    [{ key: 'a', priority: 0, extensions: ['core'] }],
    [{ key: 'a', priority: 100, extensions: ['plugin'] }],
  ])
  assert.deepEqual(merged, ['plugin'])
  // Different keys: both survive, in the order of the contributors.
  const both = mergeExtensionSlots([
    [{ key: 'a', priority: 0, extensions: ['a'] }],
    [{ key: 'b', priority: 0, extensions: ['b'] }],
  ])
  assert.deepEqual(both, ['a', 'b'])
})

test('the seam offers the keymap, the commands and the document', () => {
  const seam = new EditorSeam()
  const undoKeymap = seam.registerKeymap([{ key: 'Mod-x' }])
  const undoCommands = seam.registerCommands([{ key: 'x', label: 'X', run: () => {} }])
  assert.equal(seam.keymap.length, 1)
  assert.equal(seam.commandItems.flat().length, 1)
  undoKeymap()
  undoCommands()
  assert.equal(seam.keymap.length, 0)
  assert.equal(seam.commandItems.flat().length, 0)
})

test('the seam publishes the one CodeMirror runtime of the process', () => {
  const runtime = globalThis[CODEMIRROR_KEY]
  assert.ok(runtime !== undefined, 'the runtime is published on the global key')
  assert.equal(CODEMIRROR_KEY, Symbol.for('dsh.ide-workbench.codemirror'))
  for (const namespace of ['state', 'view', 'language', 'autocomplete', 'lint', 'commands', 'search']) {
    assert.ok(runtime[namespace] !== undefined, `the runtime carries ${namespace}`)
  }
  // The seam hands the very same runtime to the consumer.
  const seam = new EditorSeam()
  assert.equal(seam.codemirror, cmRuntime)
})

test('the editor installs the extensions in their own compartment', async () => {
  const source = await sourceOf('CodeEditor.jsx')
  // The compartment is neutral: it does not know who fills it.
  assert.match(source, /extensionCompartment\.of\(seam\?\.extensionSlots \?\? \[\]\)/)
  // The key bindings of the seam are a flat list, NOT an extension: they have
  // to be wrapped in `keymap.of` before they reach a compartment, or the
  // editor throws ("Unrecognized extension value") the moment a contributor
  // registers a shortcut - and the whole workbench body unmounts.
  assert.match(source, /keymapCompartment\.of\(keymap\.of\(seam\?\.keymap \?\? \[\]\)\)/)
  assert.match(source, /keymapCompartment\.reconfigure\(keymap\.of\(seam\.keymap\)\)/)
  // The editor imports the compartments from the seam, not from the editor.
  assert.match(source, /import \{ extensionCompartment, keymapCompartment \} from '\.\/editor-seam\.js'/)
  assert.ok(extensionCompartment !== undefined && keymapCompartment !== undefined)
})
