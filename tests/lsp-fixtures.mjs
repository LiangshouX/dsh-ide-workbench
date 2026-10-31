/**
 * Test doubles for the host-side language server manager.
 *
 * The manager never needs a real language server to be exercised: the
 * process, the frame worker and the memory probe are all injectable. These
 * doubles mirror the real contracts closely enough that the tests exercise
 * the production code paths (framing, document tracking, crash detection)
 * without a `typescript-language-server` anywhere near the machine.
 */
import { PassThrough, Writable } from 'node:stream'
import { encodeFrame, FrameDecoder } from '../src/host/lsp-frame.js'
import { Handshake } from '../src/host/lsp-worker.js'
import { DEFAULT_LSP_SETTINGS, LspManager } from '../src/host/lsp.js'

/**
 * Wait for one turn of the event loop.
 * @param {number} [ms] the delay
 * @returns {Promise<void>}
 */
export function sleep(ms = 0) {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * One fake subprocess handle.
 *
 * `stdin` records everything the manager writes, `stdout`/`stderr` are real
 * streams the test can push into, and `done` resolves when the fake process
 * "exits".
 * @returns {object} the fake handle
 */
export function makeFakeHandle() {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const stdinChunks = []
  const stdin = new Writable({
    write(chunk, encoding, callback) {
      stdinChunks.push(Buffer.from(chunk))
      callback()
    },
  })
  let resolveDone
  const done = new Promise((resolve) => { resolveDone = resolve })
  let terminateCalls = 0
  const handle = {
    stdin,
    stdout,
    stderr,
    done,
    stdinChunks,
    get terminateCalls() { return terminateCalls },
    terminate() {
      terminateCalls += 1
      resolveDone({ exitCode: null, signal: 'SIGTERM' })
    },
    waitForExit() { return done.then(() => true) },
    /** Make the fake process exit with one code. */
    exit(code, signal = null) { resolveDone({ exitCode: code, signal }) },
  }
  return handle
}

/**
 * Describe one document lifecycle notification.
 * @param {unknown} parsed the parsed payload
 * @returns {object | null} the worker message
 */
function documentEventOf(parsed) {
  if (parsed === null || typeof parsed !== 'object') return null
  const method = parsed.method
  if (typeof method !== 'string') return null
  const params = parsed.params !== null && typeof parsed.params === 'object' ? parsed.params : {}
  const document = params.textDocument !== null && typeof params.textDocument === 'object' ? params.textDocument : {}
  const uri = typeof document.uri === 'string' ? document.uri : ''
  if (uri === '') return null
  if (method === 'textDocument/didOpen') {
    return {
      type: 'document',
      action: 'open',
      uri,
      languageId: typeof document.languageId === 'string' ? document.languageId : 'plaintext',
      version: Number.isFinite(document.version) ? document.version : 0,
      text: typeof document.text === 'string' ? document.text : '',
    }
  }
  if (method === 'textDocument/didClose') return { type: 'document', action: 'close', uri }
  if (method === 'textDocument/didChange') {
    const changes = Array.isArray(params.contentChanges) ? params.contentChanges : []
    const last = changes.length > 0 ? changes[changes.length - 1] : null
    const full = last !== null && typeof last === 'object' && last.range === undefined && typeof last.text === 'string'
    return {
      type: 'document',
      action: 'change',
      uri,
      version: Number.isFinite(document.version) ? document.version : undefined,
      text: full ? last.text : undefined,
    }
  }
  return null
}

/**
 * One fake frame worker.
 *
 * It speaks the same protocol as the real worker (`lsp-worker.js`) and uses
 * the real codec, so the framing the manager relies on is exercised for real.
 * The handshake rules come from the real `Handshake` class as well: a second
 * `initialize` is absorbed and never reaches the server, exactly as in the
 * worker thread.
 *
 * One difference is deliberate: the fake worker answers *synchronously*,
 * while the worker thread answers in a later turn of the event loop. The
 * manager therefore has to be correct without depending on the timing of the
 * answer.
 * @param {object} [workerData] the data the manager passed to the worker
 * @returns {object} the fake worker
 */
export function makeFakeWorker(workerData = {}) {
  const handlers = new Map()
  const decoder = new FrameDecoder()
  const handshake = new Handshake()
  const worker = {
    workerData,
    terminated: false,
    /** Every message the manager posted to the worker. */
    posted: [],
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event).add(handler)
      return worker
    },
    off(event, handler) { handlers.get(event)?.delete(handler) },
    emit(event, ...args) { for (const handler of handlers.get(event) ?? []) handler(...args) },
    postMessage(message) {
      worker.posted.push(message)
      if (message.type === 'stdout') {
        const bytes = Buffer.isBuffer(message.data) ? message.data : Buffer.from(message.data)
        for (const text of decoder.push(bytes)) {
          handshake.noteServerPayload(text)
          worker.emit('message', { type: 'message', text })
          for (const answer of handshake.takePendingAnswers()) {
            worker.emit('message', { type: 'message', text: answer })
          }
        }
        return
      }
      if (message.type === 'send') {
        const text = message.text
        if (message.origin !== 'host') {
          let parsed
          try {
            parsed = JSON.parse(text)
          } catch {
            worker.emit('message', { type: 'dropped', reason: 'not JSON' })
            return
          }
          const event = documentEventOf(parsed)
          if (event !== null) worker.emit('message', event)
          // A handshake the server already answered is answered from the
          // cache and never reaches the server again.
          const answer = handshake.answerFor(text)
          if (answer !== null) {
            worker.emit('message', { type: 'message', text: answer })
            return
          }
        }
        if (message.origin !== 'host' && handshake.isInitialize(text)) {
          // A second handshake is absorbed: the server is initialized once.
          if (!handshake.noteForwarded(text)) return
          worker.emit('message', { type: 'handshake', text })
        }
        worker.emit('message', { type: 'stdin', data: encodeFrame(text) })
      }
    },
    terminate() { worker.terminated = true },
  }
  return worker
}

