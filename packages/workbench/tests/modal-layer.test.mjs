/**
 * The layer of the blocking confirmation (PRD-v5 supplement, LAYER-01).
 *
 * The "unsaved changes" warning and the project picker shared one backdrop
 * class with the same z-index, so the warning was drawn *under* the picker:
 * it was there, but neither visible nor clickable.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('the blocking confirmation has its own layer above the modals', async () => {
  const source = await readFile(join(root, 'src/client/styles.js'), 'utf8')
  const modal = /\.iwb-modal-backdrop\s*\{[^}]*z-index:\s*(\d+)/.exec(source)
  const confirm = /\.iwb-modal-backdrop\.iwb-confirm-backdrop\s*\{[^}]*z-index:\s*(\d+)/.exec(source)
  assert.ok(modal !== null, 'the modal backdrop has a z-index')
  assert.ok(confirm !== null, 'the confirmation backdrop has its own z-index')
  assert.ok(
    Number(confirm[1]) > Number(modal[1]),
    'the confirmation has to be above the dialog it answers',
  )
})

test('the confirmation dims the surface deeper, so the two layers do not stack into a black screen', async () => {
  const source = await readFile(join(root, 'src/client/styles.js'), 'utf8')
  const rule = /\.iwb-modal-backdrop\.iwb-confirm-backdrop\s*\{([^}]*)\}/.exec(source)
  assert.ok(rule !== null)
  assert.match(rule[1], /background:\s*rgba\(0,\s*0,\s*0,\s*\.6\)/)
})

test('the confirmation dialog uses the blocking backdrop', async () => {
  const source = await readFile(join(root, 'src/client/ui.jsx'), 'utf8')
  assert.match(source, /iwb-modal-backdrop iwb-confirm-backdrop/)
  // The editor-scoped variant (the save conflict of one document) keeps its
  // own layer: it lives inside the document pane.
  assert.match(source, /iwb-modal-backdrop iwb-editor-scoped-backdrop/)
})

test('the DOM order of the dialogs is not what keeps the warning on top', async () => {
  // The fix is the layer, not the order: the project picker is still drawn
  // after the confirmation, and the confirmation is still visible there.
  const source = await readFile(join(root, 'src/client/Workbench.jsx'), 'utf8')
  const picker = source.indexOf('React.createElement(ProjectPicker')
  const confirm = source.indexOf('React.createElement(ConfirmModal')
  assert.ok(picker !== -1 && confirm !== -1)
  // The picker comes last - the layer is what makes the difference.
  assert.ok(picker > confirm)
})

test('the unsaved-changes warning names the target and offers three ways out', async () => {
  const i18n = await readFile(join(root, 'src/client/i18n.js'), 'utf8')
  // The text says what is going to happen and how many files are affected.
  assert.match(i18n, /'editor\.unsavedSwitchRoot': 'Switching to \{target\} discards the unsaved changes in \{count\} open file\(s\)/)
  assert.match(i18n, /'editor\.saveAndSwitch':/)
  assert.match(i18n, /'editor\.discardAndSwitch':/)

  const store = await readFile(join(root, 'src/client/store.js'), 'utf8')
  // Three actions: cancel, discard and switch, save and switch.
  assert.match(store, /key: 'discard', label: this\.t\('editor\.discardAndSwitch'\)/)
  assert.match(store, /key: 'save', label: this\.t\('editor\.saveAndSwitch'\)/)
})
