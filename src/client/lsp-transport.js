/**
 * WebSocket transport for the client-side LSP session.
 *
 * `@codemirror/lsp-client` speaks a very small protocol: `send(message)` puts
 * one JSON document on the wire and `subscribe(handler)` receives the JSON
 * documents coming back. There is no LSP framing here - the host owns the
 * `Content-Length` headers and forwards plain JSON bodies.
 *
 * Three things the browser side has to get right and the library does not
 * provide:
 *
 * 1. **Queueing.** The client sends `initialize` the moment it connects, but
 *    the socket is still `CONNECTING` at that point. Messages sent before the
 *    socket opens are queued and flushed in order once it does.
 * 2. **Reconnection.** A language server may be restarted (crash recovery,
 *    idle exit) while the workbench is open. The transport reconnects with an
 *    exponential backoff and flushes whatever was queued in the meantime.
 * 3. **No uncaught exceptions.** A dead socket must not take the editor down;
 *    failures are reported through the `onError` callback instead.
 *
 * The host also puts *control events* on the same socket (`{"type":"degraded"}`).
 * They are not JSON-RPC messages and the library must never see them, so the
 * transport takes them out of the stream and hands them to `onControl`.
 */

/** The backoff schedule of the automatic reconnect, in milliseconds. */
const RETRY_BASE_MS = 500
/** The longest the transport waits before another reconnect attempt. */
const RETRY_MAX_MS = 30000

/**
 * Whether a payload of the socket is a control event of the host.
 *
 * A control event is a plain JSON object without `jsonrpc` and with a
 * `type` of its own (`{"type":"degraded","root":"…"}`). A JSON-RPC payload
 * always carries `jsonrpc: "2.0"`, so the two can never collide.
 *
 * The library would choke on a control event - it is not a JSON-RPC message
 * at all - so the transport takes such a payload out of the stream before
 * the subscribers see it.
 *
 * @param {string} text the raw payload of the socket
 * @returns {object|null} the parsed control event, or `null` for everything else
 */
export function isControlEvent(text) {
  if (typeof text !== 'string' || text === '') return null
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    // A payload that is not JSON belongs to the library: it owns the error
    // message of a broken stream.
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  if (parsed.jsonrpc !== undefined) return null
  if (typeof parsed.type !== 'string') return null
  return parsed
}

/**
 * Create one LSP transport.
 *
 * @param {object} options
 * @param {string | (() => string)} options.url the WebSocket URL, or a
 *   function that produces it (the reconnect may need a fresh URL)
 * @param {(info: {attempt: number, reopened: boolean}) => void} [options.onOpen]
 *   called when the socket opens; `reopened` is true for every opening but
 *   the first one
 * @param {(info: {code: number, reason: string}) => void} [options.onClose]
 *   called when the socket closes
 * @param {(error: unknown) => void} [options.onError] called for every
 *   connection or send failure
 * @param {(event: object) => void} [options.onControl] called for every
 *   control event of the host; such an event never reaches the subscribers
 *   of the library
 * @param {new (url: string) => any} [options.WebSocketImpl] the socket
 *   implementation (the global `WebSocket` by default)
 * @returns {{send: (message: string) => void, subscribe: (handler: (value: string) => void) => void,
 *   unsubscribe: (handler: (value: string) => void) => void, close: () => void,
 *   readonly ready: boolean, readonly queued: number}}
 */
