import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeText, writeFileText } from '../src/host/workspace.js'

async function tempRoot(t) {
  const dir = await mkdtemp(join(tmpdir(), 'iwb-write-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('writes UTF-8 in place', async (t) => {
  const root = await tempRoot(t)
  const file = join(root, 'a.txt')
  await writeFile(file, 'old\n', 'utf8')
  const result = await writeFileText(root, file, 'new\n', 'utf-8')
  assert.equal(await readFile(file, 'utf8'), 'new\n')
  assert.equal(result.path, 'a.txt')
  assert.ok(result.size > 0)
})

test('preserves BOM and UTF-16 encodings', async (t) => {
  const root = await tempRoot(t)
  const bom = join(root, 'bom.txt')
  await writeFile(bom, 'old', 'utf8')
  await writeFileText(root, bom, 'héllo', 'utf-8-bom')
  const bomBytes = await readFile(bom)
  assert.deepEqual([...bomBytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF])
  assert.equal(bomBytes.subarray(3).toString('utf8'), 'héllo')

  const utf16 = join(root, 'u16.txt')
  await writeFile(utf16, 'old', 'utf8')
  await writeFileText(root, utf16, '中文', 'utf-16le')
  const u16Bytes = await readFile(utf16)
  assert.deepEqual([...u16Bytes.subarray(0, 2)], [0xFF, 0xFE])
  assert.equal(u16Bytes.subarray(2).toString('utf16le'), '中文')
})

test('encodeText keeps plain UTF-8 for the default encoding', () => {
  assert.equal(encodeText('abc', 'utf-8').toString('utf8'), 'abc')
})

test('refuses a path outside the workspace and a missing file', async (t) => {
  const root = await tempRoot(t)
  const outside = join(root, '..', 'escape.txt')
  await assert.rejects(() => writeFileText(root, outside, 'x'))
  await assert.rejects(() => writeFileText(root, join(root, 'missing.txt'), 'x'))
  await assert.rejects(() => writeFileText(root, root, 'x'))
})

test('an expected mtime turns a concurrent external edit into stale-file', async (t) => {
  const root = await tempRoot(t)
  const file = join(root, 'a.txt')
  await writeFile(file, 'old\n', 'utf8')
  const before = await readFile(file)
  const { stat } = await import('node:fs/promises')
  const mtimeMs = (await stat(file)).mtimeMs
  await writeFile(file, 'external\n', 'utf8')
  await assert.rejects(
    () => writeFileText(root, file, 'mine\n', 'utf-8', { expectedMtimeMs: mtimeMs }),
    error => error.code === 'stale-file',
  )
  assert.equal((await readFile(file)).toString('utf8'), 'external\n')
  assert.notEqual(before.toString('utf8'), 'external\n')
})
