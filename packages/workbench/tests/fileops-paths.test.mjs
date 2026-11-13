/**
 * The host side of R5 — creating an entry at a relative path.
 *
 * The "new file" dialog can name a path below the project root, so the host
 * has to accept a relative multi-segment name: every segment is validated on
 * its own, the result stays inside the workspace, and the folders of the chain
 * are created when they do not exist yet.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEntry, splitEntryPath } from '../src/host/fileops.js'

async function sandbox() {
  return mkdtemp(join(tmpdir(), 'iwb-fileops-path-'))
}

test('splitEntryPath keeps the single-segment name as it was', () => {
  assert.deepEqual(splitEntryPath('a.txt'), ['a.txt'])
  assert.deepEqual(splitEntryPath(' ok.txt '), ['ok.txt'])
  assert.throws(() => splitEntryPath(''), /must not be empty/)
  assert.throws(() => splitEntryPath('.'), /dot path/)
  assert.throws(() => splitEntryPath('..'), /dot path/)
  assert.throws(() => splitEntryPath('a<b'), /illegal character/)
})

test('splitEntryPath splits a relative path and refuses a dot segment', () => {
  assert.deepEqual(splitEntryPath('a/b/c.txt'), ['a', 'b', 'c.txt'])
  assert.deepEqual(splitEntryPath('a\\b'), ['a', 'b'])
  assert.throws(() => splitEntryPath('../x.txt'), /illegal character/)
  assert.throws(() => splitEntryPath('a/../x.txt'), /illegal character/)
  assert.throws(() => splitEntryPath('a//x.txt'), /illegal character/)
  assert.throws(() => splitEntryPath('/abs/x.txt'), /illegal character/)
  assert.throws(() => splitEntryPath('C:\\x.txt'), /illegal character/)
})

test('createEntry writes a file at a relative path and creates the folders', async () => {
  const root = await sandbox()
  try {
    const result = await createEntry(root, { parent: root, name: 'a/b/c/Foo.java', content: 'class Foo {}' })
    assert.equal(result.path, 'a/b/c/Foo.java')
    assert.equal(result.isDir, false)
    assert.equal(existsSync(join(root, 'a', 'b', 'c')), true)
    assert.equal(await readFile(join(root, 'a', 'b', 'c', 'Foo.java'), 'utf8'), 'class Foo {}')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('createEntry creates a folder at a relative path', async () => {
  const root = await sandbox()
  try {
    const result = await createEntry(root, { parent: root, name: 'a/b/c', isDir: true })
    assert.equal(result.path, 'a/b/c')
    assert.equal(result.isDir, true)
    assert.equal(existsSync(join(root, 'a', 'b', 'c')), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('createEntry refuses a duplicate and writes nothing for an illegal path', async () => {
  const root = await sandbox()
  try {
    await mkdir(join(root, 'a'), { recursive: true })
    await writeFile(join(root, 'a', 'x.txt'), 'x')
    await assert.rejects(() => createEntry(root, { parent: root, name: 'a/x.txt' }), /already exists/)
    // A refused path must not leave a half-built chain behind.
    await assert.rejects(() => createEntry(root, { parent: root, name: '../x.txt' }), /illegal character/)
    await assert.rejects(() => createEntry(root, { parent: root, name: 'b/../x.txt' }), /illegal character/)
    assert.equal(existsSync(join(root, 'b')), false)
    assert.equal(existsSync(join(root, 'x.txt')), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('createEntry keeps the parent of the path inside the workspace', async () => {
  const root = await sandbox()
  try {
    await mkdir(join(root, 'a'), { recursive: true })
    const result = await createEntry(root, { parent: join(root, 'a'), name: 'b/c.txt', content: 'c' })
    assert.equal(result.path, 'a/b/c.txt')
    assert.equal(await readFile(join(root, 'a', 'b', 'c.txt'), 'utf8'), 'c')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
