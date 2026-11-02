/**
 * The state container of the code intelligence plugin.
 *
 * The plugin has its OWN store: it may not reach into the store of the IDE
 * workbench (PRD-v6 §5.5, acceptance R5), so everything it needs comes
 * through the contract:
 *
 *   - the **project root** comes from `contract.host.getProjectRoot()` - the
 *     core owns the project, the codeintel only follows it;
 *   - the **files** come from `contract.editor.onDocument(...)` and
 *     `contract.host.readFile(...)`;
 *   - the **settings** live in the plugin's own document
 *     (`<profile>/dsh-codeintel/settings.json`), which the host half of the
 *     plugin owns: the `lsp` section and the four semantic shortcuts.
 *
 * The API of the store is the one `lsp-session.js` already uses, so the
 * session needed almost no change: `state`, `set`, `subscribe`, `toast`, `t`,
 * `lspIndexDecision`, `lspSessionState`, `releaseLsp`, `findUsagesText`,
 * `state.root` and `state.settings.lsp`.
 *
 * One store belongs to one contract, and the contract belongs to one session
 * of the workbench: the scope of the slots is `session`, so the plugin keeps
 * one store per contract and never mixes the projects of two sessions.
 */
import { call } from './api.js'
import { baseName, isPathWithin, normalizeScopePath, sameScopePath } from './workspace-scope.js'
import { DEFAULT_LSP_SETTINGS, LSP_LANGUAGE_IDS } from '../host/settings-defaults.js'
import { LSP_HOST_HEALTHY_STATES, reconnectLsp as reconnectLspSession, releaseLspForStore, setLspLanguageHint } from './lsp-session.js'

/**
 * The four semantic shortcuts of the plugin.
 *
 * They belong to the codeintel: the workbench keeps its own shortcuts (save,
 * find, go to file, full screen), and the semantic ones moved with the
 * language servers (CUT-11).
 */
export const DEFAULT_SHORTCUTS = Object.freeze({
  goToDefinition: 'F12',
  findUsages: 'Alt+F7',
  findUsagesText: 'Alt+F8',
  complete: 'Ctrl+Space',
})

/**
 * The state of a fresh store.
 *
 * The `lsp` slice mirrors the status of the host - the client never derives a
 * state of its own - and it carries the health of the client session, which
 * only the client can measure (PRD-v5 §2.4, MEM-03).
 * @returns {any} the state
 */
function initialState() {
  return {
    /** The project root of the contract, `''` while there is none. */
    root: '',
    /** The root the program of the language server is built for. */
    scopeRoot: null,
    /** True while the IDE workbench plugin is missing (DEG-01). */
    degraded: false,
    /** The reason of the degradation, shown in the settings. */
    degradedReason: '',
    /** The version of the contract, 0 while there is none. */
    contractVersion: 0,
    /** The settings document of the plugin. */
    settings: {
      lsp: { ...DEFAULT_LSP_SETTINGS },
      shortcuts: { ...DEFAULT_SHORTCUTS },
    },
    /** The mirrored status of the language server. */
    lsp: {
      enabled: true,
      state: 'idle',
      languageId: '',
      serverId: '',
      detail: null,
      progress: '',
      startedAt: 0,
      cancellable: false,
      indexedRoots: [],
      liveRoots: [],
      clientState: 'idle',
      clientDetail: '',
      clientSince: 0,
      scopeRoot: null,
      processId: 0,
      buildingProgram: false,
      servers: { available: [], missing: [] },
      consecutiveFailures: 0,
      consecutiveTimeouts: 0,
      lastFailure: null,
      resources: null,
      stderrLines: [],
      rebuilding: false,
    },
    /**
     * The result of the last search.
     *
     * The two entries (Find in Files and the text version of Find Usages)
     * share the slice and differ only in `textMatch`: a text hit carries the
     * label, so the user never mistakes it for a semantic reference.
     */
    search: {
      query: '',
      caseSensitive: false,
      wholeWord: false,
      regexp: false,
      textMatch: false,
      loading: false,
      error: null,
      results: [],
      tookMs: 0,
      truncated: false,
      token: 0,
    },
    /** The state of the Find in Files popup. */
    searchPopup: { open: false, index: 0, generation: 0 },
    /** The pending index decision (`null` while no dialog is open). */
    indexDecision: null,
    /** The pending memory warning. */
    memoryDecision: null,
    /** The transient notice of the plugin. */
    toast: null,
    /**
     * True while the mirrored status is unknown.
     *
     * A failed poll leaves the client with a value that may be minutes old:
     * the status bar has to say that it does not know, not repeat the
     * "starting" of ten minutes ago (PRD-v5 §2.3).
     */
    lspStatusStale: false,
    /**
     * The documents the core reports.
     *
     * The core owns the tabs; the plugin only mirrors the documents it needs
     * for the language server (the draft of a file has to reach the server,
     * never the file on the disk).
     */
    documents: [],
  }
}

/**
 * The advice for a crashed language server.
 *
 * The host sends the FACT (why the server died); what the user can do about
 * it depends on the reason. A timeout is a timeout - the single-request
 * limit is the setting to raise - and the memory is only the answer when the
 * machine really ran out of it. A toast that blames the memory sends the
 * user to a setting that cannot help.
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
  // budget does.
  if (text.includes('memory budget')) return t('lsp.crashedBudget')
  if (text.includes('memory') || text.includes('out of memory')) return t('lsp.crashedMemory')
  return t('lsp.crashedGeneric')
}

/**
 * Whether two memory snapshots of the host say the same thing.
 *
 * The numbers are compared in megabytes: the free memory of the machine
 * jitters by a few kilobytes on every poll, and a byte-level comparison
 * would replace the snapshot every two seconds.
 * @param {any} left the first snapshot
 * @param {any} right the second snapshot
 * @returns {boolean} true when both say the same thing
 */
function sameResources(left, right) {
  if (left === null || left === undefined || typeof left !== 'object') return false
  if (right === null || right === undefined || typeof right !== 'object') return false
  const mib = 1024 * 1024
  const fields = ['freeBytes', 'availableBytes', 'reservedBytes', 'measuredBytes', 'worstCaseBytes', 'thresholdBytes', 'safeAvailableBytes', 'budgetUsedBytes']
  for (const field of fields) {
    const leftMB = Math.round((Number.isFinite(left?.[field]) ? left[field] : 0) / mib)
    const rightMB = Math.round((Number.isFinite(right?.[field]) ? right[field] : 0) / mib)
    if (leftMB !== rightMB) return false
  }
  if (Math.round((Number.isFinite(left?.needMB) ? left.needMB : 0)) !== Math.round((Number.isFinite(right?.needMB) ? right.needMB : 0))) return false
  if ((left?.decision ?? '') !== (right?.decision ?? '')) return false
  return true
}

