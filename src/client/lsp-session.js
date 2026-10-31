/**
 * The client-side LSP session (PRD-v5 §3.3, §5.1-§5.5).
 *
 * This module is the single entry point of the semantic features. The editor
 * asks it for extensions, the store asks it for the state, and the session
 * owns the one `LSPClient` and its WebSocket transport.
 *
 * Four rules shape the code:
 *
 * 1. **Nothing happens when the feature is off.** With `settings.lsp.enabled`
 *    off (or without a store) no client is created and no socket is opened -
 *    the workbench keeps its conservative mode (local completion plus text
 *    search for usages). The language server of the *host* is stopped as
 *    well, so switching the feature off really ends the process (SET-01).
 * 2. **The library's own keymaps are not used.** `languageServerExtensions()`
 *    would install `renameKeymap` (F2) and `formatKeymap` (Shift-Alt-f),
 *    both of which the workbench already uses for other things
 *    (PRD §0.2 #6). The extensions are therefore assembled by hand.
 * 3. **The request timeout is raised.** The library defaults to 3000 ms,
 *    which silently times out on a large project; the setting
 *    `lsp.requestTimeoutMs` (30000 by default) is used instead. The *first*
 *    semantic request of a session gets a far bigger budget
 *    (`BUILD_REQUEST_TIMEOUT_MS`, ten minutes): it is the request that makes
 *    the language server build the program of the whole project, and that
 *    takes minutes on a large project (PRD-v5 §0.2 #3, review S6). The
 *    budget goes back to the long one whenever the host reports a new
 *    language server process: the new process has to build the program again,
 *    and the socket between the browser and the host stays open when the
 *    server crashes, so the identity of the process is the only way the
 *    client learns about it (review T1).
 * 4. **The HTML of a hover is sanitized.** The server's Markdown may contain
 *    arbitrary HTML, so `sanitizeHTML` is part of the client configuration.
 *
 * The session also watches the *health* of the semantic features
 * (PRD-v5 §2.4, MEM-03): the request method of the client is wrapped, and
 * only the failures of the semantic requests are counted. A failure that
 * has nothing to do with the semantics (a document that cannot be synced,
 * for example) must not turn the status bar yellow - but three failed
 * semantic requests in a row, or two timeouts, mean that the language
 * server is not really working any more, and the user has to see that
 * (PRD-v5 §0.4 #3).
 */
import { LSPClient, LSPPlugin, WorkspaceMapping, hoverTooltips, serverCompletion, signatureHelp } from '@codemirror/lsp-client'
import { call, wsUrl } from './api.js'
import { sanitizeHTML } from './lsp-sanitize.js'
import { createLspTransport } from './lsp-transport.js'
import { fileUriOf, languageIdForPath } from './lsp-uri.js'
import { WorkbenchWorkspace } from './lsp-workspace.js'
import { BUILD_REQUEST_TIMEOUT_MS } from '../host/settings-defaults.js'
/**
 * The requests whose failures say something about the semantic features.
 *
 * The set is shared with the host, because the two sides have to agree on ONE
 * definition of "an answer that says something about the semantic features" -
 * they use it for the same decision. The client counts only the failures of
 * these requests (a document that cannot be synced says nothing about the
 * features), and the host counts only the answers to them before it tightens
 * the request budget. Two copies of the list would drift apart, and the host
 * would then kill the very server the client is still waiting for (review T3).
 *
 * Everything else - the handshake, the document synchronization, the
 * formatting - is not part of the features the status bar talks about, so
 * its failures must not be counted.
 */
import { SEMANTIC_METHODS } from '../host/semantic-methods.js'

/** The fallback keys, used when the settings do not carry them. */
const DEFAULT_SHORTCUTS = {
  goToDefinition: 'F12',
  findUsages: 'Alt+F7',
  findUsagesText: 'Alt+F8',
  complete: 'Ctrl+Space',
}

/** The WebSocket route of the host side LSP relay. */
const LSP_WS_PATH = 'ide-workbench/ws/lsp'

/** The store the session belongs to. */
let sessionStore = null
/** The one LSP client of the session. */
let currentClient = null
/** The workspace of the client, the host of the documents. */
let currentWorkspace = null
/** The transport of the client. */
let currentTransport = null
/** Whether the session wants a client at all. */
let sessionEnabled = true
/** Bumped whenever the extensions of the editors have to be refreshed. */
let sessionVersion = 0
/** The editors of the workbench, by document URI. */
const editorViews = new Map()
/** The listeners that want to know when the session changed. */
const sessionListeners = new Set()
/** The unsubscribe function of the store subscription. */
let unsubscribeStore = null
/** The last combination of settings and root the session was started for. */
let sessionKey = null
/** The project root the running client belongs to. */
let sessionRoot = ''
/** Whether the error reports of the library were redirected already. */
let reportErrorRedirected = false
/** The timer of the next handshake retry. */
let handshakeTimer = null
/** How many times the handshake was retried in a row. */
let handshakeRetries = 0
/** Whether the positions of the workspace mapping were redirected already. */
let mappingRedirected = false
/**
 * The health of the semantic features.
 *
 * `consecutiveFailures` counts the failed semantic requests since the last
 * successful one, `consecutiveTimeouts` the timed out ones among them (a
 * timeout is the typical silent failure and has its own limit), and
 * `lastFailure` describes the last failure.
 * @type {{consecutiveFailures: number, consecutiveTimeouts: number, lastFailure: {message: string, at: number} | null}}
 */
