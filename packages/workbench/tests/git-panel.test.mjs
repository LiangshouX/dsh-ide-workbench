/**
 * Git panel tests: PRD-v4 §4.2 (GIT-02, no redundant inline preview) and
 * §4.3 (GIT-03, changed files as a collapsible directory tree).
 *
 * The commit drawer is rendered through the real component (SSR markup) and
 * the tree is driven through its pure helpers, so collapse and selection can
 * be observed without a browser.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { commit as gitCommit, stage as gitStage, status as gitStatus } from '../src/host/git.js'
import { checkedPathsOf, splitCommitGroups } from '../src/client/commit-model.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let modulePromise

async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    // The bundle lives inside the package so Node resolves the externalized
    // react from this package's node_modules. The file name differs from the
    // render suite so both suites can run in parallel.
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'git-panel.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
          export * from './src/client/GitPanel.jsx'
          export { CommitPanel } from './src/client/CommitPanel.jsx'
        `,
        resolveDir: root,
        loader: 'js',
      },
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

const APP_DIFF = `diff --git a/src/app.js b/src/app.js
index 1111111..2222222 100644
--- a/src/app.js
+++ b/src/app.js
@@ -1,3 +1,3 @@
 const a = 1
-const b = 2
+const b = 3
`

const DEEP_DIFF = `diff --git a/src/app.js b/src/app.js
index 1111111..2222222 100644
--- a/src/app.js
+++ b/src/app.js
@@ -1,3 +1,3 @@
 const a = 1
-const b = 2
+const b = 3
diff --git a/src/util/deep.js b/src/util/deep.js
index 3333333..4444444 100644
--- a/src/util/deep.js
+++ b/src/util/deep.js
@@ -1,2 +1,4 @@
 const c = 1
+const d = 2
+const e = 3
diff --git a/docs/readme.md b/docs/readme.md
index 5555555..6666666 100644
--- a/docs/readme.md
+++ b/docs/readme.md
@@ -1 +1 @@
-hello
+hello world
diff --git a/old/name.js b/new/name.js
similarity index 100%
rename from old/name.js
rename to new/name.js
`

function makeStore(state = {}) {
  const opened = []
  const store = {
    opened,
    state,
    t: key => key,
    // The panels read their own slice from the store, so the fake store has
    // to serve the snapshot the panel is rendered with.
    subscribe: () => () => {},
    getSnapshot: () => store.state,
    get changedEntries() {
      return (this.state.status.entries ?? []).filter(entry => entry.ignored !== true)
    },
    get commitGroups() {
      return splitCommitGroups(this.changedEntries, this.state.commit.buckets ?? {})
    },
    get checkedCommitPaths() {
      return checkedPathsOf(this.changedEntries, this.state.commit)
    },
    get changelists() {
      const all = this.state.settings?.changelists ?? {}
      const current = all[this.state.workspaceRoot]
      return {
        active: typeof current?.active === 'string' ? current.active : 'Default',
        lists: current?.lists !== null && typeof current?.lists === 'object' ? current.lists : {},
      }
    },
    toast: () => {},
    openCommitFile: (hash, path) => { opened.push({ hash, path }) },
    openCommit: () => {},
    closeCommitDetail: () => {},
    loadLog: async () => {},
    loadBranches: async () => {},
    refreshStatus: async () => {},
    setGitFilters: () => {},
    patch: () => {},
    selectCommit: () => {},
    toggleCompare: () => {},
    compareSelected: () => {},
    openCompare: () => {},
    requestCheckout: () => {},
    revert: () => {},
    askConfirm: () => {},
  }
  return store
}

function makeState(detail) {
  return {
    root: 'C:\\work\\demo',
    workspaceRoot: 'C:\\work\\demo',
    projects: [],
    layout: { gitDrawerWidth: 420, bottom: 'git' },
    status: { isRepo: true, branch: 'main', detached: false, oid: 'abc1234', entries: [] },
    commit: {
      message: '',
      amend: false,
      committing: false,
      messages: [],
      checked: new Set(),
      unchecked: new Set(),
      buckets: {},
      selectedPath: '',
      tasks: {},
      error: null,
      focusTick: 0,
    },
    settings: {
      commit: { groupByDirectory: false, testCommand: '', optimizeImportsCommand: '', cleanupCommand: '' },
      git: { commitTemplate: '' },
      shortcuts: {},
      terminal: { fontSize: 13 },
      changelists: {},
    },
    git: {
      commits: [],
      branches: ['main'],
      compare: [],
      selectedHash: 'aaa',
      filters: { branch: '', since: '', author: '', query: '' },
      detail,
      detailHash: detail?.hash ?? null,
      detailLoading: false,
      loading: false,
      error: null,
    },
  }
}

/** Render the Git panel with one commit detail open. */
function renderDrawer(mod, diff) {
  const detail = {
    hash: 'aaa',
    shortHash: 'aaa',
    parents: ['bbb'],
    author: 'Ann',
    email: 'a@x',
    date: '2026-10-20 10:00:00 +0800',
    refs: ['HEAD -> main'],
    subject: 'first',
    body: 'Body line',
    diff,
  }
  const state = makeState(detail)
  const store = makeStore(state)
  const html = renderToStaticMarkup(React.createElement(mod.GitPanel, { store, state }))
  return { html, store }
}

