/**
 * The layout of the "new file / new directory" dialog.
 *
 * The dialog used to stack its fields in the order they were written - the
 * name first, the path second - and the path had no frame of its own, so the
 * eye could not tell "where the entry lands" from "what the entry is
 * called". The layout is a hierarchy now:
 *
 *   - the PATH comes first, in a frame of its own: it is the context of the
 *     entry, so it is read before anything else;
 *   - the NAME follows as the primary input, and it keeps the focus;
 *   - the TEMPLATE (files only) comes after it;
 *   - the actions stay at the bottom;
 *   - the hint is quiet secondary text: it follows the path box and never
 *     competes with a label.
 *
 * The behaviour must not move with the layout: the path box stays
 * read-only until it is clicked into, the name keeps the focus, and the
 * hint is still rendered.
 *
 * The dialog is mounted with `renderToStaticMarkup`, the same harness as
 * `tests/tree-sticky.test.mjs` (this package has no jsdom). Static markup
 * carries no event handlers, so `React.createElement` is wrapped to keep
 * every created element: the props can then be driven directly.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, rm, readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The stylesheet of the workbench: the layout lives in it, so the rules of
// the dialog are checked there too.
const styles = await readFile(join(root, 'src/client/styles.js'), 'utf8')

// A tiny DOM surface: module-level browser references must not explode even
// though SSR itself never touches them.
globalThis.window = {
  innerWidth: 1440,
  innerHeight: 900,
  location: { href: 'http://localhost/' },
  addEventListener() {},
  removeEventListener() {},
}
globalThis.self = globalThis.window
globalThis.document = {
  baseURI: 'http://localhost/',
  documentElement: { style: {} },
  head: { appendChild() {} },
  body: { style: {}, appendChild() {}, removeChild() {} },
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
}
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.HTMLElement = class HTMLElement {}

// ── element recorder ────────────────────────────────────────────────────
const created = []
const originalCreateElement = React.createElement
React.createElement = (type, props, ...children) => {
  const element = originalCreateElement(type, props, ...children)
  created.push(element)
  return element
}

let modulePromise

async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'new-entry-layout-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      entryPoints: ['src/client/ProjectPanel.jsx'],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: ['node20'],
      external: ['react', 'react-dom', 'react-dom/server'],
      jsx: 'transform',
      define: { 'process.env.NODE_ENV': '"production"' },
      outfile,
      logLevel: 'silent',
    })
    return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
  })()
  return modulePromise
}

const ROOT = 'C:\\work\\demo'
const SRC = `${ROOT}\\src`
const PACKAGE = `${SRC}\\main\\java\\com\\liangshou\\adapter\\controller`

/** The children of an element, with the fragments opened up. */
function childrenOf(element) {
  const children = element?.props?.children
  if (children === undefined || children === null) return []
  return (Array.isArray(children) ? children : [children])
    .filter(child => child !== null && child !== undefined && typeof child === 'object')
}

/** The class of a rendered element, or null. */
function classOf(element) {
  const className = element?.props?.className
  return typeof className === 'string' ? className : null
}

/** Mount the dialog and keep every element it created. */
function renderDialog(dialog, handlers = {}) {
  created.length = 0
  const html = renderToStaticMarkup(React.createElement(NewEntryDialog, {
    dialog,
    t: key => key,
    onNameChange() {},
    onPathChange() {},
    onPathFocus() {},
    onTemplateChange() {},
    onSubmit() {},
    onCancel() {},
    ...handlers,
  }))
  return { html, elements: created.slice() }
}

let NewEntryDialog
let mod

/** The dialog of a file, opened on the package folder. */
async function fileDialog() {
  if (mod === undefined) mod = await loadModule()
  NewEntryDialog = mod.NewEntryDialog
  return mod.newEntryDialogState(PACKAGE, false, ROOT)
}

