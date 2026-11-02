/**
 * File-type helpers for the Project tree, editor tabs and Commit rows.
 * Kept dependency-free so it is unit-testable and cheap to call per row.
 *
 * The VISUAL family of a file is the harness's own: `icons.jsx` proxies the
 * host `FileTypeIcon`, which classifies the path itself. This module only
 * answers the question the host cannot — whether a file opens in the rendered
 * Markdown view.
 */

/**
 * Whether a file should open in the rendered Markdown view by default.
 * @param {string} name file name or path
 * @returns {boolean} true for Markdown sources
 */
export function isMarkdownFile(name) {
  return /\.(md|markdown|mdx)$/i.test(String(name ?? ''))
}
