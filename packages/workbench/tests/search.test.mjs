import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listFiles, searchFiles } from '../src/host/search.js'
import { log } from '../src/host/git.js'

async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'iwb-search-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('non-repository search walks files and reports line/column', async (t) => {
  const root = await temp(t)
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'a.ts'), 'const needle = 1\nconst other = 2\n')
  await writeFile(join(root, 'b.txt'), 'no match\n')
  const env = { root, workspaceRoot: root, prefix: '', isRepo: false }
  const result = await searchFiles(env, { query: 'needle' })
  assert.equal(result.files.length, 1)
  assert.equal(result.files[0].path, 'src/a.ts')
  assert.equal(result.files[0].matches[0].line, 1)
  assert.equal(result.files[0].matches[0].column, 7)
})

test('git-backed search uses fixed strings and can return a literal bracket', async (t) => {
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
  await writeFile(join(root, 'a.ts'), 'const x = "["\nconst needle = 1\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  const env = { root, workspaceRoot: root, prefix: '', isRepo: true, gitPath: '' }
  const files = await listFiles(env)
  assert.deepEqual(files.files, ['a.ts'])
  const result = await searchFiles(env, { query: '[' })
  assert.equal(result.files.length, 1)
  assert.equal(result.files[0].matches.length, 1)
})

test('ignored files are excluded from the index and search', async (t) => {
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
  await writeFile(join(root, '.gitignore'), 'ignored.txt\n')
  await writeFile(join(root, 'ignored.txt'), 'needle\n')
  await writeFile(join(root, 'kept.txt'), 'needle\n')
  git('add', '.gitignore', 'kept.txt')
  git('commit', '-q', '-m', 'base')
  const env = { root, workspaceRoot: root, prefix: '', isRepo: true, gitPath: '' }
  const files = await listFiles(env)
  assert.ok(files.files.includes('kept.txt'))
  assert.ok(!files.files.includes('ignored.txt'))
  const result = await searchFiles(env, { query: 'needle' })
  assert.equal(result.files.length, 1)
  assert.equal(result.files[0].path, 'kept.txt')
})

test('generated and vendor directories are excluded from git search', async (t) => {
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
  await mkdir(join(root, 'dist'))
  await writeFile(join(root, 'dist', 'client.js'), 'needle\n')
  await writeFile(join(root, 'src.ts'), 'needle\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  const env = { root, workspaceRoot: root, prefix: '', isRepo: true, gitPath: '' }
  const result = await searchFiles(env, { query: 'needle' })
  assert.deepEqual(result.files.map(file => file.path), ['src.ts'])
})

test('history query is literal: a bracket does not blank the log', async (t) => {  try {
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
  await writeFile(join(root, 'a.txt'), 'a\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'literal [ bracket')
  const env = { root, workspaceRoot: root, prefix: '', isRepo: true, gitPath: '' }
  const matched = await log(env, { branch: 'main', query: '[' })
  assert.equal(matched.length, 1)
  const none = await log(env, { branch: 'main', query: 'no-such-query' })
  assert.equal(none.length, 0)
})
