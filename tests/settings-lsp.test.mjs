import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS, SETTINGS_VERSION, SettingsStore, migrateLspSettings, settingsFile,
} from '../src/host/settings-store.js'
import { DEFAULT_LSP_SETTINGS } from '../src/host/settings-defaults.js'

/** A throwaway profile directory with one settings document in it. */
async function withProfile(document, run) {
  const base = await mkdtemp(join(tmpdir(), 'iwb-settings-'))
  const previous = process.env.DSH_PROFILE_DIR
  process.env.DSH_PROFILE_DIR = base
  try {
    if (document !== undefined) {
      const file = settingsFile()
      await mkdir(join(base, 'ide-workbench'), { recursive: true })
      await writeFile(file, JSON.stringify(document, null, 2), 'utf8')
    }
    await run(base)
  } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previous
    await rm(base, { recursive: true, force: true })
  }
}

test('the settings schema is version 4', () => {
  assert.equal(SETTINGS_VERSION, 4)
  assert.equal(DEFAULT_SETTINGS.version, 4)
})

test('the lsp section carries the PRD-v5 defaults', () => {
  const lsp = DEFAULT_SETTINGS.lsp
  assert.equal(lsp.enabled, true)
  assert.equal(lsp.indexOnOpen, 'ask')
  assert.equal(lsp.memoryLimitMB, 2048)
  // The free memory is a conservative fallback now, not a hard gate.
  assert.equal(lsp.freeMemoryThresholdMB, 512)
  assert.equal(lsp.memoryHeadroom, 1.5)
  assert.equal(lsp.memoryHardFloorMB, 256)
  assert.equal(lsp.idleTimeoutMs, 600000)
  assert.equal(lsp.cancelAfterMs, 60000)
  assert.equal(lsp.autoExit, true)
  assert.equal(lsp.autoRestart, true)
  assert.deepEqual(lsp.servers, {})
  assert.deepEqual(lsp.indexedRoots, {})
  assert.deepEqual(lsp.memoryWarnedRoots, {})
})

test('the LSP request timeout never falls below the library default of 3000 ms', () => {
  // The client library times out after 3000 ms on its own; a large project
  // silently fails under that value, so the default has to be higher.
  assert.ok(DEFAULT_SETTINGS.lsp.requestTimeoutMs >= 30000)
  assert.equal(DEFAULT_SETTINGS.lsp.requestTimeoutMs, 30000)
})

test('the defaults of the shared module are the ones of the settings document', () => {
  // The client reads the defaults from the shared module (the "reset to
  // defaults" button of the settings page needs them), the host writes them
  // into the document. The two must not drift apart.
  assert.deepEqual(DEFAULT_LSP_SETTINGS, DEFAULT_SETTINGS.lsp)
})

test('the four navigation shortcuts have the documented defaults', () => {
  assert.equal(DEFAULT_SETTINGS.shortcuts.findUsages, 'Alt+F7')
  assert.equal(DEFAULT_SETTINGS.shortcuts.findUsagesText, 'Alt+F8')
  assert.equal(DEFAULT_SETTINGS.shortcuts.goToDefinition, 'F12')
  assert.equal(DEFAULT_SETTINGS.shortcuts.complete, 'Ctrl+Space')
})

test('the new shortcuts do not collide with the existing ones', () => {
  const values = Object.values(DEFAULT_SETTINGS.shortcuts)
  assert.equal(new Set(values).size, values.length)
  // F2 (rename file) and Shift+F6 (update references) keep their keys: the
  // language server's own rename keymap is deliberately not installed.
  assert.equal(DEFAULT_SETTINGS.shortcuts.rename, 'F2')
  assert.equal(DEFAULT_SETTINGS.shortcuts.renameRefs, 'Shift+F6')
  // The library's reference keymap (Shift+F12) and format keymap stay out.
  assert.ok(!values.includes('Shift+F12'))
  assert.ok(!values.includes('Shift-Alt-f'))
  assert.equal(values.filter(value => value === 'F12').length, 1)
  assert.equal(values.filter(value => value === 'Alt+F7').length, 1)
  assert.equal(values.filter(value => value === 'Alt+F8').length, 1)
})

