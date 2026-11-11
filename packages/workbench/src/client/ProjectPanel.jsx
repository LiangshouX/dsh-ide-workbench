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
import { statusClass, stableAggregateStatus } from './git-colors.js'
import { compactLabel, compactTree } from './compact-path.js'
import { shallowEqual, useStoreSlice } from './hooks.js'
import { relativePathWithin } from './workspace-scope.js'
import { baseName, matchesShortcut } from './util.js'

const ROW_HEIGHT = 22

/** The width of one character of the tree label, for the width estimate. */
const STICKY_CHAR_WIDTH = 7
/** What the frozen bar needs besides its labels: the twisty and the padding. */
const STICKY_CHROME = 40

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

/**
 * The repository the git status belongs to.
 *
 * The Git window may read another repository than the Project tree (GIT-01),
 * and the status is taken from that one — so the status keys are
 * repository-relative while the tree speaks project-relative paths.
 *
 * @param {{ root: string, gitRepoRoot?: string }} tree the tree slice
 * @returns {string} the absolute repository root
 */
export function gitRootOf(tree) {
  return typeof tree.gitRepoRoot === 'string' && tree.gitRepoRoot !== '' ? tree.gitRepoRoot : tree.root
}

/**
 * The status key of one absolute path: relative to the repository the Git
 * window reads.
 *
 * `null` means the path lives outside that repository — such a file has no
 * status entry and must never borrow the colour of a same-named file in
 * another repository.
 *
 * @param {{ root: string, gitRepoRoot?: string }} tree the tree slice
 * @param {string} absolute the absolute path of a tree entry
 * @returns {string | null} the repository-relative key
 */
export function statusKeyOf(tree, absolute) {
  return relativePathWithin(gitRootOf(tree), absolute)
}

/**
 * The repository-relative key of one project-relative path.
 *
 * The git layer runs at the repository the Git window reads (GIT-01), so the
 * tree has to hand over repository-relative paths. `null` means the file does
 * not live in that repository — the git actions do not apply to it.
 *
 * @param {{ root: string, gitRepoRoot?: string }} tree the tree slice
 * @param {string} rel the project-relative path
 * @returns {string | null} the repository-relative key
 */
export function repoRelOf(tree, rel) {
  if (typeof rel !== 'string' || rel === '') return null
  return statusKeyOf(tree, absoluteOf(tree.root, rel))
}

/**
 * The Git submenu of the tree context menu.
 *
 * The git layer runs at the repository the Git window reads, so the tree hands
 * over repository-relative paths — the Commit panel sends the very same ones
 * (its status entries are repository-relative). A file outside that repository
 * has no key: the action does not apply to it.
 *
 * showHistory is the exception: the store converts that one itself, so it
 * must not be converted twice (PRD-v4 review M8).
 *
 * @param {object} tree the tree slice
 * @param {string[]} currentRels project-relative paths of the selection
 * @param {string} currentRel project-relative path of the focused entry
 * @param {boolean} isDir whether the focused entry is a folder
 * @param {{ t: (key: string) => string, store: any }} tools
 * @returns {Array<object>} the submenu items
 */
