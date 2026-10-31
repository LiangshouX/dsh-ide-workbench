/**
 * The code surface (CodeMirror 6), used for both editing and read-only
 * viewing.
 *
 * A read-only CodeMirror still supports native selection, Ctrl+A and Ctrl+C,
 * which is exactly the baseline a code viewer must provide. The document is
 * seeded from the tab's draft; every change flows back through `onChange`.
 * The FindBar gets a small imperative controller instead of CodeMirror's
 * English default panel.
 *
 * This round adds the code-intelligence features of PRD-v5:
 *
 * - the local completion of `@codemirror/autocomplete` (COMP-01), which
 *   works in every language without a language server;
 * - the semantic extensions of the LSP session (COMP-02, NAV-02, NAV-04),
 *   which are only installed when a client exists;
 * - Ctrl+click and F12 to jump to a definition (NAV-01);
 * - Alt+F7 for the semantic usages and Alt+F8 for the text usages (NAV-02,
 *   NAV-03);
 * - a column precise reveal, so a jump lands on the column and not only on
 *   the line (NAV-05).
 *
 * Two shortcuts of the language-server library are deliberately *not*
 * installed: `renameKeymap` (F2) and `formatKeymap` (Shift-Alt-f) would
 * collide with the workbench shortcuts (PRD §0.2 #6).
 */
import React, { useEffect, useRef, useState } from 'react'
import { EditorState, Compartment, StateEffect, StateField } from '@codemirror/state'
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars, Decoration,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, startCompletion,
} from '@codemirror/autocomplete'
import { SearchQuery, setSearchQuery, search } from '@codemirror/search'
import { bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle, syntaxTree } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { java } from '@codemirror/lang-java'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { sql } from '@codemirror/lang-sql'
import { yaml } from '@codemirror/lang-yaml'
import { xml } from '@codemirror/lang-xml'
import { cpp } from '@codemirror/lang-cpp'
import { go } from '@codemirror/lang-go'
import { rust } from '@codemirror/lang-rust'
import { findReferences, jumpToDefinition, LSPPlugin } from '@codemirror/lsp-client'
import { findMatches, replaceAllMatches } from './find.js'
import { fileUriOf } from './lsp-uri.js'
import {
  findUsagesText as runTextUsageSearch,
  keymapKeyFor,
  lspClient,
  lspExtensions,
  lspPluginExtension,
  lspSessionVersion,
  navLabels,
  onLspSessionChange,
  registerEditorView,
  semanticDefinitionAvailable,
  semanticUsagesAvailable,
  shortcutFor,
  unregisterEditorView,
} from './lsp-session.js'
import { ContextMenu } from './ui.jsx'

/**
 * The node names that stand for an identifier.
 *
 * A Ctrl+click may only trigger on one of them: on whitespace, on
 * punctuation, on a comment or inside a string it must do nothing
 * (PRD §5.1). The first group is the list of the specification, the second
 * group holds the names the bundled grammars really produce - a JavaScript
 * variable is a `VariableDefinition`, a Java method a `MethodName`, and so
 * on.
 */
const IDENTIFIER_NODE_NAMES = new Set([
  'Name', 'VariableName', 'FunctionName', 'PropertyName', 'ClassName',
  'TypeName', 'LabelName', 'TagName', 'AttributeName', 'Identifier',
  'VariableDefinition', 'PrivatePropertyName', 'JSXIdentifier', 'MethodName',
  'ScopedIdentifier', 'FieldName', 'DefName', 'TypeIdentifier', 'FieldIdentifier',
  'ScopeIdentifier', 'IdName', 'PseudoClassName', 'NamespaceName', 'Label',
])

/**
 * The compartment that holds the semantic extensions.
 *
 * The language server may appear (or disappear) while an editor is open - the
 * settings arrive late, the server is restarted - so the extensions live in
 * a compartment that can be reconfigured without rebuilding the document.
 */
const lspCompartment = new Compartment()

