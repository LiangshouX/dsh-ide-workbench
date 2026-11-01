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
import { accessSync, constants, existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { constants as osConstants, freemem, setPriority, totalmem } from 'node:os'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { Worker } from 'node:worker_threads'
import { ApiError } from './wire.js'
import { BUILD_REQUEST_TIMEOUT_MS, DEFAULT_LSP_SETTINGS, IDLE_POLICIES, INDEX_SCOPES } from './settings-defaults.js'
import { SEMANTIC_METHODS } from './semantic-methods.js'

/**
 * The language registry (PRD §3.2).
 *
 * `typescript` and `javascript` are two names for the same server: the
 * TypeScript language server answers for both languages, so the two entries
 * are aliases and their `languageIds` overlap. Every language id therefore
 * resolves to exactly one language server command. `memoryLimitMB` is the
 * ceiling the server is asked to respect and can be overridden per language
 * through `settings.lsp.servers[languageId].memoryLimitMB`.
 *
 * `memoryBaselineMB` is the typical footprint of the server, not its worst
 * case: it is the estimate the free memory is compared with, so a YAML
 * project does not need the gigabytes a TypeScript project needs (PRD §2.2).
 * It can be overridden the same way the memory limit is.
 *
 * The number of the TypeScript server is a *measurement*, not a guess: the
 * 256 MB of the earlier versions measured the idle wrapper process of the
 * server, not the index it builds. The index of a real project measured
 * 400-600 MB (median 434 MB, 300 modules; 606 MB for 600 modules), so the
 * estimate was 1.4-2.4 times too low and the memory gate let the machine
 * run out of memory (PRD-v5 §5.2).
 */
export const LSP_REGISTRY = {
  typescript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
    languageIds: ['typescript', 'javascript', 'javascriptreact', 'typescriptreact'],
    memoryLimitMB: 2048,
    memoryBaselineMB: 434,
  },
  javascript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
    languageIds: ['typescript', 'javascript', 'javascriptreact', 'typescriptreact'],
    memoryLimitMB: 2048,
    memoryBaselineMB: 434,
  },
  python: {
    command: 'basedpyright-langserver',
    args: ['--stdio'],
    languageIds: ['python'],
    memoryLimitMB: 1536,
    memoryBaselineMB: 192,
  },
  yaml: {
    command: 'yaml-language-server',
    args: ['--stdio'],
    languageIds: ['yaml'],
    memoryLimitMB: 512,
    memoryBaselineMB: 64,
  },
  java: {
    command: 'jdtls',
    args: [],
    languageIds: ['java'],
    memoryLimitMB: 2048,
    memoryBaselineMB: 512,
    requires: 'JDK 21+',
  },
  go: {
    command: 'gopls',
    args: [],
    languageIds: ['go'],
    memoryLimitMB: 1536,
    memoryBaselineMB: 256,
    requires: 'Go toolchain',
  },
  rust: {
    command: 'rust-analyzer',
    args: [],
    languageIds: ['rust'],
    memoryLimitMB: 2048,
    memoryBaselineMB: 512,
    requires: 'rustup component',
  },
  cpp: {
    command: 'clangd',
    args: [],
    languageIds: ['c', 'cpp'],
    memoryLimitMB: 2048,
    memoryBaselineMB: 384,
    requires: 'LLVM',
  },
}

/**
 * The estimate of a language server that has no baseline of its own.
 *
 * The number is deliberately modest: it is only used when the language is
 * unknown, so it must neither block a start nor hide a real shortage.
 */
export const DEFAULT_BASELINE_MB = 256

/**
 * The factor between the estimate of a language server and the free memory
 * a start needs (PRD §2.2, decision #2).
 */
export const MEMORY_HEADROOM = 1.5

/**
 * The factor at which the free memory turns from "enough" into "tight".
 *
 * Below twice the estimate the user decides whether the server starts
 * (PRD §2.3), so the host refuses to start it on its own.
 */
export const MEMORY_SOFT_FACTOR = 2.0

/**
 * The free memory below which no language server starts at all (MB).
 *
 * Below this value the process cannot run whatever it is: the machine is
 * out of memory, and a server would only make it worse.
 */
export const MEMORY_HARD_FLOOR_MB = 256

/**
 * The ceiling tiers of a language server (PRD-v5.1 §3.7, MEM-11).
 *
 * The ceiling of a server is a PERMISSION (`maxTsServerMemory`), not an
 * expectation: the measured footprint of a TypeScript index is 434 MB (the
 * median of PRD-v5 §5.2) and 606 MB for a big project, while the flat
 * 2048 MB of the registry was the worst case of the worst case. A number
 * that was never going to be reached cannot be the unit of the accounting
 * (MEM-05), the base of the worst case (MEM-07) and the exposure of the
 * machine at the same time.
 *
 * The tiers are the ceiling a project of that size gets:
 *
 *   small  (<= 400 source files)   1024 MB - still 2.3x the measured 434 MB
 *   medium (<= 1000 source files)  1536 MB
 *   large  (> 1000 source files)   2048 MB - the old flat value
 *
 * The tier only LOWERS a ceiling, it never raises one: the effective
 * ceiling is `min(tier, the ceiling of the language, the global limit)`.
 */
export const CEILING_TIERS = [
  { name: 'small', maxSourceFiles: 400, memoryLimitMB: 1024 },
  { name: 'medium', maxSourceFiles: 1000, memoryLimitMB: 1536 },
]

/**
 * The ceiling of a project that is too big for the tiers (MB).
 *
 * It is also the ceiling of a project whose size could not be measured: an
 * unknown size is not evidence of a small project (PRD-v5.1 §8 risk 2), and
 * lowering the ceiling without knowing why is how a big project ends up
 * without an index.
 */
export const LARGE_CEILING_MB = 2048

/**
 * The biggest difference between two readings of the free memory that is
 * still noise (MB).
 *
 * The difference method of MEM-06 measures the footprint of a language
 * server as the difference of two readings of `os.freemem()`. A difference
 * of a few megabytes is not a language server - it is the machine doing
 * something else at the same time. Above this value the difference is
 * taken as the footprint of the server.
 */
export const MEASURE_NOISE_MAX_MB = 8

/**
 * The biggest negative difference between two readings of the free memory
 * that is still noise (MB).
 *
 * A negative difference means that the machine gave memory away while the
 * server was started. The measurement cannot be attributed to the server
 * then, so it is void.
 */
export const MEASURE_NOISE_MIN_MB = -64

/**
 * How often the footprint of a running language server is measured again (ms).
 *
 * The first measurement happens while the process starts - the program of
 * the project is not built yet, so the server is still small. It grows
 * while the program is built, and the gate has to know that: a server that
 * grew to 900 MB has 900 MB less headroom.
 */
export const MEASURE_INTERVAL_MS = 60000

/**
 * The message of a release under memory pressure (the LRU yield).
 *
 * The machine needs the memory more than the projects need their indexes,
 * and the server that was released is the one that was used the least. It
 * is not a failure: the first request starts the server again (IDLE-02).
 *
 * The message says what actually happened and NOT "the machine ran out of
 * memory": what ran out is the MARGIN of the machine - the free memory
 * minus what the running servers may still take - and that margin can be
 * gone while the machine still has gigabytes of free memory (review R4,
 * N4). The margin and the floor are IN the message, so the sentence cannot
 * be true in one range of the numbers and false in the next one (review R5,
 * M2): the two numbers are filled in by `pressureDetailOf`.
 */
export const PRESSURE_YIELD_DETAIL = 'the machine had {margin} MB of memory left for the running language servers - below the {floor} MB floor - so the least used one was released to reclaim it (this is not a failure)'

/**
 * Fill the numbers of the message of a release under memory pressure.
 *
 * The message must be true in every range of the numbers, and the only way
 * to get that is to put the numbers INTO it: the margin of the machine and
 * the floor it fell below. A sentence about the condition ("the machine had
 * less memory left than the servers may still take") is true only when the
 * margin is NEGATIVE - and the valve fires the whole band below the floor,
 * where that sentence is false (review R5, M2).
 * @param {string} template the message with its placeholders
 * @param {object | null} resources the memory snapshot that found the pressure
 * @returns {string} the message with the numbers of the snapshot
 */
export function pressureDetailOf(template, resources) {
  const margin = Math.round((resources?.safeAvailableBytes ?? 0) / (1024 * 1024))
  const floor = Math.round(Number(resources?.hardFloorMB ?? 0))
  return template.replace('{margin}', String(margin)).replace('{floor}', String(floor))
}

/**
 * The defaults of the `lsp` settings section (PRD §6.1).
 *
 * The numbers live in `settings-defaults.js`: the client needs them too (the
 * "reset to defaults" button of the settings page), and a second copy would
 * drift away from the document the host writes.
 */
export { DEFAULT_LSP_SETTINGS }

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
  building: ['ready', 'failed', 'degraded', 'cancelling', 'crashed', 'idle', 'suspended'],
  ready: ['crashed', 'degraded', 'cancelling', 'idle', 'suspended'],
  restarting: ['building', 'failed', 'degraded', 'cancelling', 'idle'],
  crashed: ['restarting', 'degraded', 'cancelling', 'idle'],
  cancelling: ['cancelled', 'idle'],
  cancelled: ['starting', 'idle'],
  failed: ['starting', 'idle'],
  degraded: ['starting', 'idle'],
  /**
   * The server was released on purpose - the memory it held was given
   * back to the machine (PRD-v5 §1.2).
   *
   * It is NOT a failure: the difference to `degraded` is the difference
   * between "the machine could not afford it" and "the machine does not
   * need it right now". The way back is `starting` (the first request
   * wakes the server again), and `idle` is the way out for good.
   */
  suspended: ['starting', 'idle', 'degraded'],
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
  suspended: 'suspended',
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
 * The message of an idle release (VIS-01).
 *
 * The server was released on purpose: the memory it held was given back to
 * the machine. That is not a failure, and the message has to say so - the
 * status bar shows the state, and the state is "asleep", not "broken".
 */
const IDLE_EXIT_DETAIL = 'the language server was released to reclaim memory after a period of inactivity (this is not a failure)'

/**
 * The message of a release under memory pressure.
 *
 * The same as the idle release, but the reason is the machine: it needs the
 * memory more than the project needs the index. What ran out is the margin
 * of the machine, not its free memory - see `PRESSURE_YIELD_DETAIL`.
 */
const PRESSURE_EXIT_DETAIL = 'the machine had {margin} MB of memory left for the running language servers - below the {floor} MB floor - so this one was released to reclaim it (this is not a failure)'

/**
 * The shortest interval of the memory pressure check (ms).
 */
const PRESSURE_CHECK_MIN_MS = 250

/**
 * The longest interval of the memory pressure check (ms).
 */
const PRESSURE_CHECK_MAX_MS = 30000

/**
 * The interval of the memory pressure check (ms).
 *
 * The check reads the free memory of the machine and walks the sessions of
 * the manager: it is cheap, and the machine must not wait long for the
 * memory it asks for (MEM-12).
 *
 * The interval does NOT depend on the idle timeout: the two are unrelated
 * questions ("how long may an unused server live" and "how fast does the
 * machine ask for its memory back"), and one of them must not slow the
 * other down. The old implementation derived the interval from the idle
 * timeout, so a machine with a ten-minute idle timeout only noticed the
 * pressure every thirty seconds.
 */
const PRESSURE_CHECK_INTERVAL_MS = 1000

/**
 * How many client payloads may wait for a language server.
 *
 * The browser connects its socket long before the server exists, so its
 * handshake lands here first. The buffer is a safety net, not a queue: a
 * handful of payloads is plenty.
 */
const MAX_PENDING_PAYLOADS = 64

/**
 * The backoff of a failed wake (ms).
 *
 * A wake that the memory gate refused must not turn every incoming payload
 * into a start attempt: the payloads arrive in bursts (a completion, a
 * hover, a semantic request of the editor), and the machine does not get
 * more memory because the user pressed F12 twice. One attempt per minute
 * per root is enough - the user frees some memory and the next payload
 * tries again.
 */
const WAKE_BACKOFF_MS = 60000

/**
 * The reasons why a session may be degraded.
 *
 * The reason decides whether a later payload may try again (IDLE-02): the
 * memory of the machine changes and the user may free some, but a server
 * that is not installed does not appear while the editor is open.
 *
 *   - 'memory': the memory gate refused the start (the tight band or the
 *     hard floor). Worth a retry.
 *   - 'budget': the machine-level total budget of the language servers is
 *     used up (MEM-08). Worth a retry: the budget frees up as soon as a
 *     server is released.
 *   - 'not-installed': the language server is not installed. The user has
 *     to install something first.
 *   - 'turned-off': the language is switched off in the settings.
 *   - 'crash': the crash budget is used up. The restart budget is one
 *     (PRD §2.7), so the host does not try again on its own.
 */
export const DEGRADE_CAUSES = {
  memory: 'memory',
  budget: 'budget',
  notInstalled: 'not-installed',
  turnedOff: 'turned-off',
  crash: 'crash',
}

/**
 * The degradations a later payload may try again (IDLE-02).
 *
 * Only the memory and the budget are worth a retry: the situation of the
 * machine changes, and the user may free some of it - a released server
 * gives its share of the budget back. A server that is not installed, a
 * language that is switched off and an exhausted crash budget need the
 * user - a retry would only repeat the same refusal.
 */
const RETRYABLE_DEGRADE_CAUSES = new Set([DEGRADE_CAUSES.memory, DEGRADE_CAUSES.budget])

/**
 * The states that end a degradation episode.
 *
 * The language server works again (or the user stopped it): the next
 * degradation is a new episode and gets its own announcement. The states
 * in between - `starting`, `crashed`, `restarting` - do NOT end it: a wake
 * that is refused walks `degraded → starting → degraded`, and that is one
 * fault, not two.
 */
const DEGRADE_EPISODE_END_STATES = ['building', 'ready', 'idle', 'cancelled']

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
    memoryWarnedRoots: isPlainObject(section.memoryWarnedRoots) ? section.memoryWarnedRoots : {},
  }
}

/**
 * The idle policy of the `lsp` section (PRD-v5 §3.2, PRD-v5.1 §5).
 *
 * `autoExit: false` is the switch of the documents that were written before
 * schema 5, and it still means "never exit": the older switch overrides the
 * newer policy, so a document that has it keeps its meaning.
 *
 * The four policies are 'never', 'after', 'onMemoryPressure' and 'always'
 * (the last one is the explicit spelling of 'after' - the idle release AND
 * the pressure yield). The list itself lives in `settings-defaults.js`,
 * because the settings page offers the same choices.
 * @param {object} lsp the `lsp` section of the settings
 * @returns {'never' | 'after' | 'onMemoryPressure' | 'always'}
 */
function idlePolicyOf(lsp) {
  const section = isPlainObject(lsp) ? lsp : {}
  if (section.autoExit === false) return 'never'
  return IDLE_POLICIES.includes(section.idlePolicy) ? section.idlePolicy : DEFAULT_LSP_SETTINGS.idlePolicy
}

/**
 * Whether the memory pressure valve may release a language server
 * (PRD-v5.1 §3.8, MEM-12).
 *
 * The valve is the last defence against the swap, and it is ON by default.
 * It is independent of the idle policy: `idlePolicy: 'never'` means "not
 * because of idleness", not "not even when the machine is dying".
 *
 * `pressureYield: false` is the one and only way to switch it off - the
 * user who does that gives up the protection, so it has to be explicit.
 *
 * @param {object} lsp the `lsp` section of the settings
 * @returns {boolean}
 */
function pressureYieldOf(lsp) {
  const section = isPlainObject(lsp) ? lsp : DEFAULT_LSP_SETTINGS
  return section.pressureYield !== false
}

/**
 * The index scope of the `lsp` section (PRD-v5 §4.2).
 * @param {object} lsp the `lsp` section of the settings
 * @returns {'auto' | 'root' | 'project'}
 */
function indexScopeOf(lsp) {
  const section = isPlainObject(lsp) ? lsp : {}
  return INDEX_SCOPES.includes(section.indexScope) ? section.indexScope : DEFAULT_LSP_SETTINGS.indexScope
}

/**
 * The memory estimate of one language server (PRD §2.2).
 *
 * The baseline is the typical footprint of the server, not its worst case:
 * a project that needs more raises the memory limit itself. The settings
 * may override the baseline per language, exactly like the memory limit.
 * @param {string | null} languageId the language of the server
 * @param {object} lsp the `lsp` section of the settings
 * @returns {{ baselineMB: number, estimated: boolean }} the baseline and
 *   whether it comes from the registry or the settings
 */
function memoryEstimateOf(languageId, lsp) {
  const servers = isPlainObject(lsp?.servers) ? lsp.servers : {}
  const override = isPlainObject(servers[languageId]) ? servers[languageId] : {}
  const registryEntry = typeof languageId === 'string' ? LSP_REGISTRY[languageId] : undefined
  // `baselineMB` is accepted as an alias of `memoryBaselineMB`: both names
  // are in the wild, and a settings document must not be rejected because of
  // the one it happens to use.
  const overridden = Number.isFinite(override.memoryBaselineMB)
    ? override.memoryBaselineMB
    : (Number.isFinite(override.baselineMB) ? override.baselineMB : null)
  const registered = Number.isFinite(registryEntry?.memoryBaselineMB) ? registryEntry.memoryBaselineMB : null
  return {
    baselineMB: overridden ?? registered ?? DEFAULT_BASELINE_MB,
    // Without a baseline of its own the estimate is a guess, and the
    // conservative floor of the settings takes over.
    estimated: overridden !== null || registered !== null,
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
 * The files that make a directory a project of its own.
 *
 * The list is the marker set of the languages the plugin knows: a directory
 * with one of them is a project, a directory without one is only a folder.
 */
const PROJECT_MARKERS = [
  'package.json',
  'tsconfig.json',
  'jsconfig.json',
  'pyproject.toml',
  'setup.py',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
]

/**
 * The file names that count as source of a project.
 *
 * Only the languages of the plugin are counted: the scan is a heuristic that
 * answers "which of the sub-projects is the big one", not a file index.
 */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

/**
 * Whether one directory is a project of its own.
 * @param {string} directory the absolute path of the directory
 * @returns {boolean}
 */
function isProjectRoot(directory) {
  return PROJECT_MARKERS.some(marker => existsSync(join(directory, marker)))
}

/**
 * The project roots directly below one directory.
 *
 * Only the direct children are looked at: a sub-project that lives deeper is
 * part of the project above it, and the scope has to be the *nearest* one.
 * @param {string} root the absolute path of the directory
 * @returns {string[]} the absolute paths of the sub-projects, sorted
 */
function subProjectsOf(root) {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    // The root does not exist (a project that was never created) or cannot
    // be read: there is no sub-project to find.
    return []
  }
  const projects = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const directory = join(root, entry.name)
    if (isProjectRoot(directory)) projects.push(directory)
  }
  return projects.sort()
}