let health = { consecutiveFailures: 0, consecutiveTimeouts: 0, lastFailure: null }
/**
 * How many semantic requests of the session have been answered.
 *
 * The counter decides how long a request may take: the first semantic
 * request of a session is the one that makes the language server build the
 * program of the whole project, and that takes minutes on a large project
 * (PRD-v5 §0.2 #3). Every request before the first answered one therefore
 * gets the long budget of {@link requestBudgetOf}.
 *
 * The counter belongs to one session: a new client, another project or a
 * restarted language server all start over, because the new server has to
 * build its program again.
 * @type {number}
 */
let semanticAnswers = 0
/**
 * The identity of the language server process the client talks to.
 *
 * The host publishes it in the status snapshot: the number changes with every
 * new language server process. The client needs it because the socket between
 * the browser and the host stays open when the language server crashes - only
 * the *process* is replaced - so the client never learns about the restart
 * from the socket and would keep the short request budget while the host is
 * patient for ten minutes (review T1).
 *
 * `null` means "the client has not seen a process yet": the first value it
 * sees is the baseline of the comparison - unless the client has already
 * talked to a server, in which case the identity belongs to a process it
 * never talked to (see {@link watchServerProcess}).
 * @type {number | null}
 */
let lastProcessId = null

/**
 * The complaints of the server about a document outside the project.
 *
 * The language server only knows the documents of the project. A file that
 * lives outside of it is announced by nobody, and the server reacts to such a
 * document with a complaint ("Unexpected resource file:///…", "not part of
 * the workspace", …). The complaint is noise for the user - the workbench
 * never asked for anything wrong - so it must not become an error toast
 * (review S8).
 */
const OUTSIDE_PROJECT_COMPLAINTS = [
  /unexpected resource/i,
  /not part of the workspace/i,
  /outside the project/i,
  /not in the project/i,
]

/**
 * Whether one report of the server is about a document outside the project.
 *
 * The filter is deliberately narrow: only the four complaints that name the
 * problem are recognised, so every other error of the server still reaches
 * the user as a toast.
 * @param {string} message the message of the library
 * @param {string} detail the detail of the error
 * @returns {boolean} true when the report is about a document outside the project
 */
function isOutsideProjectComplaint(message, detail) {
  const text = `${message ?? ''} ${detail ?? ''}`
  return OUTSIDE_PROJECT_COMPLAINTS.some(pattern => pattern.test(text))
}

/**
 * Send the reports of the language server to the workbench toast.
 *
 * `LSPPlugin.reportError` opens a dialog panel at the top of the editor and
 * never closes it: one failed request covers the code until the user clicks
 * the cross. The workbench already has a transient toast that sits above the
 * status bar, so the message goes there instead - it stays visible (PRD
 * §7.1) without covering anything.
 *
 * One kind of report is dropped: the complaint of the server about a
 * document outside the project. The workbench never announces such a
 * document (the workspace has a fence), so the complaint is only noise - and
 * a toast would blame the user for something they did not do.
 *
 * The library is not changed on disk; its prototype is redirected once, when
 * the first session starts.
 */
export function redirectErrorsToToast() {
  if (reportErrorRedirected) return
  reportErrorRedirected = true
  const original = LSPPlugin.prototype.reportError
  LSPPlugin.prototype.reportError = function reportError(message, err) {
    const detail = err?.message ?? String(err ?? '')
    console.warn('[lsp]', message, detail)
    // A complaint about a document outside the project is logged and dropped:
    // neither a toast nor the panel of the library may blame the user for a
    // file the workbench deliberately never announced.
    if (isOutsideProjectComplaint(message, detail)) return
    const store = sessionStore
    if (store !== null && typeof store.toast === 'function') {
      try {
        store.toast('error', `${message}: ${detail}`, '')
        return
      } catch {
        /* the toast is broken: fall through to the library */
      }
    }
    original.call(this, message, err)
  }
}

/**
 * The health of the semantic features.
 *
 * The values are published into the `lsp` slice of the store (see
 * {@link publishHealth}), so the status bar never has to import this
 * module. This function is the readable form of the same state - it is
 * cheap, and it never throws, not even when there is no client at all,
 * which is the normal state while the feature is off.
 * @returns {{consecutiveFailures: number, consecutiveTimeouts: number, lastFailure: {message: string, at: number} | null}} the health
 */
export function lspHealth() {
  return {
    consecutiveFailures: health.consecutiveFailures,
    consecutiveTimeouts: health.consecutiveTimeouts,
    lastFailure: health.lastFailure === null ? null : { ...health.lastFailure },
  }
}

/**
 * Forget the failures of the last project.
 *
 * The health belongs to one project: the failures of the old language server
 * say nothing about the new one, so the counter starts at zero again when
 * the project changes.
 *
 * The answered semantic requests are forgotten with it: the new language
 * server has to build its program again, so its first semantic request needs
 * the long budget again.
 */
export function resetLspHealth() {
  health = { consecutiveFailures: 0, consecutiveTimeouts: 0, lastFailure: null }
  semanticAnswers = 0
  publishHealth()
}

/**
 * Whether two failures describe the same event.
 *
 * The store compares the failures by their content and not by their
 * identity: a new object with the same message and the same time is the
 * same failure, and writing it again would wake the React subscribers for
 * nothing.
 * @param {any} left the first failure
 * @param {any} right the second failure
 * @returns {boolean} true when both describe the same failure
 */
