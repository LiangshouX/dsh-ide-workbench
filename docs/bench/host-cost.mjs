/**
 * Host-side cost benchmark: what does the DSH host process actually pay for
 * relaying LSP traffic, and can a burst of it stall the host event loop
 * (which is what "DSH 卡顿" would look like)?
 *
 * The host is a single Node process shared by the plugin's HTTP API, the
 * terminal WebSocket, git polling, and the agent's own tool calls.
 */
import { WebSocketServer, WebSocket } from 'ws'

// ── 1. event-loop delay probe ────────────────────────────────────────────────
let maxDrift = 0
let samples = []
const probe = setInterval(() => {
  const drift = Date.now() - (probe.__last + 50)
  if (probe.__last !== undefined) { maxDrift = Math.max(maxDrift, drift); samples.push(drift) }
  probe.__last = Date.now()
}, 50)

// ── 2. payload sizes seen in the real run ────────────────────────────────────
const PAYLOADS = [
  ['completion (1000 items)', 73 * 1024],
  ['workspace/symbol (1027 hits)', 216 * 1024],
  ['references (98 hits)', 16.7 * 1024],
  ['worst case: huge references', 5 * 1024 * 1024],
  ['pathological: full-text didChange', 8 * 1024 * 1024],
]

function makePayload(bytes) {
  // Shape it like a real LSP response: many small objects under `result`.
  const per = 90
  const count = Math.max(1, Math.floor(bytes / per))
  const items = new Array(count).fill(0).map((_, i) => ({
    uri: `file:///project/src/module${i % 500}/component${i}.ts`,
    range: {
      start: { line: i % 4000, character: (i * 7) % 120 },
      end: { line: i % 4000, character: (i * 7) % 120 + 9 },
    },
    name: `symbol${i}`,
    kind: 12,
    containerName: `Container${i % 80}`,
  }))
  return { jsonrpc: '2.0', id: 1, result: items }
}

console.log('=== JSON 处理成本（宿主主线程，同步） ===')
for (const [name, bytes] of PAYLOADS) {
  const obj = makePayload(bytes)
  const s = JSON.stringify(obj)
  const t0 = process.hrtime.bigint()
  const parsed = JSON.parse(s)
  const parseMs = Number(process.hrtime.bigint() - t0) / 1e6
  const t1 = process.hrtime.bigint()
  JSON.stringify(parsed)
  const strMs = Number(process.hrtime.bigint() - t1) / 1e6
  console.log(`  ${name.padEnd(32)} ${(s.length / 1024).toFixed(0).padStart(6)} KB   parse ${parseMs.toFixed(2).padStart(7)} ms   stringify ${strMs.toFixed(2).padStart(7)} ms`)
}

console.log('\n=== WebSocket 中继成本（宿主进程内，含真实 socket） ===')
const wss = new WebSocketServer({ port: 0 })
const port = wss.address().port
const received = []

await new Promise((resolve) => {
  wss.on('connection', (sock) => {
    sock.on('message', (data) => {
      received.push(data.length)
      const t = process.hrtime.bigint()
      JSON.parse(data.toString('utf8'))
      const ms = Number(process.hrtime.bigint() - t) / 1e6
      console.log(`  收到 ${(data.length / 1024).toFixed(0).padStart(6)} KB  → JSON.parse ${ms.toFixed(2)} ms  (loop drift so far ${maxDrift} ms)`)
    })
  })
  const client = new WebSocket(`ws://127.0.0.1:${port}`)
  client.on('open', async () => {
    for (const [name, bytes] of PAYLOADS) {
      const s = JSON.stringify(makePayload(bytes))
      const t = process.hrtime.bigint()
      client.send(s)
      const ms = Number(process.hrtime.bigint() - t) / 1e6
      console.log(`  发送 ${name.padEnd(32)} ${(s.length / 1024).toFixed(0).padStart(6)} KB   send ${ms.toFixed(2)} ms`)
      await new Promise(r => setTimeout(r, 120))
    }
    await new Promise(r => setTimeout(r, 300))
    client.close()
    wss.close()
    resolve()
  })
})

console.log('\n=== 事件循环漂移（模拟宿主被 LSP 洪水冲击） ===')
samples.sort((a, b) => a - b)
const p = q => samples[Math.floor(samples.length * q)] ?? 0
console.log(`  样本 ${samples.length} 个 · p50 ${p(0.5).toFixed(1)} ms · p95 ${p(0.95).toFixed(1)} ms · p99 ${p(0.99).toFixed(1)} ms · max ${maxDrift} ms`)
console.log(`  >50ms 的采样数: ${samples.filter(s => s > 50).length}`)

clearInterval(probe)
process.exit(0)
