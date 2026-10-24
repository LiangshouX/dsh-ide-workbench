/**
 * Editor area: IDEA-style preview / pinned tabs over the plugin's own viewer.
 * A single click in the Project tree reuses the one preview tab; a double
 * click pins it; opening a file that already has a pinned tab focuses it.
 *
 * Newly opened files are read-only. Text files expose a per-tab edit toggle
 * (CodeMirror) with save/restore, and Markdown opens in the rendered preview
 * with an optional document outline.
 */
import React, { useEffect, useRef, useState } from 'react'
import { CodeEditor } from './CodeEditor.jsx'
import { MarkdownView } from './MarkdownView.jsx'
import { DiffView } from './DiffView.jsx'
import { FindBar } from './FindBar.jsx'
import { SearchView } from './SearchView.jsx'
import { ContextMenu, Kbd } from './ui.jsx'
import {
  FileTypeIcon, IconChrome, IconClose, IconCode, IconEdit, IconEye, IconGlobe, IconLock,
  IconMore, IconOutline, IconPin, IconRestore, IconSave, StripeIcon,
} from './icons.jsx'
import { baseName } from './util.js'
import { openInIdeMenu } from './ide-menu.js'
import { isMarkdownPath } from './store.js'

function Welcome({ store, state }) {
  const t = store.t
  const branch = state.status.branch
  const repoProjects = (state.projects ?? []).filter(project => project.isRepo === true && project.path !== state.root)
  const Shortcut = ({ shortcut, children }) => React.createElement(Kbd, null, shortcut)
  const actions = [
    { key: 'project', icon: 'project', title: t('welcome.project'), shortcut: state.settings?.shortcuts?.project ?? 'Alt+1', onClick: () => store.showTool('project') },
    { key: 'commit', icon: 'commit', title: t('welcome.commit'), shortcut: state.settings?.shortcuts?.commit ?? 'Alt+0', onClick: () => store.showTool('commit') },
    { key: 'git', icon: 'git', title: t('welcome.git'), shortcut: state.settings?.shortcuts?.git ?? 'Alt+9', onClick: () => store.showTool('git') },
    { key: 'terminal', icon: 'terminal', title: t('welcome.terminal'), shortcut: state.settings?.shortcuts?.terminal ?? 'Alt+F12', onClick: () => store.showTool('terminal') },
  ]
  return React.createElement('div', { className: 'iwb-welcome' },
    React.createElement('div', { className: 'iwb-welcome-card' },
      React.createElement('h1', { className: 'iwb-welcome-title' }, t('welcome.title')),
      React.createElement('p', { className: 'iwb-welcome-sub' }, t('welcome.subtitle')),
      React.createElement('div', { className: 'iwb-welcome-grid' },
        actions.map(action => React.createElement('button', {
          key: action.key, type: 'button', className: 'iwb-welcome-action', onClick: action.onClick,
        },
          React.createElement(StripeIcon, { tool: action.icon, size: 17 }),
          React.createElement('span', null, action.title),
          React.createElement(Shortcut, { shortcut: action.shortcut, children: action.shortcut }),
        )),
      ),
      React.createElement('div', { className: 'iwb-welcome-meta' },
        state.status.isRepo === true
          ? React.createElement('span', null, `${t('welcome.branch')}: ${state.status.detached === true ? t('git.detached') : (branch ?? 'HEAD')}`)
          : React.createElement('span', null, t('welcome.noRepo')),
        React.createElement('span', null, state.root),
      ),
      state.status.isRepo !== true && repoProjects.length > 0
        ? React.createElement('div', { className: 'iwb-welcome-hint' },
            React.createElement('span', null, t('project.noRepoHint')),
            React.createElement('button', {
              type: 'button', className: 'iwb-textbtn iwb-small',
              onClick: () => store.openProjectPicker(),
            }, t('project.chooseRepo')),
          )
        : null,
    ),
  )
}

