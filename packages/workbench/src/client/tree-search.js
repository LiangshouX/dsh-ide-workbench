/**
 * The tree search of the Project panel — the pure part of it.
 *
 * The rule of the tree search:
 *
 *   - a file matches when its FILE NAME starts with the query, and the case
 *     does not matter: `client-api` matches `client-api.d.ts`, `client-api.ts`
 *     and `client-api.js` — and nothing whose name only carries the text
 *     somewhere else;
 *   - a folder stays visible when it lies on the way to a matching file: the
 *     tree shows the WHOLE chain from the project root down to the folder of
 *     the match, and nothing else. A folder that does not lead to a match is
 *     noise, and it is hidden;
 *   - the match is looked up in the whole-project file index, so the search
 *     does not depend on what the user happens to have expanded: the chain to
 *     the match is expanded on the fly.
 *
 * The FILE LIST is a different rule, and it stays the old one: it matches the
 * WHOLE project-relative path, so a query that is a folder name lists the
 * files under that folder. Only its cost changes (see `buildPathIndex`).
 *
 * The soft hide — how the tree is filtered:
 *
 *   The model of the tree does NOT know the filter. `flatten` builds the rows
 *   of the tree, and the filter is a layer ON TOP of that model: the rows
 *   that do not lead to a match are not painted at all. The row objects are
 *   REUSED (the model is not rebuilt, and a keystroke never rebuilds it),
 *   and the rows that are hidden are not in the DOM — so they leave no gap,
 *   and the DOM does not churn either.
 *
 * The index is the performance centre of the whole thing. The file names are
 * sorted ONCE per index identity — with the plain comparison of the
 * repository, never `localeCompare` (the ICU collation is about six times
 * slower, and the order was never promised to be a collation) — and a lookup
 * is then a binary search for the lower bound plus the walk over the block of
 * the names that share the prefix: O(log n + k) instead of a scan over every
 * file of the project, on every keystroke.
 *
 * Dependency-free and pure so it stays unit-testable and cheap per keystroke.
 */

/**
 * @typedef {object} NameIndex
 * @property {string[]} names the lowercased file names, sorted
 * @property {string[]} paths the paths of those names, in the same order
 * @property {number} count how many paths the index carries
 */

/**
 * The lowercased file name of a project-relative path.
 *
 * The name is what the search matches on: a path is a location, a name is
 * what the reader types.
 *
 * @param {string} rel a project-relative path (forward slashes)
 * @returns {string} the lowercased file name, or an empty string
 */
export function nameOf(rel) {
  if (typeof rel !== 'string' || rel === '') return ''
  // The index carries forward slashes, but a name may hold a backslash of
  // its own (a POSIX file may): the last separator of either kind ends the
  // name.
  const slash = Math.max(rel.lastIndexOf('/'), rel.lastIndexOf('\\'))
  const name = slash < 0 ? rel : rel.slice(slash + 1)
  return name.toLowerCase()
}

/**
 * The name-sorted view over the file index.
 *
 * The names are lowercased (the search does not care about the case) and
 * sorted with the PLAIN comparison — the code-unit order, the very order the
 * host sorts the file index with. It is a total order, and it is about six
 * times faster than the collation of `localeCompare`.
 *
 * The index is built ONCE per index identity — never per keystroke.
 *
 * @param {string[]} paths the project-relative paths of the file index
 * @returns {NameIndex} the names and their paths, in the same order
 */
export function buildNameIndex(paths) {
  const list = Array.isArray(paths) ? paths : []
  const count = list.length
  const lower = new Array(count)
  const order = new Array(count)
  for (let index = 0; index < count; index += 1) {
    const rel = list[index]
    lower[index] = nameOf(rel)
    order[index] = index
  }
  // The plain comparison: the code-unit order of the names. The sort is
  // stable, so two files with the same name keep the order of the index.
  order.sort((left, right) => {
    const a = lower[left]
    const b = lower[right]
    if (a < b) return -1
    if (a > b) return 1
    return 0
  })
  const names = new Array(count)
  const sorted = new Array(count)
  for (let index = 0; index < count; index += 1) {
    const source = order[index]
    names[index] = lower[source]
    sorted[index] = list[source]
  }
  return { names, paths: sorted, count }
}

/**
 * The paths whose FILE NAME starts with the query.
 *
 * The names of the index are sorted, and the names that share a prefix are
 * ONE block inside that order — so the lookup is a binary search for the
 * lower bound of the query plus the walk over that block: O(log n + k).
 *
 * @param {NameIndex} index the name index of the project
 * @param {string} query what the reader typed
 * @param {number} [limit] the most matches the caller wants
 * @returns {string[]} the matching project-relative paths
 */
export function findByPrefix(index, query, limit) {
  if (index === undefined || index === null) return []
  const names = Array.isArray(index.names) ? index.names : []
  const paths = Array.isArray(index.paths) ? index.paths : []
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (needle === '') return []
  const cap = typeof limit === 'number' && Number.isFinite(limit) && limit > 0
    ? Math.floor(limit)
    : Number.POSITIVE_INFINITY
  // The lower bound: the first name that is not smaller than the query.
  let low = 0
  let high = names.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (names[middle] < needle) low = middle + 1
    else high = middle
  }
  const out = []
  // The names that carry the prefix follow each other: the walk stops at the
  // first name that does not carry it any more.
  for (let cursor = low; cursor < names.length && out.length < cap; cursor += 1) {
    if (!names[cursor].startsWith(needle)) break
    out.push(paths[cursor])
  }
  return out
}

/**
 * @typedef {object} PathIndex
 * @property {string[]} paths the project-relative paths, in the order of the
 *   file index
 * @property {string[]} lowered the same paths, lowercased
 * @property {number} count how many paths the index carries
 */

