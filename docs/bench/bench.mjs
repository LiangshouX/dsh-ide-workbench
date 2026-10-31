/**
 * LSP footprint benchmark: spawn a real language server over stdio, drive it
 * with raw LSP framing, and report RSS / CPU / latency for the operations the
 * IDE features need (completion, definition, references).
 *
 * This doubles as a prototype of the host-side manager the assessment calls for.
 */
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BENCH_DIR = process.argv[2]
const PROJECT_DIR = process.argv[3]
const SERVER = process.argv[4]
const SERVER_ARGS = process.argv.slice(5)

function listFiles(dir, out = [], depth = 0) {
  if (depth > 8) return out
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) listFiles(p, out, depth + 1)
    else out.push(p)
  }
  return out
}

const files = listFiles(PROJECT_DIR)
console.log(`project: ${PROJECT_DIR}`)
console.log(`files (excl node_modules/.git): ${files.length}`)

const child = spawn(SERVER, SERVER_ARGS, { stdio: ['pipe', 'pipe', 'pipe'] })

let stderr = ''
child.stderr.on('data', d => { stderr += d.toString() })

// ── raw LSP framing over stdio ───────────────────────────────────────────────
let nextId = 1
const pending = new Map()
let buffer = Buffer.alloc(0)
const notifications = []

child.stdout.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd < 0) return
    const header = buffer.subarray(0, headerEnd).toString('ascii')
    const m = /Content-Length:\s*(\d+)/i.exec(header)
    if (!m) { buffer = buffer.subarray(headerEnd + 4); continue }
    const len = Number(m[1])
    const bodyStart = headerEnd + 4
    if (buffer.length < bodyStart + len) return
    const body = buffer.subarray(bodyStart, bodyStart + len).toString('utf8')
    buffer = buffer.subarray(bodyStart + len)
    let msg
    try { msg = JSON.parse(body) } catch { continue }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, t0 } = pending.get(msg.id)
      pending.delete(msg.id)
      resolve({ msg, ms: Date.now() - t0, bytes: Buffer.byteLength(body) })
    } else if (msg.method !== undefined) {
      notifications.push({ method: msg.method, bytes: Buffer.byteLength(body), body })
    }
  }
})

function send(obj) {
  const s = JSON.stringify(obj)
  child.stdin.write(`Content-Length: ${Buffer.byteLength(s, 'utf8')}\r\n\r\n${s}`)
}

function request(method, params, timeoutMs = 120000) {
  const id = nextId++
  const t0 = Date.now()
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, t0 })
    send({ jsonrpc: '2.0', id, method, params })
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)) }
    }, timeoutMs)
  })
}

function notify(method, params) { send({ jsonrpc: '2.0', method, params }) }

// ── process sampling ─────────────────────────────────────────────────────────
let peakRss = 0
const samples = []
const sampler = setInterval(() => {
  try {
    const out = readFileSync(join(tmpdir(), 'lsp-rss.txt'), 'utf8')
  } catch { /* ignore */ }
}, 1000)

// Read the child's RSS through a synchronous wmic-free path: use process handle info
function sampleChild() {
  const pid = child.pid
  try {
    const { execFileSync } = require('node:child_process')
  } catch { /* ignore */ }
  return null
}