function FilePreview({ store, state, tab, onEditorReady, onFindRequest, onFindInFiles, previewFind, onPreviewFindRequest, onClosePreviewFind }) {
  const t = store.t
  const scrollTimer = useRef(null)
  useEffect(() => () => { if (scrollTimer.current !== null) clearTimeout(scrollTimer.current) }, [])
  const onScrollTop = (top) => {
    if (scrollTimer.current !== null) clearTimeout(scrollTimer.current)
    scrollTimer.current = setTimeout(() => {
      scrollTimer.current = null
      store.updateActiveTab({ scrollTop: top })
    }, 400)
  }
  if (tab.loading === true && tab.payload === undefined) {
    return React.createElement('div', { className: 'iwb-editor-empty' }, t('common.loading'))
  }
  if (tab.error !== null && tab.error !== undefined) {
    return React.createElement('div', { className: 'iwb-editor-empty' }, React.createElement('div', { className: 'iwb-error-box' }, tab.error))
  }
  const payload = tab.payload
  if (payload === undefined || payload === null) return null
  if (payload.kind === 'image') {
    return React.createElement('div', { className: 'iwb-editor-empty', style: { flexDirection: 'column', gap: 12 } },
      React.createElement('img', { src: payload.dataUrl, alt: tab.name, style: { maxWidth: '92%', maxHeight: '82%', objectFit: 'contain', borderRadius: 6, border: '1px solid var(--iwb-border)' } }),
      React.createElement('span', null, `${tab.rel} · ${payload.size} B`),
    )
  }
  if (payload.kind === 'binary') {
    return React.createElement('div', { className: 'iwb-editor-empty' }, t('common.binary'))
  }
  if (payload.kind === 'too-large') {
    return React.createElement('div', { className: 'iwb-editor-empty' }, t('common.tooLarge'))
  }
  if (payload.kind !== 'text') {
    return React.createElement('div', { className: 'iwb-editor-empty' }, t('common.binary'))
  }
  const saved = payload.content ?? ''
  const text = tab.dirty === true ? (tab.draft ?? saved) : saved
  if (tab.editing === true && payload.truncated !== true) {
    return React.createElement(CodeEditor, {
      key: `${tab.id}:${tab.resetToken ?? 0}`,
      value: tab.draft ?? saved,
      path: tab.path,
      fontSize: state.settings?.editor?.fontSize ?? 13,
      resetToken: tab.resetToken ?? 0,
      revealLine: tab.revealLine,
      readOnly: false,
      onFindRequest,
      onFindInFiles,
      onReady: onEditorReady,
      onChange: value => store.updateDraft(tab.id, value),
      onSave: () => { void store.saveTab(tab.id) },
      onCursor: position => store.setCursor(position),
      onSendToChat: selection => store.sendSelectionToChat({ path: tab.path, rel: tab.rel, ...selection }),
      chatLabels: { send: t('chat.sendToChat'), copy: t('common.copy') },
    })
  }
  if (isMarkdownPath(tab.path) && (tab.view ?? 'preview') === 'preview') {
    return React.createElement(MarkdownView, {
      key: tab.id,
      text,
      t,
      findOpen: previewFind,
      onFindRequest: onPreviewFindRequest,
      onCloseFind: onClosePreviewFind,
      outlineOpen: tab.outlineOpen === true,
      onToggleOutline: () => store.updateActiveTab({ outlineOpen: tab.outlineOpen !== true }),
      labels: {
        outline: t('editor.outline'),
        empty: t('editor.outlineEmpty'),
        close: t('common.close'),
        copy: t('common.copy'),
        copied: t('common.copied'),
        code: t('editor.codeBlock'),
        wrap: t('editor.wrap'),
        unwrap: t('editor.unwrap'),
      },
    })
  }
  // Read-only files use the same CodeMirror surface: native selection,
  // Ctrl+A/Ctrl+C, FindBar and horizontal scrolling all come for free.
  return React.createElement(CodeEditor, {
    key: `${tab.id}:readonly:${tab.resetToken ?? 0}`,
    value: text,
    path: tab.path,
    fontSize: state.settings?.editor?.fontSize ?? 13,
    resetToken: tab.resetToken ?? 0,
    revealLine: tab.revealLine,
    readOnly: true,
    onFindRequest,
    onFindInFiles,
    onReady: onEditorReady,
    onCursor: position => store.setCursor(position),
    onSendToChat: selection => store.sendSelectionToChat({ path: tab.path, rel: tab.rel, ...selection }),
    chatLabels: { send: t('chat.sendToChat'), copy: t('common.copy') },
  })
}

