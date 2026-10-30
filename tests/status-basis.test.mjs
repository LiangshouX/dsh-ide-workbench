/**
 * PRD-v4 review fixes — R2 (git status basis), R3 (`.gitignore` entries),
 * L5 (double click on the tree twisty).
 *
 *   - the tree colours the files of the repository the Git window reads and
 *     leaves the files outside it alone;
 *   - "add to .gitignore" writes a legal repository-relative entry and
 *     refuses a path outside the repository;
 *   - one click on the twisty toggles once, a double click toggles once.
 *
 * The panel is mounted with `renderToStaticMarkup`, the same harness as
 * `tests/render.test.mjs` and `tests/tree-twisty.test.mjs` (this package has
 * no jsdom). Static markup carries no event handlers, so
 * `React.createElement` is wrapped to keep every created element: the row
 * props can then be driven directly, without a browser DOM.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { appendIgnore } from '../src/host/fileops.js'

const run = promisify(execFile)
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

// ── element recorder ────────────────────────────────────────────────────
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
    const outfile = join(dir, 'status-basis-entry.mjs')
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

const W = 'C:\\work\\w'
const APP = `${W}\\app`
const SRC = `${APP}\\src`
const OTHER = `${W}\\other`

/** One file-tree entry as the host would report it. */
function entry(name, path, rel, isDir) {
  return { name, path, rel, isDir, isSymlink: false, hidden: false, size: 0, mtimeMs: 0, ext: '' }
}

/**
 * A project whose root is NOT a repository while the Git window reads the
 * sub-repository `W/app`.
 */
function splitRepoState() {
  return {
    root: W,
    gitRepoRoot: APP,
    dirs: new Map([
      [W, { loading: false, entries: [entry('app', APP, 'app', true), entry('other', OTHER, 'other', true)] }],
      [APP, { loading: false, entries: [entry('src', SRC, 'app/src', true)] }],
      [SRC, { loading: false, entries: [entry('a.ts', `${SRC}\\a.ts`, 'app/src/a.ts', false)] }],
      [OTHER, { loading: false, entries: [entry('b.ts', `${OTHER}\\b.ts`, 'other/b.ts', false)] }],
    ]),
    expanded: new Set([W, APP, SRC, OTHER]),
    // The status comes from `W/app`, so its keys are repository-relative.
    status: {
      isRepo: true,
      branch: 'main',
      entries: [{ path: 'src/a.ts', xy: '.M', untracked: false, conflict: false, staged: false, unstaged: true }],
    },
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
    toggleSelection: (...args) => record('toggleSelection', ...args),
    selectRange: (...args) => record('selectRange', ...args),
    clearSelection: () => record('clearSelection'),
    openFile: (...args) => record('openFile', ...args),
    toggleDir: (...args) => record('toggleDir', ...args),
    setFilter: (...args) => record('setFilter', ...args),
    setFilterMode: (...args) => record('setFilterMode', ...args),
    setFileClipboard: () => {},
    pasteEntries: () => {},
    duplicateEntries: () => {},
    requestDelete: () => {},
    renameEntry: () => {},
    createEntry: () => {},
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
    openSearchTab: () => {},
    sendToChat: () => {},
    openRootPicker: () => {},
    openProjectPicker: () => {},
    showTool: () => {},
    setSelectedPath: () => {},
    loadDir: () => {},
    toast: () => {},
  }
}

/** Mount the panel with a store that owns `state`. */
function renderPanel(state) {
  created.length = 0
  const store = baseStore(state)
  const html = renderToStaticMarkup(React.createElement(ProjectPanel, { store, state }))
  return { html, store, elements: created.slice() }
}

/** The rendered tree row of one project-relative path. */
function rowOf(elements, rel) {
  return elements.find(element => typeof element?.props?.title === 'string'
    && element.props.title === rel
    && typeof element.props.className === 'string'
    && element.props.className.includes('iwb-tree-row'))
}

/** The twisty of one row. */
function twistyOf(row) {
  const children = row.props.children
  const list = Array.isArray(children) ? children : [children]
  return list.find(child => typeof child?.props?.className === 'string'
    && child.props.className.includes('iwb-tree-twisty'))
}

let ProjectPanel

// ── R2: the git status basis ────────────────────────────────────────────

test('the tree colours the files of the repository the Git window reads', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = splitRepoState()
  const { elements } = renderPanel(state)

  const inside = rowOf(elements, 'app/src/a.ts')
  assert.ok(inside !== undefined, 'the file of the sub-repository is rendered')
  assert.match(inside.props.className, /iwb-git-modified/)
})

