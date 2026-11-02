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
 * The core knows NOTHING about code intelligence (PRD-v6 D8): there is no
 * completion, no language-server client and no navigation to a definition in
 * this file. What the editor offers the plugins is the SEAM: the extensions,
 * the key bindings and the commands they register arrive through
 * `contract.editor` and are installed into the compartments of this editor.
 *
 * The grammar of the open file is fetched on demand (PRD-v5 PERF-03): the
 * thirteen language packages are a quarter of the client bundle, and only one
 * of them is needed at a time. The editor therefore renders without
 * highlighting until the package of the file arrives.
 *
 * Two shortcuts of the language-server library are deliberately *not*
 * installed: `renameKeymap` (F2) and `formatKeymap` (Shift-Alt-f) would
 * collide with the workbench shortcuts (PRD §0.2 #6).
 */
import React, { useEffect, useRef, useState } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { SearchQuery, setSearchQuery, search } from '@codemirror/search'
import { bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { findMatches, replaceAllMatches } from './find.js'
import { extensionCompartment, keymapCompartment } from './editor-seam.js'
import { ContextMenu } from './ui.jsx'
import { SLOT_KEYS } from '../contract/index.js'

/**
 * The compartment that holds the grammar of the document.
 *
 * The grammar arrives asynchronously (it is fetched on demand, see
 * `LANGUAGE_PACKAGES`), so it lives in a compartment: the editor renders
 * without highlighting until the package arrives, and the compartment then
 * takes the grammar in place. A file that changes its language gets the
 * grammar of the new language - the old one is taken away first.
 */
const languageCompartment = new Compartment()

/**
 * The language packages, loaded on demand.
 *
 * The thirteen packages and the parsers they pull in are about a quarter of
 * the client bundle, and a session uses one of them at a time (PRD-v5
 * PERF-03). Every entry is therefore a *loader*, not the package itself: a
 * static import of a package anywhere in the module graph would put all of
 * them back into the bundle.
 *
 * The key is the language of the file; the loader resolves to the CodeMirror
 * extension of that language.
 */
const LANGUAGE_PACKAGES = {
  javascript: () => import('@codemirror/lang-javascript').then(module => module.javascript()),
  'javascript-jsx': () => import('@codemirror/lang-javascript').then(module => module.javascript({ jsx: true })),
  'javascript-ts': () => import('@codemirror/lang-javascript').then(module => module.javascript({ typescript: true })),
  'javascript-tsx': () => import('@codemirror/lang-javascript').then(module => module.javascript({ typescript: true, jsx: true })),
  json: () => import('@codemirror/lang-json').then(module => module.json()),
  markdown: () => import('@codemirror/lang-markdown').then(module => module.markdown()),
  python: () => import('@codemirror/lang-python').then(module => module.python()),
  java: () => import('@codemirror/lang-java').then(module => module.java()),
  css: () => import('@codemirror/lang-css').then(module => module.css()),
  html: () => import('@codemirror/lang-html').then(module => module.html()),
  sql: () => import('@codemirror/lang-sql').then(module => module.sql()),
  yaml: () => import('@codemirror/lang-yaml').then(module => module.yaml()),
  xml: () => import('@codemirror/lang-xml').then(module => module.xml()),
  cpp: () => import('@codemirror/lang-cpp').then(module => module.cpp()),
  go: () => import('@codemirror/lang-go').then(module => module.go()),
  rust: () => import('@codemirror/lang-rust').then(module => module.rust()),
}

/**
 * The language of one file path.
 *
 * The key names the package of `LANGUAGE_PACKAGES`; `''` means "plain text" -
 * no package, no grammar, and the editor stays unhighlighted.
 *
 * @param {string} path the path of the file
 * @returns {string} the key of the language, or `''`
 */
export function languageKeyForPath(path) {
  const lower = String(path ?? '').toLowerCase()
  const dot = lower.lastIndexOf('.')
  const ext = dot < 0 ? '' : lower.slice(dot)
  switch (ext) {
    case '.js': case '.mjs': case '.cjs': return 'javascript'
    case '.jsx': return 'javascript-jsx'
    case '.ts': case '.mts': case '.cts': return 'javascript-ts'
    case '.tsx': return 'javascript-tsx'
    case '.json': case '.jsonc': case '.json5': return 'json'
    case '.md': case '.markdown': case '.mdx': return 'markdown'
    case '.py': case '.pyw': case '.pyi': return 'python'
    case '.java': return 'java'
    case '.css': case '.scss': case '.less': return 'css'
    case '.html': case '.htm': case '.vue': case '.svelte': return 'html'
    case '.sql': return 'sql'
    case '.yml': case '.yaml': return 'yaml'
    case '.xml': case '.svg': case '.xsl': case '.xsd': return 'xml'
    case '.c': case '.h': case '.cpp': case '.cc': case '.cxx': case '.hpp': case '.hh': return 'cpp'
    case '.go': return 'go'
    case '.rs': return 'rust'
    default: return ''
  }
}

/**
 * The grammar of one file path.
 *
 * The package is fetched on demand: the promise resolves when the grammar is
 * there, and the caller puts it into the language compartment. A file
 * without a known language resolves to an empty list - the editor then shows
 * the plain text.
 *
 * @param {string} path the path of the file
 * @returns {Promise<any[]>} the language extension of the file
 */
export async function loadLanguageForPath(path) {
  const key = languageKeyForPath(path)
  const loader = LANGUAGE_PACKAGES[key]
  if (loader === undefined) return []
  const extension = await loader()
  return Array.isArray(extension) ? extension : [extension]
}

/**
 * The syntax palette of the editor.
 *
 * Every colour is a token of the workbench stylesheet, and every token ends
 * in a `--dsw-alias-*` of the host design system - so the palette follows the
 * host theme instead of a fixed dark one. `prefers-color-scheme` is
 * deliberately not used: the host theme is not the system theme.
 */
const HIGHLIGHT = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--iwb-syn-comment)', fontStyle: 'italic' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--iwb-syn-string)' },
  { tag: [tags.keyword, tags.modifier], color: 'var(--iwb-syn-keyword)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--iwb-syn-number)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--iwb-syn-type)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--iwb-syn-function)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--iwb-syn-property)' },
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--iwb-syn-tag)' },
  { tag: tags.heading, color: 'var(--iwb-syn-heading)', fontWeight: 'bold' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, color: 'var(--iwb-syn-heading)', textDecoration: 'underline' },
  { tag: tags.invalid, color: 'var(--iwb-syn-invalid)' },
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
  // The selection, the matching bracket and the search hits are mixed from the
  // theme tokens instead of fixed rgba values: a brand colour that is
  // light in a light host theme then still reads as a selection.
  '.cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--iwb-accent) 24%, transparent) !important' },
  '.cm-matchingBracket': {
    backgroundColor: 'color-mix(in srgb, var(--iwb-accent) 25%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--iwb-accent) 50%, transparent)',
  },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--iwb-warn) 28%, transparent)' },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--iwb-accent) 45%, transparent)',
    outline: '1px solid var(--iwb-accent)',
  },
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
 * The rest of the keymap of the editor buffer.
 *
 * The core binds the default keymap of CodeMirror and its history; the
 * bindings of the plugins arrive through the seam and live in the keymap
 * compartment, so they can come and go without rebuilding the document.
 * @returns {Array<any>} the keymap entries
 */
