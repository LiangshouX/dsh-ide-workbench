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
import { pathOfFileUri } from './lsp-uri.js'
import { isPathWithin, normalizeScopePath } from './workspace-scope.js'

/** How long `displayFile` waits for the editor of a freshly opened file. */
const VIEW_WAIT_MS = 5000

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
