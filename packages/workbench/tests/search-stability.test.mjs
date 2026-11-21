/**
 * The stability of the project-wide search in a big repository.
 *
 * The search runs on every keystroke, and the repository it runs in is often
 * huge. These tests pin the rules that keep it usable there:
 *
 *   - a scan that is not wanted any more (the client aborts the previous one
 *     on every keystroke) must STOP - the child process included;
 *   - a path that runs into its timeout is not an error: the next path takes
 *     over, and an answer that is partial says so;
 *   - the three paths answer the SAME question: the same files, the same
 *     filters. A query that answers differently depending on which path
 *     served it is what makes a search feel broken.
 *
 * The git runner of the caller (`options.git`) is the seam the tests use, the
 * same way `options.scanner` and `options.read` are the seams of the other
 * paths.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiError } from '../src/host/wire.js'
import { runGit } from '../src/host/git.js'
import { listFiles, matchesPattern, searchFiles } from '../src/host/search.js'

async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'iwb-stability-'))
  t.after(async () => {
    // A killed child may still hold the directory as its working directory:
    // the removal is retried a moment later.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(dir, { recursive: true, force: true })
        return
      } catch {
        await sleep(100)
      }
    }
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}

/** Is git installed on this machine? */
function hasGit() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * A git repository with one commit.
 *
 * @param {object} t the test context
 * @param {Record<string, string>} files the files of the repository
 * @returns {Promise<string>} the root of the repository
 */
async function repo(t, files) {
  const root = await temp(t)
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'IDE Test')
  git('config', 'user.email', 'ide@test.local')
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path)
    await mkdir(join(absolute, '..'), { recursive: true })
    await writeFile(absolute, content)
  }
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  return root
}

/** Wait a moment, so a read takes a measurable amount of time. */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── the abort ───────────────────────────────────────────────────────────────

test('a git call of an aborted request does not run the command', async () => {
  const controller = new AbortController()
  controller.abort()
  const result = await runGit({ root: process.cwd() }, ['--version'], { signal: controller.signal })
  // The command is not wanted any more: it must not run, and it must not be
  // reported as a failure either.
  assert.equal(result.aborted, true)
})

test('an aborted git call kills the child instead of waiting for the timeout', async (t) => {
  if (!hasGit()) {
    t.skip('git is not installed')
    return
  }
  // A git that sleeps: the alias runs a shell command.
  const slow = ['-c', 'alias.slow=!sleep', 'slow', '5']
  try {
    execFileSync('git', slow, { stdio: 'ignore', timeout: 800 })
  } catch {
    // The command was still running after 800 ms: the alias works.
  }
  const probe = Date.now()
  try {
    execFileSync('git', slow, { stdio: 'ignore', timeout: 800 })
    t.skip('this machine has no slow git command')
    return
  } catch {
    if (Date.now() - probe > 4000) {
      t.skip('this machine has no slow git command')
      return
    }
  }
  const controller = new AbortController()
  const started = Date.now()
  const promise = runGit({ root: process.cwd() }, slow, { signal: controller.signal })
  setTimeout(() => controller.abort(), 150)
  const result = await promise
  const took = Date.now() - started
  assert.equal(result.aborted, true)
  // The call must not wait for the timeout of 30 s - and not for the command
  // either.
  assert.ok(took < 3000, `the call settled in ${took} ms`)
})

test('the git path of the search stops when the request is aborted', async (t) => {
  const root = await temp(t)
  await writeFile(join(root, 'a.ts'), 'needle\n')
  const env = { root, workspaceRoot: root, prefix: '', isRepo: true }
  const controller = new AbortController()
  let seen = null
  let reads = 0
  const git = async (_env, _args, options) => {
    seen = options.signal ?? null
    // The scan only ends when the request is aborted.
    await new Promise(resolve => {
      const stop = () => resolve()
      options.signal?.addEventListener('abort', stop, { once: true })
      setTimeout(stop, 5000)
    })
    return { code: -1, stdout: '', stderr: '', aborted: options.signal?.aborted === true }
  }
  const promise = searchFiles(env, {
    query: 'needle',
    signal: controller.signal,
    git,
    scanner: false,
    read: async () => { reads += 1; return null },
  })
  setTimeout(() => controller.abort(), 50)
  const result = await promise
  // The git path must receive the signal of the request: without it every
  // keystroke leaves another `git grep` running over the whole work tree.
  assert.ok(seen !== null, 'the git path receives the signal of the request')
  // The walk must not start: the request is gone, there is no reader.
  assert.equal(reads, 0, 'the walk does not start after an abort')
  assert.equal(result.files.length, 0)
})

