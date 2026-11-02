/**
 * Find bar for rendered HTML (Markdown preview). It searches the DOM text
 * nodes with the CSS Custom Highlight API, so it needs no per-renderer
 * instrumentation and still reports an exact match count.
 */
import React, { useEffect, useRef, useState } from 'react'
import { IconClose } from './icons.jsx'
import { buildFindRegExp } from './find.js'

/** Text nodes under one container, in document order. */
function textNodes(container) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (parent === null) return NodeFilter.FILTER_REJECT
      if (parent.closest('script, style, .iwb-outline, .iwb-findbar')) return NodeFilter.FILTER_REJECT
      return node.nodeValue === '' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    },
  })
  const nodes = []
  let node = walker.nextNode()
  while (node !== null) {
    nodes.push(node)
    node = walker.nextNode()
  }
  return nodes
}

/** Character offset → DOM point. */
function pointAt(segments, offset) {
  let low = 0
  let high = segments.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const segment = segments[mid]
    if (offset < segment.start) high = mid - 1
    else if (offset > segment.end) low = mid + 1
    else return { node: segment.node, offset: offset - segment.start }
  }
  const last = segments[segments.length - 1]
  return last === undefined ? null : { node: last.node, offset: last.node.nodeValue.length }
}

function rangesFor(container, query, options) {
  if (container === null || query === '') return []
  const nodes = textNodes(container)
  const segments = []
  let text = ''
  for (const node of nodes) {
    const start = text.length
    text += node.nodeValue
    segments.push({ node, start, end: text.length })
  }
  const pattern = buildFindRegExp(query, options)
  const ranges = []
  let match
  while ((match = pattern.exec(text)) !== null) {
    const from = pointAt(segments, match.index)
    const to = pointAt(segments, match.index + match[0].length)
    if (from !== null && to !== null) {
      const range = document.createRange()
      range.setStart(from.node, from.offset)
      range.setEnd(to.node, to.offset)
      ranges.push(range)
    }
    if (match[0] === '') pattern.lastIndex += 1
  }
  return ranges
}

export function DomFindBar({ containerRef, t, onClose }) {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regexp, setRegexp] = useState(false)
  const [total, setTotal] = useState(0)
  const [active, setActive] = useState(-1)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)
  const timer = useRef(null)
  const rangesRef = useRef([])

  const paint = (ranges, index) => {
    rangesRef.current = ranges
    if (typeof CSS === 'undefined' || typeof Highlight === 'undefined' || CSS.highlights === undefined) return
    CSS.highlights.delete('iwb-dom-find')
    CSS.highlights.delete('iwb-dom-find-active')
    if (ranges.length === 0) return
    CSS.highlights.set('iwb-dom-find', new Highlight(...ranges))
    if (index >= 0 && ranges[index] !== undefined) {
      CSS.highlights.set('iwb-dom-find-active', new Highlight(ranges[index]))
    }
  }

  const scrollTo = (index) => {
    const range = rangesRef.current[index]
    const container = containerRef.current
    if (range === undefined || container === null) return
    const rect = range.getBoundingClientRect()
    const box = container.getBoundingClientRect()
    if (rect.top < box.top + 20 || rect.bottom > box.bottom - 20) {
      container.scrollTop += rect.top - box.top - Math.max(20, box.height / 3)
    }
  }

  const search = (value) => {
    if (value === '') {
      rangesRef.current = []
      paint([], -1)
      setTotal(0)
      setActive(-1)
      setError(null)
      return
    }
    try {
      const ranges = rangesFor(containerRef.current, value, { caseSensitive, wholeWord, regexp })
      paint(ranges, ranges.length > 0 ? 0 : -1)
      setTotal(ranges.length)
      setActive(ranges.length > 0 ? 0 : -1)
      setError(null)
      if (ranges.length > 0) scrollTo(0)
    } catch (caught) {
      paint([], -1)
      setTotal(0)
      setActive(-1)
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])
  useEffect(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => search(query), 80)
    return () => { if (timer.current !== null) clearTimeout(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, caseSensitive, wholeWord, regexp])
  useEffect(() => () => {
    if (typeof CSS !== 'undefined' && CSS.highlights !== undefined) {
      CSS.highlights.delete('iwb-dom-find')
      CSS.highlights.delete('iwb-dom-find-active')
    }
  }, [])

  const move = (delta) => {
    if (total === 0) return
    const next = (active + delta + total) % total
    setActive(next)
    paint(rangesRef.current, next)
    scrollTo(next)
  }

  const close = () => {
    paint([], -1)
    onClose?.()
  }

  const flag = (on, label, title, onClick) => React.createElement('button', {
    type: 'button', className: `iwb-find-flag ${on ? 'iwb-on' : ''}`, title, 'aria-pressed': on, onClick,
  }, label)

  return React.createElement('div', {
    className: 'iwb-findbar iwb-dom-findbar',
    role: 'search',
    onKeyDown: (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
      else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); move(1) }
      else if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); move(-1) }
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
      }),
      React.createElement('span', { className: `iwb-find-count ${error !== null ? 'iwb-invalid' : ''}` }, error !== null ? '!' : (query === '' ? '0/0' : `${active + 1}/${total}`)),
      React.createElement('button', { type: 'button', className: 'iwb-find-btn', title: t('editor.findPrevious'), disabled: total === 0, onClick: () => move(-1) }, '↑'),
      React.createElement('button', { type: 'button', className: 'iwb-find-btn', title: t('editor.findNext'), disabled: total === 0, onClick: () => move(1) }, '↓'),
      flag(caseSensitive, 'Aa', t('editor.matchCase'), () => setCaseSensitive(value => !value)),
      flag(wholeWord, 'W', t('editor.wholeWord'), () => setWholeWord(value => !value)),
      flag(regexp, '.*', t('editor.regexp'), () => setRegexp(value => !value)),
      React.createElement('button', { type: 'button', className: 'iwb-find-btn', title: t('common.close'), onClick: close },
        React.createElement(IconClose, { width: 12, height: 12 })),
    ),
  )
}