/**
 * The lowercased view over the file index — the view the FILE LIST scans.
 *
 * The list of files has always matched the WHOLE project-relative path, and
 * not only the name of the file: a query that is a folder name lists the
 * files under that folder. That behaviour stays; what changes is the cost.
 *
 * The paths are lowercased ONCE per index identity, so a keystroke does not
 * allocate a single string any more: the scan below is a plain `indexOf` over
 * strings that are already there.
 *
 * @param {string[]} paths the project-relative paths of the file index
 * @returns {PathIndex} the paths and their lowercased twin
 */
export function buildPathIndex(paths) {
  const list = Array.isArray(paths) ? paths : []
  const lowered = new Array(list.length)
  for (let cursor = 0; cursor < list.length; cursor += 1) {
    const rel = list[cursor]
    lowered[cursor] = typeof rel === 'string' ? rel.toLowerCase() : ''
  }
  return { paths: list, lowered, count: list.length }
}

/**
 * The paths whose WHOLE path carries the query.
 *
 * The case does not matter, and the query may be a folder name as well as a
 * part of a file name: `packages` lists the files under the folder
 * `packages`. The scan stops at the limit — the matches that are never shown
 * are never built either.
 *
 * @param {PathIndex} index the lowercased view of the project
 * @param {string} query what the reader typed
 * @param {number} [limit] the most matches the caller wants
 * @returns {string[]} the matching project-relative paths
 */
export function findByText(index, query, limit) {
  if (index === undefined || index === null) return []
  const lowered = Array.isArray(index.lowered) ? index.lowered : []
  const paths = Array.isArray(index.paths) ? index.paths : []
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (needle === '') return []
  const cap = typeof limit === 'number' && Number.isFinite(limit) && limit > 0
    ? Math.floor(limit)
    : Number.POSITIVE_INFINITY
  const out = []
  for (let cursor = 0; cursor < lowered.length && out.length < cap; cursor += 1) {
    if (lowered[cursor].indexOf(needle) < 0) continue
    out.push(paths[cursor])
  }
  return out
}

/**
 * The chain of folders that leads to the matches, and the files themselves.
 *
 * The chain is the set of ABSOLUTE directories that have to be open for the
 * match to be visible: every folder between the project root and the folder
 * of the file. The root itself is not one of them — the tree always shows
 * its children.
 *
 * @param {string[]} paths the matching project-relative paths
 * @param {string} root the absolute project root
 * @returns {{ dirs: string[], files: string[] }} the absolute directories to
 *   expand, and the absolute paths of the matching files
 */
export function expandPathsOf(paths, root) {
  const list = Array.isArray(paths) ? paths : []
  const base = typeof root === 'string' ? root.replace(/[\\/]$/, '') : ''
  const separator = base.includes('\\') ? '\\' : '/'
  const dirs = []
  const seen = new Set()
  const files = []
  for (const rel of list) {
    if (typeof rel !== 'string' || rel === '') continue
    const segments = rel.split('/')
    const name = segments.pop()
    if (name === undefined || name === '') continue
    let current = ''
    for (const segment of segments) {
      current = current === '' ? segment : `${current}/${segment}`
      const absolute = base === ''
        ? current
        : `${base}${separator}${current.split('/').join(separator)}`
      if (!seen.has(absolute)) {
        seen.add(absolute)
        dirs.push(absolute)
      }
    }
    files.push(base === ''
      ? rel
      : `${base}${separator}${rel.split('/').join(separator)}`)
  }
  return { dirs, files }
}

/**
 * The path of a placeholder row: its key carries it (`loading:<path>`).
 *
 * @param {string} key the key of the row
 * @returns {string | undefined} the path of the folder the row stands for
 */
function pathOfKey(key) {
  if (typeof key !== 'string') return undefined
  const colon = key.indexOf(':')
  return colon < 0 ? undefined : key.slice(colon + 1)
}

/**
 * The rows that stay visible under a search.
 *
 * A row stays when it is a folder ON THE WAY to a match, or when it IS a
 * match. Everything else is noise and goes away.
 *
 * This is the soft hide of the tree: the row objects are REUSED — the model
 * of the tree is not rebuilt, and a keystroke never rebuilds it — and the
 * rows that are hidden are not painted at all, so they leave no gap and the
 * DOM does not churn. A row that is a folder of a merged chain stands for the
 * whole chain, and the leaf of that chain is the folder of the match - so the
 * leaf is what the lookup asks for.
 *
 * @param {Array<object>} rows the rows of the tree
 * @param {Set<string> | string[]} keepDirs the absolute paths of the folders
 *   on the way to a match
 * @param {Set<string> | string[]} keepFiles the absolute paths of the matches
 * @returns {Array<object>} the visible rows — the very same row objects
 */
export function visibleTreeRows(rows, keepDirs, keepFiles) {
  const list = Array.isArray(rows) ? rows : []
  const dirs = keepDirs instanceof Set ? keepDirs : new Set(Array.isArray(keepDirs) ? keepDirs : [])
  const files = keepFiles instanceof Set ? keepFiles : new Set(Array.isArray(keepFiles) ? keepFiles : [])
  const out = []
  for (const row of list) {
    if (row === undefined || row === null) continue
    if (row.kind === 'dir') {
      const path = row.entry?.path
      if (typeof path === 'string' && dirs.has(path)) out.push(row)
      continue
    }
    if (row.kind === 'file') {
      const path = row.entry?.path
      if (typeof path === 'string' && files.has(path)) out.push(row)
      continue
    }
    // The placeholder of a folder that is loading (or that failed) belongs to
    // the chain only when its folder does.
    const path = typeof row.path === 'string' ? row.path : pathOfKey(row.key)
    if (typeof path === 'string' && dirs.has(path)) out.push(row)
  }
  return out
}
