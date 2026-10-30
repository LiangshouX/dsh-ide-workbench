/**
 * The code surface (CodeMirror 6), used for both editing and read-only
 * viewing.
 *
 * A read-only CodeMirror still supports native selection, Ctrl+A and Ctrl+C,
 * which is exactly the baseline a code viewer must provide. The document is
 * seeded from the tab's draft; every change flows back through `onChange`.
 * The FindBar gets a small imperative controller instead of CodeMirror's
 * English default panel.
 */
import React, { useEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { SearchQuery, setSearchQuery, search } from '@codemirror/search'
import { bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle } from '@codemirror/language'
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
import { findMatches, replaceAllMatches } from './find.js'
import { ContextMenu } from './ui.jsx'

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
  '.cm-tooltip': { backgroundColor: 'var(--iwb-overlay)', border: '1px solid var(--iwb-border-strong)' },
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
 * One editable or read-only buffer.
 * @param {{ value: string, path: string, fontSize?: number, resetToken?: number, readOnly?: boolean,
 *   onFindRequest?: () => void, onReady?: (api: any) => void,
 *   onChange: (text: string) => void, onSave: () => void,
 *   onCursor?: (position: { line: number, col: number }) => void,
 *   onSendToChat?: (selection: { text: string, fromLine: number, toLine: number }) => void,
 *   chatLabels?: { send?: string, copy?: string } }} props
 */
export function CodeEditor({
  value, path, fontSize = 13, resetToken = 0, readOnly = false, revealLine = null,
  onFindRequest, onFindInFiles, onReady, onChange, onSave, onCursor,
  onSendToChat, chatLabels = {},
}) {
  const hostRef = useRef(null)
  const viewRef = useRef(null)
  const [menu, setMenu] = useState(null)
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

  // A non-empty selection gets the workbench context menu (send to chat,
  // copy); an empty one keeps the browser's native menu.
  const onContextMenu = (event) => {
    const view = viewRef.current
    if (view === null || typeof onSendToChatRef.current !== 'function') return
    const range = view.state.selection.main
    if (range.empty) return
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
    const language = languageForPath(path)
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
      keymap.of([
        ...editorKeymap({ onSaveRef, onFindRef, onFindInFilesRef, readOnly }),
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      ...(Array.isArray(language) ? language : [language]),
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
    if (Number.isInteger(revealLine) && revealLine > 0) {
      const line = view.state.doc.line(Math.min(revealLine, view.state.doc.lines))
      view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true })
    }

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
      viewRef.current = null
      view.destroy()
    }
    // The component is keyed by tab, so a path/read-only/reset change is the
    // only reason to rebuild the document; keystrokes flow through onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, resetToken, readOnly])

  useEffect(() => {
    const view = viewRef.current
    if (view === null || !Number.isInteger(revealLine) || revealLine <= 0) return
    const line = view.state.doc.line(Math.min(revealLine, view.state.doc.lines))
    view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true })
  }, [revealLine])

  const sendSelection = () => {
    const current = menu
    if (current === null) return
    onSendToChatRef.current?.({ text: current.text, fromLine: current.fromLine, toLine: current.toLine })
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
          ],
        })
      : null,
  )
}