test('a schema 2 document without an lsp section keeps every other setting', async () => {
  await withProfile({
    version: 2,
    lastRoot: 'D:\\Code\\keep-me',
    git: { path: 'C:\\git\\bin\\git.exe' },
    shortcuts: { findInFiles: 'Ctrl+Shift+R' },
  }, async () => {
    const store = new SettingsStore()
    const value = await store.get()
    assert.equal(value.version, 4)
    // The old settings survived.
    assert.equal(value.lastRoot, 'D:\\Code\\keep-me')
    assert.equal(value.git.path, 'C:\\git\\bin\\git.exe')
    assert.equal(value.shortcuts.findInFiles, 'Ctrl+Shift+R')
    // The lsp section was filled in from the defaults.
    assert.equal(value.lsp.enabled, true)
    assert.equal(value.lsp.requestTimeoutMs, 30000)
    assert.deepEqual(value.lsp.indexedRoots, {})
    // The new shortcuts were added without losing the old ones.
    assert.equal(value.shortcuts.findUsages, 'Alt+F7')
    assert.equal(value.shortcuts.rename, 'F2')
  })
})

test('a schema 2 document is backed up before the migration', async () => {
  await withProfile({ version: 2, lastRoot: 'D:\\Code\\keep-me' }, async (base) => {
    const store = new SettingsStore()
    await store.get()
    const files = await readdir(join(base, 'ide-workbench'))
    assert.ok(files.includes('settings.json.v2.bak.json'), files.join(', '))
    const backup = JSON.parse(await readFile(join(base, 'ide-workbench', 'settings.json.v2.bak.json'), 'utf8'))
    assert.equal(backup.version, 2)
  })
})

test('the migration raises a request timeout that is too small', () => {
  const value = { lsp: { requestTimeoutMs: 3000 } }
  migrateLspSettings(value)
  assert.equal(value.lsp.requestTimeoutMs, 30000)
  const worse = { lsp: { requestTimeoutMs: 'soon' } }
  migrateLspSettings(worse)
  assert.equal(worse.lsp.requestTimeoutMs, 30000)
})

test('the migration keeps a user-chosen timeout that is large enough', () => {
  const value = { lsp: { requestTimeoutMs: 120000 } }
  migrateLspSettings(value)
  assert.equal(value.lsp.requestTimeoutMs, 120000)
})

test('the migration repairs a broken indexedRoots map', () => {
  const value = { lsp: { indexedRoots: 'nonsense' } }
  migrateLspSettings(value)
  assert.deepEqual(value.lsp.indexedRoots, {})
})

test('the migration never touches the settings outside the lsp section', () => {
  const value = {
    lastRoot: 'D:\\Code',
    git: { path: 'C:\\git' },
    shortcuts: { rename: 'F3' },
    lsp: { enabled: false },
  }
  migrateLspSettings(value)
  assert.equal(value.lastRoot, 'D:\\Code')
  assert.equal(value.git.path, 'C:\\git')
  assert.equal(value.shortcuts.rename, 'F3')
  assert.equal(value.lsp.enabled, false)
})

test('the indexed roots survive a restart because they live in the document', async () => {
  await withProfile({ version: 3, lsp: { indexedRoots: { 'D:\\Code\\app': { at: 1700000000000, languageId: 'typescript' } } } }, async () => {
    const store = new SettingsStore()
    const value = await store.get()
    assert.equal(value.lsp.indexedRoots['D:\\Code\\app'].languageId, 'typescript')
    assert.equal(value.lsp.indexedRoots['D:\\Code\\app'].at, 1700000000000)
  })
})
