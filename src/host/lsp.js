/**
 * Host-side language server manager (PRD-v5 §3.1–§3.3, §2.2, §2.4, §2.6, §2.7).
 *
 * "Indexing" is not a build product. There is no index file: the index of an
 * LSP is the program (type information) a language server builds in memory, so
 * "build the index" means "start the language server and wait for its first
 * program build" (PRD §0.2 #1). Everything here is therefore process
 * lifecycle: spawn, readiness, cancellation, idle exit, crash recovery.
 *
 * Threading model (PRD §3.3):
 *
 *   browser LSPClient ──WS (bare JSON)──▶ host main thread ──postMessage──▶ worker
 *            ▲                                     │                             │
 *            └──────────── WS (bare JSON) ◀───────┴──── postMessage (Buffer) ◀───┘
 *                                                      │
 *                                                  stdio frames
 *                                                      │
 *                                               language server
 *
 * The main thread owns the process because `ctx.subprocess` is a main-thread
 * service, but it never parses an LSP payload: the framing happens in the
 * worker thread, so one large response cannot stall the host's event loop
 * (PRD risk #3: 412 ms → 8 ms). The main thread only moves bytes.
 *
 * Windows note: the npm `.bin` shims of the bundled servers are `.cmd` batch
 * files and Node cannot spawn a batch file without a shell — and this plugin
 * never uses a shell. The package's own JavaScript entry point is therefore
 * started through the current Node binary (`process.execPath`). The reported
 * `resolvedPath` still points at the `.bin` shim so the settings page can show
 * the user what is installed.
 */
import { accessSync, constants, existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { constants as osConstants, freemem, setPriority, totalmem } from 'node:os'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { Worker } from 'node:worker_threads'
import { ApiError } from './wire.js'

/**
 * The language registry (PRD §3.2).
 *
 * `typescript` and `javascript` are two names for the same server: the
 * TypeScript language server answers for both languages, so the two entries
 * are aliases and their `languageIds` overlap. Every language id therefore
 * resolves to exactly one language server command. `memoryLimitMB` is the
 * ceiling the server is asked to respect and can be overridden per language
 * through `settings.lsp.servers[languageId].memoryLimitMB`.
 */
export const LSP_REGISTRY = {
  typescript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
    languageIds: ['typescript', 'javascript', 'javascriptreact', 'typescriptreact'],
    memoryLimitMB: 2048,
  },
  javascript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
    languageIds: ['typescript', 'javascript', 'javascriptreact', 'typescriptreact'],
    memoryLimitMB: 2048,
  },
  python: {
    command: 'basedpyright-langserver',
    args: ['--stdio'],
    languageIds: ['python'],
    memoryLimitMB: 1536,
  },
  yaml: {
    command: 'yaml-language-server',
    args: ['--stdio'],
    languageIds: ['yaml'],
    memoryLimitMB: 512,
  },
  java: {
    command: 'jdtls',
    args: [],
    languageIds: ['java'],
    memoryLimitMB: 2048,
    requires: 'JDK 21+',
  },
  go: {
    command: 'gopls',
    args: [],
    languageIds: ['go'],
    memoryLimitMB: 1536,
    requires: 'Go toolchain',
  },
  rust: {
    command: 'rust-analyzer',
    args: [],
    languageIds: ['rust'],
    memoryLimitMB: 2048,
    requires: 'rustup component',
  },
  cpp: {
    command: 'clangd',
    args: [],
    languageIds: ['c', 'cpp'],
    memoryLimitMB: 2048,
    requires: 'LLVM',
  },
}

/** The defaults of the `lsp` settings section (PRD §6.1). */
export const DEFAULT_LSP_SETTINGS = {
  enabled: true,
  indexOnOpen: 'ask',
  memoryLimitMB: 2048,
  freeMemoryThresholdMB: 2048,
  idleTimeoutMs: 600_000,
  requestTimeoutMs: 30_000,
  cancelAfterMs: 60_000,
  autoExit: true,
  autoRestart: true,
  servers: {},
  indexedRoots: {},
}

/**
 * The npm package that ships each bundled language server.
 *
 * The value is the package directory; the executable is looked up in the
 * package's `bin` field so the host can start the server's JavaScript entry
 * point directly (see the Windows note in the file header).
 */
const BUNDLED_PACKAGES = {
  'typescript-language-server': 'typescript-language-server',
  'basedpyright-langserver': 'basedpyright',
  'yaml-language-server': 'yaml-language-server',
}

/**
 * The servers that understand `initializationOptions.maxTsServerMemory`.
 *
 * Every other server has its own mechanism (or none); the host says so in the
 * settings page instead of pretending the ceiling is in effect.
 */
const MEMORY_LIMIT_AWARE = new Set(['typescript-language-server'])

/** The state machine of one language server (PRD §3.1). */
const TRANSITIONS = {
  idle: ['starting', 'idle'],
  starting: ['building', 'failed', 'degraded', 'cancelling', 'crashed', 'idle'],
  building: ['ready', 'failed', 'degraded', 'cancelling', 'crashed', 'idle'],
  ready: ['crashed', 'degraded', 'cancelling', 'idle'],
  restarting: ['building', 'failed', 'degraded', 'cancelling', 'idle'],
  crashed: ['restarting', 'degraded', 'cancelling', 'idle'],
  cancelling: ['cancelled', 'idle'],
  cancelled: ['starting', 'idle'],
  failed: ['starting', 'idle'],
  degraded: ['starting', 'idle'],
}

/** The short progress label of every state, for the status bar. */
const PROGRESS = {
  idle: 'idle',
  starting: 'starting',
  building: 'building',
  ready: 'ready',
  restarting: 'restarting',
  cancelling: 'cancelling',
  cancelled: 'cancelled',
  crashed: 'crashed',
  degraded: 'degraded',
  failed: 'failed',
}

/** How many stderr lines are kept per language server for the settings page. */
const MAX_STDERR_LINES = 200
/**
 * The states in which a language server may still be cancelled.
 *
 * A cancel is a no-op for every other state: the session is not building
 * anything, so there is nothing to stop. The state machine stays strict -
 * `degraded` and `failed` have no edge to `cancelling`, and a cancel must
 * not invent one (PRD §2.4 wants the cancel to be idempotent, not to change
 * the state machine).
 */
const CANCELLABLE_STATES = ['starting', 'building', 'ready', 'restarting']
/**
 * How many client payloads may wait for a language server.
 *
 * The browser connects its socket long before the server exists, so its
 * handshake lands here first. The buffer is a safety net, not a queue: a
 * handful of payloads is plenty.
 */
const MAX_PENDING_PAYLOADS = 64

/** Characters that must never appear in a language server command. */
const SHELL_METACHARACTERS = /[&|;<>$`"'*?()\r\n\t]/

/**
 * Whether one payload is the `initialize` request of the client.
 *
 * The host main thread does not parse LSP payloads - that is the job of the
 * frame worker - but it has to recognize the handshake in one place: the
 * handshake may not be dropped by the bounded queue of the payloads that
 * arrived before the language server existed (see `#holdFor`).
 *
 * The test looks at the **first** `"method"` of the payload: a notification
 * whose *text* happens to contain the string `"method": "initialize"` still
 * has its own method first, so it is not mistaken for a handshake.
 *
 * The check is a structural one on the text, not a parse: no payload is
 * decoded here.
 * @param {unknown} text
 * @returns {boolean}
 */
function isInitializeRequest(text) {
  if (typeof text !== 'string') return false
  const match = /"method"\s*:\s*"([^"]*)"/.exec(text)
  return match !== null && match[1] === 'initialize'
}

/**
 * Every project root the plugin has seen, keyed by its normalized path.
 *
 * The map is process-global on purpose: `lspStateOf()` has to answer for a
 * root without knowing which manager instance owns it.
 */
const ROOTS = new Map()

/**
 * Whether one state may follow another.
 * @param {string} from the current state
 * @param {string} to the wanted state
 * @returns {boolean}
 */
export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to)
}

/**
 * Reject an illegal state change.
 * @param {string} from the current state
 * @param {string} to the wanted state
 * @throws {Error} when the transition is not allowed
 */
export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`illegal language server state transition: ${from} → ${to}`)
  }
}

/**
 * The comparison key of one project root.
 *
 * Paths are compared case-insensitively on Windows, where two spellings of
 * one path are the same path; the persisted `indexedRoots` map is keyed the
 * same way so a root is never indexed twice under two names.
 * @param {string} root
 * @returns {string}
 */
