/**
 * The workbench's LSP workspace (PRD-v5 §3.4 / LSP-03 / LSP-04).
 *
 * `@codemirror/lsp-client` asks the host of the editor for five things, and
 * this class is that host. The default workspace of the library only knows
 * about files that have an editor, and it reads the editor's document - but
 * the workbench has a second source of truth: the tab draft. A user who
 * types a new symbol and does not save it must still see that symbol in the
 * completion list and in the reference list, so the *draft* is what the
 * language server has to see, never the file on disk (PRD risk #7).
 *
 * The other half of the job is the fence: a language server may answer with
 * a path outside the project. Such a path is never opened and never read;
 * `displayFile` returns `null` and the user gets a toast.
 *
 * A third job was added later (PRD-v5 §3.2, USAGE-01): the library asks the
 * workspace for the file of *every* reference it got, and its own answer
 * only knows the files that have an editor. Every reference in a file that
 * is not open was therefore dropped, and "find usages" was almost always
 * empty. `requestFile` reads those files from the disk (through the host's
 * `fs.read`, so the fence of the host applies) and answers with a document
 * that has no editor - no tab is opened for it.
 *
 * Dependencies on the store (kept defensive so the module can be unit tested
 * with a small fake):
 *
 * - `store.state.root` - the current project root, the fence of the workspace.
 * - `store.state.tabs` - the open tabs; a file tab carries `path`, `draft`
 *   (the unsaved buffer), `content` (the disk buffer) and `dirty`.
 * - `store.openFile(path, options)` - opens (or reuses) a tab.
 * - `store.toast(kind, text, detail)` - the transient notification.
 * - `store.t(key)` - the translation helper.
 */
import { ChangeSet, Text } from '@codemirror/state'
import { Workspace } from '@codemirror/lsp-client'
import { call } from './api.js'
import { languageIdForPath, pathOfFileUri } from './lsp-uri.js'
import { isPathWithin, normalizeScopePath } from './workspace-scope.js'

/** How long `displayFile` waits for the editor of a freshly opened file. */
const VIEW_WAIT_MS = 5000

/**
 * How many files the workspace keeps in the request cache.
 *
 * One "find usages" can touch dozens of files, and every one of them has to
 * be read from the disk. The cache holds the files of the current find
 * cycle, so a file with many hits is read only once; the cap keeps the
 * memory of a huge project bounded.
 */
const REQUEST_CACHE_LIMIT = 64

/**
 * Split a text into lines, keeping the line break at the end of each line.
 * @param {string} text the text
 * @returns {string[]} the lines
 */
function splitLines(text) {
  const lines = []
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      lines.push(text.slice(start, index + 1))
      start = index + 1
    }
  }
  if (start < text.length) lines.push(text.slice(start))
  return lines
}

/**
 * The character offset of every line start.
 * @param {string[]} lines the lines
 * @returns {number[]} the offsets, one longer than the line list
 */
function lineOffsets(lines) {
  const offsets = [0]
  let total = 0
  for (const line of lines) {
    total += line.length
    offsets.push(total)
  }
  return offsets
}

/**
 * The longest common subsequence of two line lists, as index pairs.
 * @param {string[]} a the first list
 * @param {string[]} b the second list
 * @returns {Array<[number, number]> | null} the pairs, or `null` when the
 *   inputs are too large for the quadratic table
 */
function lcsMatches(a, b) {
  const n = a.length
  const m = b.length
  if (n === 0 || m === 0) return []
  // A quadratic table over huge files would cost more than it saves; the
  // caller falls back to one wide replacement in that case.
  if (n * m > 250000) return null
  const width = m + 1
  const table = new Int32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[i] === b[j]
        ? table[(i + 1) * width + (j + 1)] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + (j + 1)])
    }
  }
  const matches = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      matches.push([i, j])
      i += 1
      j += 1
    } else if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) {
      i += 1
    } else {
      j += 1
    }
  }
  return matches
}

/**
 * One replacement of a region, reduced to its common prefix and suffix.
 *
 * The reduction matters twice: the server receives a small range update
 * instead of a whole-line rewrite, and the position mapping of the library
 * (PRD §3.5) can still map an old position onto the new document.
 * @param {number} from the offset of the region in the old document
 * @param {string} oldText the old text of the region
 * @param {string} newText the new text of the region
 * @returns {{from: number, to: number, insert: string}} the change
 */