function TabBar({ store, state }) {
  const t = store.t
  const [menu, setMenu] = useState(null)
  const activeIndex = state.tabs.findIndex(tab => tab.id === state.activeId)
  return React.createElement('div', { className: 'iwb-tabbar' },
    state.tabs.map(tab => React.createElement('div', {
      key: tab.id,
      className: `iwb-tab ${tab.id === state.activeId ? 'iwb-active' : ''} ${tab.preview ? 'iwb-preview' : ''} ${tab.dirty ? 'iwb-dirty' : ''}`,
      title: tab.path,
      onClick: () => store.activateTab(tab.id),
      onDoubleClick: () => { if (tab.kind === 'file' && tab.preview) void store.pinTab(tab.id, { silent: true }) },
      onAuxClick: event => { if (event.button === 1) store.closeTab(tab.id) },
      onContextMenu: event => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, tab }) },
    },
      tab.kind === 'commit'
        ? React.createElement(IconMore, { width: 12, height: 12 })
        : React.createElement(FileTypeIcon, { name: tab.name, isDir: false, size: 14 }),
      React.createElement('span', { className: 'iwb-tab-name' }, tab.kind === 'commit' ? tab.hash.slice(0, 8) : tab.name),
      tab.dirty === true
        ? React.createElement('span', { className: 'iwb-tab-dirty', title: t('editor.dirty') })
        : (tab.preview ? React.createElement('span', { className: 'iwb-tab-dot', title: t('common.preview') }) : null),
      React.createElement('button', {
        type: 'button',
        className: 'iwb-tab-close',
        title: t('common.closeTab'),
        onClick: event => { event.stopPropagation(); store.closeTab(tab.id) },
      }, React.createElement(IconClose, { width: 11, height: 11 })),
    )),
    React.createElement('div', { className: 'iwb-tabbar-actions' },
      activeIndex >= 0 && state.tabs[activeIndex]?.kind === 'file' && state.tabs[activeIndex]?.preview
        ? React.createElement('button', {
            type: 'button', className: 'iwb-iconbtn', title: t('common.pinTab'),
            onClick: () => store.pinTab(state.tabs[activeIndex].id),
          }, React.createElement(IconPin, { width: 14, height: 14 }))
        : null,
    ),
    menu !== null
      ? React.createElement(ContextMenu, {
          x: menu.x, y: menu.y, onClose: () => setMenu(null),
          items: [
            {
              key: 'save', text: t('editor.save'), disabled: menu.tab.dirty !== true,
              action: () => { void store.saveTab(menu.tab.id) },
            },
            {
              key: 'revert', text: t('editor.restore'), disabled: menu.tab.dirty !== true,
              action: () => store.discardDraft(menu.tab.id),
            },
            {
              key: 'sidebar', text: t('project.openInSidebar'), disabled: menu.tab.kind !== 'file',
              action: () => { void store.openInSidebar(menu.tab.path) },
            },
            openInIdeMenu(store, menu.tab.path, menu.tab.kind !== 'file'),
            null,
            {
              key: 'pin', text: t('common.pinTab'), disabled: menu.tab.kind !== 'file' || menu.tab.preview !== true,
              action: () => store.pinTab(menu.tab.id),
            },
            { key: 'close', text: t('common.close'), action: () => store.closeTab(menu.tab.id) },
            { key: 'others', text: t('common.closeOthers'), action: () => store.closeOtherTabs(menu.tab.id) },
          ],
        })
      : null,
  )
}

