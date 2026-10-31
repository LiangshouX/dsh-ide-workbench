/**
 * Diagnostic v3: confirm the crash cause on a large TS project.
 *  - raises tsserver's heap limit via initializationOptions.maxTsServerMemory
 *  - samples the whole process tree with PowerShell CIM (accurate RSS)
 */
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BENCH = process.argv[2]
const PROJECT = process.argv[3]
const WAIT_S = Number(process.argv[4] ?? 240)
const HEAP_MB = Number(process.argv[5] ?? 4096)

const psCmd = `
$p = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize
$p | ConvertTo-Json -Compress
`
function psSnapshot() {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', psCmd], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    const arr = JSON.parse(out)
    return (Array.isArray(arr) ? arr : [arr]).map(p => ({ pid: p.ProcessId, ppid: p.ParentProcessId, ws: Number(p.WorkingSetSize) || 0, name: p.Name || '' }))
  } catch { return [] }
}
function descendants(rootPid, procs) {
  const byParent = new Map()
  for (const p of procs) { if (!byParent.has(p.ppid)) byParent.set(p.ppid, []); byParent.get(p.ppid).push(p) }
  const out = []; const stack = [rootPid]
  while (stack.length) { const cur = stack.pop(); for (const c of byParent.get(cur) ?? []) { out.push(c); stack.push(c.pid) } }
  return out
}

const child = spawn('node', [join(BENCH, 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs'), '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] })
let stderr = ''
child.stderr.on('data', d => { stderr += d.toString() })
let exited = null
child.on('exit', (code) => { exited = { code } })

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

const target = join(PROJECT, 'src', 'file0.ts')
const text = readFileSync(target, 'utf8')
const uri = `file:///${target.replace(/\\/g, '/')}`
send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'typescript', version: 1, text } } })
console.log(`[init + didOpen] done, maxTsServerMemory=${HEAP_MB} MB`)

let peakTree = 0; let peakDetail = ''
for (let i = 1; i <= WAIT_S; i++) {
  await new Promise(r => setTimeout(r, 1000))
  const procs = psSnapshot()
  const tree = [procs.find(p => p.pid === child.pid), ...descendants(child.pid, procs)].filter(Boolean)
  const total = tree.reduce((a, p) => a + p.ws, 0)
  if (total > peakTree) { peakTree = total; peakDetail = tree.map(p => `${(p.name || '?').replace('.exe', '').trim()}#${p.pid}=${Math.round(p.ws / 1048576)}MB`).join(' + ') }
  if (i % 15 === 0) console.log(`  t+${i}s  tree=${Math.round(total / 1048576)} MB  [${tree.map(p => `${(p.name || '?').replace('.exe', '').trim()}:${Math.round(p.ws / 1048576)}`).join(', ')}]  exited=${exited ? JSON.stringify(exited) : 'no'}`)
  if (exited) break
}

console.log(`\n[PEAK TREE RSS] ${Math.round(peakTree / 1048576)} MB  (${peakDetail})`)
console.log(`[child exited] ${exited ? JSON.stringify(exited) : 'still alive'}`)
if (exited) console.log(`[stderr tail]\n${stderr.slice(-1200)}`)
else {
  const line = text.split('\n').findIndex(l => l.includes('helper'))
  const ch = text.split('\n')[line].indexOf('helper')
  const t = Date.now()
  try {
    const comp = await request('textDocument/completion', { textDocument: { uri }, position: { line, character: ch } })
    console.log(`[completion] ${Date.now() - t} ms, ${comp.msg.result?.items?.length ?? 0} items`)
  } catch (e) { console.log(`[completion] FAILED: ${e.message}`) }
  const t2 = Date.now()
  try {
    const refs = await request('textDocument/references', { textDocument: { uri }, position: { line, character: ch }, context: { includeDeclaration: true } })
    console.log(`[references] ${Date.now() - t2} ms, ${refs.msg.result?.length ?? 0} hits`)
  } catch (e) { console.log(`[references] FAILED: ${e.message}`) }
  console.log(`[final tree RSS] ${Math.round(psSnapshot().reduce((a, p) => a + p.ws, 0) / 1048576)} MB (incl. unrelated processes)`)
}
child.kill()
process.exit(0)
