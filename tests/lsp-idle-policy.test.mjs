/**
 * The idle policy of the `lsp` section (PRD-v5 §3.2, IDLE-01/IDLE-04/IDLE-05).
 *
 * The ten-minute idle timeout was a hidden default: the user could not see
 * it and could not turn it off. The policy makes the three answers
 * explicit - never, after N minutes, or only when the machine runs out of
 * memory - and the timer has to survive every situation:
 *
 *   - it is not armed while the language server builds the program of the
 *     project (the build budget and the idle timeout were both ten
 *     minutes, so they used to fire together),
 *   - and it is armed again whenever the idle exit could not release the
 *     session.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeFrame } from '../src/host/lsp-frame.js'
import { DEFAULT_LSP_SETTINGS } from '../src/host/lsp.js'
import { DEFAULT_SETTINGS, migrateLspSettings, SETTINGS_VERSION } from '../src/host/settings-store.js'
import { makeManager, sleep, waitFor } from './lsp-fixtures.mjs'

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-policy-${name}`)
}

/**
 * One request that needs a language server.
 * @param {number} id the JSON-RPC id
 * @returns {string} the payload
 */
function definitionOf(id) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'textDocument/definition',
    params: { textDocument: { uri: 'file:///workspace/app.ts' }, position: { line: 1, character: 2 } },
  })
}

/**
 * One notification that opens a document.
 * @returns {string} the payload
 */
function didOpenOf() {
  return JSON.stringify({
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: { textDocument: { uri: 'file:///workspace/app.ts', languageId: 'typescript', version: 1, text: '' } },
  })
}

test('the default policy releases the server after the idle timeout', async () => {
  assert.equal(DEFAULT_LSP_SETTINGS.idlePolicy, 'after')
  const { manager, handle } = makeManager({ lsp: { idleTimeoutMs: 150 } })
  const root = rootOf('default')
  await manager.start({ root })
  handle().stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })))
  await sleep(280)
  assert.equal((await manager.status({ root })).state, 'suspended', 'the server was released')
})

test('the policy never arms a timer at all', async () => {
  const { manager, handle } = makeManager({ lsp: { idlePolicy: 'never', idleTimeoutMs: 100 } })
  const root = rootOf('never')
  await manager.start({ root })
  handle().stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })))
  await sleep(50)
  assert.equal(manager.stateOf(root).idleArmed, false, 'no idle timer is armed')

  await sleep(250)
  assert.equal(handle().terminateCalls, 0, 'the process keeps running')
  assert.equal((await manager.status({ root })).state, 'ready')
})

test('the switch of the older documents still means never', async () => {
  // `autoExit: false` was written into the settings before the policy
  // existed. It still means "never exit" - the host honours the older
  // switch over the newer policy.
  const { manager, handle } = makeManager({ lsp: { autoExit: false, idlePolicy: 'after', idleTimeoutMs: 100 } })
  const root = rootOf('auto-exit')
  await manager.start({ root })
  handle().stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })))
  await sleep(50)
  assert.equal(manager.stateOf(root).idleArmed, false, 'no idle timer is armed')

  await sleep(250)
  assert.equal(handle().terminateCalls, 0, 'the process keeps running')
})

test('the policy onMemoryPressure releases the server when the machine runs out of memory', async () => {
  let freeBytes = 8 * 1024 ** 3
  const { manager, handle } = makeManager({
    lsp: { idlePolicy: 'onMemoryPressure', idleTimeoutMs: 100 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes }),
  })
  const root = rootOf('pressure')
  await manager.start({ root })
  handle().stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })))
  await sleep(80)
  assert.equal(manager.stateOf(root).idleArmed, false, 'there is no idle timer')

  // The machine runs out of memory: the server has to go.
  freeBytes = 32 * 1024 * 1024
  assert.ok(await waitFor(() => manager.stateOf(root).state === 'suspended'), 'the server was released')
  assert.equal(handle().terminateCalls, 1)
})

test('the policy onMemoryPressure does not release a server of a healthy machine', async () => {
  const { manager, handle } = makeManager({
    lsp: { idlePolicy: 'onMemoryPressure', idleTimeoutMs: 100 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3 }),
  })
  const root = rootOf('healthy')
  await manager.start({ root })
  handle().stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })))
  await sleep(400)
  assert.equal(handle().terminateCalls, 0, 'the process keeps running')
  assert.equal((await manager.status({ root })).state, 'ready')
})

test('the timer is not armed while the program of the project is built', async () => {
  const { manager, handle } = makeManager({ lsp: { idleTimeoutMs: 100 } })
  const root = rootOf('building')
  await manager.start({ root })
  // A semantic request that is never answered: the server is building the
  // program of the project, and the idle timeout must not kill it.
  manager.relayToServer(root, definitionOf(7))
  await sleep(30)
  assert.equal(manager.stateOf(root).buildingProgram, true, 'the program is built')
  assert.equal(manager.stateOf(root).idleArmed, false, 'no idle timer is armed')

  await sleep(300)
  assert.equal(handle().terminateCalls, 0, 'the server is not released while it builds')
})

test('the timer is armed again when the program is built', async () => {
  const { manager, handle } = makeManager({ lsp: { idleTimeoutMs: 100 } })
  const root = rootOf('built')
  await manager.start({ root })
  manager.relayToServer(root, definitionOf(7))
  await sleep(30)
  assert.equal(manager.stateOf(root).idleArmed, false)

  // The server answers the request: the program is built, and the idle
  // timer may be armed again.
  handle().stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 7, result: {} })))
  await sleep(30)
  assert.equal(manager.stateOf(root).idleArmed, true, 'the idle timer is armed again')
})

test('the idle timer is armed again when the idle exit could not release the session', async () => {
  // The session is still starting when the timer fires: the release is not
  // possible yet, and the timer must not be lost (IDLE-05).
  const { manager } = makeManager({ lsp: { idleTimeoutMs: 100 }, spawnDelayMs: 600 })
  const root = rootOf('rearm')
  const starting = manager.start({ root })
  await sleep(40)
  manager.relayToServer(root, didOpenOf())
  await sleep(20)
  assert.equal(manager.stateOf(root).state, 'starting')
  assert.equal(manager.stateOf(root).idleArmed, true, 'the timer is armed')

  // The timer fires while the process is still starting.
  await sleep(200)
  assert.equal(manager.stateOf(root).state, 'starting')
  assert.equal(manager.stateOf(root).idleArmed, true, 'the timer was armed again')
  await starting
})

test('the settings carry the idle policy and the migration fills it in', () => {
  assert.equal(DEFAULT_SETTINGS.lsp.idlePolicy, 'after')
  assert.equal(SETTINGS_VERSION, 5)

  const value = { lsp: {} }
  migrateLspSettings(value)
  assert.equal(value.lsp.idlePolicy, 'after', 'a document without the policy keeps the old behaviour')

  const invalid = { lsp: { idlePolicy: 'sometimes' } }
  migrateLspSettings(invalid)
  assert.equal(invalid.lsp.idlePolicy, 'after', 'an unknown value falls back to the default')

  const chosen = { lsp: { idlePolicy: 'never' } }
  migrateLspSettings(chosen)
  assert.equal(chosen.lsp.idlePolicy, 'never', 'a value the user chose is not touched')
})
