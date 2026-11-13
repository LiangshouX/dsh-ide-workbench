import test from 'node:test'
import assert from 'node:assert/strict'
import {
  carrierTabAlive, closeCarrierTab, defaultSidebarKind, openInDefaultSidebar, replaceCarrierTab,
} from '../src/client/file-link.js'

const ADDRESS = 'dsh-resource://file/session/s1/src/a.ts'

test('defaultSidebarKind skips the IDE and names the next ranked type', () => {
  const ctx = {
    sidebarRightTabs: { candidates: () => [{ kind: 'ide-workbench' }, { kind: 'editor' }, { kind: 'text' }] },
  }
  assert.equal(defaultSidebarKind(ctx, ADDRESS, 'ide-workbench'), 'editor')
  const onlySelf = { sidebarRightTabs: { candidates: () => [{ kind: 'ide-workbench' }] } }
  assert.equal(defaultSidebarKind(onlySelf, ADDRESS, 'ide-workbench'), undefined)
})

test('openInDefaultSidebar opens the default kind and carries the line and carrier tab', () => {
  const calls = []
  const ctx = {
    sidebarRightTabs: { candidates: () => [{ kind: 'ide-workbench' }, { kind: 'editor' }] },
    sidebarRight: { openResource: (address, options) => { calls.push({ address, options }) } },
  }
  const opened = openInDefaultSidebar(ctx, ADDRESS, {
    ownKind: 'ide-workbench', line: 24, replaceTab: 'tab-1',
  })
  assert.equal(opened, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].address, ADDRESS)
  assert.equal(calls[0].options.kind, 'editor')
  assert.deepEqual(calls[0].options.params, { line: 24 })
  assert.equal(calls[0].options.replaceTab, 'tab-1')
  assert.equal(calls[0].options.revealIfOpened, true)
})

test('openInDefaultSidebar honors an explicit viewer kind before the ranking', () => {
  const calls = []
  const ctx = {
    sidebarRightTabs: { candidates: () => [{ kind: 'ide-workbench' }, { kind: 'editor' }] },
    sidebarRight: { openResource: (address, options) => { calls.push({ address, options }) } },
  }
  const opened = openInDefaultSidebar(ctx, ADDRESS, { ownKind: 'ide-workbench', kind: 'text' })
  assert.equal(opened, true)
  assert.equal(calls[0].options.kind, 'text')
})

test('openInDefaultSidebar falls back to the ranked kind when the named viewer refuses', () => {
  const calls = []
  const ctx = {
    sidebarRightTabs: { candidates: () => [{ kind: 'ide-workbench' }, { kind: 'editor' }] },
    sidebarRight: {
      openResource: (address, options) => {
        calls.push(options.kind)
        if (options.kind === 'text') throw new Error('no text viewer')
      },
    },
  }
  const opened = openInDefaultSidebar(ctx, ADDRESS, { ownKind: 'ide-workbench', kind: 'text' })
  assert.equal(opened, true)
  assert.deepEqual(calls, ['text', 'editor'])
})

test('openInDefaultSidebar declines its own address when candidates are unavailable', () => {
  let released = 0
  const calls = []
  const ctx = {
    sidebarRight: { openResource: (address, options) => { calls.push({ address, options }) } },
  }
  const opened = openInDefaultSidebar(ctx, ADDRESS, {
    ownKind: 'ide-workbench',
    suppressSelf: () => { released += 1; return () => { released += 1 } },
  })
  assert.equal(opened, true)
  assert.equal(released, 2)
  assert.equal(calls[0].options.kind, undefined)
})

test('openInDefaultSidebar reports failure without a sidebar service', () => {
  assert.equal(openInDefaultSidebar({}, ADDRESS, { ownKind: 'ide-workbench' }), false)
})

/* ── the lifetime of the carrier tab ───────────────────────────────────────
   The host replaces the carrier only when the target page tab does not exist
   yet. When it does, the host focuses the target and leaves the carrier
   alive: a carrier that stays alive sits on "Loading…" for ever and swallows
   the next click of the same link, because the host deduplicates the tabs by
   content id. The plugin therefore decides the fate of the carrier itself.
*/

