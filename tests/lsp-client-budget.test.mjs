/**
 * Regression tests for the request budget of the client (review S6).
 *
 * The library `@codemirror/lsp-client` reads `client.timeout` when it
 * *creates* a request, so the budget has to be written into the client
 * before the request is built.
 *
 * The budget follows the answered semantic requests of the session: the
 * first one is the request that makes the language server build the program
 * of the whole project, and PRD-v5 §0.2 #3 measured that at more than ten
 * minutes. Until it is answered, every request gets the long budget of
 * `BUILD_REQUEST_TIMEOUT_MS`; afterwards the configured timeout applies
 * again.
 *
 * The budget is reset when the host reports a new language server process
 * (review T1): the socket between the browser and the host stays open when
 * the language server crashes - only the *process* is replaced - so the
 * client would keep the short budget while the host waits patiently for ten
 * minutes. The user would see a "Request timed out" and an "unstable"
 * status bar for a failure the host does not consider one.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { configureLsp, isClientDeadline, lspClient, shutdownLsp } from '../src/client/lsp-session.js'
import { WorkbenchStore } from '../src/client/store.js'
import { BUILD_REQUEST_TIMEOUT_MS } from '../src/host/settings-defaults.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * One fake WebSocket.
 *
 * It answers every request, so no request ever runs into its timeout - a
 * timeout would be an unhandled rejection at the end of the test run, and
 * the budget of ten minutes would keep the process alive for ten minutes.
 */
class FakeSocket {
  constructor(url) {
    this.url = url
    this.readyState = 1
    this.sent = []
    /** The budget that was in effect when a message was sent. */
    this.budgets = []
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
    // The budget in effect when the request was created: the library reads
    // `client.timeout` exactly here.
    this.budgets.push({ method: null, timeout: lspClient()?.timeout ?? null })
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {
      return
    }
    const index = this.budgets.length - 1
    this.budgets[index].method = typeof parsed?.method === 'string' ? parsed.method : null
    if (parsed?.id === undefined) return
    const result = parsed.method === 'initialize' ? { capabilities: {} } : null
    this.emit('message', {
      data: JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result }),
    })
  }

  close() { this.readyState = 3 }
}
FakeSocket.instances = []

/** The WebSocket of the tests, so no socket ever leaves the process. */
const originalWebSocket = globalThis.WebSocket
globalThis.WebSocket = FakeSocket

after(() => {
  globalThis.WebSocket = originalWebSocket
  shutdownLsp()
})

/**
 * One workbench store with a language server that is ready.
 *
 * The store wakes its subscribers like the real one does, so the session can
 * watch what the host publishes in the status snapshot - the identity of the
 * running language server process is what tells the client that the server
 * was replaced (review T1).
 * @param {object} [options]
 * @param {number} [options.requestTimeoutMs] the configured request timeout
 * @returns {{store: any, setProcessId: (processId: number) => void}} the store
 */
