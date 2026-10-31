/**
 * Diagnostic v2: sample the WHOLE process tree (typescript-language-server
 * wrapper + the tsserver grandchild), and report the real memory of the
 * language server during the program build on a large TS project.
 */
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BENCH = process.argv[2]
const PROJECT = process.argv[3]
const WAIT_S = Number(process.argv[4] ?? 180)

function psSnapshot() {
  const out = execFileSync('wmic', ['process', 'get', 'ProcessId,ParentProcessId,WorkingSetSize,Name', '/format:csv'], { encoding: 'utf8' })
  const lines = out.split('\n').slice(1)
  const procs = []
  for (const l of lines) {
    const m = l.match(/^([^,]*),([^,]*),([^,]*),([^,]*),(\d+),(\d+),(\d+)/)
    if (!m) continue
    const pid = Number(m[6])
    const ppid = Number(m[5])
    const ws = Number(m[4])
    const name = m[3]
    if (!pid) continue
    procs.push({ pid, ppid, ws, name })
  }
  return procs
}

function descendants(rootPid, procs) {
  const byParent = new Map()
  for (const p of procs) {
    if (!byParent.has(p.ppid)) byParent.set(p.ppid, [])
    byParent.get(p.ppid).push(p)
  }
  const out = []
  const stack = [rootPid]
  while (stack.length) {
    const cur = stack.pop()
    for (const c of byParent.get(cur) ?? []) { out.push(c); stack.push(c.pid) }
  }
  return out
}

const child = spawn('node', [join(BENCH, 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs'), '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] })
let stderr = ''
child.stderr.on('data', d => { stderr += d.toString() })
let exited = null
child.on('exit', (code, signal) => { exited = { code, signal } })

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
      resolve({ msg, ms: Date.now() - t0 })
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, 900000)
  })
}

await request('initialize', {
  processId: process.pid,
  rootUri: `file:///${PROJECT.replace(/\\/g, '/')}`,
  capabilities: { textDocument: { completion: { completionItem: { snippetSupport: true } }, definition: {}, references: {} }, workspace: { symbol: {} } },
  workspaceFolders: [{ uri: `file:///${PROJECT.replace(/\\/g, '/')}`, name: 'bench' }],
})
send({ jsonrpc: '2.0', method: 'initialized', params: {} })

const target = join(PROJECT, 'src', 'file0.ts')
const text = readFileSync(target, 'utf8')
const uri = `file:///${target.replace(/\\/g, '/')}`
send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'typescript', version: 1, text } } })
console.log('[init + didOpen] done')

let peakTree = 0
let peakDetail = ''
for (let i = 1; i <= WAIT_S; i++) {
  await new Promise(r => setTimeout(r, 1000))
  let procs = []
  try { procs = psSnapshot() } catch { /* wmic unavailable */ }
  const tree = [procs.find(p => p.pid === child.pid), ...descendants(child.pid, procs)].filter(Boolean)
  const total = tree.reduce((a, p) => a + p.ws, 0)
  if (total > peakTree) {
    peakTree = total
    peakDetail = tree.map(p => `${p.name.trim()}#${p.pid}=${Math.round(p.ws / 1048576)}MB`).join(' + ')
  }
  if (i % 10 === 0 || (exited && i % 2 === 0)) {
    console.log(`  t+${i}s  treeTotal=${Math.round(total / 1048576)} MB   [${tree.map(p => `${p.name.trim().replace('.exe', '')}:${Math.round(p.ws / 1048576)}`).join(', ')}]  exited=${exited ? JSON.stringify(exited) : 'no'}`)
  }
  if (exited) break
}

console.log(`\n[PEAK TREE RSS] ${Math.round(peakTree / 1048576)} MB   (${peakDetail})`)
console.log(`[child exited] ${exited ? JSON.stringify(exited) : 'still alive'}`)
console.log(`[stderr tail]\n${stderr.slice(-1500) || '(empty)'}`)
child.kill()
process.exit(0)
