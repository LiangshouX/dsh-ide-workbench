/**
 * The workbench store: one shared repository snapshot behind all four tool
 * windows (Project / Commit / Git / Terminal).
 *
 * The store lives for the lifetime of the plugin fiber (created in `apply`),
 * not for the lifetime of the rendered panel, so switching back to the
 * Conversation and returning keeps tabs, expanded folders and layout.
 */
import { call as hostCall } from './api.js'
import { isMarkdownFile } from './file-types.js'
import {
  DEFAULT_CHANGELIST, assignChangelist, changelistOf, isEntryChecked, splitCommitGroups, checkedPathsOf,
} from './commit-model.js'
import { baseName, debounce, dirName, formatGitDate } from './util.js'
import {
  fileAddressFor, fileUrlForPath, isAmbiguousLinkPath, parseFileAddress, relativeLinkCandidateEntries, resolveFileAddress,
} from './file-address.js'
import { openInDefaultSidebar } from './file-link.js'
import {
  composeCodeReference, formatFileMention, insertChatText,
} from './chat-bridge.js'
import { isPathWithin, relativePathWithin, sameScopePath, sessionCwdOf } from './workspace-scope.js'
// The client session is the other half of the truth about the semantic
// analysis: the host knows whether the language server PROCESS is up, the
// client knows whether the link to it works. The import graph is acyclic -
// `lsp-session.js` imports the workspace and the API, not the store.
import { LSP_HOST_HEALTHY_STATES, reconnectLsp as reconnectLspSession, reportLspFocus, setLspLanguageHint, shutdownHostLspAwaited } from './lsp-session.js'
// The language of the file on the screen is reported to the host with
// `lsp.start`. `languageIdForPath` maps the extension, and the list of ids
// that have a server is the same one the host registry is built from - the
// two halves must not disagree about what can be started (PRD-v5.1 JS-04).
import { languageIdForPath } from './lsp-uri.js'
import { LSP_LANGUAGE_IDS } from '../host/settings-defaults.js'

let sequence = 0

/**
 * How long the cold entry waits before it lists the restored folders.
 *
 * The root is listed right away; the deeper levels follow a moment later, so
 * the tree paints before the workspace is read (PRD-v4 §1.2 PERF-07).
 */
const RESTORED_TREE_DELAY_MS = 200

/**
 * Development-only counters (PRD §1.3).
 *
 * `process.env.NODE_ENV` is inlined to `"production"` by the client build, so
 * every gate below folds to `false` and the whole block is dropped from a
 * production bundle: the counters are `null` and `window.__iwbPerf` does not
 * exist there. The gate is written out at each use site on purpose — only an
 * inline constant folds away without minification.
 */
export const perfCounters = process.env.NODE_ENV !== 'production'
  ? { notify: 0, git: 0, gitSubprocesses: 0, fs: 0, stores: 0 }
  : null

if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
  window.__iwbPerf = perfCounters
}

/**
 * One host call, counted for the development metrics.
 * @param {string} method
 * @param {Record<string, unknown>} [payload]
 * @param {AbortSignal} [signal]
 */
function call(method, payload = {}, signal) {
  if (process.env.NODE_ENV !== 'production' && perfCounters !== null) {
    if (method.startsWith('fs.')) perfCounters.fs += 1
    else if (method.startsWith('git.')) perfCounters.git += 1
  }
  return hostCall(method, payload, signal)
}

/** A process-local id for transient UI keys. */
export function nextId(prefix = 'id') {
  sequence += 1
  return `${prefix}-${sequence}`
}

/** Coarse file kind used for the welcome screen and icons. */
export function extOf(name) {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot).toLowerCase()
}

/** Whether a file opens in the rendered Markdown view by default. */
export function isMarkdownPath(path) {
  return isMarkdownFile(path)
}

/** Parent directory path (both separators). */
function parentPath(path) {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index <= 0 ? path : path.slice(0, index)
}

