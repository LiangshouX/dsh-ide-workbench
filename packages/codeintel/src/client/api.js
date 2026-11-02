/**
 * The client transport of the code intelligence plugin.
 *
 * The plugin is autonomous: it owns its language servers, its own settings
 * document (`<profile>/dsh-codeintel/settings.json`) and its own WebSocket
 * relay, so it talks to its OWN host routes and never to the routes of the
 * IDE workbench.
 *
 * The rules of the transport are the ones of the core (PRD-v6 §0.2 of the
 * implementation contract): HTTP rides the page base (`document.baseURI`), so
 * a reverse-proxy prefix and the Desktop shell's `dsh-app://app/` forwarding
 * both work; the WebSocket needs the injected transport origin
 * (`__DSH_TRANSPORT__.streamBaseUrl`), because a custom scheme cannot host
 * `ws:`.
 */

/** The HTTP prefix of the plugin's own host routes. */
export const API_PREFIX = 'dsh-codeintel/api/'

/** The WebSocket route of the language-server relay. */
export const LSP_WS_PATH = 'dsh-codeintel/ws/lsp'

const PLACEHOLDER = 'http://dsh.internal/'

/**
 * The origin of the transport of the host.
 * @returns {string} the base URL, or `''` when the host published none
 */
function transportBase() {
  const injected = globalThis.__DSH_TRANSPORT__?.streamBaseUrl
  if (typeof injected === 'string' && injected !== '') return injected
  if (typeof document !== 'undefined' && typeof document.baseURI === 'string') return document.baseURI
  return ''
}

/**
 * A base URL that always ends with a slash, so a relative path is appended
 * to the DIRECTORY of the base and not to its last segment.
 * @param {string} input the base
 * @returns {string} the directory URL
 */
function directoryBase(input) {
  const url = new URL(input === '' ? PLACEHOLDER : input, PLACEHOLDER)
  url.search = ''
  url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.href
}

/**
 * The absolute HTTP URL of one route of the plugin.
 * @param {string} path the path below the plugin's prefix
 * @returns {URL} the URL
 */
export function httpUrl(path) {
  const base = typeof document !== 'undefined' ? document.baseURI : transportBase()
  return new URL(String(path).replace(/^\/+/, ''), directoryBase(base))
}

/**
 * The absolute WebSocket URL of one route of the plugin.
 * @param {string} path the path below the plugin's prefix
 * @returns {URL} the URL
 */
export function wsUrl(path) {
  const url = new URL(String(path).replace(/^\/+/, ''), directoryBase(transportBase()))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url
}

/** One wire failure carrying the machine code of the host. */
export class ApiError extends Error {
  /**
   * @param {string} code the machine code of the host
   * @param {string} message the message of the host
   */
  constructor(code, message) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

/**
 * Call one host method of the plugin.
 *
 * The method is one of the plugin's own routes (`lsp.*`, `settings.*`); the
 * routes of the IDE workbench are NOT reachable from here - the codeintel
 * reaches the workbench through the contract (PRD-v6 §3.2).
 *
 * @param {string} method the name of the method
 * @param {Record<string, unknown>} [payload] the body of the call
 * @param {AbortSignal} [signal] an optional abort signal
 * @returns {Promise<any>} the value of the answer
 */
export async function call(method, payload = {}, signal) {
  let response
  try {
    response = await fetch(httpUrl(`${API_PREFIX}${method}`).href, {
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