// ── the timeout ─────────────────────────────────────────────────────────────

test('a git that times out is not the end of the search: the next path answers', async (t) => {
  const root = await temp(t)
  await writeFile(join(root, 'a.ts'), 'needle\n')
  const env = { root, workspaceRoot: root, prefix: '', isRepo: true }
  let calls = 0
  const git = async () => {
    calls += 1
    throw new ApiError('git-timeout', 'git grep timed out after 10000ms', 504)
  }
  const result = await searchFiles(env, { query: 'needle', git, scanner: false })
  assert.ok(calls >= 1, 'the search asks the git of the caller')
  // The timeout is not an error: the search answers with what the next path
  // found. A timeout used to turn the whole search into a 504.
  assert.equal(result.files.length, 1)
  assert.equal(result.files[0].path, 'a.ts')
})

test('the file index answers even when git times out', async (t) => {
  const root = await temp(t)
  await writeFile(join(root, 'a.ts'), 'x\n')
  const env = { root, workspaceRoot: root, prefix: '', isRepo: true }
  let calls = 0
  const git = async () => {
    calls += 1
    throw new ApiError('git-timeout', 'git ls-files timed out after 30000ms', 504)
  }
  const index = await listFiles(env, { git })
  assert.equal(calls, 1, 'the file index asks the git of the caller')
  // The file index is the base of the tree search: it must not fail with the
  // timeout of a git call.
  assert.deepEqual(index.files, ['a.ts'])
})

test('a scanner that runs into its timeout answers with what it found', async (t) => {
  const root = await temp(t)
  await writeFile(join(root, 'a.ts'), 'needle\n')
  const env = { root, workspaceRoot: root, prefix: '', isRepo: false }
  let reads = 0
  const result = await searchFiles(env, {
    query: 'needle',
    // A scanner that cannot answer in a millisecond: the timeout is what the
    // test is about, not the scanner.
    scanner: process.execPath,
    scannerTimeoutMs: 1,
    read: async () => { reads += 1; return Buffer.from('needle\n') },
  })
  // The walk is SLOWER than the scanner that just timed out: falling back to
  // it would make the search slower, not faster.
  assert.equal(reads, 0, 'the walk does not start after a scanner timeout')
  // The answer is partial, and it says so.
  assert.equal(result.truncated, true)
})

// ── the caps ────────────────────────────────────────────────────────────────

test('the file index of a huge repository is capped, and the answer says so', async (t) => {
  if (!hasGit()) {
    t.skip('git is not installed')
    return
  }
  const root = await repo(t, {
    'a.ts': 'x\n',
    'b.ts': 'x\n',
    'c.ts': 'x\n',
    'd.ts': 'x\n',
    'e.ts': 'x\n',
  })
  const env = { root, workspaceRoot: root, prefix: '', isRepo: true, gitPath: '' }
  const index = await listFiles(env, { maxFiles: 3 })
  assert.equal(index.files.length, 3)
  // A cap that does not say so looks like a search that found nothing.
  assert.equal(index.truncated, true)
})

test('the git scan stops reading when the cap of the hits is reached', async (t) => {
  const root = await temp(t)
  const env = { root, workspaceRoot: root, prefix: '', isRepo: true }
  let produced = 0
  const git = async (_env, _args, options) => {
    for (let index = 0; index < 100; index += 1) {
      produced += 1
      if (options.onLine(`f${index}.ts\0 1\0 1\0needle`) === false) break
    }
    return { code: 0, stdout: '', stderr: '' }
  }
  const result = await searchFiles(env, { query: 'needle', git, maxResults: 5 })
  const hits = result.files.reduce((sum, file) => sum + file.matches.length, 0)
  assert.equal(hits, 5)
  assert.equal(result.truncated, true)
  // The scan must not read the rest of the output: a query that hits
  // everywhere produced a multi-megabyte stdout before.
  assert.ok(produced <= 7, `the scan stopped at the cap (it read ${produced} lines)`)
})

// ── the three paths answer the same question ───────────────────────────────

