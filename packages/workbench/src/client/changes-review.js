/**
 * The review of the changes of one chat turn.
 *
 * A turn that changed files ends with a link to its review:
 * `dsh-resource://changes-review/session/<sessionId>/<seq>/<turn>`. The host
 * opens that address through `openResource(address, { params: { index } })`,
 * where the index is the position of the changed file in the list of the
 * turn - the review has to open on THAT file, not on the first one.
 *
 * The data of a turn lives in the host, not in the plugin: the host serves
 * `/api/changes.summary` and `/api/changes.diff` on its own origin, and the
 * documents are STRUCTURED hunks - not a unified diff text. The client reads
 * them from the host's own origin first and falls back to the plugin's own
 * route, which proxies the same path inside the host process. When neither
 * path answers, the review degrades to DSH's own sidebar with a readable
 * message: there is no hard failure and no blank pane.
 *
 * The diff itself is drawn by the diff viewer of the workbench: the hunks are
 * adapted to the row model of `diff.js`, so the turn review and the git diff
 * read ONE model instead of two implementations.
 *
 * The module is pure on purpose - the grammar, the readers of the host's
 * documents and the probe that reads them - so it can be unit tested without
 * a browser. The view that draws them lives in the client entry.
 */
import { call, httpUrl } from './api.js'
import { isPathWithin } from './workspace-scope.js'

/** The scheme and the type every turn review opens with. */
export const CHANGES_REVIEW_PREFIX = 'dsh-resource://changes-review/'

/**
 * @typedef {{ sessionId: string, seq: string, turn: string }} ChangesReviewAddress
 *   the coordinates of one turn of one session
 */

/**
 * Read one turn review address without resolving `.` or `..`.
 *
 * Query and fragment suffixes are ignored; encoded segments are decoded.
 * @param {string} address
 * @returns {ChangesReviewAddress | undefined}
 */
