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

/**
 * How long the client waits for the scope root of the host.
 *
 * The scope root decides the program the language server builds, so the
 * handshake waits for it (PRD-v5 §4.2). But not for ever: a host that does
 * not answer must not keep the semantic features dead - the workspace root is
 * the scope root then, and the session starts anyway.
 */
const SCOPE_TIMEOUT_MS = 3000

/**
 * How long the client waits for the answer of the `initialize` request.
 *
 * The handshake is answered in milliseconds: the server only has to say
 * which capabilities it has. The long budget of the session belongs to the
 * FIRST SEMANTIC request, which makes the language server build the program
 * of the whole project and takes minutes (PRD-v5 §0.2 #3). With the long
 * budget on the handshake, a broken handshake took up to ten minutes to
 * surface - and the user could do nothing in the meantime.
 */
const HANDSHAKE_TIMEOUT_MS = 30000

/**
 * The decision of the workbench about the index of one root.
 *
 * The store owns the decision: it is the one that asked the user
 * (PRD-v5 §2.3). The session only reads it.
 * @param {any} store the store of the session
 * @param {string} root the project root
 * @returns {'build'|'conservative'|'unknown'}
 */
function indexDecisionOf(store, root) {
  if (store === null || store === undefined) return 'unknown'
  if (typeof store.lspIndexDecision !== 'function') {
    // A store that cannot answer (an older host, a test double) must not
    // break the session: the session goes ahead as it always did, and only
    // a store that says "the basic mode" stops it.
    return 'build'
  }
  try {
    const decision = store.lspIndexDecision(root)
    return decision === 'build' || decision === 'conservative' ? decision : 'unknown'
  } catch {
    // A store that throws must not break the session either.
    return 'build'
  }
}

/**
 * The state of the CLIENT session.
 *
 * The host's status says that the language server PROCESS is up; it says
 * nothing about the link between the browser and the server - that is the
 * client's own truth, and the two never check each other. The status bar
 * believed the host: it said "ready" while the semantic features were dead
 * (the menu was greyed out and the hovering did nothing).
 *
 *   'starting' — the client is connecting or re-initializing;
 *   'ready'    — the handshake resolved, so the capabilities are known;
 *   'failed'   — the handshake retries are exhausted, the session is dead.
 * @type {'starting' | 'ready' | 'failed'}
 */
let clientSessionState = 'starting'

/**
 * The reason of the last failure of the client session.
 *
 * It is the only thing that tells the user whether the server is missing or
 * the link is broken.
 * @type {string}
 */
let clientSessionDetail = ''

/**
 * The error of the last failed handshake.
 *
 * The retries of the handshake end with the reason of the LAST failure: it
 * is the one that describes the session the user is stuck in.
 * @type {string}
 */
let lastHandshakeError = ''

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
/**
 * The scope root the running client was built for.
 *
 * The scope root is the directory the language server builds its program for
 * (PRD-v5 §4.2). It is part of the session key: a different scope means a
 * different program, so the client has to be built again with the new root.
 * @type {string}
 */
let sessionScopeRoot = ''
/**
 * The connection of the current client.
 *
 * The client is created before it is connected: the scope root of the project
 * is asked for first, and the handshake waits for the answer (PRD-v5 §4.2).
 * A request that arrives in that window must not fail with "Client not
 * connected" - it waits for the connection, like every other request waits
 * for the handshake.
 * @type {{client: any, promise: Promise<void>, resolve: () => void} | null}
 */
let pendingConnection = null
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
 * Report the state of the client session to the store.
 *
 * The store may be gone and the method may not exist (the session is used
 * without a store in the tests), so the call never throws: a broken report
 * must not break the session it reports about.
 * @param {'starting' | 'ready' | 'failed'} state the state of the session
 * @param {string} [detail] the reason of the failure
 */
function reportClientState(state, detail = '') {
  clientSessionState = state
  clientSessionDetail = typeof detail === 'string' ? detail : ''
  const store = sessionStore
  if (store === null || store === undefined) return
  if (typeof store.lspSessionState !== 'function') return
  try {
    store.lspSessionState(state, clientSessionDetail)
  } catch (error) {
    console.warn('[lsp] the state of the session could not be reported:', error instanceof Error ? error.message : error)
  }
}

/**
 * The state of the client session.
 *
 * It is exported so that the state can be observed without a store - the
 * tests of the handshake have no store at all.
 * @returns {{state: string, detail: string}} the state of the session
 */