function sameFailure(left, right) {
  if (left === right) return true
  if (left === null || left === undefined || right === null || right === undefined) return false
  return left.message === right.message && left.at === right.at
}

/**
 * Publish the health of the semantic features into the store.
 *
 * The store does not read the health from this module: importing the LSP
 * client into the store would drag `@codemirror/lsp-client` into every test
 * that touches the store. The session therefore writes the three fields
 * into the `lsp` slice of the store itself - the slice already declares
 * them.
 */
function publishHealth() {
  const store = sessionStore
  if (store === null || store === undefined) return
  if (typeof store.set !== 'function') return
  const lsp = store.state?.lsp
  if (lsp === null || lsp === undefined) return
  const next = {
    ...lsp,
    consecutiveFailures: health.consecutiveFailures,
    consecutiveTimeouts: health.consecutiveTimeouts,
    lastFailure: health.lastFailure === null ? null : { ...health.lastFailure },
  }
  if (lsp.consecutiveFailures === next.consecutiveFailures
    && lsp.consecutiveTimeouts === next.consecutiveTimeouts
    && sameFailure(lsp.lastFailure, next.lastFailure)) return
  store.set({ lsp: next })
}

/**
 * The message of one failed request.
 * @param {unknown} error the rejection of the request
 * @returns {string} the message
 */
function failureMessage(error) {
  if (typeof error === 'string') return error
  if (error !== null && typeof error === 'object' && typeof error.message === 'string') return error.message
  return String(error ?? '')
}

/**
 * Whether one failure was a timeout.
 *
 * A timeout is the typical silent failure of a language server: the request
 * never comes back, and the user only sees that nothing happens. It is
 * therefore counted on its own (PRD-v5 §0.4 #3).
 * @param {string} message the message of the failure
 * @returns {boolean} true when the request timed out
 */
function isTimeout(message) {
  return /timed out|timeout/i.test(message)
}

/**
 * Whether one rejection is the client's own deadline.
 *
 * The library gives up on a request with `new Error("Request timed out")`,
 * and that is the ONE rejection that means the server did not answer. Every
 * other rejection is an answer of the server: the library hands the JSON-RPC
 * error object of the server to the caller (a plain object, not an `Error`).
 * The program of the project is built when the server answers - even with an
 * error - so the next request is a short one again.
 *
 * The check is deliberately exact: a server whose error *message* mentions a
 * timeout must not be mistaken for the client's own deadline. The loose
 * {@link isTimeout} is used for the health counter, where a false positive
 * only changes the wording of the status bar.
 *
 * The function is exported so that the rule can be pinned by a test: the
 * library's own deadline cannot be reached in a test without waiting for it.
 * @param {unknown} error the rejection of the request
 * @returns {boolean} true when the client gave up on the request
 */
export function isClientDeadline(error) {
  if (!(error instanceof Error)) return false
  return /^request timed out$/i.test(error.message ?? '')
}
/**
 * Note that a semantic request worked.
 *
 * One success is enough: the features work again, so the status bar must
 * not keep the warning of the failures before it. The timeouts are reset as
 * well - they are counted as a *run* of timeouts, and a request that
 * worked in between breaks that run.
 */
function noteSemanticSuccess() {
  health.consecutiveFailures = 0
  health.consecutiveTimeouts = 0
  publishHealth()
}

/**
 * Note that a semantic request failed.
 * @param {unknown} error the rejection of the request
 */
function noteSemanticFailure(error) {
  const message = failureMessage(error)
  health.consecutiveFailures += 1
  if (isTimeout(message)) health.consecutiveTimeouts += 1
  health.lastFailure = { message, at: Date.now() }
  publishHealth()
}

/**
 * Count the failures of the semantic requests.
 *
 * The library reports a failed request through `LSPPlugin.reportError`,
 * which cannot tell a semantic failure from a document that cannot be
 * synced - and the status bar must only react to the former. The request
 * method of the client is therefore wrapped: only the semantic methods are
 * counted, a success resets the counter, and a timeout is counted on its own.
 *
 * The wrapper also carries the request budget: it is written into the client
 * before the request is created, because the library reads `client.timeout`
 * when it builds the request.
 * @param {any} client the client of the session
 */
function watchSemanticRequests(client) {
  const original = client.request.bind(client)
  client.request = function request(method, params) {
    // The budget has to be in effect *before* the request is created: the
    // library reads `client.timeout` when it builds the request, so the first
    // semantic request - the one that makes the server build the program of
    // the project - would be given the short budget otherwise.
    applyRequestBudget(client)
    // A new find cycle: the files of the last one are stale.
    if (method === 'textDocument/references') clearRequestCache()
    const promise = original(method, params)
    if (!SEMANTIC_METHODS.has(method)) return promise
    return promise.then(
      result => {
        // The server answered: from now on the incremental requests are
        // quick, and the configured timeout is the right budget again. The
        // budget itself is written into the client when the NEXT request is
        // created (the library reads `client.timeout` exactly there), so the
        // client keeps the long budget until then - that is the budget the
        // request that is still running was created with.
        semanticAnswers += 1
        noteSemanticSuccess()
        return result
      },
      error => {
        noteSemanticFailure(error)
        // A rejection that is not the client's own deadline means the server
        // DID answer - with an error, but with an answer. The program of the
        // project is built then, so the next request is a short one again.
        //
        // The host counts the same thing (the answers to the semantic
        // requests - the same list of methods, see `SEMANTIC_METHODS`), and
        // the two sides have to agree: if the host switched to the short
        // budget while the client still waited with the long one, the host
        // would kill the very server the client is still waiting for.
        if (!isClientDeadline(error)) semanticAnswers += 1
        // The error goes on to the library, which reports it as a toast.
        throw error
      },
    )
  }
}