function fakeStore(options = {}) {
  const listeners = new Set()
  const store = {
    state: {
      root: 'C:/work/demo',
      settings: { lsp: { enabled: true, requestTimeoutMs: options.requestTimeoutMs ?? 45000 } },
      lsp: {
        state: 'ready',
        consecutiveFailures: 0,
        consecutiveTimeouts: 0,
        lastFailure: null,
        // The identity of the running language server process, as the host
        // publishes it in the status snapshot. It is 0 while no server runs.
        processId: 0,
      },
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
    t(key) {
      return key
    },
  }
  return {
    store,
    /**
     * The host reports another language server process.
     * @param {number} processId the identity of the process
     */
    setProcessId(processId) {
      store.state = { ...store.state, lsp: { ...store.state.lsp, processId } }
      for (const listener of [...listeners]) listener()
    },
  }
}

/**
 * The budget that was in effect when one method was sent.
 * @param {string} method the LSP method
 * @returns {number | null} the timeout in milliseconds
 */
function budgetOf(method) {
  const socket = FakeSocket.instances[FakeSocket.instances.length - 1]
  const entry = [...socket.budgets].reverse().find(item => item.method === method)
  return entry === undefined ? null : entry.timeout
}

/**
 * The parameters of one hover request.
 * @returns {any} the parameters
 */
function hoverParams() {
  return { textDocument: { uri: 'file:///C:/work/demo/src/app.ts' }, position: { line: 0, character: 0 } }
}

/**
 * A fetch mock that answers the language-server status.
 * @param {object} status the status snapshot the host reports
 * @returns {() => void} the function that restores the real fetch
 */
function mockStatusFetch(status) {
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    const method = String(url).split('/ide-workbench/api/')[1]
    const value = method === 'lsp.status' ? status : {}
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  return () => { globalThis.fetch = original }
}

/** The bundled workbench module, loaded once per test run. */
let workbenchPromise = null

/**
 * The status item of the workbench.
 *
 * The workbench is a JSX module, so it has to be bundled before a test can
 * import it - the same way the other render tests do it. The bundle lives
 * inside the repository, because the parts that stay external (`react`) are
 * resolved from the `node_modules` of the project.
 * @returns {Promise<any>} the module with `lspStatusView`
 */
async function loadWorkbenchModule() {
  if (workbenchPromise !== null) return workbenchPromise
  workbenchPromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'lsp-client-budget-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: "export { lspStatusView } from './src/client/Workbench.jsx'\n",
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'lsp-client-budget-entry.jsx',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: ['node20'],
      external: ['react', 'react-dom', 'react-dom/server', '@deepseek-ai/dsh-client-ui-primitives'],
      alias: {
        '@xterm/xterm/css/xterm.css': join(root, 'node_modules/@xterm/xterm/css/xterm.css'),
        '@xterm/xterm': join(root, 'tests/stubs/xterm.js'),
        '@xterm/addon-fit': join(root, 'tests/stubs/addon-fit.js'),
      },
      loader: { '.css': 'text' },
      jsx: 'transform',
      define: { 'process.env.NODE_ENV': '"production"' },
      outfile,
      logLevel: 'silent',
    })
    return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
  })()
  return workbenchPromise
}

test('the client starts with the long budget', async () => {
  const { store } = fakeStore()
  configureLsp(store)
  const client = lspClient()
  assert.ok(client !== null, 'the session started a client')
  assert.equal(client.timeout, BUILD_REQUEST_TIMEOUT_MS, 'the first request may take ten minutes')
  await client.request('textDocument/hover', hoverParams())
})

test('the first semantic request gets the long budget', async () => {
  const { store } = fakeStore()
  configureLsp(store)
  const client = lspClient()

  await client.request('textDocument/hover', hoverParams())

  assert.equal(budgetOf('textDocument/hover'), BUILD_REQUEST_TIMEOUT_MS, 'the first semantic request may take ten minutes')
  assert.equal(client.timeout, BUILD_REQUEST_TIMEOUT_MS)
})

test('after the first answered semantic request the configured timeout applies', async () => {
  const { store } = fakeStore()
  configureLsp(store)
  const client = lspClient()

  await client.request('textDocument/hover', hoverParams())
  await client.request('textDocument/definition', hoverParams())

  assert.equal(budgetOf('textDocument/hover'), BUILD_REQUEST_TIMEOUT_MS, 'the first semantic request may take ten minutes')
  assert.equal(budgetOf('textDocument/definition'), 45000, 'the second one uses the configured timeout')
  assert.equal(client.timeout, 45000)
})

test('a request that is not semantic does not change the counter', async () => {
  const { store } = fakeStore()
  configureLsp(store)
  const client = lspClient()

  // The handshake of the library is not a semantic request, and neither is
  // any other request of the protocol.
  await client.request('workspace/executeCommand', { command: 'noop' })
  await client.request('textDocument/completion', hoverParams())

  assert.equal(budgetOf('workspace/executeCommand'), BUILD_REQUEST_TIMEOUT_MS, 'the other request got the long budget too')
  assert.equal(
    budgetOf('textDocument/completion'),
    BUILD_REQUEST_TIMEOUT_MS,
    'the counter did not move: the first semantic request may still take ten minutes',
  )
})

