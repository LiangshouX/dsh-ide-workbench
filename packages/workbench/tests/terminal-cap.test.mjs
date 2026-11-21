/**
 * TERM-01..TERM-06 - the output of a terminal session is capped.
 *
 * The output of a session used to reach the renderer of the IDE without a
 * limit: `cat` of a big file streamed an unbounded number of bytes into the
 * heap of the browser, and a renderer that runs out of memory takes the
 * whole IDE with it (PRD-v8 §3.1).
 *
 * The suite drives the real socket of the plugin - a WebSocket client against
 * the upgrade the plugin registers - because the things that can go wrong are
 * behavioural: the bytes that were forwarded, the number of the notices and
 * the life of the session after the cap was reached.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { apply } from '../src/index.js'
import { DEFAULT_TERMINAL_OUTPUT_LIMIT, terminalOutputLimit } from '../src/host/settings-store.js'
import { shellCandidates } from '../src/host/workspace.js'
import { loadTerminalModule } from './terminal-support.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(join(root, 'src/client/TerminalPanel.jsx'), 'utf8')
const mod = await loadTerminalModule()

/**
 * Wait until a condition holds.
 * @param {() => boolean} predicate the condition
 * @param {number} [attempts] how often the condition is asked for
 * @returns {Promise<void>} the wait
 */
async function waitFor(predicate, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('the condition did not hold in time')
}

/**
 * A terminal handle that the host believes in.
 *
 * The host only knows three things about a session: the stream of its
 * output, the writes of the user and the moment it ends. The double offers
 * exactly those.
 * @returns {object} the handle
 */
function createTerminalHandle() {
  const output = new EventEmitter()
  output.setEncoding = () => {}
  let finish
  const done = new Promise(resolve => { finish = resolve })
  return {
    output,
    done,
    /** The writes of the user. */
    writes: [],
    write(data) { this.writes.push(data); return Promise.resolve() },
    resize() { return Promise.resolve() },
    signalForeground() { return Promise.resolve() },
    terminate() { return Promise.resolve() },
    /** End the session, the way a shell that exits does. */
    finish(exitCode = 0, signal = null) { finish({ exitCode, signal }) },
  }
}

/**
 * A Cordis-like context whose subprocess spawns the terminal double.
 * @param {object} handle the terminal handle
 * @returns {object} the context and the records of the mount
 */
function fakeContext(handle) {
  const routes = []
  const upgrades = []
  const disposers = []
  const services = new Map()
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    get: (service) => services.get(service),
    provide(service, value) {
      services.set(service, value)
      return () => services.delete(service)
    },
    effect(execute) {
      const result = execute()
      if (typeof result === 'function') disposers.push(result)
      return () => {}
    },
    subprocess: { spawnTerminal: async () => handle },
    connection: { requestRejection: () => undefined },
    workspaceRegistry: { list: () => [], create: async () => ({ id: 'x', path: 'C:\\', title: 'x' }) },
    webServer: {
      register(spec) { routes.push(spec); return () => {} },
      registerUpgrade(spec) { upgrades.push(spec); return () => {} },
    },
  }
  return { ctx, routes, upgrades, disposers }
}

/**
 * Open one terminal session of the plugin.
 *
 * The socket is a real one: the plugin registers an upgrade, the test plays
 * the host and hands the socket over - so the frames the client sees are the
 * frames the plugin really sends.
 *
 * @param {object} t the test
 * @param {{ terminal?: object }} [options] the settings of the session
 * @returns {Promise<object>} the handle, the frames and the client
 */
async function openSession(t, options = {}) {
  const profile = await mkdtemp(join(tmpdir(), 'iwb-term-profile-'))
  const workspace = await mkdtemp(join(tmpdir(), 'iwb-term-work-'))
  t.after(() => rm(profile, { recursive: true, force: true }))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  await mkdir(join(profile, 'ide-workbench'), { recursive: true })
  await writeFile(
    join(profile, 'ide-workbench', 'settings.json'),
    JSON.stringify({ version: 4, terminal: options.terminal ?? {} }),
    'utf8',
  )
  process.env.DSH_PROFILE_DIR = profile

  const handle = createTerminalHandle()
  const { ctx, upgrades, disposers } = fakeContext(handle)
  t.after(() => { for (const dispose of disposers) dispose() })
  apply(ctx)

  const server = createServer()
  server.on('upgrade', (req, socket, head) => { upgrades[0].handler(req, socket, head) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(() => resolve())))

  const frames = []
  const client = new WebSocket(
    `ws://127.0.0.1:${server.address().port}/ide-workbench/ws/terminal?root=${encodeURIComponent(workspace)}`,
  )
  client.on('message', (data) => { frames.push(JSON.parse(String(data))) })
  t.after(() => client.close())
  await once(client, 'open')
  await waitFor(() => frames.some(frame => frame.type === 'ready'))
  return { handle, frames, client }
}

/**
 * The bytes of the data frames the client received.
 * @param {object[]} frames the frames
 * @returns {number} the number of bytes
 */
function forwardedBytes(frames) {
  return frames
    .filter(frame => frame.type === 'data')
    .reduce((sum, frame) => sum + Buffer.byteLength(frame.data ?? '', 'utf8'), 0)
}