/**
 * A sidebar that keeps its tabs, like the host's.
 *
 * @param {{ tabs?: object[], replaceOnOpen?: boolean, closeThrows?: boolean }} options
 *   `replaceOnOpen` makes the host do what it does when the target tab does
 *   not exist yet: it closes the carrier.
 * @returns {{ ctx: any, layout: object[], calls: object[] }}
 */
function fakeSidebar(options = {}) {
  const layout = options.tabs ?? []
  const calls = []
  const sidebar = {
    openTab: (kind, opts) => {
      calls.push({ open: kind, options: opts })
      if (options.replaceOnOpen !== true) return
      const index = layout.findIndex(tab => tab.id === opts?.replaceTab)
      if (index >= 0) layout.splice(index, 1)
    },
    openResource: (address, opts) => { calls.push({ address, options: opts }) },
    close: (id) => {
      calls.push({ close: id })
      if (options.closeThrows === true) throw new Error('no such tab')
      const index = layout.findIndex(tab => tab.id === id)
      if (index >= 0) layout.splice(index, 1)
    },
    active: () => layout[layout.length - 1] ?? null,
    openTabs: { getSnapshot: () => layout },
  }
  const ctx = { sidebarRight: sidebar, sidebarRightTabs: { candidates: () => [] } }
  return { ctx, layout, calls }
}

test('the carrier tab is replaced by the host, and nothing is closed', () => {
  const { ctx, layout, calls } = fakeSidebar({
    tabs: [{ id: 'tab-1', kind: 'ide-workbench', contentId: ADDRESS }],
    replaceOnOpen: true,
  })
  const fate = replaceCarrierTab(ctx, 'tab-1', { kind: 'ide-workbench', contentId: ADDRESS })
  assert.equal(fate.ok, true)
  assert.equal(fate.fate, 'replaced')
  assert.equal(calls.some(call => call.close !== undefined), false)
  assert.deepEqual(layout, [])
})

test('a carrier the host left alive is closed by the plugin', () => {
  const { ctx, layout, calls } = fakeSidebar({
    tabs: [{ id: 'tab-1', kind: 'ide-workbench', contentId: ADDRESS }],
  })
  const fate = replaceCarrierTab(ctx, 'tab-1', { kind: 'ide-workbench', contentId: ADDRESS })
  assert.equal(fate.ok, true)
  assert.equal(fate.fate, 'closed')
  assert.equal(calls.filter(call => call.close !== undefined).length, 1)
  // No tab with the address as its content id is left in the sidebar.
  assert.equal(layout.some(tab => tab.contentId === ADDRESS), false)
})

test('a carrier that the host renamed is found by its content id', () => {
  const { ctx, layout } = fakeSidebar({
    tabs: [{ id: 'tab-9', kind: 'ide-workbench', contentId: ADDRESS }],
  })
  assert.equal(carrierTabAlive(ctx, 'tab-1', { kind: 'ide-workbench', contentId: ADDRESS }), true)
  const fate = replaceCarrierTab(ctx, 'tab-1', { kind: 'ide-workbench', contentId: ADDRESS })
  assert.equal(fate.ok, true)
  assert.equal(layout.some(tab => tab.contentId === ADDRESS), false)
})

test('a viewer tab of the same address is not the carrier', () => {
  const { ctx, layout } = fakeSidebar({
    tabs: [{ id: 'tab-2', kind: 'text', contentId: ADDRESS }],
  })
  // The default viewer of the address is a tab of its own kind: it must not be
  // taken for the carrier, and it must not be closed.
  assert.equal(carrierTabAlive(ctx, 'tab-1', { kind: 'ide-workbench', contentId: ADDRESS }), false)
  assert.equal(replaceCarrierTab(ctx, 'tab-1', { kind: 'ide-workbench', contentId: ADDRESS }).fate, 'replaced')
  assert.equal(layout.length, 1)
  assert.equal(layout[0].id, 'tab-2')
})

