/**
 * The client session follows the decision of the workbench (review P1-2).
 *
 * The client session used to be built for EVERY project with the global
 * switch on - it never asked the store whether the workbench wants an index
 * for this project. The host then never started a server (the user had put
 * the project into the basic mode), the handshake was held for ever, the
 * client gave up after four rounds and reported a dead session: the status
 * bar turned red and a toast appeared for a decision the user had made on
 * purpose.
 *
 * The store owns the decision (it asked the user, PRD-v5 §2.3) and the
 * session reads it:
 *
 *   'build'       - the workbench wants an index: the session is built;
 *   'conservative' - the user said no: no session at all;
 *   'unknown'     - the workbench did not decide yet: the session is built,
 *                   because the client asks BEFORE the host starts the server
 *                   (the handshake is held until the server exists).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkbenchStore } from '../src/client/store.js'
import {
  configureLsp,
  lspClient,
  reconnectLsp,
  setLspEnabled,
  shutdownLsp,
} from '../src/client/lsp-session.js'

const ROOT = 'C:\\work\\demo'

/** Wait for the pending promises of the store. */
const tick = (ms = 20) => new Promise(resolve => { setTimeout(resolve, ms) })

/**
 * One fake WebSocket for the client session.
 *
 * It answers every request, so no request ever runs into its timeout.
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
    if (parsed?.id === undefined) return
    const result = parsed.method === 'initialize' ? { capabilities: {} } : null
    this.emit('message', {
      data: JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result }),
    })
  }

  close() { this.readyState = 3 }
}
FakeSocket.instances = []

/**
 * A store with a project root and a semantic-analysis section.
 *
 * The decision is a function of the test: the store answers it, and the
 * test can change the answer while the session runs.
 * @param {() => string} decision the answer of the store
 * @returns {any} the store
 */
function decisionStore(decision) {
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new WorkbenchStore(ctx, key => key)
  store.state = {
    ...store.state,
    workspaceRoot: ROOT,
    root: ROOT,
    gitRepoRoot: ROOT,
    phase: 'ready',
    settings: {
      editor: { openMode: 'auto', editableMaxBytes: 1 << 20 },
      shortcuts: {},
      lsp: { enabled: true, requestTimeoutMs: 45000 },
    },
  }
  store.lspIndexDecision = root => (root === '' ? 'unknown' : decision())
  return store
}

/**
 * Run one piece of code with a fake WebSocket and a client session.
 * @param {() => Promise<void>} run the code of the case
 * @returns {Promise<void>}
 */
async function withSession(run) {
  const originalWebSocket = globalThis.WebSocket
  globalThis.WebSocket = FakeSocket
  try {
    await run()
  } finally {
    configureLsp(null)
    shutdownLsp()
    setLspEnabled(true)
    globalThis.WebSocket = originalWebSocket
  }
}

test('a project in the basic mode gets no session at all', async (t) => {
  await withSession(async () => {
    const store = decisionStore(() => 'conservative')
    t.after(() => { store.dispose() })
    configureLsp(store)
    await tick()
    assert.equal(lspClient(), null, 'no client is built for a project without an index')
    assert.equal(FakeSocket.instances.length, 0, 'no socket is opened either')
  })
})

test('a project with an index gets its session', async (t) => {
  await withSession(async () => {
    const store = decisionStore(() => 'build')
    t.after(() => { store.dispose() })
    configureLsp(store)
    await tick()
    assert.notEqual(lspClient(), null, 'the session is built')
    assert.ok(FakeSocket.instances.length > 0, 'the client opened its socket')
  })
})

test('a project without a decision keeps the session it always had', async (t) => {
  await withSession(async () => {
    const store = decisionStore(() => 'unknown')
    t.after(() => { store.dispose() })
    configureLsp(store)
    await tick()
    assert.notEqual(lspClient(), null, 'the session is built')
    assert.ok(FakeSocket.instances.length > 0, 'the client opened its socket')
  })
})

test('a store that cannot answer does not switch the session off', async (t) => {
  await withSession(async () => {
    const ctx = { locale: { subscribe: () => () => {} } }
    const store = new WorkbenchStore(ctx, key => key)
    store.state = {
      ...store.state,
      workspaceRoot: ROOT,
      root: ROOT,
      gitRepoRoot: ROOT,
      phase: 'ready',
      settings: { editor: {}, shortcuts: {}, lsp: { enabled: true } },
    }
    t.after(() => { store.dispose() })
    // The store cannot answer: an older host, a test double. The session
    // must go on as it always did.
    store.lspIndexDecision = undefined
    assert.equal(typeof store.lspIndexDecision, 'undefined')
    configureLsp(store)
    await tick()
    assert.notEqual(lspClient(), null, 'the session is built')
  })
})

test('a decision that changes to the basic mode ends the session', async (t) => {
  await withSession(async () => {
    let decision = 'build'
    const store = decisionStore(() => decision)
    t.after(() => { store.dispose() })
    configureLsp(store)
    await tick()
    assert.notEqual(lspClient(), null, 'the session is built')
    decision = 'conservative'
    // The store tells its subscribers: the session has to notice the new
    // decision. The value has to change - a `set` that changes nothing does
    // not wake the subscribers.
    store.set({ lspStatusStale: true })
    await tick()
    assert.equal(lspClient(), null, 'the session is gone')
  })
})

test('the reconnect does not build a session for a project without an index', async (t) => {
  await withSession(async () => {
    const store = decisionStore(() => 'conservative')
    t.after(() => { store.dispose() })
    const socketsBefore = FakeSocket.instances.length
    configureLsp(store)
    await tick()
    reconnectLsp()
    await tick()
    assert.equal(lspClient(), null, 'no client is built by a refused reconnect')
    assert.equal(
      FakeSocket.instances.length,
      socketsBefore,
      'no socket is opened either',
    )
  })
})
