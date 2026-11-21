/**
 * The status of the repository is refreshed by an event, not by a poll.
 *
 * The plugin asked the host for the git status every two seconds, and every
 * tick ran `git status` in the HOST process - the process of DSH itself - and
 * shipped the whole snapshot to the browser. The host now watches the work
 * tree and answers "nothing changed" without running git and without sending
 * the snapshot again.
 *
 * The gates below are behavioural and free of any clock: they drive the watch
 * with a fake one and compare the answers, so they say the same thing on a
 * fast machine and on a slow one.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { watch } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StatusCache, STATUS_FALLBACK_MS } from '../src/host/status-cache.js'
import { gitProcessCount } from '../src/host/git.js'
import { apply } from '../src/index.js'

// ── the cache of the host ────────────────────────────────────────────────

/**
 * A watch that records the callback, so that the gates can fire an event.
 * @returns {{ watch: Function, fire: (filename: string) => void, closed: () => boolean }}
 */
function fakeWatch() {
  let callback = null
  let closed = false
  const watch = (root, options, listener) => {
    callback = listener
    return { close() { closed = true } }
  }
  return {
    watch,
    fire(filename) { if (callback !== null) callback('change', filename) },
    closed: () => closed,
  }
}

test('a snapshot that nothing changed stays the snapshot of the client', () => {
  const watcher = fakeWatch()
  const cache = new StatusCache({ watch: watcher.watch })
  const entry = cache.entry('C:\\repo')
  cache.watchTree(entry, 'C:\\repo', true)
  const revision = cache.publish(entry, '--')
  assert.equal(revision > 0, true, 'the snapshot has a revision of its own')
  // The client names the revision it holds: the host needs no new snapshot.
  assert.equal(cache.isCurrent(entry, revision, '--'), true)
  // A client that holds nothing (or something else) needs a new one.
  assert.equal(cache.isCurrent(entry, 0, '--'), false)
  assert.equal(cache.isCurrent(entry, revision + 1, '--'), false)
})

test('a change in the work tree makes the snapshot stale', () => {
  const watcher = fakeWatch()
  const cache = new StatusCache({ watch: watcher.watch })
  const entry = cache.entry('C:\\repo')
  cache.watchTree(entry, 'C:\\repo', true)
  const revision = cache.publish(entry, '--')
  assert.equal(cache.isCurrent(entry, revision, '--'), true)
  // The file system says that something changed.
  watcher.fire('src\\a.ts')
  assert.equal(cache.isCurrent(entry, revision, '--'), false, 'the snapshot has to be taken again')
})

test('a change the watcher missed is caught by the fallback', () => {
  const watcher = fakeWatch()
  const cache = new StatusCache({ watch: watcher.watch })
  const entry = cache.entry('C:\\repo')
  cache.watchTree(entry, 'C:\\repo', true)
  const revision = cache.publish(entry, '--')
  const at = entry.at
  // The watcher said nothing - the change was missed. The snapshot still has
  // a bounded life: after it, the next request takes a new one.
  assert.equal(cache.isCurrent(entry, revision, '--', at + STATUS_FALLBACK_MS - 1), true)
  assert.equal(cache.isCurrent(entry, revision, '--', at + STATUS_FALLBACK_MS), false)
})

test('the repository writing into itself is not a change of the work tree', () => {
  const watcher = fakeWatch()
  const cache = new StatusCache({ watch: watcher.watch })
  const entry = cache.entry('C:\\repo')
  cache.watchTree(entry, 'C:\\repo', true)
  const revision = cache.publish(entry, '--')
  // Git refreshes its index from time to time: that is a write INTO the
  // repository, not a change of the work tree. Without this filter the
  // snapshot would mark its own repository as changed and run for ever.
  watcher.fire('.git\\index')
  assert.equal(cache.isCurrent(entry, revision, '--'), true, 'the index is not the work tree')
})

test('a change that happens while the snapshot is taken is not swallowed', () => {
  const watcher = fakeWatch()
  const cache = new StatusCache({ watch: watcher.watch })
  const entry = cache.entry('C:\\repo')
  cache.watchTree(entry, 'C:\\repo', true)
  // The snapshot starts here...
  const seen = cache.changesOf(entry)
  // ...and the work tree changes while git reads it.
  watcher.fire('src\\a.ts')
  cache.publish(entry, '--', seen)
  assert.equal(cache.isCurrent(entry, entry.revision, '--'), false, 'the change is still to be seen')
})

