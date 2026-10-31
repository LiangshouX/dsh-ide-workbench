import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { build } from 'esbuild'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  DEFAULT_SETTINGS, SETTINGS_VERSION, SettingsStore, migrateLspSettings, settingsFile,
} from '../src/host/settings-store.js'
import { DEFAULT_LSP_SETTINGS } from '../src/host/settings-defaults.js'
import { en, zh } from '../src/client/i18n.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** A throwaway profile directory with one settings document in it. */
async function withProfile(document, run) {
  const base = await mkdtemp(join(tmpdir(), 'iwb-settings-'))
  const previous = process.env.DSH_PROFILE_DIR
  process.env.DSH_PROFILE_DIR = base
  try {
    if (document !== undefined) {
      const file = settingsFile()
      await mkdir(join(base, 'ide-workbench'), { recursive: true })
      await writeFile(file, JSON.stringify(document, null, 2), 'utf8')
    }
    await run(base)
  } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previous
    await rm(base, { recursive: true, force: true })
  }
}

test('the settings schema is version 4', () => {
  assert.equal(SETTINGS_VERSION, 4)
  assert.equal(DEFAULT_SETTINGS.version, 4)
})

test('the lsp section carries the PRD-v5 defaults', () => {
  const lsp = DEFAULT_SETTINGS.lsp
  assert.equal(lsp.enabled, true)
  assert.equal(lsp.indexOnOpen, 'ask')
  assert.equal(lsp.memoryLimitMB, 2048)
  // The free memory is a conservative fallback now, not a hard gate.
  assert.equal(lsp.freeMemoryThresholdMB, 512)
  assert.equal(lsp.memoryHeadroom, 1.5)
  assert.equal(lsp.memoryHardFloorMB, 256)
  assert.equal(lsp.idleTimeoutMs, 600000)
  assert.equal(lsp.cancelAfterMs, 60000)
  assert.equal(lsp.autoExit, true)
  assert.equal(lsp.autoRestart, true)
  assert.deepEqual(lsp.servers, {})
  assert.deepEqual(lsp.indexedRoots, {})
  assert.deepEqual(lsp.memoryWarnedRoots, {})
})

test('the LSP request timeout never falls below the library default of 3000 ms', () => {
  // The client library times out after 3000 ms on its own; a large project
  // silently fails under that value, so the default has to be higher.
  assert.ok(DEFAULT_SETTINGS.lsp.requestTimeoutMs >= 30000)
  assert.equal(DEFAULT_SETTINGS.lsp.requestTimeoutMs, 30000)
})

test('the defaults of the shared module are the ones of the settings document', () => {
  // The client reads the defaults from the shared module (the "reset to
  // defaults" button of the settings page needs them), the host writes them
  // into the document. The two must not drift apart.
  assert.deepEqual(DEFAULT_LSP_SETTINGS, DEFAULT_SETTINGS.lsp)
})

test('the four navigation shortcuts have the documented defaults', () => {
  assert.equal(DEFAULT_SETTINGS.shortcuts.findUsages, 'Alt+F7')
  assert.equal(DEFAULT_SETTINGS.shortcuts.findUsagesText, 'Alt+F8')
  assert.equal(DEFAULT_SETTINGS.shortcuts.goToDefinition, 'F12')
  assert.equal(DEFAULT_SETTINGS.shortcuts.complete, 'Ctrl+Space')
})

test('the new shortcuts do not collide with the existing ones', () => {
  const values = Object.values(DEFAULT_SETTINGS.shortcuts)
  assert.equal(new Set(values).size, values.length)
  // F2 (rename file) and Shift+F6 (update references) keep their keys: the
  // language server's own rename keymap is deliberately not installed.
  assert.equal(DEFAULT_SETTINGS.shortcuts.rename, 'F2')
  assert.equal(DEFAULT_SETTINGS.shortcuts.renameRefs, 'Shift+F6')
  // The library's reference keymap (Shift+F12) and format keymap stay out.
  assert.ok(!values.includes('Shift+F12'))
  assert.ok(!values.includes('Shift-Alt-f'))
  assert.equal(values.filter(value => value === 'F12').length, 1)
  assert.equal(values.filter(value => value === 'Alt+F7').length, 1)
  assert.equal(values.filter(value => value === 'Alt+F8').length, 1)
})

