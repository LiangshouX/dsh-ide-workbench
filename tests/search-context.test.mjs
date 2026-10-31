/**
 * Every search hit carries the lines around it, and the whole answer stays
 * inside the size budget (FIND-02).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { searchFiles, trimContextToBudget } from '../src/host/search.js'

async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'iwb-search-ctx-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('a hit carries the lines around it', async (t) => {
  const root = await temp(t)
  await writeFile(join(root, 'a.ts'), 'one\ntwo\nthree\nneedle\nfive\nsix\nseven\n')
  const env = { root, workspaceRoot: root, prefix: '', isRepo: false }
  const result = await searchFiles(env, { query: 'needle' })
  const match = result.files[0].matches[0]
  assert.equal(match.line, 4)
  assert.deepEqual(match.before, ['one', 'two', 'three'])
  assert.deepEqual(match.after, ['five', 'six', 'seven'])
})

test('the context is at most five lines on each side', async (t) => {
  const root = await temp(t)
  const lines = Array.from({ length: 20 }, (_, index) => `line ${index}`)
  lines[10] = 'needle'
  await writeFile(join(root, 'a.ts'), `${lines.join('\n')}\n`)
  const env = { root, workspaceRoot: root, prefix: '', isRepo: false }
  const result = await searchFiles(env, { query: 'needle' })
  const match = result.files[0].matches[0]
  assert.equal(match.before.length, 5)
  assert.equal(match.after.length, 5)
  assert.equal(match.before[4], 'line 9')
  assert.equal(match.after[0], 'line 11')
})

test('the git fast path carries the context as well', async (t) => {
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
  await writeFile(join(root, 'a.ts'), 'one\ntwo\nneedle\nfour\nfive\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  const env = { root, workspaceRoot: root, prefix: '', isRepo: true, gitPath: '' }
  const result = await searchFiles(env, { query: 'needle' })
  const match = result.files[0].matches[0]
  assert.equal(match.line, 3)
  assert.deepEqual(match.before, ['one', 'two'])
  assert.deepEqual(match.after, ['four', 'five'])
})

test('a binary file is marked and has no context', async (t) => {
  const root = await temp(t)
  await writeFile(join(root, 'a.bin'), Buffer.from([0x00, 0x01, 0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0x00]))
  const env = { root, workspaceRoot: root, prefix: '', isRepo: false }
  const result = await searchFiles(env, { query: 'needle' })
  assert.equal(result.files.length, 1)
  const match = result.files[0].matches[0]
  assert.equal(match.binary, true)
  assert.deepEqual(match.before, [])
  assert.deepEqual(match.after, [])
  assert.equal(match.preview, '')
})

test('the context of the later hits is dropped when the payload is too big', () => {
  const line = 'x'.repeat(200)
  const files = [{
    path: 'a.ts',
    matches: Array.from({ length: 50 }, (_, index) => ({
      line: index + 1,
      column: 1,
      preview: line,
      before: Array.from({ length: 5 }, () => line),
      after: Array.from({ length: 5 }, () => line),
    })),
  }]
  trimContextToBudget(files, 20_000)
  const size = Buffer.byteLength(JSON.stringify(files), 'utf8')
  assert.ok(size <= 20_000, `the payload is ${size} bytes`)
  // The first hit keeps its context, the last one lost it.
  assert.equal(files[0].matches[0].before.length, 5)
  assert.equal(files[0].matches[49].before.length, 0)
})

test('a huge result set is trimmed to the two megabyte budget', () => {
  const line = 'x'.repeat(200)
  const files = [{
    path: 'a.ts',
    matches: Array.from({ length: 2000 }, (_, index) => ({
      line: index + 1,
      column: 1,
      preview: line,
      before: Array.from({ length: 5 }, () => line),
      after: Array.from({ length: 5 }, () => line),
    })),
  }]
  trimContextToBudget(files)
  const size = Buffer.byteLength(JSON.stringify(files), 'utf8')
  assert.ok(size <= 2 << 20, `the payload is ${size} bytes`)
})
