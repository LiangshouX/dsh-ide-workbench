/**
 * R6 — an ignored directory and its whole subtree are grey.
 *
 * Two defects used to stack here: the host only asked git for the ignored
 * entries when the setting was on, and the two sides spoke different keys
 * (the host kept porcelain's trailing slash, the client looked the path up
 * without it). On top of that git does not descend into an ignored
 * directory, so the subtree has no entry in the status at all — the grey has
 * to be inherited by the prefix.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseStatusV2, status } from '../src/host/git.js'
import { aggregateStatus } from '../src/client/git-colors.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// A tiny DOM surface: the module-level browser references of the panel must
// not explode even though SSR itself never touches them.
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

// `renderToStaticMarkup` drops the event handlers, so every element React
// creates is kept here: the tree rows and their props stay reachable.
const created = []
const originalCreateElement = React.createElement
React.createElement = (type, props, ...children) => {
  const element = originalCreateElement(type, props, ...children)
  created.push(element)
  return element
}

let modulePromise

async function loadPanel() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'ignored-tree-entry.mjs')
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

function statusText(lines) {
  return `${lines.join('\0')}\0`
}

async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'iwb-ignored-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** A repository with an ignored `target/` folder that holds files. */
async function repoWithIgnoredFolder(t) {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
  } catch {
    t.skip('git is not installed')
    return null
  }
  const root = await temp(t)
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'IDE Test')
  git('config', 'user.email', 'ide@test.local')
  await writeFile(join(root, '.gitignore'), 'target/\n')
  await mkdir(join(root, 'target', 'sub'), { recursive: true })
  await writeFile(join(root, 'target', 'a.txt'), 'a\n')
  await writeFile(join(root, 'target', 'sub', 'b.txt'), 'b\n')
  await writeFile(join(root, 'kept.txt'), 'kept\n')
  return root
}

test('the host drops the trailing slash of an ignored directory', () => {
  const parsed = parseStatusV2(statusText([
    '! target/',
    '! root.log',
  ]))
  assert.equal(parsed.entries.length, 2)
  // The client keys the ignored set by the plain path.
  assert.equal(parsed.entries[0].path, 'target')
  assert.equal(parsed.entries[0].ignored, true)
  // The directory is marked: the client has to know that the subtree below
  // it is ignored as well.
  assert.equal(parsed.entries[0].ignoredDir, true)
  // An ignored file has no trailing slash and is not a directory.
  assert.equal(parsed.entries[1].path, 'root.log')
  assert.equal(parsed.entries[1].ignoredDir, false)
})

test('the host always asks git for the ignored entries', async (t) => {
  const root = await repoWithIgnoredFolder(t)
  if (root === null) return
  // The setting only decides whether the client SHOWS the entries, so the
  // host sends them even when the caller does not ask for them.
  const snapshot = await status({ root, gitPath: '' }, { ignored: false, numstat: false })
  const ignored = snapshot.entries.filter(entry => entry.ignored === true)
  assert.deepEqual(ignored.map(entry => entry.path), ['target'])
  assert.equal(ignored[0].ignoredDir, true)
  // The other entries are not touched.
  const untracked = snapshot.entries.filter(entry => entry.untracked === true).map(entry => entry.path)
  assert.deepEqual(untracked.sort(), ['.gitignore', 'kept.txt'])
})

test('an ignored directory carries its whole subtree', async (t) => {
  const root = await repoWithIgnoredFolder(t)
  if (root === null) return
  const snapshot = await status({ root, gitPath: '' }, {})
  const rollup = aggregateStatus(snapshot.entries)
  // The folder itself, and everything below it.
  assert.equal(rollup.ignored.has('target'), true)
  assert.equal(rollup.ignored.has('target/sub'), true)
  assert.equal(rollup.ignored.has('target/sub/b.txt'), true)
  // A folder that is not ignored stays normal.
  assert.equal(rollup.ignored.has('kept.txt'), false)
  // An ignored entry colours nothing: it is in neither table.
  assert.equal(rollup.dirs.has('target'), false)
  assert.equal(rollup.files.has('target'), false)
  assert.equal(rollup.files.has('target/sub/b.txt'), false)
})

test('the levels above the deepest ignored directory are ignored too', () => {
  // The negation case: git reports the deepest ignored sub-directory only.
  const rollup = aggregateStatus([{ path: 'target/sub', xy: '!!', ignored: true, ignoredDir: true }])
  assert.equal(rollup.ignored.has('target/sub'), true)
  assert.equal(rollup.ignored.has('target'), true)
  assert.equal(rollup.ignored.has('target/sub/file.txt'), true)
})

test('an ignored file stays a file', () => {
  const rollup = aggregateStatus([{ path: 'target/a.log', xy: '!!', ignored: true }])
  assert.equal(rollup.ignored.has('target/a.log'), true)
  // The folder of an ignored file is not ignored: only the file is grey.
  assert.equal(rollup.ignored.has('target'), false)
  assert.equal(rollup.dirs.has('target'), false)
  assert.equal(rollup.files.has('target/a.log'), false)
})

test('a porcelain path with a trailing slash is normalized', () => {
  // An older host (or a hand-written entry) still carries the slash.
  const rollup = aggregateStatus([{ path: 'target/', xy: '!!', ignored: true }])
  assert.equal(rollup.ignored.has('target'), true)
  assert.equal(rollup.ignored.has('target/sub'), true)
})