export function parseChangesReviewAddress(address) {
  if (typeof address !== 'string' || !address.startsWith(CHANGES_REVIEW_PREFIX)) return undefined
  try {
    const end = address.search(/[?#]/)
    const body = address.slice(CHANGES_REVIEW_PREFIX.length, end === -1 ? undefined : end)
    const [scope, id, seq, turn, ...rest] = body.split('/')
    if (scope !== 'session') return undefined
    if (id === undefined || id === '' || seq === undefined || seq === '' || turn === undefined || turn === '') {
      return undefined
    }
    if (rest.length > 0) return undefined
    return {
      sessionId: decodeURIComponent(id),
      seq: decodeURIComponent(seq),
      turn: decodeURIComponent(turn),
    }
  } catch {
    // `decodeURIComponent` throws URIError on a malformed escape.
    return undefined
  }
}

/** Whether one string looks like a turn review address. */
export function isChangesReviewAddress(address) {
  return typeof address === 'string' && address.startsWith(CHANGES_REVIEW_PREFIX)
}

/**
 * Build the address of one turn review.
 * @param {string} sessionId
 * @param {string | number} seq
 * @param {string | number} turn
 * @returns {string}
 */
export function changesReviewAddress(sessionId, seq, turn) {
  const segment = value => encodeURIComponent(String(value))
  return `${CHANGES_REVIEW_PREFIX}session/${segment(sessionId)}/${segment(seq)}/${segment(turn)}`
}

/** A finite number, or the fallback. */
function numberOf(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

/** The file name of a path, in either separator. */
function baseNameOf(path) {
  const parts = String(path ?? '').replace(/\\/g, '/').split('/').filter(part => part !== '')
  return parts.length === 0 ? '' : parts[parts.length - 1]
}

/**
 * The file list of one turn.
 *
 * The host answers `{ turn, files: [{ path, display, added, deleted, binary?,
 * oversized? }], total, added, deleted }`. The reader is strict on purpose: a
 * document that is not a summary is a failed path of the probe, not an empty
 * turn.
 *
 * @param {unknown} payload
 * @returns {{ turn: unknown, files: object[], total: number, added: number, deleted: number } | undefined}
 */
export function readReviewSummary(payload) {
  if (payload === null || typeof payload !== 'object') return undefined
  if (!Array.isArray(payload.files)) return undefined
  const files = payload.files.map((entry, index) => {
    const source = entry !== null && typeof entry === 'object' ? entry : {}
    const path = typeof source.path === 'string' ? source.path : ''
    const display = typeof source.display === 'string' && source.display !== '' ? source.display : baseNameOf(path)
    return {
      index,
      path,
      display,
      added: numberOf(source.added),
      deleted: numberOf(source.deleted),
      binary: source.binary === true,
      oversized: source.oversized === true,
    }
  })
  return {
    turn: payload.turn,
    files,
    total: numberOf(payload.total, files.length),
    added: numberOf(payload.added, files.reduce((sum, file) => sum + file.added, 0)),
    deleted: numberOf(payload.deleted, files.reduce((sum, file) => sum + file.deleted, 0)),
  }
}

/**
 * The diff of one changed file.
 *
 * The host answers `{ kind: 'text' | 'binary' | 'oversized', path, display,
 * before, after, coarse, hunks: [...] }`. A binary or an oversized file has
 * no hunks: the reader keeps the kind, so the view can say what it is
 * instead of showing nothing.
 *
 * @param {unknown} payload
 * @returns {{ kind: string, path: string, display: string, before: string, after: string, coarse: boolean, hunks: object[] } | undefined}
 */
export function readReviewDiff(payload) {
  if (payload === null || typeof payload !== 'object') return undefined
  if (typeof payload.kind !== 'string' || payload.kind === '') return undefined
  return {
    kind: payload.kind,
    path: typeof payload.path === 'string' ? payload.path : '',
    display: typeof payload.display === 'string' ? payload.display : '',
    before: typeof payload.before === 'string' ? payload.before : '',
    after: typeof payload.after === 'string' ? payload.after : '',
    coarse: payload.coarse === true,
    hunks: Array.isArray(payload.hunks) ? payload.hunks : [],
  }
}

/**
 * The position of the file the link points at.
 *
 * `params.index` is the index of the changed file in the list of the turn. A
 * link without an index, or with one that points past the end of the list,
 * opens the first file - never nothing.
 *
 * @param {number} count the number of changed files
 * @param {unknown} index the index of the link
 * @returns {number}
 */
export function reviewIndexOf(count, index) {
  const total = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
  if (total === 0) return 0
  const wanted = Number(index)
  if (!Number.isFinite(wanted)) return 0
  const position = Math.trunc(wanted)
  if (position < 0) return 0
  return position < total ? position : total - 1
}

/**
 * Whether one changed file lives outside the DSH workspace.
 *
 * A turn may touch a file outside the workspace (the model wrote an absolute
 * path somewhere else). Such a file is shown read-only: the workbench never
 * opens it in an editor, and the review says so.
 *
 * @param {string} path the path of the changed file
 * @param {string} workspaceRoot the DSH workspace root
 * @returns {boolean}
 */
export function isOutsideWorkspace(path, workspaceRoot) {
  if (typeof path !== 'string' || path === '') return false
  if (typeof workspaceRoot !== 'string' || workspaceRoot === '') return false
  const slashed = path.replace(/\\/g, '/')
  const absolute = /^[A-Za-z]:\//.test(slashed) || slashed.startsWith('//') || slashed.startsWith('/')
  if (!absolute) return false
  return !isPathWithin(workspaceRoot, path)
}

/**
 * The query the host's review endpoints take.
 * @param {ChangesReviewAddress} parsed the coordinates of the turn
 * @param {Record<string, unknown>} [extra] the parameters of the document
 * @returns {string}
 */
export function reviewQuery(parsed, extra = {}) {
  const query = new URLSearchParams()
  query.set('sessionId', String(parsed?.sessionId ?? ''))
  query.set('seq', String(parsed?.seq ?? ''))
  query.set('turn', String(parsed?.turn ?? ''))
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value === undefined || value === null || value === '') continue
    query.set(key, String(value))
  }
  return query.toString()
}

/**
 * The document of an envelope, or the document itself.
 *
 * The host answers either the bare document or the `{ ok, value }` envelope
 * of the plugin's own protocol.
 * @param {unknown} value
 * @returns {unknown}
 */
function unwrapDocument(value) {
  if (value === null || typeof value !== 'object') return undefined
  if (value.ok === true && value.value !== undefined) return value.value
  return value
}

/**
 * Read one document of the host's review API.
 *
 * Two paths are tried, in this order:
 *  1. the host's own origin - the client reaches `/api/changes.…` directly;
 *  2. the plugin's own route, which proxies the same path inside the host
 *     process (for a host whose routes the client cannot reach).
 *
 * A path that does not answer with the expected document is a failed path:
 * the probe moves on, and the caller degrades to DSH's own sidebar. Only when
 * BOTH paths are gone is the turn reported as expired - a host without the
 * route answers 404 as well, and that is an unreachable host, not an expired
 * turn.
 *
 * @param {'summary' | 'diff'} kind the document to read
 * @param {ChangesReviewAddress} parsed the coordinates of the turn
 * @param {{ read: (payload: unknown) => unknown, params?: Record<string, unknown>, fetch?: Function }} options
 * @returns {Promise<{ ok: boolean, document?: unknown, reason?: 'expired' | 'unreachable' }>}
 */
export async function fetchReviewDocument(kind, parsed, options = {}) {
  const read = typeof options.read === 'function' ? options.read : () => undefined
  const fetchImpl = options.fetch ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch : undefined)
  const query = reviewQuery(parsed, options.params)
  let expired = false
  if (fetchImpl !== undefined) {
    try {
      const url = `${httpUrl(`api/changes.${kind}`).href}?${query}`
      const response = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' } })
      if (response?.ok === true) {
        const document = read(unwrapDocument(await response.json()))
        if (document !== undefined) return { ok: true, document }
      } else if (response?.status === 404 || response?.status === 410) {
        // The route may be missing on this host - the proxy gets its turn
        // before the turn is called expired.
        expired = true
      }
    } catch {
      // The host's route is not reachable from here: the proxy gets its turn.
    }
  }
  try {
    const payload = { sessionId: parsed?.sessionId, seq: parsed?.seq, turn: parsed?.turn, ...(options.params ?? {}) }
    const document = read(unwrapDocument(await call(`changes.${kind}`, payload)))
    if (document !== undefined) return { ok: true, document }
  } catch (error) {
    if (error?.code === 'not-found') expired = true
  }
  return { ok: false, reason: expired ? 'expired' : 'unreachable' }
}

