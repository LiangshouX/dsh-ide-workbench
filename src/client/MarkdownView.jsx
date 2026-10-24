/**
 * Markdown read-only preview.
 *
 * The renderer is the harness's own `MarkdownText` (`@deepseek-ai/dsh-client-ui-primitives`),
 * which is seeded into the browser module table, so headings, tables, task
 * lists, code cards and typography match the DSH chat exactly. A small
 * fallback renderer keeps the preview usable if a stripped deployment does not
 * expose that module.
 *
 * The outline is built from the markdown source: heading text is parsed (fenced
 * code ignored), assigned a stable slug, then injected onto the rendered
 * heading elements after each render. Clicking an outline row scrolls the
 * preview; the active row follows the scroll position.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { IconOutline } from './icons.jsx'
import { extractHeadings } from './markdown-outline.js'
import { DomFindBar } from './DomFindBar.jsx'

let markdownComponent = null
let primitivesLoading = null
let primitivesLoader = null
const primitivesListeners = new Set()

try {
  // The factory `require` resolves the shell's module table synchronously for
  // baseline modules; a stripped host throws and the async loader below (or
  // the fallback renderer) takes over.
  // eslint-disable-next-line no-undef
  const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
  markdownComponent = primitives?.MarkdownText ?? null
} catch {
  markdownComponent = null
}

/** Give the fallback path an async resolver (the client `modules` service). */
export function setPrimitivesLoader(loader) {
  primitivesLoader = typeof loader === 'function' ? loader : null
}

function ensurePrimitives() {
  if (markdownComponent !== null) return Promise.resolve(markdownComponent)
  if (primitivesLoading !== null) return primitivesLoading
  if (primitivesLoader === null) return Promise.resolve(null)
  primitivesLoading = primitivesLoader()
    .then((module) => {
      markdownComponent = module?.MarkdownText ?? null
      for (const listener of primitivesListeners) listener()
      return markdownComponent
    })
    .catch(() => null)
  return primitivesLoading
}

/** The DSH markdown component once available (null while loading). */
function useMarkdownComponent() {
  const [component, setComponent] = useState(markdownComponent)
  useEffect(() => {
    if (component !== null) return undefined
    let alive = true
    void ensurePrimitives().then((loaded) => {
      if (alive && loaded !== null) setComponent(() => loaded)
    })
    const listener = () => {
      if (alive && markdownComponent !== null) setComponent(() => markdownComponent)
    }
    primitivesListeners.add(listener)
    return () => {
      alive = false
      primitivesListeners.delete(listener)
    }
  }, [component])
  return component
}

/** Build the nested labels the harness MarkdownText expects. */
function markdownLabels(labels = {}) {
  return {
    code: {
      copyLabel: labels.copy ?? 'Copy',
      copiedLabel: labels.copied ?? 'Copied',
      toolbarLabels: {
        codeLabel: labels.code ?? 'Code',
        wrapLabel: labels.wrap ?? 'Wrap',
        unwrapLabel: labels.unwrap ?? 'No wrap',
      },
    },
    footnotes: '',
  }
}

