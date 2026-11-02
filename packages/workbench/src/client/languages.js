/**
 * The language of a file.
 *
 * The workbench knows two things about the language of a file: the grammar
 * package that highlights it (see `LANGUAGE_PACKAGES` of `CodeEditor.jsx`) and
 * the language id the contract reports to a consumer of the editor seam.
 *
 * The id is the name of the LANGUAGE, not the name of the grammar package:
 * a consumer of the seam asks a language server for it, and the servers know
 * `typescript`, not `javascript-ts`.
 */

/** The language ids of the files the workbench knows. */
const LANGUAGE_IDS = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascriptreact',
  '.json': 'json',
  '.jsonc': 'json',
  '.json5': 'json',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdx': 'markdown',
  '.py': 'python',
  '.pyw': 'python',
  '.pyi': 'python',
  '.java': 'java',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',
  '.html': 'html',
  '.htm': 'html',
  '.vue': 'html',
  '.svelte': 'html',
  '.sql': 'sql',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.xml': 'xml',
  '.svg': 'xml',
  '.xsl': 'xml',
  '.xsd': 'xml',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.go': 'go',
  '.rs': 'rust',
}

/**
 * The language id of one file path.
 *
 * A file of an unknown kind is plain text: the workbench shows it, but no
 * language server can serve it.
 *
 * @param {string} path the path of the file
 * @returns {string} the language id, or 'plaintext'
 */
export function languageIdForPath(path) {
  const lower = String(path ?? '').toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return 'plaintext'
  return LANGUAGE_IDS[lower.slice(dot)] ?? 'plaintext'
}
