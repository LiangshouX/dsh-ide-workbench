/**
 * PDF-01..PDF-07 - the bytes of a PDF travel as bytes.
 *
 * The read of a PDF used to answer the whole document as base64 inside the
 * JSON: a file of 20 MiB became a string of 27 MiB, the answer was parsed
 * into the store of the renderer, and the document was decoded a second time
 * before PDF.js saw it (PRD-v8 §3.2).
 *
 * The suite therefore pins down two things: the JSON answer carries the
 * metadata and nothing else, and the binary route serves the bytes - over
 * the same fence, inside the same workspace, and only for a PDF.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.js'
import { MAX_PDF_BYTES } from '../src/host/workspace.js'
import { fetchPdfBytes } from '../src/client/pdf-view.js'
import { WorkbenchStore } from '../src/client/store.js'

/**
 * A Cordis-like context that records the routes of the plugin.
 * @returns {object} the context and its records
 */
function fakeContext() {
  const routes = []
  const disposers = []
  const services = new Map()
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    get: (service) => services.get(service),
    provide(service, value) {
      services.set(service, value)
      return () => services.delete(service)
    },
    effect(execute) {
      const result = execute()
      if (typeof result === 'function') disposers.push(result)
      return () => {}
    },
    subprocess: { spawn() { throw new Error('the PDF test must not start a process') } },
    // The fence of the host: a request the host refuses is one the plugin
    // refuses too.
    connection: { requestRejection: (req) => (req?.headers?.['x-rejected'] !== undefined ? 'rejected' : undefined) },
    workspaceRegistry: { list: () => [], create: async () => ({ id: 'x', path: 'C:\\', title: 'x' }) },
    webServer: {
      register(spec) { routes.push(spec); return () => {} },
      registerUpgrade() { return () => {} },
    },
  }
  return { ctx, routes, disposers }
}

/**
 * A request of the JSON API.
 * @param {string} method the API method
 * @param {object} body the body of the request
 * @returns {any} the request
 */
function apiRequest(method, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  return {
    method: 'POST',
    url: `/ide-workbench/api/${method}`,
    headers: {},
    async *[Symbol.asyncIterator]() { yield payload },
  }
}

/**
 * A request of the binary route.
 * @param {string} root the workspace root
 * @param {string} path the path of the document
 * @param {{ method?: string, rejected?: boolean }} [options] the request
 * @returns {any} the request
 */
function rawRequest(root, path, options = {}) {
  const query = new URLSearchParams({ root, path })
  return {
    method: options.method ?? 'GET',
    url: `/ide-workbench/raw?${query.toString()}`,
    headers: options.rejected === true ? { 'x-rejected': '1' } : {},
  }
}

/**
 * A response that keeps what was written into it.
 * @returns {any} the response
 */
function fakeResponse() {
  return {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    status: 0,
    headers: {},
    body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers ?? {} },
    end(chunk) { this.writableEnded = true; this.body = chunk === undefined ? '' : chunk },
  }
}

/**
 * Mount the plugin and hand back its two routes.
 * @param {object} t the test
 * @returns {Promise<object>} the routes
 */
async function mountPlugin(t) {
  const profile = await mkdtemp(join(tmpdir(), 'iwb-pdf-profile-'))
  t.after(() => rm(profile, { recursive: true, force: true }))
  process.env.DSH_PROFILE_DIR = profile
  const { ctx, routes, disposers } = fakeContext()
  t.after(() => { for (const dispose of disposers) dispose() })
  apply(ctx)
  const api = routes.find(route => route.path === '/ide-workbench/api')
  const raw = routes.find(route => route.path === '/ide-workbench/raw')
  assert.ok(api, 'the plugin mounts its JSON route')
  assert.ok(raw, 'the plugin mounts its binary route')
  assert.equal(raw.kind, 'prefix', 'the binary route is a prefix route')
  return { api, raw }
}

/**
 * The bytes of the test document.
 * @returns {Buffer} the bytes
 */
function pdfBytes() {
  // "%PDF-1.7" plus a NUL byte: the old heuristic called this file binary.
  return Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37, 0x00, 0xFF])
}

test('the read of a PDF answers the metadata, and not the bytes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'iwb-pdf-bin-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const bytes = pdfBytes()
  await writeFile(join(dir, 'report.pdf'), bytes)
  const { api } = await mountPlugin(t)

  const response = fakeResponse()
  await api.handler(apiRequest('fs.read', { root: dir, path: join(dir, 'report.pdf') }), response)
  assert.equal(response.status, 200)
  const answer = JSON.parse(response.body)
  assert.equal(answer.ok, true)
  const value = answer.value
  assert.equal(value.kind, 'pdf')
  assert.equal(value.mime, 'application/pdf')
  assert.equal(value.size, bytes.length)
  assert.equal(value.path, 'report.pdf')
  assert.equal('data' in value, false, 'the answer carries no bytes')
  assert.equal('dataUrl' in value, false, 'the answer carries no bytes')
  // The answer of a document of 20 MiB is the same size as the answer of a
  // document of 20 bytes.
  assert.ok(response.body.length < 1024, `the answer is ${response.body.length} bytes long`)
})

