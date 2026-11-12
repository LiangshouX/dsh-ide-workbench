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

test('the walk says that it stopped at the cap of the hits', async (t) => {
  const root = await temp(t)
  for (let index = 0; index < 10; index += 1) {
    await writeFile(join(root, `f${index}.txt`), 'needle\n')
  }
  const env = { root, workspaceRoot: root, prefix: '', isRepo: false }
  const result = await searchFiles(env, { query: 'needle', maxResults: 4 })
  // The cap hides the hits that do not fit - and the answer says so.
  assert.equal(result.files.reduce((sum, file) => sum + file.matches.length, 0), 4)
  assert.equal(result.truncated, true)
})

test('the walk says that it stopped at the cap of the files', async (t) => {
  const root = await temp(t)
  for (let index = 0; index < 6; index += 1) {
    await writeFile(join(root, `f${index}.txt`), `content ${index}\n`)
  }
  const env = { root, workspaceRoot: root, prefix: '', isRepo: false }
  // The cap belongs to the file index of the walk, so the walk answers.
  const result = await searchFiles(env, { query: 'content', scanner: false, maxFiles: 3 })
  assert.equal(result.files.length, 3)
  assert.equal(result.truncated, true)
})

test('the answer of the walk is in the order of the index', async (t) => {
  const root = await temp(t)
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'b.ts'), 'needle\n')
  await writeFile(join(root, 'a.ts'), 'needle\n')
  await writeFile(join(root, 'src', 'a.ts'), 'needle\n')
  const env = { root, workspaceRoot: root, prefix: '', isRepo: false }
  const result = await searchFiles(env, { query: 'needle' })
  assert.deepEqual(result.files.map(file => file.path), ['a.ts', 'src/a.ts', 'src/b.ts'])
})

test('an aborted search stops reading the workspace', async (t) => {
  const root = await temp(t)
  for (let index = 0; index < 5; index += 1) {
    await writeFile(join(root, `f${index}.txt`), 'needle\n')
  }
  const env = { root, workspaceRoot: root, prefix: '', isRepo: false }
  const controller = new AbortController()
  controller.abort()
  const result = await searchFiles(env, { query: 'needle', signal: controller.signal })
  assert.equal(result.files.length, 0)
})
