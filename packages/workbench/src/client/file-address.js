/**
 * The DSH file-resource address grammar used by the right Sidebar.
 *
 * `dsh-resource://file/session/<sessionId>/<path>` addresses a file relative
 * to one Session's workspace (an absolute path keeps its leading `/`), and
 * `dsh-resource://file/absolute/<path>` addresses a file by absolute path with
 * the leading `/` dropped. The chat's own file opener always produces the
 * session-scoped form; the absolute form is parsed for legacy/third-party
 * addresses.
 *
 * Kept dependency-free and pure so the bundle stays small and the grammar is
 * unit-testable.
 */

/** The scheme and type every file address opens with. */
export const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'

/**
 * @typedef {{ scope: 'session', sessionId: string, path: string }
 *   | { scope: 'absolute', path: string }} FileAddress
 */

/**
 * Read one file address without resolving `.` or `..`.
 * Query and fragment suffixes are ignored; encoded segments are decoded.
 * @param {string} address
 * @returns {FileAddress | undefined}
 */
export function parseFileAddress(address) {
  if (typeof address !== 'string' || !address.startsWith(FILE_ADDRESS_PREFIX)) return undefined
  try {
    const end = address.search(/[?#]/)
    const body = address.slice(FILE_ADDRESS_PREFIX.length, end === -1 ? undefined : end)
    const [scope, ...rest] = body.split('/')
    if (scope === 'session') {
      const [id, ...segments] = rest
      if (id === undefined || id === '' || segments.length === 0) return undefined
      return { scope, sessionId: decodeURIComponent(id), path: segments.map(decodeURIComponent).join('/') }
    }
    if (scope === 'absolute') {
      // An empty first segment with more behind it is a UNC path's `//`; alone
      // it is no path.
      const unc = rest[0] === '' && rest.length > 1
      const segments = (unc ? rest.slice(1) : rest).map(decodeURIComponent)
      if (segments.length === 0 || segments[0] === '') return undefined
      if (unc) return { scope, path: `//${segments.join('/')}` }
      return { scope, path: /^[A-Za-z]:$/.test(segments[0]) ? segments.join('/') : `/${segments.join('/')}` }
    }
    return undefined
  } catch {
    // `decodeURIComponent` throws URIError on a malformed escape.
    return undefined
  }
}

/** Whether one string looks like a file resource address. */
export function isFileAddress(address) {
  return typeof address === 'string' && address.startsWith(FILE_ADDRESS_PREFIX)
}

/** The decoded file name of one address (the tab chip title). */
export function basenameOfFileAddress(address) {
  const parsed = parseFileAddress(address)
  if (parsed === undefined) return undefined
  const parts = parsed.path.split('/').filter(part => part !== '')
  return parts.length === 0 ? undefined : parts[parts.length - 1]
}

/** Whether a decoded path is absolute in either spelling the host accepts. */
function isAbsoluteFilePath(path) {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')
}

/**
 * Normalize one path for the workbench: backslashes become the platform
 * separator of `cwd`, `.`/`..` are resolved, duplicate separators collapse.
 * @param {string} input
 * @param {string} [cwd] used only to choose the separator style
 */
function normalizeFilePath(input, cwd) {
  const separator = typeof cwd === 'string' && cwd.includes('\\') ? '\\' : '/'
  let value = String(input).replace(/\\/g, '/')
  let prefix = ''
  if (value.startsWith('//')) {
    prefix = '//'
    value = value.slice(2)
  } else if (/^[A-Za-z]:\//.test(value)) {
    prefix = value.slice(0, 2)
    value = value.slice(2).replace(/^\/+/, '')
  } else if (value.startsWith('/')) {
    prefix = '/'
    value = value.slice(1)
  }
  const parts = []
  for (const part of value.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length > 0) parts.pop()
      continue
    }
    parts.push(part)
  }
  const joined = parts.join(separator)
  if (prefix === '//') return joined === '' ? `${separator}${separator}` : `${separator}${separator}${joined}`
  if (prefix === '/') return joined === '' ? separator : `${separator}${joined}`
  if (prefix !== '') return joined === '' ? `${prefix}${separator}` : `${prefix}${separator}${joined}`
  return joined
}

/**
 * Resolve one parsed address to an absolute, native-separator path.
 * @param {FileAddress | undefined} parsed
 * @param {string} [cwd] the Session workspace that resolves a relative path
 * @returns {string | undefined}
 */
