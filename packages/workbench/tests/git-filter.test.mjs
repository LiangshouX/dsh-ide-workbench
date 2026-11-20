/**
 * The filters of the Git window (PRD-v8).
 *
 * Two defects are guarded here:
 *
 *   1. The branch scope was a text button whose LABEL WAS ITS OWN STATE
 *      (`仅当前分支` / `所有分支`). It read like a static label, and nobody
 *      could tell whether it was a filter, a display or a switch. It is a
 *      segmented control now: it names both options, marks the chosen one
 *      and says so to a screen reader.
 *   2. Every filter change started a `git log` subprocess over the whole
 *      repository - that was the "switching the branch lags" defect. The
 *      filters are answered from the rows that are already loaded; only the
 *      path filter reaches git, because only git can limit the history of a
 *      path.
 *
 * The client-side filter is a pure function (`filterGitLog`), so the rows it
 * keeps and the rows it drops are observable without a browser.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { WorkbenchStore } from '../src/client/store.js'
import { filterGitLog } from '../src/client/git-layout.js'
import { log } from '../src/host/git.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = 'C:\\work\\demo'

let modulePromise

async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    // The bundle lives inside the package so Node resolves the externalized
    // react from this package's node_modules. The file name differs from the
    // other suites so they can run in parallel.
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'git-filter.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
          export * from './src/client/GitPanel.jsx'
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

/** The commits the host answers with: one branch, three commits. */
const COMMITS = [
  { hash: 'aaa', shortHash: 'aaa', parents: ['bbb'], author: 'Ann', email: 'ann@x', date: '2026-10-20 10:00:00 +0800', refs: ['HEAD -> main', 'main'], subject: 'fix the parser' },
  { hash: 'bbb', shortHash: 'bbb', parents: ['ccc'], author: 'Bob', email: 'bob@x', date: '2026-10-21 10:00:00 +0800', refs: [], subject: 'chore: rename' },
  { hash: 'ccc', shortHash: 'ccc', parents: [], author: 'Ann', email: 'ann@x', date: '2026-10-22 10:00:00 +0800', refs: [], subject: 'fix the tests' },
]

/** A store that serves one snapshot, with the getters the panel reads. */
function makeStore(state) {
  const store = {
    state,
    t: key => key,
    toast: () => {},
    patch: () => {},
    subscribe: () => () => {},
    getSnapshot: () => store.state,
    loadLog: async () => {},
    loadBranches: async () => {},
    refreshStatus: async () => {},
    setGitFilters: () => {},
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

/** The state the Git panel renders. */
function panelState(overrides = {}) {
  const filters = { branch: 'main', since: '', author: '', query: '', path: '', ...(overrides.filters ?? {}) }
  return {
    root: ROOT,
    workspaceRoot: ROOT,
    projects: [],
    gitRepoRoot: ROOT,
    gitRepos: [{ path: ROOT, name: 'demo' }],
    layout: { gitDrawerWidth: 420, bottom: 'git' },
    status: { isRepo: true, branch: 'main', detached: false, oid: 'abc1234', entries: [] },
    settings: { commit: {}, git: {}, shortcuts: {}, terminal: { fontSize: 13 }, changelists: {} },
    git: {
      commits: COMMITS,
      branches: ['main'],
      compare: [],
      selectedHash: null,
      filters,
      detail: null,
      detailHash: null,
      detailLoading: false,
      loading: false,
      error: null,
      ...(overrides.git ?? {}),
    },
    commit: { message: '', amend: false, committing: false, messages: [], checked: new Set(), unchecked: new Set(), buckets: {}, selectedPath: '', tasks: {} },
    terminal: { sessions: [], activeKey: null },
    tabs: [],
    activeId: null,
  }
}

/** The markup of the segmented control of the branch scope. */
function scopeControl(html) {
  const match = /<div[^>]*class="iwb-seg"[^>]*role="radiogroup"[^>]*>[\s\S]*?<\/div>/.exec(html)
  return match === null ? '' : match[0]
}

/** The opening tags of the buttons of the segmented control. */
function scopeButtons(html) {
  return [...scopeControl(html).matchAll(/<button[^>]*>/g)].map(match => match[0])
}

/** Render the Git panel with one state. */
async function renderPanel(state) {
  const mod = await loadModule()
  const store = makeStore(state)
  return renderToStaticMarkup(React.createElement(mod.GitPanel, { store, state }))
}

/** A store of the workbench, with a repository. */
function workbenchStore() {
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new WorkbenchStore(ctx, key => key)
  store.state = {
    ...store.state,
    workspaceRoot: ROOT,
    root: ROOT,
    gitRepoRoot: ROOT,
    phase: 'ready',
    status: { isRepo: true, branch: 'main', detached: false, oid: 'abc1234', entries: [] },
    settings: { editor: { openMode: 'auto', editableMaxBytes: 1 << 20 }, shortcuts: {} },
  }
  return store
}

/** Install a fetch mock that records every call. */
function mockFetch(calls = []) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/ide-workbench/api/')[1]
    const body = JSON.parse(init.body)
    calls.push({ method, body })
    const value = method === 'git.log'
      ? { commits: COMMITS, hasMore: false }
      : method === 'git.status'
        ? { isRepo: true, branch: 'main', entries: [], subprocesses: 1 }
        : { value: {} }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  return () => { globalThis.fetch = original }
}

/** The calls of one method. */
function callsOf(calls, method) {
  return calls.filter(call => call.method === method)
}

test('the branch scope is a segmented control that marks the chosen option', async () => {
  const html = await renderPanel(panelState())
  const control = scopeControl(html)
  assert.notEqual(control, '', 'the branch scope must be a segmented control')
  assert.match(control, /aria-label="git\.scopeLabel"/, 'the control names the scope it switches')
  const buttons = scopeButtons(html)
  assert.equal(buttons.length, 2, 'the control names both options')
  // The chosen option is marked - visually and for a screen reader.
  assert.match(buttons[0], /role="radio"/)
  assert.match(buttons[0], /aria-checked="true"/)
  assert.match(buttons[0], /class="[^"]*iwb-on/)
  assert.match(buttons[1], /role="radio"/)
  assert.match(buttons[1], /aria-checked="false"/)
  assert.doesNotMatch(buttons[1], /iwb-on/)
  // The two options are named.
  assert.match(control, /git\.scopeCurrent/)
  assert.match(control, /git\.scopeAll/)
})