/** Language extension for one file path (empty = plain text). */
export function languageForPath(path) {
  const lower = String(path ?? '').toLowerCase()
  const dot = lower.lastIndexOf('.')
  const ext = dot < 0 ? '' : lower.slice(dot)
  switch (ext) {
    case '.js': case '.mjs': case '.cjs': return javascript()
    case '.jsx': return javascript({ jsx: true })
    case '.ts': case '.mts': case '.cts': return javascript({ typescript: true })
    case '.tsx': return javascript({ typescript: true, jsx: true })
    case '.json': case '.jsonc': case '.json5': return json()
    case '.md': case '.markdown': case '.mdx': return markdown()
    case '.py': case '.pyw': case '.pyi': return python()
    case '.java': return java()
    case '.css': case '.scss': case '.less': return css()
    case '.html': case '.htm': case '.vue': case '.svelte': return html()
    case '.sql': return sql()
    case '.yml': case '.yaml': return yaml()
    case '.xml': case '.svg': case '.xsl': case '.xsd': return xml()
    case '.c': case '.h': case '.cpp': case '.cc': case '.cxx': case '.hpp': case '.hh': return cpp()
    case '.go': return go()
    case '.rs': return rust()
    default: return []
  }
}

const HIGHLIGHT = HighlightStyle.define([
  { tag: tags.comment, color: '#7a8596', fontStyle: 'italic' },
  { tag: [tags.string, tags.special(tags.string)], color: '#5f8f3f' },
  { tag: [tags.keyword, tags.modifier], color: '#a15fb0' },
  { tag: [tags.number, tags.bool, tags.null], color: '#b57a2a' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: '#2f8f83' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#8a6a1f' },
  { tag: [tags.propertyName, tags.attributeName], color: '#3f6f9f' },
  { tag: [tags.tagName, tags.angleBracket], color: '#c05a63' },
  { tag: tags.heading, color: '#3b7dd8', fontWeight: 'bold' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, color: '#3b7dd8', textDecoration: 'underline' },
  { tag: tags.invalid, color: '#e2686f' },
])

const THEME = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--iwb-bg)', color: 'var(--iwb-fg)' },
  '.cm-scroller': { fontFamily: 'var(--iwb-mono)', fontSize: '13px', lineHeight: '1.6', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--iwb-accent)', padding: '10px 0' },
  '.cm-line': { padding: '0 14px 0 6px' },
  '.cm-gutters': {
    backgroundColor: 'var(--iwb-bg)',
    color: 'var(--iwb-muted)',
    border: 'none',
    borderRight: '1px solid var(--iwb-border)',
    paddingLeft: '6px',
    userSelect: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '34px', padding: '0 8px 0 4px' },
  '.cm-activeLine': { backgroundColor: 'rgba(127,127,127,.075)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--iwb-fg)' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(76,154,255,.24) !important' },
  '.cm-matchingBracket': { backgroundColor: 'rgba(76,154,255,.25)', outline: '1px solid rgba(76,154,255,.5)' },
  '.cm-searchMatch': { backgroundColor: 'rgba(215,162,74,.28)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(76,154,255,.45)', outline: '1px solid var(--iwb-accent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--iwb-accent)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-panels': { backgroundColor: 'var(--iwb-panel)', color: 'var(--iwb-fg)' },
  // The tooltips (completion, hover, signature) are themed in styles.js: one
  // stylesheet owns them, so the library's own light/dark rules cannot win a
  // precedence fight against a second set of rules here.
}, { dark: true })

function selectionOf(view, match) {
  return { anchor: match.from, head: match.to }
}

/**
 * The CodeMirror keymap of the editor buffer.
 *
 * The global Find in Files view is reachable by shortcut only: `Ctrl+Shift+R`
 * (the document area intercepts it in the capture phase) and the
 * `Ctrl+Alt+F` fallback alias. The legacy `Ctrl+Shift+F` combo must never
 * open the global view: the document area does not match it, so the event
 * would sink into the buffer and hit the keymap below - which is exactly
 * how it used to slip through. It is therefore not bound here.
 *
 * Exported so the bindings can be checked without a browser.
 * @param {{onSaveRef: object, onFindRef: object, onFindInFilesRef: object, readOnly: boolean}} refs
 * @returns {Array<{key: string, run: Function}>} the keymap entries
 */
export function editorKeymap({ onSaveRef, onFindRef, onFindInFilesRef, readOnly }) {
  return [
    { key: 'Mod-s', run: () => { if (readOnly !== true) onSaveRef.current(); return true } },
    { key: 'Mod-f', run: () => { onFindRef.current?.(); return true } },
    { key: 'Mod-Alt-f', run: () => { onFindInFilesRef.current?.(); return true } },
  ]
}

/**
 * The local completion extensions (COMP-01).
 *
 * `icons: false` keeps the popup free of the icon set of the library - the
 * workbench draws its own markers with plain CSS characters.
 * @returns {Array<any>} the extensions
 */