test('a watch that cannot be established keeps the status correct', () => {
  const cache = new StatusCache({
    watch: () => { throw new Error('ENOSPC: the watch limit of the kernel') },
  })
  const entry = cache.entry('C:\\repo')
  assert.equal(cache.watchTree(entry, 'C:\\repo', true), false)
  const revision = cache.publish(entry, '--')
  // Without a watch the host cannot know that nothing changed, so it takes a
  // new snapshot on every request - the behaviour of the plugin before the
  // watch, which is correct but slower.
  assert.equal(cache.isCurrent(entry, revision, '--'), false)
})

test('a snapshot that failed is taken again', () => {
  const watcher = fakeWatch()
  const cache = new StatusCache({ watch: watcher.watch })
  const entry = cache.entry('C:\\repo')
  cache.watchTree(entry, 'C:\\repo', true)
  const revision = cache.publish(entry, '--')
  assert.equal(cache.isCurrent(entry, revision, '--'), true)
  // The git call failed: there is no snapshot to reuse, so the next request
  // has to try again - otherwise the client would keep the error for ever.
  cache.invalidate(entry)
  assert.equal(cache.isCurrent(entry, revision, '--'), false)
})

test('a work tree that nobody asks for any more releases its watch', () => {
  const watcher = fakeWatch()
  const cache = new StatusCache({ watch: watcher.watch, idleMs: 1000 })
  const entry = cache.entry('C:\\repo')
  cache.watchTree(entry, 'C:\\repo', true)
  assert.equal(watcher.closed(), false)
  cache.sweep(entry.touchedAt + 999)
  assert.equal(watcher.closed(), false, 'the watch stays while the client asks')
  cache.sweep(entry.touchedAt + 1001)
  assert.equal(watcher.closed(), true, 'the watch of an idle work tree is closed')
  assert.equal(cache.entries.size, 0, 'the entry is gone with its watch')
})

test('the teardown of the plugin closes every watch', () => {
  const watcher = fakeWatch()
  const cache = new StatusCache({ watch: watcher.watch })
  const entry = cache.entry('C:\\repo')
  cache.watchTree(entry, 'C:\\repo', true)
  cache.clear()
  assert.equal(watcher.closed(), true)
  assert.equal(cache.entries.size, 0)
})

// ── the route of the host ────────────────────────────────────────────────

/**
 * A Cordis-like context that records what the plugin mounts.
 * @returns {any} the context and the routes
 */
function fakeContext() {
  const routes = []
  const disposers = []
  const services = new Map()
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    get: service => services.get(service),
    provide(service, value) {
      services.set(service, value)
      return () => services.delete(service)
    },
    effect(execute) {
      const result = execute()
      if (typeof result === 'function') disposers.push(result)
      return () => {}
    },
    subprocess: { spawn() { throw new Error('the gate must not start a terminal') } },
    connection: { requestRejection: () => undefined },
    workspaceRegistry: { list: () => [], create: async () => ({ id: 'x', path: 'C:\\', title: 'x' }) },
    webServer: {
      register(spec) { routes.push(spec); return () => {} },
      registerUpgrade() { return () => {} },
    },
  }
  return { ctx, routes, disposers }
}

/**
 * One request of the JSON API.
 * @param {string} method the method of the route
 * @param {object} body the payload
 * @returns {Promise<any>} the value of the answer
 */
async function callRoute(routes, method, body) {
  const route = routes.find(item => item.path === '/ide-workbench/api')
  const text = JSON.stringify(body)
  const req = {
    method: 'POST',
    url: `/ide-workbench/api/${method}`,
    headers: { host: '127.0.0.1:14442' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(text, 'utf8') },
  }
  let answer = null
  const res = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    status: 0,
    body: '',
    writeHead(status) { this.status = status; this.headersSent = true },
    end(chunk) { if (chunk !== undefined) this.body += chunk; this.writableEnded = true },
    on() { return this },
    off() { return this },
    destroy() { this.destroyed = true },
  }
  await route.handler(req, res)
  const parsed = JSON.parse(res.body)
  assert.equal(parsed.ok, true, `the route failed: ${res.body}`)
  return parsed.value
}

