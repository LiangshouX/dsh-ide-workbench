import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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
  value: { clipboard: { writeText: async () => {}, readText: async () => '' } },
})
globalThis.ResizeObserver = class { observe() {} disconnect() {} }

let modulePromise

async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    // The bundle must live inside the package so Node resolves react and
    // react-dom from this package's node_modules (externalized below).
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'entry.mjs')
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

test('workbench renders the project window and welcome screen', async () => {
  const mod = await loadModule()
  const html = mod.renderProject()
  assert.match(html, /iwb-root/)
  assert.match(html, /iwb-stripe/)
  assert.match(html, /project\.title/)
  assert.match(html, /welcome\.title/)
  assert.match(html, /a\.ts/)
  assert.match(html, /src/)
})

test('fullscreen IDE pane offers restore with pressed state', async () => {
  const mod = await loadModule()
  const html = mod.renderFullscreen()
  assert.match(html, /layout\.exitFullscreen/)
  assert.match(html, /aria-pressed="true"/)
  assert.doesNotMatch(html, /title="layout\.fullscreen"/)
})

test('commit and git windows render their rows and graph', async () => {
  const mod = await loadModule()
  const html = mod.renderCommitAndGit()
  assert.match(html, /iwb-file-row/)
  assert.match(html, /a\.ts/)
  assert.match(html, /iwb-git-row/)
  assert.match(html, /first/)
  assert.match(html, /<svg/)
  assert.match(html, /commit\.title/)
})

test('a preview tab renders italic and a code surface', async () => {
  const mod = await loadModule()
  const html = mod.renderCode()
  assert.match(html, /iwb-preview/)
  assert.match(html, /iwb-codemirror/)
  assert.match(html, /iwb-opened/)
})

test('diff view renders selected-file rows', async () => {
  const mod = await loadModule()
  const html = mod.renderDiff()
  assert.match(html, /iwb-diff-side/)
  assert.match(html, /iwb-diff-hunk/)
  assert.match(html, /iwb-diff-toolbar/)
})

test('diff component renders unified mode with hunk actions', async () => {
  const mod = await loadModule()
  const html = mod.renderDiffComponent()
  assert.match(html, /iwb-diff-hunk/)
  assert.match(html, /commit\.stageAll/)
})

test('Git drawer renders the commit metadata and file list', async () => {
  const mod = await loadModule()
  const html = mod.renderGitDrawer()
  assert.match(html, /iwb-git-drawer/)
  assert.match(html, /iwb-git-drawer-files/)
  assert.match(html, /a\.ts/)
  assert.match(html, /git\.fileList/)
  // A normal dock keeps the log columns and the side Drawer.
  assert.match(html, /iwb-author/)
  assert.match(html, /iwb-date/)
  assert.doesNotMatch(html, /iwb-git-narrow/)
})

test('Find in Files renders grouped results', async () => {
  const mod = await loadModule()
  const html = mod.renderSearchTab()
  assert.match(html, /iwb-search/)
  assert.match(html, /iwb-search-hit/)
  assert.match(html, /search\.title/)
})

test('Find in Files renders the match-case / whole-word / regexp toggles', async () => {
  const mod = await loadModule()
  const html = mod.renderSearchTab()
  assert.match(html, /title="search\.caseSensitive"/)
  assert.match(html, /title="search\.wholeWord"/)
  assert.match(html, /title="search\.regexp"/)
  assert.match(html, />Aa<\/button>/)
  assert.match(html, />W<\/button>/)
  assert.match(html, />\.\*<\/button>/)
  assert.match(html, /aria-pressed="false"/)
})

test('markdown preview renders the DOM find bar over the document', async () => {
  const mod = await loadModule()
  const html = mod.renderMarkdownFind()
  assert.match(html, /iwb-dom-findbar/)
  assert.match(html, /iwb-find-input/)
  assert.match(html, /editor\.find/)
  assert.match(html, /Sample Doc/)
})

test('Quick Open renders matching paths', async () => {
  const mod = await loadModule()
  const html = mod.renderQuickOpen()
  assert.match(html, /iwb-quick/)
  assert.match(html, /main\.ts/)
  assert.match(html, /src/)
})

test('Project file filter renders a flat quick-locate row', async () => {
  const mod = await loadModule()
  const html = mod.renderProjectQuickFilter()
  assert.match(html, /iwb-tree-relative/)
  assert.match(html, /src\/main\.ts/)
})

test('project picker lists the workspace root and first-level folders', async () => {
  const mod = await loadModule()
  const html = mod.renderProjectPicker()
  assert.match(html, /iwb-project-picker/)
  assert.match(html, /iwb-project-choice/)
  assert.match(html, /repo-a/)
  assert.match(html, /project\.gitRepo/)
  assert.match(html, /project\.current/)
})

test('Git window points a non-repository folder at the project picker', async () => {
  const mod = await loadModule()
  const html = mod.renderGitNoRepo()
  assert.match(html, /project\.noRepoHint/)
  assert.match(html, /project\.chooseRepo/)
  assert.doesNotMatch(html, /fatal: not a git repository/)
})

test('markdown preview renders the fallback document and outline', async () => {
  const mod = await loadModule()
  const html = mod.renderMarkdown()
  assert.match(html, /iwb-markdown/)
  assert.match(html, /Sample Doc/)
  assert.match(html, /iwb-outline/)
  assert.match(html, /iwb-outline-item/)
  assert.match(html, /editor\.preview/)
  assert.match(html, /editor\.source/)
  assert.match(html, /editor\.edit/)
})

