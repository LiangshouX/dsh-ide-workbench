/**
 * Diagnostic: what happens to the language server on a large TS project?
 * Captures stderr and the exit event, and samples RSS during the program build.
 */
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BENCH = process.argv[2]
const PROJECT = process.argv[3]
const WAIT_S = Number(process.argv[4] ?? 120)

const child = spawn('node', [join(BENCH, 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs'), '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] })

let stderr = ''
child.stderr.on('data', d => { stderr += d.toString() })
let exited = null
child.on('exit', (code, signal) => { exited = { code, signal, at: Date.now() } })
child.on('error', e => { exited = { code: 'spawn-error', signal: e.message, at: Date.now() } })

let buffer = Buffer.alloc(0)
let nextId = 1
const pending = new Map()
child.stdout.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const he = buffer.indexOf('\r\n\r\n')
    if (he < 0) return
    const m = /Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, he).toString('ascii'))
    if (!m) { buffer = buffer.subarray(he + 4); continue }
    const len = Number(m[1])
    if (buffer.length < he + 4 + len) return
    const body = buffer.subarray(he + 4, he + 4 + len).toString('utf8')
    buffer = buffer.subarray(he + 4 + len)
    let msg
    try { msg = JSON.parse(body) } catch { continue }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, t0 } = pending.get(msg.id); pending.delete(msg.id)
      resolve({ msg, ms: Date.now() - t0, bytes: Buffer.byteLength(body) })
    }
  }
})
function send(o) { const s = JSON.stringify(o); child.stdin.write(`Content-Length: ${Buffer.byteLength(s, 'utf8')}\r\n\r\n${s}`) }
function request(method, params) {
  const id = nextId++
  const t0 = Date.now()
  return new Promise((res, rej) => {
    pending.set(id, { resolve: res, t0 })
    send({ jsonrpc: '2.0', id, method, params })
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, 600000)
  })
}
function rssMb() {
  try {
    const out = execFileSync('tasklist', ['/FI', `PID eq ${child.pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
    const m = /"(\d+)","[^"]*","([^"]*)",\s*"?([\d,]+)"?/.exec(out)
    if (m) return Math.round(Number(m[3].replace(/,/g, '')) / 1024)
  } catch { /* gone */ }
  return null
}

const t0 = Date.now()
await request('initialize', {
  processId: process.pid,
  rootUri: `file:///${PROJECT.replace(/\\/g, '/')}`,
  capabilities: { textDocument: { completion: { completionItem: { snippetSupport: true } }, definition: {}, references: {} }, workspace: { symbol: {} } },
  workspaceFolders: [{ uri: `file:///${PROJECT.replace(/\\/g, '/')}`, name: 'bench' }],
})
send({ jsonrpc: '2.0', method: 'initialized', params: {} })
console.log(`[init] ${Date.now() - t0} ms`)

const target = join(PROJECT, 'src', 'file0.ts')
const text = readFileSync(target, 'utf8')
const uri = `file:///${target.replace(/\\/g, '/')}`
send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'typescript', version: 1, text } } })
console.log('[didOpen] sent')

// Poll RSS while the program builds; stop early if the child dies.
let peak = 0
for (let i = 1; i <= WAIT_S; i++) {
  await new Promise(r => setTimeout(r, 1000))
  const rss = rssMb()
  if (rss !== null && rss > peak) peak = rss
  if (i % 15 === 0 || (rss !== null && i % 5 === 0 && i < 20)) {
    console.log(`  t+${i}s  RSS=${rss === null ? 'GONE' : rss + ' MB'}  exited=${exited ? JSON.stringify(exited) : 'no'}`)
  }
  if (exited !== null) break
}

console.log(`\n[peak RSS] ${peak} MB`)
console.log(`[child exited] ${exited ? JSON.stringify(exited) : 'still alive'}`)
if (stderr.trim()) console.log(`[stderr]\n${stderr.slice(0, 2000)}`)
else console.log('[stderr] (empty)')

if (!exited) {
  const line = text.split('\n').findIndex(l => l.includes('helper'))
  const ch = text.split('\n')[line].indexOf('helper')
  try {
    const comp = await request('textDocument/completion', { textDocument: { uri }, position: { line, character: ch } })
    console.log(`[completion] ${comp.ms} ms, ${comp.msg.result?.items?.length ?? 0} items`)
  } catch (e) { console.log(`[completion] FAILED: ${e.message}`) }
}
child.kill()
process.exit(0)
