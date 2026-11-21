/**
 * The settings page renders what the model says, and it can be operated
 * without a mouse.
 *
 * The page is rendered on the server (the same way the workbench renders it)
 * and the markup is read: the rows, the labels that are bound to their
 * control, the category bar and the honest states of a row.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

import { SETTING_DESCRIPTORS } from '../src/client/settings-model.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const moduleRequire = createRequire(import.meta.url)

// A tiny DOM surface is enough for the module-level browser references; the
// server-side render itself does not touch it, because no effect runs.
globalThis.window = {
  innerWidth: 1440,
  innerHeight: 900,
  location: { href: 'http://localhost/' },
  addEventListener() {},
  removeEventListener() {},
}
globalThis.self = globalThis.window
const elementStub = () => ({
  style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false },
  setAttribute() {}, removeAttribute() {}, remove() {}, appendChild() {}, insertBefore() {},
  addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
  querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  getContext: () => null,
})
globalThis.document = {
  baseURI: 'http://localhost/',
  documentElement: { ...elementStub(), style: {} },
  head: { appendChild() {} },
  body: { style: {}, appendChild() {}, removeChild() {} },
  createElement: elementStub,
  createElementNS: elementStub,
  createTextNode: () => ({ style: {}, remove() {} }),
  createRange: () => ({ startContainer: elementStub(), endContainer: elementStub(), setStart() {}, setEnd() {}, getBoundingClientRect: () => ({ top: 0, left: 0 }), getClientRects: () => [] }),
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener() {},
  removeEventListener() {},
}
globalThis.window.getComputedStyle = () => ({ getPropertyValue: () => '', fontSize: '13px' })
globalThis.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
globalThis.window.requestAnimationFrame = callback => setTimeout(() => callback(Date.now()), 0)
globalThis.window.cancelAnimationFrame = handle => clearTimeout(handle)
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { clipboard: { writeText: async () => {}, readText: async () => '' } },
})
globalThis.ResizeObserver = class { observe() {} disconnect() {} }

let modulePromise

/**
 * The settings page, bundled for the server-side render.
 * @returns {Promise<object>} the module of the render entry
 */
async function loadPage() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'settings-page-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      entryPoints: ['tests/settings-render-entry.jsx'],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: ['node20'],
      external: ['react', 'react-dom', 'react-dom/server'],
      alias: {
        '@xterm/xterm/css/xterm.css': moduleRequire.resolve('@xterm/xterm/css/xterm.css'),
        '@xterm/xterm': join(root, 'tests/stubs/xterm.js'),
        '@xterm/addon-fit': join(root, 'tests/stubs/xterm-addon-fit.js'),
        'virtual:pdf-worker': join(root, 'tests/stubs/pdf-worker.js'),
      },
      loader: { '.css': 'text' },
      jsx: 'transform',
      define: { 'process.env.NODE_ENV': '"production"' },
      outfile,
      logLevel: 'silent',
    })
    return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
  })()
  return modulePromise
}

/**
 * The settings that the markup of the page carries.
 * @param {string} html the markup
 * @returns {string[]} the keys of the rows
 */
function renderedSettings(html) {
  return [...html.matchAll(/data-setting="([^"]+)"/g)].map(match => match[1])
}

test('the page shows every setting of the model', async () => {
  const { renderSettingsPage } = await loadPage()
  const html = renderSettingsPage()
  const shown = renderedSettings(html)
  const expected = SETTING_DESCRIPTORS.map(descriptor => descriptor.key)
  // A redesign must not silently drop a setting: every setting of the model
  // is on the page.
  assert.deepEqual([...shown].sort(), [...expected].sort())
})

test('the page groups the rows under the categories of the model', async () => {
  const { renderSettingsPage } = await loadPage()
  const html = renderSettingsPage()
  assert.match(html, /iwb-settings-group-title/, 'the groups carry a title')
  assert.match(html, /iwb-settings-group-desc/, 'a group may carry a description')
  // The explanation of the shortcuts is said once, for the whole group.
  assert.equal((html.match(/settings\.shortcutsGroupHint/g) ?? []).length, 1)
})

test('the filter is a search field with a name and a target', async () => {
  const { renderSettingsPage } = await loadPage()
  const html = renderSettingsPage()
  assert.match(html, /role="search"/, 'the filter lives in a search landmark')
  assert.match(html, /type="search"/, 'the filter is a search field')
  assert.match(html, /aria-label="settings\.filterLabel"/, 'the filter has a name')
  assert.match(html, /aria-controls="iwb-settings-panel"/, 'the filter controls the panel')
  assert.match(html, /role="status"/, 'the number of the matches is announced')
})