/**
 * How many source files one project has (bounded scan).
 *
 * The scan is a heuristic and it is bounded on purpose: it runs while a
 * language server is started, and a workspace with thousands of files must
 * not slow the start down. The count only decides which of several
 * sub-projects is the scope of the program.
 * @param {string} directory the absolute path of the project
 * @returns {number} the number of source files that were counted
 */
function sourceCountOf(directory) {
  let counted = 0
  const visit = (current, depth) => {
    if (depth > 3 || counted >= 400) return
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (counted >= 400) return
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      if (entry.isDirectory()) {
        visit(join(current, entry.name), depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (SOURCE_EXTENSIONS.some(extension => entry.name.endsWith(extension))) counted += 1
    }
  }
  visit(directory, 0)
  return counted
}

/**
 * The biggest number of source files the size estimate counts (files).
 *
 * The estimate answers one question - "is this a small project or a big
 * one?" - and the tiers of the ceiling (MEM-11) only have three answers. A
 * project with more than 2000 source files is a big one whatever the exact
 * number is, so the scan stops there.
 */
const PROJECT_SIZE_CAP = 2000

/**
 * How long a size estimate is reused (ms).
 *
 * The estimate is a scan of the file tree, and the resources snapshot is
 * polled every two seconds by the client. The size of a project does not
 * change from second to second, so the result is kept for a while.
 */
const PROJECT_SIZE_TTL_MS = 300000

/**
 * The size estimates of the projects, by their normalized path.
 * @type {Map<string, { count: number, at: number }>}
 */
const PROJECT_SIZES = new Map()

/**
 * How many source files one project has (bounded scan for the ceiling tier).
 *
 * This is a SECOND scan, and it is deliberately not the one of
 * {@link sourceCountOf}: that one stops at 400 files, because it only has to
 * tell the sub-projects of a workspace apart ("which one is the big one?").
 * The ceiling tier has to tell a small project from a big one, and the
 * boundary between "medium" and "large" is at 1000 files - so this scan
 * counts up to 2000 files and no deeper than three directories.
 *
 * The scan is bounded on purpose: it runs while a language server is
 * started, and a workspace with thousands of files must not slow the start
 * down. It is NOT a file index - it is a size estimate.
 *
 * @param {string} directory the absolute path of the project
 * @returns {number} the number of source files that were counted (0 when
 *   the directory does not exist or cannot be read)
 */
export function projectSizeOf(directory) {
  if (typeof directory !== 'string' || directory === '') return 0
  const key = rootKey(directory)
  const now = Date.now()
  const cached = PROJECT_SIZES.get(key)
  if (cached !== undefined && now - cached.at < PROJECT_SIZE_TTL_MS) return cached.count
  const count = countSourceFiles(directory)
  PROJECT_SIZES.set(key, { count, at: now })
  return count
}

/**
 * Count the source files of one project (bounded scan).
 * @param {string} directory the absolute path of the project
 * @returns {number} the number of source files that were counted
 */
function countSourceFiles(directory) {
  let counted = 0
  const visit = (current, depth) => {
    if (depth > 3 || counted >= PROJECT_SIZE_CAP) return
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      // The directory does not exist (a project that was never created) or
      // cannot be read: the size is unknown.
      return
    }
    for (const entry of entries) {
      if (counted >= PROJECT_SIZE_CAP) return
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      if (entry.isDirectory()) {
        visit(join(current, entry.name), depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (SOURCE_EXTENSIONS.some(extension => entry.name.endsWith(extension))) counted += 1
    }
  }
  visit(directory, 0)
  return counted
}

/**
 * The tier of one project size (PRD-v5.1 §3.7, MEM-11).
 *
 * A size of zero is NOT a small project: it is a project whose size could
 * not be measured (the directory does not exist, cannot be read, or holds
 * no source files at all). The tier of an unknown size is 'unknown', and
 * the unknown size keeps the default ceiling - lowering the ceiling
 * without knowing why is how a big project ends up without an index
 * (PRD-v5.1 §8 risk 2).
 *
 * @param {number} sourceFiles the number of source files of the project
 * @returns {'small' | 'medium' | 'large' | 'unknown'} the tier
 */
export function ceilingTierOf(sourceFiles) {
  if (!Number.isFinite(sourceFiles) || sourceFiles <= 0) return 'unknown'
  for (const tier of CEILING_TIERS) {
    if (sourceFiles <= tier.maxSourceFiles) return tier.name
  }
  return 'large'
}

/**
 * The ceiling of one project size (MB).
 *
 * @param {number} sourceFiles the number of source files of the project
 * @returns {number} the ceiling in megabytes
 */
export function ceilingMBOfSize(sourceFiles) {
  const tier = ceilingTierOf(sourceFiles)
  const entry = CEILING_TIERS.find(candidate => candidate.name === tier)
  return entry === undefined ? LARGE_CEILING_MB : entry.memoryLimitMB
}

/**
 * The effective ceiling of one language server (PRD-v5.1 §3.7, MEM-11).
 *
 * Three values play here, and the order matters:
 *
 *   1. the per-language override of the settings (`servers[lang].memoryLimitMB`)
 *      wins over everything: it is the escape hatch that keeps a big
 *      project working when the tier guessed wrong;
 *   2. the tier of the project size, lowered to the ceiling of the language
 *      (the tier only lowers a ceiling, it never raises one - a YAML server
 *      stays at 512 MB);
 *   3. the global limit of the settings, which is a CAP over every language
 *      server now (PRD-v5.1 §5) and not a flat value any more.
 *
 * @param {string | null} languageId the language of the server
 * @param {string | null} scopeRoot the directory the program is built for
 * @param {object} lsp the `lsp` section of the settings
 * @returns {number} the ceiling in megabytes
 */
export function ceilingMBOf(languageId, scopeRoot, lsp) {
  const section = isPlainObject(lsp) ? lsp : DEFAULT_LSP_SETTINGS
  const servers = isPlainObject(section.servers) ? section.servers : {}
  const override = isPlainObject(servers[languageId]) ? servers[languageId] : {}
  const registryEntry = typeof languageId === 'string' ? LSP_REGISTRY[languageId] : undefined
  const registryMB = Number.isFinite(registryEntry?.memoryLimitMB) && registryEntry.memoryLimitMB > 0
    ? registryEntry.memoryLimitMB
    : LARGE_CEILING_MB
  // The override of the user wins over everything.
  if (Number.isFinite(override.memoryLimitMB) && override.memoryLimitMB > 0) return override.memoryLimitMB
  const tierMB = Math.min(ceilingMBOfSize(projectSizeOf(scopeRoot)), registryMB)
  const globalMB = Number.isFinite(section.memoryLimitMB) && section.memoryLimitMB > 0
    ? section.memoryLimitMB
    : tierMB
  return Math.min(tierMB, globalMB)
}

/**
 * The root of the program the language server builds (PRD-v5 §4.2).
 *
 * A workspace root that holds several independent projects must not be
 * indexed as one program: the language server merges them and builds one
 * program for the whole tree (measured: 2,335 files / 84 MB for six
 * projects, where one of them had 159 files).
 *
 * The rule:
 *
 *   - 'root' keeps the whole root - the behaviour of the older versions.
 *   - 'auto' keeps a root that is a project of its own and converges onto
 *     the nearest sub-project otherwise.
 *   - 'project' always converges onto the nearest sub-project.
 *
 * "The nearest sub-project" is the direct child of the root that is a
 * project. When there is more than one, the one with the most sources wins
 * - it is the project the user works in - and the first one in alphabetical
 * order breaks the tie.
 *
 * @param {string} root the absolute project root
 * @param {string} [policy] 'auto' | 'root' | 'project'
 * @returns {string} the absolute scope root
 */
export function scopeRootOf(root, policy = 'auto') {
  const absolute = resolvePath(String(root))
  if (policy === 'root') return absolute
  const own = isProjectRoot(absolute)
  if (own && policy !== 'project') return absolute
  const projects = subProjectsOf(absolute)
  if (projects.length === 0) return absolute
  if (projects.length === 1) return resolvePath(projects[0])
  let best = projects[0]
  let bestCount = -1
  for (const project of projects) {
    const count = sourceCountOf(project)
    if (count > bestCount) {
      best = project
      bestCount = count
    }
  }
  return resolvePath(best)
}

/**
 * The configuration files that describe the program of a project.
 *
 * A TypeScript project is described by its `tsconfig.json`, a JavaScript
 * one by its `jsconfig.json`. They are the same thing for the language
 * server, and two roots that share one of them share ONE program.
 */
const PROJECT_CONFIGS = ['tsconfig.json', 'jsconfig.json']

/**
 * How many directories above a root are looked at for a workspace (levels).
 *
 * The lookup is bounded: a program never lives twelve directories above the
 * file the user opened, and the walk must not turn into a scan of the disk.
 */
const WORKSPACE_LOOKUP_DEPTH = 8

/**
 * How many configurations one program may reference (files).
 */
const MAX_REFERENCES = 64

/**
 * The configuration file of one directory (the first one that exists).
 * @param {string} directory the absolute path of the directory
 * @returns {string | null} the absolute path of the configuration
 */
function configOf(directory) {
  for (const name of PROJECT_CONFIGS) {
    const path = join(directory, name)
    if (existsSync(path)) return path
  }
  return null
}

/**
 * Parse a configuration file that may contain comments.
 *
 * A `tsconfig.json` is JSON with comments and trailing commas - it is not
 * JSON, and `JSON.parse` refuses it. The comments are removed before the
 * parse; a file that still cannot be read is treated as a configuration
 * without references, which merges less than it could.
 *
 * @param {string} text the content of the file
 * @returns {any} the parsed value, or null when it cannot be read
 */
function parseJsonc(text) {
  try {
    const withoutComments = String(text)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    return JSON.parse(withoutComments.replace(/,(\s*[}\]])/g, '$1'))
  } catch {
    return null
  }
}

/**
 * The configurations one configuration references (one level).
 * @param {string} configPath the absolute path of the configuration
 * @returns {string[]} the absolute paths of the referenced configurations
 */
function referencesOf(configPath) {
  let text
  try {
    text = readFileSync(configPath, 'utf8')
  } catch {
    return []
  }
  const parsed = parseJsonc(text)
  const references = parsed !== null && Array.isArray(parsed.references) ? parsed.references : []
  const directory = dirname(configPath)
  const output = []
  for (const reference of references) {
    const target = typeof reference?.path === 'string' ? reference.path : ''
    if (target === '') continue
    const path = resolvePath(directory, target)
    for (const name of PROJECT_CONFIGS) {
      const candidate = join(path, name)
      if (existsSync(candidate)) {
        output.push(candidate)
        break
      }
    }
  }
  return output
}

/**
 * The configurations one configuration references (transitively).
 * @param {string | null} configPath the absolute path of the configuration
 * @returns {string[]} the absolute paths of the referenced configurations
 */
function referencedConfigsOf(configPath) {
  if (configPath === null || configPath === undefined) return []
  const found = new Set()
  const queue = [configPath]
  while (queue.length > 0 && found.size < MAX_REFERENCES) {
    const current = queue.shift()
    if (current === null || current === undefined || found.has(current)) continue
    found.add(current)
    for (const reference of referencesOf(current)) {
      if (!found.has(reference)) queue.push(reference)
    }
  }
  found.delete(configPath)
  return [...found].sort()
}

/**
 * Whether one directory is the root of a workspace.
 *
 * Two shapes make a directory a workspace root:
 *
 *   - it is the root of a package manager workspace (`package.json` with a
 *     `workspaces` field): pnpm, npm and yarn put the packages of a
 *     monorepo below it, and those packages are ONE program for the
 *     language server;
 *   - it holds a configuration that references the project of the root (or
 *     configurations inside it): a solution-style `tsconfig.json` with
 *     `references` makes its packages one program.
 *
 * @param {string} directory the absolute path of the directory
 * @param {string | null} configPath the configuration of the project
 * @returns {boolean}
 */
function isWorkspaceRoot(directory, configPath) {
  const manifest = join(directory, 'package.json')
  if (existsSync(manifest)) {
    try {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
      if (isPlainObject(parsed?.workspaces)) return true
    } catch { /* no readable manifest */ }
  }
  const config = configOf(directory)
  if (config === null) return false
  const references = referencedConfigsOf(config)
  // The paths are compared through `rootKey`: Windows spells a path with
  // backslashes, and the case of the letters does not matter there.
  if (configPath !== null && references.some(reference => rootKey(reference) === rootKey(configPath))) return true
  const prefix = `${rootKey(directory)}/`
  for (const reference of references) {
    if (rootKey(reference).startsWith(prefix)) return true
  }
  return false
}

/**
 * The outermost directory above one root that is a workspace root.
 * @param {string} directory the absolute path of the root
 * @param {string | null} configPath the configuration of the project
 * @returns {string | null} the workspace root, or null when there is none
 */