/** Join a workspace-relative path to an absolute root using the root's own separator. */
function joinPath(root, rel) {
  const separator = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]$/, '')}${separator}${String(rel).split('/').join(separator)}`
}

/** Human-readable message of any thrown value. */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Whether two git status snapshots say the same thing.
 *
 * The panels read the whole status object (`ProjectPanel`) or its entry list
 * (`CommitPanel`), so a brand new object on every poll wakes them every two
 * seconds - even in an empty repository that did not change by a single byte
 * (PRD-v5 §7.2 PERF-01). The comparison therefore covers everything the
 * panels read: the branch, the detached flag, the counters and the per-file
 * status. The path set alone is not enough - a file can change its `xy`
 * status, or become staged, without the set of paths changing.
 *
 * The subprocess count of the call is deliberately not compared: it counts
 * the git processes of that one call and never says anything about the
 * repository.
 * @param {any} previous the snapshot the store holds
 * @param {any} next the snapshot the host just reported
 * @returns {boolean} whether the two snapshots are equivalent
 */
function sameGitStatus(previous, next) {
  if (previous === null || typeof previous !== 'object') return false
  if (next === null || typeof next !== 'object') return false
  if (previous.isRepo !== next.isRepo) return false
  if (previous.branch !== next.branch) return false
  if (previous.detached !== next.detached) return false
  if (previous.oid !== next.oid) return false
  if (previous.upstream !== next.upstream) return false
  if (previous.ahead !== next.ahead) return false
  if (previous.behind !== next.behind) return false
  if (previous.truncated !== next.truncated) return false
  if (previous.entryLimit !== next.entryLimit) return false
  if (previous.root !== next.root) return false
  const left = Array.isArray(previous.entries) ? previous.entries : []
  const right = Array.isArray(next.entries) ? next.entries : []
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    const before = left[index]
    const after = right[index]
    if (before.path !== after.path) return false
    if (before.xy !== after.xy) return false
    if (before.staged !== after.staged) return false
    if (before.unstaged !== after.unstaged) return false
    if (before.untracked !== after.untracked) return false
    if (before.conflict !== after.conflict) return false
    if (before.ignored !== after.ignored) return false
    if (before.stagedLines !== after.stagedLines) return false
    if (before.unstagedLines !== after.unstagedLines) return false
  }
  return true
}

/**
 * Whether one link path is a plain relative path (no leading slash at all).
 *
 * The ambiguous shape — exactly one leading slash — is decided by
 * `isAmbiguousLinkPath`; a drive-letter or UNC path is absolute and produces
 * no candidates at all.
 * @param {unknown} path
 * @returns {boolean}
 */
function isPlainRelativeLinkPath(path) {
  if (typeof path !== 'string' || path === '') return false
  return !path.replace(/\\/g, '/').startsWith('/')
}

/**
 * Editor buffers are CRLF-agnostic: CodeMirror always hands back `\n`, while a
 * CRLF file on disk reads back as `\r\n`. Comparing the two spellings marks a
 * just-saved file as "changed on disk", so both sides of every dirty/conflict
 * comparison go through this normalizer.
 */
export function normalizeNewlines(text) {
  return typeof text === 'string' ? text.replace(/\r\n/g, '\n') : text
}

/** The initial state, also the shape persisted UI is merged into. */
function initialState() {
  return {
    phase: 'booting',
    active: false,
    error: null,
    fatal: null,
    /** The DSH workspace root (the outer boundary). */
    workspaceRoot: '',
    /** The selected IDE project root (workspace root or a first-level child). */
    root: '',
    /** The repository the Git window reads (GIT-01); the Project root by default. */
    gitRepoRoot: '',
    /** The candidate repositories of the Git window. */
    gitRepos: [],
    /** Root + first-level folders offered by the project picker. */
    projects: [],
    projectPicker: false,
    home: '',
    workspaces: [],
    settings: null,
    status: { isRepo: false, entries: [], branch: undefined, detached: false, ahead: undefined, behind: undefined, root: null },
    statusError: null,
    statusAt: 0,
    /** True while the cached status is older than the last poll tick. */
    statusStale: false,
    /**
     * True while the mirrored language-server status is unknown (PRD-v5 §2.3).
     *
     * The status bar shows "unknown (retrying…)" instead of an old value:
     * a failed poll must not keep presenting the last snapshot as if it were
     * current.
     */
    lspStatusStale: false,
    layout: { left: 'project', leftWidth: 300, bottom: null, bottomHeight: 270, gitDrawerWidth: 420 },
    /** True while the pane is too narrow for side-by-side docks (CSS + JS agree). */
    stacked: false,
    dirs: new Map(),
    expanded: new Set(),
    selectedPath: '',
    selectedPaths: new Set(),
    anchorPath: '',
    clipboard: null,
    filter: '',
    /** 'files' = whole-project quick locate; 'tree' = expanded-tree filter. */
    filterMode: 'files',
    /** Whole-project file index (workspace-relative, forward slashes). */
    fileIndex: [],
    fileIndexRoot: '',
    fileIndexLoading: false,
    fileIndexError: null,
    /** Quick Open overlay. */
    quickOpen: false,
    quickOpenQuery: '',
    quickOpenIndex: 0,
    tabs: [],
    activeId: null,
    search: {
      query: '',
      caseSensitive: false,
      wholeWord: false,
      regexp: false,
      /**
       * True while the results come from the text version of Find Usages.
       * Every hit then carries a "text match" label, so the user never
       * mistakes a text hit for a semantic reference (PRD-v5 §5.3).
       */
      textMatch: false,
      loading: false,
      error: null,
      results: [],
      tookMs: 0,
      truncated: false,
      token: 0,
    },
    /**
     * The mirrored language-server status (PRD-v5 §4.3).
     *
     * The host owns the truth: the client only mirrors the last snapshot it
     * read from `lsp.status` and never derives a state of its own.
     */
    lsp: {
      /** False when the master switch in the settings is off. */
      enabled: true,
      /** 'idle' | 'starting' | 'building' | 'ready' | 'failed' | 'cancelled' | 'crashed' | 'degraded' | 'disabled' */
      state: 'idle',
      languageId: '',
      serverId: '',
      source: null,
      /** The host's explanation of the current state (shown as a tooltip). */
      detail: null,
      /** The progress text of a running build. */
      progress: '',
      /** When the current build started (epoch ms, 0 when unknown). */
      startedAt: 0,
      /** Whether the host accepts `lsp.cancelIndex` right now. */
      cancellable: false,
      /** The roots the host knows about, as reported by `lsp.status`. */
      indexedRoots: [],
      /**
       * The roots a language server runs for RIGHT NOW (`lsp.status`).
       *
       * `indexedRoots` is a historical fact ("this root completed a first
       * build"), this list is the live one ("a server runs for this root
       * now"). The badge of the project picker needs both: a root that was
       * indexed once and whose server was reclaimed is NOT the same as a
       * root whose server is running (PRD-v5.1 CONC-05).
       *
       * It is an empty array when the host does not report it (an older
       * host) - the client then falls back to the state of the project it
       * is on, which is the one root it talks to.
       */
      liveRoots: [],
      /**
       * The state of the CLIENT session: 'idle' | 'starting' | 'ready' |
       * 'failed'.
       *
       * The host's status says that the language server PROCESS is up; it
       * says nothing about the link between the browser and the server. The
       * two never check each other, and the status bar believed the host: it
       * said "ready" while the semantic features were completely dead.
       *
       * 'idle' means THERE IS NO SESSION - and that is the state a fresh
       * store starts in: the workbench has not connected to anything yet, so
       * "starting" would be a lie (the bar said "connecting…" while nothing
       * was connecting, 专项 F1). The session reports its own state as soon
       * as it exists.
       */
      clientState: 'idle',
      /** The reason of the last failure of the client session. */
      clientDetail: '',
      /**
       * The root the program of the project is built for.
       *
       * The host reports it: it is the project root itself most of the time,
       * and the nearest sub-project when the root is a workspace with several
       * projects in it (PRD-v5 §4.2). The client only mirrors it, so the
       * workspace fence can be narrowed to the directory the program really
       * covers. It is a string or `null` - never `undefined`.
       */
      scopeRoot: null,
      /**
       * The identity of the running language-server process.
       *
       * The host publishes it: the number changes with every new process, so
       * the client can see that the language server was replaced (review T1).
       * It is 0 while no server runs.
       */
      processId: 0,
      /**
       * True while the program of the project is still being built.
       *
       * The session state says "ready" long before the program is built - the
       * server answers `initialize` in milliseconds and the build takes
       * minutes. Without this flag the status bar would say "ready" while the
       * editor waits for the first semantic request (review T7).
       */
      buildingProgram: false,
      /** The language-server registry (`lsp.servers`), fetched once per language. */
      servers: { available: [], missing: [] },
      /**
       * The health of the semantic features on the client side.
       *
       * The host owns the state machine, but it cannot see a request that
       * timed out: only the client knows that the server stopped answering.
       * Without this counter the status bar kept saying "ready" while every
       * semantic request failed (PRD-v5 supplement, MEM-03).
       */
      /** Consecutive failed semantic requests (a success resets it). */
      consecutiveFailures: 0,
      /** Consecutive timed-out semantic requests. */
      consecutiveTimeouts: 0,
      /** The last semantic failure: `{ message, at }`. */
      lastFailure: null,
      /** The host's memory snapshot (`lsp.resources`), when it was fetched. */
      resources: null,
      /** The last lines the language server wrote to stderr. */
      stderrLines: [],
      /** True while the workbench is rebuilding the index. */
      rebuilding: false,
    },
    /**
     * The Find in Files popup (PRD-v5 supplement, FIND-01).
     *
     * The results live in the `search` slice - the two entries (Find in Files
     * and the text version of Find Usages) share them and differ only in
     * `search.textMatch`. The popup itself is a float above the editor, so
     * a search never takes a tab away from the code.
     */
    searchPopup: {
      open: false,
      /** The index of the selected hit in the flattened hit list. */
      index: 0,
      /**
       * Bumped every time the popup opens.
       *
       * The popup takes its query from the store when it mounts, so the
       * generation remounts it: a popup that opens with a new query (the
       * identifier of "find usages") never shows the query of the last
       * session for a moment.
       */
      generation: 0,
    },
    /**
     * The pending index decision (PRD-v5 §2.3).
     *
     * `null` while no dialog is open; otherwise the data the dialog renders
     * (the project it is about and whether it is the workspace root).
     */
    indexDecision: null,
    /**
     * The pending memory warning (PRD-v5 §2.3, MEM-02).
     *
     * `null` while no dialog is open; otherwise the numbers the dialog
     * renders (the free memory, the estimated need and the language).
     */
    memoryDecision: null,
    commit: {
      message: '',
      amend: false,
      messages: [],
      messagesLoading: false,
      committing: false,
      /** True while a push is running (it may take a minute). */
      pushing: false,
      error: null,
      mode: 'side',
      /** Explicitly checked / unchecked paths (checkbox = include in commit). */
      checked: new Set(),
      unchecked: new Set(),
      /** Paths that stay in the Unversioned group after `git add`. */
      buckets: {},
      /** Untracked paths that are added to the index when the commit is made. */
      pendingStage: new Set(),
      /** Selected row for the Change View double-click. */
      selectedPath: '',
      /** Pre-commit tasks the user enabled (only shown when configured). */
      tasks: { tests: false, optimize: false, cleanup: false },
    },
    git: {
      commits: [],
      skip: 0,
      hasMore: true,
      loading: false,
      error: null,
      filters: { branch: '', author: '', query: '', path: '', since: '' },
      branches: [],
      /** Set once the status tells us the current branch, so the log can default to it. */
      branchInitialized: false,
      selectedHash: null,
      /** Commits picked with Ctrl+click for Compare (max 2). */
      compare: [],
      detail: null,
      detailHash: null,
      detailLoading: false,
    },
    terminal: {
      sessions: [],
      activeKey: null,
      shells: [],
      shellsLoaded: false,
    },
    rootPicker: false,
    confirm: null,
    toast: null,
    /** Cursor position of the active text editor ({ line, col }), for the status bar. */
    cursor: null,
    /** Bumped when Project should take keyboard focus (Alt+1). */
    treeFocusTick: 0,
    localeTick: 0,
  }
}

/**
 * The advice for a crashed language server.
 *
 * The host sends the FACT (why the server died); what the user can do about
 * it depends on the reason. A timeout is a timeout - the single-request
 * limit is the setting to raise - and the memory is only the answer when
 * the machine really ran out of it. A toast that blames the memory sends
 * the user to a setting that cannot help.
 * @param {string} detail the reason the host reported
 * @param {(key: string) => string} t the translation helper
 * @returns {string} the advice
 */
export function crashAdviceFor(detail, t) {
  const text = typeof detail === 'string' ? detail.toLowerCase() : ''
  if (text.includes('timeout')) return t('lsp.crashedTimeout')
  // The BUDGET of MEM-08 is not the free memory of the machine: it is the
  // share of the ceilings that the running servers hold. Closing other
  // programs does not give it back - releasing a server or raising the
  // budget does. The detail of the budget refusal contains the word
  // "memory", and the memory advice was sent for it (review R6, N3).
  //
  // The keyword is the MEMORY budget: the restart budget of the crash chain
  // is a different thing, and its detail keeps the generic advice.
  if (text.includes('memory budget')) return t('lsp.crashedBudget')
  if (text.includes('memory') || text.includes('out of memory')) return t('lsp.crashedMemory')
  return t('lsp.crashedGeneric')
}

/**
 * The host states that mean the semantic features are broken.
 *
 * A crash and a degradation are the two states the user has to learn about
 * (PRD-v5 §1.5 VIS-04): the toast tells the user that the semantic analysis
 * stopped working and why.
 */
const LSP_FAULT_STATES = ['crashed', 'degraded']

/**
 * The host states that mean the language server is healthy again.
 *
 * A fault episode ends with one of them: the next fault is a new episode and
 * gets its own toast. `restarting` and `cancelling` are deliberately NOT in
 * the list - the host walks `crashed → restarting → degraded` inside one
 * millisecond window, so clearing the flag there would produce two toasts
 * for one fault.
 */
const LSP_RECOVERED_STATES = ['starting', 'building', 'ready', 'idle', 'suspended']

/**
 * The host states whose progress the client reads from `lsp.index`.
 *
 * The host accepts a cancel in `starting` and in `restarting` as well (its
 * `CANCELLABLE_STATES`), and the cancel clock starts with the `starting`
 * state - so the client has to ask for the index in these states too, or the
 * user never sees the cancel button (PRD-v5 §2.4 STALE-03).
 */
const LSP_INDEX_STATES = ['starting', 'building', 'restarting']

/**
 * The answer of the host about one memory snapshot.
 *
 * The host publishes TWO fields about the same question: `decision` ('ok' |
 * 'tight' | 'low') is the authority, and `tight` is a flag that says the same
 * thing in the older shape. They answered differently for a whole round: the
 * `decision` carried the worst band while `tight` did not, so for a machine
 * with 2000 MB available the host said "tight" (the client asks the user)
 * and "not tight" (the host starts the server anyway). Two screens, one
 * snapshot, two answers - and the user was asked about a start that was
 * never in doubt.
 *
 * The rule is therefore: **read ONE field**. The `decision` of the host is
 * that field, and the flag is only the fallback for a host that does not
 * publish it yet. The order of the fallback is fixed, so a snapshot that has
 * both fields can never be read two ways.
 *
 * The helper is exported because the settings page shows the same snapshot:
 * it has to say the same word as the popup does for the same numbers.
 *
 * @param {object | null} resources the memory snapshot of the host
 * @returns {'ok'|'tight'|'low'} the answer of the host
 */
export function memoryDecisionOf(resources) {
  if (resources === null || resources === undefined) return 'ok'
  // The authority of the host. It is present in every snapshot of this
  // build, and it is the field the gate of the host uses as well.
  const published = typeof resources.decision === 'string' ? resources.decision : ''
  if (published !== '') return published
  // An older host: the flag says the same thing in the older shape, and
  // `canIndex` is the last resort.
  if (resources.tight === true) return 'tight'
  if (resources.canIndex === false) return 'low'
  return 'ok'
}

/**
 * One memory number in megabytes.
 *
 * The numbers of the snapshot are bytes, the numbers of the interface are
 * megabytes, and the comparison between two snapshots happens in megabytes:
 * the free memory of the machine jitters by a few kilobytes on every poll,
 * and a byte-level comparison would replace the snapshot on every poll.
 * @param {unknown} bytes the number of bytes
 * @returns {number} the number of megabytes, 0 when the number is unknown
 */
function megabytesOf(bytes) {
  return Math.round((Number.isFinite(bytes) ? bytes : 0) / (1024 * 1024))
}

export class WorkbenchStore {
  /**
   * @param {any} ctx client cordis context
   * @param {() => string} t bound translate function
   * @param {string} [preferredRoot] workspace root this store belongs to
   */
  constructor(ctx, t, preferredRoot = '') {
    this.ctx = ctx
    this.t = t
    this.preferredRoot = typeof preferredRoot === 'string' ? preferredRoot : ''
    this.state = initialState()
    this.listeners = new Set()
    this.pollTimer = null
    /** Timer of the background listing of the restored folders (PERF-07). */
    this.restoredTimer = null
    this.polling = false
    this.persist = debounce(() => { void this.#persist() }, 700)
    this.toastTimer = null
    /** Per-folder request generation, so a stale listing cannot win. */
    this.treeTokens = new Map()
    this.gitRequestToken = 0
    this.gitDetailToken = 0
    this.searchToken = 0
    this.searchIndex = -1
    this.settingsFile = ''
    this.initPromise = null
    this.unsubscribers = []
    /** Layout hidden by Ctrl+Shift+F12, restored by a second press. */
    this.hiddenLayout = null
    /** The dock group the user last opened ('left' or 'bottom'). */
    this.lastToolGroup = 'left'
    /** Timer of the language-server status poll (PRD-v5 §4.3). */
    this.lspPollTimer = null
    /**
     * Whether the current fault episode was already announced (PRD-v5 §1.5).
     *
     * The control event and the two-second poll can report the same crash,
     * and the host walks `crashed → restarting → degraded` inside one
     * millisecond window. The flag makes the two paths idempotent: one fault
     * episode, one toast.
     */
    this.lspFaultNotified = false
    /**
     * Whether the current failure episode of the CLIENT session was already
     * announced.
     *
     * The session of the client is a fault of its own: the host may be
     * perfectly healthy while the link between the browser and the server is
     * dead. The flag is separate from `lspFaultNotified`, so the two kinds of
     * fault do not swallow each other's toast.
     */
    this.lspSessionFaultNotified = false
    /** Resolver of the pending index decision, if a dialog is open. */
    this.indexDecisionResolve = null
    /** Resolver of the pending memory warning, if a dialog is open. */
    this.memoryDecisionResolve = null
    /** The languages whose server registry was already fetched. */
    this.lspServersChecked = new Set()
    /**
     * The index decision of every project of this session.
     *
     * The decision has to survive a project switch - the `lsp` slice is reset
     * on every switch - so it lives in the store and not in the state. The
     * client session asks for it before it builds a session: a project the
     * user sent to the basic mode must not get one (review P1-2).
     */
    this.lspIndexDecisions = new Map()
    /**
     * Whether the document visibility listener is registered.
     *
     * The listener belongs to the document and not to the panel, so it is
     * registered once for the lifetime of the store and removed again in
     * `dispose()`.
     */
    this.visibilityBound = false
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this.#onVisibilityChange)
      this.visibilityBound = true
    }
  }

  // ── subscription ──────────────────────────────────────────────────────
  subscribe = (listener) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * The listener of the document visibility.
   *
   * A hidden page cannot keep its cadence: the browser throttles the timers
   * of a background page to once a minute. A window that was minimised
   * therefore showed the status of a minute ago for up to a minute - and the
   * status bar said "unknown (retrying…)" even though the server was healthy.
   * The listener gives the window its status back as soon as it comes to
   * the front, instead of waiting for the throttled interval.
   */
  #onVisibilityChange = () => {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
    // The work a poll tick would have done: the git status and the
    // language-server status. The git poll only runs while the workbench is
    // the visible surface, and `pollStatus()` knows that.
    void this.pollStatus()
    void this.refreshLspStatus()
  }

  getSnapshot = () => this.state

  /**
   * The repository every git call works on (GIT-01).
   *
   * The Git window may read another repository than the Project tree, but the
   * two stay independent: only the git calls follow this root.
   */
  get gitRoot() {
    return this.state.gitRepoRoot || this.state.root
  }

  /**
   * Point the Git window at another repository.
   *
   * Only the Git window follows: the file tree, the project root and the open
   * tabs stay exactly as they are (PRD-v4 §4.1).
   * @param {string} path absolute repository root
   */
  async setGitRepoRoot(path) {
    if (typeof path !== 'string' || path === '') return
    if (sameScopePath(path, this.state.gitRepoRoot)) return
    this.set({
      gitRepoRoot: path,
      // The commit selection belongs to the repository it was made in
      // (PRD-v4 review M3): the old repository's paths must not be added to
      // the new one.
      commit: this.#resetCommitSelection(),
    })
    // The diff tabs belong to the old repository: they would show its
    // content against the new one (PRD-v4 review L3).
    this.#closeRepositoryTabs()
    // The Git window now reads another repository: its log, branches and
    // status are reloaded.
    await this.refreshStatus({ initial: true })
  }

  /** Close the tabs that belong to the repository the Git window reads. */
  #closeRepositoryTabs() {
    const index = this.state.tabs.findIndex(tab => tab.kind === 'diff')
    if (index < 0) return
    const ids = new Set(this.state.tabs.filter(tab => tab.kind === 'diff').map(tab => tab.id))
    const tabs = this.state.tabs.filter(tab => !ids.has(tab.id))
    let activeId = this.state.activeId
    if (ids.has(activeId)) {
      const next = tabs[Math.min(index, tabs.length - 1)]
      activeId = next?.id ?? null
    }
    this.set({ tabs, activeId })
  }

  /**
   * The repository the Git window reads by default.
   *
   * The Project root when it is a repository, otherwise the first candidate
   * repository of the workspace (PRD-v4 §4.1).
   * @param {string} projectRoot
   */
  #defaultGitRepoRoot(projectRoot) {
    const repos = this.state.gitRepos ?? []
    if (repos.some(repo => sameScopePath(repo.path, projectRoot))) return projectRoot
    const first = repos[0]
    return first?.path ?? projectRoot
  }

  /**
   * Replace state and notify (one render per change).
   *
   * A patch whose values are all `===` to the current state changes nothing,
   * so it neither replaces the state object nor wakes the subscribers: one
   * `set` costs one render only when something really changed. Reference
   * types (`Set`, `Map`, arrays) compare by reference, as they always did.
   * @param {Record<string, unknown>} patch
   */
  set(patch) {
    if (patch === null || typeof patch !== 'object') {
      this.state = { ...this.state, ...patch }
      this.#notify()
      return
    }
    let changed = false
    for (const key of Object.keys(patch)) {
      if (this.state[key] !== patch[key]) {
        changed = true
        break
      }
    }
    if (!changed) return
    const previousLeft = this.state.layout?.left
    this.state = { ...this.state, ...patch }
    this.#notify()
    // The Commit window shows the per-file line counts, and those are only
    // fetched while it is visible: switching to it refreshes the status right
    // away instead of waiting for the next poll (PRD-v4 review L7).
    if (patch.layout?.left === 'commit' && previousLeft !== 'commit') {
      void this.refreshStatus({ silent: true, force: true })
    }
  }

  /** Wake every subscriber (one render). */
  #notify() {
    for (const listener of this.listeners) listener()
    if (process.env.NODE_ENV !== 'production' && perfCounters !== null) perfCounters.notify += 1
  }

  /**
   * Subscribe to one slice of the state.
   *
   * The callback runs only when the selected slice really changed, so a
   * panel that reads a few fields is not woken by every unrelated change.
   * @param {(state: any) => unknown} selector picks the slice
   * @param {(slice: unknown) => void} notify called with the new slice
   * @param {(left: unknown, right: unknown) => boolean} [isEqual]
   * @returns {() => void} unsubscribe
   */
  subscribeSlice(selector, notify, isEqual = Object.is) {
    let current = selector(this.state)
    const listener = () => {
      const next = selector(this.state)
      if (isEqual(current, next)) return
      current = next
      notify(next)
    }
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Patch one nested slice. */
  patch(key, patch) {
    this.set({ [key]: { ...this.state[key], ...patch } })
  }

  /** Show a transient toast. */
  toast(kind, text, detail, action) {
    const id = nextId('toast')
    this.set({ toast: { id, kind, text, detail: detail ?? '', action: action ?? null } })
    if (this.toastTimer !== null) clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null
      if (this.state.toast?.id === id) this.set({ toast: null })
    }, kind === 'error' ? 9000 : 4500)
  }

  /** Ask the user to confirm one destructive action. */
  askConfirm(title, body, confirmLabel, onConfirm, danger = true) {
    this.set({
      confirm: {
        title,
        body,
        confirmLabel,
        cancelLabel: this.t('common.cancel'),
        danger,
        onConfirm,
      },
    })
  }

  /**
   * A dialog with an explicit action list (save / discard / cancel, etc.).
   * The first action is focused, so `Enter` never triggers the destructive one.
   * @param {string} title
   * @param {string} body
   * @param {Array<{key: string, label: string, action: Function, primary?: boolean, danger?: boolean}>} actions
   */
  askChoice(title, body, actions) {
    this.set({
      confirm: {
        title,
        body,
        actions: Array.isArray(actions) ? actions : [],
      },
    })
  }

  dismissConfirm() {
    this.set({ confirm: null })
  }

  // ── boot ──────────────────────────────────────────────────────────────
  /**
   * Load settings and the workspace once. Concurrent callers share the same
   * promise; a failed boot is retried by the Workbench's Retry action.
   * @returns {Promise<void>}
   */
  init() {
    if (this.initPromise !== null && this.state.fatal === null) return this.initPromise
    if (this.state.fatal !== null) this.set({ phase: 'booting', fatal: null })
    this.initPromise = this.#runInit()
    return this.initPromise
  }

  async #runInit() {
    this.unsubscribers.push(this.ctx.locale.subscribe(() => {
      this.set({ localeTick: this.state.localeTick + 1 })
    }))
    try {
      const settingsResult = await call('settings.get')
      this.settingsFile = settingsResult.file
      const workspaces = await call('workspace.list')
      const settings = settingsResult.value
      // A workspace-scoped store boots at the active Session's cwd, so the
      // conversation and the IDE show the same project. Without one (the
      // settings page store, or an older host) fall back to the old policy.
      const preferred = this.preferredRoot !== '' ? this.preferredRoot : this.#pickRoot(settings, workspaces)
      const savedProject = preferred !== undefined ? settings?.projectRoots?.[preferred] : undefined
      // The settings (and therefore the persisted workspace state) belong to
      // the store before the ROOT is set: setting the root creates the client
      // session synchronously, and its `lsp.scope` request is the first thing
      // that needs the language. Priming after that set is too late - the
      // session subscriber has already asked for the scope, and the second
      // `set({ root })` below is normally a no-op for an unchanged root.
      this.set({
        settings,
        workspaces: workspaces.items,
        home: workspaces.defaultDirectory ?? '',
        workspaceRoot: preferred ?? '',
      })
      const initialRoot = typeof savedProject === 'string' && savedProject !== '' ? savedProject : (preferred ?? '')
      if (initialRoot !== '') this.#primeLspLanguageHint(initialRoot)
      this.set({ root: initialRoot, phase: 'ready' })
      if (preferred !== undefined && preferred !== '') {
        await this.loadProjects(preferred)
        const projectRoot = this.#projectRootFor(preferred)
        // The hint goes in before the root: setting the root creates the
        // client session, whose `lsp.scope` request is the first thing that
        // needs the language (the handshake `rootUri` of a polyglot root).
        this.#primeLspLanguageHint(projectRoot)
        this.set({ root: projectRoot, gitRepoRoot: this.#defaultGitRepoRoot(projectRoot) })
        // The project is restored, not switched: the index decision does not
        // run here. A decision the user has already expressed still does
        // (review R7-1).
        void this.#startLspForRestored(projectRoot)
        this.#restoreWorkspace(projectRoot)
        void this.loadRestoredTree({ lazy: true })
        this.patch('commit', { mode: settings?.editor?.sideBySide === false ? 'unified' : 'side' })
        void this.refreshStatus({ initial: true })
        void this.refreshShells()
        if (settings?.lastRoot === undefined || settings.lastRoot === '') {
          // First run: remember the chosen root so the next launch opens the
          // same workspace. Later activations must NOT rewrite lastRoot: an
          // in-flight init from a hot reload could otherwise overwrite a root
          // the user just switched to.
          this.state.settings = { ...(this.state.settings ?? settings), lastRoot: preferred }
          void call('settings.update', { patch: { lastRoot: preferred } })
            .then((result) => { this.state.settings = result.value })
            .catch(() => {})
        }
      } else {
        this.set({ rootPicker: true })
      }
    } catch (error) {
      this.set({ phase: 'ready', fatal: error instanceof Error ? error.message : String(error) })
    }
  }

  /** Ensure the store is booted; safe to call from a chat file-link bridge. */
  async ensureInit() {
    if (this.state.phase === 'ready' && this.state.root !== '') return true
    await this.init()
    return this.state.phase === 'ready' && this.state.root !== ''
  }

  /**
   * Resolve and open one `dsh-resource://file/…` link in the workbench.
   *
   * A chat link can name three places:
   * - a file inside the selected IDE project → open it;
   * - a file inside the DSH workspace but outside the selected IDE project
   *   (for example the IDE project is a first-level sub-folder) → report
   *   `needs-project-switch` so the caller can ask before widening the IDE
   *   project to the workspace root;
   * - a file outside the workspace → report `outside-workspace`; the caller
   *   hands it to DSH's own sidebar instead of erroring.
   *
   * A relative link may also name a file of the IDE project root without
   * saying so (PRD-v4 §7.6.2): the absolute reading is tried first and the
   * relative candidates → project root, Session cwd, workspace root → get
   * their turn when the link does not resolve.
   *
   * The chat's own file opener resolves a path against the viewing Session's
   * workspace and hands the address to `sidebarRight.openResource`; this method
   * turns that address into an absolute path and reveals it in the Project tree
   * at the requested line.
   *
   * @param {string} address the resource address
   * @param {{ line?: number, switchProject?: boolean }} [options] `switchProject`
   *   agrees to widen the IDE project to the workspace root
   * @returns {Promise<{
   *   status: 'opened' | 'needs-project-switch' | 'outside-workspace' | 'dirty' | 'failed',
   *   absolute?: string,
   * }>}
   */
  async openExternalFile(address, options = {}) {
    const parsed = parseFileAddress(address)
    if (parsed === undefined) return { status: 'failed' }
    if (!(await this.ensureInit())) return { status: 'failed' }
    const linkCwd = parsed.scope === 'session'
      ? sessionCwdOf(this.ctx, parsed.sessionId)
      : ''
    const cwd = linkCwd || this.state.workspaceRoot
    const absolute = resolveFileAddress(parsed, cwd)
    if (absolute === undefined) return { status: 'failed' }
    const workspace = this.state.workspaceRoot || cwd
    // Not inside the DSH workspace at all: this window must not claim it. The
    // caller falls back to DSH's own sidebar, which keeps its own security and
    // preview rules for files that live outside the project.
    if (workspace === '' || !isPathWithin(workspace, absolute)) {
      // One leading slash is the ambiguous shape: the link may name a file
      // relative to the project root, the Session cwd or the workspace root.
      // The absolute reading landed outside the workspace, so the relative
      // candidates get their turn → always inside the workspace fence.
      if (isAmbiguousLinkPath(parsed.path, this.state.workspaceRoot)) {
        const candidate = await this.#firstExistingCandidate(parsed)
        if (candidate !== undefined) return this.#openResolved(candidate, workspace, options)
      }
      return { status: 'outside-workspace', absolute }
    }
    if (this.#insideRoot(absolute)) {
      this.#revealInProject(absolute, options.line)
      return { status: 'opened', absolute }
    }
    // Inside the workspace but outside the current IDE project (the project is
    // a sub-folder). A plain relative link may still name a file of the
    // project root, so the candidates are tried before the project is widened.
    if (isPlainRelativeLinkPath(parsed.path)) {
      const candidate = await this.#firstExistingCandidate(parsed)
      if (candidate !== undefined) return this.#openResolved(candidate, workspace, options)
    }
    if (this.state.tabs.some(tab => tab.dirty === true)) {
      return { status: 'dirty', absolute }
    }
    if (options.switchProject !== true) {
      return { status: 'needs-project-switch', absolute }
    }
    // The carrier tab asks for the switch from a surface where no workbench
    // is mounted, so the index dialog is skipped here (it would never be
    // answered). An already indexed folder still starts its server.
    const switched = await this.selectProject(workspace, { askIndex: false })
    if (switched === false || !this.#insideRoot(absolute)) {
      return { status: 'failed', absolute }
    }
    this.#revealInProject(absolute, options.line)
    return { status: 'opened', absolute }
  }

  /**
   * The fallback candidates of one chat link, in the order of PRD-v4 §7.4:
   * the IDE project root, then the Session cwd, then the workspace root.
   * @param {{ scope: string, sessionId?: string, path: string }} parsed
   * @returns {{ base: string, rel: string, absolute: string }[]}
   */
  #linkCandidates(parsed) {
    return relativeLinkCandidateEntries(parsed.path, [
      this.state.root,
      parsed.scope === 'session' ? sessionCwdOf(this.ctx, parsed.sessionId) : '',
      this.state.workspaceRoot,
    ])
  }

  /**
   * The first fallback candidate that exists on disk.
   *
   * Every candidate is fenced by the DSH workspace: a file outside it is never
   * opened here, whatever the link says. The host route is the second barrier →
   * it refuses a path that leaves its root again after `..` is resolved.
   * @param {{ scope: string, sessionId?: string, path: string }} parsed
   * @returns {Promise<string | undefined>} the absolute path of the winner
   */
  async #firstExistingCandidate(parsed) {
    const workspace = this.state.workspaceRoot
    if (workspace === '') return undefined
    for (const candidate of this.#linkCandidates(parsed)) {
      if (!isPathWithin(workspace, candidate.absolute)) continue
      try {
        // The host fence is the workspace, the same one the client uses: a
        // candidate that leaves its own base but stays inside the workspace
        // must not be rejected by the host (PRD-v4 review L2).
        await call('fs.stat', { root: workspace, path: candidate.absolute })
        return candidate.absolute
      } catch {
        // This candidate does not exist (or is not reachable): try the next
        // base. A link that names nothing at all stays with DSH's sidebar.
      }
    }
    return undefined
  }

  /**
   * Route one resolved absolute path to the workbench.
   * @param {string} absolute
   * @param {string} workspace the DSH workspace root
   * @param {{ line?: number, switchProject?: boolean }} options
   */
  async #openResolved(absolute, workspace, options) {
    if (this.#insideRoot(absolute)) {
      this.#revealInProject(absolute, options.line)
      return { status: 'opened', absolute }
    }
    if (this.state.tabs.some(tab => tab.dirty === true)) {
      return { status: 'dirty', absolute }
    }
    if (options.switchProject !== true) {
      return { status: 'needs-project-switch', absolute }
    }
    // No dialog here either: the caller cannot answer one.
    const switched = await this.selectProject(workspace, { askIndex: false })
    if (switched === false || !this.#insideRoot(absolute)) {
      return { status: 'failed', absolute }
    }
    this.#revealInProject(absolute, options.line)
    return { status: 'opened', absolute }
  }

  /** Reveal one file the workbench already accepted (tree + preview tab). */
  #revealInProject(absolute, line) {
    this.showTool('project')
    this.openFile(absolute, { preview: true, line })
  }

  /** The session-scoped resource address for one absolute path. */
  #sidebarAddressOf(path) {
    const sessionId = this.ctx.sidebarRight?.mounted?.getSnapshot()
    if (typeof sessionId !== 'string' || sessionId === '') return undefined
    const cwd = sessionCwdOf(this.ctx, sessionId) || this.state.workspaceRoot
    return fileAddressFor(sessionId, cwd, path)
  }

  /**
   * Open one file in DSH's own sidebar as a separate tab.
   *
   * The built-in `text` document preview renders text, Markdown, images, PDFs,
   * Office documents and HTML; naming it avoids the better-sidebar editor and
   * gives the product's own preview for HTML, which this workbench does not
   * render.
   * @param {string} path absolute file path
   * @returns {boolean} true when the sidebar accepted the open
   */
  openInSidebar(path) {
    if (typeof path !== 'string' || path === '') return false
    const address = this.#sidebarAddressOf(path)
    const opened = address !== undefined
      && openInDefaultSidebar(this.ctx, address, { kind: 'text', ownKind: 'ide-workbench' })
    if (!opened) {
      this.toast('error', this.t('sidebar.openFailed'), path)
      return false
    }
    return true
  }

  /** Open one file in the OS default browser (the Chrome button). */
  async openInDefaultBrowser(path) {
    if (typeof path !== 'string' || path === '') return false
    try {
      await call('shell.openExternal', { url: fileUrlForPath(path) })
      return true
    } catch (error) {
      this.toast('error', this.t('browser.openFailed'), errorMessage(error))
      return false
    }
  }

  // ── send to chat ─────────────────────────────────────────────────────
  /** The Session whose chat composer is on screen. */
  #chatSessionId() {
    try {
      const id = this.ctx?.sidebarRight?.mounted?.getSnapshot?.()
      return typeof id === 'string' ? id : ''
    } catch {
      return ''
    }
  }

  /** Workspace-relative path for an @ reference (forward slashes). */
  #chatRelPath(path) {
    const workspace = this.state.workspaceRoot
    if (workspace !== '' && isPathWithin(workspace, path)) {
      return String(path).slice(workspace.length).replace(/^[\\/]+/, '').split('\\').join('/')
    }
    return String(path).split('\\').join('/')
  }

  /** Insert one composed message into the composer, with feedback on failure. */
  #sendChatText(text, detail) {
    const sessionId = this.#chatSessionId()
    const sent = sessionId !== '' && insertChatText(sessionId, text)
    if (!sent) {
      this.toast('error', this.t('chat.unavailable'))
      return false
    }
    this.toast('success', this.t('chat.sent'), detail)
    return true
  }

  /**
   * Send one or more files / folders from the Project tree to the chat composer
   * as `@path` references.
   * @param {Array<{ path: string, isDir?: boolean }>} entries
   * @returns {boolean} whether the composer accepted the references
   */
  sendToChat(entries) {
    const list = Array.isArray(entries) ? entries : []
    const mentions = []
    for (const entry of list) {
      if (entry === null || typeof entry !== 'object' || typeof entry.path !== 'string') continue
      const mention = formatFileMention(this.#chatRelPath(entry.path), entry.isDir === true)
      if (mention !== undefined) mentions.push(mention)
    }
    if (mentions.length === 0) return false
    return this.#sendChatText(`${mentions.join(' ')} `, mentions.join(' '))
  }

  /**
   * Send a code selection to the chat composer: the file reference, the line
   * range and the selected code in a fenced block.
   * @param {{ path: string, rel?: string, text: string, fromLine: number, toLine: number }} selection
   * @returns {boolean}
   */
  sendSelectionToChat(selection) {
    const path = selection?.path
    if (typeof path !== 'string' || path === '') return false
    const mention = formatFileMention(this.#chatRelPath(path), false)
    if (mention === undefined) return false
    const text = composeCodeReference({
      mention,
      text: selection.text,
      fromLine: selection.fromLine,
      toLine: selection.toLine,
      path,
    })
    const name = selection.rel !== undefined && selection.rel !== '' ? selection.rel : baseName(path)
    return this.#sendChatText(text, `${name}:${selection.fromLine}-${selection.toLine}`)
  }

  /** Whether one absolute path is inside the selected IDE project root. */
  #insideRoot(path) {
    return isPathWithin(this.state.root, path)
  }

  /** Choose the durable root: last used → most recent workspace → default dir. */
  #pickRoot(settings, workspaces) {
    const candidates = [settings?.lastRoot, workspaces.defaultRoot, workspaces.defaultDirectory]
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate !== '') return candidate
    }
    return workspaces.items[0]?.path
  }

  /**
   * Load the IDE project candidates (workspace root + first-level folders).
   * A failure is non-fatal: the workspace root is always a usable candidate.
   * @param {string} [workspaceRoot]
   */
  async loadProjects(workspaceRoot = this.state.workspaceRoot) {
    if (typeof workspaceRoot !== 'string' || workspaceRoot === '') return []
    let projects = []
    try {
      const result = await call('workspace.projects', { root: workspaceRoot })
      projects = Array.isArray(result?.projects)
        ? result.projects
            .filter(project => project !== null && typeof project === 'object' && typeof project.path === 'string')
            .map(project => ({
              path: project.path,
              name: typeof project.name === 'string' && project.name !== '' ? project.name : baseName(project.path),
              isRepo: project.isRepo === true,
              isRoot: project.isRoot === true || project.path === workspaceRoot,
              // The semantic-analysis status of the folder (PRD-v5 §2.1).
              // `indexed` is a historical fact: the folder completed a first
              // program build at some point in this profile.
              indexState: typeof project.indexState === 'string' && project.indexState !== '' ? project.indexState : 'unknown',
              indexedAt: Number.isFinite(project.indexedAt) ? project.indexedAt : null,
            }))
        : []
    } catch {
      projects = []
    }
    if (!projects.some(project => project.path === workspaceRoot)) {
      projects.unshift({
        path: workspaceRoot,
        name: baseName(workspaceRoot),
        isRepo: false,
        isRoot: true,
        indexState: 'unknown',
        indexedAt: null,
      })
    }
    // The Git window offers the repositories of the workspace (GIT-01); the
    // file tree keeps its own project list.
    const gitRepos = projects
      .filter(project => project.isRepo === true)
      .map(project => ({ path: project.path, name: project.name }))
    this.set({ projects, gitRepos })
    return projects
  }

  /** The persisted project root for a workspace, when the folder still exists. */
  #projectRootFor(workspaceRoot) {
    const saved = this.state.settings?.projectRoots?.[workspaceRoot]
    if (typeof saved === 'string' && this.state.projects.some(project => project.path === saved)) return saved
    return workspaceRoot
  }

  /** Persist the selected project immediately (does not wait for debounce). */
  #rememberProjectRoot(projectRoot) {
    const workspaceRoot = this.state.workspaceRoot
    if (workspaceRoot === '' || projectRoot === '') return
    const projectRoots = { ...(this.state.settings?.projectRoots ?? {}), [workspaceRoot]: projectRoot }
    this.state.settings = { ...(this.state.settings ?? {}), projectRoots }
    void call('settings.update', { patch: { projectRoots: { [workspaceRoot]: projectRoot } } })
      .then((result) => {
        // The host answers with the whole document. An answer without one
        // must not empty the settings of the store - the decision of the
        // workbench about the semantic analysis lives in them.
        if (result !== null && typeof result === 'object' && result.value !== null && typeof result.value === 'object') {
          this.state.settings = result.value
        }
      })
      .catch(() => {})
  }

  /** Switch the DSH workspace; its project root is restored from settings. */
  async setRoot(workspaceRoot) {
    if (typeof workspaceRoot !== 'string' || workspaceRoot === '') return
    if (workspaceRoot === this.state.workspaceRoot) return
    if (this.state.tabs.some(tab => tab.dirty === true)) {
      this.askConfirm(
        this.t('editor.unsavedTitle'),
        this.t('editor.unsavedSwitchRoot'),
        this.t('editor.discardChanges'),
        () => { void this.#switchWorkspace(workspaceRoot) },
      )
      return
    }
    await this.#switchWorkspace(workspaceRoot)
  }

  async #switchWorkspace(workspaceRoot) {
    // The root that is left. Its language server has to go before the new one
    // starts (WS-02): the gate of the host judges the start by the memory
    // that is really available, and a server that is still running holds a
    // reservation the new server would be charged for.
    const previousRoot = this.state.root
    await this.loadProjects(workspaceRoot)
    const projectRoot = this.#projectRootFor(workspaceRoot)
    this.set({
      workspaceRoot,
      root: projectRoot,
      gitRepoRoot: this.#defaultGitRepoRoot(projectRoot),
      projectPicker: false,
      dirs: new Map(),
      expanded: new Set(),
      selectedPath: '',
      filter: '',
      fileIndex: [],
      fileIndexRoot: '',
      quickOpen: false,
      tabs: [],
      activeId: null,
      status: initialState().status,
      git: { ...initialState().git },
      search: initialState().search,
      // The search popup belongs to the project that was left.
      searchPopup: initialState().searchPopup,
      // The language-server status belongs to the project that was left; the
      // server registry does not, so it survives the switch.
      lsp: { ...initialState().lsp, servers: this.state.lsp.servers },
      // The commit selection belongs to the repository it was made in
      // (PRD-v4 §3.2): it must not survive the switch.
      commit: this.#resetCommitSelection(),
    })
    // The workspace was switched, not the project: the index decision does
    // not run here. A decision the user has already expressed still does
    // (review R7-1).
    //
    // The old server goes first, and the answer of the host is awaited
    // (WS-02): the gate of the new server must not see the reservation of a
    // server that is still running. The switch of the client session does
    // the same for the project switch - both paths have to close the old
    // server before the new one starts, or the machine pays for two servers
    // at once.
    if (previousRoot !== '' && !sameScopePath(previousRoot, projectRoot)) {
      await shutdownHostLspAwaited(previousRoot)
    }
    void this.#startLspForRestored(projectRoot)
    this.#rememberProjectRoot(projectRoot)
    this.#restoreWorkspace(projectRoot)
    void this.loadRestoredTree({ lazy: true })
    await this.refreshStatus({ initial: true })
    void this.refreshShells()
    void this.loadLog(true)
    void this.persistNow()
  }

  /**
   * Switch the IDE project root inside the current workspace.
   *
   * @param {string} projectRoot
   * @param {{askIndex?: boolean}} [options] `askIndex: false` skips the index
   *   dialog. The file-link bridge uses it: it asks for the project switch
   *   from a carrier tab, where no workbench is mounted and the dialog could
   *   never be answered.
   * @returns {Promise<boolean>} whether the project was switched
   */
  async selectProject(projectRoot, options = {}) {
    if (typeof projectRoot !== 'string' || projectRoot === '') return false
    // Compare through `normalizeScopePath` so a session cwd spelled with a
    // different separator or drive-letter case still matches the project list.
    const project = this.state.projects.find(item => sameScopePath(item.path, projectRoot))
    if (project === undefined) return false
    if (sameScopePath(project.path, this.state.root)) {
      this.set({ projectPicker: false })
      return true
    }
    if (this.state.tabs.some(tab => tab.dirty === true)) {
      // The warning has to be above the project picker (LAYER-01) and it has
      // to say what is going to happen: three ways out, not two.
      const dirty = this.state.tabs.filter(tab => tab.dirty === true).length
      const target = typeof project.name === 'string' && project.name !== '' ? project.name : baseName(project.path)
      this.askChoice(
        this.t('editor.unsavedTitle'),
        this.#tpl('editor.unsavedSwitchRoot', { target, count: dirty }),
        [
          { key: 'cancel', label: this.t('common.cancel'), action: () => {} },
          {
            key: 'discard', label: this.t('editor.discardAndSwitch'), danger: true,
            action: () => { void this.#switchProjectWithIndex(project, options.askIndex !== false) },
          },
          {
            key: 'save', label: this.t('editor.saveAndSwitch'), primary: true,
            action: () => {
              void this.saveDirtyTabs().then(() => {
                // A save that failed must not lose the edits: the switch only
                // happens when every draft was written.
                if (this.state.tabs.some(tab => tab.dirty === true)) return
                void this.#switchProjectWithIndex(project, options.askIndex !== false)
              })
            },
          },
        ],
      )
      return false
    }
    return this.#switchProjectWithIndex(project, options.askIndex !== false)
  }

  /**
   * Switch the project, preceded by the index decision (PRD-v5 §2.3).
   *
   * The decision comes first: "Cancel" must leave the current project
   * untouched, so the switch may not happen before the user answered.
   * @param {{path: string, name?: string, isRoot?: boolean, isRepo?: boolean}} project
   * @param {boolean} ask whether the dialog may be shown
   * @returns {Promise<boolean>} whether the project was switched
   */
  async #switchProjectWithIndex(project, ask = true) {
    const decision = await this.#decideIndex(project, { ask })
    if (decision.choice === 'cancel') return false
    // The decision is recorded BEFORE the switch: the switch changes the root
    // and wakes the subscribers, and the client session asks the decision for
    // the new root right away (review P1-2).
    //
    // A decision the USER made is written to the settings document, so it
    // survives a workspace switch and a restart of DSH (PRD-v5.1 WS-04). A
    // decision the POLICY derived stays in the memory of the store - written
    // to the document it would take the choice away from the user, who could
    // never switch the index of that project off again.
    if (decision.remember === 'workspace' || decision.remember === 'both') {
      this.#rememberWorkspaceDecision(project.path, decision.choice)
    }
    if (decision.remember === 'memory' || decision.remember === 'both') {
      this.#rememberMemoryAnswer(project.path, 'conservative')
    }
    this.#rememberIndexDecision(project.path, decision.choice)
    await this.#switchProject(project.path)
    if (decision.choice === 'build') await this.#startLsp(project.path)
    if (decision.choice === 'build-forced') await this.#startLsp(project.path, { force: true })
    return true
  }

  /**
   * The one decision about a project root: does the workbench want a language
   * server for it?
   *
   * Both paths that can start a server go through this method - the project
   * switch (`ask: true`, the user may be asked) and the restore path
   * (`ask: false`, nothing is asked: a dialog at every start of DSH would be
   * unbearable). The last time the meaning of `force` changed, the host was
   * fixed first and the memory logic of the client was patched afterwards -
   * and one place was missed (PRD-v5.1 MEM-10). One helper, two callers, one
   * meaning:
   *
   *   - `force` belongs to ONE start. It is true only when the user answered
   *     the memory question of THIS start, and it is never remembered.
   *   - a decision the USER made is written to the settings
   *     (`lsp.workspaceDefaults`), so it survives a workspace switch and a
   *     restart of DSH.
   *   - a decision the POLICY derived stays in the memory of the store
   *     (`lspIndexDecisions`). Written to the document it would be
   *     indistinguishable from a decision of the user - and the user could
   *     never switch the index of that project off again (PRD-v5.1 WS-04
   *     requirement 4).
   *
   * The hierarchy (PRD-v5.1 WS-04 requirement 2):
   *
   *   1. the master switch (`lsp.enabled === false`) - the feature is off;
   *   2. the workspace-scoped default (`lsp.workspaceDefaults[scope]`) - it
   *      OUTRANKS the global policy `lsp.indexOnOpen`: a project whose user
   *      chose the basic mode stays in the basic mode even under
   *      `indexOnOpen: 'always'`, and a project whose user turned the
   *      semantic analysis on is not asked again;
   *   3. the global policy `lsp.indexOnOpen`;
   *   4. the memory answer of the user (`lsp.memoryWarnedRoots`) - it says
   *      "do not ask me again", never "you may force".
   *
   * Every answer of the user about the semantic analysis of a project is
   * written to the workspace-scoped default, and the memory answer only adds
   * the "do not ask me again" to it. The two can therefore never contradict
   * each other: the workspace-scoped default is the more recent word of the
   * user, and it is the one the client session asks about.
   *
   * @param {{path: string, name?: string, isRoot?: boolean, isRepo?: boolean}} project
   * @param {{ask?: boolean}} [options] `ask: false` skips the dialogs: a
   *   decision the restore path cannot ask for is a decision it does not take.
   * @returns {Promise<{choice: 'build'|'build-forced'|'conservative'|'cancel', remember: 'workspace'|'memory'|'both'|null}>}
   */
  async #decideIndex(project, options = {}) {
    const ask = options.ask !== false
    const lsp = this.state.settings?.lsp
    // A profile without the semantic-analysis section (a settings document
    // written before schema 3, or a host without the feature) has nothing to
    // start: the workbench stays in the conservative mode.
    if (lsp === null || lsp === undefined || typeof lsp !== 'object') {
      return { choice: 'conservative', remember: null }
    }
    // The master switch: the feature is off, so no language server is
    // started at all.
    if (lsp.enabled === false) return { choice: 'conservative', remember: null }
    // The workspace-scoped default of the user (PRD-v5.1 WS-04). It outranks
    // the global policy - this is the behaviour change of WS-04: before it,
    // the global 'always' outranked everything, and a project the user had
    // put into the basic mode was indexed behind their back.
    const workspace = this.#workspaceDefault(project.path)
    if (workspace === 'conservative') return { choice: 'conservative', remember: null }
    // The "never index" policy keeps the workbench in the conservative mode.
    if ((lsp.indexOnOpen ?? 'ask') === 'never') return { choice: 'conservative', remember: null }
    // The restore path cannot ask the user, so the decision of the workbench
    // has the last word: a project the user refused gets no server - not even
    // here. The client session asks the same question and must get the same
    // answer, or it would wait for a server that never comes.
    if (!ask && this.lspIndexDecision(project.path) === 'conservative') {
      return { choice: 'conservative', remember: null }
    }
    // The memory pre-check runs before every start the user is asked about
    // (PRD-v5 §2.2). It has three bands:
    //
    //   - enough memory      -> start
    //   - tight              -> ask the user (the host refuses to start
    //                           without an explicit "yes")
    //   - below the floor    -> degrade right away
    //
    // The old model had a single gate of 2 GB, so a YAML project on a
    // machine with 300 MB free could never start its server.
    //
    // The restore path does not ask, so it does not pre-check either: the
    // gate of the host is the authority there (a tight machine degrades the
    // session, a machine below the floor refuses the start), and the restore
    // path never forces anything.
    let resources = null
    if (ask) {
      resources = await this.#lspResources(project.path)
      // The host judges the snapshot and sends its answer with it. The client
      // renders that answer instead of judging the numbers a second time - two
      // sides that judge the same snapshot differently give the user two
      // different answers.
      //
      // The answer is read from ONE field (`decision`), with the older flag
      // only as the fallback for a host that does not publish it yet: the two
      // fields answered differently for a round, and the popup asked the user
      // about a start the host was going to make anyway (review A2).
      const decision = memoryDecisionOf(resources)
      if (decision === 'low') {
        // The threshold is the number the machine has to reach, not the
        // estimate of the language: "needs 96 MB, 200 MB available" reads
        // like a mistake, because the real gate is the hard floor.
        const need = Math.round((resources.thresholdBytes ?? 0) / (1024 * 1024))
        // The number of the toast is the one the gate judged by
        // (`availableBytes`, PRD-v5.1 MEM-09): the free memory of the
        // machine alone would say "plenty" while the gate says "not enough".
        const free = Math.round((resources.availableBytes ?? resources.freeBytes ?? 0) / (1024 * 1024))
        this.toast('error', this.#tpl('lsp.lowMemory', { need, free }), this.t('lsp.lowMemoryHint'))
        return { choice: 'conservative', remember: null }
      }
      if (decision === 'tight') {
        // The memory answer of the user: "do not ask me again" means the
        // basic mode. It NEVER means "you may force" - a remembered
        // permission to force would start the server on every tight moment,
        // for ever (PRD-v5.1 MEM-10).
        //
        // A project whose user wants the semantic analysis ('build') is asked
        // again: the permission to force is gone, and the tight band is the
        // one place where the user may overrule the gate.
        if (workspace !== 'build' && this.#memoryAnswer(project.path) === 'conservative') {
          return { choice: 'conservative', remember: null }
        }
        // The answer is not remembered as a permission: the next tight moment
        // asks again (PRD-v5.1 MEM-10). The trade-off is deliberate - the
        // "conservative" memory of the same map keeps the question from
        // becoming a nuisance.
        const choice = await this.#askMemoryDecision(project, resources)
        // The user wants the basic mode: that is a decision about the
        // semantic analysis of this project, and it is remembered as such.
        if (choice === 'conservative') return { choice: 'conservative', remember: 'both' }
        return { choice: 'build-forced', remember: 'workspace' }
      }
    }
    // The workspace-scoped default says "index this project": the user said
    // so once, and the question is not asked again.
    if (workspace === 'build') return { choice: 'build', remember: null }
    // An already indexed folder needs no question: the language server is
    // started right away (risk #26: the indexed path has no extra step).
    if (this.#isIndexed(project)) return { choice: 'build', remember: null }
    // The global policy: "always index" starts the server without a question.
    if ((lsp.indexOnOpen ?? 'ask') === 'always') return { choice: 'build', remember: null }
    // Without a dialog to answer it, the workbench stays conservative.
    if (!ask) return { choice: 'conservative', remember: null }
    const choice = await this.#askIndexDecision(project, resources)
    return { choice, remember: choice === 'cancel' ? null : 'workspace' }
  }

  /**
   * What the user answered the last time this project was tight.
   *
   * The map remembers ONE thing: "do not ask me again". The answer is
   * therefore either 'conservative' (the user wants the basic mode) or an
   * empty string (the user was never asked).
   *
   * A legacy 'accepted' (a document written before PRD-v5.1) is read as
   * 'conservative'. The old semantics remembered a PERMISSION to force the
   * start, and that permission was contagious: one click on "start anyway"
   * made every later tight moment of that project start the server without
   * asking - and the same happened on every workspace switch and every
   * restart of DSH. The new semantics have no such permission (MEM-10), so
   * the old value degrades to the safe one: the project falls back to the
   * basic mode instead of silently force-starting.
   * @param {string} root the project root
   * @returns {'conservative'|''}
   */
  #memoryAnswer(root) {
    const warned = this.state.settings?.lsp?.memoryWarnedRoots
    if (warned === null || warned === undefined || typeof warned !== 'object') return ''
    const key = Object.keys(warned).find(entry => sameScopePath(entry, root))
    if (key === undefined) return ''
    const answer = warned[key]
    if (answer === 'conservative') return 'conservative'
    // The legacy 'accepted' - see the note above.
    if (answer === 'accepted') return 'conservative'
    return ''
  }

  /**
   * The workspace-scoped default of one project root (PRD-v5.1 WS-04).
   *
   * The map lives in the settings document (`lsp.workspaceDefaults`), next to
   * `indexedRoots` and `memoryWarnedRoots`, and it holds what the USER
   * decided about the semantic analysis of that root: 'build' (the user
   * turned it on) or 'conservative' (the user chose the basic mode).
   *
   * `null` means "the user never decided" - the global policy then decides.
   * @param {string} root the project root
   * @returns {'build'|'conservative'|null}
   */
  #workspaceDefault(root) {
    const defaults = this.state.settings?.lsp?.workspaceDefaults
    if (defaults === null || defaults === undefined || typeof defaults !== 'object') return null
    const key = Object.keys(defaults).find(entry => sameScopePath(entry, root))
    if (key === undefined) return null
    const value = defaults[key]
    return value === 'build' || value === 'conservative' ? value : null
  }

  /**
   * Write the maps that remember the user, and undo the change when the host
   * does not take it.
   *
   * The store changes its own state first - the client session asks for the
   * decision right away, and a decision the user made must not wait for a
   * round trip - and asks the host to write the document afterwards. When
   * that write fails, the two sides disagree: the client says "index this
   * project", the document of the host still says "basic mode". The host
   * then keeps the basic mode while the user wonders why the button does
   * nothing, and nothing was written down (review N5).
   *
   * So a failed write takes the change back - and the rollback touches the
   * maps of THIS write and nothing else. The whole section would take the
   * changes of another round trip with it: the settings page moved the
   * budget share while this write was in flight, and the user would see
   * their own change disappear (review R3). A map that was not there before
   * the write is removed again - the host does not know it either.
   *
   * The rollback still goes through a `set`, so the subscribers are woken
   * and the client session re-reads the decision and agrees with the host
   * again. The failure is logged: a silent inconsistency is worse than a
   * visible failure.
   *
   * Both writes of the memory of the user go through this helper: the
   * workspace-scoped default and the memory answer are ONE decision in two
   * maps (PRD-v5.1 WS-04 / MEM-10), and they must not drift apart in the way
   * they report a failure.
   *
   * @param {object} patch the maps to write, as the `lsp` section of a patch
   * @param {object | null} previous the `lsp` section as it was before the change
   * @returns {void}
   */
  #writeLspSettings(patch, previous) {
    const lsp = this.state.settings?.lsp ?? {}
    this.set({ settings: { ...this.state.settings, lsp: { ...lsp, ...patch } } })
    void call('settings.update', { patch: { lsp: patch } })
      .catch(error => {
        console.warn('[lsp] the settings of the semantic analysis could not be written:', error instanceof Error ? error.message : error)
        // The document of the host did not take the change, so the maps of
        // this write go back to what that document says. Every other field of
        // the section keeps the value it has now - a change of another round
        // trip is not the business of this write.
        const current = this.state.settings?.lsp ?? {}
        const restored = { ...current }
        for (const key of Object.keys(patch)) {
          if (previous !== null && previous !== undefined && Object.hasOwn(previous, key)) {
            restored[key] = previous[key]
            continue
          }
          delete restored[key]
        }
        this.set({ settings: { ...this.state.settings, lsp: restored } })
      })
  }

  /**
   * Write the decision of the user about the semantic analysis of one root.
   *
   * The decision is written to the settings document, so it survives a
   * workspace switch and a restart of DSH - the memory of the client does
   * not (the store is evicted after three workspaces).
   *
   * Only a decision the USER made belongs here. A decision the policy
   * derived (the automatic start of the 'always' policy) stays in the memory
   * of the store: written here it would take the choice away from the user,
   * who could never switch the index of that project off again.
   *
   * The two maps that remember the user are written in ONE patch, and a
   * decision of 'build' clears the memory answer of that root. The reason is
   * the state the two sides had (review A4): the client read the
   * workspace-scoped default first, the host read the memory answer, and the
   * two said opposite things about the same project. The client said "index
   * it", the host said "basic mode" - so the server was started and then
   * never woken again after the next idle exit, and the semantic features
   * were dead for good. The user asked for a server, so the refusal has to
   * go with it.
   * @param {string} root the project root
   * @param {'build'|'build-forced'|'conservative'} choice the answer of the user
   */
  #rememberWorkspaceDecision(root, choice) {
    const decision = choice === 'build' || choice === 'build-forced' ? 'build' : 'conservative'
    // The section as it was BEFORE the change. The rollback needs it, and it
    // has to be the whole section: a shallow copy would share the very maps
    // that are about to change.
    const previous = this.state.settings?.lsp ?? null
    const lsp = this.state.settings?.lsp ?? {}
    const defaults = { ...(lsp.workspaceDefaults !== null && typeof lsp.workspaceDefaults === 'object' ? lsp.workspaceDefaults : {}), [root]: decision }
    const warned = { ...(lsp.memoryWarnedRoots !== null && typeof lsp.memoryWarnedRoots === 'object' ? lsp.memoryWarnedRoots : {}) }
    if (decision === 'build') {
      // The refusal of the user is overruled. The entry cannot be removed -
      // the host merges a patch into the document, and a map is merged key by
      // key - so it is overwritten with `null`, which both sides read as
      // "never asked" (the host skips every answer that is not
      // 'conservative', the client reads it as no answer at all).
      const key = Object.keys(warned).find(entry => sameScopePath(entry, root))
      if (key !== undefined) warned[key] = null
    }
    // ONE patch for both maps - the host has to take them together, or the
    // two markers of the same project say different things (review A4).
    this.#writeLspSettings({ workspaceDefaults: defaults, memoryWarnedRoots: warned }, previous)
  }

  /**
   * What the workbench decided about the language server of one project.
   *
   * The client session asks this before it builds a session: a project the
   * user sent to the basic mode must not get one at all. The host would
   * never start a server, the handshake would be held for ever, and the
   * client would give up after four rounds - with a red status bar and a
   * toast for a decision the user made on purpose (review P1-2).
   *
   * The answer is 'build' (a language server is wanted), 'conservative' (the
   * basic mode: no server) or 'unknown' (this session made no decision - the
   * caller decides then).
   *
   * The order of the sources is the hierarchy of PRD-v5.1 WS-04: the
   * workspace-scoped default of the user outranks the global policy
   * `lsp.indexOnOpen`. Before it, the global policy outranked everything and
   * a project the user had put into the basic mode was indexed behind their
   * back as soon as the policy said "always".
   * @param {string} root the project root
   * @returns {'build'|'conservative'|'unknown'}
   */
  lspIndexDecision(root) {
    if (typeof root !== 'string' || root === '') return 'unknown'
    const lsp = this.state.settings?.lsp
    // A profile without the semantic-analysis section has no answer to give:
    // the workbench did not decide anything about the project, and the caller
    // decides then. (In a real profile the section always exists - the
    // settings defaults fill it.)
    if (lsp === null || lsp === undefined || typeof lsp !== 'object') return 'unknown'
    // The master switch: the feature is off, so no language server is
    // started at all.
    if (lsp.enabled === false) return 'conservative'
    // The workspace-scoped default of the user - it outranks the global
    // policy in both directions (PRD-v5.1 WS-04 requirement 2).
    const workspace = this.#workspaceDefault(root)
    if (workspace === 'conservative') return 'conservative'
    if (workspace === 'build') return 'build'
    // The "never index" policy keeps the workbench in the conservative mode.
    if ((lsp.indexOnOpen ?? 'ask') === 'never') return 'conservative'
    // The user sent this project to the basic mode the last time the memory
    // was tight: the answer is remembered in the settings.
    if (this.#memoryAnswer(root) === 'conservative') return 'conservative'
    // The decision of this session. It is recorded before the switch, so it
    // is already there when the session asks for the new root.
    const recorded = this.#recordedIndexDecision(root)
    if (recorded !== null) return recorded
    // No decision was made in this session.
    return 'unknown'
  }

  /**
   * The workspace-scoped default of one project root (PRD-v5.1 WS-04).
   *
   * The public face of the private helper: the user interface asks it to
   * tell "the user chose the basic mode for this project" from "the host
   * simply has no server running".
   * @param {string} root the project root
   * @returns {'build'|'conservative'|null}
   */
  lspWorkspaceDefault(root) {
    if (typeof root !== 'string' || root === '') return null
    return this.#workspaceDefault(root)
  }

  /**
   * The index decision this session made for one project root.
   * @param {string} root the project root
   * @returns {'build'|'conservative'|null} null when there was no decision
   */
  #recordedIndexDecision(root) {
    for (const [key, decision] of this.lspIndexDecisions) {
      if (sameScopePath(key, root)) return decision
    }
    return null
  }

  /**
   * Remember the index decision of one project root.
   *
   * A cancelled decision changes nothing: the project was not switched, so
   * the old decision still holds.
   * @param {string} root the project root
   * @param {'build'|'build-forced'|'conservative'|'cancel'} choice the answer of the user
   */
  #rememberIndexDecision(root, choice) {
    if (choice === 'build' || choice === 'build-forced') {
      this.lspIndexDecisions.set(root, 'build')
      return
    }
    if (choice === 'conservative') this.lspIndexDecisions.set(root, 'conservative')
  }

  /**
   * Remember what the user answered for one project.
   *
   * The map remembers ONE thing: "do not ask me again". Only the answer
   * 'conservative' is written - the answer "start anyway" belongs to ONE
   * start and is never remembered, because a remembered permission to force
   * the start would make every later tight moment of that project start the
   * server without asking (PRD-v5.1 MEM-10).
   *
   * The answer is written to the settings, so it survives a restart of the
   * workbench. The write goes through the same helper as the workspace-scoped
   * default: a write that fails takes the change back and says so, instead
   * of leaving the client and the host with two different answers about the
   * same project (review N5).
   * @param {string} root the project root
   * @param {'conservative'} answer the answer of the user
   */
  #rememberMemoryAnswer(root, answer) {
    const previous = this.state.settings?.lsp ?? null
    const warned = this.state.settings?.lsp?.memoryWarnedRoots
    const next = { ...(warned !== null && typeof warned === 'object' ? warned : {}), [root]: answer }
    this.#writeLspSettings({ memoryWarnedRoots: next }, previous)
  }

  /**
   * Show the memory warning and wait for the user's answer.
   *
   * The host refuses to start a language server on a tight budget unless the
   * start is forced, so this dialog is the only way out of the "tight" band.
   *
   * The number of the dialog is the one the gate judged by
   * (`availableBytes`): the popup said "2648 MB available" while the gate
   * decided with 600 MB, so the same question got two opposite answers on
   * two screens (PRD-v5.1 MEM-09). The fallback to `freeBytes` is only for a
   * snapshot of a host that does not know the number yet - it is never
   * preferred over the number the gate used.
   * @param {{path: string, name?: string}} project
   * @param {{needMB?: number, availableBytes?: number, freeBytes?: number, languageId?: string}} resources
   * @returns {Promise<'start'|'conservative'>}
   */
  #askMemoryDecision(project, resources) {
    // A second request supersedes the first one: the old promise must not
    // hang forever.
    if (this.memoryDecisionResolve !== null) this.memoryDecisionResolve('conservative')
    const language = typeof resources.languageId === 'string' && resources.languageId !== ''
      ? resources.languageId
      : 'semantic analysis'
    return new Promise(resolve => {
      this.memoryDecisionResolve = resolve
      this.set({
        memoryDecision: {
          path: project.path,
          name: typeof project.name === 'string' && project.name !== '' ? project.name : baseName(project.path),
          language,
          needMB: Math.round(resources.needMB ?? 0),
          // The field keeps its name: the dialog renders it, and the field
          // name is not worth a second wave through the renderer.
          freeMB: Math.round((resources.availableBytes ?? resources.freeBytes ?? 0) / (1024 * 1024)),
        },
      })
    })
  }

  /**
   * Answer the pending memory warning.
   * @param {'start'|'conservative'} choice
   */
  resolveMemoryDecision(choice) {
    const resolve = this.memoryDecisionResolve
    this.memoryDecisionResolve = null
    this.set({ memoryDecision: null })
    if (resolve === null) return
    resolve(choice === 'start' ? 'start' : 'conservative')
  }

  /**
   * Whether this project root completed a first program build before.
   *
   * Both sources count: the host's project list and the profile settings.
   * @param {{path: string, indexState?: string}} project
   * @returns {boolean}
   */
  #isIndexed(project) {
    if (project?.indexState === 'indexed') return true
    const roots = this.state.settings?.lsp?.indexedRoots
    if (roots === null || roots === undefined || typeof roots !== 'object') return false
    return Object.keys(roots).some(key => sameScopePath(key, project.path))
  }

  /**
   * Whether a language server runs for one project root right now.
   *
   * `indexedRoots` is a historical fact ("this root completed a first
   * build"), this question is the live one ("a server runs for this root
   * now"). The host answers it in the status snapshot (`liveRoots`); a host
   * that does not know the field yet leaves the client with the state of the
   * project it is on - the one root the client talks to (the client holds a
   * single session, PRD-v5 §1.4).
   * @param {string} root the project root
   * @returns {boolean}
   */
  lspRootIsLive(root) {
    if (typeof root !== 'string' || root === '') return false
    const live = this.state.lsp?.liveRoots
    if (Array.isArray(live) && live.length > 0) {
      return live.some(entry => typeof entry === 'string' && sameScopePath(entry, root))
    }
    // The fallback: the project the workbench is on. Its state says whether
    // a server runs for it.
    if (!sameScopePath(root, this.state.root)) return false
    const state = this.state.lsp?.state
    return state === 'starting' || state === 'building' || state === 'ready' || state === 'restarting'
  }

  /**
   * The badge of one project in the project picker (PRD-v5.1 CONC-05).
   *
   * `indexedRoots` records a HISTORICAL fact: the folder completed a first
   * program build at some point in this profile. The badge said "indexed"
   * even after the server was reclaimed - and the user read it as "the index
   * is there", while a rebuild costs another full build.
   *
   * The two states are therefore:
   *
   *   - 'indexed'          the folder completed a first build AND a server
   *                        runs for it right now;
   *   - 'indexed-reclaimed' the folder completed a first build, but its
   *                        server was reclaimed (the host released it to give
   *                        the memory back).
   *
   * `null` means the folder carries no badge at all.
   * @param {{path: string, indexState?: string}} project
   * @returns {'indexed'|'indexed-reclaimed'|null}
   */
  indexBadgeState(project) {
    if (project === null || typeof project !== 'object') return null
    // A host that reports the two states itself wins: it knows which of its
    // sessions are alive, and the client only draws the badge.
    if (project.indexState === 'indexed-reclaimed') return 'indexed-reclaimed'
    if (project.indexState !== 'indexed') return null
    return this.lspRootIsLive(project.path) ? 'indexed' : 'indexed-reclaimed'
  }

  /**
   * Show the index decision and wait for the user's answer.
   * @param {{path: string, name?: string, isRoot?: boolean, isRepo?: boolean}} project
   * @param {{languageId?: string, needMB?: number}} [resources] the memory
   *   estimate of the host, so the dialog can say what the build costs.
   * @returns {Promise<'build'|'conservative'|'cancel'>}
   */
  #askIndexDecision(project, resources = null) {
    // A second request supersedes the first one: the old promise must not
    // hang forever.
    if (this.indexDecisionResolve !== null) this.indexDecisionResolve('cancel')
    return new Promise(resolve => {
      this.indexDecisionResolve = resolve
      this.set({
        indexDecision: {
          path: project.path,
          name: typeof project.name === 'string' && project.name !== '' ? project.name : baseName(project.path),
          isRoot: project.isRoot === true,
          isRepo: project.isRepo === true,
          language: typeof resources?.languageId === 'string' ? resources.languageId : '',
          needMB: Number.isFinite(resources?.needMB) ? resources.needMB : 0,
        },
      })
    })
  }

  /**
   * Answer the pending index decision.
   *
   * `Esc` and a click on the backdrop resolve as `'cancel'`: the project
   * stays as it is (PRD-v5 §2.3).
   * @param {'build'|'conservative'|'cancel'} choice
   */
  resolveIndexDecision(choice) {
    const resolve = this.indexDecisionResolve
    this.indexDecisionResolve = null
    this.set({ indexDecision: null })
    if (resolve === null) return
    resolve(choice === 'build' ? 'build' : (choice === 'conservative' ? 'conservative' : 'cancel'))
  }

  /**
   * The host's memory pre-check for one project root (PRD-v5 §2.2).
   *
   * The language of the file on the screen travels with the request: the
   * check and the start must judge the same language - the baseline of
   * TypeScript (434 MB) and the one of Java (2048 MB) are far apart, and a
   * prompt that says "ok" for one and then refuses the start for the other
   * is a question the user never got.
   * `null` means "the host could not answer": the check is skipped then, and
   * the host's own guard in `lsp.start` is the last line of defence.
   * @param {string} root
   * @returns {Promise<{canIndex?: boolean, freeBytes?: number, thresholdBytes?: number, memoryLimitBytes?: number}|null>}
   */
  async #lspResources(root) {
    try {
      const payload = { root }
      // The tab of the root, or the file the persisted workspace state of
      // the root remembers (the memory pre-check runs before a project the
      // workbench is switching to has its tabs).
      const languageId = this.#languageIdOnScreen(root) ?? this.#restoredLanguageIdFor(root)
      if (languageId !== undefined) payload.languageId = languageId
      const result = await call('lsp.resources', payload)
      if (result === null || typeof result !== 'object') return null
      return result
    } catch {
      return null
    }
  }

  /**
   * The language the persisted workspace state of one root remembers.
   *
   * The workbench is restored BEFORE its tabs are: the root is set first
   * (which starts the client session and its `lsp.scope` request) and the
   * tabs are replayed a moment later. Without this the first handshake of a
   * restarted workbench could only be guessed by the host, and in a polyglot
   * workspace the guess and the start of the next `lsp.start` would name two
   * different sub-projects.
   *
   * The witness is the file the restore will ACTIVATE, not the persisted
   * `activePath` blindly: `#restoreWorkspace` activates the first restored
   * tab when `activePath` is not one of them (the active tab may have been a
   * diff/commit tab, or older than the 24 tabs that are persisted). Reading
   * `activePath` alone would prime the handshake with the language of a tab
   * that is not on the screen while the start uses the language of the one
   * that is.
   * @param {string} root the project root
   * @returns {string | undefined} the language id, or undefined when unknown
   */
  #restoredLanguageIdFor(root) {
    if (typeof root !== 'string' || root === '') return undefined
    const workspaceState = this.state.settings?.workspaceState
    if (workspaceState === null || typeof workspaceState !== 'object') return undefined
    const saved = workspaceState[root]
    if (saved === null || typeof saved !== 'object') return undefined
    // The same filter and window `#restoreWorkspace` uses.
    const tabs = Array.isArray(saved.tabs)
      ? saved.tabs
          .filter(tab => tab !== null && typeof tab === 'object'
            && typeof tab.path === 'string' && tab.path !== '')
          .slice(-24)
      : []
    const activePath = typeof saved.activePath === 'string' ? saved.activePath : ''
    const activeIsRestored = activePath !== '' && tabs.some(tab => tab.path === activePath)
    const restoredPath = activeIsRestored ? activePath : (tabs[0]?.path ?? activePath)
    if (restoredPath === '' || !isPathWithin(root, restoredPath)) return undefined
    const languageId = languageIdForPath(restoredPath)
    return LSP_LANGUAGE_IDS.includes(languageId) ? languageId : undefined
  }

  /**
   * Record the language of one root for the session BEFORE the root changes.
   *
   * The client session is created by the root change itself (its handshake
   * asks the host for the scope root), so the language hint has to be in
   * place before `set({ root })` - the later `lsp.start` hint is too late for
   * the first `lsp.scope` request.
   * @param {string} root the project root that is about to become the root
   * @returns {void}
   */
  #primeLspLanguageHint(root) {
    if (typeof root !== 'string' || root === '') return
    const languageId = this.#languageIdOnScreen(root) ?? this.#restoredLanguageIdFor(root)
    try {
      setLspLanguageHint(root, languageId ?? '')
    } catch {
      // The hint is a nicety of the handshake: a failure must not break the
      // project switch.
    }
  }

  /**
   * The language id the host should start the server for, when it is known.
   *
   * The host detects a language on its own when it is not told one, and that
   * detection prefers the markers of a TypeScript project. A mixed repository
   * (a `package.json` next to a `pom.xml`) is therefore judged TypeScript,
   * and a `.java` file opened in it reached a server that cannot answer a
   * single Java request (PRD-v5.1 JS-04).
   *
   * The file on the screen is the better witness, but only when all three
   * answers are trustworthy:
   *
   *   - there is an open FILE tab (a diff or a placeholder has no language);
   *   - the file lives under the root the session is started for: the host
   *     keeps one language per root, so a file outside the root must not
   *     decide the root's server;
   *   - the extension maps onto a language id the host has a server for.
   *     `languageIdForPath` answers `plaintext` for everything it does not
   *     know, and the host refuses an id outside its registry.
   *
   * `undefined` means "I do not know": the host's own detection decides
   * then, which is the behaviour every language had before.
   *
   * The tab is only a witness when the root IS the root the workbench shows:
   * during a project switch the tab still belongs to the project that is
   * being left, and an ancestor root would contain it by `isPathWithin` -
   * priming the new root with the outgoing project's language would send a
   * handshake `rootUri` of one language and start the server of another.
   * @param {string} root the project root the session is started for
   * @returns {string | undefined} the language id, or undefined when unknown
   */
  #languageIdOnScreen(root) {
    if (typeof root !== 'string' || root === '') return undefined
    if (this.state.root === '' || !sameScopePath(root, this.state.root)) return undefined
    const tab = this.activeTab
    if (tab === null || tab.kind !== 'file') return undefined
    if (typeof tab.path !== 'string' || tab.path === '') return undefined
    if (!isPathWithin(root, tab.path)) return undefined
    const languageId = languageIdForPath(tab.path)
    return LSP_LANGUAGE_IDS.includes(languageId) ? languageId : undefined
  }

  /**
   * The payload of one `lsp.start` call.
   *
   * `languageId` is only present when the client has an answer: the host
   * falls back to its own detection for an absent field, and a field that is
   * present but wrong is worse than no field at all.
   *
   * The same language is handed to the client session
   * (`setLspLanguageHint`): the `lsp.scope` request of the handshake has to
   * choose the same sub-project as the server of the host, and a wake or a
   * rebuild of a session in a polyglot workspace must not ask for the
   * sub-project of another language (PRD-v5 §4.2, JS-04).
   * @param {string} root
   * @param {boolean} force
   * @returns {{root: string, force: boolean, languageId?: string}}
   */
  #lspStartPayload(root, force) {
    const payload = { root, force }
    // The tab of the root, or the file the persisted workspace state of the
    // root remembers: on the restore path the tabs are replayed after the
    // start, and the handshake of the session must already know the language.
    const languageId = this.#languageIdOnScreen(root) ?? this.#restoredLanguageIdFor(root)
    if (languageId !== undefined) payload.languageId = languageId
    // An unknown language clears the hint: the host decides, the session must
    // ask the same way the host would decide.
    try {
      setLspLanguageHint(root, languageId ?? '')
    } catch {
      // The session is a nicety of the handshake: a failure there must not
      // break the start.
    }
    return payload
  }

  /**
   * Start the language server for one project root.
   *
   * The client never sets the state itself: the host owns the transition, so
   * the two sides cannot fight over it.
   * @param {string} root
   * @param {{force?: boolean}} [options] `force` skips the host's memory
   *   pre-check - it is only set after the user answered the memory warning.
   * @returns {Promise<unknown>} the host's answer, or null on failure
   */
  async #startLsp(root, options = {}) {
    try {
      const result = await call('lsp.start', this.#lspStartPayload(root, options.force === true))
      await this.refreshLspStatus()
      return result
    } catch {
      // The status bar shows the failure; a toast here would only add noise.
      return null
    }
  }

  /**
   * Start the language server of a project that the workbench restores.
   *
   * The project switch asks the user whether the project shall be indexed;
   * the two paths that restore a project must not ask - a dialog at every
   * start of DSH would be unbearable. But a decision the user has already
   * expressed must be honoured there too:
   *
   *   - the workspace-scoped default of the user says "index this project"
   *     (or "keep it in the basic mode");
   *   - `indexOnOpen: 'always'` says "always index".
   *
   * The decision comes from the SAME helper the project switch uses
   * (`#decideIndex` with `ask: false`), so the two paths cannot drift apart
   * - the last time the semantics of `force` changed, the host was fixed
   * first and the memory logic of the client was patched afterwards, and one
   * place was missed (PRD-v5.1 MEM-10).
   *
   * Two rules of that helper matter here:
   *
   *   - the start is NEVER forced. The restore path cannot ask the user, so
   *     it has no permission to skip the tight band of the gate; the gate of
   *     the host decides (a tight machine degrades the session, a machine
   *     below the floor refuses the start).
   *   - a decision the policy derived stays in the memory of the store. The
   *     automatic start of the 'always' policy is NOT a decision of the user,
   *     and writing it to the settings would take the choice away from the
   *     user for ever (PRD-v5.1 WS-04 requirement 4).
   *
   * When nothing starts, the user gets an explanation: the workbench is in
   * the basic mode, and silence would look like a broken feature.
   * @param {string} root the project root
   * @returns {Promise<void>}
   */
  async #startLspForRestored(root) {
    if (typeof root !== 'string' || root === '') return
    const decision = await this.#decideIndex({ path: root }, { ask: false })
    if (decision.choice !== 'build' && decision.choice !== 'build-forced') {
      this.#explainBasicMode(root)
      return
    }
    // The store and the client session have to agree: the project wants a
    // server. The decision stays in the memory of the store - it is the
    // policy that derived it, not the user.
    this.#rememberIndexDecision(root, decision.choice)
    await this.#startLsp(root, { force: false })
  }

  /**
   * Explain why the workbench is in the basic mode (PRD-v5.1 WS-04).
   *
   * The restore path does not ask anything, so the user sees the basic mode
   * without a reason - and a feature that is silent looks broken (the
   * symptom the PRD reports: "the user sees the basic mode with no
   * explanation").
   *
   * The explanation differs in the two cases:
   *
   *   - the user chose the basic mode for this project: the workbench says
   *     so, and says that the choice can be undone;
   *   - the user never decided: the workbench is in the basic mode because
   *     this workspace never turned the semantic analysis on - and it can be
   *     turned on for a project.
   *
   * The master switch is not explained here: the feature is off in every
   * project, and that is a setting the user made on purpose.
   * @param {string} root the project root
   * @returns {void}
   */
  #explainBasicMode(root) {
    const lsp = this.state.settings?.lsp
    if (lsp === null || lsp === undefined || typeof lsp !== 'object') return
    if (lsp.enabled === false) return
    const chosen = this.#workspaceDefault(root) === 'conservative'
    this.toast('info', this.t(chosen ? 'lsp.workspaceConservativeToast' : 'lsp.workspaceBasicModeToast'))
  }

  /**
   * Rebuild the index of the current project.
   *
   * A degraded or crashed session used to be recoverable only by switching
   * the project away and back. The old session is shut down first: otherwise
   * the new one would find the memory the old one still holds.
   *
   * The start is forced when the free memory was the blocker: the host
   * pre-checks the memory, and a start that is not forced is degraded by the
   * same gate that degraded the session before. The user would click
   * 【重新建立索引】 and land in exactly the same degraded state - a loop
   * without an exit. Clicking the button IS the answer of the memory
   * warning («仍然启动» = start anyway, PRD-v5 §2.3). A degradation caused
   * by a missing server or by a crash must not bypass the memory gate, so
   * the force is limited to the tight band.
   *
   * The button is also the way OUT of the basic mode of a workspace: the user
   * asks for a language server here, so the workspace-scoped default of the
   * project is written - from now on the workbench starts the server of this
   * project on its own (PRD-v5.1 WS-04). Without it a project the user put
   * into the basic mode would stay there for ever.
   * @returns {Promise<void>}
   */
  async restartLsp() {
    const root = this.state.root
    if (root === '') return
    // The user asked for a language server: the decision is theirs, so it is
    // remembered in the settings document - and the old refusal of the user
    // goes with it. The two maps are two words about the same project, and
    // the host and the client read them in one order: a project that says
    // "index it" here and "basic mode" there is a project whose server is
    // started once and then never woken again after the next idle exit
    // (review A4).
    this.#rememberWorkspaceDecision(root, 'build')
    this.#rememberIndexDecision(root, 'build')
    this.patch('lsp', { rebuilding: true })
    try {
      await call('lsp.shutdown', { root })
    } catch {
      // A session that is already gone is not an error here.
    }
    // The snapshot the client holds is the one of the last poll - the
    // shutdown above does not change it, and it is the memory situation the
    // user ran into.
    //
    // The band is read from the SAME field the popup reads (`decision`): the
    // two fields of the host answered differently for a round, and a rebuild
    // that forces the start because of one of them while the popup asked
    // about the other is the same split brain in a different place (review
    // A2).
    const force = memoryDecisionOf(this.state.lsp.resources) === 'tight'
    try {
      await call('lsp.start', this.#lspStartPayload(root, force))
    } catch {
      // The status bar shows the failure.
    }
    await this.refreshLspStatus()
    this.patch('lsp', { rebuilding: false })
  }

  /**
   * The state of the CLIENT session - the link to the language server.
   *
   * The host's status says that the language server PROCESS is up; it says
   * nothing about the link between the browser and the server. The two never
   * check each other, and the status bar believed the host: it said "ready"
   * while the semantic features were completely dead - the menu was greyed
   * out, the hovering did nothing, and the rebuild button did not appear
   * either (the host was ready, so there was nothing to rebuild).
   *
   * The state is mirrored into the `lsp` slice, and a failure is announced
   * with ONE toast - once per episode. The flag of the episode is a flag of
   * its own, so the fault episodes of the host and the ones of the client
   * session do not swallow each other's toast.
   *
   * The toast is only shown when the host has a language server that could
   * fail: in every other state the host's own explanation is the truth, and
   * a dead client session on top of it is a false alarm (review P1-2).
   *
   * The client also reports WHEN it started waiting (`since`, a timestamp in
   * milliseconds). The status bar shows that waiting time, not the age of the
   * host's session: the two are different things, and the user wants to know
   * how long THEY have been waiting. A `since` of 0 means "I do not know" -
   * the bar falls back to the age of the host's session then.
   * @param {string} state 'starting' | 'ready' | 'failed' | 'idle'
   * @param {string} [detail] the reason of the failure
   * @param {number} [since] when the client started waiting (ms), 0 = unknown
   * @returns {void}
   */
  lspSessionState(state, detail = '', since = 0) {
    const next = typeof state === 'string' && state !== '' ? state : 'starting'
    const reason = typeof detail === 'string' ? detail : ''
    const started = Number.isFinite(since) && since > 0 ? since : 0
    const lsp = this.state.lsp ?? {}
    if (lsp.clientState === next && lsp.clientDetail === reason && lsp.clientSince === started) return
    this.patch('lsp', { clientState: next, clientDetail: reason, clientSince: started })
    if (next !== 'failed') {
      // The session works again: the next failure is a new episode.
      this.lspSessionFaultNotified = false
      return
    }
    if (this.lspSessionFaultNotified) return
    // The host claims to be fine: there is a language server that could
    // fail, so the dead client session is a real fault. In every other state
    // the host's own explanation is the truth - the project was put into the
    // basic mode on purpose, the feature is switched off, or the server was
    // released - and a red "the session is dead" on top of it would be a
    // false alarm (review P1-2).
    if (!LSP_HOST_HEALTHY_STATES.includes(lsp.state)) return
    this.lspSessionFaultNotified = true
    // The toast carries the localized text. The technical reason stays in
    // the mirrored state, where the status bar shows it in its tooltip.
    this.toast('error', this.t('lsp.sessionFailedToast'))
  }

  /**
   * Reconnect the semantic analysis - the way out of a dead session.
   *
   * The handshake of the client goes first: the host replays the handshake it
   * holds to the next language server process, so the new process is
   * initialized with an `initialize` of the client. The restart of the host
   * comes second: a new process means a new frame worker with an empty
   * handshake cache, so the `initialize` really reaches the server again -
   * and the server that answers it is a healthy one.
   *
   * The restart is skipped when the user refused a language server for this
   * project: the button may not start a server behind their back (review
   * P1-2).
   *
   * The method never throws: it is called from a button, and a failure of
   * one half must not keep the other half from running.
   * @returns {Promise<void>}
   */
  async reconnectLsp() {
    try {
      reconnectLspSession()
    } catch {
      // The client session is optional: the restart of the host below is the
      // way out in any case.
    }
    // The project was put into the basic mode on purpose: there is no server
    // to restart, and starting one would be the opposite of the decision the
    // user made.
    if (this.lspIndexDecision(this.state.root) === 'conservative') return
    try {
      await this.restartLsp()
    } catch {
      // The status bar shows the failure.
    }
  }

  /**
   * Fall back to the conservative mode: the language server of the current
   * project is stopped and its memory is released.
   *
   * The DECISION comes first, and it is the half that was missing: the
   * button stopped the server on the host, but the client session still
   * believed the project wanted a language server. The next semantic request
   * woke it again (IDLE-02) - the server came back, and the click looked
   * like it had never happened.
   *
   * The decision is a decision of the USER, so it is written to the settings
   * document (PRD-v5.1 WS-04): "use the basic mode" means KEEP the basic
   * mode - over a workspace switch and over a restart of DSH. The way back
   * is the 【重新建立索引】 button, which writes 'build' into the same place.
   * @returns {Promise<void>}
   */
  async degradeLsp() {
    const root = this.state.root
    if (root === '') return
    // The decision first: the client session asks the store whether it wants
    // a server, and the answer has to be "no" before the server is gone -
    // otherwise the session stays and the next request wakes the server up
    // again.
    this.#rememberIndexDecision(root, 'conservative')
    this.#rememberWorkspaceDecision(root, 'conservative')
    try {
      await call('lsp.shutdown', { root })
    } catch {
      // Nothing to stop.
    }
    await this.refreshLspStatus()
  }

  /**
   * Read the host's memory snapshot and the server log for the current
   * project.
   *
   * The snapshot is not polled: it is read when the diagnostics panel opens
   * and when the settings page asks for it, because a number that changes
   * every second would only distract.
   * @returns {Promise<void>}
   */
  async loadLspResources() {
    const root = this.state.root
    if (root === '') return
    const resources = await this.#lspResources(root)
    let stderrLines = this.state.lsp.stderrLines ?? []
    try {
      const logs = await call('lsp.logs', { root })
      if (logs !== null && typeof logs === 'object' && Array.isArray(logs.lines)) stderrLines = logs.lines
    } catch {
      // The log is a nicety: a host without one does not break the panel.
    }
    this.patch('lsp', { resources, stderrLines })
  }

  /**
   * Cancel a running index build (PRD-v5 §2.4).
   *
   * Only the host is asked: the client never sets the state on its own, and
   * nothing in the editor is touched — the tabs, the drafts and the cursor
   * stay exactly as they are.
   * @returns {Promise<void>}
   */
  async cancelLspIndex() {
    const root = this.state.root
    if (root === '') return
    try {
      await call('lsp.cancelIndex', { root })
    } catch {
      // Cancelling twice is not an error the user has to act on.
    }
    await this.refreshLspStatus()
  }

  /**
   * Whether the navigation entries of the editor are available
   * (PRD-v5 §5.2, §5.3, §7.1).
   *
   * The semantic entries need a running language server; the text entry is
   * always available, so the user always has a way to find the usages of a
   * symbol. The reason is the text the editor shows next to the greyed-out
   * entry.
   * @returns {{findUsages: {enabled: boolean, reason: string}, findUsagesText: {enabled: boolean, reason: string}}}
   */
  semanticNavigation() {
    const lsp = this.state.lsp ?? {}
    // A `suspended` server is asleep, not gone: the host wakes it on the
    // first payload (PRD-v5 §3.3 IDLE-02), so the semantic entries stay
    // available and the user never has to start the wake by hand. `idle`
    // means no server was ever started for this root - the host will not
    // wake it - and `degraded` / `failed` are real faults.
    const ready = lsp.enabled !== false && (lsp.state === 'ready' || lsp.state === 'suspended')
    return {
      findUsages: {
        enabled: ready,
        reason: ready ? '' : this.t('nav.semanticUnavailable'),
      },
      findUsagesText: { enabled: true, reason: '' },
    }
  }

  /**
   * Translate with `{placeholder}` substitution.
   *
   * The harness translate function does not interpolate, so the placeholders
   * of the code-intelligence texts are filled in here.
   * @param {string} key
   * @param {Record<string, string|number>} values
   * @returns {string}
   */
  #tpl(key, values) {
    let text = this.t(key)
    for (const [name, value] of Object.entries(values)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
    return text
  }

  async #switchProject(projectRoot) {
    // The root change creates the client session; its scope request must
    // already know the language of the project that is being entered.
    this.#primeLspLanguageHint(projectRoot)
    this.set({
      root: projectRoot,
      gitRepoRoot: this.#defaultGitRepoRoot(projectRoot),
      projectPicker: false,
      dirs: new Map(),
      expanded: new Set(),
      selectedPath: '',
      filter: '',
      fileIndex: [],
      fileIndexRoot: '',
      quickOpen: false,
      tabs: [],
      activeId: null,
      status: initialState().status,
      git: { ...initialState().git },
      search: initialState().search,
      // The search popup belongs to the project that was left.
      searchPopup: initialState().searchPopup,
      // The language-server status belongs to the project that was left; the
      // server registry does not, so it survives the switch.
      lsp: { ...initialState().lsp, servers: this.state.lsp.servers },
      // The checked paths and the group pins belong to the repository they
      // were made in (PRD-v4 §3.2): a path of repository A must not stay
      // pinned in the Unversioned group of repository B.
      commit: this.#resetCommitSelection(),
    })
    this.#rememberProjectRoot(projectRoot)
    this.#restoreWorkspace(projectRoot)
    void this.loadRestoredTree({ lazy: true })
    await this.refreshStatus({ initial: true })
    void this.refreshShells()
    void this.loadLog(true)
    void this.persistNow()
  }

  /** The commit slice without the selection of the previous repository. */
  #resetCommitSelection() {
    return {
      ...this.state.commit,
      checked: new Set(),
      unchecked: new Set(),
      buckets: {},
      pendingStage: new Set(),
      selectedPath: '',
    }
  }

  openProjectPicker() {
    if (this.state.workspaceRoot === '') {
      this.openRootPicker()
      return
    }
    this.set({ projectPicker: true })
    void this.loadProjects()
  }

  closeProjectPicker() {
    this.set({ projectPicker: false })
  }

  #restoreWorkspace(root) {
    const saved = this.state.settings?.workspaceState?.[root]
    if (saved === null || typeof saved !== 'object') {
      this.set({ expanded: new Set(), tabs: [], activeId: null })
      return
    }
    const expanded = new Set(Array.isArray(saved.expanded) ? saved.expanded.filter(item => typeof item === 'string') : [])
    const tabs = Array.isArray(saved.tabs)
      ? saved.tabs
          .filter(tab => tab !== null && typeof tab === 'object' && typeof tab.path === 'string')
          .slice(-24)
          .map(tab => ({
            id: `file:${tab.path}`,
            kind: 'file',
            path: tab.path,
            name: baseName(tab.path),
            rel: tab.rel ?? tab.path,
            preview: tab.preview === true,
            pinned: tab.pinned !== false,
            loading: false,
            content: null,
            error: null,
            scrollTop: typeof tab.scrollTop === 'number' ? tab.scrollTop : 0,
            editing: this.defaultEditing(undefined, tab.path),
            editingUserSet: false,
            view: isMarkdownPath(tab.path) && this.state.settings?.editor?.markdownPreview !== false ? 'preview' : 'code',
            draft: null,
            dirty: false,
            saving: false,
            conflict: null,
          }))
      : []
    const activeId = typeof saved.activePath === 'string' && tabs.some(tab => tab.path === saved.activePath)
      ? `file:${saved.activePath}`
      : (tabs[0]?.id ?? null)
    const layout = {
      left: saved.layout?.left === undefined ? 'project' : saved.layout.left,
      leftWidth: typeof saved.layout?.leftWidth === 'number' ? saved.layout.leftWidth : 300,
      bottom: saved.layout?.bottom === 'terminal' ? null : (saved.layout?.bottom === undefined ? null : saved.layout.bottom),
      bottomHeight: typeof saved.layout?.bottomHeight === 'number' ? saved.layout.bottomHeight : 270,
      gitDrawerWidth: typeof saved.layout?.gitDrawerWidth === 'number' ? saved.layout.gitDrawerWidth : 420,
    }
    this.set({ expanded, tabs, activeId, layout })
    // Only the focused tab is read from disk. The others wait until the user
    // focuses them, so a cold workspace does not replay every open file
    // (PRD-v4 §1.2 PERF-07).
    if (activeId !== null) void this.ensureTabContent(activeId)
  }

  async #persist() {
    const state = this.state
    if (state.workspaceRoot === '' || state.root === '') return
    const fileTabs = state.tabs
      .filter(tab => tab.kind === 'file')
      .map(tab => ({
        path: tab.path,
        rel: tab.rel,
        preview: tab.preview,
        pinned: tab.pinned,
        scrollTop: tab.scrollTop ?? 0,
      }))
    const active = state.tabs.find(tab => tab.id === state.activeId)
    const workspaceState = {
      expanded: [...state.expanded].slice(0, 3000),
      tabs: fileTabs.slice(-24),
      activePath: active?.kind === 'file' ? active.path : undefined,
      layout: state.layout,
    }
    try {
      const patch = {
        projectRoots: { [state.workspaceRoot]: state.root },
        workspaceState: { [state.root]: workspaceState },
      }
      // Workspace-scoped stores share one settings document. A background
      // store's debounce must not steal `lastRoot` from the active workspace;
      // only the visible workbench updates it.
      if (state.active === true) patch.lastRoot = state.workspaceRoot
      const result = await call('settings.update', { patch })
      // The host answers with the WHOLE document. An answer without a
      // document must not empty the settings of the store: the decision of
      // the workbench about the semantic analysis lives in them, and a
      // store without them would decide everything again from scratch.
      const answer = result !== null && typeof result === 'object' && result.value !== null && typeof result.value === 'object'
        ? result.value
        : null
      const next = answer === null ? { ...(state.settings ?? {}) } : { ...(state.settings ?? {}), ...answer }
      // Keep the in-memory document in sync without a render (the tree reads
      // settings.project.showHidden on every list call).
      this.state.settings = next
    } catch {
      // Persisting is best effort; the session keeps working in memory.
    }
  }

  async persistNow() {
    this.persist.cancel()
    await this.#persist()
  }

  // ── status polling ────────────────────────────────────────────────────
  activate() {
    this.set({ active: true })
    if (this.pollTimer === null) {
      this.pollTimer = setInterval(() => { void this.pollStatus() }, 2000)
      // A timer must not keep a Node process alive: the client bundle runs in
      // a browser, where `unref` does not exist (the host guards it the same
      // way).
      this.pollTimer?.unref?.()
    }
    if (this.state.root !== '') {
      if (this.state.statusAt === 0) {
        void this.refreshStatus({ initial: true })
      } else {
        // A hot workspace reuses its cached snapshot: coming back to it must
        // not spawn a git subprocess. The 2s poll refreshes the snapshot in
        // the background and clears the stale flag.
        this.set({ statusStale: true })
      }
    }
    if (this.state.root !== '' && !this.state.dirs.has(this.state.root)) void this.loadRestoredTree({ lazy: true })
    // The semantic-analysis status is polled on the same cadence as the git
    // status. The poll survives `deactivate()` (PRD-v5 §2.2 STALE-01): a
    // workbench that is not the visible surface still has to know whether the
    // language server is alive, or the status bar would freeze on its last
    // value for ever.
    if (this.lspPollTimer === null) {
      this.lspPollTimer = setInterval(() => { void this.pollLspStatus() }, 2000)
      this.lspPollTimer?.unref?.()
    }
    void this.pollLspStatus()
    // Sessions survive a trip to the Conversation: the terminal view is kept
    // mounted by the sidebar, so only its visibility changes.
  }

  deactivate() {
    // Do not clear `terminal.sessions`: switching tabs must not kill the PTY
    // or the xterm scrollback. Explicit close still terminates the session.
    this.set({ active: false })
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    // The language-server poll keeps running on purpose (PRD-v5 §2.2
    // STALE-01). Stopping it here froze `state.lsp.state` on its last value:
    // the status bar said "starting…" long after the server was gone. The
    // cadence is the one the PRD already mandates (§4.3), so this is no new
    // load. A store that is dropped for good stops its timers in
    // `dispose()`.
    if (this.restoredTimer !== null) {
      clearTimeout(this.restoredTimer)
      this.restoredTimer = null
    }
    void this.persistNow()
  }

  /**
   * Release the semantic session of this store (PRD-v5.1 §2.3, WS-03).
   *
   * The store of a workspace that is not the active one any more still holds
   * a mirrored status: the two-second poll of the language server went on,
   * and the status bar of that store said "语义分析：就绪" long after the
   * workspace was left. The user came back and saw a state that belonged to
   * a server nobody talks to any more.
   *
   * The release has two halves:
   *
   *   - the poll of the language-server status stops. A store that nobody
   *     watches must not keep asking the host every two seconds;
   *   - the mirrored status is cleared, so the status line of that store says
   *     "idle" instead of a state that is not true any more.
   *
   * The session itself is released by `releaseLspForStore` of the session
   * module - it closes the socket and asks the host to stop the server. This
   * method is the store-side half of it, and the session module calls it
   * when the method exists.
   *
   * The method is idempotent: the release may come twice (once from the
   * cache that drops the store, once from the store itself), and a second
   * call must not clear a state that was filled again in between.
   * @returns {void}
   */
  releaseLsp() {
    if (this.lspPollTimer !== null) {
      clearInterval(this.lspPollTimer)
      this.lspPollTimer = null
    }
    // The mirrored status of a store that is not looked at any more would
    // keep the last state of a server that is gone. The slice goes back to
    // its initial state, and the client session of that slice starts at
    // 'idle' - THERE IS NO SESSION any more, so "starting" would be a lie
    // (专项 F1).
    this.patch('lsp', { ...initialState().lsp, servers: this.state.lsp?.servers ?? { available: [], missing: [] } })
    // The fault episodes belong to the session that is gone: a new one must
    // not inherit the flag and stay silent about its first failure.
    this.lspFaultNotified = false
    this.lspSessionFaultNotified = false
  }

  /**
   * Drop the store for good.
   *
   * `deactivate()` only pauses the workbench - the language-server status
   * keeps being polled. A store that is evicted from the cache is gone for
   * good, so its timers have to stop: otherwise every visited workspace
   * would keep a poll running for the rest of the session.
   */
  dispose() {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.lspPollTimer !== null) {
      clearInterval(this.lspPollTimer)
      this.lspPollTimer = null
    }
    // The visibility listener belongs to the document, not to the store: a
    // store that is dropped for good must not keep it, or it would refresh a
    // store that nobody reads any more.
    if (this.visibilityBound && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this.#onVisibilityChange)
    }
    this.visibilityBound = false
    this.deactivate()
  }

  async pollStatus() {
    if (!this.state.active || this.state.root === '' || this.polling) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    await this.refreshStatus({ silent: true })
    await this.#checkActiveFileOnDisk()
  }

  /**
   * Poll the language-server status.
   *
   * The poll only reads: the host owns the state machine, so the client
   * never derives a state of its own. It runs even while the workbench is
   * not the visible surface (PRD-v5 §2.2 STALE-01): the store is shared
   * between the workbench and the sidebar, and a frozen snapshot is what the
   * user reported as "starting…" that never ended.
   * @returns {Promise<void>}
   */
  async pollLspStatus() {
    if (this.state.root === '') return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      // A hidden page cannot poll: the browser throttles the timer of a
      // background page to once a minute. That is a fact about the window,
      // not about the server - so the snapshot is NOT marked as stale. Only
      // a FAILED poll may say "unknown" (PRD-v5 §2.3): a skipped poll said
      // it, and the status bar then claimed the server was broken while it
      // was perfectly healthy (the rebuild button disappeared with it).
      // The `visibilitychange` listener refreshes the status as soon as the
      // window comes back.
      return
    }
    await this.refreshLspStatus()
  }

  /**
   * Refresh the mirrored language-server status (PRD-v5 §3.1, §4.3).
   *
   * A fault is announced exactly once per fault episode: the poll would
   * otherwise repeat the toast every two seconds, and the control event may
   * report the same crash (PRD-v5 §1.5 VIS-04).
   * @returns {Promise<void>}
   */
  async refreshLspStatus() {
    const root = this.state.root
    if (root === '') return
    let status
    try {
      status = await call('lsp.status', { root })
    } catch {
      // The host did not answer: the old snapshot is not current any more.
      // Keeping it would freeze the status bar on "starting…" (the fault the
      // user reported), so the client says "unknown" instead (PRD-v5 §2.3).
      this.set({ lspStatusStale: true })
      return
    }
    if (status === null || typeof status !== 'object') {
      this.set({ lspStatusStale: true })
      return
    }
    const next = {
      ...this.state.lsp,
      enabled: status.enabled !== false,
      state: typeof status.state === 'string' && status.state !== '' ? status.state : 'idle',
      languageId: typeof status.languageId === 'string' ? status.languageId : '',
      serverId: typeof status.serverId === 'string' ? status.serverId : '',
      source: typeof status.source === 'string' ? status.source : null,
      detail: typeof status.detail === 'string' ? status.detail : null,
      indexedRoots: Array.isArray(status.indexedRoots) ? status.indexedRoots : [],
      // The root the program of the project is built for. The host knows it
      // and the client has to mirror it: the workspace fence is narrowed to
      // this directory, because the semantic answers are about it and not
      // about the whole workspace (PRD-v5 §4.2). It is a string or null -
      // never undefined.
      scopeRoot: typeof status.scopeRoot === 'string' && status.scopeRoot !== ''
        ? status.scopeRoot
        : null,
      // The identity of the running language-server process. It changes with
      // every new process, and the client uses the change to reset its
      // request budget: the new process has to build the program of the
      // project again (review T1).
      processId: Number.isFinite(status.processId) ? status.processId : 0,
      // Whether the program of the project is still being built. The state of
      // the session says "ready" long before that is over, so the status bar
      // needs the flag to tell the user what it waits for (review T7).
      buildingProgram: status.buildingProgram === true,
      // The roots a language server runs for RIGHT NOW. The badge of the
      // project picker needs it to tell "indexed and running" from "indexed
      // and reclaimed" (PRD-v5.1 CONC-05). A host that does not report the
      // field leaves the list empty, and the client falls back to the state
      // of the project it is on.
      liveRoots: Array.isArray(status.liveRoots)
        ? status.liveRoots.filter(entry => typeof entry === 'string')
        : this.state.lsp.liveRoots,
    }
    // The memory snapshot travels with the status (the host reads it in the
    // same call), so the numbers are live without a second request.
    //
    // The comparison watches EVERY field the panel shows, and it compares the
    // byte fields in MEGABYTES. Two reasons:
    //
    //   - the free memory of the machine jitters by a few kilobytes on every
    //     poll. A byte-level comparison would replace the snapshot on every
    //     poll and wake the whole workbench every two seconds for a number
    //     that did not move.
    //   - the fields are DISPLAYED in megabytes, so a change of less than a
    //     megabyte is not a change the user can see.
    //
    // The comparison has to watch the reservation and the measured footprint
    // as well: when a server GROWS, the free memory drops by Δ and the
    // reservation (= ceiling − measured) drops by Δ too - so the AVAILABLE
    // memory stays exactly the same, and a comparison of the available
    // memory alone froze the panel on the numbers of the first poll (review
    // A3). The worst case and the budget move with them.
    //
    // The pressure margin moves on its own too: it is the free memory of
    // the machine minus the CONFIRMED footprint of the running servers, so it
    // falls when the free memory falls - and the free memory is not one of
    // the fields the panel shows. A field that is displayed and not watched
    // freezes (the same defect as A3).
    const resources = status.resources ?? null
    const known = this.state.lsp.resources ?? null
    // The host carries the snapshot only when there IS a server: the estimate
    // belongs to a language server, so a root without one has no estimate to
    // report ("no server, no estimate").
    //
    // "The host has nothing to say" is NOT "there is nothing": the client
    // fetched the snapshot itself when the diagnostics panel opened (the
    // `lsp.resources` route answers for every root, even one that was never
    // started), and a poll that does not carry a snapshot must NOT throw
    // that away. It did, and the memory row of the panel blinked from the
    // numbers to a dash two seconds after the panel was opened.
    //
    // The snapshot of a project that was LEFT is not kept: the whole `lsp`
    // slice is reset when the project changes, so nothing of another project
    // can survive here.
    const memoryChanged = resources === null
      ? false
      : (known === null
        || megabytesOf(known.availableBytes) !== megabytesOf(resources.availableBytes)
        || megabytesOf(known.reservedBytes) !== megabytesOf(resources.reservedBytes)
        || megabytesOf(known.measuredBytes) !== megabytesOf(resources.measuredBytes)
        || megabytesOf(known.worstCaseBytes) !== megabytesOf(resources.worstCaseBytes)
        || megabytesOf(known.budgetUsedBytes) !== megabytesOf(resources.budgetUsedBytes)
        || megabytesOf(known.safeAvailableBytes) !== megabytesOf(resources.safeAvailableBytes)
        || known.needMB !== resources.needMB
        || known.canIndex !== resources.canIndex
        || known.tight !== resources.tight)
    if (memoryChanged) next.resources = resources
    // A running build reports its progress through `lsp.index`. The host
    // accepts a cancel in `starting` and in `restarting` as well, and the
    // cancel clock starts with the `starting` state - so the index is read in
    // these states too, or the user never gets the cancel button the host
    // would accept (PRD-v5 §2.4 STALE-03).
    if (LSP_INDEX_STATES.includes(next.state)) {
      const index = await this.#lspIndex(root)
      if (index !== null) {
        next.progress = typeof index.progress === 'string' ? index.progress : ''
        next.startedAt = Number.isFinite(index.startedAt) ? index.startedAt : 0
        next.cancellable = index.cancellable === true
      }
    } else {
      // The build is over: the progress of the last one must not linger. The
      // spread above carries it over from the previous snapshot, and a stale
      // value would keep the status bar at "updating the index" forever.
      next.progress = ''
      next.startedAt = 0
      next.cancellable = false
    }
    const current = this.state.lsp
    const changed = current.state !== next.state
      || current.languageId !== next.languageId
      || current.serverId !== next.serverId
      || current.source !== next.source
      || current.detail !== next.detail
      || current.progress !== next.progress
      || current.startedAt !== next.startedAt
      || current.cancellable !== next.cancellable
      || current.enabled !== next.enabled
      || current.processId !== next.processId
      || current.buildingProgram !== next.buildingProgram
      || current.scopeRoot !== next.scopeRoot
      // The live roots change when a server is released, and the badge of
      // the project picker follows them (PRD-v5.1 CONC-05).
      || JSON.stringify(current.liveRoots) !== JSON.stringify(next.liveRoots)
      || memoryChanged
    // The status answered, so the mirrored snapshot is current again.
    const patch = { lspStatusStale: false }
    if (changed) patch.lsp = next
    this.set(patch)
    // A fault is announced once per fault episode (PRD-v5 §1.5 VIS-04). The
    // poll announces it too: the control event is lost when the socket is
    // down, and the episode flag makes the two paths idempotent.
    if (LSP_RECOVERED_STATES.includes(next.state)) {
      // The server is healthy again: the next fault is a new episode.
      this.lspFaultNotified = false
    } else {
      this.#announceLspFault(next.state, next.detail ?? '')
    }
    // The "not installed" state needs the server registry; it is fetched once
    // per language, not on every poll.
    if (next.languageId !== '' && !this.lspServersChecked.has(next.languageId)) {
      this.lspServersChecked.add(next.languageId)
      void this.#loadLspServers()
    }
  }

  /**
   * Handle one control event of the language server (PRD-v5 §1.5 VIS-04).
   *
   * The host announces a crash or a degradation over the socket, and the
   * client shows the toast. Every other event (`state`, `ready`, `idle`,
   * `didClose`) is informational: the two-second poll owns the mirrored
   * status, so an event must not overwrite it - and `didClose` in particular
   * must not touch the editor state.
   *
   * The method is called from a WebSocket callback, so it must never throw:
   * a broken toast may not take the socket down.
   * @param {{type?: string, root?: string, detail?: string, state?: string}} event
   * @returns {void}
   */
  lspControl(event) {
    try {
      if (event === null || typeof event !== 'object') return
      const type = typeof event.type === 'string' ? event.type : ''
      // An event of another project is noise: the toast belongs to the root
      // the user is working in.
      if (typeof event.root === 'string' && event.root !== ''
        && !sameScopePath(event.root, this.state.root)) return
      if (type === 'degraded') {
        this.#announceLspFault('degraded', event.detail ?? '')
        return
      }
      if (type === 'crash') {
        this.#announceLspFault('crashed', event.detail ?? '')
      }
      // Every other type is informational and ignored.
    } catch {
      // A control event may never break the socket it arrived on.
    }
  }

  /**
   * Announce one fault of the language server - once per fault episode.
   *
   * The host walks `crashed → restarting → degraded` inside one millisecond
   * window, and the control event and the two-second poll can report the
   * same fault. The episode flag makes the two paths idempotent: the first
   * announcement wins, the second one is swallowed. The flag is cleared by
   * the poll when the server is healthy again.
   * @param {string} state the host state ('crashed' or 'degraded')
   * @param {string} detail the reason the host reported
   * @returns {boolean} whether the toast was shown
   */
  #announceLspFault(state, detail) {
    if (!LSP_FAULT_STATES.includes(state)) return false
    if (this.lspFaultNotified) return false
    this.lspFaultNotified = true
    // The advice follows the reason: a server that died of a timeout has
    // nothing to do with the memory, and a toast that blames the memory
    // sends the user to a setting that cannot help.
    //
    // The two faults do not have the same title either: a crash is an exit,
    // but a degradation is not - the server may be switched off in the
    // settings, missing, or refused for lack of memory. "The language server
    // exited" would be a lie in those cases (PRD-v5 §1.5).
    //
    // The body of the toast is localized in BOTH cases: the host has no
    // locale, so its detail is an English technical sentence. The
    // degradation used to show that sentence as the body of a Chinese
    // toast; the host's degradation details carry the same keywords
    // ("timeout", "memory"), so the same three templates classify them.
    const crashed = state === 'crashed'
    const advice = this.#crashAdvice(detail)
    this.toast('error', this.t(crashed ? 'lsp.crashedToast' : 'lsp.degradedToast'), advice)
    // The technical reason stays reachable: it is the detail of the mirrored
    // status, and the status bar shows it in the tooltip of the status item
    // (the poll overwrites it with the detail of the host status, which says
    // the same thing).
    const raw = typeof detail === 'string' ? detail : ''
    if (raw !== '' && this.state.lsp.detail !== raw) {
      this.patch('lsp', { detail: raw })
    }
    return true
  }

  /**
   * The progress of a running index build.
   * @param {string} root
   * @returns {Promise<{progress?: string, startedAt?: number, cancellable?: boolean}|null>}
   */
  async #lspIndex(root) {
    try {
      const result = await call('lsp.index', { root })
      if (result === null || typeof result !== 'object') return null
      return result
    } catch {
      return null
    }
  }

  /**
   * The advice for a crashed language server.
   *
   * @param {string} detail the reason the host reported
   * @returns {string} the advice
   */
  #crashAdvice(detail) {
    return crashAdviceFor(detail, key => this.t(key))
  }

  /**
   * The language-server registry (PRD-v5 §3.1).
   *
   * It tells the status bar whether a language has no server at all, which is
   * a different state than "the server failed".
   * @returns {Promise<void>}
   */
  async #loadLspServers() {
    try {
      const result = await call('lsp.servers', {})
      // A host that still runs the old code puts the languages that are
      // switched off into a `disabled` bucket. The bucket is passed through
      // as it is: the settings page merges it into the switch list, so a
      // language can be switched on again before the host process is
      // restarted. A host of the new contract has no such bucket.
      const legacy = Array.isArray(result?.disabled) ? { disabled: result.disabled } : {}
      this.patch('lsp', {
        servers: {
          available: Array.isArray(result?.available) ? result.available : [],
          missing: Array.isArray(result?.missing) ? result.missing : [],
          ...legacy,
        },
      })
    } catch {
      // The registry is optional: without it the status bar shows the generic
      // state of the host.
    }
  }

  /**
   * Read the language-server registry.
   *
   * The status bar only needs it once per language, but the settings page
   * lists every language, so it asks for it on its own.
   * @returns {Promise<void>}
   */
  async loadLspServers() {
    await this.#loadLspServers()
  }

  /**
   * Cheap mtime probe for the active file; never reads the whole buffer.
   *
   * A timestamp difference alone is not an external edit: an atomic save can
   * publish a new mtime a moment after the poll took its sample, and other
   * tools touch files without changing them. Only a content difference may
   * surface the conflict chip; a same-content touch just refreshes the
   * baseline so the next poll stays quiet.
   */
  async #checkActiveFileOnDisk() {
    const active = this.state.tabs.find(tab => tab.id === this.state.activeId)
    if (active === undefined || active.kind !== 'file' || active.loading === true) return
    if (!Number.isFinite(active.payload?.mtimeMs)) return
    try {
      const info = await call('fs.stat', { root: this.state.root, path: active.path })
      if (!Number.isFinite(info.mtimeMs) || Math.abs(info.mtimeMs - active.payload.mtimeMs) <= 0.5) return
      if (active.dirty === true || active.editing === true) {
        const result = await call('fs.read', { root: this.state.root, path: active.path })
        const latest = this.state.tabs.find(tab => tab.id === active.id)
        if (latest === undefined) return
        if (result.kind === 'text'
          && normalizeNewlines(result.content) === normalizeNewlines(latest.payload?.content)) {
          // Same bytes: accept the new timestamp as the baseline.
          this.#updateTab(active.id, {
            payload: { ...(latest.payload ?? {}), ...result, content: normalizeNewlines(result.content) },
          })
          return
        }
        this.#updateTab(active.id, { conflict: { at: Date.now(), message: this.t('editor.conflictBody') } })
      } else {
        await this.ensureTabContent(active.id, { force: true })
      }
    } catch {
      // The file may be mid-rename; the next poll retries.
    }
  }

  /**
   * Whether the Commit window is on screen.
   *
   * Only the Commit window shows the per-file line counts, so the two
   * `git diff --numstat` calls behind them are only worth their subprocesses
   * while that window is visible.
   */
  #wantsNumstat() {
    return this.state.layout.left === 'commit'
  }

  async refreshStatus(options = {}) {
    if (this.state.root === '') return
    if (this.polling && options.silent !== false && options.force !== true) return
    this.polling = true
    // The status belongs to the repository the Git window reads (GIT-01).
    const root = this.gitRoot
    try {
      const status = await call('git.status', { root, numstat: this.#wantsNumstat() })
      if (this.gitRoot !== root) return
      const previous = this.state.status
      // The panels read the whole status object (`ProjectPanel`) or its entry
      // list (`CommitPanel`), so a brand new object on every poll woke them
      // every two seconds - even in an empty repository that did not change
      // by a single byte (PRD-v5 §7.2 PERF-01). The old object stays while
      // the snapshot says the same thing: its identity is what the panel
      // slices compare.
      const changed = !sameGitStatus(previous, status)
      this.set({
        status: changed ? status : previous,
        statusError: null,
        // The snapshot is as old as this poll says it is. The timestamp moves
        // on every successful poll, but it does not touch the status object,
        // so it cannot defeat the short-circuit above.
        statusAt: Date.now(),
        statusStale: false,
      })
      if (process.env.NODE_ENV !== 'production' && perfCounters !== null && Number.isFinite(status.subprocesses)) {
        perfCounters.gitSubprocesses += status.subprocesses
      }
      // Default the history to the current branch once; the user can then pick
      // "All branches" or another branch without the poll resetting it.
      if (!this.state.git.branchInitialized && status.isRepo === true && status.detached !== true && typeof status.branch === 'string' && status.branch !== '') {
        this.patch('git', {
          branchInitialized: true,
          filters: { ...this.state.git.filters, branch: status.branch },
        })
      }
      if (changed || options.initial === true) {
        this.#invalidateChangedDirs(status)
        this.#refreshActiveFile(status)
        if (this.state.layout.bottom === 'git') void this.loadLog(true, { silent: true })
      }
      if (options.initial === true) {
        void this.loadLog(true, { silent: true })
        void this.loadBranches()
        void this.loadCommitMessages()
      }
    } catch (error) {
      this.set({ statusError: error instanceof Error ? error.message : String(error) })
    } finally {
      this.polling = false
    }
  }

  /**
   * The key of one file inside the git status snapshot.
   *
   * The status belongs to the repository the Git window reads (PRD-v4 §4.1),
   * so its paths are relative to that repository. A file outside it has no
   * status entry at all.
   * @param {string} absolutePath the absolute path of the file
   * @returns {string | null} the repository-relative path
   */
  #statusKeyOf(absolutePath) {
    return relativePathWithin(this.gitRoot, absolutePath)
  }

  /** Reload only the expanded directories that contain a changed path. */
  #invalidateChangedDirs(status) {
    const dirtyParents = new Set()
    for (const entry of status.entries) {
      // The status paths are relative to the repository the Git window reads.
      dirtyParents.add(parentPath(joinPath(this.gitRoot, entry.path)))
    }
    const opened = [...this.state.expanded]
    for (const dir of opened) {
      if (dirtyParents.has(dir)) void this.loadDir(dir, { force: true })
    }
    // The root level itself changed (new/deleted top-level entries).
    if (status.entries.some(entry => !entry.path.includes('/') && !entry.path.includes('\\'))) {
      void this.loadDir(this.state.root, { force: true })
    }
  }

  /** Refresh one open file when its content changed on disk. */
  #refreshActiveFile(status) {
    const active = this.state.tabs.find(tab => tab.id === this.state.activeId)
    if (active === undefined || active.kind !== 'file') return
    // The status is keyed by the repository-relative path, the tab by its
    // absolute path: both speak the same basis (PRD-v4 §4.1).
    const key = this.#statusKeyOf(active.path)
    if (key === null) return
    const entry = status.entries.find(item => item.path === key)
    if (entry === undefined) return
    if (active.editing === true || active.dirty === true) {
      // Do not yank the document from under the user; detect the divergence
      // and let the toolbar offer Reload / Overwrite.
      void call('fs.read', { root: this.state.root, path: active.path }).then((result) => {
        const latest = this.state.tabs.find(tab => tab.id === active.id)
        if (latest === undefined || result.kind !== 'text') return
        if (normalizeNewlines(result.content) !== normalizeNewlines(latest.payload?.content)) {
          this.#updateTab(active.id, { conflict: { at: Date.now(), message: this.t('editor.conflictBody') } })
        }
      }).catch(() => {})
      return
    }
    void this.ensureTabContent(active.id, { force: true })
  }

  // ── file tree ─────────────────────────────────────────────────────────
  async loadDir(path, options = {}) {
    if (this.state.root === '') return
    const root = this.state.root
    const existing = this.state.dirs.get(path)
    // A forced request (refresh / project switch) supersedes an in-flight one;
    // a plain request shares it. Never return while a folder is stuck loading:
    // a stale generation must not keep the row on "loading" forever.
    if (existing !== undefined && existing.loading === true && options.force !== true) return
    if (existing !== undefined && existing.entries !== undefined && options.force !== true) return
    const token = (this.treeTokens.get(path) ?? 0) + 1
    this.treeTokens.set(path, token)
    const dirs = new Map(this.state.dirs)
    dirs.set(path, { ...(existing ?? {}), loading: true, error: null })
    this.set({ dirs })
    try {
      const listing = await call('fs.tree', { root, path })
      // A newer request for this folder, or a project switch, wins.
      if (this.state.root !== root || this.treeTokens.get(path) !== token) return
      const next = new Map(this.state.dirs)
      next.set(path, { loading: false, entries: listing.entries, truncated: listing.truncated, error: null })
      this.set({ dirs: next })
    } catch (error) {
      if (this.state.root !== root || this.treeTokens.get(path) !== token) return
      const next = new Map(this.state.dirs)
      next.set(path, { loading: false, entries: existing?.entries, error: errorMessage(error) })
      this.set({ dirs: next })
    }
  }

  /**
   * Load the persisted tree.
   *
   * By default the root and every expanded folder are listed, so a restored
   * tree never keeps a "loading" row under an expanded folder. The cold entry
   * uses `{ lazy: true }` instead: it lists the root only (one request) and
   * fills the deeper levels in the background, so switching to a big workspace
   * no longer replays its whole tree (PRD-v4 §1.2 PERF-07).
   * @param {{ lazy?: boolean }} [options]
   */
  async loadRestoredTree(options = {}) {
    if (this.state.root === '') return
    const root = this.state.root
    await this.loadDir(root)
    if (this.state.root !== root) return
    if (options.lazy === true) {
      this.#scheduleRestoredFolders(root)
      return
    }
    await Promise.all(this.#restoredFolders(root).map(dir => this.loadDir(dir)))
  }

  /** The expanded folders of the workspace state that are not listed yet. */
  #restoredFolders(root) {
    const separator = root.includes('\\') ? '\\' : '/'
    return [...this.state.expanded]
      .filter(dir => dir !== root && dir.startsWith(`${root}${separator}`) && this.state.dirs.get(dir)?.entries === undefined)
      .slice(0, 200)
  }

  /**
   * List the folders the workspace state had expanded, one after the other.
   * @param {string} root the project root the folders belong to
   */
  async #loadRestoredFolders(root) {
    for (const dir of this.#restoredFolders(root)) {
      if (this.state.root !== root) return
      await this.loadDir(dir)
    }
  }

  /** Start the background listing of the restored folders. */
  #scheduleRestoredFolders(root) {
    if (this.restoredTimer !== null) clearTimeout(this.restoredTimer)
    this.restoredTimer = setTimeout(() => {
      this.restoredTimer = null
      void this.#loadRestoredFolders(root)
    }, RESTORED_TREE_DELAY_MS)
  }

  async reloadTree() {
    const expanded = [...this.state.expanded]
    const dirs = new Map()
    this.set({ dirs })
    await this.loadDir(this.state.root, { root: true, force: true })
    for (const dir of expanded) {
      if (dir !== this.state.root) await this.loadDir(dir, { force: true })
    }
  }

  toggleDir(path) {
    const expanded = new Set(this.state.expanded)
    if (expanded.has(path)) {
      expanded.delete(path)
    } else {
      expanded.add(path)
      void this.loadDir(path)
    }
    this.set({ expanded })
    this.persist()
  }

  collapseAll() {
    this.set({ expanded: new Set([this.state.root]) })
    this.persist()
  }

  setSelectedPath(path) {
    const selection = typeof path === 'string' && path !== '' ? new Set([path]) : new Set()
    this.set({ selectedPath: path, selectedPaths: selection, anchorPath: path })
    const expanded = new Set(this.state.expanded)
    let parent = parentPath(path)
    let guard = 0
    while (parent.length >= this.state.root.length && guard < 64) {
      if (!expanded.has(parent)) {
        expanded.add(parent)
        void this.loadDir(parent)
      }
      if (parent === this.state.root) break
      parent = parentPath(parent)
      guard += 1
    }
    this.set({ expanded })
    this.persist()
  }

  setFilter(filter) {
    this.set({ filter })
    if (filter !== '' && this.state.filterMode === 'files') void this.loadFileIndex()
  }

  setFilterMode(mode) {
    const value = mode === 'tree' ? 'tree' : 'files'
    this.set({ filterMode: value })
    if (value === 'files' && this.state.filter !== '') void this.loadFileIndex()
  }

  /** Load the whole-project file index (cached per root). */
  async loadFileIndex(force = false) {
    if (this.state.root === '') return []
    if (!force && this.state.fileIndexRoot === this.state.root && this.state.fileIndex.length > 0) {
      return this.state.fileIndex
    }
    if (this.state.fileIndexLoading && !force) return this.state.fileIndex
    this.set({ fileIndexLoading: true, fileIndexError: null })
    try {
      const result = await call('fs.files', { root: this.state.root })
      const files = Array.isArray(result.files) ? result.files : []
      this.set({ fileIndex: files, fileIndexRoot: this.state.root, fileIndexLoading: false })
      return files
    } catch (error) {
      this.set({
        fileIndexLoading: false,
        fileIndexError: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  }

  // ── quick open / find in files ────────────────────────────────────────
  openQuickOpen() {
    this.set({ quickOpen: true, quickOpenQuery: '', quickOpenIndex: 0 })
    void this.loadFileIndex()
  }

  closeQuickOpen() {
    this.set({ quickOpen: false })
  }

  setQuickOpenQuery(query) {
    this.set({ quickOpenQuery: query, quickOpenIndex: 0 })
  }

  moveQuickOpen(delta) {
    this.set({ quickOpenIndex: Math.max(0, this.state.quickOpenIndex + delta) })
  }

  /** Open the file selected in the Quick Open overlay. */
  openQuickOpenSelection(rel) {
    const value = typeof rel === 'string' && rel !== '' ? rel : this.state.fileIndex[this.state.quickOpenIndex]
    if (value === undefined) return
    this.closeQuickOpen()
    this.openFile(this.#absoluteOf(value), { rel: value, preview: false })
  }

  /** Cycle through Find in Files hits with F8 / Shift+F8. */
  openNextSearchResult(delta = 1) {
    const hits = this.searchHits()
    if (hits.length === 0) return
    this.searchIndex = (this.searchIndex + (delta >= 0 ? 1 : -1) + hits.length) % hits.length
    const hit = hits[this.searchIndex]
    // The column travels with the line: the host sends it, so the cursor
    // lands on the word and not at the start of the line.
    this.openSearchResult(hit.path, hit.line, hit.column)
  }

  /**
   * The hits of the current search, flattened over the files.
   *
   * The popup shows the files on top and the hits of the selected file in
   * the preview below; this flat list is what "F8 cycles the hits" walks.
   * @returns {Array<{path: string, line: number, column: number, match: object, file: object}>}
   */
  searchHits() {
    const hits = []
    for (const file of this.state.search.results ?? []) {
      for (const match of file.matches ?? []) {
        hits.push({
          path: file.path,
          line: match.line,
          column: match.column,
          match,
          file,
        })
      }
    }
    return hits
  }

  /**
   * The file the Find in Files popup has selected.
   *
   * The upper half of the popup is a list of files; the preview below shows
   * the hits of this one.
   * @returns {object|null} the file, or `null`
   */
  selectedSearchFile() {
    const files = (this.state.search.results ?? []).filter(file => (file.matches ?? []).length > 0)
    if (files.length === 0) return null
    const index = Math.min(Math.max(this.state.searchPopup?.index ?? 0, 0), files.length - 1)
    return files[index] ?? null
  }

  /** Open one Find in Files hit at its line. */
  openSearchResult(rel, line, column) {
    if (typeof rel !== 'string' || rel === '') return
    const absolute = this.#absoluteOf(rel)
    // The popup is a one-shot tool: opening a hit ends it, so the code the
    // user was working on stays in front.
    this.closeSearchPopup()
    this.openFile(absolute, {
      rel,
      preview: false,
      line: Number.isInteger(line) ? line : 1,
      // The host sends the column of the hit, so the cursor lands on the
      // word and not at the start of the line.
      column: Number.isInteger(column) ? column : undefined,
    })
  }

  /**
   * Open the Find in Files popup.
   *
   * The results used to live in a tab of the editor area, which took a tab
   * away from the code the user was working on. The popup floats above the
   * editor instead (PRD-v5 supplement, FIND-01).
   *
   * The query and the flags are reset: the two entries (Find in Files and
   * the text version of Find Usages) share one data slice, and a plain
   * project-wide search must not inherit the identifier of a usage search
   * (and must not fire a search with it).
   * @param {string} [query] the query to run right away
   */
  openSearchPopup(query = '') {
    this.set({ searchPopup: { open: true, index: 0, generation: (this.state.searchPopup?.generation ?? 0) + 1 } })
    this.patch('search', {
      textMatch: false,
      query: '',
      caseSensitive: false,
      wholeWord: false,
      regexp: false,
    })
    if (typeof query === 'string' && query !== '') void this.runSearch(query)
  }

  /** Close the Find in Files popup. */
  closeSearchPopup() {
    if (this.state.searchPopup?.open !== true) return
    this.set({ searchPopup: { ...this.state.searchPopup, open: false, index: 0 } })
  }

  /**
   * Move the selection inside the Find in Files popup.
   *
   * The upper half of the popup lists the files that matched, so the
   * selection walks the files - the hits of a file are in its preview.
   * @param {number} delta how far to move
   */
  moveSearchSelection(delta) {
    const files = (this.state.search.results ?? []).filter(file => (file.matches ?? []).length > 0)
    if (files.length === 0) return
    const current = this.state.searchPopup?.index ?? 0
    const step = Number.isFinite(delta) ? Math.trunc(delta) : 1
    // The modulo is done twice: the first one folds the step into the list
    // length, the second one keeps the result positive.
    const index = (((current + step) % files.length) + files.length) % files.length
    this.set({ searchPopup: { ...this.state.searchPopup, open: true, index } })
  }

  /**
   * The old entry point of the Find in Files view.
   *
   * The results live in a popup now; the name is kept so a saved layout or
   * an old shortcut still finds the feature.
   * @param {string} [query] the query to run right away
   */
  openSearchTab(query = '') {
    this.openSearchPopup(query)
  }

  /**
   * The text version of Find Usages (PRD-v5 §5.3).
   *
   * It is always available — it is the fallback for a workspace without a
   * language server — and every hit carries a "text match" label, so the user
   * never mistakes a text hit for a semantic reference.
   * @param {string} identifier the identifier under the cursor
   * @returns {Promise<void>}
   */
  async findUsagesText(identifier) {
    const query = typeof identifier === 'string' ? identifier.trim() : ''
    if (query === '') return
    // The text version of Find Usages shares the popup with Find in Files:
    // two tabs over one data slice overwrote each other's query.
    this.set({ searchPopup: { open: true, index: 0, generation: (this.state.searchPopup?.generation ?? 0) + 1 } })
    this.patch('search', {
      query,
      wholeWord: true,
      caseSensitive: false,
      regexp: false,
      textMatch: true,
      loading: false,
      error: null,
      results: [],
      tookMs: 0,
      truncated: false,
    })
    await this.runSearch(query, { wholeWord: true, caseSensitive: false, regexp: false })
  }

  async runSearch(query, options = {}) {
    const value = typeof query === 'string' ? query : this.state.search.query
    const flags = {
      caseSensitive: options.caseSensitive ?? this.state.search.caseSensitive,
      wholeWord: options.wholeWord ?? this.state.search.wholeWord,
      regexp: options.regexp ?? this.state.search.regexp,
    }
    const token = ++this.searchToken
    this.searchIndex = -1
    // A new result set starts at the first hit: the old index would point
    // into a list that no longer exists.
    if (this.state.searchPopup?.open === true) this.set({ searchPopup: { ...this.state.searchPopup, index: 0 } })
    this.patch('search', {
      query: value, ...flags, loading: value !== '', error: null,
      results: value === '' ? [] : this.state.search.results,
      token,
    })
    if (value === '') return
    try {
      const result = await call('fs.search', { root: this.state.root, query: value, ...flags })
      if (token !== this.searchToken) return
      this.patch('search', {
        loading: false,
        results: result.files ?? [],
        tookMs: result.tookMs ?? 0,
        truncated: result.truncated === true,
        error: null,
      })
    } catch (error) {
      if (token !== this.searchToken) return
      this.patch('search', {
        loading: false, results: [], tookMs: 0, truncated: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // ── selection (JetBrains: select first, act second) ──────────────────
  /** Replace the selection; `anchor` is the pivot for Shift range selection. */
  setSelection(paths, anchor) {
    const list = (Array.isArray(paths) ? paths : []).filter(path => typeof path === 'string' && path !== '')
    const focus = typeof anchor === 'string' && anchor !== '' ? anchor : (list[list.length - 1] ?? '')
    this.set({ selectedPaths: new Set(list), selectedPath: focus, anchorPath: focus })
  }

  /** Ctrl+click toggle. */
  toggleSelection(path) {
    const next = new Set(this.state.selectedPaths)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    const focus = next.has(path) ? path : ([...next][next.size - 1] ?? '')
    this.set({ selectedPaths: next, selectedPath: focus, anchorPath: path })
  }

  /** Shift+click range over the currently visible row order. */
  selectRange(path, orderedPaths) {
    const anchor = this.state.anchorPath === '' ? path : this.state.anchorPath
    const from = orderedPaths.indexOf(anchor)
    const to = orderedPaths.indexOf(path)
    if (from < 0 || to < 0) { this.setSelection([path], path); return }
    const [start, end] = from <= to ? [from, to] : [to, from]
    this.set({ selectedPaths: new Set(orderedPaths.slice(start, end + 1)), selectedPath: path, anchorPath: anchor })
  }

  clearSelection() {
    this.set({ selectedPaths: new Set(), selectedPath: '', anchorPath: '' })
  }

  /** Absolute path for one project-relative path. */
  #absoluteOf(rel) {
    return joinPath(this.state.root, rel)
  }

  /** Project-relative path for one absolute path. */
  relOf(path) {
    const root = String(this.state.root ?? '').replace(/[\\/]+$/, '')
    const wide = String(path ?? '').replace(/\\/g, '/')
    const base = root.replace(/\\/g, '/')
    if (base === '' || wide === base) return ''
    return wide.startsWith(`${base}/`) ? wide.slice(base.length + 1) : wide
  }

  // ── file operations (JetBrains tree) ──────────────────────────────────
  setFileClipboard(paths, cut) {
    const list = (Array.isArray(paths) ? paths : []).filter(path => typeof path === 'string' && path !== '')
    this.set({ clipboard: list.length === 0 ? null : { paths: list, cut: cut === true } })
    if (list.length > 0) this.toast('success', this.t(cut === true ? 'project.cut' : 'project.copy'), `${list.length}`)
  }

  async pasteEntries(target) {
    const clipboard = this.state.clipboard
    if (clipboard === null || clipboard === undefined) return
    const moved = clipboard.cut === true
    await this.moveEntries(clipboard.paths, target, !moved)
    if (moved) this.set({ clipboard: null })
  }

  async createEntry(parent, options = {}) {
    const name = String(options.name ?? '').trim()
    if (name === '') return
    try {
      const result = await call('fs.create', {
        root: this.state.root,
        parent,
        name,
        isDir: options.isDir === true,
        content: typeof options.content === 'string' ? options.content : '',
      })
      await this.loadDir(parent, { force: true })
      await this.refreshStatus()
      const absolute = this.#absoluteOf(result.path)
      this.setSelection([absolute], absolute)
      if (result.isDir !== true) this.openFile(absolute, { rel: result.path, preview: false })
      this.persist()
    } catch (error) {
      this.toast('error', this.t('common.error'), errorMessage(error))
    }
  }

  async renameEntry(path, name) {
    const next = String(name ?? '').trim()
    if (next === '' || next === baseName(path)) return
    try {
      const result = await call('fs.rename', { root: this.state.root, path, name: next })
      this.#applyPathMapping([[path, this.#absoluteOf(result.target)]])
      await this.loadDir(parentPath(path), { force: true })
      await this.refreshStatus()
      this.persist()
    } catch (error) {
      this.toast('error', this.t('common.error'), errorMessage(error))
    }
  }

  async duplicateEntries(paths) {
    const list = Array.isArray(paths) ? paths : []
    if (list.length === 0) return
    let last
    for (const path of list) {
      try {
        last = await call('fs.duplicate', { root: this.state.root, path })
        await this.loadDir(parentPath(path), { force: true })
      } catch (error) {
        this.toast('error', this.t('common.error'), errorMessage(error))
      }
    }
    if (last !== undefined) {
      const absolute = this.#absoluteOf(last.target)
      this.setSelectedPath(absolute)
    }
    await this.refreshStatus()
    this.persist()
  }

  /**
   * Move or copy entries into a directory. Name conflicts auto-rename
   * (`name-copy`), matching JetBrains' duplicate behaviour.
   */
  async moveEntries(paths, target, copy = false) {
    const list = Array.isArray(paths) ? paths.filter(path => typeof path === 'string') : []
    if (list.length === 0 || typeof target !== 'string' || target === '') return
    try {
      const result = await call('fs.move', {
        root: this.state.root, paths: list, target, copy, conflict: 'rename',
      })
      const done = result.results.filter(item => item.ok === true)
      const failed = result.results.filter(item => item.ok !== true && item.skipped !== true)
      if (done.length > 0) {
        const mapping = done.map(item => [this.#absoluteOf(item.path), this.#absoluteOf(item.target)])
        this.#applyPathMapping(mapping)
        const dirs = new Set([...list.map(parentPath), target, ...done.map(item => parentPath(this.#absoluteOf(item.target)))])
        for (const dir of dirs) {
          try { await this.loadDir(dir, { force: true }) } catch { /* the folder may be gone */ }
        }
        const first = this.#absoluteOf(done[0].target)
        this.setSelectedPath(first)
        await this.refreshStatus()
      }
      if (failed.length > 0) {
        this.toast('error', this.t('common.error'), failed.map(item => `${item.path}: ${item.message ?? item.code}`).join('\n'))
      } else {
        this.toast('success', this.t('common.success'), `${done.length}`)
      }
      this.persist()
    } catch (error) {
      this.toast('error', this.t('common.error'), errorMessage(error))
    }
  }

  /** Confirmation then deletion (recycle bin when enabled). */
  requestDelete(paths) {
    const list = [...new Set((Array.isArray(paths) ? paths : []).filter(path => typeof path === 'string' && path !== ''))]
    if (list.length === 0) return
    const dirty = this.state.tabs.filter(tab => tab.kind === 'file' && tab.dirty === true
      && list.some(path => tab.path === path || tab.path.startsWith(`${path}\\`) || tab.path.startsWith(`${path}/`)))
    const names = list.map(path => baseName(path)).slice(0, 8).join(', ')
    const extra = dirty.length > 0 ? `\n${this.t('project.deleteDirty')}` : ''
    const target = this.state.settings?.delete?.useRecycleBin !== false
      ? this.t('project.deleteToTrash')
      : this.t('project.deletePermanent')
    this.askConfirm(
      this.t('project.deleteTitle'),
      `${list.length === 1 ? this.t('project.deleteOne') : `${list.length} ${this.t('project.deleteMany')}`}\n${names}${extra}\n${target}`,
      this.t('project.delete'),
      () => { void this.deleteEntries(list) },
    )
  }

  async deleteEntries(paths, options = {}) {
    const list = Array.isArray(paths) ? paths : []
    if (list.length === 0) return
    const trash = options.trash ?? this.state.settings?.delete?.useRecycleBin !== false
    try {
      const result = await call('fs.delete', {
        root: this.state.root,
        paths: list,
        trash,
        allowPermanent: trash !== true,
      })
      const done = result.results.filter(item => item.ok === true)
      const failed = result.results.filter(item => item.ok !== true)
      if (done.length > 0) {
        const removed = done.map(item => this.#absoluteOf(item.path))
        this.#closeTabsUnder(removed)
        const dirs = new Set(list.map(parentPath))
        for (const dir of dirs) {
          try { await this.loadDir(dir, { force: true }) } catch { /* gone */ }
        }
        this.clearSelection()
        await this.refreshStatus()
        this.persist()
      }
      const trashFailed = failed.filter(item => item.code === 'trash-failed')
      if (trashFailed.length > 0) {
        // Never fall through to a silent permanent delete: ask explicitly.
        this.askChoice(
          this.t('project.trashFailedTitle'),
          this.t('project.trashFailedBody'),
          [
            { key: 'cancel', label: this.t('common.cancel'), action: () => {} },
            {
              key: 'permanent', label: this.t('project.deletePermanently'), danger: true,
              action: () => { void this.deleteEntries(trashFailed.map(item => this.#absoluteOf(item.path)), { trash: false }) },
            },
          ],
        )
      }
      const otherFailed = failed.filter(item => item.code !== 'trash-failed')
      if (otherFailed.length > 0) this.toast('error', this.t('common.error'), otherFailed.map(item => item.message ?? item.code).join('\n'))
      else if (trashFailed.length === 0 && done.length > 0) this.toast('success', this.t('common.success'), `${done.length}`)
    } catch (error) {
      this.toast('error', this.t('common.error'), errorMessage(error))
    }
  }

  /** Synchronize: re-read the tree and the git snapshot, keep expansion. */
  async sync() {
    await this.reloadTree()
    await this.refreshStatus({ initial: true })
    this.toast('success', this.t('project.synchronized'), '')
  }

  /** Expand every folder (bounded so a huge repo cannot lock the UI). */
  async expandAll(limit = 400) {
    const expanded = new Set(this.state.expanded)
    const queue = [this.state.root]
    let visited = 0
    while (queue.length > 0 && visited < limit) {
      const dir = queue.shift()
      visited += 1
      expanded.add(dir)
      if (this.state.dirs.get(dir)?.entries === undefined) await this.loadDir(dir)
      const entries = this.state.dirs.get(dir)?.entries ?? []
      for (const entry of entries) if (entry.isDir) queue.push(entry.path)
    }
    this.set({ expanded })
    this.persist()
  }

  /** Re-key open file tabs (and the active id) after a rename/move. */
  #applyPathMapping(pairs) {
    if (!Array.isArray(pairs) || pairs.length === 0) return
    const mapPath = (path) => {
      for (const [from, to] of pairs) {
        if (path === from) return to
        if (path.startsWith(`${from}\\`) || path.startsWith(`${from}/`)) return to + path.slice(from.length)
      }
      return path
    }
    const wasActive = this.state.activeId
    let nextActive = wasActive
    const tabs = this.state.tabs.map((tab) => {
      if (tab.kind !== 'file' || typeof tab.path !== 'string') return tab
      const next = mapPath(tab.path)
      if (next === tab.path) return tab
      if (wasActive === tab.id) nextActive = `file:${next}`
      return { ...tab, id: `file:${next}`, path: next, name: baseName(next), rel: this.relOf(next) }
    })
    const selectedPath = mapPath(this.state.selectedPath)
    this.set({
      tabs,
      activeId: nextActive,
      selectedPath,
      selectedPaths: new Set(selectedPath === '' ? [] : [selectedPath]),
      anchorPath: selectedPath,
    })
  }

  /** Close file tabs whose path is gone. */
  #closeTabsUnder(roots) {
    const tabs = this.state.tabs.filter(tab => tab.kind !== 'file'
      || !roots.some(root => tab.path === root || tab.path.startsWith(`${root}\\`) || tab.path.startsWith(`${root}/`)))
    const activeId = tabs.some(tab => tab.id === this.state.activeId) ? this.state.activeId : (tabs[tabs.length - 1]?.id ?? null)
    this.set({ tabs, activeId })
  }

  /** Reveal one path in the native file manager. */
  async reveal(path) {
    try {
      await call('fs.reveal', { root: this.state.root, path })
    } catch (error) {
      this.toast('error', this.t('common.error'), error instanceof Error ? error.message : String(error))
    }
  }

  /** Open the saved file in the selected external IDE and current project. */
  async openInIde(ide, path) {
    try {
      const result = await call('fs.openInIde', { ide, root: this.state.root, path })
      this.toast('success', this.t('project.ideRequested'))
      return result
    } catch (error) {
      this.toast('error', this.t('project.ideFailed'), error instanceof Error ? error.message : String(error))
      return undefined
    }
  }

  openInIdea(path) {
    return this.openInIde('idea', path)
  }

  // ── editor tabs ───────────────────────────────────────────────────────
  get activeTab() {
    return this.state.tabs.find(tab => tab.id === this.state.activeId) ?? null
  }

  /** Effective editor open mode: explicit setting, else the legacy flag. */
  editorOpenMode() {
    const editor = this.state.settings?.editor
    if (editor?.openMode === 'editable' || editor?.openMode === 'readonly' || editor?.openMode === 'auto') {
      return editor.openMode
    }
    return editor?.defaultReadOnly === false ? 'editable' : 'auto'
  }

  editableMaxBytes() {
    const value = Number(this.state.settings?.editor?.editableMaxBytes)
    return Number.isFinite(value) && value > 0 ? value : 1 << 20
  }

  /**
   * Whether a file opens editable under the current mode.
   *
   * Markdown with the rendered preview enabled opens in the preview, not in
   * the source editor (README: "Markdown … Preview / Source"). Checking the
   * box "editable" is the explicit way to open the text buffer directly.
   * @param {number} [size] file size in bytes, when already known
   * @param {string} [path] absolute path, when the caller knows it
   */
  defaultEditing(size, path = '') {
    const mode = this.editorOpenMode()
    if (mode === 'readonly') return false
    if (path !== '' && isMarkdownPath(path) && this.state.settings?.editor?.markdownPreview !== false) {
      return mode === 'editable'
    }
    if (mode === 'editable') return true
    return !Number.isFinite(size) || size <= this.editableMaxBytes()
  }

  /**
   * Open a file with IDEA semantics:
   * - a pinned tab for the path is focused;
   * - a single click reuses the one preview tab (or creates it);
   * - a double click pins the tab (creating a pinned one when needed).
   * @param {string} path absolute path
   * @param {{ rel?: string, preview?: boolean, line?: number, column?: number }} [options]
   */
  openFile(path, options = {}) {
    if (typeof path !== 'string' || path === '') return
    const rel = options.rel ?? this.relOf(path)
    const existing = this.state.tabs.find(tab => tab.kind === 'file' && tab.path === path)
    if (existing !== undefined) {
      const tabs = this.state.tabs.map(tab => (tab === existing ? { ...tab, preview: tab.preview && options.preview === true } : tab))
      this.set({ tabs, activeId: existing.id })
      if (Number.isInteger(options.line)) {
        // A jump carries the column as well (PRD-v5 §5.5); without one the
        // previous column is dropped, so the caret lands on the line start.
        this.#updateTab(existing.id, {
          revealLine: options.line,
          revealColumn: Number.isInteger(options.column) ? options.column : null,
        })
      }
      this.setSelectedPath(path)
      if (options.preview !== true) void this.pinTab(existing.id, { silent: true })
      void this.ensureTabContent(existing.id)
      this.persist()
      return
    }
    const preview = options.preview === true
    const tab = {
      id: `file:${path}`,
      kind: 'file',
      path,
      name: baseName(path),
      rel,
      preview,
      pinned: !preview,
      loading: false,
      content: null,
      error: null,
      scrollTop: 0,
      editing: this.defaultEditing(undefined, path),
      editingUserSet: false,
      view: isMarkdownPath(path) && this.state.settings?.editor?.markdownPreview !== false ? 'preview' : 'code',
      draft: null,
      dirty: false,
      saving: false,
      conflict: null,
      revealLine: Number.isInteger(options.line) ? options.line : null,
      // The column of the jump target (PRD-v5 §5.5); null keeps the old
      // line-only behaviour.
      revealColumn: Number.isInteger(options.column) ? options.column : null,
    }
    let tabs = this.state.tabs
    if (preview) {
      const previewIndex = tabs.findIndex(item => item.kind === 'file' && item.preview)
      if (previewIndex >= 0) {
        const current = tabs[previewIndex]
        if (current.dirty === true) {
          // Never drop unsaved edits: pin the dirty preview first, then open the
          // new file in a fresh preview tab.
          tabs = [...tabs.map((item, index) => (index === previewIndex ? { ...item, preview: false, pinned: true } : item)), tab]
        } else {
          tabs = tabs.map((item, index) => (index === previewIndex ? tab : item))
        }
      } else {
        tabs = [...tabs, tab]
      }
    } else {
      tabs = [...tabs, tab]
    }
    this.set({ tabs, activeId: tab.id })
    this.setSelectedPath(path)
    void this.ensureTabContent(tab.id)
    this.persist()
  }

  /** Load (or reload) one tab's payload. */
  async ensureTabContent(id, options = {}) {
    const tab = this.state.tabs.find(item => item.id === id)
    if (tab === undefined) return
    if (tab.loading === true) return
    if (options.force !== true) {
      if (tab.kind === 'file' && tab.content !== null) return
      if (tab.kind === 'diff' && tab.payload !== undefined) return
      if (tab.kind === 'commit' && tab.detail !== undefined) return
    }
    this.#updateTab(id, { loading: true, error: null })
    try {
      if (tab.kind === 'file') {
        const result = await call('fs.read', { root: this.state.root, path: tab.path })
        const latest = this.state.tabs.find(item => item.id === id)
        const text = result.kind === 'text' ? normalizeNewlines(result.content) : null
        const eol = typeof result.content === 'string' && result.content.includes('\r\n') ? '\r\n' : '\n'
        const keepDraft = latest?.dirty === true && options.force === true && options.discardDraft !== true
        const editable = result.kind === 'text' && result.truncated !== true
          ? (latest?.editingUserSet === true ? latest.editing === true : this.defaultEditing(result.size, tab.path))
          : false
        // A forced reload (external change) must rebuild the CodeMirror document;
        // its value prop is only read on mount/resetToken change. `reloadTab`
        // rebuilds explicitly, so it is not doubled here.
        const rebuilt = options.force === true && !keepDraft && options.discardDraft !== true
        this.#updateTab(id, {
          loading: false,
          conflict: null,
          payload: text === null ? { ...result, eol } : { ...result, content: text, eol },
          content: text,
          // A forced refresh (external change) must not clobber unsaved edits.
          ...(keepDraft ? {} : { draft: text, dirty: false }),
          ...(rebuilt ? { resetToken: (latest?.resetToken ?? 0) + 1 } : {}),
          // Decision C: a file above the editable threshold opens read-only
          // even though the tab was created optimistically editable.
          ...(result.kind === 'text' && result.truncated !== true && !editable ? { editing: false } : {}),
        })
      } else if (tab.kind === 'diff') {
        const result = tab.compare !== undefined
          ? await call('git.diff-refs', { root: this.gitRoot, a: tab.compare.a, b: tab.compare.b })
          : tab.commitHash !== undefined
            ? await call('git.commit-file-diff', { root: this.gitRoot, hash: tab.commitHash, path: tab.rel })
            : (tab.against === 'head' || tab.against === 'latest')
              ? await call('git.diff-rev', { root: this.gitRoot, path: tab.rel, rev: tab.against })
              : await call('git.diff', {
                  root: this.gitRoot,
                  path: tab.rel,
                  staged: tab.staged === true,
                  untracked: tab.untracked === true,
                })
        this.#updateTab(id, { loading: false, payload: result })
      } else if (tab.kind === 'commit') {
        const detail = await call('git.detail', { root: this.gitRoot, hash: tab.hash })
        this.#updateTab(id, { loading: false, detail })
      }
    } catch (error) {
      if (tab.kind === 'file' && error?.code === 'not-found') {
        // A restored tab whose file was deleted outside the IDE must not
        // linger as a permanent error tab.
        this.closeTab(id, { force: true })
        return
      }
      this.#updateTab(id, { loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  #updateTab(id, patch) {
    const tabs = this.state.tabs.map(tab => (tab.id === id ? { ...tab, ...patch } : tab))
    this.set({ tabs })
  }

  updateActiveTab(patch) {
    if (this.state.activeId === null) return
    this.#updateTab(this.state.activeId, patch)
  }

  activateTab(id) {
    if (!this.state.tabs.some(tab => tab.id === id)) return
    this.set({ activeId: id })
    const tab = this.state.tabs.find(item => item.id === id)
    if (tab?.kind === 'file') this.setSelectedPath(tab.path)
    // The host cannot see which editor the user is in: the LRU order of the
    // memory pressure yield needs that fact, because yielding the focused
    // root interrupts the user (PRD-v5.1 §4.4, CONC-03).
    reportLspFocus(this.state.root)
    // A restored tab is read from disk when it is focused for the first time
    // (PRD-v4 §1.2 PERF-07).
    void this.ensureTabContent(id)
    this.persist()
  }

  async pinTab(id, options = {}) {
    const tab = this.state.tabs.find(item => item.id === id)
    if (tab === undefined || tab.kind !== 'file' || tab.pinned) return
    this.#updateTab(id, { preview: false, pinned: true })
    this.persist()
    if (options.silent !== true) this.toast('info', this.t('common.pinTab'))
  }

  closeTab(id, options = {}) {
    const index = this.state.tabs.findIndex(tab => tab.id === id)
    if (index < 0) return
    const tab = this.state.tabs[index]
    if (tab.dirty === true && options.force !== true) {
      this.askChoice(
        this.t('editor.unsavedTitle'),
        this.t('editor.unsavedClose'),
        [
          { key: 'cancel', label: this.t('common.cancel'), action: () => {} },
          {
            key: 'discard', label: this.t('editor.discardChanges'), danger: true,
            action: () => this.closeTab(id, { force: true }),
          },
          {
            key: 'save', label: this.t('editor.saveAndClose'), primary: true,
            action: () => {
              void this.saveTab(id).then(() => {
                const latest = this.state.tabs.find(item => item.id === id)
                if (latest === undefined || latest.dirty !== true) this.closeTab(id, { force: true })
              })
            },
          },
        ],
      )
      return
    }
    const tabs = this.state.tabs.filter(item => item.id !== id)
    let activeId = this.state.activeId
    if (activeId === id) {
      const next = tabs[Math.min(index, tabs.length - 1)]
      activeId = next?.id ?? null
    }
    this.set({ tabs, activeId })
    this.persist()
  }

  async closeOtherTabs(id) {
    const others = this.state.tabs.filter(tab => tab.id !== id && tab.dirty === true)
    for (const tab of others) await this.saveTab(tab.id)
    if (others.some(tab => this.state.tabs.find(item => item.id === tab.id)?.dirty === true)) {
      this.toast('error', this.t('editor.saveFailed'), this.t('editor.unsavedClose'))
      return
    }
    this.set({ tabs: this.state.tabs.filter(tab => tab.id === id), activeId: id })
    this.persist()
  }

  /** Switch one file tab between read-only and edit mode. */
  setTabEditing(id, editing) {
    const tab = this.state.tabs.find(item => item.id === id)
    if (tab === undefined || tab.kind !== 'file' || tab.payload?.kind !== 'text') return
    if (editing === true) {
      this.#updateTab(id, {
        editing: true,
        editingUserSet: true,
        view: 'code',
        conflict: null,
        draft: tab.draft ?? tab.payload.content ?? '',
      })
    } else {
      this.#updateTab(id, {
        editing: false,
        editingUserSet: true,
        view: isMarkdownPath(tab.path) ? 'preview' : 'code',
      })
    }
  }

  /** Switch the read-only renderer between rendered Markdown and source. */
  setTabView(id, view) {
    const tab = this.state.tabs.find(item => item.id === id)
    if (tab === undefined || tab.kind !== 'file') return
    this.#updateTab(id, { view: view === 'preview' ? 'preview' : 'code' })
  }

  /** Record one editor keystroke (dirty = differs from the saved buffer). */
  updateDraft(id, text) {
    const tab = this.state.tabs.find(item => item.id === id)
    if (tab === undefined || tab.kind !== 'file') return
    const saved = normalizeNewlines(tab.payload?.kind === 'text' ? tab.payload.content : (tab.content ?? ''))
    const draft = normalizeNewlines(text)
    this.#updateTab(id, { draft, dirty: draft !== saved })
  }

  /** Throw the buffer away and return to the saved content. */
  discardDraft(id) {
    const tab = this.state.tabs.find(item => item.id === id)
    if (tab === undefined || tab.kind !== 'file') return
    const saved = normalizeNewlines(tab.payload?.kind === 'text' ? tab.payload.content : '')
    this.#updateTab(id, {
      draft: saved,
      dirty: false,
      // Force the CodeMirror instance to rebuild with the saved document.
      resetToken: (tab.resetToken ?? 0) + 1,
    })
  }

  /**
   * Save every tab that has unsaved changes.
   *
   * The tabs are saved one after the other: a second write would race the
   * first one over the same file.
   * @returns {Promise<void>}
   */
  async saveDirtyTabs() {
    for (const tab of this.state.tabs.filter(item => item.dirty === true)) {
      await this.saveTab(tab.id)
    }
  }

  /** Persist one edited file through the host's fenced writer. */
  async saveTab(id, options = {}) {
    const tab = this.state.tabs.find(item => item.id === id)
    if (tab === undefined || tab.kind !== 'file' || tab.dirty !== true || tab.saving === true) return
    const text = normalizeNewlines(tab.draft ?? '')
    const payload = tab.payload ?? {}
    const eol = payload.eol === '\r\n' ? '\r\n' : '\n'
    const out = eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text
    this.#updateTab(id, { saving: true })
    try {
      const result = await call('fs.write', {
        root: this.state.root,
        path: tab.path,
        content: out,
        encoding: payload.encoding ?? 'utf-8',
        expectedMtimeMs: options.force === true ? undefined : (Number.isFinite(payload.mtimeMs) ? payload.mtimeMs : undefined),
      })
      const latest = this.state.tabs.find(item => item.id === id)
      const latestDraft = normalizeNewlines(latest?.draft ?? text)
      this.#updateTab(id, {
        saving: false,
        conflict: null,
        // Keystrokes typed while the write was in flight stay dirty.
        dirty: latestDraft !== text,
        content: text,
        draft: latestDraft,
        payload: { ...payload, content: text, size: result.size, mtimeMs: result.mtimeMs, encoding: result.encoding ?? payload.encoding },
      })
      this.toast('success', this.t('editor.saved'), baseName(tab.path))
      void this.refreshStatus({ initial: false })
    } catch (error) {
      this.#updateTab(id, { saving: false })
      if (error?.code === 'stale-file') {
        this.#updateTab(id, { conflict: { at: Date.now(), message: error.message } })
        this.askChoice(
          this.t('editor.conflictTitle'),
          this.t('editor.conflictBody'),
          [
            // "Cancel" means "not now": the conflict is cleared, otherwise the
            // document pane would raise the very same dialog again
            // (PRD-v4 review M6).
            { key: 'cancel', label: this.t('common.cancel'), action: () => { this.dismissConflict(id) } },
            {
              key: 'reload', label: this.t('editor.reloadFromDisk'), danger: true,
              action: () => { void this.reloadTab(id) },
            },
            {
              key: 'overwrite', label: this.t('editor.overwriteDisk'), primary: true,
              action: () => { void this.saveTab(id, { force: true }) },
            },
          ],
        )
        return
      }
      this.toast('error', this.t('editor.saveFailed'), error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Dismiss the conflict notice of one tab.
   *
   * The notice is a one-time offer: without clearing it, the document pane
   * raises the same dialog again on the next render (PRD-v4 review M6).
   * @param {string} tabId the tab whose conflict is dismissed
   */
  dismissConflict(tabId) {
    const tab = this.state.tabs.find(item => item.id === tabId)
    if (tab === undefined || tab.conflict === null || tab.conflict === undefined) return
    this.#updateTab(tabId, { conflict: null })
  }

  /** Reload one tab from disk, discarding the in-memory draft after confirm. */
  async reloadTab(id) {
    const tab = this.state.tabs.find(item => item.id === id)
    if (tab === undefined || tab.kind !== 'file') return
    this.#updateTab(id, { conflict: null })
    await this.ensureTabContent(id, { force: true, discardDraft: true })
    const latest = this.state.tabs.find(item => item.id === id)
    if (latest === undefined) return
    // Rebuild CodeMirror from the disk buffer; its `value` prop is only read on
    // mount or when `resetToken` changes, so a draft swap alone leaves the old
    // text on screen.
    this.#updateTab(id, {
      draft: latest.payload?.content ?? '',
      dirty: false,
      resetToken: (latest.resetToken ?? 0) + 1,
    })
  }

  /** Open the diff of one changed file (Commit / Git windows). */
  openDiff({ path, staged = false, untracked = false, against = null }) {
    if (typeof path !== 'string' || path === '') return
    const variant = against ?? (untracked ? 'untracked' : staged ? 'staged' : 'worktree')
    const id = `diff:${variant}:${path}`
    const existing = this.state.tabs.find(tab => tab.id === id)
    if (existing !== undefined) {
      this.set({ activeId: id })
      void this.ensureTabContent(id, { force: true })
      return
    }
    const tab = {
      id,
      kind: 'diff',
      path,
      name: baseName(path),
      rel: path,
      staged,
      untracked,
      against,
      preview: false,
      pinned: true,
      loading: false,
      error: null,
      scrollTop: 0,
      mode: this.state.commit.mode,
    }
    this.set({ tabs: [...this.state.tabs, tab], activeId: id })
    void this.ensureTabContent(id)
  }

  /** Open one file's diff inside a commit (bottom details pane). */
  openCommitFile(hash, path) {
    if (typeof hash !== 'string' || typeof path !== 'string' || path === '') return
    const id = `diff:commit:${hash}:${path}`
    const existing = this.state.tabs.find(tab => tab.id === id)
    if (existing !== undefined) {
      this.set({ activeId: id })
      void this.ensureTabContent(id, { force: true })
      return
    }
    const tab = {
      id,
      kind: 'diff',
      commitHash: hash,
      path,
      name: baseName(path),
      rel: path,
      preview: false,
      pinned: true,
      loading: false,
      error: null,
      scrollTop: 0,
      mode: this.state.commit.mode,
    }
    this.set({ tabs: [...this.state.tabs, tab], activeId: id })
    void this.ensureTabContent(id)
  }

  /** Ctrl+click in the log: pick up to two commits for Compare. */
  toggleCompare(hash) {
    if (typeof hash !== 'string' || hash === '') return
    const current = this.state.git.compare ?? []
    const next = current.includes(hash) ? current.filter(item => item !== hash) : [...current, hash].slice(-2)
    this.patch('git', { compare: next })
  }

  /** Open the selected pair as a two-ended diff tab. */
  compareSelected() {
    const [a, b] = this.state.git.compare ?? []
    this.openCompare(a, b)
  }

  /** Open any two refs (commit/branch/HEAD) as a read-only diff tab. */
  openCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a === '' || b === '' || a === b) return
    const id = `diff:range:${a}..${b}`
    const existing = this.state.tabs.find(tab => tab.id === id)
    if (existing !== undefined) {
      this.set({ activeId: id })
      void this.ensureTabContent(id, { force: true })
      return
    }
    const tab = {
      id,
      kind: 'diff',
      compare: { a, b },
      readOnly: true,
      path: `${a.slice(0, 7)}..${b.slice(0, 7)}`,
      rel: `${a.slice(0, 7)}..${b.slice(0, 7)}`,
      name: `${a.slice(0, 7)}..${b.slice(0, 7)}`,
      preview: false,
      pinned: true,
      loading: false,
      error: null,
      scrollTop: 0,
      mode: this.state.commit.mode,
    }
    this.set({ tabs: [...this.state.tabs, tab], activeId: id })
    void this.ensureTabContent(id)
  }

  async openCommit(hash) {
    const id = `commit:${hash}`
    const existing = this.state.tabs.find(tab => tab.id === id)
    if (existing !== undefined) {
      this.set({ activeId: id })
      void this.ensureTabContent(id)
      return
    }
    const tab = {
      id,
      kind: 'commit',
      hash,
      name: hash.slice(0, 7),
      rel: hash,
      preview: false,
      pinned: true,
      loading: false,
      error: null,
      scrollTop: 0,
    }
    this.set({ tabs: [...this.state.tabs, tab], activeId: id })
    void this.ensureTabContent(id)
  }

  setDiffMode(mode) {
    this.patch('commit', { mode })
    const tabs = this.state.tabs.map(tab => (tab.kind === 'diff' ? { ...tab, mode } : tab))
    this.set({ tabs })
    void this.updateSettings({ editor: { sideBySide: mode === 'side' } })
  }

  // ── commit window ─────────────────────────────────────────────────────
  get groups() {
    const entries = this.changedEntries
    return {
      staged: entries.filter(entry => entry.staged === true),
      unstaged: entries.filter(entry => entry.unstaged === true),
      untracked: entries.filter(entry => entry.untracked === true),
    }
  }

  get changedEntries() {
    return (this.state.status.entries ?? []).filter(entry => entry.ignored !== true)
  }

  /** V2 two-group model: Changes / Unversioned (checkbox never moves a row). */
  get commitGroups() {
    return splitCommitGroups(this.changedEntries, this.state.commit.buckets ?? {})
  }

  /** Whether one entry is included in the next commit. */
  isCommitChecked(entry) {
    return isEntryChecked(entry, this.state.commit)
  }

  get checkedCommitPaths() {
    return checkedPathsOf(this.changedEntries, this.state.commit)
  }

  get changeCount() {
    return this.changedEntries.length
  }

  /** Check / uncheck one file and keep the git index in sync immediately. */
  async toggleCommitEntry(entry) {
    await this.setCommitChecked([entry], this.isCommitChecked(entry) !== true)
  }

  /**
   * Check / uncheck a batch. Checking stages, unchecking restages; an
   * untracked file that gets added stays in the Unversioned group (bucket).
   *
   * An untracked file is **not** added to the index here (PRD-v4 §3.1): it is
   * only remembered in `commit.pendingStage` and added when the commit is
   * made. Checking a row therefore never changes the index, and the row keeps
   * its `U` letter and its untracked colour.
   */
  async setCommitChecked(entries, checked) {
    const list = (Array.isArray(entries) ? entries : []).filter(entry => entry !== null && entry !== undefined && entry.conflict !== true)
    if (list.length === 0) return
    const commit = this.state.commit
    const checkedSet = new Set(commit.checked)
    const uncheckedSet = new Set(commit.unchecked)
    const buckets = { ...(commit.buckets ?? {}) }
    const pendingStage = new Set(commit.pendingStage ?? [])
    const toStage = []
    const toUnstage = []
    for (const entry of list) {
      const currently = this.isCommitChecked(entry)
      if (currently === checked) continue
      if (checked) {
        checkedSet.add(entry.path)
        uncheckedSet.delete(entry.path)
        if (entry.untracked === true || buckets[entry.path] === 'untracked') buckets[entry.path] = 'untracked'
        if (entry.staged !== true) {
          if (entry.untracked === true) pendingStage.add(entry.path)
          else toStage.push(entry.path)
        }
      } else {
        checkedSet.delete(entry.path)
        uncheckedSet.add(entry.path)
        // The file may have entered the index by another route (the tree's
        // "Add" action), so the pending set is cleaned unconditionally; only a
        // file that really is staged needs an index reset.
        pendingStage.delete(entry.path)
        if (entry.staged === true) toUnstage.push(entry.path)
      }
    }
    this.patch('commit', {
      checked: checkedSet,
      unchecked: uncheckedSet,
      buckets,
      pendingStage,
      selectedPath: commit.selectedPath,
    })
    if (toStage.length > 0) await this.stage(toStage)
    if (toUnstage.length > 0) await this.unstage(toUnstage)
  }

  // ── changelists (client-side grouping only) ───────────────────────────
  #changelistDoc() {
    const all = this.state.settings?.changelists ?? {}
    const current = all[this.state.workspaceRoot]
    return {
      active: typeof current?.active === 'string' ? current.active : DEFAULT_CHANGELIST,
      lists: current?.lists !== null && typeof current?.lists === 'object' ? current.lists : {},
    }
  }

  get changelists() {
    return this.#changelistDoc()
  }

  changelistOf(path) {
    return changelistOf(path, this.#changelistDoc().lists)
  }

  async #saveChangelists(lists, active) {
    const all = { ...(this.state.settings?.changelists ?? {}) }
    all[this.state.workspaceRoot] = { active: active ?? this.#changelistDoc().active, lists }
    await this.updateSettings({ changelists: all })
  }

  /** Move paths into `target` (created on demand). */
  async moveToChangelist(paths, target) {
    const list = (Array.isArray(paths) ? paths : []).filter(path => typeof path === 'string' && path !== '')
    if (list.length === 0 || typeof target !== 'string' || target.trim() === '') return
    const name = target.trim()
    const lists = assignChangelist(this.#changelistDoc().lists, list, name)
    await this.#saveChangelists(lists, name)
  }

  /** Destructive changelist rename is out of V2; creating one is enough. */
  async createChangelist(name, paths = []) {
    const value = String(name ?? '').trim()
    if (value === '') return
    await this.moveToChangelist(paths, value)
  }

  async setActiveChangelist(name) {
    const value = String(name ?? '').trim()
    if (value === '') return
    await this.#saveChangelists(this.#changelistDoc().lists, value)
  }

  /** Delete one changelist; its paths fall back to Default. */
  async deleteChangelist(name) {
    const value = String(name ?? '').trim()
    if (value === '' || value === DEFAULT_CHANGELIST) return
    const lists = { ...this.#changelistDoc().lists }
    delete lists[value]
    await this.#saveChangelists(lists, DEFAULT_CHANGELIST)
  }

  async setGroupByDirectory(value) {
    await this.updateSettings({ commit: { ...(this.state.settings?.commit ?? {}), groupByDirectory: value === true } })
  }

  /** Append one changed path to the repository's .gitignore. */
  async ignoreEntry(path) {
    if (typeof path !== 'string' || path === '') return
    try {
      // The path and the repository must share one base (PRD-v4 review R3):
      // the file is addressed absolutely and the repository is given as an
      // absolute toplevel, so the host can write a legal entry such as
      // "/src/a.ts" into that repository's .gitignore.
      const absolute = joinPath(this.gitRoot, path)
      const repoRoot = this.state.status.repoRoot ?? this.gitRoot
      const fence = this.state.workspaceRoot !== '' ? this.state.workspaceRoot : this.state.root
      await call('git.ignore', {
        root: fence,
        path: absolute,
        repoRoot,
      })
      await this.refreshStatus({ initial: true })
      this.toast('success', this.t('common.success'), path)
    } catch (error) {
      this.toast('error', this.t('common.error'), errorMessage(error))
    }
  }

  /** Open a file in the editor (Change View "Jump to Source"). */
  jumpToSource(path) {
    if (typeof path !== 'string' || path === '') return
    // A status path is relative to the repository the Git window reads, which
    // may be another repository than the IDE project (PRD-v4 §4.1).
    const absolute = /^([a-zA-Z]:[\\/]|[\\/])/.test(path) ? path : joinPath(this.gitRoot, path)
    if (!this.#insideRoot(absolute)) {
      // The file lives outside the IDE project: the editor is fenced to the
      // project root, so it cannot open it. Say so instead of opening the
      // wrong file.
      this.toast('error', this.t('commit.outsideProject'), absolute)
      return
    }
    this.openFile(absolute, { rel: this.relOf(absolute), preview: false })
  }

  /** Revert one changed file after confirmation (Change View "Revert"). */
  revertChange(entry) {
    if (entry === undefined) return
    const name = entry.path.split(/[\\/]/).pop()
    this.askConfirm(
      this.t('commit.discardTitle'),
      `${this.t('commit.discardBody')}\n${name}`,
      this.t('commit.discard'),
      () => { void this.discardEntries([entry]) },
    )
  }

  setCommitMessage(message) {
    this.patch('commit', { message, error: null })
  }

  setAmend(amend) {
    this.patch('commit', { amend })
  }

  /** Toggle one pre-commit task (Run Tests / Optimize Imports / Code Cleanup). */
  setCommitTask(name, enabled) {
    const tasks = { ...(this.state.commit.tasks ?? {}), [name]: enabled === true }
    this.patch('commit', { tasks })
  }

  async loadCommitMessages() {
    if (this.state.root === '') return
    this.patch('commit', { messagesLoading: true })
    try {
      const result = await call('git.messages', { root: this.gitRoot, count: 10 })
      this.patch('commit', { messages: result.messages, messagesLoading: false })
    } catch {
      this.patch('commit', { messagesLoading: false })
    }
  }

  async stage(paths, options = {}) {
    if (paths.length === 0) return
    try {
      await call('git.stage', { root: this.gitRoot, paths })
      await this.refreshStatus({ initial: false })
      if (options.refreshDiff === true) this.#reloadActiveDiff()
    } catch (error) {
      this.toast('error', this.t('commit.failed'), error instanceof Error ? error.message : String(error))
    }
  }

  async unstage(paths, options = {}) {
    if (paths.length === 0) return
    try {
      await call('git.unstage', { root: this.gitRoot, paths })
      await this.refreshStatus({ initial: false })
      if (options.refreshDiff === true) this.#reloadActiveDiff()
    } catch (error) {
      this.toast('error', this.t('commit.failed'), error instanceof Error ? error.message : String(error))
    }
  }

  async stagePatch(patch, direction) {
    if (typeof patch !== 'string' || patch === '') {
      this.toast('info', this.t('commit.noChanges'))
      return
    }
    try {
      await call('git.apply-patch', { root: this.gitRoot, patch, direction })
      await this.refreshStatus({ initial: false })
      this.#reloadActiveDiff()
    } catch (error) {
      this.toast('error', this.t('commit.failed'), error instanceof Error ? error.message : String(error))
    }
  }

  async discardEntries(entries) {
    if (entries.length === 0) return
    // A newly added file has no HEAD version to restore: rollback means
    // removing it (the same outcome as reverting an untracked file).
    const added = entries.filter(entry => entry.untracked !== true && (entry.xy ?? '')[0] === 'A')
    const untracked = [
      ...entries.filter(entry => entry.untracked === true).map(entry => entry.path),
      ...added.map(entry => entry.path),
    ]
    const addedPaths = new Set(added.map(entry => entry.path))
    const tracked = entries
      .filter(entry => entry.untracked !== true && !addedPaths.has(entry.path))
      .map(entry => entry.path)
    try {
      await call('git.discard', { root: this.gitRoot, paths: tracked, untracked })
      await this.refreshStatus({ initial: false })
      this.toast('success', this.t('common.success'))
    } catch (error) {
      this.toast('error', this.t('commit.failed'), error instanceof Error ? error.message : String(error))
    }
  }

  #reloadActiveDiff() {
    const active = this.state.tabs.find(tab => tab.id === this.state.activeId)
    if (active?.kind === 'diff') void this.ensureTabContent(active.id, { force: true })
  }

  async commit(message, amend, pushAfter) {
    const state = this.state.commit
    if (state.committing) return
    if (typeof message !== 'string' || message.trim() === '') {
      this.patch('commit', { error: this.t('commit.messageRequired') })
      return
    }
    this.patch('commit', { committing: true, error: null })
    try {
      // Pre-commit tasks run before the commit; a failure aborts it and keeps
      // the message plus the index untouched.
      const tasks = state.tasks ?? {}
      const configured = [
        ['tests', this.state.settings?.commit?.testCommand, 'commit.taskTests'],
        ['optimize', this.state.settings?.commit?.optimizeImportsCommand, 'commit.taskOptimize'],
        ['cleanup', this.state.settings?.commit?.cleanupCommand, 'commit.taskCleanup'],
      ]
      for (const [key, command, labelKey] of configured) {
        if (tasks[key] !== true || typeof command !== 'string' || command.trim() === '') continue
        const outcome = await call('run.command', { root: this.state.root, command })
        if (outcome.code !== 0) {
          const text = `${this.t(labelKey)} · exit ${outcome.code}\n${outcome.output ?? ''}`.trim()
          this.patch('commit', { committing: false, error: text })
          this.toast('error', this.t('commit.taskFailed'), this.t(labelKey))
          return
        }
      }
      // The index may have moved since the last poll, so the commit runs
      // against a freshly forced status snapshot.
      await this.refreshStatus({ initial: false, force: true })
      // The untracked files the user checked are added now, not when they
      // were checked (PRD-v4 §3.1). A failed Add aborts the commit and leaves
      // the index as it was.
      const pendingStage = [...(this.state.commit.pendingStage ?? [])]
      if (pendingStage.length > 0) {
        try {
          await call('git.stage', { root: this.gitRoot, paths: pendingStage })
        } catch (error) {
          // Undo whatever reached the index, so no half-added file is left
          // behind, and keep the selection for a retry.
          await call('git.unstage', { root: this.gitRoot, paths: pendingStage }).catch(() => {})
          const text = error instanceof Error ? error.message : String(error)
          this.patch('commit', { committing: false, error: text })
          this.toast('error', this.t('commit.commitFailed'), text)
          return
        }
      }
      const result = await call('git.commit', { root: this.gitRoot, message, amend })
      this.patch('commit', {
        committing: false,
        message: '',
        amend: false,
        error: null,
        checked: new Set(),
        unchecked: new Set(),
        buckets: {},
        pendingStage: new Set(),
        selectedPath: '',
        tasks: { tests: false, optimize: false, cleanup: false },
      })
      this.toast('success', this.t('commit.committed'), result.hash ?? '')
      await this.refreshStatus({ initial: false })
      void this.loadCommitMessages()
      void this.loadLog(true)
      if (this.state.layout.bottom === 'git') void this.loadLog(true, { silent: true })
      if (pushAfter) await this.push({ afterCommit: true })
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      // The commit itself failed: undo the files this commit added, so no
      // half-added state is left behind (PRD-v4 §3.1). The pending set only
      // holds the untracked files this round added, so rolling it back never
      // touches what the user had staged before.
      const staged = [...(this.state.commit.pendingStage ?? [])]
      if (staged.length > 0) {
        await call('git.unstage', { root: this.gitRoot, paths: staged }).catch(() => {})
      }
      this.patch('commit', { committing: false, error: messageText })
      this.toast('error', this.t('commit.commitFailed'), messageText)
    }
  }

  /**
   * Push the commits the current branch is ahead of.
   *
   * The Commit panel has its own Push button, so a user who already committed
   * does not have to open a terminal. The state of the push is mirrored in
   * `commit.pushing`: a push may take a minute, and the button has to say so.
   * @param {{afterCommit?: boolean}} [options]
   * @returns {Promise<void>}
   */
  async push(options = {}) {
    this.patch('commit', { pushing: true })
    try {
      await call('git.push', { root: this.gitRoot })
      this.toast('success', this.t('commit.pushed'))
      await this.refreshStatus({ initial: false })
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      // A branch without an upstream is the most common failure, and the raw
      // git message is English and cryptic ("The current branch master has
      // no upstream branch"). The user gets the command to run instead.
      if (/no upstream branch|set-upstream|does not appear to be a git repository/i.test(text)) {
        // The command goes with a button that copies it: the user has to
        // run it in a terminal, and typing it by hand is where mistakes
        // happen.
        const command = this.#pushUpstreamHint()
        this.toast('error', this.t('commit.pushNoUpstream'), command, {
          label: this.t('common.copy'),
          copy: command,
          onDone: (ok) => { if (ok) this.toast('success', this.t('common.copied')) },
        })
      } else {
        this.toast('error', options.afterCommit === true ? this.t('commit.pushFailed') : this.t('commit.failed'), text)
      }
    } finally {
      this.patch('commit', { pushing: false })
    }
  }

  /**
   * The command that sets the upstream of the current branch.
   *
   * The branch name comes from the status the host reported, so the hint is
   * the command the user would have to type.
   * @returns {string} the command
   */
  #pushUpstreamHint() {
    const branch = this.state.status.branch
    const name = typeof branch === 'string' && branch !== '' ? branch : 'HEAD'
    return `git push --set-upstream origin ${name}`
  }

  // ── git window ────────────────────────────────────────────────────────
  setGitFilters(patch) {
    this.patch('git', {
      filters: { ...this.state.git.filters, ...patch },
      selectedHash: null,
      detail: null,
      detailHash: null,
      detailLoading: false,
    })
    void this.loadLog(true)
  }

  /** Project → Git | Show History: scope the log to one file or folder. */
  showHistory(rel) {
    const value = typeof rel === 'string' ? rel.replace(/[\\/]+$/, '') : ''
    // The log filter is a repository path (GIT-01), while the tree speaks
    // project-relative paths.
    const repoPath = value === '' ? '' : relativePathWithin(this.gitRoot, joinPath(this.state.root, value))
    const filter = repoPath === null ? '' : repoPath
    this.patch('git', { filters: { ...this.state.git.filters, path: filter }, selectedHash: null, detail: null })
    this.set({
      layout: {
        ...this.state.layout,
        bottom: 'git',
        ...(this.state.stacked === true ? { left: null } : {}),
      },
    })
    this.lastToolGroup = 'bottom'
    void this.loadLog(true)
    this.persist()
  }

  async loadBranches() {
    if (this.state.root === '') return
    try {
      const result = await call('git.branches', { root: this.gitRoot })
      this.patch('git', { branches: result.names ?? [] })
    } catch {
      this.patch('git', { branches: [] })
    }
  }

  async loadLog(reset, options = {}) {
    if (this.state.root === '') return
    if (this.state.git.loading && !reset) return
    const token = ++this.gitRequestToken
    const pageSize = 200
    const skip = reset ? 0 : this.state.git.skip
    this.patch('git', { loading: true, error: null })
    try {
      const result = await call('git.log', {
        root: this.gitRoot,
        skip,
        count: pageSize,
        ...this.state.git.filters,
      })
      if (token !== this.gitRequestToken) return
      const commits = reset ? result.commits : [...this.state.git.commits, ...result.commits]
      const selectedStillVisible = this.state.git.selectedHash === null
        || commits.some(commit => commit.hash === this.state.git.selectedHash)
      this.patch('git', {
        commits,
        skip: skip + result.commits.length,
        hasMore: result.commits.length >= pageSize,
        loading: false,
        error: null,
        ...(selectedStillVisible ? {} : { selectedHash: null, detail: null, detailHash: null, detailLoading: false }),
      })
      if (reset && commits.length > 0 && this.state.git.selectedHash === null) {
        // Select the newest commit without opening the Drawer; Enter/double
        // click then has a target.
        this.patch('git', { selectedHash: commits[0].hash })
      }
    } catch (error) {
      if (token !== this.gitRequestToken) return
      this.patch('git', { loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  loadMoreCommits() {
    if (this.state.git.hasMore && !this.state.git.loading) void this.loadLog(false)
  }

  /** Single click: select only. Never fires a git request or changes the Drawer. */
  selectCommit(hash) {
    if (typeof hash !== 'string' || hash === '') return
    this.patch('git', { selectedHash: hash })
  }

  /** Double click / Enter: load the commit into the right-hand Drawer. */
  async openCommitDetail(hash) {
    if (typeof hash !== 'string' || hash === '') return
    const token = ++this.gitDetailToken
    this.patch('git', { selectedHash: hash, detailHash: hash, detailLoading: true, detail: null })
    try {
      const detail = await call('git.detail', { root: this.gitRoot, hash })
      if (token !== this.gitDetailToken || this.state.git.detailHash !== hash) return
      this.patch('git', { detail, detailLoading: false })
    } catch (error) {
      if (token !== this.gitDetailToken) return
      this.patch('git', {
        detailLoading: false, detail: null,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  closeCommitDetail() {
    this.gitDetailToken += 1
    this.patch('git', { detail: null, detailHash: null, detailLoading: false })
  }

  /**
   * UI entry for branch switching: refuse a dirty worktree, then confirm.
   * `checkout` itself stays the transport call.
   */
  requestCheckout(ref) {
    if (typeof ref !== 'string' || ref === '') return
    if (ref === this.state.status.branch) return
    const dirty = (this.state.status.entries ?? []).filter(entry => entry.ignored !== true)
    if (dirty.length > 0) {
      this.toast('error', this.t('git.checkoutBlocked'), this.t('git.checkoutBlockedHint'))
      return
    }
    this.askChoice(
      this.t('git.checkout'),
      /^[0-9a-f]{7,40}$/i.test(ref) ? this.t('git.checkoutConfirm') : this.t('git.checkoutBranchConfirm'),
      [
        { key: 'cancel', label: this.t('common.cancel'), action: () => {} },
        {
          key: 'checkout', label: this.t('git.checkout'), primary: true,
          action: () => { void this.checkout(ref) },
        },
      ],
    )
  }

  async checkout(ref) {
    try {
      await call('git.checkout', { root: this.gitRoot, ref })
      this.toast('success', this.t('git.branchSwitched'), ref)
      const detached = /^[0-9a-f]{7,40}$/i.test(ref)
      this.patch('git', {
        branchInitialized: true,
        filters: { ...this.state.git.filters, branch: detached ? '' : ref },
        selectedHash: null,
        detail: null,
        detailHash: null,
      })
      await this.refreshStatus({ initial: true })
      void this.loadBranches()
      void this.loadLog(true)
    } catch (error) {
      this.toast('error', this.t('git.checkoutFailed'), error instanceof Error ? error.message : String(error))
    }
  }

  async revert(hash) {
    try {
      await call('git.revert', { root: this.gitRoot, hash })
      this.toast('success', this.t('git.reverted'))
      await this.refreshStatus({ initial: true })
      void this.loadLog(true)
    } catch (error) {
      this.toast('error', this.t('commit.failed'), error instanceof Error ? error.message : String(error))
    }
  }

  // ── terminal ──────────────────────────────────────────────────────────
  async refreshShells() {
    try {
      const result = await call('terminal.shells')
      this.patch('terminal', { shells: result.shells, shellsLoaded: true })
    } catch {
      this.patch('terminal', { shellsLoaded: true })
    }
  }

  /** Create one terminal session key (the view owns the socket). */
  addTerminal(options = {}) {
    const id = nextId('term')
    const shells = this.state.terminal.shells
    const preferred = this.state.settings?.terminal?.shell
    const shell = options.shellId ?? (preferred === 'auto' || preferred === undefined ? shells[0]?.id : preferred)
    const session = {
      key: id,
      id: undefined,
      title: shells.find(item => item.id === shell)?.label ?? this.t('terminal.title'),
      shell: shell ?? '',
      cwd: options.cwd ?? this.state.root,
      status: 'starting',
      exitCode: null,
      error: null,
    }
    const sessions = [...this.state.terminal.sessions, session]
    const layout = {
      ...this.state.layout,
      bottom: 'terminal',
      ...(this.state.stacked === true ? { left: null } : {}),
    }
    this.lastToolGroup = 'bottom'
    this.set({
      terminal: { ...this.state.terminal, sessions, activeKey: id },
      layout,
    })
    this.persist()
    return id
  }

  patchTerminal(key, patch) {
    const sessions = this.state.terminal.sessions.map(session => (session.key === key ? { ...session, ...patch } : session))
    this.set({ terminal: { ...this.state.terminal, sessions } })
  }

  activateTerminal(key) {
    const layout = {
      ...this.state.layout,
      bottom: 'terminal',
      ...(this.state.stacked === true ? { left: null } : {}),
    }
    this.lastToolGroup = 'bottom'
    this.set({ terminal: { ...this.state.terminal, activeKey: key }, layout })
    this.persist()
  }

  async closeTerminal(key) {
    const session = this.state.terminal.sessions.find(item => item.key === key)
    if (session === undefined) return
    const remove = () => {
      const sessions = this.state.terminal.sessions.filter(item => item.key !== key)
      const activeKey = this.state.terminal.activeKey === key ? (sessions[sessions.length - 1]?.key ?? null) : this.state.terminal.activeKey
      const layout = sessions.length === 0 ? { ...this.state.layout, bottom: null } : this.state.layout
      this.set({ terminal: { ...this.state.terminal, sessions, activeKey }, layout })
      this.persist()
    }
    if (session.id !== undefined && session.status === 'running') {
      try {
        const activity = await call('terminal.activity', { id: session.id })
        if (activity.state === 'busy') {
          this.askConfirm(
            this.t('terminal.close'),
            this.t('terminal.closeRunning'),
            this.t('terminal.close'),
            remove,
            false,
          )
          return
        }
      } catch {
        // Unknown activity: closing is still allowed.
      }
    }
    remove()
  }

  closeActiveTerminal() {
    if (this.state.terminal.activeKey !== null) void this.closeTerminal(this.state.terminal.activeKey)
  }

  // ── layout ────────────────────────────────────────────────────────────
  /**
   * Record the pane's layout mode. `transition` is only true for a measured
   * width change, never the first measurement of a freshly mounted pane.
   *
   * The stacked mode should not show four docks around a narrow content area:
   * a real width transition hides whatever is open, and a fresh mount hides
   * only when both groups are already open (a single default tool stays).
   * The hidden layout is kept for Ctrl+Shift+F12.
   * @param {boolean} stacked
   * @param {{ transition?: boolean }} [options]
   */
  setStacked(stacked, options = {}) {
    const next = stacked === true
    if (this.state.stacked === next) return
    const was = this.state.stacked === true
    this.set({ stacked: next })
    if (!was && next) {
      const layout = this.state.layout
      const hasLeft = layout.left !== null && layout.left !== undefined
      const hasBottom = layout.bottom !== null && layout.bottom !== undefined
      const crowded = hasLeft && hasBottom
      if (crowded || (options.transition === true && (hasLeft || hasBottom))) {
        this.hiddenLayout = { left: layout.left ?? null, bottom: layout.bottom ?? null }
        this.set({ layout: { ...layout, left: null, bottom: null } })
      }
    }
  }

  toggleTool(tool) {
    if (tool === 'project' || tool === 'commit') {
      const next = this.state.layout.left === tool ? null : tool
      const layout = {
        ...this.state.layout,
        left: next,
        ...(next !== null && this.state.stacked === true ? { bottom: null } : {}),
      }
      this.set({ layout })
      if (next !== null) this.lastToolGroup = 'left'
      if (layout.left === 'commit') this.#focusCommitLater()
      if (layout.left === 'project') this.set({ treeFocusTick: (this.state.treeFocusTick ?? 0) + 1 })
    } else {
      const next = this.state.layout.bottom === tool ? null : tool
      if (next === 'terminal' && this.state.terminal.sessions.length === 0) {
        this.addTerminal()
        return
      }
      this.set({
        layout: {
          ...this.state.layout,
          bottom: next,
          ...(next !== null && this.state.stacked === true ? { left: null } : {}),
        },
      })
      if (next !== null) this.lastToolGroup = 'bottom'
    }
    this.persist()
  }

  showTool(tool) {
    if (tool === 'project' || tool === 'commit') {
      this.set({
        layout: {
          ...this.state.layout,
          left: tool,
          ...(this.state.stacked === true ? { bottom: null } : {}),
        },
      })
      this.lastToolGroup = 'left'
      if (tool === 'commit') this.#focusCommitLater()
      if (tool === 'project') this.set({ treeFocusTick: (this.state.treeFocusTick ?? 0) + 1 })
      this.persist()
    } else if (tool === 'terminal' && this.state.terminal.sessions.length === 0) {
      this.addTerminal()
    } else {
      this.set({
        layout: {
          ...this.state.layout,
          bottom: tool,
          ...(this.state.stacked === true ? { left: null } : {}),
        },
      })
      this.lastToolGroup = 'bottom'
      this.persist()
    }
  }

  setLayout(patch) {
    this.set({ layout: { ...this.state.layout, ...patch } })
    this.persist()
  }

  /** Hide all tool windows (Ctrl+Shift+F12); a second call restores them. */
  toggleHideAll() {
    const layout = this.state.layout
    const visible = (layout.left !== null && layout.left !== undefined)
      || (layout.bottom !== null && layout.bottom !== undefined)
    if (visible) {
      this.hiddenLayout = { left: layout.left ?? null, bottom: layout.bottom ?? null }
      this.set({ layout: { ...layout, left: null, bottom: null } })
    } else {
      const saved = this.hiddenLayout ?? { left: 'project', bottom: null }
      // The stacked layout admits one group at a time: restore the group the
      // user opened last (or the only saved one) instead of re-creating the
      // cramped four-dock arrangement.
      const restore = this.state.stacked === true
        ? (saved.left !== null && saved.left !== undefined && (this.lastToolGroup === 'left' || saved.bottom === null || saved.bottom === undefined)
            ? { left: saved.left, bottom: null }
            : { left: null, bottom: saved.bottom ?? null })
        : saved
      this.set({ layout: { ...layout, ...restore } })
    }
    this.persist()
  }

  /** Cursor position from the code editor (status bar Ln:Col). */
  setCursor(cursor) {
    const current = this.state.cursor
    if (current !== null && cursor !== null && current.line === cursor.line && current.col === cursor.col) return
    this.set({ cursor })
  }

  /** Toggle the captured IDE pane's presentation, preserving the browser window. */
  toggleFullscreen(element) {
    const sidebar = this.ctx.sidebarRight
    if (sidebar === undefined) return false
    const target = sidebar.commandTarget(element)
    if (target === undefined) return false
    sidebar.toggleFullscreen(target)
    return true
  }

  #focusCommitLater() {
    // The Commit panel focuses its textarea when this counter changes.
    this.patch('commit', { focusTick: (this.state.commit.focusTick ?? 0) + 1 })
  }

  focusCommit() {
    this.set({
      layout: {
        ...this.state.layout,
        left: 'commit',
        ...(this.state.stacked === true ? { bottom: null } : {}),
      },
    })
    this.lastToolGroup = 'left'
    this.#focusCommitLater()
    this.persist()
  }

  // ── settings ──────────────────────────────────────────────────────────
  async updateSettings(patch) {
    try {
      const result = await call('settings.update', { patch })
      const before = this.state.settings?.project?.showIgnored === true
      const after = result.value?.project?.showIgnored === true
      this.set({ settings: result.value })
      // The host only lists ignored entries while that setting is on, so the
      // status has to be re-read as soon as the toggle changed.
      if (before !== after) void this.refreshStatus({ silent: true, force: true })
    } catch (error) {
      this.toast('error', this.t('commit.failed'), error instanceof Error ? error.message : String(error))
    }
  }

  openRootPicker() {
    this.set({ rootPicker: true })
  }

  closeRootPicker() {
    this.set({ rootPicker: false })
  }

  async addWorkspace(path) {
    try {
      const workspace = await call('workspace.add', { path })
      const items = this.state.workspaces.some(item => item.path === workspace.path)
        ? this.state.workspaces
        : [...this.state.workspaces, workspace]
      this.set({ workspaces: items, rootPicker: false })
      await this.setRoot(workspace.path)
    } catch (error) {
      this.toast('error', this.t('project.openWorkspace'), error instanceof Error ? error.message : String(error))
    }
  }

  /** Human summary for the status bar. */
  summary() {
    const status = this.state.status
    if (status.isRepo !== true) return { branch: undefined, changes: 0, ahead: undefined, behind: undefined }
    return {
      branch: status.branch,
      changes: (status.entries ?? []).filter(entry => entry.ignored !== true).length,
      ahead: status.ahead,
      behind: status.behind,
    }
  }
}

/**
 * The resident workspace stores, ordered least recently used first.
 *
 * One store holds the whole file tree, the tab list and the git snapshot of
 * its workspace, so keeping one per visited workspace grows the memory
 * without bound. Only the most recent workspaces stay resident; an older one
 * is deactivated and dropped. Its persisted state (expanded folders, open
 * tabs, dock geometry) survives, so re-entering the workspace restores it.
 *
 * A workspace whose Session is still mounted keeps its store: the mounted
 * body would lose its in-memory state when the store disappears.
 */
export class StoreCache {
  /**
   * @param {{ limit?: number, isMounted?: (sessionId: string) => boolean }} [options]
   */
  constructor(options = {}) {
    this.limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 3
    this.isMounted = typeof options.isMounted === 'function' ? options.isMounted : () => false
    /** workspace key → store, in least-recently-used order. */
    this.stores = new Map()
    /** workspace key → the Sessions that share that store. */
    this.sessions = new Map()
  }

  /** How many stores are resident. */
  get size() {
    return this.stores.size
  }

  /** The store of one workspace key, moved to the most recent slot. */
  get(key) {
    const store = this.stores.get(key)
    if (store === undefined) return undefined
    this.stores.delete(key)
    this.stores.set(key, store)
    return store
  }

  /**
   * Remember that one Session uses the store of one workspace key.
   * A workspace can be shared by several Sessions; every one of them must be
   * known before the store may be evicted.
   * @param {string} key workspace key
   * @param {string} sessionId the Session that uses the store
   */
  claim(key, sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return
    const sessions = this.sessions.get(key)
    if (sessions === undefined) this.sessions.set(key, new Set([sessionId]))
    else sessions.add(sessionId)
  }

  /**
   * Remember the store of one workspace key and the Session that uses it.
   * @param {string} key workspace key
   * @param {any} store the workspace store
   * @param {string} sessionId the Session that uses it
   * @param {{ evict?: boolean }} [options] `evict: false` keeps the cache as
   *   it is; the caller evicts later (outside a render).
   */
  set(key, store, sessionId, options = {}) {
    this.stores.delete(key)
    this.stores.set(key, store)
    this.claim(key, sessionId)
    if (options.evict !== false) this.evict()
    if (process.env.NODE_ENV !== 'production' && perfCounters !== null) perfCounters.stores = this.stores.size
    return store
  }

  /**
   * Drop the least recently used stores until the cache fits its limit.
   *
   * A workspace that still has a mounted Session keeps its store, and so does
   * a store with unsaved edits: the persisted workspace state does not carry
   * the draft, so evicting it would lose the content silently (PRD-v4 review
   * R1).
   */
  evict() {
    if (this.stores.size <= this.limit) return
    for (const [key, store] of [...this.stores]) {
      if (this.stores.size <= this.limit) break
      const sessions = this.sessions.get(key)
      const alive = sessions !== undefined && [...sessions].some(id => this.isMounted(id))
      if (alive) continue
      // A store with unsaved edits keeps its buffer: the persisted workspace
      // state does not carry the draft, so evicting it would lose the
      // content silently.
      const tabs = store?.state?.tabs ?? []
      if (tabs.some(tab => tab.dirty === true)) continue
      // An evicted store is gone for good: its timers have to stop. A store
      // that is only paused (`deactivate`) keeps the language-server poll
      // running, so every visited workspace would poll for ever.
      if (typeof store.dispose === 'function') store.dispose()
      else store.deactivate()
      this.stores.delete(key)
      this.sessions.delete(key)
    }
  }

  /** Deactivate and drop every store (plugin teardown). */
  clear() {
    for (const store of this.stores.values()) {
      if (typeof store.dispose === 'function') store.dispose()
      else store.deactivate()
    }
    this.stores.clear()
    this.sessions.clear()
    if (process.env.NODE_ENV !== 'production' && perfCounters !== null) perfCounters.stores = 0
  }
}
