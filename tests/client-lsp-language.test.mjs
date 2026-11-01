/**
 * The language reported to the host with `lsp.start` (PRD-v5.1 JS-04).
 *
 * The host falls back to its own `detectLanguage()` when the client does not
 * name a language, and that heuristic prefers the markers of a TypeScript
 * project. A mixed repository (a `package.json` next to a `pom.xml`) is
 * therefore judged TypeScript, so a `.java` file opened in it started a
 * TypeScript server that could not answer a single Java request — the Java
 * server was never even asked to start.
 *
 * The client answers the question it can answer better: the language of the
 * file on the screen. It must NOT answer it when the file is not a real file
 * tab, does not live under the root the session is started for, or maps onto a
 * language the host has no server for — in those cases `languageId` is absent
 * and the host's own detection decides, which is the behaviour every language
 * had before.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WorkbenchStore } from '../src/client/store.js'
import { configureLsp, releaseLspForStore, scopeRootFor, setLspLanguageHint } from '../src/client/lsp-session.js'

/** Wait one moment of the event loop. */
function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

const ROOT = 'C:\\work\\demo'
const JAVA_FILE = 'C:\\work\\demo\\src\\Demo.java'
const TEXT_FILE = 'C:\\work\\demo\\notes.txt'
const HTML_FILE = 'C:\\work\\demo\\index.html'
const OUTSIDE_JAVA_FILE = 'C:\\work\\other\\Side.java'

/** The settings of a workbench with the semantic features switched on. */
function lspSettings(extra = {}) {
  return {
    editor: { openMode: 'auto', editableMaxBytes: 1 << 20 },
    shortcuts: {},
    lsp: { enabled: true, indexOnOpen: 'ask', ...extra },
  }
}

/** One open editor tab of a file. */
function fileTab(path) {
  return { id: `file:${path}`, kind: 'file', path, name: path.split('\\').pop() }
}

/**
 * A store with one project root, without booting the host.
 * @param {any[]} [tabs] the open tabs
 * @param {string | null} [activeId] the active tab
 * @param {object} [options]
 * @param {object} [options.lsp] extra keys of the `lsp` settings section
 * @param {object} [options.settings] extra top-level settings sections
 * @returns {any} the store
 */
function fakeStore(tabs = [], activeId = null, options = {}) {
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new WorkbenchStore(ctx, key => key)
  store.state = {
    ...store.state,
    workspaceRoot: ROOT,
    root: ROOT,
    phase: 'ready',
    tabs,
    activeId,
    settings: { ...lspSettings(options.lsp ?? {}), ...(options.settings ?? {}) },
  }
  return store
}

/**
 * Install a fetch mock that records every host call.
 *
 * `restartLsp()` is the public entry of a user-triggered restart: it shuts the
 * old session down and asks for a new one, which is exactly the call the test
 * has to inspect. The answers only have to keep the store alive; the status
 * poll behind the start is not part of the assertion.
 * @param {Array<{method: string, body: any}>} calls the recorded calls
 * @returns {() => void} restore the real fetch
 */
function mockFetch(calls) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/ide-workbench/api/')[1]
    const body = init?.body === undefined ? {} : JSON.parse(init.body)
    calls.push({ method, body })
    let value = {}
    if (method === 'lsp.start') value = { state: 'building' }
    else if (method === 'lsp.status') value = { enabled: true, state: 'idle' }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  return () => { globalThis.fetch = original }
}

/**
 * The body of the `lsp.start` call one restart produces.
 * @param {any[]} [tabs] the open tabs
 * @param {string | null} [activeId] the active tab
 * @returns {Promise<any>} the body the client posted
 */
async function startBody(tabs = [], activeId = null) {
  const calls = []
  const restore = mockFetch(calls)
  const store = fakeStore(tabs, activeId)
  try {
    await store.restartLsp()
    const start = calls.find(call => call.method === 'lsp.start')
    assert.ok(start !== undefined, 'the host was asked to start a language server')
    return start.body
  } finally {
    restore()
    store.persist.cancel()
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    if (store.lspPollTimer !== null) clearTimeout(store.lspPollTimer)
  }
}

test('a java file under the root reports its language to the host', async () => {
  const body = await startBody([fileTab(JAVA_FILE)], `file:${JAVA_FILE}`)
  // The host starts the java server instead of falling back to its own
  // detection, which would pick the TypeScript server of the mixed repo.
  assert.equal(body.languageId, 'java')
  assert.equal(body.root, ROOT)
})

