import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkbenchStore } from '../src/client/store.js'

function fakeStore() {
  const ctx = { locale: { subscribe: () => () => {} } }
  const t = (key) => key
  const store = new WorkbenchStore(ctx, t)
  store.state = {
    ...store.state,
    workspaceRoot: 'C:\\work\\demo',
    root: 'C:\\work\\demo',
    phase: 'ready',
    settings: { editor: { openMode: 'auto', editableMaxBytes: 1 << 20 }, shortcuts: {} },
  }
  return store
}

test('stacked layout hides crowded docks on mount and on a width transition', () => {
  const store = fakeStore()
  // A fresh mount in a narrow pane keeps a single default tool...
  store.state.layout = { ...store.state.layout, left: 'project', bottom: null }
  store.setStacked(true, { transition: false })
  assert.equal(store.state.layout.left, 'project')
  // ...but four docks would leave no usable content area.
  store.setStacked(false, { transition: true })
  store.state.layout = { ...store.state.layout, left: 'project', bottom: 'terminal' }
  store.setStacked(true, { transition: false })
  assert.equal(store.state.layout.left, null)
  assert.equal(store.state.layout.bottom, null)
  assert.deepEqual(store.hiddenLayout, { left: 'project', bottom: 'terminal' })
  // A real resize into the stacked width always focuses the content area.
  store.setStacked(false, { transition: true })
  store.state.layout = { ...store.state.layout, left: 'project', bottom: null }
  store.setStacked(true, { transition: true })
  assert.equal(store.state.layout.left, null)
  assert.equal(store.state.layout.bottom, null)
  assert.deepEqual(store.hiddenLayout, { left: 'project', bottom: null })
  // Restoring hidden tools in stacked mode restores one group, never both.
  store.toggleHideAll()
  assert.equal(store.state.layout.left, 'project')
  assert.equal(store.state.layout.bottom, null)
  store.persist.cancel()
})

test('stacked layout makes Project/Commit and Git/Terminal mutually exclusive', () => {
  const store = fakeStore()
  store.setStacked(true)
  store.state.layout = { ...store.state.layout, left: 'project', bottom: null }
  store.showTool('git')
  assert.equal(store.state.layout.bottom, 'git')
  assert.equal(store.state.layout.left, null)
  store.toggleTool('commit')
  assert.equal(store.state.layout.left, 'commit')
  assert.equal(store.state.layout.bottom, null)
  store.toggleTool('terminal')
  assert.equal(store.state.layout.bottom, 'terminal')
  assert.equal(store.state.layout.left, null)
  store.persist.cancel()
})

test('horizontal layout keeps both groups open', () => {
  const store = fakeStore()
  store.state.layout = { ...store.state.layout, left: 'project', bottom: null }
  store.showTool('git')
  assert.equal(store.state.layout.left, 'project')
  assert.equal(store.state.layout.bottom, 'git')
  store.persist.cancel()
})

test('openInSidebar names the built-in text preview for a session address', () => {
  const calls = []
  const ctx = {
    locale: { subscribe: () => () => {} },
    sessions: { list: { getSnapshot: () => ({ byId: { s1: { cwd: 'C:\\work\\demo' } } }) } },
    sidebarRight: {
      mounted: { getSnapshot: () => 's1' },
      openResource: (address, options) => { calls.push({ address, options }) },
    },
    sidebarRightTabs: { candidates: () => [{ kind: 'ide-workbench' }, { kind: 'text' }] },
  }
  const store = new WorkbenchStore(ctx, key => key)
  store.state = {
    ...store.state,
    workspaceRoot: 'C:\\work\\demo', root: 'C:\\work\\demo', phase: 'ready',
  }
  try {
    assert.equal(store.openInSidebar('C:\\work\\demo\\index.html'), true)
    assert.equal(calls[0].address, 'dsh-resource://file/session/s1/index.html')
    assert.equal(calls[0].options.kind, 'text')
    assert.equal(store.state.toast, null)
  } finally {
    store.persist.cancel()
  }
})

test('openInDefaultBrowser sends a file URL to the host', async () => {
  const store = fakeStore()
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    return { ok: true, status: 200, async json() { return { ok: true, value: { opened: true } } } }
  }
  try {
    const opened = await store.openInDefaultBrowser('C:\\work\\demo\\index.html')
    assert.equal(opened, true)
    assert.match(calls[0].url, /shell\.openExternal/)
    assert.equal(calls[0].body.url, 'file:///C:/work/demo/index.html')
  } finally {
    store.persist.cancel()
    globalThis.fetch = original
  }
})

