/**
 * Worst-case benchmark: a large TypeScript project WITH a tsconfig.json, which
 * is what makes tsserver actually build a program and load it into memory.
 *
 * Generates a synthetic monorepo-shaped TS project, then measures:
 *   - RSS growth as the program is built
 *   - idle CPU after indexing settles (does it keep burning cores?)
 *   - latency of completion / definition / references on the real program
 */
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const BENCH_DIR = process.argv[2]
const PROJECT_DIR = process.argv[3]
const FILE_COUNT = Number(process.argv[4] ?? 3000)
const LINES_PER_FILE = Number(process.argv[5] ?? 200)

// ── generate ─────────────────────────────────────────────────────────────────
if (process.env.GENERATE === '1') {
  rmSync(PROJECT_DIR, { recursive: true, force: true })
  mkdirSync(join(PROJECT_DIR, 'src'), { recursive: true })
  const mods = 120
  mkdirSync(join(PROJECT_DIR, 'src', 'mod'), { recursive: true })
  for (let m = 0; m < mods; m++) {
    const body = []
    body.push(`export interface Shape${m} { id: string; size: number; tag: 'm${m}' }`)
    for (let i = 0; i < 60; i++) {
      body.push(`export function helper${m}_${i}(input: Shape${m}, factor: number): number {`)
      body.push(`  const scaled = input.size * factor + ${i}`)
      body.push(`  const label = 'm${m}-${i}-' + scaled.toString()`)
      body.push(`  return scaled + label.length`)
      body.push(`}`)
    }
    writeFileSync(join(PROJECT_DIR, 'src', 'mod', `module${m}.ts`), body.join('\n'), 'utf8')
  }
  for (let f = 0; f < FILE_COUNT; f++) {
    const m = f % mods
    const body = []
    body.push(`import { helper${m}_0, helper${m}_1 } from './mod/module${m}'`)
    body.push(`import type { Shape${m} } from './mod/module${m}'`)
    for (let i = 0; i < LINES_PER_FILE; i++) {
      body.push(`export const value${f}_${i} = helper${m}_0({ id: 'x${f}', size: ${i}, tag: 'm${m}' }, ${i + 1}) + helper${m}_1({ id: 'y${f}', size: ${i}, tag: 'm${m}' }, ${i + 2})`)
    }
    body.push(`export interface Local${f} { alpha: string; beta: number }`)
    writeFileSync(join(PROJECT_DIR, 'src', `file${f}.ts`), body.join('\n'), 'utf8')
  }
  writeFileSync(join(PROJECT_DIR, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, skipLibCheck: true, noEmit: true },
    include: ['src'],
  }, null, 2), 'utf8')
  console.log(`generated ${FILE_COUNT} files x ${LINES_PER_FILE} lines + ${mods} modules`)
  process.exit(0)
}