test('the scope control follows the scope that is chosen', async () => {
  const all = await renderPanel(panelState({ filters: { branch: '' } }))
  const buttons = scopeButtons(all)
  assert.match(buttons[0], /aria-checked="false"/)
  assert.match(buttons[1], /aria-checked="true"/)
  assert.match(buttons[1], /class="[^"]*iwb-on/)
  assert.doesNotMatch(buttons[0], /iwb-on/)
})

test('the button whose label was its own state is gone', async () => {
  const html = await renderPanel(panelState())
  // The old control said `仅当前分支` / `所有分支` - a label that WAS the
  // state. It is replaced by the segmented control above.
  assert.doesNotMatch(html, /git\.currentBranchOnly/)
  assert.doesNotMatch(html, /git\.allBranches/)
  // The row reads as two clusters: the scope and the filters.
  assert.match(html, /class="iwb-git-scope"/)
  assert.match(html, /class="iwb-git-filter-fields"/)
})

test('the clear-filters affordance appears only when a filter is doing something', async () => {
  const clean = await renderPanel(panelState())
  assert.doesNotMatch(clean, /git\.clearFilters/)
  const filtered = await renderPanel(panelState({ filters: { author: 'ann' } }))
  assert.match(filtered, /git\.clearFilters/)
})

test('a filter change does not refetch the log (the old contract refetched)', async () => {
  const store = workbenchStore()
  const calls = []
  const restore = mockFetch(calls)
  try {
    await store.loadLog(true)
    assert.equal(callsOf(calls, 'git.log').length, 1, 'the log is loaded once')
    // The branch scope, the author, the message and the date are answered on
    // the client: no subprocess, no refetch.
    store.setGitFilters({ branch: 'feature' })
    store.setGitFilters({ author: 'ann' })
    store.setGitFilters({ query: 'fix' })
    store.setGitFilters({ since: '7 days ago' })
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(
      callsOf(calls, 'git.log').length,
      1,
      'a filter change must not start another `git log` - that was the lag',
    )
    // The rows are still there: a filter change never empties the list.
    assert.equal(store.state.git.commits.length, COMMITS.length)
  } finally {
    store.persist.cancel()
    restore()
  }
})

test('the path filter still goes to the host', async () => {
  const store = workbenchStore()
  const calls = []
  const restore = mockFetch(calls)
  try {
    await store.loadLog(true)
    store.setGitFilters({ path: 'src/app.js' })
    await new Promise(resolve => setTimeout(resolve, 0))
    const logs = callsOf(calls, 'git.log')
    assert.equal(logs.length, 2, 'the path filter is a server-side one: it reloads the log')
    assert.equal(logs[1].body.path, 'src/app.js')
    // The other filters never reach the host.
    assert.equal(logs[1].body.branch, undefined)
    assert.equal(logs[1].body.author, undefined)
    assert.equal(logs[1].body.query, undefined)
    assert.equal(logs[1].body.since, undefined)
  } finally {
    store.persist.cancel()
    restore()
  }
})

