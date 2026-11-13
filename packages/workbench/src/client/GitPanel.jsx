/**
 * Git tool window: branch/date filters, lazily paged history, a lane graph,
 * and a right-hand commit Drawer.
 *
 * Selection follows the same rule as the Project tree: a single click only
 * selects a row; double click / Enter opens the detail Drawer. The log keeps
 * the full height while the Drawer is open.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GRAPH_COLORS, layoutGraph, rowGeometry } from './graph.js'
import { groupByDirectory } from './commit-model.js'
import { compactLabel, compactLabelFitted, compactTree, isCompactable, isMergedNode } from './compact-path.js'
import { shallowEqual, useStoreSlice } from './hooks.js'
import { ContextMenu } from './ui.jsx'
import { IconBranch, IconClose, IconCopy, IconRefresh } from './icons.jsx'
import { formatGitDate } from './util.js'
import { gitLayout, DRAWER_MIN } from './git-layout.js'

const ROW_HEIGHT = 24
const CELL = 14
const GRAPH_MAX = 8
// Tree indentation: the base padding of a row comes from the stylesheet
// (.iwb-git-tree-dir / .iwb-git-tree-file), every nesting level adds a step.
const TREE_DIR_INDENT = 5
const TREE_FILE_INDENT = 20
const TREE_INDENT_STEP = 12
// The width one character of a tree label takes (the mono font at 11.5px).
// It is only an estimate — the label is a hint, the full path stays in the
// title of the row.
const TREE_CHAR_WIDTH = 7
// The room the row itself needs: the caret, the gap and the padding.
const TREE_ROW_CHROME = 30

/**
 * Translate with an English fallback for keys the locale table does not
 * carry yet (the repository picker ships ahead of its i18n entries).
 */
function label(t, key, fallback) {
  const value = t(key)
  return value === key || value === undefined || value === null || value === '' ? fallback : value
}

/** Candidate repositories of the Git panel (store-provided, with a fallback). */
function gitRepoCandidates(slice) {
  const list = Array.isArray(slice.gitRepos) ? slice.gitRepos : []
  if (list.length > 0) return list
  return (slice.projects ?? [])
    .filter(project => project.isRepo === true)
    .map(project => ({ path: project.path, name: project.name ?? project.path }))
}

/**
 * Fields of the workbench state the Git panel renders.
 *
 * The slice is compared field by field, so an unrelated write — a toast, a
 * terminal chunk, a file-tree change — no longer re-renders the panel.
 *
 * @param {object} state workbench state
 * @returns {object} the panel's slice
 */
export function gitSlice(state) {
  return {
    git: state.git,
    branch: state.status.branch,
    detached: state.status.detached,
    isRepo: state.status.isRepo,
    drawerWidth: state.layout.gitDrawerWidth,
    projects: state.projects,
    gitRepoRoot: state.gitRepoRoot,
    gitRepos: state.gitRepos,
  }
}

/**
 * Fields the repository picker renders — it subscribes on its own, so the
 * dock header can host it with a `store` prop only.
 *
 * @param {object} state workbench state
 * @returns {object} the picker's slice
 */
export function repoSlice(state) {
  return {
    gitRepos: state.gitRepos,
    gitRepoRoot: state.gitRepoRoot,
    projects: state.projects,
  }
}

function GraphCell({ row, width, height, offset }) {
  const geometry = rowGeometry(row)
  const primaryX = 7 + row.primary * CELL
  const nodes = [row.primary, ...row.mergeLanes]
  const lines = []
  for (const lane of geometry.vertical) {
    lines.push(React.createElement('line', {
      key: `v-${lane}`,
      x1: 7 + lane * CELL, y1: 0, x2: 7 + lane * CELL, y2: height,
      stroke: GRAPH_COLORS[lane % GRAPH_COLORS.length], strokeWidth: 1.6,
    }))
  }
  for (const incoming of geometry.incoming) {
    const x = 7 + incoming.lane * CELL
    lines.push(React.createElement('path', {
      key: `in-${incoming.lane}`,
      d: `M ${x} 0 L ${x} ${height / 2} L ${primaryX} ${height / 2}`,
      fill: 'none', stroke: GRAPH_COLORS[incoming.lane % GRAPH_COLORS.length], strokeWidth: 1.6,
    }))
  }
  for (const [index, outgoing] of geometry.outgoing.entries()) {
    const x = 7 + outgoing.to * CELL
    if (outgoing.to === row.primary) {
      lines.push(React.createElement('line', {
        key: `out-${index}`,
        x1: primaryX, y1: height / 2, x2: primaryX, y2: height,
        stroke: GRAPH_COLORS[row.primary % GRAPH_COLORS.length], strokeWidth: 1.8,
      }))
    } else {
      lines.push(React.createElement('path', {
        key: `out-${index}`,
        d: `M ${primaryX} ${height / 2} C ${primaryX} ${height * 0.78}, ${x} ${height * 0.72}, ${x} ${height}`,
        fill: 'none', stroke: GRAPH_COLORS[outgoing.to % GRAPH_COLORS.length], strokeWidth: 1.8,
      }))
    }
  }
  const circles = nodes.map((lane, index) => React.createElement('circle', {
    key: `n-${lane}-${index}`,
    cx: 7 + lane * CELL, cy: height / 2, r: 3.4,
    fill: GRAPH_COLORS[lane % GRAPH_COLORS.length],
    stroke: 'var(--iwb-bg)', strokeWidth: 1.2,
  }))
  if (row.mergeLanes.length > 0) {
    lines.push(React.createElement('line', {
      key: 'merge',
      x1: primaryX, y1: height / 2, x2: 7 + row.mergeLanes[row.mergeLanes.length - 1] * CELL, y2: height / 2,
      stroke: GRAPH_COLORS[row.primary % GRAPH_COLORS.length], strokeWidth: 1.2, strokeDasharray: '2 2',
    }))
  }
  return React.createElement('svg', {
    width, height, viewBox: `0 0 ${width} ${height}`, style: { display: 'block', marginLeft: 4, transform: `translateY(${offset}px)` },
  }, ...lines, ...circles)
}