export function completionExtensions() {
  return [
    autocompletion({ activateOnTyping: true, icons: false }),
    closeBrackets(),
  ]
}

/**
 * The navigation keymap of the editor (NAV-01, NAV-02, NAV-03).
 *
 * The keys come from the settings (`goToDefinition`, `findUsages`,
 * `findUsagesText`, `complete`), so a user can move them. The semantic
 * usages are bound to `Alt+F7` and not to the `Shift+F12` of the library -
 * `Shift+F12` is already used by the workbench (`Ctrl+Shift+F12` hides all
 * the tool windows).
 * @returns {Array<{key: string, run: Function}>} the keymap entries
 */
export function navKeymap() {
  const entries = []
  const goToDefinition = keymapKeyFor('goToDefinition')
  if (goToDefinition !== '') entries.push({ key: goToDefinition, run: jumpToDefinition, preventDefault: true })
  const findUsages = keymapKeyFor('findUsages')
  if (findUsages !== '') entries.push({ key: findUsages, run: findReferences, preventDefault: true })
  const findUsagesText = keymapKeyFor('findUsagesText')
  if (findUsagesText !== '') entries.push({ key: findUsagesText, run: findUsagesTextCommand, preventDefault: true })
  const complete = keymapKeyFor('complete')
  if (complete !== '') entries.push({ key: complete, run: startCompletion, preventDefault: true })
  return entries
}

/**
 * The rest of the keymap of the editor buffer.
 *
 * The completion keymap has to come *before* the default keymap, otherwise
 * `Enter` and `Tab` would be swallowed by the default bindings and a
 * completion could not be accepted (PRD risk #14).
 * @returns {Array<any>} the keymap entries
 */
export function editorKeymapRest() {
  return [
    ...completionKeymap,
    ...closeBracketsKeymap,
    ...navKeymap(),
    ...defaultKeymap,
    ...historyKeymap,
    indentWithTab,
  ]
}

/**
 * The identifier at one position of a document.
 *
 * Only an identifier counts: on whitespace, on punctuation, on a comment or
 * inside a string the function answers `null`, so a Ctrl+click there does
 * nothing at all.
 * @param {any} state the editor state
 * @param {number} pos the document offset
 * @returns {string | null} the identifier, or `null`
 */
export function identifierAt(state, pos) {
  const range = identifierRangeAt(state, pos)
  return range === null ? null : state.doc.sliceString(range.from, range.to)
}

/**
 * The range of the identifier at one position.
 *
 * The Ctrl+hover hint needs the range, not only the text: the decoration is
 * put on exactly the word that a Ctrl+click would jump to.
 * @param {any} state the editor state
 * @param {number} pos the document offset
 * @returns {{from: number, to: number} | null} the range, or `null`
 */
export function identifierRangeAt(state, pos) {
  if (state === null || state === undefined) return null
  if (!Number.isInteger(pos) || pos < 0 || pos > state.doc.length) return null
  let node = null
  try {
    node = syntaxTree(state).resolveInner(pos, 1)
  } catch {
    return null
  }
  for (let depth = 0; node !== null && node !== undefined && depth < 3; depth += 1) {
    if (IDENTIFIER_NODE_NAMES.has(node.name)) {
      if (node.to <= node.from) return null
      return { from: node.from, to: node.to }
    }
    node = node.parent
  }
  return null
}

/**
 * The word around one position, whatever the language is.
 *
 * The text version of "find usages" has to work in a file without a grammar
 * too, so it uses the plain word characters instead of the syntax tree.
 * @param {any} state the editor state
 * @param {number} pos the document offset
 * @returns {string | null} the word, or `null`
 */
export function wordAtCursor(state, pos) {
  if (state === null || state === undefined) return null
  if (!Number.isInteger(pos) || pos < 0 || pos > state.doc.length) return null
  const line = state.doc.lineAt(pos)
  const text = line.text
  let start = Math.min(pos - line.from, text.length)
  let end = start
  while (start > 0 && /[\w$]/.test(text[start - 1])) start -= 1
  while (end < text.length && /[\w$]/.test(text[end])) end += 1
  if (end <= start) return null
  return text.slice(start, end)
}

/**
 * The command of the text version of "find usages" (NAV-03).
 * @param {any} view the editor
 * @returns {boolean} true when a word was found
 */
