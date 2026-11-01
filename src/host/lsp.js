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
 * memory more than the project needs the index.
 */
const PRESSURE_EXIT_DETAIL = 'the machine ran out of free memory, so the language server was released to reclaim it (this is not a failure)'

/**
 * The shortest interval of the memory pressure check (ms).
 */
const PRESSURE_CHECK_MIN_MS = 250

/**
 * The longest interval of the memory pressure check (ms).
 */
const PRESSURE_CHECK_MAX_MS = 30000

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
    memoryWarnedRoots: isPlainObject(section.memoryWarnedRoots) ? section.memoryWarnedRoots : {},
  }
}

/**
 * The idle policy of the `lsp` section (PRD-v5 §3.2).
 *
 * `autoExit: false` is the switch of the documents that were written before
 * schema 5, and it still means "never exit": the older switch overrides the
 * newer policy, so a document that has it keeps its meaning.
 * @param {object} lsp the `lsp` section of the settings
 * @returns {'never' | 'after' | 'onMemoryPressure'}
 */
function idlePolicyOf(lsp) {
  const section = isPlainObject(lsp) ? lsp : {}
  if (section.autoExit === false) return 'never'
  return IDLE_POLICIES.includes(section.idlePolicy) ? section.idlePolicy : DEFAULT_LSP_SETTINGS.idlePolicy
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
 * The standby cache of the machine (0 when the platform cannot report it).
 *
 * On Windows the standby cache is part of the "available" physical memory
 * of `GlobalMemoryStatusEx` - which is what `os.freemem()` returns - but it
 * is memory the machine has already given to the file cache: the kernel may
 * drop it at any moment, so it is not memory a language server may use.
 * The measurement of PRD-v5 §5.4 found 652 MB of standby counted as
 * available - exactly the cost of one medium index.
 *
 * Node cannot read the number: `GlobalMemoryStatusEx` does not report it and
 * `GetPerformanceInfo` is not reachable from JavaScript. The default probe
 * therefore reports 0 (the host never subtracts the same memory twice), and
 * a deployment that knows its number injects a probe that reports it (see
 * `options.readMemory`).
 * @returns {number} the standby cache in bytes
 */
function standbyCacheBytes() {
  return 0
}

/**
 * The default memory probe.
 *
 * The free memory of the machine, without the standby cache. The probe is
 * injectable (`options.readMemory`), and an injected probe may report the
 * standby cache as well (`standbyBytes`) - the host subtracts it before it
 * compares the free memory with the estimate of a language server.
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
   * `force` skips the memory pre-check: the user was asked how tight the
   * memory is and asked for the server anyway (PRD §2.3).
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
      const { baselineMB } = memoryEstimateOf(languageId, lsp)
      available.push({
        languageId,
        command,
        source: resolution.source,
        resolvedPath: resolution.path,
        memoryLimitMB,
        memoryBaselineMB: baselineMB,
        memoryLimitSupported: resolution.supportsMemoryLimit,
      })
    }
    return { available, missing, disabled }
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
    // The ceiling stays the one of the settings: the estimate never asks for
    // more than the server may use.
    const memoryLimitMB = session?.memoryLimitMB ?? lsp.memoryLimitMB
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
      ? { root: resolvePath(String(root)), state: 'idle', languageId: null, command: null, source: null, detail: null, startedAt: null, cancellable: false, progress: 'idle', memoryLimitMB: null, scopeRoot: null, stderrLines: [], timeouts: 0, processId: 0, buildingProgram: false, idleArmed: false }
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
      // The server may have been released on purpose: the first payload
      // wakes it up again.
      this.#requestWake(entry, session, text)
      return false
    }
    session.worker.postMessage({ type: 'send', text, origin: 'client' })
    this.#touch(entry, session)
    return true
  }

  /**
   * Start the language server again after an idle release (IDLE-02).
   *
   * The wake happens at most once at a time: several payloads can arrive in
   * the same tick, and every one of them would start a server.
   * @param {object} entry the root entry
   * @param {object | null} session the session that was released
   * @param {string} text the payload that arrived
   */
  #requestWake(entry, session, text) {
    if (session === null || session === undefined) return
    // Only a session that was released on purpose may be woken. A session
    // that is starting, that failed or that the user cancelled stays as it
    // is.
    if (session.state !== 'suspended') return
    // The handshake is not a wake: it is replayed to every new process
    // anyway, and it says nothing about the work the user wants to do.
    if (isInitializeRequest(text)) return
    if (entry.wakePromise !== null && entry.wakePromise !== undefined) return
    const running = this.#wakeSession(entry, session)
    entry.wakePromise = running
    this.#safely(running.finally(() => {
      if (entry.wakePromise === running) entry.wakePromise = null
    }), 'the wake')
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
      await this.#ensureSession(entry, session.languageId)
    } catch (error) {
      // A wake that fails must not take the host down: the session stays
      // released, and the next payload tries again.
      this.#ctx?.logger?.warn?.('lsp: the language server could not be woken: %s', messageOf(error))
    }
  }

  /**
   * Whether the user put one project into the basic mode on purpose.
   *
   * The answer is remembered in the settings (`lsp.memoryWarnedRoots`), so
   * the host does not wake a project the user has switched off (PRD-v5
   * §3.3, risk table).
   * @param {object} lsp the `lsp` section of the settings
   * @param {object} entry the root entry
   * @returns {boolean}
   */
  #isConservative(lsp, entry) {
    const warned = isPlainObject(lsp.memoryWarnedRoots) ? lsp.memoryWarnedRoots : {}
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
        /**
         * The wake that is currently running (IDLE-02).
         *
         * Several payloads can arrive in the same tick, and every one of
         * them would start a language server: the promise is the fence.
         */
        wakePromise: null,
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
   * The memory that the running language servers of this process hold.
   *
   * The gate has to know what this process already started (MEM-02): the
   * free memory of the machine is not free for a *new* server, because the
   * servers that are already running may still take their whole ceiling.
   *
   * THE RESERVATION IS THE CEILING (`memoryLimitMB`), NOT THE MEASURED
   * FOOTPRINT. This is a deliberate trade-off:
   *
   *   - The measured footprint of a TypeScript index is 434 MB (the median
   *     of the measurement of PRD-v5 §5.2), but the server is told that it
   *     may use up to `memoryLimitMB` (2 GB by default, and that ceiling
   *     really reaches the server as `maxTsServerMemory`).
   *   - The machine has to survive the worst case of every server it runs.
   *     Reserving the measured footprint would let three servers claim
   *     1.3 GB on a machine with 4 GB of free memory - and each of them
   *     may really take its 2 GB, which is a machine that swaps.
   *   - The price is a stricter gate: on a 16 GB machine with 4 GB of free
   *     memory the first two indexes are allowed and the third one is
   *     refused, and on an 8 GB machine with 8 GB of free memory four
   *     TypeScript indexes are allowed (8 GB reserved, ~1.8 GB measured).
   *     A user who opens several projects may see the conservative mode
   *     for the third one. That is the point of the gate: it is better to
   *     refuse an index than to swap.
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
  }

  /**
   * The memory situation of one language server (PRD §2.2, §2.3).
   *
   * The decision is graded: the free memory is compared with the estimate of
   * the language instead of one global number, so a YAML project does not
   * need the gigabytes a TypeScript project needs. The three bands are
   *
   *   free >= needMB * 2   enough   - the server starts
   *   free >= hardFloorMB  tight    - the user decides; the host refuses to
   *                                    start the server without `force`
   *   otherwise            too low  - the server degrades
   *
   * The free memory that the bands are computed from is the free memory of
   * the machine MINUS the standby cache (MEM-03: on Windows `os.freemem()`
   * counts the standby cache as available, and 652 MB of standby are
   * exactly one medium index) MINUS the memory the servers of this process
   * have already reserved (MEM-02: the gate has to know what it already
   * started).
   *
   * The free-memory threshold of the settings is only the conservative
   * fallback: it speaks when no estimate of the language is known, and it
   * never blocks a language that has one (PRD §4.4).
   * @param {number} memoryLimitMB the ceiling of the language server
   * @param {string | null} languageId the language the estimate is based on
   * @param {object} lsp the `lsp` section of the settings
   * @returns {{ totalBytes: number, freeBytes: number, thresholdBytes: number, memoryLimitMB: number, canIndex: boolean, needMB: number, baselineMB: number, headroom: number, hardFloorMB: number, tight: boolean, belowHardFloor: boolean, languageId: string | null, softThresholdBytes: number }}
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
    // free for the next one.
    const reservedBytes = this.#reservedBytes()
    const availableBytes = Math.max(0, freeBytes - reservedBytes)
    // The authoritative answer of the host: what may happen with this
    // snapshot. The client renders it instead of judging the numbers again -
    // two sides that judge the same snapshot differently give the user two
    // different answers.
    const decision = availableBytes < hardFloorBytes ? 'low' : (availableBytes < softThresholdBytes ? 'tight' : 'ok')
    return {
      totalBytes: memory.totalBytes,
      freeBytes,
      standbyBytes,
      reservedBytes,
      availableBytes,
      thresholdBytes,
      memoryLimitMB: limit,
      canIndex: availableBytes >= thresholdBytes,
      needMB,
      baselineMB,
      headroom,
      hardFloorMB,
      // "Tight" is the whole window between the hard floor and the soft
      // factor: the user decides there, the host does not start on its own.
      tight: availableBytes >= hardFloorBytes && availableBytes < softThresholdBytes,
      belowHardFloor: availableBytes < hardFloorBytes,
      // 'ok' = the server may start, 'tight' = the user has to decide,
      // 'low' = the machine cannot afford it.
      decision,
      languageId: typeof languageId === 'string' ? languageId : null,
      softThresholdBytes,
    }
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
    // The ceiling of the language server.
    //
    // Three values play here: the per-language override of the settings, the
    // global limit of the settings and the built-in default of the language.
    // The global limit is a CAP over every language server - that is what
    // the setting says - and the per-language override replaces it for that
    // language (so one language may be given more than the global limit).
    //
    // Without the global limit in this chain the setting was a dead
    // control: the value the user saw in the settings page never reached
    // the server, and the only ceiling in effect was the built-in one.
    const languageLimitMB = Number.isFinite(override.memoryLimitMB)
      ? override.memoryLimitMB
      : registryEntry.memoryLimitMB
    const globalLimitMB = Number.isFinite(lsp.memoryLimitMB) && lsp.memoryLimitMB > 0
      ? lsp.memoryLimitMB
      : languageLimitMB
    const memoryLimitMB = Number.isFinite(override.memoryLimitMB)
      ? override.memoryLimitMB
      : Math.min(languageLimitMB, globalLimitMB)
    // A language that is switched off in the settings is never started.
    const turnedOff = override.enabled === false

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
       * The memory this session has reserved on the machine (bytes).
       *
       * The gate subtracts the reservations of the running sessions from
       * the free memory before it decides (MEM-02). The reservation is
       * given when the process starts and given back when it goes away.
       */
      reservedBytes: 0,
      /**
       * The user asked for the server although the memory was tight.
       *
       * The decision belongs to the user, so it survives a restart: the
       * server that was forced once is not stopped by the memory check of
       * the next crash.
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
       * The cancel that is currently running, if any.
       *
       * A second cancel waits for it instead of starting a second one: the
       * operation is atomic and the process is killed exactly once
       * (PRD §2.4).
       */
      cancelPromise: null,
      lastActivityAt: this.#now(),
      idleTimer: null,
      pressureTimer: null,
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
      this.#transition(session, 'degraded', `the ${language} language server is turned off in the settings. Turn it on again to use the semantic features of this language.`)
      return session
    }

    // The memory pre-check runs before every start, not only when the
    // settings are validated (PRD §2.2). A forced start skips it: the user
    // was asked how tight the memory is and asked for the server anyway.
    if (!session.force) {
      const resources = this.#resourcesSnapshot(memoryLimitMB, language, lsp)
      session.resources = resources
      // Three bands (PRD §2.3): enough memory starts the server, a tight
      // budget is the user's decision, and a machine that is out of memory
      // cannot run a server at all.
      if (resources.belowHardFloor) {
        this.#transition(session, 'degraded', `not enough free memory to start the language server (needs ${toMb(resources.thresholdBytes)} MB, ${toMb(resources.freeBytes)} MB available). Close other programs, lower the memory limit in the settings, or use the conservative mode.`)
        return session
      }
      if (resources.tight) {
        this.#transition(session, 'degraded', `the free memory is tight for the ${language} language server (${toMb(resources.freeBytes)} MB available, ${resources.needMB} MB expected, ${toMb(resources.softThresholdBytes)} MB recommended). Start it anyway to continue, or use the conservative mode.`)
        return session
      }
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
    // The server is running: it holds memory from now on, and the gate has
    // to know it (MEM-02). The reservation is the ceiling the server may
    // use - the machine has to survive the worst case of every server it
    // runs (see `#reservedBytes`).
    session.reservedBytes = Number.isFinite(session.memoryLimitMB) && session.memoryLimitMB > 0
      ? session.memoryLimitMB * 1024 * 1024
      : 0
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
   * Handle one message of the frame worker.
   * @param {object} entry the root entry
   * @param {object} session the session
   * @param {object} message the worker message
   */
  #onWorkerMessage(entry, session, message) {
    if (message === null || typeof message !== 'object') return
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
      // A degradation is a failure the user has to know about, and the
      // status bar is polled every two seconds: the poll almost never
      // catches the state itself (`crashed` -> `restarting` -> `degraded`
      // happens inside one millisecond). The degradation therefore carries
      // its own event (VIS-04), and the client shows it as a toast.
      if (next === 'degraded') {
        this.#notify(entry, { type: 'degraded', root: entry.root, detail })
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
   *     machine runs out of free memory (see `#armPressureTimer`).
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
   * @param {object} entry the root entry
   * @param {object} session the session
   * @param {number} [delayMs] the delay, when it is not the configured timeout
   */
  #armIdleTimer(entry, session, delayMs) {
    this.#clearIdleTimer(session)
    const lsp = session.lsp ?? DEFAULT_LSP_SETTINGS
    const policy = idlePolicyOf(lsp)
    if (policy === 'never') {
      this.#clearPressureTimer(session)
      return
    }
    if (policy === 'onMemoryPressure') {
      // No idle timer: the memory of the machine decides when the server
      // has to go.
      this.#armPressureTimer(entry, session)
      return
    }
    this.#clearPressureTimer(session)
    if (isBuildingProgram(session)) return
    const timeout = Number.isFinite(delayMs) ? delayMs : Number(lsp.idleTimeoutMs)
    if (!Number.isFinite(timeout) || timeout <= 0) return
    const timer = setTimeout(() => { this.#onIdle(entry, session, timeout) }, timeout)
    timer.unref?.()
    session.idleTimer = timer
  }

  /**
   * Arm the timer that watches the free memory of the machine.
   *
   * The policy 'onMemoryPressure' releases the language server when the
   * machine runs out of memory - not after a fixed time. The check reads
   * the same memory probe the gate uses, and the interval is short enough
   * to be useful and long enough to be cheap.
   * @param {object} entry the root entry
   * @param {object} session the session
   */
  #armPressureTimer(entry, session) {
    this.#clearPressureTimer(session)
    const lsp = session.lsp ?? DEFAULT_LSP_SETTINGS
    const configured = Number(lsp.idleTimeoutMs)
    const interval = Number.isFinite(configured) && configured > 0
      ? Math.min(PRESSURE_CHECK_MAX_MS, Math.max(PRESSURE_CHECK_MIN_MS, configured))
      : PRESSURE_CHECK_MAX_MS
    const timer = setInterval(() => { this.#checkMemoryPressure(entry, session) }, interval)
    timer.unref?.()
    session.pressureTimer = timer
  }

  /**
   * The memory of the machine dropped below the hard floor.
   *
   * The server is released then: the machine needs the memory more than
   * the project needs the index. The release is not a failure - the server
   * comes back with the first request (IDLE-02).
   * @param {object} entry the root entry
   * @param {object} session the session
   */
  #checkMemoryPressure(entry, session) {
    try {
      if (entry.session !== session) return
      if (session.state !== 'ready' && session.state !== 'building') return
      const lsp = session.lsp ?? DEFAULT_LSP_SETTINGS
      const memory = this.#readMemory()
      const standbyBytes = Number.isFinite(memory.standbyBytes) && memory.standbyBytes > 0
        ? memory.standbyBytes
        : 0
      const freeBytes = Math.max(0, memory.freeBytes - standbyBytes)
      const hardFloorMB = Number.isFinite(lsp.memoryHardFloorMB) && lsp.memoryHardFloorMB >= 0
        ? lsp.memoryHardFloorMB
        : MEMORY_HARD_FLOOR_MB
      if (freeBytes >= hardFloorMB * 1024 * 1024) return
      this.#safely(this.#exitIdle(entry, session, PRESSURE_EXIT_DETAIL), 'the memory pressure release')
    } catch (error) {
      // The check runs in an interval: a throw here is an uncaught
      // exception and would end the DSH host process.
      this.#ctx?.logger?.warn?.('lsp: the memory pressure check failed: %s', messageOf(error))
    }
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
    const timer = setInterval(() => { this.#checkTimeouts(entry, session, timeout) }, interval)
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
      this.#transition(session, 'degraded', this.#degradationDetail(reason, 'the automatic restart failed'))
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
      this.#transition(session, 'degraded', this.#degradationDetail(reason, 'the automatic restart is switched off in the settings'))
      return
    }
    if (session.restarts >= 1) {
      this.#transition(session, 'degraded', this.#degradationDetail(reason, 'the automatic restart budget (1) is used up'))
      return
    }
    // The memory is checked again before the restart: the crash may well have
    // been an out-of-memory kill (PRD §2.7). A server the user forced once
    // is not stopped by the check again.
    if (!session.force) {
      const resources = this.#resourcesSnapshot(session.memoryLimitMB, session.languageId, lsp)
      session.resources = resources
      if (resources.belowHardFloor) {
        this.#transition(session, 'degraded', this.#degradationDetail(reason, `there is not enough free memory to restart it (needs ${toMb(resources.thresholdBytes)} MB, ${toMb(resources.availableBytes)} MB available)`))
        return
      }
      if (resources.tight) {
        this.#transition(session, 'degraded', this.#degradationDetail(reason, `the free memory is tight for the restart (${toMb(resources.availableBytes)} MB available, ${resources.needMB} MB expected, ${toMb(resources.softThresholdBytes)} MB recommended)`))
        return
      }
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
    if (!session.force) {
      const resources = this.#resourcesSnapshot(session.memoryLimitMB, session.languageId, lsp)
      session.resources = resources
      if (resources.belowHardFloor) {
        this.#transition(session, 'degraded', `there is not enough free memory to restart the language server (needs ${toMb(resources.thresholdBytes)} MB, ${toMb(resources.freeBytes)} MB available). Lower the memory limit in the settings, turn this language off, or use the conservative mode.`)
        return
      }
      if (resources.tight) {
        this.#transition(session, 'degraded', `the free memory is tight for the restart of the language server (${toMb(resources.freeBytes)} MB available, ${resources.needMB} MB expected, ${toMb(resources.softThresholdBytes)} MB recommended). Start it again to continue, or use the conservative mode.`)
        return
      }
    }
    // The documents the new server does not know yet (see
    // `#reopenDocuments`).
    const announced = new Set(entry.documents.keys())
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
    // more (MEM-02).
    this.#sessions.delete(session)
    this.#releaseReservation(session)
    this.#clearIdleTimer(session)
    this.#clearPressureTimer(session)
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
   * Clear the memory pressure timer of one session.
   * @param {object} session the session
   */
  #clearPressureTimer(session) {
    if (session.pressureTimer !== null && session.pressureTimer !== undefined) {
      clearInterval(session.pressureTimer)
      session.pressureTimer = null
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
    if (session.pressureTimer !== null && session.pressureTimer !== undefined) {
      clearInterval(session.pressureTimer)
      session.pressureTimer = null
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