function regionChange(from, oldText, newText) {
  let prefix = 0
  const maxPrefix = Math.min(oldText.length, newText.length)
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix += 1
  let suffix = 0
  const maxSuffix = Math.min(oldText.length - prefix, newText.length - prefix)
  while (suffix < maxSuffix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) suffix += 1
  return {
    from: from + prefix,
    to: from + prefix + (oldText.length - suffix - prefix),
    insert: newText.slice(prefix, newText.length - suffix),
  }
}

/**
 * The incremental change set that turns one text into another.
 *
 * The comparison is line based, so two edits in two places produce two
 * changes instead of one rewrite of everything between them. Inside a
 * changed region the change is reduced to its common prefix and suffix, so
 * the language server receives a small range update - and the position
 * mapping of the library stays exact.
 * @param {string} previous the text before the edit
 * @param {string} next the text after the edit
 * @returns {import('@codemirror/state').ChangeSet} the change set
 */
export function computeChanges(previous, next) {
  if (previous === next) return ChangeSet.empty(previous.length)
  if (previous === '') return ChangeSet.of([{ from: 0, to: 0, insert: next }], 0)
  if (next === '') return ChangeSet.of([{ from: 0, to: previous.length, insert: '' }], previous.length)
  const before = splitLines(previous)
  const after = splitLines(next)
  const offsets = lineOffsets(before)
  const matches = lcsMatches(before, after)
  if (matches === null) {
    return ChangeSet.of([regionChange(0, previous, next)], previous.length)
  }
  const specs = []
  let beforeIndex = 0
  let afterIndex = 0
  const pushRegion = (toLine, toAfterLine) => {
    const oldText = before.slice(beforeIndex, toLine).join('')
    const newText = after.slice(afterIndex, toAfterLine).join('')
    if (oldText === newText) return
    specs.push(regionChange(offsets[beforeIndex], oldText, newText))
  }
  for (const [matchBefore, matchAfter] of matches) {
    if (matchBefore > beforeIndex || matchAfter > afterIndex) {
      pushRegion(matchBefore, matchAfter)
    }
    beforeIndex = matchBefore + 1
    afterIndex = matchAfter + 1
  }
  if (beforeIndex < before.length || afterIndex < after.length) {
    pushRegion(before.length, after.length)
  }
  return ChangeSet.of(specs, previous.length)
}

/**
 * The `Text` of one document.
 *
 * `Text.of` takes the *lines* of a document, not the document itself - a
 * string with line breaks in it would become one very long line, and every
 * position of the protocol would be wrong.
 * @param {string} content the content of the document
 * @returns {import('@codemirror/state').Text} the text
 */
function textOf(content) {
  return Text.of(String(content ?? '').split('\n'))
}

/**
 * The workbench workspace of the LSP client.
 *
 * It maps the workbench tabs onto the documents of the language server and
 * enforces the workspace fence.
 */
export class WorkbenchWorkspace extends Workspace {
  /**
   * @param {import('@codemirror/lsp-client').LSPClient} client the client
   * @param {any} store the workbench store
   * @param {{viewRegistry?: {waitForEditorView?: (uri: string, timeoutMs?: number) => Promise<any>}}} [options]
   */
  constructor(client, store, options = {}) {
    super(client)
    this.store = store
    this.options = options
    this.viewRegistry = options.viewRegistry ?? null
    /** @type {Array<any>} the documents the server knows about */
    this.files = []
    /** @type {Map<string, any>} the files that were read for the references */
    this.requestCache = new Map()
  }

  /**
   * The tab of one absolute path, when the workbench has it open.
   *
   * The paths are compared in their normalized form: the workbench spells a
   * path with the separator of the project root, while the LSP URI always
   * uses slashes - and on Windows the case does not matter either.
   * @param {string} absolute the absolute path
   * @returns {any} the tab, or `undefined`
   */
  tabFor(absolute) {
    const tabs = this.store?.state?.tabs
    if (!Array.isArray(tabs)) return undefined
    const wanted = normalizeScopePath(absolute)
    if (wanted === '') return undefined
    return tabs.find(tab => {
      if (tab?.kind !== 'file' || typeof tab.path !== 'string') return false
      return normalizeScopePath(tab.path) === wanted
    })
  }

  /**
   * The current content of one document.
   *
   * The editor is the freshest source: the user may have typed a character
   * that React has not turned into a tab draft yet. When no editor is
   * available the tab is used, and there the *draft* wins over the disk
   * content - an unsaved symbol must be visible to the language server.
   * @param {string} uri the document URI
   * @param {any} [view] the editor, when there is one
   * @returns {string} the content
   */
  contentOf(uri, view = null) {
    if (view !== null && view !== undefined && typeof view.state?.doc?.toString === 'function') {
      return view.state.doc.toString()
    }
    const absolute = pathOfFileUri(uri)
    if (absolute === null) return ''
    const tab = this.tabFor(absolute)
    if (tab === undefined) return ''
    if (tab.dirty === true) return tab.draft ?? tab.content ?? ''
    return tab.content ?? ''
  }

