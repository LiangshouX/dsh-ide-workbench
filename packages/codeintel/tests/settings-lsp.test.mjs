/**
 * The settings document of the code intelligence plugin (PRD-v6 §7, MIG-01).
 *
 * The codeintel owns a document of its own - `<profile>/dsh-codeintel/settings.json` -
 * and it holds the `lsp` section (the language servers, their memory budget
 * and the index memory) plus the four semantic shortcuts. The document of the
 * IDE workbench keeps its own settings and knows nothing about the section of
 * the code intelligence.
 *
 * The one thing that crosses the border is the ONE-TIME import: a user who
 * upgrades from the single-plugin build has the `lsp` section and the four
 * shortcuts in the document of the workbench, and the codeintel takes them
 * over once. The document of the workbench is not touched - a downgrade has
 * to keep working.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS, SETTINGS_VERSION, SettingsStore, migrateLspSettings, settingsFile,
} from '../src/host/settings-store.js'
import { DEFAULT_LSP_SETTINGS } from '../src/host/settings-defaults.js'

/**
 * A throwaway profile directory.
 *
 * The environment variable is restored afterwards: the store reads the
 * profile directory every time it writes, and a test that leaves it behind
 * would send the other tests into the wrong directory.
 * @param {(base: string) => Promise<void>} run the body of the test
 * @returns {Promise<void>}
 */
async function withProfile(run) {
  const base = await mkdtemp(join(tmpdir(), 'dsh-codeintel-settings-'))
  const previous = process.env.DSH_PROFILE_DIR
  process.env.DSH_PROFILE_DIR = base
  try {
    await run(base)
  } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previous
    await rm(base, { recursive: true, force: true })
  }
}

/**
 * Write the settings document of the IDE workbench into the profile.
 *
 * The document is the one of the single-plugin build: it carries the `lsp`
 * section and the four semantic shortcuts.
 * @param {string} base the profile directory
 * @param {object} document the document to write
 */
async function writeCoreDocument(base, document) {
  await mkdir(join(base, 'ide-workbench'), { recursive: true })
  await writeFile(join(base, 'ide-workbench', 'settings.json'), JSON.stringify(document, null, 2), 'utf8')
}