/**
 * Forget the files that were read for the last find cycle.
 *
 * The cache of the workspace belongs to one search: the next search has to
 * see the files as they are now.
 */
function clearRequestCache() {
  const workspace = currentWorkspace
  if (workspace === null || workspace === undefined) return
  if (typeof workspace.clearRequestCache !== 'function') return
  try {
    workspace.clearRequestCache()
  } catch (error) {
    console.warn('[lsp] the request cache could not be cleared:', error instanceof Error ? error.message : error)
  }
}

/**
 * The document of one URI, when the workspace knows it.
 * @param {any} client the LSP client
 * @param {string} uri the document URI
 * @returns {any} the document, or `null`
 */
function documentOf(client, uri) {
  const workspace = client?.workspace ?? null
  if (workspace === null || workspace === undefined) return null
  if (typeof workspace.documentFor !== 'function') return null
  try {
    return workspace.documentFor(uri) ?? null
  } catch {
    return null
  }
}

/**
 * The offset of an LSP position inside a document.
 * @param {any} doc the document
 * @param {{line?: number, character?: number}} pos the position
 * @returns {number} the offset
 */
function offsetOfPosition(doc, pos) {
  const line = Number.isFinite(pos?.line) ? pos.line + 1 : 1
  const text = doc.line(Math.min(Math.max(line, 1), doc.lines))
  const character = Number.isFinite(pos?.character) ? pos.character : 0
  return text.from + Math.min(Math.max(character, 0), text.length)
}

/**
 * Let the reference panel show the files that are not open in an editor.
 *
 * The library maps the position of a reference with the workspace mapping
 * it created when the search started. That mapping knows the documents that
 * were open *at that moment* - a file that was only read for the panel has
 * no entry, and the library throws "Cannot map from a file that's not in
 * the workspace" while the panel is rendered. Such a file cannot have
 * unsaved changes, so its position needs no mapping at all: only the
 * conversion of an LSP position into an offset.
 *
 * The library is not changed on disk; its prototype is redirected once, when
 * the first session starts.
 */
function redirectMappingPositions() {
  if (mappingRedirected) return
  mappingRedirected = true
  const original = WorkspaceMapping.prototype.mapPosition
  WorkspaceMapping.prototype.mapPosition = function mapPosition(uri, pos, assoc = -1, mode) {
    try {
      return original.call(this, uri, pos, assoc, mode)
    } catch (error) {
      const doc = documentOf(this.client, uri)
      if (doc === null) throw error
      return offsetOfPosition(doc, pos)
    }
  }
}

/**
 * Stop the language server of the host.
 *
 * The feature is switched off, so the language server process has to die
 * now and not after the ten minute idle timeout of the host (SET-01). The
 * call is not awaited - switching the feature off must not wait for the
 * host - and a failure is only logged: the client closes its socket either
 * way.
 * @param {string} root the project root
 */
function shutdownHostLsp(root) {
  if (typeof root !== 'string' || root === '') return
  void call('lsp.shutdown', { root }).catch(error => {
    console.warn('[lsp] the language server could not be stopped:', error instanceof Error ? error.message : error)
  })
}

/**
 * Announce that the extensions of the editors changed.
 *
 * The language server can appear (the settings arrive late) or disappear (it
 * crashed, or the feature was switched off) while an editor is open, so the
 * editors have to be able to pick up the new extensions.
 */
function bumpVersion() {
  sessionVersion += 1
  for (const listener of [...sessionListeners]) {
    try {
      listener(sessionVersion)
    } catch (error) {
      console.warn('[lsp] session listener failed:', error instanceof Error ? error.message : error)
    }
  }
}

/**
 * Watch the session.
 * @param {(version: number) => void} listener the listener
 * @returns {() => void} a function that removes the listener again
 */
export function onLspSessionChange(listener) {
  if (typeof listener !== 'function') return () => {}
  sessionListeners.add(listener)
  return () => { sessionListeners.delete(listener) }
}

/**
 * The registry the workspace uses to find the editor of a document.
 *
 * It is a thin object so that the workspace does not have to know how the
 * editors are tracked.
 */
const viewRegistry = {
  /**
   * @param {string} uri the document URI
   * @returns {any} the editor, or `null`
   */
  get(uri) {
    const views = editorViews.get(uri)
    if (views === undefined || views.size === 0) return null
    for (const view of views) return view
    return null
  },
  /**
   * @param {string} uri the document URI
   * @param {number} [timeoutMs] how long to wait
   * @returns {Promise<any>} the editor, or `null` on timeout
   */
  waitForEditorView(uri, timeoutMs = 5000) {
    return waitForEditorView(uri, timeoutMs)
  },
}

/**
 * The translation helper of the store, with a readable fallback.
 * @param {string} key the i18n key
 * @returns {string} the text
 */