// Use PowerShell-free approach: read from the OS via `wmic` is deprecated; use tasklist
import { execFileSync } from 'node:child_process'
function rssMb() {
  try {
    const out = execFileSync('tasklist', ['/FI', `PID eq ${child.pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
    const m = /"(\d+)","[^"]*","([^"]*)",\s*"?([\d,]+)"?/.exec(out)
    if (m) {
      const kb = Number(m[3].replace(/,/g, ''))
      return Math.round(kb / 1024)
    }
  } catch { /* ignore */ }
  return null
}
function cpuSec() {
  try {
    const out = execFileSync('wmic', ['process', 'where', `ProcessId=${child.pid}`, 'get', 'KernelModeTime,UserModeTime', '/format:csv'], { encoding: 'utf8' })
    const nums = [...out.matchAll(/(\d{10,})/g)].map(x => Number(x[1]))
    if (nums.length >= 2) return Math.round((nums[0] + nums[1]) / 1e7 * 100) / 100
  } catch { /* ignore */ }
  return null
}

let stop = false
;(async () => {
  const tStart = Date.now()
  const init = await request('initialize', {
    processId: process.pid,
    rootUri: `file:///${PROJECT_DIR.replace(/\\/g, '/')}`,
    capabilities: {
      textDocument: {
        completion: { completionItem: { snippetSupport: true } },
        definition: {},
        references: {},
        hover: {},
      },
      workspace: { symbol: {}, workspaceFolders: true },
    },
    workspaceFolders: [{ uri: `file:///${PROJECT_DIR.replace(/\\/g, '/')}`, name: 'bench' }],
  }, 180000)
  const initMs = Date.now() - tStart
  console.log(`\n[init] ${initMs} ms, response ${(init.bytes / 1024).toFixed(1)} KB`)
  console.log(`[init] server capabilities: completion=${!!init.msg.result?.capabilities?.completionProvider} definition=${!!init.msg.result?.capabilities?.definitionProvider} references=${!!init.msg.result?.capabilities?.referencesProvider} symbols=${!!init.msg.result?.capabilities?.workspaceSymbolProvider}`)

  notify('initialized', {})
  await new Promise(r => setTimeout(r, 300))

  // open the biggest source file
  const srcFiles = files.filter(f => /\.(ts|tsx|js|jsx)$/.test(f))
    .map(f => ({ f, size: statSync(f).size }))
    .sort((a, b) => b.size - a.size)
  console.log(`[files] source files: ${srcFiles.length}`)

  if (srcFiles.length === 0) { console.log('no source files'); child.kill(); process.exit(0) }
  const target = srcFiles[0].f
  const text = readFileSync(target, 'utf8')
  const uri = `file:///${target.replace(/\\/g, '/')}`
  console.log(`[open] ${target.replace(PROJECT_DIR, '')} (${(text.length / 1024).toFixed(1)} KB)`)

  const tOpen = Date.now()
  notify('textDocument/didOpen', {
    textDocument: { uri, languageId: 'typescript', version: 1, text },
  })
  await new Promise(r => setTimeout(r, 500))

  // let it index
  const idxStart = Date.now()
  let lastRss = rssMb()
  let maxRss = lastRss ?? 0
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500))
    const r = rssMb()
    if (r !== null) { lastRss = r; if (r > maxRss) maxRss = r }
    if (i === 2 || i === 6 || i === 20) {
      console.log(`  t+${((Date.now() - idxStart) / 1000).toFixed(1)}s  RSS=${r} MB  CPU=${cpuSec()}s`)
    }
  }
  console.log(`[index] 20s settle → RSS=${lastRss} MB, peak=${maxRss} MB, CPU total=${cpuSec()}s`)

  // completion
  const pos = text.split('\n').findIndex(l => /\w+\s*[({=]/.test(l))
  const line = Math.max(0, pos)
  const char = Math.max(0, (text.split('\n')[line] || '').search(/\w/))
  const tC = Date.now()
  const comp = await request('textDocument/completion', {
    textDocument: { uri },
    position: { line, character: char },
  })
  const items = comp.msg.result?.items?.length ?? comp.msg.result?.length ?? 0
  console.log(`[completion] ${comp.ms} ms, ${items} items, ${(comp.bytes / 1024).toFixed(1)} KB`)

  // definition
  const tD = Date.now()
  const def = await request('textDocument/definition', {
    textDocument: { uri },
    position: { line, character: char },
  })
  console.log(`[definition] ${def.ms} ms, ${(def.bytes / 1024).toFixed(1)} KB`)

  // references
  const tR = Date.now()
  const refs = await request('textDocument/references', {
    textDocument: { uri },
    position: { line, character: char },
    context: { includeDeclaration: true },
  })
  const refCount = Array.isArray(refs.msg.result) ? refs.msg.result.length : 0
  console.log(`[references] ${refs.ms} ms, ${refCount} hits, ${(refs.bytes / 1024).toFixed(1)} KB`)

  // workspace symbols
  const tS = Date.now()
  const syms = await request('workspace/symbol', { query: 'a' })
  const symCount = Array.isArray(syms.msg.result) ? syms.msg.result.length : 0
  console.log(`[workspaceSymbol] ${syms.ms} ms, ${symCount} hits, ${(syms.bytes / 1024).toFixed(1)} KB`)

  // diagnostics volume
  const diags = notifications.filter(n => n.method === 'textDocument/publishDiagnostics')
  const diagBytes = diags.reduce((a, n) => a + n.bytes, 0)
  console.log(`[diagnostics] ${notifications.length} notifications total, ${(diagBytes / 1024).toFixed(1)} KB of publishDiagnostics`)

  console.log(`\n[FINAL] RSS=${rssMb()} MB, peak=${maxRss} MB, CPU=${cpuSec()}s, wall=${((Date.now() - tStart) / 1000).toFixed(1)}s`)
  if (stderr.trim()) console.log(`[stderr first 500]\n${stderr.slice(0, 500)}`)
  clearInterval(sampler)
  child.kill()
  process.exit(0)
})().catch(e => {
  console.error('BENCH ERROR:', e.message)
  console.error('stderr:', stderr.slice(0, 800))
  child.kill()
  process.exit(1)
})
