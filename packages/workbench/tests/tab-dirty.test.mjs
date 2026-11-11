/**
 * R11 — the store side of the dirty state.
 *
 * The "open in the default browser" action refuses a file whose tab has
 * unsaved changes: the file on disk is not the file on screen. The store
 * answers the question, so the editor area does not have to know how a tab
 * records its edits.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkbenchStore } from '../src/client/store.js'

const ROOT = 'C:\\work\\demo'

function fakeStore() {
  const ctx = { locale: { subscribe: () => () => {} } }
  const store = new WorkbenchStore(ctx, key => key)
  store.state = {
    ...store.state,
    workspaceRoot: ROOT,
    root: ROOT,
    phase: 'ready',
    settings: { editor: { openMode: 'auto', editableMaxBytes: 1 << 20 }, shortcuts: {} },
  }
  return store
}

function fileTab(path, dirty) {
  return {
    id: `file:${path}`,
    kind: 'file',
    path,
    rel: path.slice(ROOT.length + 1),
    name: path.slice(path.lastIndexOf('\\') + 1),
    preview: false,
    pinned: true,
    loading: false,
    error: null,
    payload: { kind: 'text', content: 'saved', encoding: 'utf-8', size: 5, truncated: false },
    stats: { lines: 1, words: 1 },
    scrollTop: 0,
    editing: true,
    draft: dirty ? 'unsaved' : 'saved',
    dirty,
    saving: false,
    conflict: null,
  }
}

test('the store says whether a tab has unsaved changes', () => {
  const store = fakeStore()
  try {
    const clean = `${ROOT}\\index.html`
    const dirty = `${ROOT}\\notes.md`
    store.state.tabs = [fileTab(clean, false), fileTab(dirty, true)]
    assert.equal(store.isTabDirty(`file:${clean}`), false)
    assert.equal(store.isTabDirty(`file:${dirty}`), true)
    // A tab that is not open is not dirty.
    assert.equal(store.isTabDirty('file:C:\\work\\demo\\gone.html'), false)
    assert.equal(store.isTabDirty(''), false)
    assert.equal(store.isTabDirty(undefined), false)
  } finally {
    store.persist.cancel()
  }
})

test('the store says whether a file is open with unsaved changes', () => {
  const store = fakeStore()
  try {
    const clean = `${ROOT}\\index.html`
    const dirty = `${ROOT}\\notes.md`
    store.state.tabs = [fileTab(clean, false), fileTab(dirty, true)]
    assert.equal(store.isPathDirty(clean), false)
    assert.equal(store.isPathDirty(dirty), true)
    // A file that is not open at all is not dirty.
    assert.equal(store.isPathDirty(`${ROOT}\\other.html`), false)
    assert.equal(store.isPathDirty(''), false)
    assert.equal(store.isPathDirty(undefined), false)
  } finally {
    store.persist.cancel()
  }
})

test('a keystroke and a save move the dirty state', () => {
  const store = fakeStore()
  try {
    const path = `${ROOT}\\notes.md`
    const id = `file:${path}`
    store.state.tabs = [fileTab(path, false)]
    assert.equal(store.isTabDirty(id), false)
    store.updateDraft(id, 'a longer text')
    assert.equal(store.isTabDirty(id), true)
    assert.equal(store.isPathDirty(path), true)
    store.discardDraft(id)
    assert.equal(store.isTabDirty(id), false)
    assert.equal(store.isPathDirty(path), false)
  } finally {
    store.persist.cancel()
  }
})
