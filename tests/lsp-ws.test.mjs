import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WebSocket } from 'ws'
import { encodeFrame } from '../src/host/lsp-frame.js'
import { LSP_WS_PATH, registerLspWebSocket, shutdownLspWebSocket } from '../src/host/lsp-ws.js'
import { decodeChunks, makeManager, sleep } from './lsp-fixtures.mjs'

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-${name}`)
}

/**
 * Wait until one condition holds.
 * @param {() => boolean} predicate
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
function waitFor(predicate, timeoutMs = 3000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) { resolve(); return }
      if (Date.now() - started > timeoutMs) { reject(new Error('the condition did not hold in time')); return }
      setTimeout(tick, 5)
    }
    tick()
  })
}

/**
 * A host context that only knows the upgrade handler.
 * @returns {any}
 */
function fakeCtx() {
  const upgrades = new Map()
  return {
    upgrades,
    effect(fn) { fn(); return () => {} },
    webServer: {
      registerUpgrade({ path, handler }) {
        upgrades.set(path, handler)
        return () => {}
      },
    },
  }
}

/**
 * Start one relay on a local port.
 * @param {object} options
 * @param {any} [options.t] the test context, used for the cleanup
 * @returns {Promise<{ url: string, connect: (root?: string) => WebSocket, close: () => Promise<void> }>}
 */
async function serve(options) {
  const ctx = fakeCtx()
  const relay = registerLspWebSocket(ctx, options)
  const server = createServer()
  server.on('upgrade', (req, socket, head) => {
    const handler = ctx.upgrades.get(LSP_WS_PATH)
    if (handler === undefined) { socket.destroy(); return }
    handler(req, socket, head)
  })
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address()
  const sockets = []
  const close = async () => {
    for (const socket of sockets) {
      try { socket.terminate() } catch { /* already gone */ }
    }
    relay.close()
    server.closeAllConnections?.()
    await new Promise((resolve) => { server.close(resolve) })
  }
  const connect = (root) => {
    const query = root === undefined ? '' : `?root=${encodeURIComponent(root)}`
    const socket = new WebSocket(`ws://127.0.0.1:${port}${LSP_WS_PATH}${query}`)
    // A refused connection resets the socket; the test does not care.
    socket.on('error', () => {})
    sockets.push(socket)
    return socket
  }
  if (options.t !== undefined) options.t.after(() => close())
  return { url: `ws://127.0.0.1:${port}${LSP_WS_PATH}`, connect, close }
}

test('a connection without a root is refused with a readable message', async (t) => {
  const { manager } = makeManager()
  const server = await serve({ manager, fence: () => true, t })
  const socket = server.connect()
  const messages = []
  socket.on('message', (raw) => { messages.push(JSON.parse(raw.toString('utf8'))) })
  await waitFor(() => messages.length > 0)
  assert.equal(messages[0].type, 'error')
  assert.match(messages[0].message, /root/i)
})

test('a connection with a relative root is refused', async (t) => {
  const { manager } = makeManager()
  const server = await serve({ manager, fence: () => true, t })
  const socket = server.connect('relative/path')
  const messages = []
  socket.on('message', (raw) => { messages.push(JSON.parse(raw.toString('utf8'))) })
  await waitFor(() => messages.length > 0)
  assert.equal(messages[0].type, 'error')
})

test('the relay passes the payloads of the client to the language server', async (t) => {
  const { manager, handle } = makeManager()
  const root = rootOf('ws-relay')
  await manager.start({ root })
  const server = await serve({ manager, fence: () => true, t })
  const socket = server.connect(root)
  await waitFor(() => socket.readyState === WebSocket.OPEN)
  await sleep(50)

  socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }))
  await waitFor(() => handle().stdinChunks.length > 0)

  const payloads = decodeChunks(handle().stdinChunks)
  assert.ok(payloads.some(payload => payload.includes('"initialize"')))
})

test('the relay passes the payloads of the language server to the client', async (t) => {
  const { manager, handle } = makeManager()
  const root = rootOf('ws-downstream')
  await manager.start({ root })
  const server = await serve({ manager, fence: () => true, t })
  const socket = server.connect(root)
  const messages = []
  socket.on('message', (raw) => { messages.push(raw.toString('utf8')) })
  await waitFor(() => socket.readyState === WebSocket.OPEN)
  await sleep(50)

  const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } })
  handle().stdout.write(encodeFrame(payload))
  await waitFor(() => messages.includes(payload))

  assert.ok(messages.includes(payload))
})

test('a payload that is not JSON is ignored', async (t) => {
  const { manager, handle } = makeManager()
  const root = rootOf('ws-garbage')
  await manager.start({ root })
  const server = await serve({ manager, fence: () => true, t })
  const socket = server.connect(root)
  await waitFor(() => socket.readyState === WebSocket.OPEN)
  await sleep(50)

  socket.send('this is not json')
  await sleep(80)

  assert.equal(handle().stdinChunks.length, 0, 'nothing reaches the language server')
  assert.equal(socket.readyState, WebSocket.OPEN, 'the connection survives')
})

test('closing the socket does not stop the language server', async (t) => {
  const { manager, handle } = makeManager()
  const root = rootOf('ws-close')
  await manager.start({ root })
  const server = await serve({ manager, fence: () => true, t })
  const socket = server.connect(root)
  await waitFor(() => socket.readyState === WebSocket.OPEN)
  await sleep(50)

  socket.close()
  await waitFor(() => socket.readyState === WebSocket.CLOSED)
  await sleep(80)

  assert.equal(handle().terminateCalls, 0, 'the language server keeps running')
  assert.equal((await manager.status({ root })).state, 'building')
})

test('a request that the fence refuses is dropped', async (t) => {
  const { manager } = makeManager()
  const server = await serve({ manager, fence: () => false, t })
  const socket = server.connect(rootOf('ws-fence'))
  await waitFor(() => socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING)
  assert.notEqual(socket.readyState, WebSocket.OPEN)
})

test('the relay can be closed by the host', async (t) => {
  const { manager } = makeManager()
  const server = await serve({ manager, fence: () => true, t })
  const socket = server.connect(rootOf('ws-shutdown'))
  await waitFor(() => socket.readyState === WebSocket.OPEN)
  shutdownLspWebSocket()
  await waitFor(() => socket.readyState === WebSocket.CLOSED)
})