test('a file outside that repository gets no status', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = splitRepoState()
  const { elements } = renderPanel(state)

  const outside = rowOf(elements, 'other/b.ts')
  assert.ok(outside !== undefined, 'the file outside the repository is rendered')
  assert.doesNotMatch(outside.props.className, /iwb-git-(modified|added|untracked|deleted)/)
})

test('with the project root as the repository the colours do not change', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = splitRepoState()
  // The Git window reads the project root: the status keys are then the
  // project-relative paths, exactly as before the review fix.
  state.gitRepoRoot = W
  state.status = {
    isRepo: true,
    branch: 'main',
    entries: [{ path: 'app/src/a.ts', xy: '.M', untracked: false, conflict: false, staged: false, unstaged: true }],
  }
  const { elements } = renderPanel(state)

  const inside = rowOf(elements, 'app/src/a.ts')
  assert.ok(inside !== undefined)
  assert.match(inside.props.className, /iwb-git-modified/)
})

test('the ignored entries are filtered with the repository-relative key', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = splitRepoState()
  // `src/a.ts` is ignored in the sub-repository: it must disappear from the
  // tree even though its project-relative path is `app/src/a.ts`.
  const ignored = new Set(['src/a.ts'])
  const rows = mod.flatten(state, state.filter, false, ignored, 'tree').map(row => row.key)
  assert.ok(!rows.includes(`${SRC}\\a.ts`), 'the ignored file is hidden')
  assert.ok(rows.includes(`${OTHER}\\b.ts`), 'the file outside the repository stays')

  // With the project root as the repository the key is the project-relative
  // path, as before.
  const sameRoot = { ...state, gitRepoRoot: W }
  const sameRows = mod.flatten(sameRoot, sameRoot.filter, false, new Set(['app/src/a.ts']), 'tree').map(row => row.key)
  assert.ok(!sameRows.includes(`${SRC}\\a.ts`), 'the ignored file is hidden')
})

test('the status key is null outside the repository the Git window reads', async () => {
  const mod = await loadModule()
  const state = splitRepoState()
  assert.equal(mod.statusKeyOf(state, `${SRC}\\a.ts`), 'src/a.ts')
  assert.equal(mod.statusKeyOf(state, `${OTHER}\\b.ts`), null)
  // With the project root as the repository the key is the project-relative
  // path.
  assert.equal(mod.statusKeyOf({ ...state, gitRepoRoot: W }, `${SRC}\\a.ts`), 'app/src/a.ts')
})

// ── R3: the `.gitignore` entry ──────────────────────────────────────────

