/**
 * The Find in Files popup (PRD-v5 supplement, FIND-01 / FIND-02).
 *
 * The results used to live in a tab of the editor area, which took a tab
 * away from the code the user was working on - and the two entries (Find in
 * Files and the text version of Find Usages) shared one data slice, so one
 * query overwrote the other. The popup floats above the editor instead.
 *
 * The shape follows the Quick Open overlay: the same backdrop (z-index 70, so
 * it is above every modal), the same panel, the same keyboard handling.
 *
 * The body is split in two:
 *
 *   - the upper half is the **file list**: one row per file that matched,
 *     with its match count. Nothing else - the matches of a file belong to
 *     the preview below, not into the list.
 *   - the lower half is the **preview of the selected file**: every hit of
 *     that file with the lines around it, so the user sees the code before
 *     opening anything.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FileTypeIcon, IconSearch } from './icons.jsx'

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
 * The line number sits in front of the text so the user can see where the
 * hit is in the file.
 * @param {number} number the line number
 * @param {string} text the text of the line
 * @param {boolean} hit whether this is the hit itself
 * @param {string} key the React key of the line
 */
function PreviewLine({ number, text, hit, key }) {
  return React.createElement('div', { key, className: `iwb-search-popup-line ${hit ? 'iwb-hit' : ''}` },
    React.createElement('span', { className: 'iwb-search-popup-number' }, String(number)),
    React.createElement('span', { className: 'iwb-search-popup-text' }, text),
  )
}

/**
 * The popup of the project-wide search.
 *
 * @param {{store: object, state: object}} props the workbench store and its
 *   snapshot
 */
export function SearchPopup({ store, state }) {
  const t = store.t
  const search = state.search ?? {}
  const popup = state.searchPopup ?? { open: false, index: 0 }
  const inputRef = useRef(null)
  const timer = useRef(null)
  const [query, setQuery] = useState(search.query ?? '')
  const [caseSensitive, setCaseSensitive] = useState(search.caseSensitive === true)
  const [wholeWord, setWholeWord] = useState(search.wholeWord === true)
  const [regexp, setRegexp] = useState(search.regexp === true)

  /** The files that matched, in the order the host returned them. */
  const files = useMemo(() => (search.results ?? []).filter(file => (file.matches ?? []).length > 0), [search.results])

  const totals = useMemo(() => {
    let matches = 0
    for (const file of files) matches += (file.matches ?? []).length
    return { matches, files: files.length }
  }, [files])

  const selected = files.length === 0
    ? null
    : files[Math.min(Math.max(popup.index ?? 0, 0), files.length - 1)]

  useEffect(() => {
    if (popup.open !== true) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [popup.open])

  useEffect(() => {
    if (popup.open !== true) return undefined
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void store.runSearch(query, { caseSensitive, wholeWord, regexp })
    }, query === '' ? 0 : 220)
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, caseSensitive, wholeWord, regexp, popup.open])

  if (popup.open !== true) return null

  const openHit = (path, line) => {
    if (typeof path !== 'string' || path === '') return
    store.openSearchResult(path, line)
  }

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); store.moveSearchSelection(1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); store.moveSearchSelection(-1) }
    else if (event.key === 'Enter') {
      event.preventDefault()
      // The first hit of the selected file is the one the user means.
      const first = selected?.matches?.[0]
      if (selected !== null && first !== undefined) openHit(selected.path, first.line)
      else void store.runSearch(query, { caseSensitive, wholeWord, regexp })
    } else if (event.key === 'Escape') { event.preventDefault(); store.closeSearchPopup() }
    else if (event.key === 'F8') { event.preventDefault(); store.moveSearchSelection(event.shiftKey ? -1 : 1) }
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
    onMouseDown: event => { if (event.target === event.currentTarget) store.closeSearchPopup() },
  },
    React.createElement('div', {
      className: 'iwb-quick iwb-search-popup',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': search.textMatch === true ? t('nav.usagesTitle') : t('search.title'),
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
          onKeyDown,
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
        search.loading === true
          ? t('search.searching')
          : (query === ''
            ? t('search.empty')
            : (search.error !== null
              ? search.error
              : interpolate(t('search.popup.matches'), { count: totals.matches, files: totals.files }))),
        search.truncated === true ? React.createElement('span', { className: 'iwb-search-warn' }, t('search.truncated')) : null,
        // The text version of Find Usages is a fallback, not a semantic
        // result: every hit is labelled, so the user knows what the list
        // really is (PRD-v5 §5.3).
        search.textMatch === true
          ? React.createElement('span', { className: 'iwb-search-textmatch' }, t('nav.textMatch'))
          : null,
      ),
      // The upper half: one row per file that matched. The matches of a file
      // are not repeated here - they are the preview below.
      React.createElement('div', { className: 'iwb-search-popup-list' },
        search.error !== null && query !== ''
          ? React.createElement('div', { className: 'iwb-search-error' }, search.error)
          : (files.length === 0 && query !== '' && search.loading !== true
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
                if (first !== undefined) openHit(file.path, first.line)
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
                  onDoubleClick: () => openHit(selected.path, match.line),
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
        search.tookMs > 0 ? ` · ${search.tookMs} ${t('search.took')}` : '',
      ),
    ),
  )
}