  /**
   * The editor that shows one document, when the workbench has one.
   * @param {string} uri the document URI
   * @returns {any} the editor, or `null`
   */
  viewOf(uri) {
    const file = this.getFile(uri)
    if (file !== null && file !== undefined) {
      const view = file.getView()
      if (view !== null && view !== undefined) return view
    }
    if (this.viewRegistry !== null && typeof this.viewRegistry.get === 'function') {
      const view = this.viewRegistry.get(uri)
      if (view !== null && view !== undefined) return view
    }
    return null
  }

  /**
   * Open one document with the server.
   *
   * The content that is announced is the editor buffer (the draft), never the
   * file on disk.
   * @param {string} uri the document URI
   * @param {string} languageId the LSP language id
   * @param {any} view the editor
   */
  openFile(uri, languageId, view) {
    const existing = this.getFile(uri)
    if (existing !== null && existing !== undefined) {
      existing.languageId = languageId
      existing.view = view
      return
    }
    const content = this.contentOf(uri, view)
    const file = {
      uri,
      languageId,
      version: 1,
      doc: textOf(content),
      view,
      /** @returns {any} the editor that shows this document */
      getView() {
        return this.view ?? null
      },
    }
    this.files.push(file)
    this.client.didOpen(file)
  }

  /**
   * The file of one URI, whether or not it is open in an editor.
   *
   * The library's own answer only knows the files that have an editor, and
   * `findReferences` drops every reference whose file is not in that list -
   * which is why the usages of a symbol, which usually live in other files,
   * were almost never shown. This method reads the missing files from the
   * disk instead.
   *
   * Three rules keep the method harmless:
   *
   * 1. **No tab is opened.** The file is only needed to render the context
   *    of a reference row; opening it would turn one search into a batch of
   *    opened files.
   * 2. **The fence holds.** A path outside the project is not read and does
   *    not even produce a toast - one search may touch dozens of files, and
   *    dozens of toasts would bury the panel.
   * 3. **The file is cached.** One search reads the same file again for
   *    every reference in it.
   * @param {string} uri the document URI
   * @returns {Promise<any>} the file, or `null` when it cannot be read
   */
  async requestFile(uri) {
    const existing = this.getFile(uri)
    if (existing !== null && existing !== undefined) return existing
    const cached = this.requestCache.get(uri)
    if (cached !== undefined) return cached
    const absolute = pathOfFileUri(uri)
    if (absolute === null) return null
    if (!this.insideRoot(absolute)) return null
    const content = await this.readFileContent(absolute)
    if (content === null) return null
    const file = {
      uri,
      languageId: languageIdForPath(absolute),
      version: 1,
      doc: textOf(content),
      /** @returns {any} the editor - there is none, the file is only read */
      getView() {
        return null
      },
    }
    this.rememberRequest(file)
    return file
  }

  /**
   * The content of one file on disk, read through the host.
   *
   * The host route `fs.read` resolves the path inside the project root, so
   * the fence of the host applies a second time - the client never builds a
   * path of its own.
   * @param {string} absolute the absolute path
   * @returns {Promise<string | null>} the content, or `null` when the file
   *   cannot be read
   */
  async readFileContent(absolute) {
    const root = this.store?.state?.root
    if (typeof root !== 'string' || root === '') return null
    let result = null
    try {
      result = await call('fs.read', { root, path: absolute })
    } catch (error) {
      console.warn('[lsp] the file could not be read:', absolute, error instanceof Error ? error.message : error)
      return null
    }
    if (result === null || typeof result !== 'object') return null
    // A binary or an image has no text to show.
    if (result.kind !== 'text') return null
    return typeof result.content === 'string' ? result.content : ''
  }

  /**
   * Remember one requested file, dropping the oldest one when the cache is
   * full.
   * @param {any} file the file
   */
  rememberRequest(file) {
    this.requestCache.set(file.uri, file)
    while (this.requestCache.size > REQUEST_CACHE_LIMIT) {
      const oldest = this.requestCache.keys().next()
      if (oldest.done === true) break
      this.requestCache.delete(oldest.value)
    }
  }

