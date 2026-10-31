/**
 * The Find in Files popup (PRD-v5 supplement, FIND-01 / FIND-02).
 *
 * The results used to live in a tab of the editor area. The popup floats
 * above the editor instead, so a search never takes a tab away from the code
 * the user was working on.
 *
 * The rendering part of the file mounts the popup without a DOM: the test
 * environment has none, and a static markup can neither run an effect nor
 * prove that a click does what it should. The runner below calls the real
 * handlers of the real elements and runs the real effects.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { WorkbenchStore } from '../src/client/store.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The bundle touches browser globals at import time; the popup flow itself
// never reads the DOM.
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
  createRange: () => ({ setStart() {}, setEnd() {}, getBoundingClientRect: () => ({ top: 0, left: 0 }), getClientRects: () => [] }),
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
  value: { clipboard: { writeText: async () => {}, readText: () => '' } },
})
globalThis.ResizeObserver = class { observe() {} disconnect() {} }

let modulePromise

async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'search-popup-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
export { Workbench } from './src/client/Workbench.jsx'
export { SearchPopup } from './src/client/SearchPopup.jsx'
`,
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'search-popup-entry.jsx',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: ['node20'],
      external: ['react', 'react-dom', 'react-dom/server', '@deepseek-ai/dsh-client-ui-primitives'],
      alias: {
        '@xterm/xterm/css/xterm.css': join(root, 'node_modules/@xterm/xterm/css/xterm.css'),
        '@xterm/xterm': join(root, 'tests/stubs/xterm.js'),
        '@xterm/addon-fit': join(root, 'tests/stubs/addon-fit.js'),
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

const ROOT = 'C:\\work\\demo'

/**
 * One host stub: every plugin route answers with a fixture, and the calls are
 * recorded so the test can see which route was asked.
 */
function hostStub() {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/').pop()
    const body = init?.body === undefined ? {} : JSON.parse(init.body)
    calls.push({ method, body })
    let value = {}
    if (method === 'fs.search') {
      value = {
        files: [
          {
            path: 'src/app.ts',
            matches: [
              { line: 11, column: 3, preview: 'const needle = 1', before: ['// a', 'const b = 2'], after: ['console.log(needle)'] },
              { line: 47, column: 9, preview: 'return needle', before: [], after: [] },
            ],
          },
          {
            path: 'src/other.ts',
            matches: [{ line: 6, column: 1, preview: 'import { needle } from "./app"', before: [], after: [] }],
          },
        ],
        truncated: false,
        tookMs: 12,
      }
    } else if (method === 'lsp.resources') {
      value = { totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3, thresholdBytes: 384 * 1024 * 1024, canIndex: true }
    } else if (method === 'lsp.status') {
      value = { enabled: true, state: 'idle', languageId: '', indexedRoots: [] }
    } else if (method === 'lsp.servers') value = { available: [], missing: [] }
    else if (method === 'workspace.projects') value = { workspace: body.root, projects: [] }
    else if (method === 'git.status') value = { isRepo: false, entries: [], detached: false }
    else if (method === 'git.log') value = { commits: [], hasMore: false }
    else if (method === 'fs.tree') value = { entries: [], truncated: false }
    else value = { shells: [], names: [], messages: [] }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  return {
    calls,
    methods: () => calls.map(call => call.method),
    searches: () => calls.filter(call => call.method === 'fs.search'),
    restore() { globalThis.fetch = original },
  }
}

/** A store with one workspace root. */
function fakeStore() {
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new WorkbenchStore(ctx, key => key)
  store.state = {
    ...store.state,
    workspaceRoot: ROOT,
    root: ROOT,
    phase: 'ready',
    settings: { editor: { openMode: 'auto' }, shortcuts: {}, lsp: { enabled: true, indexOnOpen: 'ask' } },
    projects: [],
  }
  return store
}

/** Let the pending promise chain of the store settle. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

/** Let the debounce of the popup (220 ms) and the store settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 280))

/** Release the timers a test may have armed. */
function cleanup(store) {
  if (store.toastTimer !== null) clearTimeout(store.toastTimer)
  store.persist.cancel()
}