/** The dialog of a folder, opened on the package folder. */
async function dirDialog() {
  if (mod === undefined) mod = await loadModule()
  NewEntryDialog = mod.NewEntryDialog
  return mod.newEntryDialogState(PACKAGE, true, ROOT)
}

test('the path block comes before the name field', async () => {
  const dialog = await fileDialog()
  const { elements } = renderDialog(dialog)

  const modal = elements.find(element => classOf(element) === 'iwb-modal iwb-new-entry-modal')
  assert.ok(modal !== undefined, 'the dialog has a class of its own')
  const blocks = childrenOf(modal).map(element => classOf(element))
  assert.deepEqual(blocks, [
    'iwb-new-entry-title',
    'iwb-new-entry-path',
    'iwb-field iwb-new-entry-name',
    'iwb-field iwb-new-entry-template',
    'iwb-modal-actions',
  ], 'the blocks of the dialog, in the order they are rendered')

  const pathAt = blocks.indexOf('iwb-new-entry-path')
  const nameAt = blocks.indexOf('iwb-field iwb-new-entry-name')
  assert.ok(pathAt !== -1, 'the path has a block of its own')
  assert.ok(nameAt !== -1, 'the name is a field')
  assert.ok(pathAt < nameAt, 'the path is read before the name')
})

test('the path sits in a frame, and the hint follows the path box', async () => {
  const dialog = await fileDialog()
  const { html, elements } = renderDialog(dialog)

  const frame = elements.find(element => classOf(element) === 'iwb-new-entry-path')
  assert.ok(frame !== undefined, 'the target folder has a frame')

  // The frame carries the path box and the hint - in that order.
  const frameBlocks = childrenOf(frame).map(element => classOf(element))
  assert.deepEqual(frameBlocks, ['iwb-new-entry-path-box', 'iwb-new-entry-hint'],
    'the frame holds the path box and the hint below it')

  // The hint comes AFTER the path input, not before it.
  const inputAt = html.indexOf('class="iwb-new-entry-path-input')
  const hintAt = html.indexOf('class="iwb-new-entry-hint"')
  assert.ok(inputAt !== -1, 'the path box is inside the frame')
  assert.ok(hintAt !== -1, 'the hint is rendered')
  assert.ok(inputAt < hintAt, 'the hint follows the path box')
})

test('the title comes first and the actions come last', async () => {
  const dialog = await fileDialog()
  const { html, elements } = renderDialog(dialog)

  const modal = elements.find(element => classOf(element) === 'iwb-modal iwb-new-entry-modal')
  const blocks = childrenOf(modal).map(element => classOf(element))
  assert.equal(blocks[0], 'iwb-new-entry-title', 'the title opens the dialog')
  assert.equal(blocks[blocks.length - 1], 'iwb-modal-actions', 'the actions close it')
  assert.ok(html.indexOf('project.newFile') < html.indexOf('iwb-new-entry-path'),
    'the title is rendered above the path frame')
})

test('the layout did not change the behaviour of the dialog', async () => {
  const dialog = await fileDialog()
  const { html, elements } = renderDialog(dialog)

  // The hint is still rendered, and it is still the hint of the path box.
  assert.match(html, /project\.pathHint/)

  // The path box is read-only until it is clicked into: a disabled input
  // cannot be clicked into at all.
  const pathInput = elements.find(element => element?.props?.value === dialog.path
    && element.type === 'input')
  assert.ok(pathInput !== undefined, 'the path box is rendered')
  assert.equal(pathInput.props.readOnly, true, 'the path box is read-only')
  assert.equal(pathInput.props.disabled, undefined, 'a disabled input cannot be clicked into')
  assert.match(pathInput.props.className, /iwb-input-readonly/, 'the path box is greyed')
  assert.equal(typeof pathInput.props.onFocus, 'function', 'a click into the box unlocks it')

  // The name keeps the focus.
  const nameInput = elements.find(element => element?.props?.value === dialog.name
    && element.type === 'input')
  assert.ok(nameInput !== undefined, 'the name box is rendered')
  assert.equal(nameInput.props.autoFocus, true, 'the name keeps the focus')
})