/** Opening tags of every tree row that carries the given class marker. */
function tagsOf(html, marker) {
  return [...html.matchAll(new RegExp(`<button[^>]*${marker}[^>]*>`, 'g'))].map(match => match[0])
}

/** Inner markup of the row whose title is the given path. */
function rowOf(html, title) {
  const match = new RegExp(`<button[^>]*title="${title}"[^>]*>([\\s\\S]*?)</button>`).exec(html)
  return match === null ? '' : match[1]
}

function treeOptions(overrides = {}) {
  return {
    collapsed: new Set(),
    selectedPath: '',
    depth: 0,
    onToggleDir: () => {},
    onSelectFile: () => {},
    onOpenFile: () => {},
    ...overrides,
  }
}

test('the commit drawer renders no inline preview block (GIT-02)', async () => {
  const mod = await loadModule()
  const { html } = renderDrawer(mod, DEEP_DIFF)
  assert.match(html, /iwb-git-drawer/)
  assert.match(html, /iwb-git-drawer-files/)
  // The redundant inline patch preview is gone (double click opens the full
  // diff in the content area instead).
  assert.doesNotMatch(html, /iwb-git-drawer-inline/)
  assert.doesNotMatch(html, /iwb-git-inline-diff/)
  assert.doesNotMatch(html, /iwb-git-inline-line/)
})

test('the drawer source no longer keeps the inline preview pieces (GIT-02)', async () => {
  const source = await readFile(join(root, 'src/client/GitPanel.jsx'), 'utf8')
  assert.doesNotMatch(source, /InlinePatch/)
  assert.doesNotMatch(source, /selectedFile/)
  assert.doesNotMatch(source, /iwb-git-drawer-inline/)
  // The file selection and the tree expansion are separate states.
  assert.match(source, /selectedPath/)
  assert.match(source, /collapsed/)
})

test('changed files are grouped into a collapsible directory tree (GIT-03)', async () => {
  const mod = await loadModule()
  const { html } = renderDrawer(mod, DEEP_DIFF)
  assert.match(html, /iwb-git-tree/)
  const dirPaths = tagsOf(html, 'iwb-git-tree-dir').map(tag => /title="([^"]*)"/.exec(tag)[1])
  assert.deepEqual(dirPaths, ['docs', 'new', 'src', 'src/util'])
  const leafPaths = tagsOf(html, 'iwb-git-tree-file').map(tag => /title="([^"]*)"/.exec(tag)[1])
  assert.deepEqual(leafPaths, ['docs/readme.md', 'new/name.js', 'src/app.js'])
  // The second level is closed by default, so its file is not listed.
  assert.doesNotMatch(html, /deep\.js/)
  // Every leaf keeps the status letter, the name and the +/- counters.
  const leaf = rowOf(html, 'src/app.js')
  assert.match(leaf, /iwb-git-file-status/)
  assert.match(leaf, />app\.js</)
  assert.match(leaf, /\+1</)
  assert.match(leaf, /-1</)
})