/**
 * Decode every payload a fake handle received on stdin.
 * @param {Buffer[]} chunks the recorded stdin chunks
 * @returns {string[]} the payloads
 */
export function decodeChunks(chunks) {
  const decoder = new FrameDecoder()
  const payloads = []
  for (const chunk of chunks) payloads.push(...decoder.push(chunk))
  return payloads
}

/**
 * One manager with every dependency replaced by a double.
 * @param {object} [options]
 * @param {object} [options.lsp] the `lsp` section of the settings document
 * @param {() => { totalBytes: number, freeBytes: number }} [options.readMemory]
 * @param {(map: object) => Promise<void>} [options.persistIndexedRoots]
 * @param {number} [options.readyDelayMs]
 * @param {number} [options.restartBackoffMs]
 * @param {number} [options.timeoutLimit]
 * @param {number} [options.spawnDelayMs] how long the fake process takes to
 *   start (the window in which the session may change its state)
 * @returns {object} the manager and the recorded calls
 */
export function makeManager(options = {}) {
  const lsp = { ...DEFAULT_LSP_SETTINGS, ...(options.lsp ?? {}) }
  const document = { lsp }
  const spawned = []
  const workers = []
  const persisted = []
  /** The warnings the manager wrote to the host log. */
  const warnings = []
  const spawnDelayMs = Number.isFinite(options.spawnDelayMs) ? options.spawnDelayMs : 0
  const manager = new LspManager({
    ctx: {
      subprocess: { spawn: () => { throw new Error('the fake manager never uses ctx.subprocess') } },
      logger: { warn: (...args) => { warnings.push(args.map(String).join(' ')) } },
    },
    getSettings: async () => document,
    persistIndexedRoots: async (map) => {
      persisted.push(map)
      document.lsp.indexedRoots = map
    },
    spawnServer: async (spec) => {
      if (spawnDelayMs > 0) await sleep(spawnDelayMs)
      const handle = makeFakeHandle()
      spawned.push({ spec, handle })
      return handle
    },
    createWorker: (workerData) => {
      const worker = makeFakeWorker(workerData)
      workers.push(worker)
      return worker
    },
    now: options.now,
    readMemory: options.readMemory ?? (() => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3 })),
    readyDelayMs: options.readyDelayMs ?? 10,
    restartBackoffMs: options.restartBackoffMs ?? 10,
    timeoutLimit: options.timeoutLimit ?? 3,
    graceMs: options.graceMs ?? 20,
  })
  return {
    manager,
    spawned,
    workers,
    persisted,
    document,
    lsp,
    /** The warnings the manager wrote to the host log. */
    warnings,
    /** The handle of the n-th spawned process. */
    handle: (index = 0) => spawned[index]?.handle,
  }
}

/**
 * One sink that records what the manager sends to a client.
 * @returns {{ send: (text: string) => void, control: (event: object) => void, texts: string[], events: object[] }}
 */
export function makeSink() {
  const texts = []
  const events = []
  return {
    texts,
    events,
    send(text) { texts.push(text) },
    control(event) { events.push(event) },
  }
}