test('a tracked file next to an ignored folder keeps its own colour', () => {
  // The everyday case: `node_modules/` is ignored, the folder around it holds
  // tracked files. The ignored folder is grey, the folder itself and its
  // tracked content are NOT - the ancestor of an ignored directory is a
  // LEVEL, not a root, so it greys its own row and nothing below it.
  const rollup = aggregateStatus([
    { path: 'packages/workbench/node_modules', xy: '!!', ignored: true, ignoredDir: true },
    { path: 'packages/workbench/src/index.js', xy: '.M', modified: true },
  ])
  assert.equal(rollup.ignored.has('packages/workbench/node_modules'), true)
  assert.equal(rollup.ignored.has('packages/workbench/node_modules/react/index.js'), true)
  // The tracked file next to it keeps its own colour.
  assert.equal(rollup.ignored.has('packages/workbench/src/index.js'), false)
  // The folder that holds it is not grey either: git said something about it.
  assert.equal(rollup.ignored.has('packages/workbench'), false)
  assert.equal(rollup.ignored.has('packages'), false)
})

test('an ignored folder does not grey the tracked content of its level', () => {
  // The same case without any other status entry: the level above the ignored
  // directory is grey, but its own content is not - a level greys its row.
  const rollup = aggregateStatus([
    { path: 'packages/workbench/node_modules', xy: '!!', ignored: true, ignoredDir: true },
  ])
  assert.equal(rollup.ignored.has('packages/workbench/node_modules'), true)
  assert.equal(rollup.ignored.has('packages/workbench/src/index.js'), false)
  // The level above it is grey (the negation case of the level rule).
  assert.equal(rollup.ignored.has('packages/workbench'), true)
})

test('the ignored set keeps its identity while the status is unchanged', async () => {
  const entries = [{ path: 'target', xy: '!!', ignored: true, ignoredDir: true }]
  const first = aggregateStatus(entries)
  const second = aggregateStatus(entries.map(entry => ({ ...entry })))
  assert.notEqual(first.ignored, second.ignored)
  assert.equal(first.ignored.has('target'), true)
  assert.equal(second.ignored.has('target'), true)
})

// ── the Project tree (the consumer of the aggregate) ─────────────────────

const ROOT = 'C:\\work\\demo'
const TARGET = `${ROOT}\\target`
const SUB = `${TARGET}\\sub`

/** One file-tree entry as the host would report it. */
function entry(name, path, rel, isDir) {
  return { name, path, rel, isDir, isSymlink: false, hidden: false, size: 0, mtimeMs: 0, ext: '' }
}

/** A project with an ignored folder that holds a sub folder with a file. */
function treeState(showIgnored) {
  return {
    root: ROOT,
    dirs: new Map([
      [ROOT, {
        loading: false,
        entries: [entry('target', TARGET, 'target', true), entry('a.ts', `${ROOT}\\a.ts`, 'a.ts', false)],
      }],
      [TARGET, {
        loading: false,
        entries: [entry('sub', SUB, 'target/sub', true), entry('keep.txt', `${TARGET}\\keep.txt`, 'target/keep.txt', false)],
      }],
      [SUB, { loading: false, entries: [entry('x.txt', `${SUB}\\x.txt`, 'target/sub/x.txt', false)] }],
    ]),
    expanded: new Set([ROOT, TARGET, SUB]),
    status: { isRepo: true, branch: 'main', entries: [{ path: 'target', xy: '!!', ignored: true, ignoredDir: true }] },
    settings: { shortcuts: {}, project: { showIgnored, singleClickOpen: false, excluded: [] } },
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
    gitRepoRoot: '',
  }
}

/** A store double: every call the panel makes is answered. */
function treeStore(state) {
  const store = {
    t: key => key,
    state: { clipboard: null },
    getSnapshot: () => state,
    subscribe: () => () => {},
    toast: () => {},
  }
  return new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (typeof prop === 'symbol' || prop === 'then') return undefined
      return () => {}
    },
  })
}

/** Mount the tree and return the rows it rendered. */
function renderRows(mod, state) {
  created.length = 0
  renderToStaticMarkup(React.createElement(mod.ProjectPanel, { store: treeStore(state), state }))
  return created.filter(element => typeof element?.props?.className === 'string'
    && element.props.className.includes('iwb-tree-row'))
}

test('the tree hides the ignored folder and its subtree by default', async () => {
  const mod = await loadPanel()
  const rows = renderRows(mod, treeState(false))
  const titles = rows.map(row => row.props.title)
  assert.ok(!titles.includes('target'), 'the ignored folder is hidden')
  assert.ok(!titles.includes('target/sub'), 'the subtree is hidden as well')
  assert.ok(titles.includes('a.ts'), 'the other files stay')
})

test('the tree greys the ignored folder and its whole subtree', async () => {
  const mod = await loadPanel()
  const rows = renderRows(mod, treeState(true))
  const below = rows.filter(row => String(row.props.title).startsWith('target'))
  assert.ok(below.length >= 2, 'the ignored folder and its content are rendered')
  // Every row of the ignored subtree is grey — and carries no other colour.
  for (const row of below) {
    assert.match(row.props.className, /iwb-git-ignored/, `${row.props.title} is grey`)
    assert.doesNotMatch(row.props.className, /iwb-git-(added|modified|untracked|conflict|deleted)/)
  }
  // The other rows stay normal.
  for (const row of rows) {
    if (String(row.props.title).startsWith('target')) continue
    assert.doesNotMatch(row.props.className, /iwb-git-/, `${row.props.title} stays normal`)
  }
})