export function createLspTransport(options = {}) {
  const { url, onOpen, onClose, onError, onControl } = options
  const handlers = new Set()
  const queue = []
  let socket = null
  let stopped = false
  let attempt = 0
  let retryTimer = null
  /** How many times the socket has been open; the first one is not a reopen. */
  let opened = 0

  /** The URL of the next connection attempt. */
  function resolveUrl() {
    const value = typeof url === 'function' ? url() : url
    if (value === undefined || value === null) return ''
    return typeof value === 'string' ? value : String(value)
  }

  /** The socket implementation to use. */
  function socketImpl() {
    if (typeof options.WebSocketImpl === 'function') return options.WebSocketImpl
    return globalThis.WebSocket
  }

  /** Report a failure without ever throwing at the caller. */
  function report(error) {
    if (typeof onError === 'function') {
      try {
        onError(error)
      } catch {
        /* a broken error handler must not break the transport */
      }
    }
  }

  /** Send everything that was queued while the socket was down. */
  function flush() {
    if (socket === null || socket.readyState !== 1) return
    while (queue.length > 0) {
      const message = queue.shift()
      try {
        socket.send(message)
      } catch (error) {
        // The socket died between the check and the send: keep the message
        // queued and let the close handler schedule the reconnect.
        queue.unshift(message)
        report(error)
        return
      }
    }
  }

  /** Open the socket. */
  function connect() {
    if (stopped) return
    const Impl = socketImpl()
    if (typeof Impl !== 'function') {
      report(new Error('No WebSocket implementation is available for the LSP transport'))
      return
    }
    const target = resolveUrl()
    if (target === '') {
      report(new Error('The LSP transport has no WebSocket URL'))
      return
    }
    try {
      socket = new Impl(target)
    } catch (error) {
      report(error)
      scheduleReconnect()
      return
    }
    socket.addEventListener?.('open', () => {
      attempt = 0
      // A socket that opens again is a *re*connection: the client has to run
      // its handshake once more, because the language server was initialized
      // for the socket that died.
      const reopened = opened > 0
      opened += 1
      if (typeof onOpen === 'function') {
        try {
          onOpen({ attempt, reopened })
        } catch (error) {
          report(error)
        }
      }
      flush()
    })
    socket.addEventListener?.('message', (event) => {
      const data = typeof event?.data === 'string' ? event.data : String(event?.data ?? '')
      // A control event of the host is not a JSON-RPC message: the library
      // would fail on it. It is taken out of the stream here and handed to
      // the store instead (PRD-v5 §1.5).
      const control = isControlEvent(data)
      if (control !== null) {
        if (typeof onControl === 'function') {
          try {
            onControl(control)
          } catch (error) {
            report(error)
          }
        }
        return
      }
      for (const handler of [...handlers]) {
        try {
          handler(data)
        } catch (error) {
          report(error)
        }
      }
    })
    socket.addEventListener?.('error', (event) => {
      report(event instanceof Error ? event : new Error('The LSP WebSocket reported an error'))
    })
    socket.addEventListener?.('close', (event) => {
      socket = null
      const info = { code: Number(event?.code ?? 0), reason: String(event?.reason ?? '') }
      if (typeof onClose === 'function') {
        try {
          onClose(info)
        } catch (error) {
          report(error)
        }
      }
      if (stopped) return
      scheduleReconnect()
    })
  }

  /** Try again later, with an exponential backoff. */
  function scheduleReconnect() {
    if (stopped || retryTimer !== null) return
    const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS)
    attempt += 1
    retryTimer = setTimeout(() => {
      retryTimer = null
      connect()
    }, delay)
    // A pending reconnect must not keep a Node process alive (the tests
    // import this module); in the browser the timer is a plain number.
    if (typeof retryTimer?.unref === 'function') retryTimer.unref()
  }

  return {
    /**
     * Send one JSON document.
     *
     * The message is queued while the socket is not open yet; a permanently
     * stopped transport drops it and reports the failure instead of throwing.
     * @param {string} message the JSON body
     */
    send(message) {
      if (typeof message !== 'string') return
      if (stopped) {
        report(new Error('The LSP transport is closed'))
        return
      }
      if (socket !== null && socket.readyState === 1) {
        try {
          socket.send(message)
        } catch (error) {
          queue.push(message)
          report(error)
        }
        return
      }
      queue.push(message)
      if (socket === null) connect()
    },
    /**
     * Register a handler for the incoming JSON documents.
     * @param {(value: string) => void} handler the handler
     */
    subscribe(handler) {
      if (typeof handler !== 'function') return
      handlers.add(handler)
    },
    /**
     * Remove a handler.
     * @param {(value: string) => void} handler the handler
     */
    unsubscribe(handler) {
      handlers.delete(handler)
    },
    /** Stop the transport: no reconnect, no further messages. */
    close() {
      stopped = true
      if (retryTimer !== null) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      queue.length = 0
      const current = socket
      socket = null
      try {
        current?.close()
      } catch {
        /* the socket is already gone */
      }
    },
    /** Whether the socket is open and able to carry messages. */
    get ready() {
      return socket !== null && socket.readyState === 1
    },
    /** How many messages are waiting for the socket. */
    get queued() {
      return queue.length
    },
  }
}