/**
 * The decision of the memory gate of the host.
 *
 * The host publishes the decision with the snapshot (`decision`), and the
 * client renders it instead of judging the numbers a second time - two sides
 * that judge the same snapshot differently give the user two different
 * answers (review A2). The flags of an older host are the fallback.
 * @param {any} resources the memory snapshot of the host
 * @returns {'ok'|'tight'|'low'} the decision
 */
export function memoryDecisionOf(resources) {
  if (resources === null || resources === undefined) return 'ok'
  const published = typeof resources.decision === 'string' ? resources.decision : ''
  if (published !== '') return published
  if (resources.tight === true) return 'tight'
  if (resources.canIndex === false) return 'low'
  return 'ok'
}

/**
 * The state container of the code intelligence plugin.
 */
export class CodeIntelStore {
  /**
   * @param {{t?: (key: string) => string, contract?: any} | any} [options] the
   *   translator of the plugin and the contract (when it is already there),
   *   or the client context of the host - the plugin needs no service of the
   *   host: everything comes through the contract
   * @param {((key: string) => string) | null} [t] the translator, when it is
   *   handed over as the second argument (the signature the migrated tests
   *   of the core used)
   */
  constructor(options = {}, t = null) {
    /** The bound translator of the plugin. */
    this.t = typeof t === 'function'
      ? t
      : (typeof options?.t === 'function' ? options.t : (key => key))
    /** The contract of the session, `null` while the workbench is missing. */
    this.contract = options?.contract ?? null
    /** The current state. */
    this.state = initialState()
    /** The subscribers of the state. */
    this.listeners = new Set()
    /** The timer of the toast. */
    this.toastTimer = null
    /** The timer of the status poll of the language server. */
    this.lspPollTimer = null
    /** The unsubscriptions of the contract. */
    this.unsubscribers = []
    /** Whether the fault episode of the host was already announced. */
    this.lspFaultNotified = false
    /** Whether the fault episode of the client session was already announced. */
    this.lspSessionFaultNotified = false
    /** The resolver of the pending index decision. */
    this.indexDecisionResolve = null
    /** The resolver of the pending memory warning. */
    this.memoryDecisionResolve = null
    /**
     * The index decision of every project of this session.
     *
     * The decision has to survive a project switch - the `lsp` slice is reset
     * on every switch - so it lives in the store and not in the state.
     */
    this.lspIndexDecisions = new Map()
    /** The token of the last search, so a stale answer cannot win. */
    this.searchToken = 0
    /**
     * Whether the listener of the visibility is registered.
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

  // ── the state ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to the state.
   * @param {() => void} listener the subscriber
   * @returns {() => void} the unsubscription
   */
  subscribe = (listener) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * The current state, for `useSyncExternalStore`.
   * @returns {any} the state
   */
  getSnapshot = () => this.state

  /**
   * Replace the state and wake the subscribers.
   *
   * A patch whose values are all `===` to the current ones changes nothing,
   * so it neither replaces the state object nor wakes the subscribers.
   * @param {Record<string, unknown>} patch the patch
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
    this.state = { ...this.state, ...patch }
    this.#notify()
  }

  /**
   * Patch one nested slice.
   * @param {string} key the name of the slice
   * @param {Record<string, unknown>} patch the patch of the slice
   */
  patch(key, patch) {
    this.set({ [key]: { ...this.state[key], ...patch } })
  }

  /** Wake every subscriber. */
  #notify() {
    for (const listener of [...this.listeners]) listener()
  }

