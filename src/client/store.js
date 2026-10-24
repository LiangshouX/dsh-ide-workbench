/**
 * The workbench store: one shared repository snapshot behind all four tool
 * windows (Project / Commit / Git / Terminal).
 *
 * The store lives for the lifetime of the plugin fiber (created in `apply`),
 * not for the lifetime of the rendered panel, so switching back to the
 * Conversation and returning keeps tabs, expanded folders and layout.
 */
import { call } from './api.js'
import { isMarkdownFile } from './file-types.js'
import {
  DEFAULT_CHANGELIST, assignChangelist, changelistOf, isEntryChecked, splitCommitGroups, checkedPathsOf,
} from './commit-model.js'
import { baseName, debounce, dirName, formatGitDate } from './util.js'
import { fileAddressFor, fileUrlForPath, parseFileAddress, resolveFileAddress } from './file-address.js'
import { openInDefaultSidebar } from './file-link.js'
import {
  composeCodeReference, formatFileMention, insertChatText,
} from './chat-bridge.js'
import { isPathWithin, sameScopePath, sessionCwdOf } from './workspace-scope.js'

let sequence = 0
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
    /** Root + first-level folders offered by the project picker. */
    projects: [],
    projectPicker: false,
    home: '',
    workspaces: [],
    settings: null,
    status: { isRepo: false, entries: [], branch: undefined, detached: false, ahead: undefined, behind: undefined, root: null },
    statusError: null,
    statusAt: 0,
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
      loading: false,
      error: null,
      results: [],
      tookMs: 0,
      truncated: false,
      token: 0,
    },
    commit: {
      message: '',
      amend: false,
      messages: [],
      messagesLoading: false,
      committing: false,
      error: null,
      mode: 'side',
      /** Explicitly checked / unchecked paths (checkbox = include in commit). */
      checked: new Set(),
      unchecked: new Set(),
      /** Paths that stay in the Unversioned group after `git add`. */
      buckets: {},
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
  }

  // ── subscription ──────────────────────────────────────────────────────
  subscribe = (listener) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = () => this.state

  /** Replace state and notify (one render per change). */
  set(patch) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
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
        this.set({ root: projectRoot })
        this.#restoreWorkspace(projectRoot)
        void this.loadRestoredTree()
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
      return { status: 'outside-workspace', absolute }
    }
    if (this.#insideRoot(absolute)) {
      this.#revealInProject(absolute, options.line)
      return { status: 'opened', absolute }
    }
    // Inside the workspace but outside the current IDE project (the project is
    // a sub-folder). Widening the project resets the tree, Git view and tabs,
    // so it only happens after the user agrees.
    if (this.state.tabs.some(tab => tab.dirty === true)) {
      return { status: 'dirty', absolute }
    }
    if (options.switchProject !== true) {
      return { status: 'needs-project-switch', absolute }
    }
    const switched = await this.selectProject(workspace)
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
            }))
        : []
    } catch {
      projects = []
    }
    if (!projects.some(project => project.path === workspaceRoot)) {
      projects.unshift({ path: workspaceRoot, name: baseName(workspaceRoot), isRepo: false, isRoot: true })
    }
    this.set({ projects })
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
    })
    this.#rememberProjectRoot(projectRoot)
    this.#restoreWorkspace(projectRoot)
    void this.loadRestoredTree()
    await this.refreshStatus({ initial: true })
    void this.refreshShells()
    void this.loadLog(true)
    void this.persistNow()
  }

  /** Switch the IDE project root inside the current workspace. */
  async selectProject(projectRoot) {
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
      this.askConfirm(
        this.t('editor.unsavedTitle'),
        this.t('editor.unsavedSwitchRoot'),
        this.t('editor.discardChanges'),
        () => { void this.#switchProject(project.path) },
      )
      return false
    }
    await this.#switchProject(project.path)
    return true
  }

  async #switchProject(projectRoot) {
    this.set({
      root: projectRoot,
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
    })
    this.#rememberProjectRoot(projectRoot)
    this.#restoreWorkspace(projectRoot)
    void this.loadRestoredTree()
    await this.refreshStatus({ initial: true })
    void this.refreshShells()
    void this.loadLog(true)
    void this.persistNow()
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
    for (const tab of tabs) void this.ensureTabContent(tab.id)
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
    if (this.state.root !== '' && this.state.statusAt === 0) void this.refreshStatus({ initial: true })
    if (this.state.root !== '' && !this.state.dirs.has(this.state.root)) void this.loadRestoredTree()
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
    void this.persistNow()
  }

  async pollStatus() {
    if (!this.state.active || this.state.root === '' || this.polling) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    await this.refreshStatus({ silent: true })
    await this.#checkActiveFileOnDisk()
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

  async refreshStatus(options = {}) {
    if (this.state.root === '') return
    if (this.polling && options.silent !== false) return
    this.polling = true
    const root = this.state.root
    try {
      const status = await call('git.status', { root })
      if (this.state.root !== root) return
      const previousPaths = new Set(this.state.status.entries.map(entry => entry.path))
      const nextPaths = new Set(status.entries.map(entry => entry.path))
      const changed = status.entries.some(entry => !previousPaths.has(entry.path))
        || [...previousPaths].some(path => !nextPaths.has(path))
      this.set({
        status,
        statusError: null,
        statusAt: Date.now(),
      })
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

  /** Reload only the expanded directories that contain a changed path. */
  #invalidateChangedDirs(status) {
    const dirtyParents = new Set()
    for (const entry of status.entries) {
      dirtyParents.add(parentPath(joinPath(this.state.root, entry.path)))
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
    const entry = status.entries.find(item => item.path === active.rel)
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
   * Load the persisted tree: the root plus every folder the user had expanded.
   *
   * The workspace state restores `expanded` synchronously, so without this the
   * first render of a restored project shows a permanent "loading" row under
   * each expanded folder (nothing ever asks for its listing).
   */
  async loadRestoredTree() {
    if (this.state.root === '') return
    const root = this.state.root
    await this.loadDir(root)
    if (this.state.root !== root) return
    const pending = [...this.state.expanded]
      .filter(dir => dir !== root && dir.startsWith(`${root}${root.includes('\\') ? '\\' : '/'}`) && this.state.dirs.get(dir)?.entries === undefined)
      .slice(0, 200)
    await Promise.all(pending.map(dir => this.loadDir(dir)))
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
    const hits = []
    for (const file of this.state.search.results ?? []) {
      for (const match of file.matches ?? []) hits.push({ path: file.path, line: match.line })
    }
    if (hits.length === 0) return
    this.searchIndex = (this.searchIndex + (delta >= 0 ? 1 : -1) + hits.length) % hits.length
    const hit = hits[this.searchIndex]
    this.openSearchResult(hit.path, hit.line)
  }

  /** Open one Find in Files hit at its line. */
  openSearchResult(rel, line) {
    if (typeof rel !== 'string' || rel === '') return
    const absolute = this.#absoluteOf(rel)
    this.openFile(absolute, { rel, preview: false, line: Number.isInteger(line) ? line : 1 })
  }

  /** Open (or focus) the Find in Files editor tab. */
  openSearchTab(query = '') {
    const id = 'search:in-files'
    const existing = this.state.tabs.find(tab => tab.id === id)
    if (existing !== undefined) {
      this.set({ activeId: id })
    } else {
      this.set({
        tabs: [...this.state.tabs, {
          id, kind: 'search', name: this.t('search.title'), preview: false, pinned: true,
          loading: false, error: null, scrollTop: 0,
        }],
        activeId: id,
      })
    }
    if (typeof query === 'string' && query !== '') this.runSearch(query)
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

  /** Star / unstar absolute paths in Favorites. */
  async toggleFavorite(paths) {
    const list = (Array.isArray(paths) ? paths : []).filter(path => typeof path === 'string' && path !== '')
    if (list.length === 0) return
    const favorites = Array.isArray(this.state.settings?.favorites) ? [...this.state.settings.favorites] : []
    for (const path of list) {
      const index = favorites.indexOf(path)
      if (index >= 0) favorites.splice(index, 1)
      else favorites.push(path)
    }
    await this.updateSettings({ favorites })
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
   * @param {{ rel?: string, preview?: boolean }} [options]
   */
  openFile(path, options = {}) {
    if (typeof path !== 'string' || path === '') return
    const rel = options.rel ?? this.relOf(path)
    const existing = this.state.tabs.find(tab => tab.kind === 'file' && tab.path === path)
    if (existing !== undefined) {
      const tabs = this.state.tabs.map(tab => (tab === existing ? { ...tab, preview: tab.preview && options.preview === true } : tab))
      this.set({ tabs, activeId: existing.id })
      if (Number.isInteger(options.line)) this.#updateTab(existing.id, { revealLine: options.line })
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
          ? await call('git.diff-refs', { root: this.state.root, a: tab.compare.a, b: tab.compare.b })
          : tab.commitHash !== undefined
            ? await call('git.commit-file-diff', { root: this.state.root, hash: tab.commitHash, path: tab.rel })
            : (tab.against === 'head' || tab.against === 'latest')
              ? await call('git.diff-rev', { root: this.state.root, path: tab.rel, rev: tab.against })
              : await call('git.diff', {
                  root: this.state.root,
                  path: tab.rel,
                  staged: tab.staged === true,
                  untracked: tab.untracked === true,
                })
        this.#updateTab(id, { loading: false, payload: result })
      } else if (tab.kind === 'commit') {
        const detail = await call('git.detail', { root: this.state.root, hash: tab.hash })
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
            { key: 'cancel', label: this.t('common.cancel'), action: () => {} },
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
   */
  async setCommitChecked(entries, checked) {
    const list = (Array.isArray(entries) ? entries : []).filter(entry => entry !== null && entry !== undefined && entry.conflict !== true)
    if (list.length === 0) return
    const commit = this.state.commit
    const checkedSet = new Set(commit.checked)
    const uncheckedSet = new Set(commit.unchecked)
    const buckets = { ...(commit.buckets ?? {}) }
    const toStage = []
    const toUnstage = []
    for (const entry of list) {
      const currently = this.isCommitChecked(entry)
      if (currently === checked) continue
      if (checked) {
        checkedSet.add(entry.path)
        uncheckedSet.delete(entry.path)
        if (entry.untracked === true || buckets[entry.path] === 'untracked') buckets[entry.path] = 'untracked'
        if (entry.staged !== true) toStage.push(entry.path)
      } else {
        checkedSet.delete(entry.path)
        uncheckedSet.add(entry.path)
        if (entry.staged === true) toUnstage.push(entry.path)
      }
    }
    this.patch('commit', { checked: checkedSet, unchecked: uncheckedSet, buckets, selectedPath: commit.selectedPath })
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
      await call('git.ignore', {
        root: this.state.root,
        path,
        repoRoot: this.state.status.repoRoot ?? undefined,
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
    const absolute = /^([a-zA-Z]:[\\/]|[\\/])/.test(path) ? path : this.#absoluteOf(path)
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
      const result = await call('git.messages', { root: this.state.root, count: 10 })
      this.patch('commit', { messages: result.messages, messagesLoading: false })
    } catch {
      this.patch('commit', { messagesLoading: false })
    }
  }

  async stage(paths, options = {}) {
    if (paths.length === 0) return
    try {
      await call('git.stage', { root: this.state.root, paths })
      await this.refreshStatus({ initial: false })
      if (options.refreshDiff === true) this.#reloadActiveDiff()
    } catch (error) {
      this.toast('error', this.t('commit.failed'), error instanceof Error ? error.message : String(error))
    }
  }

  async unstage(paths, options = {}) {
    if (paths.length === 0) return
    try {
      await call('git.unstage', { root: this.state.root, paths })
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
      await call('git.apply-patch', { root: this.state.root, patch, direction })
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
      await call('git.discard', { root: this.state.root, paths: tracked, untracked })
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
      const result = await call('git.commit', { root: this.state.root, message, amend })
      this.patch('commit', {
        committing: false,
        message: '',
        amend: false,
        error: null,
        checked: new Set(),
        unchecked: new Set(),
        buckets: {},
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
      this.patch('commit', { committing: false, error: messageText })
      this.toast('error', this.t('commit.commitFailed'), messageText)
    }
  }

  async push(options = {}) {
    try {
      await call('git.push', { root: this.state.root })
      this.toast('success', this.t('commit.pushed'))
      await this.refreshStatus({ initial: false })
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      this.toast('error', options.afterCommit === true ? this.t('commit.pushFailed') : this.t('commit.failed'), text)
    }
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
    this.patch('git', { filters: { ...this.state.git.filters, path: value }, selectedHash: null, detail: null })
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
      const result = await call('git.branches', { root: this.state.root })
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
        root: this.state.root,
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
      const detail = await call('git.detail', { root: this.state.root, hash })
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
      await call('git.checkout', { root: this.state.root, ref })
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
      await call('git.revert', { root: this.state.root, hash })
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
      this.set({ settings: result.value })
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