test('the categories are a tablist with one selected tab', async () => {
  const { renderSettingsPage } = await loadPage()
  const html = renderSettingsPage()
  assert.match(html, /role="tablist"/, 'the categories are a tablist')
  assert.match(html, /role="tab"/, 'the categories are tabs')
  assert.match(html, /aria-controls="iwb-settings-panel"/, 'the tab controls the panel')
  assert.match(html, /role="tabpanel"/, 'the rows live in a tab panel')
  assert.match(html, /aria-labelledby="iwb-settings-tab-all"/, 'the panel is named by its tab')
  // Exactly one tab is selected: a tablist with two selected tabs is a lie.
  assert.equal((html.match(/aria-selected="true"/g) ?? []).length, 1)
})

test('every control is bound to a visible label', async () => {
  const { renderSettingsPage } = await loadPage()
  const html = renderSettingsPage()
  // The label of a row names the control of the row: clicking the name of a
  // setting changes it, and a screen reader announces the pair.
  const labels = [...html.matchAll(/<label class="iwb-settings-title" for="([^"]+)"/g)].map(match => match[1])
  assert.ok(labels.length > 0, 'the rows carry labels')
  for (const id of labels) {
    assert.ok(html.includes(`id="${id}"`), `the control ${id} exists`)
  }
  // Every checkbox, text field, number field and select of the page is one
  // of them: a control without a label is invisible to a screen reader. The
  // filter is not one of them: it is named by its own aria-label.
  const controls = [...html.matchAll(/<(input|select)[^>]*id="(iwb-settings-[^"]+)"/g)]
    .map(match => match[2])
    .filter(id => id !== 'iwb-settings-filter')
  assert.ok(controls.length > 0, 'the page has controls')
  for (const id of controls) {
    assert.ok(labels.includes(id), `the control ${id} has a label`)
  }
})

test('the shortcut rows carry a capture chip', async () => {
  const { renderSettingsPage } = await loadPage()
  const html = renderSettingsPage()
  assert.match(html, /iwb-settings-shortcut/, 'the shortcut rows carry a chip')
  // The chip is a button with a name of its own - and the name carries the
  // shortcut the chip SHOWS (WCAG 2.5.3): a name that was only the hint
  // never told a screen reader which shortcut is bound.
  assert.match(html, /aria-label="Alt\+1 · settings\.recordShortcutHint"/)
  // Every chip of the page names the shortcut it holds.
  const chips = [...html.matchAll(/aria-label="([^"]+) · settings\.recordShortcutHint"/g)]
    .map(match => match[1])
  assert.ok(chips.length >= 9, `the chips name their shortcut (${chips.length} chips)`)
  // The shortcut the chip shows is in its name.
  for (const shortcut of chips) {
    assert.match(html, new RegExp(`>${shortcut.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`), `the chip of ${shortcut} shows it`)
  }
})

test('a row that the user changed says so', async () => {
  const { renderSettingsPage } = await loadPage()
  // The default of the editor font size is 13; the document says 17.
  const html = renderSettingsPage({
    document: { editor: { fontSize: 17, highlight: true, openMode: 'auto', editableMaxBytes: 1048576, markdownPreview: true } },
  })
  assert.match(html, /iwb-settings-badge-changed/, 'a changed setting is marked')
  // The row that changed also offers the way back to the default.
  assert.match(html, /iwb-settings-reset-row/, 'a changed setting can be put back')
})

test('a setting that only affects the new sessions says so', async () => {
  const { renderSettingsPage } = await loadPage()
  const html = renderSettingsPage()
  // The shell and the output limit are read when a session starts.
  assert.match(html, /iwb-settings-badge-deferred/, 'the deferred settings are marked')
})

test('the destructive setting says so when it is off', async () => {
  const { renderSettingsPage } = await loadPage()
  const html = renderSettingsPage({ document: { delete: { useRecycleBin: false } } })
  assert.match(html, /iwb-settings-badge-danger/, 'the permanent delete is marked')
})

test('the reset asks before it throws the settings away', async () => {
  const { renderSettingsPage } = await loadPage()
  const html = renderSettingsPage()
  // The reset lives in the header of the page, not at the end of a long
  // scroll, and it asks before it acts.
  assert.match(html, /iwb-settings-reset/, 'the reset is on the page')
  assert.match(html, /aria-label="settings\.resetTitle"/, 'the reset says what it does')
})

test('the page carries the groups of the other plugins', async () => {
  const { renderSettingsPage } = await loadPage()
  const html = renderSettingsPage({
    props: { contract: { version: 1 }, renderSlot: () => 'SLOT' },
  })
  assert.match(html, /SLOT/, 'the slot of the other plugins is rendered')
})