  /**
   * Show a transient notice.
   * @param {'error'|'success'|'info'} kind the kind of the notice
   * @param {string} text the text
   * @param {string} [detail] the detail (the tooltip)
   * @param {any} [action] the action of the notice
   */
  toast(kind, text, detail, action) {
    this.set({ toast: { id: `${Date.now()}-${Math.random()}`, kind, text, detail: detail ?? '', action: action ?? null } })
    if (this.toastTimer !== null) clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null
      this.set({ toast: null })
    }, kind === 'error' ? 9000 : 4500)
  }

  /**
   * Translate a key and fill in its `{placeholder}` slots.
   *
   * The translate function of the host does not interpolate, so the slots of
   * the texts of the plugin are filled in here.
   * @param {string} key the key
   * @param {Record<string, string | number>} [values] the values
   * @returns {string} the text
   */
  tpl(key, values = {}) {
    let text = this.t(key)
    for (const [name, value] of Object.entries(values)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
    return text
  }

  // ── the contract ──────────────────────────────────────────────────────────

  /**
   * Take over a contract of the IDE workbench.
   *
   * The contract is the ONLY channel to the core: the project root, the
   * documents, the files and the editor all come from it. The store follows
   * the project of the core and never guesses one.
   * @param {any} contract the contract
   */
  attachContract(contract) {
    if (contract === null || contract === undefined) return
    this.contract = contract
    this.set({
      contractVersion: typeof contract.version === 'number' ? contract.version : 0,
      degraded: false,
      degradedReason: '',
    })
    this.#followProject()
    this.unsubscribers.push(this.#followProjectUnsubscribe())
  }

  /**
   * Leave the contract behind.
   *
   * The core was unloaded: the session of the client is released, so no
   * language server of the browser keeps running for a project that is gone.
   */
  detachContract() {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      try {
        unsubscribe()
      } catch {
        /* an unsubscription that fails must not break the teardown */
      }
    }
    // The session of the browser goes with the contract: the socket must not
    // stay open for a project that is gone.
    try {
      releaseLspForStore(this)
    } catch (error) {
      console.warn('[codeintel] the session could not be released:', error instanceof Error ? error.message : error)
    }
    this.contract = null
    this.set({ root: '', scopeRoot: null, contractVersion: 0 })
  }

  /**
   * Read the project root of the contract and follow it.
   *
   * The core owns the project: the codeintel asks the contract and never
   * keeps a root of its own that could drift away from the one of the user.
   */
  #followProject() {
    const host = this.contract?.host
    if (host === null || host === undefined) return
    let root = ''
    let scopeRoot = null
    try {
      root = typeof host.getProjectRoot === 'function' ? (host.getProjectRoot() ?? '') : ''
      scopeRoot = typeof host.getScopeRoot === 'function' ? (host.getScopeRoot() ?? null) : null
    } catch {
      return
    }
    if (typeof root !== 'string') root = ''
    this.set({ root, scopeRoot: typeof scopeRoot === 'string' && scopeRoot !== '' ? scopeRoot : null })
  }

  /**
   * The subscription to the changes of the project.
   * @returns {() => void} the unsubscription
   */
  #followProjectUnsubscribe() {
    const host = this.contract?.host
    if (host === null || host === undefined) return () => {}
    if (typeof host.onProjectChanged !== 'function') return () => {}
    try {
      const unsubscribe = host.onProjectChanged(() => { this.#followProject() })
      return typeof unsubscribe === 'function' ? unsubscribe : () => {}
    } catch {
      return () => {}
    }
  }

  /**
   * Read a file through the contract.
   *
   * The fence of the core applies: a path outside of the project is refused
   * by the host, not by the plugin.
   * @param {string} absolutePath the absolute path
   * @returns {Promise<string | null>} the content, or `null`
   */
  async readFile(absolutePath) {
    const host = this.contract?.host
    if (host === null || host === undefined || typeof host.readFile !== 'function') return null
    try {
      const result = await host.readFile(absolutePath)
      if (typeof result === 'string') return result
      if (result !== null && typeof result === 'object' && typeof result.content === 'string') return result.content
      return null
    } catch {
      return null
    }
  }

  /**
   * Show a file to the user.
   *
   * The contract reveals the position in the editor of the core; the
   * codeintel does not open tabs of its own.
   * @param {string} absolutePath the absolute path
   * @param {{line?: number, column?: number}} [options] the position
   */
  openFile(absolutePath, options = {}) {
    const editor = this.contract?.editor
    if (editor === null || editor === undefined || typeof editor.reveal !== 'function') return
    try {
      editor.reveal(absolutePath, options.line ?? 1, options.column)
    } catch {
      /* the editor may be gone */
    }
  }

  /**
   * Take over one document of the core.
   *
   * The core broadcasts the document when the tab changes and when the
   * content changes; the plugin keeps the last one of every file, so the
   * language server sees the DRAFT of a file and never the file on the disk.
   * @param {any} document the document (`uri`, `absolutePath`, `languageId`,
   *   `content`, `dirty`)
   */
  setDocument(document) {
    if (document === null || typeof document !== 'object') return
    const uri = typeof document.uri === 'string' ? document.uri : ''
    if (uri === '') return
    const documents = this.state.documents ?? []
    const next = documents.filter(entry => entry.uri !== uri)
    next.push({
      uri,
      absolutePath: typeof document.absolutePath === 'string' ? document.absolutePath : '',
      languageId: typeof document.languageId === 'string' ? document.languageId : '',
      content: typeof document.content === 'string' ? document.content : '',
      dirty: document.dirty === true,
    })
    this.set({ documents: next })
    // The language of the file on the screen is the answer the host asks for
    // when it starts a server (PRD-v5.1 JS-04): a mixed repository would
    // otherwise be judged TypeScript, and a `.java` file in it would start a
    // TypeScript server that cannot answer a single Java request.
    const languageId = this.languageOnScreen()
    if (languageId !== '') {
      this.set({ lsp: { ...this.state.lsp, languageId } })
      setLspLanguageHint(this.state.root, languageId)
    }
  }

  /**
   * The language of the file on the screen, when the host has a server for it.
   *
   * A language without a server is not reported: the host would refuse an id
   * that is not in its registry, and its own detection decides then.
   * @returns {string} the language, or `''`
   */
  languageOnScreen() {
    const documents = this.state.documents ?? []
    const last = documents[documents.length - 1]
    const languageId = typeof last?.languageId === 'string' ? last.languageId : ''
    if (languageId === '') return ''
    return LSP_LANGUAGE_IDS.includes(languageId) ? languageId : ''
  }

  /**
   * The document of one URI, when the core reported it.
   * @param {string} uri the document URI
   * @returns {any} the document, or `undefined`
   */
  documentOf(uri) {
    const documents = this.state.documents ?? []
    return documents.find(entry => entry.uri === uri)
  }

  // ── the settings ──────────────────────────────────────────────────────────

  /**
   * Load the settings document of the plugin.
   *
   * The document lives in the profile of the plugin
   * (`<profile>/dsh-codeintel/settings.json`); the host half of the plugin
   * owns it. A host that cannot answer leaves the defaults in place: the
   * plugin then works with its defaults instead of refusing to start.
   * @returns {Promise<void>}
   */
  async init() {
    try {
      const result = await call('settings.get')
      const value = result?.value ?? result
      if (value === null || typeof value !== 'object') return
      this.set({
        settings: {
          lsp: { ...DEFAULT_LSP_SETTINGS, ...(value.lsp ?? {}) },
          shortcuts: { ...DEFAULT_SHORTCUTS, ...(value.shortcuts ?? {}) },
        },
      })
    } catch (error) {
      console.warn('[codeintel] the settings could not be read:', error instanceof Error ? error.message : error)
    }
  }

  /**
   * Write a patch of the settings document.
   *
   * The change is applied to the local state first and written afterwards;
   * a failed write takes the change back, so the client and the document do
   * not disagree about what the user has chosen.
   * @param {Record<string, unknown>} patch the patch of the document
   * @returns {Promise<void>}
   */
  async updateSettings(patch) {
    const previous = this.state.settings
    this.set({ settings: { ...previous, ...patch } })
    try {
      await call('settings.update', { patch })
    } catch (error) {
      // The document of the host did not take the change, so the client goes
      // back to what that document says: the two sides must not drift apart
      // (review N5). The failure is logged: a silent inconsistency is worse
      // than a visible failure.
      console.warn('[lsp] the settings of the semantic analysis could not be written:', error instanceof Error ? error.message : error)
      this.set({ settings: previous })
    }
  }

  /**
   * Write a patch of the `lsp` section of the settings.
   *
   * The change is applied to the local state first and written afterwards; a
   * failed write takes the change back - and ONLY the fields of this write:
   * the settings page moved the budget share while the write of the decision
   * was in flight, and the rollback must not touch it (review R3).
   * @param {Record<string, unknown>} patch the patch
   * @returns {Promise<void>}
   */
  async updateLspSettings(patch) {
    const previous = this.state.settings.lsp ?? {}
    const lsp = { ...previous, ...patch }
    this.set({ settings: { ...this.state.settings, lsp } })
    try {
      await call('settings.update', { patch: { lsp: patch } })
    } catch (error) {
      // The document of the host did not take the change, so the client goes
      // back to what that document says: the two sides must not drift apart
      // (review N5).
      console.warn('[lsp] the settings of the semantic analysis could not be written:', error instanceof Error ? error.message : error)
      const current = this.state.settings.lsp ?? {}
      const restored = { ...current }
      for (const key of Object.keys(patch)) {
        if (Object.hasOwn(previous, key)) {
          restored[key] = previous[key]
          continue
        }
        delete restored[key]
      }
      this.set({ settings: { ...this.state.settings, lsp: restored } })
    }
  }

  // ── the index decision ────────────────────────────────────────────────────

  /**
   * The answer of the user the last time the memory was tight.
   *
   * The map remembers ONE thing: "do not ask me again". The legacy value
   * 'accepted' is read as 'conservative' - the old semantics remembered a
   * PERMISSION to force the start, and that permission was contagious.
   * @param {string} root the project root
   * @returns {'conservative'|''} the answer
   */
  #memoryAnswer(root) {
    const warned = this.state.settings?.lsp?.memoryWarnedRoots
    if (warned === null || warned === undefined || typeof warned !== 'object') return ''
    const key = Object.keys(warned).find(entry => sameScopePath(entry, root))
    if (key === undefined) return ''
    const answer = warned[key]
    if (answer === 'conservative' || answer === 'accepted') return 'conservative'
    return ''
  }

  /**
   * The workspace-scoped default of one project root.
   *
   * The map outranks the global policy in both directions (PRD-v5.1 WS-04):
   * a project the user sent to the basic mode stays there, and a project the
   * user wants indexed is indexed without a question.
   * @param {string} root the project root
   * @returns {'build'|'conservative'|null} the default
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
   * Whether one project root completed a first program build.
   *
   * Both sources count: the roots of the settings document and the profile
   * settings.
   * @param {string} root the project root
   * @returns {boolean} true when the folder is indexed
   */
  #isIndexed(root) {
    const roots = this.state.settings?.lsp?.indexedRoots
    if (roots === null || roots === undefined || typeof roots !== 'object') return false
    return Object.keys(roots).some(key => sameScopePath(key, root))
  }

  /**
   * What the plugin decided about the language server of one project.
   *
   * The answer is 'build' (a language server is wanted), 'conservative' (the
   * basic mode: no server) or 'unknown' (nobody decided yet).
   * @param {string} root the project root
   * @returns {'build'|'conservative'|'unknown'} the decision
   */
  lspIndexDecision(root) {
    if (typeof root !== 'string' || root === '') return 'unknown'
    const lsp = this.state.settings?.lsp
    if (lsp === null || lsp === undefined || typeof lsp !== 'object') return 'unknown'
    if (lsp.enabled === false) return 'conservative'
    const workspace = this.#workspaceDefault(root)
    if (workspace === 'conservative') return 'conservative'
    if (workspace === 'build') return 'build'
    if ((lsp.indexOnOpen ?? 'ask') === 'never') return 'conservative'
    if (this.#memoryAnswer(root) === 'conservative') return 'conservative'
    for (const [key, decision] of this.lspIndexDecisions) {
      if (sameScopePath(key, root)) return decision
    }
    return 'unknown'
  }

  /**
   * The workspace-scoped default of one project root, for the user interface.
   * @param {string} root the project root
   * @returns {'build'|'conservative'|null} the default
   */
  lspWorkspaceDefault(root) {
    if (typeof root !== 'string' || root === '') return null
    return this.#workspaceDefault(root)
  }

  /**
   * Remember the index decision of one project root.
   * @param {string} root the project root
   * @param {'build'|'conservative'} decision the decision
   */
  rememberIndexDecision(root, decision) {
    if (decision !== 'build' && decision !== 'conservative') return
    this.lspIndexDecisions.set(root, decision)
  }

  /**
   * Remember the answer of the user to the memory warning.
   *
   * The map remembers ONE thing: "do not ask me again". Only the answer
   * 'conservative' is written - the answer "start anyway" belongs to ONE
   * start and is never remembered, because a remembered permission to force
   * the start would make every later tight moment start the server without
   * asking (PRD-v5.1 MEM-10).
   * @param {string} root the project root
   * @param {'conservative'} answer the answer of the user
   * @returns {Promise<void>}
   */
  async rememberMemoryAnswer(root, answer) {
    const warned = this.state.settings.lsp?.memoryWarnedRoots ?? {}
    await this.updateLspSettings({ memoryWarnedRoots: { ...warned, [root]: answer } })
  }

  /**
   * Write the decision of the user about the semantic analysis of one root.
   *
   * Only a decision the USER made belongs in the settings document: a
   * decision the policy derived would take the choice away from the user.
   * @param {string} root the project root
   * @param {'build'|'conservative'} decision the decision
   * @returns {Promise<void>}
   */
  async rememberWorkspaceDecision(root, decision) {
    const lsp = this.state.settings.lsp ?? {}
    const defaults = { ...(lsp.workspaceDefaults ?? {}), [root]: decision }
    const warned = { ...(lsp.memoryWarnedRoots ?? {}) }
    if (decision === 'build') {
      // The refusal of the user is overruled: the entry is overwritten with
      // `null`, which both sides read as "never asked".
      const key = Object.keys(warned).find(entry => sameScopePath(entry, root))
      if (key !== undefined) warned[key] = null
    }
    await this.updateLspSettings({ workspaceDefaults: defaults, memoryWarnedRoots: warned })
  }

  /**
   * Answer the pending index decision.
   * @param {'build'|'conservative'|'cancel'} choice the answer of the user
   */
  resolveIndexDecision(choice) {
    const resolve = this.indexDecisionResolve
    this.indexDecisionResolve = null
    this.set({ indexDecision: null })
    if (resolve === null) return
    resolve(choice === 'build' ? 'build' : (choice === 'conservative' ? 'conservative' : 'cancel'))
  }

  /**
   * Show the index decision and wait for the answer of the user.
   * @param {{path: string, name?: string, language?: string, needMB?: number}} project the project
   * @returns {Promise<'build'|'conservative'|'cancel'>} the answer
   */
  askIndexDecision(project) {
    if (this.indexDecisionResolve !== null) this.indexDecisionResolve('cancel')
    return new Promise(resolve => {
      this.indexDecisionResolve = resolve
      this.set({
        indexDecision: {
          path: project.path,
          name: typeof project.name === 'string' && project.name !== '' ? project.name : baseName(project.path),
          language: typeof project.language === 'string' ? project.language : '',
          needMB: Number.isFinite(project.needMB) ? project.needMB : 0,
        },
      })
    })
  }

  // ── the client session ────────────────────────────────────────────────────

  /**
   * Show the memory warning and wait for the user's answer.
   *
   * The host refuses to start a language server on a tight budget unless the
   * start is forced, so this dialog is the only way out of the "tight" band.
   *
   * The number of the dialog is the one the gate judged by
   * (`availableBytes`): the popup said "2648 MB available" while the gate
   * decided with 600 MB, so the same question got two opposite answers on
   * two screens (PRD-v5.1 MEM-09).
   * @param {{path: string, name?: string}} project the project
   * @param {{needMB?: number, availableBytes?: number, freeBytes?: number, languageId?: string}} resources
   *   the memory snapshot of the host
   * @returns {Promise<'start'|'conservative'>} the answer of the user
   */
  askMemoryDecision(project, resources) {
    // A second request supersedes the first one: the old promise must not
    // hang for ever.
    if (this.memoryDecisionResolve !== null) this.memoryDecisionResolve('conservative')
    const language = typeof resources?.languageId === 'string' && resources.languageId !== ''
      ? resources.languageId
      : 'semantic analysis'
    return new Promise(resolve => {
      this.memoryDecisionResolve = resolve
      this.set({
        memoryDecision: {
          path: project.path,
          name: typeof project.name === 'string' && project.name !== '' ? project.name : baseName(project.path),
          language,
          needMB: Math.round(resources?.needMB ?? 0),
          // The field keeps its name: the dialog renders it, and the field
          // name is not worth a second wave through the renderer.
          freeMB: Math.round((resources?.availableBytes ?? resources?.freeBytes ?? 0) / (1024 * 1024)),
        },
      })
    })
  }

  /**
   * Answer the pending memory warning.
   * @param {'start'|'conservative'} choice the answer of the user
   */
  resolveMemoryDecision(choice) {
    const resolve = this.memoryDecisionResolve
    this.memoryDecisionResolve = null
    this.set({ memoryDecision: null })
    if (resolve === null) return
    resolve(choice === 'start' ? 'start' : 'conservative')
  }

  /**
   * Decide what happens with the index of one project root.
   *
   * The decision is the user's: the plugin asks when the policy does not
   * answer, and it remembers what the user said (PRD-v5 §2.3). The hierarchy
   * is the one of PRD-v5.1 WS-04:
   *
   *   1. the master switch: the feature is off, so nothing is started;
   *   2. the workspace-scoped default of the user: it outranks the policy in
   *      both directions;
   *   3. the policy `indexOnOpen` ('ask', 'always', 'never');
   *   4. the memory gate: a machine below the floor degrades, a tight
   *      machine asks the user;
   *   5. the dialog of the index decision.
   *
   * @param {string} root the project root
   * @param {{ask?: boolean}} [options] `ask: false` decides without a dialog
   * @returns {Promise<'build'|'build-forced'|'conservative'|'cancel'>} the decision
   */
  async decideIndex(root, options = {}) {
    const ask = options.ask !== false
    const lsp = this.state.settings?.lsp
    // A profile without the semantic section has nothing to start.
    if (lsp === null || lsp === undefined || typeof lsp !== 'object') return 'conservative'
    if (lsp.enabled === false) return 'conservative'
    const workspace = this.#workspaceDefault(root)
    if (workspace === 'conservative') return 'conservative'
    if (workspace === 'build') return 'build'
    if ((lsp.indexOnOpen ?? 'ask') === 'never') return 'conservative'
    // The project the user sent to the basic mode the last time the memory
    // was tight: the answer is remembered in the settings.
    if (this.#memoryAnswer(root) === 'conservative') return 'conservative'
    // A folder that completed a first build needs no question: the language
    // server is started right away (risk #26).
    if (this.#isIndexed(root)) return 'build'
    const resources = await this.#lspResources(root)
    const decision = memoryDecisionOf(resources)
    if (decision === 'low') {
      // The threshold is the number the machine has to reach, not the estimate
      // of the language: "needs 96 MB, 200 MB available" reads like a
      // mistake, because the real gate is the hard floor.
      const need = Math.round((resources?.thresholdBytes ?? 0) / (1024 * 1024))
      // The number of the toast is the one the gate judged by
      // (`availableBytes`, PRD-v5.1 MEM-09).
      const free = Math.round((resources?.availableBytes ?? resources?.freeBytes ?? 0) / (1024 * 1024))
      this.toast('error', this.tpl('lsp.lowMemory', { need, free }), this.t('lsp.lowMemoryHint'))
      return 'conservative'
    }
    if (decision === 'tight') {
      // The memory answer of the user: "do not ask me again" means the basic
      // mode. It NEVER means "you may force" - a remembered permission to
      // force would start the server on every tight moment, for ever
      // (PRD-v5.1 MEM-10).
      const choice = await this.askMemoryDecision({ path: root }, resources ?? {})
      if (choice === 'conservative') {
        // The refusal is remembered twice: as the decision of the project and
        // as the answer "do not ask me again" - the two markers say the same
        // thing (PRD-v5.1 WS-04).
        await this.rememberMemoryAnswer(root, 'conservative')
        await this.rememberWorkspaceDecision(root, 'conservative')
        return 'conservative'
      }
      return 'build-forced'
    }
    if ((lsp.indexOnOpen ?? 'ask') === 'always') {
      await this.#startServer(root, false)
      return 'build'
    }
    if (!ask) return 'conservative'
    const choice = await this.askIndexDecision({
      path: root,
      language: typeof resources?.languageId === 'string' ? resources.languageId : '',
      needMB: Number.isFinite(resources?.needMB) ? resources.needMB : 0,
    })
    if (choice === 'build') {
      await this.rememberWorkspaceDecision(root, 'build')
      await this.#startServer(root, false)
      return 'build'
    }
    if (choice === 'conservative') {
      await this.rememberWorkspaceDecision(root, 'conservative')
      return 'conservative'
    }
    return 'cancel'
  }

  /**
   * Ask the host to start the language server of one root.
   *
   * The plugin owns the language servers, so it is the plugin that asks for
   * one - and it asks with the language of the file on the screen, so a
   * mixed repository starts the server of the language the user is looking
   * at (PRD-v5.1 JS-04).
   * @param {string} root the project root
   * @param {boolean} force whether the memory gate may be skipped
   * @returns {Promise<void>}
   */
  async #startServer(root, force) {
    const languageId = this.languageOnScreen()
    const payload = languageId === '' ? { root, force } : { root, languageId, force }
    try {
      await call('lsp.start', payload)
    } catch (error) {
      console.warn('[lsp] the language server could not be started:', error instanceof Error ? error.message : error)
    }
  }

  /**
   * The state of the client session, as the session reports it.
   *
   * The session of the client is a fault of its own: the host may be healthy
   * while the link between the browser and the server is dead. The failure is
   * only announced while the host claims to be all right - in every other
   * state the host knows the reason, and its explanation is the truth.
   * @param {'starting'|'ready'|'failed'|'idle'} state the state of the session
   * @param {string} [detail] the reason of the failure
   * @param {number} [since] the moment the client started waiting
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
    if (!LSP_HOST_HEALTHY_STATES.includes(lsp.state)) return
    this.lspSessionFaultNotified = true
    this.toast('error', this.t('lsp.sessionFailedToast'))
  }

  /**
   * The store-side half of the release of the semantic session.
   *
   * The session module calls this method when it releases a store (the
   * method is optional there), so it must NOT call the session module back:
   * that would be a recursion. The session itself is released by
   * `releaseLspForStore(store)`, which the bridge calls when the contract
   * goes away.
   *
   * The method is idempotent: the release may come twice, and a second call
   * must not clear a state that was filled again in between.
   */
  releaseLsp() {
    if (this.lspPollTimer !== null) {
      clearInterval(this.lspPollTimer)
      this.lspPollTimer = null
    }
    // The mirrored status of a store that is not looked at any more would keep
    // the last state of a server that is gone: the slice goes back to its
    // initial state, and the client session starts at 'idle' - THERE IS NO
    // SESSION any more, so "starting" would be a lie.
    this.patch('lsp', { ...initialState().lsp, servers: this.state.lsp?.servers ?? { available: [], missing: [] } })
    // The fault episodes belong to the session that is gone: a new one must
    // not inherit the flag and stay silent about its first failure.
    this.lspFaultNotified = false
    this.lspSessionFaultNotified = false
  }

  /**
   * Reconnect the semantic analysis: the way out of a dead session.
   *
   * The handshake of the client goes first: the host replays the handshake it
   * holds to the next language server process. The restart of the host comes
   * second: a new process means a new frame worker with an empty handshake
   * cache, so the `initialize` really reaches the server again.
   *
   * The restart is skipped when the user refused a language server for this
   * project: the button may not start a server behind their back.
   * @returns {Promise<void>}
   */
  async reconnectLsp() {
    try {
      reconnectLspSession()
    } catch {
      /* the client session is optional: the restart below is the way out */
    }
    if (this.lspIndexDecision(this.state.root) === 'conservative') return
    await this.restartLsp()
  }

  /**
   * Restart the language server of the current project.
   *
   * The server is stopped and started again, so its index is built from
   * scratch - that is the price of the way out of a broken session.
   * @returns {Promise<void>}
   */
  async restartLsp() {
    const root = this.state.root
    if (root === '') return
    // The user asked for a language server: the decision is theirs, so it is
    // remembered in the settings document - and the old refusal of the user
    // goes with it. The two maps are two words about the same project, and
    // the host and the client read them in one order (review A4).
    await this.rememberWorkspaceDecision(root, 'build')
    this.rememberIndexDecision(root, 'build')
    this.patch('lsp', { rebuilding: true })
    try {
      await call('lsp.shutdown', { root })
    } catch {
      /* a session that is already gone is not an error here */
    }
    // The snapshot the client holds is the one of the last poll - the
    // shutdown above does not change it, and it is the memory situation the
    // user ran into.
    //
    // The memory is the blocker of a tight machine: the 【仍然启动】 button
    // ("start anyway") forces the start then - and only then. A machine with
    // enough memory never gets a forced start (PRD-v5 §2.3).
    const resources = this.state.lsp?.resources ?? await this.#lspResources(root)
    const force = memoryDecisionOf(resources) === 'tight'
    // The language of the file on the screen travels with the start: the host
    // falls back to its own detection when the client names no language, and
    // its detection prefers the markers of a TypeScript project (JS-04).
    const languageId = this.languageOnScreen()
    const payload = languageId === '' ? { root, force } : { root, languageId, force }
    try {
      await call('lsp.start', payload)
    } catch {
      /* the status bar shows the failure */
    }
    await this.refreshLspStatus()
    this.patch('lsp', { rebuilding: false })
  }

  /**
   * The memory snapshot of the host for one root.
   * @param {string} root the project root
   * @returns {Promise<any>} the snapshot, or `null`
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
   * Fall back to the conservative mode.
   *
   * The decision comes first: the session asks the store whether it wants a
   * server, and the answer has to be "no" before the server is gone.
   * @returns {Promise<void>}
   */
  async degradeLsp() {
    const root = this.state.root
    if (root === '') return
    this.rememberIndexDecision(root, 'conservative')
    await this.rememberWorkspaceDecision(root, 'conservative')
    try {
      await call('lsp.shutdown', { root })
    } catch {
      /* nothing to stop */
    }
    await this.refreshLspStatus()
  }

  /**
   * Cancel a running index build.
   * @returns {Promise<void>}
   */
  async cancelLspIndex() {
    const root = this.state.root
    if (root === '') return
    try {
      await call('lsp.cancelIndex', { root })
    } catch {
      /* cancelling twice is not an error the user has to act on */
    }
    await this.refreshLspStatus()
  }

  /**
   * Read the memory snapshot and the log of the language server.
   * @returns {Promise<void>}
   */
  async loadLspResources() {
    const root = this.state.root
    if (root === '') return
    // The pre-check and the start must judge the SAME language: the baseline
    // of TypeScript (434 MB) and the one of Java (2048 MB) are far apart, and
    // a prompt that says "ok" for one and then refuses the start for the
    // other is a question the user never got (PRD-v5.1 MEM-09).
    const languageId = this.languageOnScreen()
    const payload = languageId === '' ? { root } : { root, languageId }
    let resources = null
    try {
      resources = await call('lsp.resources', payload)
    } catch {
      resources = null
    }
    let stderrLines = this.state.lsp.stderrLines ?? []
    try {
      const logs = await call('lsp.logs', { root })
      if (logs !== null && typeof logs === 'object' && Array.isArray(logs.lines)) stderrLines = logs.lines
    } catch {
      /* the log is a nicety */
    }
    this.patch('lsp', { resources, stderrLines })
  }

  /**
   * Read the registry of the language servers.
   * @returns {Promise<void>}
   */
  async loadLspServers() {
    try {
      const result = await call('lsp.servers', {})
      this.patch('lsp', {
        servers: {
          available: Array.isArray(result?.available) ? result.available : [],
          missing: Array.isArray(result?.missing) ? result.missing : [],
        },
      })
    } catch {
      /* the registry is optional */
    }
  }

  /**
   * Poll the status of the language server.
   *
   * The poll is the only thing that keeps the mirrored status fresh: the
   * host owns the state machine, and the client only mirrors it.
   *
   * A HIDDEN page does not poll: the browser throttles the timers of a
   * background page to once a minute, and a poll every two seconds would ask
   * the host for nothing. The status is refreshed as soon as the window is
   * visible again (the visibility listener).
   * @returns {Promise<void>}
   */
  async pollLspStatus() {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    await this.refreshLspStatus()
  }

  /**
   * Start the poll of the status.
   *
   * The poll belongs to the lifetime of the store: a store that is dropped
   * must not keep a timer running.
   * @returns {void}
   */
  activate() {
    if (this.lspPollTimer !== null) return
    this.lspPollTimer = setInterval(() => { void this.pollLspStatus() }, 2000)
    if (typeof this.lspPollTimer?.unref === 'function') this.lspPollTimer.unref()
  }

  /**
   * Pause the work of the store.
   *
   * The poll of the language server KEEPS running: the status of the server
   * belongs to the project, not to the surface the user is looking at, and a
   * frozen status bar would show a state of minutes ago (PRD-v5 §2.3).
   * @returns {void}
   */
  deactivate() {
    // The poll stays: only the disposal of the store stops it.
  }

  /**
   * The listener of the visibility of the document.
   *
   * A hidden page cannot keep its cadence: the browser throttles the timers
   * of a background page to once a minute, and the status bar would show a
   * state of a minute ago for up to a minute. The listener gives the window
   * its status back as soon as it comes to the front.
   */
  #onVisibilityChange = () => {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
    void this.refreshLspStatus()
  }

  /**
   * Read the status of the language server of the current project.
   *
   * The host owns the state machine; the client only mirrors the snapshot.
   * @returns {Promise<void>}
   */
  async refreshLspStatus() {
    const root = this.state.root
    if (root === '') return
    let result = null
    try {
      result = await call('lsp.status', { root })
    } catch {
      // A failed poll leaves the client with a value that may be minutes old:
      // the status bar has to say that it does not know, not repeat it.
      this.set({ lspStatusStale: true })
      return
    }
    if (result === null || typeof result !== 'object') {
      // An answer the client cannot use is as good as no answer: the status
      // bar has to say that it does not know.
      this.set({ lspStatusStale: true })
      return
    }
    this.set({ lspStatusStale: false })
    const lsp = this.state.lsp ?? {}
    // Only the fields that really changed are written: a poll that carries
    // the same snapshot must not wake the subscribers (the status bar would
    // render again and again for nothing).
    const next = {
      enabled: result.enabled !== false,
      state: typeof result.state === 'string' ? result.state : lsp.state,
      languageId: typeof result.languageId === 'string' ? result.languageId : lsp.languageId,
      detail: typeof result.detail === 'string' ? result.detail : lsp.detail,
      startedAt: Number.isFinite(result.startedAt) ? result.startedAt : lsp.startedAt,
      cancellable: result.cancellable === true,
      indexedRoots: Array.isArray(result.indexedRoots) ? result.indexedRoots : lsp.indexedRoots,
      liveRoots: Array.isArray(result.liveRoots) ? result.liveRoots : lsp.liveRoots,
      scopeRoot: typeof result.scopeRoot === 'string' ? result.scopeRoot : lsp.scopeRoot,
      processId: Number.isFinite(result.processId) ? result.processId : lsp.processId,
      buildingProgram: result.buildingProgram === true,
    }
    // The progress of a finished build is gone: the build is over, and a
    // leftover progress would keep the status bar at "building" for ever.
    if (['ready', 'idle', 'suspended', 'degraded', 'failed'].includes(next.state)) {
      next.progress = ''
      next.startedAt = 0
      next.cancellable = false
    }
    // The memory snapshot travels with the status: the numbers of the panel
    // are the ones of the host, and the client never derives them a second
    // time (two sides that compute the same thing differently give the user
    // two different answers).
    //
    // The comparison happens in MEGABYTES: the free memory of the machine
    // moves by a few kilobytes on every poll, and a byte-level comparison
    // would replace the snapshot every two seconds and wake the whole
    // workbench for a number that did not move.
    if (result.resources !== null && typeof result.resources === 'object') {
      const previous = lsp.resources
      if (!sameResources(previous, result.resources)) next.resources = result.resources
    }
    const changed = {}
    let dirty = false
    for (const key of Object.keys(next)) {
      if (lsp[key] === next[key]) continue
      changed[key] = next[key]
      dirty = true
    }
    if (!dirty) return
    this.patch('lsp', changed)
    // A fault of the host is announced once per episode: the control event
    // and the poll can report the same crash, and the host walks
    // `crashed → restarting → degraded` inside one millisecond window.
    if (['crashed', 'degraded'].includes(next.state)) {
      this.#announceLspFault(next.state, next.detail)
    } else if (['starting', 'building', 'ready', 'idle', 'suspended'].includes(next.state)) {
      this.lspFaultNotified = false
    }
    // A running build has a progress of its own: the host publishes it with
    // `lsp.index`, and the status bar shows it (PRD-v5 §2.4).
    if (['starting', 'building', 'restarting'].includes(next.state)) {
      await this.#refreshLspIndex(root)
    }
  }

  /**
   * Announce one fault of the language server - once per fault episode.
   *
   * The body of the toast is the advice that follows the reason: a server
   * that died of a timeout has nothing to do with the memory, and a toast
   * that blames the memory sends the user to a setting that cannot help.
   * @param {string} state the state of the host ('crashed' or 'degraded')
   * @param {string} detail the reason the host reported
   * @returns {boolean} whether the toast was shown
   */
  #announceLspFault(state, detail) {
    if (!['crashed', 'degraded'].includes(state)) return false
    if (this.lspFaultNotified) return false
    this.lspFaultNotified = true
    const crashed = state === 'crashed'
    const advice = crashAdviceFor(detail, key => this.t(key))
    this.toast('error', this.t(crashed ? 'lsp.crashedToast' : 'lsp.degradedToast'), advice)
    // The technical reason stays reachable: it is the detail of the
    // mirrored status, and the status bar shows it in its tooltip.
    const raw = typeof detail === 'string' ? detail : ''
    if (raw !== '' && this.state.lsp.detail !== raw) this.patch('lsp', { detail: raw })
    return true
  }

  /**
   * Read the progress of a running index build.
   * @param {string} root the project root
   * @returns {Promise<void>}
   */
  async #refreshLspIndex(root) {
    let index = null
    try {
      index = await call('lsp.index', { root })
    } catch {
      return
    }
    if (index === null || typeof index !== 'object') return
    const lsp = this.state.lsp ?? {}
    const next = {
      progress: typeof index.progress === 'string' ? index.progress : lsp.progress,
      startedAt: Number.isFinite(index.startedAt) ? index.startedAt : lsp.startedAt,
      cancellable: index.cancellable === true,
    }
    const changed = {}
    let dirty = false
    for (const key of Object.keys(next)) {
      if (lsp[key] === next[key]) continue
      changed[key] = next[key]
      dirty = true
    }
    if (!dirty) return
    this.patch('lsp', changed)
  }

  /**
   * The control event of the host (a crash, a degradation).
   *
   * A control event may never break the socket it arrived on.
   * @param {any} event the event
   */
  lspControl(event) {
    try {
      if (event === null || typeof event !== 'object') return
      const type = typeof event.type === 'string' ? event.type : ''
      if (typeof event.root === 'string' && event.root !== ''
        && !sameScopePath(event.root, this.state.root)) return
      if (type !== 'degraded' && type !== 'crash') return
      this.#announceLspFault(type === 'crash' ? 'crashed' : 'degraded', typeof event.detail === 'string' ? event.detail : '')
    } catch {
      /* a control event may never break the socket */
    }
  }

  /**
   * Whether the navigation entries of the editor are available.
   *
   * The semantic entries need a language server; the text entry is always
   * available, so the user always has a way to find the usages of a symbol.
   * @returns {{findUsages: {enabled: boolean, reason: string}, findUsagesText: {enabled: boolean, reason: string}}} the entries
   */
  semanticNavigation() {
    const lsp = this.state.lsp ?? {}
    const ready = lsp.enabled !== false && (lsp.state === 'ready' || lsp.state === 'suspended')
    return {
      findUsages: { enabled: ready, reason: ready ? '' : this.t('nav.semanticUnavailable') },
      findUsagesText: { enabled: true, reason: '' },
    }
  }

  // ── the search ────────────────────────────────────────────────────────────

  /**
   * Find the usages of one identifier with a TEXT search.
   *
   * The text search is the fallback of the semantic one: it always works, and
   * every hit carries the label "text match", so the user never mistakes a
   * text hit for a semantic reference.
   * @param {string} identifier the identifier
   * @returns {Promise<void>}
   */
  async findUsagesText(identifier) {
    const query = typeof identifier === 'string' ? identifier.trim() : ''
    if (query === '') return
    // The text version of Find Usages shares the popup with Find in Files:
    // two tabs over one data slice overwrote each other's query.
    const popup = this.state.searchPopup ?? { open: false, index: 0, generation: 0 }
    this.set({ searchPopup: { ...popup, open: true, index: 0, generation: (popup.generation ?? 0) + 1 } })
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

  /**
   * Run a search over the project.
   *
   * The engine is the one of the core: the plugin asks for it through the
   * contract (`contract.host.searchFiles`), so the plugin never walks the
   * files of the project on its own.
   * @param {string} query the query
   * @param {{caseSensitive?: boolean, wholeWord?: boolean, regexp?: boolean, textMatch?: boolean}} [options] the options
   * @returns {Promise<void>}
   */
  async runSearch(query, options = {}) {
    const host = this.contract?.host
    const search = this.state.search ?? {}
    const value = typeof query === 'string' ? query : (search.query ?? '')
    const flags = {
      caseSensitive: options.caseSensitive ?? search.caseSensitive === true,
      wholeWord: options.wholeWord ?? search.wholeWord === true,
      regexp: options.regexp ?? search.regexp === true,
    }
    const token = ++this.searchToken
    this.patch('search', {
      query: value,
      ...flags,
      textMatch: options.textMatch ?? search.textMatch === true,
      loading: value !== '',
      error: null,
    })
    if (value === '') return
    if (host === null || host === undefined || typeof host.searchFiles !== 'function') {
      this.patch('search', { loading: false, error: 'no search' })
      return
    }
    try {
      const result = await host.searchFiles({ query: value, ...flags })
      // A stale answer must not win over a newer one.
      if (token !== this.searchToken) return
      const files = (Array.isArray(result?.files) ? result.files : []).map(file => ({
        ...file,
        // The engine of the core calls the hits of a file `matches`; the
        // contract of the search names them `hits`. Both are accepted.
        matches: file?.matches ?? file?.hits ?? [],
      }))
      this.patch('search', {
        loading: false,
        results: files,
        tookMs: Number.isFinite(result?.tookMs) ? result.tookMs : 0,
        truncated: result?.truncated === true,
        error: null,
      })
    } catch (error) {
      if (token !== this.searchToken) return
      this.patch('search', {
        loading: false,
        results: [],
        tookMs: 0,
        truncated: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * The hits of the current search, flattened over the files.
   *
   * The popup shows the files on top and the hits of the selected file in
   * the preview below; this flat list is what "F8 cycles the hits" walks.
   * @returns {Array<{path: string, line: number, column: number, match: object, file: object}>} the hits
   */
  searchHits() {
    const hits = []
    for (const file of this.state.search?.results ?? []) {
      for (const match of file?.matches ?? []) {
        hits.push({ path: file.path, line: match.line, column: match.column, match, file })
      }
    }
    return hits
  }

  /**
   * The file the popup shows.
   * @returns {any} the file, or `null` when there is none
   */
  selectedSearchFile() {
    const files = (this.state.search?.results ?? []).filter(file => (file?.matches ?? []).length > 0)
    if (files.length === 0) return null
    const index = Math.min(Math.max(this.state.searchPopup?.index ?? 0, 0), files.length - 1)
    return files[index] ?? null
  }

  /**
   * The old entry point of the Find in Files view.
   *
   * The results live in a popup now; the name is kept so an old shortcut
   * still finds the feature.
   * @param {string} [query] the query to run right away
   */
  openSearchTab(query = '') {
    this.openSearchPopup(query)
  }

  /**
   * Open the Find in Files popup.
   *
   * The query and the flags are reset: the two entries (Find in Files and
   * the text version of Find Usages) share one data slice, and a plain
   * project-wide search must not inherit the identifier of a usage search.
   * @param {string} [query] the query to run right away
   */
  openSearchPopup(query = '') {
    const popup = this.state.searchPopup ?? { open: false, index: 0, generation: 0 }
    this.set({ searchPopup: { ...popup, open: true, index: 0, generation: (popup.generation ?? 0) + 1 } })
    this.patch('search', {
      textMatch: false,
      query: '',
      caseSensitive: false,
      wholeWord: false,
      regexp: false,
    })
    if (typeof query === 'string' && query !== '') void this.runSearch(query)
  }

  /**
   * Close the Find in Files popup.
   */
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
    const files = (this.state.search?.results ?? []).filter(file => (file?.matches ?? []).length > 0)
    if (files.length === 0) return
    const current = this.state.searchPopup?.index ?? 0
    const step = Number.isFinite(delta) ? Math.trunc(delta) : 1
    // The modulo is done twice: the first one folds the step into the list
    // length, the second one keeps the result positive.
    const index = (((current + step) % files.length) + files.length) % files.length
    this.set({ searchPopup: { ...this.state.searchPopup, open: true, index } })
  }

  /**
   * Open one hit of the search.
   *
   * The popup is a one-shot tool: opening a hit ends it, so the code the
   * user was working on stays in front.
   * @param {string} path the path of the file
   * @param {number} line the line of the hit
   * @param {number} [column] the column of the hit
   */
  openSearchResult(path, line, column) {
    if (typeof path !== 'string' || path === '') return
    this.closeSearchPopup()
    this.openFile(path, {
      line: Number.isInteger(line) ? line : 1,
      column: Number.isInteger(column) ? column : undefined,
    })
  }

  // ── the teardown ──────────────────────────────────────────────────────────

  /**
   * Release everything the store holds.
   */
  dispose() {
    try {
      releaseLspForStore(this)
    } catch {
      /* the session is gone anyway */
    }
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      try {
        unsubscribe()
      } catch {
        /* an unsubscription that fails must not break the teardown */
      }
    }
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer)
      this.toastTimer = null
    }
    if (this.lspPollTimer !== null) {
      clearTimeout(this.lspPollTimer)
      this.lspPollTimer = null
    }
    // The visibility listener belongs to the document: a store that is
    // dropped for good must not keep it.
    if (this.visibilityBound && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this.#onVisibilityChange)
      this.visibilityBound = false
    }
    this.listeners.clear()
  }
}

/**
 * Whether one path is inside the project of the store.
 * @param {CodeIntelStore} store the store
 * @param {string} path the path
 * @returns {boolean} true when the path may be read
 */
export function isInsideProject(store, path) {
  const root = store?.state?.root
  if (typeof root !== 'string' || root === '') return false
  return isPathWithin(root, path)
}

/**
 * The normalized key of one root, for the maps of the plugin.
 * @param {string} root the root
 * @returns {string} the key
 */
export function rootKey(root) {
  return normalizeScopePath(root)
}