function translate(key) {
  if (typeof sessionStore?.t === 'function') {
    try {
      const value = sessionStore.t(key)
      if (typeof value === 'string' && value !== '') return value
    } catch {
      /* a broken translator must not break the menu */
    }
  }
  return key
}

/**
 * Register the editor of one document.
 * @param {string} uri the document URI
 * @param {any} view the editor
 */
export function registerEditorView(uri, view) {
  if (typeof uri !== 'string' || uri === '' || view === null || view === undefined) return
  let views = editorViews.get(uri)
  if (views === undefined) {
    views = new Set()
    editorViews.set(uri, views)
  }
  views.add(view)
}

/**
 * Unregister the editor of one document.
 * @param {string} uri the document URI
 * @param {any} view the editor
 */
export function unregisterEditorView(uri, view) {
  const views = editorViews.get(uri)
  if (views === undefined) return
  views.delete(view)
  if (views.size === 0) editorViews.delete(uri)
}

/**
 * Wait until the editor of one document shows up.
 *
 * A file that is opened by a cross-file jump is rendered by React a tick
 * later, so the workspace has to wait for it.
 * @param {string} uri the document URI
 * @param {number} [timeoutMs] how long to wait
 * @returns {Promise<any>} the editor, or `null` on timeout
 */
export function waitForEditorView(uri, timeoutMs = 5000) {
  const existing = viewRegistry.get(uri)
  if (existing !== null) return Promise.resolve(existing)
  return new Promise((resolve) => {
    let timer = null
    let interval = null
    const finish = (value) => {
      if (timer !== null) clearTimeout(timer)
      if (interval !== null) clearInterval(interval)
      resolve(value)
    }
    timer = setTimeout(() => finish(null), Math.max(0, timeoutMs))
    interval = setInterval(() => {
      const view = viewRegistry.get(uri)
      if (view !== null) finish(view)
    }, 40)
    if (typeof interval?.unref === 'function') interval.unref()
    if (typeof timer?.unref === 'function') timer.unref()
  })
}

/**
 * The WebSocket URL of the host side LSP relay.
 * @param {string} root the project root
 * @returns {string} the URL
 */
function lspSocketUrl(root) {
  const url = wsUrl(LSP_WS_PATH)
  if (typeof root === 'string' && root !== '') url.searchParams.set('root', root)
  return url.href
}

/**
 * The request timeout of the client.
 *
 * The library default is 3000 ms, which is far too short for a first
 * semantic request on a large project.
 * @param {any} store the workbench store
 * @returns {number} the timeout in milliseconds
 */
function requestTimeoutOf(store) {
  const configured = store?.state?.settings?.lsp?.requestTimeoutMs
  if (Number.isFinite(configured) && configured >= 30000) return configured
  return 30000
}

/**
 * The budget of one request, in milliseconds.
 *
 * The budget follows the *answered* semantic requests of the session: the
 * first one is the request that makes the language server build the program
 * of the whole project, and PRD-v5 §0.2 #3 measured that at more than ten
 * minutes. A 30 s budget turns it into a "Request timed out" the user
 * cannot do anything about - and, because the host counts the unanswered
 * requests, into a server that is killed and restarted (review S6).
 *
 * The mirrored state of the session is deliberately *not* used: the host
 * marks a session `ready` about ten milliseconds after the server answered
 * `initialize`, while the long program build happens minutes later - on the
 * first semantic request. A budget that followed the state would therefore
 * never apply to the request that actually takes ten minutes.
 *
 * After the first answered semantic request the server is up and answers the
 * incremental requests quickly, so the configured timeout applies again.
 * @param {any} store the workbench store
 * @returns {number} the budget in milliseconds
 */
export function requestBudgetOf(store) {
  const configured = requestTimeoutOf(store)
  if (semanticAnswers > 0) return configured
  return Math.max(configured, BUILD_REQUEST_TIMEOUT_MS)
}

/**
 * Write the current request budget into the client.
 *
 * The library reads `client.timeout` when it *creates* a request, so the
 * budget has to be written before the request is built and not when the
 * settings change.
 * @param {any} client the client of the session
 */
function applyRequestBudget(client) {
  if (client === null || client === undefined) return
  const budget = requestBudgetOf(sessionStore)
  if (client.timeout === budget) return
  client.timeout = budget
}

/**
 * Whether the semantic features may be used right now.
 * @returns {boolean} true when the server is ready and offers the feature
 */
function capabilityAvailable(name) {
  const capabilities = currentClient?.serverCapabilities ?? null
  if (capabilities === null) return false
  if (!capabilities[name]) return false
  const slice = sessionStore?.state?.lsp ?? null
  if (slice !== null && typeof slice === 'object' && typeof slice.state === 'string') {
    if (slice.state !== 'ready') return false
  }
  return true
}

/**
 * Whether the server can answer a reference request.
 * @returns {boolean} true when the semantic "find usages" is available
 */
export function semanticUsagesAvailable() {
  return capabilityAvailable('referencesProvider')
}

/**
 * Whether the server can answer a definition request.
 * @returns {boolean} true when the semantic "go to definition" is available
 */
export function semanticDefinitionAvailable() {
  return capabilityAvailable('definitionProvider')
}

