/** Client integration: a native right-sidebar tab, header entry and shortcuts. */
import React, { useEffect, useLayoutEffect, useSyncExternalStore } from 'react'
import xtermCss from '@xterm/xterm/css/xterm.css'
import { NS, en, zh } from './i18n.js'
import { StoreCache, WorkbenchStore } from './store.js'
import { Workbench } from './Workbench.jsx'
import { SettingsSection } from './SettingsPanel.jsx'
import { CSS } from './styles.js'
import { setPrimitivesLoader } from './host-primitives.js'
import { matchesShortcut, isTerminalTarget } from './util.js'
import { useWorkbench } from './hooks.js'
import {
  basenameOfFileAddress, isFileAddress, isIdeViewableAddress, parseFileAddress, resolveFileAddress,
} from './file-address.js'
import {
  isPathWithin, sameScopePath, sessionCwdOf, shouldContinueIde, workspaceScopeKey,
} from './workspace-scope.js'
import { openInDefaultSidebar } from './file-link.js'
import { registerChatInput } from './chat-bridge.js'
import { configureLsp } from './lsp-session.js'

export const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'sessions']
const PANEL_ID = 'ide-workbench'

function PanelIcon({ size = 20 }) {
  return React.createElement('svg', {
    viewBox: '0 0 20 20', width: size, height: size, fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round', 'aria-hidden': true,
  },
    React.createElement('rect', { x: 2, y: 2.5, width: 16, height: 15, rx: 2 }),
    React.createElement('line', { x1: 7.4, y1: 2.5, x2: 7.4, y2: 17.5 }),
    React.createElement('line', { x1: 7.4, y1: 11.5, x2: 18, y2: 11.5 }),
    React.createElement('polyline', { points: '9.6 14.2 11 15.4 13.6 13.6' }),
  )
}

/** The on-screen Session the right Sidebar is currently drawing. */
function useMountedSession(ctx) {
  const mounted = ctx.sidebarRight?.mounted
  return useSyncExternalStore(
    (callback) => (typeof mounted?.subscribe === 'function' ? mounted.subscribe(callback) : () => {}),
    () => (typeof mounted?.getSnapshot === 'function' ? mounted.getSnapshot() : undefined),
    () => undefined,
  )
}

/**
 * A file resource tab is only a transient carrier: it opens the file in the
 * workbench and replaces itself with the IDE page tab. It never renders a
 * second Workbench (which would duplicate terminal sockets and editor state).
 *
 * When the file cannot stay in the IDE — it lives outside the DSH workspace, or
 * the user declines to widen the IDE project to the workspace root — the
 * carrier tab hands the address back to DSH's own sidebar and replaces itself
 * with that viewer instead of surfacing an error.
 */