function RefChip({ value }) {
  const isHead = value.startsWith('HEAD')
  const isRemote = value.includes('/')
  return React.createElement('span', {
    style: {
      display: 'inline-flex', alignItems: 'center', height: 15, padding: '0 5px', borderRadius: 3, fontSize: 10,
      background: isHead ? 'rgba(76,154,255,.2)' : isRemote ? 'rgba(127,127,127,.18)' : 'rgba(79,180,119,.2)',
      color: isHead ? 'var(--iwb-accent)' : isRemote ? 'var(--iwb-muted)' : 'var(--iwb-success)',
      maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    },
  }, value)
}

/** Split one full commit patch into per-file entries. */
export function diffFiles(diff) {
  const text = String(diff ?? '')
  const output = []
  for (const part of text.split(/^diff --git /m).slice(1)) {
    const lines = part.split('\n')
    const header = lines[0] ?? ''
    const match = /^a\/(.+?) b\/(.+)$/.exec(header)
    const path = match?.[2] ?? header
    let additions = 0
    let deletions = 0
    for (const line of lines.slice(1)) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions += 1
      else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1
    }
    const status = lines.some(line => line.startsWith('new file mode'))
      ? 'A'
      : lines.some(line => line.startsWith('deleted file mode'))
        ? 'D'
        : lines.some(line => line.startsWith('rename from'))
          ? 'R'
          : 'M'
    output.push({ path, status, additions, deletions, patch: `diff --git ${part}` })
  }
  return output
}

/**
 * Copy one text into the clipboard and tell the user what was copied.
 *
 * The toast carries the copied text itself: the short SHA is seven
 * characters, so the user has to see which text ended up in the clipboard
 * (R8).
 *
 * @param {{ toast: (kind: string, text: string, detail?: string) => void }} store
 * @param {(key: string) => string} t the translator
 * @param {string} text the text to copy
 * @returns {Promise<void>}
 */
export async function copyToClipboard(store, t, text) {
  try {
    await navigator.clipboard.writeText(text)
    store.toast('success', t('common.copied'), text)
  } catch {
    store.toast('error', t('common.error'), text)
  }
}

/**
 * The short SHA of one commit: exactly seven characters.
 *
 * The host already ships the abbreviated hash with every commit, so the
 * short SHA is never derived here — only its length is fixed, so that the
 * copied text is the same everywhere and can be typed into `git show` (R8).
 *
 * @param {{ hash?: string, shortHash?: string } | undefined | null} commit
 * @returns {string}
 */
export function shortShaOf(commit) {
  const short = typeof commit?.shortHash === 'string' && commit.shortHash !== ''
    ? commit.shortHash
    : (typeof commit?.hash === 'string' ? commit.hash : '')
  return short.slice(0, 7)
}

/**
 * The context menu of one commit row.
 *
 * Pure (the actions are handed in), so the menu can be driven by tests.
 *
 * @param {{ hash: string, shortHash?: string, subject?: string }} commit
 * @param {{ t: (key: string) => string, openDetail: Function, copy: Function, store: object }} tools
 * @returns {Array<object>} the menu items
 */
export function commitMenuItems(commit, tools) {
  const { t, openDetail, copy, store } = tools
  return [
    { key: 'open', text: t('git.openDetails'), action: () => openDetail(commit.hash) },
    {
      // The full and the short SHA are two different texts, so they get a
      // submenu: the short one is the seven characters an IDE user types
      // into `git show` (R8).
      key: 'copy-sha',
      text: t('git.copySha'),
      submenu: [
        { key: 'copy-sha-full', text: t('git.copyFullSha'), action: () => { void copy(commit.hash) } },
        { key: 'copy-sha-short', text: t('git.copyShortSha'), action: () => { void copy(shortShaOf(commit)) } },
      ],
    },
    { key: 'compare-head', text: t('git.compareWithHead'), action: () => store.openCompare(commit.hash, 'HEAD') },
    null,
    {
      key: 'checkout', text: t('git.checkout'), action: () => store.requestCheckout(commit.hash),
    },
    {
      key: 'revert', text: t('git.revert'), action: () => {
        store.askConfirm(t('git.revert'), `${t('git.revertConfirm')}\n\n${commit.shortHash} ${commit.subject}`, t('git.revert'), () => { void store.revert(commit.hash) })
      },
    },
  ]
}

/**
 * Build the changed-file tree of one commit from repository-relative paths.
 *
 * The first level reuses `groupByDirectory` (the Commit panel's grouping);
 * deeper levels nest by directory segment. Every directory node keeps its
 * full repository-relative path so the collapse state can key on it.
 *
 * @param {Array<{ path: string }>} files changed files of one commit
 * @returns {{ name: string, path: string, depth: number, dirs: Map<string, object>, files: Array<object> }}
 */
export function buildChangedFileTree(files) {
  const root = { name: '', path: '', depth: 0, dirs: new Map(), files: [] }
  for (const group of groupByDirectory(files)) {
    const segments = group.dir === '' ? [] : group.dir.split('/').filter(segment => segment !== '')
    let node = root
    let prefix = ''
    for (const segment of segments) {
      prefix = prefix === '' ? segment : `${prefix}/${segment}`
      let child = node.dirs.get(segment)
      if (child === undefined) {
        child = { name: segment, path: prefix, depth: node.depth + 1, dirs: new Map(), files: [] }
        node.dirs.set(segment, child)
      }
      node = child
    }
    node.files.push(...group.entries)
  }
  return root
}

/**
 * One node of the changed-file tree.
 *
 * @typedef {object} ChangedNode
 * @property {string} name the display name of the node
 * @property {string} path the full repository-relative path
 * @property {number} depth the level of the node in the tree
 * @property {Map<string, ChangedNode>} dirs the child directories
 * @property {Array<object>} files the changed files of the node
 * @property {boolean} [merged] true for a node that stands for a chain
 * @property {string[]} [segments] the directory names of a merged chain
 * @property {Array<{ name: string, path: string, depth: number }>} [chain]
 *   the original directories of a merged chain
 */

/** The display name of one changed file (its last path segment). */
function fileNameOf(file) {
  return file.path.split('/').pop() ?? file.path
}