test('a schema 2 document without an lsp section keeps every other setting', async () => {
  await withProfile({
    version: 2,
    lastRoot: 'D:\\Code\\keep-me',
    git: { path: 'C:\\git\\bin\\git.exe' },
    shortcuts: { findInFiles: 'Ctrl+Shift+R' },
  }, async () => {
    const store = new SettingsStore()
    const value = await store.get()
    assert.equal(value.version, 4)
    // The old settings survived.
    assert.equal(value.lastRoot, 'D:\\Code\\keep-me')
    assert.equal(value.git.path, 'C:\\git\\bin\\git.exe')
    assert.equal(value.shortcuts.findInFiles, 'Ctrl+Shift+R')
    // The lsp section was filled in from the defaults.
    assert.equal(value.lsp.enabled, true)
    assert.equal(value.lsp.requestTimeoutMs, 30000)
    assert.deepEqual(value.lsp.indexedRoots, {})
    // The new shortcuts were added without losing the old ones.
    assert.equal(value.shortcuts.findUsages, 'Alt+F7')
    assert.equal(value.shortcuts.rename, 'F2')
  })
})

test('a schema 2 document is backed up before the migration', async () => {
  await withProfile({ version: 2, lastRoot: 'D:\\Code\\keep-me' }, async (base) => {
    const store = new SettingsStore()
    await store.get()
    const files = await readdir(join(base, 'ide-workbench'))
    assert.ok(files.includes('settings.json.v2.bak.json'), files.join(', '))
    const backup = JSON.parse(await readFile(join(base, 'ide-workbench', 'settings.json.v2.bak.json'), 'utf8'))
    assert.equal(backup.version, 2)
  })
})

test('the migration raises a request timeout that is too small', () => {
  const value = { lsp: { requestTimeoutMs: 3000 } }
  migrateLspSettings(value)
  assert.equal(value.lsp.requestTimeoutMs, 30000)
  const worse = { lsp: { requestTimeoutMs: 'soon' } }
  migrateLspSettings(worse)
  assert.equal(worse.lsp.requestTimeoutMs, 30000)
})

test('the migration keeps a user-chosen timeout that is large enough', () => {
  const value = { lsp: { requestTimeoutMs: 120000 } }
  migrateLspSettings(value)
  assert.equal(value.lsp.requestTimeoutMs, 120000)
})

test('the migration repairs a broken indexedRoots map', () => {
  const value = { lsp: { indexedRoots: 'nonsense' } }
  migrateLspSettings(value)
  assert.deepEqual(value.lsp.indexedRoots, {})
})

test('the migration never touches the settings outside the lsp section', () => {
  const value = {
    lastRoot: 'D:\\Code',
    git: { path: 'C:\\git' },
    shortcuts: { rename: 'F3' },
    lsp: { enabled: false },
  }
  migrateLspSettings(value)
  assert.equal(value.lastRoot, 'D:\\Code')
  assert.equal(value.git.path, 'C:\\git')
  assert.equal(value.shortcuts.rename, 'F3')
  assert.equal(value.lsp.enabled, false)
})

test('the indexed roots survive a restart because they live in the document', async () => {
  await withProfile({ version: 3, lsp: { indexedRoots: { 'D:\\Code\\app': { at: 1700000000000, languageId: 'typescript' } } } }, async () => {
    const store = new SettingsStore()
    const value = await store.get()
    assert.equal(value.lsp.indexedRoots['D:\\Code\\app'].languageId, 'typescript')
    assert.equal(value.lsp.indexedRoots['D:\\Code\\app'].at, 1700000000000)
  })
})

// ── the per-language ceiling of the settings page (S7) ────────────────────
//
// The global `lsp.memoryLimitMB` is a cap over EVERY language server, and
// the per-language `lsp.servers[languageId].memoryLimitMB` replaces that cap
// for one language (the host: `src/host/lsp.js`). Without an input for it
// the user could only LOWER a language, never raise it - and the hint said
// nothing about it, so raising the global value changed nothing and looked
// like a setting that does not work.
//
// The panel is mounted without a DOM: a static markup cannot prove that
// typing a number writes the setting, and the test environment has no DOM.

