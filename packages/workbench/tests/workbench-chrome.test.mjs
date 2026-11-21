/**
 * The chrome of the workbench (PRD-v8 §4 and §2.3).
 *
 * Three families of rules live here:
 *
 *   - the BUTTONS. The top bar carries one action (the settings), the
 *     Project panel carries three (filter, locate, refresh). The buttons
 *     that were removed had a better home each - a keyboard shortcut, the
 *     menu, or the button of the host - so removing them is a CONFLATION of
 *     the entry, never of the function.
 *   - the GLYPHS. A Unicode character is not an icon: it renders differently
 *     in every font and it says nothing. The functional icons are SVG.
 *   - the TOKENS. The stylesheet has ONE radius, ONE easing and ONE set of
 *     surfaces, so the workbench has a rhythm instead of fifty small
 *     decisions.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const clientDir = join(root, 'src/client')
// The workspace hoists the packages to the root of the repository: the
// terminal stylesheet is resolved, not guessed.
const moduleRequire = createRequire(import.meta.url)

const styles = await readFile(join(clientDir, 'styles.js'), 'utf8')

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
    const outfile = join(dir, 'chrome-entry.mjs')
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

let workbenchPromise

/** The SSR entry of the test suite: the whole workbench, mounted. */
async function loadWorkbench() {
  if (workbenchPromise !== undefined) return workbenchPromise
  workbenchPromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'chrome-workbench-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      entryPoints: ['tests/render-entry.jsx'],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: ['node20'],
      external: ['react', 'react-dom', 'react-dom/server', '@deepseek-ai/dsh-client-ui-primitives'],
      alias: {
        '@xterm/xterm/css/xterm.css': moduleRequire.resolve('@xterm/xterm/css/xterm.css'),
        '@xterm/xterm': join(root, 'tests/stubs/xterm.js'),
        '@xterm/addon-fit': join(root, 'tests/stubs/addon-fit.js'),
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
  return workbenchPromise
}

const ROOT = 'C:\\work\\demo'

function entry(name, path, rel, isDir) {
  return { name, path, rel, isDir, isSymlink: false, hidden: false, size: 0, mtimeMs: 0, ext: '' }
}

function baseState() {
  return {
    root: ROOT,
    dirs: new Map([
      [ROOT, {
        loading: false,
        entries: [entry('src', `${ROOT}\\src`, 'src', true), entry('a.ts', `${ROOT}\\a.ts`, 'a.ts', false)],
      }],
    ]),
    expanded: new Set([ROOT]),
    status: { isRepo: true, branch: 'main', entries: [] },
    settings: { shortcuts: {}, project: { showIgnored: false, singleClickOpen: false, excluded: [] } },
    filter: '',
    filterMode: 'tree',
    fileIndex: [],
    fileIndexLoading: false,
    fileIndexError: null,
    selectedPath: '',
    selectedPaths: new Set(),
    tabs: [],
    activeId: '',
    treeFocusTick: 0,
    gitRepoRoot: '',
  }
}

function baseStore(state) {
  const calls = []
  const record = (name, ...args) => { calls.push({ name, args }) }
  return {
    t: key => key,
    state: { clipboard: null },
    calls,
    getSnapshot: () => state,
    subscribe: () => () => {},
    setSelection: (...args) => record('setSelection', ...args),
    setFilter: (...args) => record('setFilter', ...args),
    setFilterMode: (...args) => record('setFilterMode', ...args),
    sync: (...args) => record('sync', ...args),
    showTool: (...args) => record('showTool', ...args),
    setSelectedPath: (...args) => record('setSelectedPath', ...args),
    toast: (...args) => record('toast', ...args),
  }
}

/** The markup of the Project panel. */
async function renderPanel() {
  const mod = await loadModule()
  const state = baseState()
  const store = baseStore(state)
  created.length = 0
  const html = renderToStaticMarkup(React.createElement(mod.ProjectPanel, { store }))
  return { html, elements: created.slice() }
}

/** The markup of the whole workbench (the SSR entry of the test suite). */
async function renderWorkbench() {
  const entry = await loadWorkbench()
  return entry.renderProject()
}

/* ── the top bar ───────────────────────────────────────────────────────── */

test('the top bar carries the settings and nothing else', async () => {
  // PRD-v8 §4.2: "hide all", "fullscreen" and "refresh" left the bar - the
  // keyboard, the menu and the button of the host still do the same work.
  const html = await renderWorkbench()
  const start = html.indexOf('class="iwb-topbar"')
  assert.ok(start !== -1, 'the workbench has a top bar')
  const end = html.indexOf('class="iwb-body"', start)
  const bar = html.slice(start, end === -1 ? html.length : end)

  assert.match(bar, /title="common\.settings"/, 'the settings stay in the bar')
  assert.doesNotMatch(bar, /title="layout\.fullscreen"/, 'the fullscreen button is gone')
  assert.doesNotMatch(bar, /title="layout\.exitFullscreen"/, 'the restore button is gone')
  assert.doesNotMatch(bar, /title="layout\.hideAll"/, 'the hide-all button is gone')
  assert.doesNotMatch(bar, /title="common\.refresh"/, 'the refresh button is gone')
})

/* ── the header of the Project panel ───────────────────────────────────── */

test('the Project panel header carries filter, locate and refresh', async () => {
  const { html } = await renderPanel()
  assert.match(html, /title="project\.filter"/, 'the filter stays')
  assert.match(html, /title="project\.locateFile"/, 'the locate stays')
  assert.match(html, /title="common\.refresh"/, 'the refresh stays')
  // PRD-v8 §4.1: the "new file" button could only create ONE file, and only
  // at the root of the project. The context menu and Alt+Insert cover it.
  assert.doesNotMatch(html, /title="project\.newFile"/, 'the new-file button is gone')
})

test('the locate button draws an icon, not a character', async () => {
  const { elements } = await renderPanel()
  const button = elements.find(element => element?.props?.title === 'project.locateFile')
  assert.ok(button !== undefined, 'the locate button is rendered')
  const raw = button.props.children
  const children = (Array.isArray(raw) ? raw : [raw]).filter(child => child !== null && child !== undefined)
  // The glyph it used to carry was a black blob in most fonts.
  for (const child of children) {
    assert.notEqual(typeof child, 'string', 'the locate button carries no text glyph')
  }
  assert.ok(children.some(child => child?.type !== undefined), 'the locate button carries an icon')
})

/* ── the glyphs ────────────────────────────────────────────────────────── */

/**
 * The characters that used to stand in for an icon.
 *
 * They are not decorative: each of them was a control - a close button, a
 * caret, a marker. A character renders differently in every font and says
 * nothing to a reader who has never seen it; an SVG says the same thing
 * everywhere.
 */
const FORBIDDEN_GLYPHS = ['⊟', '⛶', '⌖', '×', '▾', '▸', '●', '✓']

test('no Unicode character stands in for a functional icon', async () => {
  const files = (await readdir(clientDir)).filter(name => name.endsWith('.jsx') || name.endsWith('.js'))
  const offenders = []
  for (const name of files) {
    const text = await readFile(join(clientDir, name), 'utf8')
    for (const glyph of FORBIDDEN_GLYPHS) {
      if (text.includes(glyph)) offenders.push(`${name}: ${glyph}`)
      // The escaped spelling counts as well: `'\u2316'` is the same glyph.
      const escaped = `\\u${glyph.codePointAt(0).toString(16).padStart(4, '0')}`
      if (text.includes(escaped)) offenders.push(`${name}: ${escaped}`)
    }
  }
  assert.deepEqual(offenders, [], 'the functional icons are SVG')
})

/* ── the new entry ─────────────────────────────────────────────────────── */

test('the shortcut asks for a directory only when the shift key says so', async () => {
  const mod = await loadModule()
  // Alt+Insert repeats the kind of the last dialog.
  assert.equal(mod.newEntryKindFor({ altKey: true, key: 'Insert' }, false), false)
  assert.equal(mod.newEntryKindFor({ altKey: true, key: 'Insert' }, true), true)
  // Alt+Shift+Insert always asks for a directory.
  assert.equal(mod.newEntryKindFor({ altKey: true, shiftKey: true, key: 'Insert' }, false), true)
  assert.equal(mod.newEntryKindFor({ altKey: true, shiftKey: true, key: 'Insert' }, true), true)
  // A broken event does not throw.
  assert.equal(mod.newEntryKindFor(null, true), true)
})

test('the two new-entry entries name two different shortcuts', async () => {
  // The old menu offered "New File" and "New Directory" and BOTH claimed
  // Alt+Insert - a hint that lied. The shortcuts are different now.
  const source = await readFile(join(clientDir, 'ProjectPanel.jsx'), 'utf8')
  const file = /key: 'new-file'[^\n]*shortcut: '([^']+)'/.exec(source)
  const dir = /key: 'new-dir'[^\n]*shortcut: '([^']+)'/.exec(source)
  assert.ok(file !== null, 'the new-file entry names a shortcut')
  assert.ok(dir !== null, 'the new-dir entry names a shortcut')
  assert.equal(file[1], 'Alt+Insert')
  assert.equal(dir[1], 'Alt+Shift+Insert')
  assert.notEqual(file[1], dir[1], 'the two entries do not claim the same shortcut')
})

