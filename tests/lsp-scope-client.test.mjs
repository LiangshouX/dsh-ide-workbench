/**
 * SCOPE-01: the client sends the scope root of the project as the `rootUri`
 * of its handshake (PRD-v5 §4.2).
 *
 * The `rootUri` of the `initialize` request is what tells the language server
 * which project it is looking at - the working directory of its process does
 * not. A workspace root that holds several projects must therefore not be the
 * root of the program: the scope converges onto the nearest sub-project, and
 * the host owns that rule (the client does not see the disk).
 *
 * The tests below watch three things:
 *
 *   - the client asks the host for the scope root and sends it as the
 *     `rootUri` of its *first* handshake - the host forwards the first one to
 *     the language server and answers the later ones from its cache, so only
 *     the first one decides the program;
 *   - a host that does not answer leaves the client on the workspace root and
 *     does not break the session;
 *   - the scope root is part of the session key: a changed policy builds a new
 *     client, and a scope that does not move does not.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { configureLsp, lspClient, scopeRootFor, shutdownLsp } from '../src/client/lsp-session.js'
import { fileUriOf } from '../src/client/lsp-uri.js'

/** The workspace root of the tests. */
const ROOT = 'C:/work/demo'
/** The scope root the host reports: the nearest sub-project. */
const SCOPE_ROOT = 'C:/work/demo/packages/app'

/**
 * One fake WebSocket.
 *
 * It records every payload the client sends, so that the handshake can be
 * read: the `rootUri` of the `initialize` request is the thing the server
 * builds its program for.
 */
class FakeSocket {
  constructor(url) {
    this.url = url
    this.readyState = 1
    this.sent = []
    this.handlers = new Map()
    FakeSocket.instances.push(this)
    queueMicrotask(() => this.emit('open', {}))
  }

  addEventListener(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type).add(handler)
  }

  emit(type, event) {
    for (const handler of this.handlers.get(type) ?? []) handler(event)
  }

  send(text) {
    this.sent.push(text)
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {
      return
    }
    if (parsed?.method !== 'initialize') return
    this.emit('message', {
      data: JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { capabilities: {} } }),
    })
  }

  close() { this.readyState = 3 }
}
FakeSocket.instances = []

/** The socket of the current session, when there is one. */
function socketOf() {
  return FakeSocket.instances.length === 0 ? null : FakeSocket.instances[FakeSocket.instances.length - 1]
}

/**
 * The `initialize` request the client sent.
 * @returns {any} the parsed request, or `null` when there is none
 */
function handshakeOf(socket) {
  if (socket === null) return null
  const text = socket.sent.find(entry => entry.includes('"initialize"'))
  if (text === undefined) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * A workbench store for the session.
 * @returns {any} the store
 */
function fakeStore() {
  const listeners = new Set()
  return {
    state: {
      root: ROOT,
      tabs: [],
      settings: { lsp: { enabled: true }, shortcuts: {} },
      lsp: { state: 'idle', scopeRoot: null },
    },
    set(patch) {
      this.state = { ...this.state, ...patch }
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    toast() {},
    t(key) { return key },
    /**
     * The store publishes something: the session follows the state.
     */
    notify() {
      for (const listener of [...listeners]) listener()
    },
  }
}

/**
 * Wait until one condition holds.
 * @param {() => boolean} condition the condition
 * @param {number} [timeoutMs] how long to wait at most
 * @returns {Promise<boolean>} whether the condition held
 */
async function waitFor(condition, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return true
    await new Promise(resolve => { setTimeout(resolve, 10) })
  }
  return condition()
}

/**
 * Start a session and wait until its handshake is sent.
 *
 * The session of the module is global, so the socket of *this* session is the
 * one that appeared after the call - the sockets of the sessions before it are
 * still in the list.
 * @param {any} store the store of the session
 * @returns {Promise<FakeSocket>} the socket of the session
 */
async function startSession(store) {
  const before = FakeSocket.instances.length
  configureLsp(store)
  assert.equal(
    await waitFor(() => FakeSocket.instances.length > before),
    true,
    'the client opened its socket',
  )
  const socket = socketOf()
  assert.equal(
    await waitFor(() => handshakeOf(socket) !== null),
    true,
    'the client sent its handshake',
  )
  return socket
}

const originalWebSocket = globalThis.WebSocket
const originalFetch = globalThis.fetch
const originalTransport = globalThis.__DSH_TRANSPORT__

/** The WebSocket of the tests, so no socket ever leaves the process. */
globalThis.WebSocket = FakeSocket

/**
 * Install a host that answers the scope call.
 * @param {object} [options]
 * @param {string} [options.scopeRoot] the scope root the host reports
 * @param {boolean} [options.broken] the host does not answer at all
 * @returns {{calls: Array<any>}} the calls the host got
 */
function installHost(options = {}) {
  const calls = []
  globalThis.__DSH_TRANSPORT__ = { streamBaseUrl: 'http://127.0.0.1:9/' }
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/ide-workbench/api/')[1] ?? ''
    calls.push({ method, body: init?.body === undefined ? null : JSON.parse(init.body) })
    if (method === 'lsp.scope' && options.broken !== true) {
      return {
        ok: true,
        status: 200,
        async json() { return { ok: true, value: { scopeRoot: options.scopeRoot ?? SCOPE_ROOT } } },
      }
    }
    if (options.broken === true) throw new Error('the host is not reachable')
    return { ok: true, status: 200, async json() { return { ok: true, value: {} } } }
  }
  return { calls }
}

