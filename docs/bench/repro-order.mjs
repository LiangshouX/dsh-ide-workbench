// The order the browser really uses: the socket is connected when the
// workbench opens, the language server is started later (when the user
// picks a project). The handshake that arrives in between must not be lost.
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { WebSocket } from 'ws'

const mod = await import('../../src/index.js')
const root = resolve(process.cwd())
const server = createServer((req, res) => { res.writeHead(404); res.end() })
await new Promise(done => server.listen(0, '127.0.0.1', done))
const port = server.address().port
const cleanups = []
let route = null
const ctx = {
  logger: { info() {}, warn() {} },
  get: () => undefined,
  effect: (fn) => { const d = fn(); if (typeof d === 'function') cleanups.push(d); return () => {} },
  subprocess: { spawn(spec) {
    const child = spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, stdio: ['pipe','pipe','pipe'], env: process.env, windowsHide: true })
    return { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr,
      done: new Promise(d2 => child.on('close', (code, signal) => d2({ exitCode: code, signal }))),
      terminate: () => { child.kill() }, waitForExit: async () => true }
  } },
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

// 1. The browser connects its socket.
const socket = new WebSocket('ws://127.0.0.1:' + port + '/ide-workbench/ws/lsp?root=' + encodeURIComponent(root))
const frames = []
socket.on('message', d => frames.push(JSON.parse(d.toString())))
await new Promise((ok, fail) => { socket.once('open', ok); socket.once('error', fail) })
console.log('1. socket open (no language server yet)')

// 2. The client sends its handshake right away.
socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: null, rootUri: 'file:///' + root.replace(/\\/g,'/'), capabilities: { textDocument: { definition: { dynamicRegistration: false } } } } }))
await new Promise(r => setTimeout(r, 400))
console.log('2. initialize sent while there is no server (it has to be held)')

// 3. The user picks a project: the host starts the language server.
console.log('3. lsp.start ->', JSON.stringify(await call('lsp.start', { root })))

// 4. Wait for the handshake to reach the server.
const deadline = Date.now() + 30000
let init = null
while (Date.now() < deadline && init === null) {
  await new Promise(r => setTimeout(r, 100))
  for (const frame of frames.splice(0)) {
    if (frame.id === 1 && frame.result !== undefined) init = frame
  }
}
console.log('4. the server answered the handshake:', init === null ? 'NO' : 'yes (' + Object.keys(init.result?.capabilities ?? {}).length + ' capabilities)')

// 5. The state must leave "building" (the readiness heuristic waits a moment).
const deadline3 = Date.now() + 15000
let status = await call('lsp.status', { root })
while (Date.now() < deadline3 && status.state === 'building') {
  await new Promise(r => setTimeout(r, 200))
  status = await call('lsp.status', { root })
}
console.log('5. lsp.status ->', status.state, status.state === 'ready' ? '(good)' : '(STUCK)')

// 6. A semantic request has to come back.
if (init !== null) {
  const fileUri = 'file:///' + resolve(root, 'src/client/lsp-uri.js').replace(/\\/g,'/')
  socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri: fileUri, languageId: 'javascript', version: 1, text: 'export const a = 1\nexport function f() { return a }\n' } } }))
  await new Promise(r => setTimeout(r, 600))
  socket.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'textDocument/definition', params: { textDocument: { uri: fileUri }, position: { line: 1, character: 27 } } }))
  const deadline2 = Date.now() + 30000
  let definition = null
  while (Date.now() < deadline2 && definition === null) {
    await new Promise(r => setTimeout(r, 100))
    for (const frame of frames.splice(0)) {
      if (frame.id === 2) definition = frame
    }
  }
  console.log('6. textDocument/definition ->', definition === null ? 'NO ANSWER' : JSON.stringify(definition.result))
}
socket.close()
await call('lsp.shutdown', { root })
for (const fn of cleanups) { try { fn() } catch {} }
server.close()
process.exit(0)