test('the language of the active tab, not of any open tab, is reported', async () => {
  // A java tab is open, but the user is looking at a TypeScript file: the
  // session has to start the server of the file on the screen.
  const tab = fileTab('C:\\work\\demo\\src\\main.ts')
  const body = await startBody([fileTab(JAVA_FILE), tab], tab.id)
  assert.equal(body.languageId, 'typescript')
})

test('a file of a language without a server reports nothing', async () => {
  // `languageIdForPath` answers `plaintext` for an unknown extension, and the
  // host would refuse an id that is not in its registry.
  const text = await startBody([fileTab(TEXT_FILE)], `file:${TEXT_FILE}`)
  assert.ok(!('languageId' in text), 'plaintext is not a language to start a server for')
  // A known extension without a server of its own is filtered the same way:
  // the shared list, not the extension map, decides what can be started.
  const html = await startBody([fileTab(HTML_FILE)], `file:${HTML_FILE}`)
  assert.ok(!('languageId' in html), 'html has no server in the registry')
})

test('a file outside the root does not decide the language of the root', async () => {
  // The host keeps one language per root: a file of another project must not
  // pick the server of this one - the root's own detection decides instead.
  const body = await startBody([fileTab(OUTSIDE_JAVA_FILE)], `file:${OUTSIDE_JAVA_FILE}`)
  assert.ok(!('languageId' in body), 'a file outside the root is not reported')
})

test('no open file reports nothing', async () => {
  const body = await startBody()
  assert.ok(!('languageId' in body), 'the host detects the language when the client has no answer')
  assert.equal(body.force, false, 'the force flag of the restart is unchanged')
})

test('the memory pre-check and the start carry the same language', async () => {
  // The memory pre-check walks the same path as the start: the snapshot it
  // asks for has to be the one of the java server (2048 MB base), or the
  // client judges the memory of another language and the gate refuses a
  // start it never asked about.
  const calls = []
  const restore = mockFetch(calls)
  const store = fakeStore([fileTab(JAVA_FILE)], `file:${JAVA_FILE}`)
  try {
    await store.loadLspResources()
    const resources = calls.find(call => call.method === 'lsp.resources')
    assert.ok(resources !== undefined, 'the memory pre-check asked the host')
    assert.equal(resources.body.languageId, 'java')
    assert.equal(resources.body.root, ROOT)

    await store.restartLsp()
    const start = calls.find(call => call.method === 'lsp.start')
    assert.ok(start !== undefined, 'the host was asked to start the server')
    assert.equal(start.body.languageId, 'java', 'the pre-check and the start judge the same language')
  } finally {
    restore()
    store.persist.cancel()
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    if (store.lspPollTimer !== null) clearTimeout(store.lspPollTimer)
  }
})

/**
 * Run one scope request against the fetch mock, with a page base the session
 * can reach (the session does not ask a host it cannot address).
 * @param {Array<{method: string, body: any}>} calls the recorded calls
 * @param {string} root the root to ask the scope for
 * @returns {Promise<string>} the scope root the session resolved
 */
async function scopeWithMock(calls, root) {
  const originalDocument = globalThis.document
  globalThis.document = { baseURI: 'http://localhost/' }
  try {
    return await scopeRootFor(root)
  } finally {
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
  }
}

test('the session language hint reaches the lsp.scope request', async () => {
  // The handshake rootUri and the cwd of the host server must name the same
  // sub-project: the scope request carries the language of the file the
  // workbench is starting the server for (PRD-v5 §4.2, JS-04).
  const calls = []
  const restore = mockFetch(calls)
  try {
    setLspLanguageHint(ROOT, 'java')
    const scope = await scopeWithMock(calls, ROOT)
    // The mock host does not narrow the scope, so the workspace root stays.
    assert.equal(scope, ROOT)
    const request = calls.find(call => call.method === 'lsp.scope')
    assert.ok(request !== undefined, 'the host was asked for the scope')
    assert.deepEqual(request.body, { root: ROOT, languageId: 'java' })
  } finally {
    restore()
  }
})

test('the hint of another root does not leak into the scope request', async () => {
  const calls = []
  const restore = mockFetch(calls)
  const otherRoot = 'C:\\work\\other'
  try {
    setLspLanguageHint(otherRoot, 'python')
    await scopeWithMock(calls, ROOT)
    const request = calls.find(call => call.method === 'lsp.scope')
    assert.ok(request !== undefined, 'the host was asked for the scope')
    assert.equal(request.body.root, ROOT)
    assert.ok(!('languageId' in request.body), 'the hint belongs to another root and is not used')
    assert.notEqual(request.body.languageId, 'python')
  } finally {
    restore()
  }
})

