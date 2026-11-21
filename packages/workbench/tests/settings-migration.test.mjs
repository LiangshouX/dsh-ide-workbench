import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS, DEAD_SETTINGS, SETTINGS_DENSITIES, SETTINGS_VERSION, SettingsStore, migrateSettings, settingsFile,
} from '../src/host/settings-store.js'

/** The shortcuts that belong to the code intelligence plugin. */
const FOREIGN_SHORTCUTS = ['findUsages', 'findUsagesText', 'goToDefinition', 'complete']

/**
 * A profile with a settings document of the old schema.
 *
 * The document of the old build carries the section of the code intelligence
 * plugin and its four shortcuts - the core has to drop both of them from the
 * document it works with, and to leave them in the file.
 * @param {any} t the test context
 * @param {object} document the document to write
 * @returns {Promise<string>} the profile directory
 */
async function profileWith(t, document) {
  const profile = await mkdtemp(join(tmpdir(), 'iwb-settings-'))
  t.after(() => rm(profile, { recursive: true, force: true }))
  process.env.DSH_PROFILE_DIR = profile
  await mkdir(join(profile, 'ide-workbench'), { recursive: true })
  await writeFile(join(profile, 'ide-workbench', 'settings.json'), JSON.stringify(document, null, 2), 'utf8')
  return profile
}

/**
 * The document of the old build.
 * @returns {object} the document
 */
function oldDocument() {
  return {
    version: 4,
    lastRoot: 'C:\\work\\demo',
    editor: { fontSize: 17 },
    shortcuts: {
      quickOpen: 'Ctrl+Shift+N',
      findUsages: 'Alt+F7',
      findUsagesText: 'Alt+F8',
      goToDefinition: 'F12',
      complete: 'Ctrl+Space',
    },
    lsp: {
      enabled: true,
      indexOnOpen: 'ask',
      indexedRoots: { 'C:\\work\\demo': { at: 1700000000000 } },
      servers: { typescript: { command: 'tsserver' } },
    },
  }
}

test('the defaults of the core hold no settings of the other plugin', () => {
  assert.equal(SETTINGS_VERSION, 6)
  assert.equal(DEFAULT_SETTINGS.version, 6)
  assert.equal(DEFAULT_SETTINGS.lsp, undefined, 'the core must not know the section of the other plugin')
  for (const key of FOREIGN_SHORTCUTS) {
    assert.equal(DEFAULT_SETTINGS.shortcuts[key], undefined, `the core must not know the shortcut ${key}`)
  }
  // The shortcuts of the core are still there.
  assert.equal(DEFAULT_SETTINGS.shortcuts.quickOpen, 'Ctrl+Shift+N')
})

test('the defaults hold no setting that nothing reads', () => {
  // A setting that no code reads is a promise the IDE cannot keep: the user
  // changes it and nothing happens. Such a key is not a default any more.
  for (const [section, key] of DEAD_SETTINGS) {
    const group = DEFAULT_SETTINGS[section]
    assert.equal(group === undefined ? undefined : group[key], undefined,
      `the default ${section}.${key} must be gone`)
  }
  // The settings that ARE read stay: the diff view reads the two of them.
  assert.equal(DEFAULT_SETTINGS.editor.sideBySide, true)
  assert.equal(DEFAULT_SETTINGS.git.wordLevel, true)
})

test('a document that carries a dead setting loses it', () => {
  // The migration takes the key out of a document written before the key
  // was removed - and leaves every other key of the user alone.
  const document = migrateSettings({
    editor: { fontSize: 17, wordWrap: true },
    git: { colors: false, diffStyle: 'unified' },
    shortcuts: { quickOpen: 'Ctrl+Shift+N', compare: 'Ctrl+D' },
  })
  assert.equal(document.editor.fontSize, 17, 'the settings of the user survive')
  assert.equal(document.editor.wordWrap, undefined, 'the dead setting is gone')
  assert.equal(document.git.colors, false, 'the settings of the user survive')
  assert.equal(document.git.diffStyle, undefined, 'the dead setting is gone')
  assert.equal(document.shortcuts.quickOpen, 'Ctrl+Shift+N')
  assert.equal(document.shortcuts.compare, undefined, 'the dead shortcut is gone')
})

test('a write does not bring a dead setting back', async (t) => {
  await profileWith(t, { version: 5, editor: { fontSize: 17 } })
  const store = new SettingsStore()
  await store.get()
  // A client that still knows the setting writes it: the store drops it, so
  // the document does not carry a key the IDE cannot honour.
  await store.update({ editor: { wordWrap: true } })
  const written = JSON.parse(await readFile(settingsFile(), 'utf8'))
  assert.equal(written.editor.wordWrap, undefined)
  assert.equal(written.editor.fontSize, 17, 'the settings of the user survive')
})

