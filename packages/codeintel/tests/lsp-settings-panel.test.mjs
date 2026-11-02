/**
 * The settings page of the code intelligence (S7).
 *
 * The global `lsp.memoryLimitMB` is a cap over EVERY language server, and
 * the per-language `lsp.servers[languageId].memoryLimitMB` replaces that cap
 * for one language (the host: `src/host/lsp.js`). Without an input for it
 * the user could only LOWER a language, never raise it - and the hint said
 * nothing about it, so raising the global value changed nothing and looked
 * like a setting that does not work.
 *
 * The panel is mounted without a DOM: a static markup cannot prove that
 * typing a number writes the setting, and the test environment has no DOM.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { en, zh } from '../src/client/i18n.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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
        contents: "export { SettingsForm } from './src/client/settings.jsx'\n",
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
      },
      resources: null,
    },
  }
}

/**
 * The switch of one language in the language-server list.
 *
 * The row of a language is the `iwb-settings-language` block that carries the
 * name of the language; the switch is the first checkbox inside it.
 * @param {object} tree the tree of the panel
 * @param {string} languageId the language to look for
 * @returns {object|undefined} the switch
 */
function languageSwitch(tree, languageId) {
  const row = elementsOf(tree).find(element => {
    if (element.props?.className !== 'iwb-settings-language') return false
    return elementsOf(element).some(child =>
      child.props?.className === 'iwb-settings-language-name' && child.props?.children === languageId)
  })
  if (row === undefined) return undefined
  return elementsOf(row).find(element => element.props?.type === 'checkbox')
}

/**
 * Every text the panel shows.
 * @param {object} tree the tree of the panel
 * @returns {string[]} the texts
 */
