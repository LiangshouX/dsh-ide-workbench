/**
 * Client transport: the plugin's own Host routes.
 *
 * HTTP rides the page base (`document.baseURI`) so a reverse-proxy prefix and
 * the Desktop shell's `dsh-app://app/` forwarding both work; the terminal
 * WebSocket needs the injected transport origin (`__DSH_TRANSPORT__.streamBaseUrl`)
 * because a custom scheme cannot host `ws:`.
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
    if (error instanceof DOMException && error.name === 'AbortError') throw error
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