/**
 * The `compact-path.js` shape of one tree node.
 *
 * `compact-path.js` works on `{ name, path, kind, children }`; the changed
 * file tree keeps its directories in a Map and its files in a list, so the
 * two shapes are bridged here.
 *
 * @param {ChangedNode} node
 * @returns {object} the compact shape of the node
 */
function compactShape(node) {
  const children = []
  for (const dir of node.dirs.values()) children.push(compactShape(dir))
  for (const file of node.files) children.push({ name: fileNameOf(file), path: file.path, kind: 'file', file })
  const shape = { name: node.name, path: node.path, kind: 'dir', depth: node.depth, children }
  // A merged chain keeps its identity: the chain must not be built again
  // from the children, which are the children of the leaf.
  if (isMergedNode(node)) {
    shape.merged = true
    shape.segments = node.segments
    shape.chain = node.chain
  }
  return shape
}

/**
 * The original directories of one merged chain.
 *
 * The chain is the list of directories the merge replaced; the fallback (a
 * double click on the merged row) shows them again.
 *
 * @param {object} node the first node of the chain
 * @returns {Array<{ name: string, path: string, depth: number }>}
 */
function chainOf(node) {
  if (node === undefined || node === null) return []
  const chain = [{ name: node.name, path: node.path, depth: node.depth }]
  let current = node
  while (isCompactable(current)) {
    current = current.children[0]
    chain.push({ name: current.name, path: current.path, depth: current.depth })
  }
  return chain
}

/**
 * Merge the single-child directory chains of one level.
 *
 * `compact-path.js` owns the rule: a directory that holds exactly one
 * sub-directory (and no file) is merged with it. The merged node keeps the
 * leaf of the chain as its path and the leaf's children, so expanding it
 * shows the changed file right away.
 *
 * The pass is idempotent: a node that is already a merged chain is never
 * merged again, so the chain cannot grow with every render.
 *
 * @param {Array<object>} children the nodes of one level
 * @returns {Array<object>} the level with its chains merged
 */
function compactLevel(children) {
  const pending = children.filter(child => !isMergedNode(child))
  const compacted = compactTree(pending)
  let cursor = 0
  return children.map(child => {
    const depth = child?.depth ?? 0
    if (isMergedNode(child)) {
      // The chain of a merged node is already known: it must not be built
      // again from its children, which are the children of the leaf.
      return { ...child, depth, children: compactLevel(child.children).map(entry => ({ ...entry, depth: depth + 1 })) }
    }
    const node = compacted[cursor]
    cursor += 1
    if (node.kind === 'file') return { ...node, depth }
    const entries = compactLevel(node.children).map(entry => ({ ...entry, depth: depth + 1 }))
    const result = { ...node, depth, children: entries }
    if (isMergedNode(node)) result.chain = chainOf(child)
    return result
  })
}

/**
 * The changed-file tree shape of one compact node.
 *
 * @param {object} node the compact shape of the node
 * @returns {ChangedNode}
 */
function treeShape(node) {
  const dirs = new Map()
  const files = []
  for (const child of node.children) {
    if (child.kind === 'file') {
      files.push(child.file)
      continue
    }
    dirs.set(child.name, treeShape(child))
  }
  const result = { name: node.name, path: node.path, depth: node.depth, dirs, files }
  if (node.merged === true) {
    result.merged = true
    result.segments = node.segments
    result.chain = node.chain
  }
  return result
}

/**
 * The changed-file tree with its empty directory chains merged.
 *
 * A chain of directories that holds no changed file becomes ONE step instead
 * of a ladder: the leaf is expanded by default, so the changed file is
 * visible without a click (R7). The tree root never takes part in a merge —
 * a root that merged with its only child would lose the path context
 * completely.
 *
 * @param {ChangedNode} root the raw tree
 * @returns {ChangedNode} the compacted tree
 */
export function compactChangedFileTree(root) {
  if (root === undefined || root === null) return root
  const shape = compactShape(root)
  return treeShape({ ...shape, children: compactLevel(shape.children) })
}

/**
 * The directories that are closed by default.
 *
 * A merged chain is OPEN: the whole point of the merge is that the changed
 * file is visible without a click. A real directory is closed when it is
 * deeper than the first level — that is where the tree starts to branch.
 *
 * @param {ChangedNode} root the tree
 * @returns {Set<string>} the paths of the closed directories
 */
export function defaultCollapsedDirs(root) {
  const collapsed = new Set()
  const walk = (node) => {
    for (const dir of node.dirs.values()) {
      if (!isMergedNode(dir) && dir.depth >= 2) collapsed.add(dir.path)
      walk(dir)
    }
  }
  walk(compactChangedFileTree(root))
  return collapsed
}

/**
 * The original (unmerged) tree of one merged chain.
 *
 * The chain is nested again, so the fallback shows the directories the merge
 * replaced — the deepest one holds the children of the merged node. The
 * result is a wrapper around the chain: the tree renderer draws the CHILDREN
 * of the node it gets, and the first directory of the chain has to be drawn
 * as well.
 *
 * @param {ChangedNode} dir the merged node
 * @returns {ChangedNode | null}
 */
function originalTree(dir) {
  const chain = Array.isArray(dir.chain) ? dir.chain : []
  if (chain.length === 0) return null
  const leaf = chain[chain.length - 1]
  let node = { name: leaf.name, path: leaf.path, depth: leaf.depth, dirs: dir.dirs, files: dir.files }
  for (let index = chain.length - 2; index >= 0; index -= 1) {
    const current = chain[index]
    node = { name: current.name, path: current.path, depth: current.depth, dirs: new Map([[current.name, node]]), files: [] }
  }
  return { name: '', path: '', depth: chain[0].depth - 1, dirs: new Map([[node.name, node]]), files: [] }
}

/**
 * How many characters the label of a row may use.
 *
 * The drawer width is the only measure the tree has, so the label is fitted
 * to it — the indentation of the row takes a part of it.
 *
 * @param {{ width?: number, depth?: number }} options
 * @returns {number | undefined} undefined when the width is unknown
 */