function EditorToolbar({ store, state, tab }) {
  const t = store.t
  const [diffMenu, setDiffMenu] = useState(null)
  if (tab.kind === 'diff') {
    const variant = tab.compare !== undefined
      ? `${tab.compare.a.slice(0, 7)} \u2194 ${tab.compare.b.slice(0, 7)}`
      : tab.against === 'head'
        ? t('commit.lastRevision')
        : tab.against === 'latest'
          ? t('commit.latest')
          : tab.staged === true
            ? t('commit.staged')
            : tab.untracked === true
              ? t('commit.untracked')
              : t('commit.workingTree')
    const readOnly = tab.readOnly === true
    const anchor = (event) => {
      const rect = event.currentTarget.getBoundingClientRect()
      setDiffMenu({ x: rect.left - 120, y: rect.bottom + 4 })
    }
    return React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'iwb-editor-toolbar' },
        React.createElement('div', { className: 'iwb-breadcrumb' },
          React.createElement('span', null, t('commit.title')),
          React.createElement('span', { className: 'iwb-sep' }, '›'),
          React.createElement('b', null, variant),
          React.createElement('span', { className: 'iwb-sep' }, '›'),
          React.createElement('b', null, baseName(tab.rel)),
        ),
        React.createElement('div', { className: 'iwb-spacer' }),
        readOnly
          ? null
          : React.createElement(React.Fragment, null,
              React.createElement('button', {
                type: 'button', className: 'iwb-textbtn iwb-small',
                onClick: anchor,
              }, t('commit.showDiffWith'), ' ▾'),
              React.createElement('button', {
                type: 'button', className: 'iwb-textbtn iwb-small', title: t('commit.jumpToSource'),
                onClick: () => store.jumpToSource(tab.rel),
              }, t('commit.jumpToSource')),
              React.createElement('button', {
                type: 'button', className: 'iwb-textbtn iwb-small iwb-danger',
                onClick: () => store.revertChange({ path: tab.rel, untracked: tab.untracked === true }),
              }, t('commit.revert')),
            ),
      ),
      diffMenu !== null && !readOnly
        ? React.createElement(ContextMenu, {
            x: diffMenu.x, y: diffMenu.y,
            items: [
              { key: 'worktree', text: t('commit.workingTree'), checked: tab.against === null && tab.staged !== true && tab.untracked !== true, action: () => store.openDiff({ path: tab.rel }) },
              { key: 'head', text: t('commit.lastRevision'), checked: tab.against === 'head', action: () => store.openDiff({ path: tab.rel, against: 'head' }) },
              { key: 'latest', text: t('commit.latest'), checked: tab.against === 'latest', action: () => store.openDiff({ path: tab.rel, against: 'latest' }) },
            ],
            onClose: () => setDiffMenu(null),
          })
        : null,
    )
  }
  if (tab.kind === 'commit') {
    return React.createElement('div', { className: 'iwb-editor-toolbar' },
      React.createElement('div', { className: 'iwb-breadcrumb' },
        React.createElement('b', null, t('git.details')),
        React.createElement('span', { className: 'iwb-sep' }, '›'),
        React.createElement('b', { style: { fontFamily: 'var(--iwb-mono)' } }, tab.hash.slice(0, 10)),
      ),
      React.createElement('div', { className: 'iwb-spacer' }),
    )
  }
  const segments = tab.rel.split(/[\\/]/)
  const payload = tab.payload
  const isText = payload?.kind === 'text' && payload?.truncated !== true
  const markdown = isMarkdownPath(tab.path)
  const editing = tab.editing === true
  const view = tab.view ?? (markdown ? 'preview' : 'code')
  const dirty = tab.dirty === true
  const saving = tab.saving === true
  return React.createElement('div', { className: 'iwb-editor-toolbar' },
    React.createElement('div', { className: 'iwb-breadcrumb', title: tab.path },
      segments.slice(0, -1).map((segment, index) => React.createElement(React.Fragment, { key: index },
        React.createElement('span', null, segment),
        React.createElement('span', { className: 'iwb-sep' }, '›'),
      )),
      React.createElement('b', null, segments[segments.length - 1]),
      dirty ? React.createElement('span', { className: 'iwb-toolbar-dirty', title: t('editor.dirty') }, t('editor.dirty')) : null,
      tab.conflict !== null && tab.conflict !== undefined
        ? React.createElement('span', { className: 'iwb-conflict-chip', title: tab.conflict.message ?? '' },
            t('editor.externalChanged'),
            React.createElement('button', {
              type: 'button', className: 'iwb-textbtn iwb-small',
              onClick: () => { void store.reloadTab(tab.id) },
            }, t('editor.reloadFromDisk')),
            React.createElement('button', {
              type: 'button', className: 'iwb-textbtn iwb-small',
              onClick: () => { void store.saveTab(tab.id, { force: true }) },
            }, t('editor.overwriteDisk')),
          )
        : null,
    ),
    React.createElement('div', { className: 'iwb-spacer' }),
    payload?.truncated === true ? React.createElement('span', { style: { color: 'var(--iwb-warn)' } }, t('editor.truncated')) : null,
    isText && markdown && !editing
      ? React.createElement('div', { className: 'iwb-seg' },
          React.createElement('button', {
            type: 'button', className: view === 'preview' ? 'iwb-on' : '', title: t('editor.preview'),
            onClick: () => store.setTabView(tab.id, 'preview'),
          }, React.createElement(IconEye, { width: 12, height: 12 }), t('editor.preview')),
          React.createElement('button', {
            type: 'button', className: view === 'code' ? 'iwb-on' : '', title: t('editor.source'),
            onClick: () => store.setTabView(tab.id, 'code'),
          }, React.createElement(IconCode, { width: 12, height: 12 }), t('editor.source')),
        )
      : null,
    isText && markdown && !editing && view === 'preview'
      ? React.createElement('button', {
          type: 'button', className: `iwb-iconbtn ${tab.outlineOpen === true ? 'iwb-on' : ''}`, title: t('editor.outline'),
          onClick: () => store.updateActiveTab({ outlineOpen: tab.outlineOpen !== true }),
        }, React.createElement(IconOutline, { width: 14, height: 14 }))
      : null,
    isText
      ? React.createElement('button', {
          type: 'button',
          className: 'iwb-textbtn iwb-small',
          title: editing ? t('editor.toReadOnly') : t('editor.toEdit'),
          onClick: () => store.setTabEditing(tab.id, !editing),
        },
          React.createElement(editing ? IconLock : IconEdit, { width: 12, height: 12 }),
          editing ? t('editor.readonly') : t('editor.edit'),
        )
      : null,
    editing && isText
      ? React.createElement(React.Fragment, null,
          React.createElement('button', {
            type: 'button',
            className: `iwb-textbtn iwb-small ${dirty ? 'iwb-primary' : ''}`,
            disabled: !dirty || saving,
            title: 'Ctrl+S',
            onClick: () => { void store.saveTab(tab.id) },
          }, React.createElement(IconSave, { width: 12, height: 12 }), saving ? t('editor.saving') : t('editor.save')),
          React.createElement('button', {
            type: 'button', className: 'iwb-iconbtn', disabled: !dirty, title: t('editor.restore'),
            onClick: () => store.discardDraft(tab.id),
          }, React.createElement(IconRestore, { width: 14, height: 14 })),
        )
      : (isText && dirty
          ? React.createElement(React.Fragment, null,
              React.createElement('button', {
                type: 'button', className: 'iwb-textbtn iwb-primary iwb-small', disabled: saving, title: 'Ctrl+S',
                onClick: () => { void store.saveTab(tab.id) },
              }, React.createElement(IconSave, { width: 12, height: 12 }), saving ? t('editor.saving') : t('editor.save')),
              React.createElement('button', {
                type: 'button', className: 'iwb-iconbtn', title: t('editor.restore'),
                onClick: () => store.discardDraft(tab.id),
              }, React.createElement(IconRestore, { width: 14, height: 14 })),
            )
          : null),
    React.createElement('span', null, payload?.encoding ?? 'utf-8'),
  )
}