test('a request the server answered with an error counts as an answer', async () => {
  const { store } = fakeStore()
  configureLsp(store)
  const client = lspClient()

  // The server answers with an error: the request WAS answered, so the
  // program of the project is built and the next request is a short one.
  // The host counts the same thing, and the two sides have to agree - if the
  // host switched to the short budget while the client still waited with the
  // long one, the host would kill the very server the client waits for.
  const socket = FakeSocket.instances[FakeSocket.instances.length - 1]
  const originalSend = socket.send.bind(socket)
  socket.send = (text) => {
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
    if (parsed?.method === 'textDocument/hover') {
      socket.emit('message', {
        data: JSON.stringify({ jsonrpc: '2.0', id: parsed.id, error: { code: -1, message: 'boom' } }),
      })
      return
    }
    originalSend(text)
  }

  await assert.rejects(() => client.request('textDocument/hover', hoverParams()))
  await client.request('textDocument/definition', hoverParams())

  assert.equal(
    budgetOf('textDocument/definition'),
    45000,
    'the server answered, so the configured timeout is the right budget again',
  )
})

test('the deadline of the client does not count as an answer', () => {
  // The library gives up on a request with exactly this error
  // (`new Error("Request timed out")`), and it is the one rejection that
  // means the server did NOT answer: the program of the project may still be
  // building, so the long budget has to stay in effect.
  //
  // The library's own deadline cannot be reached in a test without waiting
  // for it (ten minutes), so the rule is pinned where it lives.
  assert.equal(isClientDeadline(new Error('Request timed out')), true, "the client's own deadline")
  assert.equal(isClientDeadline(new Error('request timed out')), true, 'the deadline, in lower case')

  // The server answered with an error: that is an answer.
  assert.equal(isClientDeadline({ code: -1, message: 'boom' }), false, 'the error of the server')
  assert.equal(isClientDeadline(new Error('boom')), false, 'an ordinary failure')

  // A server whose error message mentions a timeout is not the client's own
  // deadline: the check is exact on purpose.
  assert.equal(isClientDeadline(new Error('the operation timed out')), false, 'a message that mentions a timeout')
})

test('the budget is reset when the host reports a new language server process', async () => {
  const { store, setProcessId } = fakeStore()
  configureLsp(store)
  const client = lspClient()

  // The host reports the running language server process. The first value the
  // client sees is the baseline of the comparison: nothing was replaced yet.
  setProcessId(1)

  await client.request('textDocument/hover', hoverParams())
  await client.request('textDocument/definition', hoverParams())
  assert.equal(client.timeout, 45000, 'the configured timeout applies after the first answer')

  // The language server crashed and the host started a new one. The socket
  // between the browser and the host stays open - only the process is
  // replaced - so the status is the only way the client learns about it.
  setProcessId(2)
  assert.equal(
    client.timeout,
    BUILD_REQUEST_TIMEOUT_MS,
    'the new process has to build the program of the project again',
  )

  // The next request uses the long budget as well.
  await client.request('textDocument/hover', hoverParams())
  assert.equal(
    budgetOf('textDocument/hover'),
    BUILD_REQUEST_TIMEOUT_MS,
    'the first semantic request of the new process may take ten minutes',
  )
})

test('the first process the client sees is not a restart', async () => {
  const { store, setProcessId } = fakeStore()
  configureLsp(store)
  const client = lspClient()

  // The first process identity the client sees: there was no server before,
  // so nothing was replaced and the budget must not move.
  setProcessId(7)

  await client.request('textDocument/hover', hoverParams())
  await client.request('textDocument/definition', hoverParams())
  assert.equal(client.timeout, 45000, 'the configured timeout applies after the first answer')

  setProcessId(7)

  assert.equal(client.timeout, 45000, 'the budget did not move')
})

