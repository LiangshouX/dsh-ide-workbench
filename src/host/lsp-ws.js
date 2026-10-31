/**
 * The LSP WebSocket relay (PRD §1.3).
 *
 * The browser side runs the official `@codemirror/lsp-client`, whose
 * `Transport` interface speaks plain JSON: one WebSocket text message is one
 * JSON-RPC payload and it carries no `Content-Length` header. This relay is
 * therefore transparent:
 *
 *   client → host : one text message  → the language server's stdin
 *   host → client : one text message  ← the language server's stdout
 *
 * The host main thread never parses the payload (the framing happens in the
 * frame worker, see `lsp.js`), and it never touches the editor state of the
 * user: closing a tab only detaches the client, several tabs may share one
 * language server.
 *
 * The path is separate from the terminal socket, so the two never interfere.
 */
import { isAbsolute, resolve as resolvePath } from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import { guardEmitter } from './guard.js'

/** The WebSocket path of the language server relay. */
export const LSP_WS_PATH = '/ide-workbench/ws/lsp'

/** The relay that is currently registered, so the host can close it. */
let active = null

/**
 * Whether one payload looks like JSON.
 *
 * This is a structural check, not a parse: the main thread must not parse
 * LSP payloads (PRD §3.3). The frame worker does the authoritative check and
 * drops what it cannot read.
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeJson(text) {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return true
  return trimmed.startsWith('[') && trimmed.endsWith(']')
}

/**
 * Register the language server relay.
 *
 * @param {any} ctx the cordis host context
 * @param {{ manager: any, fence?: (req: any) => boolean }} options
 *   `manager` is the {@link import('./lsp.js').LspManager} that owns the
 *   language servers, `fence` is the request check of the host (the same
 *   `ctx.connection.requestRejection` fence the JSON API uses).
 * @returns {{ wss: WebSocketServer, close: () => void }} the registered relay
 */
export function registerLspWebSocket(ctx, { manager, fence } = {}) {
  if (manager === undefined || manager === null) {
    throw new Error('registerLspWebSocket needs a manager')
  }
  const wss = new WebSocketServer({ noServer: true })
  // The relay's own server is a source of errors as well: `ws` emits
  // 'error' on the server when an upgrade fails. An 'error' event without a
  // listener is an uncaught exception, and that ends the DSH host process.
  guardEmitter(ctx, wss, 'language server relay')
  const sockets = new Set()

  /**
   * Serve one language server socket: attach it to the language server of
   * its project root and relay the payloads in both directions.
   *
   * The whole body is guarded: a throw inside the `upgrade` callback would
   * escape into the HTTP server and take the DSH host process down with it.
   * @param {WebSocket} ws the socket
   * @param {any} req the upgrade request
   */
  const attach = (ws, req) => {
    try {
      const url = new URL(req.url ?? '/', 'http://dsh.internal')
      const requested = url.searchParams.get('root')
      if (typeof requested !== 'string' || requested === '' || !isAbsolute(requested)) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'error', message: 'the LSP WebSocket needs an absolute "root" path' }))
        }
        ws.close()
        return
      }
      const root = resolvePath(requested)
      const send = (text) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(text)
      }
      const control = (event) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event))
      }
      const detach = manager.attachSink(root, { send, control })
      sockets.add(ws)

      // The relay attaches to an existing session; it never starts one on its
      // own. The client decides through the API whether a language server is
      // started (and whether the index is built at all).
      let snapshot = { state: 'idle' }
      try {
        snapshot = manager.stateOf?.(root) ?? snapshot
      } catch { /* the root has no session yet */ }
      control({ type: 'ready', root, state: snapshot.state ?? 'idle' })

      ws.on('message', (raw) => {
        const text = typeof raw === 'string' ? raw : raw.toString('utf8')
        if (text.trim() === '') return
        // A broken client must not take the session down: a payload that is
        // not JSON is dropped instead of forwarded.
        if (!looksLikeJson(text)) return
        try {
          manager.relayToServer(root, text)
        } catch {
          /* the root is gone: the client reconnects */
        }
      })
      ws.on('error', () => {})
      ws.on('close', () => {
        sockets.delete(ws)
        detach()
      })
    } catch {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'error', message: 'the language server relay could not be attached' }))
        }
        ws.close()
      } catch {
        /* the socket is already gone */
      }
    }
  }

  const handler = (req, socket, head) => {
    if (typeof fence === 'function' && !fence(req)) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => { attach(ws, req) })
  }

  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: LSP_WS_PATH,
    handler,
  }), 'dsh-ide-workbench: LSP WebSocket')

  const close = () => {
    for (const socket of sockets) {
      try {
        socket.close()
      } catch { /* already gone */ }
    }
    sockets.clear()
    wss.close()
  }

  active = { wss, sockets, close }
  return { wss, close }
}

/**
 * Close the language server relay and every open socket.
 *
 * The host calls this when the plugin is unloaded.
 */
export function shutdownLspWebSocket() {
  if (active === null) return
  const { close } = active
  active = null
  close()
}
