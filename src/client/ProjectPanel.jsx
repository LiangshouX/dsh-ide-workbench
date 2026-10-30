/**
 * Project tool window — JetBrains selection model.
 *
 *   - single click selects (folder or file); double click opens / expands;
 *   - Ctrl/Shift multi-select drives batch actions and Compare;
 *   - inline rename (F2), duplicate (F5), move (F6), delete (Delete),
 *     cut/copy/paste, drag & drop move (Ctrl = copy);
 *   - context menus show the rebindable shortcut in a grey column.
 *
 * The tree keeps the V1 virtualization (fixed rows, windowed rendering) so a
 * 10k-file repository stays responsive; status colouring is aggregated over
 * the whole repository, not only over loaded folders.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ContextMenu } from './ui.jsx'
import { FileTypeIcon, IconChat, IconExternal, IconGlobe, IconRefresh, IconSearch } from './icons.jsx'
import { openInIdeMenu } from './ide-menu.js'
import { aggregateStatus, statusClass } from './git-colors.js'
import { shallowEqual, useStoreSlice } from './hooks.js'
import { baseName, matchesShortcut } from './util.js'

const ROW_HEIGHT = 22

/** Shortcut defaults used when the running host still returns a pre-v2 document. */
const SHORTCUT_FALLBACK = {
  rename: 'F2',
  delete: 'Delete',
  duplicate: 'F5',
  move: 'F6',
  synchronize: 'Ctrl+Alt+Y',
  compare: 'Ctrl+D',
  findInFiles: 'Ctrl+Shift+R',
  quickOpen: 'Ctrl+Shift+N',
  openEntry: 'Enter',
}

/** Parent directory of a path (both separators). */
function parentOf(path) {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index <= 0 ? path : path.slice(0, index)
}

/** Join one child name to an absolute parent using the parent's separator. */
function childOf(parent, name) {
  const separator = parent.includes('\\') ? '\\' : '/'
  return `${parent.replace(/[\\/]$/, '')}${separator}${name}`
}

/** Workspace-relative forward-slash path → absolute path under `root`. */
function absoluteOf(root, rel) {
  const separator = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]$/, '')}${separator}${String(rel).split('/').join(separator)}`
}

/** Whether a relative path sits under an excluded directory pattern. */
export function isExcluded(rel, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false
  for (const raw of patterns) {
    if (typeof raw !== 'string' || raw.trim() === '') continue
    const pattern = raw.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    if (pattern === '') continue
    if (rel === pattern || rel.startsWith(`${pattern}/`)) return true
  }
  return false
}

/** Flatten the expanded tree into render rows. */
export function flatten(state, filter, showIgnored, ignored, mode = 'tree') {
  const rows = []
  const dirs = state.dirs
  const normalized = mode === 'tree' ? filter.trim().toLowerCase() : ''
  const root = state.root
  if (root === '') return rows

  // A tree filter only searches what is already loaded; never pretend an
  // unloaded folder is "loading" just because a filter is active.
  const isExpanded = path => state.expanded.has(path)
  const visible = entry => showIgnored || !ignored.has(entry.rel)

  const walk = (path, depth) => {
    const dir = dirs.get(path)
    if (dir === undefined || dir.entries === undefined) {
      rows.push({ kind: 'loading', key: `loading:${path}`, depth })
      return
    }
    if (dir.error !== undefined && dir.error !== null) {
      rows.push({ kind: 'error', key: `error:${path}`, depth, message: dir.error, path })
      return
    }
    for (const entry of dir.entries) {
      if (!visible(entry)) continue
      if (entry.isDir) {
        const open = isExpanded(entry.path)
        rows.push({ kind: 'dir', key: entry.path, entry, depth, open })
        if (open) walk(entry.path, depth + 1)
      } else {
        if (normalized !== '' && !entry.name.toLowerCase().includes(normalized) && !entry.rel.toLowerCase().includes(normalized)) continue
        rows.push({ kind: 'file', key: entry.path, entry, depth })
      }
    }
    if (dir.truncated === true) rows.push({ kind: 'note', key: `trunc:${path}`, depth, message: '…' })
    if (dir.loading === true && dir.entries !== undefined) {
      rows.push({ kind: 'note', key: `busy:${path}`, depth, message: '…' })
    }
  }

  // A restored project loads its expanded folders asynchronously; until the
  // first listing arrives the root itself has no entries. Show that as a
  // loading row (and a retryable error row) instead of a blank tree.
  const rootDir = dirs.get(root)
  if (rootDir === undefined || rootDir.entries === undefined) {
    if (rootDir !== undefined && rootDir.error !== undefined && rootDir.error !== null) {
      rows.push({ kind: 'error', key: `error:${root}`, depth: 0, message: rootDir.error, path: root })
    } else {
      rows.push({ kind: 'loading', key: `loading:${root}`, depth: 0 })
    }
    return rows
  }

  for (const entry of (dirs.get(root)?.entries ?? [])) {
    if (!visible(entry)) continue
    if (entry.isDir) {
      const open = isExpanded(entry.path)
      rows.push({ kind: 'dir', key: entry.path, entry, depth: 0, open })
      if (open) walk(entry.path, 1)
    } else {
      if (normalized !== '' && !entry.name.toLowerCase().includes(normalized) && !entry.rel.toLowerCase().includes(normalized)) continue
      rows.push({ kind: 'file', key: entry.path, entry, depth: 0 })
    }
  }
  return rows
}

/**
 * The inputs `flatten` really reads — and therefore the exact dependency list
 * of its `useMemo`.
 *
 * The store replaces `dirs` (a new Map) and `expanded` (a new Set) on every
 * write, never mutating them in place, so reference comparison is enough to
 * know the tree changed. Depending on the whole `state` object instead would
 * recompute the tree on every store notification.
 */
export function flattenInputs(state, showIgnored, ignored, mode) {
  return [state.dirs, state.expanded, state.root, state.filter, showIgnored, ignored, mode]
}

/** Starter content for the New File templates. */
function templateContent(templateId, name) {
  const stem = name.replace(/\.[^.]+$/, '') || name
  const pascal = stem.replace(/(^|[-_.\s]+)([a-zA-Z0-9])/g, (_, __, ch) => ch.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '')
  const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1)
  const title = stem.replace(/[-_]+/g, ' ')
  switch (templateId) {
    case 'java': return `public class ${pascal === '' ? 'Main' : pascal} {\n\n}\n`
    case 'kotlin': return `class ${pascal === '' ? 'Main' : pascal} {\n\n}\n`
    case 'ts': return `export function ${camel === '' ? 'main' : camel}(): void {\n\n}\n`
    case 'js': return `function ${camel === '' ? 'main' : camel}() {\n\n}\n`
    case 'python': return 'def main() -> None:\n    pass\n\n\nif __name__ == "__main__":\n    main()\n'
    case 'markdown': return `# ${title}\n\n`
    case 'json': return '{\n  \n}\n'
    case 'html': return '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title></title>\n</head>\n<body>\n\n</body>\n</html>\n'
    case 'css': return '/* styles */\n'
    case 'shell': return '#!/usr/bin/env bash\nset -euo pipefail\n'
    case 'gitignore': return '# ignore rules\n'
    default: return ''
  }
}

