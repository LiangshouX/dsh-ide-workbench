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
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ContextMenu } from './ui.jsx'
import { FileTypeIcon, IconChat, IconExternal, IconGlobe, IconRefresh, IconSearch } from './icons.jsx'
import { openInIdeMenu } from './ide-menu.js'
import { aggregateStatus, statusClass } from './git-colors.js'
import { baseName, matchesShortcut } from './util.js'

const ROW_HEIGHT = 22

/** Shortcut defaults used when the running host still returns a pre-v2 document. */
const SHORTCUT_FALLBACK = {
  rename: 'F2',
  delete: 'Delete',
  duplicate: 'F5',
  move: 'F6',
  synchronize: 'Ctrl+Alt+Y',
  favorite: 'Alt+Shift+F',
  compare: 'Ctrl+D',
  findInFiles: 'Ctrl+Shift+F',
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
function flatten(state, filter, showIgnored, ignored, mode = 'tree') {
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

export function ProjectPanel({ store, state }) {
  const t = store.t
  const [filterOpen, setFilterOpen] = useState(false)
  const [menu, setMenu] = useState(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(600)
  const [renaming, setRenaming] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [dropTarget, setDropTarget] = useState(null)
  const scrollRef = useRef(null)
  const treeRef = useRef(null)
  const dragRef = useRef(null)
  const shortcuts = state.settings?.shortcuts ?? {}
  const shortcutFor = key => shortcuts[key] ?? SHORTCUT_FALLBACK[key] ?? ''
  const showIgnored = state.settings?.project?.showIgnored === true
  const singleClickOpen = state.settings?.project?.singleClickOpen === true
  const status = useMemo(() => aggregateStatus(state.status.entries ?? []), [state.status])
  const filterMode = state.filterMode === 'tree' ? 'tree' : 'files'
  const quickRows = useMemo(() => {
    const query = state.filter.trim().toLowerCase()
    if (filterMode !== 'files' || query === '') return []
    return state.fileIndex
      .filter(rel => rel.toLowerCase().includes(query))
      .slice(0, 300)
      .map(rel => ({
        kind: 'file',
        key: `quick:${rel}`,
        quick: true,
        entry: {
          name: rel.slice(rel.lastIndexOf('/') + 1),
          path: absoluteOf(state.root, rel),
          rel,
          isDir: false,
        },
      }))
  }, [filterMode, state.filter, state.fileIndex, state.root])
  const treeRows = useMemo(() => flatten(state, state.filter, showIgnored, status.ignored, filterMode), [state, state.filter, showIgnored, status, filterMode])
  const rows = filterMode === 'files' && state.filter.trim() !== '' ? quickRows : treeRows
  const rowPaths = useMemo(() => rows.filter(row => row.entry !== undefined).map(row => row.entry.path), [rows])
  const excluded = state.settings?.project?.excluded ?? []

  useEffect(() => {
    if (scrollRef.current === null) return undefined
    const element = scrollRef.current
    const observer = new ResizeObserver(() => setViewport(element.clientHeight))
    observer.observe(element)
    setViewport(element.clientHeight)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if ((state.treeFocusTick ?? 0) > 0) scrollRef.current?.focus()
  }, [state.treeFocusTick])

  // A project switch replaces the whole tree; a windowed list that kept the
  // previous scroll offset would render an empty viewport until the user
  // scrolled back.
  useEffect(() => {
    if (scrollRef.current !== null) scrollRef.current.scrollTop = 0
    setScrollTop(0)
  }, [state.root])

  // Reverse locate: reveal the selected path after any navigation source.
  useEffect(() => {
    if (state.selectedPath === '' || scrollRef.current === null) return
    const index = rows.findIndex(row => row.entry?.path === state.selectedPath)
    if (index < 0) return
    const top = index * ROW_HEIGHT
    const element = scrollRef.current
    if (top < element.scrollTop || top > element.scrollTop + element.clientHeight - ROW_HEIGHT * 2) {
      element.scrollTop = Math.max(0, top - element.clientHeight / 2)
    }
  }, [state.selectedPath, rows.length])

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 6)
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + 6)
  const visible = rows.slice(start, end)

  const selection = state.selectedPaths instanceof Set ? state.selectedPaths : new Set(state.selectedPath === '' ? [] : [state.selectedPath])
  const selectedEntries = rows.filter(row => selection.has(row.entry?.path)).map(row => row.entry)

  const openMenu = (event, row) => {
    event.preventDefault()
    event.stopPropagation()
    const entry = row?.entry
    if (entry !== undefined && !selection.has(entry.path)) store.setSelection([entry.path], entry.path)
    setMenu({ x: event.clientX, y: event.clientY, row })
  }

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

  const currentEntries = selectedEntries.length > 0
    ? selectedEntries
    : (menu?.row?.entry !== undefined ? [menu.row.entry] : [])
  const currentEntry = currentEntries[0]
  const currentRel = currentEntry?.rel ?? ''
  const currentPaths = currentEntries.map(entry => entry.path)
  const currentRels = currentEntries.map(entry => entry.rel)

  const menuItems = useMemo(() => {
    if (menu === null) return []
    const entry = menu.row?.entry
    const isDir = entry?.isDir === true
    const parentDir = entry === undefined ? state.root : (isDir ? entry.path : parentOf(entry.path))
    const pasteTarget = isDir ? entry.path : (entry === undefined ? state.root : parentOf(entry.path))
    const shortcut = shortcutFor
    const items = [
      { key: 'find-in-files', text: t('search.title'), shortcut: shortcut('findInFiles'), action: () => store.openSearchTab() },
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
      { key: 'paste', text: t('project.paste'), shortcut: shortcut('paste') || 'Ctrl+V', disabled: store.state.clipboard === null, action: () => store.pasteEntries(pasteTarget) },
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
      { key: 'favorite', text: t('project.addFavorite'), shortcut: shortcut('favorite'), disabled: currentPaths.length === 0, action: () => { void store.toggleFavorite(currentPaths) } },
      { key: 'terminal', text: t('project.openTerminal'), action: () => { store.addTerminal({ cwd: isDir ? entry.path : (entry === undefined ? state.root : parentDir) }) } },
      {
        key: 'sidebar', text: t('project.openInSidebar'), icon: React.createElement(IconGlobe, { width: 13, height: 13 }),
        disabled: entry === undefined || isDir,
        action: () => { if (entry !== undefined && !isDir) void store.openInSidebar(entry.path) },
      },
      { ...openInIdeMenu(store, entry?.path, isDir), icon: React.createElement(IconExternal, { width: 13, height: 13 }) },
      { key: 'reveal', text: t('project.reveal'), icon: React.createElement(IconExternal, { width: 13, height: 13 }), disabled: entry === undefined, action: () => { void store.reveal(entry.path) } },
    ]
    if (entry !== undefined && state.status.isRepo === true) {
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
  }, [menu, currentPaths.join('|'), currentRels.join('|'), shortcuts, state.root, state.status.isRepo, state.clipboard])

  const onRowClick = (event, row) => {
    const entry = row.entry
    if (entry === undefined) return
    // Keep keyboard actions scoped to the tree (F2/Delete/Ctrl+A).
    scrollRef.current?.focus()
    if (event.ctrlKey || event.metaKey) {
      store.toggleSelection(entry.path)
      return
    }
    if (event.shiftKey) {
      store.selectRange(entry.path, rowPaths)
      return
    }
    store.setSelection([entry.path], entry.path)
    if (row.quick === true) {
      store.openFile(entry.path, { rel: entry.rel, preview: true })
      return
    }
    if (!entry.isDir && singleClickOpen) store.openFile(entry.path, { rel: entry.rel, preview: true })
  }

  const onRowDoubleClick = (row) => {
    const entry = row.entry
    if (entry === undefined) return
    if (entry.isDir) store.toggleDir(entry.path)
    else store.openFile(entry.path, { rel: entry.rel, preview: false })
  }

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
    if (hit('favorite')) { event.preventDefault(); void store.toggleFavorite(currentPaths); return }
    if (event.altKey && key === 'Insert') {
      event.preventDefault()
      const row = rows.find(item => item.entry?.path === state.selectedPath)
      const parent = row === undefined ? state.root : (row.entry.isDir ? row.entry.path : parentOf(row.entry.path))
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
      const row = rows.find(item => item.entry?.path === state.selectedPath)
      if (row === undefined) return
      if (row.entry.isDir) store.toggleDir(row.entry.path)
      else store.openFile(row.entry.path, { rel: row.entry.rel, preview: false })
      return
    }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault()
      const index = rowPaths.indexOf(state.selectedPath)
      const next = key === 'ArrowDown' ? Math.min(rowPaths.length - 1, index + 1) : Math.max(0, index - 1)
      const path = rowPaths[next]
      if (path !== undefined) store.setSelection([path], path)
      return
    }
    if (key === 'ArrowRight') {
      event.preventDefault()
      const row = rows.find(item => item.entry?.path === state.selectedPath)
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
      const row = rows.find(item => item.entry?.path === state.selectedPath)
      if (row?.entry?.isDir === true && row.open) { store.toggleDir(row.entry.path); return }
      const parent = parentOf(state.selectedPath)
      if (parent !== state.root && rowPaths.includes(parent)) store.setSelection([parent], parent)
      return
    }
    if (key === 'Escape') { store.clearSelection(); return }
    if ((event.ctrlKey || event.metaKey) && (key === 'c' || key === 'x' || key === 'v')) {
      event.preventDefault()
      if (key === 'v') {
        const pasteTarget = currentEntry?.isDir === true
          ? currentEntry.path
          : (state.selectedPath === '' ? state.root : parentOf(state.selectedPath))
        void store.pasteEntries(pasteTarget)
      } else {
        store.setFileClipboard(currentPaths, key === 'x')
      }
    }
  }

  // ── drag & drop ───────────────────────────────────────────────────────
  const onDragStart = (event, row) => {
    const entry = row.entry
    if (entry === undefined) return
    const paths = selection.has(entry.path) ? currentPaths : [entry.path]
    dragRef.current = { paths, copy: false }
    event.dataTransfer.effectAllowed = 'copyMove'
    event.dataTransfer.setData('application/x-iwb-paths', JSON.stringify(paths))
    event.dataTransfer.setData('text/plain', paths.join('\n'))
  }

  const onDragOver = (event, row) => {
    if (dragRef.current === null) return
    event.stopPropagation()
    const entry = row?.entry
    if (entry !== undefined && !entry.isDir) return
    if (entry !== undefined && dragRef.current.paths.includes(entry.path)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = event.ctrlKey ? 'copy' : 'move'
    setDropTarget(entry?.path ?? state.root)
  }

  const onDrop = (event, row) => {
    event.stopPropagation()
    if (dragRef.current === null) return
    event.preventDefault()
    const entry = row?.entry
    if (entry !== undefined && !entry.isDir) { setDropTarget(null); return }
    const target = entry?.path ?? state.root
    const paths = dragRef.current.paths
    const copy = event.ctrlKey
    dragRef.current = null
    setDropTarget(null)
    void store.moveEntries(paths, target, copy)
  }

  const onDragEnd = () => { dragRef.current = null; setDropTarget(null) }

  const commitRename = () => {
    if (renaming === null) return
    const next = renaming.value.trim()
    const current = baseName(renaming.path)
    setRenaming(null)
    if (next === '' || next === current) return
    void store.renameEntry(renaming.path, next)
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

  const rootRow = state.root === ''
    ? React.createElement('div', { className: 'iwb-empty' },
        React.createElement('div', { className: 'iwb-empty-title' }, t('project.empty')),
        React.createElement('button', { type: 'button', className: 'iwb-textbtn iwb-primary', onClick: () => store.openRootPicker() }, t('project.openWorkspace')),
      )
    : (filterMode === 'files' && state.filter.trim() !== '' && rows.length === 0 && state.fileIndexLoading !== true
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
          const classes = [
            'iwb-vlist-row', 'iwb-tree-row',
            selected ? 'iwb-selected' : '',
            kind !== undefined ? statusClass(kind) : '',
            ignoredFile ? 'iwb-git-ignored' : '',
            excludedEntry ? 'iwb-excluded' : '',
            dropTarget === entry.path ? 'iwb-drop-target' : '',
          ].filter(Boolean).join(' ')
          if (row.kind === 'dir') {
            return React.createElement('div', {
              key: row.key,
              className: classes,
              style,
              title: entry.rel,
              draggable: true,
              onClick: event => onRowClick(event, row),
              onDoubleClick: () => onRowDoubleClick(row),
              onContextMenu: event => openMenu(event, row),
              onDragStart: event => onDragStart(event, row),
              onDragOver: event => onDragOver(event, row),
              onDrop: event => onDrop(event, row),
              onDragEnd,
            },
              React.createElement('span', { className: 'iwb-tree-twisty' }, row.open ? React.createElement(ChevronDown, null) : React.createElement(ChevronRight, null)),
              React.createElement(FileTypeIcon, { name: entry.name, isDir: true, open: row.open, size: 15 }),
              React.createElement('span', { className: 'iwb-tree-name iwb-dir' }, entry.name),
            )
          }
          const active = state.tabs.find(tab => tab.kind === 'file' && tab.path === entry.path && tab.id === state.activeId)
          const editing = renaming !== null && renaming.path === entry.path
          return React.createElement('div', {
            key: row.key,
            className: `${classes} ${active !== undefined ? 'iwb-opened' : ''}`,
            style,
            title: entry.rel,
            draggable: !editing,
            onClick: event => onRowClick(event, row),
            onDoubleClick: () => onRowDoubleClick(row),
            onContextMenu: event => openMenu(event, row),
            onDragStart: event => onDragStart(event, row),
            onDragOver: event => onDragOver(event, row),
            onDrop: event => onDrop(event, row),
            onDragEnd,
          },
            React.createElement('span', { className: 'iwb-tree-twisty' }),
            React.createElement(FileTypeIcon, { name: entry.name, size: 15 }),
            editing
              ? React.createElement('input', {
                  className: 'iwb-rename-input',
                  autoFocus: true,
                  value: renaming.value,
                  onChange: event => setRenaming({ ...renaming, value: event.target.value }),
                  onKeyDown: event => {
                    event.stopPropagation()
                    if (event.key === 'Enter') { event.preventDefault(); commitRename() }
                    if (event.key === 'Escape') { event.preventDefault(); setRenaming(null) }
                  },
                  onBlur: commitRename,
                  onClick: event => event.stopPropagation(),
                  onDoubleClick: event => event.stopPropagation(),
                })
              : React.createElement('span', { className: 'iwb-tree-name' }, entry.name),
            row.quick === true
              ? React.createElement('span', { className: 'iwb-tree-relative' }, entry.rel)
              : null,
          )
        }),
      ))

  const favorites = state.settings?.favorites ?? []
  const favoritesPanel = favoritesOpen && favorites.length > 0
    ? React.createElement('div', { className: 'iwb-favorites' },
        favorites.map(path => React.createElement('div', {
          key: path, className: 'iwb-favorite-row', title: path,
          onClick: () => { void store.openFile(path, { rel: path, preview: false }) },
        },
          React.createElement('span', { className: 'iwb-favorite-star' }, '★'),
          React.createElement('span', { className: 'iwb-favorite-name' }, baseName(path)),
          React.createElement('button', {
            type: 'button', className: 'iwb-iconbtn iwb-favorite-remove', title: t('project.removeFavorite'),
            onClick: event => { event.stopPropagation(); void store.toggleFavorite([path]) },
          }, '×'),
        )),
      )
    : null

  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'iwb-panel-header' },
      React.createElement('span', { className: 'iwb-panel-title' }, t('project.title')),
      React.createElement('button', {
        type: 'button',
        className: 'iwb-project-sub-btn',
        title: `${t('project.selectProject')} — ${state.root}`,
        onClick: () => store.openProjectPicker(),
      },
        React.createElement('span', { className: 'iwb-project-sub-name' }, baseName(state.root) || t('project.empty')),
        React.createElement(ChevronDown, { size: 11 }),
      ),
      React.createElement('span', { className: 'iwb-spacer' }),
      React.createElement('button', {
        type: 'button', className: `iwb-iconbtn ${favoritesOpen ? 'iwb-on' : ''}`, title: t('project.favorites'),
        onClick: () => setFavoritesOpen(!favoritesOpen),
      }, '★'),
      React.createElement('button', {
        type: 'button', className: 'iwb-iconbtn', title: `${t('search.title')} (${shortcutFor('findInFiles')})`,
        onClick: () => store.openSearchTab(),
      }, React.createElement('span', { style: { fontSize: 16, lineHeight: 1 } }, '\u2315')),
      React.createElement('button', {
        type: 'button', className: `iwb-iconbtn ${filterOpen ? 'iwb-on' : ''}`, title: t('project.filter'),
        onClick: () => { setFilterOpen(!filterOpen); if (filterOpen) store.setFilter('') },
      }, React.createElement(IconSearch, { width: 14, height: 14 })),
      React.createElement('button', {
        type: 'button', className: 'iwb-iconbtn', title: t('project.newFile'),
        onClick: () => beginNew(state.root, false),
      }, '+'),
      React.createElement('button', {
        type: 'button', className: 'iwb-iconbtn', title: t('common.refresh'),
        onClick: () => { void store.sync() },
      }, React.createElement(IconRefresh, { width: 14, height: 14 })),
    ),
    favoritesPanel,
    filterOpen || state.filter !== ''
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
            value: state.filter,
            onChange: event => store.setFilter(event.target.value),
            onKeyDown: event => { if (event.key === 'Escape') { store.setFilter(''); setFilterOpen(false) } },
          }),
        )
      : null,
    filterMode === 'tree' && state.filter.trim() !== ''
      ? React.createElement('div', { className: 'iwb-filter-hint' }, t('project.filterTreeHint'))
      : null,
    filterMode === 'files' && state.filter.trim() !== '' && state.fileIndexLoading === true
      ? React.createElement('div', { className: 'iwb-filter-hint' }, t('project.filterIndexing'))
      : null,
    filterMode === 'files' && state.filter.trim() !== '' && state.fileIndexError !== null
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
      onContextMenu: event => { if (event.target === event.currentTarget) openMenu(event, { entry: undefined }) },
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