test('the search opens a popup and never takes a tab away', () => {
  const store = fakeStore()
  store.openSearchPopup()
  assert.equal(store.state.tabs.length, 0)
  assert.equal(store.state.searchPopup.open, true)
  assert.equal(store.state.searchPopup.index, 0)
  // The old entry point still opens the popup.
  store.openSearchTab()
  assert.equal(store.state.tabs.length, 0)
  assert.equal(store.state.searchPopup.open, true)
  store.closeSearchPopup()
  assert.equal(store.state.searchPopup.open, false)
})

test('single-click commit selection does not open the drawer', () => {
  const store = fakeStore()
  store.selectCommit('abc1234')
  assert.equal(store.state.git.selectedHash, 'abc1234')
  assert.equal(store.state.git.detail, null)
  assert.equal(store.state.git.detailLoading, false)
  store.closeCommitDetail()
  assert.equal(store.state.git.selectedHash, 'abc1234')
})

test('open mode C: editable up to the byte limit, read-only above it', () => {
  const store = fakeStore()
  assert.equal(store.editorOpenMode(), 'auto')
  assert.equal(store.defaultEditing(1024), true)
  assert.equal(store.defaultEditing(2 << 20), false)
  store.state.settings.editor.openMode = 'readonly'
  assert.equal(store.defaultEditing(10), false)
  store.state.settings.editor.openMode = 'editable'
  assert.equal(store.defaultEditing(2 << 20), true)
})

test('closeTab on a clean tab removes it; dirty tabs open a choice dialog', () => {
  const store = fakeStore()
  store.state.tabs = [
    { id: 'file:a', kind: 'file', path: 'C:\\work\\demo\\a', dirty: false },
    { id: 'file:b', kind: 'file', path: 'C:\\work\\demo\\b', dirty: true, payload: { content: 'x' }, draft: 'y' },
  ]
  store.state.activeId = 'file:a'
  store.closeTab('file:a')
  assert.deepEqual(store.state.tabs.map(tab => tab.id), ['file:b'])
  store.closeTab('file:b')
  assert.equal(store.state.confirm?.actions?.[0]?.key, 'cancel')
  assert.equal(store.state.confirm?.actions?.[2]?.key, 'save')
})

test('openCommitDetail loads git.detail and closeCommitDetail keeps the row selected', async () => {
  const store = fakeStore()
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url: String(url), body })
    return {
      ok: true,
      status: 200,
      async json() { return { ok: true, value: { hash: body.hash, shortHash: 'abc1234', diff: '', files: [] } } },
    }
  }
  try {
    await store.openCommitDetail('abc1234')
    assert.equal(store.state.git.detail?.hash, 'abc1234')
    assert.equal(store.state.git.detailHash, 'abc1234')
    assert.match(calls[0].url, /git\.detail/)
    store.closeCommitDetail()
    assert.equal(store.state.git.detail, null)
    assert.equal(store.state.git.selectedHash, 'abc1234')
  } finally {
    globalThis.fetch = original
  }
})

test('openExternalFile resolves a chat address, reveals the tree and jumps to the line', async () => {
  const store = fakeStore()
  store.state.projects = [{ path: 'C:\\work\\demo', isRoot: true, isRepo: true }]
  store.state.tabs = []
  store.state.activeId = null
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url: String(url), body })
    const value = String(url).includes('fs.tree')
      ? { entries: [], truncated: false }
      : { kind: 'text', content: 'export const a = 1\n', size: 23, encoding: 'utf-8', truncated: false }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  try {
    const result = await store.openExternalFile(
      'dsh-resource://file/session/s1/src/main.ts',
      { line: 4 },
    )
    assert.equal(result.status, 'opened')
    assert.equal(store.state.tabs.length, 1)
    assert.equal(store.state.tabs[0].path, 'C:\\work\\demo\\src\\main.ts')
    assert.equal(store.state.tabs[0].revealLine, 4)
    assert.equal(store.state.activeId, store.state.tabs[0].id)
    assert.equal(store.state.layout.left, 'project')
    assert.equal(store.state.expanded.has('C:\\work\\demo\\src'), true)
    assert.ok(calls.some(call => call.url.includes('fs.read')))
  } finally {
    store.persist.cancel()
    globalThis.fetch = original
  }
})