  /**
   * Forget the files that were read for the last find cycle.
   *
   * The session calls this when a new reference request starts, so that
   * every search reads the files of the project as they are *now*.
   */
  clearRequestCache() {
    this.requestCache.clear()
  }

  /**
   * The document of one URI, when the workspace knows it.
   *
   * The library maps the positions of a reference with the workspace
   * mapping it created when the search started; that mapping only knows the
   * documents that were open at that moment. This method gives the mapping
   * the document of a file that was read for the panel.
   * @param {string} uri the document URI
   * @returns {any} the document, or `null` when the URI is unknown
   */
  documentFor(uri) {
    const open = this.getFile(uri)
    if (open !== null && open !== undefined) return open.doc ?? null
    const requested = this.requestCache.get(uri)
    if (requested !== undefined) return requested.doc ?? null
    return null
  }

  /**
   * Push the pending edits of every open document to the server.
   *
   * Only the documents that actually changed are reported, and the change is
   * incremental.
   * @returns {Array<any>} the updates
   */
  syncFiles() {
    const updates = []
    for (const file of this.files) {
      const view = file.getView()
      const next = this.contentOf(file.uri, view)
      const previous = file.doc.toString()
      if (next === previous) continue
      const changes = computeChanges(previous, next)
      const prevDoc = file.doc
      file.doc = textOf(next)
      file.version += 1
      updates.push({ file, prevDoc, changes })
    }
    return updates
  }

  /**
   * Whether one path is inside the current project.
   * @param {string} absolute the absolute path
   * @returns {boolean} true when the path may be opened
   */
  insideRoot(absolute) {
    const root = this.store?.state?.root
    if (typeof root !== 'string' || root === '') return false
    return isPathWithin(root, absolute)
  }

  /**
   * Tell the user that a path is outside the project.
   * @param {string} absolute the absolute path
   */
  notifyOutside(absolute) {
    const store = this.store
    if (store === null || store === undefined) return
    const text = typeof store.t === 'function' ? store.t('lsp.outsideProject') : 'lsp.outsideProject'
    if (typeof store.toast === 'function') {
      try {
        store.toast('error', text, absolute)
      } catch {
        /* a broken toast must not break the jump */
      }
    }
  }

  /**
   * Show another document to the user.
   *
   * A path outside the project is refused: it is neither opened nor read.
   * @param {string} uri the document URI
   * @returns {Promise<any>} the editor, or `null` when it cannot be shown
   */
  async displayFile(uri) {
    const absolute = pathOfFileUri(uri)
    if (absolute === null) return null
    if (!this.insideRoot(absolute)) {
      this.notifyOutside(absolute)
      return null
    }
    const store = this.store
    if (store === null || store === undefined || typeof store.openFile !== 'function') return null
    try {
      // No reveal line is passed on purpose: the library dispatches the exact
      // target position into the editor it gets back, and a reveal line would
      // move the cursor away from it right after.
      store.openFile(absolute, { preview: false })
    } catch (error) {
      this.notifyOutside(absolute)
      return null
    }
    const registry = this.viewRegistry
    if (registry === null || registry === undefined) return null
    if (typeof registry.waitForEditorView === 'function') {
      try {
        return await registry.waitForEditorView(uri, VIEW_WAIT_MS)
      } catch {
        return null
      }
    }
    if (typeof registry.get === 'function') return registry.get(uri) ?? null
    return null
  }

  /**
   * The connection to the server is live.
   *
   * The default implementation of the library re-opens every document here.
   * That is wrong for a *re*connection: the language server still knows the
   * documents, and a second `didOpen` for the same URI breaks the protocol.
   * The documents are opened by `openFile()` - the editor plugin calls it as
   * soon as the plugin extension exists - and the host re-opens them itself
   * after a crash restart.
   */
  connected() {
    // Nothing to do: the open documents are already announced.
  }

  /**
   * Apply a server initiated change to one document.
   * @param {string} uri the document URI
   * @param {any} transaction the transaction
   */
  updateFile(uri, transaction) {
    const file = this.getFile(uri)
    if (file === null || file === undefined) return
    const view = file.getView()
    if (view === null || view === undefined) return
    try {
      view.dispatch(transaction)
    } catch {
      /* the editor may already be gone */
    }
  }

  /**
   * Close one document with the server.
   * @param {string} uri the document URI
   */
  closeFile(uri) {
    const index = this.files.findIndex(file => file.uri === uri)
    if (index < 0) return
    this.files.splice(index, 1)
    this.client.didClose(uri)
  }
}