// ── the popup without a DOM ───────────────────────────────────────────────

/**
 * Whether two dependency lists ask for the same effect.
 * @param {unknown[]|undefined} left
 * @param {unknown[]|undefined} right
 * @returns {boolean}
 */
function sameDeps(left, right) {
  if (left === undefined || right === undefined) return false
  if (left.length !== right.length) return false
  return left.every((value, at) => Object.is(value, right[at]))
}

/**
 * Mount a component without a DOM.
 *
 * `renderToStaticMarkup` never runs an effect, so the popup could only be
 * checked as a picture - and a picture cannot prove that a click does what
 * it should. This runner is the smallest thing that runs the real effects:
 * it keeps the state of the hooks, renders again when a state or the store
 * changes, and calls the effects after every render (the cleanup of an
 * effect runs before its next call).
 *
 * The tree of the render is handed back, so a test can hit the very element
 * the user would hit.
 *
 * @param {Function} Component the component to mount
 * @param {object|(() => object)} props the props; a function is called for
 *   every render, so the component always sees the live state
 * @param {object} [store] the store to subscribe to
 * @returns {{tree: object|null, unmount: () => void}}
 */
function mount(Component, props, store) {
  const cells = []
  const effects = []
  let cursor = 0
  let tree = null
  let dirty = false
  let rendering = false
  let pending = false

  // The hooks of React are only a dispatcher away: the component asks the
  // current dispatcher, not React itself.
  const dispatcher = {
    useState(initial) {
      const slot = cursor++
      if (cells[slot] === undefined) cells[slot] = { value: typeof initial === 'function' ? initial() : initial }
      const cell = cells[slot]
      const setValue = (next) => {
        const value = typeof next === 'function' ? next(cell.value) : next
        if (Object.is(value, cell.value)) return
        cell.value = value
        dirty = true
        // A state change renders again, the way React does it.
        schedule()
      }
      return [cell.value, setValue]
    },
    useRef(initial) {
      const slot = cursor++
      if (cells[slot] === undefined) cells[slot] = { current: initial }
      return cells[slot]
    },
    useMemo(factory, deps) {
      const slot = cursor++
      const cell = cells[slot]
      if (cell === undefined || !sameDeps(cell.deps, deps)) cells[slot] = { deps, value: factory() }
      return cells[slot].value
    },
    useEffect(fn, deps) {
      const slot = cursor++
      const cell = cells[slot]
      const changed = cell === undefined || !sameDeps(cell.deps, deps)
      cells[slot] = { deps, fn, changed, cleanup: cell?.cleanup }
      effects.push(cells[slot])
    },
  }

  const renderOnce = () => {
    cursor = 0
    effects.length = 0
    const internals = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
    const previous = internals.ReactCurrentDispatcher.current
    internals.ReactCurrentDispatcher.current = dispatcher
    try {
      tree = Component(typeof props === 'function' ? props() : props)
    } finally {
      internals.ReactCurrentDispatcher.current = previous
    }
    for (const cell of effects) {
      if (cell.changed !== true) continue
      if (typeof cell.cleanup === 'function') cell.cleanup()
      const cleanup = cell.fn()
      cell.cleanup = typeof cleanup === 'function' ? cleanup : undefined
    }
  }

  const run = () => {
    if (rendering === true) { pending = true; return }
    rendering = true
    try {
      for (let round = 0; round < 20; round += 1) {
        dirty = false
        renderOnce()
        // The store changed while the effects ran: render again.
        if (pending === true) { pending = false; continue }
        if (dirty !== true) break
      }
    } finally {
      rendering = false
    }
  }

  // A render that is asked for while another one runs waits for it.
  const schedule = () => {
    if (rendering === true) { pending = true; return }
    run()
  }

  run()
  const unsubscribe = typeof store?.subscribe === 'function'
    ? store.subscribe(() => { schedule() })
    : () => {}
  return {
    get tree() { return tree },
    unmount() {
      unsubscribe()
      for (const cell of cells) {
        if (typeof cell?.cleanup === 'function') cell.cleanup()
      }
    },
  }
}