test('edit mode renders save/restore and the dirty marker', async () => {
  const mod = await loadModule()
  const html = mod.renderMarkdownEdit()
  assert.match(html, /iwb-codemirror/)
  assert.match(html, /iwb-tab-dirty/)
  assert.match(html, /editor\.save/)
  assert.match(html, /editor\.restore/)
  assert.match(html, /editor\.dirty/)
})

test('settings render grouped rows with a shared control column', async () => {
  const mod = await loadModule()
  const html = mod.renderSettings()
  assert.match(html, /iwb-settings-group-title/)
  assert.match(html, /iwb-settings-group-desc/)
  assert.match(html, /iwb-settings-control/)
  assert.match(html, /settings\.shortcutsGroupHint/)
  assert.match(html, /iwb-settings-shortcut/)
  // The external-IDE explanation is a group description, not repeated per row.
  assert.equal((html.match(/settings\.idePathHint/g) ?? []).length, 1)
})

test('HTML editor offers sidebar preview and default-browser actions', async () => {
  const html = (await loadModule()).renderHtmlEditor()
  assert.match(html, /iwb-html-actions/)
  assert.match(html, /editor\.htmlPreviewSidebar/)
  assert.match(html, /editor\.htmlPreviewBrowser/)
  assert.match(html, /iwb-chrome/)
})

test('client opens a native sidebar tab without registering a central page', async () => {
  const mod = await loadModule()
  const entries = []
  const types = []
  const disposers = []
  const opened = []
  let expanded = false
  let activeTab
  let collapsed = 0
  let subscriptions = 0
  const ctx = {
    locale: {
      bind: () => key => key,
      register: () => () => {},
      subscribe: () => { subscriptions++; return () => { subscriptions-- } },
    },
    sidebarRight: {
      openTab: kind => { opened.push(kind); expanded = true; activeTab = { kind } },
      mounted: { getSnapshot: () => 'session-1' },
      active: () => activeTab,
      isExpanded: () => expanded,
      toggleExpanded: () => { expanded = !expanded; collapsed++ },
    },
    sidebarRightTabs: { register: type => {
      types.push(type)
      return () => types.splice(types.indexOf(type), 1)
    } },
    sessions: {
      list: {
        getSnapshot: () => ({
          byId: {
            'session-1': { cwd: 'C:\\work\\demo' },
            'session-2': { cwd: 'C:\\work\\other' },
          },
        }),
      },
    },
    slots: {
      inject: (_name, register) => register(),
      register: (options, component) => {
        const entry = { ...options, component }
        entries.push(entry)
        return () => entries.splice(entries.indexOf(entry), 1)
      },
    },
    effect: callback => { disposers.push(callback()) },
    get: () => undefined,
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('offline fixture') }
  try {
    mod.applyClient(ctx)
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(mod.clientInject.includes('sidebarRightTabs'))
    assert.equal(types[0].kind, 'ide-workbench')
    assert.equal(types[0].guide[0].title(), 'panelLabel')
    assert.deepEqual(types[0].patterns, [
      'dsh-resource://file/session/**',
      'dsh-resource://file/absolute/**',
    ])
    assert.equal(types[0].priority, 'extension')
    assert.equal(types[0].canOpen('dsh-resource://file/session/session-1/src/a.ts'), true)
    // Inside the workspace but outside the selected project still claims: the
    // bridge then asks whether to widen the IDE project to the workspace root.
    assert.equal(types[0].canOpen('dsh-resource://file/session/session-1/lib/a.ts'), true)
    assert.equal(types[0].canOpen('dsh-resource://file/session/session-1/report.pdf'), false)
    // A link outside the DSH workspace falls through to DSH's own sidebar.
    assert.equal(types[0].canOpen('dsh-resource://file/session/session-1/C:/outside/a.ts'), false)
    assert.equal(types[0].canOpen('dsh-resource://file/absolute/D:/outside/a.ts'), false)
    // A link owned by another Session's workspace is not claimed either.
    assert.equal(types[0].canOpen('dsh-resource://file/session/session-2/src/a.ts'), false)
    assert.equal(types[0].title('dsh-resource://file/session/session-1/src/a.ts'), 'a.ts')
    assert.equal(types[0].title('sidebar://ide-workbench'), 'panelLabel')
    assert.ok(entries.some(entry => entry.name === 'sidebar.right.pane.tab'))
    assert.ok(entries.some(entry => entry.name === 'conversation.hero.options'))
    assert.ok(entries.some(entry => entry.name === 'sidebar.footer.action'))
    assert.ok(!entries.some(entry => entry.name === 'main' || entry.name === 'sidebar.panellist'))
    const header = entries.find(entry => entry.name === 'conversation.session.header.utilities')
    const fragment = header.component()
    const buttonComponent = fragment.props.children[1]
    const click = buttonComponent.type(buttonComponent.props).props.onClick
    click()
    assert.deepEqual(opened, ['ide-workbench'])
    assert.equal(expanded, true)
    click()
    assert.equal(expanded, false)
    assert.equal(collapsed, 1)
    assert.equal(opened.length, 1)
    click()
    assert.equal(expanded, true)
    assert.equal(opened.length, 2)
    activeTab = { kind: 'files' }
    click()
    assert.equal(expanded, true)
    assert.equal(activeTab.kind, 'ide-workbench')
    assert.equal(collapsed, 1)
    assert.equal(opened.length, 3)
  } finally {
    for (const dispose of disposers.reverse()) dispose?.()
    globalThis.fetch = originalFetch
  }
  assert.equal(types.length, 0)
  assert.equal(entries.length, 0)
  assert.equal(subscriptions, 0)
})