/**
 * Whether this platform can watch a work tree recursively.
 *
 * The watch is what makes the refresh event driven. A platform without it
 * (a Node that is too old for a recursive watch, a kernel whose watch limit
 * is reached) keeps the behaviour of the plugin before the watch: correct,
 * but the poll runs git every time.
 * @param {string} root the directory to watch
 * @returns {boolean} whether the watch works
 */
function canWatch(root) {
  try {
    const watcher = watch(root, { recursive: true, persistent: false }, () => {})
    watcher.close()
    return true
  } catch {
    return false
  }
}

test('the poll of an unchanged work tree does not run git at all', async (t) => {
  const previousProfile = process.env.DSH_PROFILE_DIR
  const profile = await mkdtemp(join(tmpdir(), 'iwb-profile-'))
  const repo = await mkdtemp(join(tmpdir(), 'iwb-repo-'))
  process.env.DSH_PROFILE_DIR = profile
  const { ctx, routes, disposers } = fakeContext()
  try {
    try { execFileSync('git', ['--version'], { stdio: 'ignore' }) } catch {
      t.skip('git is not installed')
      return
    }
    const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] })
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'IDE Test')
    git('config', 'user.email', 'ide@test.local')
    git('config', 'commit.gpgsign', 'false')
    await writeFile(join(repo, 'a.txt'), 'a\n', 'utf8')
    git('add', '-A')
    git('commit', '-q', '-m', 'base')
    if (canWatch(repo) !== true) {
      t.diagnostic('this platform cannot watch a work tree recursively: the refresh stays a poll')
      return
    }

    apply(ctx)
    const before = gitProcessCount()
    const first = await callRoute(routes, 'git.status', { root: repo })
    assert.equal(first.isRepo, true)
    assert.equal(typeof first.revision, 'number', 'the snapshot carries a revision')
    const afterFirst = gitProcessCount()
    assert.ok(afterFirst > before, 'the first snapshot runs git')

    // The second poll of a work tree that did not change: the host answers
    // "nothing changed" and does not run git again.
    const second = await callRoute(routes, 'git.status', { root: repo, since: first.revision })
    assert.equal(second.unchanged, true, 'the host must not ship the snapshot again')
    assert.equal(second.revision, first.revision)
    assert.equal(gitProcessCount(), afterFirst, 'the poll of an unchanged tree must not run git')
    // The answer is tiny: the snapshot of a big repository is megabytes.
    assert.equal(Object.keys(second).length, 2)

    // A client that asks without a revision wants the state of THIS moment:
    // it gets a new snapshot.
    const third = await callRoute(routes, 'git.status', { root: repo })
    assert.notEqual(third.unchanged, true, 'an explicit refresh gets a fresh snapshot')
    assert.notEqual(third.revision, first.revision, 'a new snapshot has a new revision')
    assert.ok(gitProcessCount() > afterFirst, 'the explicit refresh runs git')
  } finally {
    for (const dispose of disposers) dispose()
    if (previousProfile === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previousProfile
    await rm(profile, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('a client that asks without a revision always gets a fresh snapshot', async (t) => {
  const previousProfile = process.env.DSH_PROFILE_DIR
  const profile = await mkdtemp(join(tmpdir(), 'iwb-profile-'))
  const repo = await mkdtemp(join(tmpdir(), 'iwb-repo-'))
  process.env.DSH_PROFILE_DIR = profile
  const { ctx, routes, disposers } = fakeContext()
  try {
    try { execFileSync('git', ['--version'], { stdio: 'ignore' }) } catch {
      t.skip('git is not installed')
      return
    }
    const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] })
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'IDE Test')
    git('config', 'user.email', 'ide@test.local')
    git('config', 'commit.gpgsign', 'false')
    await writeFile(join(repo, 'a.txt'), 'a\n', 'utf8')
    git('add', '-A')
    git('commit', '-q', '-m', 'base')

    apply(ctx)
    const first = await callRoute(routes, 'git.status', { root: repo })
    // No revision: the client wants the state of THIS moment.
    const second = await callRoute(routes, 'git.status', { root: repo })
    assert.notEqual(second.unchanged, true, 'an explicit refresh gets a fresh snapshot')
    assert.notEqual(second.revision, first.revision)
  } finally {
    for (const dispose of disposers) dispose()
    if (previousProfile === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previousProfile
    await rm(profile, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})