export function gitMenuItems(tree, currentRels, currentRel, isDir, tools) {
  const repoRels = currentRels.map(rel => repoRelOf(tree, rel)).filter(rel => rel !== null)
  const repoRel = repoRelOf(tree, currentRel)
  const { t, store } = tools
  return [
    { key: 'git-add', text: t('git.add'), disabled: repoRels.length === 0, action: () => { void store.stage(repoRels) } },
    { key: 'git-diff', text: t('git.showDiff'), disabled: repoRel === null || repoRels.length !== 1 || isDir, action: () => { if (repoRel !== null) store.openDiff({ path: repoRel }) } },
    { key: 'git-history', text: t('git.showHistory'), disabled: currentRels.length !== 1, action: () => store.showHistory(currentRel) },
  ]
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
  // The ignored set is keyed by the repository-relative path, not by the
  // project-relative one (see `statusKeyOf`).
  const gitRoot = gitRootOf(state)
  const visible = entry => showIgnored || !ignored.has(relativePathWithin(gitRoot, entry.path))

  /**
   * The compact view of one entry (R5).
   *
   * A folder that holds nothing but one sub-folder is the start of a package
   * chain (`com/liangshou/adapter/controller`) and shows up as a single row.
   * The children of a folder are only known when the folder has been loaded,
   * so an unloaded folder ends a chain - deciding a merge never costs a
   * directory read (zero extra IO).
   */
  const nodeOf = entry => {
    if (!entry.isDir) return { name: entry.name, path: entry.path, kind: 'file', entry }
    const dir = dirs.get(entry.path)
    const loaded = dir !== undefined && dir.entries !== undefined
    let children
    if (loaded) {
      // Only a folder that holds exactly one sub-folder can start a chain.
      // The count stops at the second visible child, so a folder with many
      // entries costs two lookups - the tree stays as cheap as it was before
      // the merging.
      let only = null
      let count = 0
      for (const child of dir.entries) {
        if (!visible(child)) continue
        count += 1
        if (count > 1) break
        only = child
      }
      children = count === 1 && only.isDir === true ? [nodeOf(only)] : []
    }
    return { name: entry.name, path: entry.path, kind: 'dir', entry, children }
  }

  /** The rows of one level, with its package chains merged. */
  const pushLevel = (entries, depth) => {
    for (const node of compactTree(entries.filter(visible).map(nodeOf))) {
      if (node.kind === 'file') {
        if (normalized !== '' && !node.name.toLowerCase().includes(normalized) && !node.entry.rel.toLowerCase().includes(normalized)) continue
        rows.push({ kind: 'file', key: node.path, entry: node.entry, depth })
        continue
      }
      // A merged row stands for the whole chain: its path is the LEAF of the
      // chain, so the git status, the excluded background, the selection and
      // the context menu keep working without a second set of rules.
      const merged = node.merged === true
      const entry = merged ? { ...node.entry, merged: true, segments: node.segments } : node.entry
      rows.push({
        kind: 'dir',
        key: node.path,
        entry,
        depth,
        open: isExpanded(node.path),
        merged,
        // The label of a merged row is the dot-joined chain; the title stays
        // the full relative path of the chain's leaf.
        label: merged ? compactLabel(node, '.') : undefined,
        segments: merged ? node.segments : undefined,
      })
      if (isExpanded(node.path)) walk(node.path, depth + 1)
    }
  }

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
    pushLevel(dir.entries, depth)
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

  pushLevel(rootDir.entries, 0)
  return rows
}

/**
 * The nearest ancestor of `path` that is still a visible row.
 *
 * A merged row hides the folders of its chain, so the exact parent of a file
 * is not always a row any more - the walk has to skip the hidden ones. The
 * root is not a row either: it ends the walk.
 *
 * @param {string} path the absolute path of a row
 * @param {Set<string>} paths the paths of every visible row
 * @param {string} root the project root
 * @returns {string | null} the path of the nearest visible ancestor
 */
export function visibleAncestorOf(path, paths, root) {
  if (typeof path !== 'string' || path === '') return null
  const known = paths instanceof Set ? paths : new Set(Array.isArray(paths) ? paths : [])
  let current = parentOf(path)
  while (current !== '' && current !== root && current !== parentOf(current)) {
    if (known.has(current)) return current
    current = parentOf(current)
  }
  return null
}

/**
 * The chain of folders the viewport sits in - the content of the frozen bar
 * (R4).
 *
 * The tree rows are absolutely positioned (the tree is virtualised), so CSS
 * `position: sticky` cannot hold one of them in place: the frozen bar is a
 * layer of its own and its content has to be rebuilt from the row model,
 * because the ancestor rows are not mounted while they are scrolled out.
 *
 * The bar carries the WHOLE chain from the project root down to the folder
 * the viewport starts in, not only the last name: a reader has to see WHERE
 * the tree is, not just the name of the folder. The chain follows the rows
 * that are really there, so a merged row contributes its whole chain
 * (`src.main.java.com`) as one step.
 *
 * @param {Array<object>} rows the rendered rows
 * @param {number} scrollTop the scroll offset of the tree
 * @param {Set<string>} paths the paths of every visible row
 * @param {string} root the project root
 * @returns {Array<{ path: string, label: string, title: string }>} the chain,
 *   from the topmost visible folder down to the current one
 */