let panelPromise

/**
 * The settings panel, bundled.
 *
 * The panel is a `.jsx` file, which Node cannot import. esbuild turns it into
 * a module inside the package, so `react` resolves from the package's own
 * `node_modules` and the test and the panel share one React instance - the
 * dispatcher below only reaches the panel if both use the same one.
 * @returns {Promise<{SettingsForm: Function}>} the bundled panel
 */
function loadPanel() {
  if (panelPromise !== undefined) return panelPromise
  panelPromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'settings-panel-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: "export { SettingsForm } from './src/client/SettingsPanel.jsx'\n",
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'settings-panel-entry.jsx',
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
  return panelPromise
}

/**
 * Whether two dependency lists ask for the same effect.
 * @param {unknown[]|undefined} left
 * @param {unknown[]|undefined} right
 * @returns {boolean}
 */
function sameDeps(left, right) {
  if (left === undefined || right === undefined) return false
  if (left.length !== right.length) return false
  return left.every((value, at) => Object.is(value, right[at]))
}

/**
 * Mount a component without a DOM.
 *
 * The hooks of React are only a dispatcher away: the component asks the
 * current dispatcher, not React itself. This runner keeps the state of the
 * hooks, renders again when a state changes and calls the effects after
 * every render. The tree of the render is handed back, so a test can hit the
 * very element the user would hit.
 * @param {Function} Component the component to mount
 * @param {object|(() => object)} props the props; a function is called for
 *   every render, so the component always sees the live state
 * @returns {{tree: object|null, unmount: () => void}} the mounted component
 */
function mount(Component, props) {
  const cells = []
  const effects = []
  let cursor = 0
  let tree = null
  let dirty = false
  let rendering = false
  let pending = false

  const dispatcher = {
    useState(initial) {
      const slot = cursor++
      if (cells[slot] === undefined) cells[slot] = { value: typeof initial === 'function' ? initial() : initial }
      const cell = cells[slot]
      const setValue = (next) => {
        const value = typeof next === 'function' ? next(cell.value) : next
        if (Object.is(value, cell.value)) return
        cell.value = value
        dirty = true
        // A state change renders again, the way React does it.
        schedule()
      }
      return [cell.value, setValue]
    },
    useRef(initial) {
      const slot = cursor++
      if (cells[slot] === undefined) cells[slot] = { current: initial }
      return cells[slot]
    },
    useMemo(factory, deps) {
      const slot = cursor++
      const cell = cells[slot]
      if (cell === undefined || !sameDeps(cell.deps, deps)) cells[slot] = { deps, value: factory() }
      return cells[slot].value
    },
    useEffect(fn, deps) {
      const slot = cursor++
      const cell = cells[slot]
      const changed = cell === undefined || !sameDeps(cell.deps, deps)
      cells[slot] = { deps, fn, changed, cleanup: cell?.cleanup }
      effects.push(cells[slot])
    },
  }

  const renderOnce = () => {
    cursor = 0
    effects.length = 0
    const internals = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
    const previous = internals.ReactCurrentDispatcher.current
    internals.ReactCurrentDispatcher.current = dispatcher
    try {
      tree = Component(typeof props === 'function' ? props() : props)
    } finally {
      internals.ReactCurrentDispatcher.current = previous
    }
    for (const cell of effects) {
      if (cell.changed !== true) continue
      if (typeof cell.cleanup === 'function') cell.cleanup()
      const cleanup = cell.fn()
      cell.cleanup = typeof cleanup === 'function' ? cleanup : undefined
    }
  }

  const run = () => {
    if (rendering === true) { pending = true; return }
    rendering = true
    try {
      for (let round = 0; round < 20; round += 1) {
        dirty = false
        renderOnce()
        // The store changed while the effects ran: render again.
        if (pending === true) { pending = false; continue }
        if (dirty !== true) break
      }
    } finally {
      rendering = false
    }
  }

  // A render that is asked for while another one runs waits for it.
  const schedule = () => {
    if (rendering === true) { pending = true; return }
    run()
  }

  run()
  return {
    get tree() { return tree },
    unmount() {
      for (const cell of cells) {
        if (typeof cell?.cleanup === 'function') cell.cleanup()
      }
    },
  }
}

