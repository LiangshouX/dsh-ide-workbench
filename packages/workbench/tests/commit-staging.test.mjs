/**
 * COMMIT-01: checking a file never writes the index (PRD-v4 §3.1).
 *
 * An untracked file is added to the index when the commit is made, not when
 * its checkbox is ticked — so the row keeps its `U` letter and its untracked
 * colour while it waits. A failed Add aborts the commit and leaves the index
 * as it was. Switching the project drops the selection of the old repository
 * (§3.2).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkbenchStore } from '../src/client/store.js'
import { isEntryChecked } from '../src/client/commit-model.js'
import { commit as gitCommit, stage as gitStage, status as gitStatus } from '../src/host/git.js'

const ROOT = 'C:\\work\\demo'

/** A store whose workspace is the given root. */
function fakeStore(root = ROOT) {
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new WorkbenchStore(ctx, key => key)
  store.state = {
    ...store.state,
    workspaceRoot: root,
    root,
    phase: 'ready',
    status: { isRepo: true, branch: 'main', entries: [] },
    settings: { editor: { openMode: 'auto', editableMaxBytes: 1 << 20 }, shortcuts: {} },
  }
  return store
}

/** One untracked entry as the host reports it. */
function untracked(path = 'new.txt') {
  return { path, xy: '??', untracked: true, staged: false, unstaged: false, ignored: false }
}

/** Install a fetch mock; `routes` maps method → (body) => value (or throws). */
function mockFetch(routes, calls = []) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/ide-workbench/api/')[1]
    const body = JSON.parse(init.body)
    calls.push({ method, body })
    const route = routes[method]
    if (route === undefined) throw new Error(`unexpected ${method}`)
    try {
      const value = await route(body)
      return { ok: true, status: 200, async json() { return { ok: true, value } } }
    } catch (error) {
      return {
        ok: false,
        status: 500,
        async json() { return { ok: false, error: { code: error.code ?? 'error', message: error.message } } },
      }
    }
  }
  return () => { globalThis.fetch = original }
}

/** The routes a commit needs. */
function commitRoutes(extra = {}) {
  return {
    'git.status': () => ({ isRepo: true, entries: [], subprocesses: 1 }),
    'git.messages': () => ({ messages: [] }),
    'git.log': () => ({ commits: [], hasMore: false }),
    'settings.update': () => ({ value: {} }),
    'fs.tree': () => ({ entries: [], truncated: false }),
    'terminal.shells': () => ({ shells: [] }),
    ...extra,
  }
}

const stageCalls = calls => calls.filter(call => call.method === 'git.stage')
const unstageCalls = calls => calls.filter(call => call.method === 'git.unstage')

test('checking an untracked file does not write the index', async () => {
  const store = fakeStore()
  const entry = untracked()
  store.state.status = { isRepo: true, branch: 'main', entries: [entry] }
  const calls = []
  const restore = mockFetch(commitRoutes(), calls)
  try {
    await store.setCommitChecked([entry], true)
    assert.deepEqual(stageCalls(calls), [], 'the index is untouched')
    assert.deepEqual(unstageCalls(calls), [])
    // The path waits for the commit.
    assert.equal(store.state.commit.pendingStage.has('new.txt'), true)
    assert.equal(store.state.commit.checked.has('new.txt'), true)
    // The row stays in the Unversioned group.
    assert.equal(store.state.commit.buckets['new.txt'], 'untracked')
    // "checked but not yet added" is expressed by the checked set.
    assert.equal(isEntryChecked(entry, store.state.commit), true)
    assert.equal(entry.staged, false)
  } finally {
    store.persist.cancel()
    restore()
  }
})

test('unchecking an untracked file has no index side effect', async () => {
  const store = fakeStore()
  const entry = untracked()
  store.state.status = { isRepo: true, branch: 'main', entries: [entry] }
  const calls = []
  const restore = mockFetch(commitRoutes(), calls)
  try {
    await store.setCommitChecked([entry], true)
    await store.setCommitChecked([entry], false)
    assert.deepEqual(stageCalls(calls), [])
    assert.deepEqual(unstageCalls(calls), [], 'a file that was never added needs no reset')
    assert.equal(store.state.commit.pendingStage.has('new.txt'), false)
    assert.equal(isEntryChecked(entry, store.state.commit), false)
  } finally {
    store.persist.cancel()
    restore()
  }
})

test('the group header checkbox does not add untracked files either', async () => {
  const store = fakeStore()
  const entries = [untracked('a.txt'), untracked('b.txt')]
  store.state.status = { isRepo: true, branch: 'main', entries }
  const calls = []
  const restore = mockFetch(commitRoutes(), calls)
  try {
    // The header checkbox checks every row of the group at once.
    await store.setCommitChecked(entries, true)
    assert.deepEqual(stageCalls(calls), [], 'selecting all does not add anything')
    assert.equal(store.state.commit.pendingStage.size, 2)
  } finally {
    store.persist.cancel()
    restore()
  }
})