test('the cap of the output is 8 MiB, and an invalid setting falls back to it', () => {
  assert.equal(DEFAULT_TERMINAL_OUTPUT_LIMIT, 8 * 1024 * 1024)
  assert.equal(terminalOutputLimit({}), DEFAULT_TERMINAL_OUTPUT_LIMIT)
  assert.equal(terminalOutputLimit({ terminal: {} }), DEFAULT_TERMINAL_OUTPUT_LIMIT)
  assert.equal(terminalOutputLimit({ terminal: { outputLimitBytes: 'nonsense' } }), DEFAULT_TERMINAL_OUTPUT_LIMIT)
  assert.equal(terminalOutputLimit({ terminal: { outputLimitBytes: null } }), DEFAULT_TERMINAL_OUTPUT_LIMIT)
  assert.equal(terminalOutputLimit({ terminal: { outputLimitBytes: 0 } }), DEFAULT_TERMINAL_OUTPUT_LIMIT)
  assert.equal(terminalOutputLimit({ terminal: { outputLimitBytes: -1 } }), DEFAULT_TERMINAL_OUTPUT_LIMIT)
  assert.equal(terminalOutputLimit({ terminal: { outputLimitBytes: 4096 } }), 4096)
})

test('the session forwards no more than the cap, and says once that it stopped', async (t) => {
  if (shellCandidates().length === 0) {
    t.skip('this machine has no shell the plugin can start')
    return
  }
  const { handle, frames } = await openSession(t, { terminal: { outputLimitBytes: 4096 } })

  handle.output.emit('data', 'x'.repeat(1000))
  handle.output.emit('data', 'y'.repeat(1000))
  handle.output.emit('data', 'z'.repeat(1000))
  // The last chunk does not fit into the budget any more.
  handle.output.emit('data', 'w'.repeat(5000))
  await waitFor(() => frames.some(frame => frame.type === 'truncated'))

  const bytes = forwardedBytes(frames)
  assert.ok(bytes <= 4096, `the session forwarded ${bytes} bytes, the cap is 4096`)
  const truncated = frames.filter(frame => frame.type === 'truncated')
  assert.equal(truncated.length, 1, 'the host says once that the output was truncated')
  assert.equal(truncated[0].limit, 4096, 'the frame carries the cap')
  assert.equal(truncated[0].bytes, bytes, 'the frame carries the bytes that were forwarded')

  // The output that comes after the cap is dropped - and the host does not
  // say it twice.
  handle.output.emit('data', 'q'.repeat(1000))
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(forwardedBytes(frames), bytes, 'the output after the cap is not forwarded')
  assert.equal(frames.filter(frame => frame.type === 'truncated').length, 1, 'the host says it once')
})

test('the session survives the truncation', async (t) => {
  if (shellCandidates().length === 0) {
    t.skip('this machine has no shell the plugin can start')
    return
  }
  const { handle, frames, client } = await openSession(t, { terminal: { outputLimitBytes: 2048 } })

  handle.output.emit('data', 'x'.repeat(4096))
  await waitFor(() => frames.some(frame => frame.type === 'truncated'))

  // The socket is open: the user still has a shell.
  assert.equal(client.readyState, WebSocket.OPEN, 'the socket stays open')
  client.send(JSON.stringify({ type: 'input', data: 'echo hi\r' }))
  await waitFor(() => handle.writes.length > 0)
  assert.deepEqual(handle.writes, ['echo hi\r'], 'the user can still type')

  // The shell can still be resized and interrupted.
  client.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }))
  client.send(JSON.stringify({ type: 'signal', signal: 'SIGINT' }))
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(client.readyState, WebSocket.OPEN, 'the session is still alive')

  // And the end of the shell is still reported.
  handle.finish(0)
  await waitFor(() => frames.some(frame => frame.type === 'exit'))
  assert.equal(frames.filter(frame => frame.type === 'exit')[0].exitCode, 0)
})

test('a broken cap falls back to the default of 8 MiB', async (t) => {
  if (shellCandidates().length === 0) {
    t.skip('this machine has no shell the plugin can start')
    return
  }
  const { handle, frames } = await openSession(t, { terminal: { outputLimitBytes: 'not a number' } })

  handle.output.emit('data', 'x'.repeat(DEFAULT_TERMINAL_OUTPUT_LIMIT + 16))
  await waitFor(() => frames.some(frame => frame.type === 'truncated'), 400)

  const truncated = frames.filter(frame => frame.type === 'truncated')
  assert.equal(truncated.length, 1)
  assert.equal(truncated[0].limit, DEFAULT_TERMINAL_OUTPUT_LIMIT, 'the default cap takes the place')
  assert.ok(forwardedBytes(frames) <= DEFAULT_TERMINAL_OUTPUT_LIMIT)
})

test('the terminal prints the truncation, and prints it once', () => {
  const { truncatedNotice, createTruncationNotice } = mod
  const notice = truncatedNotice({ bytes: 1024, limit: DEFAULT_TERMINAL_OUTPUT_LIMIT })
  assert.match(notice, /output truncated after 8 MiB/, 'the notice names the cap')
  assert.match(notice, /\x1b\[93m/, 'the notice is visible')
  assert.ok(notice.startsWith('\r\n') && notice.endsWith('\r\n'), 'the notice stands on its own line')

  // A repeated frame must not print a second line.
  const noticeOf = createTruncationNotice()
  assert.notEqual(noticeOf({ bytes: 1, limit: 4096 }), null, 'the first frame prints the notice')
  assert.equal(noticeOf({ bytes: 1, limit: 4096 }), null, 'the second frame prints nothing')
})

test('the scrollback of the terminal is bounded', () => {
  assert.equal(mod.TERMINAL_SCROLLBACK, 5000, 'the scrollback is 5000 lines')
  assert.ok(mod.TERMINAL_SCROLLBACK > 1000, 'the scrollback is bigger than the default of xterm')
  assert.match(source, /scrollback: TERMINAL_SCROLLBACK/, 'the instance is built with the bounded scrollback')
})