/** Create the client and open the socket. */
function startLsp() {
  if (currentClient !== null) return
  const store = sessionStore
  if (store === null || store === undefined) return
  redirectErrorsToToast()
  redirectMappingPositions()
  const root = typeof store.state?.root === 'string' ? store.state.root : ''
  // A new client is a new session: no semantic request has been answered
  // yet, so the first one gets the long budget.
  semanticAnswers = 0
  currentClient = new LSPClient({
    rootUri: fileUriOf(root),
    // The budget of the construction is the budget of the session, so that a
    // request which is sent before the first wrapper call is not short
    // either.
    timeout: requestBudgetOf(store),
    sanitizeHTML,
    workspace: (client) => {
      currentWorkspace = new WorkbenchWorkspace(client, store, { viewRegistry })
      return currentWorkspace
    },
    // The editor extensions are added by `lspExtensions()` instead, so that
    // the workbench can keep them out of the editors that have no client.
    extensions: [],
  })
  // The health of the features is watched on the request method of the
  // client, so that only the semantic failures are counted.
  watchSemanticRequests(currentClient)
  currentTransport = createLspTransport({
    url: () => lspSocketUrl(root),
    onOpen: (info) => {
      // A socket that opens again means the previous connection died. The
      // library only runs its handshake in `connect()`, so the client is
      // reconnected here: the host answers the second `initialize` from the
      // capabilities of the running language server.
      if (info?.reopened === true) reinitializeLsp()
      bumpVersion()
    },
    onClose: () => { bumpVersion() },
    onError: (error) => {
      console.warn('[lsp] transport error:', error instanceof Error ? error.message : error)
    },
  })
  currentClient.connect(currentTransport)
  watchHandshake(currentClient)
  bumpVersion()
}

/**
 * How often a failed handshake is retried before the user has to refresh.
 *
 * The retry is the way out of a broken session: a rejected handshake leaves
 * the client dead for good (every later request rejects with the same
 * error), and the language server may well be on its way - the host holds
 * the handshake until the server exists.
 */
const MAX_HANDSHAKE_RETRIES = 3

/**
 * Watch the handshake of the client.
 *
 * `LSPClient.connect()` sends the `initialize` request and rejects the
 * handshake promise when it does not get an answer. A rejected promise is
 * sticky: every later request rejects with it, so the semantic features
 * stay dead until the page is reloaded. The library resets the promise in
 * `disconnect()`, so the way out is to disconnect and connect again - which
 * is what the retry does.
 * @param {any} client the LSP client
 */
function watchHandshake(client) {
  const handshake = client?.initializing
  if (handshake === null || handshake === undefined || typeof handshake.then !== 'function') return
  handshake.then(
    () => { handshakeRetries = 0 },
    (error) => {
      console.warn('[lsp] the handshake failed:', error instanceof Error ? error.message : error)
      scheduleHandshakeRetry()
    },
  )
}

/**
 * Try the handshake again after it failed.
 *
 * The language server may need a moment (the host starts it when the
 * project is opened), and a session that is broken for good is worse than
 * a few retries.
 */
function scheduleHandshakeRetry() {
  if (handshakeTimer !== null) return
  if (handshakeRetries >= MAX_HANDSHAKE_RETRIES) {
    console.warn('[lsp] the handshake keeps failing; reload the page to try again')
    return
  }
  handshakeRetries += 1
  handshakeTimer = setTimeout(() => {
    handshakeTimer = null
    if (currentClient === null) return
    reinitializeLsp()
  }, 2000)
  handshakeTimer.unref?.()
}

/**
 * Run the handshake again after the socket was rebuilt.
 *
 * `LSPClient.connect()` is the only place that sends `initialize`, and
 * `disconnect()` resets the handshake promise, so the pair brings the client
 * back into the state it had right after the first connection.
 */
function reinitializeLsp() {
  if (currentClient === null || currentTransport === null) return
  try {
    currentClient.disconnect()
    // The socket opened again, so the language server was restarted (the
    // user asked for a new index, or the server died). The failures of the
    // old server say nothing about the new one - and the new server has to
    // build its program again, so its handshake needs the long budget as
    // well. Both have to happen before the handshake is sent: the library
    // reads the budget of the client when it creates the request.
    resetLspHealth()
    applyRequestBudget(currentClient)
    currentClient.connect(currentTransport)
    // The new handshake has to be watched as well: a session whose handshake
    // failed has to be able to try again.
    watchHandshake(currentClient)
  } catch (error) {
    console.warn('[lsp] the handshake could not be repeated:', error instanceof Error ? error.message : error)
  }
}

/**
 * Put the session back into the state of a fresh language server.
 *
 * A language server that is replaced has to build the program of the project
 * again, so its first semantic request needs the long budget - exactly like
 * the first request of a new session. The failures of the old server say
 * nothing about the new one, so the health of the features goes with it.
 *
 * This is the same work that {@link reinitializeLsp} does when the socket
 * opens again.
 */
function resetForNewServer() {
  resetLspHealth()
  applyRequestBudget(currentClient)
}