function FileLinkBridge({ store, tab, ctx, suppressSelf }) {
  const address = typeof tab.contentId === 'string' ? tab.contentId : ''
  const line = tab.navigation?.params?.line
  const [view, setView] = React.useState({ phase: 'opening', absolute: '' })

  const replaceWithIde = React.useCallback(() => {
    try {
      ctx.sidebarRight.openTab(PANEL_ID, { replaceTab: tab.id })
      return true
    } catch {
      return false
    }
  }, [ctx, tab.id])

  const openDefault = React.useCallback(() => openInDefaultSidebar(ctx, address, {
    ownKind: PANEL_ID, line, replaceTab: tab.id, suppressSelf,
  }), [ctx, address, line, tab.id, suppressSelf])

  const close = React.useCallback(() => {
    try { ctx.sidebarRight.close(tab.id) } catch { /* the layout owns the tab */ }
  }, [ctx, tab.id])

  const begin = React.useCallback(async (switchProject) => {
    setView(current => ({ ...current, phase: 'opening' }))
    let result
    try {
      result = await store.openExternalFile(address, { line, switchProject })
    } catch {
      result = { status: 'failed' }
    }
    if (result.status === 'opened') {
      if (!replaceWithIde()) setView({ phase: 'failed', absolute: result.absolute ?? '' })
      return
    }
    if (result.status === 'outside-workspace') {
      // The link belongs to the default sidebar; hand it over with this tab as
      // the carrier so no extra tab is left behind.
      if (openDefault()) return
    }
    const phase = result.status === 'needs-project-switch'
      ? 'prompt'
      : result.status === 'dirty' ? 'dirty' : 'failed'
    setView({ phase, absolute: result.absolute ?? '' })
  }, [store, address, line, replaceWithIde, openDefault])

  useLayoutEffect(() => {
    void begin(false)
  }, [begin])

  const path = view.absolute !== '' ? view.absolute : address
  const button = (key, label, extra, onClick) => React.createElement('button', {
    key, type: 'button', className: `iwb-textbtn ${extra}`.trim(), onClick,
  }, store.t(label))
  const card = (title, body, actions) => React.createElement('div', { className: 'iwb-empty iwb-link-prompt' },
    React.createElement('div', { className: 'iwb-empty-title' }, store.t(title)),
    body === '' ? null : React.createElement('div', { className: 'iwb-link-body' }, store.t(body)),
    path === '' ? null : React.createElement('div', { className: 'iwb-link-path' }, path),
    React.createElement('div', { className: 'iwb-link-actions' }, actions),
  )
  const defaultButton = () => button('default', 'links.openInDefaultSidebar', '', () => {
    if (!openDefault()) setView({ phase: 'failed', absolute: path })
  })

  let content
  if (view.phase === 'opening') {
    content = React.createElement('div', { className: 'iwb-empty' },
      React.createElement('div', { className: 'iwb-empty-title' }, store.t('common.loading')),
    )
  } else if (view.phase === 'prompt') {
    content = card('links.switchProjectTitle', 'links.switchProjectBody', [
      button('yes', 'links.switchProjectYes', 'iwb-primary', () => { void begin(true) }),
      defaultButton(),
    ])
  } else if (view.phase === 'dirty') {
    content = card('links.dirtyProject', '', [
      button('retry', 'common.retry', '', () => { void begin(true) }),
      defaultButton(),
      button('close', 'common.close', '', close),
    ])
  } else {
    content = card('links.openFailed', '', [
      button('retry', 'common.retry', '', () => { void begin(false) }),
      defaultButton(),
      button('close', 'common.close', '', close),
    ])
  }
  // `.iwb-root`'s tokens are scoped to the workbench; this carrier tab is a
  // sibling surface, so it brings its own `.iwb-link-shell` token scope.
  return React.createElement('div', { className: 'iwb-link-shell' }, content)
}

function BoundWorkbench({ getStore, sessionId, useTabInfo, ctx, reportVisible, suppressSelf }) {
  const { tab, sidebar } = useTabInfo()
  const store = getStore(sessionId)
  const mountedId = useMountedSession(ctx)
  const hasMounted = typeof ctx.sidebarRight?.mounted?.getSnapshot === 'function'
  // A background Session still keeps its tab body mounted (keepMounted), but it
  // must not draw a second Workbench against the same workspace store. When the
  // host has no `mounted` feed, fall back to drawing every body as before.
  const isMounted = !hasMounted || mountedId === undefined || mountedId === sessionId
  const fileLink = isFileAddress(tab.contentId)

  useEffect(() => {
    if (isMounted) void store.init()
  }, [store, isMounted])

  useEffect(() => {
    if (fileLink) return undefined
    reportVisible(sessionId, isMounted && tab.visible === true)
    return () => reportVisible(sessionId, false)
  }, [sessionId, isMounted, tab.visible, fileLink, reportVisible])

  if (fileLink) {
    return React.createElement(FileLinkBridge, { store, tab, ctx, suppressSelf })
  }
  if (!isMounted) return null
  return React.createElement(Workbench, { store, visible: tab.visible, fullscreen: sidebar.fullscreen })
}

function BoundSettings({ store }) {
  const state = useWorkbench(store)
  return React.createElement(SettingsSection, { store, state })
}

function OpenButton({ open, t }) {
  return React.createElement('button', {
    type: 'button', title: t('panelLabel'), 'aria-label': t('panelLabel'),
    className: 'iwb-sidebar-open', onClick: open,
  }, React.createElement(PanelIcon, { size: 18 }))
}

/**
 * Invisible composer companion: the conversation plugin publishes its
 * per-Session `inputActions` as standard props to Session-scoped slots, so one
 * hidden registration in the composer dock is enough to let the workbench
 * insert `@` references ("send to chat") without reaching into that plugin.
 */
function ChatInputBridge({ sessionId, inputActions }) {
  useLayoutEffect(() => {
    if (typeof sessionId !== 'string' || sessionId === '') return undefined
    return registerChatInput(sessionId, inputActions)
  }, [sessionId, inputActions])
  return null
}