export function rootKey(root) {
  const absolute = resolvePath(String(root))
  const slashed = absolute.replace(/\\/g, '/')
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed
}

/**
 * Whether one value is an absolute path on this platform.
 * @param {string} value
 * @returns {boolean}
 */
function isAbsolutePath(value) {
  if (process.platform === 'win32') {
    return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('\\')
  }
  return value.startsWith('/')
}

/**
 * Check one user-supplied language server command.
 *
 * The command is never handed to a shell — `argv` is always an array — but a
 * command that looks like a shell fragment is refused anyway, so a value that
 * was pasted from a shell transcript cannot smuggle in a second command.
 * @param {unknown} command
 * @returns {string | null} the reason it is refused, or null when it is fine
 */
export function validateServerCommand(command) {
  if (typeof command !== 'string' || command.trim() === '') {
    return 'the language server command must be a non-empty string'
  }
  if (SHELL_METACHARACTERS.test(command)) {
    return 'the language server command must not contain shell metacharacters'
  }
  if (!isAbsolutePath(command) && /[\\/]/.test(command)) {
    return 'the language server command must be a bare executable name or an absolute path'
  }
  if (/\s/.test(command) && !isAbsolutePath(command)) {
    return 'the language server command must not contain whitespace unless it is an absolute path'
  }
  return null
}

/**
 * Whether a value is a plain object.
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * The `lsp` section of a settings document, with the defaults filled in.
 * @param {any} settings the settings document
 * @returns {typeof DEFAULT_LSP_SETTINGS}
 */
export function lspSection(settings) {
  const section = isPlainObject(settings?.lsp) ? settings.lsp : {}
  return {
    ...DEFAULT_LSP_SETTINGS,
    ...section,
    servers: isPlainObject(section.servers) ? section.servers : {},
    indexedRoots: isPlainObject(section.indexedRoots) ? section.indexedRoots : {},
  }
}

/**
 * The directory of one installed npm package.
 * @param {string} name the package name
 * @returns {string | null} the absolute directory, or null when not installed
 */
