/**
 * The workspace switch must not leave a language server behind (WS-01/02/03).
 *
 * The bug this file locks down:
 *
 *   - `configureLsp(store)` blanked `sessionRoot` BEFORE the new binding was
 *     used, and `refreshLsp()` only stops the old server when the root it
 *     remembers is not empty. The guard was therefore false for ever, and
 *     `shutdownHostLsp()` was NEVER called on a workspace switch: the old
 *     workspace kept its language server - and its 2 GB reservation - until
 *     the idle timeout of the host took it away ten minutes later.
 *
 * The root cause is not that the client forgot to close the server: the
 * client never told the host to close it. The client does not start a server
 * on its own either - the host only starts one when the client asks for it,
 * and the wake-up of the host needs a session that already exists - so the
 * close has to be a call of the client (PRD-v5.1 §1.3, X1).
 *
 * The second half of the file locks the ORDER down (WS-02): the stop of the
 * old server has to be confirmed before the new session starts, because the
 * memory gate of the host reads the memory of the machine - and it has to
 * read the memory the old server gave back.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  configureLsp,
  lspClient,
  lspState,
  releaseLspForStore,
  setLspEnabled,
  shutdownHostLspAwaited,
  shutdownLsp,
} from '../src/client/lsp-session.js'
import { loadLspLibrary } from '../src/client/lsp-lib.js'
// The library of the language-server client is loaded lazily: the plugin may
// be installed alone, and the session needs the library to build its client.
await loadLspLibrary()

/** The roots of the workspaces of the cases. */
const ROOT_ONE = 'C:\\work\\one'
const ROOT_TWO = 'C:\\work\\two'
const ROOT_THREE = 'C:\\work\\three'

/** Wait for the pending promises of the session. */
const tick = (ms = 30) => new Promise(resolve => { setTimeout(resolve, ms) })

/**
 * The events of the run: the calls of the client to the host and the sockets
 * the client opened. The order of the events is what WS-02 is about.
 */
let events = []

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
    events.push('socket')
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

/**
 * One store of a workspace.
 *
 * The store owns the decision about the index of a project; here it always
 * wants one, so the session is built.
 * @param {string} root the project root of the workspace
 * @returns {any} the store
 */
function fakeStore(root) {
  const listeners = new Set()
  return {
    state: {
      root,
      workspaceRoot: root,
      settings: { editor: {}, shortcuts: {}, lsp: { enabled: true, requestTimeoutMs: 45000 } },
      lsp: {},
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    /** Tell the session that the state of the store changed. */
    notify() { for (const listener of [...listeners]) listener() },
    lspIndexDecision() { return 'build' },
    lspSessionState() {},
    t(key) { return key },
  }
}

/**
 * The host of the client, as a double.
 *
 * The calls of the client are recorded, and the answer of the host can be
 * withheld: that is how the order of the switch is checked. The host can also
 * fail - that is how the failure of a shutdown is exercised.
 * @returns {any} the double of the host
 */
function makeHost() {
  const calls = []
  const gates = new Map()
  const failures = new Set()
  const original = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const method = String(url).split('/').pop()
    let body = {}
    try {
      body = typeof options?.body === 'string' ? JSON.parse(options.body) : {}
    } catch {
      body = {}
    }
    calls.push({ method, body })
    events.push(`call:${method}:${body.root ?? ''}`)
    if (failures.has(method)) throw new Error('the host is gone')
    const gate = gates.get(method)
    if (gate !== undefined) {
      await gate.promise
      events.push(`answered:${method}:${body.root ?? ''}`)
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, value: null }),
    }
  }
  return {
    calls,
    /** The roots the host was told to stop. */
    shutdowns() { return calls.filter(call => call.method === 'lsp.shutdown').map(call => call.body.root) },
    /**
     * Withhold the answer of the host for one method.
     * @param {string} method the method of the host
     * @returns {() => void} the function that lets the answer through
     */
    hold(method) {
      let resolve = null
      const promise = new Promise(r => { resolve = r })
      gates.set(method, { promise, resolve })
      return () => {
        gates.delete(method)
        resolve()
      }
    },
    /**
     * Make the host fail one method.
     * @param {string} method the method of the host
     */
    fail(method) { failures.add(method) },
    /**
     * Let the host answer one method again.
     * @param {string} method the method of the host
     */
    repair(method) { failures.delete(method) },
    restore() { globalThis.fetch = original },
  }
}

/**
 * Run one case with a client session and a host double.
 * @param {(host: any) => Promise<void>} run the code of the case
 * @returns {Promise<void>}
 */