function labelLimit(options) {
  const width = options?.width
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) return undefined
  const indent = TREE_DIR_INDENT + (options.depth ?? 0) * TREE_INDENT_STEP
  return Math.max(6, Math.floor((width - indent - TREE_ROW_CHROME) / TREE_CHAR_WIDTH))
}

/**
 * The label of one directory row.
 *
 * A merged chain shows its whole path, so the row stays recognisable; when
 * the drawer is too narrow the label degrades to "first…last" and then to
 * the last segment. The full repository-relative path always stays in the
 * title of the row.
 *
 * @param {ChangedNode} dir the directory node
 * @param {boolean} merged whether the node stands for a chain
 * @param {{ width?: number, depth?: number }} options
 * @returns {string}
 */
function dirLabel(dir, merged, options) {
  if (!merged) return dir.name
  const limit = labelLimit(options)
  return limit === undefined ? compactLabel(dir, '/') : compactLabelFitted(dir, limit, '/')
}

/** Children of one tree node: directories and files mixed, sorted by name. */
function sortedChildren(node) {
  const children = []
  for (const dir of node.dirs.values()) children.push({ kind: 'dir', name: dir.name, node: dir })
  for (const file of node.files) {
    children.push({ kind: 'file', name: file.path.split('/').pop() ?? file.path, file })
  }
  children.sort((left, right) => left.name.localeCompare(right.name))
  return children
}

/** Path of the first changed file of the tree (the default selection). */
function firstLeafOf(node) {
  for (const child of sortedChildren(node)) {
    if (child.kind === 'file') return child.file.path
    const found = firstLeafOf(child.node)
    if (found !== '') return found
  }
  return ''
}

/**
 * Render the changed-file tree rows.
 *
 * Pure (no hooks) so the tree can be driven directly by tests. `collapsed`
 * holds the closed directory paths; the file selection travels separately in
 * `selectedPath` — the two states never mix.
 *
 * @param {object} node tree node to render
 * @param {{ collapsed: Set<string>, selectedPath: string, depth: number,
 *   width?: number, expandedOriginal?: Set<string>,
 *   onToggleDir: Function, onExpandOriginal?: Function,
 *   onSelectFile: Function, onOpenFile: Function }} options
 * @returns {Array<React.ReactElement>} the rows of this level
 */
export function fileTreeRows(node, options) {
  // The tree is compacted here, so every caller gets the merged rows — the
  // pass is idempotent, so an already compacted tree stays the same.
  return renderTreeRows(compactChangedFileTree(node), options)
}

/**
 * The rows of one level of the tree.
 *
 * @param {object} node tree node to render
 * @param {{ collapsed: Set<string>, selectedPath: string, depth: number,
 *   width?: number, expandedOriginal?: Set<string>,
 *   onToggleDir: Function, onExpandOriginal?: Function,
 *   onSelectFile: Function, onOpenFile: Function }} options
 * @returns {Array<React.ReactElement>} the rows of this level
 */
function renderTreeRows(node, options) {
  const rows = []
  for (const [index, child] of sortedChildren(node).entries()) {
    if (child.kind === 'dir') {
      const dir = child.node
      const merged = isMergedNode(dir)
      // A merged chain can be shown as the original folders: the fallback
      // that keeps the sense of hierarchy (R7).
      if (merged && options.expandedOriginal?.has(dir.path) === true) {
        const original = originalTree(dir)
        if (original !== null) {
          rows.push(...renderTreeRows(original, options))
          continue
        }
      }
      const expanded = !options.collapsed.has(dir.path)
      rows.push(React.createElement('button', {
        key: `dir:${dir.path}`,
        type: 'button',
        className: 'iwb-git-tree-dir',
        title: dir.path,
        'aria-expanded': expanded,
        style: { paddingLeft: `${TREE_DIR_INDENT + options.depth * TREE_INDENT_STEP}px` },
        // The two clicks of a double click must not toggle the row: the
        // double click of a merged chain opens the original folders.
        onClick: event => { if (event?.detail > 1) return; options.onToggleDir(dir.path) },
        onDoubleClick: merged ? () => options.onExpandOriginal?.(dir.path) : undefined,
      },
        React.createElement('span', { className: 'iwb-git-tree-caret' }, expanded ? '▾' : '▸'),
        React.createElement('span', { className: 'iwb-git-tree-dir-name' }, dirLabel(dir, merged, options)),
      ))
      if (expanded) rows.push(...renderTreeRows(dir, { ...options, depth: options.depth + 1 }))
      continue
    }
    const file = child.file
    rows.push(React.createElement('button', {
      key: `file:${file.path}:${index}`,
      type: 'button',
      className: `iwb-git-drawer-file iwb-git-tree-file${options.selectedPath === file.path ? ' iwb-selected' : ''}`,
      title: file.path,
      style: { paddingLeft: `${TREE_FILE_INDENT + options.depth * TREE_INDENT_STEP}px` },
      onClick: () => options.onSelectFile(file.path),
      onDoubleClick: () => options.onOpenFile(file.path),
    },
      React.createElement('span', { className: `iwb-git-file-status iwb-status-${file.status}` }, file.status),
      React.createElement('span', { className: 'iwb-git-file-name' }, child.name),
      React.createElement('span', { className: 'iwb-additions' }, `+${file.additions}`),
      React.createElement('span', { className: 'iwb-deletions' }, `-${file.deletions}`),
    ))
  }
  return rows
}