test('directory rows collapse and expand their children (GIT-03)', async () => {
  const mod = await loadModule()
  const tree = mod.buildChangedFileTree(mod.diffFiles(DEEP_DIFF))
  assert.deepEqual([...mod.defaultCollapsedDirs(tree)], ['src/util'])

  const toggled = []
  const closed = mod.fileTreeRows(tree, treeOptions({
    collapsed: mod.defaultCollapsedDirs(tree),
    onToggleDir: path => toggled.push(path),
  }))
  const closedHtml = renderToStaticMarkup(React.createElement('div', null, closed))
  assert.doesNotMatch(closedHtml, /deep\.js/)
  const utilRow = closed.find(row => row.props?.className === 'iwb-git-tree-dir' && row.props.title === 'src/util')
  assert.ok(utilRow !== undefined)
  assert.equal(utilRow.props['aria-expanded'], false)
  utilRow.props.onClick()
  assert.deepEqual(toggled, ['src/util'])

  const opened = mod.fileTreeRows(tree, treeOptions())
  const openedHtml = renderToStaticMarkup(React.createElement('div', null, opened))
  assert.match(openedHtml, /deep\.js/)
})

test('a rename entry uses the b/ side path (GIT-03)', async () => {
  const mod = await loadModule()
  const files = mod.diffFiles(DEEP_DIFF)
  const renamed = files.find(file => file.status === 'R')
  assert.equal(renamed.path, 'new/name.js')
  const tree = mod.buildChangedFileTree(files)
  const html = renderToStaticMarkup(React.createElement('div', null, mod.fileTreeRows(tree, treeOptions())))
  assert.match(html, /title="new\/name\.js"/)
  assert.doesNotMatch(html, /old\/name\.js/)
})

test('file selection and directory expansion stay separate states (GIT-03)', async () => {
  const mod = await loadModule()
  const tree = mod.buildChangedFileTree(mod.diffFiles(DEEP_DIFF))
  const rows = mod.fileTreeRows(tree, treeOptions({ selectedPath: 'src/app.js' }))
  const leaf = rows.find(row => row.props?.className?.includes('iwb-git-tree-file') && row.props.title === 'src/app.js')
  assert.match(leaf.props.className, /iwb-selected/)
  const dirRow = rows.find(row => row.props?.className === 'iwb-git-tree-dir')
  assert.doesNotMatch(dirRow.props.className, /iwb-selected/)
})

test('a file leaf selects on click and opens the diff on double click (GIT-03)', async () => {
  const mod = await loadModule()
  const tree = mod.buildChangedFileTree(mod.diffFiles(DEEP_DIFF))
  const selected = []
  const opened = []
  const rows = mod.fileTreeRows(tree, treeOptions({
    onSelectFile: path => selected.push(path),
    onOpenFile: path => opened.push(path),
  }))
  const leaf = rows.find(row => row.props?.title === 'src/app.js')
  leaf.props.onClick()
  leaf.props.onDoubleClick()
  assert.deepEqual(selected, ['src/app.js'])
  assert.deepEqual(opened, ['src/app.js'])
})

test('the changed-file tree groups by repository-relative path (GIT-03)', async () => {
  const mod = await loadModule()
  const tree = mod.buildChangedFileTree(mod.diffFiles(DEEP_DIFF))
  assert.deepEqual([...tree.dirs.keys()], ['docs', 'new', 'src'])
  assert.deepEqual([...tree.dirs.get('src').dirs.keys()], ['util'])
  assert.equal(tree.dirs.get('src').depth, 1)
  assert.equal(tree.dirs.get('src').dirs.get('util').depth, 2)
  assert.deepEqual(tree.dirs.get('src').files.map(file => file.path), ['src/app.js'])
})

test('the Git panel shows the repository it works against (GIT-01)', async () => {
  const mod = await loadModule()
  const state = makeState(null)
  state.gitRepoRoot = 'C:\\work\\demo'
  state.gitRepos = [
    { path: 'C:\\work\\demo', name: 'demo' },
    { path: 'C:\\work\\repo-a', name: 'repo-a' },
  ]
  const store = makeStore(state)
  const html = renderToStaticMarkup(React.createElement(mod.GitPanel, { store, state }))
  // The switch shows the repository name; the full path stays in the title.
  assert.match(html, /iwb-repo-switch/)
  assert.match(html, /iwb-repo-name[^>]*>demo</)
  assert.match(html, /title="C:\\work\\demo"/)
})

