/**
 * Path helpers of the code intelligence plugin.
 *
 * The plugin compares absolute paths a lot: the fence of the workspace, the
 * fence of the language server and the roots the user remembered a decision
 * for. The rules are the ones of the core (they are the rules of Windows and
 * of POSIX, not of a plugin): both separators count as one, a trailing slash
 * is nothing, and a Windows path compares case-insensitively.
 *
 * The helpers live in their own module because the plugin may not import
 * anything from the IDE workbench (PRD-v6 §5.5, acceptance R5).
 */

/**
 * Normalize one path for equality and for keys.
 * @param {unknown} path the path
 * @returns {string} the normalized path, `''` for an empty one
 */
export function normalizeScopePath(path) {
  if (typeof path !== 'string' || path === '') return ''
  const slashed = path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '')
  const windows = /^[A-Za-z]:\//.test(slashed) || slashed.startsWith('//')
  return windows ? slashed.toLowerCase() : slashed
}

/**
 * Whether two non-empty paths name the same file, directory or project.
 * @param {unknown} left the first path
 * @param {unknown} right the second path
 * @returns {boolean} true when both name the same place
 */
export function sameScopePath(left, right) {
  const normalized = normalizeScopePath(left)
  return normalized !== '' && normalized === normalizeScopePath(right)
}

/**
 * Whether one path is the root itself or lives below it.
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
 * @param {unknown} base the containing directory
 * @param {unknown} absolute the absolute path
 * @returns {string | null} `''` when the path is the base itself, `null` when
 *   it does not live inside the base
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
  // The prefix has the same length as the original spelling (the case folding
  // never changes a length), so the slice keeps the original casing.
  return slashed.slice(parent.length + 1)
}

/**
 * The last segment of one path.
 * @param {unknown} path the path
 * @returns {string} the name of the file or the directory
 */
export function baseName(path) {
  if (typeof path !== 'string' || path === '') return ''
  const parts = path.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] ?? ''
}