/** Changed files of one commit as a collapsible directory tree. */
function ChangedFileTree({ store, hash, files, width }) {
  // The tree is compacted once: a chain of directories that holds no changed
  // file is one step, and its leaf is open (R7).
  const tree = useMemo(() => compactChangedFileTree(buildChangedFileTree(files)), [files])
  const [toggles, setToggles] = useState(() => new Map())
  const [expandedOriginal, setExpandedOriginal] = useState(() => new Set())
  const [selectedPath, setSelectedPath] = useState('')

  const collapsed = useMemo(() => {
    const dirs = defaultCollapsedDirs(tree)
    for (const [path, isCollapsed] of toggles) {
      if (isCollapsed) dirs.add(path)
      else dirs.delete(path)
    }
    return dirs
  }, [tree, toggles])

  useEffect(() => {
    setSelectedPath('')
    setExpandedOriginal(new Set())
  }, [hash])

  const toggleDir = useCallback((path) => {
    setToggles(previous => {
      const next = new Map(previous)
      next.set(path, !collapsed.has(path))
      return next
    })
  }, [collapsed])

  // The fallback of a merged chain: it shows the original folders again.
  const expandOriginal = useCallback((path) => {
    setExpandedOriginal(previous => {
      const next = new Set(previous)
      next.add(path)
      return next
    })
  }, [])

  const openFile = useCallback((path) => { void store.openCommitFile(hash, path) }, [store, hash])

  const selected = selectedPath === '' ? firstLeafOf(tree) : selectedPath

  return React.createElement('div', { className: 'iwb-git-drawer-files iwb-git-tree' },
    fileTreeRows(tree, {
      collapsed,
      selectedPath: selected,
      depth: 0,
      width,
      expandedOriginal,
      onToggleDir: toggleDir,
      onExpandOriginal: expandOriginal,
      onSelectFile: setSelectedPath,
      onOpenFile: openFile,
    }),
  )
}

function BranchPopover({ store, branches, currentBranch, x, y, onClose }) {
  const t = store.t
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef(null)
  const names = useMemo(() => {
    const value = query.trim().toLowerCase()
    return branches.filter(name => value === '' || name.toLowerCase().includes(value))
  }, [query, branches])
  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setIndex(0) }, [query])
  const choose = (name) => { onClose(); store.requestCheckout(name) }
  return React.createElement('div', {
    className: 'iwb-branch-popover',
    style: { left: `${x}px`, top: `${y}px` },
    onMouseDown: event => event.stopPropagation(),
  },
    React.createElement('input', {
      ref: inputRef,
      className: 'iwb-input',
      style: { width: '100%' },
      placeholder: t('git.searchBranch'),
      value: query,
      onChange: event => setQuery(event.target.value),
      onKeyDown: event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setIndex(value => Math.min(names.length - 1, value + 1)) }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex(value => Math.max(0, value - 1)) }
        else if (event.key === 'Enter') { event.preventDefault(); if (names[index] !== undefined) choose(names[index]) }
        else if (event.key === 'Escape') { event.preventDefault(); onClose() }
      },
    }),
    React.createElement('div', { className: 'iwb-branch-list' },
      names.length === 0
        ? React.createElement('div', { className: 'iwb-quick-empty' }, t('quickOpen.empty'))
        : names.map((name, position) => React.createElement('button', {
            key: name,
            type: 'button',
            className: `iwb-branch-row ${position === index ? 'iwb-selected' : ''}`,
            onMouseEnter: () => setIndex(position),
            onClick: () => choose(name),
          },
            React.createElement('span', { className: 'iwb-branch-check' }, name === currentBranch ? '✓' : ''),
            React.createElement('span', { className: 'iwb-branch-name' }, name),
          )),
    ),
  )
}

/**
 * Rows of the repository picker (pure, so the choices can be driven directly
 * by tests).
 *
 * @param {Array<{ path: string, name: string }>} repos candidate repositories
 * @param {{ current: string, index: number, onHover?: Function, onChoose: Function }} options
 * @returns {Array<React.ReactElement>}
 */
export function repoRows(repos, options) {
  return repos.map((repo, position) => React.createElement('button', {
    key: repo.path,
    type: 'button',
    className: `iwb-branch-row ${position === options.index ? 'iwb-selected' : ''}`,
    title: repo.path,
    onMouseEnter: () => options.onHover?.(position),
    onClick: () => options.onChoose(repo.path),
  },
    React.createElement('span', { className: 'iwb-branch-check' }, repo.path === options.current ? '✓' : ''),
    React.createElement('span', { className: 'iwb-branch-name' }, repo.name),
  ))
}

/**
 * Repository picker of the Git tool window.
 *
 * Exported so the Terminal/Git dock header can host the same popover. The
 * candidates come from `state.gitRepos`; choosing one only moves the Git
 * panel — the file tree and the open tabs stay untouched.
 */
export function RepoPopover({ store, x, y, onClose }) {
  const t = store.t
  const slice = useStoreSlice(store, repoSlice, shallowEqual)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef(null)
  const repos = useMemo(() => gitRepoCandidates(slice), [slice])
  const names = useMemo(() => {
    const value = query.trim().toLowerCase()
    return repos.filter(repo => value === ''
      || String(repo.name).toLowerCase().includes(value)
      || String(repo.path).toLowerCase().includes(value))
  }, [query, repos])
  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setIndex(0) }, [query])
  const choose = (path) => { onClose(); store.setGitRepoRoot(path) }
  return React.createElement('div', {
    className: 'iwb-branch-popover iwb-repo-popover',
    style: { left: `${x}px`, top: `${y}px` },
    onMouseDown: event => event.stopPropagation(),
  },
    React.createElement('input', {
      ref: inputRef,
      className: 'iwb-input',
      style: { width: '100%' },
      placeholder: label(t, 'git.searchRepo', 'Search repository'),
      value: query,
      onChange: event => setQuery(event.target.value),
      onKeyDown: event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setIndex(value => Math.min(names.length - 1, value + 1)) }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex(value => Math.max(0, value - 1)) }
        else if (event.key === 'Enter') { event.preventDefault(); if (names[index] !== undefined) choose(names[index].path) }
        else if (event.key === 'Escape') { event.preventDefault(); onClose() }
      },
    }),
    React.createElement('div', { className: 'iwb-branch-list' },
      names.length === 0
        ? React.createElement('div', { className: 'iwb-quick-empty' }, t('quickOpen.empty'))
        : repoRows(names, {
            current: slice.gitRepoRoot ?? '',
            index,
            onHover: position => setIndex(position),
            onChoose: choose,
          }),
    ),
  )
}