async function withHost(run) {
  events = []
  const host = makeHost()
  const originalWebSocket = globalThis.WebSocket
  globalThis.WebSocket = FakeSocket
  try {
    await run(host)
  } finally {
    configureLsp(null)
    shutdownLsp()
    setLspEnabled(true)
    globalThis.WebSocket = originalWebSocket
    host.restore()
  }
}

test('switching the workspace stops the language server of the old workspace', async () => {
  await withHost(async (host) => {
    configureLsp(fakeStore(ROOT_ONE))
    await tick()
    assert.notEqual(lspClient(), null, 'the session of the first workspace is running')

    configureLsp(fakeStore(ROOT_TWO))
    await tick()
    assert.deepEqual(
      host.shutdowns(),
      [ROOT_ONE],
      'the host is told to stop the server of the workspace that was left',
    )
  })
})

test('the server of the workspace that was left does not wait for the idle timeout', async () => {
  // The whole point of WS-01: the server of the old workspace holds its
  // reservation (2 GB for TypeScript) until the idle timeout of the host
  // takes it away - ten minutes later. The close has to happen at once.
  await withHost(async (host) => {
    configureLsp(fakeStore(ROOT_ONE))
    await tick()
    configureLsp(fakeStore(ROOT_TWO))
    await tick()
    const shutdown = host.calls.find(call => call.method === 'lsp.shutdown')
    assert.ok(shutdown !== undefined, 'the stop is asked for')
    assert.equal(shutdown.body.root, ROOT_ONE, 'the stop names the old root')
  })
})

test('the new session starts only after the host confirmed the stop', async () => {
  await withHost(async (host) => {
    const release = host.hold('lsp.shutdown')
    try {
      configureLsp(fakeStore(ROOT_ONE))
      await tick()
      const socketsBefore = events.filter(event => event === 'socket').length
      assert.equal(socketsBefore, 1, 'the first workspace opened its socket')

      configureLsp(fakeStore(ROOT_TWO))
      await tick(60)
      assert.equal(
        events.filter(event => event === 'socket').length,
        socketsBefore,
        'no socket is opened before the host answered',
      )
      assert.equal(lspClient().connected, false, 'the new client waits for its turn')

      release()
      await tick(60)
      assert.ok(
        events.filter(event => event === 'socket').length > socketsBefore,
        'the new session opened its socket after the stop',
      )
      const answered = events.findIndex(event => event.startsWith('answered:lsp.shutdown'))
      const socket = events.lastIndexOf('socket')
      assert.ok(answered >= 0, 'the host answered the stop')
      assert.ok(answered < socket, 'the new session is opened after the stop was confirmed')
    } finally {
      release()
    }
  })
})

test('a switch that is overtaken starts nothing', async () => {
  await withHost(async (host) => {
    const release = host.hold('lsp.shutdown')
    try {
      configureLsp(fakeStore(ROOT_ONE))
      await tick()
      configureLsp(fakeStore(ROOT_TWO))
      await tick(20)
      // The user switches again before the host answered the first stop.
      configureLsp(fakeStore(ROOT_THREE))
      await tick(20)
      release()
      await tick(80)
      assert.equal(lspState().root, ROOT_THREE, 'the session belongs to the last workspace')
      assert.equal(
        events.filter(event => event === 'socket').length,
        2,
        'one socket for the first workspace and one for the last - none for the one in between',
      )
    } finally {
      release()
    }
  })
})

test('the session of a project that stays the same is not stopped', async () => {
  await withHost(async (host) => {
    configureLsp(fakeStore(ROOT_ONE))
    await tick()
    // Another store of the SAME project: the server belongs to the project,
    // not to the store.
    configureLsp(fakeStore(ROOT_ONE))
    await tick()
    assert.deepEqual(host.shutdowns(), [], 'the server of the project stays alive')
    assert.notEqual(lspClient(), null, 'the session is running')
  })
})

test('a released store ends the session and stops the server on the host', async () => {
  await withHost(async (host) => {
    const store = fakeStore(ROOT_ONE)
    configureLsp(store)
    await tick()
    assert.notEqual(lspClient(), null, 'the session is running')

    releaseLspForStore(store)
    assert.equal(lspClient(), null, 'the session of the released store is gone')
    assert.deepEqual(host.shutdowns(), [ROOT_ONE], 'the host is told to stop the server')
  })
})