test('the settings schema of the plugin starts at 1', () => {
  // The codeintel has its OWN version line: its document is a new file, so
  // the version starts at 1 and has nothing to do with the version of the
  // document of the workbench.
  assert.equal(SETTINGS_VERSION, 1)
  assert.equal(DEFAULT_SETTINGS.version, 1)
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
  // The idle policy of schema 5: the server is released after the idle
  // timeout, exactly as it was in schema 4.
  assert.equal(lsp.idlePolicy, 'after')
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

test('the document holds the four semantic shortcuts and nothing else', () => {
  assert.equal(DEFAULT_SETTINGS.shortcuts.findUsages, 'Alt+F7')
  assert.equal(DEFAULT_SETTINGS.shortcuts.findUsagesText, 'Alt+F8')
  assert.equal(DEFAULT_SETTINGS.shortcuts.goToDefinition, 'F12')
  assert.equal(DEFAULT_SETTINGS.shortcuts.complete, 'Ctrl+Space')
  assert.deepEqual(Object.keys(DEFAULT_SETTINGS.shortcuts).sort(), [
    'complete', 'findUsages', 'findUsagesText', 'goToDefinition',
  ])
})

test('the document of the plugin lives in its own directory of the profile', async () => {
  await withProfile(async (base) => {
    const store = new SettingsStore()
    await store.get()
    assert.equal(settingsFile(), join(base, 'dsh-codeintel', 'settings.json'))
    const files = await readdir(join(base, 'dsh-codeintel'))
    assert.ok(files.includes('settings.json'), files.join(', '))
  })
})

test('a document without an lsp section gets the defaults', async () => {
  await withProfile(async () => {
    const store = new SettingsStore()
    const value = await store.get()
    assert.equal(value.version, 1)
    assert.equal(value.lsp.enabled, true)
    assert.equal(value.lsp.requestTimeoutMs, 30000)
    assert.equal(value.lsp.idlePolicy, 'after')
    assert.deepEqual(value.lsp.indexedRoots, {})
  })
})

test('the migration keeps an idle policy the user chose', () => {
  const value = { lsp: { idlePolicy: 'never' } }
  migrateLspSettings(value)
  assert.equal(value.lsp.idlePolicy, 'never')
  const memory = { lsp: { idlePolicy: 'onMemoryPressure' } }
  migrateLspSettings(memory)
  assert.equal(memory.lsp.idlePolicy, 'onMemoryPressure')
})

test('the migration repairs an idle policy this build does not know', () => {
  const value = { lsp: { idlePolicy: 'sometimes' } }
  migrateLspSettings(value)
  assert.equal(value.lsp.idlePolicy, 'after')
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
    shortcuts: { findUsages: 'F9' },
    lsp: { enabled: false },
  }
  migrateLspSettings(value)
  assert.equal(value.shortcuts.findUsages, 'F9')
  assert.equal(value.lsp.enabled, false)
})

test('the indexed roots survive a restart because they live in the document', async () => {
  await withProfile(async () => {
    const store = new SettingsStore()
    await store.update({ lsp: { indexedRoots: { 'D:\\Code\\app': { at: 1700000000000, languageId: 'typescript' } } } })
    // A second store reads the document of the disk.
    const second = new SettingsStore()
    const value = await second.get()
    assert.equal(value.lsp.indexedRoots['D:\\Code\\app'].languageId, 'typescript')
    assert.equal(value.lsp.indexedRoots['D:\\Code\\app'].at, 1700000000000)
  })
})

// ── the one-time import (MIG-01) ─────────────────────────────────────────

test('the import takes the lsp section of the workbench over', async () => {
  await withProfile(async (base) => {
    await writeCoreDocument(base, {
      version: 5,
      lsp: { enabled: false, idleTimeoutMs: 120000, memoryLimitMB: 4096 },
      shortcuts: { findUsages: 'Alt+F9', findUsagesText: 'Alt+F10', goToDefinition: 'F11', complete: 'Ctrl+Space' },
    })
    const store = new SettingsStore()
    const value = await store.get()
    assert.equal(value.lsp.enabled, false, 'the switch of the user came over')
    assert.equal(value.lsp.idleTimeoutMs, 120000, 'the idle timeout came over')
    assert.equal(value.lsp.memoryLimitMB, 4096, 'the memory ceiling came over')
    assert.equal(value.shortcuts.findUsages, 'Alt+F9', 'the shortcut came over')
    assert.equal(value.shortcuts.goToDefinition, 'F11', 'the shortcut came over')
  })
})

test('the import does not touch the document of the workbench', async () => {
  await withProfile(async (base) => {
    const core = {
      version: 5,
      lsp: { enabled: false, idleTimeoutMs: 120000 },
      shortcuts: { findUsages: 'Alt+F9' },
    }
    await writeCoreDocument(base, core)
    const store = new SettingsStore()
    await store.get()
    // The section of the workbench is still there: a user who downgrades
    // again finds everything where it was.
    const onDisk = JSON.parse(await readFile(join(base, 'ide-workbench', 'settings.json'), 'utf8'))
    assert.deepEqual(onDisk, core, 'the document of the workbench is untouched')
  })
})

test('the import happens exactly once', async () => {
  await withProfile(async (base) => {
    await writeCoreDocument(base, { version: 5, lsp: { enabled: false } })
    const store = new SettingsStore()
    const value = await store.get()
    assert.equal(value.lsp.enabled, false, 'the section came over')
    assert.equal(value.legacyImported, true, 'the import is marked as done')
    // The flag is on the disk, so the next start does not import again.
    const onDisk = JSON.parse(await readFile(settingsFile(), 'utf8'))
    assert.equal(onDisk.legacyImported, true)

    // The workbench changes its document - the plugin does not notice.
    await writeCoreDocument(base, { version: 5, lsp: { enabled: true } })
    const second = new SettingsStore()
    const again = await second.get()
    assert.equal(again.lsp.enabled, false, 'the import does not happen a second time')
  })
})

test('the values of the plugin win over the imported ones', async () => {
  await withProfile(async (base) => {
    await writeCoreDocument(base, { version: 5, lsp: { enabled: false, idleTimeoutMs: 120000 } })
    const store = new SettingsStore()
    await store.get()
    await store.update({ lsp: { enabled: true } })
    // A second store: the document of the plugin wins over the imported one.
    const second = new SettingsStore()
    const value = await second.get()
    assert.equal(value.lsp.enabled, true, 'the decision of the user survived')
    assert.equal(value.lsp.idleTimeoutMs, 120000, 'the rest of the import came over')
  })
})

test('a document of the plugin without the flag is imported once and then marked', async () => {
  await withProfile(async (base) => {
    // A document of an earlier build: it carries the section, but it does not
    // know the flag yet.
    await mkdir(join(base, 'dsh-codeintel'), { recursive: true })
    await writeFile(settingsFile(), JSON.stringify({ version: 1, lsp: { enabled: false } }, null, 2), 'utf8')
    await writeCoreDocument(base, { version: 5, lsp: { enabled: true, idleTimeoutMs: 999 } })
    const store = new SettingsStore()
    const value = await store.get()
    // The values of the plugin win over the imported ones.
    assert.equal(value.lsp.enabled, false)
    assert.equal(value.lsp.idleTimeoutMs, 999, 'the rest of the import came over')
    assert.equal(value.legacyImported, true)
  })
})