/**
 * Reset the request budget when the language server was replaced.
 *
 * The host publishes the identity of the running language server process in
 * the status snapshot, and the client watches it. The socket between the
 * browser and the host stays open when the language server crashes - only the
 * *process* is replaced - so the restart has to be seen in the status that
 * the store polls. Without it the client would keep the short budget (30 s by
 * default) while the host waits patiently for ten minutes: the client would
 * give up with "Request timed out" and the status bar would say "unstable",
 * and the user would see a failure that the host did not consider one
 * (review T1).
 *
 * The first value the client sees is not always the same thing, so three
 * cases are told apart:
 *
 *   - the client has not talked to a server yet and sees an identity for the
 *     first time: that is the baseline, not a restart - there was no server
 *     before;
 *   - the client HAS talked to a server and sees an identity for the first
 *     time: the identity belongs to a process the client never talked to.
 *     The server it talked to was replaced before the first status poll, and
 *     the new process has to build the program of the project again;
 *   - the identity changes: the server was replaced.
 *
 * The client cannot tell whether the server it talked to is still the
 * running one - the status poll lags by up to two seconds - so the safe
 * choice is made: the program is built again and the long budget applies.
 * The price is one request with a longer budget than it needs in the rare
 * case that nothing was replaced; the price of the other choice is the
 * "Request timed out" the user complained about.
 *
 * The id 0 means that no server runs at all. It never establishes the
 * baseline - only a running server has an identity - but it does reset the
 * budget: the server is gone, and the next one has to build the program
 * again.
 * @param {any} store the workbench store
 */
function watchServerProcess(store) {
  const reported = store?.state?.lsp?.processId
  if (!Number.isFinite(reported)) return
  const processId = reported
  if (processId === 0) {
    // No server runs. If one ran a moment ago, it is gone: the next server
    // has to build the program of the project again, so the budget goes back
    // to the long one - before the new process is even there. A request that
    // wakes the new server would otherwise time out after 30 seconds.
    if (lastProcessId === null) return
    lastProcessId = null
    resetForNewServer()
    return
  }
  if (lastProcessId === null) {
    // The first process the client sees: it is the baseline of the
    // comparison, not a restart. The budget is already the long one, because
    // the session has not answered a semantic request yet.
    //
    // Unless the client ALREADY got an answer from a server whose identity
    // it never saw: then that server was replaced before the first poll, the
    // id belongs to a NEW process, and the program of the project has to be
    // built again. The budget would otherwise stay short while the host is
    // patient - the one asymmetry this watch exists to remove.
    lastProcessId = processId
    if (semanticAnswers > 0) resetForNewServer()
    return
  }
  if (processId === lastProcessId) return
  // The language server was replaced. The id is remembered BEFORE the reset,
  // because the reset writes into the store and that wakes the subscribers
  // again - the second round has to see the same id and do nothing.
  lastProcessId = processId
  resetForNewServer()
}

/** Drop the client and close the socket. */
function stopLsp() {
  if (handshakeTimer !== null) {
    clearTimeout(handshakeTimer)
    handshakeTimer = null
  }
  handshakeRetries = 0
  if (currentClient !== null) {
    try {
      currentClient.disconnect()
    } catch {
      /* the client may already be gone */
    }
  }
  if (currentTransport !== null) {
    try {
      currentTransport.close()
    } catch {
      /* the transport may already be gone */
    }
  }
  currentClient = null
  currentWorkspace = null
  currentTransport = null
  // The health belongs to the running session: when it ends, the failures
  // of the old server say nothing about the next one. The answered semantic
  // requests go with it - the next session starts with a server that has to
  // build its program again.
  resetLspHealth()
  bumpVersion()
}

/** Apply the current settings to the session. */
function refreshLsp() {
  // The store rebuilds its `lsp` slice every two seconds (the status poll),
  // and that rebuild can drop the health of the session. The health is
  // written back here, so it always survives.
  publishHealth()
  const store = sessionStore
  if (store === null || store === undefined) {
    if (sessionKey !== null) {
      sessionKey = null
      sessionRoot = ''
      stopLsp()
    }
    return
  }
  const lspSettings = store.state?.settings?.lsp ?? null
  const root = typeof store.state?.root === 'string' ? store.state.root : ''
  const enabled = sessionEnabled && lspSettings?.enabled !== false
  // Without a project there is no language server to talk to.
  const wanted = enabled && root !== ''
  const key = `${enabled}|${root}`
  if (key === sessionKey) return
  const hadClient = currentClient !== null
  // The root of the client that is running now: it is the project whose
  // language server has to be stopped.
  const previousRoot = sessionRoot
  sessionKey = key
  sessionRoot = root
  if (previousRoot !== root) {
    // Another project: the failures of the old language server say nothing
    // about the new one.
    resetLspHealth()
  }
  if (wanted) {
    // A different project means a different server: the old client is
    // closed first, so its socket cannot outlive the project.
    if (hadClient) {
      // The old language server keeps running on the host until its idle
      // timeout - ten minutes - and holds its memory all that time. The
      // project was left, so the server has to go with it (SET-01 asks for
      // the same when the feature is switched off).
      if (previousRoot !== '' && previousRoot !== root) shutdownHostLsp(previousRoot)
      stopLsp()
    }
    startLsp(store)
  } else if (hadClient) {
    // The feature is off: the language server of the host has to die now
    // and not after its ten minute idle timeout (SET-01). The call happens
    // before the socket is closed, so the host learns about it while the
    // session is still alive.
    shutdownHostLsp(previousRoot)
    stopLsp()
  }
}

/**
 * Bind the session to a workbench store.
 *
 * The workbench has one store per workspace scope, so this is called once per
 * store. Calling it again replaces the previous binding.
 * @param {any} store the workbench store
 */