export function currentFolderChainOf(rows, scrollTop, paths, root) {
  if (!Array.isArray(rows) || rows.length === 0) return []
  const offset = Number.isFinite(scrollTop) ? scrollTop : 0
  const index = Math.min(rows.length - 1, Math.max(0, Math.floor(offset / ROW_HEIGHT)))
  const row = rows[index]
  if (row?.entry === undefined) return []
  const byPath = new Map()
  for (const item of rows) {
    if (item.kind === 'dir' && item.entry !== undefined) byPath.set(item.entry.path, item)
  }
  const chain = []
  let current = row.entry.path
  const seen = new Set()
  while (current !== '' && current !== root) {
    if (seen.has(current)) break
    seen.add(current)
    const parent = visibleAncestorOf(current, paths, root)
    if (parent === null) break
    const item = byPath.get(parent)
    if (item === undefined) break
    chain.unshift({
      path: parent,
      // A merged row stands for a chain of folders: it names all of them.
      label: item.merged === true && Array.isArray(item.segments) && item.segments.length > 1
        ? item.segments.join('.')
        : (item.entry?.name ?? ''),
      title: item.entry?.rel ?? '',
    })
    current = parent
  }
  return chain
}

/**
 * The folder the viewport sits in - the last step of the chain of the frozen
 * bar (R4).
 *
 * @param {Array<object>} rows the rendered rows
 * @param {number} scrollTop the scroll offset of the tree
 * @param {Set<string>} paths the paths of every visible row
 * @param {string} root the project root
 * @returns {string | null} the path of the current folder
 */
export function currentFolderPathOf(rows, scrollTop, paths, root) {
  const chain = currentFolderChainOf(rows, scrollTop, paths, root)
  if (chain.length === 0) return null
  return chain[chain.length - 1].path
}

/**
 * Fit the chain of the frozen bar into the width that is available (R4).
 *
 * The bar carries the whole path, so it can be longer than the panel. Three
 * steps, in this order:
 * 1. the whole chain;
 * 2. the middle is elided: the first step and the last one stay;
 * 3. the project root is elided as well: only the last step stays, behind an
 *    ellipsis.
 *
 * The last step is the folder the viewport is in - it is never dropped: it is
 * the one the reader needs.
 *
 * @param {Array<{ label: string }>} chain the steps of the chain
 * @param {number} [width] the width of the panel, in pixels
 * @returns {Array<string>} the labels to show
 */
export function fitFolderChain(chain, width) {
  const steps = Array.isArray(chain) ? chain : []
  if (steps.length === 0) return []
  const limit = typeof width === 'number' && Number.isFinite(width) && width > 0
    ? Math.max(8, Math.floor((width - STICKY_CHROME) / STICKY_CHAR_WIDTH))
    : undefined
  // Without a width the whole chain is shown: the bar clips it.
  if (limit === undefined) return steps
  const length = steps.map(step => step.label).join(' › ').length
  if (length <= limit) return steps
  if (steps.length === 1) return steps
  const first = steps[0]
  const last = steps[steps.length - 1]
  const middle = [{ label: first.label, path: first.path, title: first.title }, { label: '…', path: null, title: '' }, last]
  if (middle.map(step => step.label).join(' › ').length <= limit) return middle
  return [{ label: '…', path: null, title: '' }, last]
}

/**
 * Resolve the "full path" of a new entry against the project root (R5).
 *
 * The path is relative to the project root. Everything that could leave the
 * project - an absolute path, a `..` segment, an empty segment - is refused
 * here, before a single file is written.
 *
 * @param {string} value the path the user typed
 * @returns {{ ok: true, path: string, name: string } | { ok: false, detail: string }}
 *   the resolved path, or the reason why it was refused
 */
export function resolveEntryPath(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (raw === '') return { ok: false, detail: 'the path is empty' }
  const slashed = raw.replace(/\\/g, '/')
  if (slashed.startsWith('/') || /^[a-zA-Z]:/.test(slashed)) {
    return { ok: false, detail: 'the path is absolute' }
  }
  const parts = slashed.split('/')
  for (const part of parts) {
    if (part === '') return { ok: false, detail: 'the path has an empty segment' }
    if (part === '.' || part === '..') return { ok: false, detail: 'the path leaves the project root' }
  }
  return { ok: true, path: parts.join('/'), name: parts[parts.length - 1] }
}

/**
 * The state of the new-entry dialog when it opens (R5).
 *
 * The path box starts with the full relative path of the folder the entry
 * goes into; it is read-only until the user clicks into it.
 *
 * @param {string} parent the absolute path of the target folder
 * @param {boolean} isDir whether a folder is created
 * @param {string} root the project root
 * @returns {object} the dialog state
 */
export function newEntryDialogState(parent, isDir, root) {
  const rel = relativePathWithin(root, parent)
  const base = rel === null ? '' : rel
  return {
    kind: 'new',
    parent,
    isDir,
    name: '',
    template: 'plain',
    base,
    path: base,
    pathEdited: false,
  }
}