test('openExternalFile leaves files outside the workspace to the default sidebar', async () => {
  const store = fakeStore()
  store.state.projects = [{ path: 'C:\\work\\demo', isRoot: true, isRepo: true }]
  try {
    const result = await store.openExternalFile('dsh-resource://file/session/s1/../outside/a.ts')
    assert.equal(result.status, 'outside-workspace')
    assert.equal(result.absolute, 'C:\\work\\outside\\a.ts')
    // The fallback is not an error: no toast and no IDE tab.
    assert.equal(store.state.toast, null)
    assert.deepEqual(store.state.tabs, [])
  } finally {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.persist.cancel()
  }
})

test('openExternalFile asks before widening a sub-folder project to the workspace root', async () => {
  const store = fakeStore()
  store.state.root = 'C:\\work\\demo\\src'
  store.state.projects = [
    { path: 'C:\\work\\demo', isRoot: true, isRepo: false },
    { path: 'C:\\work\\demo\\src', isRoot: false, isRepo: true },
  ]
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).includes('fs.stat')) {
      // The relative candidates do not exist (PRD-v4 §7.6.2), so the link
      // still needs the project switch.
      return {
        ok: false,
        status: 404,
        async json() { return { ok: false, error: { code: 'not-found', message: 'file not found' } } },
      }
    }
    const value = String(url).includes('git.status')
      ? { isRepo: false, entries: [], detached: false }
      : String(url).includes('git.log')
        ? { commits: [], hasMore: false }
        : String(url).includes('fs.tree')
          ? { entries: [], truncated: false }
          : String(url).includes('fs.read')
            ? { kind: 'text', content: 'export const a = 1\n', size: 23, encoding: 'utf-8', truncated: false }
            : String(url).includes('settings.update')
              ? { value: {} }
              : { shells: [], names: [], messages: [] }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  try {
    const asked = await store.openExternalFile('dsh-resource://file/session/s1/lib/a.ts')
    assert.equal(asked.status, 'needs-project-switch')
    assert.equal(store.state.root, 'C:\\work\\demo\\src')
    assert.equal(store.state.tabs.length, 0)

    const opened = await store.openExternalFile(
      'dsh-resource://file/session/s1/lib/a.ts',
      { switchProject: true },
    )
    assert.equal(opened.status, 'opened')
    assert.equal(store.state.root, 'C:\\work\\demo')
    assert.equal(store.state.tabs[0].path, 'C:\\work\\demo\\lib\\a.ts')
  } finally {
    store.persist.cancel()
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    globalThis.fetch = original
  }
})

test('openExternalFile reports dirty edits instead of switching the IDE project', async () => {
  const store = fakeStore()
  store.state.root = 'C:\\work\\demo\\src'
  store.state.projects = [
    { path: 'C:\\work\\demo', isRoot: true, isRepo: false },
    { path: 'C:\\work\\demo\\src', isRoot: false, isRepo: true },
  ]
  store.state.tabs = [{
    id: 'file:a', kind: 'file', path: 'C:\\work\\demo\\src\\a.ts', dirty: true, draft: 'x',
  }]
  store.state.activeId = 'file:a'
  try {
    const result = await store.openExternalFile(
      'dsh-resource://file/session/s1/lib/a.ts',
      { switchProject: true },
    )
    assert.equal(result.status, 'dirty')
    assert.equal(store.state.root, 'C:\\work\\demo\\src')
    assert.equal(store.state.tabs.length, 1)
  } finally {
    store.persist.cancel()
  }
})

test('requestCheckout refuses a dirty worktree without calling the host', () => {
  const store = fakeStore()
  store.state.status = { ...store.state.status, isRepo: true, branch: 'main', entries: [{ path: 'a', ignored: false }] }
  store.requestCheckout('feature')
  assert.equal(store.state.confirm, null)
  assert.match(store.state.toast?.text ?? '', /git\.checkoutBlocked/)
})

