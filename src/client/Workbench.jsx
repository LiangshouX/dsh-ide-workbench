/**
 * The workbench root: one main-panel page that hosts the four tool windows
 * (Project / Commit left dock, Git / Terminal bottom dock) around an editor
 * area the plugin owns, so Preview / Pinned tab semantics are exact.
 */
import React, { useEffect, useRef, useState } from 'react'
import { useWorkbench } from './hooks.js'
import { FileTypeIcon, IconGit, IconGear, IconRefresh, IconTerminal, StripeIcon } from './icons.jsx'
import { ProjectPanel } from './ProjectPanel.jsx'
import { CommitPanel } from './CommitPanel.jsx'
import { GitPanel, RepoPopover } from './GitPanel.jsx'
import { TerminalPanel } from './TerminalPanel.jsx'
import { EditorArea } from './EditorArea.jsx'
import { SettingsForm } from './SettingsPanel.jsx'
import { QuickOpen } from './QuickOpen.jsx'
import { SearchPopup } from './SearchPopup.jsx'
import { ContextMenu, ConfirmModal, Kbd, Toast } from './ui.jsx'
import { baseName } from './util.js'
import { STACK_WIDTH } from './layout.js'
import { LSP_HOST_HEALTHY_STATES } from './lsp-session.js'

/**
 * Translate with an English fallback for keys the locale table does not
 * carry yet.
 */
function label(t, key, fallback) {
  const value = t(key)
  return value === key || value === undefined || value === null || value === '' ? fallback : value
}

/**
 * Fill the `{placeholder}` slots of one text.
 *
 * The harness translate function does not interpolate, so the code-intelligence
 * texts are completed here (PRD-v5 §7.1).
 * @param {string} text
 * @param {Record<string, string|number>} values
 * @returns {string}
 */
function interpolate(text, values) {
  let out = typeof text === 'string' ? text : ''
  for (const [name, value] of Object.entries(values)) {
    out = out.replaceAll(`{${name}}`, String(value))
  }
  return out
}

/*
 * PERF-02: a panel that subscribes to its own slice does not need the whole
 * state. The memo keeps a Workbench re-render (a toast, a terminal chunk)
 * from re-rendering the panel: its only prop is the store, which is stable.
 */
const MemoEditorArea = React.memo(EditorArea)
const MemoProjectPanel = React.memo(ProjectPanel)
const MemoCommitPanel = React.memo(CommitPanel)
const MemoGitPanel = React.memo(GitPanel)
const MemoTerminalPanel = React.memo(TerminalPanel)

function TopBar({ store, state, fullscreen, onOpenSettings }) {
  const t = store.t
  const branch = state.status.branch
  const detached = state.status.detached === true
  const workspaceTitle = baseName(state.workspaceRoot) || t('project.empty')
  const projectTitle = baseName(state.root)
  const showProject = state.root !== state.workspaceRoot && projectTitle !== ''
  const [menu, setMenu] = useState(null)
  const [pushMenu, setPushMenu] = useState(null)
  const ahead = typeof state.status.ahead === 'number' ? state.status.ahead : 0
  const behind = typeof state.status.behind === 'number' ? state.status.behind : 0
  const upstream = typeof state.status.upstream === 'string' ? state.status.upstream : ''
  return React.createElement('div', { className: 'iwb-topbar' },
    React.createElement('button', {
      type: 'button',
      className: 'iwb-project-select',
      title: state.workspaceRoot,
      onClick: event => setMenu({ x: event.clientX, y: event.clientY + 8 }),
    },
      React.createElement(StripeIcon, { tool: 'project', size: 16 }),
      React.createElement('span', { className: 'iwb-project-name' },
        workspaceTitle,
        showProject ? React.createElement('span', { className: 'iwb-project-current' }, ` / ${projectTitle}`) : null,
      ),
      React.createElement('span', { className: 'iwb-project-path' }, state.root || state.workspaceRoot),
    ),
    state.status.isRepo === true
      ? React.createElement('span', { className: 'iwb-branch-chip', title: state.status.upstream ?? '' },
          React.createElement(IconGit, { width: 12, height: 12 }),
          React.createElement('span', { className: 'iwb-branch-name' }, detached ? (state.status.oid ?? 'HEAD').slice(0, 7) : (branch ?? 'HEAD')),
          detached ? React.createElement('span', { className: 'iwb-behind' }, t('git.detached')) : null,
          // The "ahead" badge is a button: it is the only place that offers
          // the push without a terminal (PUSH-02).
          ahead > 0
            ? React.createElement('button', {
                type: 'button',
                className: 'iwb-ahead iwb-ahead-btn',
                title: interpolate(t('git.aheadTitle'), { upstream: upstream === '' ? t('common.branch') : upstream, count: ahead }),
                onClick: event => {
                  event.stopPropagation()
                  setPushMenu({ x: event.clientX, y: event.clientY + 8 })
                },
              }, `↑${ahead}`)
            : null,
          behind > 0
            ? React.createElement('button', {
                type: 'button',
                className: 'iwb-behind iwb-ahead-btn',
                title: interpolate(t('git.behindTitle'), { count: behind }),
                onClick: event => {
                  event.stopPropagation()
                  setPushMenu({ x: event.clientX, y: event.clientY + 8 })
                },
              }, `↓${behind}`)
            : null,
        )
      : null,
    React.createElement('div', { className: 'iwb-top-spacer' }),
    React.createElement('button', {
      type: 'button', className: 'iwb-iconbtn', title: t('layout.hideAll'),
      onClick: () => store.toggleHideAll(),
    }, '⊟'),
    React.createElement('button', {
      type: 'button', className: `iwb-iconbtn ${fullscreen ? 'iwb-on' : ''}`,
      title: t(fullscreen ? 'layout.exitFullscreen' : 'layout.fullscreen'),
      'aria-label': t(fullscreen ? 'layout.exitFullscreen' : 'layout.fullscreen'),
      'aria-pressed': fullscreen,
      onClick: event => store.toggleFullscreen(event.currentTarget),
    }, '⛶'),
    React.createElement('button', {
      type: 'button', className: 'iwb-iconbtn', title: t('common.refresh'),
      onClick: () => { void store.reloadTree(); void store.refreshStatus({ initial: true }); void store.loadBranches() },
    }, React.createElement(IconRefresh, { width: 15, height: 15 })),
    React.createElement('button', {
      type: 'button', className: 'iwb-iconbtn', title: t('common.settings'), onClick: onOpenSettings,
    }, React.createElement(IconGear, { width: 15, height: 15 })),
    menu !== null
      ? React.createElement(ContextMenu, {
          x: menu.x, y: menu.y, onClose: () => setMenu(null),
          items: [
            { label: t('common.root') },
            ...(state.workspaces.length > 0
              ? state.workspaces.map(workspace => ({
                  key: workspace.path,
                  text: workspace.title,
                  icon: workspace.path === state.workspaceRoot ? React.createElement('span', { style: { color: 'var(--iwb-accent)' } }, '●') : null,
                  action: () => { void store.setRoot(workspace.path) },
                }))
              : [{ text: t('project.empty'), disabled: true }]),
            null,
            { key: 'project', text: t('project.selectProject'), action: () => store.openProjectPicker() },
            { key: 'open', text: t('project.openWorkspace'), action: () => store.openRootPicker() },
          ],
        })
      : null,
    pushMenu !== null
      ? React.createElement(ContextMenu, {
          x: pushMenu.x, y: pushMenu.y, onClose: () => setPushMenu(null),
          items: [
            { label: interpolate(t('git.aheadTitle'), { upstream: upstream === '' ? t('common.branch') : upstream, count: ahead }) },
            { key: 'push', text: t('git.aheadPush'), disabled: ahead === 0, action: () => { void store.push() } },
            { key: 'history', text: t('git.aheadHistory'), action: () => store.showTool('git') },
            ...(behind > 0
              ? [{ key: 'behind', text: interpolate(t('git.behindTitle'), { count: behind }), disabled: true }]
              : []),
          ],
        })
      : null,
  )
}