test('the release of another store does not touch the running session', async () => {
  await withHost(async (host) => {
    configureLsp(fakeStore(ROOT_ONE))
    await tick()
    releaseLspForStore(fakeStore(ROOT_TWO))
    await tick()
    assert.notEqual(lspClient(), null, 'the running session is still there')
    assert.deepEqual(host.shutdowns(), [ROOT_TWO], 'only the root of the released store is stopped')
  })
})

test('the release of a store happens once', async () => {
  await withHost(async (host) => {
    const store = fakeStore(ROOT_ONE)
    configureLsp(store)
    await tick()
    releaseLspForStore(store)
    releaseLspForStore(store)
    await tick()
    assert.deepEqual(host.shutdowns(), [ROOT_ONE], 'the server is stopped once')
  })
})

test('the awaited stop of a server never rejects', async () => {
  await withHost(async () => {
    const original = globalThis.fetch
    globalThis.fetch = async () => { throw new Error('the host is gone') }
    try {
      await shutdownHostLspAwaited(ROOT_ONE)
    } finally {
      globalThis.fetch = original
    }
  })
})

// ── the duplicate shutdown of one workspace switch (review round 1, B2) ──
//
// One workspace switch asks the host to stop the server of the root that was
// left TWICE: the store stops it on its restore path, and the switch of the
// session stops it as well. The second call is nearly free - the server is
// already gone - but it IS a duplicate call, and the host answers
// `lsp.shutdown` only after the process really died (measured: 56 ms for a
// server that dies after 50 ms, 1207 ms for one that dies after 1200 ms), so
// the duplicate is not free in time either.

test('two awaited stops of the same root ask the host once', async () => {
  await withHost(async (host) => {
    const release = host.hold('lsp.shutdown')
    try {
      const first = shutdownHostLspAwaited(ROOT_ONE)
      const second = shutdownHostLspAwaited(ROOT_ONE)
      release()
      // Both callers get an answer - the second one waits for the answer of
      // the first one instead of asking again.
      await Promise.all([first, second])
      assert.deepEqual(host.shutdowns(), [ROOT_ONE], 'the host is asked once')
      assert.ok(
        events.some(event => event.startsWith('answered:lsp.shutdown')),
        'the host answered the stop',
      )
    } finally {
      release()
    }
  })
})

test('two awaited stops of different roots ask the host twice', async () => {
  await withHost(async (host) => {
    await Promise.all([shutdownHostLspAwaited(ROOT_ONE), shutdownHostLspAwaited(ROOT_TWO)])
    assert.deepEqual(host.shutdowns(), [ROOT_ONE, ROOT_TWO], 'both roots are stopped')
  })
})

test('two spellings of the same root share one request', async () => {
  await withHost(async (host) => {
    // The same path, spelled differently: a drive letter in another case and
    // a forward slash instead of a backslash. The host would answer both of
    // them the same way, so it must not be asked twice.
    await Promise.all([
      shutdownHostLspAwaited('C:\\work\\demo'),
      shutdownHostLspAwaited('c:/work/demo/'),
    ])
    assert.deepEqual(host.shutdowns(), ['C:\\work\\demo'], 'the host is asked once')
  })
})

test('a later stop of the same root reaches the host again', async () => {
  await withHost(async (host) => {
    await shutdownHostLspAwaited(ROOT_ONE)
    await shutdownHostLspAwaited(ROOT_ONE)
    assert.deepEqual(
      host.shutdowns(),
      [ROOT_ONE, ROOT_ONE],
      'the second stop is a real request - the server may be running again',
    )
  })
})

test('a failed stop does not poison the next one', async () => {
  await withHost(async (host) => {
    host.fail('lsp.shutdown')
    // The host is gone: the call fails, but the promise does not reject.
    await shutdownHostLspAwaited(ROOT_ONE)
    host.repair('lsp.shutdown')
    await shutdownHostLspAwaited(ROOT_ONE)
    assert.equal(
      host.shutdowns().length,
      2,
      'the failed stop does not swallow the next one',
    )
  })
})

test('a project that only differs in spelling is not stopped', async () => {
  await withHost(async (host) => {
    configureLsp(fakeStore('C:\\work\\demo'))
    await tick()
    // The same project, spelled differently: the drive letter in another
    // case, a forward slash instead of a backslash. The server of the
    // project belongs to the project, so it stays.
    configureLsp(fakeStore('c:/work/demo'))
    await tick()
    assert.deepEqual(host.shutdowns(), [], 'the server of the project is not stopped')
    assert.notEqual(lspClient(), null, 'the session is running')
  })
})