after(() => {
  globalThis.WebSocket = originalWebSocket
  globalThis.fetch = originalFetch
  if (originalTransport === undefined) delete globalThis.__DSH_TRANSPORT__
  else globalThis.__DSH_TRANSPORT__ = originalTransport
  shutdownLsp()
})

test('the client sends the scope root of the host as the rootUri of its handshake', async () => {
  const { calls } = installHost()
  const store = fakeStore()
  const socket = await startSession(store)

  const handshake = handshakeOf(socket)
  assert.equal(handshake.params.rootUri, fileUriOf(SCOPE_ROOT), 'the handshake carries the scope root')

  // The host was asked for the scope root - with the root of the project.
  const asked = calls.find(call => call.method === 'lsp.scope')
  assert.ok(asked !== undefined, 'the host was asked for the scope root')
  assert.equal(asked.body.root, ROOT)
})

test('the scope root of the host is the scope root of the session', async () => {
  installHost()
  assert.equal(await scopeRootFor(ROOT), SCOPE_ROOT)
})

test('a host that does not answer leaves the client on the workspace root', async () => {
  installHost({ broken: true })
  const store = fakeStore()
  const socket = await startSession(store)

  const handshake = handshakeOf(socket)
  assert.equal(handshake.params.rootUri, fileUriOf(ROOT), 'the handshake carries the workspace root')
  assert.notEqual(lspClient(), null, 'the session is alive')
})

test('the scope root of a host that does not answer is the workspace root', async () => {
  installHost({ broken: true })
  assert.equal(await scopeRootFor(ROOT), ROOT)
})

test('a scope that does not move does not build a new client', async () => {
  installHost()
  const store = fakeStore()
  await startSession(store)
  const client = lspClient()

  // The store publishes its state again (the status poll does that every two
  // seconds): the scope did not move, so the client must stay.
  store.notify()
  await new Promise(resolve => { setTimeout(resolve, 50) })
  assert.equal(lspClient(), client, 'the client was not built again')
})

test('a changed policy builds a new client', async () => {
  installHost()
  const store = fakeStore()
  await startSession(store)
  const client = lspClient()

  // The policy of the index scope moved: the program of the language server
  // is built for another project, so the client has to be built again.
  store.state = {
    ...store.state,
    settings: { ...store.state.settings, lsp: { enabled: true, indexScope: 'root' } },
  }
  store.notify()

  assert.equal(
    await waitFor(() => lspClient() !== null && lspClient() !== client),
    true,
    'the client was built again',
  )
  assert.notEqual(lspClient(), client)
})