function Stripe({ store, state }) {
  const t = store.t
  const sessions = state.terminal.sessions.length
  const button = (tool, active, children) => React.createElement('button', {
    type: 'button',
    className: `iwb-stripe-btn ${active ? 'iwb-on' : ''}`,
    title: `${t(`${tool}.title`)} (${state.settings?.shortcuts?.[tool] ?? ''})`,
    onClick: () => store.toggleTool(tool),
  }, children)
  return React.createElement('div', { className: 'iwb-stripe' },
    button('project', state.layout.left === 'project',
      React.createElement(StripeIcon, { tool: 'project', size: 20 })),
    button('commit', state.layout.left === 'commit',
      React.createElement('span', null,
        React.createElement(StripeIcon, { tool: 'commit', size: 20 }),
        state.changeCount > 0 ? React.createElement('span', { className: 'iwb-badge' }, state.changeCount > 99 ? '99+' : state.changeCount) : null,
      )),
    React.createElement('div', { className: 'iwb-stripe-spacer' }),
    button('git', state.layout.bottom === 'git',
      React.createElement(StripeIcon, { tool: 'git', size: 20 })),
    button('terminal', state.layout.bottom === 'terminal',
      React.createElement('span', null,
        React.createElement(StripeIcon, { tool: 'terminal', size: 20 }),
        sessions > 0 ? React.createElement('span', { className: 'iwb-badge iwb-badge-dirty' }, sessions) : null,
      )),
  )
}

/**
 * Repository picker for the Git tool window (GIT-01).
 *
 * The Git panel works against its own repository: picking one here never
 * touches the Project file tree or the open tabs. The control lives in the
 * Terminal/Git dock header and is only active while the Git window is the
 * visible one.
 */
