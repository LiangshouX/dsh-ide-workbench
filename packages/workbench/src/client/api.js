/**
 * Client transport: the plugin's own Host routes.
 *
 * HTTP rides the page base (`document.baseURI`) so a reverse-proxy prefix and
 * the Desktop shell's `dsh-app://app/` forwarding both work; the terminal
 * WebSocket needs the injected transport origin (`__DSH_TRANSPORT__.streamBaseUrl`)
 * because a custom scheme cannot host `ws:`.
 *
 * The JSON route answers the documents of the workspace as text; the binary
 * route (`rawUrl`) answers the bytes of a document that the browser has to
 * parse itself - a PDF is the only one today.
 */

const PLACEHOLDER = 'http://dsh.internal/'

function transportBase() {
  const injected = globalThis.__DSH_TRANSPORT__?.streamBaseUrl
  if (typeof injected === 'string' && injected !== '') return injected
  if (typeof document !== 'undefined' && typeof document.baseURI === 'string') return document.baseURI
  return ''
}

function directoryBase(input) {
  const url = new URL(input === '' ? PLACEHOLDER : input, PLACEHOLDER)
  url.search = ''
  url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.href
}

/** Absolute HTTP URL of one plugin route. */
export function httpUrl(path) {
  const base = typeof document !== 'undefined' ? document.baseURI : transportBase()
  return new URL(String(path).replace(/^\/+/, ''), directoryBase(base))
}

/** Absolute WebSocket URL of one plugin route. */
export function wsUrl(path) {
  const url = new URL(String(path).replace(/^\/+/, ''), directoryBase(transportBase()))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url
}

/**
 * The absolute URL of the raw bytes of one file of the workspace.
 *
 * The binary route of the plugin serves the bytes of a document as bytes:
 * the JSON route answers the metadata of a document only, so a large file
 * never inflates a JSON answer by a third (PRD-v8 PDF-02).
 *
 * @param {string} root the workspace root
 * @param {string} path the workspace-relative path of the file
 * @returns {URL} the absolute URL of the bytes
 */
export function rawUrl(root, path) {
  const url = httpUrl('ide-workbench/raw')
  url.searchParams.set('root', String(root ?? ''))
  url.searchParams.set('path', String(path ?? ''))
  return url
}

/** One wire failure carrying the host's machine code. */
export class ApiError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

/**
 * Call one Host API method.
 * @param {string} method
 * @param {Record<string, unknown>} [payload]
 * @param {AbortSignal} [signal]
 */
export async function call(method, payload = {}, signal) {
  let response
  try {
    response = await fetch(httpUrl(`ide-workbench/api/${method}`).href, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error) {
    // The NAME is the contract of an abort, not its class: an abort that
    // comes from another realm (an iframe) is not a DOMException of this
    // one, and it must not be reported as a network failure.
    if (error !== null && error !== undefined && error.name === 'AbortError') throw error
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  let parsed = null
  try {
    parsed = await response.json()
  } catch {
    throw new ApiError('http', `HTTP ${response.status}`)
  }
  if (!response.ok || parsed === null || parsed.ok !== true) {
    throw new ApiError(parsed?.error?.code ?? 'http', parsed?.error?.message ?? `HTTP ${response.status}`)
  }
  return parsed.value
}