function workspaceRootOf(directory, configPath) {
  let current = resolvePath(String(directory))
  let found = null
  for (let depth = 0; depth <= WORKSPACE_LOOKUP_DEPTH; depth += 1) {
    if (isWorkspaceRoot(current, configPath)) found = current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return found
}

/**
 * The configuration of the program of one directory.
 *
 * The configuration of the directory itself wins; if there is none, the
 * nearest one above it is used - a root that is a sub-directory of a
 * project belongs to the program of that project.
 *
 * @param {string} directory the absolute path of the directory
 * @returns {string | null} the absolute path of the configuration
 */
function nearestConfigOf(directory) {
  let current = resolvePath(String(directory))
  for (let depth = 0; depth <= WORKSPACE_LOOKUP_DEPTH; depth += 1) {
    const config = configOf(current)
    if (config !== null) return config
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

/**
 * The path of a `file:` URI.
 * @param {string} uri the URI
 * @returns {string | null} the absolute path, or null when the URI is not one
 */
function fileUriToPath(uri) {
  if (!/^file:\/\//i.test(String(uri))) return null
  const rest = String(uri).slice('file://'.length)
  const slash = rest.indexOf('/')
  if (slash < 0) return null
  const host = rest.slice(0, slash)
  if (host !== '' && host !== 'localhost') return null
  let path = rest.slice(slash)
  if (process.platform === 'win32') path = path.replace(/^\/([A-Za-z]:)/, '$1')
  try {
    return resolvePath(decodeURIComponent(path))
  } catch {
    return resolvePath(path)
  }
}

/**
 * The root URI of a recorded handshake.
 *
 * The handshake is owned by the host (PRD-v5 §6, L4), and its `rootUri` is
 * the authoritative statement of WHICH program the language server builds.
 * The host does not parse LSP payloads - the framing and the protocol live
 * in the frame worker - but it already looks at the one payload it owns
 * with the same narrow structural check (`isInitializeRequest`), and the
 * program of a root is a question the host has to answer itself.
 *
 * @param {string} handshake the recorded handshake
 * @returns {string | null} the absolute path of the program, or null
 */
function rootUriOf(handshake) {
  if (typeof handshake !== 'string' || handshake === '') return null
  const match = /"rootUri"\s*:\s*"([^"]*)"/.exec(handshake)
  if (match === null) return null
  return fileUriToPath(match[1])
}

/**
 * The identity of the program one root would build (PRD-v5.1 §4.2, CONC-01).
 *
 * Two roots that share a `tsconfig.json` / `jsconfig.json`, or that are
 * connected through the `references` of a configuration, belong to the SAME
 * program: the language server would hold the same symbols twice, twice
 * the memory, and two programs may disagree about the types of the same
 * file. The host therefore starts ONE server for them.
 *
 * The decision is CONSERVATIVE: when the host is not sure, the roots are
 * merged. One missing index is better than two duplicate ones (PRD-v5.1
 * §8 risk 6).
 *
 * The key is built from three things, in this order:
 *
 *   1. the `rootUri` of the recorded handshake, when the host knows one -
 *      it is the authoritative statement of the program (L4);
 *   2. the workspace root above the project: a package manager workspace
 *      or a solution-style `tsconfig.json` puts its packages into one
 *      program;
 *   3. the configuration of the project itself, or the root when there is
 *      none.
 *
 * @param {string} root the absolute project root
 * @param {string} [handshake] the recorded handshake of the root
 * @returns {string} the key of the program
 */
export function programKeyOf(root, handshake = '') {
  const base = rootUriOf(handshake) ?? resolvePath(String(root))
  const config = nearestConfigOf(base)
  // The program root is the directory of the configuration when the
  // configuration lives above the root: a sub-directory of a project belongs
  // to the program of that project.
  const programRoot = config === null ? base : (dirname(config) === base ? base : dirname(config))
  const workspace = workspaceRootOf(programRoot, config)
  if (workspace !== null) return `workspace:${rootKey(workspace)}`
  if (config !== null) return `config:${rootKey(config)}`
  return `root:${rootKey(programRoot)}`
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
 * The hint of the worst case (PRD-v5.1 §3.3, MEM-07).
 *
 * The typical band says what happens when the server keeps the footprint it
 * has today. The worst band says what happens when it grows to the
 * permission it was given - and that number may be negative, which is
 * exactly what the user has to know before the machine starts to swap.
 *
 * @param {object} resources the memory snapshot
 * @returns {string} the hint, or an empty string when the worst case is fine
 */
function worstCaseHintOf(resources) {
  if (resources?.worstCase !== true) return ''
  return `; if it grew to its ceiling of ${resources.ceilingMB} MB, the machine would be left with ${toMb(resources.worstCaseBytes)} MB`
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
 * The standby cache of the machine (0 when the platform cannot report it).
 *
 * **The standby cache is AVAILABLE memory, and the default of 0 is the
 * correct value on Windows.** PRD-v5 §5.4 asked for it to be subtracted
 * ("the 652 MB of standby counted as available"), but that premise does not
 * hold: the standby list holds clean, file-backed pages, and the kernel drops
 * them FIRST under pressure - long before it pages anything out. Measured on
 * the machine of the round (2026-11-01):
 *
 *   - a Node process that allocated 1.5 GB drained 1.2 GB of the standby
 *     list while it ran, with no paging and no failure - the memory was
 *     handed over on demand;
 *   - `GlobalMemoryStatusEx().ullAvailPhys` (= `os.freemem()`) and the
 *     `Available Bytes` counter both count the standby, which is the
 *     operating system's own answer to "can this process get that much?".
 *
 * Subtracting it would make the gate refuse starts the machine can satisfy:
 * with 2,483 MB available and 1.2 GB of standby, the gate would see ~1.3 GB -
 * right at the soft threshold - and ask the user about a start that would
 * have worked.
 *
 * The hook stays for a deployment that wants the stricter accounting (a
 * machine whose file cache must not be touched, say): the probe is
 * injectable (`options.readMemory`) and a probe may report `standbyBytes`.
 * The alternative the specification named - `GetPerformanceInfo` - is **not**
 * usable here: it mixes the standby with the file-cache working set (2,403 MB
 * against 1,798 MB of standby on the same machine, so it over-subtracts by
 * ~600 MB of reclaimable cache) and it is not reachable from JavaScript
 * without a native helper.
 *
 * What actually keeps the machine out of swap is not one number but three:
 * MEM-05 charges every running language server only for what it can STILL
 * grow into, MEM-08 caps the sum of the ceilings of all running servers at
 * a share of the machine, and MEM-12 gives the memory back when the
 * machine asks for it.
 *
 * @returns {number} the standby cache in bytes
 */
function standbyCacheBytes() {
  return 0
}

/**
 * The default memory probe.
 *
 * The free memory of the machine. The probe is injectable
 * (`options.readMemory`), and an injected probe may report the standby cache
 * as well (`standbyBytes`) - the host subtracts it before it compares the
 * free memory with the estimate of a language server. The default probe
 * reports 0, which is the right number on Windows (see
 * {@link standbyCacheBytes}).
 * @returns {{ totalBytes: number, freeBytes: number, standbyBytes: number }}
 */
function defaultReadMemory() {
  return { totalBytes: totalmem(), freeBytes: freemem(), standbyBytes: standbyCacheBytes() }
}

/**
 * Whether the program of the project is still being built.
 *
 * The answer is "yes" while the language server is busy building the
 * program of the whole project - the work behind the first semantic request,
 * measured at more than ten minutes on a large project (PRD-v5 §0.2 #3). The
 * status bar has to say so: the session is already "ready" ten milliseconds
 * after the server answered the `initialize`, so without this fact the user
 * sees "ready" while the editor hangs and has no idea what it waits for.
 *
 * Two conditions, and both of them are needed:
 *
 *   - the server has not answered a *semantic* request yet (`realAnswers`),
 *     because the program is built as soon as it answers one - the requests
 *     after that are incremental and quick; and
 *   - a semantic request is outstanding, because a program is only built
 *     *for* a request. Without the second half the status bar would claim
 *     "building" for ever in a project where the user never asks anything
 *     semantic - and the server would be building nothing at all.
 *
 * @param {object | null | undefined} session the session
 * @returns {boolean} true while the program is being built
 */
function isBuildingProgram(session) {
  if (session === null || session === undefined) return false
  if (session.realAnswers > 0) return false
  for (const pending of session.pendingRequests.values()) {
    if (pending.semantic === true) return true
  }
  return false
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
    /**
     * The root the program of the project is built for.
     *
     * It is the project root itself most of the time, and the nearest
     * sub-project when the root is a workspace with several projects in it
     * (PRD-v5 §4.2). The user has to see it: the program is built for that
     * directory and not for the whole workspace.
     */
    scopeRoot: session?.scopeRoot ?? null,
    stderrLines: session === null ? [] : [...session.stderrLines],
    // The requests the server did not answer in time. The counter is the
    // host's own truth about the server; the client counts its own failures
    // separately.
    timeouts: session?.timeouts ?? 0,
    /**
     * The identity of the language server process (0 when there is none).
     *
     * It changes with every new process and stays the same while the process
     * lives. The client watches it to learn that the server behind the
     * WebSocket is a new one - the socket stays open when the server
     * crashes - and resets its request budget when it moves: the new server
     * has to build the program of the project again.
     */
    processId: session?.processId ?? 0,
    /**
     * Whether the program of the project is still being built.
     *
     * See {@link isBuildingProgram}: the server has not answered a semantic
     * request yet and a semantic request is outstanding.
     */
    buildingProgram: isBuildingProgram(session),
    /**
     * Whether the idle timer of the session is armed.
     *
     * The timer is the promise of the host that the memory of the language
     * server is given back when the project is not used any more. It is not
     * armed while the program is built (IDLE-04), and it is armed again
     * whenever the idle exit could not release the session (IDLE-05) - so
     * the answer is "yes" for every session that may still be released.
     */
    idleArmed: session?.idleTimer !== null && session?.idleTimer !== undefined,
    /**
     * Whether a language server runs for this root right now (CONC-05).
     */
    running: session !== null && session !== undefined && ['starting', 'building', 'ready', 'restarting'].includes(session.state),
    /**
     * The identity of the program of this root (CONC-01).
     */
    programKey: session?.programKey ?? null,
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
   * The root the editor of the user is in (PRD-v5.1 §4.4, CONC-03).
   *
   * The host cannot see the editor, so the client reports it (see
   * `setFocus`). Without a report the host treats every root as "not
   * focused": the order of the yield is still right, the focused root just
   * does not get the special treatment of the last position.
   * @type {string | null}
   */
  #focusRoot = null
  /**
   * The free memory of the machine at the last reading (bytes).
   *
   * The baseline of the measurement of MEM-06 is a number of the MANAGER
   * and not of a session: the free memory of the machine is ONE number, and
   * a difference of two readings of it is ONE difference. Two sessions that
   * kept a baseline each would count the same drop of the machine twice,
   * and the sum of the measurements would be twice the real footprint
   * (PRD-v5.1 §3.1).
   * @type {number | null}
   */
  #lastGlobalFreeBytes = null
  /**
   * The moment of the last measurement round (ms).
   *
   * The round belongs to the manager: two sessions whose watchdog ticks at
   * the same time must not run two rounds.
   * @type {number | null}
   */
  #lastMeasureAt = null
  /**
   * Whether the current memory pressure episode was already reported.
   *
   * The check of the pressure runs every second, and every session of the
   * machine runs it. A report that repeats every second is noise that hides
   * the one line that matters, so the episode is reported once - and the
   * flag is cleared when the machine is out of the pressure again.
   * @type {boolean}
   */
  #pressureReported = false
  /**
   * The sessions this manager owns.
   *
   * The memory gate counts the servers that are already running (MEM-02),
   * and a session that is gone must not be counted any more. The set is
   * per manager and not per process: the module-level `ROOTS` map is
   * shared by every manager of the process, and a reservation of one
   * manager must not be charged to another one.
   * @type {Set<object>}
   */
  #sessions = new Set()

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
      // The requests the server did not answer in time.
      timeouts: session?.timeouts ?? 0,
      /**
       * The identity of the language server process (0 when there is none).
       *
       * It changes with every new process and stays the same while the
       * process lives. The client watches it to learn that the server behind
       * the WebSocket is a new one - the socket stays open when the server
       * crashes - and resets its request budget when it moves.
       */
      processId: session?.processId ?? 0,
      /**
       * The root the program of the project is built for.
       *
       * The status bar shows it, because the program is built for that
       * directory and not for the whole workspace (PRD-v5 §4.2).
       */
      scopeRoot: session?.scopeRoot ?? null,
      /**
       * Whether the program of the project is still being built.
       *
       * The status bar shows it while the state is "ready": the session is
       * ready ten milliseconds after the server answered the `initialize`,
       * but the first semantic request still waits for the program of the
       * whole project (more than ten minutes on a large project).
       */
      buildingProgram: isBuildingProgram(session),
      /**
       * Whether the idle timer of the session is armed.
       *
       * The timer is the promise of the host that the memory of the language
       * server is given back when the project is not used any more.
       */
      idleArmed: session?.idleTimer !== null && session?.idleTimer !== undefined,
      /**
       * Whether a language server runs for this root right now.
       *
       * Together with the historical fact of the `indexedRoots` map this is
       * what the badge of the client needs: "indexed, running" and
       * "indexed, reclaimed" are two different states (CONC-05).
       */
      running: session !== null && session !== undefined && this.#isRunning(session),
      /**
       * The identity of the program of this root (CONC-01).
       *
       * Two roots with the same key share one language server.
       */
      programKey: session?.programKey ?? null,
      /**
       * The scope roots of the roots that run a language server right now.
       *
       * The badge of the client has to tell "indexed, running" from
       * "indexed, reclaimed" (CONC-05), and it has to tell it for EVERY
       * root - not only for the one the client is talking to. The host owns
       * the answer: it knows which sessions are running.
       *
       * The scope root is reported and not the root itself: the program of
       * a project is built for the scope root (PRD-v5 §4.2), and that is
       * the path the client knows.
       */
      liveRoots: this.#liveRoots(),
      // The memory of the machine and the estimate of the server travel with
      // the status: the client polls it every two seconds anyway, and a
      // running server already knows its language, so nothing has to be
      // read from disk to know the numbers. Without a server there is
      // nothing to estimate, and the client asks for it separately.
      resources: session === null
        ? null
        : this.#resourcesSnapshot(session.memoryLimitMB, session.languageId, lsp),
    }
  }

  /**
   * The scope roots of the roots that run a language server right now.
   *
   * The answer is process-wide and not per manager: the badge of the
   * client is about the whole IDE, and the roots of every manager belong
   * to the same process.
   *
   * A root counts as running when its session is in one of the live states
   * (`starting`, `building`, `ready`, `restarting`) - the same set the
   * client uses for the health of the host.
   *
   * @returns {string[]} the scope roots of the running servers
   */
  #liveRoots() {
    const roots = new Set()
    for (const entry of ROOTS.values()) {
      const session = entry.session
      if (session === null || session === undefined) continue
      if (!this.#isRunning(session)) continue
      roots.add(session.scopeRoot ?? entry.root)
    }
    return [...roots]
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
   *
   * `force` skips the TIGHT band of the memory pre-check: the user was
   * asked how tight the memory is and asked for the server anyway
   * (PRD §2.3). It does NOT skip the hard floor - a machine that cannot
   * run the server at all does not run it with `force` either (P2-3).
   * @param {{ root: string, languageId?: string, force?: boolean }} payload
   * @returns {Promise<{ state: string, detail: string | null, resources: object | null }>}
   */
  async start({ root, languageId, force } = {}) {
    const target = this.#requireRoot(root)
    const entry = this.#entry(target)
    const wanted = typeof languageId === 'string' && languageId !== '' ? languageId : null
    const session = await this.#ensureSession(entry, wanted, force === true)
    return { state: session.state, detail: session.detail ?? null, resources: session.resources ?? null }
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
   * The command of every language of the registry is resolved, no matter how
   * the switch of the settings stands: a language that is turned off is still
   * probed and still reported, because a language that is not listed cannot
   * be turned on again. The switch itself travels with the entry
   * (`enabled`), so the settings page can tell "not installed" and "turned
   * off" apart without a third list.
   * @returns {Promise<{ available: object[], missing: object[] }>}
   */
  async servers() {
    const settings = await this.#settings()
    const lsp = lspSection(settings)
    const available = []
    const missing = []
    for (const [languageId, registryEntry] of Object.entries(LSP_REGISTRY)) {
      const override = isPlainObject(lsp.servers[languageId]) ? lsp.servers[languageId] : {}
      const command = typeof override.command === 'string' && override.command !== ''
        ? override.command
        : registryEntry.command
      // The effective switch of the language: everything but an explicit
      // `false` leaves the language on.
      const enabled = override.enabled !== false
      const invalid = validateServerCommand(command)
      if (invalid !== null) {
        missing.push({ languageId, command, enabled, hint: invalid })
        continue
      }
      const resolution = this.#resolveServer(command)
      if (resolution === null) {
        missing.push({ languageId, command, enabled, hint: hintFor(registryEntry, command) })
        continue
      }
      const memoryLimitMB = Number.isFinite(override.memoryLimitMB)
        ? override.memoryLimitMB
        : registryEntry.memoryLimitMB
      const { baselineMB } = memoryEstimateOf(languageId, lsp)
      available.push({
        languageId,
        command,
        enabled,
        source: resolution.source,
        resolvedPath: resolution.path,
        memoryLimitMB,
        memoryBaselineMB: baselineMB,
        memoryLimitSupported: resolution.supportsMemoryLimit,
      })
    }
    return { available, missing }
  }

  /**
   * The memory situation of the machine.
   *
   * The estimate is the one of the language the root would be started with,
   * so the numbers the settings page shows are the numbers the start will
   * use (PRD §2.2). A running server knows its language; a root that was
   * never started is detected the same way the start path detects it.
   * @param {{ root?: string }} [payload]
   * @returns {Promise<object>} the memory snapshot
   */
  async resources({ root } = {}) {
    const settings = await this.#settings()
    const lsp = lspSection(settings)
    const entry = this.#resolveEntry(root)
    const session = entry?.session ?? null
    // A root that was never started has no session, but it still has a
    // language: the same detection the start path uses.
    const target = typeof root === 'string' && root.trim() !== ''
      ? resolvePath(root)
      : (entry?.root ?? null)
    const languageId = session?.languageId ?? (target === null ? null : detectLanguage(target))
    // The ceiling of the snapshot is the EFFECTIVE ceiling of the server
    // that would start: the tier of the project size, the ceiling of the
    // language and the global limit (MEM-11). A root that was never
    // started has no session, but it has a language and a size - the same
    // ones the start path would use.
    const memoryLimitMB = session?.memoryLimitMB
      ?? ceilingMBOf(languageId, target === null ? null : scopeRootOf(target, indexScopeOf(lsp)), lsp)
    return this.#resourcesSnapshot(memoryLimitMB, languageId, lsp)
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
   *
   * The map records a HISTORICAL fact ("this root completed a first
   * build"), and the badge of the client has to tell two states apart
   * (PRD-v5.1 §4.6, CONC-05):
   *
   *   - "indexed": the root was indexed and a language server is running
   *     for it right now;
   *   - "indexed, reclaimed": the root was indexed, and the server was
   *     released (the idle exit, the pressure yield, the shutdown).
   *
   * The host owns the answer - it knows which sessions are running - so
   * every entry carries the flag `running`.
   *
   * @returns {Promise<Record<string, { at: number, languageId: string, running: boolean }>>}
   */
  async indexedRoots() {
    const settings = await this.#settings()
    const map = { ...lspSection(settings).indexedRoots }
    for (const key of Object.keys(map)) {
      const entry = ROOTS.get(rootKey(key))
      const session = entry?.session ?? null
      const running = session !== null && session !== undefined && this.#isRunning(session)
      const value = isPlainObject(map[key]) ? map[key] : {}
      map[key] = { ...value, running }
    }
    return map
  }

  /**
   * Report the root the editor of the user is in (PRD-v5.1 §4.4, CONC-03).
   *
   * The yield order of the pressure valve needs to know which root the user
   * is working in: that one is released last of all, and a release would
   * interrupt the editor.
   *
   * The host does not need the report to work: without it the focused root
   * is simply not treated specially (and the client that is attached to a
   * root is treated as the focused one anyway).
   *
   * @param {string | null} root the absolute project root, or null to clear it
   * @returns {{ focusedRoot: string | null }} the root that is focused now
   */
  setFocus(root) {
    this.#focusRoot = typeof root === 'string' && root.trim() !== '' ? resolvePath(root) : null
    return { focusedRoot: this.#focusRoot }
  }

  /**
   * The root the editor of the user is in (CONC-03).
   * @returns {string | null} the absolute project root, or null when the
   *   client did not report one
   */
  focusedRoot() {
    return this.#focusRoot
  }

  /**
   * The identity of the program one root would build (PRD-v5.1 §4.2, CONC-01).
   *
   * Two roots with the same key belong to the same program, and the host
   * starts ONE language server for them.
   * @param {string} root the absolute project root
   * @returns {string} the key of the program
   */
  programKey(root) {
    const target = this.#requireRoot(root)
    const entry = this.#peek(target)
    return programKeyOf(target, entry?.handshake ?? '')
  }

  /**
   * The current snapshot of one root (the synchronous variant of `status`).
   * @param {string} root the absolute project root
   * @returns {object}
   */
  stateOf(root) {
    const entry = this.#peek(this.#requireRoot(root))
    return entry === null
      ? { root: resolvePath(String(root)), state: 'idle', languageId: null, command: null, source: null, detail: null, startedAt: null, cancellable: false, progress: 'idle', memoryLimitMB: null, scopeRoot: null, stderrLines: [], timeouts: 0, processId: 0, buildingProgram: false, idleArmed: false, running: false, programKey: null }
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
   *
   * A session that was released by the idle exit is the special case
   * (IDLE-02): the first payload that needs the server starts it again, so
   * the user does not have to rebuild the index by hand. The payload stays
   * in the queue and is replayed when the new process exists.
   *
   * The same is true when the wake was refused by the memory gate: the
   * payload stays in the queue, and a later payload tries again - after the
   * backoff. The user is never asked, and the server does not stay away
   * for the rest of the session.
   *
   * The handshake is recorded HERE, before the payload goes to the worker
   * (P1-1): the worker absorbs a second handshake - it answers it from its
   * cache - and it reports only the FIRST one to the host. A handshake that
   * arrives while the server runs would therefore never reach the host, and
   * the next server process would be initialized with the OLD `rootUri`:
   * the index scope would silently revert.
   *
   * A SERVER IS NOT THERE UNTIL THE PROCESS IS (B1): the worker of the
   * frame channel is created BEFORE the process is spawned, and a payload
   * that arrives in that window used to be handed to the worker - which
   * forwarded it to a stdin that did not exist yet. The payload was
   * dropped silently, the handshake among it, and the worker had already
   * marked it as "forwarded": the initialize that the host posts after the
   * spawn was absorbed as the second one, and the server never heard of it.
   * The client retried, the retry was absorbed as well, and the status bar
   * said "connecting" for 4 x 30 s + 3 x 2 s = 126 s.
   *
   * So the guard below asks for the PROCESS, not only for the worker. A
   * payload that arrives in the window waits in the queue of the root and
   * is replayed when the process exists - and the handshake is forwarded
   * to the server for the first time.
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
    // The process has to be there: the worker alone is not enough (B1).
    if (session === null || session.worker === null || session.handle === null) {
      this.#holdFor(entry, text)
      // The client is talking: the session counts as used, and the idle
      // timer has to be armed even while the process is still starting
      // (IDLE-05). Before the fix of B1 this was the path of the payload
      // that was handed to the worker and dropped there - and the session
      // was touched all the same.
      if (session !== null && session !== undefined && session.worker !== null) this.#touch(entry, session)
      // The server may have been released on purpose: the first payload
      // wakes it up again.
      this.#requestWake(entry, session, text)
      return false
    }
    // The newest handshake is the one the next server process is initialized
    // with. The host owns it: the worker cannot report it (see the note
    // above).
    if (isInitializeRequest(text)) entry.handshake = text
    session.worker.postMessage({ type: 'send', text, origin: 'client' })
    this.#touch(entry, session)
    return true
  }

  /**
   * Start the language server again after an idle release (IDLE-02).
   *
   * The wake happens at most once at a time: several payloads can arrive in
   * the same tick, and every one of them would start a server.
   *
   * Two states may be woken:
   *
   *   - `suspended`: the server was released on purpose, and the payload
   *     needs it again.
   *   - `degraded` with the cause `memory`: the memory gate refused the
   *     start. The machine may have more memory now, and the user is never
   *     asked - the server would simply stay away for the rest of the
   *     session. That was the defect: the wake worked exactly once.
   *
   * A degradation that the user has to act on (a missing server, a language
   * that is switched off, an exhausted crash budget) is NOT woken: a retry
   * would only repeat the same refusal.
   * @param {object} entry the root entry
   * @param {object | null} session the session that was released
   * @param {string} text the payload that arrived
   */
  #requestWake(entry, session, text) {
    if (session === null || session === undefined) return
    // Only a session that may be woken is woken at all.
    if (!this.#isWakeable(session)) return
    // The handshake is not a wake: it is replayed to every new process
    // anyway, and it says nothing about the work the user wants to do.
    if (isInitializeRequest(text)) return
    if (entry.wakePromise !== null && entry.wakePromise !== undefined) return
    // The backoff: a wake that failed must not turn every payload of the
    // next minute into a start attempt.
    if (!this.#mayRetryWake(entry)) return
    const running = this.#wakeSession(entry, session)
    entry.wakePromise = running
    this.#safely(running.finally(() => {
      if (entry.wakePromise === running) entry.wakePromise = null
    }), 'the wake')
  }

  /**
   * Whether one session may be woken by a payload.
   *
   * A released server is woken, and so is a server that the memory gate
   * refused: the memory of the machine changes, and the user is never asked
   * whether the server may start.
   * @param {object} session the session
   * @returns {boolean}
   */
  #isWakeable(session) {
    if (session.state === 'suspended') return true
    if (session.state !== 'degraded') return false
    return RETRYABLE_DEGRADE_CAUSES.has(session.degradeCause)
  }

  /**
   * Whether a new wake may be tried after a failed one.
   *
   * The moment of the last failed wake is remembered on the entry: a wake
   * that the memory gate refused is not repeated for every payload of the
   * next minute - the machine does not get more memory because the user
   * pressed F12 twice.
   * @param {object} entry the root entry
   * @returns {boolean}
   */
  #mayRetryWake(entry) {
    const last = entry.lastWakeFailureAt
    if (last === null || last === undefined) return true
    return this.#now() - last >= WAKE_BACKOFF_MS
  }

  /**
   * The wake itself: start the language server of a released session.
   *
   * The start goes through `#ensureSession`, so the memory pre-check of
   * `#startSession` runs: a machine that cannot afford the server right now
   * degrades instead of starting it, and the payload stays in the queue.
   * @param {object} entry the root entry
   * @param {object} session the session that was released
   * @returns {Promise<void>}
   */
  async #wakeSession(entry, session) {
    try {
      const settings = await this.#settings()
      const lsp = lspSection(settings)
      // The user put this project into the basic mode on purpose: the host
      // does not wake it. The marker of the client is the same one, but the
      // host is the authority here - it is the host that starts the server.
      if (this.#isConservative(lsp, entry)) return
      const started = await this.#ensureSession(entry, session.languageId)
      if (this.#isRunning(started)) {
        // The wake worked: the next idle release gets a fresh first wake.
        entry.lastWakeFailureAt = null
        return
      }
      // The wake failed: the payload stays in the queue, and a later payload
      // may try again - after the backoff.
      entry.lastWakeFailureAt = this.#now()
    } catch (error) {
      // A wake that fails must not take the host down: the session stays
      // released, and the next payload tries again.
      entry.lastWakeFailureAt = this.#now()
      this.#ctx?.logger?.warn?.('lsp: the language server could not be woken: %s', messageOf(error))
    }
  }

  /**
   * Whether one session runs a language server.
   * @param {object | null | undefined} session the session
   * @returns {boolean}
   */
  #isRunning(session) {
    if (session === null || session === undefined) return false
    return ['starting', 'building', 'ready', 'restarting'].includes(session.state)
  }

  /**
   * Whether the user put one project into the basic mode on purpose.
   *
   * The host and the client have to answer the SAME question with the SAME
   * rules, or the project behaves in two ways at once: the client says
   * "index this project", the host says "do not touch it" - and the
   * semantic features of the project are dead for ever, because the wake
   * after an idle exit or a pressure release is refused.
   *
   * The order is the one of the client (`workspace-scope.js` / the store):
   *
   *   1. the master switch: the feature is off;
   *   2. the workspace-scoped default of the user: 'conservative' is the
   *      basic mode, 'build' is the decision to index - and it outranks
   *      everything that follows;
   *   3. the global policy `indexOnOpen: 'never'`;
   *   4. the memory answer of the user (`memoryWarnedRoots`): it says "do
   *      not ask me again", and it is the marker of the documents that were
   *      written before the workspace-scoped default existed.
   *
   * The keys of the maps are absolute paths, and `rootKey` normalises them
   * (the separators and, on Windows, the case) - the same key space the
   * client writes.
   *
   * @param {object} lsp the `lsp` section of the settings
   * @param {object} entry the root entry
   * @returns {boolean}
   */
  #isConservative(lsp, entry) {
    const section = isPlainObject(lsp) ? lsp : {}
    // 1. The master switch: the feature is off.
    if (section.enabled === false) return true
    // 2. The workspace-scoped default of the user.
    const defaults = isPlainObject(section.workspaceDefaults) ? section.workspaceDefaults : {}
    for (const [key, value] of Object.entries(defaults)) {
      if (rootKey(key) !== entry.key) continue
      if (value === 'conservative') return true
      if (value === 'build') return false
    }
    // 3. The global policy.
    if (section.indexOnOpen === 'never') return true
    // 4. The memory answer of the older documents.
    const warned = isPlainObject(section.memoryWarnedRoots) ? section.memoryWarnedRoots : {}
    for (const [key, answer] of Object.entries(warned)) {
      if (answer !== 'conservative') continue
      if (rootKey(key) === entry.key) return true
    }
    return false
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
    //
    // The newest handshake also BECOMES the one that is replayed to the next
    // server process: the handshake carries the `rootUri`, and the `rootUri`
    // is what decides the program of the language server (the `cwd` of the
    // process does not). A client that asks for a different scope - because
    // the scope policy changed - sends a new handshake, and a server that is
    // started later has to be initialized with the scope the client is using
    // NOW. Without this the scope would silently revert to the old one on
    // the next restart.
    if (isInitializeRequest(text)) {
      if (entry.handshake === '') {
        entry.handshake = text
        return
      }
      entry.handshake = text
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
        /**
         * The wake that is currently running (IDLE-02).
         *
         * Several payloads can arrive in the same tick, and every one of
         * them would start a language server: the promise is the fence.
         */
        wakePromise: null,
        /**
         * The moment of the last wake that failed (ms).
         *
         * A wake that the memory gate refused must not turn every payload
         * of the next minute into a start attempt, so the moment is
         * remembered here and the next wake has to wait for the backoff.
         */
        lastWakeFailureAt: null,
        /**
         * Whether the root is in a degradation episode right now.
         *
         * The `degraded` control event belongs to the episode and not to
         * the transition: a wake that is refused degrades the root again,
         * and the state of the root does not change then. A second event
         * would be a second toast for one fault.
         */
        degradeEpisode: false,
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
   *
   * A restart (`restarting`) is a build as well: the server has to build
   * the program of the project again, and that takes just as long as the
   * first build. The cancel button belongs to it, too.
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
    const cancellable = (state === 'starting' || state === 'building' || state === 'restarting') && elapsed >= cancelAfterMs
    return {
      state,
      progress: PROGRESS[state] ?? state,
      startedAt: startedAt ?? undefined,
      cancellable,
    }
  }

  /**
   * The running session that already covers one program (CONC-01).
   *
   * The search is over the sessions of THIS manager: a session of another
   * manager belongs to another host.
   * @param {string} programKey the key of the program
   * @param {string | null} languageId the language of the server
   * @param {object | null} [exclude] a session that is not the owner (the
   *   session that is being started is in the set already)
   * @returns {object | null} the session that owns the program
   */
  #programOwnerOf(programKey, languageId, exclude = null) {
    if (typeof programKey !== 'string' || programKey === '') return null
    for (const session of this.#sessions) {
      if (session === exclude) continue
      if (session.programKey !== programKey) continue
      if (session.languageId !== languageId) continue
      if (!this.#isRunning(session)) continue
      return session
    }
    return null
  }

  /**
   * How many language servers of this manager are running.
   * @param {object | null} [exclude] a session that is not counted
   * @returns {number}
   */
  #runningSessionCount(exclude = null) {
    let count = 0
    for (const session of this.#sessions) {
      if (session === exclude) continue
      if (this.#isRunning(session)) count += 1
    }
    return count
  }

  /**
   * The memory that the running language servers of this process can STILL
   * grow into (PRD-v5.1 §3.1, MEM-05).
   *
   * THE RESERVATION IS NOT THE CEILING, IT IS THE HEADROOM.
   *
   *   `os.freemem()` has ALREADY subtracted the real footprint of the
   *   running servers - the machine does not give the same memory to the
   *   editor and to a language server. Charging the ceiling of every
   *   running server ON TOP of that counts every server TWICE: once as
   *   consumed and once as permission. That is the whole defect the user
   *   reported (2648 MB free, one index that really needs 621 MB, and the
   *   gate said "not enough resources").
   *
   * What a running server may still take from the machine is its headroom:
   *
   *   headroom_i = max(0, ceiling_i - measured_i)
   *
   * `measured_i` is the measured footprint of the server (MEM-06) and
   * `ceiling_i` the permission it was given (MEM-11). A server that uses
   * 606 MB of its 2048 MB ceiling endangers the next server with 1442 MB -
   * and with the old formula it endangered it with 2048 MB.
   *
   * The measured value is an UPPER bound of the real footprint (the method
   * cannot say whose memory the machine lost), so the headroom is a LOWER
   * bound of the real headroom: the account is a little too generous. The
   * pressure valve does NOT use this number - it uses the confirmed one
   * (`#safeReservedBytes`), which a difference that may belong to another
   * program cannot inflate (review R1).
   *
   * The reservation is given back on every path that ends a session:
   * `#terminateAndWait`, `#teardownSession` and `#onCrash`.
   * @returns {number} the reserved memory in bytes
   */
  #reservedBytes() {
    let total = 0
    for (const session of this.#sessions) {
      if (session.reservedBytes > 0) total += session.reservedBytes
    }
    return total
  }

  /**
   * The room the running language servers may still take, counted from the
   * footprint that was CONFIRMED (bytes).
   *
   * The account of `#reservedBytes` is built on the measured footprint, and
   * the periodic re-measurement books every difference of the machine on the
   * servers - including the part that belonged to another program (MEM-06).
   * The reservation is therefore too small, and the available memory of the
   * account is too big: the pressure valve would not fire while the machine
   * is really out of memory (review R1).
   *
   * THIS number is the room of the CONFIRMED footprint: the footprint that
   * was measured while the server was starting - the one window in which the
   * server itself was the main cause of the change. It is never inflated by
   * a difference that may belong to another program, so the margin it leaves
   * on the machine is the pessimistic one: the valve fires early, and never
   * late.
   *
   * It is never bigger than the room of the account (the confirmed footprint
   * is never bigger than the measured one), so the valve that watches it
   * also covers the trigger of the account.
   * @returns {number} the room in bytes
   */
  #safeReservedBytes() {
    let total = 0
    for (const session of this.#sessions) {
      // A session without a measurement holds no memory: it is on its way
      // out, and the machine has it back (or gets it back in a moment). Its
      // ceiling must not be charged here - a server that is already dying
      // may not take a server that is still alive with it (review R4, N2).
      //
      // The criterion is the MEASUREMENT and not the reservation: the
      // reservation is the number of the account, and the account can say
      // "this server has taken its whole ceiling" while the server is
      // running perfectly well and may still take 1448 MB more. A session
      // that is skipped like that would not be charged at all - and the
      // margin would degenerate into the bare free memory of the machine
      // (review R5, M1).
      if (session.measuredBytes === 0) continue
      const room = Math.max(0, session.ceilingBytes - session.confirmedBytes)
      total += room
    }
    return total
  }

  /**
   * The measured footprint of the running language servers (MEM-06).
   *
   * The sum of the measurements of the running sessions, in bytes. The
   * client shows it, and it is the number that makes the reservation
   * understandable: "the machine has 2648 MB free, 606 MB of it is the
   * index that is already running, and 1442 MB of it is what that index
   * may still grow into".
   *
   * It is an UPPER BOUND of the real footprint, not the footprint itself:
   * the method measures the drop of the free memory of the machine, and a
   * drop that fits inside the room of the servers may belong to another
   * program. The difference that does NOT fit is never counted, so the
   * bound is one-sided: the measured value is too big, the reservation is
   * too small, and the account is too generous. The pressure valve does not
   * use this number - it uses the confirmed footprint of the spawn window
   * (`#safeReservedBytes`), which no difference of a later round can
   * inflate (review R1).
   * @returns {number} the measured memory in bytes
   */
  #measuredBytes() {
    let total = 0
    for (const session of this.#sessions) {
      if (session.measuredBytes > 0) total += session.measuredBytes
    }
    return total
  }

  /**
   * The sum of the ceilings of the running language servers (MEM-08).
   *
   * This is the number the machine-level budget is about: the per-server
   * gate answers "may the NEXT server start", and only the sum answers
   * "may these servers grow to their ceilings AT THE SAME TIME".
   * @returns {number} the ceilings in bytes
   */
  #ceilingBytes() {
    let total = 0
    for (const session of this.#sessions) {
      if (session.ceilingBytes > 0) total += session.ceilingBytes
    }
    return total
  }

  /**
   * The machine-level budget of the language servers (PRD-v5.1 §3.4, MEM-08).
   *
   * `min(totalBytes * budgetRatio, budgetCapMB)`: a quarter of the machine
   * is the default share, and the absolute cap keeps a big machine from
   * handing out a budget that no project ever needs.
   * @param {object} lsp the `lsp` section of the settings
   * @param {number} totalBytes the total memory of the machine
   * @returns {number} the budget in bytes
   */
  #budgetBytesOf(lsp, totalBytes) {
    const section = isPlainObject(lsp) ? lsp : DEFAULT_LSP_SETTINGS
    const ratio = Number.isFinite(section.budgetRatio) && section.budgetRatio > 0
      ? section.budgetRatio
      : DEFAULT_LSP_SETTINGS.budgetRatio
    const capMB = Number.isFinite(section.budgetCapMB) && section.budgetCapMB > 0
      ? section.budgetCapMB
      : DEFAULT_LSP_SETTINGS.budgetCapMB
    const total = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0
    return Math.min(total * ratio, capMB * 1024 * 1024)
  }

  /**
   * Give the memory of one session back to the machine.
   *
   * The reservation has to go away on every path that ends a session, or
   * the gate refuses the next server because of a server that does not
   * exist any more.
   * @param {object | null} session the session
   */
  #releaseReservation(session) {
    if (session === null || session === undefined) return
    session.reservedBytes = 0
    // The measurement belongs to the process: it is meaningless without it.
    session.measuredBytes = 0
    // The confirmed footprint belongs to the process as well.
    session.confirmedBytes = 0
  }

  /**
   * The memory situation of one language server (PRD §2.2, §2.3, PRD-v5.1
   * §3.3/MEM-07/MEM-08).
   *
   * The decision is graded: the available memory is compared with the
   * estimate of the language instead of one global number, so a YAML
   * project does not need the gigabytes a TypeScript project needs. The
   * three bands are
   *
   *   available >= soft_j   enough   - the server starts
   *   available >= floor    tight    - the user decides; the host refuses to
   *                                    start the server without `force`
   *   otherwise             too low  - the server degrades
   *
   * The available memory is the free memory of the machine MINUS the
   * standby cache (MEM-03: on Windows `os.freemem()` counts the standby
   * cache as available, and 652 MB of standby are exactly one medium index)
   * MINUS the headroom of the servers that are already running (MEM-05:
   * the gate has to know what it already started - and it has to charge it
   * for what it may still grow into, not for its whole ceiling).
   *
   * TWO BANDS, ONE DECISION (MEM-07):
   *
   *   the typical band compares the available memory with the estimate of
   *   the language (`needMB`) - that is what happens when the server keeps
   *   the footprint it has today;
   *
   *   the worst band compares the available memory MINUS THE CEILING of the
   *   new server with the hard floor - that is what happens when it grows
   *   to the permission it was given. The worst band is REPORTED, never
   *   enforced: with a 2 GB ceiling almost every machine would hit it, and
   *   a hard reject on the worst case would seal the gate shut for good.
   *   What keeps the machine out of the swap is the machine-level budget
   *   (MEM-08) and the pressure valve (MEM-12).
   *
   * The free-memory threshold of the settings is only the conservative
   * fallback: it speaks when no estimate of the language is known, and it
   * never blocks a language that has one (PRD §4.4).
   * @param {number} memoryLimitMB the effective ceiling of the language server
   * @param {string | null} languageId the language the estimate is based on
   * @param {object} lsp the `lsp` section of the settings
   * @returns {object} the memory snapshot
   */
  #resourcesSnapshot(memoryLimitMB, languageId, lsp) {
    const memory = this.#readMemory()
    const section = isPlainObject(lsp) ? lsp : DEFAULT_LSP_SETTINGS
    const headroom = Number.isFinite(section.memoryHeadroom) && section.memoryHeadroom > 0
      ? section.memoryHeadroom
      : MEMORY_HEADROOM
    const hardFloorMB = Number.isFinite(section.memoryHardFloorMB) && section.memoryHardFloorMB >= 0
      ? section.memoryHardFloorMB
      : MEMORY_HARD_FLOOR_MB
    const { baselineMB, estimated } = memoryEstimateOf(languageId, section)
    const limit = Number.isFinite(memoryLimitMB) && memoryLimitMB > 0 ? memoryLimitMB : 0
    // The estimate never asks for more than the ceiling allows: a server that
    // may only use 512 MB cannot need 768 MB of free memory.
    const needMB = Math.min(baselineMB, limit) * headroom
    const fallbackMB = Number.isFinite(section.freeMemoryThresholdMB) && section.freeMemoryThresholdMB >= 0
      ? section.freeMemoryThresholdMB
      : DEFAULT_LSP_SETTINGS.freeMemoryThresholdMB
    const floorMB = estimated ? needMB : Math.max(needMB, fallbackMB)
    const thresholdBytes = Math.max(hardFloorMB, floorMB) * 1024 * 1024
    const softThresholdBytes = needMB * MEMORY_SOFT_FACTOR * 1024 * 1024
    const hardFloorBytes = hardFloorMB * 1024 * 1024
    // The standby cache is memory the machine has already given to the file
    // cache: it may be dropped at any moment, so it is not memory a
    // language server may use.
    const standbyBytes = Number.isFinite(memory.standbyBytes) && memory.standbyBytes > 0
      ? memory.standbyBytes
      : 0
    const freeBytes = Math.max(0, memory.freeBytes - standbyBytes)
    // The servers that are already running hold their memory: it is not
    // free for the next one. Only their HEADROOM is charged (MEM-05).
    const reservedBytes = this.#reservedBytes()
    const measuredBytes = this.#measuredBytes()
    const ceilingBytes = this.#ceilingBytes()
    const availableBytes = Math.max(0, freeBytes - reservedBytes)
    // The margin the machine really has, counted from the CONFIRMED
    // footprint of the servers (the spawn window) and not from the measured
    // one: the difference of a later round may belong to another program,
    // and the account must not become more optimistic because of it (review
    // R1). The number is never bigger than the available memory of the
    // account - it is the pessimistic view of the same machine.
    const safeAvailableBytes = Math.max(0, freeBytes - this.#safeReservedBytes())
    // The worst band: the machine, if the new server grows to its ceiling.
    // The number may be negative - that is the point of it.
    const worstCaseBytes = availableBytes - limit * 1024 * 1024
    const worstCase = worstCaseBytes < hardFloorBytes
    // The machine-level budget of the language servers (MEM-08).
    const budgetBytes = this.#budgetBytesOf(section, memory.totalBytes)
    // The authoritative answer of the host: what may happen with this
    // snapshot. The client renders it instead of judging the numbers again -
    // two sides that judge the same snapshot differently give the user two
    // different answers.
    //
    // ONE AUTHORITY: the decision is the TYPICAL band and nothing else, and
    // the flag `tight` is the decision itself. The host gate and the client
    // read the same two fields, and they can never contradict each other.
    //
    // The worst band is INFORMATIONAL: it says what the machine would have
    // left if the new server grew to the permission it was given. With a
    // 2 GB ceiling almost every machine hits it, and enforcing it would ask
    // the user about a hypothetical that nobody can act on. What keeps the
    // machine out of the swap is the machine-level budget (MEM-08) and the
    // pressure valve (MEM-12) - not this hint (PRD-v5.1 §3.3).
    const decision = availableBytes < hardFloorBytes
      ? 'low'
      : (availableBytes < softThresholdBytes ? 'tight' : 'ok')
    return {
      totalBytes: memory.totalBytes,
      freeBytes,
      standbyBytes,
      reservedBytes,
      // The real footprint of the running servers, and the part of it that
      // is still free to grow (MEM-05/MEM-06).
      measuredBytes,
      measuredMB: toMb(measuredBytes),
      availableBytes,
      /**
       * The margin of the machine, counted from the confirmed footprint of
       * the running servers. It is the number the pressure valve uses
       * (MEM-12): the account may be too generous, and a valve that watches
       * an optimistic number is a valve that does not fire.
       */
      safeAvailableBytes,
      safeAvailableMB: toMb(safeAvailableBytes),
      thresholdBytes,
      memoryLimitMB: limit,
      /** The effective ceiling of the language server (MEM-11). */
      ceilingMB: limit,
      canIndex: availableBytes >= thresholdBytes,
      needMB,
      baselineMB,
      headroom,
      hardFloorMB,
      // "Tight" is the decision itself: the host gate and the client read
      // the same field, so they can never give the user two different
      // answers about the same snapshot. The worst band is reported
      // separately and is not part of it.
      tight: decision === 'tight',
      belowHardFloor: availableBytes < hardFloorBytes,
      // 'ok' = the server may start, 'tight' = the user has to decide,
      // 'low' = the machine cannot afford it.
      decision,
      languageId: typeof languageId === 'string' ? languageId : null,
      softThresholdBytes,
      /** Whether the machine would run out of memory in the worst case. */
      worstCase,
      /** What the machine would have left in the worst case (bytes). */
      worstCaseBytes,
      /** The machine-level budget of the language servers (bytes). */
      budgetBytes,
      /** The share of the budget the running servers hold (bytes). */
      budgetUsedBytes: ceilingBytes,
    }
  }

  /**
   * The refusal of the machine-level budget (PRD-v5.1 §3.4, MEM-08).
   *
   * The budget answers "may these servers grow to their ceilings AT THE
   * SAME TIME", and that is the question that ends in the swap.
   *
   * The budget is NOT skipped by `force`: the user answered the question
   * "may this server start although the memory is tight", and the budget
   * is not a question about the memory of THIS server (PRD-v5.1 §4.2).
   * Releasing another server frees the budget again.
   *
   * @param {object} resources the memory snapshot
   * @param {number} memoryLimitMB the ceiling of the server that would start
   * @returns {string | null} the message, or null when the budget has room
   */
  #budgetRefusal(resources, memoryLimitMB) {
    const ceilingBytes = Math.max(0, memoryLimitMB) * 1024 * 1024
    if (resources.budgetUsedBytes + ceilingBytes <= resources.budgetBytes) return null
    return `the memory budget of the language servers is used up (${toMb(resources.budgetUsedBytes)} MB of ${toMb(resources.budgetBytes)} MB are held by the running servers, and this one would need ${memoryLimitMB} MB). Release a language server, or raise the budget in the settings.`
  }

  /**
   * Make sure one root has a running language server.
   * @param {object} entry the root entry
   * @param {string | null} languageId the wanted language, or null to detect it
   * @param {boolean} [force] true skips the memory pre-check
   * @returns {Promise<object>} the session
   */
  async #ensureSession(entry, languageId, force = false) {
    const session = entry.session
    if (session !== null && ['starting', 'building', 'ready', 'restarting'].includes(session.state)) {
      return session
    }
    // A root whose program is covered by another running server does not get
    // a server of its own (CONC-01) - but it does as soon as that server is
    // gone, so the decision is re-checked and not remembered for ever.
    if (session !== null && session.duplicateOf !== null) {
      const owner = this.#programOwnerOf(session.programKey, session.languageId, session)
      if (owner !== null) return session
    }
    return this.#startSession(entry, languageId, force)
  }

  /**
   * Start a language server for one root.
   * @param {object} entry the root entry
   * @param {string | null} languageId the wanted language, or null to detect it
   * @param {boolean} [force] true skips the memory pre-check
   * @returns {Promise<object>} the session
   */
  async #startSession(entry, languageId, force = false) {
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
    // The scope of the program (PRD-v5 §4.2): a workspace root with several
    // projects in it must not be indexed as one program. The scope root is
    // the directory the server is started in and the directory the program
    // is built for.
    const scopeRoot = scopeRootOf(entry.root, indexScopeOf(lsp))
    const language = languageId ?? detectLanguage(scopeRoot)
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
    // The effective ceiling of the language server (PRD-v5.1 §3.7, MEM-11).
    //
    // Three values play here, and the order matters: the per-language
    // override of the settings wins over everything (it is the escape hatch
    // that keeps a big project working), the tier of the project size comes
    // next, and the global limit of the settings is a CAP over every
    // language server - it is not a flat value any more (PRD-v5.1 §5).
    //
    // Without the global limit in this chain the setting was a dead
    // control: the value the user saw in the settings page never reached
    // the server, and the only ceiling in effect was the built-in one.
    const memoryLimitMB = ceilingMBOf(language, scopeRoot, lsp)
    // A language that is switched off in the settings is never started.
    const turnedOff = override.enabled === false
    // The identity of the program this root would build (PRD-v5.1 §4.2,
    // CONC-01). Two roots of one program must not get two language
    // servers: the symbols would be held twice, the memory would be spent
    // twice, and two programs may disagree about the types of one file.
    const programKey = programKeyOf(entry.root, entry.handshake)

    const session = {
      entry,
      languageId: language,
      command,
      args,
      memoryLimitMB,
      lsp,
      /**
       * The root the program of the project is built for (PRD-v5 §4.2).
       *
       * It is the project root itself most of the time, and the nearest
       * sub-project when the root is a workspace with several projects in
       * it: the language server would otherwise merge them into one
       * program (measured: 2,335 files / 84 MB).
       */
      scopeRoot,
      /**
       * The identity of the program of this root (CONC-01).
       *
       * Two roots with the same key belong to the same program, and the
       * host starts ONE language server for them.
       */
      programKey,
      /**
       * The root whose running language server already covers this program.
       *
       * It is null while this session has a server of its own.
       * @type {string | null}
       */
      duplicateOf: null,
      /**
       * The ceiling of this session on the machine (bytes).
       *
       * The ceiling is a permission, not a footprint - it is what the
       * server MAY take. The machine-level budget is about the sum of
       * these (MEM-08).
       */
      ceilingBytes: 0,
      /**
       * The memory this session has reserved on the machine (bytes).
       *
       * The gate subtracts the reservations of the running sessions from
       * the free memory before it decides (MEM-05). The reservation is the
       * HEADROOM of the session - what it may still grow into - and it is
       * given when the process starts and given back when it goes away.
       */
      reservedBytes: 0,
      /**
       * The measured footprint of the language server (bytes).
       *
       * It is measured as the difference of two readings of the free memory
       * (MEM-06) and it is what makes the reservation a headroom instead
       * of the whole ceiling.
       */
      measuredBytes: 0,
      /**
       * The footprint that was measured while the server was STARTING
       * (bytes).
       *
       * The spawn window is the only window in which the language server
       * itself is the main cause of the change of the free memory: it lasts
       * seconds, and the server allocates in it. The periodic
       * re-measurement cannot say that - its window is a minute long, and
       * every program of the machine may have grown in it (review R1).
       *
       * The pressure valve books THIS number and not the measured one: the
       * valve must not become more optimistic because a difference that may
       * belong to another program was booked on the servers.
       */
      confirmedBytes: 0,
      /**
       * The moment of the last check of the memory pressure (ms).
       *
       * The check runs at its own interval, not on every tick of the
       * watchdog.
       */
      lastPressureAt: null,
      /**
       * The user asked for the server although the memory was tight.
       *
       * The decision belongs to the user, so it survives a restart: the
       * server that was forced once is not stopped by the TIGHT band of the
       * memory check of the next crash. The hard floor is never skipped -
       * not even for a forced session (P2-3).
       */
      force: force === true,
      /**
       * The memory snapshot of the last pre-check.
       *
       * The client reads it to tell "not enough memory" from "the memory is
       * tight", and the two need different answers from the user.
       */
      resources: null,
      resolution: null,
      source: null,
      resolvedPath: null,
      supportsMemoryLimit: false,
      state: 'idle',
      detail: null,
      /**
       * Why the session was degraded (null while it is not degraded).
       *
       * The cause decides whether a later payload may wake the session
       * again (IDLE-02): the memory of the machine changes, but a server
       * that is not installed does not. Without it the wake would work
       * exactly once - the first refusal would end the semantic features
       * of the project for the rest of the session.
       * @type {string | null}
       */
      degradeCause: null,
      startedAt: null,
      handle: null,
      worker: null,
      stderrLines: [],
      restarts: 0,
      timeouts: 0,
      /**
       * The requests the client sent and the server has not answered yet.
       *
       * The key is the JSON-RPC id, the value the moment the request went
       * out, whether it was the handshake and whether it was a *semantic*
       * request. Only the worker knows which payload is a request and which
       * is a notification, so it reports both (`request` and `answered`) -
       * and it also reports whether the request was the `initialize`, because
       * the watchdog treats the two differently (see `realAnswers`).
       *
       * The semantic flag is what makes the host and the client agree: the
       * client counts only the answers to the semantic requests, and the host
       * may not shorten the request budget because of an answer the client
       * does not count (see `semantic-methods.js`).
       *
       * The watchdog counts the entries that ran into their deadline. A
       * notification is not in this map - a language server never answers
       * one - so a server that is busy building its program is not killed for
       * staying silent.
       * @type {Map<number|string, { at: number, handshake: boolean, semantic: boolean }>}
       */
      pendingRequests: new Map(),
      /**
       * The answers of the server to the *semantic* requests.
       *
       * The `initialize` is answered in milliseconds, while the first
       * *semantic* request waits for the program build of the project - more
       * than ten minutes on a large project (PRD-v5 §0.2 #3). The watchdog
       * is therefore patient until the server has answered one semantic
       * request; from then on the configured timeout applies.
       *
       * Only the semantic answers are counted: the answer to the handshake
       * says nothing about the speed of the server, and the answer to a
       * request that is not semantic (a command of the workspace, say) does
       * not either - the client does not count those either.
       */
      realAnswers: 0,
      exited: false,
      intentionalExit: false,
      /**
       * Whether the session is being released right now.
       *
       * The idle timer and the pressure valve may fire at the same time,
       * and a session that is released twice would try to leave the state
       * `suspended` twice.
       */
      releasing: false,
      /**
       * The cancel that is currently running, if any.
       *
       * A second cancel waits for it instead of starting a second one: the
       * operation is atomic and the process is killed exactly once
       * (PRD §2.4).
       */
      cancelPromise: null,
      lastActivityAt: this.#now(),
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
      /**
       * The generation whose death was already reported (CRASH-01).
       *
       * One death arrives twice - the stdout of the dead process ends and
       * the promise of the process resolves - and the second signal must
       * not degrade the session: the restart budget is one, and the
       * duplicate signal spent it before the restart even began.
       */
      crashedGeneration: -1,
      /**
       * The identity of the language server process of this session.
       *
       * The number changes with EVERY new process (the first one is 1, the
       * first restart 2, ...) and stays the same while the process lives.
       *
       * The client cannot see the process itself: the WebSocket between the
       * browser and the host stays open when the language server crashes
       * (only the server process is replaced), so the client never learns
       * that the server behind the socket is a new one. It has to see the
       * fact somewhere, and this is the fact: the client watches the number
       * and resets its request budget when it moves - the new server has to
       * build the program of the project again, so the first semantic
       * request needs the long budget again.
       *
       * The counter is carried over from the session this one replaces: the
       * identity of a project must never go backwards (a session that is
       * replaced after an idle exit would otherwise start again at 1, and
       * the client - which compares the numbers - would not see the new
       * process at all).
       */
      processId: previous?.processId ?? 0,
    }
    entry.session = session
    this.#sessions.add(session)
    // The clock of the cancel window starts NOW, before the transition into
    // "starting" (PRD-v5 §2.4): the client shows how long the build has
    // been running, and the time the process needed to start belongs to
    // that window.
    session.startedAt = this.#now()
    session.lastActivityAt = this.#now()
    this.#transition(session, 'starting', 'starting the language server')

    // A language that is switched off in the settings is never started. The
    // check comes before the memory pre-check: a server that may not run
    // does not need any memory.
    if (turnedOff) {
      this.#degrade(session, DEGRADE_CAUSES.turnedOff, `the ${language} language server is turned off in the settings. Turn it on again to use the semantic features of this language.`)
      return session
    }

    // ONE PROGRAM, ONE SERVER (PRD-v5.1 §4.2, CONC-01).
    //
    // Two roots of one program - the packages of a pnpm workspace, the
    // projects of a solution-style `tsconfig.json` - would be indexed
    // twice: twice the memory, twice the symbols, and two programs that
    // may disagree about the types of the same file. The host starts one
    // server and says which root it belongs to.
    //
    // The decision is conservative: when the host is not sure, the roots
    // are merged. One missing index is better than two duplicate ones.
    const owner = this.#programOwnerOf(programKey, language, session)
    if (owner !== null) {
      session.duplicateOf = owner.entry.root
      this.#transition(session, 'idle', `this project belongs to the same program as "${owner.entry.root}", which is already indexed - one language server covers both, so no second one was started`)
      return session
    }

    // The memory pre-check runs before every start, not only when the
    // settings are validated (PRD §2.2).
    //
    // `force` means "the user said start anyway although the memory is
    // tight" - it skips the TIGHT band and only the tight band. The hard
    // floor means "this machine cannot run the server at all", and it is
    // never skipped: least of all by the 【重新建立索引】 button, which
    // passes `force` without asking anything (P2-3).
    const resources = this.#resourcesSnapshot(memoryLimitMB, language, lsp)
    session.resources = resources
    // Three bands (PRD §2.3): enough memory starts the server, a tight
    // budget is the user's decision, and a machine that is out of memory
    // cannot run a server at all.
    //
    // The refusals of the memory have the cause `memory`: the situation of
    // the machine changes, and a later payload may try again (IDLE-02).
    // The refusal of the budget has its own cause - the budget frees up
    // as soon as a server is released, and that is worth a retry too.
    //
    // The numbers in the messages are the AVAILABLE memory - the number
    // the gate really decided with (MEM-09). The free memory of the
    // machine ignores the servers that are already running, and a user
    // that is told "2648 MB available" while the gate says "600 MB" gets
    // two opposite answers to one question.
    if (resources.belowHardFloor) {
      this.#degrade(session, DEGRADE_CAUSES.memory, `not enough free memory to start the language server (needs ${toMb(resources.thresholdBytes)} MB, ${toMb(resources.availableBytes)} MB available${worstCaseHintOf(resources)}). Close other programs, lower the memory limit in the settings, or use the conservative mode.`)
      return session
    }
    // The machine-level budget of the language servers (PRD-v5.1 §3.4,
    // MEM-08).
    //
    // The per-server gate answers "may the NEXT server start"; the budget
    // answers "may these servers grow to their ceilings AT THE SAME TIME",
    // and that is the question that ends in the swap.
    //
    // The budget is checked BEFORE the tight band: asking the user "shall
    // I start it anyway?" and then refusing the start anyway would be the
    // worst of both answers.
    const refusal = this.#budgetRefusal(resources, memoryLimitMB)
    if (refusal !== null) {
      this.#degrade(session, DEGRADE_CAUSES.budget, refusal)
      return session
    }
    // The own limit of the user: how many indexes may run at the same time.
    // The stricter of the two wins - the budget and this one.
    const maxConcurrent = Number.isFinite(lsp.maxConcurrentIndexes) ? lsp.maxConcurrentIndexes : 0
    if (maxConcurrent > 0 && this.#runningSessionCount(session) >= maxConcurrent) {
      this.#degrade(session, DEGRADE_CAUSES.budget, `the limit of ${maxConcurrent} concurrent indexes is reached (the setting "maxConcurrentIndexes"). Release a language server, or raise the limit in the settings.`)
      return session
    }
    if (resources.tight && !session.force) {
      this.#degrade(session, DEGRADE_CAUSES.memory, `the available memory is tight for the ${language} language server (${toMb(resources.availableBytes)} MB available, ${resources.needMB} MB expected, ${toMb(resources.softThresholdBytes)} MB recommended${worstCaseHintOf(resources)}). Start it anyway to continue, or use the conservative mode.`)
      return session
    }

    const resolution = this.#resolveServer(command)
    if (resolution === null) {
      // The server is not installed: no retry helps. The user has to install
      // it (or to point the settings at another executable).
      this.#degrade(session, DEGRADE_CAUSES.notInstalled, `the ${language} language server ("${command}") is not installed. ${hintFor(registryEntry, command)}`)
      return session
    }
    session.resolution = resolution
    session.source = resolution.source
    session.resolvedPath = resolution.path
    session.supportsMemoryLimit = resolution.supportsMemoryLimit

    // The documents the new server does not know yet. The payloads that are
    // replayed below are told to the new server as well, so they must not
    // be opened twice - a second `didOpen` for the same URI breaks the
    // protocol (the client does not re-open the documents itself).
    const announced = new Set(entry.documents.keys())
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
    // The documents of the project are announced to the new server. This is
    // what the wake needs (IDLE-02): the host kept its document table over
    // the idle exit, and the fresh server knows nothing about them.
    this.#reopenDocuments(entry, session, announced)
    this.#transition(session, 'building', 'building the program')
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
    // The frame worker of the previous generation is stopped as well. An old
    // worker keeps running (a thread that nothing waits for any more) and it
    // keeps posting frames: those frames were written into the stdin of the
    // NEW server - a protocol violation (the new server received a
    // `didChange` of the old generation) and, if the old process was already
    // gone, a write into a broken pipe.
    this.#stopWorker(session)
    if (previous !== null && previous !== undefined) {
      session.intentionalExit = true
      // The handle is cleared before the process is terminated: a frame that
      // is still on its way must not be written into the pipe of a process
      // that is about to die.
      session.handle = null
      try { previous.terminate() } catch { /* it is already gone */ }
    }
    const worker = this.#createWorker({
      memoryLimitMB: session.memoryLimitMB,
      injectMemoryLimit: session.supportsMemoryLimit,
    })
    session.worker = worker
    worker.on?.('message', (message) => {
      // The fence of the stdout path: a worker of an older generation must
      // not feed the session that took its place. Without it the frames of
      // the old worker were written into the stdin of the new server.
      if (session.generation !== generation) return
      this.#onWorkerMessage(entry, session, message)
    })
    worker.on?.('error', (error) => {
      // The same fence: the death of an old worker may not be reported into
      // the session that replaced it.
      if (session.generation !== generation) return
      this.#safely(this.#onCrash(entry, session, `the frame worker failed: ${messageOf(error)}`), 'the crash handler')
    })
    worker.on?.('messageerror', (error) => {
      // A message of the port that could not be deserialized. The port emits
      // 'messageerror' for it, and without a listener the error is an
      // *uncaught exception* - which ends the whole DSH host process.
      try {
        this.#ctx?.logger?.warn?.('lsp: the frame worker could not read a message: %s', messageOf(error))
      } catch { /* a broken logger may not take the host down */ }
    })

    const argv = resolution.scriptPath !== null && resolution.scriptPath !== undefined
      ? [process.execPath, resolution.scriptPath, ...session.args]
      : [resolution.path, ...session.args]
    const spec = {
      argv,
      // The program is built for the scope root, not for the whole
      // workspace (PRD-v5 §4.2): the server has to see the project it
      // indexes and nothing else.
      cwd: session.scopeRoot ?? entry.root,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: this.#graceMs,
    }
    let handle
    // The free memory right BEFORE the process starts (MEM-06).
    //
    // The footprint of the language server is measured as the difference of
    // two readings of the free memory: `os.freemem()` has already counted
    // the memory that the running servers hold, and the difference between
    // the two readings is what the new server took.
    //
    // There is NO process-level API here on purpose: Windows has no way to
    // read the RSS of another process from Node, and `Get-Process` would
    // cost a PowerShell child process per server per round (measured: 50-150
    // ms) - and tsserver is a GRANDchild process, so the tree would have to
    // be rebuilt every time.
    const freeBefore = this.#freeBytes()
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
    // The session is counted by the memory gate again.
    //
    // A session that crashed was torn down (it left the set of the
    // sessions of the manager), and the restart reuses the very same
    // session object: without this line the running server would hold
    // memory that the gate does not see - and the budget of the machine
    // (MEM-08) would not know about it either.
    this.#sessions.add(session)
    // The ceiling of the server on this machine (MEM-08): what it MAY take.
    session.ceilingBytes = Number.isFinite(session.memoryLimitMB) && session.memoryLimitMB > 0
      ? session.memoryLimitMB * 1024 * 1024
      : 0
    // The footprint of the server, measured right after the process exists
    // (MEM-06).
    const freeAfter = this.#freeBytes()
    this.#measureFootprint(session, freeBefore, freeAfter)
    // The server is running: it holds memory from now on, and the gate has
    // to know it (MEM-05). The reservation is its HEADROOM - what it may
    // still grow into - and not its whole ceiling: the free memory of the
    // machine has already subtracted the memory the server holds.
    session.reservedBytes = Math.max(0, session.ceilingBytes - session.measuredBytes)
    // The measurement is repeated while the session lives: the program of
    // the project is not built yet, so the server grows afterwards. The
    // watchdog of the session carries it (see `#tick`), and the round
    // itself belongs to the manager.
    // The new process starts at zero. The requests of the old one will
    // never be answered, and the program of the project is built again -
    // so the first semantic request after a restart is a long one too.
    session.realAnswers = 0
    session.pendingRequests.clear()
    // The timeout counter belongs to the process that died: its unanswered
    // requests are gone with it, and the new process has to earn its own
    // count. Without this reset the counter of the crashed process is
    // inherited, and the FIRST timeout after the restart already reaches
    // the limit - the new server is killed for the mistakes of the old one.
    session.timeouts = 0
    // Every new process gets its own identity. The client cannot see the
    // process itself (the WebSocket to the browser stays open when the
    // server crashes), so this number is how it learns that the server
    // behind the socket is a new one and has to build the program again.
    session.processId += 1
    // The stdin of the server is the half of the frame channel that breaks
    // first, and it breaks silently: a write into a pipe whose reader is
    // gone fails ASYNCHRONOUSLY, and the only sign of it is the 'error'
    // event of the stream. The try/catch around the write cannot catch it
    // (the write has already returned by then), and a stream without an
    // 'error' listener turns that error into an *uncaught exception* - the
    // EventEmitter throws, and the whole DSH host process dies with it (the
    // EPIPE that ended the IDE when the project was switched).
    if (handle.stdin) {
      handle.stdin.on('error', (error) => {
        // The handler must never throw: it runs inside the error path of
        // the stream, and a throw here is an uncaught exception as well.
        try {
          this.#ctx?.logger?.warn?.('lsp: the language server closed its stdin: %s', messageOf(error))
        } catch { /* a broken logger may not take the host down */ }
      })
    }
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
   * The free memory of the machine, in bytes.
   *
   * The same probe the gate uses (`options.readMemory`), so that a test can
   * inject the machine it wants to see. The standby cache is subtracted:
   * it is memory the machine has already given to the file cache (MEM-03).
   * @returns {number} the free memory in bytes
   */
  #freeBytes() {
    try {
      const memory = this.#readMemory()
      const standby = Number.isFinite(memory?.standbyBytes) && memory.standbyBytes > 0 ? memory.standbyBytes : 0
      const free = Number.isFinite(memory?.freeBytes) ? memory.freeBytes : 0
      return Math.max(0, free - standby)
    } catch {
      // A probe that fails must not take the host down: the measurement is
      // void, and the estimate of the registry is used instead.
      return 0
    }
  }

  /**
   * Measure the footprint of one language server (PRD-v5.1 §3.2, MEM-06).
   *
   * The measurement is the difference of two readings of the free memory.
   * It is VOID when the difference is in the noise band (or negative): then
   * something else on the machine allocated or freed memory at the same
   * time, and the difference cannot be attributed to the server. The
   * estimate of the registry is used instead - the measured 434 MB of a
   * TypeScript index - and the host log says so.
   *
   * A void measurement is not a wrong one: it is a missing one, and the
   * conservative direction is the estimate of a real measurement.
   *
   * THE SPAWN WINDOW IS PER SESSION, AND IT IS ATTRIBUTABLE: the spawns
   * are sequential, so the drop between the two readings belongs to the
   * one server that was started. The window also moves the baseline of the
   * manager: the later round must not count the drop of this spawn a
   * second time.
   *
   * THE DIFFERENCE IS ONLY ATTRIBUTED WHEN THE SERVER COULD HAVE TAKEN IT.
   * The difference between two readings is the growth of EVERYTHING on the
   * machine: the IDE that indexes its own files, the browser, Docker, the
   * antivirus. A server can never have taken more than the room it has
   * left, so a difference that is bigger than its capacity was NOT its
   * memory - and it is void (the estimate of the registry is used, and the
   * host log says so with the numbers).
   *
   * Without that bound the accounting is optimistic in the dangerous
   * direction: a foreign program that eats 7 GB would be booked on the
   * server, the reservation would collapse, the available memory would
   * look huge - and the gate would let the machine run into the swap.
   *
   * The bound is not enough on its own, and the reason is worth writing
   * down: a difference that FITS the room of the server may still belong
   * to another program. The spawn window is the last measurement that can
   * be trusted (the server is the main cause of the change in it), so it is
   * the footprint the pressure valve counts (review R1).
   *
   * @param {object} session the session
   * @param {number} freeBefore the free memory before the process started
   * @param {number} freeAfter the free memory after the process existed
   */
  #measureFootprint(session, freeBefore, freeAfter) {
    const delta = freeBefore - freeAfter
    // The baseline of the machine moves with the spawn: the round that
    // follows compares against this reading and not against the one of
    // before the spawn. It moves in every case - also when the measurement
    // is void, or every later round would be void for ever.
    this.#lastGlobalFreeBytes = freeAfter
    const capacity = this.#capacityOf(session)
    const { baselineMB } = memoryEstimateOf(session.languageId, session.lsp ?? DEFAULT_LSP_SETTINGS)
    const baselineBytes = Math.max(0, baselineMB) * 1024 * 1024
    if (delta > MEASURE_NOISE_MAX_MB * 1024 * 1024 && delta <= capacity) {
      // The difference fits the room the server has left: it is its growth.
      // No clamp is needed - the bound is the capacity.
      session.measuredBytes = delta
      // The CONFIRMED footprint: the drop of the spawn window, but never
      // more than the typical footprint of the language.
      //
      // The spawn window is the only window in which the server itself was
      // the main cause of the change - and it is still a window of the
      // MACHINE, not a measurement OF the server: another program may
      // allocate in it as well. A drop that is bigger than the typical
      // footprint of the language is more likely another program's than the
      // server's, so the confirmed number refuses to believe it.
      //
      // That buys a BOUND: the confirmed footprint is never more than one
      // baseline above the real one, while the measured value of the
      // account is not bounded at all (review R4, N1).
      session.confirmedBytes = Math.min(delta, baselineBytes)
      return
    }
    session.measuredBytes = baselineBytes
    // The estimate is not a measurement, but it is the only number there is:
    // the valve books it as well (review R1).
    session.confirmedBytes = baselineBytes
    let reason
    if (delta <= MEASURE_NOISE_MAX_MB * 1024 * 1024) {
      reason = delta < MEASURE_NOISE_MIN_MB * 1024 * 1024
        ? 'the machine gave memory away while the server was started'
        : 'the difference of the free memory was inside the noise band'
    } else {
      reason = `the machine lost ${Math.round(delta / (1024 * 1024))} MB and the server cannot take more than ${Math.round(capacity / (1024 * 1024))} MB - the difference was not its memory`
    }
    this.#ctx?.logger?.warn?.('lsp: the footprint of the %s language server could not be measured (%s) - the estimate of %d MB is used instead', session.languageId, reason, baselineMB)
  }

  /**
   * The room one language server has left (bytes).
   *
   * It is the difference between the ceiling the server was given and the
   * footprint that was measured for it: the memory it may still take. A
   * server that stands at its ceiling has no room left, and a difference
   * of the machine can never be bigger than the room of all the servers
   * together.
   * @param {object} session the session
   * @returns {number} the room in bytes
   */
  #capacityOf(session) {
    return Math.max(0, session.ceilingBytes - session.measuredBytes)
  }

  /**
   * Measure the footprint of the running language servers again (MEM-06).
   *
   * The first measurement happens while the process starts: the program of
   * the project is not built yet, so the server is still small. It grows
   * while the program is built, and the gate has to know that - a server
   * that grew to 900 MB has 900 MB less headroom.
   *
   * THE ROUND IS A ROUND OF THE MANAGER, NOT OF A SESSION. The free memory
   * of the machine is ONE number, and a difference of two readings of it
   * is ONE difference: two sessions that measure it in overlapping windows
   * would each count the same drop, and the sum of the measurements would
   * be twice the real footprint of the machine. The measured footprint
   * would be far too large, the reservations far too small, and the gate
   * would let the machine run into the swap (PRD-v5.1 §3.1).
   *
   * So the manager keeps ONE baseline and ONE reading per round, and the
   * difference is computed ONCE. It is then credited to the sessions that
   * have room left - split PROPORTIONALLY to their room, so that no
   * session can grow beyond its ceiling (and no clamp of the measured
   * value is needed anywhere).
   *
   * THE ATTRIBUTION IS BOUNDED, NOT EXACT. The difference of two readings
   * is the growth of everything on the machine, and the method cannot say
   * whose growth it was. Two consequences:
   *
   *   - a difference that does not fit the room of all the servers together
   *     was NOT theirs: it is void, and the last values stay. That is the
   *     conservative direction - the reservation stays big and the gate
   *     stays strict;
   *   - a difference that DOES fit may still contain the growth of another
   *     program. The measured value is then an UPPER bound of the real
   *     growth of the servers, the reservation an LOWER bound of their
   *     room, and the available memory an UPPER bound - too optimistic by
   *     the part that belonged to somebody else.
   *
   * That optimism cannot be closed inside this method: a minute of the
   * machine does not say whose growth it was, and the difference of the
   * machine is ONE number. It is closed where it hurts: the pressure valve
   * (MEM-12) does NOT watch the account - it watches the CONFIRMED margin
   * of the machine (`safeAvailableBytes`), which is counted from the
   * footprint of the spawn window and can never be inflated by a difference
   * of a later round (review R1). The account stays the number of the gate
   * and of the panel, and it is the honest one for the question they ask:
   * "how much may the NEXT server take".
   *
   * A session without room is not a candidate: the difference it cannot
   * take is left to the others (and to the next round).
   */
  #remeasure() {
    try {
      const now = this.#now()
      // The interval belongs to the manager: two sessions that tick at the
      // same time must not run two rounds.
      if (this.#lastMeasureAt !== null && this.#lastMeasureAt !== undefined) {
        if (now - this.#lastMeasureAt < MEASURE_INTERVAL_MS) return
      }
      this.#lastMeasureAt = now
      const free = this.#freeBytes()
      const previous = this.#lastGlobalFreeBytes
      this.#lastGlobalFreeBytes = free
      if (previous === null || previous === undefined) return
      const delta = previous - free
      if (delta <= MEASURE_NOISE_MAX_MB * 1024 * 1024) {
        // The machine gave memory away, or something else on it allocated
        // and freed memory at the same time: the difference cannot be
        // attributed to the servers, and the last valid values stay.
        this.#ctx?.logger?.warn?.('lsp: the re-measurement of the language servers was not conclusive (%d MB) - the last valid values are kept', Math.round(delta / (1024 * 1024)))
        return
      }
      // The candidates: the sessions that have room left, and the room
      // itself. The room is what a server can still take, and the difference
      // of the machine can never be bigger than the room of all the servers
      // together.
      const growers = []
      let capacity = 0
      for (const candidate of this.#sessions) {
        const room = this.#capacityOf(candidate)
        if (room <= 0) continue
        growers.push({ session: candidate, room })
        capacity += room
      }
      if (growers.length === 0) {
        // Nobody can take the difference: it was not theirs - another
        // program of the machine took it. The last values stay.
        this.#ctx?.logger?.warn?.('lsp: the machine lost %d MB and no language server can take it - the last valid values are kept', Math.round(delta / (1024 * 1024)))
        return
      }
      if (delta > capacity) {
        // VOID: the difference is bigger than what all the servers together
        // could ever take, so it cannot be theirs. Booking it on them would
        // make the reservations collapse and the available memory look huge
        // while the machine is out of memory.
        this.#ctx?.logger?.warn?.('lsp: the machine lost %d MB and the language servers can only take %d MB - the difference was not their memory and the last valid values are kept', Math.round(delta / (1024 * 1024)), Math.round(capacity / (1024 * 1024)))
        return
      }
      // The difference fits: it is split PROPORTIONALLY to the room of the
      // growers. No grower can grow beyond its ceiling this way, so the
      // measured value needs no clamp.
      for (const grower of growers) {
        const attributed = Math.floor(delta * grower.room / capacity)
        grower.session.measuredBytes += attributed
        grower.session.reservedBytes = Math.max(0, grower.session.ceilingBytes - grower.session.measuredBytes)
      }
      // The difference was booked on the servers - and the method cannot say
      // whose growth it was. The trace matters: without it the account can
      // grow too kind without anybody noticing, and the panel would show a
      // number that the machine does not have (review R1).
      this.#ctx?.logger?.info?.(
        'lsp: the machine lost %d MB and it was booked on %d language server(s) - the method cannot say whose growth it was, and the pressure valve counts the confirmed footprint instead',
        Math.round(delta / (1024 * 1024)),
        growers.length,
      )
    } catch (error) {
      // The measurement runs in an interval: a throw here is an uncaught
      // exception and would end the DSH host process.
      this.#ctx?.logger?.warn?.('lsp: the measurement of the language server failed: %s', messageOf(error))
    }
  }

  /**
   * One tick of a running session.
   *
   * The watchdog of the session carries three things, because a session
   * should not own three timers that all wake up the host:
   *
   *   - the measurement of the footprint of the server (MEM-06): it runs at
   *     most once per minute;
   *   - the check of the memory pressure of the machine (MEM-12): it runs
   *     at the interval of the pressure check;
   *   - the count of the unanswered requests (CRASH-01).
   *
   * @param {object} entry the root entry
   * @param {object} session the session
   * @param {number} timeout the request timeout
   */
  #tick(entry, session, timeout) {
    this.#remeasure()
    this.#checkMemoryPressure(entry, session)
    this.#checkTimeouts(entry, session, timeout)
  }

  /**
   * Handle one message of the frame worker.
   * @param {object} entry the root entry
   * @param {object} session the session
   * @param {object} message the worker message
   */
  #onWorkerMessage(entry, session, message) {
    if (message === null || typeof message !== 'object') return
    if (message.type === 'dropped') {
      // The frame worker dropped a payload. A payload that is not JSON is
      // dropped by design, but a dropped HANDSHAKE is the one moment where
      // the client waits for an answer that will never come: the server was
      // asked twice and has not answered the first time yet, so the second
      // one cannot be forwarded (a protocol violation) and cannot be
      // answered (there are no capabilities yet).
      //
      // The host log is the only place where this shows up - the client
      // waits for a handshake that will never arrive, and the status bar
      // keeps saying "ready" because the server process is up.
      this.#ctx?.logger?.warn?.('lsp: the frame worker dropped a payload: %s', messageOf(message.reason ?? message))
      return
    }
    if (message.type === 'message') {
      // The server speaks again. The requests that ran into their deadline
      // are history as soon as it answers one of them - the counter is the
      // number of the requests that are still unanswered, not a total of
      // every timeout the session ever had.
      session.timeouts = 0
      this.#broadcast(entry, message.text)
      this.#scheduleReady(entry, session)
      this.#touch(entry, session)
      return
    }
    if (message.type === 'request') {
      // A request of the client that the server has to answer. The id and the
      // method come from the worker: only that thread may parse the
      // payloads. The flag tells the host that the request is the handshake
      // - the watchdog treats the two differently - and the semantic flag
      // tells it whether the answer says something about the semantic
      // features (the client counts exactly those answers).
      const id = message.id
      if (typeof id === 'number' || typeof id === 'string') {
        const semantic = SEMANTIC_METHODS.has(message.method)
        session.pendingRequests.set(id, {
          at: this.#now(),
          handshake: message.handshake === true,
          semantic,
        })
        // A semantic request that is outstanding means that the server is
        // building the program of the project (IDLE-04). The idle timer is
        // cleared: the server must not be released while it does the work
        // the user is waiting for.
        if (semantic) this.#clearIdleTimer(session)
      }
      return
    }
    if (message.type === 'answered') {
      // The server answered a request (or the worker answered it from the
      // handshake cache). The request is not outstanding any more.
      const id = message.id
      if (typeof id === 'number' || typeof id === 'string') {
        const pending = session.pendingRequests.get(id)
        // The first answer to a *semantic* request is the end of the
        // patience: from then on the configured timeout applies. The
        // handshake is answered in milliseconds and says nothing about the
        // speed of the server, and the answer to a request that is not
        // semantic says nothing about the semantic features either - the
        // client does not count it either, so the host may not let it
        // shorten the budget (the two sides must agree on the budget, or
        // the host kills the server the client is still waiting for).
        if (pending !== undefined && pending.semantic === true) session.realAnswers += 1
        session.pendingRequests.delete(id)
        session.timeouts = 0
        // The program is built: the idle timer may be armed again (the
        // server answered a semantic request, so it is not building
        // anything any more).
        if (pending !== undefined && pending.semantic === true) this.#touch(entry, session)
      }
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
      //
      // The message is ASYNCHRONOUS: it can arrive after `relayToServer`
      // recorded a NEWER handshake (P1-1), and it must not overwrite that
      // one with the older text it carries. The host owns the handshake -
      // it is the newest one that counts - and the worker only fills the gap
      // when nothing is known yet.
      if (typeof message.text === 'string' && message.text !== '' && entry.handshake === '') {
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
   *
   * The process is gone - or not there yet: the bytes cannot be written
   * anywhere, and a payload that disappears without a trace is the hardest
   * kind of defect to find (the handshake of B1 disappeared exactly like
   * this, and the status bar said "connecting" for two minutes). So the
   * host log says it.
   * @param {object} session the session
   * @param {Buffer | Uint8Array} data
   */
  #writeToServer(session, data) {
    const stdin = session.handle?.stdin
    if (stdin === undefined || stdin === null) {
      this.#ctx?.logger?.warn?.('lsp: a payload of the language server could not be written: the process is not there')
      return
    }
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
   *
   * The client does not re-open the documents itself when the connection is
   * live again (`lsp-workspace.js`): the host knows the documents and
   * announces them to the new server. The same is true for the wake after
   * an idle exit (IDLE-02/IDLE-03): the host kept its document table, and
   * the fresh server knows nothing about it.
   *
   * `announced` is the set of documents that were known *before* the server
   * was started: those are the ones the new server has to learn about. The
   * documents that arrived while there was no server are replayed as
   * payloads and must not be opened a second time - a second `didOpen` for
   * the same URI breaks the protocol.
   * @param {object} entry the root entry
   * @param {object} session the session
   * @param {Set<string> | null} [announced] the documents that were known
   *   before the server was started
   */
  #reopenDocuments(entry, session, announced = null) {
    for (const document of entry.documents.values()) {
      if (announced !== null && !announced.has(document.uri)) continue
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
   * Degrade one session and remember why.
   *
   * The cause is the answer to "may a later payload try again?" (IDLE-02):
   * the memory of the machine changes and the user may free some, but a
   * server that is not installed does not appear while the editor is open.
   * Without the cause the host would have to guess - and the wake would
   * stop working after the first refusal.
   * @param {object} session the session
   * @param {string} cause the reason (one of `DEGRADE_CAUSES`)
   * @param {string} detail the message shown to the user
   */
  #degrade(session, cause, detail) {
    session.degradeCause = cause
    this.#transition(session, 'degraded', detail)
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
    const previous = session.state
    assertTransition(previous, next)
    session.state = next
    session.detail = detail
    // The cause of a degradation belongs to the state: a session that is not
    // degraded has no cause, and a session that is degraded has exactly the
    // one that explains it.
    if (next !== 'degraded') session.degradeCause = null
    const entry = session.entry
    if (entry !== undefined) {
      this.#notify(entry, { type: 'state', root: entry.root, state: next, detail })
      // A degradation is a failure the user has to know about, and the
      // status bar is polled every two seconds: the poll almost never
      // catches the state itself (`crashed` -> `restarting` -> `degraded`
      // happens inside one millisecond). The degradation therefore carries
      // its own event (VIS-04), and the client shows it as a toast.
      //
      // The event belongs to the episode and not to the transition: a wake
      // that the memory gate refused degrades the root again, and the state
      // of the root does not change then (`degraded` -> `starting` ->
      // `degraded` is one fault, not two). A second event would be a second
      // toast for one fault, and the state of the root did not change.
      if (next === 'degraded') {
        if (!entry.degradeEpisode) {
          entry.degradeEpisode = true
          this.#notify(entry, { type: 'degraded', root: entry.root, detail, cause: session.degradeCause })
        }
      } else if (DEGRADE_EPISODE_END_STATES.includes(next)) {
        // The language server works again: the next degradation is a new
        // episode and gets its own announcement.
        entry.degradeEpisode = false
      }
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
   *
   * The policy of the settings decides what happens (PRD-v5 §3.2):
   *
   *   - 'never' arms no timer at all: the server stays until the user
   *     stops it.
   *   - 'after' arms the timer of `idleTimeoutMs`.
   *   - 'onMemoryPressure' arms no timer: the server is released when the
   *     machine runs out of free memory (see `#checkMemoryPressure`).
   *   - 'always' arms the timer of `idleTimeoutMs` - the same as 'after',
   *     written down explicitly.
   *
   * `autoExit: false` still means "never": the documents that were written
   * before the policy existed keep their meaning.
   *
   * The timer is not armed while the program of the project is built
   * (IDLE-04): the server is busy with the work the user is waiting for,
   * and killing it would throw that work away. The idle timeout and the
   * build budget are both ten minutes by default, so they used to fire
   * together.
   *
   * THE PRESSURE VALVE IS NOT PART OF THIS POLICY (PRD-v5.1 §3.8, MEM-12).
   * It is armed on its own, and `idlePolicy: 'never'` does NOT exempt it:
   * "never" means "not because of idleness", not "not even when the machine
   * is dying". The default policy ('after') used to leave the machine
   * without any defence at all - the pressure timer was not even installed,
   * and the promise "never let the machine run into swap" had no fallback.
   * The only way to switch the valve off is `pressureYield: false`.
   *
   * The valve rides on the watchdog of the session (see `#tick`) and not on
   * a timer of its own: a session that owns three timers wakes the host up
   * three times, and the review of the earlier rounds made sure that a
   * session owns exactly two - the idle timer and the watchdog. The
   * watchdog is armed independently of the idle policy, so the valve is too.
   *
   * @param {object} entry the root entry
   * @param {object} session the session
   * @param {number} [delayMs] the delay, when it is not the configured timeout
   */
  #armIdleTimer(entry, session, delayMs) {
    this.#clearIdleTimer(session)
    const lsp = session.lsp ?? DEFAULT_LSP_SETTINGS
    const policy = idlePolicyOf(lsp)
    if (policy === 'never' || policy === 'onMemoryPressure') return
    if (isBuildingProgram(session)) return
    const timeout = Number.isFinite(delayMs) ? delayMs : Number(lsp.idleTimeoutMs)
    if (!Number.isFinite(timeout) || timeout <= 0) return
    const timer = setTimeout(() => { this.#onIdle(entry, session, timeout) }, timeout)
    timer.unref?.()
    session.idleTimer = timer
  }

  /**
   * The machine is below the hard floor: give the memory back.
   *
   * The server is released then: the machine needs the memory more than
   * the project needs the index. The release is not a failure - the server
   * comes back with the first request (IDLE-02) - and it ends in
   * `suspended`, not in `degraded` (CONC-04): the machine did not break,
   * it asked for its memory back.
   *
   * The trigger is the CONFIRMED margin of the machine: the free memory
   * minus the room the running servers may still take, counted from the
   * footprint that was measured while they were starting.
   *
   * Why not the available memory of the account? Because the account may be
   * too generous, and the difference method cannot say whose memory the
   * machine lost: the periodic re-measurement books a difference that FITS
   * inside the room of the servers on them, and part of that difference may
   * have belonged to another program. Every booked difference shrinks the
   * reservations and grows the available memory of the account - so a
   * machine that is really out of memory can look like a machine with
   * gigabytes to spare, and a valve that watches that number never fires
   * (review R1).
   *
   * The confirmed margin is never BIGGER than the available memory of the
   * account - the confirmed footprint is never bigger than the measured one
   * - so the trigger below also covers the trigger of the account: a
   * machine that is below the hard floor on the account is below it here as
   * well. One number, one trigger, and the pessimistic one.
   *
   * It fires EARLY and never late. The confirmed footprint is an upper
   * bound of the real one, and the measurement that could tell more is
   * exactly the measurement that cannot be trusted: a server that really
   * grew is not credited, so the margin is that much too low and the valve
   * gives the memory back a little earlier than the truth would ask for.
   *
   * The victim is chosen by the LRU order of CONC-03 - the machine is not
   * asked which server may go, and the server that builds its program is
   * never the one that goes.
   *
   * @param {object} entry the root entry
   * @param {object} session the session
   */
  #checkMemoryPressure(entry, session) {
    try {
      if (entry.session !== session) return
      if (session.state !== 'ready' && session.state !== 'building') return
      const lsp = session.lsp ?? DEFAULT_LSP_SETTINGS
      // The valve is the one and only way to switch it off (MEM-12).
      if (!pressureYieldOf(lsp)) return
      // The check runs at its own interval and not on every tick of the
      // watchdog: the reading of the free memory is cheap, but it is not
      // free, and the machine does not change its mind every second.
      const now = this.#now()
      const interval = this.#pressureIntervalOf()
      const last = session.lastPressureAt
      if (last !== null && last !== undefined && now - last < interval) return
      session.lastPressureAt = now
      const resources = this.#resourcesSnapshot(session.memoryLimitMB, session.languageId, lsp)
      const hardFloorBytes = resources.hardFloorMB * 1024 * 1024
      // The CONFIRMED margin, not the available memory of the account: the
      // account may be too optimistic, and a valve that watches an
      // optimistic number is a valve that does not fire (review R1). The
      // confirmed margin is never bigger than the available memory of the
      // account, so this trigger also covers the trigger of the account.
      if (resources.safeAvailableBytes >= hardFloorBytes) {
        // The machine is out of the pressure again: the next episode may be
        // reported again (the check runs every second).
        this.#pressureReported = false
        return
      }
      this.#safely(this.#yieldUnderPressure(session, resources), 'the memory pressure release')
    } catch (error) {
      // The check runs in an interval: a throw here is an uncaught
      // exception and would end the DSH host process.
      this.#ctx?.logger?.warn?.('lsp: the memory pressure check failed: %s', messageOf(error))
    }
  }

  /**
   * How often the memory pressure of the machine is checked (ms).
   *
   * The interval is inside the range of the constants of the pressure
   * check, and it does not depend on the idle timeout.
   * @returns {number}
   */
  #pressureIntervalOf() {
    return Math.min(PRESSURE_CHECK_MAX_MS, Math.max(PRESSURE_CHECK_MIN_MS, PRESSURE_CHECK_INTERVAL_MS))
  }

  /**
   * Release the least used language server of the machine (CONC-03).
   *
   * The order is the one of the specification, from "given up first" to
   * "given up last":
   *
   *   1. no outstanding request, not the focused root, not building, and
   *      idle the longest;
   *   2. requests that ran into their deadline - they are dead anyway;
   *   3. a root with requests that are still running;
   *   4. the focused root - the editor of the user is there, and it is
   *      released last of all.
   *
   * A server that BUILDS the program of its project is never released: the
   * idle timer is not armed while it builds (IDLE-04), so it looks like
   * the most idle one - and it is the one that must not be touched.
   *
   * @param {object} trigger the session whose check found the pressure
   * @param {object} [resources] the memory snapshot that found it
   */
  async #yieldUnderPressure(trigger, resources = null) {
    const victim = this.#lruVictim()
    if (victim === null) {
      // Nobody may go: every session builds its program, and CONC-03 says
      // that a building project is never touched. The machine is short of
      // memory and nothing can be done about it - that is worth saying, but
      // ONCE: the check of the pressure runs every second (review R4, N3).
      if (!this.#pressureReported) {
        this.#pressureReported = true
        this.#ctx?.logger?.warn?.('lsp: the machine is below the hard floor, but no language server may be released: every session builds its program')
      }
      return
    }
    const entry = victim.entry
    if (entry === undefined || entry === null) return
    // The message says why the server was released: the margin of the
    // machine fell below the floor (this server was the one that had to go),
    // or the host gave the room to a server that was used less (the LRU
    // rule). The numbers of the snapshot go into the message, so that it is
    // true in every band (review R5, M2).
    const template = victim === trigger ? PRESSURE_EXIT_DETAIL : PRESSURE_YIELD_DETAIL
    const detail = pressureDetailOf(template, resources)
    await this.#exitIdle(entry, victim, detail)
    // The release may NOT have happened: the idle exit returns early when
    // the session was replaced in the meantime or when it is already being
    // released. The log may only say that a server was released when it
    // really was (review R5, H1).
    if (victim.state !== 'suspended') return
    // The two numbers are logged together: the account may still say that
    // there is room, and the operator has to see WHY the machine gave the
    // memory back (review R1: the account used to be inflated silently).
    this.#pressureReported = true
    this.#ctx?.logger?.warn?.(
      'lsp: the machine is below the hard floor: the confirmed margin is %d MB, the account says %d MB - the least used language server was released',
      Math.round((resources?.safeAvailableBytes ?? 0) / (1024 * 1024)),
      Math.round((resources?.availableBytes ?? 0) / (1024 * 1024)),
    )
  }

  /**
   * The language server that may be released first (CONC-03).
   * @returns {object | null} the session, or null when none may go
   */
  #lruVictim() {
    const candidates = []
    for (const session of this.#sessions) {
      if (session.state !== 'ready' && session.state !== 'building') continue
      // A server that builds the program of its project is never yielded.
      if (isBuildingProgram(session)) continue
      const focused = this.#isFocused(session)
      const outstanding = session.pendingRequests.size
      const timedOut = this.#hasTimedOutRequest(session)
      // The focused root is released last of all - the user is working in
      // it, and a release would interrupt them.
      const priority = focused ? 3 : (outstanding === 0 ? 0 : (timedOut ? 1 : 2))
      candidates.push({ session, priority, activity: session.lastActivityAt })
    }
    if (candidates.length === 0) return null
    // The longest idle one goes first inside a group.
    candidates.sort((left, right) => (left.priority - right.priority) || (left.activity - right.activity))
    return candidates[0].session
  }

  /**
   * Whether the user is working in one session (CONC-03).
   *
   * The host cannot see the editor of the user, but it knows two things
   * that come close to it:
   *
   *   - the client that is attached to the root is the client the user is
   *     working with (the relay attaches the sink of the root it speaks
   *     to);
   *   - the client may report the focused root itself (see `setFocus`).
   *
   * Without any of them the host treats the sessions as "not focused": the
   * order of the yield is still right, the focused root just does not get
   * the special treatment.
   *
   * @param {object} session the session
   * @returns {boolean}
   */
  #isFocused(session) {
    const entry = session.entry
    if (entry === undefined || entry === null) return false
    if (entry.sinks instanceof Set && entry.sinks.size > 0) return true
    const focus = this.#focusRoot
    if (focus === null || focus === undefined) return false
    return rootKey(focus) === entry.key
  }

  /**
   * Whether one session has a request that ran into its deadline.
   *
   * A request that is still running is work the user waits for. A request
   * that ran into its deadline is dead - the answer will not come - and the
   * server that owns it is a better victim than one that is busy.
   *
   * @param {object} session the session
   * @returns {boolean}
   */
  #hasTimedOutRequest(session) {
    if (session.timeouts > 0) return true
    const lsp = session.lsp ?? DEFAULT_LSP_SETTINGS
    const timeout = Number(lsp.requestTimeoutMs)
    const budget = session.realAnswers > 0 ? timeout : BUILD_REQUEST_TIMEOUT_MS
    const now = this.#now()
    for (const pending of session.pendingRequests.values()) {
      if (now - pending.at >= budget) return true
    }
    return false
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
   * Stop the language server because it was idle for too long.
   *
   * The state becomes `suspended` and not `idle` (VIS-01): the server was
   * released on purpose, and that is not a failure. The client shows it as
   * "asleep" and the first request starts the server again (IDLE-02).
   *
   * The `indexedRoots` map is *not* touched: "this root was indexed" stays
   * true even though the server is gone (PRD §2.6).
   *
   * The document table of the host is *not* cleared either (IDLE-03): the
   * documents are still open in the editor of the user, and the wake
   * re-opens them for the new server. The clients are told that the
   * documents are closed - their editor state must not change.
   * @param {object} entry the root entry
   * @param {object} session the session
   * @param {string} [detail] the message shown to the user
   */
  async #exitIdle(entry, session, detail = IDLE_EXIT_DETAIL) {
    if (entry.session !== session) return
    if (session.state !== 'ready' && session.state !== 'building') {
      // The timer must not be lost (IDLE-05): the session is in a state
      // that cannot be released right now, so the timer is armed again and
      // the release happens later. A session that does not run any more
      // (it is suspended or gone) gets no timer.
      this.#rearmAfterEarlyExit(entry, session)
      return
    }
    // Two releases of the same session must not happen: the idle timer and
    // the pressure valve may fire at the same time, and the second release
    // would try to leave the state `suspended` twice - a transition the
    // state machine refuses.
    if (session.releasing === true) return
    session.releasing = true
    session.intentionalExit = true
    this.#writeDidClose(entry, session)
    await this.#terminateAndWait(session)
    // The idle timer is cleared here as well: the session that is going
    // away must not leave a timer behind that fires ten minutes later.
    this.#teardownSession(session)
    this.#transition(session, 'suspended', detail)
    // The documents stay in the table of the host (IDLE-03): the wake
    // re-opens them for the new server. The clients are told that the
    // documents are closed, so their editor state stays untouched.
    for (const uri of entry.documents.keys()) {
      this.#notify(entry, { type: 'didClose', uri })
    }
    this.#notify(entry, { type: 'suspended', root: entry.root, detail })
  }

  /**
   * Arm the idle timer again after the idle exit could not release the
   * session (IDLE-05).
   *
   * Without this the timer is gone for ever: `#onIdle` clears it before it
   * calls the idle exit, and the early return of the exit would leave the
   * session without one - and the memory of the language server would never
   * be given back.
   *
   * The remaining time keeps the deadline of the release. A session that
   * has been idle for longer than the timeout gets the whole timeout again:
   * a delay of zero would be a busy loop.
   * @param {object} entry the root entry
   * @param {object} session the session
   */
  #rearmAfterEarlyExit(entry, session) {
    if (entry.session !== session) return
    if (!['starting', 'building', 'ready', 'restarting'].includes(session.state)) return
    const lsp = session.lsp ?? DEFAULT_LSP_SETTINGS
    const timeout = Number(lsp.idleTimeoutMs)
    const elapsed = this.#now() - session.lastActivityAt
    const remaining = Number.isFinite(timeout) ? timeout - elapsed : 0
    this.#armIdleTimer(entry, session, remaining > 0 ? remaining : undefined)
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
    const timer = setInterval(() => { this.#tick(entry, session, timeout) }, interval)
    timer.unref?.()
    session.watchdogTimer = timer
  }

  /**
   * Count one unanswered request.
   *
   * The watchdog counts the **requests** the server did not answer, not the
   * time it stayed silent. A notification (`textDocument/didChange` and the
   * like) is never answered - that is normal - so a server that is busy
   * building its program must not be killed for it. The pending requests are
   * tracked by their id: the worker reports which payload was a request and
   * which payload answered one.
   *
   * One request is counted once: it is dropped from the pending list when it
   * is counted, so the next tick does not count it again.
   *
   * The budget depends on what the server has answered so far. As long as
   * it has not answered a *semantic* request, the watchdog is
   * patient: the first semantic request of a session waits for the program
   * build of the project, and that build was measured at more than ten
   * minutes on a large project (PRD-v5 §0.2 #3). Counting it with the
   * normal budget killed the server that was doing the work, and the
   * restart began the whole build again - the "building → killed →
   * rebuilding" loop. After the first real answer the configured timeout
   * applies exactly as before.
   * @param {object} entry the root entry
   * @param {object} session the session
   * @param {number} timeout the request timeout
   */
  #checkTimeouts(entry, session, timeout) {
    try {
      if (entry.session !== session) return
      if (session.state !== 'ready' && session.state !== 'building') return
      const budget = session.realAnswers > 0 ? timeout : BUILD_REQUEST_TIMEOUT_MS
      const now = this.#now()
      let oldest = null
      for (const [id, pending] of session.pendingRequests) {
        if (now - pending.at < budget) continue
        if (oldest === null || pending.at < oldest.at) oldest = { id, at: pending.at }
      }
      // Nothing is outstanding: the server may be silent for ever, that is
      // not a timeout.
      if (oldest === null) return
      // The request leaves the pending list when it is counted: it is
      // counted once, not once per tick of the watchdog.
      session.pendingRequests.delete(oldest.id)
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
   * it is reset as soon as the server answers one of them (see
   * `#onWorkerMessage`). The message says "request timeouts" and not
   * "consecutive request timeouts": the counter is not a streak of ticks.
   *
   * The reason of the timeout travels with the crash (CRASH-02): the
   * degradation has to answer "why did it degrade?", and "3 request
   * timeouts" is a part of that answer.
   * @param {object} entry the root entry
   * @param {object} session the session
   * @param {string} reason the reason of the timeout
   */
  #noteTimeout(entry, session, reason) {
    session.timeouts += 1
    if (session.timeouts < this.#timeoutLimit) return
    this.#safely(this.#onCrash(entry, session, `${session.timeouts} request timeouts (${reason})`), 'the crash handler')
  }

  /**
   * The detail of a degraded session (CRASH-02).
   *
   * The user asks "why did it degrade?" and the answer has to be in the
   * detail: the ORIGINAL reason (what killed the server) AND the cause
   * that ended the recovery (the exhausted budget, the settings, the
   * memory). A detail that only says "the server was not started again"
   * cannot answer that question - the status bar tooltip and the
   * diagnostics panel show the detail and nothing else.
   * @param {string} reason the original reason
   * @param {string} cause why the server was not started again
   * @returns {string}
   */
  #degradationDetail(reason, cause) {
    return `the language server stopped unexpectedly (${reason}); ${cause}, so the semantic analysis is paused`
  }

  /**
   * React to a crashed language server.
   *
   * One death arrives TWICE: the stdout of the dead process ends first and
   * the promise of the process resolves a moment later. The second signal
   * must not degrade the session - the restart budget is one, and the
   * duplicate signal used to spend it (CRASH-01): the server was killed by
   * the out-of-memory killer, the restart began, and the duplicate signal
   * degraded the session before the restart had even started.
   *
   * The generation of the process is the fence: a signal that belongs to a
   * process whose death was already reported is ignored.
   *
   * @param {object} entry the root entry
   * @param {object} session the session
   * @param {string} reason what happened
   */
  async #onCrash(entry, session, reason) {
    if (entry.session !== session) return
    // A session that is stopped on purpose (an idle release, a cancel, a
    // shutdown) is not a crash: the process is killed on the way out and its
    // output stream ends with it.
    if (session.intentionalExit) return
    // The crash of this generation was already reported: the signal is a
    // duplicate and must not change anything (CRASH-01).
    if (session.crashedGeneration === session.generation) return
    session.crashedGeneration = session.generation
    const state = session.state
    if (state === 'cancelled' || state === 'cancelling' || state === 'idle' || state === 'suspended' || state === 'degraded' || state === 'crashed') {
      return
    }
    if (state === 'restarting') {
      // The restart really failed: the process died again while the restart
      // was still pending.
      this.#degrade(session, DEGRADE_CAUSES.crash, this.#degradationDetail(reason, 'the automatic restart failed'))
      return
    }
    const lsp = session.lsp ?? DEFAULT_LSP_SETTINGS
    this.#transition(session, 'crashed', reason)
    // The handle of the dead process is cleared: for the whole restart
    // backoff (two seconds by default) `session.handle` pointed at the
    // process that is already gone, and every frame that arrived in that
    // window was written into a broken pipe.
    session.handle = null
    // The timers of the crashed session go away with it: the restart arms
    // new ones, and a session that stays crashed must not keep a watchdog
    // alive.
    this.#teardownSession(session)
    // The dead process holds no memory any more (MEM-02).
    this.#releaseReservation(session)
    // The detail is the FACT and not an advice: the reason is known here,
    // but what the user should do about it depends on the reason - and a
    // server that died of a timeout has nothing to do with the memory. The
    // client picks the advice.
    const detail = `The language server exited unexpectedly (${reason}).`
    this.#notify(entry, { type: 'crash', root: entry.root, detail })
    if (lsp.autoRestart === false) {
      this.#degrade(session, DEGRADE_CAUSES.crash, this.#degradationDetail(reason, 'the automatic restart is switched off in the settings'))
      return
    }
    if (session.restarts >= 1) {
      // The restart budget is one (PRD §2.7): the host does not try again
      // on its own, and a payload does not wake a server that crashed.
      this.#degrade(session, DEGRADE_CAUSES.crash, this.#degradationDetail(reason, 'the automatic restart budget (1) is used up'))
      return
    }
    // The memory is checked again before the restart: the crash may well have
    // been an out-of-memory kill (PRD §2.7).
    //
    // The rule is the same as at the start: the hard floor is never skipped
    // (a machine that cannot run the server cannot run it a second time
    // either), and the tight band is skipped only for a session the user
    // forced (P2-3).
    const resources = this.#resourcesSnapshot(session.memoryLimitMB, session.languageId, lsp)
    session.resources = resources
    // The refusal is the memory and not the crash: the machine may have
    // more memory later, and the session may be woken again then.
    if (resources.belowHardFloor) {
      this.#degrade(session, DEGRADE_CAUSES.memory, this.#degradationDetail(reason, `there is not enough free memory to restart it (needs ${toMb(resources.thresholdBytes)} MB, ${toMb(resources.availableBytes)} MB available${worstCaseHintOf(resources)})`))
      return
    }
    // The machine-level budget is the same rule as at the start (MEM-08):
    // it is never skipped, not even by a session the user forced.
    const refusal = this.#budgetRefusal(resources, session.memoryLimitMB)
    if (refusal !== null) {
      this.#degrade(session, DEGRADE_CAUSES.budget, this.#degradationDetail(reason, refusal))
      return
    }
    if (resources.tight && !session.force) {
      this.#degrade(session, DEGRADE_CAUSES.memory, this.#degradationDetail(reason, `the available memory is tight for the restart (${toMb(resources.availableBytes)} MB available, ${resources.needMB} MB expected, ${toMb(resources.softThresholdBytes)} MB recommended${worstCaseHintOf(resources)})`))
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
    // The memory is checked again before the restart, with the same rule as
    // at the start: the hard floor is never skipped, and the tight band is
    // skipped only for a session the user forced (P2-3).
    const resources = this.#resourcesSnapshot(session.memoryLimitMB, session.languageId, lsp)
    session.resources = resources
    // The refusal is the memory: the machine may have more memory later,
    // and the session may be woken again then (IDLE-02).
    if (resources.belowHardFloor) {
      this.#degrade(session, DEGRADE_CAUSES.memory, `there is not enough free memory to restart the language server (needs ${toMb(resources.thresholdBytes)} MB, ${toMb(resources.availableBytes)} MB available${worstCaseHintOf(resources)}). Lower the memory limit in the settings, turn this language off, or use the conservative mode.`)
      return
    }
    // The machine-level budget is the same rule as at the start (MEM-08):
    // it is never skipped, not even by a session the user forced.
    const refusal = this.#budgetRefusal(resources, session.memoryLimitMB)
    if (refusal !== null) {
      this.#degrade(session, DEGRADE_CAUSES.budget, refusal)
      return
    }
    if (resources.tight && !session.force) {
      this.#degrade(session, DEGRADE_CAUSES.memory, `the available memory is tight for the restart of the language server (${toMb(resources.availableBytes)} MB available, ${resources.needMB} MB expected, ${toMb(resources.softThresholdBytes)} MB recommended${worstCaseHintOf(resources)}). Start it again to continue, or use the conservative mode.`)
      return
    }
    // The documents the new server does not know yet (see
    // `#reopenDocuments`).
    const announced = new Set(entry.documents.keys())
    try {
      await this.#spawn(entry, session, session.resolution)
    } catch (error) {
      this.#degrade(session, DEGRADE_CAUSES.crash, `the language server could not be restarted: ${messageOf(error)}`)
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
    this.#reopenDocuments(entry, session, announced)
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
    // The memory of the session is given back as soon as the process is on
    // its way out: the gate must not refuse the next server because of a
    // server that is already gone (MEM-02).
    this.#releaseReservation(session)
    // The handle is cleared BEFORE the process is terminated: a frame that
    // is still on its way (the frame worker is a thread - it answers in a
    // later turn of the event loop) would otherwise be written into the
    // pipe of a process that is about to die. The write into a broken pipe
    // fails asynchronously and took the whole host down with it.
    session.handle = null
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
    // The session is gone: it must not be counted by the memory gate any
    // more (MEM-05).
    this.#sessions.delete(session)
    this.#releaseReservation(session)
    // The ceiling of the session is the share of the machine-level budget
    // it held: the budget of the machine is free again (MEM-08).
    session.ceilingBytes = 0
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
