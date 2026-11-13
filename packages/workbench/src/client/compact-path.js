/**
 * Compact directory chains — VS Code "compact folders" / IntelliJ "compact
 * middle packages".
 *
 * A chain of folders that holds nothing but one sub-folder is a package chain
 * (`com/liangshou/adapter/controller`), and an IDE shows it as one row
 * instead of a ladder of seven. This module is the single implementation of
 * that rule: the Project tree (R5) and the Git changed-file tree (R7) share
 * it, so both speak the same language about what a "merged folder" is.
 *
 * Dependency-free and pure so it stays unit-testable and cheap per visible
 * row.
 */

/**
 * @typedef {object} CompactNode
 * @property {string} name the single-segment display name of the node
 * @property {string} path the real path of the node (absolute or repo-relative)
 * @property {'dir'|'file'} kind
 * @property {CompactNode[]} [children] the children of a directory node.
 *   `undefined` means "not loaded yet" — such a node ends a merge chain,
 *   so no extra directory read is ever needed to decide.
 * @property {boolean} [merged] true for a node that stands for a chain
 * @property {string[]} [segments] the directory names of a merged chain
 */

/**
 * Whether one node is a directory that holds exactly one child directory.
 *
 * A folder with a file in it, or with more than one sub-folder, is where the
 * tree starts to branch — it is never merged into its parent.
 *
 * @param {CompactNode | undefined | null} node
 * @returns {boolean}
 */
export function isCompactable(node) {
  if (node === undefined || node === null) return false
  if (node.kind !== undefined && node.kind !== 'dir') return false
  if (!Array.isArray(node.children)) return false
  if (node.children.length !== 1) return false
  const only = node.children[0]
  return only !== undefined && only !== null && only.kind !== 'file'
}

/**
 * The chain of directory names one node stands for.
 *
 * @param {CompactNode} node
 * @returns {string[]}
 */
export function segmentsOf(node) {
  if (node === undefined || node === null) return []
  if (Array.isArray(node.segments) && node.segments.length > 0) return node.segments
  return typeof node.name === 'string' && node.name !== '' ? [node.name] : []
}

/**
 * Whether one node is a merged chain.
 * @param {CompactNode | undefined | null} node
 * @returns {boolean}
 */
export function isMergedNode(node) {
  return node !== undefined && node !== null && node.merged === true
}

/**
 * Merge the single-child directory chains of one level.
 *
 * A chain starts at a node that holds exactly one sub-directory and no file,
 * and continues while that condition holds. The chain stops at the first node
 * that branches, that holds a file, or that is not loaded yet.
 *
 * The merged node keeps the *leaf* of the chain as its path: the leaf is the
 * real directory that a "new file here" or a "delete" acts on. Its children
 * are the leaf's children, so expanding it shows the leaf's content right
 * away.
 *
 * The tree root never takes part in a merge (a root that merged with its only
 * child would lose the path context completely), so the root's own children
 * may still merge with *their* children.
 *
 * @param {CompactNode[]} nodes the children of one level
 * @returns {CompactNode[]} the level with its chains merged
 */
export function compactTree(nodes) {
  const list = Array.isArray(nodes) ? nodes : []
  const output = []
  for (const node of list) {
    if (node === undefined || node === null) {
      output.push(node)
      continue
    }
    if (!isCompactable(node)) {
      output.push(node)
      continue
    }
    const segments = [node.name]
    let current = node
    while (isCompactable(current)) {
      const only = current.children[0]
      segments.push(only.name)
      current = only
    }
    // A chain of one is no chain at all: the node was not compactable in the
    // first place, so keep it exactly as it was.
    if (segments.length < 2) {
      output.push(node)
      continue
    }
    output.push({
      ...current,
      name: node.name,
      merged: true,
      segments,
      path: current.path,
      children: current.children,
    })
  }
  return output
}

/**
 * The display label of one node.
 *
 * A merged chain is joined by `sep`. When one of its segments contains the
 * separator itself the label would be ambiguous (`a.b.c` could be three
 * folders or two), so the whole label falls back to the slash spelling to
 * show which is which.
 *
 * @param {CompactNode} node
 * @param {string} [sep] the separator of the label, `.` by default
 * @returns {string}
 */
export function compactLabel(node, sep = '.') {
  if (node === undefined || node === null) return ''
  const segments = segmentsOf(node)
  if (segments.length === 0) return typeof node.name === 'string' ? node.name : ''
  if (segments.length === 1) return segments[0]
  const separator = typeof sep === 'string' && sep !== '' ? sep : '.'
  const ambiguous = segments.some(segment => segment.includes(separator))
  return segments.join(ambiguous ? '/' : separator)
}

/**
 * The label of one merged node, shortened to the width that is available.
 *
 * The full path always stays in the `title` of the row, so the short form
 * never loses information.
 *
 * @param {CompactNode} node
 * @param {number} maxChars the width the label may use
 * @param {string} [sep] the separator of the full label, `.` by default
 * @returns {string}
 */
export function compactLabelFitted(node, maxChars, sep = '.') {
  const full = compactLabel(node, sep)
  const limit = typeof maxChars === 'number' && maxChars > 0 ? maxChars : full.length
  if (full.length <= limit) return full
  const segments = segmentsOf(node)
  if (segments.length <= 1) return full
  const head = segments[0]
  const tail = segments[segments.length - 1]
  const short = `${head}…${tail}`
  if (short.length <= limit) return short
  return tail
}
