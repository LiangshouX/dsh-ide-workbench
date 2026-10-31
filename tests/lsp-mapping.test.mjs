import test from 'node:test'
import assert from 'node:assert/strict'
import { LSPClient, Workspace } from '@codemirror/lsp-client'
import { Text } from '@codemirror/state'
import { computeChanges } from '../src/client/lsp-workspace.js'
import { sanitizeHTML } from '../src/client/lsp-sanitize.js'

/**
 * LSP-05 (PRD-v5 §3.5): a request is answered against the document as it
 * was when the request went out. When the user keeps typing meanwhile, the
 * position of the answer has to be mapped onto the current document -
 * otherwise a reference jumps into the wrong line.
 *
 * The test drives the real client and the real mapping of the library; only
 * the transport is a stub.
 */

const URI = 'file:///C:/work/demo/src/app.ts'

/**
 * A transport that answers the initialize handshake and ignores the rest.
 * @returns {any} the transport
 */
function stubTransport() {
  const handlers = new Set()
  return {
    sent: [],
    send(message) {
      this.sent.push(message)
      const parsed = JSON.parse(message)
      if (parsed.method !== 'initialize') return
      const response = JSON.stringify({
        jsonrpc: '2.0',
        id: parsed.id,
        result: {
          capabilities: {
            definitionProvider: true,
            referencesProvider: true,
            textDocumentSync: 2,
          },
        },
      })
      for (const handler of [...handlers]) handler(response)
    },
    subscribe(handler) {
      handlers.add(handler)
    },
    unsubscribe(handler) {
      handlers.delete(handler)
    },
  }
}

/**
 * A workspace whose only document is edited from the outside.
 */
class EditableWorkspace extends Workspace {
  constructor(client) {
    super(client)
    this.files = []
    this.content = ''
  }

  /** @param {string} content the new content of the document */
  setContent(content) {
    this.content = content
  }

  syncFiles() {
    const updates = []
    for (const file of this.files) {
      const previous = file.doc.toString()
      if (previous === this.content) continue
      const changes = computeChanges(previous, this.content)
      const prevDoc = file.doc
      file.doc = Text.of(this.content.split('\n'))
      file.version += 1
      updates.push({ file, prevDoc, changes })
    }
    return updates
  }

  openFile() {}

  closeFile() {}
}

test('a position of an old document is mapped onto the current one', async () => {
  const transport = stubTransport()
  const client = new LSPClient({
    rootUri: 'file:///C:/work/demo',
    // The library default is 3000 ms, which is far too short (PRD §0.2 #3).
    timeout: 30000,
    sanitizeHTML,
    workspace: created => new EditableWorkspace(created),
  })
  client.connect(transport)
  await client.initializing

  const workspace = client.workspace
  const before = 'const alpha = 1\n'
  const after = '  const alpha = 1\n'
  workspace.setContent(before)
  workspace.files.push({
    uri: URI,
    languageId: 'typescript',
    version: 1,
    doc: Text.of(before.split('\n')),
    getView: () => null,
  })

  // The mapping is taken before the request goes out.
  const mapping = client.workspaceMapping()
  // The user indents the line while the server is busy.
  workspace.setContent(after)
  client.sync()

  // The server answers with the position of "alpha" in the old document.
  const oldPosition = { line: 0, character: 6 }
  const mapped = mapping.mapPosition(URI, oldPosition)
  assert.equal(mapped, after.indexOf('alpha'))
  assert.equal(after.slice(mapped, mapped + 'alpha'.length), 'alpha')
  mapping.destroy()
})

test('withMapping keeps the position correct over a running request', async () => {
  const transport = stubTransport()
  const client = new LSPClient({
    rootUri: 'file:///C:/work/demo',
    timeout: 30000,
    sanitizeHTML,
    workspace: created => new EditableWorkspace(created),
  })
  client.connect(transport)
  await client.initializing

  const workspace = client.workspace
  const before = 'const alpha = 1\nconst beta = 2\n'
  const after = 'const alpha = 1\n  const beta = 2\n'
  workspace.setContent(before)
  workspace.files.push({
    uri: URI,
    languageId: 'typescript',
    version: 1,
    doc: Text.of(before.split('\n')),
    getView: () => null,
  })

  const mapped = await client.withMapping(async (mapping) => {
    // The edit happens while the request is running.
    workspace.setContent(after)
    client.sync()
    return mapping.mapPosition(URI, { line: 1, character: 6 })
  })
  assert.equal(mapped, after.indexOf('beta'))
  assert.equal(after.slice(mapped, mapped + 'beta'.length), 'beta')
})

test('an edit before the symbol shifts the mapped position as well', async () => {
  const transport = stubTransport()
  const client = new LSPClient({
    rootUri: 'file:///C:/work/demo',
    timeout: 30000,
    sanitizeHTML,
    workspace: created => new EditableWorkspace(created),
  })
  client.connect(transport)
  await client.initializing

  const workspace = client.workspace
  const before = 'const alpha = 1\n'
  const after = 'const prefix = 0\nconst alpha = 1\n'
  workspace.setContent(before)
  workspace.files.push({
    uri: URI,
    languageId: 'typescript',
    version: 1,
    doc: Text.of(before.split('\n')),
    getView: () => null,
  })

  const mapping = client.workspaceMapping()
  workspace.setContent(after)
  client.sync()
  const mapped = mapping.mapPosition(URI, { line: 0, character: 6 })
  assert.equal(mapped, after.indexOf('alpha'))
  mapping.destroy()
})

test('the client announces its capabilities after the handshake', async () => {
  const transport = stubTransport()
  const client = new LSPClient({
    rootUri: 'file:///C:/work/demo',
    timeout: 30000,
    sanitizeHTML,
    workspace: created => new EditableWorkspace(created),
  })
  client.connect(transport)
  await client.initializing
  assert.equal(client.serverCapabilities.definitionProvider, true)
  assert.equal(client.serverCapabilities.referencesProvider, true)
  client.disconnect()
})