function textsOf(tree) {
  const texts = []
  const walk = node => {
    if (typeof node === 'string') { texts.push(node); return }
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (node.props === undefined) return
    walk(node.props.children)
  }
  walk(tree)
  return texts
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

// ── one switch per language (no second "turned off" list) ──────────────────
//
// A language that is switched off used to leave the switch list of the
// "语言服务器" group and to show up in a second group ("已关闭的语言服务器")
// instead. From there it could never be switched on again - the user hit
// exactly that with javascript and yaml. One checkbox per language is
// enough: a checked box means "on", an empty box means "off".

test('a language that is switched off keeps its row and can be switched on again', async () => {
  const mod = await loadPanel()
  const store = panelStore()
  // The language is switched off in the settings file, and the host reports
  // it as installed - but switched off.
  const state = panelState({ servers: { typescript: { enabled: false } } })
  state.lsp.servers.available = [{
    languageId: 'typescript',
    command: 'typescript-language-server',
    source: 'PATH',
    resolvedPath: 'C:\\npm\\typescript-language-server.cmd',
    enabled: false,
  }]
  const mounted = mount(mod.SettingsForm, () => ({ store, state }))
  try {
    const row = languageSwitch(mounted.tree, 'typescript')
    assert.ok(row !== undefined, 'the switched-off language still has its row')
    assert.equal(row.props.checked, false, 'the switch of the switched-off language is empty')
    // The user clicks the switch: the language is switched on again.
    row.props.onChange({ target: { checked: true } })
    await settle()
    assert.equal(store.patches.length, 1, 'the panel sent one patch')
    const entry = store.patches[0].lsp.servers.typescript
    assert.equal(entry.enabled, true, 'the language was switched on')
    // The switch is on now - the page shows what it wrote.
    assert.equal(languageSwitch(mounted.tree, 'typescript').props.checked, true)
  } finally {
    mounted.unmount()
  }
})

test('the bucket of an older host is merged into the switch list', async () => {
  const mod = await loadPanel()
  const store = panelStore()
  // A host that still runs the old code does not list a language that is
  // switched off under `available`: it puts it into a `disabled` bucket.
  // The page has to show that language as well, or the user cannot switch
  // it back on before the host process is restarted.
  const state = panelState({ servers: { yaml: { enabled: false } } })
  state.lsp.servers.disabled = [{ languageId: 'yaml', command: 'yaml-language-server' }]
  const mounted = mount(mod.SettingsForm, () => ({ store, state }))
  try {
    const row = languageSwitch(mounted.tree, 'yaml')
    assert.ok(row !== undefined, 'the language of the old bucket has a row')
    assert.equal(row.props.checked, false, 'the switch of the switched-off language is empty')
    // The language is in the list exactly once.
    const names = elementsOf(mounted.tree)
      .filter(element => element.props?.className === 'iwb-settings-language-name')
      .map(element => element.props.children)
    assert.deepEqual(names, ['typescript', 'yaml'])
    // The user clicks the switch: the language is switched on again.
    row.props.onChange({ target: { checked: true } })
    await settle()
    assert.equal(store.patches.length, 1, 'the panel sent one patch')
    assert.equal(store.patches[0].lsp.servers.yaml.enabled, true, 'the language was switched on')
  } finally {
    mounted.unmount()
  }
})

test('the page has no "language servers turned off" row any more', async () => {
  const mod = await loadPanel()
  const store = panelStore()
  const state = panelState({ servers: { yaml: { enabled: false } } })
  state.lsp.servers.disabled = [{ languageId: 'yaml', command: 'yaml-language-server' }]
  const mounted = mount(mod.SettingsForm, () => ({ store, state }))
  try {
    // The old row listed the languages that are switched off with their
    // command. That list does not exist any more.
    const values = elementsOf(mounted.tree)
      .filter(element => element.props?.className === 'iwb-settings-value')
      .map(element => element.props?.children)
    assert.ok(!values.includes('yaml (yaml-language-server)'), 'the redundant list is gone')
    // The language has a row of its own instead.
    assert.ok(textsOf(mounted.tree).includes('yaml'), 'the switched-off language is listed')
  } finally {
    mounted.unmount()
  }
  // The text of the old row is gone from both locale tables as well: the
  // page cannot show a section that has no name any more.
  assert.equal('settings.lspServersDisabled' in en, false, 'the English text is gone')
  assert.equal('settings.lspServersDisabledHint' in en, false, 'the English hint is gone')
  assert.equal('settings.lspServersDisabled' in zh, false, 'the Chinese text is gone')
  assert.equal('settings.lspServersDisabledHint' in zh, false, 'the Chinese hint is gone')
})

test('a language that is switched off and not installed keeps its row', async () => {
  const mod = await loadPanel()
  const store = panelStore()
  // The host puts a language that is switched off AND not installed into the
  // bucket of the missing servers - and it carries the switch there too.
  // Without a row in the switch list the user could only switch it on again
  // by editing the settings file (review R6-2).
  const state = panelState({ servers: { java: { enabled: false } } })
  state.lsp.servers.missing = [{
    languageId: 'java',
    command: 'jdtls',
    hint: 'install jdtls and make sure it is on PATH',
    enabled: false,
  }]
  const mounted = mount(mod.SettingsForm, () => ({ store, state }))
  try {
    const row = languageSwitch(mounted.tree, 'java')
    assert.ok(row !== undefined, 'the switched-off language has its row')
    assert.equal(row.props.checked, false, 'the switch of the switched-off language is empty')
    // The title of the row is the install advice of the host: the language
    // shows up nowhere else, so this is the last place that can say how to
    // install it.
    const label = elementsOf(mounted.tree).find(element =>
      element.props?.className === 'iwb-settings-language-toggle'
      && elementsOf(element).some(child =>
        child.props?.className === 'iwb-settings-language-name' && child.props?.children === 'java'))
    assert.ok(label !== undefined, 'the row has its label')
    assert.equal(label.props.title, 'install jdtls and make sure it is on PATH', 'the hint of the host is the title')
    // The user clicks the switch: the language is switched on again.
    row.props.onChange({ target: { checked: true } })
    await settle()
    assert.equal(store.patches.length, 1, 'the panel sent one patch')
    assert.equal(store.patches[0].lsp.servers.java.enabled, true, 'the language was switched on')
  } finally {
    mounted.unmount()
  }
})

test('the "not found" row lists the languages that are wanted', async () => {
  const mod = await loadPanel()
  const store = panelStore()
  const state = panelState()
  state.lsp.servers.missing = [
    { languageId: 'java', command: 'jdtls', hint: 'install jdtls', enabled: false },
    { languageId: 'go', command: 'gopls', hint: 'install gopls', enabled: true },
  ]
  const mounted = mount(mod.SettingsForm, () => ({ store, state }))
  try {
    const values = elementsOf(mounted.tree)
      .filter(element => element.props?.className === 'iwb-settings-value')
      .map(element => String(element.props?.children ?? ''))
    // A language that the user switched off is not announced as missing any
    // more: the status bar filters it the same way, and the two interfaces
    // must not use the same word for two different things (review R6-3).
    assert.ok(!values.some(value => value.includes('java')), 'the switched-off language is not announced as missing')
    assert.ok(values.some(value => value.includes('go')), 'the wanted language is announced as missing')
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
