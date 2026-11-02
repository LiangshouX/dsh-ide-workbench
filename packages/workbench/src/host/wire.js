/**
 * Wire helpers for the /ide-workbench JSON API.
 *
 * Every method answers `{ ok: true, value }` or `{ ok: false, error: { code, message } }`.
 * The shape mirrors what the shipped DSH plugins use, so the client has one
 * response reader for every route.
 */

/** One API failure carrying its machine code and HTTP status. */
export class ApiError extends Error {
  /**
   * @param {string} code machine-readable code
   * @param {string} message human-readable message (shown in the UI)
   * @param {number} [status] HTTP status
   */
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

const MAX_BODY_BYTES = 8 << 20

/**
 * Read and parse one JSON request body (bounded).
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new ApiError('bad-request', 'request body too large', 413)
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ApiError('bad-request', 'request body must be a JSON object')
    }
    return parsed
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError('bad-request', 'request body is not valid JSON')
  }
}

/** Write one JSON response (headers-sent safe). */
export function writeJson(res, status, body) {
  if (res.headersSent) {
    res.destroy?.()
    return
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** Write a success envelope. */
export function writeOk(res, value) {
  writeJson(res, 200, { ok: true, value })
}

/** Write the failure envelope for any thrown value. */
export function writeError(res, error) {
  if (error instanceof ApiError) {
    writeJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } })
    return
  }
  // A git failure is a state/input problem the user caused (unknown ref, path
  // outside the repository, not a repository), not a plugin fault. Report it
  // with the git error code so the UI can show the command's own stderr.
  if (error?.name === 'GitError') {
    const notRepo = /not a git repository/i.test(error.message ?? '')
    writeJson(res, notRepo ? 409 : 400, {
      ok: false,
      error: { code: notRepo ? 'not-repo' : 'git-error', message: error.message },
    })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  writeJson(res, 500, { ok: false, error: { code: 'internal', message } })
}

/**
 * Narrow one payload field to a string.
 * @param {unknown} payload request body
 * @param {string} key field name
 * @param {{ allowEmpty?: boolean }} [options] an editor buffer may be empty
 */
export function requireString(payload, key, options = {}) {
  const value = payload?.[key]
  if (typeof value !== 'string' || (value === '' && options.allowEmpty !== true)) {
    throw new ApiError('bad-request', `missing or invalid "${key}"`)
  }
  return value
}

/** Narrow one payload field to a string array (default: empty array). */
export function stringArray(payload, key) {
  const value = payload?.[key]
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new ApiError('bad-request', `invalid "${key}"`)
  }
  return value
}

/** Narrow one optional boolean. */
export function optionalBoolean(payload, key, fallback = false) {
  const value = payload?.[key]
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new ApiError('bad-request', `invalid "${key}"`)
  return value
}

/** Narrow one optional integer. */
export function optionalInteger(payload, key, fallback) {
  const value = payload?.[key]
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value)) throw new ApiError('bad-request', `invalid "${key}"`)
  return value
}