export function apply(ctx) {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => {
    const offZh = ctx.locale.register(NS, 'zh', zh)
    const offEn = ctx.locale.register(NS, 'en', en)
    return () => { offZh(); offEn() }
  }, 'dsh-ide-workbench: dictionaries')

  // The settings document is shared by every workspace store; load it before a
  // file-link claim can consult `links.chatFiles`.
  const settingsStore = new WorkbenchStore(ctx, t)
  void settingsStore.init()

  // `openInDefaultSidebar` uses this when the host does not publish the tab
  // registry's `candidates()`: the IDE declines one address for the duration
  // of the synchronous default open, so the registry ranks the default type.
  let suppressFileLinkClaim = false
  const suppressSelf = () => {
    suppressFileLinkClaim = true
    return () => { suppressFileLinkClaim = false }
  }

  // Render styles through React so their lifetime follows the plugin's seats.
  const Styles = () => React.createElement('style', { 'data-dsh-ide-workbench': '' }, `${xtermCss}\n${CSS}`)

  /**
   * The host session table, read once and then cached.
   *
   * `sessions.list.getSnapshot()` rebuilds the whole table, and the workbench
   * body of every Session stays mounted — reading it during render would hit
   * the host on every render of every Session. The table only changes when
   * the host changes it, so the cache is dropped then.
   */
  let sessionSnapshot = null
  let sessionSnapshotValid = false
  const readSessionSnapshot = () => {
    if (!sessionSnapshotValid) {
      const sessions = ctx?.sessions ?? ctx?.get?.('sessions')
      sessionSnapshot = sessions?.list?.getSnapshot?.() ?? null
      sessionSnapshotValid = true
    }
    return sessionSnapshot
  }
  const invalidateSessionSnapshot = () => { sessionSnapshotValid = false }
  /**
   * A context whose session table comes from the cache.
   *
   * The scope rules of `workspace-scope.js` stay the single source of truth:
   * only the table behind them is cached.
   */
  const cachedSessionsCtx = {
    get sessions() {
      return { list: { getSnapshot: () => readSessionSnapshot() } }
    },
  }
  /** The workspace root of one Session. */
  const cwdOf = sessionId => sessionCwdOf(cachedSessionsCtx, sessionId)
  /** The store key of one Session (the rule of `workspaceScopeKey`). */
  const scopeKeyOf = sessionId => workspaceScopeKey(cachedSessionsCtx, sessionId)

  /**
   * Whether one Session is the one the right Sidebar is drawing right now.
   *
   * A Session that is not the current one keeps its tab body alive
   * (`keepMounted`), but that body renders nothing (see `BoundWorkbench`),
   * so its store is not in use and may be evicted. The evicted store's
   * persisted state comes back when the workspace is entered again
   * (PRD-v4 review M9).
   * @param {string} sessionId
   */
  const isMountedSession = (sessionId) => {
    if (typeof sessionId !== 'string' || sessionId === '') return false
    return ctx.sidebarRight?.mounted?.getSnapshot?.() === sessionId
  }

  const hasMounted = typeof ctx.sidebarRight?.mounted?.getSnapshot === 'function'
  // One store per workspace, at most three of them resident (PRD PERF-05).
  const stores = new StoreCache({ limit: 3, isMounted: isMountedSession })
  /**
   * Evict outside the render stack.
   *
   * Evicting deactivates a store, which notifies its subscribers and writes
   * the persisted state to disk — both must not happen while React renders
   * (PRD-v4 review M4).
   */
  let evictTimer = null
  const scheduleEvict = () => {
    if (evictTimer !== null) return
    evictTimer = setTimeout(() => {
      evictTimer = null
      stores.evict()
    }, 0)
  }
  const getStore = (sessionId) => {
    const id = typeof sessionId === 'string' ? sessionId : ''
    const key = hasMounted ? scopeKeyOf(id) : `session:${id}`
    const existing = stores.get(key)
    if (existing !== undefined) {
      // Several Sessions can share one workspace: every one of them must be
      // known, or the store could be evicted while a mounted body still uses
      // it.
      stores.claim(key, id)
      return existing
    }
    // The eviction is deferred: `getStore` runs while React renders.
    const store = stores.set(key, new WorkbenchStore(ctx, t, cwdOf(id)), id, { evict: false })
    // The semantic-analysis session belongs to the store: it reads the
    // language-server status and the drafts from it, and it registers the
    // text version of Find Usages on it.
    configureLsp(store)
    scheduleEvict()
    return store
  }
  const activeStore = () => {
    const sessionId = ctx.sidebarRight.mounted?.getSnapshot()
    const tab = ctx.sidebarRight.active()
    if (tab?.kind !== PANEL_ID || typeof sessionId !== 'string') return undefined
    return getStore(sessionId)
  }

  // `openTab` fails while the arriving Session's rightbar store is not adopted
  // yet. Queue the intent and replay it on `mounted`/`openTabs` changes and a
  // short bounded timer; no polling follows.
  let pendingOpen = null
  let pendingTimer = null
  let pendingAttempts = 0
  const clearPending = () => {
    if (pendingTimer !== null) { clearTimeout(pendingTimer); pendingTimer = null }
    pendingOpen = null
    pendingAttempts = 0
  }
  const verifyOpen = (target) => {
    if (pendingOpen !== target) return
    const mounted = ctx.sidebarRight?.mounted?.getSnapshot()
    if (mounted !== target) { clearPending(); return }
    let opened = false
    try {
      const inventory = ctx.sidebarRight?.openTabs?.getSnapshot?.()
      if (Array.isArray(inventory)) {
        opened = inventory.some(tab => tab?.sessionId === target && tab?.kind === PANEL_ID)
      } else {
        opened = ctx.sidebarRight.active()?.kind === PANEL_ID
      }
    } catch {
      opened = false
    }
    if (opened || pendingAttempts >= 40) { clearPending(); return }
    pendingAttempts += 1
    pendingTimer = setTimeout(flushOpen, 25)
  }
  const flushOpen = () => {
    if (pendingOpen === null) return
    const target = pendingOpen
    const mounted = ctx.sidebarRight?.mounted?.getSnapshot()
    if (mounted !== target) { clearPending(); return }
    try {
      ctx.sidebarRight.openTab(PANEL_ID)
      // Some hosts accept the call before the Session's rightbar store is
      // adopted and simply no-op. Confirm membership once, then retry.
      pendingTimer = setTimeout(() => verifyOpen(target), 30)
    } catch {
      pendingAttempts += 1
      if (pendingAttempts >= 40) clearPending()
      else pendingTimer = setTimeout(flushOpen, 25)
    }
  }
  const requestOpen = (sessionId = ctx.sidebarRight?.mounted?.getSnapshot()) => {
    if (typeof sessionId !== 'string' || sessionId === '') return
    pendingOpen = sessionId
    pendingAttempts = 0
    if (pendingTimer !== null) { clearTimeout(pendingTimer); pendingTimer = null }
    flushOpen()
  }
  const open = () => requestOpen()
  const toggle = () => {
    if (ctx.sidebarRight.isExpanded() && ctx.sidebarRight.active()?.kind === PANEL_ID) {
      ctx.sidebarRight.toggleExpanded()
    } else {
      open()
    }
  }

  // Which Session last had the IDE body actually visible. A Session switch
  // reads this before React commits the new Session's body, then reopens the
  // IDE in the arriving Session when both share a workspace.
  let ideVisibleSession = null
  const reportVisible = (sessionId, visible) => {
    if (typeof sessionId !== 'string') return
    if (visible === true) ideVisibleSession = sessionId
    else if (ideVisibleSession === sessionId) ideVisibleSession = null
  }

  const modules = ctx.get('modules')
  if (modules != null && typeof modules.import === 'function') {
    setPrimitivesLoader(() => modules.import('@deepseek-ai/dsh-client-ui-primitives'))
  }

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: 'dsh-ide-workbench', kind: PANEL_ID,
    title: address => (isFileAddress(address)
      ? (basenameOfFileAddress(address) ?? t('panelLabel'))
      : t('panelLabel')),
    keepMounted: true,
    // A chat file link is a `dsh-resource://file/...` address. These longer
    // patterns outrank the better-sidebar editor (`dsh-resource://file/**`) by
    // matched-pattern length, independent of registration order.
    patterns: ['dsh-resource://file/session/**', 'dsh-resource://file/absolute/**'],
    priority: 'extension',
    canOpen: address => {
      if (suppressFileLinkClaim) return false
      if (settingsStore.state.settings?.links?.chatFiles === 'sidebar') return false
      if (!isIdeViewableAddress(address)) return false
      const parsed = parseFileAddress(address)
      if (parsed === undefined) return false
      const mountedSession = ctx.sidebarRight?.mounted?.getSnapshot()
      const current = cwdOf(mountedSession)
      const linkCwd = parsed.scope === 'session' ? cwdOf(parsed.sessionId) : ''
      if (current !== '' && linkCwd !== '' && !sameScopePath(current, linkCwd)) return false
      // Claim only files inside the DSH workspace. A link that points elsewhere
      // (another drive, a temp file, a sibling checkout) must fall through to
      // DSH's own sidebar, which owns previews and path rules for it.
      const workspace = current || linkCwd
      if (workspace === '') return true
      const absolute = resolveFileAddress(parsed, linkCwd || current)
      if (absolute === undefined) return false
      return isPathWithin(workspace, absolute)
    },
    guide: [{ id: PANEL_ID, title: () => t('panelLabel'), icon: PanelIcon, order: 35 }],
  }), 'dsh-ide-workbench: sidebar tab type')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: 'dsh-ide-workbench',
  }, props => React.createElement(React.Fragment, null,
    React.createElement(Styles),
    React.createElement(BoundWorkbench, {
      ...props, getStore, ctx, reportVisible, suppressSelf,
    }),
  ))), 'dsh-ide-workbench: sidebar body')

  ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities', id: PANEL_ID, order: 30,
    label: () => t('panelLabel'),
  }, () => React.createElement(React.Fragment, null,
    React.createElement(Styles), React.createElement(OpenButton, { open: toggle, t }),
  ))), 'dsh-ide-workbench: sidebar entry')

  // A blank Session hides the whole session-header title cluster, so the entry
  // above disappears on Ctrl+N. The New Session row keeps its compact options
  // list; contribute the same button there. Non-blank Sessions never render it.
  ctx.effect(() => ctx.slots.inject('conversation.hero.options', () => ctx.slots.register({
    name: 'conversation.hero.options', id: PANEL_ID, order: 40,
    label: () => t('panelLabel'),
  }, () => React.createElement(React.Fragment, null,
    React.createElement(Styles), React.createElement(OpenButton, { open, t }),
  ))), 'dsh-ide-workbench: new-session entry')

  ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'ide-workbench-chat-input', order: 80,
    label: () => t('chat.sendToChat'),
  }, props => React.createElement(ChatInputBridge, props))), 'dsh-ide-workbench: composer chat bridge')

  // The footer entry is the always-present fallback: it survives when a skin or
  // a narrow header hides the session utilities, and it is visible on the
  // session-less start page as well (where no right Sidebar can be opened yet).
  ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: PANEL_ID, order: 20,
    label: () => t('panelLabel'),
  }, () => React.createElement(React.Fragment, null,
    React.createElement(Styles), React.createElement(OpenButton, { open, t }),
  ))), 'dsh-ide-workbench: sidebar footer entry')

  ctx.effect(() => {
    const mounted = ctx.sidebarRight?.mounted
    if (typeof mounted?.subscribe !== 'function' || typeof mounted.getSnapshot !== 'function') {
      return () => clearPending()
    }
    let lastMounted = mounted.getSnapshot()
    const onMounted = () => {
      const next = mounted.getSnapshot()
      const previous = lastMounted
      lastMounted = next
      if (typeof next !== 'string' || next === '' || next === previous) return
      // The workspace roots come from the cached session table: the switch
      // itself must not read the host snapshot.
      const continueIde = shouldContinueIde(cachedSessionsCtx, previous, next, ideVisibleSession)
      // The host may have published another workspace root; the next lookup
      // re-reads the session table once.
      invalidateSessionSnapshot()
      if (!continueIde) return
      requestOpen(next)
    }
    const unsubscribeMounted = mounted.subscribe(onMounted)
    const openTabs = ctx.sidebarRight?.openTabs
    const unsubscribeTabs = typeof openTabs?.subscribe === 'function' ? openTabs.subscribe(flushOpen) : undefined
    return () => {
      unsubscribeMounted?.()
      unsubscribeTabs?.()
      clearPending()
    }
  }, 'dsh-ide-workbench: workspace continuity')

  ctx.effect(() => {
    // The session table backs the workspace scope of every Session. When the
    // host publishes a new table, the cached copy is dropped.
    const sessionList = ctx.sessions?.list
    if (typeof sessionList?.subscribe !== 'function') return () => {}
    return sessionList.subscribe(() => { invalidateSessionSnapshot() })
  }, 'dsh-ide-workbench: session scope cache')

  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: PANEL_ID, order: 60, label: () => t('settings.nav'),
  }, () => React.createElement(React.Fragment, null,
    React.createElement(Styles),
    React.createElement(BoundSettings, { store: settingsStore }),
  ))), 'dsh-ide-workbench: settings section')

  ctx.effect(() => {
    const onKeyDown = event => {
      if (event.repeat || ctx.sidebarRight.mounted.getSnapshot() === undefined) return
      const store = activeStore()
      const shortcuts = (store ?? settingsStore).state.settings?.shortcuts
      if (shortcuts == null) return
      const target = event.target
      const inWorkbench = target instanceof Element && target.closest('.iwb-root') !== null
      const inTerminal = isTerminalTarget(event.target)
      if (store?.state.active === true && inWorkbench) {
        if (matchesShortcut(shortcuts.findInFiles ?? 'Ctrl+Shift+R', event)
          || matchesShortcut(shortcuts.findInFilesAlt ?? 'Ctrl+Alt+F', event)) {
          event.preventDefault()
          event.stopPropagation()
          store.openSearchTab()
          return
        }
        if (matchesShortcut(shortcuts.quickOpen ?? 'Ctrl+Shift+N', event)) {
          event.preventDefault()
          event.stopPropagation()
          store.openQuickOpen()
          return
        }
        // Ctrl+P is the VS Code muscle memory; keep both (decision 4C).
        if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'p') {
          event.preventDefault()
          event.stopPropagation()
          store.openQuickOpen()
          return
        }
        if (store.state.activeId === 'search:in-files' && event.key === 'F8' && !event.ctrlKey && !event.altKey && !event.metaKey) {
          event.preventDefault()
          event.stopPropagation()
          store.openNextSearchResult(event.shiftKey ? -1 : 1)
          return
        }
        if (store.state.layout.bottom === 'git'
          && matchesShortcut(shortcuts.openCommitDetail ?? 'Ctrl+Alt+D', event)) {
          event.preventDefault()
          event.stopPropagation()
          const hash = store.state.git.selectedHash ?? store.state.git.commits[0]?.hash
          if (hash !== undefined) void store.openCommitDetail(hash)
          return
        }
      }
      const pairs = [
        ['project', shortcuts.project], ['commit', shortcuts.commit],
        ['git', shortcuts.git], ['terminal', shortcuts.terminal],
        ['focusCommit', shortcuts.focusCommit], ['push', shortcuts.push],
      ]
      for (const [action, shortcut] of pairs) {
        if (!shortcut || !matchesShortcut(shortcut, event)) continue
        if (inTerminal && (action === 'focusCommit' || action === 'push')) continue
        // Ctrl+K / F11 belong to the IDE only while it has focus; otherwise a
        // chat input or another panel must receive them.
        if ((action === 'focusCommit') && !inWorkbench) continue
        if (action === 'push') {
          if (store?.state.active !== true || store.state.status.isRepo !== true) return
          event.preventDefault()
          event.stopPropagation()
          void store.push()
          return
        }
        event.preventDefault()
        event.stopPropagation()
        const wasActive = store?.state.active === true
        open()
        // Opening mounts the body after this event. Apply the requested tool
        // once its store exists; do not consume shortcuts without a Session.
        requestAnimationFrame(() => {
          const targetStore = activeStore()
          if (targetStore === undefined) return
          if (action === 'focusCommit') targetStore.focusCommit()
          else if (wasActive) targetStore.toggleTool(action)
          else targetStore.showTool(action)
        })
        return
      }
      if (store?.state.active !== true) return
      if (event.key === 'F11') {
        if (!inWorkbench) return
        event.preventDefault()
        event.stopPropagation()
        store.toggleFullscreen(event.target)
      } else if (matchesShortcut(shortcuts.hideAll ?? 'Ctrl+Shift+F12', event)) {
        event.preventDefault()
        store.toggleHideAll()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, 'dsh-ide-workbench: shortcuts')

  ctx.effect(() => () => {
    for (const store of stores.stores.values()) {
      for (const unsubscribe of store.unsubscribers.splice(0)) unsubscribe()
    }
    stores.clear()
    settingsStore.deactivate()
    for (const unsubscribe of settingsStore.unsubscribers.splice(0)) unsubscribe()
  }, 'dsh-ide-workbench: store teardown')
}
