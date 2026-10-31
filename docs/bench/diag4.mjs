/**
 * Diagnostic v4: accurate per-process RSS + CPU for the whole language-server
 * tree (wmic's CPU columns are gone on modern Windows, so use Win32_Process
 * KernelModeTime/UserModeTime via CIM, which are 100ns units).
 */
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BENCH = process.argv[2]
const PROJECT = process.argv[3]
const WAIT_S = Number(process.argv[4] ?? 180)
const HEAP_MB = Number(process.argv[5] ?? 2048)
const IDLE_S = Number(process.argv[6] ?? 15)

const psCmd = `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,KernelModeTime,UserModeTime | ConvertTo-Json -Compress`
function snapshot() {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', psCmd], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    const arr = JSON.parse(out)
    return (Array.isArray(arr) ? arr : [arr]).map(p => ({
      pid: p.ProcessId, ppid: p.ParentProcessId, ws: Number(p.WorkingSetSize) || 0,
      cpuMs: ((Number(p.KernelModeTime) || 0) + (Number(p.UserModeTime) || 0)) / 10000,
      name: (p.Name || '?').replace('.exe', '').trim(),
    }))
  } catch { return [] }
}
function descendants(rootPid, procs) {
  const byParent = new Map()
  for (const p of procs) { if (!byParent.has(p.ppid)) byParent.set(p.ppid, []); byParent.get(p.ppid).push(p) }
  const out = []; const stack = [rootPid]
  while (stack.length) { const cur = stack.pop(); for (const c of byParent.get(cur) ?? []) { out.push(c); stack.push(c.pid) } }
  return out
}
function tree() {
  const procs = snapshot()
  return { procs, all: [procs.find(p => p.pid === child.pid), ...descendants(child.pid, procs)].filter(Boolean) }
}

const child = spawn('node', [join(BENCH, 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs'), '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] })
let stderr = ''; child.stderr.on('data', d => { stderr += d.toString() })
let exited = null; child.on('exit', (code) => { exited = { code } })
let buffer = Buffer.alloc(0); let nextId = 1; const pending = new Map()
child.stdout.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const he = buffer.indexOf('\r\n\r\n'); if (he < 0) return
    const m = /Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, he).toString('ascii'))
    if (!m) { buffer = buffer.subarray(he + 4); continue }
    const len = Number(m[1]); if (buffer.length < he + 4 + len) return
    const body = buffer.subarray(he + 4, he + 4 + len).toString('utf8')
    buffer = buffer.subarray(he + 4 + len)
    let msg; try { msg = JSON.parse(body) } catch { continue }
    if (msg.id !== undefined && pending.has(msg.id)) { const { resolve, t0 } = pending.get(msg.id); pending.delete(msg.id); resolve({ msg, ms: Date.now() - t0 }) }
  }
})
function send(o) { const s = JSON.stringify(o); child.stdin.write(`Content-Length: ${Buffer.byteLength(s, 'utf8')}\r\n\r\n${s}`) }
function request(method, params) {
  const id = nextId++; const t0 = Date.now()
  return new Promise((res, rej) => { pending.set(id, { resolve: res, t0 }); send({ jsonrpc: '2.0', id, method, params }); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, 900000) })
}

await request('initialize', {
  processId: process.pid,
  rootUri: `file:///${PROJECT.replace(/\\/g, '/')}`,
  capabilities: { textDocument: { completion: { completionItem: { snippetSupport: true } }, definition: {}, references: {} }, workspace: { symbol: {} } },
  workspaceFolders: [{ uri: `file:///${PROJECT.replace(/\\/g, '/')}`, name: 'bench' }],
  initializationOptions: { maxTsServerMemory: HEAP_MB },
})
send({ jsonrpc: '2.0', method: 'initialized', params: {} })
const target = join(PROJECT, 'src', process.argv[7] ?? 'file0.ts')
const text = readFileSync(target, 'utf8')
const uri = `file:///${target.replace(/\\/g, '/')}`
send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'typescript', version: 1, text } } })
console.log(`[init + didOpen] ${target.split('\\').pop()}, maxTsServerMemory=${HEAP_MB} MB`)

let peakRss = 0; let peakDetail = ''
for (let i = 1; i <= WAIT_S; i++) {
  await new Promise(r => setTimeout(r, 1000))
  const { all } = tree()
  const total = all.reduce((a, p) => a + p.ws, 0)
  if (total > peakRss) { peakRss = total; peakDetail = all.map(p => `${p.name}#${p.pid}=${Math.round(p.ws / 1048576)}MB`).join(' + ') }
  if (i % 20 === 0) console.log(`  t+${i}s  treeRSS=${Math.round(total / 1048576)} MB  [${all.map(p => `${p.name}:${Math.round(p.ws / 1048576)}`).join(', ')}]  exited=${exited ? JSON.stringify(exited) : 'no'}`)
  if (exited) break
}
console.log(`\n[PEAK TREE RSS] ${Math.round(peakRss / 1048576)} MB  (${peakDetail})`)
console.log(`[exited] ${exited ? JSON.stringify(exited) : 'alive'}`)

// ── idle CPU measurement (real, per process) ────────────────────────────────
if (!exited) {
  const before = tree()
  await new Promise(r => setTimeout(r, IDLE_S * 1000))
  const after = tree()
  let dCpu = 0; let dRss = 0
  for (const a of after.all) {
    const b = before.all.find(x => x.pid === a.pid)
    if (b) { dCpu += a.cpuMs - b.cpuMs; dRss += a.ws - b.ws }
  }
  console.log(`\n[IDLE ${IDLE_S}s] CPU consumed by language-server tree: ${(dCpu / 1000).toFixed(2)} s  → ${(dCpu / 1000 / IDLE_S * 100).toFixed(1)}% of one core`)
  console.log(`[IDLE ${IDLE_S}s] RSS delta: ${(dRss / 1048576).toFixed(0)} MB`)
  const line = text.split('\n').findIndex(l => l.includes('helper') || l.includes('format') || l.includes('step'))
  const ch = Math.max(0, text.split('\n')[line].search(/\w/))
  const t = Date.now()
  try {
    const comp = await request('textDocument/completion', { textDocument: { uri }, position: { line, character: ch } })
    console.log(`[completion] ${Date.now() - t} ms, ${comp.msg.result?.items?.length ?? 0} items`)
  } catch (e) { console.log(`[completion] FAILED ${e.message}`) }
}
if (exited) console.log(`[stderr tail]\n${stderr.slice(-900)}`)
child.kill()
process.exit(0)