/** Minimal renderer used only when the host MarkdownText is unavailable. */
function FallbackMarkdown({ text }) {
  const blocks = []
  const lines = String(text ?? '').split(/\r?\n/)
  let index = 0
  let key = 0
  while (index < lines.length) {
    const line = lines[index]
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading !== null) {
      const tag = `h${heading[1].length}`
      blocks.push(React.createElement(tag, { key: key += 1 }, heading[2]))
      index += 1
      continue
    }
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      const fence = /^\s*(`{3,}|~{3,})/.exec(line)[1]
      index += 1
      const body = []
      while (index < lines.length && !lines[index].trimStart().startsWith(fence)) {
        body.push(lines[index])
        index += 1
      }
      index += 1
      blocks.push(React.createElement('pre', { key: key += 1 }, React.createElement('code', null, body.join('\n'))))
      continue
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const items = []
      while (index < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[index])) {
        items.push(React.createElement('li', { key: items.length }, lines[index].replace(/^\s*([-*+]|\d+\.)\s+/, '')))
        index += 1
      }
      blocks.push(React.createElement('ul', { key: key += 1 }, items))
      continue
    }
    if (line.trim() === '') {
      index += 1
      continue
    }
    const paragraph = []
    while (index < lines.length && lines[index].trim() !== '' && !/^\s*(#{1,6})\s+/.test(lines[index])) {
      paragraph.push(lines[index])
      index += 1
    }
    blocks.push(React.createElement('p', { key: key += 1 }, paragraph.join(' ')))
  }
  return React.createElement('div', { className: 'iwb-markdown-fallback' }, blocks)
}

/**
 * Render one markdown document in the read-only viewer.
 * @param {{ text: string, outlineOpen: boolean, onToggleOutline: () => void,
 *   labels?: Record<string, string>, t?: (key: string) => string,
 *   findOpen?: boolean, onCloseFind?: () => void, onFindRequest?: () => void }} props
 */
export function MarkdownView({
  text, outlineOpen, onToggleOutline, labels = {}, t = (key) => key,
  findOpen = false, onCloseFind, onFindRequest,
}) {
  const MarkdownText = useMarkdownComponent()
  const containerRef = useRef(null)
  const [activeSlug, setActiveSlug] = useState('')
  const headings = useMemo(() => extractHeadings(text), [text])
  const headingKey = useMemo(() => headings.map(heading => heading.slug).join('|'), [headings])
  const openFind = () => { onFindRequest?.() }

  // Assign the parsed slugs to the rendered heading elements in document order.
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const elements = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')]
    for (let index = 0; index < elements.length; index += 1) {
      const heading = headings[index]
      if (heading === undefined) break
      if (elements[index].id !== heading.slug) elements[index].id = heading.slug
    }
  }, [headingKey, MarkdownText])

  // Follow the scroll position with the outline highlight.
  useEffect(() => {
    const container = containerRef.current
    if (container === null || outlineOpen !== true) return undefined
    let frame = 0
    const update = () => {
      frame = 0
      const elements = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      const base = container.getBoundingClientRect().top - container.scrollTop
      let current = ''
      for (const element of elements) {
        const top = element.getBoundingClientRect().top - base
        if (top <= 64) current = element.id
        else break
      }
      setActiveSlug(current)
    }
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update)
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => {
      container.removeEventListener('scroll', onScroll)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [outlineOpen, headingKey, MarkdownText])

  const jump = (slug) => {
    const container = containerRef.current
    if (container === null) return
    const target = [...container.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(element => element.id === slug)
    if (target !== undefined) {
      const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 12
      container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
      setActiveSlug(slug)
    }
  }

  return React.createElement('div', {
    className: 'iwb-markdown-wrap',
    // Fallback for focus that stays inside the preview (links, copy buttons).
    // The editor area owns the shortcut when focus fell back to document.body.
    onKeyDown: (event) => {
      const mod = event.ctrlKey || event.metaKey
      if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        event.stopPropagation()
        openFind()
      } else if (event.key === 'F3' && !mod) {
        event.preventDefault()
        event.stopPropagation()
        openFind()
      }
    },
  },
    findOpen === true
      ? React.createElement(DomFindBar, { containerRef, t, onClose: () => onCloseFind?.() })
      : null,
    React.createElement('div', { className: 'iwb-markdown', ref: containerRef },
      MarkdownText !== null
        ? React.createElement(MarkdownText, { text, labels: markdownLabels(labels) })
        : React.createElement(FallbackMarkdown, { text }),
    ),
    outlineOpen === true
      ? React.createElement('div', { className: 'iwb-outline', role: 'navigation', 'aria-label': labels.outline ?? 'Outline' },
          React.createElement('div', { className: 'iwb-outline-head' },
            React.createElement(IconOutline, { width: 13, height: 13 }),
            React.createElement('span', null, labels.outline ?? 'Outline'),
            React.createElement('button', {
              type: 'button', className: 'iwb-iconbtn', style: { width: 20, height: 20, marginLeft: 'auto' },
              onClick: onToggleOutline, title: labels.close ?? 'Close',
            }, React.createElement('span', { style: { fontSize: 14, lineHeight: 1 } }, '×')),
          ),
          headings.length === 0
            ? React.createElement('div', { className: 'iwb-outline-empty' }, labels.empty ?? 'No headings')
            : React.createElement('div', { className: 'iwb-outline-list' },
                headings.map((heading, index) => React.createElement('button', {
                  key: `${heading.slug}-${index}`,
                  type: 'button',
                  className: `iwb-outline-item ${activeSlug === heading.slug ? 'iwb-active' : ''}`,
                  style: { paddingLeft: `${8 + (heading.level - 1) * 12}px` },
                  onClick: () => jump(heading.slug),
                }, heading.text)),
              ),
        )
      : null,
  )
}
