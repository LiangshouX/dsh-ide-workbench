/**
 * Inline SVG icon set (16px grid, stroke = currentColor unless the artwork is
 * a colored file-type mark). No external icon font or package.
 *
 * The file-type marks are the exception: they come from the harness itself
 * (`@deepseek-ai/dsh-client-ui-primitives`), so the tree wears the same brand
 * logos as the DSH file explorer and `dsh-better-sidebar`.
 */
import React from 'react'
import { useHostPrimitives } from './host-primitives.js'

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

/**
 * The harness's own file-type artwork.
 *
 * `@deepseek-ai/dsh-client-ui-primitives` ships `FileTypeIcon`: the brand
 * marks (React, Java, TypeScript, C, C++, …) that the DSH file explorer and
 * `dsh-better-sidebar` draw in front of a file, plus a category-coloured
 * sheet for everything the brands do not claim. Reusing it keeps the
 * workbench on the host's `--dsw-*` palette, so the tree follows the skin
 * instead of carrying a second, hard-coded colour set.
 *
 * The host draws ONE folder glyph — whether a directory is expanded is carried
 * by the row's chevron, exactly like `dsh-better-sidebar`. `kind: 'folder'`
 * asks for it outright; a file is classified from its path.
 *
 * @param {object} props the host's own props: `path` or `kind`, plus `size`
 * @returns {React.ReactElement} the host glyph, or a neutral local fallback
 */
export function FileTypeIcon(props = {}) {
  const { path, kind, size = 16 } = props
  const primitives = useHostPrimitives()
  const HostIcon = primitives?.FileTypeIcon ?? null
  if (HostIcon !== null) {
    const className = typeof props.className === 'string' && props.className !== ''
      ? `iwb-file-icon ${props.className}`
      : 'iwb-file-icon'
    // The host reads `path` with the `in` operator, so a present-but-empty
    // path would classify `undefined` and throw. Send exactly one of the two,
    // and only when it can actually classify something.
    if (typeof kind === 'string' && kind !== '') {
      return React.createElement(HostIcon, { kind, size, className })
    }
    if (typeof path === 'string' && path !== '') {
      return React.createElement(HostIcon, { path, size, className })
    }
  }
  return React.createElement(FallbackFileGlyph, { kind, size })
}

/**
 * The neutral glyphs used when the host primitives are unreachable.
 *
 * They ride `currentColor`, so they follow the row's own colour instead of
 * inventing a palette the host does not know about.
 *
 * @param {object} props `kind` and the square edge in px
 * @returns {React.ReactElement} the fallback glyph
 */
function FallbackFileGlyph({ kind, size }) {
  const common = {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 16 16',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.3,
    strokeLinejoin: 'round',
    'aria-hidden': true,
    className: 'iwb-file-icon',
  }
  return kind === 'folder'
    ? React.createElement('svg', common,
      React.createElement('path', { key: 'a', d: 'M1.7 4.1h4.2l1.2 1.5h7.2v7.1H1.7z' }))
    : React.createElement('svg', common,
      React.createElement('path', { key: 'a', d: 'M4 2.4h5l3 3v8.2H4z' }),
      React.createElement('path', { key: 'b', d: 'M9 2.4v3h3' }))
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