test('the repository picker offers the candidate repositories (GIT-01)', async () => {
  const mod = await loadModule()
  const repos = [
    { path: 'C:\\work\\demo', name: 'demo' },
    { path: 'C:\\work\\repo-a', name: 'repo-a' },
  ]
  const chosen = []
  const rows = mod.repoRows(repos, { current: 'C:\\work\\demo', index: 1, onChoose: path => chosen.push(path) })
  assert.equal(rows.length, 2)
  assert.match(rows[1].props.className, /iwb-selected/)
  assert.equal(rows[0].props.title, 'C:\\work\\demo')
  rows[1].props.onClick()
  assert.deepEqual(chosen, ['C:\\work\\repo-a'])
  // Choosing a repository must not touch the file tree or the tabs.
  const html = renderToStaticMarkup(React.createElement('div', null, rows))
  assert.match(html, /demo/)
  assert.match(html, /repo-a/)
})

test('the empty state points at the repository picker (GIT-01)', async () => {
  const mod = await loadModule()
  const state = makeState(null)
  state.status = { ...state.status, isRepo: false }
  state.gitRepos = [{ path: 'C:\\work\\repo-a', name: 'repo-a' }]
  const store = makeStore(state)
  const html = renderToStaticMarkup(React.createElement(mod.GitPanel, { store, state }))
  assert.match(html, /project\.noRepoHint/)
  assert.match(html, /project\.chooseRepo/)
  // The hint points at the repository picker, not at the IDE project switch.
  assert.match(html, /Terminal\/Git header/)
})

test('the empty state never switches the IDE project (GIT-01)', async () => {
  const mod = await loadModule()
  const state = makeState(null)
  state.status = { ...state.status, isRepo: false }
  state.gitRepos = []
  state.projects = []
  const store = makeStore(state)
  const html = renderToStaticMarkup(React.createElement(mod.GitPanel, { store, state }))
  // Without a candidate repository the block only says so — it never offers
  // the IDE project picker, which is exactly what GIT-01 removes.
  assert.match(html, /No Git repository candidate/)
  assert.doesNotMatch(html, /project\.selectProject/)
  assert.doesNotMatch(html, /project\.chooseRepo/)
  const source = await readFile(join(root, 'src/client/GitPanel.jsx'), 'utf8')
  assert.doesNotMatch(source, /openProjectPicker/)
})
test('switching the Git repository keeps the file tree and the tabs (GIT-01)', async () => {
  const { WorkbenchStore } = await import('../src/client/store.js')
  const store = new WorkbenchStore({ locale: { subscribe: () => () => {} } }, key => key)
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/ide-workbench/api/')[1]
    calls.push({ method, payload: JSON.parse(init.body) })
    const value = method === 'git.status'
      ? { isRepo: true, branch: 'main', entries: [], subprocesses: 1 }
      : method === 'git.branches'
        ? { branches: [] }
        : method === 'git.log'
          ? { commits: [], hasMore: false }
          : { value: {} }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  try {
    store.state = {
      ...store.state,
      root: 'C:\\work\\demo',
      projectRoot: 'C:\\work\\demo',
      gitRepoRoot: 'C:\\work\\demo',
      tabs: [{ id: 'file:a.ts', kind: 'file', path: 'C:\\work\\demo\\a.ts' }],
      activeId: 'file:a.ts',
      phase: 'ready',
      settings: { editor: { openMode: 'auto', editableMaxBytes: 1 << 20 }, shortcuts: {} },
    }
    await store.setGitRepoRoot('C:\\work\\repo-b')
    // The file tree, the project root and the tabs are untouched.
    assert.equal(store.state.root, 'C:\\work\\demo')
    assert.equal(store.state.projectRoot, 'C:\\work\\demo')
    assert.equal(store.state.activeId, 'file:a.ts')
    assert.deepEqual(store.state.tabs.map(tab => tab.id), ['file:a.ts'])
    assert.equal(store.state.gitRepoRoot, 'C:\\work\\repo-b')
    // Every git call of the new repository uses the new root.
    calls.length = 0
    await store.loadBranches()
    assert.ok(calls.length > 0)
    assert.ok(calls.every(entry => entry.payload.root === 'C:\\work\\repo-b'))
  } finally {
    globalThis.fetch = originalFetch
    store.persist.cancel()
  }
})
test('the changed-file tree follows the Git repository (GIT-01)', async () => {
  const mod = await loadModule()
  const diff = `diff --git a/lib/other.js b/lib/other.js
index 1111111..2222222 100644
--- a/lib/other.js
+++ b/lib/other.js
@@ -1 +1 @@
-old
+new
`
  const detail = {
    hash: 'ccc', shortHash: 'ccc', parents: [], author: 'Ann', email: 'a@x',
    date: '2026-10-20 10:00:00 +0800', refs: [], subject: 'other repo', body: '', diff,
  }
  const state = makeState(detail)
  // The Git window reads another repository: the tree is built from the
  // repository-relative paths of that repository.
  state.gitRepoRoot = 'C:\\work\\repo-b'
  state.gitRepos = [
    { path: 'C:\\work\\demo', name: 'demo' },
    { path: 'C:\\work\\repo-b', name: 'repo-b' },
  ]
  const store = makeStore(state)
  const html = renderToStaticMarkup(React.createElement(mod.GitPanel, { store, state }))
  assert.match(html, /iwb-git-tree-dir/)
  assert.match(html, /title="lib\/other\.js"/)
})