test('"add to .gitignore" writes a repository-relative entry', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'iwb-ignore-'))
  try {
    const repo = join(workspace, 'app')
    await mkdir(join(repo, 'src'), { recursive: true })
    await writeFile(join(repo, 'src', 'a.ts'), 'const a = 1\n', 'utf8')

    const result = await appendIgnore(workspace, { path: join(repo, 'src', 'a.ts'), repoRoot: repo })
    assert.equal(result.line, '/src/a.ts')
    assert.equal(result.changed, true)
    const written = await readFile(join(repo, '.gitignore'), 'utf8')
    assert.match(written, /^\/src\/a\.ts$/m)
    assert.doesNotMatch(written, /\.\./)

    // The same entry twice does not duplicate the line.
    const again = await appendIgnore(workspace, { path: join(repo, 'src', 'a.ts'), repoRoot: repo })
    assert.equal(again.changed, false)
    assert.equal((await readFile(join(repo, '.gitignore'), 'utf8')).match(/\/src\/a\.ts/g)?.length, 1)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('"add to .gitignore" refuses a path outside the repository', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'iwb-ignore-'))
  try {
    const repo = join(workspace, 'app')
    const outside = join(workspace, 'other')
    await mkdir(repo, { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'b.ts'), 'const b = 2\n', 'utf8')

    await assert.rejects(
      () => appendIgnore(workspace, { path: join(outside, 'b.ts'), repoRoot: repo }),
      error => error?.code === 'bad-request',
      'the entry outside the repository is refused',
    )
    // Nothing was written.
    await assert.rejects(() => readFile(join(repo, '.gitignore'), 'utf8'))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('the written entry really ignores the file (git check-ignore)', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'iwb-ignore-'))
  try {
    const repo = join(workspace, 'app')
    await mkdir(join(repo, 'src'), { recursive: true })
    await writeFile(join(repo, 'src', 'a.ts'), 'const a = 1\n', 'utf8')
    await appendIgnore(workspace, { path: join(repo, 'src', 'a.ts'), repoRoot: repo })
    try {
      await run('git', ['init', '-q'], { cwd: repo })
    } catch {
      return // no git in this environment
    }
    const { stdout } = await run('git', ['check-ignore', 'src/a.ts'], { cwd: repo })
    assert.match(stdout, /src\/a\.ts/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

// ── the git actions of the tree context menu ────────────────────────────

/** A store double that records the git actions of the context menu. */
function gitStore() {
  const calls = []
  return {
    calls,
    stage: paths => { calls.push({ name: 'stage', args: [paths] }) },
    openDiff: options => { calls.push({ name: 'openDiff', args: [options] }) },
    showHistory: rel => { calls.push({ name: 'showHistory', args: [rel] }) },
  }
}

test('the tree hands repository-relative paths to the git actions', async () => {
  const mod = await loadModule()
  const state = splitRepoState()
  const store = gitStore()
  const items = mod.gitMenuItems(state, ['app/src/a.ts'], 'app/src/a.ts', false, { t: key => key, store })
  const add = items.find(item => item.key === 'git-add')
  const diff = items.find(item => item.key === 'git-diff')
  const history = items.find(item => item.key === 'git-history')
  assert.ok(add !== undefined && diff !== undefined && history !== undefined)
  assert.equal(add.disabled, false)
  assert.equal(diff.disabled, false)

  add.action()
  diff.action()
  history.action()

  // The git layer runs at the repository: it wants `src/a.ts`, not the
  // project-relative `app/src/a.ts`.
  assert.deepEqual(store.calls[0], { name: 'stage', args: [['src/a.ts']] })
  assert.deepEqual(store.calls[1], { name: 'openDiff', args: [{ path: 'src/a.ts' }] })
  // The store converts the history path itself (PRD-v4 review M8): it must
  // not be converted twice.
  assert.deepEqual(store.calls[2], { name: 'showHistory', args: ['app/src/a.ts'] })
})

test('the git actions are disabled for a file outside the selected repository', async () => {
  const mod = await loadModule()
  const state = splitRepoState()
  const store = gitStore()
  const items = mod.gitMenuItems(state, ['other/b.ts'], 'other/b.ts', false, { t: key => key, store })
  const add = items.find(item => item.key === 'git-add')
  const diff = items.find(item => item.key === 'git-diff')
  assert.ok(add !== undefined && diff !== undefined)
  assert.equal(add.disabled, true, 'there is nothing to add to that repository')
  assert.equal(diff.disabled, true, 'that repository has no diff for this file')
})

test('with the project root as the repository the arguments are the same as before', async () => {
  const mod = await loadModule()
  const state = splitRepoState()
  state.gitRepoRoot = W
  const store = gitStore()
  const items = mod.gitMenuItems(state, ['app/src/a.ts'], 'app/src/a.ts', false, { t: key => key, store })
  items.find(item => item.key === 'git-add').action()
  items.find(item => item.key === 'git-diff').action()
  assert.deepEqual(store.calls[0], { name: 'stage', args: [['app/src/a.ts']] })
  assert.deepEqual(store.calls[1], { name: 'openDiff', args: [{ path: 'app/src/a.ts' }] })
})

// ── L5: the twisty and the double click ─────────────────────────────────

test('one click on the twisty toggles the folder once', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = splitRepoState()
  const { store, elements } = renderPanel(state)

  const row = rowOf(elements, 'app')
  assert.ok(row !== undefined)
  const twisty = twistyOf(row)
  assert.ok(twisty !== undefined)
  twisty.props.onClick({ detail: 1, stopPropagation() {} })

  const toggles = store.calls.filter(call => call.name === 'toggleDir')
  assert.equal(toggles.length, 1)
  assert.deepEqual(toggles[0].args, [APP])
})

test('a double click on the twisty toggles the folder once, not three times', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = splitRepoState()
  const { store, elements } = renderPanel(state)

  const row = rowOf(elements, 'app')
  const twisty = twistyOf(row)
  assert.ok(twisty !== undefined)

  // A double click sends two clicks (detail 1 and 2) and one dblclick.
  twisty.props.onClick({ detail: 1, stopPropagation() {} })
  twisty.props.onClick({ detail: 2, stopPropagation() {} })
  let dblStopped = false
  twisty.props.onDoubleClick({ stopPropagation() { dblStopped = true } })
  assert.equal(dblStopped, true, 'the dblclick does not reach the row')

  const toggles = store.calls.filter(call => call.name === 'toggleDir')
  assert.equal(toggles.length, 1, 'the folder is toggled once')
})

test('a double click on the folder name still toggles the folder', async () => {
  const mod = await loadModule()
  ProjectPanel = mod.ProjectPanel
  const state = splitRepoState()
  const { store, elements } = renderPanel(state)

  const row = rowOf(elements, 'app')
  assert.ok(row !== undefined)
  row.props.onDoubleClick({})

  const toggles = store.calls.filter(call => call.name === 'toggleDir')
  assert.equal(toggles.length, 1)
  assert.deepEqual(toggles[0].args, [APP])
})
