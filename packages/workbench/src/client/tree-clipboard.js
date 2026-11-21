/**
 * The clipboard of the project tree: WHERE a paste lands, and what may not
 * be pasted at all.
 *
 * These are the answers to the question every user of a file tree asks
 * ("where did it go?"). A paste has to land in the folder the user is
 * looking at - the folder that is selected, the folder the menu was opened
 * on, the project root when nothing is selected - and never in a place the
 * user has to go looking for.
 *
 * The rules live in their own module because they are the same rules for the
 * context menu and for the keyboard: one place decides, so the two can never
 * disagree. The module is pure - the panel asks it, the store obeys it, and
 * a test can check it without a browser.
 */

/**
 * The parent directory of a path (both separators).
 *
 * @param {string} path the absolute path of an entry
 * @returns {string} the absolute path of the folder that holds it
 */
export function parentOf(path) {
  if (typeof path !== 'string' || path === '') return ''
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index <= 0 ? path : path.slice(0, index)
}

/**
 * Whether `child` is `parent` itself or lives under it.
 *
 * The comparison is segment-aware: `C:\demo2` is NOT under `C:\demo`, and a
 * plain `startsWith` would say it is.
 *
 * @param {string} parent the absolute path of a folder
 * @param {string} child the absolute path of an entry
 * @returns {boolean}
 */
export function isUnder(parent, child) {
  if (typeof parent !== 'string' || parent === '') return false
  if (typeof child !== 'string' || child === '') return false
  if (child === parent) return true
  const separator = parent.includes('\\') ? '\\' : '/'
  return child.startsWith(`${parent}${separator}`)
}

/**
 * The folder every path of the list lives in.
 *
 * A selection of files that share one folder is pasted into that folder; a
 * selection that spans folders is pasted into the folder that holds them
 * all. When there is no such folder (the paths do not share one) the answer
 * is the empty string - the caller falls back to the project root.
 *
 * @param {string[]} paths the absolute paths of the selected entries
 * @returns {string} the absolute path of the folder that holds them all
 */
export function commonParentOf(paths) {
  const list = (Array.isArray(paths) ? paths : []).filter(path => typeof path === 'string' && path !== '')
  if (list.length === 0) return ''
  let candidate = parentOf(list[0])
  for (const path of list.slice(1)) {
    while (candidate !== '' && !isUnder(candidate, path)) {
      const next = parentOf(candidate)
      if (next === candidate) break
      candidate = next
    }
  }
  return candidate
}

/**
 * The folder a paste lands in.
 *
 * The rules, in order:
 *
 *   1. a selected FOLDER receives the paste inside itself - the user pointed
 *      at that folder, so that is where the entry belongs;
 *   2. a selected FILE receives the paste in its own folder - a file cannot
 *      hold anything;
 *   3. a multi-selection receives the paste in the folder the entries share;
 *   4. the entry the context menu was opened on receives the paste, when the
 *      menu is what the user acted on and nothing is selected;
 *   5. the FOCUSED entry receives the paste, when the search hides the row
 *      the user picked - the tree still knows what that path is;
 *   6. without any hint the paste lands in the project root.
 *
 * @param {string} root the absolute path of the project root
 * @param {Array<{ path: string, isDir?: boolean }>} selected the selected entries
 * @param {{ path: string, isDir?: boolean } | undefined} menuEntry the entry the context menu was opened on
 * @param {{ path: string, isDir?: boolean } | undefined} focusedEntry the entry the tree points at
 * @returns {string} the absolute path of the target folder
 */
export function pasteTargetOf(root, selected, menuEntry, focusedEntry) {
  const entries = (Array.isArray(selected) ? selected : []).filter(entry => entry !== null && entry !== undefined)
  if (entries.length === 1) {
    const entry = entries[0]
    if (entry.isDir === true) return entry.path
    return parentOf(entry.path)
  }
  if (entries.length > 1) {
    const common = commonParentOf(entries.map(entry => entry.path))
    if (common !== '') return common
  }
  if (menuEntry !== null && menuEntry !== undefined) {
    if (menuEntry.isDir === true) return menuEntry.path
    return parentOf(menuEntry.path)
  }
  if (focusedEntry !== null && focusedEntry !== undefined) {
    if (focusedEntry.isDir === true) return focusedEntry.path
    return parentOf(focusedEntry.path)
  }
  return typeof root === 'string' ? root : ''
}

/**
 * Why a paste may not happen - `null` when it may.
 *
 * A folder cannot be pasted into itself, and it cannot be pasted into one of
 * its own subfolders: the copy would walk into itself and never end. The
 * host refuses both as well, but it refuses them AFTER the request crossed
 * the wire - here the user learns it at once, before anything is written.
 *
 * @param {Array<{ path: string, isDir?: boolean }>} entries the entries of the clipboard
 * @param {string} target the folder the paste would land in
 * @returns {null | 'self' | 'inside' | 'no-target'} the reason, or `null`
 */
export function pasteRefusal(entries, target) {
  if (typeof target !== 'string' || target === '') return 'no-target'
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry === null || entry === undefined) continue
    const path = entry.path
    if (typeof path !== 'string' || path === '') continue
    if (path === target) return 'self'
    if (entry.isDir === true && isUnder(path, target)) return 'inside'
  }
  return null
}
