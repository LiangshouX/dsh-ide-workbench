/**
 * PERF-02 slice subscriptions for the Git, Commit and Terminal panels.
 *
 * The panels read a narrow slice of the workbench state through
 * `useStoreSlice` instead of the whole snapshot, so an unrelated write — a
 * toast, a terminal chunk, a file-tree change — no longer re-renders them.
 *
 * The assertions cover the three things that can go wrong: the slice misses
 * a field the panel reads (the panel would go stale), the slice is too wide
 * (the panel still re-renders for everything) and the migration broke a
 * panel's rendering.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { checkedPathsOf, splitCommitGroups } from '../src/client/commit-model.js'
import { shallowEqual } from '../src/client/hooks.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let modulePromise

async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    // The bundle lives inside the package so Node resolves the externalized
    // react from this package's node_modules. The file name differs from the
    // other suites so they can run in parallel.
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'perf-slice-git.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
          export { gitSlice, repoSlice, GitPanel, RepoPopover } from './src/client/GitPanel.jsx'
          export { commitSlice, CommitPanel } from './src/client/CommitPanel.jsx'
          export { terminalSlice, TerminalPanel } from './src/client/TerminalPanel.jsx'
        `,
        resolveDir: root,
        loader: 'js',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: ['node20'],
      external: ['react', 'react-dom', 'react-dom/server'],
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
  return modulePromise
}

const SAMPLE_DIFF = `diff --git a/src/app.js b/src/app.js
index 1111111..2222222 100644
--- a/src/app.js
+++ b/src/app.js
@@ -1,3 +1,3 @@
 const a = 1
-const b = 2
+const b = 3
`

function baseState() {
  return {
    workspaceRoot: 'C:\\work\\demo',
    root: 'C:\\work\\demo',
    projects: [{ path: 'C:\\work\\demo', name: 'demo', isRoot: true, isRepo: true }],
    gitRepoRoot: 'C:\\work\\demo',
    gitRepos: [{ path: 'C:\\work\\demo', name: 'demo' }, { path: 'C:\\work\\repo-a', name: 'repo-a' }],
    layout: { left: 'commit', leftWidth: 300, bottom: 'git', bottomHeight: 260, gitDrawerWidth: 420 },
    status: {
      isRepo: true,
      branch: 'main',
      detached: false,
      oid: 'abc1234',
      entries: [
        { path: 'src/app.js', xy: '.M', untracked: false, conflict: false, staged: false, unstaged: true, unstagedLines: { additions: 2, deletions: 1 } },
        { path: 'notes.txt', xy: '??', untracked: true, conflict: false, staged: false, unstaged: false },
      ],
    },
    git: {
      commits: [
        { hash: 'aaa', shortHash: 'aaa', parents: ['bbb'], author: 'Ann', email: 'a@x', date: '2026-10-20 10:00:00 +0800', refs: ['HEAD -> main'], subject: 'first' },
      ],
      branches: ['main'],
      compare: [],
      selectedHash: 'aaa',
      filters: { branch: '', since: '', author: '', query: '' },
      detail: {
        hash: 'aaa', shortHash: 'aaa', parents: ['bbb'], author: 'Ann', email: 'a@x',
        date: '2026-10-20 10:00:00 +0800', refs: ['HEAD -> main'], subject: 'first',
        body: 'Body line', diff: SAMPLE_DIFF,
      },
      detailHash: 'aaa',
      detailLoading: false,
      loading: false,
      error: null,
    },
    commit: {
      message: 'a commit message',
      amend: false,
      committing: false,
      committing2: false,
      messages: [],
      checked: new Set(),
      unchecked: new Set(),
      buckets: {},
      selectedPath: '',
      tasks: {},
      error: null,
      focusTick: 0,
    },
    terminal: {
      sessions: [{ key: 's1', title: 'pwsh', cwd: 'C:\\work\\demo', status: 'running' }],
      activeKey: 's1',
    },
    settings: {
      commit: { groupByDirectory: false, testCommand: '', optimizeImportsCommand: '', cleanupCommand: '' },
      git: { commitTemplate: '' },
      shortcuts: { jumpToSource: 'F4' },
      terminal: { fontSize: 13 },
      changelists: {},
    },
    tabs: [],
    activeId: null,
  }
}

/** A store that serves one snapshot, with the getters the panels read. */
function makeStore(state) {
  const store = {
    state,
    t: key => key,
    toast: () => {},
    patch: () => {},
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
  }
  return store
}