/**
 * Build a store that is about to switch from an inner project to its parent.
 *
 * The outgoing tab is a java file INSIDE the incoming (ancestor) root, so a
 * language check that only asks `isPathWithin` would call the incoming root
 * java. The incoming root's persisted `activePath` is a TypeScript file: that
 * is the language its server must be started and scoped with.
 * @param {Array<{method: string, body: any}>} calls the recorded host calls
 * @returns {{ store: any, outgoingRoot: string, incomingRoot: string, restore: () => void, finish: () => void }}
 */
function switchingStore(calls) {
  const incomingRoot = 'C:\\work'
  const outgoingRoot = 'C:\\work\\app'
  const outgoingJava = 'C:\\work\\app\\src\\Demo.java'
  const restoredTs = 'C:\\work\\web\\main.ts'
  const restore = mockFetch(calls)
  const store = fakeStore([fileTab(outgoingJava)], `file:${outgoingJava}`, {
    lsp: { indexOnOpen: 'always' },
    settings: { workspaceState: { [incomingRoot]: { activePath: restoredTs } } },
  })
  store.state = {
    ...store.state,
    workspaceRoot: incomingRoot,
    root: outgoingRoot,
    projects: [
      { path: incomingRoot, name: 'work' },
      { path: outgoingRoot, name: 'app' },
    ],
  }
  return {
    store,
    incomingRoot,
    outgoingRoot,
    restore,
    finish() {
      restore()
      store.persist.cancel()
      if (store.toastTimer !== null) clearTimeout(store.toastTimer)
      if (store.lspPollTimer !== null) clearTimeout(store.lspPollTimer)
    },
  }
}

test('a project switch primes the incoming root from its restored tab, not the outgoing tab', async () => {
  const calls = []
  const harness = switchingStore(calls)
  const { store, incomingRoot } = harness
  const originalDocument = globalThis.document
  globalThis.document = { baseURI: 'http://localhost/' }
  try {
    const switched = await store.selectProject(incomingRoot, { askIndex: false })
    assert.equal(switched, true, 'the project was switched')

    // The start of the incoming root carries ITS restored language: the
    // outgoing java tab lives inside the ancestor root and must not decide it.
    const start = calls.find(call => call.method === 'lsp.start' && call.body.root === incomingRoot)
    assert.ok(start !== undefined, 'the incoming root was started')
    assert.equal(start.body.languageId, 'typescript', 'the restored tab of the incoming root')
    assert.notEqual(start.body.languageId, 'java', 'the outgoing tab must not leak')

    // The hint was primed BEFORE the root changed (it is what the session's
    // own `lsp.scope` request reads): the scope request of the incoming root
    // carries the same language.
    calls.length = 0
    await scopeRootFor(incomingRoot)
    const scope = calls.find(call => call.method === 'lsp.scope')
    assert.ok(scope !== undefined, 'the session asked for the scope of the incoming root')
    assert.equal(scope.body.languageId, 'typescript', 'the primed hint, not the outgoing java tab')
  } finally {
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
    harness.finish()
  }
})

test('the memory pre-check of an incoming root uses its restored language', async () => {
  // The pre-check runs BEFORE the root changes: the outgoing tab is still the
  // active one, so only the runtime-root guard plus the restored state can
  // keep the incoming root from being judged as java.
  const calls = []
  const harness = switchingStore(calls)
  const { store, incomingRoot } = harness
  try {
    const switched = await store.selectProject(incomingRoot)
    assert.equal(switched, true, 'the project was switched')
    const resources = calls.find(call => call.method === 'lsp.resources')
    assert.ok(resources !== undefined, 'the memory pre-check ran for the incoming root')
    assert.equal(resources.body.root, incomingRoot)
    assert.equal(resources.body.languageId, 'typescript', 'the restored tab of the incoming root')
    assert.notEqual(resources.body.languageId, 'java', 'the outgoing tab must not leak')
  } finally {
    harness.finish()
  }
})

test('the restored active path decides the language when no tab is open', async () => {
  // The restore path starts the server before the tabs are replayed: without
  // the persisted `activePath` the start of a `.java` project would carry no
  // language and the host would fall back to its own detection.
  const calls = []
  const restore = mockFetch(calls)
  const store = fakeStore([], null, {
    settings: { workspaceState: { [ROOT]: { activePath: JAVA_FILE } } },
  })
  try {
    await store.restartLsp()
    const start = calls.find(call => call.method === 'lsp.start')
    assert.ok(start !== undefined, 'the host was asked to start the server')
    assert.equal(start.body.languageId, 'java', 'the persisted activePath decides without any tab')
  } finally {
    restore()
    store.persist.cancel()
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    if (store.lspPollTimer !== null) clearTimeout(store.lspPollTimer)
  }
})

