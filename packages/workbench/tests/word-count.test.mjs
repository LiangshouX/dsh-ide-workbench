/**
 * A1 — the word count of the status bar.
 *
 * The number is counted by the store, once, when the buffer is read or
 * written. The status bar re-renders on every keystroke and on every git
 * poll, so a scan of the text in the render path would be paid over and over
 * again (the requirement: "只在加载 / 保存时算一次").
 *
 * The counting rule is 口径 B: a CJK character counts one by one, a Latin text
 * counts one word per whitespace-separated word, and the two are added.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, rm, readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { countWords, documentStats, WorkbenchStore } from '../src/client/store.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// The workspace hoists the packages to the root of the repository: the
// terminal stylesheet is resolved, not guessed.
const moduleRequire = createRequire(import.meta.url)

// A tiny DOM surface is enough for module-level browser references; SSR itself
// does not touch it because no effects run.
globalThis.window = {
  innerWidth: 1440,
  innerHeight: 900,
  location: { href: 'http://localhost/' },
  addEventListener() {},
  removeEventListener() {},
}
globalThis.self = globalThis.window
globalThis.HTMLElement = class HTMLElement {}
globalThis.Element = class Element {}
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
  createRange: () => ({ style: {}, remove() {} }),
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener() {},
  removeEventListener() {},
}
globalThis.window.getComputedStyle = () => ({ getPropertyValue: () => '', fontSize: '13px' })
globalThis.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
globalThis.window.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0)
globalThis.window.cancelAnimationFrame = (handle) => clearTimeout(handle)
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { clipboard: { writeText: async () => {}, readText: async () => '' } },
})
globalThis.ResizeObserver = class { observe() {} disconnect() {} }

// ── the pure counter ────────────────────────────────────────────────────────

test('the counter follows 口径 B: CJK one by one, Latin one word per space', () => {
  // The example of the requirement: 2 CJK characters + 2 Latin words.
  assert.equal(countWords('你好，hello world'), 4)
  assert.equal(countWords('hello world'), 2)
  assert.equal(countWords('你好世界'), 4)
  assert.equal(countWords(''), 0)
  assert.equal(countWords('   \n\t  '), 0)
  assert.equal(countWords('Hello, world!'), 2)
  assert.equal(countWords('a1 b2'), 2)
  // A Chinese word glued to an English one is two units.
  assert.equal(countWords('中文english'), 3)
  // The punctuation of a Chinese sentence is not a word.
  assert.equal(countWords('第一段。第二段。'), 6)
  assert.equal(countWords('你好，世界'), 4)
  // A token without a letter or a digit is punctuation, not a word.
  assert.equal(countWords('!!!'), 0)
})

test('the Markdown syntax and the code blocks count as plain text', () => {
  // No Markdown is parsed: what is written is what is counted.
  assert.equal(countWords('**markdown** `code`'), 2)
  assert.equal(countWords('# Title\n\n```js\nconst a = 1\n```\n'), 5)
})

test('the counts of one document: the lines always, the words only for md/txt', () => {
  assert.deepEqual(documentStats('C:\\work\\demo\\README.md', 'a\nb'), { lines: 2, words: 2 })
  assert.deepEqual(documentStats('C:\\work\\demo\\notes.txt', 'hello'), { lines: 1, words: 1 })
  // A source file is not counted: the number would describe the code.
  assert.deepEqual(documentStats('C:\\work\\demo\\main.ts', 'const a = 1\n'), { lines: 2, words: undefined })
  assert.deepEqual(documentStats('C:\\work\\demo\\logo.png', 'binary'), { lines: 1, words: undefined })
  // A file the host cut short has no meaningful count.
  assert.deepEqual(documentStats('C:\\work\\demo\\README.md', 'hello', true), { lines: 1, words: undefined })
  // A file that is not text at all has no counts.
  assert.deepEqual(documentStats('C:\\work\\demo\\logo.png', null), { lines: undefined, words: undefined })
})

// ── the store counts the buffer once ───────────────────────────────────────

/** One host stub: it answers the routes a test names and records the calls. */
function mockHost(routes = {}) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/ide-workbench/api/')[1] ?? ''
    const body = init?.body === undefined ? {} : JSON.parse(init.body)
    calls.push({ method, body })
    const route = routes[method]
    const value = typeof route === 'function' ? await route(body) : (route ?? null)
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  return { calls, restore() { globalThis.fetch = original } }
}

