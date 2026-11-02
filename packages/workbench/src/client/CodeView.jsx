/**
 * Read-only code viewer: virtualized lines (fixed 20px rows), line numbers,
 * and a small per-family syntax tokenizer. Large files stay responsive because
 * only the visible window is mounted.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'

const LINE_HEIGHT = 20

const KEYWORDS = {
  js: new Set('const let var function return if else for while do switch case break continue class extends new this super import export from default async await try catch finally throw typeof instanceof in of delete void yield static get set null undefined true false interface type enum implements public private protected readonly declare namespace as'.split(' ')),
  py: new Set('def class return if elif else for while import from as pass break continue try except finally raise with lambda yield global nonlocal assert del in is not and or None True False async await'.split(' ')),
  json: new Set('true false null'.split(' ')),
  sh: new Set('if then else fi for while do done case esac function return local export echo cd source alias unset set'.split(' ')),
  sql: new Set('select from where insert into values update set delete create table drop alter join left right inner outer on group by order having limit offset distinct as and or not null union all'.split(' ')),
  yaml: new Set('true false null yes no on off'.split(' ')),
}

function familyOf(path) {
  const lower = String(path).toLowerCase()
  const dot = lower.lastIndexOf('.')
  const ext = dot < 0 ? '' : lower.slice(dot)
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'].includes(ext)) return 'js'
  if (ext === '.json' || ext === '.jsonc') return 'json'
  if (['.py', '.pyw'].includes(ext)) return 'py'
  if (['.sh', '.bash', '.zsh', '.ps1', '.psm1', '.bat', '.cmd'].includes(ext)) return 'sh'
  if (['.css', '.scss', '.less'].includes(ext)) return 'css'
  if (['.html', '.htm', '.xml', '.svg', '.vue'].includes(ext)) return 'html'
  if (['.md', '.markdown'].includes(ext)) return 'md'
  if (['.yml', '.yaml', '.toml', '.ini', '.properties'].includes(ext)) return 'yaml'
  if (['.sql'].includes(ext)) return 'sql'
  if (['.c', '.h', '.cpp', '.hpp', '.cc', '.cs', '.java', '.kt', '.go', '.rs', '.swift', '.m', '.mm'].includes(ext)) return 'c'
  return 'txt'
}

const JS_STRING = /^"(?:[^"\\]|\\.)*"?|^'(?:[^'\\]|\\.)*'?|^`(?:[^`\\]|\\.)*`?/
const NUMBER = /^\b(?:0[xX][0-9a-fA-F]+|0[bB][01]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/
const IDENT = /^[A-Za-z_$][\w$]*/

/** Tokenize one line into `[text, className]` runs. */
function tokenize(line, family) {
  if (family === 'txt' || line === '') return [[line, '']]
  if (family === 'md') {
    if (/^\s*#{1,6}\s/.test(line)) return [[line, 'iwb-tok-keyword']]
    if (/^\s*>/.test(line)) return [[line, 'iwb-tok-comment']]
    return [[line, '']]
  }
  if (family === 'html') return tokenizeHtml(line)
  const out = []
  let index = 0
  const push = (text, cls) => { if (text !== '') out.push([text, cls]) }
  while (index < line.length) {
    const rest = line.slice(index)
    if (family === 'json') {
      const jsonString = /^"(?:[^"\\]|\\.)*"?/.exec(rest)
      if (jsonString !== null) { push(jsonString[0], 'iwb-tok-string'); index += jsonString[0].length; continue }
    }
    if (rest.startsWith('//') && ['js', 'c', 'css', 'sql'].includes(family)) { push(rest, 'iwb-tok-comment'); break }
    if (family === 'py' || family === 'sh' || family === 'yaml') {
      const hash = rest.indexOf('#')
      if (hash === 0) { push(rest, 'iwb-tok-comment'); break }
    }
    if (family === 'sql' && rest.startsWith('--')) { push(rest, 'iwb-tok-comment'); break }
    const string = JS_STRING.exec(rest)
    if (string !== null && string[0] !== '') { push(string[0], 'iwb-tok-string'); index += string[0].length; continue }
    const number = NUMBER.exec(rest)
    if (number !== null && number[0] !== '') { push(number[0], 'iwb-tok-number'); index += number[0].length; continue }
    const ident = IDENT.exec(rest)
    if (ident !== null && ident[0] !== '') {
      const word = ident[0]
      const after = rest.slice(word.length)
      let cls = ''
      if (KEYWORDS[family]?.has(word)) cls = 'iwb-tok-keyword'
      else if (/^\s*\(/.test(after)) cls = 'iwb-tok-fn'
      else if (/^[A-Z]/.test(word) && family !== 'json') cls = 'iwb-tok-type'
      push(word, cls)
      index += word.length
      continue
    }
    push(rest[0], '')
    index += 1
  }
  return out
}

