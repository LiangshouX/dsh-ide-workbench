/**
 * Inline SVG icon set (16px grid, stroke = currentColor unless the artwork is
 * a colored file-type mark). No external icon font or package.
 */
import React from 'react'
import { fileTypeOf } from './file-types.js'

const S = { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true }

function svg(children, props = {}) {
  return React.createElement('svg', { ...S, ...props }, children)
}

function path(d, extra = {}) {
  return React.createElement('path', { key: extra.key ?? 'p', d, fill: 'none', stroke: 'currentColor', strokeWidth: 1.35, strokeLinecap: 'round', strokeLinejoin: 'round', ...extra })
}

export function IconProject(props = {}) {
  return svg([
    React.createElement('path', { key: 'a', d: 'M1.8 4.2h4l1.3 1.6h7.1v6.9H1.8z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.35, strokeLinejoin: 'round' }),
    path('M1.8 7.2h12.4', { key: 'b' }),
    path('M4.4 10h2.2', { key: 'c' }),
  ], props)
}

export function IconCommit(props = {}) {
  return svg([
    React.createElement('circle', { key: 'a', cx: 4, cy: 8, r: 1.8, fill: 'none', stroke: 'currentColor', strokeWidth: 1.35 }),
    path('M5.8 8h7.6', { key: 'b' }),
    React.createElement('circle', { key: 'c', cx: 11.4, cy: 8, r: 1.8, fill: 'none', stroke: 'currentColor', strokeWidth: 1.35 }),
    path('M8.8 6.6l1.1 1.1 2-2.2', { key: 'd' }),
  ], props)
}

export function IconGit(props = {}) {
  return svg([
    React.createElement('circle', { key: 'a', cx: 8, cy: 3.2, r: 1.7, fill: 'none', stroke: 'currentColor', strokeWidth: 1.35 }),
    path('M8 4.9v3', { key: 'b' }),
    React.createElement('circle', { key: 'c', cx: 3.6, cy: 11.3, r: 1.7, fill: 'none', stroke: 'currentColor', strokeWidth: 1.35 }),
    React.createElement('circle', { key: 'd', cx: 12.4, cy: 11.3, r: 1.7, fill: 'none', stroke: 'currentColor', strokeWidth: 1.35 }),
    path('M8 7.9L4.2 9.8', { key: 'e' }),
    path('M8 7.9l3.8 1.9', { key: 'f' }),
    path('M8 7.9v0', { key: 'g' }),
  ], props)
}

export function IconTerminal(props = {}) {
  return svg([
    React.createElement('rect', { key: 'a', x: 1.6, y: 2.4, width: 12.8, height: 11.2, rx: 1.6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.35 }),
    path('M4.4 6.2L6.6 8l-2.2 1.8', { key: 'b' }),
    path('M8.7 10h2.9', { key: 'c' }),
  ], props)
}

export function IconChat(props = {}) {
  return svg([
    React.createElement('path', {
      key: 'a',
      d: 'M2.6 2.8h10.8a1.2 1.2 0 0 1 1.2 1.2v6a1.2 1.2 0 0 1-1.2 1.2H6.8l-3 2.4v-2.4H2.6a1.2 1.2 0 0 1-1.2-1.2v-6a1.2 1.2 0 0 1 1.2-1.2z',
      fill: 'none', stroke: 'currentColor', strokeWidth: 1.35, strokeLinejoin: 'round',
    }),
    path('M4.8 5.9h6.4', { key: 'b' }),
    path('M4.8 8.2h4.2', { key: 'c' }),
  ], props)
}

export function IconRefresh(props = {}) {
  return svg([
    path('M13 8a5 5 0 1 1-1.6-3.7', { key: 'a' }),
    path('M13.2 2.4v3.2H10', { key: 'b' }),
  ], props)
}

export function IconClose(props = {}) {
  return svg([path('M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8', props)])
}

export function IconPlus(props = {}) {
  return svg([path('M8 3v10M3 8h10', props)])
}

export function IconChevron(props = {}) {
  const down = props.down === true
  return svg([path(down ? 'M4 6l4 4 4-4' : 'M6 4l4 4-4 4', props)], { style: { transform: down ? 'none' : 'none' } })
}

export function IconSearch(props = {}) {
  return svg([
    React.createElement('circle', { key: 'a', cx: 7, cy: 7, r: 4.2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.35 }),
    path('M10.1 10.1l3.1 3.1', { key: 'b' }),
  ], props)
}

export function IconGear(props = {}) {
  return svg([
    React.createElement('circle', { key: 'a', cx: 8, cy: 8, r: 2.4, fill: 'none', stroke: 'currentColor', strokeWidth: 1.35 }),
    path('M8 1.6v1.9M8 12.5v1.9M1.6 8h1.9M12.5 8h1.9M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3', { key: 'b' }),
  ], props)
}

export function IconCopy(props = {}) {
  return svg([
    React.createElement('rect', { key: 'a', x: 5.4, y: 5.4, width: 8.2, height: 8.2, rx: 1.3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }),
    path('M10.6 5.2V3.8c0-.7-.6-1.3-1.3-1.3H3.8c-.7 0-1.3.6-1.3 1.3v5.5c0 .7.6 1.3 1.3 1.3h1.4', { key: 'b' }),
  ], props)
}

export function IconExternal(props = {}) {
  return svg([
    path('M9 2.6h4.4v4.4', { key: 'a' }),
    path('M13.2 2.8L8 8', { key: 'b' }),
    path('M11.6 9.4v3.2c0 .5-.4.9-.9.9H3.5c-.5 0-.9-.4-.9-.9V5.4c0-.5.4-.9.9-.9h3.2', { key: 'c' }),
  ], props)
}

export function IconPin(props = {}) {
  return svg([
    React.createElement('circle', { key: 'a', cx: 8, cy: 8, r: 2.2, fill: 'currentColor' }),
  ], props)
}

export function IconWarning(props = {}) {
  return svg([
    path('M8 2.2l6 11.2H2z', { key: 'a' }),
    path('M8 6.4v3.1', { key: 'b' }),
    React.createElement('circle', { key: 'c', cx: 8, cy: 11.6, r: 0.7, fill: 'currentColor', stroke: 'none' }),
  ], props)
}

export function IconCheck(props = {}) {
  return svg([path('M2.8 8.4l3.2 3.2 7.2-7.4', props)])
}

export function IconMore(props = {}) {
  return svg([
    React.createElement('circle', { key: 'a', cx: 3.4, cy: 8, r: 1.15, fill: 'currentColor', stroke: 'none' }),
    React.createElement('circle', { key: 'b', cx: 8, cy: 8, r: 1.15, fill: 'currentColor', stroke: 'none' }),
    React.createElement('circle', { key: 'c', cx: 12.6, cy: 8, r: 1.15, fill: 'currentColor', stroke: 'none' }),
  ], props)
}

export function IconBranch(props = {}) {
  return svg([
    React.createElement('circle', { key: 'a', cx: 4.6, cy: 3.4, r: 1.4, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }),
    React.createElement('circle', { key: 'b', cx: 4.6, cy: 12.6, r: 1.4, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }),
    React.createElement('circle', { key: 'c', cx: 11.4, cy: 6.2, r: 1.4, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }),
    path('M4.6 4.8v6.4', { key: 'd' }),
    path('M4.6 8.4c0-2.4 1.4-3.6 3.4-3.6h2.2', { key: 'e' }),
  ], props)
}

export function IconFolder(props = {}) {
  const open = props.open === true
  return svg([
    React.createElement('path', {
      key: 'a',
      d: open
        ? 'M1.7 4.3h4.1l1.2 1.5h7.2l-1.7 7H2.6z'
        : 'M1.7 4.1h4.2l1.2 1.5h7.2v7.1H1.7z',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinejoin: 'round',
    }),
  ], {
    width: props.width ?? props.size ?? 16,
    height: props.height ?? props.size ?? 16,
    style: { color: 'var(--iwb-icon-folder, #d7a24a)', ...(props.style ?? {}) },
  })
}

/** Visual family of one file name — see `file-types.js`. */

const FILE_TINTS = {
  java: '#b0722e',
  ts: '#3178c6',
  tsx: '#3178c6',
  js: '#c99700',
  jsx: '#c99700',
  python: '#3572a5',
  go: '#0090b0',
  rust: '#b35a2a',
  json: '#4b5563',
  markdown: '#2f6fd0',
  html: '#d84315',
  css: '#7b1fa2',
  sql: '#bf6a00',
  shell: '#2e7d32',
  config: '#6f42c1',
  image: '#558b2f',
  svg: '#8e44ad',
  pdf: '#c62828',
  archive: '#8d6e63',
  lock: '#2e7d4f',
  git: '#c2185b',
  docker: '#0d6efd',
  env: '#8d6e63',
  build: '#558b2f',
  c: '#1565c0',
  cpp: '#5e35b1',
  csharp: '#2e7d4f',
  ruby: '#c62828',
  php: '#5e35b1',
  kotlin: '#7b1fa2',
  swift: '#b35a2a',
  vue: '#2e8b57',
  xml: '#558b2f',
  log: '#6b7280',
  file: 'var(--iwb-icon-file, #6b7280)',
}

function monoLabel(text, tint, size = 4.6) {
  return React.createElement('text', {
    x: 7.95,
    y: 12.7,
    textAnchor: 'middle',
    fontSize: size,
    fontWeight: 700,
    fill: tint,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  }, text)
}

/** The type mark drawn inside the page's lower half. */
function typeGlyph(kind, tint) {
  switch (kind) {
    case 'java':
      return [
        React.createElement('path', { key: 'cup', d: 'M5.4 9.5h4.3v1.7a2.1 2.1 0 0 1-2.1 2.1h-.1a2.1 2.1 0 0 1-2.1-2.1z', fill: 'none', stroke: tint, strokeWidth: 1.15, strokeLinejoin: 'round' }),
        React.createElement('path', { key: 'handle', d: 'M9.7 10.1h.6a1.05 1.05 0 0 1 0 2.1h-.6', fill: 'none', stroke: tint, strokeWidth: 1.1 }),
        React.createElement('path', { key: 'saucer', d: 'M4.7 13.5h6.5', stroke: tint, strokeWidth: 1.2, strokeLinecap: 'round' }),
        React.createElement('path', { key: 'steam1', d: 'M6.4 8.7c.35-.55-.2-.9-.1-1.35', stroke: tint, strokeWidth: 1, strokeLinecap: 'round', fill: 'none' }),
        React.createElement('path', { key: 'steam2', d: 'M8.2 8.7c.35-.55-.2-.9-.1-1.35', stroke: tint, strokeWidth: 1, strokeLinecap: 'round', fill: 'none' }),
      ]
    case 'python':
      return [
        React.createElement('path', { key: 's1', d: 'M5.2 9.7c1.65 0 1.65 1.15 2.9 1.15s1.25-1.15 2.9-1.15', fill: 'none', stroke: '#5aa9dd', strokeWidth: 1.5, strokeLinecap: 'round' }),
        React.createElement('path', { key: 's2', d: 'M5.2 11.5c1.65 0 1.65 1.15 2.9 1.15s1.25-1.15 2.9-1.15', fill: 'none', stroke: '#e8c244', strokeWidth: 1.5, strokeLinecap: 'round' }),
        React.createElement('circle', { key: 'eye1', cx: 5.3, cy: 9.7, r: 0.55, fill: '#e8c244' }),
        React.createElement('circle', { key: 'eye2', cx: 10.8, cy: 12.65, r: 0.55, fill: '#5aa9dd' }),
      ]
    case 'markdown':
      return [
        React.createElement('path', { key: 'm', d: 'M4.9 12.6V9.3l1.55 1.8 1.55-1.8v3.3', fill: 'none', stroke: tint, strokeWidth: 1.25, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        React.createElement('path', { key: 'a', d: 'M10.5 9.3v3.3M9.3 11.4l1.2 1.25 1.2-1.25', fill: 'none', stroke: tint, strokeWidth: 1.15, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      ]
    case 'json':
      return [monoLabel('{}', tint, 5.2)]
    case 'ts':
      return [monoLabel('TS', tint, 4.4)]
    case 'tsx':
      return [
        monoLabel('TS', tint, 4),
        React.createElement('circle', { key: 'atom', cx: 10.7, cy: 9.4, r: 0.55, fill: tint }),
      ]
    case 'js':
      return [monoLabel('JS', '#b9962c', 4.4)]
    case 'jsx':
      return [
        React.createElement('circle', { key: 'atom', cx: 7.95, cy: 10.9, r: 0.7, fill: '#e8c244' }),
        React.createElement('ellipse', { key: 'o1', cx: 7.95, cy: 10.9, rx: 2.6, ry: 1.05, fill: 'none', stroke: '#e8c244', strokeWidth: 0.8, transform: 'rotate(30 7.95 10.9)' }),
        React.createElement('ellipse', { key: 'o2', cx: 7.95, cy: 10.9, rx: 2.6, ry: 1.05, fill: 'none', stroke: '#e8c244', strokeWidth: 0.8, transform: 'rotate(-30 7.95 10.9)' }),
      ]
    case 'go':
      return [monoLabel('GO', tint, 4.2)]
    case 'rust':
      return [
        React.createElement('circle', { key: 'gear', cx: 7.95, cy: 11, r: 2.2, fill: 'none', stroke: tint, strokeWidth: 1.1, strokeDasharray: '1.1 0.8' }),
        React.createElement('text', { key: 'r', x: 7.95, y: 12.6, textAnchor: 'middle', fontSize: 4.4, fontWeight: 700, fill: tint, fontFamily: 'ui-monospace, monospace' }, 'R'),
      ]
    case 'html':
      return [monoLabel('</>', tint, 4.1)]
    case 'css':
      return [monoLabel('#', tint, 6.2)]
    case 'sql':
      return [
        React.createElement('ellipse', { key: 'top', cx: 7.95, cy: 9.6, rx: 2.8, ry: 0.95, fill: 'none', stroke: tint, strokeWidth: 1 }),
        React.createElement('path', { key: 'side', d: 'M5.15 9.6v2.7c0 .55 1.25 1 2.8 1s2.8-.45 2.8-1V9.6', fill: 'none', stroke: tint, strokeWidth: 1 }),
        React.createElement('path', { key: 'mid', d: 'M5.15 11c0 .55 1.25 1 2.8 1s2.8-.45 2.8-1', fill: 'none', stroke: tint, strokeWidth: 0.85 }),
      ]
    case 'shell':
      return [monoLabel('>_', '#4f9a52', 4.6)]
    case 'config':
      return [monoLabel('Y', tint, 5.6)]
    case 'image':
      return [
        React.createElement('rect', { key: 'frame', x: 4.6, y: 9, width: 6.7, height: 4.6, rx: 0.7, fill: 'none', stroke: tint, strokeWidth: 1 }),
        React.createElement('circle', { key: 'sun', cx: 6.2, cy: 10.4, r: 0.7, fill: tint }),
        React.createElement('path', { key: 'mount', d: 'M4.9 13.2l1.9-2.2 1.4 1.5 1.2-1.2 1.6 1.9', fill: 'none', stroke: tint, strokeWidth: 1, strokeLinejoin: 'round' }),
      ]
    case 'svg':
      return [
        React.createElement('path', { key: 'a', d: 'M5 11.6c.4-2 1.2-2.8 1.6-1.4.4 1.4 1.2.6 1.6-1.4', fill: 'none', stroke: tint, strokeWidth: 1.1, strokeLinecap: 'round' }),
        React.createElement('circle', { key: 'b', cx: 9.4, cy: 9.7, r: 0.9, fill: 'none', stroke: tint, strokeWidth: 1 }),
      ]
    case 'pdf':
      return [monoLabel('PDF', tint, 3.7)]
    case 'archive':
      return [
        React.createElement('rect', { key: 'box', x: 4.6, y: 9, width: 6.7, height: 4.6, rx: 0.6, fill: 'none', stroke: tint, strokeWidth: 1 }),
        React.createElement('path', { key: 'zip', d: 'M8 9v4.6', stroke: tint, strokeWidth: 1, strokeDasharray: '1 0.9' }),
      ]
    case 'lock':
      return [
        React.createElement('rect', { key: 'body', x: 4.9, y: 10.5, width: 6.1, height: 3.3, rx: 0.7, fill: 'none', stroke: tint, strokeWidth: 1.1 }),
        React.createElement('path', { key: 'shackle', d: 'M6.1 10.4V9.2a1.85 1.85 0 0 1 3.7 0v1.2', fill: 'none', stroke: tint, strokeWidth: 1.1 }),
        React.createElement('circle', { key: 'key', cx: 7.95, cy: 12.1, r: 0.55, fill: tint }),
      ]
    case 'git':
      return [
        React.createElement('circle', { key: 'n1', cx: 6, cy: 9.4, r: 0.8, fill: 'none', stroke: tint, strokeWidth: 0.9 }),
        React.createElement('circle', { key: 'n2', cx: 6, cy: 13.2, r: 0.8, fill: 'none', stroke: tint, strokeWidth: 0.9 }),
        React.createElement('circle', { key: 'n3', cx: 10, cy: 10.9, r: 0.8, fill: 'none', stroke: tint, strokeWidth: 0.9 }),
        React.createElement('path', { key: 'ln', d: 'M6 10.2v2.2M6 11.2c0-1.3.9-2 2.1-2h1.1', fill: 'none', stroke: tint, strokeWidth: 0.9 }),
      ]
    case 'docker':
      return [
        React.createElement('rect', { key: 'b1', x: 5, y: 10.7, width: 1.9, height: 1.6, fill: 'none', stroke: tint, strokeWidth: 0.9 }),
        React.createElement('rect', { key: 'b2', x: 7.2, y: 10.7, width: 1.9, height: 1.6, fill: 'none', stroke: tint, strokeWidth: 0.9 }),
        React.createElement('rect', { key: 'b3', x: 7.2, y: 8.9, width: 1.9, height: 1.5, fill: 'none', stroke: tint, strokeWidth: 0.9 }),
        React.createElement('path', { key: 'w', d: 'M4.9 13.4c2.2.7 4.6.4 5.9-.5 1-.7 1.4-1.6 1.4-1.6', fill: 'none', stroke: tint, strokeWidth: 0.9, strokeLinecap: 'round' }),
      ]
    case 'env':
      return [
        React.createElement('circle', { key: 'ring', cx: 6.2, cy: 10.3, r: 1.1, fill: 'none', stroke: tint, strokeWidth: 1.1 }),
        React.createElement('path', { key: 'stem', d: 'M7.2 11.2l2.8 2.6M9.1 13l.9.9M9.9 12.2l.9.9', fill: 'none', stroke: tint, strokeWidth: 1, strokeLinecap: 'round' }),
      ]
    case 'build':
      return [
        React.createElement('path', { key: 'wrench', d: 'M5 12.9l4.7-4.7M8.9 7.2a1.7 1.7 0 1 1 2.3 2.3', fill: 'none', stroke: tint, strokeWidth: 1.1, strokeLinecap: 'round' }),
      ]
    case 'c':
      return [monoLabel('C', tint, 5.8)]
    case 'cpp':
      return [monoLabel('C++', tint, 3.7)]
    case 'csharp':
      return [monoLabel('C#', tint, 4.2)]
    case 'ruby':
      return [
        React.createElement('path', { key: 'gem', d: 'M5.3 9.1h5.3l1 1.1-3.65 3.6-3.65-3.6z', fill: 'none', stroke: tint, strokeWidth: 1, strokeLinejoin: 'round' }),
        React.createElement('path', { key: 'cut', d: 'M5.3 10.2h5.3', stroke: tint, strokeWidth: 0.9 }),
      ]
    case 'php':
      return [monoLabel('php', tint, 3.9)]
    case 'kotlin':
      return [monoLabel('K', tint, 5.8)]
    case 'swift':
      return [monoLabel('S', tint, 5.6)]
    case 'vue':
      return [monoLabel('V', tint, 5.6)]
    case 'xml':
      return [monoLabel('<>', tint, 4.6)]
    case 'log':
      return [
        React.createElement('path', { key: 'l1', d: 'M5.2 9.6h5.6M5.2 11.2h4.2M5.2 12.8h3', stroke: tint, strokeWidth: 0.95, strokeLinecap: 'round' }),
      ]
    default: {
      // Unknown extension: a couple of text lines (generic file).
      return [
        React.createElement('path', { key: 'l1', d: 'M5.4 9.4h5.1M5.4 11.2h3.8M5.4 13h4.6', stroke: tint, strokeWidth: 0.9, strokeLinecap: 'round' }),
      ]
    }
  }
}

export function FileTypeIcon(props = {}) {
  const name = typeof props.name === 'string' ? props.name : ''
  if (props.isDir === true) return React.createElement(IconFolder, { open: props.open === true, size: props.size ?? 15 })
  const kind = fileTypeOf(name)
  const tint = FILE_TINTS[kind] ?? FILE_TINTS.file
  const size = props.size ?? 16
  // Rounded tile + glyph, matching the DSH sidebar's badge style.
  return svg([
    React.createElement('rect', {
      key: 'bg',
      x: 1.4, y: 1.4, width: 13.2, height: 13.2, rx: 3.2,
      fill: tint, fillOpacity: 0.16, stroke: tint, strokeOpacity: 0.28, strokeWidth: 0.6,
    }),
    React.createElement('g', { key: 'glyph', transform: 'translate(-4.2 -8.2) scale(1.5)' }, ...typeGlyph(kind, tint)),
  ], { width: size, height: size })
}

export function IconLock(props = {}) {
  return svg([
    React.createElement('rect', { key: 'body', x: 3.2, y: 7.2, width: 9.6, height: 6.4, rx: 1.4, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }),
    path('M5.4 7V5.6a2.6 2.6 0 0 1 5.2 0V7', { key: 'shackle' }),
    React.createElement('circle', { key: 'dot', cx: 8, cy: 10.4, r: 0.9, fill: 'currentColor' }),
  ], props)
}

export function IconEdit(props = {}) {
  return svg([
    path('M3.2 12.8l.7-3 7.3-7.3 2.3 2.3-7.3 7.3z', { key: 'pencil' }),
    path('M9.9 3.8l2.3 2.3', { key: 'tip' }),
    path('M3.2 12.8l3 -.7', { key: 'cut' }),
  ], props)
}

export function IconSave(props = {}) {
  return svg([
    path('M2.8 2.8h9.1l1.3 1.3v9.1H2.8z', { key: 'body' }),
    path('M5 2.8v3.6h5.2V2.8', { key: 'top' }),
    React.createElement('rect', { key: 'label', x: 5, y: 9.2, width: 6, height: 3.8, rx: 0.5, fill: 'none', stroke: 'currentColor', strokeWidth: 1.1 }),
  ], props)
}

export function IconEye(props = {}) {
  return svg([
    path('M1.6 8s2.3-4.4 6.4-4.4S14.4 8 14.4 8s-2.3 4.4-6.4 4.4S1.6 8 1.6 8z', { key: 'eye' }),
    React.createElement('circle', { key: 'pupil', cx: 8, cy: 8, r: 2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }),
  ], props)
}

export function IconCode(props = {}) {
  return svg([
    path('M5.6 4.4L2 8l3.6 3.6', { key: 'left' }),
    path('M10.4 4.4L14 8l-3.6 3.6', { key: 'right' }),
    path('M9.2 2.8l-2.4 10.4', { key: 'slash' }),
  ], props)
}

export function IconOutline(props = {}) {
  return svg([
    path('M2.6 3.6h2M6.2 3.6h7.2', { key: 'h1' }),
    path('M2.6 7h2M6.2 7h5.4', { key: 'h2' }),
    path('M2.6 10.4h2M6.2 10.4h6.6', { key: 'h3' }),
    path('M2.6 13.4h2M6.2 13.4h4.2', { key: 'h4' }),
  ], props)
}

export function IconRestore(props = {}) {
  return svg([
    path('M2.8 8a5.2 5.2 0 1 0 1.6-3.8', { key: 'arc' }),
    path('M2.6 2.6v3.2h3.2', { key: 'arrow' }),
  ], props)
}

/** DSH's sidebar-browser guide glyph: a globe. */
export function IconGlobe(props = {}) {
  return svg([
    React.createElement('circle', { key: 'c', cx: 8, cy: 8, r: 6.2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.35 }),
    path('M1.8 8h12.4M8 1.8c2.4 2 2.4 10.4 0 12.4M8 1.8c-2.4 2-2.4 10.4 0 12.4', { key: 'g' }),
  ], props)
}

/** Google Chrome mark (Simple Icons path) for "open in default browser". */
export function IconChrome(props = {}) {
  return React.createElement('svg', {
    xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', width: 16, height: 16,
    'aria-hidden': true, ...props,
  }, React.createElement('path', {
    fill: 'currentColor',
    d: 'M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-5.344 9.257c.206.01.413.016.621.016 6.627 0 12-5.373 12-12 0-1.54-.29-3.011-.818-4.364zM12 16.364a4.364 4.364 0 1 1 0-8.728 4.364 4.364 0 0 1 0 8.728z',
  }))
}

/** Stripe icon switch used by the left rail. */
export function StripeIcon(props = {}) {
  const size = props.size ?? 20
  const common = { width: size, height: size }
  switch (props.tool) {
    case 'project': return React.createElement(IconProject, common)
    case 'commit': return React.createElement(IconCommit, common)
    case 'git': return React.createElement(IconGit, common)
    case 'terminal': return React.createElement(IconTerminal, common)
    default: return React.createElement(IconProject, common)
  }
}
