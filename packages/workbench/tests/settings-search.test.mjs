/**
 * The model of the settings page: the categories, the settings they hold and
 * the filter that narrows them.
 *
 * The model is the single source of the row metadata - the page renders what
 * is written here and the filter matches the very same words - so these
 * tests pin the behaviour the user feels: what the filter finds, what it
 * does not find, and what the page shows.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SETTINGS_CATEGORIES, SETTING_DESCRIPTORS, buildSearchIndex, countByCategory,
  filterSettings, groupByCategory, readSetting,
} from '../src/client/settings-model.js'
import { en, zh } from '../src/client/i18n.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The translate function of the tests: the key is the word. */
const t = key => key

/** The index of the page, built with the real dictionaries. */
const index = buildSearchIndex(key => (en[key] ?? key))

test('every setting of the page belongs to a category of the page', () => {
  const ids = new Set(SETTINGS_CATEGORIES.map(category => category.id))
  for (const descriptor of SETTING_DESCRIPTORS) {
    assert.ok(ids.has(descriptor.category), `${descriptor.key} belongs to a known category`)
  }
  // Every category holds at least one setting: a category with nothing in it
  // is an empty heading on the page.
  const counts = countByCategory(index.entries)
  for (const category of SETTINGS_CATEGORIES) {
    assert.ok(counts.byCategory[category.id] > 0, `${category.id} holds settings`)
  }
})

test('every setting of the page is reachable and has a control', () => {
  const keys = new Set()
  for (const descriptor of SETTING_DESCRIPTORS) {
    assert.ok(!keys.has(descriptor.key), `${descriptor.key} appears once`)
    keys.add(descriptor.key)
    assert.ok(descriptor.control !== undefined, `${descriptor.key} has a control`)
    assert.ok(
      descriptor.labelKey !== undefined || descriptor.label !== undefined,
      `${descriptor.key} has a label`,
    )
  }
})

test('the page shows every shortcut the workbench really reads', () => {
  // These keys were live in the code and unreachable in the settings page:
  // the user could not change them at all.
  const live = [
    'shortcuts.rename', 'shortcuts.delete', 'shortcuts.duplicate', 'shortcuts.move',
    'shortcuts.synchronize', 'shortcuts.openCommitDetail', 'shortcuts.jumpToSource',
    'shortcuts.hideAll',
  ]
  const keys = new Set(SETTING_DESCRIPTORS.map(descriptor => descriptor.key))
  for (const key of live) {
    assert.ok(keys.has(key), `${key} is on the page`)
  }
})

test('the page shows no setting that nothing reads', () => {
  // A setting that no code reads would be worse than no setting: the user
  // changes it and nothing happens. The list is the list of the keys that
  // were removed from the document of the core.
  const dead = [
    'editor.wordWrap', 'git.diffStyle', 'git.structuralOnly', 'git.logPageSize',
    'delete.confirm', 'ui.showStatusBar', 'terminal.cwdMode',
    'shortcuts.compare', 'shortcuts.renameRefs', 'shortcuts.searchEverywhere',
    'shortcuts.revertCommit', 'shortcuts.openEntry',
  ]
  const keys = new Set(SETTING_DESCRIPTORS.map(descriptor => descriptor.key))
  for (const key of dead) {
    assert.ok(!keys.has(key), `${key} is not on the page`)
  }
})

test('the filter finds a setting by its label', () => {
  const found = filterSettings(index.entries, 'font size')
  assert.ok(found.length > 0, 'the filter finds something')
  assert.ok(found.some(entry => entry.key === 'editor.fontSize'), 'the editor font size is found')
})

test('the filter finds a setting by its description', () => {
  // The words of the explanation are part of the search: the user remembers
  // what the setting DOES, not what it is called.
  const found = filterSettings(index.entries, 'recycle')
  assert.ok(found.some(entry => entry.key === 'delete.useRecycleBin'), 'the recycle bin is found')
})

test('the filter finds a setting by its key', () => {
  const found = filterSettings(index.entries, 'terminal.outputLimit')
  assert.ok(found.some(entry => entry.key === 'terminal.outputLimitBytes'), 'the output limit is found')
})

test('the filter finds a setting by the name of its category', () => {
  const found = filterSettings(index.entries, 'shortcuts')
  assert.ok(found.length > 0)
  for (const entry of found) assert.equal(entry.category, 'shortcuts')
})

