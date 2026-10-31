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
 *    search for usages).
 * 2. **The library's own keymaps are not used.** `languageServerExtensions()`
 *    would install `renameKeymap` (F2) and `formatKeymap` (Shift-Alt-f),
 *    both of which the workbench already uses for other things
 *    (PRD §0.2 #6). The extensions are therefore assembled by hand.
 * 3. **The request timeout is raised.** The library defaults to 3000 ms,
 *    which silently times out on a large project; the setting
 *    `lsp.requestTimeoutMs` (30000 by default) is used instead.
 * 4. **The HTML of a hover is sanitized.** The server's Markdown may contain
 *    arbitrary HTML, so `sanitizeHTML` is part of the client configuration.
 */
import { LSPClient, hoverTooltips, serverCompletion, signatureHelp } from '@codemirror/lsp-client'
import { wsUrl } from './api.js'
import { sanitizeHTML } from './lsp-sanitize.js'
import { createLspTransport } from './lsp-transport.js'
import { fileUriOf, languageIdForPath } from './lsp-uri.js'
import { WorkbenchWorkspace } from './lsp-workspace.js'

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
  const root = typeof store.state?.root === 'string' ? store.state.root : ''
  currentClient = new LSPClient({
    rootUri: fileUriOf(root),
    timeout: requestTimeoutOf(store),
    sanitizeHTML,
    workspace: client => new WorkbenchWorkspace(client, store, { viewRegistry }),
    // The editor extensions are added by `lspExtensions()` instead, so that
    // the workbench can keep them out of the editors that have no client.
    extensions: [],
  })
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
  bumpVersion()
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
    currentClient.connect(currentTransport)
  } catch (error) {
    console.warn('[lsp] the handshake could not be repeated:', error instanceof Error ? error.message : error)
  }
}

/** Drop the client and close the socket. */
function stopLsp() {
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
  currentTransport = null
  bumpVersion()
}

/** Apply the current settings to the session. */
function refreshLsp() {
  const store = sessionStore
  if (store === null || store === undefined) {
    if (sessionKey !== null) {
      sessionKey = null
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
  sessionKey = key
  if (wanted) {
    // A different project means a different server: the old client is
    // closed first, so its socket cannot outlive the project.
    if (hadClient) stopLsp()
    startLsp(store)
  } else if (hadClient) {
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
  if (typeof store?.subscribe === 'function') {
    // The settings and the project root arrive after the store was created,
    // so the session follows the state of the store.
    unsubscribeStore = store.subscribe(() => refreshLsp())
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
