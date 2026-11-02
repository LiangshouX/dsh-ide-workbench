import test from 'node:test'
import assert from 'node:assert/strict'
import {
  composeCodeReference, fenceLabelForPath, formatFileMention, insertChatText, registerChatInput,
} from '../src/client/chat-bridge.js'
import { WorkbenchStore } from '../src/client/store.js'

const ROOT = 'C:\\work\\demo'

function chatStore(sessionId = 's1') {
  const ctx = {
    locale: { subscribe: () => () => {} },
    sidebarRight: { mounted: { getSnapshot: () => sessionId } },
  }
  const store = new WorkbenchStore(ctx, key => key)
  store.state = {
    ...store.state,
    workspaceRoot: ROOT,
    root: ROOT,
    phase: 'ready',
    settings: { editor: {}, shortcuts: {} },
  }
  return store
}

/** A fake composer action face that records one insertion. */
function fakeInput({ start = 0, end = 0, draftRev = 7 } = {}) {
  const calls = []
  return {
    calls,
    captureInsertion: () => ({ start, end, draftRev }),
    insertText: (text, span) => { calls.push({ text, span }); return true },
    persistDraft: () => { calls.push({ persisted: true }) },
  }
}

test('formatFileMention uses the composer @ grammar', () => {
  assert.equal(formatFileMention('src/app.js'), '@src/app.js')
  assert.equal(formatFileMention('src\\client\\store.js'), '@src/client/store.js')
  assert.equal(formatFileMention('./docs/', true), '@docs/')
  assert.equal(formatFileMention('docs\\guide', true), '@docs/guide/')
  assert.equal(formatFileMention('my notes/a.md'), '@"my notes/a.md"')
  assert.equal(formatFileMention('a\u0001b'), undefined)
  assert.equal(formatFileMention(''), undefined)
})

test('code references carry the line range and a fenced block', () => {
  assert.equal(fenceLabelForPath('C:\\x\\a.ts'), 'ts')
  assert.equal(fenceLabelForPath('a.unknown'), '')
  const message = composeCodeReference({
    mention: '@src/app.js', text: 'const a = 1\nconst b = 2', fromLine: 3, toLine: 4, path: 'src/app.js',
  })
  assert.match(message, /^@src\/app\.js \(L3-L4\)\n\n```js\nconst a = 1\nconst b = 2\n```\n$/)
  const single = composeCodeReference({ mention: '@a.py', text: 'x = 1', fromLine: 9, toLine: 9, path: 'a.py' })
  assert.match(single, /\(L9\)/)
  assert.match(single, /```python/)
})

test('long code selections are capped with a truncation marker', () => {
  const message = composeCodeReference({
    mention: '@big.txt', text: Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n'), fromLine: 1, toLine: 300,
  })
  assert.match(message, /truncated/)
  assert.ok(message.length < 18000)
})

test('insertChatText places a spaced reference at the caret and persists', () => {
  const input = fakeInput({ start: 12, end: 12 })
  const dispose = registerChatInput('s1', input)
  try {
    assert.equal(insertChatText('s1', '@src/app.js '), true)
    assert.equal(input.calls[0].text, ' @src/app.js ')
    assert.deepEqual(input.calls[0].span, { start: 12, end: 12, draftRev: 7 })
    assert.equal(input.calls[1].persisted, true)
  } finally {
    dispose()
  }
  assert.equal(insertChatText('s1', '@src/app.js '), false)
})

test('insertChatText never replaces an existing composer selection', () => {
  const input = fakeInput({ start: 4, end: 9 })
  const dispose = registerChatInput('s1', input)
  try {
    assert.equal(insertChatText('s1', '@a.js'), true)
    assert.equal(input.calls[0].span.start, 9)
    assert.equal(input.calls[0].span.end, 9)
  } finally {
    dispose()
  }
})

test('the first reference in an empty draft has no leading space', () => {
  const input = fakeInput({ start: 0, end: 0 })
  const dispose = registerChatInput('s1', input)
  try {
    assert.equal(insertChatText('s1', '@a.js '), true)
    assert.equal(input.calls[0].text, '@a.js ')
  } finally {
    dispose()
  }
})

test('store sends tree entries to the mounted chat composer', () => {
  const store = chatStore('s1')
  const input = fakeInput({ start: 0, end: 0 })
  const dispose = registerChatInput('s1', input)
  try {
    assert.equal(store.sendToChat([{ path: `${ROOT}\\src\\app.js` }]), true)
    assert.equal(input.calls[0].text, '@src/app.js ')
    assert.equal(store.state.toast?.kind, 'success')
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)

    assert.equal(store.sendToChat([{ path: `${ROOT}\\docs`, isDir: true }]), true)
    assert.equal(input.calls[2].text, '@docs/ ')
  } finally {
    dispose()
    store.persist.cancel()
  }
})

test('store reports an unavailable composer instead of dropping the action', () => {
  const store = chatStore('s1')
  try {
    assert.equal(store.sendToChat([{ path: `${ROOT}\\a.js` }]), false)
    assert.equal(store.state.toast?.kind, 'error')
    assert.equal(store.state.toast?.text, 'chat.unavailable')
  } finally {
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.persist.cancel()
  }
})

test('store sends a code selection with its line range', () => {
  const store = chatStore('s1')
  const input = fakeInput({ start: 0, end: 0 })
  const dispose = registerChatInput('s1', input)
  try {
    assert.equal(store.sendSelectionToChat({
      path: `${ROOT}\\src\\app.js`, rel: 'src/app.js', text: 'const a = 1', fromLine: 3, toLine: 3,
    }), true)
    assert.match(input.calls[0].text, /^@src\/app\.js \(L3\)\n\n```js\nconst a = 1\n```\n$/)
    assert.equal(store.state.toast?.kind, 'success')
  } finally {
    dispose()
    if (store.toastTimer !== null) clearTimeout(store.toastTimer)
    store.persist.cancel()
  }
})