const GIT_STATUS = { isRepo: true, branch: 'main', detached: false, entries: [], ahead: 0, behind: 0 }

function fakeStore() {
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new WorkbenchStore(ctx, key => key)
  store.state = {
    ...store.state,
    workspaceRoot: 'C:\\work\\demo',
    root: 'C:\\work\\demo',
    phase: 'ready',
    settings: { editor: { openMode: 'auto', editableMaxBytes: 1 << 20 }, shortcuts: {} },
  }
  return store
}

function fileTab(overrides = {}) {
  return {
    id: 'file:C:\\work\\demo\\README.md',
    kind: 'file',
    path: 'C:\\work\\demo\\README.md',
    rel: 'README.md',
    name: 'README.md',
    preview: false,
    pinned: true,
    loading: false,
    error: null,
    payload: null,
    content: null,
    stats: null,
    scrollTop: 0,
    editing: true,
    editingUserSet: false,
    view: 'preview',
    draft: null,
    dirty: false,
    saving: false,
    conflict: null,
    ...overrides,
  }
}

test('the store counts the buffer when it reads it', async () => {
  const store = fakeStore()
  const host = mockHost({
    'fs.read': { kind: 'text', content: '你好，hello world', encoding: 'utf-8', size: 30, mtimeMs: 1 },
    'git.status': GIT_STATUS,
  })
  try {
    const id = 'file:C:\\work\\demo\\README.md'
    store.state.tabs = [fileTab()]
    await store.ensureTabContent(id)
    const tab = store.state.tabs.find(item => item.id === id)
    assert.equal(tab.stats.lines, 1)
    assert.equal(tab.stats.words, 4)
  } finally {
    host.restore()
    store.persist.cancel()
  }
})

test('a file that is not text gets no counts, and nothing throws', async () => {
  const store = fakeStore()
  const host = mockHost({
    'fs.read': { kind: 'binary', size: 4096 },
    'git.status': GIT_STATUS,
  })
  try {
    const id = 'file:C:\\work\\demo\\logo.png'
    store.state.tabs = [fileTab({ id, path: 'C:\\work\\demo\\logo.png', name: 'logo.png' })]
    await store.ensureTabContent(id)
    const tab = store.state.tabs.find(item => item.id === id)
    assert.deepEqual(tab.stats, { lines: undefined, words: undefined })
  } finally {
    host.restore()
    store.persist.cancel()
  }
})

test('the store counts the saved text, and the draft of an unsaved file does not', async () => {
  const store = fakeStore()
  const host = mockHost({
    'fs.read': { kind: 'text', content: '你好，hello world', encoding: 'utf-8', size: 30, mtimeMs: 1 },
    'fs.write': { size: 40, mtimeMs: 2, encoding: 'utf-8' },
    'git.status': GIT_STATUS,
  })
  try {
    const id = 'file:C:\\work\\demo\\README.md'
    store.state.tabs = [fileTab()]
    await store.ensureTabContent(id)
    // A keystroke does not move the number: only the saved content counts.
    store.updateDraft(id, '你好，hello world and more words')
    let tab = store.state.tabs.find(item => item.id === id)
    assert.equal(tab.stats.words, 4)
    await store.saveTab(id)
    tab = store.state.tabs.find(item => item.id === id)
    assert.equal(tab.dirty, false)
    assert.equal(tab.stats.words, 7)
  } finally {
    host.restore()
    store.persist.cancel()
  }
})

