/**
 * The LSP frame worker.
 *
 * The host main thread owns the language server process (it has to: the
 * `ctx.subprocess` service only exists there), but the main thread must not
 * parse LSP payloads — a single large response costs the host's event loop
 * hundreds of milliseconds (PRD §3.3, risk #3: 412 ms → 8 ms). This worker
 * therefore owns every byte-level concern:
 *
 *   - it turns the server's stdout stream into complete JSON-RPC payloads
 *     (the `Content-Length` framing of the LSP base protocol), and
 *   - it turns the browser's bare JSON payloads into framed bytes for the
 *     server's stdin.
 *
 * The main thread only ever moves `Buffer`s around. It never parses.
 *
 * Message protocol
 *
 *   host → worker
 *     { type: 'stdout', data: Uint8Array }   raw bytes read from the server
 *     { type: 'send', text: string, origin?: 'client' | 'host' }
 *                                             one JSON-RPC payload to write
 *     { type: 'shutdown' }                    stop the worker
 *
 *   worker → host
 *     { type: 'message', text: string }       one complete JSON-RPC payload
 *     { type: 'stdin', data: Uint8Array }     framed bytes for the server
 *     { type: 'document', action, uri, ... }  document lifecycle bookkeeping
 *     { type: 'dropped', reason: string }     a payload that was not JSON
 *
 * Two responsibilities beyond framing exist because the host needs them and
 * cannot compute them without parsing:
 *
 *  1. `textDocument/didOpen` / `didClose` / `didChange` are tracked so the
 *     host can close every open document when an index is cancelled and can
 *     re-open them after a crash restart.
 *  2. The `initialize` request gets `initializationOptions.maxTsServerMemory`
 *     injected, because `typescript-language-server` turns that value into
 *     tsserver's `--max-old-space-size` — without it tsserver grows until the
 *     machine swaps (PRD risk #2: measured 4,225 MB, then exit 134).
 *
 * Both happen here, in the thread that is allowed to look at payloads.
 */
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import { encodeFrame, FrameDecoder } from './lsp-frame.js'

export { encodeFrame, FrameDecoder }

/**
 * View one value as bytes.
 * @param {unknown} value
 * @returns {Buffer}
 */
function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  return Buffer.from(String(value ?? ''), 'utf8')
}

/**
 * Whether one payload looks like a JSON-RPC message.
 * @param {string} text
 * @returns {boolean}
 */
function isJsonPayload(text) {
  const trimmed = text.trim()
  return trimmed.startsWith('{') && trimmed.endsWith('}')
}

/**
 * Read the method name out of a payload without keeping the parsed object.
 * @param {unknown} parsed
 * @returns {string | null}
 */
function methodOf(parsed) {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const method = parsed.method
  return typeof method === 'string' ? method : null
}

/**
 * Add the tsserver memory ceiling to the `initialize` request.
 *
 * `typescript-language-server` reads `initializationOptions.maxTsServerMemory`
 * and turns it into tsserver's `--max-old-space-size` flag; no other channel
 * reaches the tsserver process. Every other language server either has its
 * own mechanism or none at all, and the host reports that in the settings
 * page instead of pretending the limit is in effect.
 * @param {string} text the payload
 * @param {number | null} memoryLimitMB the ceiling in megabytes
 * @returns {string} the payload to forward
 */
function withMemoryLimit(text, memoryLimitMB) {
  if (memoryLimitMB === null) return text
  if (!/"method"\s*:\s*"initialize"/.test(text)) return text
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return text
  }
  if (methodOf(parsed) !== 'initialize') return text
  const params = parsed.params !== null && typeof parsed.params === 'object' ? parsed.params : {}
  const options = params.initializationOptions !== null && typeof params.initializationOptions === 'object'
    ? params.initializationOptions
    : {}
  parsed.params = { ...params, initializationOptions: { ...options, maxTsServerMemory: memoryLimitMB } }
  return JSON.stringify(parsed)
}