test('the filter ignores the case and matches every word', () => {
  const upper = filterSettings(index.entries, 'TERMINAL FONT')
  assert.ok(upper.some(entry => entry.key === 'terminal.fontSize'), 'the case does not matter')
  // Two words that belong to two different settings find nothing: the filter
  // does not fall back to a fuzzy match.
  assert.deepEqual(filterSettings(index.entries, 'font zzzz'), [])
})

test('an empty filter keeps every setting', () => {
  assert.equal(filterSettings(index.entries, '').length, index.entries.length)
  assert.equal(filterSettings(index.entries, '   ').length, index.entries.length)
})

test('the counts tell where the matches are', () => {
  const counts = countByCategory(filterSettings(index.entries, 'font'))
  assert.ok(counts.total > 0)
  assert.ok(counts.byCategory.editor > 0, 'the matches of the filter are counted per category')
  const sum = Object.values(counts.byCategory).reduce((total, value) => total + value, 0)
  assert.equal(sum, counts.total, 'the counts of the categories add up to the matches')
})

test('the groups keep the order of the categories', () => {
  const groups = groupByCategory(index.entries)
  const ids = groups.map(group => group.category.id)
  const expected = SETTINGS_CATEGORIES.map(category => category.id).filter(id => ids.includes(id))
  assert.deepEqual(ids, expected, 'the groups appear in the order of the categories')
})

test('one setting is read out of the document by its key', () => {
  const document = { terminal: { fontSize: 15 } }
  assert.equal(readSetting(document, 'terminal.fontSize'), 15)
  assert.equal(readSetting(document, 'terminal.missing'), undefined)
  assert.equal(readSetting({}, 'editor.fontSize'), undefined)
})

test('every word of the page exists in both languages', async () => {
  // A string that exists in one language only is a broken page in the other.
  const keys = new Set([...Object.keys(en), ...Object.keys(zh)])
  for (const descriptor of SETTING_DESCRIPTORS) {
    for (const key of [descriptor.labelKey, descriptor.hintKey]) {
      if (key === undefined) continue
      assert.ok(keys.has(key), `${key} exists in a dictionary`)
      assert.ok(typeof en[key] === 'string' && en[key] !== '', `${key} is written in English`)
      assert.ok(typeof zh[key] === 'string' && zh[key] !== '', `${key} is written in Chinese`)
    }
  }
  for (const category of SETTINGS_CATEGORIES) {
    assert.ok(typeof en[category.labelKey] === 'string' && en[category.labelKey] !== '', `${category.labelKey} is written in English`)
    assert.ok(typeof zh[category.labelKey] === 'string' && zh[category.labelKey] !== '', `${category.labelKey} is written in Chinese`)
  }
})

test('the words of the page exist in both languages', async () => {
  // The labels of the header, the filter and the honest states.
  const words = [
    'settings.categoryAll', 'settings.categoryGeneral', 'settings.categoryDeletion',
    'settings.categoriesLabel', 'settings.filterLabel', 'settings.filterPlaceholder',
    'settings.countAll', 'settings.countMatches', 'settings.emptyTitle', 'settings.emptyHint',
    'settings.emptyClear', 'settings.changedBadge', 'settings.deferredBadge',
    'settings.externalBadge', 'settings.failedBadge', 'settings.dangerBadge',
    'settings.resetOne', 'settings.saveFailed', 'settings.resetConfirm', 'settings.resetConfirmYes',
    'settings.resetTitle', 'settings.resetDone', 'settings.density', 'settings.densityHint',
    'settings.densityComfortable', 'settings.densityCompact',
  ]
  for (const key of words) {
    assert.ok(typeof en[key] === 'string' && en[key] !== '', `${key} is written in English`)
    assert.ok(typeof zh[key] === 'string' && zh[key] !== '', `${key} is written in Chinese`)
  }
})

test('the settings page does not name a colour of its own', async () => {
  // The stylesheet of the page speaks in theme tokens; a raw colour would
  // break in the other theme (styles-theme.test.mjs guards the stylesheet,
  // this test guards the new rules).
  const css = await readFile(join(root, 'src/client/styles.js'), 'utf8')
  const block = css.slice(css.indexOf('.iwb-settings {'), css.indexOf('.iwb-modal-backdrop'))
  const colours = block.match(/#[0-9a-f]{3,8}\b/gi) ?? []
  assert.deepEqual(colours, [], 'the settings page names no colour of its own')
})
