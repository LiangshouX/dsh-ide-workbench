/**
 * The focus report of the client (PRD-v5.1 §4.4, CONC-03).
 *
 * The host cannot see the focus of the browser: it knows which roots have a
 * language server, but not which one the user is working in. The LRU order of
 * the memory pressure yield needs that fact - the focused root is one of the
 * LAST to go, because yielding it interrupts the user.
 *
 * The chain is:
 *
 *   the editor moves   →   the store reports the root   →   `lsp.focus`
 *   →   the host remembers it   →   the LRU order protects it
 *
 * This file locks down both ends of the chain and the route in between.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeFrame } from '../src/host/lsp-frame.js'
import { makeManager, sleep, waitFor } from './lsp-fixtures.mjs'
import { reportLspFocus } from '../src/client/lsp-session.js'

const MB = 1024 * 1024

/** The root of a case. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-focus-${name}`)
}

/**
 * A manager whose machine can be squeezed.
 * @param {object} [options] the options of the fixture
 * @returns {object} the fixture and the switch of the machine
 */
function focusFixture(options = {}) {
  let freeBytes = options.freeBytes ?? 8 * 1024 ** 3
  const fixture = makeManager({
    ...options,
    lsp: { idleTimeoutMs: 600000, requestTimeoutMs: 100, ...(options.lsp ?? {}) },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes }),
  })
  return {
    ...fixture,
    squeeze() { freeBytes = 32 * MB },
    relax() { freeBytes = 8 * 1024 ** 3 },
  }
}

/**
 * Let one server answer a request, so that it becomes "ready".
 * @param {object} handle the handle of the fake process
 */
function ready(handle) {
  handle.stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })))
}

/**
 * Let the machine breathe again as soon as a server is released.
 * @param {object} fixture the fixture of the case
 * @param {number} index the number of the spawned process
 */
function recoverOnRelease(fixture, index) {
  const entry = fixture.spawned[index]
  if (entry === undefined) return
  const handle = entry.handle
  const original = handle.terminate.bind(handle)
  handle.terminate = () => {
    fixture.relax()
    return original()
  }
}

test('the host keeps the focused root and protects it from the yield', async () => {
  const fixture = focusFixture()
  const { manager } = fixture
  const older = rootOf('older')
  const focused = rootOf('focused')
  await manager.start({ root: older })
  await sleep(120)
  await manager.start({ root: focused })
  ready(fixture.spawned[0].handle)
  ready(fixture.spawned[1].handle)
  await sleep(50)
  recoverOnRelease(fixture, 0)
  recoverOnRelease(fixture, 1)

  // The client tells the host where the user is looking.
  const answer = manager.setFocus(focused)
  assert.equal(answer.focusedRoot, focused, 'the host remembers the focus')
  assert.equal(manager.focusedRoot(), focused)

  fixture.squeeze()
  assert.ok(await waitFor(() => manager.stateOf(older).state === 'suspended', 4000), 'the unfocused server went')
  await sleep(120)
  assert.equal(manager.stateOf(focused).state, 'ready', 'the focused root stays')
})

test('an empty focus means that no root is protected', async () => {
  const manager = makeManager({}).manager
  manager.setFocus(rootOf('somewhere'))
  assert.equal(manager.focusedRoot(), rootOf('somewhere'))
  const answer = manager.setFocus('')
  assert.equal(answer.focusedRoot, null, 'the focus is gone')
  assert.equal(manager.focusedRoot(), null)
})

test('the client reports the focus to the host', async () => {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const method = String(url).split('/').pop()
    let body = {}
    try {
      body = typeof options?.body === 'string' ? JSON.parse(options.body) : {}
    } catch {
      body = {}
    }
    calls.push({ method, body })
    return { ok: true, status: 200, json: async () => ({ ok: true, value: null }) }
  }
  try {
    reportLspFocus('C:\\work\\focused')
    await sleep(30)
    const first = calls.filter(call => call.method === 'lsp.focus')
    assert.equal(first.length, 1, 'the focus was reported')
    assert.equal(first[0].body.root, 'C:\\work\\focused')

    // The same root again: the report is skipped. The focus moves with the
    // editor, not with the millisecond.
    reportLspFocus('C:\\work\\focused')
    await sleep(30)
    assert.equal(calls.filter(call => call.method === 'lsp.focus').length, 1, 'the same root is not reported twice')

    // Another root: the report goes out.
    reportLspFocus('C:\\work\\other')
    await sleep(30)
    const second = calls.filter(call => call.method === 'lsp.focus')
    assert.equal(second.length, 2, 'the new root was reported')
    assert.equal(second[1].body.root, 'C:\\work\\other')
  } finally {
    globalThis.fetch = original
    // The module keeps the last reported root: the next case starts from a
    // known state.
    reportLspFocus('')
    await sleep(10)
  }
})

test('a failing focus report does not break anything', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('the host is gone') }
  try {
    reportLspFocus('C:\\work\\broken')
    await sleep(30)
    // The failure is logged, not thrown: the focus is a hint for the order
    // of a yield, not a precondition of anything.
  } finally {
    globalThis.fetch = original
    reportLspFocus('')
    await sleep(10)
  }
})