/**
 * Mount the Find in Files popup of a store.
 * @param {object} mod the bundled workbench
 * @param {object} store the workbench store
 * @returns {object} the mounted popup
 */
function mountPopup(mod, store) {
  return mount(mod.SearchPopup, () => ({ store, state: store.state }), store)
}

/**
 * Every element of a tree.
 * @param {object} tree the root of the tree
 * @returns {object[]} the elements
 */
function elementsOf(tree) {
  const found = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (node.props === undefined) return
    found.push(node)
    walk(node.props.children)
  }
  walk(tree)
  return found
}

/**
 * The elements whose class name carries the name.
 * @param {object} tree the root of the tree
 * @param {string} className the class to look for
 * @returns {object[]} the elements
 */
function byClass(tree, className) {
  return elementsOf(tree).filter(element => {
    const name = element.props?.className
    return typeof name === 'string' && name.split(' ').includes(className)
  })
}

/**
 * The path from an element up to the root - the way an event travels.
 * @param {object} tree the root of the tree
 * @param {object} target the element the user hit
 * @returns {object[]} the elements, from the target up to the root
 */
function pathOf(tree, target) {
  let found = null
  const walk = (node, parents) => {
    if (found !== null) return
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child, parents)
      return
    }
    if (node.props === undefined) return
    const chain = [...parents, node]
    if (node === target) { found = chain; return }
    walk(node.props.children, chain)
  }
  walk(tree, [])
  return found ?? []
}

/**
 * Dispatch an event the way the browser does: the handler of the element
 * first, then the handlers of its parents - until one of them stops the
 * propagation.
 * @param {object} tree the root of the tree
 * @param {object} target the element the user hit
 * @param {object} event the event
 * @param {string} name the name of the handler ('onClick', 'onKeyDown', ...)
 */
function dispatch(tree, target, event, name) {
  for (const element of pathOf(tree, target)) {
    const handler = element.props?.[name]
    if (typeof handler !== 'function') continue
    event.target = target
    event.currentTarget = element
    handler(event)
    if (event.propagationStopped === true) break
  }
}

/**
 * A key event: the popup reads the key and stops the event.
 * @param {string} key the key
 * @param {object} [extra] more properties of the event
 * @returns {object} the event
 */
function keyEvent(key, extra = {}) {
  return {
    key,
    shiftKey: false,
    propagationStopped: false,
    preventDefault() {},
    stopPropagation() { this.propagationStopped = true },
    ...extra,
  }
}

/**
 * A mouse event: the popup reads the target of the event.
 * @param {object} target the element the user hit
 * @param {object} [currentTarget] the element the handler belongs to
 * @returns {object} the event
 */
function mouseEvent(target, currentTarget = target) {
  return {
    target,
    currentTarget,
    propagationStopped: false,
    preventDefault() {},
    stopPropagation() { this.propagationStopped = true },
  }
}

/**
 * Record every hit of the popup on a file.
 *
 * The store hands the jump to `openFile` as a line and a column; the popup
 * has to pass both on (PRD-v5 §6.2, review R15).
 * @param {object} store the workbench store
 * @returns {{calls: object[], restore: () => void}} the recorded calls
 */
function recordOpenings(store) {
  const calls = []
  const original = store.openSearchResult
  store.openSearchResult = (rel, line, column) => {
    calls.push({ rel, line, column })
    return original.call(store, rel, line, column)
  }
  return { calls, restore() { store.openSearchResult = original } }
}

// ── the store flow ─────────────────────────────────────────────────────────