export function configureLsp(store) {
  sessionStore = store ?? null
  if (unsubscribeStore !== null) {
    unsubscribeStore()
    unsubscribeStore = null
  }
  sessionKey = null
  sessionRoot = ''
  // A new store is a new world for the client: it has not seen a language
  // server process yet, so the first process id it reads is the baseline of
  // the comparison and not a restart.
  lastProcessId = null
  if (typeof store?.subscribe === 'function') {
    // The settings and the project root arrive after the store was created,
    // so the session follows the state of the store.
    //
    // The identity of the language server process is watched here as well: the
    // socket between the browser and the host stays open when the language
    // server crashes (only the process is replaced), so the restart can only
    // be seen in the status that the store polls.
    unsubscribeStore = store.subscribe(() => {
      watchServerProcess(store)
      refreshLsp()
    })
  }
  refreshLsp()
}

/**
 * Apply the current settings to the session again.
 *
 * The session watches the store on its own; this is for the cases where the
 * settings were changed outside of the store.
 */
export function refreshLspSession() {
  sessionKey = null
  refreshLsp()
}

/**
 * The LSP client of the session.
 * @returns {any} the client, or `null` when the feature is off
 */
export function lspClient() {
  return currentClient
}

/**
 * The semantic extensions of the editor.
 *
 * Only the three features of this round are installed. The keymaps of the
 * library are deliberately left out: `renameKeymap` (F2) and `formatKeymap`
 * (Shift-Alt-f) would collide with the workbench shortcuts, and
 * `signatureKeymap` (Ctrl-Shift-Space) is not wanted either.
 * @returns {Array<any>} the extensions
 */
export function lspExtensions() {
  if (currentClient === null) return []
  return [
    // The semantic completion runs next to the local one; it must not
    // override it (PRD §4.2).
    serverCompletion(),
    hoverTooltips({ hoverTime: 300 }),
    signatureHelp({ keymap: false }),
  ]
}

/**
 * The LSP plugin of one file.
 *
 * The plugin is what connects an editor to the language server; it has to be
 * added after the language extension, because the language id is derived from
 * the file name anyway, but the server capabilities come from the client.
 * @param {string} path the absolute path of the file
 * @returns {Array<any>} the extensions
 */
export function lspPluginExtension(path) {
  if (currentClient === null) return []
  const uri = fileUriOf(path)
  if (uri === '') return []
  return currentClient.plugin(uri, languageIdForPath(path))
}

/**
 * The state of the session.
 * @returns {{connected: boolean, root: string, serverCapabilities: any}} the state
 */
export function lspState() {
  return {
    connected: currentClient !== null && currentClient.connected === true,
    root: typeof sessionStore?.state?.root === 'string' ? sessionStore.state.root : '',
    serverCapabilities: currentClient?.serverCapabilities ?? null,
  }
}

/**
 * Turn the semantic features on or off.
 * @param {boolean} enabled whether the features may be used
 */
export function setLspEnabled(enabled) {
  sessionEnabled = enabled === true
  sessionKey = null
  refreshLsp()
}

/**
 * Close the session and release everything it holds.
 */
export function shutdownLsp() {
  sessionEnabled = false
  sessionKey = null
  stopLsp()
  editorViews.clear()
}

/**
 * A counter that changes whenever the editor extensions have to be refreshed.
 * @returns {number} the version
 */
export function lspSessionVersion() {
  return sessionVersion
}

/**
 * One shortcut of the settings, with the documented default as fallback.
 * @param {string} name `goToDefinition`, `findUsages`, `findUsagesText` or `complete`
 * @returns {string} the shortcut, e.g. `Alt+F7`
 */
export function shortcutFor(name) {
  const table = sessionStore?.state?.settings?.shortcuts
  const value = table?.[name]
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  return DEFAULT_SHORTCUTS[name] ?? ''
}

/**
 * The CodeMirror key of one shortcut of the settings.
 *
 * The settings spell a key as `Alt+F7`; CodeMirror wants `Alt-F7`.
 * @param {string} name the shortcut name
 * @returns {string} the CodeMirror key, or `''`
 */
export function keymapKeyFor(name) {
  const shortcut = shortcutFor(name)
  if (shortcut === '') return ''
  return shortcut
    .split('+')
    .map(part => {
      const key = part.trim()
      if (key === 'Cmd' || key === 'Command' || key === 'Meta') return 'Mod'
      if (key === 'Control') return 'Ctrl'
      if (key === 'Option') return 'Alt'
      return key
    })
    .filter(part => part !== '')
    .join('-')
}

/**
 * The labels of the navigation menu items.
 *
 * The workbench keeps the i18n table in one place, so the texts come from
 * the store's translator.
 * @returns {{goToDefinition: string, findUsages: string, findUsagesText: string, semanticUnavailable: string}} the labels
 */
export function navLabels() {
  return {
    goToDefinition: translate('nav.goToDefinition'),
    findUsages: translate('nav.findUsages'),
    findUsagesText: translate('nav.findUsagesText'),
    semanticUnavailable: translate('nav.semanticUnavailable'),
  }
}

/**
 * Run the text version of "find usages" for one identifier.
 *
 * The implementation lives in the store (it uses the host's file search); the
 * editor only hands over the word under the cursor.
 * @param {string} identifier the identifier
 */
export function findUsagesText(identifier) {
  const text = typeof identifier === 'string' ? identifier.trim() : ''
  if (text === '') return
  const store = sessionStore
  if (store === null || typeof store.findUsagesText !== 'function') return
  try {
    void store.findUsagesText(text)
  } catch (error) {
    console.warn('[lsp] text search failed:', error instanceof Error ? error.message : error)
  }
}