function render(mod, name, state) {
  const store = makeStore(state)
  const html = renderToStaticMarkup(React.createElement(mod[name], { store, state }))
  return { html, store }
}

test('the git slice returns exactly the fields the panel reads', async () => {
  const mod = await loadModule()
  const state = baseState()
  const slice = mod.gitSlice(state)
  assert.deepEqual(Object.keys(slice).sort(), [
    'branch', 'detached', 'drawerWidth', 'git', 'gitRepoRoot', 'gitRepos', 'isRepo', 'projects',
  ])
  assert.equal(slice.git, state.git)
  assert.equal(slice.branch, state.status.branch)
  assert.equal(slice.detached, state.status.detached)
  assert.equal(slice.isRepo, state.status.isRepo)
  assert.equal(slice.drawerWidth, state.layout.gitDrawerWidth)
  assert.equal(slice.projects, state.projects)
  assert.equal(slice.gitRepoRoot, state.gitRepoRoot)
  assert.equal(slice.gitRepos, state.gitRepos)
})

test('the commit slice returns exactly the fields the panel reads', async () => {
  const mod = await loadModule()
  const state = baseState()
  const slice = mod.commitSlice(state)
  // `ahead` and `upstream` came with the Push button: the panel needs to know
  // whether there is anything to push at all. `statusTruncated` and
  // `statusLimit` came with the scale guard of the status: the panel has to
  // say that the file list is incomplete.
  assert.deepEqual(Object.keys(slice).sort(), [
    'ahead', 'branch', 'commit', 'detached', 'entries', 'isRepo', 'oid', 'settings', 'statusLimit', 'statusTruncated', 'upstream', 'workspaceRoot',
  ])
  assert.equal(slice.commit, state.commit)
  assert.equal(slice.entries, state.status.entries)
  assert.equal(slice.isRepo, state.status.isRepo)
  assert.equal(slice.branch, state.status.branch)
  assert.equal(slice.detached, state.status.detached)
  assert.equal(slice.oid, state.status.oid)
  assert.equal(slice.ahead, state.status.ahead)
  assert.equal(slice.upstream, state.status.upstream)
  assert.equal(slice.statusTruncated, false)
  assert.equal(slice.statusLimit, undefined)
  assert.equal(slice.settings, state.settings)
  assert.equal(slice.workspaceRoot, state.workspaceRoot)
})

test('the terminal slice returns exactly the fields the panel reads', async () => {
  const mod = await loadModule()
  const state = baseState()
  const slice = mod.terminalSlice(state)
  assert.deepEqual(Object.keys(slice), ['terminal'])
  assert.equal(slice.terminal, state.terminal)
})

test('a change outside the slice keeps the slice identical', async () => {
  const mod = await loadModule()
  const before = baseState()
  // Unrelated writes: a toast, an open tab, a file-tree change. The store
  // replaces only the keys it changed, so every sliced field keeps its
  // identity.
  const after = {
    ...before,
    toast: { kind: 'info', text: 'hello' },
    tabs: [{ id: 'file:a.ts' }],
    activeId: 'file:a.ts',
    dirs: new Map([['C:\\work\\demo', { entries: [] }]]),
  }
  for (const [selector, name] of [[mod.gitSlice, 'git'], [mod.commitSlice, 'commit'], [mod.terminalSlice, 'terminal']]) {
    assert.equal(shallowEqual(selector(before), selector(after)), true, `${name} slice must ignore unrelated writes`)
  }
})