export function editorKeymapRest() {
  return [
    ...defaultKeymap,
    ...historyKeymap,
    indentWithTab,
  ]
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
 *   contract?: object, renderSlot?: Function }} props
 */
export function CodeEditor({
  value, path, fontSize = 13, resetToken = 0, readOnly = false, revealLine = null, revealColumn = null,
  onFindRequest, onFindInFiles, onReady, onChange, onSave, onCursor,
  onSendToChat, chatLabels = {}, contract = null, renderSlot = null,
}) {
  // The seam of the editor: the extensions, the key bindings and the commands
  // of the plugins arrive through it.
  const seam = contract?.editor ?? null
  const hostRef = useRef(null)
  const viewRef = useRef(null)
  const pathRef = useRef(path)
  const [menu, setMenu] = useState(null)
  /** Bumped when the seam changes, so the context menu offers the new commands. */
  const [, setSeamVersion] = useState(0)
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

  // The extensions, the key bindings and the commands of the plugins arrive
  // through the seam. A change of them reconfigures the compartments of the
  // editor - the document itself stays untouched.
  useEffect(() => {
    if (seam === null || seam === undefined) return undefined
    return seam.subscribe(() => {
      const view = viewRef.current
      if (view !== null) {
        try {
          view.dispatch({
            effects: [
              extensionCompartment.reconfigure(seam.extensionSlots),
              keymapCompartment.reconfigure(seam.keymap),
            ],
          })
        } catch {
          /* the editor may already be gone */
        }
      }
      setSeamVersion(version => version + 1)
    })
  }, [seam])

  // A non-empty selection gets the workbench context menu (send to chat,
  // copy); the commands of the plugins are always offered as well.
  const onContextMenu = (event) => {
    const view = viewRef.current
    if (view === null) return
    const range = view.state.selection.main
    const hasSelection = range.empty === false
    if (!hasSelection) return
    event.preventDefault()
    const fromLine = view.state.doc.lineAt(range.from).number
    const toLine = view.state.doc.lineAt(range.to).number
    setMenu({
      x: event.clientX,
      y: event.clientY,
      text: view.state.sliceDoc(range.from, range.to),
      fromLine,
      toLine,
    })
  }

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return undefined
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
      // The extensions of the plugins (and the automatic closing of the
      // brackets of the core) live in their own compartment: they come and go
      // while the editor is open, and a reconfiguration must not rebuild the
      // document.
      extensionCompartment.of(seam?.extensionSlots ?? []),
      // The key bindings of the plugins. They come BEFORE the default keymap,
      // otherwise `Enter` and `Tab` would be swallowed by it and a registered
      // shortcut could never fire.
      keymapCompartment.of(seam?.keymap ?? []),
      keymap.of([
        ...editorKeymap({ onSaveRef, onFindRef, onFindInFilesRef, readOnly }),
        ...editorKeymapRest(),
      ]),
      // The grammar of the document (PERF-03). It is fetched on demand, so
      // the compartment starts empty and the editor renders without
      // highlighting until the package arrives.
      languageCompartment.of([]),
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
    view.focus()
    const initial = revealPosition(view.state, revealLine, revealColumn)
    if (initial !== null) view.dispatch({ selection: { anchor: initial }, scrollIntoView: true })

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
      uri: '',
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
      /** Move by `delta` (wraps), recompute against the current document. */
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
    // The grammar of the document is fetched on demand (PERF-03): the editor
    // renders without highlighting until the package arrives, and the
    // compartment then takes the grammar in place. The load belongs to this
    // view: a document that is rebuilt (a new path, a reset) starts with an
    // empty compartment again, so the grammar of the old language never stays
    // behind.
    let languageCancelled = false
    loadLanguageForPath(path).then(extension => {
      if (languageCancelled) return
      try {
        view.dispatch({ effects: languageCompartment.reconfigure(extension) })
      } catch {
        /* the editor may already be gone */
      }
    }).catch(() => {
      // The package could not be fetched: the file stays plain text.
    })
    return () => {
      languageCancelled = true
      onReadyRef.current?.(null)
      viewRef.current = null
      view.destroy()
    }
    // The component is keyed by tab, so a path/read-only/reset change is the
    // only reason to rebuild the document; keystrokes flow through onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, resetToken, readOnly])

  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    const position = revealPosition(view.state, revealLine, revealColumn)
    if (position === null) return
    view.dispatch({ selection: { anchor: position }, scrollIntoView: true })
  }, [revealLine, revealColumn])

  const sendSelection = () => {
    const current = menu
    if (current === null) return
    onSendToChatRef.current?.({ text: current.text, fromLine: current.fromLine, toLine: current.toLine })
  }

  // The commands of the plugins. They are ordinary menu entries; a plugin
  // that wants them greyed out says so itself.
  const commandItems = (seam?.commandItems ?? []).flat().filter(item => item !== null && typeof item === 'object')

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
            ...(commandItems.length === 0
              ? []
              : [null, ...commandItems.map(item => ({
                  key: item.key,
                  text: item.label,
                  shortcut: item.shortcut,
                  disabled: typeof item.enabled === 'function' ? item.enabled() !== true : item.enabled === false,
                  action: () => { item.run?.() },
                }))]),
          ],
          // The commands of the plugins that come through the slot of the
          // contract: the occupant draws its own entry (PRD-v6 §3.2).
          extra: renderSlot !== null && contract !== null
            ? renderSlot(SLOT_KEYS.commandItem, { contract })
            : null,
        })
      : null,
  )
}
