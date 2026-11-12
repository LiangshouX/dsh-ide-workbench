/**
 * The display name of a language id.
 *
 * The host speaks language ids (`typescript`), the user reads names
 * (`TypeScript`). The helper was born in the flat layout of the plugin and
 * moved here with the plugin that owns the language servers - and the dialogs
 * of the plugin are the only place that shows the language of a decision.
 *
 * The test also pins the wiring: the dialog has to show the NAME, not the id.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { languageLabel } from '../src/client/language-label.js'

const here = dirname(fileURLToPath(import.meta.url))
const decisionSource = await readFile(join(here, '..', 'src', 'client', 'decision.jsx'), 'utf8')

test('a known language id becomes its name', () => {
  assert.equal(languageLabel('typescript'), 'TypeScript')
  assert.equal(languageLabel('typescriptreact'), 'TypeScript React')
  assert.equal(languageLabel('javascript'), 'JavaScript')
  assert.equal(languageLabel('javascriptreact'), 'JavaScript React')
  assert.equal(languageLabel('python'), 'Python')
  assert.equal(languageLabel('yaml'), 'YAML')
  assert.equal(languageLabel('java'), 'Java')
  assert.equal(languageLabel('go'), 'Go')
  assert.equal(languageLabel('rust'), 'Rust')
  assert.equal(languageLabel('c'), 'C')
  assert.equal(languageLabel('cpp'), 'C++')
})

test('an unknown language id is shown as it is', () => {
  // The id of a language the plugin does not know is still better than
  // nothing: the user can read `kotlin` even if the plugin has no name for it.
  assert.equal(languageLabel('kotlin'), 'kotlin')
  assert.equal(languageLabel(''), '')
  assert.equal(languageLabel(undefined), '')
  assert.equal(languageLabel(null), '')
})

test('the index decision shows the name of the language', () => {
  // The dialog must not show the raw id: `typescript` is a host word, and
  // `TypeScript` is what the user reads.
  assert.match(decisionSource, /languageLabel\(decision\.language\)/)
  assert.doesNotMatch(decisionSource, /React\.createElement\('div', null, decision\.language\)/)
})