function CommitDrawer({ store, git, narrow, width, onResizeStart, onClose }) {
  const t = store.t
  const detail = git.detail
  const closeRef = useRef(null)
  const files = useMemo(() => diffFiles(detail?.diff), [detail?.diff])
  const additions = files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0)

  useEffect(() => {
    closeRef.current?.focus()
  }, [detail?.hash])

  const copy = useCallback((text) => copyToClipboard(store, t, text), [store, t])

  return React.createElement(React.Fragment, null,
    narrow
      ? React.createElement('div', { className: 'iwb-git-drawer-backdrop', onMouseDown: onClose })
      : null,
    React.createElement('aside', {
      className: `iwb-git-drawer ${narrow ? 'iwb-git-drawer-overlay' : ''}`,
      style: narrow ? undefined : { width: `${width}px` },
      role: 'complementary',
      'aria-label': t('git.detailTitle'),
    },
      narrow ? null : React.createElement('div', { className: 'iwb-git-drawer-resizer', onPointerDown: onResizeStart }),
      React.createElement('div', { className: 'iwb-git-drawer-head' },
        React.createElement('span', { className: 'iwb-git-drawer-title', title: detail?.subject ?? '' },
          detail?.subject ?? (git.detailLoading ? t('common.loading') : '')),
        React.createElement('span', { className: 'iwb-spacer' }),
        detail !== null
          ? React.createElement('button', {
              type: 'button', className: 'iwb-iconbtn', title: t('git.copySha'),
              onClick: () => { void copy(detail.hash) },
            }, React.createElement(IconCopy, { width: 12, height: 12 }))
          : null,
        React.createElement('button', {
          ref: closeRef,
          type: 'button', className: 'iwb-iconbtn', title: t('git.closeDetail'),
          onClick: onClose,
        }, React.createElement(IconClose, { width: 13, height: 13 })),
      ),
      detail === null && git.detailLoading === true
        ? React.createElement('div', { className: 'iwb-git-drawer-body' }, React.createElement('div', { className: 'iwb-empty' }, t('common.loading')))
        : (detail === null
            ? React.createElement('div', { className: 'iwb-git-drawer-body' }, React.createElement('div', { className: 'iwb-empty' }, t('git.selectCommit')))
            : React.createElement('div', { className: 'iwb-git-drawer-body' },
                React.createElement('div', { className: 'iwb-git-drawer-meta' },
                  React.createElement('span', { className: 'iwb-git-drawer-sha', title: detail.hash }, detail.shortHash),
                  React.createElement('span', null, detail.author),
                  detail.email !== '' ? React.createElement('span', { className: 'iwb-git-detail-dim' }, detail.email) : null,
                  React.createElement('span', { className: 'iwb-git-detail-dim' }, detail.date),
                  ...(detail.refs ?? []).map(ref => React.createElement('span', { key: ref, className: 'iwb-ref-chip' }, ref)),
                  detail.parents?.length > 0
                    ? React.createElement('span', { className: 'iwb-git-detail-dim' }, `${t('git.parents')}: ${detail.parents.map(parent => parent.slice(0, 7)).join(', ')}`)
                    : null,
                ),
                React.createElement('button', {
                  type: 'button', className: 'iwb-textbtn iwb-small iwb-git-open-full', title: t('git.openFull'),
                  onClick: () => { void store.openCommit(detail.hash) },
                }, t('git.openFull')),
                detail.body !== ''
                  ? React.createElement('pre', { className: 'iwb-git-drawer-body-text' }, detail.body)
                  : null,
                React.createElement('div', { className: 'iwb-git-drawer-section-title' },
                  `${t('git.fileList')} · ${files.length}`,
                  React.createElement('span', { className: 'iwb-additions' }, ` +${additions}`),
                  React.createElement('span', { className: 'iwb-deletions' }, ` -${deletions}`),
                ),
                files.length === 0
                  ? React.createElement('div', { className: 'iwb-git-detail-dim' }, t('git.noFiles'))
                  : React.createElement(ChangedFileTree, { store, hash: detail.hash, files, width }),
              )),
    ),
  )
}