/**
 * Apply the name of the entry to the dialog state.
 *
 * The path box follows the name: while it has not been edited it points at
 * the folder the dialog was opened on, afterwards it keeps the folder the
 * user has chosen.
 *
 * @param {object} dialog the dialog state
 * @param {string} name the new name
 * @returns {object} the next dialog state
 */
export function withDialogName(dialog, name) {
  if (dialog === null || dialog === undefined) return dialog
  const path = name === ''
    ? dialog.base
    : (dialog.pathEdited === true ? replaceLastSegment(dialog.path, name) : joinRelative(dialog.base, name))
  return { ...dialog, name, path }
}

/**
 * Apply the path of the entry to the dialog state.
 *
 * The last segment of the path is the name of the entry.
 *
 * @param {object} dialog the dialog state
 * @param {string} path the new path
 * @returns {object} the next dialog state
 */
export function withDialogPath(dialog, path) {
  if (dialog === null || dialog === undefined) return dialog
  return {
    ...dialog,
    path,
    pathEdited: true,
    name: baseName(String(path).replace(/\\/g, '/')),
  }
}

/**
 * Unlock the path box: it is read-only until the mouse clicks into it.
 *
 * @param {object} dialog the dialog state
 * @returns {object} the next dialog state
 */
export function withDialogPathUnlocked(dialog) {
  if (dialog === null || dialog === undefined) return dialog
  if (dialog.pathEdited === true) return dialog
  return { ...dialog, pathEdited: true }
}

/**
 * Whether a folder may be renamed (R5).
 *
 * A merged folder stands for a whole chain of folders and has no name of its
 * own: renaming it would mean renaming a chain.
 *
 * @param {object | undefined} entry the entry of the row
 * @returns {boolean}
 */
export function canRenameEntry(entry) {
  if (entry === undefined || entry === null) return false
  return entry.merged !== true
}

/**
 * Resolve where a new entry is created (R5).
 *
 * While the path box is untouched the entry goes into the folder the dialog
 * was opened on - the behaviour of the tree before the path box existed. Once
 * the box has been edited the path is resolved against the project root, and
 * a path that leaves the project is refused before anything is written.
 *
 * @param {{ parent: string, name: string, path?: string, pathEdited?: boolean }} dialog
 * @param {string} root the project root
 * @returns {{ ok: true, parent?: string, name: string, relPath?: string }
 *   | { ok: false, reason: 'empty-name' | 'invalid-path', detail?: string }}
 *   the folder of the entry, or the path relative to the project root
 */
export function resolveNewEntry(dialog, root) {
  if (dialog?.pathEdited === true) {
    const resolved = resolveEntryPath(dialog.path)
    if (!resolved.ok) return { ok: false, reason: 'invalid-path', detail: dialog.path }
    return { ok: true, name: resolved.name, relPath: resolved.path }
  }
  const name = typeof dialog?.name === 'string' ? dialog.name.trim() : ''
  if (name === '') return { ok: false, reason: 'empty-name' }
  return { ok: true, parent: dialog.parent, name }
}

/** Join a project-relative directory and a name. */
function joinRelative(base, name) {
  if (base === '' || base === undefined || base === null) return name
  return `${base}/${name}`
}

/** Replace the last segment of a relative path. */
function replaceLastSegment(path, name) {
  if (typeof path !== 'string' || path === '') return name
  const index = path.lastIndexOf('/')
  return index < 0 ? name : `${path.slice(0, index)}/${name}`
}

/**
 * The inputs `flatten` really reads — and therefore the exact dependency list
 * of its `useMemo`.
 *
 * The store replaces `dirs` (a new Map) and `expanded` (a new Set) on every
 * write, never mutating them in place, so reference comparison is enough to
 * know the tree changed. Depending on the whole `state` object instead would
 * recompute the tree on every store notification. `gitRepoRoot` is part of it
 * because the ignored entries are keyed relative to that repository.
 */
export function flattenInputs(state, showIgnored, ignored, mode) {
  return [state.dirs, state.expanded, state.root, state.filter, state.gitRepoRoot, showIgnored, ignored, mode]
}

/**
 * Scroll a tree row into view with the smallest movement that shows it.
 *
 * The row list is windowed at a fixed row height, so a row's box is known
 * without measuring it. Scrolling only as far as needed leaves the tree where
 * the user left it; centering the row would move the whole list under them.
 *
 * @param {HTMLElement} element the scrolling container
 * @param {number} index the row's index in the full row list
 */
