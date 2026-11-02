import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listProjectCandidates } from '../src/host/workspace.js'
import { status as gitStatus } from '../src/host/git.js'

async function tempRoot(t) {
  const dir = await mkdtemp(join(tmpdir(), 'iwb-projects-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('project candidates are the workspace root plus first-level folders', async (t) => {
  const root = await tempRoot(t)
  await mkdir(join(root, 'child-b'))
  await mkdir(join(root, 'child-a', '.git'), { recursive: true })
  await mkdir(join(root, 'node_modules'))
  await mkdir(join(root, '.hidden'))
  await writeFile(join(root, 'file.txt'), 'x')

  const result = await listProjectCandidates(root)
  assert.equal(result.workspace, await realpath(root))
  assert.equal(result.projects[0].path, result.workspace)
  assert.equal(result.projects[0].isRoot, true)
  assert.equal(result.projects[0].isRepo, false)
  assert.deepEqual(result.projects.slice(1).map(project => project.name), ['child-a', 'child-b'])
  assert.equal(result.projects[1].isRepo, true)
  assert.equal(result.projects[2].isRepo, false)
  assert.equal(result.projects.some(project => project.name === 'node_modules' || project.name === '.hidden'), false)
})

test('a nested repository is visible only after selecting its folder', async (t) => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
  } catch {
    t.skip('git is not installed')
    return
  }
  const root = await tempRoot(t)
  const child = join(root, 'repo')
  await mkdir(child)
  const git = (...args) => execFileSync('git', args, { cwd: child, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'IDE Test')
  git('config', 'user.email', 'ide@test.local')
  git('config', 'commit.gpgsign', 'false')
  await writeFile(join(child, 'a.txt'), 'one\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')

  const fromWorkspace = await gitStatus({ root })
  assert.equal(fromWorkspace.isRepo, false, 'the container folder is not itself a repository')

  const fromChild = await gitStatus({ root: child })
  assert.equal(fromChild.isRepo, true)
  assert.equal(await realpath(fromChild.root), await realpath(child))
  assert.equal(fromChild.entries.length, 0)
})
