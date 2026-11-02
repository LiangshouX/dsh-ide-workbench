/**
 * The few icons of the code intelligence plugin.
 *
 * The plugin draws a search glyph and the mark of a file. It does not use the
 * artwork of the IDE workbench (the plugin may not import anything from the
 * core), and it does not need the host primitives either: the search popup is
 * a self-contained float above the editor.
 */
import React from 'react'

/**
 * One SVG path of an icon.
 * @param {string} d the path data
 * @param {object} props the props of the path
 * @returns {React.ReactElement} the path
 */
function path(d, props) {
  return React.createElement('path', {
    d,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.35,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    ...props,
  })
}

/**
 * The SVG element of an icon.
 * @param {Array<React.ReactElement>} children the parts of the icon
 * @param {object} props the props of the icon
 * @returns {React.ReactElement} the icon
 */
function svg(children, props = {}) {
  const { size = 16, className = '', ...rest } = props
  return React.createElement('svg', {
    viewBox: '0 0 16 16',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    'aria-hidden': true,
    className,
    ...rest,
  }, children)
}

/**
 * The glyph of the search.
 * @param {object} props the props of the icon
 * @returns {React.ReactElement} the icon
 */
export function IconSearch(props = {}) {
  return svg([
    React.createElement('circle', { key: 'a', cx: 7, cy: 7, r: 4.2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.35 }),
    path('M10.1 10.1l3.1 3.1', { key: 'b' }),
  ], props)
}

/**
 * The colour of the mark of a file, by its extension.
 *
 * The palette is the one of the host (`--dsw-*` tokens), so the mark follows
 * the skin of the IDE instead of carrying a second, hard-coded colour set.
 * @param {string} path the path of the file
 * @returns {string} the CSS colour
 */
function colorOf(path) {
  const name = typeof path === 'string' ? path.toLowerCase() : ''
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return 'var(--dsw-accent, #4c9aff)'
  if (name.endsWith('.js') || name.endsWith('.jsx')) return 'var(--dsw-warning, #e2b93b)'
  if (name.endsWith('.java')) return 'var(--dsw-danger, #e5534b)'
  if (name.endsWith('.json') || name.endsWith('.yaml') || name.endsWith('.yml')) return 'var(--dsw-success, #57ab5a)'
  if (name.endsWith('.md')) return 'var(--dsw-fg-muted, #8b949e)'
  return 'var(--dsw-fg-muted, #8b949e)'
}

/**
 * The mark of a file.
 *
 * The host ships a `FileTypeIcon` of its own, but the plugin may not reach
 * into the primitives of the core - so it draws a neutral sheet with the
 * colour of the language of the file.
 * @param {object} props `path` (or `kind`) and `size`
 * @returns {React.ReactElement} the mark
 */
export function FileTypeIcon(props = {}) {
  const { path: filePath = '', kind = '', size = 16 } = props
  const label = kind === 'folder' ? 'DIR' : (filePath.split('.').pop() ?? '').slice(0, 4).toUpperCase()
  return svg([
    React.createElement('path', {
      key: 'sheet',
      d: 'M3.5 1.8h5.2l3.8 3.8v8.6H3.5z',
      fill: 'none',
      stroke: colorOf(filePath),
      strokeWidth: 1.2,
      strokeLinejoin: 'round',
    }),
    React.createElement('text', {
      key: 'label',
      x: 8,
      y: 12.4,
      textAnchor: 'middle',
      fontSize: 4.6,
      fill: colorOf(filePath),
      stroke: 'none',
    }, label),
  ], { size, className: props.className ?? '' })
}
