/**
 * The compact spellings of the editor toolbar.
 *
 * A 30-pixel bar above the document cannot keep its labels when the pane is
 * narrow: the labels used to wrap inside their buttons ("编/辑", "utf-/8"),
 * which is what the compact mode removes. The controls keep their icon (the
 * label moves into the tooltip that each button already carries) and the
 * encoding keeps one letter. This file pins the letter rule and the wiring that
 * the stylesheet switches.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { shortEncoding } from '../src/client/util.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const clientDir = join(root, 'src/client')

test('the compact encoding is one letter', () => {
  assert.equal(shortEncoding('utf-8'), 'u')
  assert.equal(shortEncoding('GBK'), 'G')
  assert.equal(shortEncoding('utf-8-bom'), 'u')
  assert.equal(shortEncoding('utf-16le'), 'u')
  assert.equal(shortEncoding('  GB18030 '), 'G', 'the value is trimmed first')
  assert.equal(shortEncoding(''), '')
  assert.equal(shortEncoding(undefined), '', 'nothing is invented for a missing value')
  assert.equal(shortEncoding(42), '')
})

test('the labels are wrapped so the stylesheet can drop them', async () => {
  const source = await readFile(join(clientDir, 'EditorArea.jsx'), 'utf8')
  // The four controls named in the report: preview, source, edit, save.
  assert.match(source, /className: 'iwb-toolbar-label' \}, t\('editor\.preview'\)/)
  assert.match(source, /className: 'iwb-toolbar-label' \}, t\('editor\.source'\)/)
  assert.match(source, /className: 'iwb-toolbar-label' \}, editing \? t\('editor\.readonly'\) : t\('editor\.edit'\)\)/)
  assert.match(source, /className: 'iwb-toolbar-label' \}, saving \? t\('editor\.saving'\) : t\('editor\.save'\)\)/)
  // Each control keeps a tooltip: an icon-only button must still say its word.
  assert.match(source, /title: t\('editor\.preview'\)/)
  assert.match(source, /title: t\('editor\.source'\)/)
  assert.match(source, /title: `\$\{t\('editor\.save'\)\} · Ctrl\+S`/)
})

test('the encoding keeps the whole value in the tooltip', async () => {
  const source = await readFile(join(clientDir, 'EditorArea.jsx'), 'utf8')
  assert.match(source, /className: 'iwb-encoding'/)
  assert.match(source, /className: 'iwb-encoding-full'/)
  assert.match(source, /className: 'iwb-encoding-short'/)
  // utf-8 -> u, GBK -> G, and the tooltip names the whole value.
  assert.match(source, /shortEncoding\(payload\?\.encoding \?\? 'utf-8'\)/)
  assert.match(source, /`\$\{payload\.encoding\} · \$\{payload\.eol === '\\r\\n' \? 'CRLF' : 'LF'\}`/)
})

test('the compact mode is a measured marker on the bar', async () => {
  const css = await readFile(join(clientDir, 'styles.js'), 'utf8')
  const source = await readFile(join(clientDir, 'EditorArea.jsx'), 'utf8')
  // The labels never wrap, whatever the width: they are dropped, not broken.
  assert.match(css, /\.iwb-toolbar-label \{ white-space: nowrap; \}/)
  assert.match(css, /\.iwb-editor-toolbar > button,\s*\n\.iwb-editor-toolbar > \.iwb-seg,\s*\n\.iwb-editor-toolbar > \.iwb-encoding,\s*\n\.iwb-toolbar-actions > button,\s*\n\.iwb-toolbar-actions > \.iwb-seg,\s*\n\.iwb-toolbar-actions > \.iwb-encoding \{ flex: 0 0 auto; white-space: nowrap; \}/)
  // The compact spelling is hidden until the marker says the bar is narrow.
  assert.match(css, /\.iwb-encoding-short \{ display: none; \}/)
  // The marker, not a guessed width: a longer translation drops the labels on
  // its own, because the controls are measured at their natural width.
  const compact = /\.iwb-editor-toolbar\[data-compact='true'\] \{[^}]*\}|\.iwb-editor-toolbar\[data-compact='true'\] [^{]+\{[^}]*\}/g
  const rules = css.match(compact) ?? []
  const block = rules.join('\n')
  assert.match(block, /\.iwb-toolbar-label \{ display: none; \}/)
  assert.match(block, /\.iwb-encoding-full \{ display: none; \}/)
  assert.match(block, /\.iwb-encoding-short \{ display: inline; \}/)
  assert.match(block, /\.iwb-textbtn \{ gap: 0; padding: 0 6px; \}/)
  assert.doesNotMatch(css, /@container iwb-editor-toolbar/, 'the old fixed-width container query is gone')
  // The wiring: the bar carries the marker and the cluster that is measured.
  assert.match(source, /'data-compact': compact === true \? 'true' : 'false'/)
  assert.match(source, /className: 'iwb-toolbar-actions', ref: actionsRef/)
  assert.match(source, /const TOOLBAR_BREADCRUMB_MIN = \d+/)
  assert.match(source, /element\.clientWidth < needed/)
  // The read happens with the labels forced back on, so the natural width is
  // what the comparison sees; the layout effect keeps it out of the paint.
  assert.match(source, /setAttribute\('data-compact', 'false'\)/)
  assert.match(source, /useLayoutEffect\(\(\) => \{/)
})