export function resolveFileAddress(parsed, cwd) {
  if (parsed === undefined || parsed === null) return undefined
  if (parsed.scope === 'absolute') return normalizeFilePath(parsed.path, cwd)
  const path = parsed.path
  if (typeof path !== 'string' || path === '') return undefined
  if (isAbsoluteFilePath(path)) return normalizeFilePath(path, cwd)
  if (typeof cwd !== 'string' || cwd === '') return undefined
  return normalizeFilePath(`${cwd.replace(/[\\/]+$/, '')}/${path}`, cwd)
}

/**
 * The maximum number of fallback candidates one ambiguous link may try.
 * A bounded list keeps the stat probes of PRD-v4 §7.8 risk 5 finite.
 */
const MAX_LINK_CANDIDATES = 3

/** Whether one path is a drive-letter absolute path (`C:/…` or `C:\…`). */
function isDriveAbsolutePath(path) {
  return /^[A-Za-z]:[\\/]/.test(path)
}

/** Whether one path is a UNC path (`\\server\share`). */
function isUncPath(path) {
  return path.startsWith('\\\\')
}

/**
 * One path in comparison form: `/` separators, no repeated or trailing
 * separator, Windows paths folded to lower case.
 *
 * Mirrors `normalizeScopePath` in `workspace-scope.js`; it is repeated here
 * so this module keeps its dependency-free, standalone grammar.
 * @param {unknown} path
 * @returns {string}
 */
function comparablePath(path) {
  if (typeof path !== 'string' || path === '') return ''
  const slashed = path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '')
  const windows = /^[A-Za-z]:\//.test(slashed) || slashed.startsWith('//')
  return windows ? slashed.toLowerCase() : slashed
}

/**
 * Whether one path lives inside one root.
 * @param {unknown} root the containing directory
 * @param {unknown} path the candidate file or directory
 * @returns {boolean} false when either path is empty
 */
function isWithinRoot(root, path) {
  const parent = comparablePath(root)
  if (parent === '') return false
  const candidate = comparablePath(path)
  return candidate === parent || candidate.startsWith(`${parent}/`)
}

/**
 * Whether one link path needs the relative fallback.
 *
 * A path with exactly one leading slash is ambiguous: on Windows it is a
 * relative path with a redundant slash (every real absolute path there
 * carries a drive letter or a UNC prefix), but on POSIX it may still be a
 * genuine absolute path. The predicate therefore reports the shape alone
 * unless a workspace root is given: with one, a path that already lands
 * inside the workspace is never ambiguous, so the absolute interpretation
 * wins there (PRD-v4 §7.8 risk 2).
 *
 * @param {string} path the link path
 * @param {string} [workspaceRoot] the DSH workspace root, when known
 * @returns {boolean}
 */
export function isAmbiguousLinkPath(path, workspaceRoot) {
  if (typeof path !== 'string' || path === '') return false
  if (isDriveAbsolutePath(path) || isUncPath(path)) return false
  const slashed = path.replace(/\\/g, '/')
  if (!slashed.startsWith('/') || slashed.startsWith('//')) return false
  if (typeof workspaceRoot === 'string' && workspaceRoot !== '') {
    return !isWithinRoot(workspaceRoot, slashed)
  }
  return true
}

/**
 * The fallback candidates for one chat file link, each split into the base
 * it was built from and the path relative to that base.
 *
 * The host's file routes take `{ root, path }` (the root is canonicalized,
 * the path is resolved inside it), so the caller needs the pair and not
 * only the joined string.
 *
 * @param {string} path the link path, either separator
 * @param {string[]} bases the candidate bases, most specific first
 * @returns {{ base: string, rel: string, absolute: string }[]} at most 3 entries
 */
export function relativeLinkCandidateEntries(path, bases) {
  if (typeof path !== 'string' || path === '') return []
  if (isDriveAbsolutePath(path) || isUncPath(path)) return []
  const slashed = path.replace(/\\/g, '/')
  if (slashed.startsWith('//')) return []
  // One leading slash is a redundant slash in front of a relative path; a
  // plain relative path is used as it is.
  const rel = slashed.startsWith('/') ? slashed.slice(1) : slashed
  if (rel === '') return []
  const list = Array.isArray(bases) ? bases : []
  const entries = []
  const seen = new Set()
  for (const base of list) {
    if (typeof base !== 'string' || base === '') continue
    const trimmed = base.replace(/[\\/]+$/, '')
    if (trimmed === '') continue
    // Normalizing resolves `.`/`..`, so a path that escapes its base shows
    // up as a candidate outside that base instead of one that only looks
    // contained.
    const absolute = normalizeFilePath(`${trimmed}/${rel}`, trimmed)
    const key = comparablePath(absolute)
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({ base: trimmed, rel, absolute })
    if (entries.length >= MAX_LINK_CANDIDATES) break
  }
  return entries
}