export function revealRow(element, index) {
  if (element.clientHeight === 0) return
  const top = index * ROW_HEIGHT
  const bottom = top + ROW_HEIGHT
  const viewTop = element.scrollTop
  const viewBottom = viewTop + element.clientHeight
  if (top - ROW_HEIGHT < viewTop) element.scrollTop = Math.max(0, top - ROW_HEIGHT)
  else if (bottom + ROW_HEIGHT > viewBottom) {
    element.scrollTop = Math.max(0, bottom + ROW_HEIGHT - element.clientHeight)
  }
}

/**
 * The status aggregate for the polled git status.
 *
 * The poll hands over a fresh entry list every two seconds, and an aggregate
 * built from it is a fresh object every time. The tree keys its row list on
 * the aggregate's `ignored` set, so a new aggregate meant the whole tree was
 * rebuilt on every poll. Keeping the previous aggregate while the entries
 * still describe the same status leaves those inputs alone.
 *
 * @param {Array<object>} entries the polled status entries
 * @returns {object} the aggregate, stable while the status is unchanged
 */
function useStableStatus(entries) {
  const ref = useRef(undefined)
  ref.current = stableAggregateStatus(ref.current, entries)
  return ref.current
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
  label,
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
          // A double click sends two clicks plus a dblclick: only the first
          // click may toggle, and the dblclick must not reach the row — else
          // the folder would flip three times and visibly flicker.
          onClick: event => {
            event.stopPropagation()
            if (event.detail > 1) return
            onToggleDir(entry.path)
          },
          onDoubleClick: event => event.stopPropagation(),
        }, open ? React.createElement(ChevronDown, null) : React.createElement(ChevronRight, null))
      : React.createElement('span', { className: 'iwb-tree-twisty' }),
    isDir
      ? React.createElement(FileTypeIcon, { kind: 'folder', size: 15 })
      : React.createElement(FileTypeIcon, { path: entry.name, size: 15 }),
    isDir
      ? React.createElement('span', { className: 'iwb-tree-name iwb-dir' }, label ?? entry.name)
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
 * The "new file / new directory" dialog (R5).
 *
 * Next to the name there is a box with the FULL path of the entry to create,
 * relative to the project root. The box is read-only (and greyed) until the
 * mouse clicks into it - a disabled input cannot be focused by a click, so
 * `readOnly` is the only way to keep it clickable. While the box is
 * untouched the entry is created in the folder the dialog was opened on;
 * once it has been edited the path is resolved against the project root.
 *
 * @param {{ dialog: object, t: (key: string) => string,
 *   onNameChange: (value: string) => void, onPathChange: (value: string) => void,
 *   onPathFocus: () => void, onTemplateChange: (template: string) => void,
 *   onSubmit: () => void, onCancel: () => void }} props
 */
export function NewEntryDialog({
  dialog, t, onNameChange, onPathChange, onPathFocus, onTemplateChange, onSubmit, onCancel,
}) {
  return React.createElement('div', {
    className: 'iwb-modal-backdrop',
    onMouseDown: event => { if (event.target === event.currentTarget) onCancel() },
  },
    React.createElement('div', { className: 'iwb-modal', role: 'dialog', 'aria-modal': 'true' },
      React.createElement('h2', null, dialog.isDir ? t('project.newDir') : t('project.newFile')),
      React.createElement('label', { className: 'iwb-field' },
        React.createElement('span', null, t('project.nameLabel')),
        React.createElement('input', {
          autoFocus: true, value: dialog.name,
          onChange: event => onNameChange(event.target.value),
          onKeyDown: event => { if (event.key === 'Enter') { event.preventDefault(); onSubmit() } },
        }),
      ),
      React.createElement('label', { className: 'iwb-field' },
        React.createElement('span', null, t('project.pathLabel')),
        React.createElement('input', {
          value: dialog.path,
          // A disabled input cannot be clicked into, so the path box is
          // read-only (and greyed by `.iwb-input-readonly`) until the mouse
          // clicks into it.
          readOnly: dialog.pathEdited !== true,
          className: dialog.pathEdited === true ? undefined : 'iwb-input-readonly',
          title: t('project.pathHint'),
          onFocus: onPathFocus,
          onChange: event => onPathChange(event.target.value),
          onKeyDown: event => { if (event.key === 'Enter') { event.preventDefault(); onSubmit() } },
        }),
        React.createElement('span', { className: 'iwb-modal-hint' }, t('project.pathHint')),
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
                onNameChange(name)
                onTemplateChange(event.target.value)
              },
            }, NEW_TEMPLATES.map(template => React.createElement('option', { key: template.id, value: template.id }, t(template.labelKey)))),
          )
        : null,
      React.createElement('div', { className: 'iwb-modal-actions' },
        React.createElement('button', { type: 'button', className: 'iwb-textbtn', onClick: onCancel }, t('common.cancel')),
        React.createElement('button', { type: 'button', className: 'iwb-textbtn iwb-primary', onClick: onSubmit }, t('project.create')),
      ),
    ),
  )
}