/* ── the design tokens ─────────────────────────────────────────────────── */

test('the stylesheet declares the design tokens of the round', () => {
  for (const token of [
    '--iwb-radius-xs', '--iwb-radius-sm', '--iwb-radius-md', '--iwb-radius-lg',
    '--iwb-space-1', '--iwb-space-3', '--iwb-space-5',
    '--iwb-ease', '--iwb-dur-fast', '--iwb-dur',
    '--iwb-surface-base', '--iwb-surface-raised', '--iwb-surface-sunken',
    '--iwb-surface-overlay', '--iwb-surface-hover', '--iwb-surface-active',
    '--iwb-surface-selected',
    '--iwb-sheen', '--iwb-highlight', '--iwb-shadow-sm', '--iwb-shadow-md',
    '--iwb-shadow-lg', '--iwb-focus-ring',
  ]) {
    assert.ok(styles.includes(`${token}:`), `the stylesheet declares ${token}`)
  }
})

test('the buttons are drawn with the tokens, not with flat fills', () => {
  // The icon button is a ghost: it has no border and no fill until the
  // pointer arrives.
  const iconRule = /\.iwb-iconbtn \{[^}]*\}/.exec(styles)
  assert.ok(iconRule !== null, 'the stylesheet has a rule for the icon button')
  assert.doesNotMatch(iconRule[0], /border:\s*1px/, 'the icon button has no border')

  // The text button is a solid: it catches light and casts a shadow.
  const textRule = /\.iwb-textbtn \{[^}]*\}/.exec(styles)
  assert.ok(textRule !== null, 'the stylesheet has a rule for the text button')
  assert.match(textRule[0], /box-shadow:/, 'the text button casts a shadow')
  assert.match(textRule[0], /var\(--iwb-sheen\)/, 'the text button catches light')

  // Every button answers the pointer.
  assert.match(styles, /\.iwb-iconbtn:hover:not\(:disabled\)/, 'the icon button answers the pointer')
  assert.match(styles, /\.iwb-textbtn:active:not\(:disabled\)/, 'the text button answers the press')

  // A keyboard user can see where the focus is.
  assert.match(styles, /\.iwb-root button:focus-visible \{[^}]*--iwb-focus-ring/, 'the focus ring is visible')
})