export function GitPanel({ store, state }) {
  const t = store.t
  // `state` is still accepted (the Workbench cleanup drops the prop in a
  // parallel step) but the panel reads its own slice from now on.
  const slice = useStoreSlice(store, gitSlice, shallowEqual)
  const git = slice.git
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(300)
  const [menu, setMenu] = useState(null)
  const [mainWidth, setMainWidth] = useState(0)
  const [branchMenu, setBranchMenu] = useState(null)
  const [repoMenu, setRepoMenu] = useState(null)
  const repoRoot = slice.gitRepoRoot ?? ''
  const repoName = useMemo(() => {
    const match = gitRepoCandidates(slice).find(repo => repo.path === repoRoot)
    if (match !== undefined) return match.name
    if (repoRoot === '') return ''
    const parts = repoRoot.split(/[\\/]/)
    return parts[parts.length - 1] ?? repoRoot
  }, [slice, repoRoot])
  const scrollRef = useRef(null)
  const mainRef = useRef(null)
  const queryTimer = useRef(null)
  const rowRefs = useRef(new Map())

  useEffect(() => {
    const element = scrollRef.current
    if (element === null) return undefined
    const observer = new ResizeObserver(() => setViewport(element.clientHeight))
    observer.observe(element)
    setViewport(element.clientHeight)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const element = mainRef.current
    if (element === null) return undefined
    const observer = new ResizeObserver(() => setMainWidth(element.clientWidth))
    observer.observe(element)
    setMainWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    void store.loadLog(true)
    void store.loadBranches()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const layout = useMemo(() => layoutGraph(git.commits), [git.commits])
  const graphWidth = Math.max(40, Math.min(GRAPH_MAX, layout.maxLanes) * CELL + 16)
  const rows = layout.rows
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 6)
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + 6)
  const drawerOpen = git.detail !== null || git.detailLoading === true
  const geometry = gitLayout({
    mainWidth,
    configuredWidth: slice.drawerWidth ?? 420,
    drawerOpen,
  })
  const drawerNarrow = geometry.drawerNarrow
  const drawerWidth = geometry.drawerWidth
  const tableNarrow = geometry.tableNarrow

  const onScroll = (event) => {
    const element = event.currentTarget
    setScrollTop(element.scrollTop)
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 240) store.loadMoreCommits()
  }

  const copy = useCallback((text) => copyToClipboard(store, t, text), [store, t])

  const openDetail = (hash) => { void store.openCommitDetail(hash) }

  const closeDetail = () => {
    const hash = git.detail?.hash ?? git.detailHash
    store.closeCommitDetail()
    if (hash !== null && hash !== undefined) {
      window.setTimeout(() => rowRefs.current.get(hash)?.focus?.(), 0)
    }
  }

  useEffect(() => {
    if (drawerOpen !== true) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeDetail()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerOpen, git.detail?.hash, git.detailHash])

  const moveSelection = (delta) => {
    const list = git.commits
    const index = list.findIndex(commit => commit.hash === git.selectedHash)
    const next = Math.max(0, Math.min(list.length - 1, index < 0 ? 0 : index + delta))
    const commit = list[next]
    if (commit !== undefined) {
      store.selectCommit(commit.hash)
      const row = rowRefs.current.get(commit.hash)
      row?.scrollIntoView?.({ block: 'nearest' })
      row?.focus?.()
    }
  }

  const onRowKeyDown = (event, commit) => {
    if (event.key === 'Enter') { event.preventDefault(); openDetail(commit.hash) }
    else if (event.key === 'Escape' && drawerOpen) { event.preventDefault(); closeDetail() }
    else if (event.key === 'ArrowDown') { event.preventDefault(); moveSelection(1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveSelection(-1) }
  }

  const onContextMenu = (event, commit) => {
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY, commit })
  }

  const menuItems = useMemo(() => {
    if (menu === null) return []
    return commitMenuItems(menu.commit, { t, openDetail, copy, store })
  }, [menu, t])

  useEffect(() => {
    if (branchMenu === null && repoMenu === null) return undefined
    const onDown = (event) => {
      if (event.target instanceof Element && event.target.closest('.iwb-branch-popover, .iwb-branch-switch, .iwb-repo-switch') !== null) return
      setBranchMenu(null)
      setRepoMenu(null)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [branchMenu, repoMenu])

  const startDrawerResize = (event) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = drawerWidth
    const move = (moveEvent) => {
      const next = Math.max(DRAWER_MIN, Math.min(startWidth + (startX - moveEvent.clientX), Math.max(DRAWER_MIN, mainWidth * 0.6)))
      store.setLayout({ gitDrawerWidth: Math.round(next) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const dateOptions = [
    ['', 'git.allTime'],
    ['7 days ago', 'git.last7'],
    ['30 days ago', 'git.last30'],
    ['90 days ago', 'git.last90'],
  ]

  return React.createElement('div', { className: 'iwb-git' },
    React.createElement('div', { className: 'iwb-git-filters' },
      React.createElement('button', {
        type: 'button', className: 'iwb-branch-switch iwb-repo-switch',
        title: repoRoot === '' ? label(t, 'git.pickRepoHint', 'Choose a repository in the Terminal/Git header.') : repoRoot,
        onClick: event => {
          const rect = event.currentTarget.getBoundingClientRect()
          setRepoMenu({ x: rect.left, y: rect.bottom + 4 })
        },
      },
        React.createElement('span', { className: 'iwb-repo-name' }, repoName === '' ? label(t, 'git.pickRepo', 'Choose repository') : repoName),
        React.createElement('span', { className: 'iwb-branch-caret' }, '▾'),
      ),
      React.createElement('button', {
        type: 'button', className: 'iwb-branch-switch', title: t('git.switchBranchTitle'),
        onClick: event => {
          const rect = event.currentTarget.getBoundingClientRect()
          setBranchMenu({ x: rect.left, y: rect.bottom + 4 })
        },
      },
        React.createElement(IconBranch, { width: 13, height: 13 }),
        React.createElement('span', null, slice.detached === true ? t('git.detached') : (slice.branch ?? '—')),
        React.createElement('span', { className: 'iwb-branch-caret' }, '▾'),
      ),
      (git.compare ?? []).length > 0
        ? React.createElement('span', { className: 'iwb-compare-chip', title: t('git.compareHint') },
            (git.compare ?? []).map(hash => hash.slice(0, 7)).join(' \u2194 '),
            React.createElement('button', {
              type: 'button', className: 'iwb-path-chip-clear', title: t('git.clearCompare'),
              onClick: () => store.patch('git', { compare: [] }),
            }, '\u00d7'),
          )
        : null,
      (git.compare ?? []).length === 2
        ? React.createElement('button', {
            type: 'button', className: 'iwb-textbtn iwb-small iwb-primary',
            onClick: () => store.compareSelected(),
          }, t('git.compare'))
        : null,
      React.createElement('button', {
        type: 'button',
        className: `iwb-textbtn iwb-small ${git.filters.branch === '' ? 'iwb-primary' : ''}`,
        title: t('git.branchFilter'),
        onClick: () => store.setGitFilters({ branch: git.filters.branch === '' ? (slice.branch ?? '') : '' }),
      }, git.filters.branch === '' ? t('git.allBranches') : t('git.currentBranchOnly')),
      React.createElement('select', {
        className: 'iwb-select', title: t('git.dateFilter'),
        value: git.filters.since ?? '',
        onChange: event => store.setGitFilters({ since: event.target.value }),
      },
        dateOptions.map(([value, key]) => React.createElement('option', { key: value, value }, t(key))),
      ),
      React.createElement('input', {
        className: 'iwb-input', style: { width: 100 }, placeholder: t('git.authorFilter'),
        value: git.filters.author,
        onChange: event => {
          const value = event.target.value
          if (queryTimer.current !== null) clearTimeout(queryTimer.current)
          queryTimer.current = setTimeout(() => store.setGitFilters({ author: value }), 350)
        },
      }),
      React.createElement('input', {
        className: 'iwb-input', style: { flex: 1, minWidth: 100, width: 'auto' }, placeholder: t('git.queryFilter'),
        value: git.filters.query,
        onChange: event => {
          const value = event.target.value
          if (queryTimer.current !== null) clearTimeout(queryTimer.current)
          queryTimer.current = setTimeout(() => store.setGitFilters({ query: value }), 350)
        },
      }),
      git.filters.path !== undefined && git.filters.path !== ''
        ? React.createElement('span', { className: 'iwb-path-chip', title: git.filters.path },
            React.createElement('span', { className: 'iwb-path-chip-text' }, git.filters.path),
            React.createElement('button', {
              type: 'button', className: 'iwb-path-chip-clear', title: t('git.clearPath'),
              onClick: () => store.setGitFilters({ path: '' }),
            }, '×'),
          )
        : null,
      git.selectedHash !== null && git.selectedHash !== undefined && !drawerOpen
        ? React.createElement('button', {
            type: 'button', className: 'iwb-textbtn iwb-small',
            onClick: () => openDetail(git.selectedHash),
          }, t('git.openDetails'))
        : null,
      React.createElement('button', {
        type: 'button', className: 'iwb-iconbtn', title: t('common.refresh'),
        onClick: () => { void store.loadLog(true); void store.loadBranches(); void store.refreshStatus({ initial: true }) },
      }, React.createElement(IconRefresh, { width: 14, height: 14 })),
    ),
    React.createElement('div', { className: `iwb-git-main ${tableNarrow ? 'iwb-git-narrow' : ''}`, ref: mainRef },
      React.createElement('div', {
        className: 'iwb-git-table',
        style: { '--iwb-graph-w': `${graphWidth}px` },
      },
        React.createElement('div', { className: 'iwb-git-head' },
          React.createElement('span', null, ''),
          React.createElement('span', null, 'SHA'),
          React.createElement('span', null, t('git.message')),
          React.createElement('span', null, t('git.author')),
          React.createElement('span', null, t('git.date')),
        ),
        React.createElement('div', { className: 'iwb-git-scroll', ref: scrollRef, onScroll },
          rows.length === 0 && git.loading !== true
            ? React.createElement('div', { className: 'iwb-git-empty' },
                React.createElement('div', null,
                  slice.isRepo === true
                    ? (git.error ?? t('git.noCommits'))
                    : t('project.noRepoHint'),
                ),
                slice.isRepo !== true
                  ? React.createElement('div', { className: 'iwb-git-no-repo' },
                      React.createElement('div', { className: 'iwb-git-detail-dim' },
                        label(t, 'git.pickRepoHint', 'Choose a repository in the Terminal/Git header.')),
                      gitRepoCandidates(slice).length > 0
                        ? React.createElement('button', {
                            type: 'button', className: 'iwb-textbtn iwb-primary iwb-small',
                            onClick: event => {
                              const rect = event.currentTarget.getBoundingClientRect()
                              setRepoMenu({ x: rect.left, y: rect.bottom + 4 })
                            },
                          }, t('project.chooseRepo'))
                        : React.createElement('div', { className: 'iwb-git-detail-dim' },
                            label(t, 'git.noRepoCandidate', 'No Git repository candidate was found in this workspace.')),
                    )
                  : (git.error !== null && git.error !== undefined
                      ? React.createElement('button', { type: 'button', className: 'iwb-textbtn iwb-small', style: { marginTop: 10 }, onClick: () => { void store.loadLog(true) } }, t('common.retry'))
                      : null),
              )
            : React.createElement('div', { className: 'iwb-git-rows', style: { height: `${rows.length * ROW_HEIGHT}px` } },
                rows.slice(start, end).map((row, index) => {
                  const commit = row.commit
                  const top = (start + index) * ROW_HEIGHT
                  const selected = git.selectedHash === commit.hash
                  const inCompare = (git.compare ?? []).includes(commit.hash)
                  return React.createElement('div', {
                    key: `${commit.hash}:${start + index}`,
                    ref: element => {
                      if (element === null) rowRefs.current.delete(commit.hash)
                      else rowRefs.current.set(commit.hash, element)
                    },
                    className: `iwb-git-row ${selected ? 'iwb-selected' : ''} ${inCompare ? 'iwb-compare' : ''}`,
                    style: { top: `${top}px` },
                    tabIndex: 0,
                    onClick: event => {
                      if (event.ctrlKey || event.metaKey) store.toggleCompare(commit.hash)
                      else store.selectCommit(commit.hash)
                    },
                    onDoubleClick: () => openDetail(commit.hash),
                    onKeyDown: event => onRowKeyDown(event, commit),
                    onContextMenu: event => onContextMenu(event, commit),
                  },
                    React.createElement('div', { className: 'iwb-git-graph' },
                      React.createElement(GraphCell, { row, width: graphWidth, height: ROW_HEIGHT, offset: 0 }),
                    ),
                    React.createElement('span', { className: 'iwb-sha' }, commit.shortHash),
                    React.createElement('span', { className: 'iwb-subject', style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
                      commit.refs.length > 0
                        ? React.createElement('span', { style: { display: 'inline-flex', gap: 4, flex: '0 0 auto' } },
                            commit.refs.slice(0, 2).map(ref => React.createElement(RefChip, { key: ref, value: ref })),
                          )
                        : null,
                      React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, commit.subject),
                    ),
                    React.createElement('span', { className: 'iwb-author', title: commit.email }, commit.author),
                    React.createElement('span', { className: 'iwb-date' }, formatGitDate(commit.date, tableNarrow)),
                  )
                }),
                git.loading === true
                  ? React.createElement('div', { style: { position: 'absolute', left: 0, right: 0, bottom: -26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--iwb-muted)', fontSize: 11 } }, t('common.loading'))
                  : null,
              ),
        ),
      ),
      drawerOpen
        ? React.createElement(CommitDrawer, {
            store, git, narrow: drawerNarrow, width: drawerWidth,
            onResizeStart: startDrawerResize, onClose: closeDetail,
          })
        : null,
    ),
    menu !== null ? React.createElement(ContextMenu, { x: menu.x, y: menu.y, items: menuItems, onClose: () => setMenu(null) }) : null,
    branchMenu !== null
      ? React.createElement(BranchPopover, {
          store, branches: git.branches, currentBranch: slice.branch,
          x: branchMenu.x, y: branchMenu.y, onClose: () => setBranchMenu(null),
        })
      : null,
    repoMenu !== null
      ? React.createElement(RepoPopover, {
          store, x: repoMenu.x, y: repoMenu.y, onClose: () => setRepoMenu(null),
        })
      : null,
  )
}
