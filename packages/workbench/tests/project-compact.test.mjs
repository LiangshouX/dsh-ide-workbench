/**
 * R5 — the compact folders (package chains) and the new-entry dialog.
 *
 *   - a chain of folders that holds nothing but one sub-folder is a package
 *     chain and shows up as ONE row with a dot-joined label (the title stays
 *     the full relative path);
 *   - expanding the merged row shows the files of the leaf directly;
 *   - the chain forks where a file or a second folder appears, and it ends
 *     where a folder has not been loaded (no extra directory read);
 *   - the merged row keeps the git status colour and the excluded background
 *     of its leaf, "new file" and "delete" act on the leaf, and a merged
 *     folder cannot be renamed;
 *   - ArrowLeft goes back to the nearest VISIBLE ancestor row;
 *   - the new-entry dialog has a path box: read-only until it is clicked
 *     into, resolved against the project root, and it refuses a path that
 *     leaves the project.
 *
 * The panel is mounted with `renderToStaticMarkup`, the same harness as
 * `tests/tree-twisty.test.mjs` (this package has no jsdom). Static markup
 * carries no event handlers, so `React.createElement` is wrapped to keep every
 * created element: the props can then be driven directly.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// A tiny DOM surface: module-level browser references must not explode even
// though SSR itself never touches them.
globalThis.window = {
  innerWidth: 1440,
  innerHeight: 900,
  location: { href: 'http://localhost/' },
  addEventListener() {},
  removeEventListener() {},
}
globalThis.self = globalThis.window
globalThis.document = {
  baseURI: 'http://localhost/',
  documentElement: { style: {} },
  head: { appendChild() {} },
  body: { style: {}, appendChild() {}, removeChild() {} },
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
}
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
// The tree keyboard handler asks whether the event target is an input.
globalThis.HTMLElement = class HTMLElement {}

const created = []
const originalCreateElement = React.createElement
React.createElement = (type, props, ...children) => {
  const element = originalCreateElement(type, props, ...children)
  created.push(element)
  return element
}

let modulePromise

async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'compact-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      entryPoints: ['src/client/ProjectPanel.jsx'],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: ['node20'],
      external: ['react', 'react-dom', 'react-dom/server'],
      jsx: 'transform',
      define: { 'process.env.NODE_ENV': '"production"' },
      outfile,
      logLevel: 'silent',
    })
    return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
  })()
  return modulePromise
}

const ROOT = 'C:\\work\\demo'
const SRC = `${ROOT}\\src`
const MAIN = `${SRC}\\main`
const JAVA = `${MAIN}\\java`
const COM = `${JAVA}\\com`
const LIANG = `${COM}\\liangshou`
const ADAPTER = `${LIANG}\\adapter`
const CONTROLLER = `${ADAPTER}\\controller`
const USER = `${CONTROLLER}\\UserController.java`

/** One file-tree entry as the host would report it. */
function entry(name, path, rel, isDir) {
  return { name, path, rel, isDir, isSymlink: false, hidden: false, size: 0, mtimeMs: 0, ext: '' }
}

/**
 * The package chain of the issue:
 * `src/main/java/com/liangshou/adapter/controller`.
 */