// ── R6-1: the init handshake is primed before the root is set ───────────

/**
 * The boot of the real workbench: a store, the real semantic session and a
 * fetch mock that answers the routes of `store.init()`.
 *
 * The socket is replaced by a stub that never opens: the session's first
 * `lsp.scope` request goes out before the handshake, and the real socket
 * would only add a reconnect loop to the test.
 * @param {{ settings: object, list: object }} answers the fixed answers
 * @param {Array<{method: string, body: any}>} calls the recorded requests
 * @returns {object} the store and the restore pair
 */
function bootStore(answers, calls) {
  const originalFetch = globalThis.fetch
  const originalDocument = globalThis.document
  const originalWebSocket = globalThis.WebSocket
  globalThis.document = { baseURI: 'http://localhost/' }
  globalThis.WebSocket = class StubSocket {
    constructor() {
      this.readyState = 0
      this.listeners = new Map()
      // The socket never opens: it reports its death right away, so the
      // session's connect rejects immediately instead of waiting for the
      // 30 s handshake budget of the library.
      setTimeout(() => this.emit('close', { code: 1006, reason: 'stub' }), 0)
    }
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set())
      this.listeners.get(type).add(handler)
    }
    removeEventListener(type, handler) {
      this.listeners.get(type)?.delete(handler)
    }
    emit(type, event) {
      for (const handler of [...(this.listeners.get(type) ?? [])]) handler(event)
    }
    send() {
      throw new Error('the stub socket never opens')
    }
    close() {
      this.readyState = 3
    }
  }
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/ide-workbench/api/')[1]
    const body = init?.body === undefined ? {} : JSON.parse(init.body)
    calls.push({ method, body })
    // The scope answer is deliberately slow: the test asserts the recorded
    // request and then releases the session BEFORE the answer arrives, so the
    // client is never connected (the library's handshake would keep a 30 s
    // request timer alive in the test process). This is the same race the
    // workbench has on a real switch, where the session may end while the
    // host is still being asked for the scope.
    if (method === 'lsp.scope') await sleep(1000)
    let value = {}
    if (method === 'settings.get') value = { file: '', value: answers.settings }
    else if (method === 'workspace.list') value = answers.list
    else if (method === 'workspace.projects') value = { projects: [] }
    else if (method === 'lsp.servers') value = { available: [], missing: [] }
    else if (method === 'lsp.status') value = { enabled: true, state: 'idle', detail: null, languageId: null }
    else if (method === 'lsp.scope') value = { scopeRoot: answers.root, languageId: answers.languageId }
    else if (method === 'lsp.resources') value = { decision: 'ok', canIndex: true, languageId: answers.languageId }
    else if (method === 'lsp.start') value = { state: 'building' }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new WorkbenchStore(ctx, key => key)
  return {
    store,
    restore() {
      globalThis.fetch = originalFetch
      if (originalDocument === undefined) delete globalThis.document
      else globalThis.document = originalDocument
      if (originalWebSocket === undefined) delete globalThis.WebSocket
      else globalThis.WebSocket = originalWebSocket
    },
  }
}