test('version 5 adds the density of the settings page', () => {
  // The density is the one key of version 5: a document of version 4 has no
  // `ui.density`, the deep merge fills it from the defaults, and every other
  // key of the user survives.
  assert.equal(DEFAULT_SETTINGS.ui.density, 'comfortable')
  assert.deepEqual([...SETTINGS_DENSITIES], ['comfortable', 'compact'])
})

test('a density that is not a density falls back to the default', () => {
  // The document of the profile is a file the user may edit: a broken value
  // must not reach the panel as a broken control.
  const document = migrateSettings({ ui: { density: 'enormous' } })
  assert.equal(document.ui.density, 'comfortable')
  const missing = migrateSettings({ editor: { fontSize: 12 } })
  assert.equal(missing.ui.density, 'comfortable')
  const kept = migrateSettings({ ui: { density: 'compact' } })
  assert.equal(kept.ui.density, 'compact', 'a density the user chose is never rewritten')
})

test('the store refuses a density that is not one of the two', async (t) => {
  await profileWith(t, { version: 4 })
  const store = new SettingsStore()
  await store.get()
  await assert.rejects(
    () => store.update({ ui: { density: 'enormous' } }),
    /ui\.density/,
    'a broken density is refused instead of being written',
  )
  await store.update({ ui: { density: 'compact' } })
  const written = JSON.parse(await readFile(settingsFile(), 'utf8'))
  assert.equal(written.ui.density, 'compact')
})

test('a document of version 4 keeps every key of the user and gains the density', async (t) => {
  await profileWith(t, oldDocument())
  const store = new SettingsStore()
  const document = await store.get()
  assert.equal(document.version, SETTINGS_VERSION)
  assert.equal(document.ui.density, 'comfortable', 'the new key is filled from the defaults')
  assert.equal(document.editor.fontSize, 17, 'the settings of the user survive')
})

test('version 4 adds the two defaults of the V6 enhancements', () => {
  // Both keys are additions: an old document has neither, the deep merge fills
  // them in, and the client reads them with the same fallback when the file
  // has not loaded yet (V6).
  assert.equal(DEFAULT_SETTINGS.git.wordLevel, true, 'word-level diff is on by default')
  assert.equal(DEFAULT_SETTINGS.layout.entrySide, 'right', 'the tool-window entries sit on the right by default')
})

test('the migration drops the section and the shortcuts of the other plugin', async (t) => {
  await profileWith(t, oldDocument())
  const store = new SettingsStore()
  const document = await store.get()

  // The section of the other plugin is gone from the document of the core.
  assert.equal(document.lsp, undefined)
  for (const key of FOREIGN_SHORTCUTS) {
    assert.equal(document.shortcuts[key], undefined, `the shortcut ${key} must be gone`)
  }
  // Everything else survives: the migration may not lose a key of the user.
  assert.equal(document.version, SETTINGS_VERSION)
  assert.equal(document.lastRoot, 'C:\\work\\demo')
  assert.equal(document.editor.fontSize, 17)
  assert.equal(document.shortcuts.quickOpen, 'Ctrl+Shift+N')
  // The defaults of the core are filled in.
  assert.equal(document.git.colors, true)
  assert.equal(document.editor.fontSize, 17)
})

test('the file keeps the settings of the other plugin', async (t) => {
  await profileWith(t, oldDocument())
  const store = new SettingsStore()
  await store.get()

  // A write of the core must not delete the settings of the other plugin: a
  // user who downgrades the IDE finds them where they left them.
  await store.update({ ui: { density: 'compact' } })
  const written = JSON.parse(await readFile(settingsFile(), 'utf8'))
  assert.equal(written.lsp.enabled, true)
  assert.equal(written.lsp.servers.typescript.command, 'tsserver')
  assert.equal(written.shortcuts.findUsages, 'Alt+F7')
  assert.equal(written.shortcuts.findUsagesText, 'Alt+F8')
  assert.equal(written.shortcuts.goToDefinition, 'F12')
  assert.equal(written.shortcuts.complete, 'Ctrl+Space')
  // The write of the core is in the file, too.
  assert.equal(written.ui.density, 'compact')
  assert.equal(written.version, SETTINGS_VERSION)
})

test('a document without the settings of the other plugin is left alone', async (t) => {
  await profileWith(t, { version: 3, lastRoot: 'C:\\work\\demo', editor: { fontSize: 17 } })
  const store = new SettingsStore()
  const document = await store.get()
  assert.equal(document.lsp, undefined)
  assert.equal(document.editor.fontSize, 17)
  await store.update({ ui: { density: 'compact' } })
  const written = JSON.parse(await readFile(settingsFile(), 'utf8'))
  assert.equal(written.lsp, undefined)
  assert.equal(written.editor.fontSize, 17)
})
