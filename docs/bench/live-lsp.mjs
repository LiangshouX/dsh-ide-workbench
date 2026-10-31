import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { WebSocket } from 'ws'

// The script is a check, not a demo: it exits with a non-zero code when a
// step fails. Exit codes:
//
//   0  every step worked
//   1  a step failed (no handshake, no answer, …)
//   2  the machine could not run the scenario (not enough memory, the
//      language server is not installed)
//
// The memory limits of the scenario are lowered through a throw-away profile
// (DSH_PROFILE_DIR), so the script does not need a machine with 2 GB of
// free memory to reach the interesting part.
const profile = join(tmpdir(), `iwb-bench-live-${process.pid}`)
mkdirSync(join(profile, 'ide-workbench'), { recursive: true })
writeFileSync(join(profile, 'ide-workbench', 'settings.json'), JSON.stringify({
  version: 3,
  lsp: {
    freeMemoryThresholdMB: 64,
    servers: { typescript: { memoryLimitMB: 1024 }, javascript: { memoryLimitMB: 1024 } },
  },
}, null, 2))
process.env.DSH_PROFILE_DIR = profile

/** The steps that failed. */
const failures = []
/**
 * Remember one failed step.
 * @param {string} what the step
 */
function fail(what) {
  failures.push(what)
  console.log('   FAILED:', what)
}

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
  subprocess: {
    spawn(spec) {
      const child = spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, stdio: ['pipe','pipe','pipe'], env: process.env, windowsHide: true })
      let stderr = ''
      child.stderr.on('data', c => { stderr += c.toString() })
      return {
        stdin: child.stdin, stdout: child.stdout, stderr: child.stderr,
        done: new Promise(done2 => child.on('close', (code, signal) => { if (stderr.trim() !== '') console.log('[stderr]', stderr.trim().slice(0,300)); done2({ exitCode: code, signal }) })),
        terminate: () => { child.kill() },
        waitForExit: async () => true,
      }
    },
  },
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
const started = await call('lsp.start', { root })
console.log('lsp.start ->', JSON.stringify(started))
if (started.state === 'degraded') {
  console.log('   the machine could not run the scenario:', started.detail ?? '')
  rmSync(profile, { recursive: true, force: true })
  process.exit(2)
}
const socket = new WebSocket('ws://127.0.0.1:' + port + '/ide-workbench/ws/lsp?root=' + encodeURIComponent(root))
const messages = []
socket.on('message', d => messages.push(d.toString()))
await new Promise((ok, fail) => { socket.once('open', ok); socket.once('error', fail) })
console.log('websocket open')
socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: null, rootUri: 'file:///' + root.replace(/\\/g,'/'), capabilities: { textDocument: { synchronization: { dynamicRegistration: false, didSave: true }, completion: { completionItem: { snippetSupport: false } }, definition: { dynamicRegistration: false }, references: { dynamicRegistration: false }, hover: { contentFormat: ['plaintext','markdown'] } }, workspace: { workspaceFolders: true } } } }))
const deadline = Date.now() + 30000
let init = null
while (Date.now() < deadline && init === null) {
  await new Promise(r => setTimeout(r, 100))
  for (const text of messages.splice(0)) { const p = JSON.parse(text); if (p.id === 1) init = p }
}
if (init === null) {
  console.log('NO initialize response; messages seen:', messages.length)
  fail('the language server never answered the handshake')
} else {
  console.log('initialize ok - capabilities:', Object.keys(init.result?.capabilities ?? {}).join(', '))
  socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }))
}
await new Promise(r => setTimeout(r, 3000))
const status = await call('lsp.status', { root })
console.log('lsp.status ->', status.state, '| language:', status.languageId, '| source:', status.source)
if (status.state !== 'ready') fail('the session did not become ready')
const index = await call('lsp.index', { root })
console.log('lsp.index  ->', JSON.stringify(index))
if (init !== null) {
  const fileUri = 'file:///' + resolve(root, 'src/client/lsp-uri.js').replace(/\\/g,'/')
  socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri: fileUri, languageId: 'javascript', version: 1, text: 'export const a = 1\nexport function f() { return a }\n' } } }))
  await new Promise(r => setTimeout(r, 500))
  socket.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'textDocument/definition', params: { textDocument: { uri: fileUri }, position: { line: 1, character: 27 } } }))
  const deadline2 = Date.now() + 30000
  let definition = null
  while (Date.now() < deadline2 && definition === null) {
    await new Promise(r => setTimeout(r, 100))
    for (const text of messages.splice(0)) { const p = JSON.parse(text); if (p.id === 2) definition = p }
  }
  console.log('textDocument/definition ->', definition === null ? 'NO ANSWER' : JSON.stringify(definition.result))
  if (definition === null) fail('the semantic request was never answered')
}

// --- reconnect: the socket dies, the client handshakes again -------------
socket.close()
await new Promise(r => setTimeout(r, 300))
const again = new WebSocket('ws://127.0.0.1:' + port + '/ide-workbench/ws/lsp?root=' + encodeURIComponent(root))
const againMessages = []
again.on('message', d => againMessages.push(d.toString()))
await new Promise((ok, fail) => { again.once('open', ok); again.once('error', fail) })
again.send(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'initialize', params: { processId: null, rootUri: 'file:///' + root.replace(/\\/g,'/'), capabilities: {} } }))
const deadline3 = Date.now() + 15000
let againInit = null
while (Date.now() < deadline3 && againInit === null) {
  await new Promise(r => setTimeout(r, 100))
  for (const text of againMessages.splice(0)) { const p = JSON.parse(text); if (p.id === 7) againInit = p }
}
console.log('reconnect initialize ->', againInit === null ? 'NO ANSWER' : ('answered, capabilities: ' + Object.keys(againInit.result?.capabilities ?? {}).length))
if (againInit === null) fail('the reconnect handshake was never answered')
again.close()
socket.close()
await call('lsp.shutdown', { root })
for (const fn of cleanups) { try { fn() } catch {} }
server.close()
rmSync(profile, { recursive: true, force: true })
if (failures.length > 0) {
  console.log('the scenario FAILED:', failures.join(', '))
  process.exit(1)
}
console.log('the scenario worked: the language server answered the handshake, the request and the reconnect.')
process.exit(0)