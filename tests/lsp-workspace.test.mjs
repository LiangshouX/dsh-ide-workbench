import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkbenchWorkspace, computeChanges } from '../src/client/lsp-workspace.js'
import { fileUriOf } from '../src/client/lsp-uri.js'

/**
 * The custom workspace is the heart of LSP-03 / LSP-04 (PRD-v5 §3.4): the
 * language server has to see the *draft* of a file, not the file on disk, and
 * it must never see a path outside the project.
 */

/**
 * A recording client: the workspace only ever calls these two methods.
 * @returns {{calls: Array<any>, didOpen: Function, didClose: Function}} the client
 */
function recordingClient() {
  const calls = []
  return {
    calls,
    didOpen(file) {
      calls.push({ kind: 'didOpen', uri: file.uri, version: file.version, text: file.doc.toString(), languageId: file.languageId })
    },
    didClose(uri) {
      calls.push({ kind: 'didClose', uri })
    },
  }
}

/**
 * A workbench store with one file tab.
 * @param {object} [options]
 * @returns {{store: any, calls: Array<any>}} the store and the recorded calls
 */
function recordingStore(options = {}) {
  const calls = []
  const tab = {
    id: 'file:C:/work/demo/src/app.ts',
    kind: 'file',
    path: 'C:/work/demo/src/app.ts',
    rel: 'src/app.ts',
    content: options.content ?? 'const onDisk = 1\n',
    draft: options.draft ?? 'const inDraft = 1\n',
    dirty: options.dirty ?? true,
  }
  const store = {
    state: {
      root: options.root ?? 'C:/work/demo',
      tabs: options.tabs ?? [tab],
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
  return { store, calls, tab }
}

/**
 * How many changes a change set carries.
 *
 * `ChangeSet.length` is the length of the document the set applies to, not
 * the number of changes - the changes themselves are iterated.
 * @param {any} changeSet the change set
 * @returns {number} the number of changes
 */
function changeCount(changeSet) {
  let count = 0
  changeSet.iterChanges(() => { count += 1 })
  return count
}

/**
 * The text that results from applying a change set.
 * @param {string} before the text before the change
 * @param {any} changeSet the change set
 * @returns {string} the text after the change
 */
function applyChanges(before, changeSet) {
  let result = ''
  let position = 0
  changeSet.iterChanges((fromA, toA, fromB, toB, inserted) => {
    result += before.slice(position, fromA) + inserted.toString()
    position = toA
  })
  result += before.slice(position)
  return result
}

test('the opened document carries the draft of the tab, not the disk content', () => {
  const client = recordingClient()
  const { store } = recordingStore({ content: 'const onDisk = 1\n', draft: 'const inDraft = 1\n', dirty: true })
  const workspace = new WorkbenchWorkspace(client, store, {})
  workspace.openFile('file:///C:/work/demo/src/app.ts', 'typescript', null)
  assert.equal(client.calls.length, 1)
  assert.equal(client.calls[0].kind, 'didOpen')
  assert.equal(client.calls[0].text, 'const inDraft = 1\n')
  assert.equal(client.calls[0].languageId, 'typescript')
  assert.equal(client.calls[0].version, 1)
})

test('a clean tab is announced with its saved content', () => {
  const client = recordingClient()
  const { store } = recordingStore({ content: 'const onDisk = 1\n', draft: 'const onDisk = 1\n', dirty: false })
  const workspace = new WorkbenchWorkspace(client, store, {})
  workspace.openFile('file:///C:/work/demo/src/app.ts', 'typescript', null)
  assert.equal(client.calls[0].text, 'const onDisk = 1\n')
})

test('the editor buffer wins over the tab when the view is available', () => {
  const client = recordingClient()
  const { store } = recordingStore({ content: 'const onDisk = 1\n', draft: 'const inDraft = 1\n', dirty: true })
  const workspace = new WorkbenchWorkspace(client, store, {})
  const view = { state: { doc: { toString: () => 'const typed = 1\n' } } }
  workspace.openFile('file:///C:/work/demo/src/app.ts', 'typescript', view)
  assert.equal(client.calls[0].text, 'const typed = 1\n')
})

test('syncFiles reports the draft and leaves an unchanged file alone', () => {
  const client = recordingClient()
  const { store, tab } = recordingStore({ content: 'const onDisk = 1\n', draft: 'const inDraft = 1\n', dirty: true })
  const workspace = new WorkbenchWorkspace(client, store, {})
  workspace.openFile('file:///C:/work/demo/src/app.ts', 'typescript', null)

  const unchanged = workspace.syncFiles()
  assert.equal(unchanged.length, 0)

  // The user keeps typing: the draft grows, the disk content stays.
  tab.draft = 'const inDraft = 2\n'
  const updates = workspace.syncFiles()
  assert.equal(updates.length, 1)
  assert.equal(updates[0].file.uri, 'file:///C:/work/demo/src/app.ts')
  assert.equal(updates[0].file.version, 2)
  assert.equal(updates[0].file.doc.toString(), 'const inDraft = 2\n')
  assert.equal(updates[0].prevDoc.toString(), 'const inDraft = 1\n')
  // The change is incremental, not a rewrite of the whole document.
  assert.equal(changeCount(updates[0].changes), 1)

  const again = workspace.syncFiles()
  assert.equal(again.length, 0)
})

test('the change of a sync carries the draft, not the disk content', () => {
  const client = recordingClient()
  const { store, tab } = recordingStore({ content: 'const onDisk = 1\n', draft: 'const inDraft = 1\n', dirty: true })
  const workspace = new WorkbenchWorkspace(client, store, {})
  workspace.openFile('file:///C:/work/demo/src/app.ts', 'typescript', null)
  tab.draft = 'const inDraft = 42\n'
  const [update] = workspace.syncFiles()
  assert.equal(applyChanges(update.prevDoc.toString(), update.changes), 'const inDraft = 42\n')
})

test('displayFile opens the file in the workbench and returns its editor', async () => {
  const client = recordingClient()
  const { store, calls } = recordingStore()
  const view = { state: { doc: { toString: () => '' } } }
  const workspace = new WorkbenchWorkspace(client, store, {
    viewRegistry: { waitForEditorView: async () => view },
  })
  const result = await workspace.displayFile('file:///C:/work/demo/src/app.ts')
  assert.equal(result, view)
  const opened = calls.find(call => call.kind === 'openFile')
  assert.ok(opened !== undefined)
  assert.equal(opened.path, 'C:\\work\\demo\\src\\app.ts')
  assert.equal(opened.options.preview, false)
})

test('displayFile refuses a path outside the project and never opens it', async () => {
  const client = recordingClient()
  const { store, calls } = recordingStore()
  const workspace = new WorkbenchWorkspace(client, store, {
    viewRegistry: { waitForEditorView: async () => ({ state: { doc: { toString: () => '' } } }) },
  })
  const result = await workspace.displayFile('file:///C:/elsewhere/secret.ts')
  assert.equal(result, null)
  assert.equal(calls.find(call => call.kind === 'openFile'), undefined)
  const toast = calls.find(call => call.kind === 'toast')
  assert.ok(toast !== undefined)
  assert.equal(toast.level, 'error')
  assert.equal(toast.text, 'lsp.outsideProject')
  assert.equal(toast.detail, 'C:\\elsewhere\\secret.ts')
})

test('a path that only shares a prefix with the root is outside the project', async () => {
  const client = recordingClient()
  const { store, calls } = recordingStore({ root: 'C:/work/demo' })
  const workspace = new WorkbenchWorkspace(client, store, {})
  assert.equal(workspace.insideRoot('C:\\work\\demo\\src\\app.ts'), true)
  assert.equal(workspace.insideRoot('C:\\work\\demo-other\\src\\app.ts'), false)
  assert.equal(await workspace.displayFile('file:///C:/work/demo-other/src/app.ts'), null)
  assert.equal(calls.find(call => call.kind === 'openFile'), undefined)
})

test('closeFile removes the document and tells the server', () => {
  const client = recordingClient()
  const { store } = recordingStore()
  const workspace = new WorkbenchWorkspace(client, store, {})
  workspace.openFile('file:///C:/work/demo/src/app.ts', 'typescript', null)
  assert.equal(workspace.files.length, 1)
  workspace.closeFile('file:///C:/work/demo/src/app.ts', null)
  assert.equal(workspace.files.length, 0)
  const closed = client.calls.find(call => call.kind === 'didClose')
  assert.ok(closed !== undefined)
  assert.equal(closed.uri, 'file:///C:/work/demo/src/app.ts')
})

/**
 * The fence of the workspace, the other way round: a document outside the
 * project must never reach the language server.
 *
 * The server only knows the documents of the project and answers every other
 * one with a complaint ("Unexpected resource …"), which the workbench would
 * turn into a fake error toast (review S8).
 */
test('a file inside the project is announced to the server', () => {
  const client = recordingClient()
  const { store } = recordingStore({ root: 'C:/work/demo' })
  const workspace = new WorkbenchWorkspace(client, store, {})
  workspace.openFile('file:///C:/work/demo/src/app.ts', 'typescript', null)
  const opened = client.calls.find(call => call.kind === 'didOpen')
  assert.ok(opened !== undefined, 'the server was told about the file')
  assert.equal(opened.uri, 'file:///C:/work/demo/src/app.ts')
})

test('a file outside the project is not announced to the server', () => {
  const client = recordingClient()
  const { store } = recordingStore({ root: 'C:/work/demo' })
  const workspace = new WorkbenchWorkspace(client, store, {})
  workspace.openFile('file:///C:/elsewhere/secret.ts', 'typescript', null)
  assert.equal(
    client.calls.find(call => call.kind === 'didOpen'),
    undefined,
    'the server was not told about the file',
  )
  // The file is still tracked: the editor needs it.
  assert.equal(workspace.files.length, 1)
  assert.equal(workspace.files[0].uri, 'file:///C:/elsewhere/secret.ts')
})

test('a file outside the project is not closed with the server', () => {
  const client = recordingClient()
  const { store } = recordingStore({ root: 'C:/work/demo' })
  const workspace = new WorkbenchWorkspace(client, store, {})
  workspace.openFile('file:///C:/elsewhere/secret.ts', 'typescript', null)
  workspace.closeFile('file:///C:/elsewhere/secret.ts', null)
  assert.equal(workspace.files.length, 0, 'the file is closed locally')
  assert.equal(
    client.calls.find(call => call.kind === 'didClose'),
    undefined,
    'the server was not told about a document it never knew',
  )
})

test('the changes of a file outside the project are not reported to the server', () => {
  const client = recordingClient()
  const { store } = recordingStore({ root: 'C:/work/demo' })
  const workspace = new WorkbenchWorkspace(client, store, {})
  let text = 'const typed = 1\n'
  const view = { state: { doc: { toString: () => text } } }
  workspace.openFile('file:///C:/elsewhere/secret.ts', 'typescript', view)
  text = 'const typed = 2\n'
  const updates = workspace.syncFiles()
  assert.equal(updates.length, 0, 'the server hears nothing about the file')
})

test('closeFile of an unknown document does nothing', () => {
  const client = recordingClient()
  const { store } = recordingStore()
  const workspace = new WorkbenchWorkspace(client, store, {})
  workspace.closeFile('file:///C:/work/demo/src/unknown.ts', null)
  assert.equal(client.calls.length, 0)
})

test('updateFile dispatches the transaction into the editor of the document', () => {
  const client = recordingClient()
  const { store } = recordingStore()
  const dispatched = []
  const view = { state: { doc: { toString: () => '' } }, dispatch: (tr) => dispatched.push(tr) }
  const workspace = new WorkbenchWorkspace(client, store, {})
  workspace.openFile('file:///C:/work/demo/src/app.ts', 'typescript', view)
  const transaction = { changes: { from: 0, to: 0, insert: 'x' } }
  workspace.updateFile('file:///C:/work/demo/src/app.ts', transaction)
  assert.deepEqual(dispatched, [transaction])
})

test('the change set of an edit is incremental', () => {
  const before = 'const a = 1\nconst b = 2\nconst c = 3\n'
  const after = 'const a = 1\nconst b = 22\nconst c = 3\n'
  const changes = computeChanges(before, after)
  assert.equal(changeCount(changes), 1)
  assert.equal(applyChanges(before, changes), after)
  // Only the changed line is touched, not the whole document.
  let touched = 0
  changes.iterChanges((fromA, toA) => { touched += toA - fromA })
  assert.ok(touched < before.length, `touched ${touched} of ${before.length}`)
})

test('the change set of an unchanged text is empty', () => {
  const text = 'const a = 1\n'
  assert.equal(changeCount(computeChanges(text, text)), 0)
})

test('the URI of a path round trips', () => {
  const path = 'C:\\work\\demo\\src\\app.ts'
  assert.equal(fileUriOf(path), 'file:///C:/work/demo/src/app.ts')
})
