/**
 * The search reads the workspace concurrently.
 *
 * The serial read of every file was 94 % of the time of a search (5.2 s of
 * 6.3 s on a 20 000 file tree), so the walk reads the files at the same time
 * - with a bounded number of them and a bounded amount of memory in flight.
 *
 * The tests pin the behaviour, not the wall clock: the reader is replaced by
 * one that waits, so the ratio between a serial and a pooled read is stable
 * even when the suite runs its files in parallel.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { searchFiles } from '../src/host/search.js'

async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'iwb-search-perf-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** Wait a moment, so a read takes a measurable amount of time. */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * A tree of `count` files that all hold the needle.
 * @param {string} root the tree
 * @param {number} count the number of files
 */
async function treeOf(root, count) {
  await mkdir(join(root, 'src'), { recursive: true })
  for (let index = 0; index < count; index += 1) {
    const name = `f${String(index).padStart(3, '0')}.ts`
    await writeFile(join(root, 'src', name), 'const value = 1\nconst needle = value\n')
  }
}

test('the walk reads the files at the same time', async (t) => {
  const root = await temp(t)
  await treeOf(root, 24)
  const env = { root, workspaceRoot: root, prefix: '', isRepo: false }
  let running = 0
  let peak = 0
  const read = async () => {
    running += 1
    peak = Math.max(peak, running)
    await sleep(5)
    running -= 1
    return Buffer.from('const needle = 1\n')
  }
  const result = await searchFiles(env, { query: 'needle', scanner: false, read })
  assert.equal(result.files.length, 24)
  assert.ok(peak > 1, `the files are read concurrently (the peak was ${peak})`)
  assert.ok(peak <= 32, `the reads stay bounded (the peak was ${peak})`)
})

test('the pooled walk is much faster than a serial read of the same files', async (t) => {
  const root = await temp(t)
  const count = 24
  await treeOf(root, count)
  const env = { root, workspaceRoot: root, prefix: '', isRepo: false }
  const read = async () => {
    await sleep(8)
    return Buffer.from('const needle = 1\n')
  }
  // The serial reference: the same reads, one after the other.
  const serialStarted = Date.now()
  for (let index = 0; index < count; index += 1) await read()
  const serial = Date.now() - serialStarted
  const pooledStarted = Date.now()
  await searchFiles(env, { query: 'needle', scanner: false, read })
  const pooled = Date.now() - pooledStarted
  assert.ok(pooled * 3 < serial, `the pooled walk (${pooled} ms) must be much faster than a serial read (${serial} ms)`)
})

test('the answer follows the index, not the order of the reads', async (t) => {
  const root = await temp(t)
  await treeOf(root, 12)
  const env = { root, workspaceRoot: root, prefix: '', isRepo: false }
  const read = async (absolute) => {
    // The first file is the slowest: the answers must not follow the reads.
    await sleep(absolute.endsWith('f000.ts') ? 40 : 1)
    return Buffer.from('const needle = 1\n')
  }
  const result = await searchFiles(env, { query: 'needle', scanner: false, read })
  const expected = Array.from({ length: 12 }, (_, index) => `src/f${String(index).padStart(3, '0')}.ts`)
  assert.deepEqual(result.files.map(file => file.path), expected)
})

test('the bytes in flight stay under the budget', async (t) => {
  const root = await temp(t)
  await treeOf(root, 16)
  const env = { root, workspaceRoot: root, prefix: '', isRepo: false }
  let running = 0
  let peak = 0
  let refused = 0
  const size = 100 * 1024
  const read = async (absolute, budget, signal) => {
    const reserved = await budget.reserve(size, signal)
    if (!reserved) {
      refused += 1
      return null
    }
    running += 1
    peak = Math.max(peak, running)
    await sleep(5)
    running -= 1
    budget.release(size)
    return Buffer.from('const needle = 1\n'.padEnd(size, 'a'))
  }
  // A budget of two files: the third read has to wait for the first two.
  const result = await searchFiles(env, {
    query: 'needle',
    scanner: false,
    read,
    readBudgetBytes: size * 2,
  })
  assert.equal(result.files.length, 16)
  assert.ok(peak <= 3, `the budget bounds the bytes in flight (the peak was ${peak})`)
  assert.equal(refused, 0, 'a read is never refused')
})
