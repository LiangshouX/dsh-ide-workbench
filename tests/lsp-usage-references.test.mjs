/**
 * USAGE-01: "find usages" has to show the references of the files that are
 * not open in an editor (PRD-v5 supplement §3.1, §3.2).
 *
 * The library's own `Workspace.requestFile` only knows the files that have an
 * editor, and `findReferences` drops every reference whose file is not in
 * that list - which is why the panel was almost always empty. The workbench
 * workspace reads the missing files from the disk instead, through the host's
 * `fs.read` route, so that the fence of the host applies as well.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkbenchWorkspace } from '../src/client/lsp-workspace.js'

/**
 * A host stub that answers `fs.read` with the files of one fake project.
 *
 * The client transport is the real one (`fetch` against the route of the
 * plugin), so the test replaces `globalThis.fetch` - the same way the other
 * client tests do it.
 * @param {Record<string, string>} files the files of the project, by path
 * @returns {{calls: any[], restore: () => void}} the recorded calls
 */
function hostStub(files) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/').pop()
    const body = init?.body === undefined ? {} : JSON.parse(init.body)
    calls.push({ method, body })
    if (method !== 'fs.read') {
      return { ok: true, status: 200, async json() { return { ok: true, value: {} } } }
    }
    const content = files[body.path]
    if (content === undefined) {
      return { ok: false, status: 404, async json() { return { ok: false, error: { code: 'not-found', message: 'file not found' } } } }
    }
    const value = { kind: 'text', content, path: body.path }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  return {
    calls,
    restore() { globalThis.fetch = original },
  }
}

/**
 * A recording client: the workspace only ever calls these two methods.
 * @returns {{calls: any[], didOpen: Function, didClose: Function}} the client
 */
function recordingClient() {
  const calls = []
  return {
    calls,
    didOpen(file) {
      calls.push({ kind: 'didOpen', uri: file.uri, text: file.doc.toString() })
    },
    didClose(uri) {
      calls.push({ kind: 'didClose', uri })
    },
  }
}

/**
 * A workbench store with one project and no open tab.
 * @param {object} [options]
 * @returns {{store: any, calls: any[]}} the store and the recorded calls
 */
function fakeStore(options = {}) {
  const calls = []
  const store = {
    state: {
      root: options.root ?? 'C:/work/demo',
      tabs: [],
      settings: { lsp: { enabled: true }, shortcuts: {} },
    },
    openFile(path, openOptions) {
      calls.push({ kind: 'openFile', path, options: openOptions })
    },
    toast(level, text, detail) {
      calls.push({ kind: 'toast', level, text, detail })
    },
    t(key) {
      return key
    },
  }
  return { store, calls }
}

test('a file that is not open is read from the disk', async () => {
  const host = hostStub({ 'C:\\work\\demo\\src\\other.ts': 'const other = 1\n' })
  try {
    const client = recordingClient()
    const { store } = fakeStore()
    const workspace = new WorkbenchWorkspace(client, store, {})
    const file = await workspace.requestFile('file:///C:/work/demo/src/other.ts')
    assert.ok(file !== null)
    assert.equal(file.uri, 'file:///C:/work/demo/src/other.ts')
    assert.equal(file.doc.toString(), 'const other = 1\n')
    assert.equal(file.languageId, 'typescript')
    assert.equal(file.version, 1)
    assert.equal(file.getView(), null)
  } finally {
    host.restore()
  }
})

test('the file of a reference is read through the host route of the plugin', async () => {
  const host = hostStub({ 'C:\\work\\demo\\src\\other.ts': 'const other = 1\n' })
  try {
    const client = recordingClient()
    const { store } = fakeStore()
    const workspace = new WorkbenchWorkspace(client, store, {})
    await workspace.requestFile('file:///C:/work/demo/src/other.ts')
    assert.equal(host.calls.length, 1)
    assert.equal(host.calls[0].method, 'fs.read')
    assert.equal(host.calls[0].body.root, 'C:/work/demo')
    assert.equal(host.calls[0].body.path, 'C:\\work\\demo\\src\\other.ts')
  } finally {
    host.restore()
  }
})

test('a file that is open is answered from the editor and never read', async () => {
  const host = hostStub({})
  try {
    const client = recordingClient()
    const { store } = fakeStore()
    const workspace = new WorkbenchWorkspace(client, store, {})
    workspace.openFile('file:///C:/work/demo/src/app.ts', 'typescript', null)
    const file = await workspace.requestFile('file:///C:/work/demo/src/app.ts')
    assert.ok(file !== null)
    assert.equal(file.getView(), null)
    assert.equal(host.calls.length, 0, 'the host was not asked for the file')
  } finally {
    host.restore()
  }
})