/**
 * The message the review shows for one state.
 *
 * A review that cannot be shown says why: the turn is gone, the host does
 * not answer, the file is binary or it is too large. The key is empty when
 * the diff itself is shown - the one case in which nothing is said.
 *
 * @param {{ phase?: string, diffPhase?: string, reason?: string, diff?: { kind?: string } | null }} state
 * @returns {string} the i18n key of the message, '' when the diff is shown
 */
export function reviewMessageKey(state) {
  const expired = state?.reason === 'expired'
  if (state?.phase === 'loading') return 'common.loading'
  if (state?.phase === 'failed') return expired ? 'changesReview.expired' : 'changesReview.loadFailed'
  if (state?.diffPhase === 'loading') return 'common.loading'
  if (state?.diffPhase === 'idle') return 'common.loading'
  if (state?.diffPhase === 'failed') return expired ? 'changesReview.expired' : 'changesReview.loadFailed'
  if (state?.diff?.kind === 'binary') return 'changesReview.binary'
  if (state?.diff?.kind === 'oversized') return 'changesReview.oversized'
  return ''
}

/**
 * The file list of one turn.
 * @param {ChangesReviewAddress} parsed the coordinates of the turn
 * @param {{ params?: Record<string, unknown>, fetch?: Function }} [options]
 * @returns {Promise<{ ok: boolean, document?: object, reason?: string }>}
 */
export function fetchReviewSummary(parsed, options = {}) {
  return fetchReviewDocument('summary', parsed, { ...options, read: readReviewSummary })
}

/**
 * The diff of one changed file.
 * @param {ChangesReviewAddress} parsed the coordinates of the turn
 * @param {{ params?: Record<string, unknown>, fetch?: Function }} [options]
 * @returns {Promise<{ ok: boolean, document?: object, reason?: string }>}
 */
export function fetchReviewDiff(parsed, options = {}) {
  return fetchReviewDocument('diff', parsed, { ...options, read: readReviewDiff })
}

