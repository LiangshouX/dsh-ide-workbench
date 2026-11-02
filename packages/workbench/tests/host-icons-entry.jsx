/**
 * SSR entry for the host-icon proxy test.
 *
 * The stub module is aliased in at build time, so the plugin's synchronous
 * `require` of `@deepseek-ai/dsh-client-ui-primitives` finds the stub and the
 * host path is exercised — the plain Node render would only ever see the
 * local fallback.
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FileTypeIcon } from '../src/client/icons.jsx'

/**
 * Render one file glyph.
 * @param {string} path the file name or path
 * @param {number} size the square edge in px
 * @returns {string} the rendered markup
 */
export function renderFile(path, size) {
  return renderToStaticMarkup(React.createElement(FileTypeIcon, { path, size }))
}

/**
 * Render one folder glyph.
 * @param {number} size the square edge in px
 * @returns {string} the rendered markup
 */
export function renderFolder(size) {
  return renderToStaticMarkup(React.createElement(FileTypeIcon, { kind: 'folder', size }))
}

/**
 * Render a file glyph with an extra class name.
 * @param {string} path the file name or path
 * @param {string} className the extra class
 * @returns {string} the rendered markup
 */
export function renderFileWithClass(path, className) {
  return renderToStaticMarkup(React.createElement(FileTypeIcon, { path, className, size: 15 }))
}