export function lspClientSessionState() {
  return { state: clientSessionState, detail: clientSessionDetail }
}
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
    // The client may not be connected yet: the scope root of the project is
    // asked for before the handshake goes out (PRD-v5 §4.2). Such a request
    // waits for the connection instead of failing with "Client not connected".
    const connection = pendingConnection !== null && pendingConnection.client === client
      ? pendingConnection.promise
      : null
    const promise = connection === null
      ? original(method, params)
      : connection.then(() => {
        // The budget may have moved while the request waited.
        applyRequestBudget(client)
        return original(method, params)
      })
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
 *
 * A *suspended* server is the exception: it was released to save memory and
 * the next payload wakes it up (PRD-v5 §3.3). The woken server builds the
 * program of the project from scratch, so it gets the long budget - the same
 * one a session that has not answered a semantic request yet gets.
 * @param {any} store the workbench store
 * @returns {number} the budget in milliseconds
 */
export function requestBudgetOf(store) {
  const configured = requestTimeoutOf(store)
  // A suspended server is about to be woken: the woken server builds the
  // program of the project from scratch, exactly like a fresh session, and
  // the host waits for it with the long budget (`session.realAnswers` is 0
  // for every new process - the wake starts one). The client has to agree
  // from the moment the request is *created*: it learns about the new
  // process only through the two-second status poll, and a short budget in
  // that window would show "Request timed out" while the host is still
  // building (PRD-v5 §3.3).
  if (store?.state?.lsp?.state === 'suspended') return Math.max(configured, BUILD_REQUEST_TIMEOUT_MS)
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
 * The states in which the semantic commands stay enabled.
 *
 * A *suspended* server is recoverable: the host wakes it up on the first
 * payload (PRD-v5 §3.3), so the commands must not be greyed out - otherwise
 * the user cannot start the wake from the context menu. An `idle` server was
 * never started for this root (the host would not wake it), and
 * `degraded` / `failed` are faults: in both cases the command stays off.
 *
 * @param {string} state the state the host reports
 * @returns {boolean} true when the semantic commands may be used
 */
export function semanticStateAllowed(state) {
  return state === 'ready' || state === 'suspended'
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
    if (!semanticStateAllowed(slice.state)) return false
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

/**
 * Whether the host can be asked for the scope root of a project.
 *
 * The client half lives in a browser: the routes of the plugin are reached
 * through the base of the page or through the transport the host injected.
 * Without one of them there is no host to ask - the request could only fail,
 * and the failure would delay the session by the timeout of the request. The
 * workspace root is the scope root then, and the session starts right away.
 * @returns {boolean} true when the host may be asked
 */
function hostIsReachable() {
  const injected = globalThis.__DSH_TRANSPORT__?.streamBaseUrl
  if (typeof injected === 'string' && injected !== '') return true
  if (typeof document !== 'undefined' && typeof document.baseURI === 'string' && document.baseURI !== '') return true
  return false
}

/**
 * The scope root of one project, as the host reports it (PRD-v5 §4.2).
 *
 * The host owns the rule: the program of the language server converges onto
 * the nearest sub-project, and the client cannot compute that - it does not
 * see the disk. The host is asked through its own route, and it answers
 * without a running language server: the scope is a rule of the settings and
 * of the disk, not a fact about a session.
 *
 * A host that does not answer leaves the workspace root as the scope root:
 * the session starts, and the program is the one of the whole workspace (the
 * behaviour of the older versions).
 * @param {string} root the workspace root
 * @returns {Promise<string>} the scope root
 */
export async function scopeRootFor(root) {
  if (typeof root !== 'string' || root === '') return ''
  if (!hostIsReachable()) return root
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, SCOPE_TIMEOUT_MS)
  // A pending timeout must not keep a Node process alive (the tests import
  // this module); in the browser the timer is a plain number.
  if (typeof timer?.unref === 'function') timer.unref()
  try {
    const answer = await call('lsp.scope', { root }, controller.signal)
    const scope = answer?.scopeRoot
    if (typeof scope === 'string' && scope !== '') return scope
  } catch (error) {
    console.warn('[lsp] the scope root could not be read:', error instanceof Error ? error.message : error)
  } finally {
    clearTimeout(timer)
  }
  return root
}

/**
 * The index scope policy of the settings (PRD-v5 §4.2).
 *
 * The policy decides which project the program of the language server is
 * built for. The host validates it (an unknown value falls back to the
 * default there); the client only needs to notice that the policy *moved*,
 * because a changed policy means a changed scope and a new client.
 * @param {any} lsp the `lsp` section of the settings
 * @returns {string} the policy
 */
function indexScopePolicy(lsp) {
  const section = lsp !== null && typeof lsp === 'object' && !Array.isArray(lsp) ? lsp : {}
  return typeof section.indexScope === 'string' ? section.indexScope : ''
}

/**
 * The key of the session: what decides whether the client is built again.
 *
 * The scope root is part of it: a different scope means a different program,
 * so the client has to be built again with the new root - and the policy
 * belongs to it as well, because the policy is what decides the scope
 * (PRD-v5 §4.2).
 *
 * The "wanted" flag is part of it too: the session is built when there is
 * something to talk to, and given up when there is not. It changes when the
 * decision of the workbench changes - and that is exactly when the client
 * has to be built again or torn down.
 * @param {boolean} enabled whether the semantic features are on
 * @param {string} root the workspace root
 * @param {string} policy the index scope policy of the settings
 * @param {string} scopeRoot the scope root of the running client
 * @param {boolean} wanted whether the session wants a client at all
 * @returns {string} the key
 */
function sessionKeyOf(enabled, root, policy, scopeRoot, wanted = true) {
  return `${enabled}|${root}|${policy}|${scopeRoot}|${wanted ? '1' : '0'}`
}

/**
 * Whether the session wants a client for one root.
 *
 * Three things have to agree:
 *
 *   - the semantic features are switched on (the global switch);
 *   - there is a project;
 *   - the workbench wants an index for this project. The store owns that
 *     decision - it asked the user (PRD-v5 §2.3) - and a project the user
 *     put into the basic mode must not get a session: the host would never
 *     start a server for it, the handshake would wait for ever, and the
 *     session would end up reporting a failure for a decision that was made
 *     on purpose (review P1-2).
 *
 * The decision is NOT the host's state: the session is built BEFORE the
 * host starts the server - the handshake is held until the server exists.
 * A host that has no server yet is the normal state of the first second of
 * a session, not a reason to refuse one.
 * @param {any} store the store of the session
 * @param {string} root the project root
 * @returns {boolean}
 */
function sessionWanted(store, root) {
  if (store === null || store === undefined) return false
  const lspSettings = store.state?.settings?.lsp ?? null
  if (!sessionEnabled || lspSettings?.enabled === false) return false
  if (typeof root !== 'string' || root === '') return false
  return indexDecisionOf(store, root) !== 'conservative'
}

/**
 * Connect the client and open the socket.
 *
 * The `rootUri` of the `initialize` request is written into the configuration
 * of the client before the handshake goes out: the library reads it exactly
 * there.
 * @param {any} client the client of the session
 * @param {any} config the configuration of the client
 * @param {string} root the workspace root
 * @param {string} scopeRoot the scope root the program is built for
 */
function connectClient(client, config, root, scopeRoot) {
  config.rootUri = fileUriOf(scopeRoot)
  sessionScopeRoot = scopeRoot
  // The key follows the scope: the client that is running now is the one of
  // this scope, and a changed scope builds a new client.
  const lspSettings = sessionStore?.state?.settings?.lsp ?? null
  sessionKey = sessionKeyOf(
    sessionEnabled && lspSettings?.enabled !== false,
    root,
    indexScopePolicy(lspSettings),
    scopeRoot,
    sessionWanted(sessionStore, root),
  )
  // The handshake gets a SHORT budget: the server answers it in
  // milliseconds, and the long budget of the session belongs to the first
  // semantic request (the program build). The library reads `client.timeout`
  // when it CREATES a request, so the short window has to be in effect
  // before `connect()` - and the only request that is created in there is
  // the `initialize`.
  client.timeout = HANDSHAKE_TIMEOUT_MS
  client.connect(currentTransport)
  // The budget of the session is restored right away: every request that is
  // created from now on gets it. The semantic requests are created only
  // after `initializing` resolved (the library waits for it), so the short
  // window of the handshake cannot shorten one of them.
  applyRequestBudget(client)
  watchHandshake(client)
  // The client is connected now: the editors pick it up.
  bumpVersion()
  // The requests that waited for the connection may go.
  if (pendingConnection !== null && pendingConnection.client === client) pendingConnection.resolve()
}

/**
 * Connect the client with the scope root of the project.
 *
 * The scope root decides the program the language server builds, and the
 * `rootUri` of the `initialize` request is what tells the server which
 * project it is looking at - the working directory of its process does not
 * (PRD-v5 §4.2). The root is therefore written into the configuration of the
 * client *before* the handshake goes out: the host forwards the first
 * handshake to the language server and answers the later ones from its
 * cache, so only the first one decides the program.
 *
 * The promise never rejects: a host that does not answer leaves the
 * workspace root as the scope root, and the session starts anyway.
 * @param {any} client the client of the session
 * @param {any} config the configuration of the client
 * @param {string} root the workspace root
 */
async function connectWithScope(client, config, root) {
  const scopeRoot = await scopeRootFor(root)
  // The session may have ended - or moved to another project - while the
  // host was asked. A client that is not the current one is not connected.
  if (currentClient !== client) {
    // The requests that wait for the connection must not hang: the client
    // they belong to is gone.
    if (pendingConnection !== null && pendingConnection.client === client) {
      pendingConnection.resolve()
      pendingConnection = null
    }
    return
  }
  connectClient(client, config, root, scopeRoot)
}

/**
 * Start the session: create the client and open the socket.
 *
 * The client is created right away - the editors of the workbench ask for it
 * as soon as it exists - but the handshake waits for the scope root of the
 * project: the `initialize` request carries the `rootUri`, and the `rootUri`
 * decides the program the language server builds (PRD-v5 §4.2).
 */
function startLsp() {
  if (currentClient !== null) return
  const store = sessionStore
  if (store === null || store === undefined) return
  // The link is being built: the status bar says so, and it says "ready"
  // only when the handshake resolved.
  reportClientState('starting')
  redirectErrorsToToast()
  redirectMappingPositions()
  const root = typeof store.state?.root === 'string' ? store.state.root : ''
  // A new client is a new session: no semantic request has been answered
  // yet, so the first one gets the long budget.
  semanticAnswers = 0
  // The configuration of the client. The library reads the `rootUri` when it
  // creates the `initialize` request, so the scope root is written into this
  // object before the handshake goes out.
  const config = {
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
  }
  currentClient = new LSPClient(config)
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
    // The control events of the host (a degradation, a crash) are not
    // JSON-RPC messages: they belong to the store, which turns them into a
    // toast. The store may be gone and the method may not exist yet, so the
    // callback never throws.
    onControl: (event) => { store?.lspControl?.(event) },
  })
  // The requests that arrive before the client is connected wait for the
  // connection instead of failing with "Client not connected".
  let resolveConnection = () => {}
  const connection = new Promise(resolve => { resolveConnection = resolve })
  pendingConnection = { client: currentClient, promise: connection, resolve: resolveConnection }
  if (!hostIsReachable()) {
    // There is no host to ask: the workspace root is the scope root, and the
    // session starts right away.
    connectClient(currentClient, config, root, root)
    return
  }
  // The handshake waits for the scope root of the project.
  void connectWithScope(currentClient, config, root)
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
    () => {
      // A handshake of a session that has moved on does not count any more:
      // `disconnect()` replaces the promise, and the answer of the old
      // request belongs to a session that is already gone.
      if (client?.initializing !== handshake) return
      handshakeRetries = 0
      lastHandshakeError = ''
      // The budget of the session is back: the handshake is over, and every
      // request that is created from now on is a semantic one.
      applyRequestBudget(client)
      // The link works: the server answered, so its capabilities are known
      // and the semantic features may be used.
      reportClientState('ready')
    },
    (error) => {
      // The same rule for the failure: the timeout of the request of a
      // session that was replaced must not schedule a retry for it.
      if (client?.initializing !== handshake) return
      const message = failureMessage(error)
      lastHandshakeError = message
      console.warn('[lsp] the handshake failed:', message)
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
    console.warn('[lsp] the handshake keeps failing; the session is dead - reconnect it from the status bar')
    // The session is dead, and the user has to know it: the status bar
    // believed the host and said "ready" while every semantic request was
    // dead. The console line alone left the user with no way out.
    //
    // The status bar decides how loud this is: a host that has no language
    // server at all cannot have a dead session, and its own wording ("no
    // language server") is the truth there (review P1-2).
    reportClientState('failed', lastHandshakeError)
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
    // build its program again, so its first semantic request needs the long
    // budget again. The budget itself is written into the client when the
    // NEXT request is created (the library reads `client.timeout` exactly
    // there).
    resetLspHealth()
    // The handshake gets the short budget again: the answer of the server
    // comes in milliseconds, and the long budget belongs to the semantic
    // requests (the program build).
    currentClient.timeout = HANDSHAKE_TIMEOUT_MS
    currentClient.connect(currentTransport)
    // The budget of the session is restored right away (see `connectClient`).
    applyRequestBudget(currentClient)
    // The new handshake has to be watched as well: a session whose handshake
    // failed has to be able to try again.
    watchHandshake(currentClient)
    // The link is built again: the status bar says so while it lasts.
    reportClientState('starting')
  } catch (error) {
    console.warn('[lsp] the handshake could not be repeated:', error instanceof Error ? error.message : error)
  }
}