export function findUsagesTextCommand(view) {
  if (view === null || view === undefined) return false
  const word = wordAtCursor(view.state, view.state.selection.main.head)
  if (word === null) return false
  runTextUsageSearch(word)
  return true
}

/**
 * The Ctrl+click handler of the editor (NAV-01).
 *
 * CodeMirror 6 has no built-in "click to go to definition", so the handler
 * is added by hand. It only reacts on an identifier and only when the
 * modifier key is pressed; on a hit it prevents the default action, so the
 * mouse does not start a text selection at the same time (PRD risk #16).
 * @param {any} event the mouse event
 * @param {any} view the editor
 * @param {{trigger?: (view: any) => boolean, requirePlugin?: boolean}} [options]
 * @returns {boolean} true when the event was handled
 */
export function handleCtrlClick(event, view, options = {}) {
  if (event === null || event === undefined) return false
  if (!(event.ctrlKey === true || event.metaKey === true)) return false
  if (view === null || view === undefined) return false
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
  if (typeof pos !== 'number') return false
  if (identifierAt(view.state, pos) === null) return false
  // Without a language server there is nothing to jump to; the click keeps
  // its normal meaning (a selection), so the modifier drag still works.
  if (options.requirePlugin !== false && LSPPlugin.get(view) === null) return false
  event.preventDefault()
  view.dispatch({ selection: { anchor: pos } })
  const trigger = options.trigger ?? jumpToDefinition
  trigger(view)
  return true
}

/**
 * The mark of the symbol a Ctrl+click would jump to.
 *
 * JetBrains highlights the target *before* the click: holding the modifier
 * turns the identifier under the pointer blue and underlines it. The same
 * promise is made here, so the click has a visible target.
 */
const ctrlHoverMark = Decoration.mark({ class: 'iwb-ctrl-hover-symbol' })

/** Replaces the highlighted range while the modifier is held. */
export const setCtrlHover = StateEffect.define()

/**
 * The range of the symbol under the pointer, while Ctrl is held.
 *
 * A state field (and not a plugin-local value) so the decoration survives a
 * document edit and is mapped through it.
 */
export const ctrlHoverField = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (!effect.is(setCtrlHover)) continue
      const range = effect.value
      next = range === null
        ? Decoration.none
        : Decoration.set([ctrlHoverMark.range(range.from, range.to)])
    }
    return next
  },
  provide: field => EditorView.decorations.from(field),
})

/**
 * The range currently highlighted by the Ctrl+hover hint.
 * @param {any} state the editor state
 * @returns {{from: number, to: number} | null}
 */
export function currentCtrlHover(state) {
  const value = state.field(ctrlHoverField, false)
  if (value === undefined || value === null || value.size === 0) return null
  const first = value.iter()
  return { from: first.from, to: first.to }
}

/**
 * Highlight (or clear) the symbol the modifier points at.
 *
 * The dispatch only happens when the range really changes: a pointer that
 * moves inside one word must not push a transaction per pixel.
 * @param {any} view the editor
 * @param {{from: number, to: number} | null} range the wanted range
 */
function highlightCtrlHover(view, range) {
  if (view === null || view === undefined) return
  const current = currentCtrlHover(view.state)
  const same = (current === null && range === null)
    || (current !== null && range !== null && current.from === range.from && current.to === range.to)
  if (same) return
  try {
    view.dispatch({ effects: setCtrlHover.of(range) })
  } catch {
    /* the editor may already be gone */
  }
}

/**
 * The range the modifier points at, with the current pointer position.
 * @param {any} view the editor
 * @param {{x: number, y: number} | null} pointer the last known pointer
 * @returns {{from: number, to: number} | null}
 */
function ctrlHoverRangeAt(view, pointer) {
  if (pointer === null) return null
  const pos = view.posAtCoords({ x: pointer.x, y: pointer.y })
  if (typeof pos !== 'number') return null
  return identifierRangeAt(view.state, pos)
}

/**
 * The position of one line and column inside a document.
 *
 * The column is 1-based, like the column the status bar shows.
 * @param {any} state the editor state
 * @param {number} line the 1-based line
 * @param {number | null} column the 1-based column, or `null`
 * @returns {number | null} the document offset
 */