function chainState() {
  return {
    root: ROOT,
    dirs: new Map([
      [ROOT, { loading: false, entries: [entry('src', SRC, 'src', true)] }],
      [SRC, { loading: false, entries: [entry('main', MAIN, 'src/main', true)] }],
      [MAIN, { loading: false, entries: [entry('java', JAVA, 'src/main/java', true)] }],
      [JAVA, { loading: false, entries: [entry('com', COM, 'src/main/java/com', true)] }],
      [COM, { loading: false, entries: [entry('liangshou', LIANG, 'src/main/java/com/liangshou', true)] }],
      [LIANG, { loading: false, entries: [entry('adapter', ADAPTER, 'src/main/java/com/liangshou/adapter', true)] }],
      [ADAPTER, { loading: false, entries: [entry('controller', CONTROLLER, 'src/main/java/com/liangshou/adapter/controller', true)] }],
      [CONTROLLER, { loading: false, entries: [entry('UserController.java', USER, 'src/main/java/com/liangshou/adapter/controller/UserController.java', false)] }],
    ]),
    expanded: new Set([ROOT, SRC, MAIN, JAVA, COM, LIANG, ADAPTER, CONTROLLER]),
    status: { isRepo: true, branch: 'main', entries: [] },
    settings: { shortcuts: {}, project: { showIgnored: false, singleClickOpen: false, excluded: [] } },
    filter: '',
    filterMode: 'tree',
    fileIndex: [],
    fileIndexLoading: false,
    fileIndexError: null,
    selectedPath: '',
    selectedPaths: new Set(),
    tabs: [],
    activeId: '',
    treeFocusTick: 0,
    clipboard: null,
    gitRepoRoot: '',
  }
}

/** A store double that records every call the panel makes. */
function baseStore(state) {
  const calls = []
  const record = (name, ...args) => { calls.push({ name, args }) }
  return {
    t: key => key,
    state,
    calls,
    getSnapshot: () => state,
    subscribe: () => () => {},
    setSelection: (...args) => record('setSelection', ...args),
    toggleSelection: () => {},
    selectRange: () => {},
    clearSelection: () => {},
    openFile: () => {},
    toggleDir: (...args) => record('toggleDir', ...args),
    setFilter: () => {},
    setFilterMode: () => {},
    setFileClipboard: () => {},
    pasteEntries: () => {},
    duplicateEntries: () => {},
    requestDelete: (...args) => record('requestDelete', ...args),
    renameEntry: (...args) => record('renameEntry', ...args),
    createEntry: (...args) => record('createEntry', ...args),
    moveEntries: () => {},
    expandAll: () => {},
    collapseAll: () => {},
    sync: () => {},
    addTerminal: () => {},
    openInSidebar: () => {},
    openInIde: () => {},
    reveal: () => {},
    stage: () => {},
    openDiff: () => {},
    showHistory: () => {},
    openQuickOpen: () => {},
    openSearchPopup: () => {},
    sendToChat: () => {},
    openRootPicker: () => {},
    openProjectPicker: () => {},
    showTool: () => {},
    setSelectedPath: (...args) => record('setSelectedPath', ...args),
    loadDir: () => {},
    toast: (...args) => record('toast', ...args),
  }
}

/** Mount the panel. */
function renderPanel(state) {
  created.length = 0
  const store = baseStore(state)
  const html = renderToStaticMarkup(React.createElement(ProjectPanel, { store, state }))
  return { html, store, elements: created.slice() }
}

/** The tree row of one relative path. */
function rowOf(elements, rel) {
  return elements.find(element => typeof element?.props?.title === 'string'
    && element.props.title === rel
    && typeof element.props.className === 'string'
    && element.props.className.includes('iwb-tree-row'))
}

/** A key event for the tree. */
function keyEvent(key) {
  return {
    key,
    target: {},
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
    stopPropagation() {},
  }
}

let ProjectPanel

// ── A: the compact folders ─────────────────────────────────────────────

test('a package chain collapses into one row with a dot-joined label', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = chainState()
  const rows = mod.flatten(state, state.filter, false, new Set(), 'tree')

  assert.equal(rows.length, 2, 'the whole chain is one row plus its file')
  const merged = rows[0]
  assert.equal(merged.kind, 'dir')
  assert.equal(merged.merged, true)
  assert.equal(merged.depth, 0, 'the chain keeps the level of its first segment')
  assert.equal(merged.label, 'src.main.java.com.liangshou.adapter.controller')
  assert.deepEqual(merged.segments, ['src', 'main', 'java', 'com', 'liangshou', 'adapter', 'controller'])
  // The row stands for the LEAF of the chain: the git status, the selection
  // and the context menu act on the real folder.
  assert.equal(merged.entry.path, CONTROLLER)
  assert.equal(merged.entry.rel, 'src/main/java/com/liangshou/adapter/controller')
  assert.equal(merged.entry.merged, true)

  // Expanding the merged row shows the files of the leaf directly.
  assert.equal(rows[1].kind, 'file')
  assert.equal(rows[1].entry.path, USER)
  assert.equal(rows[1].depth, 1)

  const { html } = renderPanel(state)
  assert.match(html, /src\.main\.java\.com\.liangshou\.adapter\.controller/)
  assert.match(html, /UserController\.java/)
})