/**
 * Read the request id of a JSON-RPC request.
 * @param {unknown} parsed
 * @returns {number | string | null}
 */
function idOf(parsed) {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const id = parsed.id
  if (typeof id === 'number' || typeof id === 'string') return id
  return null
}

/**
 * Describe one document lifecycle notification.
 * @param {string} text the payload
 * @returns {{ type: 'document', action: string, uri: string, languageId?: string, version?: number, text?: string } | null}
 */function documentEvent(text) {
  if (!/"method"\s*:\s*"textDocument\/did(Open|Close|Change)"/.test(text)) return null
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const method = methodOf(parsed)
  if (method === null) return null
  const params = parsed.params !== null && typeof parsed.params === 'object' ? parsed.params : {}
  const document = params.textDocument !== null && typeof params.textDocument === 'object' ? params.textDocument : {}
  const uri = typeof document.uri === 'string' ? document.uri : ''
  if (uri === '') return null
  if (method === 'textDocument/didClose') {
    return { type: 'document', action: 'close', uri }
  }
  if (method === 'textDocument/didOpen') {
    return {
      type: 'document',
      action: 'open',
      uri,
      languageId: typeof document.languageId === 'string' ? document.languageId : undefined,
      version: Number.isFinite(document.version) ? document.version : undefined,
      text: typeof document.text === 'string' ? document.text : undefined,
    }
  }
  // textDocument/didChange: only a full-document change carries the new text.
  const changes = Array.isArray(params.contentChanges) ? params.contentChanges : []
  const last = changes.length > 0 ? changes[changes.length - 1] : null
  const full = last !== null && typeof last === 'object' && last.range === undefined && typeof last.text === 'string'
  return {
    type: 'document',
    action: 'change',
    uri,
    version: Number.isFinite(document.version) ? document.version : undefined,
    text: full ? last.text : undefined,
  }
}

/**
 * The handshake cache of one language server.
 *
 * A language server is initialized exactly once per process, but a browser
 * may reconnect: the WebSocket drops, the transport reconnects and the client
 * sends a second `initialize`. Forwarding that request would be a protocol
 * violation (and `typescript-language-server` would answer with an error), so
 * the worker answers it from the capabilities of the running server.
 *
 * The class is exported so the behaviour can be tested without a worker.
 */
export class Handshake {
  constructor() {
    /** The capabilities of the server, once it has answered. */
    this.result = null
    /** The id of the `initialize` request that was forwarded to the server. */
    this.requestId = null
    /**
     * The ids of the handshakes that were absorbed instead of forwarded.
     *
     * A client may ask for a handshake twice (a reconnect while the server
     * is still answering the first one). Only the first request reaches the
     * server; the others are answered from the cache as soon as it is known.
     */
    this.duplicates = []
  }

