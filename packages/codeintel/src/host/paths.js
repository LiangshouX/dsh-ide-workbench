/**
 * Path comparison for the code intelligence plugin.
 *
 * The language server manager keys its live sessions by a normalized path
 * (see `rootKey` in `lsp.js`), so a second spelling of the same folder has to
 * be recognized as the same folder - otherwise one project would be indexed
 * twice under two names.
 *
 * It is a COPY of the helper of the IDE workbench (PRD-v6 CUT-02): the two
 * plugins must not depend on each other, so the few lines are duplicated on
 * purpose.
 */

/**
 * The comparison key of one Windows path.
 *
 * @param {string} value
 * @returns {string}
 */
export function windowsKey(value) {
  return value.replace(/\\/g, '/').toLowerCase()
}

/**
 * Compare two absolute paths for identity.
 *
 * Windows paths are case-insensitive and accept both separators, so
 * `D:\Code`, `d:\code` and `d:/code` name the same folder. The comparison
 * therefore normalizes the separators as well.
 *
 * Everywhere else the comparison stays exact.
 * @param {string} left
 * @param {string} right
 * @returns {boolean} whether the two paths name the same folder
 */
export function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  if (process.platform === 'win32') return windowsKey(left) === windowsKey(right)
  return left === right
}