test('the client-side filter keeps the rows that match and drops the ones that do not', () => {
  // The message filter.
  assert.deepEqual(filterGitLog(COMMITS, { query: 'fix' }).map(commit => commit.hash), ['aaa', 'ccc'])
  assert.deepEqual(filterGitLog(COMMITS, { query: 'FIX' }).map(commit => commit.hash), ['aaa', 'ccc'])
  // The author filter matches the name and the address.
  assert.deepEqual(filterGitLog(COMMITS, { author: 'bob' }).map(commit => commit.hash), ['bbb'])
  assert.deepEqual(filterGitLog(COMMITS, { author: 'ann@x' }).map(commit => commit.hash), ['aaa', 'ccc'])
  // The date filter.
  const now = Date.UTC(2026, 9, 22, 4, 0, 0)
  assert.deepEqual(
    filterGitLog(COMMITS, { since: '1 days ago' }, { now }).map(commit => commit.hash),
    ['ccc'],
  )
  assert.deepEqual(
    filterGitLog(COMMITS, { since: '30 days ago' }, { now }).map(commit => commit.hash),
    ['aaa', 'bbb', 'ccc'],
  )
  // No filter at all: every row stays.
  assert.deepEqual(filterGitLog(COMMITS, {}).map(commit => commit.hash), ['aaa', 'bbb', 'ccc'])
})

test('the branch scope is the history of the branch, not the tips of the refs', () => {
  const commits = [
    { hash: 'f1', shortHash: 'f1', parents: ['m1'], author: 'Ann', email: 'ann@x', date: '2026-10-21 10:00:00 +0800', refs: ['feature'], subject: 'feature tip' },
    { hash: 'm1', shortHash: 'm1', parents: ['m0'], author: 'Ann', email: 'ann@x', date: '2026-10-20 10:00:00 +0800', refs: ['HEAD -> main', 'main'], subject: 'main tip' },
    { hash: 'm0', shortHash: 'm0', parents: [], author: 'Ann', email: 'ann@x', date: '2026-10-19 10:00:00 +0800', refs: [], subject: 'the shared history' },
  ]
  // `git log main` is the tip of main and the history behind it - the tip of
  // the feature branch is NOT in it, even though its ref is in the rows.
  assert.deepEqual(filterGitLog(commits, { branch: 'main' }).map(commit => commit.hash), ['m1', 'm0'])
  // `git log feature` is the tip of the feature branch and everything behind it.
  assert.deepEqual(filterGitLog(commits, { branch: 'feature' }).map(commit => commit.hash), ['f1', 'm1', 'm0'])
  // A branch that is not in the rows has nothing to show.
  assert.deepEqual(filterGitLog(commits, { branch: 'other' }).map(commit => commit.hash), [])
})

test('the panel renders the rows the filters let through', async () => {
  const html = await renderPanel(panelState({ filters: { author: 'bob' } }))
  assert.match(html, /chore: rename/)
  assert.doesNotMatch(html, /fix the parser/)
  assert.doesNotMatch(html, /fix the tests/)
})

test('the log page carries the history of the branch that is checked out', async (t) => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
  } catch {
    t.skip('git is not installed')
    return
  }
  const dir = await mkdtemp(join(tmpdir(), 'iwb-git-filter-'))
  // The dates are fixed: the order of the commits must not depend on how
  // fast the machine writes them.
  const git = (args, env = {}) => execFileSync('git', args, {
    cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  })
  const commit = async (name, message, date) => {
    await writeFile(join(dir, name), `${message}\n`)
    git(['add', '-A'])
    git(['commit', '-q', '-m', message], {
      GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date,
    })
  }
  try {
    git(['init', '-q', '-b', 'main'])
    git(['config', 'user.name', 'IDE Test'])
    git(['config', 'user.email', 'ide@test.local'])
    git(['config', 'commit.gpgsign', 'false'])
    await commit('a.txt', 'one', '2026-01-01T00:00:00+0000')
    // A branch that stays behind: its tip is older than the newest commits.
    git(['branch', 'old'])
    await commit('b.txt', 'two', '2026-02-01T00:00:00+0000')
    await commit('c.txt', 'three', '2026-03-01T00:00:00+0000')

    // The window of the whole repository does not have the tip of `old`.
    const all = await log({ root: dir, gitPath: '' }, { count: 2 })
    assert.deepEqual(all.map(commit => commit.subject), ['three', 'two'])

    // The branch that is checked out is behind that window: the page carries
    // its history as well, or the "current branch" scope would have nothing
    // to show.
    git(['checkout', '-q', 'old'])
    const page = await log({ root: dir, gitPath: '' }, { count: 2 })
    assert.deepEqual(page.map(commit => commit.subject), ['three', 'two', 'one'])
    // And the client can answer the scope from that page.
    assert.deepEqual(
      filterGitLog(page, { branch: 'old' }).map(commit => commit.subject),
      ['one'],
    )
    assert.deepEqual(
      filterGitLog(page, { branch: 'main' }).map(commit => commit.subject),
      ['three', 'two', 'one'],
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
