// The language server crashes and is restarted. The host process must
// survive: an unhandled rejection would take the whole DSH application down.
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { WebSocket } from 'ws'

function fakeStream() { const listeners = {}; return { on(type, fn) { (listeners[type] ??= []).push(fn) }, emit(type, value) { for (const fn of listeners[type] ?? []) fn(value) } } }
const unhandled = []
process.on('unhandledRejection', (reason) => { unhandled.push(String(reason)) })
process.on('uncaughtException', (error) => { unhandled.push('uncaught: ' + String(error)) })

const mod = await import('../../src/index.js')
const root = resolve(process.cwd())
const server = createServer((req, res) => { res.writeHead(404); res.end() })
await new Promise(done => server.listen(0, '127.0.0.1', done))
const port = server.address().port
const cleanups = []
let route = null

/** The handles of the language servers that were started. */
const handles = []
/** The fake stdin of a language server. */
function fakeHandle() {
  let resolveDone
  const done = new Promise(r => { resolveDone = r })
  const handle = {
    stdin: { write() {} },
    stdout: fakeStream(),
    stderr: fakeStream(),
    done,
    pid: 1234,
    terminate() { resolveDone({ exitCode: 0, signal: null }) },
    waitForExit: async () => true,
    crash() { resolveDone({ exitCode: 1, signal: null }) },
  }
  handles.push(handle)
  return handle
}

const ctx = {
  logger: { info(...a) { console.log('[host]', ...a) }, warn(...a) { console.log('[host warn]', ...a) }, error(...a) { console.log('[host error]', ...a) } },
  get: () => undefined,
  effect: (fn) => { const d = fn(); if (typeof d === 'function') cleanups.push(d); return () => {} },
  subprocess: { spawn: () => fakeHandle() },
  connection: { requestRejection: () => undefined },
  workspaceRegistry: { list: () => [] },
  webServer: {
    register: (spec) => { if (spec.kind === 'prefix') route = spec; return () => {} },
    registerUpgrade(spec) { if (spec.path === '/ide-workbench/ws/lsp') server.on('upgrade', (req, socket, head) => { if (!req.url.startsWith(spec.path)) return; spec.handler(req, socket, head) }); return () => {} },
  },
}
mod.apply(ctx)
const call = async (method, body) => {
  const req = { method: 'POST', url: '/ide-workbench/api/' + method, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body ?? {})) } }
  let out = null
  const res = { headersSent: false, writeHead() {}, end(t) { out = t }, destroy() {} }
  await route.handler(req, res)
  const parsed = JSON.parse(out)
  if (parsed.ok !== true) throw new Error(method + ': ' + parsed.error?.message)
  return parsed.value
}

const socket = new WebSocket('ws://127.0.0.1:' + port + '/ide-workbench/ws/lsp?root=' + encodeURIComponent(root))
socket.on('message', () => {})
await new Promise((ok, fail) => { socket.once('open', ok); socket.once('error', fail) })
socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: null, rootUri: 'file:///' + root.replace(/\\/g,'/'), capabilities: {} } }))

console.log('1. lsp.start ->', JSON.stringify(await call('lsp.start', { root })))
await new Promise(r => setTimeout(r, 500))
console.log('2. state after the start:', (await call('lsp.status', { root })).state)

// The language server dies.
handles[0].crash()
console.log('3. the language server was killed')
await new Promise(r => setTimeout(r, 500))
console.log('4. state right after the crash:', (await call('lsp.status', { root })).state)

// The automatic restart happens after the backoff.
await new Promise(r => setTimeout(r, 3500))
console.log('5. state after the restart:', (await call('lsp.status', { root })).state, '| servers started:', handles.length)

// The host must still be alive and must not have leaked a rejection.
await new Promise(r => setTimeout(r, 500))
console.log('6. unhandled rejections:', unhandled.length, unhandled.length ? JSON.stringify(unhandled) : '(none)')
console.log('7. the host process is alive:', true)

socket.close()
await call('lsp.shutdown', { root })
for (const fn of cleanups) { try { fn() } catch {} }
server.close()
process.exit(unhandled.length === 0 ? 0 : 1)