test('the commit grouping follows the Git repository (GIT-01)', async () => {
  const mod = await loadModule()
  const state = makeState(null)
  state.gitRepoRoot = 'C:\\work\\repo-b'
  // The status entries belong to the selected repository, so the Commit
  // groups them by the paths of that repository.
  state.status = {
    ...state.status,
    entries: [
      { path: 'lib/other.js', xy: '.M', untracked: false, conflict: false, staged: false, unstaged: true, unstagedLines: { additions: 1, deletions: 1 } },
    ],
  }
  const store = makeStore(state)
  const html = renderToStaticMarkup(React.createElement(mod.CommitPanel, { store, state }))
  assert.match(html, /other\.js/)
  assert.match(html, /iwb-file-row/)
})
test('a tracked change is still staged when it is checked (COMMIT-01)', async (t) => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
  } catch {
    t.skip('git is not installed')
    return
  }
  const dir = await mkdtemp(join(tmpdir(), 'iwb-git-panel-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'IDE Test')
    git('config', 'user.email', 'ide@test.local')
    git('config', 'commit.gpgsign', 'false')
    await writeFile(join(dir, 'tracked.txt'), 'one\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'base')
    // The tracked file changes in the worktree.
    await writeFile(join(dir, 'tracked.txt'), 'two\n')
    const root = await realpath(dir)
    const { WorkbenchStore } = await import('../src/client/store.js')
    const store = new WorkbenchStore({ locale: { subscribe: () => () => {} } }, key => key)
    store.state = {
      ...store.state,
      workspaceRoot: root,
      root,
      gitRepoRoot: root,
      phase: 'ready',
      status: { isRepo: true, branch: 'main', entries: [] },
      settings: { editor: { openMode: 'auto', editableMaxBytes: 1 << 20 }, shortcuts: {} },
    }
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      const method = String(url).split('/ide-workbench/api/')[1]
      const body = JSON.parse(init.body)
      const value = method === 'git.status'
        ? await gitStatus({ root, gitPath: '' }, { ignored: false, numstat: false })
        : method === 'git.stage'
          ? { ok: await gitStage({ root, gitPath: '' }, body.paths) }
          : method === 'git.commit'
            ? await gitCommit({ root, gitPath: '' }, body.message, body.amend === true)
            : method === 'git.messages'
              ? { messages: [] }
              : method === 'git.log'
                ? { commits: [], hasMore: false }
                : method === 'settings.update'
                  ? { value: {} }
                  : method === 'fs.tree'
                    ? { entries: [], truncated: false }
                    : method === 'terminal.shells'
                      ? { shells: [] }
                      : {}
      return { ok: true, status: 200, async json() { return { ok: true, value } } }
    }
    try {
      await store.refreshStatus({ force: true })
      const entry = store.state.status.entries.find(item => item.path === 'tracked.txt')
      assert.ok(entry !== undefined, 'the tracked change is listed')
      assert.equal(entry.untracked, false)
      // Checking a tracked file stages it right away — only an untracked file
      // waits for the commit. The commit itself takes the index only, so a
      // deferred tracked change would silently stay out of the commit.
      await store.setCommitChecked([entry], true)
      const staged = git('diff', '--cached', '--name-only').trim().split('\n')
      assert.ok(staged.includes('tracked.txt'), 'the tracked change is staged')
      await store.commit('change tracked', false, false)
      const committed = git('show', '--name-only', '--pretty=format:', 'HEAD').trim().split('\n')
      assert.ok(committed.includes('tracked.txt'), 'the file is part of the commit')
      assert.equal(git('status', '--porcelain').trim(), '', 'the worktree is clean')
    } finally {
      globalThis.fetch = originalFetch
      store.persist.cancel()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})