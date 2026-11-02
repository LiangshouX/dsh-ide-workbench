/**
 * Untracked files are reported one by one, so the file tree can colour the
 * files inside an untracked directory instead of the directory alone (GIT-01).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseStatusV2, status } from '../src/host/git.js'
import { aggregateStatus } from '../src/client/git-colors.js'

function statusText(lines) {
  return `${lines.join('\0')}\0`
}

async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'iwb-untracked-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('the untracked entries of a -uall status are the files themselves', () => {
  const parsed = parseStatusV2(statusText([
    '# branch.oid 1234567890abcdef',
    '# branch.head main',
    '? new dir/one.js',
    '? new dir/two.js',
  ]))
  assert.deepEqual(parsed.entries.map(entry => entry.path), ['new dir/one.js', 'new dir/two.js'])
  assert.equal(parsed.entries.every(entry => entry.untracked === true), true)
})

test('a porcelain directory entry colours the directory, not a file', () => {
  const rollup = aggregateStatus([{ path: 'pkg/new dir/', xy: '??', untracked: true }])
  // The tree looks directories up in `dirs` and files in `files`, so a
  // directory entry must never end up in the file table.
  assert.equal(rollup.files.has('pkg/new dir/'), false)
  assert.equal(rollup.dirs.get('pkg/new dir'), 'untracked')
  // The ancestors of the directory are coloured as well.
  assert.equal(rollup.dirs.get('pkg'), 'untracked')
})

test('the files of an untracked directory colour the directory by aggregation', () => {
  const rollup = aggregateStatus([
    { path: 'new dir/one.js', xy: '??', untracked: true },
    { path: 'new dir/two.js', xy: '??', untracked: true },
  ])
  assert.equal(rollup.files.get('new dir/one.js'), 'untracked')
  assert.equal(rollup.files.get('new dir/two.js'), 'untracked')
  assert.equal(rollup.dirs.get('new dir'), 'untracked')
})

test('the host lists every untracked file even when the config folds directories', async (t) => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
  } catch {
    t.skip('git is not installed')
    return
  }
  const root = await temp(t)
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'IDE Test')
  git('config', 'user.email', 'ide@test.local')
  // A user configuration that folds the untracked directories must not win.
  git('config', 'status.showUntrackedFiles', 'normal')
  await mkdir(join(root, 'new dir'))
  await writeFile(join(root, 'new dir', 'one.js'), 'one\n')
  await writeFile(join(root, 'new dir', 'two.js'), 'two\n')
  const snapshot = await status({ root, gitPath: '' }, { ignored: false, numstat: false })
  const untracked = snapshot.entries
    .filter(entry => entry.untracked === true)
    .map(entry => entry.path)
    .sort()
  assert.deepEqual(untracked, ['new dir/one.js', 'new dir/two.js'])
})

test('the status snapshot says that it cut the file list short', async (t) => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
  } catch {
    t.skip('git is not installed')
    return
  }
  const root = await temp(t)
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  for (let index = 0; index < 5; index += 1) {
    await writeFile(join(root, `file-${index}.txt`), 'x\n')
  }
  const snapshot = await status({ root, gitPath: '' }, { ignored: false, numstat: false, limit: 3 })
  // The client has to be able to say that the list above is not the whole
  // truth, so the snapshot carries the flag and the limit that was applied.
  assert.equal(snapshot.entries.length, 3)
  assert.equal(snapshot.truncated, true)
  assert.equal(snapshot.entryLimit, 3)
})
