/**
 * The two states of the "indexed" badge (PRD-v5.1 §4.6, CONC-05).
 *
 * The `indexedRoots` map records a HISTORICAL fact ("this root completed a
 * first build"), and the badge of the client used to say "indexed" even
 * though the server was gone: the process was reclaimed, and the user had
 * to rebuild the whole program to get the semantic features back.
 *
 * The host owns the answer - it knows which sessions are running - so it
 * reports both:
 *
 *   - the flag `running` on every entry of the `indexedRoots` map, and
 *   - the list of the scope roots that run a language server right now
 *     (`liveRoots` in the status snapshot), so the client can tell the
 *     state of a root it is not talking to.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeFrame } from '../src/host/lsp-frame.js'
import { makeManager, sleep } from './lsp-fixtures.mjs'

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-badge-${name}`)
}

test('the indexed roots carry the state of the server', async () => {
  const { manager, handle, document } = makeManager({ lsp: { idleTimeoutMs: 150 } })
  const root = rootOf('badge')
  await manager.start({ root })
  handle().stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })))
  await sleep(80)
  assert.ok(document.lsp.indexedRoots[root], 'the root is remembered as indexed')

  const running = await manager.indexedRoots()
  assert.equal(running[root].running, true, 'the server runs for this root')

  // The idle release takes the server away, and the badge has to say so.
  await sleep(280)
  const reclaimed = await manager.indexedRoots()
  assert.equal(reclaimed[root].running, false, 'the server was reclaimed')
  assert.ok(reclaimed[root].at, 'the historical fact survives')
})

test('the status reports the roots that run a language server', async () => {
  const { manager, handle } = makeManager({ lsp: { idleTimeoutMs: 150 } })
  const root = rootOf('live')
  const status = await manager.status({ root })
  assert.deepEqual(status.liveRoots, [], 'nothing runs yet')

  await manager.start({ root })
  handle().stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })))
  await sleep(80)
  const running = await manager.status({ root })
  assert.equal(running.running, true, 'the server runs for this root')
  assert.deepEqual(running.liveRoots, [root], 'the scope root is reported')

  await sleep(280)
  const reclaimed = await manager.status({ root })
  assert.equal(reclaimed.running, false)
  assert.deepEqual(reclaimed.liveRoots, [], 'the list is empty again')
})

test('the live roots carry the roots of the other projects too', async () => {
  const { manager } = makeManager({ lsp: { idleTimeoutMs: 600000 } })
  const first = rootOf('live-first')
  const second = rootOf('live-second')
  await manager.start({ root: first })
  await manager.start({ root: second })
  const status = await manager.status({ root: first })
  assert.equal(status.liveRoots.length, 2, 'the client sees both projects')
  assert.ok(status.liveRoots.includes(first))
  assert.ok(status.liveRoots.includes(second))
})
