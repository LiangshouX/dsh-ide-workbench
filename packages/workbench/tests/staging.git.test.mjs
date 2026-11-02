import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPatch, hunkChangeIndexes, parseUnifiedDiff } from '../src/client/diff.js'
import { discard } from '../src/host/git.js'

/**
 * Applies the plugin's rebuilt patches to a real git index. This is the
 * acceptance path for "line-level staging changes exactly the selected lines".
 */
test('line and hunk staging round-trip against real git', async (t) => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
  } catch {
    t.skip('git is not installed')
    return
  }
  const dir = await mkdtemp(join(tmpdir(), 'iwb-staging-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  const gitIn = (args, input) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', input })
  try {
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'IDE Test')
    git('config', 'user.email', 'ide@test.local')
    git('config', 'commit.gpgsign', 'false')
    await writeFile(join(dir, 'a.txt'), 'one\ntwo\nthree\nfour\nfive\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'base')
    await writeFile(join(dir, 'a.txt'), 'one\nTWO\nthree\nfour\nfive\nsix\n')

    const diff = git('diff', '--no-color', '--unified=3', '--', 'a.txt')
    const file = parseUnifiedDiff(diff).files[0]
    const addIndexes = file.hunks[0].lines.filter(line => line.type === '+').map(line => line.index)
    gitIn(['apply', '--cached', '--unidiff-zero', '--recount'], buildPatch(file, new Set(addIndexes)))
    const additionsOnly = git('diff', '--cached', '--no-color', '--', 'a.txt')
    assert.match(additionsOnly, /^\+TWO$/m)
    assert.match(additionsOnly, /^\+six$/m)
    assert.doesNotMatch(additionsOnly, /^-two$/m)
    assert.doesNotMatch(additionsOnly, /^@@ .*\n\n@@/m, 'no blank header line')

    gitIn(['apply', '--cached', '--unidiff-zero', '--recount', '-R'], buildPatch(file, new Set(addIndexes)))
    assert.equal(git('diff', '--cached', '--no-color', '--', 'a.txt'), '')

    const all = hunkChangeIndexes(file, 0)
    gitIn(['apply', '--cached', '--unidiff-zero', '--recount'], buildPatch(file, new Set(all)))
    const wholeHunk = git('diff', '--cached', '--no-color', '--', 'a.txt')
    assert.match(wholeHunk, /^-two$/m)
    assert.match(wholeHunk, /^\+TWO$/m)
    assert.match(wholeHunk, /^\+six$/m)

    const stagedFile = parseUnifiedDiff(wholeHunk).files[0]
    const reverseAll = stagedFile.hunks.flatMap((_, index) => hunkChangeIndexes(stagedFile, index))
    gitIn(['apply', '--cached', '--unidiff-zero', '--recount', '-R'], buildPatch(stagedFile, new Set(reverseAll)))
    assert.equal(git('diff', '--cached', '--no-color', '--', 'a.txt'), '')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('discard clears both the index and the worktree', async (t) => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
  } catch {
    t.skip('git is not installed')
    return
  }
  const dir = await mkdtemp(join(tmpdir(), 'iwb-discard-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  try {
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'IDE Test')
    git('config', 'user.email', 'ide@test.local')
    await writeFile(join(dir, 'a.txt'), 'base\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'base')
    await writeFile(join(dir, 'a.txt'), 'staged\n')
    git('add', 'a.txt')
    await writeFile(join(dir, 'a.txt'), 'worktree\n')
    await discard({ root: dir, gitPath: '' }, ['a.txt'])
    assert.equal(git('status', '--porcelain'), '')
    assert.equal(git('show', 'HEAD:a.txt'), 'base\n')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
