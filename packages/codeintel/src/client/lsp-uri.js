/**
 * URI and language-id helpers for the client-side LSP session.
 *
 * Why this module exists:
 *
 * - The LSP wire protocol addresses documents by URI, the workbench addresses
 *   them by absolute path. Converting between the two is the single most
 *   error-prone part of the integration (Windows drive letters, UNC shares,
 *   spaces and non-ASCII characters), so it lives in one pure module that can
 *   be tested without a browser.
 * - The `languageId` sent to a language server must be derived from the file
 *   *extension*, never from CodeMirror's `Language.name`. CodeMirror reports
 *   "JavaScript" for `javascript({typescript: true})`, so a TypeScript file
 *   would reach tsserver as `javascript` and every semantic answer would be
 *   wrong. The mapping below is therefore explicit and extension-driven.
 *
 * Everything here is pure: no DOM, no store, no network.
 */

/** Extensions that map onto one LSP language id. */
const LANGUAGE_IDS = new Map(Object.entries({
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascriptreact',
  py: 'python',
  pyw: 'python',
  pyi: 'python',
  yaml: 'yaml',
  yml: 'yaml',
  java: 'java',
  go: 'go',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  html: 'html',
  htm: 'html',
  vue: 'html',
  svelte: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  sql: 'sql',
  xml: 'xml',
  svg: 'xml',
  xsl: 'xml',
  xsd: 'xml',
  md: 'markdown',
  markdown: 'markdown',
}))

/**
 * Percent-encode one character as UTF-8 bytes.
 * @param {string} char a single (possibly multi-byte) code point
 * @returns {string} the percent-encoded form
 */
function utf8Percent(char) {
  let out = ''
  for (const byte of new TextEncoder().encode(char)) {
    out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return out
}

/**
 * Encode one path for a `file:` URI.
 *
 * `encodeURI` is the base (it keeps the path separators and the drive colon
 * readable), but it leaves `?` and `#` alone - those would end the path
 * component - and it keeps non-ASCII characters literal. Both are fixed here.
 * @param {string} path a slash-separated path
 * @returns {string} the encoded path
 */
function encodePath(path) {
  let out
  try {
    out = encodeURI(path)
  } catch {
    // A lone surrogate cannot be encoded; fall back to a byte-wise escape.
    out = path.replace(/[\uD800-\uDFFF]/g, char => utf8Percent(char))
  }
  out = out.replace(/[?#]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  out = out.replace(/[^\x00-\x7F]/gu, char => utf8Percent(char))
  return out
}

/**
 * The `file:` URI of an absolute path.
 *
 * `C:\a\b.ts` becomes `file:///C:/a/b.ts` (forward slashes, the drive colon
 * kept), `/home/u/a.ts` becomes `file:///home/u/a.ts`, and a UNC path
 * `\\server\share\x` becomes `file://server/share/x`.
 * @param {string} absolutePath the absolute path of a file
 * @returns {string} the URI, or `''` for an unusable input
 */
export function fileUriOf(absolutePath) {
  if (typeof absolutePath !== 'string' || absolutePath === '') return ''
  let path = absolutePath.replace(/\\/g, '/')
  let authority = ''
  if (path.startsWith('//')) {
    const rest = path.slice(2)
    const slash = rest.indexOf('/')
    if (slash < 0) {
      authority = rest
      path = '/'
    } else {
      authority = rest.slice(0, slash)
      path = rest.slice(slash)
    }
  }
  if (!path.startsWith('/')) path = `/${path}`
  const host = authority === '' ? '' : encodeURI(authority)
  return `file://${host}${encodePath(path)}`
}

/**
 * The absolute path of a `file:` URI.
 *
 * The inverse of {@link fileUriOf}: `file:///C:/a/b.ts` becomes `C:\a\b.ts`
 * and `file:///home/u/a.ts` becomes `/home/u/a.ts`.
 * @param {string} uri the URI
 * @returns {string | null} the path, or `null` when the URI is not a file URI
 */
export function pathOfFileUri(uri) {
  if (typeof uri !== 'string' || uri === '') return null
  if (!/^file:/i.test(uri)) return null
  let rest = uri.slice(5).replace(/[?#].*$/, '')
  let authority = ''
  if (rest.startsWith('//')) {
    rest = rest.slice(2)
    const slash = rest.indexOf('/')
    if (slash < 0) {
      authority = rest
      rest = ''
    } else {
      authority = rest.slice(0, slash)
      rest = rest.slice(slash)
    }
  }
  let path
  try {
    path = decodeURIComponent(rest)
  } catch {
    path = rest
  }
  if (authority !== '' && authority.toLowerCase() !== 'localhost') {
    return `\\\\${authority}${path.replace(/\//g, '\\')}`
  }
  if (/^\/[A-Za-z]:/.test(path)) {
    return path.slice(1).replace(/\//g, '\\')
  }
  return path
}

/**
 * The LSP language id of a file path.
 *
 * Derived from the extension only - never from CodeMirror's language name -
 * so that `javascript({typescript: true})` still reports `typescript`.
 * @param {string} path the file path
 * @returns {string} the language id, `plaintext` for unknown extensions
 */
export function languageIdForPath(path) {
  if (typeof path !== 'string' || path === '') return 'plaintext'
  const name = path.replace(/\\/g, '/').split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return 'plaintext'
  const ext = name.slice(dot + 1).toLowerCase()
  return LANGUAGE_IDS.get(ext) ?? 'plaintext'
}