test('a server that was replaced before the first poll resets the budget', async () => {
  const { store, setProcessId } = fakeStore()
  configureLsp(store)
  const client = lspClient()

  // The client gets an answer from a server whose identity it never saw: the
  // status poll has not run yet. If that server is replaced before the first
  // poll, the identity the client sees belongs to a NEW process - and the
  // program of the project has to be built again.
  await client.request('textDocument/hover', hoverParams())
  await client.request('textDocument/definition', hoverParams())
  assert.equal(client.timeout, 45000, 'the configured timeout applies after the first answer')

  setProcessId(3)

  assert.equal(
    client.timeout,
    BUILD_REQUEST_TIMEOUT_MS,
    'the identity belongs to a process the client never talked to: the long budget is right',
  )
})

test('the status bar says that the index is built while the program is built', async () => {
  const mod = await loadWorkbenchModule()
  const t = key => key
  // The state of the session says "ready" long before the program of the
  // project is built: the server answers `initialize` within milliseconds
  // and the build takes minutes - on the first semantic request. The status
  // bar must not say "ready" then (review T7).
  const building = mod.lspStatusView({ t }, {
    lsp: { enabled: true, state: 'ready', buildingProgram: true, languageId: 'typescript' },
    settings: { lsp: { enabled: true } },
  })
  assert.equal(building.key, 'buildingProgram')
  assert.equal(building.text, 'lsp.status.buildingProgram')
  assert.equal(building.tone, 'warn', 'the wait is visible, so the item is not green')

  // Without the flag the state keeps its old meaning.
  const ready = mod.lspStatusView({ t }, {
    lsp: { enabled: true, state: 'ready', buildingProgram: false, languageId: 'typescript' },
    settings: { lsp: { enabled: true } },
  })
  assert.equal(ready.key, 'ready')
  assert.equal(ready.text, 'lsp.status.ready')
  assert.equal(ready.tone, 'ok')

  // A failing server is more important than the build.
  const unstable = mod.lspStatusView({ t }, {
    lsp: {
      enabled: true,
      state: 'ready',
      buildingProgram: true,
      languageId: 'typescript',
      consecutiveFailures: 3,
      consecutiveTimeouts: 0,
    },
    settings: { lsp: { enabled: true } },
  })
  assert.equal(unstable.key, 'unstable', 'the failing server wins over the build')
  assert.equal(unstable.tone, 'warn')
})

test('the store mirrors the identity of the server process and the build of the program', async () => {
  const store = new WorkbenchStore({ locale: { subscribe: () => () => {} } }, key => key)
  store.state = {
    ...store.state,
    root: 'C:\\work\\demo',
    settings: { editor: {}, shortcuts: {}, lsp: { enabled: true } },
  }
  const status = {
    enabled: true,
    state: 'ready',
    languageId: '',
    indexedRoots: [],
    processId: 7,
    buildingProgram: true,
  }
  const restore = mockStatusFetch(status)
  try {
    await store.refreshLspStatus()
  } finally {
    restore()
  }
  assert.equal(store.state.lsp.processId, 7, 'the identity of the server process is mirrored')
  assert.equal(store.state.lsp.buildingProgram, true, 'the build of the program is mirrored')

  // The status is polled every two seconds: a poll that changes nothing must
  // not wake the workbench. The two new fields are part of the comparison,
  // so a new process is published - and nothing else is.
  let wakes = 0
  const unsubscribe = store.subscribe(() => { wakes += 1 })
  const restore2 = mockStatusFetch(status)
  try {
    await store.refreshLspStatus()
  } finally {
    restore2()
    unsubscribe()
  }
  assert.equal(wakes, 0, 'the poll changed nothing, so nothing was published')

  // A new process changes the snapshot, so the store publishes it - that is
  // how the client learns that the language server was replaced.
  const restore3 = mockStatusFetch({ ...status, processId: 8 })
  try {
    await store.refreshLspStatus()
  } finally {
    restore3()
  }
  assert.equal(store.state.lsp.processId, 8, 'the new process is published')
})