test('the binary route serves the exact bytes of the document', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'iwb-pdf-bin-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const bytes = pdfBytes()
  await writeFile(join(dir, 'report.pdf'), bytes)
  const { raw } = await mountPlugin(t)

  const response = fakeResponse()
  await raw.handler(rawRequest(dir, 'report.pdf'), response)
  assert.equal(response.status, 200)
  assert.equal(response.headers['content-type'], 'application/pdf')
  assert.equal(response.headers['content-length'], String(bytes.length))
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.deepEqual(Buffer.from(response.body), bytes, 'the bytes are the bytes of the file')
})

test('the binary route refuses a path outside of the workspace', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'iwb-pdf-bin-'))
  const outside = await mkdtemp(join(tmpdir(), 'iwb-pdf-out-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await writeFile(join(outside, 'secret.pdf'), pdfBytes())
  const { raw } = await mountPlugin(t)

  const relative = fakeResponse()
  await raw.handler(rawRequest(dir, '../iwb-pdf-out-x/secret.pdf'), relative)
  assert.equal(relative.status, 403, 'a path that walks out of the workspace is refused')

  const absolute = fakeResponse()
  await raw.handler(rawRequest(dir, join(outside, 'secret.pdf')), absolute)
  assert.equal(absolute.status, 403, 'an absolute path outside of the workspace is refused')
})

test('the binary route refuses everything that is not a PDF', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'iwb-pdf-bin-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'notes.txt'), 'hello\n', 'utf8')
  await mkdir(join(dir, 'folder.pdf'))
  const { raw } = await mountPlugin(t)

  const text = fakeResponse()
  await raw.handler(rawRequest(dir, 'notes.txt'), text)
  assert.equal(text.status, 400, 'a text file is not a document of the viewer')

  const folder = fakeResponse()
  await raw.handler(rawRequest(dir, 'folder.pdf'), folder)
  assert.equal(folder.status, 400, 'a directory is not a document of the viewer')

  const missing = fakeResponse()
  await raw.handler(rawRequest(dir, 'gone.pdf'), missing)
  assert.equal(missing.status, 404, 'a document that is not there is not found')
})

test('the binary route refuses a document above the cap', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'iwb-pdf-bin-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  // A sparse file: the host answers from `stat` before it reads anything.
  const handle = await open(join(dir, 'huge.pdf'), 'w')
  await handle.truncate(MAX_PDF_BYTES + 1)
  await handle.close()
  const { raw } = await mountPlugin(t)

  const response = fakeResponse()
  await raw.handler(rawRequest(dir, 'huge.pdf'), response)
  assert.equal(response.status, 413, 'a document above the cap is refused')
  // The failure is reported in the envelope of the JSON API - and no byte of
  // the document is written.
  assert.equal(typeof response.body, 'string', 'the failure is a message, not bytes')
  assert.match(response.body, /too-large/)
})

test('the binary route passes the fence and answers GET only', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'iwb-pdf-bin-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'report.pdf'), pdfBytes())
  const { raw } = await mountPlugin(t)

  const rejected = fakeResponse()
  await raw.handler(rawRequest(dir, 'report.pdf', { rejected: true }), rejected)
  assert.equal(rejected.status, 403, 'a request the host refuses is refused here too')

  const posted = fakeResponse()
  await raw.handler(rawRequest(dir, 'report.pdf', { method: 'POST' }), posted)
  assert.equal(posted.status, 405, 'the route serves GET only')
})

test('the client fetches the bytes and hands them to the parser', async () => {
  const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255])
  const asked = []
  const result = await fetchPdfBytes('http://dsh.internal/ide-workbench/raw?root=r&path=a.pdf', {
    fetch: async (url) => {
      asked.push(url)
      return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer }
    },
  })
  assert.deepEqual(Array.from(result), Array.from(bytes), 'the bytes arrive unchanged')
  assert.equal(asked.length, 1, 'the document is fetched once')
})

test('a document that cannot be read is an error, not an empty document', async () => {
  await assert.rejects(
    () => fetchPdfBytes('http://dsh.internal/ide-workbench/raw', {
      fetch: async () => ({ ok: false, status: 403 }),
    }),
    /HTTP 403/,
    'the viewer has to know that the document is not there',
  )
  await assert.rejects(
    () => fetchPdfBytes('', { fetch: async () => ({ ok: true, status: 200 }) }),
    /no source/,
    'a document without a source is an error',
  )
})

test('the store keeps the metadata of a PDF, and not its bytes', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        ok: true,
        value: { kind: 'pdf', mime: 'application/pdf', size: 1234, mtimeMs: 7, path: 'report.pdf' },
      }
    },
  })
  try {
    const store = new WorkbenchStore({ locale: { subscribe: () => () => {} } }, key => key)
    store.state = { ...store.state, root: 'C:\\work\\demo' }
    store.openFile('C:\\work\\demo\\report.pdf')
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (store.state.tabs[0]?.payload !== undefined) break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    const payload = store.state.tabs[0]?.payload
    assert.ok(payload !== undefined, 'the tab is loaded')
    assert.equal(payload.kind, 'pdf')
    assert.equal('data' in payload, false, 'the store keeps no bytes of the document')
    // The URL of the bytes is built from the root and the relative path: the
    // host resolves the root itself.
    const url = store.rawUrl('C:\\work\\demo\\docs\\report.pdf')
    assert.match(url, /\/ide-workbench\/raw\?/)
    assert.match(url, /root=C%3A%5Cwork%5Cdemo/)
    assert.match(url, /path=docs%2Freport\.pdf/)
  } finally {
    globalThis.fetch = original
  }
})
