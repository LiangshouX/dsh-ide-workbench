/**
 * JetBrains file-status model (IntelliJ default highlight scheme).
 *
 *   red    = unversioned (untracked, not added)
 *   green  = added to VCS / index (new file staged)
 *   blue   = tracked file with uncommitted changes (index or working tree)
 *   red + ! = merge conflict
 *   brown  = ignored (.gitignore)  / excluded directories get a tinted background
 *
 * Directories aggregate their descendants recursively, so a collapsed folder
 * already shows that something below it changed. Precedence (V2 decision):
 *   conflict > modified > added > unversioned.
 *
 * Dependency-free so it stays unit-testable and cheap per visible row.
 */

/** Precedence of one file status inside a directory aggregate. */
const RANK = { conflict: 4, modified: 3, added: 2, untracked: 1 }

/** Status kinds in descending precedence, for documentation/tests. */
export const STATUS_PRECEDENCE = ['conflict', 'modified', 'added', 'untracked']

/**
 * Classify one `git.status` entry.
 * @param {{ xy?: string, untracked?: boolean, conflict?: boolean, ignored?: boolean }} entry
 * @returns {'conflict'|'untracked'|'added'|'modified'|'deleted'|'ignored'|null}
 */
export function fileStatusKind(entry) {
  if (entry === undefined || entry === null) return null
  if (entry.ignored === true) return 'ignored'
  if (entry.conflict === true) return 'conflict'
  if (entry.untracked === true) return 'untracked'
  const xy = typeof entry.xy === 'string' ? entry.xy : ''
  if (xy[0] === 'D' || xy[1] === 'D') return 'deleted'
  if (xy[0] === 'A') return 'added'
  if (xy === '' || xy === '..') return null
  // Any other tracked difference (index or working tree) is "modified" in the
  // IDEA sense: the file differs from its last committed revision.
  return 'modified'
}

/** CSS class carrying the colour for one status kind. */
export function statusClass(kind) {
  switch (kind) {
    case 'untracked': return 'iwb-git-untracked'
    case 'added': return 'iwb-git-added'
    case 'modified': return 'iwb-git-modified'
    case 'conflict': return 'iwb-git-conflict'
    case 'deleted': return 'iwb-git-deleted'
    case 'ignored': return 'iwb-git-ignored'
    default: return ''
  }
}

/** Short row badge (optional column, hidden by default in V2). */
export function statusBadge(kind) {
  switch (kind) {
    case 'untracked': return 'U'
    case 'added': return 'A'
    case 'modified': return 'M'
    case 'conflict': return '!'
    case 'deleted': return 'D'
    case 'ignored': return 'I'
    default: return ''
  }
}

/** Every ancestor directory rel-path of `rel` (`a/b/c.txt` → `a`, `a/b`). */
function ancestorsOf(rel) {
  const parts = String(rel).split('/')
  const output = []
  for (let index = 1; index < parts.length; index += 1) output.push(parts.slice(0, index).join('/'))
  return output
}

/**
 * The ignored paths of one status snapshot.
 *
 * `has` is prefix aware: git does not descend into an ignored directory
 * (`--ignored=matching`), so the status carries no entry at all for the
 * files below it. A path below an ignored directory is ignored as well —
 * without that rule the whole subtree would keep its normal colour and the
 * folder would look like a tracked, unchanged directory (R6).
 *
 * The set itself stays a plain set of paths (the ignored entries and the
 * ancestors of the ignored directories), so the code that only iterates over
 * it is unaffected.
 *
 * Two kinds of paths live in it, and the difference matters:
 * - the ROOTS: the paths git reported as ignored (`target/`, `node_modules/`).
 *   Everything below a root is ignored, so a root answers for its subtree.
 * - the LEVELS: the ancestors of a root. Git does not descend into an ignored
 *   directory, so the levels above it hold nothing but ignored content and
 *   have to be grey as well (R6). They are NOT roots: a tracked file that
 *   sits next to an ignored folder must keep its own colour, so a level
 *   greys its own row and nothing below it.
 */
class IgnoredPaths extends Set {
  constructor() {
    super()
    this.roots = new Set()
    this.levels = new Set()
  }

  /**
   * The path git reported as ignored: it greys its whole subtree.
   * @param {string} path the repository-relative path
   */
  addRoot(path) {
    if (typeof path !== 'string' || path === '') return
    this.roots.add(path)
    super.add(path)
  }

  /**
   * An intermediate level above an ignored directory: it greys its own row.
   * @param {string} path the repository-relative path
   */
  addLevel(path) {
    if (typeof path !== 'string' || path === '') return
    this.levels.add(path)
    super.add(path)
  }

  /**
   * Whether the path is ignored — directly, below an ignored directory, or as
   * an intermediate level above one.
   * @param {unknown} path the repository-relative path
   * @returns {boolean}
   */
  has(path) {
    if (typeof path !== 'string' || path === '') return false
    const key = path.replace(/\/+$/, '')
    if (this.roots.has(key)) return true
    for (const ancestor of ancestorsOf(key)) if (this.roots.has(ancestor)) return true
    return this.levels.has(key)
  }
}

/**
 * Whether one path is ignored — directly or below an ignored directory.
 *
 * The consumer of the aggregate (the Project tree) looks a row up in the
 * ignored set, so the set itself answers the question; this helper is the
 * same rule for callers that keep their own set.
 *
 * @param {{ has: (path: string) => boolean }} ignored the ignored paths
 * @param {string} path the repository-relative path
 * @returns {boolean}
 */
export function isIgnoredPath(ignored, path) {
  if (ignored === undefined || ignored === null || typeof ignored.has !== 'function') return false
  return ignored.has(path)
}