/**
 * The fallback candidates for one chat file link.
 *
 * A chat link may address a file relative to one of the workspace bases
 * without saying which one. This resolver is pure: it classifies the link
 * path and joins the bases in the given order, so the caller can try the
 * candidates one by one and keep the first that exists on disk.
 *
 * Rules (PRD-v4 §7.6.1):
 * - a drive-letter absolute path (`C:/…`) or a UNC path (`\\server\share`)
 *   is unambiguous → no candidates;
 * - a path with exactly one leading slash is a relative path with a
 *   redundant slash → the base is joined with the path as it is;
 * - any other relative path is joined to the base with one `/`.
 *
 * The candidates are normalized, so the caller can fence them with
 * `isPathWithin` without a second normalization pass. The absolute
 * interpretation is not part of this list: on POSIX it must be tried first
 * and only dropped when it lands outside the workspace.
 *
 * @param {string} path the link path, either separator
 * @param {string[]} bases the candidate bases, most specific first
 * @returns {string[]} at most 3 distinct candidate paths
 */
export function relativeLinkCandidates(path, bases) {
  return relativeLinkCandidateEntries(path, bases).map(entry => entry.absolute)
}

/** Office/PDF/archive/binary formats the IDE should leave to the sidebar. */
const NON_IDE_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.odt', '.ods', '.odp', '.rtf', '.epub',
  '.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.bz2', '.xz',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.iso', '.jar', '.class', '.wasm',
])

/**
 * Whether the IDE can render this file address. Text, Markdown and images are
 * claimed; Office documents, PDFs, archives and obvious binaries keep the
 * product's own preview.
 */
export function isIdeViewableAddress(address) {
  const name = basenameOfFileAddress(address)
  if (name === undefined) return false
  const dot = name.lastIndexOf('.')
  if (dot < 0) return true
  return !NON_IDE_EXTENSIONS.has(name.slice(dot).toLowerCase())
}

/** Component-encode one id or path segment, keeping `:` literal for drive letters. */
function encodeSegment(segment) {
  return encodeURIComponent(segment).replace(/%3A/gi, ':')
}

/** Encode a `/`-separated path segment by segment. */
function encodePath(path) {
  return path.split('/').map(encodeSegment).join('/')
}

/**
 * Build the session-scoped address for one file path.
 * @param {string} sessionId
 * @param {string} path absolute or session-relative, either separator
 * @returns {string}
 */
export function sessionFileAddress(sessionId, path) {
  const normalized = String(path).replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
  return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(String(sessionId))}/${encodePath(normalized)}`
}

/**
 * Build the session-scoped address DSH uses for a path as a caller holds it.
 *
 * A relative path, or an absolute path inside the session's workspace, becomes
 * the relative spelling; an absolute path outside it keeps its absolute
 * spelling inside the session scope.
 * @param {string} sessionId
 * @param {string | undefined} cwd the session workspace root
 * @param {string} path
 * @returns {string}
 */
export function fileAddressFor(sessionId, cwd, path) {
  const normalized = String(path).replace(/\\/g, '/')
  if (!isAbsoluteFilePath(normalized)) return sessionFileAddress(sessionId, normalized)
  const root = typeof cwd === 'string' ? cwd.replace(/\\/g, '/').replace(/\/+$/, '') : ''
  if (root !== '' && normalized === root) return sessionFileAddress(sessionId, '')
  if (root !== '' && normalized.startsWith(`${root}/`)) return sessionFileAddress(sessionId, normalized.slice(root.length + 1))
  return sessionFileAddress(sessionId, normalized)
}

/**
 * Build a `file://` URL the OS default browser can open.
 * @param {string} path absolute native path
 * @returns {string}
 */
export function fileUrlForPath(path) {
  const normalized = String(path).replace(/\\/g, '/')
  const encoded = normalized.split('/').map(segment => encodeURIComponent(segment).replace(/%3A/gi, ':')).join('/')
  if (/^[A-Za-z]:\//.test(normalized)) return `file:///${encoded}`
  if (normalized.startsWith('//')) return `file:${encoded}`
  return `file://${encoded}`
}