test('a close that fails is reported, so the caller can show a message', () => {
  const { ctx } = fakeSidebar({
    tabs: [{ id: 'tab-1', kind: 'ide-workbench', contentId: ADDRESS }],
    closeThrows: true,
  })
  const fate = replaceCarrierTab(ctx, 'tab-1', { kind: 'ide-workbench', contentId: ADDRESS })
  assert.equal(fate.ok, false)
  assert.equal(fate.fate, 'unknown')
  assert.ok(fate.error !== undefined)
})

test('a host without an inventory leaves the fate unknown', () => {
  const ctx = { sidebarRight: { openTab: () => {} } }
  assert.equal(carrierTabAlive(ctx, 'tab-1'), null)
  const fate = replaceCarrierTab(ctx, 'tab-1', { kind: 'ide-workbench' })
  assert.equal(fate.ok, false)
  assert.equal(fate.fate, 'unknown')
})

test('the default viewer closes a carrier that survived the open', () => {
  const { ctx, layout, calls } = fakeSidebar({
    tabs: [{ id: 'tab-1', kind: 'ide-workbench', contentId: ADDRESS }],
  })
  const opened = openInDefaultSidebar(ctx, ADDRESS, {
    ownKind: 'ide-workbench', kind: 'text', replaceTab: 'tab-1',
  })
  assert.equal(opened, true)
  // The host did not replace the carrier (the viewer was already open): the
  // plugin closes it, so no tab with the address is left behind.
  assert.equal(calls.filter(call => call.close !== undefined).length, 1)
  assert.equal(layout.some(tab => tab.contentId === ADDRESS), false)
})

test('three clicks on the same link leave no carrier tab behind', () => {
  const layout = []
  const calls = []
  const sidebar = {
    openTab: (kind, opts) => {
      calls.push({ open: kind, options: opts })
      // The first click: the IDE page tab does not exist yet, so the host
      // replaces the carrier. Every click after that: the page tab is
      // already there, and the host only focuses it.
      if (layout.some(tab => tab.id === 'page')) {
        const index = layout.findIndex(tab => tab.id === opts?.replaceTab)
        if (index >= 0) layout.splice(index, 1)
        return
      }
      const index = layout.findIndex(tab => tab.id === opts?.replaceTab)
      if (index >= 0) layout.splice(index, 1)
      layout.push({ id: 'page', kind, contentId: 'sidebar://ide-workbench' })
    },
    close: (id) => {
      calls.push({ close: id })
      const index = layout.findIndex(tab => tab.id === id)
      if (index >= 0) layout.splice(index, 1)
    },
    active: () => layout[layout.length - 1] ?? null,
    openTabs: { getSnapshot: () => layout },
  }
  const ctx = { sidebarRight: sidebar, sidebarRightTabs: { candidates: () => [] } }
  for (let click = 0; click < 3; click += 1) {
    // Every click of the chat opens a carrier tab for the address.
    layout.push({ id: `carrier-${click}`, kind: 'ide-workbench', contentId: ADDRESS })
    const fate = replaceCarrierTab(ctx, `carrier-${click}`, { kind: 'ide-workbench', contentId: ADDRESS })
    assert.equal(fate.ok, true, `the carrier of the click ${click + 1} has a decided fate`)
    // No tab of the sidebar carries the address any more.
    assert.equal(layout.some(tab => tab.contentId === ADDRESS), false)
  }
  // The IDE page tab is the only one left, and it was never closed.
  assert.deepEqual(layout.map(tab => tab.id), ['page'])
  assert.equal(calls.filter(call => call.close === 'page').length, 0)
})

test('closeCarrierTab tolerates a carrier the host already removed', () => {
  const { ctx, layout } = fakeSidebar({ tabs: [] })
  assert.equal(closeCarrierTab(ctx, 'tab-1', { contentId: ADDRESS }).closed, true)
  assert.deepEqual(layout, [])
})
