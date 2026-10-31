/**
 * Regression tests for the error report of the language server.
 *
 * `@codemirror/lsp-client` reports a failed request with
 * `showDialog(view, { top: true })`: a CodeMirror panel at the top of the
 * editor that is never closed, so one failed request covers the code until
 * the user clicks the cross. The workbench redirects the reports into its own
 * toast, which sits above the status bar and does not cover anything.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { LSPPlugin } from '@codemirror/lsp-client'
import { configureLsp, redirectErrorsToToast, shutdownLsp } from '../src/client/lsp-session.js'

/**
 * One fake WebSocket.
 *
 * The client sends its `initialize` request as soon as the socket is open.
 * The fake answers it, so the request never runs into its 30 second timeout
 * - a timeout would be an unhandled rejection at the end of the test run.
 */
class FakeSocket {
  constructor(url) {
    this.url = url
    this.readyState = 1
    this.sent = []
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
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {
      return
    }
    if (parsed?.method !== 'initialize') return
    this.emit('message', {
      data: JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { capabilities: {} } }),
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
 * One fake editor view.
 *
 * `showDialog` of the library only needs `view.state.field` and
 * `view.dispatch`, so the fake is enough to see whether the library opened
 * its panel.
 * @returns {{view: any, dispatched: any[]}} the view and its transactions
 */
function fakeView() {
  const dispatched = []
  const view = {
    state: {
      field: () => false,
      phrase: (text) => text,
    },
    dispatch: (transaction) => { dispatched.push(transaction) },
  }
  return { view, dispatched }
}

/**
 * One workbench store that records the toasts.
 * @param {object} [options]
 * @param {string} [options.root] the project root of the store
 * @param {boolean} [options.withToast] whether the store can show a toast
 * @param {boolean} [options.brokenToast] whether the toast throws
 * @returns {{store: any, toasts: any[]}} the store and the recorded toasts
 */
function fakeStore(options = {}) {
  const toasts = []
  const store = {
    state: {
      root: options.root ?? '',
      settings: { lsp: { enabled: true } },
    },
  }
  if (options.withToast !== false) {
    store.toast = (level, text, detail) => {
      if (options.brokenToast === true) throw new Error('the toast is broken')
      toasts.push({ level, text, detail })
    }
  }
  return { store, toasts }
}

/**
 * Run one function without the warnings of the library.
 * @param {() => void} action the function
 * @returns {void}
 */
function quietly(action) {
  const original = console.warn
  console.warn = () => {}
  try {
    action()
  } finally {
    console.warn = original
  }
}

test('the session redirects the errors of the library when it starts', async () => {
  const { store, toasts } = fakeStore({ root: 'C:/work/demo' })
  configureLsp(store)
  await new Promise(resolve => { setTimeout(resolve, 20) })

  assert.equal(FakeSocket.instances.length, 1, 'the client opened its socket')
  const handshake = FakeSocket.instances[0].sent.find(text => text.includes('"initialize"'))
  assert.ok(handshake !== undefined, 'the client sent its handshake')

  const { view, dispatched } = fakeView()
  quietly(() => {
    LSPPlugin.prototype.reportError.call({ view }, 'Find definition failed', new Error('boom'))
  })

  assert.equal(toasts.length, 1, 'the errors of the library reach the toast')
  assert.equal(dispatched.length, 0, 'the panel of the library is not opened')
})

test('a failed request is reported as a toast and opens no panel', () => {
  const { store, toasts } = fakeStore()
  configureLsp(store)
  redirectErrorsToToast()
  const { view, dispatched } = fakeView()

  quietly(() => {
    LSPPlugin.prototype.reportError.call({ view }, 'Find definition failed', new Error('boom'))
  })

  assert.equal(dispatched.length, 0, 'the library did not open its panel')
  assert.equal(toasts.length, 1, 'the workbench shows one toast')
  assert.equal(toasts[0].level, 'error')
})

test('the toast carries the message of the library and the detail of the error', () => {
  const { store, toasts } = fakeStore()
  configureLsp(store)
  redirectErrorsToToast()
  const { view } = fakeView()

  quietly(() => {
    LSPPlugin.prototype.reportError.call({ view }, 'Find definition failed', new Error('Request timed out'))
  })

  assert.equal(toasts.length, 1)
  assert.match(toasts[0].text, /Find definition failed/, 'the toast names the failed request')
  assert.match(toasts[0].text, /Request timed out/, 'the toast carries the detail of the error')
})

test('the panel of the library is used again when the store cannot show a toast', () => {
  const { store } = fakeStore({ withToast: false })
  configureLsp(store)
  redirectErrorsToToast()
  const { view, dispatched } = fakeView()

  quietly(() => {
    LSPPlugin.prototype.reportError.call({ view }, 'Find definition failed', new Error('boom'))
  })

  assert.equal(dispatched.length, 1, 'the library opened its panel')
  assert.ok(dispatched[0].effects !== undefined, 'the panel is opened as an effect')
  assert.equal(typeof dispatched[0].effects.is, 'function', 'the effect is an effect of CodeMirror')
})

test('a toast that throws falls back to the panel of the library', () => {
  const { store } = fakeStore({ brokenToast: true })
  configureLsp(store)
  redirectErrorsToToast()
  const { view, dispatched } = fakeView()

  quietly(() => {
    LSPPlugin.prototype.reportError.call({ view }, 'Find definition failed', new Error('boom'))
  })

  assert.equal(dispatched.length, 1, 'the library opened its panel')
})

test('the redirection happens only once', () => {
  const { store, toasts } = fakeStore()
  configureLsp(store)
  redirectErrorsToToast()
  const redirected = LSPPlugin.prototype.reportError

  redirectErrorsToToast()
  assert.equal(
    LSPPlugin.prototype.reportError,
    redirected,
    'the original implementation of the library is not wrapped twice',
  )

  const { view, dispatched } = fakeView()
  quietly(() => {
    LSPPlugin.prototype.reportError.call({ view }, 'Find definition failed', new Error('boom'))
  })

  assert.equal(toasts.length, 1, 'the toast is shown once')
  assert.equal(dispatched.length, 0, 'no panel is opened')
})

/**
 * The complaint of the server about a document outside the project.
 *
 * The workbench never announces such a document (the workspace has a fence),
 * so the complaint is noise - and a toast would blame the user for a file
 * they only opened (review S8).
 */
test('a complaint about a document outside the project does not become a toast', () => {
  const { store, toasts } = fakeStore()
  configureLsp(store)
  redirectErrorsToToast()
  const { view, dispatched } = fakeView()

  quietly(() => {
    LSPPlugin.prototype.reportError.call(
      { view },
      'Find definition failed',
      new Error('Unexpected resource file:///C:/elsewhere/secret.ts'),
    )
  })

  assert.equal(toasts.length, 0, 'no toast for a document outside the project')
  assert.equal(dispatched.length, 0, 'the panel of the library is not opened either')
})

test('a complaint about a document outside the project stays a warning in the log', () => {
  const { store, toasts } = fakeStore()
  configureLsp(store)
  redirectErrorsToToast()
  const { view } = fakeView()

  const warnings = []
  const original = console.warn
  console.warn = (...args) => { warnings.push(args.join(' ')) }
  try {
    LSPPlugin.prototype.reportError.call(
      { view },
      'Find definition failed',
      new Error('not part of the workspace'),
    )
  } finally {
    console.warn = original
  }

  assert.equal(toasts.length, 0, 'no toast for a document outside the project')
  assert.ok(
    warnings.some(line => line.includes('not part of the workspace')),
    'the complaint is logged as a warning',
  )
})

test('an ordinary error of the server still becomes a toast', () => {
  const { store, toasts } = fakeStore()
  configureLsp(store)
  redirectErrorsToToast()
  const { view } = fakeView()

  quietly(() => {
    LSPPlugin.prototype.reportError.call({ view }, 'Find definition failed', new Error('boom'))
  })

  assert.equal(toasts.length, 1, 'the workbench shows one toast')
  assert.equal(toasts[0].level, 'error')
})