/**
 * The frozen "current folder" bar (R4).
 *
 * The tree rows are absolutely positioned (the tree is virtualised), so CSS
 * `position: sticky` cannot hold one of them in place: the bar is a layer of
 * its own inside the scrolling body, and its content is rebuilt from the row
 * model, because the ancestor rows are not mounted while they are scrolled
 * out of the viewport.
 *
 * It is a navigation bar, not a tree row: it never joins the selection. It
 * carries the WHOLE chain of folders the viewport sits in - from the project
 * root down to the current one - and every step of it jumps to its folder.
 * The fold marker folds the folder the viewport is in.
 *
 * @param {{ chain: Array<{ path: string | null, label: string, title: string }>,
 *   foldTitle?: string, onJump: (path: string) => void,
 *   onToggle: (path: string) => void }} props
 */
export function FrozenFolderBar({ chain, foldTitle, onJump, onToggle }) {
  const current = chain.length > 0 ? chain[chain.length - 1] : undefined
  return React.createElement('div', {
    className: 'iwb-tree-sticky',
    // The bar is a layer on top of the tree: it must not push the rows down
    // when it appears, or the tree would jump on every scroll step.
    style: { marginBottom: '-22px' },
  },
    React.createElement('span', {
      className: 'iwb-tree-twisty iwb-tree-twisty-click',
      title: foldTitle ?? (current?.title ?? ''),
      // The twisty sits inside the bar, which jumps on click: without
      // stopPropagation one click would jump *and* fold the folder. A double
      // click sends two clicks plus a dblclick: only the first click may
      // fold, and the dblclick must not reach the bar.
      onClick: event => {
        event.stopPropagation()
        if (event.detail > 1) return
        if (current?.path) onToggle(current.path)
      },
      onDoubleClick: event => event.stopPropagation(),
    }, React.createElement(ChevronDown, null)),
    ...chain.map((step, index) => React.createElement(React.Fragment, { key: `${step.label}-${index}` },
      index > 0 ? React.createElement('span', { className: 'iwb-tree-sticky-sep' }, '›') : null,
      // A step without a path is the ellipsis of a shortened chain.
      step.path === null
        ? React.createElement('span', { className: 'iwb-tree-sticky-sep' }, step.label)
        : React.createElement('span', {
            className: 'iwb-tree-sticky-item',
            title: step.title,
            onClick: () => onJump(step.path),
          }, step.label),
    )),
  )
}
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
    // The repository the git status belongs to (GIT-01): its keys are
    // repository-relative, the tree rows are project-relative.
    gitRepoRoot: state.gitRepoRoot,
  }
}