function packageDirOf(name) {
  const require = createRequire(import.meta.url)
  try {
    return dirname(require.resolve(`${name}/package.json`))
  } catch { /* the package does not export its manifest */ }
  try {
    let dir = dirname(require.resolve(name))
    for (let depth = 0; depth < 8; depth += 1) {
      if (existsSync(join(dir, 'package.json'))) return dir
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch { /* not installed */ }
  return null
}

/**
 * The JavaScript entry point of one package's binary.
 * @param {string} packageDir the package directory
 * @param {string} command the executable name
 * @returns {string | null} the absolute script path, or null when unknown
 */
function resolveBinScript(packageDir, command) {
  try {
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
    const bin = manifest.bin
    if (typeof bin === 'string') return join(packageDir, bin)
    if (isPlainObject(bin) && typeof bin[command] === 'string') return join(packageDir, bin[command])
  } catch { /* no readable manifest */ }
  return null
}

/**
 * Locate one bundled language server inside this package's `node_modules`.
 * @param {string} command the executable name
 * @returns {{ binPath: string, scriptPath: string | null } | null}
 */
function resolveBundled(command) {
  const packageName = BUNDLED_PACKAGES[command]
  if (packageName === undefined) return null
  const packageDir = packageDirOf(packageName)
  if (packageDir === null) return null
  const extension = process.platform === 'win32' ? '.cmd' : ''
  const binPath = join(packageDir, '..', '.bin', `${command}${extension}`)
  const scriptPath = resolveBinScript(packageDir, command)
  if (!existsSync(binPath) && scriptPath === null) return null
  return { binPath: existsSync(binPath) ? binPath : scriptPath, scriptPath }
}

/**
 * Look one executable up on PATH.
 *
 * On Windows only extension-less files and real executables are accepted: a
 * `.cmd` or `.bat` launcher cannot be spawned without a shell, and this
 * plugin never uses a shell.
 * @param {string} command the executable name
 * @returns {string | null} the absolute path, or null when it is not on PATH
 */
function probePath(command) {
  const raw = process.env.PATH ?? ''
  const separator = process.platform === 'win32' ? ';' : ':'
  const extensions = process.platform === 'win32' ? ['', '.exe', '.com'] : ['']
  for (const directory of raw.split(separator)) {
    if (directory === '') continue
    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`)
      try {
        if (process.platform === 'win32') {
          if (existsSync(candidate)) return candidate
        } else {
          accessSync(candidate, constants.X_OK)
          return candidate
        }
      } catch { /* keep looking */ }
    }
  }
  return null
}

/**
 * The installation hint of one language server.
 * @param {object} registryEntry the registry entry
 * @param {string} command the executable name
 * @returns {string}
 */
function hintFor(registryEntry, command) {
  if (typeof registryEntry.requires === 'string') {
    return `Install ${registryEntry.requires} and make sure "${command}" is on PATH.`
  }
  return `Install "${command}" (or point the settings at your own executable) and make sure it is on PATH.`
}

/**
 * Guess the language of one project root from its marker files.
 * @param {string} root the absolute project root
 * @returns {string} a language id of the registry
 */
function detectLanguage(root) {
  const markers = [
    ['typescript', ['tsconfig.json', 'jsconfig.json']],
    ['python', ['pyproject.toml', 'setup.py', 'requirements.txt']],
    ['yaml', ['docker-compose.yml', 'docker-compose.yaml']],
    ['java', ['pom.xml', 'build.gradle', 'build.gradle.kts']],
    ['go', ['go.mod']],
    ['rust', ['Cargo.toml']],
  ]
  for (const [languageId, files] of markers) {
    if (files.some(file => existsSync(join(root, file)))) return languageId
  }
  return 'typescript'
}

/**
 * One byte count in megabytes, for the messages the user reads.
 * @param {number} bytes
 * @returns {number}
 */
function toMb(bytes) {
  return Math.round(bytes / (1024 * 1024))
}

/**
 * The message of a thrown value.
 * @param {unknown} error
 * @returns {string}
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The default worker factory: the frame worker of this package.
 * @param {object} workerData
 * @returns {Worker}
 */
function defaultCreateWorker(workerData) {
  return new Worker(new URL('./lsp-worker.js', import.meta.url), { workerData })
}

/**
 * The default memory probe.
 * @returns {{ totalBytes: number, freeBytes: number }}
 */
function defaultReadMemory() {
  return { totalBytes: totalmem(), freeBytes: freemem() }
}

/**
 * The snapshot of one root, shared by the manager and by `lspStateOf()`.
 * @param {object} entry the root entry
 * @returns {object}
 */
function snapshotOf(entry) {
  const session = entry.session
  const state = session?.state ?? 'idle'
  return {
    root: entry.root,
    state,
    languageId: session?.languageId ?? null,
    command: session?.command ?? null,
    source: session?.source ?? null,
    resolvedPath: session?.resolvedPath ?? null,
    detail: session?.detail ?? null,
    startedAt: session?.startedAt ?? null,
    cancellable: state === 'starting' || state === 'building' || state === 'ready',
    progress: PROGRESS[state] ?? state,
    memoryLimitMB: session?.memoryLimitMB ?? null,
    stderrLines: session === null ? [] : [...session.stderrLines],
  }
}

/**
 * The host-side language server manager.
 *
 * One instance owns every project root of the plugin. The state of a root is
 * the single source of truth for the client: the client never derives
 * "indexing" or "ready" on its own, it reads `lsp.status` / `lsp.index`.
 */
export class LspManager {
  #ctx
  #getSettings
  #persistIndexedRoots
  #spawnServer
  #createWorker
  #now
  #readMemory
  #readyDelayMs
  #restartBackoffMs
  #timeoutLimit
  #graceMs
  #lastEntry = null

  /**
   * @param {object} options
   * @param {any} [options.ctx] the cordis host context (`ctx.subprocess.spawn`)
   * @param {() => Promise<any>} [options.getSettings] the settings document
   * @param {(map: Record<string, { at: number, languageId: string }>) => Promise<void>} [options.persistIndexedRoots]
   *   called with the updated `settings.lsp.indexedRoots` map after a
   *   successful build
   * @param {(spec: object) => Promise<object>} [options.spawnServer]
   *   replaces `ctx.subprocess.spawn` (used by the tests)
   * @param {(workerData: object) => object} [options.createWorker]
   *   replaces the frame worker (used by the tests)
   * @param {() => number} [options.now] the clock
   * @param {() => { totalBytes: number, freeBytes: number }} [options.readMemory]
   *   the memory probe
   * @param {number} [options.readyDelayMs] how long the first server output
   *   takes to be read as "the program is built"
   * @param {number} [options.restartBackoffMs] the backoff before an automatic
   *   restart after a crash
   * @param {number} [options.timeoutLimit] how many request timeouts count
   *   as a crash
   * @param {number} [options.graceMs] the grace period of the process
   */
  constructor(options = {}) {
    this.#ctx = options.ctx ?? null
    this.#getSettings = typeof options.getSettings === 'function' ? options.getSettings : async () => ({})
    this.#persistIndexedRoots = typeof options.persistIndexedRoots === 'function' ? options.persistIndexedRoots : null
    this.#spawnServer = typeof options.spawnServer === 'function' ? options.spawnServer : null
    this.#createWorker = typeof options.createWorker === 'function' ? options.createWorker : defaultCreateWorker
    this.#now = typeof options.now === 'function' ? options.now : () => Date.now()
    this.#readMemory = typeof options.readMemory === 'function' ? options.readMemory : defaultReadMemory
    this.#readyDelayMs = Number.isFinite(options.readyDelayMs) ? options.readyDelayMs : 1500
    this.#restartBackoffMs = Number.isFinite(options.restartBackoffMs) ? options.restartBackoffMs : 2000
    this.#timeoutLimit = Number.isFinite(options.timeoutLimit) ? options.timeoutLimit : 3
    this.#graceMs = Number.isFinite(options.graceMs) ? options.graceMs : 2000
  }

  // ── public API ──────────────────────────────────────────────────────────

  /**
   * The state of one project root.
   * @param {string} [root] the absolute project root
   * @returns {Promise<object>} the status snapshot
   */
  async status({ root } = {}) {
    const settings = await this.#settings()
    const lsp = lspSection(settings)
    const entry = this.#resolveEntry(root)
    const session = entry?.session ?? null
    const enabled = lsp.enabled !== false
    return {
      enabled,
      // "disabled" is not a state of the machine: it says that the feature
      // is switched off, so the client does not have to look at two fields.
      state: enabled ? (session?.state ?? 'idle') : 'disabled',
      languageId: session?.languageId ?? null,
      serverId: session?.command ?? null,
      source: session?.source ?? null,
      detail: session?.detail ?? null,
      indexedRoots: Object.keys(lsp.indexedRoots ?? {}),
      stderrLines: session === null ? [] : [...session.stderrLines],
    }
  }

  /**
   * Start (or continue) the program build of one project root.
   * @param {{ root: string }} payload
   * @returns {Promise<{ state: string, progress?: string, startedAt?: number, cancellable: boolean }>}
   */
  async index({ root } = {}) {
    const target = this.#requireRoot(root)
    const entry = this.#entry(target)
    const session = await this.#ensureSession(entry, null)
    return this.#indexSnapshot(session)
  }

  /**
   * Start the language server of one project root.
   *
   * The call is idempotent: a server that is already running is not spawned
   * a second time, the current state is returned instead.
   * @param {{ root: string, languageId?: string }} payload
   * @returns {Promise<{ state: string, detail: string | null }>}
   */
  async start({ root, languageId } = {}) {
    const target = this.#requireRoot(root)
    const entry = this.#entry(target)
    const wanted = typeof languageId === 'string' && languageId !== '' ? languageId : null
    const session = await this.#ensureSession(entry, wanted)
    return { state: session.state, detail: session.detail ?? null }
  }

  /**
   * Cancel the program build of one project root.
   *
   * The whole operation runs in one critical section on the host side:
   * `cancelling` → terminate the process → `cancelled` → close the open
   * documents → notify the clients. Repeated calls are answered with the same
   * result and never kill a second time. The editor state of the user (tabs,
   * drafts, cursor) is never touched here: that state lives in the client.
   *
   * The cancel is **idempotent** (PRD §2.4): it never throws, whatever the
   * state of the session is.
   *
   *   - A session that is not building anything (`idle`, `cancelled`,
   *     `crashed`, `degraded`, `failed`) has nothing to stop: the answer is
   *     the same and no process is killed. A session that was *degraded* -
   *     the server crashed or the machine had not enough memory - used to
   *     be an illegal state change here.
   *   - A cancel that is already running is not repeated: the second call
   *     waits for the first one and answers with the same result, so the
   *     process is killed exactly once.
   * @param {{ root: string }} payload
   * @returns {Promise<{ state: 'cancelled' }>}
   */
  async cancelIndex({ root } = {}) {
    const target = this.#requireRoot(root)
    const entry = this.#peek(target)
    const session = entry?.session ?? null
    if (session === null) return { state: 'cancelled' }
    // A cancel that is already running is not repeated: the second call
    // waits for the first one and answers with the same result.
    if (session.cancelPromise !== null) {
      await session.cancelPromise.catch(() => {})
      return { state: 'cancelled' }
    }
    // A session that is not building anything has nothing to cancel.
    if (!CANCELLABLE_STATES.includes(session.state)) return { state: 'cancelled' }
    const running = this.#cancelSession(entry, session)
    session.cancelPromise = running
    try {
      await running
    } finally {
      if (session.cancelPromise === running) session.cancelPromise = null
    }
    return { state: 'cancelled' }
  }

  /**
   * The atomic cancel itself (PRD §2.4).
   *
   * The whole sequence runs in one critical section: mark the session
   * `cancelling`, terminate the process, mark it `cancelled`, close the open
   * documents and notify the clients.
   * @param {object} entry the root entry
   * @param {object} session the session
   */
  async #cancelSession(entry, session) {
    this.#transition(session, 'cancelling', 'cancelling')
    session.intentionalExit = true
    this.#writeDidClose(entry, session)
    await this.#terminateAndWait(session)
    // The worker and every timer of the session go away with the cancel:
    // a watchdog that keeps running would count the timeouts of a session
    // that does not exist any more.
    this.#teardownSession(session)
    this.#transition(session, 'cancelled', 'cancelled')
    for (const uri of this.#forgetDocuments(entry)) {
      this.#notify(entry, { type: 'didClose', uri })
    }
    this.#notify(entry, { type: 'cancelled', root: entry.root })
  }

  /**
   * Every language server this plugin knows about.
   *
   * A language that is switched off in the settings (`lsp.servers[languageId]
   * .enabled === false`) is neither available nor missing: it is reported
   * as disabled, so the settings page can tell "not installed" and "turned
   * off" apart.
   * @returns {Promise<{ available: object[], missing: object[], disabled: object[] }>}
   */
  async servers() {
    const settings = await this.#settings()
    const lsp = lspSection(settings)
    const available = []
    const missing = []
    const disabled = []
    for (const [languageId, registryEntry] of Object.entries(LSP_REGISTRY)) {
      const override = isPlainObject(lsp.servers[languageId]) ? lsp.servers[languageId] : {}
      const command = typeof override.command === 'string' && override.command !== ''
        ? override.command
        : registryEntry.command
      if (override.enabled === false) {
        disabled.push({ languageId, command, hint: 'the language server is turned off in the settings' })
        continue
      }
      const invalid = validateServerCommand(command)
      if (invalid !== null) {
        missing.push({ languageId, command, hint: invalid })
        continue
      }
      const resolution = this.#resolveServer(command)
      if (resolution === null) {
        missing.push({ languageId, command, hint: hintFor(registryEntry, command) })
        continue
      }
      const memoryLimitMB = Number.isFinite(override.memoryLimitMB)
        ? override.memoryLimitMB
        : registryEntry.memoryLimitMB
      available.push({
        languageId,
        command,
        source: resolution.source,
        resolvedPath: resolution.path,
        memoryLimitMB,
        memoryLimitSupported: resolution.supportsMemoryLimit,
      })
    }
    return { available, missing, disabled }
  }

  /**
   * The memory situation of the machine.
   * @param {{ root?: string }} [payload]
   * @returns {Promise<{ totalBytes: number, freeBytes: number, thresholdBytes: number, memoryLimitMB: number, canIndex: boolean }>}
   */
  async resources({ root } = {}) {
    const settings = await this.#settings()
    const lsp = lspSection(settings)
    const entry = this.#resolveEntry(root)
    const session = entry?.session ?? null
    const memoryLimitMB = session?.memoryLimitMB ?? lsp.memoryLimitMB
    return this.#resourcesSnapshot(memoryLimitMB, lsp.freeMemoryThresholdMB)
  }

  /**
   * Stop the language server of one root (or of every root).
   * @param {{ root?: string }} [payload]
   * @returns {Promise<{ ok: true }>}
   */
  async shutdown({ root } = {}) {
    if (root === undefined || root === null || root === '') {
      for (const entry of [...ROOTS.values()]) await this.#shutdownEntry(entry)
      return { ok: true }
    }
    const entry = this.#peek(this.#requireRoot(root))
    if (entry !== null) await this.#shutdownEntry(entry)
    return { ok: true }
  }

  /**
   * The stderr lines of one root's language server.
   * @param {{ root?: string }} [payload]
   * @returns {Promise<{ lines: string[] }>}
   */
  async logs({ root } = {}) {
    const entry = this.#resolveEntry(root)
    return { lines: [...(entry?.session?.stderrLines ?? [])] }
  }

  /**
   * The `indexedRoots` map of the settings document.
   * @returns {Promise<Record<string, { at: number, languageId: string }>>}
   */
  async indexedRoots() {
    const settings = await this.#settings()
    return { ...lspSection(settings).indexedRoots }
  }

  /**
   * The current snapshot of one root (the synchronous variant of `status`).
   * @param {string} root the absolute project root
   * @returns {object}
   */
  stateOf(root) {
    const entry = this.#peek(this.#requireRoot(root))
    return entry === null
      ? { root: resolvePath(String(root)), state: 'idle', languageId: null, command: null, source: null, detail: null, startedAt: null, cancellable: false, progress: 'idle', memoryLimitMB: null, stderrLines: [] }
      : snapshotOf(entry)
  }

  /**
   * The live state of every root that currently has a session.
   *
   * The project picker reads this to tell "is indexing" from "is ready"
   * without asking every candidate in turn. The keys are the normalized
   * absolute paths of {@link rootKey}, so Windows never reports the same
   * root twice because of its spelling.
   * @returns {Map<string, string>} the normalized root and its session state
   */
  liveStates() {
    const output = new Map()
    for (const entry of ROOTS.values()) {
      const session = entry.session
      if (session === null || session === undefined) continue
      output.set(entry.key, session.state)
    }
    return output
  }

  /**
   * Move one root to another state.
   *
   * Every state change of the manager goes through this gate, so an illegal
   * transition (for example `cancelled` → `building`) is rejected instead of
   * quietly corrupting the state machine.
   * @param {string} root the absolute project root
   * @param {string} next the wanted state
   * @param {string | null} [detail] the message shown to the user
   * @returns {{ state: string }}
   */
  transition(root, next, detail = null) {
    const entry = this.#peek(this.#requireRoot(root))
    if (entry === null || entry.session === null) {
      throw new Error('no language server session for this root')
    }
    this.#transition(entry.session, next, detail)
    return { state: entry.session.state }
  }

  /**
   * Report one request timeout of a language server.
   *
   * The transport layer calls this when a request ran into its deadline; the
   * manager counts the timeouts and treats the third one as a crash
   * (PRD §2.7). The counter is reset as soon as the server answers again.
   * @param {string} root the absolute project root
   * @returns {{ timeouts: number }}
   */
  noteTimeout(root) {
    const entry = this.#peek(this.#requireRoot(root))
    const session = entry?.session ?? null
    if (session === null) return { timeouts: 0 }
    this.#noteTimeout(entry, session, 'the language server stopped responding')
    return { timeouts: session.timeouts }
  }

  /**
   * Attach one client to a project root.
   *
   * The sink receives the raw JSON-RPC payloads of the language server
   * (`send`) and the control events of the manager (`control`). Closing the
   * client never stops the language server: several tabs may share it.
   * @param {string} root the absolute project root
   * @param {{ send: (text: string) => void, control?: (event: object) => void }} sink
   * @returns {() => void} the detach function
   */
  attachSink(root, sink) {
    const entry = this.#entry(this.#requireRoot(root))
    entry.sinks.add(sink)
    return () => { entry.sinks.delete(sink) }
  }

  /**
   * Forward one client payload to the language server.
   *
   * The browser connects its socket long before the language server exists:
   * the workbench opens, the client says hello, and the server is only
   * started when the user picks a project. The handshake that arrives in
   * between would be lost, and the server would wait for it forever - the
   * session would stay in "building" and every request would time out.
   *
   * So a payload that arrives without a server is *held* and replayed the
   * moment one starts. The payloads are opaque strings: the main thread
   * never parses them.
   * @param {string} root the absolute project root
   * @param {string} text one bare JSON-RPC payload
   * @returns {boolean} false when no language server is running
   */
  relayToServer(root, text) {
    // `#entry()` instead of `#peek()`: the entry is created when it is
    // missing, so a payload that arrives before the relay attached the sink
    // is held instead of dropped.
    const entry = this.#entry(this.#requireRoot(root))
    const session = entry.session ?? null
    if (session === null || session.worker === null) {
      this.#holdFor(entry, text)
      return false
    }
    session.worker.postMessage({ type: 'send', text, origin: 'client' })
    session.lastClientActivityAt = this.#now()
    this.#touch(entry, session)
    return true
  }

  /**
   * Keep one client payload until a language server can take it.
   * @param {object | null} entry the root entry
   * @param {string} text the payload
   */
  #holdFor(entry, text) {
    if (entry === null || entry === undefined) return
    if (typeof text !== 'string' || text === '') return
    // The *first* handshake has a slot of its own. The queue below is
    // bounded and drops its oldest entry - and the handshake is the oldest
    // entry, so a client that sends more than `MAX_PENDING_PAYLOADS`
    // payloads before the server exists would drop the one payload the
    // server cannot do without: it would wait for the `initialize` for ever
    // and never build the program (the session would stay in "building" and
    // every request would time out).
    //
    // A *second* handshake (the client reconnects while the server is still
    // missing) stays in the queue: the frame worker absorbs it and answers
    // it from the capabilities of the server, so the client that asked for
    // it is not left waiting.
    if (isInitializeRequest(text) && entry.handshake === '') {
      entry.handshake = text
      return
    }
    if (entry.pending.length >= MAX_PENDING_PAYLOADS) {
      // The oldest payload is dropped, but never a handshake.
      const index = entry.pending.findIndex(payload => !isInitializeRequest(payload))
      if (index >= 0) entry.pending.splice(index, 1)
      else entry.pending.shift()
    }
    entry.pending.push(text)
  }

  /**
   * Replay the payloads that arrived before the language server started.
   * @param {object} entry the root entry
   * @param {object} session the session
   */
  #replayPending(entry, session) {
    if (entry.pending.length === 0) return
    const payloads = entry.pending.splice(0, entry.pending.length)
    for (const text of payloads) {
      session.worker?.postMessage({ type: 'send', text, origin: 'client' })
    }
  }

  // ── internals ───────────────────────────────────────────────────────────

  /**
   * The current settings document.
   * @returns {Promise<any>}
   */
  async #settings() {
    const document = await this.#getSettings()
    return isPlainObject(document) ? document : {}
  }

  /**
   * The entry of one root, created when it is seen for the first time.
   * @param {string} root the absolute project root
   * @returns {object}
   */
  #entry(root) {
    const key = rootKey(root)
    let entry = ROOTS.get(key)
    if (entry === undefined) {
      entry = {
        root: resolvePath(root),
        key,
        session: null,
        sinks: new Set(),
        documents: new Map(),
        /**
         * The client payloads that arrived before a language server was
         * started. The handshake of the browser lands here: the socket is
         * connected long before the server exists.
         */
        pending: [],
        /**
         * The handshake of the browser, kept so a language server that is
         * started later - or restarted after a crash - can be initialized.
         */
        handshake: '',
      }
      ROOTS.set(key, entry)
    }
    this.#lastEntry = entry
    return entry
  }

  /**
   * The entry of one root without creating it.
   * @param {string} root the absolute project root
   * @returns {object | null}
   */
  #peek(root) {
    return ROOTS.get(rootKey(root)) ?? null
  }

  /**
   * The entry of one root, or the most recently used one.
   * @param {string | null | undefined} root
   * @returns {object | null}
   */
  #resolveEntry(root) {
    if (typeof root === 'string' && root !== '') return this.#peek(this.#requireRoot(root))
    return this.#lastEntry
  }

  /**
   * The absolute project root of one request.
   * @param {unknown} root
   * @returns {string}
   */
  #requireRoot(root) {
    if (typeof root !== 'string' || root.trim() === '') {
      throw new ApiError('bad-request', 'missing or invalid "root"')
    }
    return resolvePath(root)
  }

  /**
   * The snapshot of one index operation.
   *
   * `cancellable` is computed by the host, because the host owns the
   * `cancelAfterMs` setting: the cancel button appears once the build has
   * been running longer than that (PRD §2.4).
   * @param {object | null} session
   * @returns {{ state: string, progress: string, startedAt?: number, cancellable: boolean }}
   */
  #indexSnapshot(session) {
    const state = session?.state ?? 'idle'
    const lsp = session?.lsp ?? DEFAULT_LSP_SETTINGS
    const cancelAfterMs = Number.isFinite(Number(lsp.cancelAfterMs))
      ? Number(lsp.cancelAfterMs)
      : DEFAULT_LSP_SETTINGS.cancelAfterMs
    const startedAt = session?.startedAt ?? null
    const elapsed = startedAt === null ? 0 : this.#now() - startedAt
    const cancellable = (state === 'starting' || state === 'building') && elapsed >= cancelAfterMs
    return {
      state,
      progress: PROGRESS[state] ?? state,
      startedAt: startedAt ?? undefined,
      cancellable,
    }
  }

  /**
   * The memory situation for one ceiling.
   * @param {number} memoryLimitMB the ceiling of the language server
   * @param {number} freeMemoryThresholdMB the configured free-memory threshold
   * @returns {{ totalBytes: number, freeBytes: number, thresholdBytes: number, memoryLimitMB: number, canIndex: boolean }}
   */
  #resourcesSnapshot(memoryLimitMB, freeMemoryThresholdMB) {
    const memory = this.#readMemory()
    const needBytes = Math.max(0, memoryLimitMB) * 1024 * 1024
    const thresholdBytes = Math.max(needBytes, Math.max(0, freeMemoryThresholdMB) * 1024 * 1024)
    return {
      totalBytes: memory.totalBytes,
      freeBytes: memory.freeBytes,
      thresholdBytes,
      memoryLimitMB,
      canIndex: memory.freeBytes >= thresholdBytes,
    }
  }

  /**
   * Make sure one root has a running language server.
   * @param {object} entry the root entry
   * @param {string | null} languageId the wanted language, or null to detect it
   * @returns {Promise<object>} the session
   */
  async #ensureSession(entry, languageId) {
    const session = entry.session
    if (session !== null && ['starting', 'building', 'ready', 'restarting'].includes(session.state)) {
      return session
    }
    return this.#startSession(entry, languageId)
  }

  /**
   * Start a language server for one root.
   * @param {object} entry the root entry
   * @param {string | null} languageId the wanted language, or null to detect it
   * @returns {Promise<object>} the session
   */
  async #startSession(entry, languageId) {
    // A session that is replaced must not leave its timers behind: the new
    // session gets its own idle timer and watchdog, and the old ones would
    // keep the host awake for nothing.
    const previous = entry.session
    if (previous !== null && previous !== undefined) this.#teardownSession(previous)
    const settings = await this.#settings()
    const lsp = lspSection(settings)
    if (lsp.enabled === false) {
      throw new ApiError('forbidden', 'semantic analysis is disabled in the settings', 403)
    }
    const language = languageId ?? detectLanguage(entry.root)
    const registryEntry = LSP_REGISTRY[language]
    if (registryEntry === undefined) {
      throw new ApiError('bad-request', `unknown language "${language}"`)
    }
    const override = isPlainObject(lsp.servers[language]) ? lsp.servers[language] : {}
    const command = typeof override.command === 'string' && override.command !== ''
      ? override.command
      : registryEntry.command
    const invalid = validateServerCommand(command)
    if (invalid !== null) throw new ApiError('bad-request', invalid)
    const args = Array.isArray(override.args) ? override.args.map(String) : registryEntry.args
    const memoryLimitMB = Number.isFinite(override.memoryLimitMB)
      ? override.memoryLimitMB
      : registryEntry.memoryLimitMB
    // A language that is switched off in the settings is never started.
    const turnedOff = override.enabled === false

    const session = {
      entry,
      languageId: language,
      command,
      args,
      memoryLimitMB,
      lsp,
      resolution: null,
      source: null,
      resolvedPath: null,
      supportsMemoryLimit: false,
      state: 'idle',
      detail: null,
      startedAt: null,
      handle: null,
      worker: null,
      stderrLines: [],
      restarts: 0,
      timeouts: 0,
      /**
       * The client activity a timeout was counted for.
       *
       * The watchdog runs every second; without this marker one slow
       * request would be counted three times in three seconds and the
       * server would be killed for a single request that took too long.
       */
      timeoutStallAt: 0,
      exited: false,
      intentionalExit: false,
      /**
       * The cancel that is currently running, if any.
       *
       * A second cancel waits for it instead of starting a second one: the
       * operation is atomic and the process is killed exactly once
       * (PRD §2.4).
       */
      cancelPromise: null,
      lastActivityAt: this.#now(),
      lastClientActivityAt: 0,
      lastServerActivityAt: 0,
      idleTimer: null,
      watchdogTimer: null,
      readyTimer: null,
      restartTimer: null,
      /**
       * Counts the processes this session started.
       *
       * A process that was replaced must not report its own death into the
       * new session: the callbacks of the old process check the generation
       * they were started with and stop when it moved on.
       */
      generation: 0,
    }
    entry.session = session
    this.#transition(session, 'starting', 'starting the language server')

    // A language that is switched off in the settings is never started. The
    // check comes before the memory pre-check: a server that may not run
    // does not need any memory.
    if (turnedOff) {
      this.#transition(session, 'degraded', `the ${language} language server is turned off in the settings. Turn it on again to use the semantic features of this language.`)
      return session
    }

    // The memory pre-check runs before every start, not only when the
    // settings are validated (PRD §2.2).
    const resources = this.#resourcesSnapshot(memoryLimitMB, lsp.freeMemoryThresholdMB)
    if (!resources.canIndex) {
      this.#transition(session, 'degraded', `not enough free memory to start the language server (needs ${toMb(resources.thresholdBytes)} MB, ${toMb(resources.freeBytes)} MB available). Close other programs, lower the memory limit in the settings, or use the conservative mode.`)
      return session
    }

    const resolution = this.#resolveServer(command)
    if (resolution === null) {
      this.#transition(session, 'degraded', `the ${language} language server ("${command}") is not installed. ${hintFor(registryEntry, command)}`)
      return session
    }
    session.resolution = resolution
    session.source = resolution.source
    session.resolvedPath = resolution.path
    session.supportsMemoryLimit = resolution.supportsMemoryLimit

    try {
      await this.#spawn(entry, session, resolution)
    } catch (error) {
      // The session may have been cancelled while the process was starting:
      // the cancel owns the state now, the failure does not overwrite it.
      if (session.state !== 'starting') return session
      this.#transition(session, 'failed', `the language server could not be started: ${messageOf(error)}`)
      return session
    }
    // The session may have left the "starting" state while the process was
    // starting - a cancel does exactly that. The session keeps its state and
    // is not dragged back into a build it has left.
    if (session.state !== 'starting') return session
    this.#transition(session, 'building', 'building the program')
    session.startedAt = this.#now()
    session.lastActivityAt = this.#now()
    this.#armIdleTimer(entry, session)
    this.#armWatchdog(entry, session)
    return session
  }

  /**
   * Locate the executable of one language server.
   * @param {string} command the executable name
   * @returns {{ path: string, scriptPath: string | null, source: 'bundled' | 'path', supportsMemoryLimit: boolean } | null}
   */
  #resolveServer(command) {
    const bundled = resolveBundled(command)
    if (bundled !== null) {
      return {
        path: bundled.binPath,
        scriptPath: bundled.scriptPath,
        source: 'bundled',
        supportsMemoryLimit: MEMORY_LIMIT_AWARE.has(command),
      }
    }
    const probed = probePath(command)
    if (probed !== null) {
      return { path: probed, scriptPath: null, source: 'path', supportsMemoryLimit: MEMORY_LIMIT_AWARE.has(command) }
    }
    return null
  }

  /**
   * Start the process and wire its pipes to the frame worker.
   *
   * A process that is replaced is terminated first: a language server that
   * keeps running in the background would hold its memory and would report
   * its own death into the session that took its place.
   * @param {object} entry the root entry
   * @param {object} session the session
   * @param {object} resolution the resolved executable
   */
  async #spawn(entry, session, resolution) {
    // The process of the previous generation is stopped before the new one
    // starts, and its callbacks are fenced off by the generation counter.
    const previous = session.handle
    session.generation += 1
    const generation = session.generation
    if (previous !== null && previous !== undefined) {
      session.intentionalExit = true
      try { previous.terminate() } catch { /* it is already gone */ }
      session.handle = null
    }
    const worker = this.#createWorker({
      memoryLimitMB: session.memoryLimitMB,
      injectMemoryLimit: session.supportsMemoryLimit,
    })
    session.worker = worker
    worker.on?.('message', (message) => { this.#onWorkerMessage(entry, session, message) })
    worker.on?.('error', (error) => {
      this.#safely(this.#onCrash(entry, session, `the frame worker failed: ${messageOf(error)}`), 'the crash handler')
    })

    const argv = resolution.scriptPath !== null && resolution.scriptPath !== undefined
      ? [process.execPath, resolution.scriptPath, ...session.args]
      : [resolution.path, ...session.args]
    const spec = {
      argv,
      cwd: entry.root,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: this.#graceMs,
    }
    let handle
    try {
      handle = this.#spawnServer !== null
        ? await this.#spawnServer(spec)
        : this.#ctx?.subprocess?.spawn(spec)
    } catch (error) {
      this.#stopWorker(session)
      throw error
    }
    if (handle === undefined || handle === null) {
      this.#stopWorker(session)
      throw new ApiError('lsp-unavailable', 'the language server did not start')
    }
    session.handle = handle
    session.intentionalExit = false
    // The session is alive again: the flag of the process that died must not
    // swallow the death of the new one (a server that dies silently after a
    // restart would go unnoticed).
    session.exited = false

    // The session may have been cancelled while the process was starting: the
    // cancel waits for a process that does not exist yet and gives up. The
    // process that was just started is not wanted any more - it is stopped
    // right away, so a cancel never leaves a language server behind
    // (PRD §2.4: "取消后无残留语言服务器进程").
    if (session.state !== 'starting' && session.state !== 'restarting') {
      session.intentionalExit = true
      try { handle.terminate() } catch { /* it is already gone */ }
      session.handle = null
      return
    }

    // The handshake and the payloads that arrived while there was no server
    // are written *after* the process exists.
    //
    // The worker answers with the framed bytes and the host can only write
    // them into a stdin that is already there - a payload that is handed to
    // the worker before the process was started is silently dropped, and the
    // symptom is the one of the "held handshake" defect: the server waits
    // for its `initialize` for ever and every request times out.
    //
    // The handshake comes first: a language server that was restarted (after
    // a crash) has to be initialized again before any document may be
    // announced. The payload is the one the browser sent.
    if (typeof entry.handshake === 'string' && entry.handshake !== '') {
      worker.postMessage({ type: 'send', text: entry.handshake, origin: 'client' })
    }
    // Then the payloads that arrived while there was no server at all.
    this.#replayPending(entry, session)

    // The stdout pipe is the frame channel: it carries LSP messages and
    // nothing else. Logs go to stderr, which is collected separately.
    // Every callback checks the generation: a process that was replaced must
    // not feed the new worker and must not report its death into the new
    // session.
    const current = () => session.generation === generation
    if (handle.stdout) {
      handle.stdout.on('data', (chunk) => {
        if (!current()) return
        session.worker?.postMessage({ type: 'stdout', data: chunk })
      })
      handle.stdout.on('end', () => {
        if (!current() || session.exited) return
        this.#safely(this.#onCrash(entry, session, 'the output stream closed while the process was still running'), 'the crash handler')
      })
      handle.stdout.on('error', () => {})
    }
    if (handle.stderr) {
      handle.stderr.on('data', (chunk) => {
        if (!current()) return
        const text = typeof chunk === 'string' ? chunk : String(chunk)
        session.stderrLines.push(text)
        if (session.stderrLines.length > MAX_STDERR_LINES) session.stderrLines.shift()
        this.#ctx?.logger?.warn?.('lsp stderr: %s', text.trim())
      })
      handle.stderr.on('error', () => {})
    }
    Promise.resolve(handle.done ?? null).then((outcome) => {
      if (!current()) return
      session.exited = true
      const code = outcome?.exitCode ?? null
      const signal = outcome?.signal ?? null
      // A process that was stopped on purpose (cancel, idle exit, shutdown)
      // is not a crash.
      if (session.intentionalExit) return
      if (code === 0 && signal === null) {
        if (session.state === 'ready' || session.state === 'building') {
          this.#transition(session, 'idle', 'the language server exited')
        }
        this.#stopWorker(session)
        return
      }
      this.#safely(this.#onCrash(entry, session, `the process exited with code ${code}${signal === null ? '' : ` (${signal})`}`), 'the crash handler')
    }).catch((error) => {
      if (!current()) return
      session.exited = true
      if (session.intentionalExit) return
      this.#safely(this.#onCrash(entry, session, `the process failed: ${messageOf(error)}`), 'the crash handler')
    })

    // Windows: an indexing language server must not steal the CPU from the
    // DSH agent. `ctx.subprocess` has no priority option, and falling back to
    // a raw `child_process.spawn` would leak the host environment into the
    // server (PRD risk #6), so the priority is lowered after the start when
    // the handle exposes a pid. A failure here is not fatal.
    if (process.platform === 'win32' && Number.isInteger(handle.pid)) {
      try {
        setPriority(handle.pid, osConstants.priority.PRIORITY_BELOW_NORMAL)
      } catch { /* the platform refused to change the priority */ }
    }
  }

  /**
   * Handle one message of the frame worker.
   * @param {object} entry the root entry
   * @param {object} session the session
   * @param {object} message the worker message
   */
  #onWorkerMessage(entry, session, message) {
    if (message === null || typeof message !== 'object') return
    if (message.type === 'message') {
      session.lastServerActivityAt = this.#now()
      // The server answers again: the requests that ran into their deadline
      // are history. The counter is the number of unanswered requests, not a
      // total of every timeout the session ever had.
      session.timeouts = 0
      session.timeoutStallAt = 0
      this.#broadcast(entry, message.text)
      this.#scheduleReady(entry, session)
      this.#touch(entry, session)
      return
    }
    if (message.type === 'stdin') {
      this.#writeToServer(session, message.data)
      return
    }
    if (message.type === 'document') {
      this.#trackDocument(entry, message)
      return
    }
    if (message.type === 'handshake') {
      // The browser sends its handshake once. A language server that is
      // started later - or restarted after a crash - needs it again, so the
      // host keeps it and replays it to every new process.
      if (typeof message.text === 'string' && message.text !== '') {
        entry.handshake = message.text
      }
      return
    }
  }

  /**
   * Write one payload to the language server.
   * @param {object} session the session
   * @param {object} payload the JSON-RPC message
   */
  #sendToServer(session, payload) {
    if (session.worker === null) return
    session.worker.postMessage({ type: 'send', text: JSON.stringify(payload), origin: 'host' })
  }

  /**
   * Write bytes to the language server's stdin.
   * @param {object} session the session
   * @param {Buffer | Uint8Array} data
   */
  #writeToServer(session, data) {
    const stdin = session.handle?.stdin
    if (stdin === undefined || stdin === null) return
    try {
      stdin.write(data)
    } catch { /* the pipe is already gone */ }
  }

  /**
   * Remember one document lifecycle event.
   * @param {object} entry the root entry
   * @param {object} message the worker message
   */
  #trackDocument(entry, message) {
    const uri = typeof message.uri === 'string' ? message.uri : ''
    if (uri === '') return
    if (message.action === 'close') {
      entry.documents.delete(uri)
      return
    }
    if (message.action === 'open') {
      entry.documents.set(uri, {
        uri,
        languageId: typeof message.languageId === 'string' ? message.languageId : 'plaintext',
        version: Number.isFinite(message.version) ? message.version : 0,
        text: typeof message.text === 'string' ? message.text : '',
      })
      return
    }
    if (message.action === 'change') {
      const document = entry.documents.get(uri)
      if (document === undefined) return
      if (typeof message.text === 'string') document.text = message.text
      if (Number.isFinite(message.version)) document.version = message.version
    }
  }

  /**
   * Tell the language server that every open document is closed.
   * @param {object} entry the root entry
   * @param {object} session the session
   */
  #writeDidClose(entry, session) {
    for (const document of entry.documents.values()) {
      this.#sendToServer(session, {
        jsonrpc: '2.0',
        method: 'textDocument/didClose',
        params: { textDocument: { uri: document.uri } },
      })
    }
  }

  /**
   * Re-open every document after a restart.
   * @param {object} entry the root entry
   * @param {object} session the session
   */
  #reopenDocuments(entry, session) {
    for (const document of entry.documents.values()) {
      this.#sendToServer(session, {
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: document.uri,
            languageId: document.languageId,
            version: document.version,
            text: document.text,
          },
        },
      })
    }
  }

  /**
   * Drop the tracked documents of one root.
   * @param {object} entry the root entry
   * @returns {string[]} the URIs that were open
   */
  #forgetDocuments(entry) {
    const uris = [...entry.documents.keys()]
    entry.documents.clear()
    return uris
  }

  /**
   * Move one session to another state and tell the clients.
   *
   * The transition is strict: an illegal change is a bug and is rejected.
   * The state machine is the contract the tests hold, and a rejected change
   * is much easier to find than a silently corrupted one.
   *
   * The host must survive it, though: every asynchronous step of the manager
   * goes through `#safely()`, so a rejected transition is logged and the
   * process keeps running.
   * @param {object} session the session
   * @param {string} next the wanted state
   * @param {string | null} [detail] the message shown to the user
   */
  #transition(session, next, detail = null) {
    assertTransition(session.state, next)
    session.state = next
    session.detail = detail
    const entry = session.entry
    if (entry !== undefined) {
      this.#notify(entry, { type: 'state', root: entry.root, state: next, detail })
    }
  }

  /**
   * Run one asynchronous step without ever letting it reject.
   *
   * A plugin that leaks an unhandled rejection kills the DSH host process
   * (the harness treats it as a fatal load failure), so every asynchronous
   * step of the manager goes through here.
   * @param {Promise<any>} promise the step
   * @param {string} what a short name for the log
   */
  #safely(promise, what) {
    Promise.resolve(promise).catch((error) => {
      this.#ctx?.logger?.warn?.('lsp: %s failed: %s', what, messageOf(error))
    })
  }

  /**
   * Send one payload to every attached client.
   * @param {object} entry the root entry
   * @param {string} text the bare JSON-RPC payload
   */
  #broadcast(entry, text) {
    for (const sink of entry.sinks) {
      try {
        sink.send(text)
      } catch { /* the client vanished */ }
    }
  }

  /**
   * Send one control event to every attached client.
   * @param {object} entry the root entry
   * @param {object} event the event
   */
  #notify(entry, event) {
    for (const sink of entry.sinks) {
      try {
        sink.control?.(event)
      } catch { /* the client vanished */ }
    }
  }

  /**
   * Read the first server output as "the program is built".
   *
   * A language server has no notification for "my first program build is
   * done", so the host uses the readiness heuristic of PRD §3.1: the process
   * is up and the server has answered, a short moment later the server is
   * ready.
   * @param {object} entry the root entry
   * @param {object} session the session
   */
  #scheduleReady(entry, session) {
    if (session.readyTimer !== null || session.state !== 'building') return
    const timer = setTimeout(() => {
      session.readyTimer = null
      if (session.state !== 'building') return
      try {
        this.#transition(session, 'ready', 'ready')
      } catch (error) {
        // A timer callback that throws is an *uncaught* exception, and an
        // uncaught exception in the host ends the DSH process.
        this.#ctx?.logger?.warn?.('lsp: the server could not be marked ready: %s', messageOf(error))
        return
      }
      this.#safely(this.#persistIndexed(entry, session), 'saving the indexed roots')
    }, this.#readyDelayMs)
    timer.unref?.()
    session.readyTimer = timer
  }

  /**
   * Remember that one root has completed its first program build.
   * @param {object} entry the root entry
   * @param {object} session the session
   */
  async #persistIndexed(entry, session) {
    if (this.#persistIndexedRoots === null) return
    const settings = await this.#settings()
    const lsp = lspSection(settings)
    const map = { ...lsp.indexedRoots }
    for (const key of Object.keys(map)) {
      if (rootKey(key) === entry.key) delete map[key]
    }
    map[entry.root] = { at: this.#now(), languageId: session.languageId }
    try {
      await this.#persistIndexedRoots(map)
    } catch { /* the badge catches up on the next successful build */ }
  }

  /**
   * Note that the root was used, and arm the idle timer again.
   * @param {object} entry the root entry
   * @param {object} session the session
   */
  #touch(entry, session) {
    session.lastActivityAt = this.#now()
    this.#armIdleTimer(entry, session)
  }

  /**
   * Arm the idle timer of one session.
   * @param {object} entry the root entry
   * @param {object} session the session
   * @param {number} [delayMs] the delay, when it is not the configured timeout
   */
  #armIdleTimer(entry, session, delayMs) {
    this.#clearIdleTimer(session)
    const lsp = session.lsp ?? DEFAULT_LSP_SETTINGS
    if (lsp.autoExit === false) return
    const timeout = Number.isFinite(delayMs) ? delayMs : Number(lsp.idleTimeoutMs)
    if (!Number.isFinite(timeout) || timeout <= 0) return
    const timer = setTimeout(() => { this.#onIdle(entry, session, timeout) }, timeout)
    timer.unref?.()
    session.idleTimer = timer
  }

  /**
   * The idle timer fired.
   * @param {object} entry the root entry
   * @param {object} session the session
   * @param {number} timeout the timeout that was armed
   */
  #onIdle(entry, session, timeout) {
    session.idleTimer = null
    if (entry.session !== session) return
    const elapsed = this.#now() - session.lastActivityAt
    if (elapsed < timeout) {
      this.#armIdleTimer(entry, session, timeout - elapsed)
      return
    }
    this.#safely(this.#exitIdle(entry, session), 'the idle exit')
  }

  /**
   * Stop the language server because it has been idle for too long.
   *
   * The `indexedRoots` map is *not* touched: "this root was indexed" stays
   * true even though the server is gone (PRD §2.6).
   * @param {object} entry the root entry
   * @param {object} session the session
   */
  async #exitIdle(entry, session) {
    if (entry.session !== session) return
    if (session.state !== 'ready' && session.state !== 'building') return
    session.intentionalExit = true
    this.#writeDidClose(entry, session)
    await this.#terminateAndWait(session)
    // The idle timer is cleared here as well: the session that is going
    // away must not leave a timer behind that fires ten minutes later.
    this.#teardownSession(session)
    this.#transition(session, 'idle', 'the language server exited after a period of inactivity')
    for (const uri of this.#forgetDocuments(entry)) {
      this.#notify(entry, { type: 'didClose', uri })
    }
    this.#notify(entry, { type: 'idle', root: entry.root })
  }

  /**
   * Arm the watchdog that counts unanswered client requests.
   * @param {object} entry the root entry
   * @param {object} session the session
   */
  #armWatchdog(entry, session) {
    this.#clearWatchdog(session)
    const lsp = session.lsp ?? DEFAULT_LSP_SETTINGS
    const timeout = Number(lsp.requestTimeoutMs)
    if (!Number.isFinite(timeout) || timeout <= 0) return
    const interval = Math.min(1000, Math.max(25, Math.floor(timeout / 4)))
    const timer = setInterval(() => { this.#checkTimeouts(entry, session, timeout) }, interval)
    timer.unref?.()
    session.watchdogTimer = timer
  }

  /**
   * Count one unanswered request.
   *
   * The watchdog runs every second, and the condition below stays true until
   * the server answers - a counter that was raised on every tick would kill
   * the server after three ticks, which is three *seconds* and not three
   * requests. One stall is therefore counted once: the marker
   * `timeoutStallAt` remembers the client activity the timeout was counted
   * for, and a new request moves that marker.
   * @param {object} entry the root entry
   * @param {object} session the session
   * @param {number} timeout the request timeout
   */
  #checkTimeouts(entry, session, timeout) {
    try {
      if (entry.session !== session) return
      if (session.state !== 'ready' && session.state !== 'building') return
      if (session.lastClientActivityAt === 0) return
      if (session.lastServerActivityAt >= session.lastClientActivityAt) return
      if (this.#now() - session.lastClientActivityAt < timeout) return
      // The stall was already counted: the server is still silent about the
      // same request.
      if (session.timeoutStallAt === session.lastClientActivityAt) return
      this.#noteTimeout(entry, session, 'the language server stopped responding')
    } catch (error) {
      // The watchdog runs in an interval: a throw here is an uncaught
      // exception and would end the DSH host process.
      this.#ctx?.logger?.warn?.('lsp: the watchdog failed: %s', messageOf(error))
    }
  }

  /**
   * Count one request timeout and crash the server when there were too many.
   *
   * The counter is the number of requests that ran into their deadline, and
   * it is reset as soon as the server answers again (see
   * `#onWorkerMessage`). The message says "request timeouts" and not
   * "consecutive request timeouts": the counter is not a streak of ticks.
   * @param {object} entry the root entry
   * @param {object} session the session
   * @param {string} reason the reason of the timeout
   */
  #noteTimeout(entry, session, reason) {
    session.timeoutStallAt = session.lastClientActivityAt
    session.timeouts += 1
    if (session.timeouts < this.#timeoutLimit) return
    this.#safely(this.#onCrash(entry, session, `${session.timeouts} request timeouts`), 'the crash handler')
  }

  /**
   * React to a crashed language server.
   * @param {object} entry the root entry
   * @param {object} session the session
   * @param {string} reason what happened
   */
  async #onCrash(entry, session, reason) {
    if (entry.session !== session) return
    const state = session.state
    if (state === 'cancelled' || state === 'cancelling' || state === 'idle' || state === 'degraded' || state === 'crashed') {
      return
    }
    if (state === 'restarting') {
      this.#transition(session, 'degraded', `the language server could not be restarted (${reason}). Lower the memory limit in the settings, turn this language off, or use the conservative mode.`)
      return
    }
    const lsp = session.lsp ?? DEFAULT_LSP_SETTINGS
    this.#transition(session, 'crashed', reason)
    // The timers of the crashed session go away with it: the restart arms
    // new ones, and a session that stays crashed must not keep a watchdog
    // alive.
    this.#teardownSession(session)
    const detail = `The language server exited unexpectedly (${reason}). A common cause is not enough memory. You can lower the memory limit in the settings, turn this language off, or use the conservative mode.`
    this.#notify(entry, { type: 'crash', root: entry.root, detail })
    if (lsp.autoRestart === false) {
      this.#transition(session, 'degraded', detail)
      return
    }
    if (session.restarts >= 1) {
      this.#transition(session, 'degraded', `${detail} The automatic restart was already used once, so the server was not started again.`)
      return
    }
    // The memory is checked again before the restart: the crash may well have
    // been an out-of-memory kill (PRD §2.7).
    const resources = this.#resourcesSnapshot(session.memoryLimitMB, lsp.freeMemoryThresholdMB)
    if (!resources.canIndex) {
      this.#transition(session, 'degraded', `The language server exited unexpectedly (${reason}) and there is not enough free memory to restart it (needs ${toMb(resources.thresholdBytes)} MB, ${toMb(resources.freeBytes)} MB available). Lower the memory limit in the settings, turn this language off, or use the conservative mode.`)
      return
    }
    session.restarts += 1
    this.#transition(session, 'restarting', 'restarting the language server')
    const timer = setTimeout(() => { this.#safely(this.#restart(entry, session), 'the restart') }, this.#restartBackoffMs)
    timer.unref?.()
    session.restartTimer = timer
  }

  /**
   * Restart a crashed language server.
   * @param {object} entry the root entry
   * @param {object} session the session
   */
  async #restart(entry, session) {
    session.restartTimer = null
    if (entry.session !== session) return
    const lsp = session.lsp ?? DEFAULT_LSP_SETTINGS
    const resources = this.#resourcesSnapshot(session.memoryLimitMB, lsp.freeMemoryThresholdMB)
    if (!resources.canIndex) {
      this.#transition(session, 'degraded', `there is not enough free memory to restart the language server (needs ${toMb(resources.thresholdBytes)} MB, ${toMb(resources.freeBytes)} MB available). Lower the memory limit in the settings, turn this language off, or use the conservative mode.`)
      return
    }
    try {
      await this.#spawn(entry, session, session.resolution)
    } catch (error) {
      this.#transition(session, 'degraded', `the language server could not be restarted: ${messageOf(error)}`)
      return
    }
    // The state may have moved on while the process was starting: an idle
    // exit, a cancel or a shutdown can happen in that window. A restart must
    // not drag the session back into a build it has left.
    if (entry.session !== session) return
    if (session.state !== 'restarting') return
    this.#transition(session, 'building', 'building the program')
    session.startedAt = this.#now()
    session.lastActivityAt = this.#now()
    this.#reopenDocuments(entry, session)
    this.#armIdleTimer(entry, session)
    this.#armWatchdog(entry, session)
  }

  /**
   * Terminate the language server and wait for it to be gone.
   * @param {object} session the session
   */
  async #terminateAndWait(session) {
    const handle = session.handle
    if (handle === undefined || handle === null) return
    try {
      handle.terminate()
    } catch {
      return
    }
    try {
      await Promise.race([
        Promise.resolve(typeof handle.waitForExit === 'function' ? handle.waitForExit() : true).catch(() => false),
        this.#delay(this.#graceMs + 500),
      ])
    } catch { /* the handle never reported an exit */ }
  }

  /**
   * Stop the frame worker of one session.
   * @param {object} session the session
   */
  #stopWorker(session) {
    const worker = session.worker
    session.worker = null
    if (worker === undefined || worker === null) return
    try {
      worker.terminate?.()
    } catch { /* already gone */ }
  }

  /**
   * Stop one session: its worker and every timer it owns.
   *
   * A session that is replaced must not leave a timer behind. An idle timer
   * of ten minutes and a watchdog that wakes up every second are harmless on
   * their own, but a session that is cancelled, crashed or replaced leaves
   * them behind - and after a few project switches the host keeps a handful
   * of intervals alive that nobody waits for any more.
   *
   * The timers are `unref`'d, so they never hold the process open, but they
   * still cost a wake-up per second each.
   * @param {object | null} session the session
   */
  #teardownSession(session) {
    if (session === null || session === undefined) return
    this.#clearIdleTimer(session)
    this.#clearWatchdog(session)
    if (session.readyTimer !== null) {
      clearTimeout(session.readyTimer)
      session.readyTimer = null
    }
    if (session.restartTimer !== null) {
      clearTimeout(session.restartTimer)
      session.restartTimer = null
    }
    this.#stopWorker(session)
  }

  /**
   * Clear the idle timer of one session.
   * @param {object} session the session
   */
  #clearIdleTimer(session) {
    if (session.idleTimer !== null) {
      clearTimeout(session.idleTimer)
      session.idleTimer = null
    }
  }

  /**
   * Clear the watchdog of one session.
   * @param {object} session the session
   */
  #clearWatchdog(session) {
    if (session.watchdogTimer !== null) {
      clearInterval(session.watchdogTimer)
      session.watchdogTimer = null
    }
  }

  /**
   * A promise that resolves after a delay.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  #delay(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms)
      timer.unref?.()
    })
  }

  /**
   * Stop one root's language server.
   * @param {object} entry the root entry
   */
  async #shutdownEntry(entry) {
    const session = entry.session
    if (session === null) {
      entry.documents.clear()
      return
    }
    this.#writeDidClose(entry, session)
    session.intentionalExit = true
    await this.#terminateAndWait(session)
    this.#teardownSession(session)
    if (session.state !== 'cancelled') {
      try {
        this.#transition(session, 'idle', 'the language server was shut down')
      } catch {
        session.state = 'idle'
      }
    }
    session.handle = null
    session.exited = true
    this.#forgetDocuments(entry)
    this.#notify(entry, { type: 'idle', root: entry.root })
  }
}

