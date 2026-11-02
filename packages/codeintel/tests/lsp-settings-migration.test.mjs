/**
 * The migration of the `lsp` section of the settings document (PRD-v5.1).
 *
 * The document of the code intelligence is the one of the plugin itself
 * (`<profile>/dsh-codeintel/settings.json`, PRD-v6 §7), and it is filled in
 * from the defaults when it is read. A document that was written before a
 * setting existed therefore has to be completed by the migration - and a
 * value that was HAND EDITED (a budget of "half", a pressure switch of
 * "yes") has to be repaired instead of being carried into the runtime: a
 * budget that is not a number makes the budget of the host meaningless.
 *
 * The cases live here because the `lsp` section belongs to the code
 * intelligence: they were part of `store-workspace-defaults.test.mjs` in the
 * single-plugin build, and that file also drove the client of the old
 * workbench - which does not exist here any more.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS, migrateLspSettings } from '../src/host/settings-store.js'
import { DEFAULT_LSP_SETTINGS } from '../src/host/settings-defaults.js'

test('the new keys arrive in an old document', () => {
  const document = { version: 5, lsp: { enabled: true, indexOnOpen: 'ask' } }
  migrateLspSettings(document)
  assert.equal(document.lsp.budgetRatio, DEFAULT_LSP_SETTINGS.budgetRatio)
  assert.equal(document.lsp.budgetCapMB, DEFAULT_LSP_SETTINGS.budgetCapMB)
  assert.equal(document.lsp.maxConcurrentIndexes, DEFAULT_LSP_SETTINGS.maxConcurrentIndexes)
  assert.equal(document.lsp.pressureYield, DEFAULT_LSP_SETTINGS.pressureYield)
  assert.deepEqual(document.lsp.workspaceDefaults, {})
  // The old values survive the migration.
  assert.equal(document.lsp.indexOnOpen, 'ask')
})

test('a hand-edited budget is repaired', () => {
  const document = {
    version: 5,
    lsp: { budgetRatio: 'half', budgetCapMB: -1, maxConcurrentIndexes: -3, pressureYield: 'yes' },
  }
  migrateLspSettings(document)
  assert.equal(document.lsp.budgetRatio, DEFAULT_SETTINGS.lsp.budgetRatio)
  assert.equal(document.lsp.budgetCapMB, DEFAULT_SETTINGS.lsp.budgetCapMB)
  assert.equal(document.lsp.maxConcurrentIndexes, DEFAULT_SETTINGS.lsp.maxConcurrentIndexes)
  assert.equal(document.lsp.pressureYield, DEFAULT_SETTINGS.lsp.pressureYield)
})

test('a budget the user chose survives the migration', () => {
  const document = { version: 5, lsp: { budgetRatio: 0.5, budgetCapMB: 2048, maxConcurrentIndexes: 2, pressureYield: false } }
  migrateLspSettings(document)
  assert.equal(document.lsp.budgetRatio, 0.5)
  assert.equal(document.lsp.budgetCapMB, 2048)
  assert.equal(document.lsp.maxConcurrentIndexes, 2)
  assert.equal(document.lsp.pressureYield, false)
})

test('a hand-edited workspace default map is repaired', () => {
  const document = { version: 5, lsp: { workspaceDefaults: 'nonsense' } }
  migrateLspSettings(document)
  assert.deepEqual(document.lsp.workspaceDefaults, {})
})

test('the workspace default map of the user survives the migration', () => {
  const document = { version: 5, lsp: { workspaceDefaults: { 'C:\\work\\demo': 'conservative' } } }
  migrateLspSettings(document)
  assert.deepEqual(document.lsp.workspaceDefaults, { 'C:\\work\\demo': 'conservative' })
})