// ── drive the server ─────────────────────────────────────────────────────────
const child = spawn('node', [join(BENCH_DIR, 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs'), '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] })
let buffer = Buffer.alloc(0)
let nextId = 1
const pending = new Map()
let notifications = 0
child.stderr.on('data', () => {})
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
    } else if (msg.method) notifications++
  }
})
function send(o) { const s = JSON.stringify(o); child.stdin.write(`Content-Length: ${Buffer.byteLength(s, 'utf8')}\r\n\r\n${s}`) }
function request(method, params, timeoutMs = 300000) {
  const id = nextId++
  const t0 = Date.now()
  return new Promise((res, rej) => {
    pending.set(id, { resolve: res, t0 })
    send({ jsonrpc: '2.0', id, method, params })
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)) } }, timeoutMs)
  })
}
function rssMb() {
  try {
    const out = execFileSync('tasklist', ['/FI', `PID eq ${child.pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
    const m = /"(\d+)","[^"]*","([^"]*)",\s*"?([\d,]+)"?/.exec(out)
    if (m) return Math.round(Number(m[3].replace(/,/g, '')) / 1024)
  } catch { /* ignore */ }
  return null
}
function cpuMs() {
  try {
    const out = execFileSync('wmic', ['process', 'where', `ProcessId=${child.pid}`, 'get', 'KernelModeTime,UserModeTime', '/format:csv'], { encoding: 'utf8' })
    const nums = [...out.matchAll(/(\d{10,})/g)].map(x => Number(x[1]))
    if (nums.length >= 2) return Math.round((nums[0] + nums[1]) / 1e4)
  } catch { /* ignore */ }
  return null
}

const t0 = Date.now()
await request('initialize', {
  processId: process.pid,
  rootUri: `file:///${PROJECT_DIR.replace(/\\/g, '/')}`,
  capabilities: { textDocument: { completion: { completionItem: { snippetSupport: true } }, definition: {}, references: {} }, workspace: { symbol: {} } },
  workspaceFolders: [{ uri: `file:///${PROJECT_DIR.replace(/\\/g, '/')}`, name: 'bench' }],
})
send({ jsonrpc: '2.0', method: 'initialized', params: {} })
console.log(`[init] ${Date.now() - t0} ms`)

const target = join(PROJECT_DIR, 'src', 'file0.ts')
const text = (await import('node:fs')).readFileSync(target, 'utf8')
const uri = `file:///${target.replace(/\\/g, '/')}`
send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'typescript', version: 1, text } } })

console.log('\n[program build]')
let peak = 0
for (let i = 1; i <= 30; i++) {
  await new Promise(r => setTimeout(r, 1000))
  const rss = rssMb(); const cpu = cpuMs()
  if (rss !== null && rss > peak) peak = rss
  if (i <= 5 || i % 5 === 0) console.log(`  t+${i}s   RSS=${rss} MB   CPU=${cpu === null ? 'n/a' : (cpu / 1000).toFixed(1) + 's'}`)
}
console.log(`  → peak RSS ${peak} MB, steady ${rssMb()} MB, CPU total ${((cpuMs() ?? 0) / 1000).toFixed(1)}s`)

// idle CPU: 10 s with no requests
const cpuBefore = cpuMs()
await new Promise(r => setTimeout(r, 10000))
const cpuAfter = cpuMs()
console.log(`\n[idle 10s] CPU consumed: ${(((cpuAfter ?? 0) - (cpuBefore ?? 0)) / 1000).toFixed(2)}s  → ${(((cpuAfter ?? 0) - (cpuBefore ?? 0)) / 10000 * 100).toFixed(1)}% of one core`)

const line = text.split('\n').findIndex(l => l.includes('helper'))
const character = text.split('\n')[line].indexOf('helper')
const comp = await request('textDocument/completion', { textDocument: { uri }, position: { line, character } })
console.log(`[completion] ${comp.ms} ms, ${comp.msg.result?.items?.length ?? 0} items, ${(comp.bytes / 1024).toFixed(1)} KB`)
const def = await request('textDocument/definition', { textDocument: { uri }, position: { line, character } })
console.log(`[definition] ${def.ms} ms, ${(def.bytes / 1024).toFixed(1)} KB`)
const refs = await request('textDocument/references', { textDocument: { uri }, position: { line, character }, context: { includeDeclaration: true } })
console.log(`[references] ${refs.ms} ms, ${refs.msg.result?.length ?? 0} hits, ${(refs.bytes / 1024).toFixed(1)} KB`)
const sym = await request('workspace/symbol', { query: 'value12' })
console.log(`[workspaceSymbol] ${sym.ms} ms, ${sym.msg.result?.length ?? 0} hits, ${(sym.bytes / 1024).toFixed(1)} KB`)
console.log(`[notifications] ${notifications}`)
console.log(`\n[FINAL] RSS=${rssMb()} MB peak=${peak} MB CPU=${((cpuMs() ?? 0) / 1000).toFixed(1)}s wall=${((Date.now() - t0) / 1000).toFixed(1)}s`)
child.kill()
process.exit(0)
