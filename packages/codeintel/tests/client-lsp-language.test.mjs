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
 * The plugin answers the question it can answer better: the language of the
 * file on the screen. The file on the screen is the document the core
 * broadcasts through the contract, so the answer is the language of the
 * document — and it must NOT be reported when the document does not live
 * under the root the session is started for, or maps onto a language the
 * host has no server for.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { CodeIntelStore } from '../src/client/store.js'
import { configureLsp, releaseLspForStore, scopeRootFor, setLspLanguageHint } from '../src/client/lsp-session.js'
import { loadLspLibrary } from '../src/client/lsp-lib.js'
// The library of the language-server client is loaded lazily: the plugin may
// be installed alone, and the session needs the library to build its client.
await loadLspLibrary()

/** Wait one moment of the event loop. */
function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

const ROOT = 'C:\\work\\demo'
const JAVA_FILE = 'C:\\work\\demo\\src\\Demo.java'
const TEXT_FILE = 'C:\\work\\demo\\notes.txt'
const HTML_FILE = 'C:\\work\\demo\\index.html'
const OUTSIDE_JAVA_FILE = 'C:\\work\\other\\Side.java'

/** The settings of a plugin with the semantic features switched on. */
function lspSettings(extra = {}) {
  return {
    shortcuts: { goToDefinition: 'F12', findUsages: 'Alt+F7', findUsagesText: 'Alt+F8', complete: 'Ctrl+Space' },
    lsp: { enabled: true, indexOnOpen: 'ask', ...extra },
  }
}

/**
 * One open editor document of a file.
 * @param {string} path the absolute path of the file
 * @param {string} languageId the language of the document
 * @returns {any} the document
 */
function fileDocument(path, languageId) {
  return {
    uri: `file:///${path.replace(/\\/g, '/')}`,
    absolutePath: path,
    languageId,
    content: '',
    dirty: false,
  }
}

/**
 * A store with one project root, without booting the host.
 * @param {any[]} [documents] the documents of the core
 * @param {object} [options]
 * @param {object} [options.lsp] extra keys of the `lsp` settings section
 * @returns {any} the store
 */
function fakeStore(documents = [], options = {}) {
  const store = new CodeIntelStore({ t: key => key })
  store.state = {
    ...store.state,
    root: ROOT,
    settings: lspSettings(options.lsp ?? {}),
  }
  for (const document of documents) store.setDocument(document)
  return store
}

/**
 * Install a fetch mock that records every host call.
 * @param {Array<{method: string, body: any}>} calls the recorded calls
 * @returns {() => void} restore the real fetch
 */
function mockFetch(calls) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/dsh-codeintel/api/')[1]
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
 * @param {any[]} [documents] the documents of the core
 * @returns {Promise<any>} the body the client posted
 */
async function startBody(documents = []) {
  const calls = []
  const restore = mockFetch(calls)
  const store = fakeStore(documents)
  try {
    await store.restartLsp()
    const start = calls.find(call => call.method === 'lsp.start')
    assert.ok(start !== undefined, 'the host was asked to start a language server')
    return start.body
  } finally {
    restore()
    store.dispose()
  }
}

test('a java file under the root reports its language to the host', async () => {
  const body = await startBody([fileDocument(JAVA_FILE, 'java')])
  // The host starts the java server instead of falling back to its own
  // detection, which would pick the TypeScript server of the mixed repo.
  assert.equal(body.languageId, 'java')
  assert.equal(body.root, ROOT)
})

test('the language of the active document, not of any open document, is reported', async () => {
  // A java document was seen before, but the user is looking at a TypeScript
  // file: the session has to start the server of the file on the screen.
  const body = await startBody([
    fileDocument(JAVA_FILE, 'java'),
    fileDocument('C:\\work\\demo\\src\\main.ts', 'typescript'),
  ])
  assert.equal(body.languageId, 'typescript')
})

test('a file of a language without a server reports nothing', async () => {
  // The host would refuse an id that is not in its registry.
  const text = await startBody([fileDocument(TEXT_FILE, 'plaintext')])
  assert.ok(!('languageId' in text), 'plaintext is not a language to start a server for')
  // A known extension without a server of its own is filtered the same way:
  // the shared list, not the extension map, decides what can be started.
  const html = await startBody([fileDocument(HTML_FILE, 'html')])
  assert.ok(!('languageId' in html), 'html has no server in the registry')
})

test('no open file reports nothing', async () => {
  const body = await startBody()
  assert.ok(!('languageId' in body), 'the host detects the language when the client has no answer')
})

test('the memory pre-check and the start carry the same language', async () => {
  // The memory pre-check walks the same path as the start: the snapshot it
  // asks for has to be the one of the java server (2048 MB base), or the
  // client judges the memory of another language and the gate refuses a
  // start it never asked about.
  const calls = []
  const restore = mockFetch(calls)
  const store = fakeStore([fileDocument(JAVA_FILE, 'java')])
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
    store.dispose()
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
  // session is starting the server for (PRD-v5 §4.2, JS-04).
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

test('the document of the core primes the hint of the session', async () => {
  // The plugin does not guess the language: the core broadcasts the document
  // that is on the screen, and the plugin takes its language from there.
  const calls = []
  const restore = mockFetch(calls)
  const store = fakeStore()
  try {
    store.setDocument(fileDocument(JAVA_FILE, 'java'))
    const scope = await scopeWithMock(calls, ROOT)
    assert.equal(scope, ROOT)
    const request = calls.find(call => call.method === 'lsp.scope')
    assert.ok(request !== undefined, 'the host was asked for the scope')
    assert.equal(request.body.languageId, 'java')
  } finally {
    restore()
    store.dispose()
  }
})

test('the session of a released store is released with it', async () => {
  const store = fakeStore()
  configureLsp(store)
  // The release is idempotent: the store may release itself and the session
  // module may release it too.
  releaseLspForStore(store)
  releaseLspForStore(store)
  store.dispose()
  await sleep(5)
})
