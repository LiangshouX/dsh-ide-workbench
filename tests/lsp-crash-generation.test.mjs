/**
 * The crash signal of a dying language server (PRD-v5 §6.2/§6.3).
 *
 * One death arrives twice: the stdout of the dead process ends first and
 * the promise of the process resolves a moment later. The second signal
 * used to degrade the session - the restart budget is one, and the
 * duplicate signal spent it before the restart had even started. A server
 * that was killed by the out-of-memory killer never came back.
 *
 * The degradation also has to explain itself: the status bar tooltip and
 * the diagnostics panel show the detail and nothing else, so the detail
 * names the original reason AND the exhausted budget.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeManager, sleep } from './lsp-fixtures.mjs'

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-crash-${name}`)
}

test('a death that is reported twice restarts the server once', async () => {
  const { manager, spawned, handle } = makeManager({ restartBackoffMs: 10 })
  const root = rootOf('double')
  await manager.start({ root })
  assert.equal(spawned.length, 1)

  // Two signals for one death: the output stream ends and the process
  // reports the exit code of the out-of-memory killer.
  handle().stdout.end()
  handle().exit(134)
  await sleep(250)

  assert.equal(spawned.length, 2, 'the server really restarted once')
  const status = await manager.status({ root })
  assert.notEqual(status.state, 'degraded', 'the duplicate signal did not spend the restart budget')
})

test('the restart budget is spent by the second death of the server', async () => {
  const { manager, spawned, handle } = makeManager({ restartBackoffMs: 10 })
  const root = rootOf('budget')
  await manager.start({ root })

  handle().stdout.end()
  handle().exit(134)
  await sleep(250)
  assert.equal(spawned.length, 2)

  // The restarted server dies as well: now the budget is really used up.
  spawned[1].handle.stdout.end()
  spawned[1].handle.exit(134)
  await sleep(250)

  const status = await manager.status({ root })
  assert.equal(status.state, 'degraded')
  assert.equal(spawned.length, 2, 'no third process is started')
})

test('the degradation says why it degraded', async () => {
  const { manager, spawned, handle } = makeManager({ restartBackoffMs: 10 })
  const root = rootOf('detail')
  await manager.start({ root })

  handle().stdout.end()
  handle().exit(134)
  await sleep(250)
  spawned[1].handle.stdout.end()
  spawned[1].handle.exit(134)
  await sleep(250)

  const status = await manager.status({ root })
  assert.match(status.detail, /exited with code 134/, 'the original reason is named')
  assert.match(status.detail, /restart budget/i, 'the exhausted budget is named')
  assert.match(status.detail, /paused/i, 'the consequence is named')
})

test('a crash that is switched off explains itself as well', async () => {
  const { manager, handle } = makeManager({ lsp: { autoRestart: false } })
  const root = rootOf('no-restart')
  await manager.start({ root })

  handle().exit(134)
  await sleep(150)

  const status = await manager.status({ root })
  assert.equal(status.state, 'degraded')
  assert.match(status.detail, /exited with code 134/)
  assert.match(status.detail, /switched off/i)
  assert.match(status.detail, /paused/i)
})

test('the timeouts of the server are part of the reason of the degradation', async () => {
  const { manager } = makeManager({ timeoutLimit: 1, lsp: { autoRestart: false } })
  const root = rootOf('timeout')
  await manager.start({ root })

  manager.noteTimeout(root)
  await sleep(150)

  const status = await manager.status({ root })
  assert.equal(status.state, 'degraded')
  assert.match(status.detail, /request timeout/i, 'the reason of the crash is named')
})