/** Whether a path is an HTML document this workbench cannot render inline. */
function isHtmlPath(path) {
  return typeof path === 'string' && /\.(?:html?|xhtml)$/i.test(path)
}

/**
 * Floating actions for HTML files: the right side of the workbench shows the
 * source, while DSH's own sidebar can render the document and the OS default
 * browser can open it with its normal relative-asset behaviour.
 */
function HtmlPreviewActions({ store, tab }) {
  const t = store.t
  if (tab.kind !== 'file' || !isHtmlPath(tab.path)) return null
  return React.createElement('div', { className: 'iwb-html-actions' },
    React.createElement('button', {
      type: 'button', className: 'iwb-html-action', title: t('editor.htmlPreviewSidebar'),
      'aria-label': t('editor.htmlPreviewSidebar'),
      onClick: () => { void store.openInSidebar(tab.path) },
    }, React.createElement(IconGlobe, { width: 15, height: 15 })),
    React.createElement('button', {
      type: 'button', className: 'iwb-html-action iwb-chrome', title: t('editor.htmlPreviewBrowser'),
      'aria-label': t('editor.htmlPreviewBrowser'),
      onClick: () => { void store.openInDefaultBrowser(tab.path) },
    }, React.createElement(IconChrome, { width: 15, height: 15 })),
  )
}

