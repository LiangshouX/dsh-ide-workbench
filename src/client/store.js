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
      /** The language-server registry (`lsp.servers`), fetched once per language. */
      servers: { available: [], missing: [], disabled: [] },
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
    /** Resolver of the pending index decision, if a dialog is open. */
    this.indexDecisionResolve = null
    /** Resolver of the pending memory warning, if a dialog is open. */
    this.memoryDecisionResolve = null
    /** The languages whose server registry was already fetched. */
    this.lspServersChecked = new Set()
  }

  // ── subscription ──────────────────────────────────────────────────────
  subscribe = (listener) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
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
  toast(kind, text, detail) {
    const id = nextId('toast')
    this.set({ toast: { id, kind, text, detail: detail ?? '' } })
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
      this.set({
        settings,
        workspaces: workspaces.items,
        home: workspaces.defaultDirectory ?? '',
        workspaceRoot: preferred ?? '',
        root: typeof savedProject === 'string' && savedProject !== '' ? savedProject : (preferred ?? ''),
        phase: 'ready',
      })
      if (preferred !== undefined && preferred !== '') {
        await this.loadProjects(preferred)
        const projectRoot = this.#projectRootFor(preferred)
        this.set({ root: projectRoot, gitRepoRoot: this.#defaultGitRepoRoot(projectRoot) })
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
      .then((result) => { this.state.settings = result.value })
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
    const choice = await this.#decideIndex(project, ask)
    if (choice === 'cancel') return false
    await this.#switchProject(project.path)
    if (choice === 'build') await this.#startLsp(project.path)
    if (choice === 'build-forced') await this.#startLsp(project.path, { force: true })
    return true
  }

  /**
   * The index decision for one project root (PRD-v5 §2.3).
   *
   * Resolves with `'build'` (start the language server), `'build-forced'`
   * (start it although the memory is tight - the user said so),
   * `'conservative'` (stay in the basic mode) or `'cancel'` (do not switch
   * the project).
   * @param {{path: string, name?: string, isRoot?: boolean, isRepo?: boolean}} project
   * @param {boolean} [ask] false skips the dialog and stays conservative
   * @returns {Promise<'build'|'build-forced'|'conservative'|'cancel'>}
   */
  async #decideIndex(project, ask = true) {
    const lsp = this.state.settings?.lsp
    // A profile without the semantic-analysis section (a settings document
    // written before schema 3, or a host without the feature) has nothing to
    // start: the workbench stays in the conservative mode.
    if (lsp === null || lsp === undefined || typeof lsp !== 'object') return 'conservative'
    // The master switch and the "never index" policy both keep the workbench
    // in the conservative mode: no language server is started at all.
    if (lsp.enabled === false) return 'conservative'
    if ((lsp.indexOnOpen ?? 'ask') === 'never') return 'conservative'
    // The memory pre-check runs before every start (PRD-v5 §2.2). It has
    // three bands now:
    //
    //   - enough memory      -> start
    //   - tight              -> ask the user (the host refuses to start
    //                           without an explicit "yes")
    //   - below the floor    -> degrade right away
    //
    // The old model had a single gate of 2 GB, so a YAML project on a
    // machine with 300 MB free could never start its server.
    const resources = await this.#lspResources(project.path)
    // The "tight" band comes first: in the window between the hard floor and
    // the estimate the host refuses to start without a forced start, and the
    // user has to decide. The hard-floor band (below the floor) is the only
    // one that degrades right away.
    if (resources !== null && resources.tight === true && this.#memoryWarned(project.path) === false) {
      const choice = await this.#askMemoryDecision(project, resources)
      // The answer is remembered either way: the same project must not ask
      // again, but the user may change their mind in the settings.
      this.#rememberMemoryWarning(project.path)
      if (choice === 'conservative') return 'conservative'
      return 'build-forced'
    }
    if (resources !== null && resources.canIndex === false) {
      const need = Math.round(resources.needMB ?? ((resources.thresholdBytes ?? resources.memoryLimitBytes ?? 0) / (1024 * 1024)))
      const free = Math.round((resources.freeBytes ?? 0) / (1024 * 1024))
      this.toast('error', this.#tpl('lsp.lowMemory', { need, free }), this.t('lsp.lowMemoryHint'))
      return 'conservative'
    }
    // An already indexed folder needs no question: the language server is
    // started right away (risk #26: the indexed path has no extra step).
    if (this.#isIndexed(project)) return 'build'
    if ((lsp.indexOnOpen ?? 'ask') === 'always') return 'build'
    // Without a dialog to answer it, the workbench stays conservative.
    if (ask === false) return 'conservative'
    return this.#askIndexDecision(project, resources)
  }

  /**
   * Whether the user was already warned about the memory of one project.
   * @param {string} root the project root
   * @returns {boolean} true when the warning must not be shown again
   */
  #memoryWarned(root) {
    const warned = this.state.settings?.lsp?.memoryWarnedRoots
    if (warned === null || warned === undefined || typeof warned !== 'object') return false
    return Object.keys(warned).some(key => sameScopePath(key, root))
  }

  /**
   * Remember that the user answered the memory warning for one project.
   *
   * The answer is written to the settings, so it survives a restart of the
   * workbench. A failure is not fatal: the user is asked again next time.
   * @param {string} root the project root
   */
  #rememberMemoryWarning(root) {
    const warned = this.state.settings?.lsp?.memoryWarnedRoots
    const next = { ...(warned !== null && typeof warned === 'object' ? warned : {}), [root]: true }
    this.set({ settings: { ...this.state.settings, lsp: { ...this.state.settings.lsp, memoryWarnedRoots: next } } })
    void call('settings.update', { patch: { lsp: { memoryWarnedRoots: next } } }).catch(() => {})
  }

  /**
   * Show the memory warning and wait for the user's answer.
   *
   * The host refuses to start a language server on a tight budget unless the
   * start is forced, so this dialog is the only way out of the "tight" band.
   * @param {{path: string, name?: string}} project
   * @param {{needMB?: number, freeBytes?: number, languageId?: string}} resources
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
          freeMB: Math.round((resources.freeBytes ?? 0) / (1024 * 1024)),
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
   * `null` means "the host could not answer": the check is skipped then, and
   * the host's own guard in `lsp.start` is the last line of defence.
   * @param {string} root
   * @returns {Promise<{canIndex?: boolean, freeBytes?: number, thresholdBytes?: number, memoryLimitBytes?: number}|null>}
   */
  async #lspResources(root) {
    try {
      const result = await call('lsp.resources', { root })
      if (result === null || typeof result !== 'object') return null
      return result
    } catch {
      return null
    }
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
      const result = await call('lsp.start', { root, force: options.force === true })
      await this.refreshLspStatus()
      return result
    } catch {
      // The status bar shows the failure; a toast here would only add noise.
      return null
    }
  }

  /**
   * Rebuild the index of the current project.
   *
   * A degraded or crashed session used to be recoverable only by switching
   * the project away and back. The old session is shut down first: otherwise
   * the new one would find the memory the old one still holds.
   * @returns {Promise<void>}
   */
  async restartLsp() {
    const root = this.state.root
    if (root === '') return
    this.patch('lsp', { rebuilding: true })
    try {
      await call('lsp.shutdown', { root })
    } catch {
      // A session that is already gone is not an error here.
    }
    try {
      await call('lsp.start', { root })
    } catch {
      // The status bar shows the failure.
    }
    await this.refreshLspStatus()
    this.patch('lsp', { rebuilding: false })
  }

  /**
   * Fall back to the conservative mode: the language server of the current
   * project is stopped and its memory is released.
   * @returns {Promise<void>}
   */
  async degradeLsp() {
    const root = this.state.root
    if (root === '') return
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
    const ready = lsp.enabled !== false && lsp.state === 'ready'
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
      const next = { ...state.settings, ...result.value }
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
    // status, but only while the workbench is the visible surface.
    if (this.lspPollTimer === null) {
      this.lspPollTimer = setInterval(() => { void this.pollLspStatus() }, 2000)
      void this.pollLspStatus()
    }
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
    if (this.lspPollTimer !== null) {
      clearInterval(this.lspPollTimer)
      this.lspPollTimer = null
    }
    if (this.restoredTimer !== null) {
      clearTimeout(this.restoredTimer)
      this.restoredTimer = null
    }
    void this.persistNow()
  }

  async pollStatus() {
    if (!this.state.active || this.state.root === '' || this.polling) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    await this.refreshStatus({ silent: true })
    await this.#checkActiveFileOnDisk()
  }

  /**
   * Poll the language-server status while the workbench is visible.
   *
   * The poll only reads: the host owns the state machine, so the client
   * never derives a state of its own.
   * @returns {Promise<void>}
   */
  async pollLspStatus() {
    if (!this.state.active || this.state.root === '') return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    await this.refreshLspStatus()
  }

  /**
   * Refresh the mirrored language-server status (PRD-v5 §3.1, §4.3).
   *
   * A crash is announced exactly once: the poll would otherwise repeat the
   * toast every two seconds.
   * @returns {Promise<void>}
   */
  async refreshLspStatus() {
    const root = this.state.root
    if (root === '') return
    let status
    try {
      status = await call('lsp.status', { root })
    } catch {
      return
    }
    if (status === null || typeof status !== 'object') return
    const previous = this.state.lsp.state
    const next = {
      ...this.state.lsp,
      enabled: status.enabled !== false,
      state: typeof status.state === 'string' && status.state !== '' ? status.state : 'idle',
      languageId: typeof status.languageId === 'string' ? status.languageId : '',
      serverId: typeof status.serverId === 'string' ? status.serverId : '',
      source: typeof status.source === 'string' ? status.source : null,
      detail: typeof status.detail === 'string' ? status.detail : null,
      indexedRoots: Array.isArray(status.indexedRoots) ? status.indexedRoots : [],
    }
    // The memory snapshot travels with the status (the host reads it in the
    // same call), so the numbers are live without a second request. It is
    // compared in megabytes: the free memory changes in bytes every time,
    // and a new object on every poll would wake the whole workbench every
    // two seconds for a number that did not move.
    const resources = status.resources ?? null
    const known = this.state.lsp.resources ?? null
    const memoryChanged = resources === null
      ? known !== null
      : (known === null
        || Math.round(known.freeBytes / (1024 * 1024)) !== Math.round(resources.freeBytes / (1024 * 1024))
        || known.needMB !== resources.needMB
        || known.canIndex !== resources.canIndex
        || known.tight !== resources.tight)
    if (memoryChanged) next.resources = resources
    // A running build reports its progress through `lsp.index`.
    if (next.state === 'building') {
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
      || memoryChanged
    if (changed) this.set({ lsp: next })
    // The crash is a one-time event: the toast must not repeat on every poll.
    if (next.state === 'crashed' && previous !== 'crashed') {
      this.toast('error', this.t('lsp.crashedToast'))
    }
    // The "not installed" state needs the server registry; it is fetched once
    // per language, not on every poll.
    if (next.languageId !== '' && !this.lspServersChecked.has(next.languageId)) {
      this.lspServersChecked.add(next.languageId)
      void this.#loadLspServers()
    }
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
   * The language-server registry (PRD-v5 §3.1).
   *
   * It tells the status bar whether a language has no server at all, which is
   * a different state than "the server failed".
   * @returns {Promise<void>}
   */
  async #loadLspServers() {
    try {
      const result = await call('lsp.servers', {})
      this.patch('lsp', {
        servers: {
          available: Array.isArray(result?.available) ? result.available : [],
          missing: Array.isArray(result?.missing) ? result.missing : [],
          disabled: Array.isArray(result?.disabled) ? result.disabled : [],
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
      const previousPaths = new Set(this.state.status.entries.map(entry => entry.path))
      const nextPaths = new Set(status.entries.map(entry => entry.path))
      const changed = status.entries.some(entry => !previousPaths.has(entry.path))
        || [...previousPaths].some(path => !nextPaths.has(path))
      this.set({
        status,
        statusError: null,
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
    this.openSearchResult(hit.path, hit.line)
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
  openSearchResult(rel, line) {
    if (typeof rel !== 'string' || rel === '') return
    const absolute = this.#absoluteOf(rel)
    // The popup is a one-shot tool: opening a hit ends it, so the code the
    // user was working on stays in front.
    this.closeSearchPopup()
    this.openFile(absolute, { rel, preview: false, line: Number.isInteger(line) ? line : 1 })
  }

  /**
   * Open the Find in Files popup.
   *
   * The results used to live in a tab of the editor area, which took a tab
   * away from the code the user was working on. The popup floats above the
   * editor instead (PRD-v5 supplement, FIND-01).
   * @param {string} [query] the query to run right away
   */
  openSearchPopup(query = '') {
    this.set({ searchPopup: { open: true, index: 0, generation: (this.state.searchPopup?.generation ?? 0) + 1 } })
    // A plain Find in Files run is not a text-match run: the label of the
    // usages view must not leak into it.
    this.patch('search', { textMatch: false })
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
        this.toast('error', this.t('commit.pushNoUpstream'), this.#pushUpstreamHint())
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
      store.deactivate()
      this.stores.delete(key)
      this.sessions.delete(key)
    }
  }

  /** Deactivate and drop every store (plugin teardown). */
  clear() {
    for (const store of this.stores.values()) store.deactivate()
    this.stores.clear()
    this.sessions.clear()
    if (process.env.NODE_ENV !== 'production' && perfCounters !== null) perfCounters.stores = 0
  }
}