function RepoSwitch({ store, state }) {
  const t = store.t
  const [anchor, setAnchor] = useState(null)
  const [placement, setPlacement] = useState(null)
  const holderRef = useRef(null)
  const current = typeof state.gitRepoRoot === 'string' ? state.gitRepoRoot : ''
  const enabled = state.layout.bottom === 'git'
  const name = current === '' ? '' : (baseName(current) || current)

  useEffect(() => {
    if (anchor === null) return undefined
    const onDown = (event) => {
      if (event.target instanceof Element && event.target.closest('.iwb-branch-popover, .iwb-branch-switch, .iwb-repo-switch') !== null) return
      setAnchor(null)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [anchor])

  // The dock header sits at the bottom of the workbench: measure the popover
  // once and place it below the button when there is room, above it otherwise.
  useEffect(() => {
    if (anchor === null) return undefined
    const holder = holderRef.current
    if (holder === null) return undefined
    const popover = holder.querySelector('.iwb-branch-popover')
    if (popover === null) return undefined
    const height = popover.getBoundingClientRect().height
    if (!(height > 0)) return undefined
    const below = anchor.bottom + 4
    const top = below + height + 8 <= window.innerHeight
      ? below
      : Math.max(8, anchor.top - height - 4)
    setPlacement({ top })
    return undefined
  }, [anchor])

  return React.createElement(React.Fragment, null,
    React.createElement('button', {
      type: 'button',
      // The base class keeps the Git panel's switcher look; the dock modifier
      // gives this one its own room, so the tab label and the repository name
      // do not run together.
      className: 'iwb-branch-switch iwb-dock-repo',
      disabled: !enabled,
      title: !enabled
        ? label(t, 'git.switchRepoDisabled', 'Only the Git window can switch repositories')
        : (current === '' ? label(t, 'git.pickRepoHint', 'Pick a repository in the Terminal/Git header') : current),
      onClick: event => {
        if (!enabled) return
        const rect = event.currentTarget.getBoundingClientRect()
        const left = Math.max(6, Math.min(rect.left, window.innerWidth - 268))
        setPlacement(null)
        setAnchor({ left, top: rect.top, bottom: rect.bottom })
      },
    },
      React.createElement('span', { className: 'iwb-dock-repo-dot' }),
      React.createElement('span', { className: 'iwb-repo-name' }, name === '' ? label(t, 'git.pickRepo', 'Choose repository') : name),
      React.createElement('span', { className: 'iwb-branch-caret' }, '▾'),
    ),
    anchor !== null
      ? React.createElement('div', {
          ref: holderRef,
          style: { width: 0, height: 0, opacity: placement === null ? 0 : 1 },
        },
          React.createElement(RepoPopover, {
            store, x: anchor.left, y: placement?.top ?? anchor.bottom + 4,
            onClose: () => setAnchor(null),
          }),
        )
      : null,
  )
}

function BottomTabs({ store, state }) {
  const t = store.t
  const tool = state.layout.bottom
  if (tool === null || tool === undefined) return null
  return React.createElement('div', { className: 'iwb-bottom-tabs' },
    React.createElement('button', {
      type: 'button', className: `iwb-bottom-tab ${tool === 'terminal' ? 'iwb-on' : ''}`,
      onClick: () => store.showTool('terminal'),
    },
      React.createElement(IconTerminal, { width: 13, height: 13 }), t('terminal.title'),
      state.terminal.sessions.length > 0 ? React.createElement('span', { className: 'iwb-badge' }, state.terminal.sessions.length) : null,
    ),
    React.createElement('button', {
      type: 'button', className: `iwb-bottom-tab ${tool === 'git' ? 'iwb-on' : ''}`,
      onClick: () => store.showTool('git'),
    }, React.createElement(IconGit, { width: 13, height: 13 }), t('git.title')),
    React.createElement(RepoSwitch, { store, state }),
    React.createElement('button', {
      type: 'button', className: 'iwb-iconbtn iwb-bottom-close', title: t('common.close'),
      onClick: () => store.setLayout({ bottom: null }),
    }, React.createElement('span', { style: { fontSize: 16, lineHeight: 1 } }, '×')),
  )
}

/**
 * How many failed semantic requests make the session "unstable".
 *
 * The host owns the state machine, but it cannot see a request that timed
 * out: only the client knows that the server stopped answering. Three
 * failures (or two timeouts, which is the most typical silent failure) turn
 * the status bar yellow instead of green.
 */
export const LSP_UNSTABLE_FAILURES = 3
export const LSP_UNSTABLE_TIMEOUTS = 2

/**
 * The two numbers of a waited time.
 *
 * The status text of a session that is coming up has to say how long the
 * user has been waiting: a bare "starting…" looked like a hang, because
 * the client froze on it for ten minutes (PRD-v5 §2.4).
 *
 * @param {number} elapsedMs the milliseconds since the session started
 * @returns {{minutes: number, seconds: number}} the two numbers
 */
export function waitedFor(elapsedMs) {
  const value = Number.isFinite(elapsedMs) ? elapsedMs : 0
  const total = Math.max(0, Math.floor(value / 1000))
  return { minutes: Math.floor(total / 60), seconds: total % 60 }
}

/**
 * A waited time as one readable string.
 *
 * The units belong to the language of the interface, so they are a parameter
 * and not a constant: "2 min 14 s" and "2 分 14 秒" say the same thing.
 *
 * @param {number} minutes the whole minutes
 * @param {number} seconds the seconds left
 * @param {'en'|'zh'} [locale] the language of the units
 * @returns {string} "2 min 14 s" / "2 分 14 秒"
 */
export function formatWaited(minutes, seconds, locale = 'en') {
  return locale === 'zh'
    ? `${minutes} 分 ${seconds} 秒`
    : `${minutes} min ${seconds} s`
}

/**
 * Whether a translated text is Chinese.
 *
 * The store does not carry the locale of the interface, but the text does:
 * the Chinese table is Chinese. The status item only needs it to pick the
 * units of the waited time.
 *
 * @param {string} text a translated text
 * @returns {boolean} true for a Chinese text
 */
function isChineseText(text) {
  return /[\u3400-\u9fff]/.test(typeof text === 'string' ? text : '')
}

/**
 * Whether the status bar offers the rebuild button.
 *
 * The conservative mode has no way back on its own: the rebuild button is
 * the difference between "the feature is gone" and "the feature is one
 * click away". A server that was released (`idle`, `suspended`) is
 * recoverable, so the button belongs to those states too (PRD-v5 §1.4).
 *
 * The button is NOT offered to a dead client session: the reconnect button
 * does everything the rebuild button does (the host stops and starts its
 * server) PLUS the client handshake, so showing both would offer two
 * buttons for one problem - and the weaker one first (review R6-1).
 *
 * @param {string} viewKey the key of the status view
 * @param {object} [lsp] the `lsp` slice of the state
 * @returns {boolean} true when the button is shown
 */
export function showRebuildButton(viewKey, lsp = {}) {
  if (lsp.rebuilding === true) return false
  if (lsp.clientState === 'failed') return false
  return ['degraded', 'failed', 'cancelled', 'idle', 'suspended'].includes(viewKey)
}

/**
 * Whether the status bar offers the reconnect button.
 *
 * The rebuild button is the way out of a server that is not there - but the
 * dead CLIENT session is another fault: the host is perfectly healthy, and
 * rebuilding its index would not repair the link between the browser and the
 * server. The two buttons are exclusive: the rebuild button belongs to the
 * states of the host, the reconnect button to the dead session.
 *
 * The button follows the PROBLEM and not the display winner: the red "the
 * session is dead" only wins while the host claims to be fine (the host
 * knows the reason in every other state), but the exit has to be there
 * whenever the session is dead - the greyed menu item points at it ("the
 * semantic analysis session is not ready, reconnect it from the status
 * bar"), and a tooltip that promises a button that is not there is a lie
 * (review R6-1).
 *
 * For a host that has no server at all (`idle`) the reconnect button is
 * exactly the right one: it repeats the handshake AND starts the server, in
 * one click.
 *
 * @param {string} viewKey the key of the status view
 * @param {string} [clientState] the state of the client session
 * @returns {boolean} true when the button is shown
 */
export function showReconnectButton(viewKey, clientState = '') {
  return viewKey === 'sessionFailed' || clientState === 'failed'
}

/**
 * Whether the status bar offers the cancel button.
 *
 * The host can cancel a build that is still starting or restarting, so the
 * button belongs to those states as well - the UI used to withhold a
 * capability the host already had (PRD-v5 §2.4).
 *
 * The argument is the state of the HOST and not the key of the status view:
 * the client session may hide the state of the host behind "connecting…",
 * but the build it waits for can still be cancelled.
 *
 * @param {string} hostState the state the host reports
 * @param {boolean} cancellable whether the host says the build may be cancelled
 * @returns {boolean} true when the button is shown
 */
export function showCancelButton(hostState, cancellable) {
  return cancellable === true && ['building', 'starting', 'restarting'].includes(hostState)
}

/**
 * The numbers of the memory row of the diagnostics panel.
 *
 * "Available" is the memory a new language server may really use - the free
 * memory of the machine minus what the running servers have reserved. It is
 * the number the host judges the start by, so it is the number the panel has
 * to show: the free memory of the machine alone would say "plenty of memory"
 * while the gate says "tight".
 *
 * "Needs" is what the next server would take, and "Reserved" is what the
 * running servers have claimed - their ceiling, not the memory they actually
 * use. The reservation is only shown when there is one: a row that always
 * says "reserved 0 MB" is noise.
 *
 * The panel shows TWO bands (PRD-v5.1 MEM-07): the typical one above ("the
 * server needs 651 MB, the machine has 1206 MB") and the worst one below
 * ("if this server takes its ceiling of 2048 MB, the machine will be left
 * with -842 MB"). One band alone is a promise the machine may not keep: the
 * gate judges the estimate, but the server may grow into its ceiling. The
 * worst band is NOT a rejection - it is the truth, and the machine-level
 * budget (MEM-08) and the pressure valve (MEM-12) are what keep the machine
 * out of the swap.
 *
 * The numbers of the worst band come from the host (`worstCaseBytes`,
 * `ceilingMB`): the client does not compute them a second time, because two
 * sides that compute the same thing differently give the user two different
 * answers.
 *
 * The helper is exported so the numbers can be asserted without mounting the
 * whole dialog.
 *
 * @param {{t: (key: string) => string}} store the workbench store
 * @param {object | null} resources the memory snapshot of the host
 * @returns {{availableMB: number|null, needMB: number|null, reservedMB: number, text: string, worstMB: number|null, worstText: string}}
 */
export function memoryFacts(store, resources) {
  const t = store.t
  if (resources === null || resources === undefined) {
    return { availableMB: null, needMB: null, reservedMB: 0, text: '—', worstMB: null, worstText: '' }
  }
  const mib = 1024 * 1024
  const availableMB = Math.round((resources.availableBytes ?? resources.freeBytes ?? 0) / mib)
  const needMB = Math.round(resources.needMB ?? 0)
  const reservedMB = Math.round((resources.reservedBytes ?? 0) / mib)
  const text = `${t('lsp.diagnostics.memoryAvailable')} ${availableMB} MB · ${t('lsp.diagnostics.memoryNeed')} ${needMB} MB`
    + (reservedMB > 0 ? ` · ${t('lsp.diagnostics.memoryReserved')} ${reservedMB} MB` : '')
  // The worst band: what the machine would be left with if the next server
  // grew into its own ceiling. The number may be negative - that is the
  // point of the band.
  const worstBytes = Number.isFinite(resources.worstCaseBytes) ? resources.worstCaseBytes : null
  const ceilingMB = Number.isFinite(resources.ceilingMB) ? resources.ceilingMB : null
  const worstMB = worstBytes === null ? null : Math.round(worstBytes / mib)
  const worstText = worstMB === null || ceilingMB === null
    ? ''
    : interpolate(t('lsp.diagnostics.memoryWorstText'), { ceiling: ceilingMB, left: worstMB })
  return { availableMB, needMB, reservedMB, text, worstMB, worstText }
}

/**
 * The host states in which the client session shows "connecting…".
 *
 * Only "ready" and "building": the label of "starting" and "restarting"
 * carries the elapsed time (PRD-v5 §2.4), and the client session cannot be
 * ready during them anyway - the language server is not up yet.
 */
const HOST_CONNECTING_STATES = ['ready', 'building']

/**
 * How long the session has been coming up.
 *
 * The host stamps the start of the session *before* it moves to "starting",
 * so the elapsed time is real while the server comes up (PRD-v5 §2.4).
 *
 * @param {object} lsp the `lsp` slice of the state
 * @returns {{minutes: number, seconds: number}|null} the two numbers, or
 *   `null` when the host stamped no start
 */
function waitedSince(lsp) {
  const startedAt = typeof lsp?.startedAt === 'number' && lsp.startedAt > 0 ? lsp.startedAt : 0
  if (startedAt === 0) return null
  return waitedFor(Date.now() - startedAt)
}

/**
 * The semantic-analysis status of the workbench (PRD-v5 §4.3).
 *
 * The host owns the state machine; this only maps it to a label, a tone and
 * an optional action. The tone picks the colour class of the status item, and
 * the action says what a click on it does.
 *
 * Two sources are combined: the state the host reports and the health the
 * client measured. A server that says "ready" while every semantic request
 * fails is not ready - that mismatch is exactly what the user reported.
 *
 * A third source is the state of the CLIENT session: the host says that the
 * language server process is up, the client says whether the link between
 * the browser and the server works. The two never check each other, and the
 * status bar believed the host: it said "ready" while the semantic features
 * were completely dead (the menu was greyed out and the hovering did
 * nothing). The state of the client therefore wins over a host that claims
 * to be fine - the states "starting", "building", "ready" and "restarting".
 *
 * It does NOT win over a host that knows the real reason: "idle" and
 * "disabled" mean that nobody can fail at all (there is no language server),
 * and "degraded", "crashed", "suspended", "cancelled" and "failed" come with
 * an explanation of the host that is more useful than "the session is dead"
 * (review P1-2).
 *
 * The mapping is exported so the tests can assert the seven states without
 * mounting the whole workbench.
 *
 * @param {{t: (key: string) => string}} store
 * @param {object} state the workbench snapshot
 * @returns {{key: string, text: string, tone: 'idle'|'warn'|'ok'|'error', title: string, detail: string, action: string|null}}
 */
export function lspStatusView(store, state) {
  const t = store.t
  const lsp = state?.lsp ?? {}
  const settingsLsp = state?.settings?.lsp ?? {}
  const language = typeof lsp.languageId === 'string' ? lsp.languageId : ''
  const current = typeof lsp.state === 'string' && lsp.state !== '' ? lsp.state : 'idle'
  const detail = typeof lsp.detail === 'string' ? lsp.detail : ''
  const base = { title: t('lsp.statusTitle'), detail, action: null }
  // A poll that failed leaves the client with a value that may be minutes
  // old. Showing that value is exactly what made the status bar lie - it
  // froze on "starting" long after the host was gone - so the stale flag
  // wins over every other state (PRD-v5 §2.3).
  if (state?.lspStatusStale === true) {
    return { ...base, key: 'unknown', text: t('lsp.status.unknown'), tone: 'idle' }
  }
  if (settingsLsp.enabled === false || lsp.enabled === false || current === 'disabled') {
    return { ...base, key: 'disabled', text: t('lsp.status.disabled'), tone: 'idle' }
  }
  // The state of the client session. It is checked after the stale flag and
  // after the "switched off" state - a feature that is off is not "not
  // connected", and a stale snapshot is not "not connected" either.
  const clientState = typeof lsp.clientState === 'string' ? lsp.clientState : ''
  const clientDetail = typeof lsp.clientDetail === 'string' ? lsp.clientDetail : ''
  // A language without a server is a different state than a failing server:
  // the user has to install something, so the item points at the settings.
  // A language that the user switched off is not missing: it is installed
  // and simply off, and announcing it as "not installed" would send the
  // user after something that is already there.
  const missing = (lsp.servers?.missing ?? []).filter(entry => typeof entry?.languageId === 'string' && entry.enabled !== false)
  const missingHere = missing.find(entry => entry.languageId === language)
  // The host reports the language of the running session; without a session
  // it stays empty, so a single language without a server is used as the
  // name of the state.
  const missingOnly = missingHere ?? (missing.length === 1 ? missing[0] : undefined)
  if (missingOnly !== undefined && current !== 'ready' && current !== 'building' && current !== 'starting') {
    return {
      ...base,
      key: 'missing',
      text: interpolate(t('lsp.status.missing'), { language: missingOnly.languageId }),
      tone: 'idle',
      action: 'settings',
      title: interpolate(t('lsp.serverMissing'), { language: missingOnly.languageId }),
    }
  }
  // The state of the client session wins over a host that claims to be fine:
  // a dead session means that the semantic features do not work, whatever the
  // host says about its process. It does NOT win over a host that knows the
  // real reason - "idle" means that nobody can fail, and "degraded",
  // "crashed" or "suspended" come with an explanation of the host that is
  // more useful than "the session is dead" (review P1-2).
  //
  // The language that is not installed is the one exception above - that
  // message tells the user what to do, and a reconnect cannot install a
  // server.
  if (clientState === 'failed' && LSP_HOST_HEALTHY_STATES.includes(current)) {
    return {
      ...base,
      key: 'sessionFailed',
      text: t('lsp.status.sessionFailed'),
      tone: 'error',
      action: 'diagnostics',
      // The reason of the failure is the one thing the user cannot guess.
      detail: clientDetail === '' ? base.detail : clientDetail,
    }
  }
  if (clientState === 'starting' && HOST_CONNECTING_STATES.includes(current)) {
    // The host says the process is up (or is building the index), but the
    // handshake is not resolved yet: the features are not usable, so "ready"
    // would be a lie - and while the host builds the index, a false
    // "everything is fine" is most likely (review P3-4).
    //
    // The host's own text goes into the tooltip: the label of the client
    // would swallow it, and what the host is doing (or how long the user has
    // been waiting for it) is exactly what the user wants to know.
    //
    // The states "starting" and "restarting" keep the label of the host: it
    // carries the elapsed time (PRD-v5 §2.4), and the client session cannot
    // be ready during them anyway.
    const waited = waitedSince(lsp)
    const waitedText = waited === null
      ? ''
      : formatWaited(waited.minutes, waited.seconds, isChineseText(t('lsp.status.sessionConnecting')) ? 'zh' : 'en')
    const hostText = current === 'building' ? t('lsp.status.building') : ''
    return {
      ...base,
      key: 'sessionConnecting',
      text: t('lsp.status.sessionConnecting'),
      tone: 'idle',
      detail: base.detail === '' ? (waitedText !== '' ? waitedText : hostText) : base.detail,
    }
  }
  // The health the client measured. It only matters while the server claims
  // to be ready.
  const failures = Number.isFinite(lsp.consecutiveFailures) ? lsp.consecutiveFailures : 0
  const timeouts = Number.isFinite(lsp.consecutiveTimeouts) ? lsp.consecutiveTimeouts : 0
  switch (current) {
    case 'starting':
    case 'restarting': {
      // The host stamps the start of the session *before* it moves to
      // "starting", so the elapsed time is real while the server comes up
      // (PRD-v5 §2.4).
      const waited = waitedSince(lsp)
      if (waited === null) {
        // Without a start time there is nothing to count: the plain text
        // says what the host is doing.
        const plain = current === 'starting' ? t('lsp.status.starting') : t('lsp.status.restarting')
        return { ...base, key: current, text: plain, tone: 'idle' }
      }
      const template = current === 'starting' ? t('lsp.status.startingWait') : t('lsp.status.restartingWait')
      return {
        ...base,
        key: current,
        text: interpolate(template, { minutes: waited.minutes, seconds: waited.seconds }),
        tone: 'idle',
        // The tooltip says how long the user waits when the host says
        // nothing about it.
        detail: base.detail === ''
          ? formatWaited(waited.minutes, waited.seconds, isChineseText(template) ? 'zh' : 'en')
          : base.detail,
      }
    }
    case 'building':
      return { ...base, key: 'building', text: t('lsp.status.building'), tone: 'warn' }
    case 'cancelling':
      // The host owns the transition; the label tells the user the build is
      // on its way out. `lsp.status.cancelling` is used when the locale table
      // carries it.
      return {
        ...base,
        key: 'cancelling',
        text: label(t, 'lsp.status.cancelling', t('lsp.status.cancelled')),
        tone: 'idle',
      }
    case 'ready':
      // "Ready" is ready. An incremental update runs inside the language
      // server and it reports nothing about it, so there is no state to show
      // here - the `progress` value belongs to a build and the store clears it
      // when the build ends. Showing "updating" on a leftover value kept the
      // status bar at that text forever.
      if (failures >= LSP_UNSTABLE_FAILURES || timeouts >= LSP_UNSTABLE_TIMEOUTS) {
        // The server is up but the semantic requests do not answer. Saying
        // "ready" here is what made the failure invisible.
        const text = timeouts >= LSP_UNSTABLE_TIMEOUTS
          ? interpolate(t('lsp.status.unstableTimeout'), { count: timeouts })
          : interpolate(t('lsp.status.unstable'), { count: failures })
        return { ...base, key: 'unstable', text, tone: 'warn', action: 'diagnostics' }
      }
      // The host says the program of the project is still being built. The
      // session state says "ready" about ten milliseconds after the server
      // answered `initialize`, while the build happens minutes later - on the
      // first semantic request. Saying "ready" here left the user in front of
      // a hanging editor with a green dot and no idea what it waited for
      // (review T7). The failing server above is more important than the
      // build, so the unstable state wins.
      if (lsp.buildingProgram === true) {
        return { ...base, key: 'buildingProgram', text: t('lsp.status.buildingProgram'), tone: 'warn' }
      }
      return { ...base, key: 'ready', text: t('lsp.status.ready'), tone: 'ok' }
    case 'crashed':
      return { ...base, key: 'crashed', text: t('lsp.status.crashed'), tone: 'error', action: 'crash' }
    case 'cancelled':
      return { ...base, key: 'cancelled', text: t('lsp.status.cancelled'), tone: 'warn', action: 'diagnostics' }
    case 'degraded':
      // The conservative mode is not the normal state: it looks exactly like
      // the grey dot of an idle workbench, so the user could not see that the
      // semantic features were gone.
      return { ...base, key: 'degraded', text: t('lsp.status.degraded'), tone: 'warn', action: 'diagnostics' }
    case 'failed':
      // The server could not be started at all: that is a fault, and it has
      // to look like one - a red dot, not the quiet yellow of the basic mode.
      return { ...base, key: 'failed', text: t('lsp.status.failed'), tone: 'error', action: 'diagnostics' }
    case 'idle':
      // No server runs at all. Nothing is broken: the workbench is in its
      // basic mode and says so.
      //
      // When the USER chose the basic mode for this project, the status says
      // so as well (PRD-v5.1 WS-04): a grey dot with "not enabled" and no
      // reason reads like a broken feature, and the user has no way back
      // from it without knowing that the choice was theirs.
      if (typeof store.lspWorkspaceDefault === 'function'
        && store.lspWorkspaceDefault(state?.root) === 'conservative') {
        return {
          ...base,
          key: 'workspaceOff',
          text: t('lsp.status.workspaceOff'),
          tone: 'idle',
          action: 'diagnostics',
          detail: t('lsp.workspaceOffHint'),
        }
      }
      return { ...base, key: 'idle', text: t('lsp.status.idle'), tone: 'idle', action: 'diagnostics' }
    case 'suspended':
      // The host released the server to give the memory back (PRD-v5 §1.2).
      // That is a deliberate act and not a fault: a grey dot, and the
      // rebuild button right next to it.
      return { ...base, key: 'suspended', text: t('lsp.status.suspended'), tone: 'idle', action: 'diagnostics' }
    default:
      // An unknown state is treated like an idle one: the workbench keeps
      // its basic mode, and nothing pretends that something broke.
      return { ...base, key: 'idle', text: t('lsp.status.idle'), tone: 'idle', action: 'diagnostics' }
  }
}

/**
 * The semantic-analysis item of the status bar (PRD-v5 §4.3, §7.1).
 *
 * The item is always visible: a missing capability has to be visible, not
 * hidden. The dot carries the state by its colour, and the label folds away
 * in a narrow pane (risk #25) — the stylesheet owns that part.
 *
 * The item is also the way back into the semantic features: a degraded or
 * crashed session opens the diagnostics panel, and the panel can rebuild the
 * index (MEM-03, MEM-04).
 */
function LspStatus({ store, state, onOpenSettings, onOpenDiagnostics }) {
  const t = store.t
  const lsp = state.lsp ?? {}
  const view = lspStatusView(store, state)
  const cancelAfter = state.settings?.lsp?.cancelAfterMs ?? 60000
  const startedAt = typeof lsp.startedAt === 'number' ? lsp.startedAt : 0
  const cancellable = lsp.cancellable === true
    || (startedAt > 0 && Date.now() - startedAt > cancelAfter)
  // The cancel button follows the state of the HOST: the client session may
  // hide that state behind "connecting…", but the build it waits for can
  // still be cancelled.
  const showCancel = showCancelButton(lsp.state, cancellable)
  // The conservative mode has no way back on its own: the rebuild button is
  // the difference between "the feature is gone" and "the feature is one
  // click away". A released server (idle, suspended) is recoverable, so it
  // gets the same button (PRD-v5 §1.4).
  const showRebuild = showRebuildButton(view.key, lsp)
  // The dead client session has a way out of its own: rebuilding the index
  // of a healthy server would not repair the link between the browser and
  // the server. The two buttons are exclusive.
  //
  // The reconnect button follows the dead session and not the key of the
  // status view: the host may own the wording of the status bar, but the
  // exit has to be there whenever the session is dead - the greyed menu
  // item points at it (review R6-1).
  const showReconnect = showReconnectButton(view.key, lsp.clientState)
  const tone = view.tone === 'ok' ? ' iwb-lsp-status-ready'
    : (view.tone === 'warn' ? ' iwb-lsp-status-warn' : (view.tone === 'error' ? ' iwb-lsp-status-error' : ' iwb-lsp-status-muted'))
  const title = view.detail === '' ? view.title : `${view.title} — ${view.detail}`
  const onClick = view.action === 'settings'
    ? () => { onOpenSettings?.() }
    : (view.action === 'crash' ? () => { store.toast('error', t('lsp.crashedToast'), view.detail) }
      : (view.action === 'diagnostics' ? () => { onOpenDiagnostics?.() } : undefined))
  return React.createElement('span', {
    className: `iwb-status-item iwb-lsp-status${tone}`,
    title,
    'data-lsp-state': view.key,
    style: onClick === undefined ? undefined : { cursor: 'pointer' },
    onClick,
  },
    React.createElement('span', { className: 'iwb-lsp-status-dot' }),
    React.createElement('span', { className: 'iwb-lsp-status-label' }, view.text),
    // The cancel button only appears while a build runs longer than the
    // configured patience (PRD-v5 §2.4).
    showCancel
      ? React.createElement('button', {
          type: 'button',
          className: 'iwb-lsp-cancel',
          title: t('lsp.cancelIndex'),
          onClick: event => {
            event.stopPropagation()
            void store.cancelLspIndex()
          },
        }, t('lsp.cancelIndex'))
      : null,
    showRebuild
      ? React.createElement('button', {
          type: 'button',
          className: 'iwb-lsp-cancel',
          title: t('lsp.rebuildIndex'),
          onClick: event => {
            event.stopPropagation()
            void store.restartLsp()
          },
        }, t('lsp.rebuildIndex'))
      : null,
    showReconnect
      ? React.createElement('button', {
          type: 'button',
          className: 'iwb-lsp-cancel',
          title: t('lsp.reconnect'),
          onClick: event => {
            event.stopPropagation()
            void store.reconnectLsp()
          },
        }, t('lsp.reconnect'))
      : null,
    lsp.rebuilding === true
      ? React.createElement('span', { className: 'iwb-lsp-status-label' }, t('lsp.diagnostics.rebuilding'))
      : null,
  )
}

function StatusBar({ store, state, onOpenSettings, onOpenDiagnostics }) {
  const t = store.t
  const summary = store.summary()
  const active = state.tabs.find(tab => tab.id === state.activeId)
  const text = active?.payload?.kind === 'text' ? active.payload : undefined
  const lines = text !== undefined && typeof text.content === 'string'
    ? text.content.split('\n').length
    : undefined
  const encoding = text === undefined
    ? undefined
    : text.encoding === 'utf-8-bom'
      ? 'UTF-8 BOM'
      : text.encoding === 'utf-16le'
        ? 'UTF-16 LE'
        : text.encoding === 'utf-16be'
          ? 'UTF-16 BE'
          : 'UTF-8'
  const eol = text === undefined ? undefined : (text.eol === '\r\n' ? 'CRLF' : 'LF')
  const cursor = state.cursor !== null && state.cursor !== undefined && active?.editing === true ? state.cursor : null
  return React.createElement('div', { className: 'iwb-statusbar' },
    React.createElement('span', { className: 'iwb-status-item' },
      React.createElement('span', { className: `iwb-status-dot ${state.statusError !== null ? 'iwb-busy' : ''}` }),
      state.status.isRepo === true ? t('status.ready') : t('welcome.noRepo'),
    ),
    summary.branch !== undefined
      ? React.createElement('span', { className: 'iwb-status-item', style: { cursor: 'pointer' }, onClick: () => store.showTool('git') }, summary.branch)
      : null,
    summary.changes > 0
      ? React.createElement('span', { className: 'iwb-status-item', style: { cursor: 'pointer' }, onClick: () => store.showTool('commit') }, `${summary.changes} ${t('status.changes')}`)
      : null,
    // The semantic-analysis state sits next to the other status items, before
    // the spacer: it must be visible even when the workbench is idle.
    React.createElement(LspStatus, { store, state, onOpenSettings, onOpenDiagnostics }),
    React.createElement('div', { className: 'iwb-spacer' }),
    cursor !== null
      ? React.createElement('span', { className: 'iwb-status-item' }, `${t('editor.line')} ${cursor.line}:${cursor.col}`)
      : null,
    lines !== undefined
      ? React.createElement('span', { className: 'iwb-status-item' }, `${lines} ${t('editor.lines')}`)
      : null,
    encoding !== undefined
      ? React.createElement('span', { className: 'iwb-status-item' }, `${encoding} ${eol}`)
      : null,
    React.createElement('span', { className: 'iwb-status-item' },
      React.createElement(Kbd, null, state.settings?.shortcuts?.project ?? 'Alt+1'),
      React.createElement('span', { style: { marginLeft: 4 } }, t('project.title')),
    ),
    React.createElement('span', { className: 'iwb-status-item' },
      React.createElement(Kbd, null, state.settings?.shortcuts?.terminal ?? 'Alt+F12'),
      React.createElement('span', { style: { marginLeft: 4 } }, t('terminal.title')),
    ),
  )
}

function RootPicker({ store, state }) {
  const t = store.t
  const [path, setPath] = useState('')
  if (state.rootPicker !== true) return null
  return React.createElement('div', { className: 'iwb-modal-backdrop', onMouseDown: event => { if (event.target === event.currentTarget) store.closeRootPicker() } },
    React.createElement('div', { className: 'iwb-modal', role: 'dialog', 'aria-modal': 'true' },
      React.createElement('h2', null, t('project.openWorkspace')),
      React.createElement('div', { className: 'iwb-root-picker' },
        React.createElement('div', { className: 'iwb-root-list' },
          state.workspaces.map(workspace => React.createElement('button', {
            key: workspace.path,
            type: 'button',
            className: 'iwb-root-item',
            onClick: () => { store.closeRootPicker(); void store.setRoot(workspace.path) },
          },
            React.createElement(StripeIcon, { tool: 'project', size: 16 }),
            React.createElement('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
              React.createElement('b', null, workspace.title),
              React.createElement('span', { className: 'iwb-root-path' }, workspace.path),
            ),
          )),
        ),
        React.createElement('div', { style: { display: 'flex', gap: 8, marginTop: 4 } },
          React.createElement('input', {
            className: 'iwb-input',
            style: { flex: 1, width: 'auto' },
            placeholder: t('project.workspacePath'),
            value: path,
            onChange: event => setPath(event.target.value),
            onKeyDown: event => { if (event.key === 'Enter' && path.trim() !== '') { void store.addWorkspace(path.trim()) } },
          }),
          React.createElement('button', {
            type: 'button', className: 'iwb-textbtn iwb-primary', disabled: path.trim() === '',
            onClick: () => { void store.addWorkspace(path.trim()) },
          }, t('common.open')),
        ),
      ),
      React.createElement('div', { className: 'iwb-modal-actions', style: { marginTop: 16 } },
        React.createElement('button', { type: 'button', className: 'iwb-textbtn', onClick: () => store.closeRootPicker() }, t('common.cancel')),
      ),
    ),
  )
}

function ProjectPicker({ store, state }) {
  const t = store.t
  if (state.projectPicker !== true) return null
  const projects = Array.isArray(state.projects) ? state.projects : []
  const root = projects.filter(project => project.isRoot === true)
  const children = projects.filter(project => project.isRoot !== true)
  /**
   * The badge of one project (PRD-v5.1 CONC-05).
   *
   * `indexedRoots` is a historical fact: the folder completed a first build
   * at some point in this profile. The badge said "indexed" even after the
   * server was reclaimed - and the user read that as "the index is there",
   * while a rebuild costs another full build. The two states are therefore
   * distinguished: a server that runs now says "indexed", a reclaimed one
   * says "indexed (reclaimed)" - in grey, because a reclaimed server is a
   * deliberate act of the host and not a failure.
   * @param {{path: string, indexState?: string}} project
   * @returns {any} the badge, or null
   */
  const indexBadge = project => {
    const badge = typeof store.indexBadgeState === 'function' ? store.indexBadgeState(project) : null
    if (badge === 'indexed') {
      return React.createElement('span', { className: 'iwb-project-index-badge', title: t('project.indexedHint') }, t('project.indexed'))
    }
    if (badge === 'indexed-reclaimed') {
      // The grey tone of a released server - not the yellow of a failure.
      return React.createElement('span', {
        className: 'iwb-project-index-badge iwb-project-index-badge-reclaimed',
        title: t('project.indexedReclaimedHint'),
      }, t('project.indexedReclaimed'))
    }
    return null
  }
  const choice = project => React.createElement('button', {
    key: project.path,
    type: 'button',
    className: `iwb-project-choice ${project.path === state.root ? 'iwb-current' : ''}`,
    title: project.path,
    onClick: () => { void store.selectProject(project.path) },
  },
    React.createElement('span', { className: 'iwb-project-choice-icon' },
      project.isRepo === true
        ? React.createElement(IconGit, { width: 15, height: 15 })
        : React.createElement(FileTypeIcon, { kind: 'folder', size: 15 }),
    ),
    React.createElement('span', { className: 'iwb-project-choice-text' },
      React.createElement('b', null, project.name),
      React.createElement('span', { className: 'iwb-project-choice-path' }, project.path),
    ),
    project.isRepo === true
      ? React.createElement('span', { className: 'iwb-project-repo-badge' }, t('project.gitRepo'))
      : null,
    // The badge order is fixed: [Git] → [Indexed] → [Current]. The three can
    // coexist; none of them replaces another (PRD-v5 §2.1).
    indexBadge(project),
    project.path === state.root
      ? React.createElement('span', { className: 'iwb-project-current-badge' }, t('project.current'))
      : null,
  )
  return React.createElement('div', {
    className: 'iwb-modal-backdrop',
    onMouseDown: event => { if (event.target === event.currentTarget) store.closeProjectPicker() },
  },
    React.createElement('div', {
      className: 'iwb-modal iwb-project-picker', role: 'dialog', 'aria-modal': 'true',
    },
      React.createElement('h2', null, t('project.selectProject')),
      React.createElement('p', { className: 'iwb-modal-hint' }, t('project.selectProjectHint')),
      React.createElement('div', { className: 'iwb-project-picker-list' },
        React.createElement('div', { className: 'iwb-project-group' }, t('project.workspaceRoot')),
        ...root.map(choice),
        React.createElement('div', { className: 'iwb-project-group' }, t('project.subdirectories')),
        children.length === 0
          ? React.createElement('div', { className: 'iwb-project-empty' }, t('project.noSubdirectories'))
          : children.map(choice),
      ),
      React.createElement('div', { className: 'iwb-modal-actions' },
        React.createElement('button', {
          type: 'button', className: 'iwb-textbtn',
          onClick: () => { void store.loadProjects() },
        }, React.createElement(IconRefresh, { width: 12, height: 12 }), t('project.refreshProjects')),
        React.createElement('button', {
          type: 'button', className: 'iwb-textbtn', onClick: () => store.closeProjectPicker(),
        }, t('common.cancel')),
      ),
    ),
  )
}

/**
 * How long the first build of a language server takes, as a coarse estimate.
 *
 * The real time depends on the size of the project, so the estimate is only
 * used to set the expectation: "about 1-2 minutes" is honest, "exactly 87
 * seconds" is a lie.
 * @param {number} baselineMB the estimated memory need of the server
 * @returns {string} an i18n key
 */
function buildTimeKey(baselineMB) {
  if (baselineMB <= 96) return 'index.decision.time.under1'
  if (baselineMB <= 320) return 'index.decision.time.1to2'
  if (baselineMB <= 768) return 'index.decision.time.2to5'
  return 'index.decision.time.5to10'
}

/**
 * The display name of a language id.
 *
 * The host speaks language ids (`typescript`), the user reads names
 * (`TypeScript`).
 * @param {string} languageId the language id
 * @returns {string} the name, or the id itself when it is unknown
 */
export function languageLabel(languageId) {
  const id = typeof languageId === 'string' ? languageId : ''
  const names = {
    typescript: 'TypeScript',
    typescriptreact: 'TypeScript React',
    javascript: 'JavaScript',
    javascriptreact: 'JavaScript React',
    python: 'Python',
    yaml: 'YAML',
    java: 'Java',
    go: 'Go',
    rust: 'Rust',
    c: 'C',
    cpp: 'C++',
  }
  return names[id] ?? id
}

/**
 * The index decision dialog (PRD-v5 §2.3).
 *
 * It is the only modal of the semantic-analysis flow: it appears before the
 * language server starts, never while a build runs (PRD-v5 §7.2). `Esc` and a
 * click on the backdrop are "cancel" — the project stays as it is.
 *
 * The wording does not promise an index *file*: "building an index" means
 * starting the language server and waiting for its first program build, and
 * the dialog says so (THEME-04).
 */
function IndexDecisionModal({ store, state }) {
  const t = store.t
  const decision = state.indexDecision
  useEffect(() => {
    if (decision === null || decision === undefined) return undefined
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      store.resolveIndexDecision('cancel')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [decision, store])
  if (decision === null || decision === undefined) return null
  const name = typeof decision.name === 'string' ? decision.name : ''
  const isRoot = decision.isRoot === true
  const isRepo = decision.isRepo === true
  const language = typeof decision.language === 'string' ? languageLabel(decision.language) : ''
  // The estimate comes from the memory model of the host (MEM-01). The
  // language is not always known: a project without a marker file has none.
  const needMB = Number.isFinite(decision.needMB) ? decision.needMB : 0
  const time = interpolate(t(buildTimeKey(needMB)), {})
  const title = interpolate(t('index.decision.title'), { name })
  // One sentence: what starts, and how long it takes. The memory is in the
  // settings page and in the memory warning - repeating it here only made
  // the dialog talk about the same thing twice.
  const body = language === ''
    ? interpolate(t('index.decision.bodyUnknown'), { time })
    : interpolate(t('index.decision.body'), { language, time })
  return React.createElement('div', {
    className: 'iwb-modal-backdrop',
    onMouseDown: event => { if (event.target === event.currentTarget) store.resolveIndexDecision('cancel') },
  },
    React.createElement('div', {
      className: 'iwb-modal iwb-index-decision', role: 'dialog', 'aria-modal': 'true', 'aria-label': title,
    },
      React.createElement('div', { className: 'iwb-modal-head' },
        React.createElement('h2', null, title),
        React.createElement('button', {
          type: 'button', className: 'iwb-iconbtn', title: t('common.close'), 'aria-label': t('common.close'),
          onClick: () => store.resolveIndexDecision('cancel'),
        }, React.createElement('span', { style: { fontSize: 17, lineHeight: 1 } }, '×')),
      ),
      React.createElement('p', { className: 'iwb-modal-hint' }, body),
      // The workspace root carries the extra warning: it usually holds
      // several independent repositories, and one program over all of them
      // costs a lot of memory and build time.
      isRoot
        ? React.createElement('div', { className: 'iwb-index-decision-warning' },
            React.createElement('div', { className: 'iwb-index-decision-warning-title' }, t('index.decision.rootTitle')),
            React.createElement('div', null, isRepo ? t('index.decision.rootRepo') : t('index.decision.rootWarning')),
          )
        : null,
      React.createElement('div', { className: 'iwb-modal-actions' },
        // In the workspace root there is no recommended option: all three
        // buttons have the same weight. A "not recommended" option must not
        // be the primary button (THEME-04).
        isRoot
          ? React.createElement('button', {
              type: 'button', className: 'iwb-textbtn',
              onClick: () => store.resolveIndexDecision('build'),
            }, t('index.decision.buildRoot'))
          : React.createElement('button', {
              type: 'button', className: 'iwb-textbtn iwb-primary',
              onClick: () => store.resolveIndexDecision('build'),
            }, t('index.decision.build')),
        React.createElement('button', {
          type: 'button', className: 'iwb-textbtn',
          title: t('index.decision.conservativeHint'),
          onClick: () => store.resolveIndexDecision('conservative'),
        }, t('index.decision.conservative')),
        // "Cancel the switch" is the third way out. Without it the user had
        // no choice but to switch the project.
        React.createElement('button', {
          type: 'button', className: 'iwb-textbtn',
          title: t('index.decision.cancelHint'),
          onClick: () => store.resolveIndexDecision('cancel'),
        }, t('index.decision.cancel')),
      ),
    ),
  )
}

/**
 * The memory warning (MEM-02).
 *
 * The host refuses to start a language server on a tight memory budget
 * unless the start is forced. This dialog is the place where the user
 * decides: the machine is short on memory, and the language server is the
 * thing that needs it.
 */
function MemoryDecisionModal({ store, state }) {
  const t = store.t
  const decision = state.memoryDecision
  useEffect(() => {
    if (decision === null || decision === undefined) return undefined
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      store.resolveMemoryDecision('conservative')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [decision, store])
  if (decision === null || decision === undefined) return null
  const language = typeof decision.language === 'string' ? languageLabel(decision.language) : ''
  // Two numbers and a question - the warning has to be short, it is read
  // at the moment the project is switched.
  const body = language === ''
    ? interpolate(t('lsp.memoryWarn.bodyUnknown'), {
        free: decision.freeMB ?? 0,
        need: decision.needMB ?? 0,
      })
    : interpolate(t('lsp.memoryWarn.body'), {
        free: decision.freeMB ?? 0,
        need: decision.needMB ?? 0,
        language,
      })
  return React.createElement('div', {
    className: 'iwb-modal-backdrop',
    onMouseDown: event => { if (event.target === event.currentTarget) store.resolveMemoryDecision('conservative') },
  },
    React.createElement('div', {
      className: 'iwb-modal iwb-index-decision', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('lsp.memoryWarn.title'),
    },
      React.createElement('div', { className: 'iwb-modal-head' },
        React.createElement('h2', null, t('lsp.memoryWarn.title')),
        React.createElement('button', {
          type: 'button', className: 'iwb-iconbtn', title: t('common.close'), 'aria-label': t('common.close'),
          onClick: () => store.resolveMemoryDecision('conservative'),
        }, React.createElement('span', { style: { fontSize: 17, lineHeight: 1 } }, '×')),
      ),
      React.createElement('p', { className: 'iwb-modal-hint' }, body),
      React.createElement('div', { className: 'iwb-modal-actions' },
        React.createElement('button', {
          type: 'button', className: 'iwb-textbtn iwb-primary',
          onClick: () => store.resolveMemoryDecision('start'),
        }, t('lsp.memoryWarn.start')),
        React.createElement('button', {
          type: 'button', className: 'iwb-textbtn',
          title: t('lsp.memoryWarn.conservativeHint'),
          onClick: () => store.resolveMemoryDecision('conservative'),
        }, t('lsp.memoryWarn.conservative')),
      ),
    ),
  )
}

/**
 * The diagnostics panel of the semantic analysis (MEM-03).
 *
 * It answers the question the status bar cannot: what does the server say,
 * what failed last, how much memory is left, and what can be done about it.
 */
export function LspDiagnosticsModal({ store, state, onOpenSettings, onClose }) {
  const t = store.t
  const lsp = state.lsp ?? {}
  const resources = lsp.resources ?? null
  const failures = Number.isFinite(lsp.consecutiveFailures) ? lsp.consecutiveFailures : 0
  const timeouts = Number.isFinite(lsp.consecutiveTimeouts) ? lsp.consecutiveTimeouts : 0
  const lastFailure = lsp.lastFailure ?? null
  const view = lspStatusView(store, state)
  // The numbers of the memory row: what is available, what the next server
  // needs, what the running servers have reserved - and what the machine
  // would be left with if the next server grew into its ceiling (MEM-07).
  const memory = memoryFacts(store, resources)
  const memoryText = memory.text
  return React.createElement('div', {
    className: 'iwb-modal-backdrop',
    onMouseDown: event => { if (event.target === event.currentTarget) onClose() },
  },
    React.createElement('div', {
      className: 'iwb-modal iwb-lsp-diagnostics', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('lsp.diagnostics.title'),
    },
      React.createElement('div', { className: 'iwb-modal-head' },
        React.createElement('h2', null, t('lsp.diagnostics.title')),
        React.createElement('button', {
          type: 'button', className: 'iwb-iconbtn', title: t('common.close'), 'aria-label': t('common.close'),
          onClick: onClose,
        }, React.createElement('span', { style: { fontSize: 17, lineHeight: 1 } }, '×')),
      ),
      React.createElement('div', { className: 'iwb-lsp-diagnostics-body' },
        React.createElement('div', { className: 'iwb-lsp-diagnostics-row' },
          React.createElement('span', { className: 'iwb-lsp-diagnostics-key' }, t('lsp.diagnostics.state')),
          React.createElement('span', { className: 'iwb-lsp-diagnostics-value' }, view.text),
        ),
        React.createElement('div', { className: 'iwb-lsp-diagnostics-row' },
          React.createElement('span', { className: 'iwb-lsp-diagnostics-key' }, t('lsp.diagnostics.health')),
          React.createElement('span', { className: 'iwb-lsp-diagnostics-value' },
            failures === 0 && timeouts === 0
              ? t('lsp.diagnostics.healthy')
              : `${failures} / ${timeouts}`,
          ),
        ),
        React.createElement('div', { className: 'iwb-lsp-diagnostics-row' },
          React.createElement('span', { className: 'iwb-lsp-diagnostics-key' }, t('lsp.diagnostics.lastFailure')),
          React.createElement('span', { className: 'iwb-lsp-diagnostics-value' },
            lastFailure === null
              ? t('lsp.diagnostics.noFailure')
              : `${lastFailure.message ?? ''} (${new Date(lastFailure.at ?? 0).toLocaleTimeString()})`,
          ),
        ),
        // The reason the host reported. The toast says «the details are in the
        // diagnostics panel» - so the panel has to carry them. It is the
        // technical sentence of the host (the host has no locale), and it is
        // the only place where the exact reason is readable.
        typeof lsp.detail === 'string' && lsp.detail !== ''
          ? React.createElement('div', { className: 'iwb-lsp-diagnostics-row' },
              React.createElement('span', { className: 'iwb-lsp-diagnostics-key' }, t('lsp.diagnostics.reason')),
              React.createElement('span', { className: 'iwb-lsp-diagnostics-value' }, lsp.detail),
            )
          : null,
        React.createElement('div', { className: 'iwb-lsp-diagnostics-row' },
          React.createElement('span', { className: 'iwb-lsp-diagnostics-key' }, t('lsp.diagnostics.memory')),
          React.createElement('span', { className: 'iwb-lsp-diagnostics-value', title: t('lsp.diagnostics.memoryHint') }, memoryText),
        ),
        // The worst band (PRD-v5.1 MEM-07). The row above is the typical
        // case; this one says what happens if the server grows into its
        // ceiling. It is a fact, not a rejection: the budget of the machine
        // (MEM-08) and the pressure valve (MEM-12) are what keep the machine
        // out of the swap.
        memory.worstText === ''
          ? null
          : React.createElement('div', { className: 'iwb-lsp-diagnostics-row' },
              React.createElement('span', { className: 'iwb-lsp-diagnostics-key' }, t('lsp.diagnostics.memoryWorstCase')),
              React.createElement('span', {
                className: 'iwb-lsp-diagnostics-value',
                title: t('lsp.diagnostics.memoryWorstHint'),
              }, memory.worstText),
            ),
        React.createElement('div', { className: 'iwb-lsp-diagnostics-row' },
          React.createElement('span', { className: 'iwb-lsp-diagnostics-key' }, t('lsp.diagnostics.stderr')),
          React.createElement('pre', { className: 'iwb-lsp-diagnostics-logs' },
            (lsp.stderrLines ?? []).length === 0
              ? t('lsp.diagnostics.noLogs')
              : (lsp.stderrLines ?? []).slice(-20).join('\n'),
          ),
        ),
      ),
      React.createElement('div', { className: 'iwb-modal-actions' },
        React.createElement('button', {
          type: 'button', className: 'iwb-textbtn iwb-primary',
          disabled: lsp.rebuilding === true,
          onClick: () => { void store.restartLsp() },
        }, t('lsp.diagnostics.rebuild')),
        React.createElement('button', {
          type: 'button', className: 'iwb-textbtn',
          title: t('lsp.diagnostics.degradeHint'),
          onClick: () => { void store.degradeLsp() },
        }, t('lsp.diagnostics.degrade')),
        React.createElement('button', {
          type: 'button', className: 'iwb-textbtn',
          title: t('lsp.diagnostics.settingsHint'),
          onClick: () => { onClose(); onOpenSettings?.() },
        }, t('lsp.diagnostics.settings')),
      ),
    ),
  )
}

function SettingsModal({ store, state, onClose }) {
  const t = store.t
  const [status, setStatus] = useState({ saving: false, saved: false })
  return React.createElement('div', { className: 'iwb-modal-backdrop', onMouseDown: event => { if (event.target === event.currentTarget) onClose() } },
    React.createElement('div', { className: 'iwb-modal iwb-settings-modal', role: 'dialog', 'aria-modal': 'true' },
      // The header and the close control stay put while the long form scrolls;
      // the save feedback rides along so a toggle never disappears silently.
      React.createElement('div', { className: 'iwb-modal-head' },
        React.createElement('h2', null, t('settings.title')),
        status.saving === true
          ? React.createElement('span', { className: 'iwb-settings-saved', role: 'status', 'aria-live': 'polite' }, t('settings.saving'))
          : (status.saved === true
              ? React.createElement('span', { className: 'iwb-settings-saved', role: 'status', 'aria-live': 'polite' }, t('settings.saved'))
              : null),
        React.createElement('button', {
          type: 'button', className: 'iwb-iconbtn', title: t('common.close'), 'aria-label': t('common.close'),
          onClick: onClose,
        }, React.createElement('span', { style: { fontSize: 17, lineHeight: 1 } }, '×')),
      ),
      React.createElement('div', { className: 'iwb-modal-body' },
        React.createElement(SettingsForm, { store, state, compact: true, onStatusChange: setStatus }),
      ),
      React.createElement('div', { className: 'iwb-modal-actions iwb-modal-foot' },
        React.createElement('button', { type: 'button', className: 'iwb-textbtn', onClick: onClose }, t('common.close')),
      ),
    ),
  )
}

export function Workbench({ store, visible = true, fullscreen = false }) {
  const state = useWorkbench(store)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const leftRef = useRef(null)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!visible) return
    store.activate()
    return () => { store.deactivate() }
  }, [store, visible])

  // The stylesheet's container query and this observer share `STACK_WIDTH`, so
  // the body CSS and the tool-group behavior flip at exactly the same width.
  // `transition` is false for the first measurement: opening the IDE in a
  // narrow pane keeps its default tool visible instead of hiding it.
  useEffect(() => {
    const element = rootRef.current
    if (element === null || typeof ResizeObserver !== 'function') return undefined
    let measured = false
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect?.width ?? 0
      if (!(width > 0)) return
      store.setStacked(width <= STACK_WIDTH, { transition: measured })
      measured = true
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [store])

  const startLeftResize = (event) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = state.layout.leftWidth
    const move = (moveEvent) => {
      store.setLayout({ leftWidth: Math.max(220, Math.min(680, startWidth + moveEvent.clientX - startX)) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const startBottomResize = (event) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = state.layout.bottomHeight
    const move = (moveEvent) => {
      store.setLayout({ bottomHeight: Math.max(100, Math.min(680, startHeight - (moveEvent.clientY - startY))) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  let left = null
  if (state.layout.left !== null && state.layout.left !== undefined) {
    left = React.createElement('div', {
      className: 'iwb-left',
      ref: leftRef,
      style: { '--iwb-left-width': `${state.layout.leftWidth}px` },
    },
      state.layout.left === 'project'
        ? React.createElement(MemoProjectPanel, { store })
        : React.createElement(MemoCommitPanel, { store }),
      React.createElement('div', { className: 'iwb-left-resizer', onPointerDown: startLeftResize }),
    )
  }

  const bottom = state.layout.bottom !== null && state.layout.bottom !== undefined ? state.layout.bottom : null
  const terminalKeep = state.terminal.sessions.length > 0
  const bottomNode = bottom !== null || terminalKeep
    ? React.createElement('div', {
        className: `iwb-bottom ${bottom === null ? 'iwb-bottom-hidden' : ''}`,
        style: { height: bottom === null ? 0 : state.layout.bottomHeight },
      },
        bottom !== null
          ? React.createElement(React.Fragment, null,
              React.createElement('div', { className: 'iwb-bottom-resizer', onPointerDown: startBottomResize }),
              React.createElement(BottomTabs, { store, state }),
            )
          : null,
        React.createElement('div', { className: 'iwb-bottom-body' },
          bottom === 'git' ? React.createElement(MemoGitPanel, { store }) : null,
          terminalKeep
            ? React.createElement('div', {
                className: bottom === 'terminal' ? 'iwb-bottom-content' : 'iwb-term-hidden',
              }, React.createElement(MemoTerminalPanel, { store, visible: bottom === 'terminal' }))
            : (bottom === 'terminal' ? React.createElement(MemoTerminalPanel, { store, visible: true }) : null),
        ),
      )
    : null

  return React.createElement('div', { className: 'iwb-root', ref: rootRef },
    React.createElement(TopBar, { store, state, fullscreen, onOpenSettings: () => setSettingsOpen(true) }),
    React.createElement('div', { className: 'iwb-body' },
      React.createElement(Stripe, { store, state }),
      left,
      React.createElement('div', { className: 'iwb-center' },
        React.createElement(MemoEditorArea, { store }),
      ),
    ),
    // The Terminal/Git dock spans the whole workbench width: it is a sibling
    // of the body, so the left dock shrinks above it instead of squeezing it.
    bottomNode,
    React.createElement(StatusBar, {
      store, state,
      onOpenSettings: () => setSettingsOpen(true),
      onOpenDiagnostics: () => { setDiagnosticsOpen(true); void store.loadLspResources() },
    }),
    state.phase === 'booting'
      ? React.createElement('div', { className: 'iwb-empty', style: { position: 'absolute', inset: 0, background: 'var(--iwb-bg)' } }, store.t('common.loading'))
      : null,
    state.fatal !== null && state.fatal !== undefined
      ? React.createElement('div', { className: 'iwb-modal-backdrop' },
          React.createElement('div', { className: 'iwb-modal' },
            React.createElement('h2', null, store.t('common.error')),
            React.createElement('p', null, state.fatal),
            React.createElement('div', { className: 'iwb-modal-actions' },
              React.createElement('button', { type: 'button', className: 'iwb-textbtn iwb-primary', onClick: () => { store.set({ fatal: null }); void store.init() } }, store.t('common.retry')),
            ),
          ),
        )
      : null,
    React.createElement(ConfirmModal, { dialog: state.confirm, onClose: () => store.dismissConfirm() }),
    React.createElement(QuickOpen, { store, state }),
    // The Find in Files popup floats above the editor: a search must not
    // take a tab away from the code (FIND-01). The key remounts it on every
    // open, so it starts with the query of the store and not with the one of
    // the last session.
    React.createElement(SearchPopup, {
      key: `search-popup-${state.searchPopup?.generation ?? 0}`,
      store,
      state,
    }),
    React.createElement(Toast, { toast: state.toast }),
    React.createElement(RootPicker, { store, state }),
    React.createElement(ProjectPicker, { store, state }),
    // The index decision is drawn above the project picker: it is the answer
    // to the choice the user just made in it.
    React.createElement(IndexDecisionModal, { store, state }),
    // The memory warning answers the index decision, so it is drawn above it.
    React.createElement(MemoryDecisionModal, { store, state }),
    // The diagnostics panel answers the status bar, so it is drawn above the
    // other dialogs too.
    diagnosticsOpen
      ? React.createElement(LspDiagnosticsModal, {
          store, state,
          onOpenSettings: () => setSettingsOpen(true),
          onClose: () => setDiagnosticsOpen(false),
        })
      : null,
    settingsOpen ? React.createElement(SettingsModal, { store, state, onClose: () => setSettingsOpen(false) }) : null,
  )
}