export function revealPosition(state, line, column) {
  if (!Number.isInteger(line) || line <= 0) return null
  const doc = state.doc
  const target = doc.line(Math.min(line, doc.lines))
  if (!Number.isInteger(column) || column <= 0) return target.from
  // `Line.to` includes the line break, so the last position of the line is
  // reached through the length of its text.
  const lineEnd = target.from + target.text.length
  return Math.min(target.from + column - 1, lineEnd)
}

/**
 * One editable or read-only buffer.
 * @param {{ value: string, path: string, fontSize?: number, resetToken?: number, readOnly?: boolean,
 *   revealLine?: number | null, revealColumn?: number | null,
 *   onFindRequest?: () => void, onReady?: (api: any) => void,
 *   onChange: (text: string) => void, onSave: () => void,
 *   onCursor?: (position: { line: number, col: number }) => void,
 *   onSendToChat?: (selection: { text: string, fromLine: number, toLine: number }) => void,
 *   chatLabels?: { send?: string, copy?: string },
 *   navLabels?: { goToDefinition?: string, findUsages?: string, findUsagesText?: string, semanticUnavailable?: string } }} props
 */
export function CodeEditor({
  value, path, fontSize = 13, resetToken = 0, readOnly = false, revealLine = null, revealColumn = null,
  onFindRequest, onFindInFiles, onReady, onChange, onSave, onCursor,
  onSendToChat, chatLabels = {}, navLabels: navLabelsProp = null,
}) {
  const hostRef = useRef(null)
  const viewRef = useRef(null)
  const pathRef = useRef(path)
  const lspClientRef = useRef(null)
  /** The last pointer position over the editor, for the Ctrl+hover hint. */
  const pointerRef = useRef(null)
  const [menu, setMenu] = useState(null)
  const [lspVersion, setLspVersion] = useState(() => lspSessionVersion())
  const onSendToChatRef = useRef(onSendToChat)
  onSendToChatRef.current = onSendToChat
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onCursorRef = useRef(onCursor)
  const onFindRef = useRef(onFindRequest)
  const onFindInFilesRef = useRef(onFindInFiles)
  const onReadyRef = useRef(onReady)
  onChangeRef.current = onChange
  onSaveRef.current = onSave
  onCursorRef.current = onCursor
  onFindRef.current = onFindRequest
  onFindInFilesRef.current = onFindInFiles
  onReadyRef.current = onReady
  pathRef.current = path

  // The language server may appear or disappear while the editor is open;
  // the compartment then picks up the new extensions.
  useEffect(() => {
    setLspVersion(lspSessionVersion())
    return onLspSessionChange(() => setLspVersion(lspSessionVersion()))
  }, [])

  // A non-empty selection gets the workbench context menu (send to chat,
  // copy); the navigation entries are always offered, also on an identifier
  // without a selection.
  const onContextMenu = (event) => {
    const view = viewRef.current
    if (view === null) return
    const range = view.state.selection.main
    const hasSelection = range.empty === false
    const clicked = view.posAtCoords({ x: event.clientX, y: event.clientY })
    const word = typeof clicked === 'number' ? wordAtCursor(view.state, clicked) : null
    if (!hasSelection && word === null) return
    event.preventDefault()
    const fromLine = view.state.doc.lineAt(range.from).number
    const toLine = view.state.doc.lineAt(range.to).number
    setMenu({
      x: event.clientX,
      y: event.clientY,
      text: hasSelection ? view.state.sliceDoc(range.from, range.to) : (word ?? ''),
      fromLine,
      toLine,
      word,
      pos: hasSelection ? range.head : clicked,
    })
  }

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return undefined
    const language = languageForPath(path)
    const uri = fileUriOf(path)
    const extensions = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      EditorState.readOnly.of(readOnly === true),
      EditorView.editable.of(readOnly !== true),
      indentOnInput(),
      bracketMatching(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      syntaxHighlighting(HIGHLIGHT),
      THEME,
      EditorView.theme({ '.cm-scroller': { fontSize: `${fontSize}px` } }),
      // The extension supplies match highlighting; its default panel is never
      // opened. FindBar drives the query through the controller below.
      search({ top: false }),
      // The local completion of COMP-01. It works without a language server.
      ...completionExtensions(),
      keymap.of([
        ...editorKeymap({ onSaveRef, onFindRef, onFindInFilesRef, readOnly }),
        ...editorKeymapRest(),
      ]),
      ...(Array.isArray(language) ? language : [language]),
      // The semantic extensions come after the language, the server needs to
      // know the language of the document.
      lspCompartment.of([...lspExtensions(), ...lspPluginExtension(path)]),
      // Ctrl+click to go to a definition (NAV-01), and the hint that says
      // where that click would land (the modifier turns the symbol blue and
      // underlines it, like JetBrains does).
      ctrlHoverField,
      EditorView.domEventHandlers({
        mousedown: (event, view) => handleCtrlClick(event, view),
        mousemove: (event, view) => {
          pointerRef.current = { x: event.clientX, y: event.clientY }
          highlightCtrlHover(view, (event.ctrlKey || event.metaKey) ? ctrlHoverRangeAt(view, pointerRef.current) : null)
          return false
        },
        mouseleave: (event, view) => {
          pointerRef.current = null
          highlightCtrlHover(view, null)
          return false
        },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current?.(update.state.doc.toString())
        if (update.selectionSet || update.docChanged) {
          const head = update.state.selection.main.head
          const line = update.state.doc.lineAt(head)
          onCursorRef.current?.({ line: line.number, col: head - line.from + 1 })
        }
      }),
    ]
    const view = new EditorView({
      state: EditorState.create({ doc: value ?? '', extensions }),
      parent: host,
    })
    viewRef.current = view
    lspClientRef.current = lspClient()
    view.focus()
    const initial = revealPosition(view.state, revealLine, revealColumn)
    if (initial !== null) view.dispatch({ selection: { anchor: initial }, scrollIntoView: true })
    if (uri !== '') registerEditorView(uri, view)

    let matches = []
    let active = -1
    const clearQueryEffect = () => {
      try {
        view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) })
      } catch { /* nothing to clear */ }
    }
    const setHighlight = (query, options) => {
      try {
        view.dispatch({
          effects: setSearchQuery.of(new SearchQuery({
            search: query,
            caseSensitive: options.caseSensitive === true,
            regexp: options.regexp === true,
            wholeWord: options.wholeWord === true,
          })),
        })
      } catch { /* an invalid regex is surfaced by findMatches */ }
    }
    const api = {
      focus: () => view.focus(),
      getText: () => view.state.doc.toString(),
      getSelection: () => {
        const range = view.state.selection.main
        return view.state.sliceDoc(range.from, range.to)
      },
      /** The editor itself, so the workbench can drive it. */
      view,
      /** The document URI of the buffer. */
      uri,
      /** Recompute matches and select the first one. */
      find: (query, options = {}) => {
        try {
          matches = findMatches(view.state.doc.toString(), query, options)
        } catch (error) {
          matches = []
          active = -1
          clearQueryEffect()
          return { total: 0, active: -1, error: error instanceof Error ? error.message : String(error) }
        }
        active = matches.length > 0 ? 0 : -1
        if (active >= 0) {
          setHighlight(query, options)
          view.dispatch({ selection: selectionOf(view, matches[active]), scrollIntoView: true })
        } else {
          clearQueryEffect()
        }
        return { total: matches.length, active, error: null }
      },
      /** Move by `delta` (wraps), recomputing against the current document. */
      go: (delta) => {
        if (matches.length === 0) return { total: 0, active: -1, error: null }
        active = (active + delta + matches.length) % matches.length
        view.dispatch({ selection: selectionOf(view, matches[active]), scrollIntoView: true })
        return { total: matches.length, active, error: null }
      },
      select: (index) => {
        if (matches.length === 0) return -1
        active = ((index % matches.length) + matches.length) % matches.length
        view.dispatch({ selection: selectionOf(view, matches[active]), scrollIntoView: true })
        return active
      },
      replaceCurrent: (replacement) => {
        if (readOnly === true) return { total: matches.length, active, replaced: false }
        if (active < 0 || matches[active] === undefined) return { total: matches.length, active, replaced: false }
        const match = matches[active]
        view.dispatch({ changes: { from: match.from, to: match.to, insert: String(replacement ?? '') } })
        return { total: matches.length, active, replaced: true }
      },
      replaceAll: (replacement, query, options) => {
        if (readOnly === true) return { count: 0 }
        const result = replaceAllMatches(view.state.doc.toString(), query, options, replacement)
        if (result.count > 0) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: result.text } })
        return result
      },
      clear: () => {
        matches = []
        active = -1
        clearQueryEffect()
      },
      focusFind: () => view.focus(),
    }
    onReadyRef.current?.(api)
    return () => {
      onReadyRef.current?.(null)
      if (uri !== '') unregisterEditorView(uri, view)
      viewRef.current = null
      view.destroy()
    }
    // The component is keyed by tab, so a path/read-only/reset change is the
    // only reason to rebuild the document; keystrokes flow through onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, resetToken, readOnly])

  // A language server that appears (or disappears) changes the extensions of
  // the open editor; the document itself stays untouched.
  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    const client = lspClient()
    // Only a new client means new extensions; a reconnect keeps the same
    // one and must not tear the plugin down.
    if (client === lspClientRef.current) return
    lspClientRef.current = client
    try {
      view.dispatch({
        effects: lspCompartment.reconfigure([...lspExtensions(), ...lspPluginExtension(pathRef.current)]),
      })
    } catch {
      /* the editor may already be gone */
    }
  }, [lspVersion])

  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    const position = revealPosition(view.state, revealLine, revealColumn)
    if (position === null) return
    view.dispatch({ selection: { anchor: position }, scrollIntoView: true })
  }, [revealLine, revealColumn])

  // Holding the modifier has to light the symbol up *before* the click, and
  // releasing it has to take the hint away again. The pointer may already rest
  // on a symbol when the key goes down, and it may move before the key comes
  // up - so the pointer position is remembered and reused.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const isModifier = event => event.key === 'Control' || event.key === 'Meta'
    const onKeyDown = (event) => {
      if (!isModifier(event)) return
      const view = viewRef.current
      if (view === null) return
      highlightCtrlHover(view, ctrlHoverRangeAt(view, pointerRef.current))
    }
    const onKeyUp = (event) => {
      if (!isModifier(event)) return
      const view = viewRef.current
      if (view === null) return
      highlightCtrlHover(view, null)
    }
    const onBlur = () => {
      const view = viewRef.current
      if (view !== null) highlightCtrlHover(view, null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const sendSelection = () => {
    const current = menu
    if (current === null) return
    onSendToChatRef.current?.({ text: current.text, fromLine: current.fromLine, toLine: current.toLine })
  }

  const labels = { ...navLabels(), ...(navLabelsProp ?? {}) }
  const usageAvailable = semanticUsagesAvailable()
  const definitionAvailable = semanticDefinitionAvailable()
  const semanticNote = labels.semanticUnavailable ?? 'The language server does not support finding usages.'
  // A greyed-out entry has to say *why* it is greyed out (PRD §7.1). The
  // reason is a tooltip: the label itself is narrow and gets ellipsized.
  const noteFor = (available) => (available ? undefined : semanticNote)

  const goToDefinitionAt = (pos) => {
    const view = viewRef.current
    if (view === null) return
    if (typeof pos === 'number') view.dispatch({ selection: { anchor: pos } })
    jumpToDefinition(view)
  }

  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'iwb-codemirror', ref: hostRef, onContextMenu }),
    menu !== null
      ? React.createElement(ContextMenu, {
          x: menu.x,
          y: menu.y,
          onClose: () => setMenu(null),
          items: [
            { key: 'send', text: chatLabels.send ?? 'Send to chat', action: sendSelection },
            {
              key: 'copy',
              text: chatLabels.copy ?? 'Copy',
              action: () => { void navigator.clipboard.writeText(menu.text).catch(() => {}) },
            },
            null,
            {
              key: 'goToDefinition',
              text: labels.goToDefinition ?? 'Go to definition',
              title: noteFor(definitionAvailable),
              shortcut: shortcutFor('goToDefinition'),
              disabled: definitionAvailable === false,
              action: () => goToDefinitionAt(menu.pos),
            },
            {
              key: 'findUsages',
              text: labels.findUsages ?? 'Find usages (semantic)',
              title: noteFor(usageAvailable),
              shortcut: shortcutFor('findUsages'),
              disabled: usageAvailable === false,
              action: () => {
                const view = viewRef.current
                if (view === null) return
                if (typeof menu.pos === 'number') view.dispatch({ selection: { anchor: menu.pos } })
                findReferences(view)
              },
            },
            {
              key: 'findUsagesText',
              text: labels.findUsagesText ?? 'Find usages (text)',
              shortcut: shortcutFor('findUsagesText'),
              action: () => {
                const view = viewRef.current
                if (view === null) return
                const word = menu.word ?? wordAtCursor(view.state, view.state.selection.main.head)
                if (word === null || word === undefined) return
                runTextUsageSearch(word)
              },
            },
          ],
        })
      : null,
  )
}
