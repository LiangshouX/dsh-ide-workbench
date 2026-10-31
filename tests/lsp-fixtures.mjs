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
import { Handshake, answeredIdOf, requestIdOf, requestOf, withMemoryLimit } from '../src/host/lsp-worker.js'
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
 * Wait until one condition holds.
 *
 * A fixed sleep is a race: on a busy machine the watchdog of the language
 * server may not have run yet when the assertion is made, and the case
 * fails for a reason that has nothing to do with the behaviour it checks.
 * The helper waits for the condition and gives up after the timeout.
 * @param {() => boolean} condition the condition to wait for
 * @param {number} [timeoutMs] how long to wait at most
 * @param {number} [stepMs] how long to wait between the tries
 * @returns {Promise<boolean>} whether the condition held
 */
export async function waitFor(condition, timeoutMs = 3000, stepMs = 10) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return true
    await sleep(stepMs)
  }
  return condition()
}

/**
 * One fake subprocess handle.
 *
 * `stdin` records everything the manager writes, `stdout`/`stderr` are real
 * streams the test can push into, and `done` resolves when the fake process
 * "exits".
 * @param {object} [options]
 * @param {number} [options.terminateDelayMs] how long the process takes to
 *   die after `terminate()` - the window in which a second cancel arrives
 *   while the first one is still running
 * @param {boolean} [options.failStdin] when true the stdin is a broken pipe:
 *   every write fails ASYNCHRONOUSLY, exactly like the pipe of a process
 *   that is already gone
 * @returns {object} the fake handle
 */
export function makeFakeHandle(options = {}) {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const stdinChunks = []
  const stdin = new Writable({
    write(chunk, encoding, callback) {
      stdinChunks.push(Buffer.from(chunk))
      if (options.failStdin === true) {
        // The write fails ASYNCHRONOUSLY: the error of the stream arrives
        // after the write has returned, so the try/catch of the caller
        // cannot catch it - and a stream without an 'error' listener turns
        // it into an uncaught exception that kills the whole host. That is
        // the shape of the EPIPE that ended the DSH process, and a
        // synchronous throw would prove nothing.
        setImmediate(() => {
          const error = new Error('write EPIPE')
          error.code = 'EPIPE'
          stdin.emit('error', error)
        })
      }
      callback()
    },
  })
  let resolveDone
  let exited = false
  const done = new Promise((resolve) => { resolveDone = resolve })
  let terminateCalls = 0
  const handle = {
    stdin,
    stdout,
    stderr,
    done,
    stdinChunks,
    get terminateCalls() { return terminateCalls },
    /** Whether the fake process is gone. */
    get exited() { return exited },
    terminate() {
      terminateCalls += 1
      const finish = () => { exited = true; resolveDone({ exitCode: null, signal: 'SIGTERM' }) }
      if (Number.isFinite(options.terminateDelayMs) && options.terminateDelayMs > 0) {
        // The timer is not unref'd: the test waits for the process to die.
        setTimeout(finish, options.terminateDelayMs)
      } else {
        finish()
      }
    },
    waitForExit() { return done.then(() => true) },
    /** Make the fake process exit with one code. */
    exit(code, signal = null) { exited = true; resolveDone({ exitCode: code, signal }) },
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
          // The real worker reports which id the payload answers, so the
          // host knows that a request is not outstanding any more.
          const answered = answeredIdOf(text)
          if (answered !== null) worker.emit('message', { type: 'answered', id: answered })
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
            const answered = requestIdOf(text)
            if (answered !== null) worker.emit('message', { type: 'answered', id: answered })
            return
          }
          // A request the server has to answer: the host counts the ones that
          // never get one. A notification is not a request. The flag tells
          // the host that the request is the handshake - the watchdog treats
          // the handshake and the first semantic request differently - and
          // the method tells the host which requests are semantic ones: the
          // host counts only their answers (the client counts the same
          // ones, see `semantic-methods.js`).
          const request = requestOf(text)
          if (request !== null) {
            worker.emit('message', {
              type: 'request',
              id: request.id,
              method: request.method,
              handshake: handshake.isInitialize(text),
            })
          }
        }
        // The real worker injects the memory ceiling into the handshake, so
        // the fake one has to do the same - otherwise the ceiling of the
        // language server could not be asserted at all.
        const limit = worker.workerData?.injectMemoryLimit === true ? worker.workerData.memoryLimitMB : null
        const payload = message.origin === 'host' ? text : withMemoryLimit(text, limit ?? null)
        if (message.origin !== 'host' && handshake.isInitialize(payload)) {
          // A second handshake is absorbed: the server is initialized once.
          if (!handshake.noteForwarded(payload)) return
          worker.emit('message', { type: 'handshake', text: payload })
        }
        worker.emit('message', { type: 'stdin', data: encodeFrame(payload) })      }
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
 * @param {number} [options.terminateDelayMs] how long the fake process takes
 *   to die after `terminate()`
 * @param {boolean} [options.failStdin] when true the stdin of the fake
 *   process is a broken pipe: every write fails asynchronously
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
      const handle = makeFakeHandle({
        terminateDelayMs: options.terminateDelayMs,
        failStdin: options.failStdin,
      })
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
