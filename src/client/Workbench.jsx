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
import { ContextMenu, ConfirmModal, Kbd, Toast } from './ui.jsx'
import { baseName } from './util.js'
import { STACK_WIDTH } from './layout.js'

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
          typeof state.status.ahead === 'number' && state.status.ahead > 0
            ? React.createElement('span', { className: 'iwb-ahead' }, `↑${state.status.ahead}`)
            : null,
          typeof state.status.behind === 'number' && state.status.behind > 0
            ? React.createElement('span', { className: 'iwb-behind' }, `↓${state.status.behind}`)
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
 * The semantic-analysis status of the workbench (PRD-v5 §4.3).
 *
 * The host owns the state machine; this only maps it to a label, a tone and
 * an optional action. The tone picks the colour class of the status item, and
 * the action says what a click on it does.
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
  const progress = typeof lsp.progress === 'string' ? lsp.progress : ''
  const base = { title: t('lsp.statusTitle'), detail, action: null }
  if (settingsLsp.enabled === false || lsp.enabled === false || current === 'disabled') {
    return { ...base, key: 'disabled', text: t('lsp.status.disabled'), tone: 'idle' }
  }
  // A language without a server is a different state than a failing server:
  // the user has to install something, so the item points at the settings.
  const missing = (lsp.servers?.missing ?? []).filter(entry => typeof entry?.languageId === 'string')
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
  switch (current) {
    case 'starting':
    case 'restarting':
      return { ...base, key: current, text: t('lsp.status.starting'), tone: 'idle' }
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
      // An incremental update is announced while the server keeps serving.
      return progress === ''
        ? { ...base, key: 'ready', text: t('lsp.status.ready'), tone: 'ok' }
        : { ...base, key: 'updating', text: t('lsp.status.updating'), tone: 'warn' }
    case 'crashed':
      return { ...base, key: 'crashed', text: t('lsp.status.crashed'), tone: 'error', action: 'crash' }
    case 'cancelled':
      return { ...base, key: 'cancelled', text: t('lsp.status.cancelled'), tone: 'idle' }
    case 'degraded':
      return { ...base, key: 'degraded', text: t('lsp.status.degraded'), tone: 'idle' }
    case 'failed':
      return { ...base, key: 'failed', text: t('lsp.status.degraded'), tone: 'idle' }
    default:
      // No server runs: the workbench is in its conservative mode.
      return { ...base, key: 'idle', text: t('lsp.status.degraded'), tone: 'idle' }
  }
}

/**
 * The semantic-analysis item of the status bar (PRD-v5 §4.3, §7.1).
 *
 * The item is always visible: a missing capability has to be visible, not
 * hidden. The dot carries the state by its colour, and the label folds away
 * in a narrow pane (risk #25) — the stylesheet owns that part.
 */
function LspStatus({ store, state, onOpenSettings }) {
  const t = store.t
  const lsp = state.lsp ?? {}
  const view = lspStatusView(store, state)
  const cancelAfter = state.settings?.lsp?.cancelAfterMs ?? 60000
  const startedAt = typeof lsp.startedAt === 'number' ? lsp.startedAt : 0
  const cancellable = lsp.cancellable === true
    || (startedAt > 0 && Date.now() - startedAt > cancelAfter)
  const showCancel = view.key === 'building' && cancellable
  const tone = view.tone === 'ok' ? ' iwb-lsp-status-ready'
    : (view.tone === 'warn' ? ' iwb-lsp-status-warn' : (view.tone === 'error' ? ' iwb-lsp-status-error' : ' iwb-lsp-status-muted'))
  const title = view.detail === '' ? view.title : `${view.title} — ${view.detail}`
  const onClick = view.action === 'settings'
    ? () => { onOpenSettings?.() }
    : (view.action === 'crash' ? () => { store.toast('error', t('lsp.crashedToast'), view.detail) } : undefined)
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
  )
}

function StatusBar({ store, state, onOpenSettings }) {
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
    React.createElement(LspStatus, { store, state, onOpenSettings }),
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
    project.indexState === 'indexed'
      ? React.createElement('span', { className: 'iwb-project-index-badge', title: t('project.indexedHint') }, t('project.indexed'))
      : null,
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
 * The index decision dialog (PRD-v5 §2.3).
 *
 * It is the only modal of the semantic-analysis flow: it appears before the
 * language server starts, never while a build runs (PRD-v5 §7.2). `Esc` and a
 * click on the backdrop are "cancel" — the project stays as it is.
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
  const title = interpolate(t('index.decision.title'), { name })
  return React.createElement('div', {
    className: 'iwb-modal-backdrop',
    onMouseDown: event => { if (event.target === event.currentTarget) store.resolveIndexDecision('cancel') },
  },
    React.createElement('div', {
      className: 'iwb-modal iwb-index-decision', role: 'dialog', 'aria-modal': 'true', 'aria-label': title,
    },
      React.createElement('h2', null, title),
      React.createElement('p', null, t('index.decision.body')),
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
          onClick: () => store.resolveIndexDecision('conservative'),
        }, t('index.decision.conservative')),
        isRoot
          ? React.createElement('button', {
              type: 'button', className: 'iwb-textbtn',
              onClick: () => store.resolveIndexDecision('cancel'),
            }, t('index.decision.cancel'))
          : null,
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
    React.createElement(StatusBar, { store, state, onOpenSettings: () => setSettingsOpen(true) }),
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
    React.createElement(Toast, { toast: state.toast }),
    React.createElement(RootPicker, { store, state }),
    React.createElement(ProjectPicker, { store, state }),
    // The index decision is drawn above the project picker: it is the answer
    // to the choice the user just made in it.
    React.createElement(IndexDecisionModal, { store, state }),
    settingsOpen ? React.createElement(SettingsModal, { store, state, onClose: () => setSettingsOpen(false) }) : null,
  )
}
