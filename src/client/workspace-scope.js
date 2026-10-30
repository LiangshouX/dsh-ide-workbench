/**
 * Session → workspace helpers shared by the client entry and the store.
 *
 * DSH's session summary exposes the Session workspace root as `cwd`; the
 * right Sidebar keeps one layout per Session, so the plugin uses that path as
 * the scope key for its own store. Keeping these helpers pure makes the
 * workspace-scoping rules testable without a browser.
 */

/**
 * Normalize one path for equality/keys: both separators to `/`, collapsed
 * repeats, trailing slash dropped; Windows drive and UNC paths compare
 * case-insensitively.
 * @param {unknown} path
 * @returns {string}
 */
export function normalizeScopePath(path) {
  if (typeof path !== 'string' || path === '') return ''
  const slashed = path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '')
  const windows = /^[A-Za-z]:\//.test(slashed) || slashed.startsWith('//')
  return windows ? slashed.toLowerCase() : slashed
}

/**
 * Whether two non-empty paths name the same workspace/project.
 * @param {unknown} left
 * @param {unknown} right
 */
export function sameScopePath(left, right) {
  const normalized = normalizeScopePath(left)
  return normalized !== '' && normalized === normalizeScopePath(right)
}

/**
 * Whether one path is the root itself or lives below it.
 *
 * Both sides go through {@link normalizeScopePath}, so separator spelling,
 * trailing slashes and Windows case never split one tree into two.
 * @param {unknown} root the containing directory
 * @param {unknown} path the candidate file or directory
 * @returns {boolean} false when either path is empty
 */
export function isPathWithin(root, path) {
  const parent = normalizeScopePath(root)
  if (parent === '') return false
  const candidate = normalizeScopePath(path)
  return candidate === parent || candidate.startsWith(`${parent}/`)
}

/**
 * The path of `absolute` relative to `base`, with `/` separators.
 *
 * The git status belongs to the repository the Git window reads (PRD-v4
 * §4.1), so its paths are relative to *that* repository while the file tree
 * speaks project-relative paths. This helper converts one into the other and
 * returns `null` when the path does not live inside `base` — a caller must
 * never treat an outside path as a relative one.
 * @param {unknown} base the containing directory
 * @param {unknown} absolute the absolute path
 * @returns {string | null} `''` when the path is the base itself
 */
export function relativePathWithin(base, absolute) {
  const parent = normalizeScopePath(base)
  if (parent === '') return null
  if (typeof absolute !== 'string' || absolute === '') return null
  const slashed = absolute.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '')
  if (slashed === '') return null
  const candidate = normalizeScopePath(slashed)
  if (candidate === parent) return ''
  if (!candidate.startsWith(`${parent}/`)) return null
  // The prefix has the same length as the original spelling (case folding
  // never changes a length), so the slice keeps the original casing.
  return slashed.slice(parent.length + 1)
}

/**
 * The workspace root a Session belongs to, when the host has published it.
 * @param {any} ctx client cordis context
 * @param {string} sessionId
 * @returns {string} `''` when unknown
 */
export function sessionCwdOf(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return ''
  try {
    const sessions = ctx?.sessions ?? ctx?.get?.('sessions')
    const list = sessions?.list?.getSnapshot?.()
    const summary = list?.byId?.[sessionId]
    return typeof summary?.cwd === 'string' ? summary.cwd : ''
  } catch {
    return ''
  }
}

/**
 * The store key for one Session: its workspace root, or the Session itself
 * when the host has not published a cwd.
 * @param {any} ctx client cordis context
 * @param {string} sessionId
 */
export function workspaceScopeKey(ctx, sessionId) {
  const cwd = sessionCwdOf(ctx, sessionId)
  return cwd === '' ? `session:${sessionId}` : `workspace:${normalizeScopePath(cwd)}`
}

/**
 * Whether two Sessions share one workspace root.
 * @param {any} ctx client cordis context
 * @param {string} left
 * @param {string} right
 */
export function sameWorkspace(ctx, left, right) {
  return sameScopePath(sessionCwdOf(ctx, left), sessionCwdOf(ctx, right))
}

/**
 * Whether switching Sessions should reopen the IDE in the arriving Session.
 *
 * The IDE is only carried across a switch when its body was actually visible
 * in the Session being left (so a hidden/closed IDE does not pop open) and
 * both Sessions resolve to the same workspace root.
 * @param {any} ctx client cordis context
 * @param {string} previous the Session being left
 * @param {string} next the Session arriving
 * @param {string | null} visibleSession the Session whose IDE body was visible
 */
export function shouldContinueIde(ctx, previous, next, visibleSession) {
  if (typeof previous !== 'string' || typeof next !== 'string') return false
  if (previous === '' || next === '' || previous === next) return false
  if (visibleSession !== previous) return false
  return sameWorkspace(ctx, previous, next)
}