/**
 * Every element of a tree.
 * @param {object} tree the root of the tree
 * @returns {object[]} the elements
 */
function elementsOf(tree) {
  const found = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (node.props === undefined) return
    found.push(node)
    walk(node.props.children)
  }
  walk(tree)
  return found
}

/**
 * The ceiling input of one language in the language-server list.
 * @param {object} tree the tree of the panel
 * @param {string} languageId the language to look for
 * @returns {object|undefined} the input
 */
function ceilingInput(tree, languageId) {
  return elementsOf(tree).find(element => {
    const label = element.props?.['aria-label']
    return element.props?.type === 'number'
      && typeof label === 'string'
      && label.includes(languageId)
  })
}

/**
 * A store that records the settings patches the panel sends.
 * @returns {object} the store
 */
function panelStore() {
  const patches = []
  return {
    t: key => key,
    patches,
    updateSettings: async patch => { patches.push(patch); return { ok: true } },
    loadLspServers: async () => {},
    loadLspResources: async () => {},
  }
}

/**
 * The state of the workbench the settings page reads.
 * @param {object} [lsp] the `lsp` section of the settings
 * @returns {object} the state
 */
function panelState(lsp = {}) {
  return {
    settings: {
      git: { path: '', colors: true, commitTemplate: '' },
      idea: { path: '' },
      webstorm: { path: '' },
      vscode: { path: '' },
      terminal: { shell: 'auto', copyOnSelect: false, fontSize: 13 },
      project: { alwaysSelectOpened: true, showHidden: true, showIgnored: false, singleClickOpen: false },
      commit: { groupByDirectory: false },
      delete: { useRecycleBin: true },
      editor: { fontSize: 13, highlight: true, openMode: 'auto', editableMaxBytes: 1 << 20, markdownPreview: true },
      links: { chatFiles: 'ide' },
      shortcuts: {},
      lsp: {
        enabled: true, indexOnOpen: 'ask',
        memoryLimitMB: 2048, freeMemoryThresholdMB: 512, memoryHeadroom: 1.5, memoryHardFloorMB: 256,
        idleTimeoutMs: 600000, requestTimeoutMs: 30000, autoExit: true, autoRestart: true,
        servers: {},
        ...lsp,
      },
    },
    terminal: { shells: [{ id: 'pwsh', label: 'PowerShell' }] },
    lsp: {
      state: 'idle',
      servers: {
        available: [{
          languageId: 'typescript',
          command: 'typescript-language-server',
          source: 'PATH',
          resolvedPath: 'C:\\npm\\typescript-language-server.cmd',
          memoryLimitMB: 2048,
          memoryLimitSupported: true,
        }],
        missing: [],
        disabled: [],
      },
      resources: null,
    },
  }
}