/** HTML/XML: tags, attribute names, strings and comments. */
function tokenizeHtml(line) {
  const out = []
  const regex = /(<!--.*?-->)|(<\/?)([A-Za-z][\w:-]*)([^>]*?)(\/?>)/g
  let last = 0
  let match
  while ((match = regex.exec(line)) !== null) {
    if (match.index > last) out.push([line.slice(last, match.index), ''])
    if (match[1] !== undefined) out.push([match[1], 'iwb-tok-comment'])
    else {
      out.push([match[2], 'iwb-tok-comment'])
      out.push([match[3], 'iwb-tok-tag'])
      const attrs = match[4] ?? ''
      let cursor = 0
      const attrRegex = /([A-Za-z_:][\w:.-]*)(\s*=\s*)("(?:[^"]*)"|'(?:[^']*)')?/g
      let attr
      while ((attr = attrRegex.exec(attrs)) !== null) {
        if (attr.index > cursor) out.push([attrs.slice(cursor, attr.index), ''])
        out.push([attr[1], 'iwb-tok-attr'])
        if (attr[2] !== undefined) out.push([attr[2], ''])
        if (attr[3] !== undefined) out.push([attr[3], 'iwb-tok-string'])
        cursor = attr.index + attr[0].length
      }
      if (cursor < attrs.length) out.push([attrs.slice(cursor), ''])
      out.push([match[5], 'iwb-tok-comment'])
    }
    last = match.index + match[0].length
  }
  if (last < line.length) out.push([line.slice(last), ''])
  return out
}

const tokenCache = new Map()

function tokensFor(line, family) {
  const key = `${family}\u0000${line}`
  const cached = tokenCache.get(key)
  if (cached !== undefined) return cached
  const tokens = tokenize(line, family)
  if (tokenCache.size > 4000) tokenCache.clear()
  tokenCache.set(key, tokens)
  return tokens
}

export function CodeView({ content, path, fontSize = 13, highlight = true, initialScrollTop = 0, onScrollTop }) {
  const text = typeof content === 'string' ? content : ''
  const lines = useMemo(() => text.split('\n'), [text])
  const family = useMemo(() => familyOf(path), [path])
  const scrollRef = useRef(null)
  const [scrollTop, setScrollTop] = useState(initialScrollTop)
  const [viewport, setViewport] = useState(400)
  const lineHeight = Math.max(18, Math.round(fontSize * 1.55))

  useEffect(() => {
    const element = scrollRef.current
    if (element === null) return undefined
    element.scrollTop = initialScrollTop
    const observer = new ResizeObserver(() => setViewport(element.clientHeight))
    observer.observe(element)
    setViewport(element.clientHeight)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  const total = lines.length * lineHeight
  const start = Math.max(0, Math.floor(scrollTop / lineHeight) - 8)
  const end = Math.min(lines.length, Math.ceil((scrollTop + viewport) / lineHeight) + 8)
  const digits = String(lines.length).length
  const gutter = Math.max(42, digits * 8 + 22)

  return React.createElement('div', {
    className: 'iwb-code',
    ref: scrollRef,
    style: { '--iwb-line': `${lineHeight}px`, '--iwb-gutter': `${gutter}px`, fontSize: `${fontSize}px` },
    onScroll: event => {
      const top = event.currentTarget.scrollTop
      setScrollTop(top)
      onScrollTop?.(top)
    },
  },
    React.createElement('div', { className: 'iwb-code-inner', style: { height: `${total}px` } },
      Array.from({ length: Math.max(0, end - start) }, (_, offset) => {
        const lineIndex = start + offset
        const rawLine = (lines[lineIndex] ?? '').replace(/\r$/, '')
        return React.createElement('div', {
          key: lineIndex,
          className: 'iwb-code-line',
          style: { position: 'absolute', top: `${lineIndex * lineHeight}px`, left: 0, right: 0 },
        },
          React.createElement('span', { className: 'iwb-ln' }, String(lineIndex + 1)),
          React.createElement('span', { className: 'iwb-code-text' },
            highlight
              ? tokensFor(rawLine, family).map(([piece, cls], tokenIndex) => (cls === ''
                  ? piece
                  : React.createElement('span', { key: tokenIndex, className: cls }, piece)))
              : rawLine,
            rawLine === '' ? '\u00a0' : null,
          ),
        )
      }),
    ),
  )
}
