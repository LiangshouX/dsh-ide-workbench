/**
 * Host file operations: create / rename / duplicate / move / delete and the
 * .gitignore append helper. Every test runs in a throwaway temp directory.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendIgnore, createEntry, deleteEntries, duplicateEntry, moveEntries, renameEntry, validateEntryName,
} from '../src/host/fileops.js'

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), 'iwb-fileops-'))
  return root
}

test('createEntry writes a file and a directory', async () => {
  const root = await sandbox()
  try {
    const file = await createEntry(root, { parent: root, name: 'a.txt', content: 'hello' })
    assert.equal(file.path, 'a.txt')
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'hello')
    const dir = await createEntry(root, { parent: root, name: 'sub', isDir: true })
    assert.equal(dir.isDir, true)
    assert.equal(existsSync(join(root, 'sub')), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('createEntry refuses duplicates, bad names and escaped parents', async () => {
  const root = await sandbox()
  try {
    await writeFile(join(root, 'a.txt'), 'x')
    await assert.rejects(() => createEntry(root, { parent: root, name: 'a.txt' }), /already exists/)
    await assert.rejects(() => createEntry(root, { parent: root, name: '../x.txt' }), /illegal character/)
    await assert.rejects(() => createEntry(root, { parent: root, name: '' }), /must not be empty/)
    await assert.rejects(() => createEntry(root, { parent: join(root, 'nope'), name: 'x' }), /not found/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('validateEntryName rejects dot paths and separators', () => {
  assert.equal(validateEntryName(' ok.txt '), 'ok.txt')
  assert.throws(() => validateEntryName('.'), /dot path/)
  assert.throws(() => validateEntryName('..'), /dot path/)
  assert.throws(() => validateEntryName('a/b'), /illegal character/)
  assert.throws(() => validateEntryName('a\\b'), /illegal character/)
})

test('renameEntry keeps the parent and refuses an existing target', async () => {
  const root = await sandbox()
  try {
    await writeFile(join(root, 'a.txt'), 'x')
    await writeFile(join(root, 'b.txt'), 'y')
    const result = await renameEntry(root, { path: join(root, 'a.txt'), name: 'c.txt' })
    assert.equal(result.target, 'c.txt')
    assert.equal(existsSync(join(root, 'c.txt')), true)
    assert.equal(existsSync(join(root, 'a.txt')), false)
    await assert.rejects(() => renameEntry(root, { path: join(root, 'c.txt'), name: 'b.txt' }), /already exists/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('duplicateEntry appends -copy (and -copy-2) before the extension', async () => {
  const root = await sandbox()
  try {
    await writeFile(join(root, 'a.ts'), 'export {}')
    const first = await duplicateEntry(root, { path: join(root, 'a.ts') })
    assert.equal(first.target, 'a-copy.ts')
    const second = await duplicateEntry(root, { path: join(root, 'a.ts') })
    assert.equal(second.target, 'a-copy-2.ts')
    assert.equal(await readFile(join(root, 'a-copy.ts'), 'utf8'), 'export {}')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('moveEntries moves into a folder, copies with copy:true, renames conflicts', async () => {
  const root = await sandbox()
  try {
    await mkdir(join(root, 'dest'))
    await writeFile(join(root, 'a.txt'), 'move-me')
    await writeFile(join(root, 'dest', 'a.txt'), 'existing')
    const moved = await moveEntries(root, { paths: [join(root, 'a.txt')], target: join(root, 'dest'), conflict: 'rename' })
    assert.equal(moved.results[0].ok, true)
    assert.equal(existsSync(join(root, 'a.txt')), false)
    assert.equal(await readFile(join(root, 'dest', 'a-copy.txt'), 'utf8'), 'move-me')

    const copied = await moveEntries(root, { paths: [join(root, 'dest', 'a-copy.txt')], target: root, copy: true })
    assert.equal(copied.results[0].ok, true)
    assert.equal(existsSync(join(root, 'dest', 'a-copy.txt')), true)
    assert.equal(existsSync(join(root, 'a-copy.txt')), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('moveEntries refuses moving a folder into itself', async () => {
  const root = await sandbox()
  try {
    await mkdir(join(root, 'a'))
    await mkdir(join(root, 'a', 'b'))
    const result = await moveEntries(root, { paths: [join(root, 'a')], target: join(root, 'a', 'b') })
    assert.equal(result.results[0].ok, false)
    assert.match(result.results[0].message, /itself/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('deleteEntries removes files and non-empty folders', async () => {
  const root = await sandbox()
  try {
    await mkdir(join(root, 'a', 'b'), { recursive: true })
    await writeFile(join(root, 'a', 'b', 'x.txt'), 'x')
    await writeFile(join(root, 'top.txt'), 't')
    const result = await deleteEntries(root, { paths: [join(root, 'a'), join(root, 'top.txt')] })
    assert.equal(result.results.every(item => item.ok === true), true)
    assert.equal(existsSync(join(root, 'a')), false)
    assert.equal(existsSync(join(root, 'top.txt')), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('deleteEntries refuses the project root', async () => {
  const root = await sandbox()
  try {
    const result = await deleteEntries(root, { paths: [root] })
    assert.equal(result.results[0].ok, false)
    assert.match(result.results[0].message, /project root/)
    assert.equal(existsSync(root), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('appendIgnore adds one anchored line and stays idempotent', async () => {
  const root = await sandbox()
  try {
    await writeFile(join(root, 'a.log'), 'x')
    const first = await appendIgnore(root, { path: join(root, 'a.log') })
    assert.equal(first.changed, true)
    const text = await readFile(join(root, '.gitignore'), 'utf8')
    assert.equal(text, '/a.log\n')
    const second = await appendIgnore(root, { path: join(root, 'a.log') })
    assert.equal(second.changed, false)
    assert.equal(await readFile(join(root, '.gitignore'), 'utf8'), text)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
