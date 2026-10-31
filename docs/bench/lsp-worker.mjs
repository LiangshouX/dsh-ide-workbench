
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