test('committing adds the checked untracked files first', async () => {
  const store = fakeStore()
  const entry = untracked()
  store.state.status = { isRepo: true, branch: 'main', entries: [entry] }
  const calls = []
  const restore = mockFetch(commitRoutes({
    'git.stage': () => ({ ok: true }),
    'git.commit': () => ({ hash: 'abc1234' }),
  }), calls)
  try {
    await store.setCommitChecked([entry], true)
    await store.commit('a message', false, false)
    const methods = calls.map(call => call.method)
    const stage = methods.indexOf('git.stage')
    const commit = methods.indexOf('git.commit')
    assert.ok(stage >= 0, 'the Add runs')
    assert.ok(commit >= 0, 'the commit runs')
    assert.ok(stage < commit, 'the Add runs before the commit')
    assert.deepEqual(calls[stage].body.paths, ['new.txt'])
    // The selection is cleared after a successful commit.
    assert.equal(store.state.commit.pendingStage.size, 0)
    assert.equal(store.state.commit.checked.size, 0)
  } finally {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.persist.cancel()
    restore()
  }
})

test('a failed Add aborts the commit and rolls the index back', async () => {
  const store = fakeStore()
  const entry = untracked()
  store.state.status = { isRepo: true, branch: 'main', entries: [entry] }
  const calls = []
  const restore = mockFetch(commitRoutes({
    'git.stage': () => { throw new Error('add failed') },
    'git.unstage': () => ({ ok: true }),
    'git.commit': () => ({ hash: 'abc1234' }),
  }), calls)
  try {
    await store.setCommitChecked([entry], true)
    await store.commit('a message', false, false)
    const methods = calls.map(call => call.method)
    assert.equal(methods.includes('git.commit'), false, 'the commit is not made')
    assert.equal(methods.includes('git.unstage'), true, 'the index is rolled back')
    assert.deepEqual(unstageCalls(calls)[0].body.paths, ['new.txt'])
    assert.equal(store.state.commit.committing, false)
    assert.ok(store.state.commit.error, 'the failure is reported')
    // The selection survives, so the user can retry.
    assert.equal(store.state.commit.pendingStage.has('new.txt'), true)
  } finally {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.persist.cancel()
    restore()
  }
})

test('switching the project drops the commit selection', async () => {
  const store = fakeStore()
  const entry = untracked()
  store.state.status = { isRepo: true, branch: 'main', entries: [entry] }
  store.state.projects = [
    { path: ROOT, isRoot: true, isRepo: true },
    { path: `${ROOT}\\other`, isRoot: false, isRepo: true },
  ]
  const calls = []
  const restore = mockFetch(commitRoutes(), calls)
  try {
    await store.setCommitChecked([entry], true)
    assert.equal(store.state.commit.pendingStage.has('new.txt'), true)
    await store.selectProject(`${ROOT}\\other`)
    assert.equal(store.state.commit.pendingStage.size, 0)
    assert.equal(store.state.commit.checked.size, 0)
    assert.equal(store.state.commit.unchecked.size, 0)
    assert.deepEqual(store.state.commit.buckets, {})
  } finally {
    store.persist.cancel()
    restore()
  }
})

test('the real index stays untouched until the commit', async (t) => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
  } catch {
    t.skip('git is not installed')
    return
  }
  const dir = await mkdtemp(join(tmpdir(), 'iwb-commit-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'IDE Test')
    git('config', 'user.email', 'ide@test.local')
    git('config', 'commit.gpgsign', 'false')
    await writeFile(join(dir, 'a.txt'), 'one\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'base')
    await writeFile(join(dir, 'new.txt'), 'two\n')
    const root = await realpath(dir)
    const store = fakeStore(root)
    const calls = []
    const restore = mockFetch(commitRoutes({
      'git.status': async () => gitStatus({ root, gitPath: '' }, { ignored: false, numstat: false }),
      'git.stage': async body => { await gitStage({ root, gitPath: '' }, body.paths); return { ok: true } },
      'git.unstage': async () => ({ ok: true }),
      'git.commit': async body => gitCommit({ root, gitPath: '' }, body.message, body.amend === true),
    }), calls)
    try {
      await store.refreshStatus({ force: true })
      const entry = store.state.status.entries.find(item => item.path === 'new.txt')
      assert.ok(entry !== undefined, 'the untracked file is listed')
      assert.equal(entry.untracked, true)
      // Checking the row does not touch the index.
      await store.setCommitChecked([entry], true)
      assert.equal(git('diff', '--cached', '--name-only').trim(), '', 'the index is empty')
      assert.match(git('status', '--porcelain'), /\?\? new\.txt/)
      // A tracked, modified file is still staged when it is checked: the
      // commit writes the index only, so it would be left out otherwise.
      await writeFile(join(dir, 'a.txt'), 'one\nchanged\n')
      await store.refreshStatus({ force: true })
      const modified = store.state.status.entries.find(item => item.path === 'a.txt')
      assert.ok(modified !== undefined, 'the modified file is listed')
      assert.equal(modified.untracked, false)
      await store.setCommitChecked([modified], true)
      assert.match(git('diff', '--cached', '--name-only'), /a\.txt/, 'the tracked file is staged')
      // The commit adds it.
      await store.commit('add new', false, false)
      const committed = git('show', '--name-only', '--pretty=format:', 'HEAD').trim().split('\n')
      assert.ok(committed.includes('new.txt'), 'the file is part of the commit')
      assert.ok(committed.includes('a.txt'), 'the modified file is part of the commit')
      assert.equal(git('status', '--porcelain').trim(), '', 'the worktree is clean')
    } finally {
      restore()
      store.persist.cancel()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