/** File templates offered by the New File dialog. */
export const NEW_TEMPLATES = [
  { id: 'plain', labelKey: 'project.tplPlain' },
  { id: 'java', labelKey: 'project.tplJava', ext: '.java' },
  { id: 'kotlin', labelKey: 'project.tplKotlin', ext: '.kt' },
  { id: 'ts', labelKey: 'project.tplTs', ext: '.ts' },
  { id: 'js', labelKey: 'project.tplJs', ext: '.js' },
  { id: 'python', labelKey: 'project.tplPython', ext: '.py' },
  { id: 'markdown', labelKey: 'project.tplMarkdown', ext: '.md' },
  { id: 'json', labelKey: 'project.tplJson', ext: '.json' },
  { id: 'html', labelKey: 'project.tplHtml', ext: '.html' },
  { id: 'css', labelKey: 'project.tplCss', ext: '.css' },
  { id: 'shell', labelKey: 'project.tplShell', ext: '.sh' },
  { id: 'gitignore', labelKey: 'project.tplGitignore', ext: '' },
]

/**
 * One file-tree row.
 *
 * Memoized so a status change on a single file only re-renders that row
 * instead of rebuilding every visible row. The memo only holds if every
 * callback arrives `useCallback`-stable from the panel — an inline handler
 * would defeat it on every render — so the row takes plain data plus the
 * shared callbacks and nothing else.
 */
const TreeRow = React.memo(function TreeRow({
  entry,
  depth,
  top,
  open,
  selected,
  statusKind,
  ignored,
  excluded,
  dropTarget,
  active,
  editing,
  renameValue,
  relative,
  quick,
  onRowClick,
  onRowDoubleClick,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onToggleDir,
  onRenameChange,
  onRenameKeyDown,
  onRenameBlur,
}) {
  const isDir = entry.isDir === true
  const style = useMemo(() => ({ top: `${top}px`, paddingLeft: `${8 + depth * 14}px` }), [top, depth])
  const classes = useMemo(() => [
    'iwb-vlist-row', 'iwb-tree-row',
    selected ? 'iwb-selected' : '',
    statusKind !== undefined ? statusClass(statusKind) : '',
    ignored ? 'iwb-git-ignored' : '',
    excluded ? 'iwb-excluded' : '',
    dropTarget ? 'iwb-drop-target' : '',
  ].filter(Boolean).join(' '), [selected, statusKind, ignored, excluded, dropTarget])
  return React.createElement('div', {
    className: active ? `${classes} iwb-opened` : classes,
    style,
    title: entry.rel,
    draggable: isDir ? true : !editing,
    onClick: event => onRowClick(event, entry, quick),
    onDoubleClick: () => onRowDoubleClick(entry),
    onContextMenu: event => onContextMenu(event, entry),
    onDragStart: event => onDragStart(event, entry),
    onDragOver: event => onDragOver(event, entry),
    onDrop: event => onDrop(event, entry),
    onDragEnd,
  },
    isDir
      ? React.createElement('span', {
          className: 'iwb-tree-twisty iwb-tree-twisty-click',
          // The twisty sits inside the row, which selects on click: without
          // stopPropagation one click would select *and* toggle the folder.
          onClick: event => { event.stopPropagation(); onToggleDir(entry.path) },
        }, open ? React.createElement(ChevronDown, null) : React.createElement(ChevronRight, null))
      : React.createElement('span', { className: 'iwb-tree-twisty' }),
    isDir
      ? React.createElement(FileTypeIcon, { name: entry.name, isDir: true, open, size: 15 })
      : React.createElement(FileTypeIcon, { name: entry.name, size: 15 }),
    isDir
      ? React.createElement('span', { className: 'iwb-tree-name iwb-dir' }, entry.name)
      : (editing
          ? React.createElement('input', {
              className: 'iwb-rename-input',
              autoFocus: true,
              value: renameValue,
              onChange: event => onRenameChange(event.target.value),
              onKeyDown: onRenameKeyDown,
              onBlur: onRenameBlur,
              onClick: event => event.stopPropagation(),
              onDoubleClick: event => event.stopPropagation(),
            })
          : React.createElement('span', { className: 'iwb-tree-name' }, entry.name)),
    relative !== undefined
      ? React.createElement('span', { className: 'iwb-tree-relative' }, relative)
      : null,
  )
})