test('the template belongs to the files only', async () => {
  const file = await fileDialog()
  const fileBlocks = childrenOf(renderDialog(file).elements
    .find(element => classOf(element) === 'iwb-modal iwb-new-entry-modal'))
    .map(element => classOf(element))
  assert.ok(fileBlocks.includes('iwb-field iwb-new-entry-template'), 'a file offers a template')

  const dir = await dirDialog()
  const dirBlocks = childrenOf(renderDialog(dir).elements
    .find(element => classOf(element) === 'iwb-modal iwb-new-entry-modal'))
    .map(element => classOf(element))
  assert.ok(!dirBlocks.includes('iwb-field iwb-new-entry-template'), 'a folder has no template')
  // The path block stays on top for a folder too.
  assert.ok(dirBlocks.indexOf('iwb-new-entry-path') < dirBlocks.indexOf('iwb-field iwb-new-entry-name'),
    'the path is read before the name')
})

test('the hint is secondary text, not a label', async () => {
  // The hint is smaller than the labels of the fields and quieter than
  // them: its colour is mixed towards the surface of the frame.
  const hintRule = ruleOf('.iwb-new-entry-hint')
  const hintSize = fontSizeOf(hintRule)
  const labelSize = fontSizeOf(ruleOf('.iwb-field'))
  assert.ok(hintSize !== null, 'the hint has a font size')
  assert.ok(labelSize !== null, 'a field label has a font size')
  assert.ok(hintSize < labelSize, `the hint is ${hintSize}, a label is ${labelSize}`)
  assert.match(hintRule, /color-mix\(/, 'the hint is dimmer than a label')
  assert.doesNotMatch(hintRule, /font-weight:\s*(?:[5-9]00|bold)/, 'the hint is not a label')

  // Every colour of the new rules comes from a token.
  const block = styles.slice(styles.indexOf('.iwb-new-entry-modal'))
  assert.doesNotMatch(block.slice(0, block.indexOf('.iwb-toast')), /#[0-9a-f]{3,8}\b/i,
    'the rules of the dialog hold no hard-coded colour')
  assert.doesNotMatch(block.slice(0, block.indexOf('.iwb-toast')), /rgba?\(/i,
    'the rules of the dialog hold no hard-coded colour')
  assert.doesNotMatch(block.slice(0, block.indexOf('.iwb-toast')), /prefers-color-scheme/,
    'the rules of the dialog follow the host theme, not the system theme')
})

test('the shared modal rules are untouched', async () => {
  // The settings modal and the confirmation keep their own look: the
  // dialog of the new entry lives under its own class and changes nothing
  // that the other modals share.
  assert.match(styles, /\.iwb-modal \{[^}]*width: min\(440px, calc\(100% - 40px\)\);/,
    'the shared modal keeps its width')
  assert.match(styles, /\.iwb-field \{ display: flex; flex-direction: column; gap: 5px; margin: 10px 0; font-size: 12px; color: var\(--iwb-muted\); \}/,
    'the shared field keeps its look')
  assert.match(styles, /\.iwb-modal-hint \{ color: var\(--iwb-muted\); font-size: 12px; margin: -2px 0 12px; \}/,
    'the shared hint keeps its look')
})

/** The body of the rule of a selector. */
function ruleOf(selector) {
  const start = styles.indexOf(`${selector} {`)
  assert.ok(start !== -1, `the stylesheet holds a rule for ${selector}`)
  const open = styles.indexOf('{', start)
  const close = styles.indexOf('}', open)
  return styles.slice(open + 1, close)
}

/** The font size of a rule, in pixels. */
function fontSizeOf(rule) {
  const match = /font-size:\s*([0-9.]+)px/.exec(rule)
  return match === null ? null : Number(match[1])
}
