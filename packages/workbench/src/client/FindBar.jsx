/**
 * Plugin-owned FindBar for the code editor.
 *
 * CodeMirror's stock panel is English, unthemed and has no match count, so the
 * plugin renders its own row and drives a tiny controller exposed by
 * CodeEditor. Both read-only and editable buffers use the same UI.
 */
import React, { useEffect, useRef, useState } from 'react'
import { IconClose } from './icons.jsx'

export function FindBar({ store, editor, readOnly = false, initialQuery = '', onClose }) {
  const t = store.t
  const [query, setQuery] = useState(initialQuery)
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regexp, setRegexp] = useState(false)
  const [total, setTotal] = useState(0)
  const [active, setActive] = useState(-1)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)
  const timer = useRef(null)

  const options = { caseSensitive, wholeWord, regexp }

  const apply = (text = query) => {
    if (editor === null || editor === undefined) return
    if (text === '') {
      editor.clear()
      setTotal(0)
      setActive(-1)
      setError(null)
      return
    }
    const result = editor.find(text, options)
    setTotal(result.total)
    setActive(result.active)
    setError(result.error ?? null)
  }

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
    apply(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  useEffect(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => apply(query), 90)
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, caseSensitive, wholeWord, regexp])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'F3') {
        event.preventDefault()
        event.stopPropagation()
        const result = editor?.go(event.shiftKey ? -1 : 1)
        if (result !== undefined) { setTotal(result.total); setActive(result.active) }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [editor])

  const move = (delta) => {
    const result = editor?.go(delta)
    if (result !== undefined) { setTotal(result.total); setActive(result.active) }
  }

  const close = () => {
    editor?.clear()
    editor?.focus()
    onClose?.()
  }

  const replaceCurrent = () => {
    const result = editor?.replaceCurrent(replacement)
    if (result?.replaced === true) {
      apply(query)
    }
  }

  const replaceAll = () => {
    const result = editor?.replaceAll(replacement, query, options)
    if ((result?.count ?? 0) > 0) apply(query)
  }

  const flag = (on, label, title, onClick) => React.createElement('button', {
    type: 'button',
    className: `iwb-find-flag ${on ? 'iwb-on' : ''}`,
    title,
    'aria-pressed': on,
    onClick,
  }, label)

  return React.createElement('div', {
    className: 'iwb-findbar',
    role: 'search',
    onKeyDown: (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        move(1)
      } else if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault()
        move(-1)
      }
    },
  },
    React.createElement('div', { className: 'iwb-find-row' },
      React.createElement('span', { className: 'iwb-find-label' }, t('editor.find')),
      React.createElement('input', {
        ref: inputRef,
        className: `iwb-find-input ${error !== null ? 'iwb-invalid' : ''}`,
        value: query,
        placeholder: t('editor.findPlaceholder'),
        spellCheck: false,
        onChange: event => setQuery(event.target.value),
        onKeyDown: (event) => {
          if (event.key === 'F3') {
            event.preventDefault()
            move(event.shiftKey ? -1 : 1)
          }
        },
      }),
      React.createElement('span', {
        className: `iwb-find-count ${error !== null ? 'iwb-invalid' : ''}`,
        title: error ?? '',
      }, error !== null ? '!' : (query === '' ? '0/0' : `${active + 1}/${total}`)),
      React.createElement('button', {
        type: 'button', className: 'iwb-find-btn', title: t('editor.findPrevious'),
        disabled: total === 0, onClick: () => move(-1),
      }, '↑'),
      React.createElement('button', {
        type: 'button', className: 'iwb-find-btn', title: t('editor.findNext'),
        disabled: total === 0, onClick: () => move(1),
      }, '↓'),
      flag(caseSensitive, 'Aa', t('editor.matchCase'), () => setCaseSensitive(value => !value)),
      flag(wholeWord, 'W', t('editor.wholeWord'), () => setWholeWord(value => !value)),
      flag(regexp, '.*', t('editor.regexp'), () => setRegexp(value => !value)),
      React.createElement('button', {
        type: 'button', className: 'iwb-find-btn', title: t('common.close'),
        onClick: close,
      }, React.createElement(IconClose, { width: 12, height: 12 })),
    ),
    readOnly !== true
      ? React.createElement('div', { className: 'iwb-find-row' },
          React.createElement('span', { className: 'iwb-find-label' }, t('editor.replace')),
          React.createElement('input', {
            className: 'iwb-find-input',
            value: replacement,
            placeholder: t('editor.replacePlaceholder'),
            spellCheck: false,
            onChange: event => setReplacement(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') { event.preventDefault(); replaceCurrent() }
            },
          }),
          React.createElement('button', {
            type: 'button', className: 'iwb-textbtn iwb-small', disabled: total === 0,
            onClick: replaceCurrent,
          }, t('editor.replaceOne')),
          React.createElement('button', {
            type: 'button', className: 'iwb-textbtn iwb-small', disabled: total === 0,
            onClick: replaceAll,
          }, t('editor.replaceAll')),
        )
      : null,
  )
}