export function ProjectPanel({ store, state: _state, initialScrollTop = 0 }) {
  // The panel reads its data from a store slice; the `state` prop is still
  // accepted (Workbench.jsx passes it) but no longer used.
  const slice = useStoreSlice(store, projectSlice, shallowEqual)
  const t = store.t
  const [filterOpen, setFilterOpen] = useState(false)
  const [menu, setMenu] = useState(null)
  const [scrollTop, setScrollTop] = useState(initialScrollTop)
  const [viewport, setViewport] = useState(600)
  // The width of the tree panel: the frozen bar fits its chain into it.
  const [panelWidth, setPanelWidth] = useState(0)
  // Locate File asks for the active file even when it is already the selected
  // one, so the reveal needs a trigger of its own.
  const [locateTick, setLocateTick] = useState(0)
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
  const status = useStableStatus(slice.status.entries)
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
  // The flat quick-file list is only in use when the mode asks for it AND a
  // filter is typed - the panel shows the TREE otherwise, even in the 'files'
  // mode (that mode only changes what the filter searches in).
  const quickList = filterMode === 'files' && slice.filter.trim() !== ''
  const rows = quickList ? quickRows : treeRows
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
    const observer = new ResizeObserver(() => {
      setViewport(element.clientHeight)
      setPanelWidth(element.clientWidth)
    })
    observer.observe(element)
    setViewport(element.clientHeight)
    setPanelWidth(element.clientWidth)
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
  //
  // The trigger is the selected row's INDEX, not the row list itself. The
  // git status poll rebuilds the rows every two seconds, and re-deriving the
  // reveal from that made the tree jump back to the selected file whenever
  // the user scrolled away from it. The index moves when the selection
  // changes, when the row shows up one notification later (its parents load
  // asynchronously, PRD TREE-02 risk 1), and when Locate File asks for the
  // row that is already selected.
  const selectedIndex = useMemo(
    () => rows.findIndex(row => row.entry?.path === slice.selectedPath),
    [rows, slice.selectedPath],
  )
  useEffect(() => {
    const element = scrollRef.current
    if (element === null || selectedIndex < 0) return
    revealRow(element, selectedIndex)
  }, [selectedIndex, locateTick])

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 6)
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + 6)
  const visible = rows.slice(start, end)

  // The frozen "current folder" bar (R4).
  //
  // It is derived from the rows and the local scroll offset only: no store
  // field is read, so the git status poll (every two seconds) cannot make it
  // flicker, and the panel needs no extra slice field.
  const rowPathSet = useMemo(() => new Set(rowPaths), [rowPaths])
  const dirRows = useMemo(() => {
    const map = new Map()
    for (const row of rows) {
      if (row.kind === 'dir' && row.entry !== undefined) map.set(row.entry.path, row)
    }
    return map
  }, [rows])
  // The flat quick-file list has no hierarchy to point at: no frozen bar.
  //
  // The bar carries the WHOLE chain from the project root down to the folder
  // the viewport sits in: a reader has to see WHERE the tree is, not only the
  // name of the last folder. The chain follows the rows that are really
  // there, so a merged row contributes its whole chain as one step.
  const stickyChain = useMemo(() => {
    if (quickList) return []
    const steps = currentFolderChainOf(rows, scrollTop, rowPathSet, slice.root)
    if (steps.length === 0) return []
    const rootName = baseName(slice.root)
    if (rootName === '') return steps
    // The project root is the first step of the chain: it is not a row, but
    // clicking it brings the tree back to the top.
    return [{ path: slice.root, label: rootName, title: slice.root, root: true }, ...steps]
  }, [quickList, rows, scrollTop, rowPathSet, slice.root])
  // The chain is shortened when the panel is too narrow: the middle goes
  // first, the project root after it.
  const stickySteps = useMemo(
    () => fitFolderChain(stickyChain, panelWidth),
    [stickyChain, panelWidth],
  )
  const stickyPath = stickyChain.length > 0 ? stickyChain[stickyChain.length - 1].path : null
  const stickyRow = stickyPath === null ? undefined : dirRows.get(stickyPath)

  /** Jump to the folder of the frozen bar. */
  const onStickyJump = useCallback(path => {
    if (typeof path !== 'string' || path === '') return
    // The project root is not a row: clicking it brings the tree back to the
    // top instead of selecting it.
    if (path === slice.root) {
      if (scrollRef.current !== null) scrollRef.current.scrollTop = 0
      setScrollTop(0)
      return
    }
    // Selecting the folder expands its ancestors; the reveal tick scrolls the
    // tree to it even when the selection did not change.
    store.setSelectedPath(path)
    setLocateTick(tick => tick + 1)
  }, [store, slice.root])

  /** Fold the folder of the frozen bar. */
  const onStickyToggle = useCallback(path => {
    if (typeof path !== 'string' || path === '') return
    store.toggleDir(path)
  }, [store])

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
    // A merged folder stands for a whole chain of folders and has no name of
    // its own: renaming it would mean renaming a chain.
    if (!canRenameEntry(entry)) {
      store.toast('error', t('project.compactRenameDenied'), entry.rel ?? '')
      return
    }
    setRenaming({ path: entry.path, value: entry.name })
  }

  const beginNew = (parentPath, isDir) => {
    setDialog(newEntryDialogState(parentPath, isDir, slice.root))
  }

  /** The name box changed: the full path follows it. */
  const onDialogNameChange = useCallback(value => {
    setDialog(current => withDialogName(current, value))
  }, [])

  /** The path box changed: the entry moves to that path. */
  const onDialogPathChange = useCallback(value => {
    setDialog(current => withDialogPath(current, value))
  }, [])

  /** The path box was clicked into: it becomes editable. */
  const onDialogPathFocus = useCallback(() => {
    setDialog(current => withDialogPathUnlocked(current))
  }, [])

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
      {
        key: 'rename', text: t('project.rename'), shortcut: shortcut('rename'),
        // A merged folder cannot be renamed - the menu says why.
        disabled: currentEntries.length !== 1 || !canRenameEntry(currentEntry),
        title: currentEntry?.merged === true ? t('project.compactRenameDenied') : undefined,
        action: () => beginRename(currentEntry),
      },
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
        submenu: gitMenuItems(slice, currentRels, currentRel, isDir, { t, store }),
      })
    }
    return items
  }, [menu, currentPaths.join('|'), currentRels.join('|'), shortcuts, slice.root, slice.gitRepoRoot, slice.status.isRepo, slice.clipboard])

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
      // The nearest VISIBLE ancestor: a merged row hides the folders of its
      // chain, so the exact parent of a file is not always a row any more.
      const parent = visibleAncestorOf(slice.selectedPath, rowPathSet, slice.root)
      if (parent !== null) store.setSelection([parent], parent)
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
      const target = resolveNewEntry(dialog, slice.root)
      if (!target.ok) {
        // An illegal path is refused with a message; nothing is written.
        if (target.reason === 'invalid-path') store.toast('error', t('project.pathInvalid'), target.detail ?? '')
        return
      }
      const content = dialog.isDir ? '' : templateContent(dialog.template, target.name)
      setDialog(null)
      if (target.relPath !== undefined) {
        // The path is resolved against the project root: the store hands the
        // whole relative path to the host, which creates the folders of the
        // chain that do not exist yet.
        void store.createEntry(slice.root, { relPath: target.relPath, isDir: dialog.isDir, content })
        return
      }
      void store.createEntry(target.parent, { name: target.name, isDir: dialog.isDir, content })
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
          // The git status belongs to the repository the Git window reads, so
          // its keys are repository-relative while the tree rows are
          // project-relative. A file outside that repository has no status —
          // it must not borrow the colour of a same-named file elsewhere.
          const statusKey = statusKeyOf(slice, entry.path)
          const kind = statusKey === null
            ? undefined
            : (row.kind === 'dir' ? status.dirs.get(statusKey) : status.files.get(statusKey))
          const ignoredFile = statusKey !== null && status.ignored.has(statusKey)
          const excludedEntry = isExcluded(entry.rel, excluded)
          const editing = renaming !== null && renaming.path === entry.path
          const active = row.kind === 'file'
            ? slice.tabs.find(tab => tab.kind === 'file' && tab.path === entry.path && tab.id === slice.activeId) !== undefined
            : false
          return React.createElement(TreeRow, {
            key: row.key,
            entry,
            // A merged row shows the dot-joined chain instead of one segment.
            label: row.merged === true ? row.label : undefined,
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
    // The selection may not change (the active file is usually the selected
    // one), so the reveal is requested explicitly.
    setLocateTick(tick => tick + 1)
  }, [store, activeTab])

  /**
   * The frozen "current folder" bar (R4).
   *
   * The bar is a navigation bar, not a tree row: it never joins the
   * selection, it carries the WHOLE chain of folders the viewport sits in -
   * from the project root down to the current one. Every step of the chain
   * jumps to its folder, the fold marker folds the folder the viewport is
   * in. When the panel is too narrow the chain is shortened: the middle
   * first, the project root after it.
   */
  const stickyBar = stickySteps.length === 0
    ? null
    : React.createElement(FrozenFolderBar, {
        chain: stickySteps,
        foldTitle: t('project.currentFolder'),
        onJump: onStickyJump,
        onToggle: onStickyToggle,
      })

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
    }, stickyBar, rootRow),
    menu !== null ? React.createElement(ContextMenu, { x: menu.x, y: menu.y, items: menuItems, onClose: () => setMenu(null) }) : null,
    dialog !== null && dialog.kind === 'new'
      ? React.createElement(NewEntryDialog, {
          dialog,
          t,
          onNameChange: onDialogNameChange,
          onPathChange: onDialogPathChange,
          onPathFocus: onDialogPathFocus,
          onTemplateChange: template => setDialog(current => current === null ? current : { ...current, template }),
          onSubmit: submitDialog,
          onCancel: () => setDialog(null),
        })
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
