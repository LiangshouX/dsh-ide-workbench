/**
 * A failed settings write must reach the caller.
 *
 * The settings document is the only durable place of the decisions of the
 * user: "this project gets an index", "this project stays in the basic
 * mode". A write that fails and is reported as a success loses the decision
 * without a word - the memory of the host holds the new value, the disk
 * holds the old one, and the next start of DSH is back where it was.
 *
 * Three properties make the difference, and the tests below pin them:
 *
 *   1. the caller learns that the write failed,
 *   2. the memory of the host is never newer than the disk,
 *   3. a failed write does not poison the queue of the writes.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore, settingsFile } from '../src/host/settings-store.js'

/**
 * A throwaway profile directory with one settings document in it.
 *
 * The environment variable is restored afterwards: the store reads the
 * profile directory every time it writes, and a test that leaves it behind
 * would send the other tests into the wrong directory.
 * @param {object|undefined} document the document to put into the profile
 * @param {(base: string) => Promise<void>} run the body of the test
 * @returns {Promise<void>}
 */
async function withProfile(document, run) {
  const base = await mkdtemp(join(tmpdir(), 'iwb-settings-write-'))
  const previous = process.env.DSH_PROFILE_DIR
  process.env.DSH_PROFILE_DIR = base
  try {
    if (document !== undefined) {
      await mkdir(join(base, 'ide-workbench'), { recursive: true })
      await writeFile(settingsFile(), JSON.stringify(document, null, 2), 'utf8')
    }
    await run(base)
  } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previous
    await rm(base, { recursive: true, force: true })
  }
}

/**
 * The path of the file the store writes before it renames it.
 *
 * The name carries the pid of the process, so the blocker only hits this
 * process - the other tests of the suite write into their own profile.
 * @param {string} base the profile directory
 * @returns {string} the path of the temporary file
 */
function tempFileOf(base) {
  return join(base, 'ide-workbench', `settings.json.${process.pid}.tmp`)
}

test('a write that fails rejects to the caller', async () => {
  await withProfile(undefined, async (base) => {
    const store = new SettingsStore()
    await store.get()
    // The directory of the settings file is a *file*: the store cannot
    // create the directory, so the write fails.
    await writeFile(join(base, 'ide-workbench'), 'not a directory', 'utf8')
    // The caller has to learn that the decision did not reach the disk.
    await assert.rejects(store.update({ lsp: { workspaceDefaults: { 'D:\\Code': 'build' } } }))
  })
})

test('a write that fails leaves the memory at the value of the disk', async () => {
  await withProfile(undefined, async (base) => {
    const store = new SettingsStore()
    await store.get()
    await writeFile(join(base, 'ide-workbench'), 'not a directory', 'utf8')
    await assert.rejects(store.update({ lastRoot: 'D:\\Code\\app' }))
    // The memory still holds the value of the disk. A value that is newer
    // than the file would make the host act on a decision the disk does not
    // know - and the decision would be gone with the next start of DSH.
    assert.equal(store.value.lastRoot, '')
    assert.equal((await store.get()).lastRoot, '')
    assert.deepEqual(store.value.lsp.workspaceDefaults, {})
  })
})

test('a write that fails leaves the old document on the disk', async () => {
  await withProfile({ version: 5, lastRoot: 'D:\\Code\\keep-me' }, async (base) => {
    const store = new SettingsStore()
    await store.get()
    // The temporary file of the write is a directory: the write fails
    // *after* the old document was read, so the old document is still
    // there - and it stays readable.
    await mkdir(tempFileOf(base), { recursive: true })
    await assert.rejects(store.update({ lastRoot: 'D:\\Code\\new' }))
    const onDisk = JSON.parse(await readFile(settingsFile(), 'utf8'))
    assert.equal(onDisk.lastRoot, 'D:\\Code\\keep-me', 'the old document is untouched')
    // The memory agrees with the disk.
    assert.equal(store.value.lastRoot, 'D:\\Code\\keep-me')
  })
})

test('a failed write does not poison the queue', async () => {
  await withProfile(undefined, async (base) => {
    const store = new SettingsStore()
    await store.get()
    const blocker = join(base, 'ide-workbench')
    await writeFile(blocker, 'not a directory', 'utf8')
    await assert.rejects(store.update({ lsp: { workspaceDefaults: { 'D:\\lost': 'build' } } }))
    // The queue is still alive: the next write fails too - the way is still
    // blocked - but it fails instead of hanging for ever.
    await assert.rejects(store.update({ lastRoot: 'D:\\Code\\app' }))
    // Once the way is clear again, the write succeeds.
    await rm(blocker, { force: true })
    await store.update({ lastRoot: 'D:\\Code\\app' })
    const onDisk = JSON.parse(await readFile(settingsFile(), 'utf8'))
    assert.equal(onDisk.lastRoot, 'D:\\Code\\app')
    // The patch that failed is nowhere: it never reached the disk, and the
    // memory did not keep it either.
    assert.equal(onDisk.lsp.workspaceDefaults['D:\\lost'], undefined)
    assert.equal(store.value.lsp.workspaceDefaults['D:\\lost'], undefined)
  })
})

test('a failed write leaves a line in the log of the host', async () => {
  await withProfile(undefined, async (base) => {
    const store = new SettingsStore()
    await store.get()
    await writeFile(join(base, 'ide-workbench'), 'not a directory', 'utf8')
    const warnings = []
    const original = console.warn
    console.warn = (...args) => { warnings.push(args.join(' ')) }
    try {
      await assert.rejects(store.update({ lastRoot: 'D:\\Code\\app' }))
    } finally {
      console.warn = original
    }
    assert.ok(warnings.length > 0, 'the failure is written into the log')
    assert.match(warnings.join('\n'), /settings/i)
  })
})

test('the log of the host is used when the store has a context', async () => {
  await withProfile(undefined, async (base) => {
    const lines = []
    const ctx = { logger: { warn: (...args) => { lines.push(args.join(' ')) } } }
    const store = new SettingsStore(ctx)
    await store.get()
    await writeFile(join(base, 'ide-workbench'), 'not a directory', 'utf8')
    await assert.rejects(store.update({ lastRoot: 'D:\\Code\\app' }))
    assert.ok(lines.length > 0, 'the plugin log carries the failure')
    assert.match(lines.join('\n'), /settings/i)
  })
})

test('two writes at the same time are written one after the other', async () => {
  await withProfile(undefined, async () => {
    const store = new SettingsStore()
    await store.get()
    // The second patch must see the result of the first one: both of them
    // have to be on the disk afterwards.
    const first = store.update({ lastRoot: 'D:\\Code\\first' })
    const second = store.update({ git: { path: 'C:\\git\\bin\\git.exe' } })
    await Promise.all([first, second])
    const onDisk = JSON.parse(await readFile(settingsFile(), 'utf8'))
    assert.equal(onDisk.lastRoot, 'D:\\Code\\first')
    assert.equal(onDisk.git.path, 'C:\\git\\bin\\git.exe')
    assert.equal(store.value.lastRoot, 'D:\\Code\\first')
  })
})