/**
 * Reconnect the client session - the way out of a dead one.
 *
 * The handshake is repeated, so the client gets the capabilities of the
 * server again. The retry budget starts over: the user asked for a new
 * attempt, and the failures of the old one must not end this one at once.
 *
 * A project the workbench does not want to index is left alone: the user
 * said no, and a reconnect must not start the very server the decision
 * refused (review P1-2).
 * @returns {void}
 */
export function reconnectLsp() {
  const root = typeof sessionStore?.state?.root === 'string' ? sessionStore.state.root : ''
  if (indexDecisionOf(sessionStore, root) === 'conservative') {
    console.warn('[lsp] the reconnect was refused: this project stays in the basic mode')
    return
  }
  handshakeRetries = 0
  lastHandshakeError = ''
  reportClientState('starting')
  try {
    if (currentClient === null) {
      // There is no client yet: the session has to be built first.
      startLsp()
      return
    }
    reinitializeLsp()
  } catch (error) {
    console.warn('[lsp] the session could not be reconnected:', error instanceof Error ? error.message : error)
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
  // The requests that wait for the connection may go: the session is over.
  if (pendingConnection !== null) {
    pendingConnection.resolve()
    pendingConnection = null
  }
  // The health belongs to the running session: when it ends, the failures
  // of the old server say nothing about the next one. The answered semantic
  // requests go with it - the next session starts with a server that has to
  // build its program again.
  resetLspHealth()
  // The session is over: there is no link any more, so the status bar must
  // not keep saying that the session is ready. The next session reports
  // "starting" again when it is built.
  reportClientState('starting')
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
  // The decision of the workbench about this project: does it get an index?
  // The store owns it (it asked the user, PRD-v5 §2.3), and the session has
  // to follow it - a session for a project the user put into the basic mode
  // waits for a server that will never come, and its handshake ends in a
  // failure report for a decision that was made on purpose.
  const decision = indexDecisionOf(store, root)
  // Without a project there is no language server to talk to, and a project
  // the workbench does not want to index gets no session at all.
  const wanted = sessionWanted(store, root)
  const policy = indexScopePolicy(lspSettings)
  // The scope root belongs to the project: another project has another scope,
  // and the host is asked for it again.
  if (sessionRoot !== root) sessionScopeRoot = ''
  // The scope root is part of the key: the program of the language server is
  // built for the scope, and a different scope needs a different client
  // (PRD-v5 §4.2). The policy belongs to the key as well - it is what
  // decides the scope. The "wanted" flag belongs to it too: the session is
  // built when there is something to talk to and given up when there is not.
  const key = sessionKeyOf(enabled, root, policy, sessionScopeRoot, wanted)
  if (key === sessionKey) return
  const hadClient = currentClient !== null
  // The root of the client that is running now: it is the project whose
  // language server has to be stopped.
  const previousRoot = sessionRoot
  // The scope root of the client that is running is kept until the host
  // answers for the new one: the key must not move on its own, or every poll
  // of the store would build a new client.
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
    // The session is over: the language server of the host has to die now
    // and not after its ten minute idle timeout (SET-01). The call happens
    // before the socket is closed, so the host learns about it while the
    // session is still alive.
    //
    // The one case in which the server stays: the session was given up
    // because the HOST released the server (the idle timeout, a crash) -
    // the host knows that already, and shutting it down again would be
    // pointless. Another project, a switched-off feature and a project the
    // user put into the basic mode all end the server of the old root.
    if (previousRoot !== root || !enabled || decision === 'conservative') {
      shutdownHostLsp(previousRoot)
    }
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
  // The scope root belongs to the client of the previous store: the new one
  // asks the host again.
  sessionScopeRoot = ''
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
 *
 * The reason why the semantic entries are greyed out belongs to the state of
 * the client session: while the session is not ready, the feature is missing
 * for a different reason than a server that does not support it - and the
 * old text was a lie in that case (it said that the server does not support
 * the feature while the session was dead).
 * @returns {{goToDefinition: string, findUsages: string, findUsagesText: string, semanticUnavailable: string}} the labels
 */
export function navLabels() {
  const unavailable = clientSessionState === 'ready'
    ? translate('nav.semanticUnavailable')
    : translate('nav.semanticSessionUnavailable')
  return {
    goToDefinition: translate('nav.goToDefinition'),
    findUsages: translate('nav.findUsages'),
    findUsagesText: translate('nav.findUsagesText'),
    semanticUnavailable: unavailable,
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
