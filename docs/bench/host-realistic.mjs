/**
 * Realistic-bounds host cost + worker_thread isolation test.
 *
 * Q1: with payloads the plugin can actually produce (editableMaxBytes = 1 MB),
 *     how much does the host's event loop stall?
 * Q2: does moving the LSP client into a worker_thread eliminate the stall?
 * Q3: what does opaque relay (forwarding bytes without parsing) cost?
 */
import { Worker } from 'node:worker_threads'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const benchDir = process.argv[2]

// ── event loop probe ─────────────────────────────────────────────────────────
function makeProbe(label) {
  const state = { samples: [], max: 0, last: undefined }
  state.timer = setInterval(() => {
    const now = Date.now()
    if (state.last !== undefined) {
      const drift = now - (state.last + 25)
      state.samples.push(drift)
      if (drift > state.max) state.max = drift
    }
    state.last = now
  }, 25)
  state.report = () => {
    clearInterval(state.timer)
    const s = [...state.samples].sort((a, b) => a - b)
    const q = p => s[Math.floor(s.length * p)] ?? 0
    return `${label}: n=${s.length} p50=${q(0.5).toFixed(1)}ms p95=${q(0.95).toFixed(1)}ms p99=${q(0.99).toFixed(1)}ms max=${state.max}ms >50ms:${s.filter(x => x > 50).length}`
  }
  return state
}

function payload(bytes) {
  const per = 90
  const count = Math.max(1, Math.floor(bytes / per))
  const items = new Array(count).fill(0).map((_, i) => ({
    uri: `file:///project/src/m${i % 500}/c${i}.ts`,
    range: { start: { line: i % 4000, character: (i * 7) % 120 }, end: { line: i % 4000, character: (i * 7) % 120 + 9 } },
    name: `symbol${i}`, kind: 12,
  }))
  return JSON.stringify({ jsonrpc: '2.0', id: 1, result: items })
}

// ── the real-world payload set ───────────────────────────────────────────────
const CASES = [
  ['incremental didChange (typical)', 8 * 1024],          // a few keystrokes
  ['full didChange @ plugin 1MB cap', 1024 * 1024],        // editableMaxBytes = 1<<20
  ['completion (measured real)', 158 * 1024],
  ['workspace/symbol (measured real)', 473 * 1024],
  ['references, huge monorepo symbol', 5 * 1024 * 1024],
]

// ── Q1: main-thread handling ─────────────────────────────────────────────────
console.log('=== Q1: 宿主主线程直接处理（朴素实现） ===')
{
  const probe = makeProbe('主线程')
  for (const [name, bytes] of CASES) {
    const s = payload(bytes)
    const t0 = process.hrtime.bigint()
    const obj = JSON.parse(s)
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    // forward as a browser would receive it
    const buf = Buffer.from(JSON.stringify(obj), 'utf8')
    console.log(`  ${name.padEnd(34)} ${(s.length / 1024).toFixed(0).padStart(6)} KB   parse ${ms.toFixed(2).padStart(7)} ms   → 转发 ${(buf.length / 1024).toFixed(0)} KB`)
  }
  console.log('  ' + probe.report())
}

// ── Q3: opaque relay (no parse on the main thread) ──────────────────────────
console.log('\n=== Q3: 不解析、只做字节中继（转发 Buffer） ===')
{
  const probe = makeProbe('中继')
  for (const [name, bytes] of CASES) {
    const s = payload(bytes)
    const t0 = process.hrtime.bigint()
    const buf = Buffer.from(s, 'utf8')   // just a copy
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    console.log(`  ${name.padEnd(34)} ${(buf.length / 1024).toFixed(0).padStart(6)} KB   copy ${ms.toFixed(2).padStart(7)} ms`)
  }
  console.log('  ' + probe.report())
}

// ── Q2: worker_thread isolation ─────────────────────────────────────────────
console.log('\n=== Q2: 把 LSP 客户端放进 worker_thread ===')
const workerSrc = `
import { parentPort, workerData } from 'node:worker_threads'
const cases = workerData.cases
const results = []
for (const [name, bytes] of cases) {
  const s = JSON.stringify({ jsonrpc: '2.0', id: 1, result: new Array(Math.max(1, Math.floor(bytes / 90))).fill(0).map((_, i) => ({ uri: 'file:///a/' + i, name: 'sym' + i })) })
  const t0 = process.hrtime.bigint()
  JSON.parse(s)
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  results.push({ name, bytes: s.length, ms })
}
parentPort.postMessage(results)
`
const workerPath = join(benchDir, 'lsp-worker.mjs')
writeFileSync(workerPath, workerSrc, 'utf8')

{
  const probe = makeProbe('worker 隔离')
  const results = await new Promise((resolve, reject) => {
    const w = new Worker(workerPath, { workerData: { cases: CASES } })
    w.on('message', resolve)
    w.on('error', reject)
  })
  for (const r of results) {
    console.log(`  ${r.name.padEnd(34)} ${(r.bytes / 1024).toFixed(0).padStart(6)} KB   parse ${r.ms.toFixed(2).padStart(7)} ms  (在 worker 内，主线程不阻塞)`)
  }
  console.log('  ' + probe.report())
}

console.log('\n=== 结论对照 ===')
console.log('  插件当前 editor.editableMaxBytes = 1 MB —— 这是编辑器可编辑文件的上限，')
console.log('  所以 didChange 的全文同步载荷被这个上限约束在 ~1 MB。')
process.exit(0)
