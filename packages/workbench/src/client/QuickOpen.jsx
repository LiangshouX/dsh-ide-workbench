/**
 * Ctrl+Shift+N / Ctrl+P Quick Open. The index comes from `fs.files`; matching
 * is client-side and capped so a 10k-file repository stays responsive.
 */
import React, { useEffect, useMemo, useRef } from 'react'

/** A small, predictable fuzzy score (higher is better). */
export function quickScore(path, query) {
  const text = String(path).toLowerCase()
  const value = String(query).trim().toLowerCase()
  if (value === '') return 1
  const name = text.slice(text.lastIndexOf('/') + 1)
  if (name === value) return 100
  if (name.startsWith(value)) return 90
  if (name.includes(value)) return 80
  if (text.endsWith(`/${value}`)) return 70
  if (text.includes(value)) return 60
  // subsequence: all query characters in order
  let cursor = 0
  for (const char of value) {
    cursor = text.indexOf(char, cursor)
    if (cursor < 0) return null
    cursor += 1
  }
  return Math.max(1, 40 - (text.length - value.length))
}

export function QuickOpen({ store, state }) {
  const t = store.t
  const index = state.quickOpenIndex
  const inputRef = useRef(null)

  const results = useMemo(() => {
    const scored = []
    for (const path of state.fileIndex) {
      const score = quickScore(path, state.quickOpenQuery)
      if (score === null) continue
      scored.push({ path, score })
    }
    scored.sort((left, right) => right.score - left.score || left.path.length - right.path.length || left.path.localeCompare(right.path))
    return scored.slice(0, 100).map(item => item.path)
  }, [state.fileIndex, state.quickOpenQuery])

  useEffect(() => {
    if (state.quickOpen !== true) return
    inputRef.current?.focus()
  }, [state.quickOpen])

  useEffect(() => {
    if (index >= results.length) store.set({ quickOpenIndex: Math.max(0, results.length - 1) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.length])

  if (state.quickOpen !== true) return null
  const active = Math.min(index, Math.max(0, results.length - 1))

  const open = (rel) => {
    if (rel !== undefined) store.openQuickOpenSelection(rel)
  }

  return React.createElement('div', {
    className: 'iwb-quick-backdrop',
    onMouseDown: event => { if (event.target === event.currentTarget) store.closeQuickOpen() },
  },
    React.createElement('div', { className: 'iwb-quick', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('quickOpen.title') },
      React.createElement('div', { className: 'iwb-quick-head' },
        React.createElement('span', { className: 'iwb-quick-title' }, t('quickOpen.title')),
        React.createElement('input', {
          ref: inputRef,
          className: 'iwb-quick-input',
          value: state.quickOpenQuery,
          placeholder: t('quickOpen.placeholder'),
          spellCheck: false,
          onChange: event => store.setQuickOpenQuery(event.target.value),
          onKeyDown: event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); store.moveQuickOpen(1) }
            else if (event.key === 'ArrowUp') { event.preventDefault(); store.moveQuickOpen(-1) }
            else if (event.key === 'Enter') { event.preventDefault(); open(results[active]) }
            else if (event.key === 'Escape') { event.preventDefault(); store.closeQuickOpen() }
          },
        }),
      ),
      React.createElement('div', { className: 'iwb-quick-list' },
        state.fileIndexLoading === true && state.fileIndex.length === 0
          ? React.createElement('div', { className: 'iwb-quick-empty' }, t('common.loading'))
          : (results.length === 0
              ? React.createElement('div', { className: 'iwb-quick-empty' }, t('quickOpen.empty'))
              : results.map((path, position) => React.createElement('button', {
                  key: path,
                  type: 'button',
                  className: `iwb-quick-row ${position === active ? 'iwb-selected' : ''}`,
                  onMouseEnter: () => store.set({ quickOpenIndex: position }),
                  onClick: () => open(path),
                },
                  React.createElement('span', { className: 'iwb-quick-name' }, path.slice(path.lastIndexOf('/') + 1)),
                  React.createElement('span', { className: 'iwb-quick-dir' }, path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''),
                ))),
      ),
      React.createElement('div', { className: 'iwb-quick-foot' },
        `${results.length} · ${t('quickOpen.hint')}`,
        state.fileIndexError !== null ? ` · ${state.fileIndexError}` : '',
      ),
    ),
  )
}