test('the init handshake is primed with the restored language', async () => {
  // R6-1: the boot sets the settings/workspace first, primes the language of
  // the initial root and only then sets the root. If the root went in first,
  // the session would ask the host for the scope WITHOUT a language, and the
  // `lsp.scope` body and the `lsp.start` body would disagree.
  const root = mkdtempSync(join(tmpdir(), 'iwb-init-primed-'))
  const demoFile = join(root, 'src', 'Demo.java')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(demoFile, 'class Demo {}\n')
  const settings = {
    editor: { openMode: 'auto', editableMaxBytes: 1 << 20 },
    shortcuts: {},
    lsp: { enabled: true, indexOnOpen: 'always' },
    // The root of the last session: `#pickRoot` restores it and the store
    // boots into it (no preferred root is passed to the store).
    lastRoot: root,
    workspaceState: { [root]: { activePath: demoFile } },
  }
  const calls = []
  const boot = bootStore({ settings, list: { items: [], defaultDirectory: root }, root, languageId: 'java' }, calls)
  const { store } = boot
  try {
    configureLsp(store)
    await store.init()

    // The scope request of the session is asynchronous: wait for it (bounded).
    let scope
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      scope = calls.find(call => call.method === 'lsp.scope' && call.body.root === root)
      if (scope !== undefined) break
      await sleep(20)
    }
    assert.ok(scope !== undefined, `the session asked the host for the scope (${calls.map(call => call.method).join(', ')})`)
    assert.equal(scope.body.languageId, 'java', 'the init handshake is primed with the restored activePath')

    const start = calls.find(call => call.method === 'lsp.start' && call.body.root === root)
    assert.ok(start !== undefined, 'the restored project was started')
    assert.equal(start.body.languageId, 'java', 'the start uses the same restored language')
    assert.equal(scope.body.languageId, start.body.languageId, 'the scope request and the start agree')
  } finally {
    try { releaseLspForStore(store) } catch { /* the unload must not throw */ }
    boot.restore()
    store.persist.cancel()
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    if (store.lspPollTimer !== null) clearTimeout(store.lspPollTimer)
    if (store.pollTimer !== null) clearTimeout(store.pollTimer)
    rmSync(root, { recursive: true, force: true })
  }
})

// ── R7-1: the witness is the tab the restore will ACTIVATE ──────────────

/**
 * Boot the real store into one persisted workspace state and assert that the
 * init handshake and the start name the same language.
 *
 * The witness of the language is the file `#restoreWorkspace` will activate:
 * the persisted `activePath` only when it is one of the restored tabs, else
 * the first restored tab. A stale `activePath` (a tab that is no longer
 * persisted) must not prime the handshake with the language of a file that is
 * not on the screen while the start uses the language of the one that is.
 * @param {(paths: { javaFile: string, staleTs: string }) => object} stateOf the
 *   persisted `workspaceState[root]` of the shape under test
 * @returns {Promise<void>}
 */
async function assertRestoredWitness(stateOf) {
  const root = mkdtempSync(join(tmpdir(), 'iwb-restored-witness-'))
  const javaFile = join(root, 'src', 'Main.java')
  const staleTs = join(root, 'web', 'app.ts')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'web'), { recursive: true })
  writeFileSync(javaFile, 'class Main {}\n')
  writeFileSync(staleTs, 'export const app = 1\n')
  const settings = {
    editor: { openMode: 'auto', editableMaxBytes: 1 << 20 },
    shortcuts: {},
    lsp: { enabled: true, indexOnOpen: 'always' },
    lastRoot: root,
    workspaceState: { [root]: stateOf({ javaFile, staleTs }) },
  }
  const calls = []
  const boot = bootStore({ settings, list: { items: [], defaultDirectory: root }, root, languageId: 'java' }, calls)
  const { store } = boot
  try {
    configureLsp(store)
    await store.init()

    // The scope request and the start are asynchronous: wait for both.
    let scope
    let start
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      scope = calls.find(call => call.method === 'lsp.scope' && call.body.root === root)
      start = calls.find(call => call.method === 'lsp.start' && call.body.root === root)
      if (scope !== undefined && start !== undefined) break
      await sleep(20)
    }
    assert.ok(scope !== undefined, `the session asked the host for the scope (${calls.map(call => call.method).join(', ')})`)
    assert.ok(start !== undefined, 'the restored project was started')
    assert.equal(scope.body.languageId, 'java', 'the restored active tab is the witness, not a stale activePath')
    assert.equal(start.body.languageId, 'java')
    assert.equal(scope.body.languageId, start.body.languageId, 'the scope request and the start agree')
  } finally {
    try { releaseLspForStore(store) } catch { /* the unload must not throw */ }
    boot.restore()
    store.persist.cancel()
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    if (store.lspPollTimer !== null) clearTimeout(store.lspPollTimer)
    if (store.pollTimer !== null) clearTimeout(store.pollTimer)
    rmSync(root, { recursive: true, force: true })
  }
}

test('the restored witness is the tab the restore activates, not a stale activePath', async () => {
  // Shape A: the persisted activePath points at a TypeScript file that is NOT
  // among the persisted tabs; the restore activates the first tab (the java
  // one). The handshake must be primed with java, like the start.
  await assertRestoredWitness(({ javaFile, staleTs }) => ({
    activePath: staleTs,
    tabs: [{ path: javaFile }],
  }))
})

test('the restored witness falls back to the first persisted tab without an activePath', async () => {
  // Shape B: no activePath at all; the restore activates the first tab.
  await assertRestoredWitness(({ javaFile }) => ({
    tabs: [{ path: javaFile }],
  }))
})
