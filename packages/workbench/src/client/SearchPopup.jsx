/**
 * Find in Files as a POPUP over the workbench (PRD-v5 supplement FIND-01/02).
 *
 * The results used to be a tab of the editor area: a project-wide search took
 * the file the user was working on off the screen, and the tab strip filled up
 * with a tool that is not a document. The popup floats above the editor
 * instead, so the code stays where it was.
 *
 * The shape follows the Quick Open overlay of the core: the same backdrop
 * (z-index 70, above every modal), the same panel, the same keyboard handling.
 *
 * The body is split in two:
 *
 *   - the upper half is the FILE list: one row per file that matched, with its
 *     match count. The matches of a file are not repeated here - they are the
 *     preview below.
 *   - the lower half is the PREVIEW of the selected file: every hit with the
 *     lines around it (the host sends `before`/`after` with each hit), so the
 *     user sees the code before opening anything.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FileTypeIcon, IconSearch } from './icons.jsx'
import { shallowEqual, useStoreSlice } from './hooks.js'

/**
 * Fill the `{placeholder}` slots of one text.
 *
 * The harness translate function does not interpolate.
 * @param {string} text
 * @param {Record<string, string|number>} values
 * @returns {string}
 */
function interpolate(text, values) {
  let out = typeof text === 'string' ? text : ''
  for (const [name, value] of Object.entries(values)) {
    out = out.replaceAll(`{${name}}`, String(value))
  }
  return out
}

/**
 * One line of the preview.
 *
 * The line number sits in front of the text so the user can see where the hit
 * is in the file.
 * @param {{number: number, text: string, hit: boolean, key: string}} props
 */
function PreviewLine({ number, text, hit, key }) {
  return React.createElement('div', { key, className: `iwb-search-popup-line ${hit ? 'iwb-hit' : ''}` },
    React.createElement('span', { className: 'iwb-search-popup-number' }, String(number)),
    React.createElement('span', { className: 'iwb-search-popup-text' }, text),
  )
}

/**
 * The slice of the workbench snapshot the popup reads.
 *
 * The popup is an overlay of its own: it subscribes here instead of being fed
 * by the editor area, so a search result never re-renders the editor.
 * @param {object} state the whole workbench snapshot
 * @returns {{search: object, popup: object}} the slice
 */
export function searchPopupSlice(state) {
  return { search: state.search, popup: state.searchPopup }
}

/**
 * The popup of the project-wide search.
 * @param {{store: object}} props the workbench store
 */