  /**
   * Parse one payload, or return null when it is not a JSON object.
   * @param {string} text
   * @returns {any}
   */
  static parse(text) {
    try {
      const parsed = JSON.parse(text)
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  /**
   * Remember a payload that was forwarded to the server.
   *
   * Only the *first* handshake is forwarded: a language server is
   * initialized once per process, and a second `initialize` would be a
   * protocol violation.
   * @param {string} text the payload
   * @returns {boolean} true when the payload was the `initialize` request
   */
  noteForwarded(text) {
    if (!/"method"\s*:\s*"initialize"/.test(text)) return false
    const parsed = Handshake.parse(text)
    if (parsed === null || methodOf(parsed) !== 'initialize') return false
    const id = idOf(parsed)
    if (this.requestId !== null) {
      // A second handshake: remember it, but do not forward it.
      if (id !== null && !this.duplicates.includes(id)) this.duplicates.push(id)
      return false
    }
    this.requestId = id
    return true
  }

  /**
   * The answers for the handshakes that were absorbed.
   *
   * They are only available once the server has answered the first one:
   * the capabilities are what the client is waiting for.
   * @returns {string[]} the JSON-RPC responses
   */
  takePendingAnswers() {
    if (this.result === null || this.duplicates.length === 0) return []
    const ids = this.duplicates.splice(0, this.duplicates.length)
    return ids.map(id => JSON.stringify({ jsonrpc: '2.0', id, result: this.result }))
  }

  /**
   * Remember a payload that came from the server.
   * @param {string} text the payload
   * @returns {boolean} true when the payload was the initialize response
   */
  noteServerPayload(text) {
    if (this.result !== null) return false
    // The cheap substring test keeps the parse off the path of ordinary
    // traffic: only the initialize response carries capabilities.
    if (!text.includes('"capabilities"')) return false
    const parsed = Handshake.parse(text)
    if (parsed === null) return false
    if (idOf(parsed) !== this.requestId) return false
    if (parsed.result === undefined || parsed.result === null) return false
    this.result = parsed.result
    return true
  }

  /**
   * The answer for a client that asks for a handshake again.
   * @param {string} text the client payload
   * @returns {string | null} the JSON-RPC response, or null when the request
   *   has to be forwarded to the server
   */
  answerFor(text) {
    if (this.result === null) return null
    if (!/"method"\s*:\s*"initialize"/.test(text)) return null
    const parsed = Handshake.parse(text)
    if (parsed === null || methodOf(parsed) !== 'initialize') return null
    const id = idOf(parsed)
    if (id === null) return null
    return JSON.stringify({ jsonrpc: '2.0', id, result: this.result })
  }
}

/**
 * Start the worker loop.
 * @param {{ memoryLimitMB?: number, injectMemoryLimit?: boolean }} options
 */
function run(options) {
  const decoder = new FrameDecoder()
  const injectMemoryLimit = options.injectMemoryLimit === true
  const memoryLimitMB = Number.isFinite(options.memoryLimitMB) ? options.memoryLimitMB : null
  const handshake = new Handshake()

  parentPort.on('message', (message) => {
    if (message === null || typeof message !== 'object') return
    if (message.type === 'stdout') {
      for (const payload of decoder.push(toBuffer(message.data))) {
        handshake.noteServerPayload(payload)
        parentPort.postMessage({ type: 'message', text: payload })
        // A client that asked for a handshake twice is waiting for the second
        // answer; it comes from the cached capabilities.
        for (const answer of handshake.takePendingAnswers()) {
          parentPort.postMessage({ type: 'message', text: answer })
        }
      }
      return
    }
    if (message.type === 'send') {
      const text = typeof message.text === 'string' ? message.text : ''
      if (text === '') return
      // The host's own notifications (didOpen/didClose written by the host)
      // must not be mistaken for client traffic.
      if (message.origin !== 'host') {
        if (!isJsonPayload(text)) {
          parentPort.postMessage({ type: 'dropped', reason: 'not a JSON object' })
          return
        }
        const event = documentEvent(text)
        if (event !== null) parentPort.postMessage(event)
        // A second handshake is answered from the cache: the server has been
        // initialized once and must not see a second `initialize`.
        const answer = handshake.answerFor(text)
        if (answer !== null) {
          parentPort.postMessage({ type: 'message', text: answer })
          return
        }
      }
      const payload = message.origin === 'host' ? text : withMemoryLimit(text, injectMemoryLimit ? memoryLimitMB : null)
      if (message.origin !== 'host' && handshake.noteForwarded(payload)) {
        // The host keeps the handshake: a language server that is restarted
        // after a crash has to be initialized again, and the browser sends its
        // handshake only once.
        parentPort.postMessage({ type: 'handshake', text: payload })
      }
      parentPort.postMessage({ type: 'stdin', data: encodeFrame(payload) })
      return
    }
    if (message.type === 'shutdown') {
      parentPort.close()
    }
  })
}

if (!isMainThread && parentPort !== null) {
  run({
    memoryLimitMB: workerData?.memoryLimitMB,
    injectMemoryLimit: workerData?.injectMemoryLimit === true,
  })
}