test('the chain forks where a file or a second folder appears', async () => {
  const mod = await loadModule()
  const state = chainState()
  // The leaf of the chain holds a second folder: the chain ends there.
  state.dirs.set(CONTROLLER, {
    loading: false,
    entries: [
      entry('UserController.java', USER, 'src/main/java/com/liangshou/adapter/controller/UserController.java', false),
      entry('service', `${CONTROLLER}\\service`, 'src/main/java/com/liangshou/adapter/controller/service', true),
    ],
  })
  const rows = mod.flatten(state, state.filter, false, new Set(), 'tree')
  const merged = rows[0]
  assert.equal(merged.merged, true)
  assert.equal(merged.label, 'src.main.java.com.liangshou.adapter.controller')
  // The files and the folders of the leaf follow the merged row.
  assert.deepEqual(rows.slice(1).map(row => row.entry.name), ['UserController.java', 'service'])
})

test('only loaded chains are merged - an unloaded level ends the chain', async () => {
  const mod = await loadModule()
  const state = chainState()
  // `main` was never opened: it has no listing, so the chain stops there.
  state.dirs.delete(MAIN)
  state.expanded.delete(MAIN)
  const rows = mod.flatten(state, state.filter, false, new Set(), 'tree')
  const merged = rows[0]
  assert.equal(merged.merged, true)
  assert.deepEqual(merged.segments, ['src', 'main'])
  assert.equal(merged.entry.path, MAIN)
  // Nothing below the unloaded level is read.
  assert.equal(rows.length, 1)
})

test('a merged row keeps the git status colour and the excluded background', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = chainState()
  state.status = {
    isRepo: true,
    branch: 'main',
    entries: [{ path: 'src/main/java/com/liangshou/adapter/controller/UserController.java', xy: '.M' }],
  }
  state.settings.project.excluded = ['src/main/java/com']
  const { elements } = renderPanel(state)
  const row = rowOf(elements, 'src/main/java/com/liangshou/adapter/controller')
  assert.ok(row !== undefined, 'the merged row is rendered')
  assert.match(row.props.className, /iwb-git-modified/, 'the status colour of the leaf reaches the row')
  assert.match(row.props.className, /iwb-excluded/, 'the excluded background of the leaf reaches the row')
})

test('a merged folder cannot be renamed', async () => {
  const mod = await loadModule()
  const state = chainState()
  const rows = mod.flatten(state, state.filter, false, new Set(), 'tree')
  assert.equal(mod.canRenameEntry(rows[0].entry), false, 'a merged folder has no name of its own')
  assert.equal(mod.canRenameEntry({ name: 'a', path: 'a' }), true)
})

test('ArrowLeft goes back to the nearest visible ancestor row', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = chainState()
  state.selectedPath = USER
  state.selectedPaths = new Set([USER])
  const { store, elements } = renderPanel(state)

  const body = elements.find(element => typeof element?.props?.className === 'string'
    && element.props.className.includes('iwb-panel-body'))
  assert.ok(body !== undefined, 'the tree body is rendered')
  body.props.onKeyDown(keyEvent('ArrowLeft'))

  const selections = store.calls.filter(call => call.name === 'setSelection')
  assert.equal(selections.length, 1)
  // The parent of the file is the leaf of the chain - the merged row.
  assert.deepEqual(selections[0].args, [[CONTROLLER], CONTROLLER])
})

// ── B: the new-entry dialog with its path box ───────────────────────────