test('runSearch stores grouped Find in Files results', async () => {
  const store = fakeStore()
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        ok: true,
        value: {
          files: [{ path: 'src/a.ts', matches: [{ line: 3, column: 7, preview: 'const needle = 1' }] }],
          truncated: false,
          tookMs: 8,
        },
      }
    },
  })
  try {
    store.openSearchTab()
    await store.runSearch('needle')
    assert.equal(store.state.search.query, 'needle')
    assert.equal(store.state.search.results.length, 1)
    assert.equal(store.state.search.results[0].path, 'src/a.ts')
    assert.equal(store.state.search.tookMs, 8)
  } finally {
    globalThis.fetch = original
  }
})

test('openSearchResult opens the hit at its line', () => {
  const store = fakeStore()
  let requested
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    requested = JSON.parse(init.body)
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true, value: { kind: 'text', content: 'a\nb\nc\n', encoding: 'utf-8', size: 6, mtimeMs: 1, truncated: false } }
      },
    }
  }
  try {
    store.openSearchResult('src/a.ts', 3)
    const tab = store.state.tabs.find(item => item.id === store.state.activeId)
    assert.equal(tab.kind, 'file')
    assert.equal(tab.path, 'C:\\work\\demo\\src\\a.ts')
    assert.equal(tab.revealLine, 3)
    assert.equal(requested.path, 'C:\\work\\demo\\src\\a.ts')
  } finally {
    globalThis.fetch = original
  }
})

test('stale-file save keeps the draft and offers reload / overwrite', async () => {
  const store = fakeStore()
  store.state.tabs = [{
    id: 'file:a', kind: 'file', path: 'C:\\work\\demo\\a.txt', dirty: true, draft: 'mine',
    payload: { content: 'old', mtimeMs: 1, encoding: 'utf-8', eol: '\n' },
  }]
  store.state.activeId = 'file:a'
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    status: 409,
    async json() { return { ok: false, error: { code: 'stale-file', message: 'changed on disk' } } },
  })
  try {
    await store.saveTab('file:a')
    const tab = store.state.tabs[0]
    assert.equal(tab.dirty, true)
    assert.equal(tab.conflict?.message, 'changed on disk')
    assert.deepEqual(store.state.confirm?.actions?.map(action => action.key), ['cancel', 'reload', 'overwrite'])
  } finally {
    globalThis.fetch = original
  }
})

test('trash failure asks before a permanent delete', async () => {
  const store = fakeStore()
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { ok: true, value: { results: [{ path: 'a.txt', ok: false, code: 'trash-failed', message: 'recycle failed' }] } }
    },
  })
  try {
    await store.deleteEntries(['C:\\work\\demo\\a.txt'])
    assert.deepEqual(store.state.confirm?.actions?.map(action => action.key), ['cancel', 'permanent'])
  } finally {
    globalThis.fetch = original
  }
})

test('Close Others saves dirty tabs before closing them', async () => {
  const store = fakeStore()
  store.state.tabs = [
    { id: 'file:a', kind: 'file', path: 'C:\\work\\demo\\a.txt', dirty: false },
    { id: 'file:b', kind: 'file', path: 'C:\\work\\demo\\b.txt', dirty: true, draft: 'b', payload: { content: 'old', mtimeMs: 1, encoding: 'utf-8', eol: '\n' } },
  ]
  store.state.activeId = 'file:a'
  const writes = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    writes.push(JSON.parse(init.body))
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true, value: { path: 'b.txt', size: 1, mtimeMs: 2, encoding: 'utf-8' } }
      },
    }
  }
  try {
    await store.closeOtherTabs('file:a')
    const fileWrites = writes.filter(body => body.content !== undefined)
    assert.equal(fileWrites.length, 1)
    assert.equal(fileWrites[0].content, 'b')
    assert.deepEqual(store.state.tabs.map(tab => tab.id), ['file:a'])
  } finally {
    globalThis.fetch = original
  }
})

test('a restored tab whose file disappeared is closed instead of staying as an error', async () => {
  const store = fakeStore()
  store.state.tabs = [{ id: 'file:gone', kind: 'file', path: 'C:\\work\\demo\\gone.txt', dirty: false, loading: false, content: null, payload: null }]
  store.state.activeId = 'file:gone'
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    async json() { return { ok: false, error: { code: 'not-found', message: 'file not found' } } },
  })
  try {
    await store.ensureTabContent('file:gone')
    assert.deepEqual(store.state.tabs, [])
  } finally {
    globalThis.fetch = original
  }
})
