/**
 * Find in Files: a real editor tab (decision 3A), grouped by file, with
 * match count and elapsed time. Clicking a hit opens the file at its line.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { IconSearch } from './icons.jsx'

function Flag({ on, label, title, onClick }) {
  return React.createElement('button', {
    type: 'button',
    className: `iwb-find-flag ${on ? 'iwb-on' : ''}`,
    title,
    'aria-pressed': on,
    onClick,
  }, label)
}

export function SearchView({ store, state }) {
  const t = store.t
  const search = state.search
  const [query, setQuery] = useState(search.query)
  const [caseSensitive, setCaseSensitive] = useState(search.caseSensitive)
  const [wholeWord, setWholeWord] = useState(search.wholeWord)
  const [regexp, setRegexp] = useState(search.regexp)
  const inputRef = useRef(null)
  const timer = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
    // The tab can finish opening after this effect; focus again once the
    // sidebar transition has settled.
    const timerId = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 80)
    return () => clearTimeout(timerId)
  }, [])

  useEffect(() => {
    // A completed search re-renders the tab; keep the caret in the query box
    // so Enter can open the first result.
    if (search.loading === false) inputRef.current?.focus()
  }, [search.loading, search.tookMs])

  useEffect(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void store.runSearch(query, { caseSensitive, wholeWord, regexp })
    }, query === '' ? 0 : 220)
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, caseSensitive, wholeWord, regexp])

  const totals = useMemo(() => {
    const matches = search.results.reduce((sum, file) => sum + file.matches.length, 0)
    return { matches, files: search.results.length }
  }, [search.results])

  const open = (result, match) => {
    store.openSearchResult(result.path, match.line)
  }

  // The tab-level Enter fallback: even if focus drifted to the result list,
  // Enter on the Search tab opens the first hit.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      if (store.state.activeId !== 'search:in-files') return
      const first = search.results[0]
      if (first === undefined || first.matches[0] === undefined) return
      event.preventDefault()
      event.stopPropagation()
      open(first, first.matches[0])
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [search.results, store])

  return React.createElement('div', { className: 'iwb-search' },
    React.createElement('div', { className: 'iwb-search-head' },
      React.createElement(IconSearch, { width: 14, height: 14, style: { color: 'var(--iwb-muted)' } }),
      React.createElement('input', {
        ref: inputRef,
        className: 'iwb-search-input',
        value: query,
        placeholder: t('search.placeholder'),
        spellCheck: false,
        onChange: event => setQuery(event.target.value),
        onKeyDown: event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            const first = search.results[0]
            if (first !== undefined && first.matches[0] !== undefined) {
              open(first, first.matches[0])
            } else {
              void store.runSearch(query, { caseSensitive, wholeWord, regexp })
            }
          }
        },
      }),
      React.createElement(Flag, {
        on: caseSensitive,
        label: 'Aa',
        title: t('search.caseSensitive'),
        onClick: () => setCaseSensitive(value => !value),
      }),
      React.createElement(Flag, {
        on: wholeWord,
        label: 'W',
        title: t('search.wholeWord'),
        onClick: () => setWholeWord(value => !value),
      }),
      React.createElement(Flag, {
        on: regexp,
        label: '.*',
        title: t('search.regexp'),
        onClick: () => setRegexp(value => !value),
      }),
    ),
    React.createElement('div', { className: 'iwb-search-meta' },
      search.loading === true
        ? t('search.searching')
        : (query === ''
            ? t('search.empty')
            : (search.error !== null
                ? search.error
                : `${totals.matches} ${t('search.resultCount')} · ${totals.files} · ${search.tookMs} ${t('search.took')}`)),
      search.truncated === true ? React.createElement('span', { className: 'iwb-search-warn' }, t('search.truncated')) : null,
    ),
    React.createElement('div', { className: 'iwb-search-results' },
      search.error !== null && query !== ''
        ? React.createElement('div', { className: 'iwb-search-error' }, search.error)
        : (search.results.length === 0 && query !== '' && search.loading !== true
            ? React.createElement('div', { className: 'iwb-empty' }, t('search.noResults'))
            : search.results.map(file => React.createElement('div', { key: file.path, className: 'iwb-search-file' },
                React.createElement('div', { className: 'iwb-search-file-head', title: file.path },
                  React.createElement('span', { className: 'iwb-search-file-name' }, file.path.split('/').pop()),
                  React.createElement('span', { className: 'iwb-search-file-dir' }, file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''),
                  React.createElement('span', { className: 'iwb-count' }, file.matches.length),
                ),
                file.matches.map((match, index) => React.createElement('button', {
                  key: `${file.path}:${match.line}:${match.column}:${index}`,
                  type: 'button',
                  className: 'iwb-search-hit',
                  title: t('search.openResult'),
                  onClick: () => open(file, match),
                },
                  React.createElement('span', { className: 'iwb-search-line' }, match.line),
                  React.createElement('span', { className: 'iwb-search-preview' }, match.preview),
                )),
              ))),
    ),
  )
}
