/**
 * Geometry for the Git log + commit Drawer, and the client-side filters of
 * the log.
 *
 * The Drawer is a side panel whenever the dock has room; it becomes an
 * overlay only below a genuinely narrow width. Column hiding is based on the
 * *remaining table* width, not on the whole dock, so opening a Drawer on a
 * normal bottom panel must not flip the whole panel into overlay mode.
 *
 * The filters live here because they are the OTHER half of the same problem:
 * the branch scope, the author, the message and the date are answered from
 * the rows that are already loaded, so changing them costs a walk over the
 * loaded page instead of a `git log` subprocess over the whole repository
 * (that subprocess was the "switching the branch lags" defect).
 */
export const DRAWER_MIN = 340
export const DRAWER_DEFAULT = 420
export const OVERLAY_BELOW = 520
export const COLUMNS_BELOW = 560

export function gitLayout({ mainWidth = 0, configuredWidth = DRAWER_DEFAULT, drawerOpen = false } = {}) {
  const width = Number.isFinite(mainWidth) ? Math.max(0, mainWidth) : 0
  const desired = Number.isFinite(configuredWidth) ? configuredWidth : DRAWER_DEFAULT
  const drawerNarrow = width > 0 && width < OVERLAY_BELOW
  const drawerWidth = Math.max(DRAWER_MIN, Math.min(
    desired,
    width > 0 ? Math.max(DRAWER_MIN, width * 0.55) : desired,
    width > 0 ? Math.max(DRAWER_MIN, width - 300) : desired,
  ))
  const tableWidth = width > 0 ? (width - (drawerOpen ? drawerWidth : 0)) : 0
  return {
    drawerNarrow,
    drawerWidth,
    tableWidth,
    tableNarrow: tableWidth > 0 && tableWidth < COLUMNS_BELOW,
  }
}

/** One day in milliseconds - the unit of the date filter. */
const DAY_MS = 86_400_000

/**
 * The epoch milliseconds of the date of a commit.
 *
 * The log carries the ISO date of git (`2026-10-20 10:00:00 +0800`); the
 * offset is part of it, so the value is comparable with `Date.now()`.
 * @param {string} value the date of a commit
 * @returns {number | null} the epoch milliseconds, or null when the date cannot be read
 */
export function gitDateMs(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\s*([+-])(\d{2}):?(\d{2}))?/.exec(String(value ?? '').trim())
  if (match === null) return null
  const [, year, month, day, hour, minute, second, sign, offsetHour, offsetMinute] = match
  const offset = sign === undefined ? 0 : (Number(offsetHour) * 60 + Number(offsetMinute)) * 60_000
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  return sign === '-' ? utc + offset : utc - offset
}

/**
 * The cutoff of the date filter, in epoch milliseconds.
 *
 * The filter speaks git's own vocabulary ("7 days ago"), so the value is
 * turned into the moment the filter starts to bite.
 * @param {string} since the value of the date filter
 * @param {number} now the epoch milliseconds of "now"
 * @returns {number | null} the cutoff, or null when the filter is empty
 */
export function sinceCutoffMs(since, now) {
  const match = /^(\d+)\s+days?\s+ago$/i.exec(String(since ?? '').trim())
  if (match === null) return null
  return now - Number(match[1]) * DAY_MS
}

/**
 * Whether a decoration names a branch.
 *
 * git decorates a commit with the refs that point at it: `main`,
 * `HEAD -> main` for the branch that is checked out, `origin/main` for a
 * remote. Only the branch itself (and the `HEAD ->` form of it) counts.
 * @param {string} ref one entry of the `refs` of a commit
 * @param {string} branch the name of the branch
 * @returns {boolean} true when the ref names the branch
 */
function refNamesBranch(ref, branch) {
  if (typeof ref !== 'string' || ref === '' || branch === '') return false
  return ref === branch || ref === `HEAD -> ${branch}` || ref === `refs/heads/${branch}`
}

/**
 * The hashes of the loaded commits that belong to one branch.
 *
 * A commit belongs to a branch when the tip of that branch is one of its
 * ancestors - the very rule of `git log <branch>`. The tip is the commit the
 * branch ref points at, and the ancestors are walked through the parents the
 * rows already carry, so the answer costs one pass over the loaded page.
 *
 * The tip is not always among the loaded rows: a branch whose tip is older
 * than the whole loaded window has no loaded commit at all, and the set is
 * empty (loading more brings its tip in).
 * @param {Array<{ hash: string, parents?: string[], refs?: string[] }>} commits the loaded commits
 * @param {string} branch the name of the branch
 * @returns {Set<string>} the hashes of the commits of that branch
 */
export function branchCommitHashes(commits, branch) {
  const members = new Set()
  if (typeof branch !== 'string' || branch === '') return members
  const byHash = new Map()
  let tip = null
  for (const commit of commits) {
    byHash.set(commit.hash, commit)
    if (tip === null && (commit.refs ?? []).some(ref => refNamesBranch(ref, branch))) tip = commit
  }
  if (tip === null) return members
  const pending = [tip.hash]
  members.add(tip.hash)
  while (pending.length > 0) {
    const commit = byHash.get(pending.pop())
    for (const parent of commit?.parents ?? []) {
      if (members.has(parent) || !byHash.has(parent)) continue
      members.add(parent)
      pending.push(parent)
    }
  }
  return members
}

/**
 * Whether a filter of the Git window is doing something.
 *
 * The branch scope is not one of them: it is a scope, and the segmented
 * control says which one is chosen.
 * @param {{ since?: string, author?: string, query?: string, path?: string }} filters
 * @returns {boolean} true when at least one filter narrows the rows
 */
export function hasActiveFilters(filters = {}) {
  return ['since', 'author', 'query', 'path'].some(key => {
    const value = filters[key]
    return typeof value === 'string' && value.trim() !== ''
  })
}

/**
 * The loaded commits that pass the client-side filters.
 *
 * The path filter is NOT applied here: it is the one filter git alone can
 * answer, so the host has already limited the history of the path.
 * @param {Array<object>} commits the loaded commits, newest first
 * @param {{ branch?: string, author?: string, query?: string, since?: string }} filters
 * @param {{ now?: number }} [options] the moment "now" is measured at
 * @returns {Array<object>} the commits that pass the filters
 */
export function filterGitLog(commits, filters = {}, options = {}) {
  const list = Array.isArray(commits) ? commits : []
  const branch = typeof filters.branch === 'string' ? filters.branch.trim() : ''
  const author = typeof filters.author === 'string' ? filters.author.trim().toLowerCase() : ''
  const query = typeof filters.query === 'string' ? filters.query.trim().toLowerCase() : ''
  const cutoff = sinceCutoffMs(filters.since, options.now ?? Date.now())
  if (branch === '' && author === '' && query === '' && cutoff === null) return list
  const members = branch === '' ? null : branchCommitHashes(list, branch)
  const result = []
  for (const commit of list) {
    if (members !== null && !members.has(commit.hash)) continue
    if (author !== '') {
      const name = String(commit.author ?? '').toLowerCase()
      const email = String(commit.email ?? '').toLowerCase()
      if (!name.includes(author) && !email.includes(author)) continue
    }
    if (query !== '' && !String(commit.subject ?? '').toLowerCase().includes(query)) continue
    if (cutoff !== null) {
      const date = gitDateMs(commit.date)
      // A commit whose date cannot be read stays in the list: the filter must
      // not hide a row because of a date it did not understand.
      if (date !== null && date < cutoff) continue
    }
    result.push(commit)
  }
  return result
}