/** Let the debounce of the panel (300 ms) and the store settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 400))

test('the settings page renders a memory ceiling for every language', async () => {
  const mod = await loadPanel()
  const store = panelStore()
  const state = panelState()
  const mounted = mount(mod.SettingsForm, () => ({ store, state }))
  try {
    const input = ceilingInput(mounted.tree, 'typescript')
    assert.ok(input !== undefined, 'the language row carries a ceiling input')
    // No ceiling of its own: the field is empty, so the global one applies.
    assert.equal(input.props.value, '')
    // The row still carries the switch and the command of the language.
    const names = elementsOf(mounted.tree)
      .filter(element => element.props?.className === 'iwb-settings-language-name')
      .map(element => element.props.children)
    assert.deepEqual(names, ['typescript'])
    const switches = elementsOf(mounted.tree)
      .filter(element => element.props?.type === 'checkbox' && element.props?.checked === true)
    assert.ok(switches.length > 0, 'the language still has its switch')
  } finally {
    mounted.unmount()
  }
})

test('the per-language ceiling reads the value of the settings', async () => {
  const mod = await loadPanel()
  const store = panelStore()
  const state = panelState({ servers: { typescript: { enabled: true, memoryLimitMB: 4096 } } })
  const mounted = mount(mod.SettingsForm, () => ({ store, state }))
  try {
    const input = ceilingInput(mounted.tree, 'typescript')
    assert.ok(input !== undefined, 'the language row carries a ceiling input')
    assert.equal(input.props.value, '4096', 'the ceiling of the settings is in the field')
  } finally {
    mounted.unmount()
  }
})

test('typing a per-language ceiling writes it and keeps the other keys of the language', async () => {
  const mod = await loadPanel()
  const store = panelStore()
  const state = panelState({ servers: { typescript: { enabled: false, command: 'tsserver' } } })
  const mounted = mount(mod.SettingsForm, () => ({ store, state }))
  try {
    const input = ceilingInput(mounted.tree, 'typescript')
    assert.ok(input !== undefined, 'the language row carries a ceiling input')
    input.props.onChange({ target: { value: '4096' } })
    await settle()
    assert.equal(store.patches.length, 1, 'the panel sent one patch')
    const entry = store.patches[0].lsp.servers.typescript
    assert.equal(entry.memoryLimitMB, 4096, 'the ceiling of this language was written')
    // The other keys of the language survived the write.
    assert.equal(entry.enabled, false, 'the switch of the language survived')
    assert.equal(entry.command, 'tsserver', 'the command of the language survived')
    // The field shows the value that was written.
    assert.equal(ceilingInput(mounted.tree, 'typescript').props.value, '4096')
  } finally {
    mounted.unmount()
  }
})

test('an empty per-language ceiling writes no number', async () => {
  const mod = await loadPanel()
  const store = panelStore()
  const state = panelState({ servers: { typescript: { enabled: true, memoryLimitMB: 4096 } } })
  const mounted = mount(mod.SettingsForm, () => ({ store, state }))
  try {
    const input = ceilingInput(mounted.tree, 'typescript')
    assert.ok(input !== undefined, 'the language row carries a ceiling input')
    input.props.onChange({ target: { value: '' } })
    await settle()
    assert.equal(store.patches.length, 1, 'the panel sent one patch')
    const entry = store.patches[0].lsp.servers.typescript
    // An empty field means "no ceiling of its own": the global one applies.
    // A number the user did not type - and no zero - may not be written.
    assert.ok(!Number.isFinite(entry.memoryLimitMB), 'no number was written')
    assert.notEqual(entry.memoryLimitMB, 0)
    assert.equal(entry.enabled, true, 'the other keys of the language survived')
    // The field is empty again: the global ceiling is in effect.
    assert.equal(ceilingInput(mounted.tree, 'typescript').props.value, '')
  } finally {
    mounted.unmount()
  }
})

test('the global ceiling hint says what the value really does', () => {
  // The user raised the global ceiling and still saw the old one, because
  // the value is a cap over every language and a language keeps its own
  // ceiling. The hint has to say so.
  const hint = en['settings.lspMemoryLimitHint']
  assert.match(hint, /all language servers/i, 'the value is a cap over every language')
  assert.match(hint, /every language/i, 'lowering it lowers every language')
  assert.match(hint, /built-in ceiling/i, 'raising it cannot break through a ceiling of its own')
  const zhHint = zh['settings.lspMemoryLimitHint']
  assert.match(zhHint, /所有语言服务器/, 'the value is a cap over every language')
  assert.match(zhHint, /每个语言/, 'lowering it lowers every language')
  assert.match(zhHint, /内置上限/, 'raising it cannot break through a ceiling of its own')
})

test('the two locale tables carry the same keys and no empty value', () => {
  const enKeys = Object.keys(en)
  const zhKeys = Object.keys(zh)
  assert.deepEqual(zhKeys.filter(key => !enKeys.includes(key)), [], 'the Chinese table has no extra key')
  assert.deepEqual(enKeys.filter(key => !zhKeys.includes(key)), [], 'every key has a Chinese text')
  for (const key of enKeys) {
    assert.ok(typeof en[key] === 'string' && en[key].trim() !== '', `the English text of ${key} is not empty`)
    assert.ok(typeof zh[key] === 'string' && zh[key].trim() !== '', `the Chinese text of ${key} is not empty`)
  }
})