// ── the status bar ──────────────────────────────────────────────────────────

const ENTRY = `
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkbenchStore } from './src/client/store.js'
import { Workbench } from './src/client/Workbench.jsx'

const t = key => key

export function renderStatusBar(tab) {
  const ctx = {
    locale: { subscribe: () => () => {}, bind: () => t },
    layout: { selectPanel: () => {} },
  }
  const store = new WorkbenchStore(ctx, t)
  store.state = {
    ...store.state,
    phase: 'ready',
    active: true,
    workspaceRoot: 'C:\\\\work\\\\demo',
    root: 'C:\\\\work\\\\demo',
    projects: [{ path: 'C:\\\\work\\\\demo', name: 'demo', isRoot: true, isRepo: true }],
    workspaces: [],
    status: { isRepo: true, branch: 'main', detached: false, entries: [] },
    settings: { shortcuts: { project: 'Alt+1', terminal: 'Alt+F12' }, editor: { fontSize: 13 } },
    layout: { left: null, leftWidth: 300, bottom: null, bottomHeight: 200 },
    tabs: [tab],
    activeId: tab.id,
  }
  return renderToStaticMarkup(React.createElement(Workbench, { store }))
}
`

let modulePromise

async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    // The bundle must live inside the package so Node resolves react and
    // react-dom from this package's node_modules (externalized below).
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'word-count-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: { contents: ENTRY, resolveDir: root, loader: 'jsx', sourcefile: 'word-count-entry.jsx' },
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
    const imported = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
    return imported
  })()
  return modulePromise
}

test('the status bar shows the word count of the active document', async () => {
  const mod = await loadModule()
  const html = mod.renderStatusBar({
    id: 'file:C:\\work\\demo\\README.md',
    kind: 'file',
    path: 'C:\\work\\demo\\README.md',
    rel: 'README.md',
    name: 'README.md',
    preview: false,
    pinned: true,
    loading: false,
    error: null,
    payload: { kind: 'text', content: '你好，hello world', encoding: 'utf-8', size: 30, truncated: false, eol: '\n' },
    stats: { lines: 1, words: 4 },
    scrollTop: 0,
    editing: false,
    view: 'preview',
    draft: null,
    dirty: false,
    saving: false,
  })
  assert.match(html, /iwb-statusbar/)
  // The line count and the word count sit next to each other.
  assert.match(html, /1 editor\.lines/)
  assert.match(html, /4 status\.words/)
})

test('the status bar shows no word count for a file that is not counted', async () => {
  const mod = await loadModule()
  const html = mod.renderStatusBar({
    id: 'file:C:\\work\\demo\\main.ts',
    kind: 'file',
    path: 'C:\\work\\demo\\main.ts',
    rel: 'main.ts',
    name: 'main.ts',
    preview: false,
    pinned: true,
    loading: false,
    error: null,
    payload: { kind: 'text', content: 'const a = 1\n', encoding: 'utf-8', size: 12, truncated: false, eol: '\n' },
    // A source file: the lines are there, the words are not.
    stats: { lines: 2, words: undefined },
    scrollTop: 0,
    editing: false,
    view: 'code',
    draft: null,
    dirty: false,
    saving: false,
  })
  assert.match(html, /2 editor\.lines/)
  assert.doesNotMatch(html, /status\.words/)
})

test('the status bar counts nothing in the render path', async () => {
  const source = await readFile(join(root, 'src/client/Workbench.jsx'), 'utf8')
  // The line count and the word count come from the tab: the bar must not
  // walk the text of the document.
  assert.doesNotMatch(source, /split\('\\n'\)/)
  assert.doesNotMatch(source, /countWords/)
  assert.doesNotMatch(source, /documentStats/)
  // ... and it reads them from the counts of the store.
  assert.match(source, /const stats = active\?\.stats/)
})