export function SearchPopup({ store }) {
  const t = store.t
  const { search, popup: rawPopup } = useStoreSlice(store, searchPopupSlice, shallowEqual)
  const popup = rawPopup ?? { open: false, index: 0, generation: 0 }
  const open = popup.open === true
  const inputRef = useRef(null)
  const timer = useRef(null)
  /**
   * The generation of the popup.
   *
   * It changes on every open, so it marks the moment the popup takes its seed
   * (the query and the flags) from the store.
   */
  const generation = popup.generation ?? 0
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regexp, setRegexp] = useState(false)
  /**
   * Whether the seed was applied.
   *
   * The search waits for it: the store resets the query and the flags when the
   * popup opens, and that reset can land in the same tick as the open - a
   * search with the old value would be a project-wide run the user never asked
   * for (PRD-v5 review R14).
   */
  const [seeded, setSeeded] = useState(false)
  /**
   * The last search the popup started.
   *
   * The seed effect and the debounce effect can see the same query - the seed
   * lands in the state, and the debounce fires for it. The key makes sure
   * that one query is scanned once; the generation empties it when the popup
   * opens again (the workspace may have changed in between).
   */
  const lastRun = useRef('')

  /** The files that matched, in the order the host returned them. */
  const files = useMemo(() => (search?.results ?? []).filter(file => (file?.matches ?? []).length > 0), [search?.results])

  const totals = useMemo(() => {
    let matches = 0
    for (const file of files) matches += (file.matches ?? []).length
    return { matches, files: files.length }
  }, [files])

  const selected = files.length === 0
    ? null
    : files[Math.min(Math.max(popup.index ?? 0, 0), files.length - 1)]

  useEffect(() => {
    if (open !== true) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [open])

  // The seed of the popup: the query and the flags of the run it shows. The
  // store owns them, and it resets them on every open, so an earlier run can
  // never leak in.
  useEffect(() => {
    if (open !== true) return
    const live = store.state?.search ?? search ?? {}
    setQuery(live.query ?? '')
    setCaseSensitive(live.caseSensitive === true)
    setWholeWord(live.wholeWord === true)
    setRegexp(live.regexp === true)
    setSeeded(true)
    // A new run of the popup may search the same query again: the workspace
    // can have changed since the last one.
    lastRun.current = ''
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, open])

  useEffect(() => {
    if (open !== true) return undefined
    // The search waits for the seed: the value the store reset in the same
    // tick as the open must not start a run (PRD-v5 review R14).
    if (seeded !== true) return undefined
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      // One query is scanned once: the seed and the debounce must not start
      // the same scan twice.
      const key = `${query}\u0000${caseSensitive} ${wholeWord} ${regexp}`
      if (lastRun.current === key) return
      lastRun.current = key
      void store.runSearch(query, { caseSensitive, wholeWord, regexp })
    }, query === '' ? 0 : 220)
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, caseSensitive, wholeWord, regexp, seeded, open])

  if (open !== true) return null

  /**
   * Open one hit of the result list.
   *
   * The column is part of the jump: the host sends it with every match, and
   * without it the caret lands at the start of the line instead of on the hit
   * (PRD-v5 review R15). Opening a hit closes the popup.
   * @param {string} path the relative path of the file
   * @param {number} line the line of the hit
   * @param {number} [column] the column of the hit
   */
  const openHit = (path, line, column) => {
    if (typeof path !== 'string' || path === '') return
    store.openSearchResult(path, line, column)
  }

  /**
   * The keys of the popup.
   *
   * They belong to the container and not to the input alone: the file rows are
   * buttons, so a click on one takes the focus away from the input - the
   * keyboard has to keep working there (PRD-v5 review R13).
   * @param {object} event the key event
   * @returns {boolean} whether the key was handled
   */
  const handleKey = (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); store.moveSearchSelection(1); return true }
    if (event.key === 'ArrowUp') { event.preventDefault(); store.moveSearchSelection(-1); return true }
    if (event.key === 'Enter') {
      event.preventDefault()
      // The first hit of the selected file is the one the user means.
      const first = selected?.matches?.[0]
      if (selected !== null && first !== undefined) openHit(selected.path, first.line, first.column)
      else void store.runSearch(query, { caseSensitive, wholeWord, regexp })
      return true
    }
    if (event.key === 'Escape') { event.preventDefault(); store.closeSearchPopup(); return true }
    if (event.key === 'F8') { event.preventDefault(); store.moveSearchSelection(event.shiftKey ? -1 : 1); return true }
    return false
  }

  // The container owns the keys: a click on a file row moves the focus out of
  // the input, and Esc / the arrows have to work there too (R13).
  const onContainerKeyDown = (event) => {
    if (handleKey(event) !== true) return
    // The popup is a modal: the key must not travel on - the workbench
    // shortcuts would act on it a second time.
    event.stopPropagation()
  }

  // The input delegates to the same handler and stops the event there: the
  // container would otherwise handle the key a second time.
  const onInputKeyDown = (event) => {
    if (handleKey(event) !== true) return
    event.stopPropagation()
  }

  const flag = (on, label, title, onClick) => React.createElement('button', {
    type: 'button',
    className: `iwb-find-flag ${on ? 'iwb-on' : ''}`,
    title,
    'aria-pressed': on,
    onClick,
  }, label)

  return React.createElement('div', {
    className: 'iwb-quick-backdrop iwb-search-popup-backdrop',
    // The container takes the keys, so they work wherever the focus is - a
    // click on a file row moves the focus out of the input (R13).
    tabIndex: -1,
    onKeyDown: onContainerKeyDown,
    onMouseDown: event => { if (event.target === event.currentTarget) store.closeSearchPopup() },
  },
    React.createElement('div', {
      className: 'iwb-quick iwb-search-popup',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': t('search.title'),
    },
      React.createElement('div', { className: 'iwb-quick-head' },
        React.createElement(IconSearch, { width: 14, height: 14, style: { color: 'var(--iwb-muted)' } }),
        React.createElement('input', {
          ref: inputRef,
          className: 'iwb-quick-input',
          value: query,
          placeholder: t('search.placeholder'),
          spellCheck: false,
          onChange: event => setQuery(event.target.value),
          onKeyDown: onInputKeyDown,
        }),
        flag(caseSensitive, 'Aa', t('search.caseSensitive'), () => setCaseSensitive(value => !value)),
        flag(wholeWord, 'W', t('search.wholeWord'), () => setWholeWord(value => !value)),
        flag(regexp, '.*', t('search.regexp'), () => setRegexp(value => !value)),
        React.createElement('button', {
          type: 'button', className: 'iwb-iconbtn', title: t('common.close'), 'aria-label': t('common.close'),
          onClick: () => store.closeSearchPopup(),
        }, React.createElement('span', { style: { fontSize: 15, lineHeight: 1 } }, '×')),
      ),
      React.createElement('div', { className: 'iwb-search-popup-meta' },
        search?.loading === true
          ? t('search.searching')
          : (query === ''
            ? t('search.empty')
            : (search?.error !== null && search?.error !== undefined
              ? search.error
              : interpolate(t('search.popup.matches'), { count: totals.matches, files: totals.files }))),
        search?.truncated === true ? React.createElement('span', { className: 'iwb-search-warn' }, t('search.truncated')) : null,
      ),
      // The upper half: one row per file that matched. The matches of a file
      // are not repeated here - they are the preview below.
      React.createElement('div', { className: 'iwb-search-popup-list' },
        search?.error !== null && search?.error !== undefined && query !== ''
          ? React.createElement('div', { className: 'iwb-search-error' }, search.error)
          : (files.length === 0 && query !== '' && search?.loading !== true
            ? React.createElement('div', { className: 'iwb-quick-empty' }, t('search.noResults'))
            : files.map((file, index) => React.createElement('button', {
              key: file.path,
              type: 'button',
              className: `iwb-search-popup-file ${index === (popup.index ?? 0) ? 'iwb-selected' : ''}`,
              title: file.path,
              onClick: () => store.set({ searchPopup: { ...popup, index } }),
              // A double click opens the file at its first hit.
              onDoubleClick: () => {
                const first = file.matches?.[0]
                if (first !== undefined) openHit(file.path, first.line, first.column)
              },
            },
              React.createElement(FileTypeIcon, { path: file.path, size: 14 }),
              React.createElement('span', { className: 'iwb-search-popup-file-name' }, file.path.split('/').pop()),
              React.createElement('span', { className: 'iwb-search-popup-file-dir' }, file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''),
              React.createElement('span', { className: 'iwb-search-popup-file-count' },
                interpolate(t('search.popup.matchCount'), { count: (file.matches ?? []).length })),
            ))),
      ),
      // The lower half: the preview of the selected file - every hit with the
      // lines around it.
      React.createElement('div', { className: 'iwb-search-popup-preview' },
        selected === null
          ? React.createElement('div', { className: 'iwb-quick-empty' }, t('search.popup.noPreview'))
          : React.createElement('div', { className: 'iwb-search-popup-blocks' },
              (selected.matches ?? []).map((match, index) => {
                const before = Array.isArray(match.before) ? match.before : []
                const after = Array.isArray(match.after) ? match.after : []
                const line = match.line ?? 0
                const binary = match.binary === true
                return React.createElement('div', {
                  key: `${selected.path}:${match.line}:${match.column}:${index}`,
                  className: 'iwb-search-popup-block',
                  // A double click on the hit itself opens it as well: the
                  // preview is where the user reads the context and decides.
                  onDoubleClick: () => openHit(selected.path, match.line, match.column),
                },
                  React.createElement('div', { className: 'iwb-search-popup-block-head' },
                    React.createElement('span', { className: 'iwb-search-popup-block-pos' }, `${selected.path}:${line}`),
                    React.createElement('span', { className: 'iwb-search-popup-block-preview' }, match.preview ?? ''),
                  ),
                  binary
                    ? React.createElement('div', { className: 'iwb-quick-empty' }, t('search.popup.binary'))
                    : React.createElement('div', { className: 'iwb-search-popup-code' },
                        before.map((text, at) => PreviewLine({
                          key: `before-${at}`,
                          number: line - before.length + at,
                          text,
                          hit: false,
                        })),
                        PreviewLine({ key: 'hit', number: line, text: match.preview ?? '', hit: true }),
                        after.map((text, at) => PreviewLine({
                          key: `after-${at}`,
                          number: line + at + 1,
                          text,
                          hit: false,
                        })),
                      ),
                )
              }),
            ),
      ),
      React.createElement('div', { className: 'iwb-quick-foot' },
        `${totals.files} · ${t('search.popup.hint')}`,
        search?.tookMs > 0 ? ` · ${search.tookMs} ${t('search.took')}` : '',
      ),
    ),
  )
}