export function EditorArea({ store, state }) {
  const active = state.tabs.find(tab => tab.id === state.activeId)
  const [findOpen, setFindOpen] = useState(false)
  const [previewFind, setPreviewFind] = useState(false)
  const [editorApi, setEditorApi] = useState(null)
  const findOpenRef = useRef(false)
  findOpenRef.current = findOpen
  const previewFindRef = useRef(false)
  previewFindRef.current = previewFind
  const textTab = active?.kind === 'file' && active.payload?.kind === 'text' && active.payload?.truncated !== true
    && !(isMarkdownPath(active.path) && (active.view ?? 'preview') === 'preview' && active.editing !== true)
  // A rendered Markdown document is not a CodeMirror buffer, so it needs the
  // DOM find bar rather than the CodeMirror FindBar.
  const previewTab = active?.kind === 'file' && active.payload?.kind === 'text' && active.payload?.truncated !== true
    && isMarkdownPath(active.path) && (active.view ?? 'preview') === 'preview' && active.editing !== true

  useEffect(() => {
    setFindOpen(false)
    setPreviewFind(false)
    setEditorApi(null)
  }, [active?.id])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (store.state.active !== true) return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('.iwb-search')) return
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (mod && ((event.shiftKey && !event.altKey) || (event.altKey && !event.shiftKey)) && key === 'f') {
        event.preventDefault()
        event.stopPropagation()
        store.openSearchTab()
        return
      }
      if (mod && !event.altKey && !event.shiftKey && key === 'f' && textTab) {
        event.preventDefault()
        event.stopPropagation()
        setFindOpen(true)
        return
      }
      // The rendered preview keeps focus on `document.body` when the user
      // clicks plain text, so the shortcut must be owned here and not only by
      // the preview element.
      if (mod && !event.altKey && !event.shiftKey && key === 'f' && previewTab) {
        event.preventDefault()
        event.stopPropagation()
        setPreviewFind(true)
        return
      }
      if ((event.key === 'F3' || (mod && key === 'g')) && textTab) {
        event.preventDefault()
        event.stopPropagation()
        setFindOpen(true)
        return
      }
      if (event.key === 'F3' && !mod && previewTab) {
        event.preventDefault()
        event.stopPropagation()
        setPreviewFind(true)
        return
      }
      if (event.key === 'Escape' && findOpenRef.current) {
        event.preventDefault()
        findOpenRef.current = false
        editorApi?.clear()
        setFindOpen(false)
      }
      if (event.key === 'Escape' && previewFindRef.current) {
        event.preventDefault()
        previewFindRef.current = false
        setPreviewFind(false)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [store, textTab, previewTab, editorApi])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const target = event.target
      if (!(target instanceof Element) || target.closest('.iwb-root') === null) return
      if (target.closest('.iwb-commit, .iwb-term, .iwb-term-host, .iwb-diff, .iwb-search') !== null) return
      if (event.key.toLowerCase() === 'w' && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        const activeTab = store.state.tabs.find(item => item.id === store.state.activeId)
        if (activeTab !== undefined) store.closeTab(activeTab.id)
        return
      }
      if (event.key.toLowerCase() !== 's') return
      const tab = store.state.tabs.find(item => item.id === store.state.activeId)
      if (tab === undefined || tab.kind !== 'file' || tab.dirty !== true) return
      event.preventDefault()
      event.stopPropagation()
      void store.saveTab(tab.id)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [store])

  if (active === undefined) {
    return React.createElement('div', { className: 'iwb-editor' },
      React.createElement(TabBar, { store, state }),
      React.createElement(Welcome, { store, state }),
    )
  }
  if (active.kind === 'search') {
    return React.createElement('div', { className: 'iwb-editor' },
      React.createElement(TabBar, { store, state }),
      React.createElement(SearchView, { store, state }),
    )
  }
  const content = active.kind === 'file'
    ? React.createElement(FilePreview, {
        store, state, tab: active,
        previewFind,
        onPreviewFindRequest: () => setPreviewFind(true),
        onClosePreviewFind: () => setPreviewFind(false),
        onEditorReady: setEditorApi,
        onFindRequest: () => setFindOpen(true),
        onFindInFiles: () => store.openSearchTab(),
      })
    : (active.loading === true
        ? React.createElement('div', { className: 'iwb-editor-empty' }, store.t('common.loading'))
        : (active.error !== null && active.error !== undefined
            ? React.createElement('div', { className: 'iwb-editor-empty' }, React.createElement('div', { className: 'iwb-error-box' }, active.error))
            : React.createElement(DiffView, { store, state, tab: active })))
  return React.createElement('div', { className: 'iwb-editor' },
    React.createElement(TabBar, { store, state }),
    React.createElement(EditorToolbar, { store, state, tab: active }),
    findOpen === true && textTab && editorApi !== null
      ? React.createElement(FindBar, {
          store,
          editor: editorApi,
          readOnly: active.editing !== true,
          onClose: () => setFindOpen(false),
        })
      : null,
    content,
    React.createElement(HtmlPreviewActions, { store, tab: active }),
  )
}