test('a change inside the slice invalidates the slice', async () => {
  const mod = await loadModule()
  const before = baseState()
  // Every case changes exactly one field of the slice — the other fields keep
  // their identity, so the slice may only differ because of that field.
  const git = { ...before, git: { ...before.git, selectedHash: 'bbb' } }
  assert.equal(shallowEqual(mod.gitSlice(before), mod.gitSlice(git)), false)

  const status = { ...before, status: { ...before.status, branch: 'feature' } }
  assert.equal(shallowEqual(mod.gitSlice(before), mod.gitSlice(status)), false)

  const width = { ...before, layout: { ...before.layout, gitDrawerWidth: 500 } }
  assert.equal(shallowEqual(mod.gitSlice(before), mod.gitSlice(width)), false)

  const commit = { ...before, commit: { ...before.commit, message: 'other' } }
  assert.equal(shallowEqual(mod.commitSlice(before), mod.commitSlice(commit)), false)

  const entries = { ...before, status: { ...before.status, entries: [] } }
  assert.equal(shallowEqual(mod.commitSlice(before), mod.commitSlice(entries)), false)

  const settings = { ...before, settings: { ...before.settings, commit: { groupByDirectory: true } } }
  assert.equal(shallowEqual(mod.commitSlice(before), mod.commitSlice(settings)), false)

  const terminal = { ...before, terminal: { ...before.terminal, sessions: [] } }
  assert.equal(shallowEqual(mod.terminalSlice(before), mod.terminalSlice(terminal)), false)
})

test('the panels read the store snapshot, not the state prop', async () => {
  const mod = await loadModule()
  const snapshot = baseState()
  // The prop carries a different world: the panels must follow the store.
  const prop = baseState()
  prop.git = { ...prop.git, detail: null }
  prop.status = { ...prop.status, isRepo: false }
  const store = makeStore(snapshot)
  const html = renderToStaticMarkup(React.createElement(mod.GitPanel, { store, state: prop }))
  assert.match(html, /iwb-git-drawer/)
  assert.match(html, /iwb-git-tree-dir/)
  assert.match(html, /iwb-git-drawer-meta/)
})

test('the commit drawer still renders the changed-file tree', async () => {
  const mod = await loadModule()
  const { html } = render(mod, 'GitPanel', baseState())
  assert.match(html, /iwb-git-drawer/)
  assert.match(html, /iwb-git-tree/)
  assert.match(html, /iwb-git-tree-dir/)
  assert.match(html, /title="src\/app\.js"/)
  assert.doesNotMatch(html, /iwb-git-drawer-inline/)
})

test('the repository picker still lists the candidate repositories', async () => {
  const mod = await loadModule()
  const state = baseState()
  const store = makeStore(state)
  const html = renderToStaticMarkup(React.createElement(mod.RepoPopover, { store, x: 10, y: 20, onClose: () => {} }))
  assert.match(html, /iwb-repo-popover/)
  assert.match(html, /demo/)
  assert.match(html, /repo-a/)
  // The current repository is marked.
  assert.equal((html.match(/iwb-branch-check">✓/g) ?? []).length, 1)
})

test('the commit groups still render their files and checkboxes', async () => {
  const mod = await loadModule()
  const { html } = render(mod, 'CommitPanel', baseState())
  assert.match(html, /iwb-file-row/)
  assert.match(html, /app\.js/)
  assert.match(html, /notes\.txt/)
  assert.equal((html.match(/type="checkbox"/g) ?? []).length >= 2, true)
  assert.match(html, /commit\.title/)
})

test('the terminal tabs still render their sessions', async () => {
  const mod = await loadModule()
  const { html } = render(mod, 'TerminalPanel', baseState())
  assert.match(html, /iwb-term-tab/)
  assert.match(html, /pwsh/)
  assert.match(html, /iwb-term-pane/)
})

test('the migrated panels no longer read the state prop', async () => {
  const mod = await loadModule()
  // A state prop that throws on any read: a panel that still uses the prop
  // fails the render instead of silently reading a stale snapshot.
  const forbidden = new Proxy({}, {
    get(target, property) {
      throw new Error(`the panel read state.${String(property)}`)
    },
  })
  for (const name of ['GitPanel', 'CommitPanel', 'TerminalPanel']) {
    const store = makeStore(baseState())
    const html = renderToStaticMarkup(React.createElement(mod[name], { store, state: forbidden }))
    assert.ok(html.length > 0)
  }
})