test('the search opens a popup and never takes a tab away', async () => {
  const host = hostStub()
  const store = fakeStore()
  try {
    store.openSearchPopup('needle')
    await flush()
    assert.equal(store.state.searchPopup.open, true)
    assert.equal(store.state.tabs.length, 0, 'a search must not open a tab')
    assert.equal(store.state.activeId, null)
    // The host was asked for the query.
    const search = host.calls.find(call => call.method === 'fs.search')
    assert.ok(search !== undefined)
    assert.equal(search.body.query, 'needle')
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('the hits of the popup are one flat list over the files', async () => {
  const host = hostStub()
  const store = fakeStore()
  try {
    store.openSearchPopup('needle')
    await flush()
    const hits = store.searchHits()
    assert.equal(hits.length, 3)
    assert.equal(hits[0].path, 'src/app.ts')
    assert.equal(hits[0].line, 11)
    assert.equal(hits[2].path, 'src/other.ts')
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('the popup selects a file, not a hit', async () => {
  const host = hostStub()
  const store = fakeStore()
  try {
    store.openSearchPopup('needle')
    await flush()
    // The upper half is a list of files: the selection walks the files.
    assert.equal(store.state.searchPopup.index, 0)
    assert.equal(store.selectedSearchFile().path, 'src/app.ts')
    store.moveSearchSelection(1)
    assert.equal(store.state.searchPopup.index, 1)
    assert.equal(store.selectedSearchFile().path, 'src/other.ts')
    // The selection wraps around.
    store.moveSearchSelection(1)
    assert.equal(store.state.searchPopup.index, 0)
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('opening a hit closes the popup and opens the file', async () => {
  const host = hostStub()
  const store = fakeStore()
  try {
    store.openSearchPopup('needle')
    await flush()
    // The store takes the column of the hit as a third argument and hands
    // it to `openFile` as `column` (PRD-v5 §6.2).
    store.openSearchResult('src/app.ts', 47, 9)
    assert.equal(store.state.searchPopup.open, false)
    const tab = store.state.tabs.find(item => item.rel === 'src/app.ts')
    assert.ok(tab !== undefined, 'the file was opened')
    assert.equal(tab.revealLine, 47, 'the cursor lands on the hit')
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('the popup can be closed without opening anything', async () => {
  const host = hostStub()
  const store = fakeStore()
  try {
    store.openSearchPopup('needle')
    await flush()
    store.closeSearchPopup()
    assert.equal(store.state.searchPopup.open, false)
    assert.equal(store.state.tabs.length, 0)
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('the text version of Find Usages uses the same popup', async () => {
  const host = hostStub()
  const store = fakeStore()
  try {
    await store.findUsagesText('needle')
    assert.equal(store.state.searchPopup.open, true)
    assert.equal(store.state.tabs.length, 0)
    assert.equal(store.state.search.textMatch, true)
  } finally {
    cleanup(store)
    host.restore()
  }
})

// ── the rendered popup ─────────────────────────────────────────────────────

test('the upper half lists the files, the lower half previews the selected one', async () => {
  const mod = await loadModule()
  const host = hostStub()
  const store = fakeStore()
  try {
    store.openSearchPopup('needle')
    await flush()
    const html = renderToStaticMarkup(React.createElement(mod.Workbench, { store }))
    assert.match(html, /iwb-search-popup/)
    // One row per file, with its match count.
    assert.match(html, /iwb-search-popup-file/)
    assert.match(html, /app\.ts/)
    assert.match(html, /other\.ts/)
    // The preview of the selected file shows the lines around the hit.
    assert.match(html, /iwb-search-popup-preview/)
    assert.match(html, /const b = 2/)
    assert.match(html, /const needle = 1/)
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('the file list does not repeat the hits under every file', async () => {
  const mod = await loadModule()
  const host = hostStub()
  const store = fakeStore()
  try {
    store.openSearchPopup('needle')
    await flush()
    const html = renderToStaticMarkup(React.createElement(mod.Workbench, { store }))
    const list = html.slice(html.indexOf('iwb-search-popup-list'), html.indexOf('iwb-search-popup-preview'))
    // The upper half carries the file names, not the matched lines.
    assert.match(list, /app\.ts/)
    assert.doesNotMatch(list, /const needle = 1/)
    assert.doesNotMatch(list, /import \{ needle \}/)
  } finally {
    cleanup(store)
    host.restore()
  }
})

test('the popup floats above the modals', async () => {
  const source = await readFile(join(root, 'src/client/styles.js'), 'utf8')
  const quick = /\.iwb-quick-backdrop\s*\{[^}]*z-index:\s*(\d+)/.exec(source)
  const modal = /\.iwb-modal-backdrop\s*\{[^}]*z-index:\s*(\d+)/.exec(source)
  assert.ok(quick !== null, 'the Quick Open backdrop has a z-index')
  assert.ok(modal !== null, 'the modal backdrop has a z-index')
  assert.ok(
    Number(quick[1]) > Number(modal[1]),
    'the search popup has to be above every modal',
  )
})

// ── the three ways out (spec §10.1) ───────────────────────────────────────

test('Esc closes the popup', async () => {
  const mod = await loadModule()
  const host = hostStub()
  const store = fakeStore()
  let mounted = { unmount() {} }
  try {
    store.openSearchPopup('needle')
    await flush()
    mounted = mountPopup(mod, store)
    // The keys belong to the container: the file rows are buttons, so a
    // click on one takes the focus away from the input (review R13).
    const backdrop = byClass(mounted.tree, 'iwb-search-popup-backdrop')[0]
    assert.equal(typeof backdrop.props.onKeyDown, 'function', 'the container takes the keys')
    dispatch(mounted.tree, backdrop, keyEvent('Escape'), 'onKeyDown')
    assert.equal(store.state.searchPopup.open, false, 'Esc closed the popup')
  } finally {
    mounted.unmount()
    cleanup(store)
    host.restore()
  }
})

test('the backdrop closes the popup', async () => {
  const mod = await loadModule()
  const host = hostStub()
  const store = fakeStore()
  let mounted = { unmount() {} }
  try {
    store.openSearchPopup('needle')
    await flush()
    mounted = mountPopup(mod, store)
    const backdrop = byClass(mounted.tree, 'iwb-search-popup-backdrop')[0]
    dispatch(mounted.tree, backdrop, mouseEvent(backdrop), 'onMouseDown')
    assert.equal(store.state.searchPopup.open, false, 'the backdrop closed the popup')
    assert.equal(store.state.tabs.length, 0, 'and opened nothing')
  } finally {
    mounted.unmount()
    cleanup(store)
    host.restore()
  }
})

test('the ✕ closes the popup', async () => {
  const mod = await loadModule()
  const host = hostStub()
  const store = fakeStore()
  let mounted = { unmount() {} }
  try {
    store.openSearchPopup('needle')
    await flush()
    mounted = mountPopup(mod, store)
    const close = byClass(mounted.tree, 'iwb-iconbtn')[0]
    assert.ok(close !== undefined, 'the popup has a close button')
    dispatch(mounted.tree, close, mouseEvent(close), 'onClick')
    assert.equal(store.state.searchPopup.open, false, 'the ✕ closed the popup')
    assert.equal(store.state.tabs.length, 0, 'and opened nothing')
  } finally {
    mounted.unmount()
    cleanup(store)
    host.restore()
  }
})

// ── the click on a file row (review R13 / R15) ────────────────────────────

test('a single click on a file row only selects it', async () => {
  const mod = await loadModule()
  const host = hostStub()
  const store = fakeStore()
  let mounted = { unmount() {} }
  try {
    store.openSearchPopup('needle')
    await flush()
    mounted = mountPopup(mod, store)
    const rows = byClass(mounted.tree, 'iwb-search-popup-file')
    assert.equal(rows.length, 2, 'one row per file that matched')
    dispatch(mounted.tree, rows[1], mouseEvent(rows[1]), 'onClick')
    assert.equal(store.state.searchPopup.open, true, 'the popup stays open')
    assert.equal(store.state.searchPopup.index, 1, 'the selection moved to the file')
    assert.equal(store.state.tabs.length, 0, 'a single click opens no file')
  } finally {
    mounted.unmount()
    cleanup(store)
    host.restore()
  }
})

test('a double click on a file row opens the file at the hit', async () => {
  const mod = await loadModule()
  const host = hostStub()
  const store = fakeStore()
  let mounted = { unmount() {} }
  const openings = recordOpenings(store)
  try {
    store.openSearchPopup('needle')
    await flush()
    mounted = mountPopup(mod, store)
    const rows = byClass(mounted.tree, 'iwb-search-popup-file')
    dispatch(mounted.tree, rows[1], mouseEvent(rows[1]), 'onDoubleClick')
    // The jump carries the line and the column of the hit (PRD-v5 §6.2).
    assert.deepEqual(openings.calls, [{ rel: 'src/other.ts', line: 6, column: 1 }])
    assert.equal(store.state.searchPopup.open, false, 'the popup closed')
    const tab = store.state.tabs.find(item => item.rel === 'src/other.ts')
    assert.ok(tab !== undefined, 'the file was opened')
    assert.equal(tab.revealLine, 6, 'the cursor lands on the line of the hit')
  } finally {
    mounted.unmount()
    openings.restore()
    cleanup(store)
    host.restore()
  }
})

test('the backdrop does not close the popup when the click was on a row', async () => {
  const mod = await loadModule()
  const host = hostStub()
  const store = fakeStore()
  let mounted = { unmount() {} }
  try {
    store.openSearchPopup('needle')
    await flush()
    mounted = mountPopup(mod, store)
    const rows = byClass(mounted.tree, 'iwb-search-popup-file')
    const backdrop = byClass(mounted.tree, 'iwb-search-popup-backdrop')[0]
    // The press on the row bubbles to the backdrop; only a press on the
    // backdrop itself closes the popup.
    dispatch(mounted.tree, rows[0], mouseEvent(rows[0], backdrop), 'onMouseDown')
    assert.equal(store.state.searchPopup.open, true, 'the popup stays open')
    assert.equal(store.state.tabs.length, 0, 'and opened nothing')
  } finally {
    mounted.unmount()
    cleanup(store)
    host.restore()
  }
})

// ── the keyboard of the popup (review R13) ────────────────────────────────

test('the keyboard still works after a click on a file row', async () => {
  const mod = await loadModule()
  const host = hostStub()
  const store = fakeStore()
  let mounted = { unmount() {} }
  try {
    store.openSearchPopup('needle')
    await flush()
    mounted = mountPopup(mod, store)
    // The click takes the focus away from the input: the row is a button.
    const rows = byClass(mounted.tree, 'iwb-search-popup-file')
    dispatch(mounted.tree, rows[1], mouseEvent(rows[1]), 'onClick')
    assert.equal(store.state.searchPopup.index, 1, 'the selection moved')
    // The key travels from the row up to the container of the popup.
    const after = byClass(mounted.tree, 'iwb-search-popup-file')
    dispatch(mounted.tree, after[1], keyEvent('Escape'), 'onKeyDown')
    assert.equal(store.state.searchPopup.open, false, 'Esc closed the popup')
  } finally {
    mounted.unmount()
    cleanup(store)
    host.restore()
  }
})

test('the arrows move the selection by one, in the input and on a row', async () => {
  const mod = await loadModule()
  const host = hostStub()
  const store = fakeStore()
  let mounted = { unmount() {} }
  try {
    store.openSearchPopup('needle')
    await flush()
    mounted = mountPopup(mod, store)
    const input = byClass(mounted.tree, 'iwb-quick-input')[0]
    dispatch(mounted.tree, input, keyEvent('ArrowDown'), 'onKeyDown')
    assert.equal(store.state.searchPopup.index, 1, 'the input moved the selection by one')
    // The key must not be handled twice: the container sits above the input.
    const rows = byClass(mounted.tree, 'iwb-search-popup-file')
    dispatch(mounted.tree, rows[1], keyEvent('ArrowDown'), 'onKeyDown')
    assert.equal(store.state.searchPopup.index, 0, 'the row moved the selection by one')
  } finally {
    mounted.unmount()
    cleanup(store)
    host.restore()
  }
})

test('Enter opens the first hit of the selected file', async () => {
  const mod = await loadModule()
  const host = hostStub()
  const store = fakeStore()
  let mounted = { unmount() {} }
  const openings = recordOpenings(store)
  try {
    store.openSearchPopup('needle')
    await flush()
    mounted = mountPopup(mod, store)
    const input = byClass(mounted.tree, 'iwb-quick-input')[0]
    dispatch(mounted.tree, input, keyEvent('Enter'), 'onKeyDown')
    assert.deepEqual(openings.calls, [{ rel: 'src/app.ts', line: 11, column: 3 }])
    assert.equal(store.state.searchPopup.open, false, 'the popup closed')
  } finally {
    mounted.unmount()
    openings.restore()
    cleanup(store)
    host.restore()
  }
})

// ── the two entries (review R14) ──────────────────────────────────────────

test('the text version of Find Usages shows the identifier and the whole-word flag', async () => {
  const mod = await loadModule()
  const host = hostStub()
  const store = fakeStore()
  let mounted = { unmount() {} }
  try {
    await store.findUsagesText('render')
    mounted = mountPopup(mod, store)
    const input = byClass(mounted.tree, 'iwb-quick-input')[0]
    assert.equal(input.props.value, 'render', 'the box holds the identifier')
    const flags = byClass(mounted.tree, 'iwb-find-flag')
    assert.equal(flags.length, 3, 'the popup has the three flags')
    assert.match(flags[1].props.className, /iwb-on/, 'the whole-word flag is on')
  } finally {
    mounted.unmount()
    cleanup(store)
    host.restore()
  }
})

test('a plain Find in Files inherits neither the query nor the flags', async () => {
  const mod = await loadModule()
  const host = hostStub()
  const store = fakeStore()
  let mounted = { unmount() {} }
  try {
    // The text version of Find Usages leaves the identifier and the
    // whole-word flag in the shared slice.
    await store.findUsagesText('spawn')
    assert.equal(store.state.search.query, 'spawn')
    assert.equal(store.state.search.wholeWord, true)
    const before = host.searches().length

    // A plain Find in Files run resets the query and the flags - that half
    // of the fix belongs to the store, so the contract is emulated here.
    const original = store.openSearchPopup.bind(store)
    store.openSearchPopup = (query = '') => {
      original(query)
      if (query === '') {
        store.patch('search', { query: '', wholeWord: false, caseSensitive: false, regexp: false })
      }
    }
    store.openSearchPopup()

    mounted = mountPopup(mod, store)
    await settle()
    // The box is empty and every flag is off.
    const input = byClass(mounted.tree, 'iwb-quick-input')[0]
    assert.equal(input.props.value, '', 'the box is empty')
    for (const flag of byClass(mounted.tree, 'iwb-find-flag')) {
      assert.doesNotMatch(flag.props.className, /iwb-on/, 'no flag is on')
    }
    // And the popup did not fire a full-project search with the inherited
    // query.
    assert.equal(host.searches().length, before, 'the plain run searched nothing')
  } finally {
    mounted.unmount()
    cleanup(store)
    host.restore()
  }
})

test('the popup searches what is in the box, with the flags of the box', async () => {
  const mod = await loadModule()
  const host = hostStub()
  const store = fakeStore()
  let mounted = { unmount() {} }
  try {
    store.openSearchPopup('needle')
    await flush()
    mounted = mountPopup(mod, store)
    const input = byClass(mounted.tree, 'iwb-quick-input')[0]
    // The user types: the box is the truth.
    input.props.onChange({ target: { value: 'spawn' } })
    // The whole-word flag is on.
    const flags = byClass(mounted.tree, 'iwb-find-flag')
    flags[1].props.onClick()
    await settle()
    const searches = host.searches()
    const last = searches[searches.length - 1]
    assert.equal(last.body.query, 'spawn', 'the host was asked for the box')
    assert.equal(last.body.wholeWord, true, 'the host was asked with the flag')
  } finally {
    mounted.unmount()
    cleanup(store)
    host.restore()
  }
})