/**
 * The current state of one project root.
 *
 * The state lives in the host process, so any caller can read it without
 * holding a reference to the manager that owns the root.
 * @param {string} root the absolute project root
 * @returns {object} the snapshot
 */
export function lspStateOf(root) {
  const entry = ROOTS.get(rootKey(root))
  if (entry === undefined) {
    return {
      root: resolvePath(String(root)),
      state: 'idle',
      languageId: null,
      command: null,
      source: null,
      resolvedPath: null,
      detail: null,
      startedAt: null,
      cancellable: false,
      progress: 'idle',
      memoryLimitMB: null,
      stderrLines: [],
    }
  }
  return snapshotOf(entry)
}

/**
 * Stop every language server of this process.
 *
 * The host calls this when the plugin is unloaded: no language server may
 * outlive the plugin.
 */
export function shutdownAll() {
  for (const entry of ROOTS.values()) {
    const session = entry.session
    if (session === null) continue
    try {
      session.handle?.terminate()
    } catch { /* already gone */ }
    try {
      session.worker?.terminate?.()
    } catch { /* already gone */ }
    // The timers of the session go away with it: an unloaded plugin must
    // not leave a watchdog running in the host.
    if (session.idleTimer !== null) {
      clearTimeout(session.idleTimer)
      session.idleTimer = null
    }
    if (session.watchdogTimer !== null) {
      clearInterval(session.watchdogTimer)
      session.watchdogTimer = null
    }
    if (session.readyTimer !== null) {
      clearTimeout(session.readyTimer)
      session.readyTimer = null
    }
    if (session.restartTimer !== null) {
      clearTimeout(session.restartTimer)
      session.restartTimer = null
    }
    session.worker = null
    session.handle = null
    session.state = 'idle'
    entry.session = null
    entry.documents.clear()
  }
  ROOTS.clear()
}
