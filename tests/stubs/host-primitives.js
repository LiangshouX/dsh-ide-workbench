/**
 * A stand-in for the harness's `@deepseek-ai/dsh-client-ui-primitives`.
 *
 * The real module is seeded into the DSH browser module table, so a Node test
 * cannot reach it. This stub stands in for it and records what the plugin
 * asked the host to draw, which is the only way to test the proxy in Node.
 */
import React from 'react'

/**
 * The host's file-type glyph, as a marker element.
 * @param {object} props the host's own props (`path` or `kind`, plus `size`)
 * @returns {React.ReactElement} the marker
 */
export function FileTypeIcon(props) {
  return React.createElement('svg', {
    'data-host-file-icon': props.kind !== undefined ? `kind:${props.kind}` : `path:${props.path}`,
    'data-size': String(props.size),
    className: props.className,
  })
}

/** The host's Markdown renderer (not used by this test). */
export const MarkdownText = null