test('the git path applies the exclude filter, like the other paths', async (t) => {
  if (!hasGit()) {
    t.skip('git is not installed')
    return
  }
  const root = await repo(t, {
    'src/keep.ts': 'needle\n',
    'src/dist/drop.ts': 'needle\n',
    'other/c.ts': 'needle\n',
  })
  const gitEnv = { root, workspaceRoot: root, prefix: '', isRepo: true, gitPath: '' }
  // The walk is the reference: the environment without a repository is the
  // only way to ask for it (`scanner: false` only forbids the SCANNER).
  const walkEnv = { root, workspaceRoot: root, prefix: '', isRepo: false }
  const gitAnswer = await searchFiles(gitEnv, { query: 'needle', exclude: ['src/dist'] })
  const walkAnswer = await searchFiles(walkEnv, { query: 'needle', scanner: false, exclude: ['src/dist'] })
  assert.deepEqual(gitAnswer.files.map(file => file.path), ['other/c.ts', 'src/keep.ts'])
  assert.deepEqual(gitAnswer.files, walkAnswer.files)
})

test('the three paths answer the same files', async (t) => {
  if (!hasGit()) {
    t.skip('git is not installed')
    return
  }
  const root = await repo(t, {
    'src/a.ts': 'needle\n',
    'src/dist/b.ts': 'needle\n',
    'src/node_modules/c.ts': 'needle\n',
    'other/d.ts': 'needle\n',
  })
  const gitEnv = { root, workspaceRoot: root, prefix: '', isRepo: true, gitPath: '' }
  const walkEnv = { root, workspaceRoot: root, prefix: '', isRepo: false }
  const gitAnswer = await searchFiles(gitEnv, { query: 'needle' })
  const walkAnswer = await searchFiles(walkEnv, { query: 'needle', scanner: false })
  // The noise directories are skipped at ANY depth - by the walk, by the
  // scanner and by the git path. Before the fix the git path only skipped
  // them at the root of the repository, so the same query answered
  // differently depending on which path served it.
  assert.deepEqual(
    gitAnswer.files.map(file => file.path),
    ['other/d.ts', 'src/a.ts'],
  )
  assert.deepEqual(gitAnswer.files, walkAnswer.files)
})

test('the filters understand a glob', async (t) => {
  if (!hasGit()) {
    t.skip('git is not installed')
    return
  }
  const root = await repo(t, {
    'src/a.ts': 'needle\n',
    'src/b.md': 'needle\n',
    'other/c.ts': 'needle\n',
  })
  const gitEnv = { root, workspaceRoot: root, prefix: '', isRepo: true, gitPath: '' }
  const walkEnv = { root, workspaceRoot: root, prefix: '', isRepo: false }
  const gitAnswer = await searchFiles(gitEnv, { query: 'needle', include: ['*.ts'] })
  const walkAnswer = await searchFiles(walkEnv, { query: 'needle', scanner: false, include: ['*.ts'] })
  // A glob that looks supported but matches nothing is worse than a wrong
  // answer: the same query must answer the same in every path.
  assert.deepEqual(gitAnswer.files.map(file => file.path), ['other/c.ts', 'src/a.ts'])
  assert.deepEqual(gitAnswer.files, walkAnswer.files)
})

test('the matcher knows a prefix and a glob', () => {
  // A plain prefix matches the path itself and the paths under it - and
  // nothing else.
  assert.equal(matchesPattern('src/a.ts', 'src'), true)
  assert.equal(matchesPattern('src/deep/a.ts', 'src'), true)
  assert.equal(matchesPattern('src', 'src'), true)
  assert.equal(matchesPattern('src-old/a.ts', 'src'), false)
  assert.equal(matchesPattern('other/a.ts', 'src'), false)
  // A glob.
  assert.equal(matchesPattern('src/a.ts', '*.ts'), true)
  assert.equal(matchesPattern('src/deep/a.ts', '*.ts'), true)
  assert.equal(matchesPattern('src/a.md', '*.ts'), false)
  assert.equal(matchesPattern('src/deep/a.ts', 'src/**/*.ts'), true)
  assert.equal(matchesPattern('src/deep/a.ts', '**/dist/**'), false)
  assert.equal(matchesPattern('src/dist/a.ts', '**/dist/**'), true)
  assert.equal(matchesPattern('src/a.ts', ''), false)
})
