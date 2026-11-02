/**
 * Commit tool-window model (pure, unit-testable).
 *
 * V2 keeps JetBrains semantics: two groups (Changes / Unversioned), a
 * checkbox that means "include in commit" without moving the row, changelist
 * grouping and optional directory grouping.
 */

export const DEFAULT_CHANGELIST = 'Default'

/** Parent directory of a workspace-relative path ('' for the root). */
export function parentDirOf(rel) {
  const index = rel.lastIndexOf('/')
  return index < 0 ? '' : rel.slice(0, index)
}

/**
 * Split tracked vs unversioned entries.
 *
 * `buckets` pins a path to the unversioned group after the user checked it:
 * `git add` turns an untracked file into `A.`, but the row must not move.
 */
export function splitCommitGroups(entries, buckets = {}) {
  const changes = []
  const unversioned = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry === null || typeof entry !== 'object') continue
    if (entry.ignored === true) continue
    const isUntracked = entry.untracked === true || buckets[entry.path] === 'untracked'
    if (isUntracked) unversioned.push(entry)
    else changes.push(entry)
  }
  return { changes, unversioned }
}

/**
 * Checkbox state of one entry: explicit check, explicit uncheck, else
 * "checked" when the file is already staged.
 */
export function isEntryChecked(entry, { checked, unchecked } = {}) {
  const path = entry?.path
  if (typeof path !== 'string') return false
  if (unchecked !== undefined && unchecked !== null && unchecked.has(path)) return false
  if (checked !== undefined && checked !== null && checked.has(path)) return true
  return entry.staged === true
}

/** Paths currently checked across a list of entries. */
export function checkedPathsOf(entries, state) {
  const set = new Set()
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (isEntryChecked(entry, state)) set.add(entry.path)
  }
  return set
}

/** 'all' | 'some' | 'none' for a group header checkbox. */
export function headerState(entries, checkedPaths) {
  const list = Array.isArray(entries) ? entries : []
  if (list.length === 0) return 'none'
  const selected = list.filter(entry => checkedPaths.has(entry.path)).length
  if (selected === 0) return 'none'
  return selected === list.length ? 'all' : 'some'
}

/**
 * Group one entry list by parent directory, sorted by path.
 * @returns {Array<{ dir: string, entries: Array<any> }>}
 */
export function groupByDirectory(entries) {
  const map = new Map()
  for (const entry of Array.isArray(entries) ? entries : []) {
    const dir = parentDirOf(entry.path)
    const list = map.get(dir)
    if (list === undefined) map.set(dir, [entry])
    else list.push(entry)
  }
  return [...map.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([dir, list]) => ({ dir, entries: list }))
}

/** The changelist a path belongs to (Default unless explicitly assigned). */
export function changelistOf(path, lists = {}) {
  for (const [name, paths] of Object.entries(lists)) {
    if (Array.isArray(paths) && paths.includes(path)) return name
  }
  return DEFAULT_CHANGELIST
}

/**
 * Group Changes entries by changelist: Default first, then custom lists.
 * Empty lists are omitted.
 */
export function groupByChangelist(entries, lists = {}) {
  const groups = new Map([[DEFAULT_CHANGELIST, []]])
  for (const name of Object.keys(lists)) {
    if (name !== DEFAULT_CHANGELIST) groups.set(name, [])
  }
  for (const entry of Array.isArray(entries) ? entries : []) {
    const name = changelistOf(entry.path, lists)
    const list = groups.get(name)
    if (list === undefined) groups.set(name, [entry])
    else list.push(entry)
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length > 0)
    .map(([name, list]) => ({ name, entries: list }))
}

/** Remove one path from every changelist and add it to `target`. */
export function assignChangelist(lists, paths, target) {
  const next = {}
  for (const [name, list] of Object.entries(lists ?? {})) {
    next[name] = (Array.isArray(list) ? list : []).filter(path => !paths.includes(path))
  }
  if (target !== undefined) {
    next[target] = [...new Set([...(next[target] ?? []), ...paths])]
  }
  return next
}

/** One-line human label of a status entry ('Added', 'Modified to be committed'…). */
export function statusLabel(entry) {
  if (entry === undefined || entry === null) return ''
  if (entry.conflict === true) return 'conflict'
  if (entry.untracked === true) return 'unversioned'
  const xy = entry.xy ?? ''
  if (xy[0] === 'A') return 'added'
  if (xy[0] === 'M' || xy[1] === 'M') return 'modified'
  if (xy[0] === 'D' || xy[1] === 'D') return 'deleted'
  if (xy[0] === 'R') return 'renamed'
  return ''
}