test('a path outside the project is not read and does not produce a toast', async () => {
  const host = hostStub({ 'C:\\elsewhere\\secret.ts': 'const secret = 1\n' })
  try {
    const client = recordingClient()
    const { store, calls } = fakeStore()
    const workspace = new WorkbenchWorkspace(client, store, {})
    const file = await workspace.requestFile('file:///C:/elsewhere/secret.ts')
    assert.equal(file, null)
    assert.equal(host.calls.length, 0, 'the host was not asked for the file')
    assert.equal(calls.find(call => call.kind === 'toast'), undefined, 'no toast was shown')
  } finally {
    host.restore()
  }
})

test('a file that cannot be read is answered with null', async () => {
  const host = hostStub({})
  try {
    const client = recordingClient()
    const { store } = fakeStore()
    const workspace = new WorkbenchWorkspace(client, store, {})
    const file = await workspace.requestFile('file:///C:/work/demo/src/missing.ts')
    assert.equal(file, null)
  } finally {
    host.restore()
  }
})

test('a binary file is answered with null', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() { return { ok: true, value: { kind: 'binary', size: 12 } } },
  })
  try {
    const client = recordingClient()
    const { store } = fakeStore()
    const workspace = new WorkbenchWorkspace(client, store, {})
    const file = await workspace.requestFile('file:///C:/work/demo/assets/logo.png')
    assert.equal(file, null)
  } finally {
    globalThis.fetch = original
  }
})

test('the files of one find cycle are read only once', async () => {
  const host = hostStub({ 'C:\\work\\demo\\src\\other.ts': 'const other = 1\n' })
  try {
    const client = recordingClient()
    const { store } = fakeStore()
    const workspace = new WorkbenchWorkspace(client, store, {})
    const first = await workspace.requestFile('file:///C:/work/demo/src/other.ts')
    const second = await workspace.requestFile('file:///C:/work/demo/src/other.ts')
    assert.equal(first, second, 'the same file object comes back')
    assert.equal(host.calls.length, 1, 'the file was read once')
  } finally {
    host.restore()
  }
})

test('the cache of a find cycle can be cleared', async () => {
  const host = hostStub({ 'C:\\work\\demo\\src\\other.ts': 'const other = 1\n' })
  try {
    const client = recordingClient()
    const { store } = fakeStore()
    const workspace = new WorkbenchWorkspace(client, store, {})
    await workspace.requestFile('file:///C:/work/demo/src/other.ts')
    workspace.clearRequestCache()
    await workspace.requestFile('file:///C:/work/demo/src/other.ts')
    assert.equal(host.calls.length, 2, 'the file was read again after the reset')
  } finally {
    host.restore()
  }
})

test('the cache never holds more than 64 files', async () => {
  const files = {}
  for (let index = 0; index < 70; index += 1) {
    files[`C:\\work\\demo\\src\\file${index}.ts`] = `const value${index} = 1\n`
  }
  const host = hostStub(files)
  try {
    const client = recordingClient()
    const { store } = fakeStore()
    const workspace = new WorkbenchWorkspace(client, store, {})
    for (let index = 0; index < 70; index += 1) {
      const uri = `file:///C:/work/demo/src/file${index}.ts`
      const file = await workspace.requestFile(uri)
      assert.ok(file !== null)
    }
    assert.equal(workspace.requestCache.size, 64, 'the oldest files were dropped')
    // The file that was read first is gone, the newest one is still there.
    assert.equal(workspace.requestCache.has('file:///C:/work/demo/src/file0.ts'), false)
    assert.equal(workspace.requestCache.has('file:///C:/work/demo/src/file69.ts'), true)
  } finally {
    host.restore()
  }
})

test('no tab is opened for a file that was read for a reference', async () => {
  const host = hostStub({ 'C:\\work\\demo\\src\\other.ts': 'const other = 1\n' })
  try {
    const client = recordingClient()
    const { store, calls } = fakeStore()
    const workspace = new WorkbenchWorkspace(client, store, {})
    await workspace.requestFile('file:///C:/work/demo/src/other.ts')
    assert.equal(calls.find(call => call.kind === 'openFile'), undefined)
    assert.equal(client.calls.length, 0, 'the server was not told about the file')
    assert.equal(workspace.files.length, 0, 'the file is not an open document')
  } finally {
    host.restore()
  }
})

test('the workspace knows the document of a file that was read', async () => {
  const host = hostStub({ 'C:\\work\\demo\\src\\other.ts': 'const other = 1\n' })
  try {
    const client = recordingClient()
    const { store } = fakeStore()
    const workspace = new WorkbenchWorkspace(client, store, {})
    await workspace.requestFile('file:///C:/work/demo/src/other.ts')
    const doc = workspace.documentFor('file:///C:/work/demo/src/other.ts')
    assert.ok(doc !== null)
    assert.equal(doc.toString(), 'const other = 1\n')
    assert.equal(workspace.documentFor('file:///C:/work/demo/src/unknown.ts'), null)
  } finally {
    host.restore()
  }
})