test('the path box shows the full relative path and is read-only until it is clicked', async () => {
  const mod = await loadModule()
  const { NewEntryDialog } = mod
  const dialog = mod.newEntryDialogState(CONTROLLER, false, ROOT)
  assert.equal(dialog.base, 'src/main/java/com/liangshou/adapter/controller')
  assert.equal(dialog.path, dialog.base)
  assert.equal(dialog.pathEdited, false)

  const unlocked = mod.withDialogPathUnlocked(dialog)
  assert.equal(unlocked.pathEdited, true, 'a click into the box makes it editable')

  created.length = 0
  const html = renderToStaticMarkup(React.createElement(NewEntryDialog, {
    dialog,
    t: key => key,
    onNameChange() {},
    onPathChange() {},
    onPathFocus() {},
    onTemplateChange() {},
    onSubmit() {},
    onCancel() {},
  }))
  assert.match(html, /project\.pathLabel/)
  assert.match(html, /src\/main\/java\/com\/liangshou\/adapter\/controller/)
  const inputs = created.filter(element => element?.props?.value === dialog.path)
  assert.equal(inputs.length, 1, 'the path box is rendered')
  assert.equal(inputs[0].props.readOnly, true, 'the path box is read-only')
  assert.equal(inputs[0].props.disabled, undefined, 'a disabled input cannot be clicked into')
})

test('an unchanged path box creates the entry in the direct parent', async () => {
  const mod = await loadModule()
  const dialog = mod.withDialogName(mod.newEntryDialogState(CONTROLLER, false, ROOT), 'Foo.java')
  assert.equal(dialog.path, 'src/main/java/com/liangshou/adapter/controller/Foo.java')
  const target = mod.resolveNewEntry(dialog, ROOT)
  assert.equal(target.ok, true)
  assert.equal(target.parent, CONTROLLER, 'the entry goes into the folder of the dialog')
  assert.equal(target.name, 'Foo.java')
  assert.equal(target.relPath, undefined, 'nothing was moved')
})

test('an edited path is resolved against the project root', async () => {
  const mod = await loadModule()
  let dialog = mod.withDialogName(mod.newEntryDialogState(CONTROLLER, false, ROOT), 'Foo.java')
  dialog = mod.withDialogPath(dialog, 'a/b/c/Foo.java')
  assert.equal(dialog.name, 'Foo.java', 'the last segment of the path is the name')
  const target = mod.resolveNewEntry(dialog, ROOT)
  assert.equal(target.ok, true)
  assert.equal(target.relPath, 'a/b/c/Foo.java', 'the path is relative to the project root')
  assert.equal(target.name, 'Foo.java')
  assert.equal(target.parent, undefined, 'the project root is the base of the path')
})

test('an illegal path is refused and nothing is written', async () => {
  const mod = await loadModule()
  for (const illegal of ['../outside.txt', '/etc/passwd', 'C:\\Windows\\x.txt', 'a//b.txt', 'a/../b.txt']) {
    const dialog = mod.withDialogPath(mod.newEntryDialogState(CONTROLLER, false, ROOT), illegal)
    const target = mod.resolveNewEntry(dialog, ROOT)
    assert.equal(target.ok, false, `${illegal} is refused`)
    assert.equal(target.reason, 'invalid-path')
  }
  // An empty name is refused as well.
  const empty = mod.resolveNewEntry(mod.withDialogName(mod.newEntryDialogState(CONTROLLER, false, ROOT), ''), ROOT)
  assert.equal(empty.ok, false)
  assert.equal(empty.reason, 'empty-name')
})

test('the name of the entry follows the path box', async () => {
  const mod = await loadModule()
  let dialog = mod.newEntryDialogState(CONTROLLER, false, ROOT)
  dialog = mod.withDialogPath(dialog, 'a/b/Bar.java')
  assert.equal(dialog.name, 'Bar.java')
  // The name box keeps the folder the user has chosen.
  dialog = mod.withDialogName(dialog, 'Baz.java')
  assert.equal(dialog.path, 'a/b/Baz.java')
})