/**
 * The fields the Project panel reads.
 *
 * The panel subscribes to this slice instead of the whole workbench snapshot,
 * so unrelated store writes (terminal output, toasts, the git log, the
 * commit drawer) no longer re-render the file tree.
 *
 * Every field the panel touches must be listed here — a field that is read
 * but missing here would freeze the panel (PRD §11 row 16). `tests/perf-slice-project.test.mjs`
 * guards the list against the panel source.
 */
export function projectSlice(state) {
  return {
    dirs: state.dirs,
    expanded: state.expanded,
    root: state.root,
    filter: state.filter,
    filterMode: state.filterMode,
    fileIndex: state.fileIndex,
    fileIndexLoading: state.fileIndexLoading,
    fileIndexError: state.fileIndexError,
    status: state.status,
    settings: state.settings,
    selectedPath: state.selectedPath,
    selectedPaths: state.selectedPaths,
    tabs: state.tabs,
    activeId: state.activeId,
    treeFocusTick: state.treeFocusTick,
    clipboard: state.clipboard,
  }
}

export function ProjectPanel({ store, state: _state }) {
  // The panel reads its data from a store slice; the `state` prop is still
  // accepted (Workbench.jsx passes it) but no longer used.
  const slice = useStoreSlice(store, projectSlice, shallowEqual)
  const t = store.t
  const [filterOpen, setFilterOpen] = useState(false)
  const [menu, setMenu] = useState(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(600)
  const [renaming, setRenaming] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const scrollRef = useRef(null)
  const treeRef = useRef(null)
  const dragRef = useRef(null)
  const shortcuts = slice.settings?.shortcuts ?? {}
  const shortcutFor = key => shortcuts[key] ?? SHORTCUT_FALLBACK[key] ?? ''
  const showIgnored = slice.settings?.project?.showIgnored === true
  const singleClickOpen = slice.settings?.project?.singleClickOpen === true
  const status = useMemo(() => aggregateStatus(slice.status.entries ?? []), [slice.status])
  const filterMode = slice.filterMode === 'tree' ? 'tree' : 'files'
  const quickRows = useMemo(() => {
    const query = slice.filter.trim().toLowerCase()
    if (filterMode !== 'files' || query === '') return []
    return slice.fileIndex
      .filter(rel => rel.toLowerCase().includes(query))
      .slice(0, 300)
      .map(rel => ({
        kind: 'file',
        key: `quick:${rel}`,
        quick: true,
        entry: {
          name: rel.slice(rel.lastIndexOf('/') + 1),
          path: absoluteOf(slice.root, rel),
          rel,
          isDir: false,
        },
      }))
  }, [filterMode, slice.filter, slice.fileIndex, slice.root])
  // PERF-03: depend on the inputs `flatten` really reads, not on the whole
  // state object — the store replaces the snapshot on every notification, so
  // a `state`-keyed memo never hits and rebuilds the tree every time. The
  // slice carries the three fields `flatten` reads (`dirs`, `expanded`,
  // `root`), and the store replaces them immutably.
  const treeRows = useMemo(
    () => flatten(slice, slice.filter, showIgnored, status.ignored, filterMode),
    flattenInputs(slice, showIgnored, status.ignored, filterMode),
  )
  const rows = filterMode === 'files' && slice.filter.trim() !== '' ? quickRows : treeRows
  const rowPaths = useMemo(() => rows.filter(row => row.entry !== undefined).map(row => row.entry.path), [rows])
  const excluded = slice.settings?.project?.excluded ?? []
  // The callbacks handed to the memoized rows must keep their identity: a
  // changing callback would re-render every row. The values they read are
  // therefore kept in refs and refreshed after each render.
  const rowPathsRef = useRef(rowPaths)
  const selectionRef = useRef(new Set())
  const currentPathsRef = useRef([])

  useEffect(() => {
    if (scrollRef.current === null) return undefined
    const element = scrollRef.current
    const observer = new ResizeObserver(() => setViewport(element.clientHeight))
    observer.observe(element)
    setViewport(element.clientHeight)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if ((slice.treeFocusTick ?? 0) > 0) scrollRef.current?.focus()
  }, [slice.treeFocusTick])

  // A project switch replaces the whole tree; a windowed list that kept the
  // previous scroll offset would render an empty viewport until the user
  // scrolled back.
  useEffect(() => {
    if (scrollRef.current !== null) scrollRef.current.scrollTop = 0
    setScrollTop(0)
  }, [slice.root])

  // Reverse locate: reveal the selected path after any navigation source.
  // The trigger is "the target path is in the rows", not "the row count
  // changed": `setSelectedPath` loads the parent directories asynchronously, so
  // the row only shows up one notification later (PRD TREE-02 risk 1).
  useEffect(() => {
    if (slice.selectedPath === '' || scrollRef.current === null) return
    const index = rows.findIndex(row => row.entry?.path === slice.selectedPath)
    if (index < 0) return
    const top = index * ROW_HEIGHT
    const element = scrollRef.current
    if (top < element.scrollTop || top > element.scrollTop + element.clientHeight - ROW_HEIGHT * 2) {
      element.scrollTop = Math.max(0, top - element.clientHeight / 2)
    }
  }, [slice.selectedPath, rows])

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 6)
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + 6)
  const visible = rows.slice(start, end)

  const selection = useMemo(() => slice.selectedPaths instanceof Set
    ? slice.selectedPaths
    : new Set(slice.selectedPath === '' ? [] : [slice.selectedPath]),
  [slice.selectedPaths, slice.selectedPath])
  const selectedEntries = useMemo(() => rows.filter(row => selection.has(row.entry?.path)).map(row => row.entry), [rows, selection])

  const openMenu = useCallback((event, entry) => {
    event.preventDefault()
    event.stopPropagation()
    if (entry !== undefined && !selectionRef.current.has(entry.path)) store.setSelection([entry.path], entry.path)
    setMenu({ x: event.clientX, y: event.clientY, entry })
  }, [store])

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      store.toast('success', t('common.copied'), text)
    } catch {
      store.toast('error', t('common.error'), String(text))
    }
  }

  const beginRename = (entry) => {
    if (entry === undefined) return
    setRenaming({ path: entry.path, value: entry.name })
  }

  const beginNew = (parentPath, isDir) => {
    setDialog({
      kind: 'new',
      parent: parentPath,
      isDir,
      name: '',
      template: isDir ? 'plain' : 'plain',
    })
  }

  const beginMove = (entries) => {
    setDialog({ kind: 'move', paths: entries.map(entry => entry.path), target: '' })
  }

  const currentEntries = useMemo(() => selectedEntries.length > 0
    ? selectedEntries
    : (menu?.entry !== undefined ? [menu.entry] : []),
  [selectedEntries, menu?.entry])
  const currentEntry = currentEntries[0]
  const currentRel = currentEntry?.rel ?? ''
  const currentPaths = useMemo(() => currentEntries.map(entry => entry.path), [currentEntries])
  const currentRels = useMemo(() => currentEntries.map(entry => entry.rel), [currentEntries])

  // Refresh the values the stable row callbacks read.
  useEffect(() => {
    rowPathsRef.current = rowPaths
    selectionRef.current = selection
    currentPathsRef.current = currentPaths
  })

  const menuItems = useMemo(() => {
    if (menu === null) return []
    const entry = menu.entry
    const isDir = entry?.isDir === true
    const parentDir = entry === undefined ? slice.root : (isDir ? entry.path : parentOf(entry.path))
    const pasteTarget = isDir ? entry.path : (entry === undefined ? slice.root : parentOf(entry.path))
    const shortcut = shortcutFor
    const items = [
      { key: 'quick-open', text: t('quickOpen.title'), shortcut: shortcut('quickOpen'), action: () => store.openQuickOpen() },
      null,
      {
        key: 'send-to-chat', text: t('chat.sendToChat'), icon: React.createElement(IconChat, { width: 13, height: 13 }),
        disabled: currentPaths.length === 0,
        action: () => { void store.sendToChat(currentEntries.map(item => ({ path: item.path, isDir: item.isDir }))) },
      },
      null,
      { key: 'new-file', text: t('project.newFile'), shortcut: 'Alt+Insert', action: () => beginNew(parentDir, false) },
      { key: 'new-dir', text: t('project.newDir'), shortcut: 'Alt+Insert', action: () => beginNew(parentDir, true) },
      null,
      { key: 'cut', text: t('project.cut'), shortcut: shortcut('cut') || 'Ctrl+X', disabled: currentPaths.length === 0, action: () => store.setFileClipboard(currentPaths, true) },
      { key: 'copy', text: t('project.copy'), shortcut: shortcut('copy') || 'Ctrl+C', disabled: currentPaths.length === 0, action: () => store.setFileClipboard(currentPaths, false) },
      { key: 'paste', text: t('project.paste'), shortcut: shortcut('paste') || 'Ctrl+V', disabled: slice.clipboard === null, action: () => store.pasteEntries(pasteTarget) },
      null,
      { key: 'duplicate', text: t('project.duplicate'), shortcut: shortcut('duplicate'), disabled: currentPaths.length === 0, action: () => { void store.duplicateEntries(currentPaths) } },
      { key: 'delete', text: t('project.delete'), shortcut: shortcut('delete'), danger: true, disabled: currentPaths.length === 0, action: () => store.requestDelete(currentPaths) },
      { key: 'rename', text: t('project.rename'), shortcut: shortcut('rename'), disabled: currentEntries.length !== 1, action: () => beginRename(currentEntry) },
      null,
      {
        key: 'copy-path', text: t('project.copyPath'), shortcut: 'Ctrl+Alt+Shift+C', disabled: entry === undefined,
        submenu: [
          { key: 'abs', text: t('project.copyAbsolute'), action: () => { if (entry !== undefined) void copy(entry.path) } },
          { key: 'rel', text: t('project.copyRelative'), action: () => { if (entry !== undefined) void copy(entry.rel) } },
          { key: 'name', text: t('project.copyName'), action: () => { if (entry !== undefined) void copy(entry.name) } },
        ],
      },
      null,
      { key: 'expand', text: t('project.expandAll'), action: () => { void store.expandAll() } },
      { key: 'collapse', text: t('project.collapseAll'), action: () => store.collapseAll() },
      { key: 'sync', text: t('project.synchronize'), shortcut: shortcut('synchronize'), action: () => { void store.sync() } },
      null,
      { key: 'terminal', text: t('project.openTerminal'), action: () => { store.addTerminal({ cwd: isDir ? entry.path : (entry === undefined ? slice.root : parentDir) }) } },
      {
        key: 'sidebar', text: t('project.openInSidebar'), icon: React.createElement(IconGlobe, { width: 13, height: 13 }),
        disabled: entry === undefined || isDir,
        action: () => { if (entry !== undefined && !isDir) void store.openInSidebar(entry.path) },
      },
      { ...openInIdeMenu(store, entry?.path, isDir), icon: React.createElement(IconExternal, { width: 13, height: 13 }) },
      { key: 'reveal', text: t('project.reveal'), icon: React.createElement(IconExternal, { width: 13, height: 13 }), disabled: entry === undefined, action: () => { void store.reveal(entry.path) } },
    ]
    if (entry !== undefined && slice.status.isRepo === true) {
      items.push(null, {
        key: 'git', text: 'Git',
        submenu: [
          { key: 'git-add', text: t('git.add'), disabled: currentRels.length === 0, action: () => { void store.stage(currentRels) } },
          { key: 'git-diff', text: t('git.showDiff'), disabled: currentRels.length !== 1 || isDir, action: () => store.openDiff({ path: currentRel }) },
          { key: 'git-history', text: t('git.showHistory'), disabled: currentRels.length !== 1, action: () => store.showHistory(currentRel) },
        ],
      })
    }
    return items
  }, [menu, currentPaths.join('|'), currentRels.join('|'), shortcuts, slice.root, slice.status.isRepo, slice.clipboard])

  const onRowClick = useCallback((event, entry, quick) => {
    if (entry === undefined) return
    // Keep keyboard actions scoped to the tree (F2/Delete/Ctrl+A).
    scrollRef.current?.focus()
    if (event.ctrlKey || event.metaKey) {
      store.toggleSelection(entry.path)
      return
    }
    if (event.shiftKey) {
      store.selectRange(entry.path, rowPathsRef.current)
      return
    }
    store.setSelection([entry.path], entry.path)
    if (quick === true) {
      store.openFile(entry.path, { rel: entry.rel, preview: true })
      return
    }
    if (!entry.isDir && singleClickOpen) store.openFile(entry.path, { rel: entry.rel, preview: true })
  }, [store, singleClickOpen])

  const onRowDoubleClick = useCallback(entry => {
    if (entry === undefined) return
    if (entry.isDir) store.toggleDir(entry.path)
    else store.openFile(entry.path, { rel: entry.rel, preview: false })
  }, [store])

  /** Toggle a folder from its twisty (the row click must not run as well). */
  const onToggleDir = useCallback(path => { store.toggleDir(path) }, [store])

  // ── keyboard (tree navigator) ─────────────────────────────────────────
  const onKeyDown = (event) => {
    const target = event.target
    if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
    const key = event.key
    const hit = name => matchesShortcut(shortcutFor(name), event)
    if ((event.ctrlKey || event.metaKey) && !event.altKey && key.toLowerCase() === 'a') {
      event.preventDefault()
      event.stopPropagation()
      if (rowPaths.length > 0) store.setSelection(rowPaths, rowPaths[0])
      return
    }
    if (hit('rename')) { event.preventDefault(); beginRename(currentEntry); return }
    if (hit('delete')) { event.preventDefault(); store.requestDelete(currentPaths); return }
    if (hit('duplicate')) { event.preventDefault(); void store.duplicateEntries(currentPaths); return }
    if (hit('move')) { event.preventDefault(); if (currentPaths.length > 0) beginMove(currentEntries); return }
    if (hit('synchronize')) { event.preventDefault(); void store.sync(); return }
    if (event.altKey && key === 'Insert') {
      event.preventDefault()
      const row = rows.find(item => item.entry?.path === slice.selectedPath)
      const parent = row === undefined ? slice.root : (row.entry.isDir ? row.entry.path : parentOf(row.entry.path))
      beginNew(parent, false)
      return
    }
    if (event.ctrlKey && event.altKey && event.shiftKey && (key === 'c' || key === 'C')) {
      event.preventDefault()
      if (currentEntry !== undefined) void copy(currentEntry.rel)
      return
    }
    if (key === 'Enter') {
      event.preventDefault()
      const row = rows.find(item => item.entry?.path === slice.selectedPath)
      if (row === undefined) return
      if (row.entry.isDir) store.toggleDir(row.entry.path)
      else store.openFile(row.entry.path, { rel: row.entry.rel, preview: false })
      return
    }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault()
      const index = rowPaths.indexOf(slice.selectedPath)
      const next = key === 'ArrowDown' ? Math.min(rowPaths.length - 1, index + 1) : Math.max(0, index - 1)
      const path = rowPaths[next]
      if (path !== undefined) store.setSelection([path], path)
      return
    }
    if (key === 'ArrowRight') {
      event.preventDefault()
      const row = rows.find(item => item.entry?.path === slice.selectedPath)
      if (row?.entry?.isDir === true) {
        if (!row.open) store.toggleDir(row.entry.path)
        else {
          const child = rowPaths[rowPaths.indexOf(row.entry.path) + 1]
          if (child !== undefined) store.setSelection([child], child)
        }
      }
      return
    }
    if (key === 'ArrowLeft') {
      event.preventDefault()
      const row = rows.find(item => item.entry?.path === slice.selectedPath)
      if (row?.entry?.isDir === true && row.open) { store.toggleDir(row.entry.path); return }
      const parent = parentOf(slice.selectedPath)
      if (parent !== slice.root && rowPaths.includes(parent)) store.setSelection([parent], parent)
      return
    }
    if (key === 'Escape') { store.clearSelection(); return }
    if ((event.ctrlKey || event.metaKey) && (key === 'c' || key === 'x' || key === 'v')) {
      event.preventDefault()
      if (key === 'v') {
        const pasteTarget = currentEntry?.isDir === true
          ? currentEntry.path
          : (slice.selectedPath === '' ? slice.root : parentOf(slice.selectedPath))
        void store.pasteEntries(pasteTarget)
      } else {
        store.setFileClipboard(currentPaths, key === 'x')
      }
    }
  }

  // ── drag & drop ───────────────────────────────────────────────────────
  const onDragStart = useCallback((event, entry) => {
    if (entry === undefined) return
    const paths = selectionRef.current.has(entry.path) ? currentPathsRef.current : [entry.path]
    dragRef.current = { paths, copy: false }
    event.dataTransfer.effectAllowed = 'copyMove'
    event.dataTransfer.setData('application/x-iwb-paths', JSON.stringify(paths))
    event.dataTransfer.setData('text/plain', paths.join('\n'))
  }, [])

  const onDragOver = useCallback((event, entry) => {
    if (dragRef.current === null) return
    event.stopPropagation()
    const item = entry ?? undefined
    if (item !== undefined && !item.isDir) return
    if (item !== undefined && dragRef.current.paths.includes(item.path)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = event.ctrlKey ? 'copy' : 'move'
    setDropTarget(item?.path ?? slice.root)
  }, [slice.root])

  const onDrop = useCallback((event, entry) => {
    event.stopPropagation()
    if (dragRef.current === null) return
    event.preventDefault()
    const item = entry ?? undefined
    if (item !== undefined && !item.isDir) { setDropTarget(null); return }
    const destination = item?.path ?? slice.root
    const paths = dragRef.current.paths
    const copy = event.ctrlKey
    dragRef.current = null
    setDropTarget(null)
    void store.moveEntries(paths, destination, copy)
  }, [store, slice.root])

  const onDragEnd = useCallback(() => { dragRef.current = null; setDropTarget(null) }, [])

  const commitRename = () => {
    if (renaming === null) return
    const next = renaming.value.trim()
    const current = baseName(renaming.path)
    setRenaming(null)
    if (next === '' || next === current) return
    void store.renameEntry(renaming.path, next)
  }

  const handleRenameChange = value => {
    setRenaming(current => (current === null ? current : { ...current, value }))
  }

  const handleRenameKeyDown = event => {
    event.stopPropagation()
    if (event.key === 'Enter') { event.preventDefault(); commitRename() }
    if (event.key === 'Escape') { event.preventDefault(); setRenaming(null) }
  }

  const submitDialog = () => {
    if (dialog === null) return
    if (dialog.kind === 'new') {
      const name = dialog.name.trim()
      if (name === '') return
      const content = dialog.isDir ? '' : templateContent(dialog.template, name)
      setDialog(null)
      void store.createEntry(dialog.parent, { name, isDir: dialog.isDir, content })
      return
    }
    if (dialog.kind === 'move') {
      const target = dialog.target.trim()
      if (target === '') return
      setDialog(null)
      void store.moveEntries(dialog.paths, target, false)
    }
  }

  const rootRow = slice.root === ''
    ? React.createElement('div', { className: 'iwb-empty' },
        React.createElement('div', { className: 'iwb-empty-title' }, t('project.empty')),
        React.createElement('button', { type: 'button', className: 'iwb-textbtn iwb-primary', onClick: () => store.openRootPicker() }, t('project.openWorkspace')),
      )
    : (filterMode === 'files' && slice.filter.trim() !== '' && rows.length === 0 && slice.fileIndexLoading !== true
        ? React.createElement('div', { className: 'iwb-empty' },
            React.createElement('div', { className: 'iwb-empty-title' }, t('project.noMatches')),
          )
        : React.createElement('div', { className: 'iwb-vlist', style: { height: `${rows.length * ROW_HEIGHT}px` } },
        visible.map((row, index) => {
          const top = (start + index) * ROW_HEIGHT
          const style = { top: `${top}px`, paddingLeft: `${8 + row.depth * 14}px` }
          if (row.kind === 'loading') {
            return React.createElement('div', { key: row.key, className: 'iwb-tree-msg', style: { ...style, position: 'absolute', left: 0, right: 0 } }, t('common.loading'))
          }
          if (row.kind === 'error') {
            return React.createElement('div', {
              key: row.key,
              className: 'iwb-error-box',
              style: { ...style, position: 'absolute', left: 8, right: 8, cursor: 'pointer' },
              title: t('common.retry'),
              onClick: () => { void store.loadDir(row.path, { force: true }) },
            }, row.message)
          }
          if (row.kind === 'note') {
            return React.createElement('div', { key: row.key, className: 'iwb-tree-msg', style: { ...style, position: 'absolute', left: 0, right: 0 } }, row.message)
          }
          const entry = row.entry
          const selected = selection.has(entry.path)
          const kind = row.kind === 'dir' ? status.dirs.get(entry.rel) : status.files.get(entry.rel)
          const ignoredFile = status.ignored.has(entry.rel)
          const excludedEntry = isExcluded(entry.rel, excluded)
          const editing = renaming !== null && renaming.path === entry.path
          const active = row.kind === 'file'
            ? slice.tabs.find(tab => tab.kind === 'file' && tab.path === entry.path && tab.id === slice.activeId) !== undefined
            : false
          return React.createElement(TreeRow, {
            key: row.key,
            entry,
            depth: row.depth,
            top,
            open: row.kind === 'dir' ? row.open : undefined,
            selected,
            statusKind: kind,
            ignored: ignoredFile,
            excluded: excludedEntry,
            dropTarget: dropTarget === entry.path,
            active,
            editing,
            renameValue: editing ? renaming.value : undefined,
            relative: row.quick === true ? entry.rel : undefined,
            quick: row.quick === true,
            onRowClick,
            onRowDoubleClick,
            onContextMenu: openMenu,
            onDragStart,
            onDragOver,
            onDrop,
            onDragEnd,
            onToggleDir,
            onRenameChange: editing ? handleRenameChange : undefined,
            onRenameKeyDown: editing ? handleRenameKeyDown : undefined,
            onRenameBlur: editing ? commitRename : undefined,
          })
        }),
      ))

  const activeTab = useMemo(() => slice.tabs.find(tab => tab.id === slice.activeId), [slice.tabs, slice.activeId])
  const canLocate = activeTab !== undefined && activeTab.kind === 'file'

  /** Locate File: reveal the active file in the tree. */
  const onLocateFile = useCallback(() => {
    if (activeTab === undefined || activeTab.kind !== 'file') return
    // The Project panel must be visible, otherwise the scroll means nothing.
    store.showTool('project')
    // The tab path is already absolute; `setSelectedPath` expands the parent
    // folders and loads them asynchronously.
    store.setSelectedPath(activeTab.path)
  }, [store, activeTab])

  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'iwb-panel-header' },
      React.createElement('span', { className: 'iwb-panel-title' }, t('project.title')),
      React.createElement('button', {
        type: 'button',
        className: 'iwb-project-sub-btn',
        title: `${t('project.selectProject')} — ${slice.root}`,
        onClick: () => store.openProjectPicker(),
      },
        React.createElement('span', { className: 'iwb-project-sub-name' }, baseName(slice.root) || t('project.empty')),
        React.createElement(ChevronDown, { size: 11 }),
      ),
      React.createElement('span', { className: 'iwb-spacer' }),
      React.createElement('button', {
        type: 'button', className: `iwb-iconbtn ${filterOpen ? 'iwb-on' : ''}`, title: t('project.filter'),
        onClick: () => { setFilterOpen(!filterOpen); if (filterOpen) store.setFilter('') },
      }, React.createElement(IconSearch, { width: 14, height: 14 })),
      React.createElement('button', {
        type: 'button', className: 'iwb-iconbtn',
        title: t('project.locateFile'), 'aria-label': t('project.locateFile'),
        disabled: !canLocate,
        onClick: onLocateFile,
      }, React.createElement('span', { style: { fontSize: 15, lineHeight: 1 } }, '\u2316')),
      React.createElement('button', {
        type: 'button', className: 'iwb-iconbtn', title: t('project.newFile'),
        onClick: () => beginNew(slice.root, false),
      }, '+'),
      React.createElement('button', {
        type: 'button', className: 'iwb-iconbtn', title: t('common.refresh'),
        onClick: () => { void store.sync() },
      }, React.createElement(IconRefresh, { width: 14, height: 14 })),
    ),
    filterOpen || slice.filter !== ''
      ? React.createElement('div', { className: 'iwb-filter' },
          React.createElement('div', { className: 'iwb-filter-mode', role: 'group' },
            React.createElement('button', {
              type: 'button', className: filterMode === 'files' ? 'iwb-on' : '',
              title: t('project.filterFiles'),
              onClick: () => store.setFilterMode('files'),
            }, t('project.filterFiles')),
            React.createElement('button', {
              type: 'button', className: filterMode === 'tree' ? 'iwb-on' : '',
              title: t('project.filterTree'),
              onClick: () => store.setFilterMode('tree'),
            }, t('project.filterTree')),
          ),
          React.createElement(IconSearch, { width: 13, height: 13 }),
          React.createElement('input', {
            autoFocus: true,
            placeholder: filterMode === 'tree' ? t('project.filter') : t('project.filterFiles'),
            value: slice.filter,
            onChange: event => store.setFilter(event.target.value),
            onKeyDown: event => { if (event.key === 'Escape') { store.setFilter(''); setFilterOpen(false) } },
          }),
        )
      : null,
    filterMode === 'tree' && slice.filter.trim() !== ''
      ? React.createElement('div', { className: 'iwb-filter-hint' }, t('project.filterTreeHint'))
      : null,
    filterMode === 'files' && slice.filter.trim() !== '' && slice.fileIndexLoading === true
      ? React.createElement('div', { className: 'iwb-filter-hint' }, t('project.filterIndexing'))
      : null,
    filterMode === 'files' && slice.filter.trim() !== '' && slice.fileIndexError !== null
      ? React.createElement('div', { className: 'iwb-filter-hint iwb-error-text' }, t('project.filterError'))
      : null,
    React.createElement('div', {
      className: 'iwb-panel-body iwb-tree',
      ref: scrollRef,
      tabIndex: 0,
      onKeyDown,
      onScroll: event => setScrollTop(event.currentTarget.scrollTop),
      onDragOver: event => onDragOver(event, null),
      onDrop: event => onDrop(event, null),
      onContextMenu: event => { if (event.target === event.currentTarget) openMenu(event, undefined) },
    }, rootRow),
    menu !== null ? React.createElement(ContextMenu, { x: menu.x, y: menu.y, items: menuItems, onClose: () => setMenu(null) }) : null,
    dialog !== null && dialog.kind === 'new'
      ? React.createElement('div', { className: 'iwb-modal-backdrop', onMouseDown: event => { if (event.target === event.currentTarget) setDialog(null) } },
          React.createElement('div', { className: 'iwb-modal', role: 'dialog', 'aria-modal': 'true' },
            React.createElement('h2', null, dialog.isDir ? t('project.newDir') : t('project.newFile')),
            React.createElement('label', { className: 'iwb-field' },
              React.createElement('span', null, t('project.nameLabel')),
              React.createElement('input', {
                autoFocus: true, value: dialog.name,
                onChange: event => setDialog({ ...dialog, name: event.target.value }),
                onKeyDown: event => { if (event.key === 'Enter') { event.preventDefault(); submitDialog() } },
              }),
            ),
            !dialog.isDir
              ? React.createElement('label', { className: 'iwb-field' },
                  React.createElement('span', null, t('project.templateLabel')),
                  React.createElement('select', {
                    value: dialog.template,
                    onChange: event => {
                      const template = NEW_TEMPLATES.find(item => item.id === event.target.value)
                      const ext = template?.ext ?? ''
                      const name = dialog.name.includes('.') ? dialog.name : `${dialog.name}${ext}`
                      setDialog({ ...dialog, template: event.target.value, name })
                    },
                  }, NEW_TEMPLATES.map(template => React.createElement('option', { key: template.id, value: template.id }, t(template.labelKey)))),
                )
              : null,
            React.createElement('div', { className: 'iwb-modal-actions' },
              React.createElement('button', { type: 'button', className: 'iwb-textbtn', onClick: () => setDialog(null) }, t('common.cancel')),
              React.createElement('button', { type: 'button', className: 'iwb-textbtn iwb-primary', onClick: submitDialog }, t('project.create')),
            ),
          ),
        )
      : null,
    dialog !== null && dialog.kind === 'move'
      ? React.createElement('div', { className: 'iwb-modal-backdrop', onMouseDown: event => { if (event.target === event.currentTarget) setDialog(null) } },
          React.createElement('div', { className: 'iwb-modal', role: 'dialog', 'aria-modal': 'true' },
            React.createElement('h2', null, t('project.moveTitle')),
            React.createElement('p', null, dialog.paths.map(path => baseName(path)).join(', ')),
            React.createElement('label', { className: 'iwb-field' },
              React.createElement('span', null, t('project.moveTarget')),
              React.createElement('input', {
                autoFocus: true, value: dialog.target, placeholder: t('project.movePlaceholder'),
                onChange: event => setDialog({ ...dialog, target: event.target.value }),
                onKeyDown: event => { if (event.key === 'Enter') { event.preventDefault(); submitDialog() } },
              }),
            ),
            React.createElement('div', { className: 'iwb-modal-actions' },
              React.createElement('button', { type: 'button', className: 'iwb-textbtn', onClick: () => setDialog(null) }, t('common.cancel')),
              React.createElement('button', { type: 'button', className: 'iwb-textbtn iwb-primary', onClick: submitDialog }, t('project.move')),
            ),
          ),
        )
      : null,
  )
}