/**
 * Remember the status of one directory, keeping the strongest one.
 *
 * The precedence is the IDEA one (conflict > modified > added > untracked),
 * so a folder that holds a modified file is not downgraded by an untracked
 * sibling.
 *
 * @param {Map<string, string>} dirs directory → status kind
 * @param {Set<string>} conflictDirs the directories that hold a conflict
 * @param {string} dir the directory rel-path
 * @param {string} kind the status kind
 */
function setDirStatus(dirs, conflictDirs, dir, kind) {
  const previous = dirs.get(dir)
  if (previous === undefined || (RANK[previous] ?? 0) < (RANK[kind] ?? 0)) dirs.set(dir, kind)
  if (kind === 'conflict') conflictDirs.add(dir)
}

/**
 * Build the recursive status map.
 *
 * @param {Array<{ path: string, xy?: string, untracked?: boolean, conflict?: boolean,
 *   ignored?: boolean, ignoredDir?: boolean }>} entries
 *   entries carry workspace-relative `path` values
 * @returns {{ dirs: Map<string, string>, files: Map<string, string>,
 *   ignored: Set<string>, conflictDirs: Set<string>, entries: Array<object> }}
 *   `entries` is the list this aggregate was built from, so a caller can tell
 *   whether a later list still describes the same status.
 *   `ignored` holds the ignored paths without a trailing slash; `has` also
 *   answers for the paths below an ignored directory (R6).
 */
export function aggregateStatus(entries) {
  const list = Array.isArray(entries) ? entries : []
  const dirs = new Map()
  const files = new Map()
  const ignored = new IgnoredPaths()
  const conflictDirs = new Set()
  // The ignored roots and the paths that git said something else about. The
  // second list decides which intermediate levels may be greyed (R6).
  const ignoredRoots = []
  const otherPaths = []
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object' || typeof entry.path !== 'string') continue
    const kind = fileStatusKind(entry)
    if (kind === null) continue
    if (kind === 'ignored') {
      // The host drops the trailing slash of an ignored directory, so both
      // sides speak the same key. A path that still carries one (an older
      // host, a hand-written entry) is normalized here as well.
      const isDir = entry.ignoredDir === true || entry.path.endsWith('/')
      const path = entry.path.replace(/\/+$/, '')
      if (path === '') continue
      ignored.addRoot(path)
      ignoredRoots.push({ path, isDir })
      // An ignored entry colours nothing: it must not reach the directory
      // table (`dirs`) nor the file table (`files`).
      continue
    }
    otherPaths.push(entry.path.replace(/\/+$/, ''))
    // A porcelain entry that ends with a slash describes a DIRECTORY
    // (`? dir/`), not a file. The tree looks directories up in `dirs` and
    // files in `files`, so such an entry must never reach the file table —
    // the files inside the directory would stay uncoloured (GIT-01).
    if (entry.path.endsWith('/')) {
      const dir = entry.path.replace(/\/+$/, '')
      setDirStatus(dirs, conflictDirs, dir, kind)
      for (const ancestor of ancestorsOf(dir)) setDirStatus(dirs, conflictDirs, ancestor, kind)
      continue
    }
    files.set(entry.path, kind)
    for (const dir of ancestorsOf(entry.path)) setDirStatus(dirs, conflictDirs, dir, kind)
  }
  // The ancestors of an ignored DIRECTORY are grey as well: git only reports
  // the deepest ignored directory (`target/sub/`), and the levels above it
  // have to be grey as well (R6). They are levels, not roots: a level greys
  // its own row and nothing below it, so a tracked file next to an ignored
  // folder keeps its own colour. A level that git said something else about
  // is not grey either - it holds real content.
  for (const root of ignoredRoots) {
    if (!root.isDir) continue
    for (const ancestor of ancestorsOf(root.path)) {
      const prefix = `${ancestor}/`
      if (otherPaths.some(path => path.startsWith(prefix))) continue
      ignored.addLevel(ancestor)
    }
  }
  return { dirs, files, ignored, conflictDirs, entries: list }
}

/**
 * Whether two entry lists describe the same status.
 *
 * The aggregate depends on a file only through its path and its kind, so two
 * lists that agree on those agree on the aggregate — whatever else the host
 * sends alongside an entry does not matter here. The one exception is the
 * ignored DIRECTORY flag: it decides whether the ancestors of the path are
 * ignored as well, so it belongs to the status (R6).
 *
 * @param {Array<object>} left the earlier entry list
 * @param {Array<object>} right the later entry list
 * @returns {boolean} true when both describe the same status
 */
export function sameStatusEntries(left, right) {
  const first = Array.isArray(left) ? left : []
  const second = Array.isArray(right) ? right : []
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    const one = first[index]
    const other = second[index]
    if (one === other) continue
    if (one === null || other === null || typeof one !== 'object' || typeof other !== 'object') return false
    if (one.path !== other.path) return false
    if (fileStatusKind(one) !== fileStatusKind(other)) return false
    if ((one.ignoredDir === true) !== (other.ignoredDir === true)) return false
  }
  return true
}

/**
 * The aggregate for these entries, keeping the previous one while the entries
 * still describe the same status.
 *
 * The store polls the git status every two seconds and hands over a fresh
 * entry list every time. Rebuilding the aggregate from it produced fresh Map
 * and Set instances on every poll, and every memo keyed on them rebuilt the
 * whole file tree — even though nothing had changed.
 *
 * @param {object|undefined} previous the last aggregate, when there is one
 * @param {Array<object>} entries the entry list to aggregate
 * @returns {object} the aggregate; the previous one when nothing changed
 */
export function stableAggregateStatus(previous, entries) {
  const list = Array.isArray(entries) ? entries : []
  if (previous !== undefined && sameStatusEntries(previous.entries, list)) return previous
  return aggregateStatus(list)
}