test('the surfaces of the workbench are named, not guessed', () => {
  // The hover of a row is mixed from the theme's own text colour: a grey
  // that belongs to neither theme is what made the old panels look flat.
  assert.match(styles, /--iwb-surface-hover:\s*color-mix\(in srgb, var\(--iwb-fg\)/)
  assert.match(styles, /--iwb-surface-selected:\s*color-mix\(in srgb, var\(--iwb-accent\)/)
  // And no rule of the workbench paints a row with a hard-coded grey.
  assert.doesNotMatch(styles, /rgba\(127,\s*127,\s*127/, 'the workbench paints no hard-coded grey')
})

test('the floating layers are glass, and the dense ones are not', () => {
  // The material of the recent system UIs: a translucent surface that
  // catches the light and blurs what is behind it. It belongs to the layers
  // that float ABOVE the content - the menu, the dialog, the toast.
  assert.match(styles, /--iwb-glass:/, 'the glass has a token')
  assert.match(styles, /--iwb-glass-blur:/, 'the blur has a token')
  assert.match(styles, /@supports \(\(backdrop-filter/, 'the blur is behind a capability check')
  const glass = /@supports \(\(backdrop-filter[^{]*\{([^}]*\{[^}]*\}[^}]*)\}/.exec(styles)
  assert.ok(glass !== null, 'the stylesheet has the glass block')
  for (const selector of ['.iwb-menu', '.iwb-modal', '.iwb-toast']) {
    assert.ok(glass[1].includes(selector), `${selector} is glass`)
  }
  // The dense surfaces stay SOLID: a file tree behind a blur is unreadable,
  // and a blur on every row would cost a frame per row.
  for (const selector of ['.iwb-tree-row', '.iwb-left', '.iwb-code']) {
    assert.ok(!glass[1].includes(selector), `${selector} stays solid`)
  }
})
