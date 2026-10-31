/**
 * The smart-code colours follow the host theme (THEME-01 / THEME-02 / THEME-03).
 *
 * The completion popup, the hover card, the signature help and the reference
 * panel used to carry a hard-coded dark palette: a black code block and white
 * text in a light host theme. This file pins the fix down by scanning the
 * stylesheet and the editor for the values that must not come back, and for
 * the tokens that have to be there instead.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const styles = await readFile(join(root, 'src/client/styles.js'), 'utf8')
const editor = await readFile(join(root, 'src/client/CodeEditor.jsx'), 'utf8')
const ui = await readFile(join(root, 'src/client/ui.jsx'), 'utf8')

/** The colours the smart-code widgets must not hard-code any more. */
const FORBIDDEN_IN_STYLES = [
  '#1b1e24', // the black code block of the hover card
  '#d8dce3', // its light text
  '#7fb8ff', // the active parameter of the signature help
  /rgba\(\s*255\s*,\s*255\s*,\s*255/i, // white text on a solid accent
]

/** The old syntax palette of the editor (THEME-03). */
const OLD_SYNTAX_PALETTE = [
  '#7a8596', '#5f8f3f', '#a15fb0', '#b57a2a', '#2f8f83',
  '#8a6a1f', '#3f6f9f', '#c05a63', '#3b7dd8',
]

/** The tokens that carry the smart-code colours. */
const THEME_TOKENS = [
  '--iwb-code-bg', '--iwb-code-fg', '--iwb-code-border', '--iwb-code-muted',
  '--iwb-on-accent', '--iwb-shadow',
  '--iwb-syn-comment', '--iwb-syn-string', '--iwb-syn-keyword', '--iwb-syn-type',
  '--iwb-syn-number', '--iwb-syn-function', '--iwb-syn-property', '--iwb-syn-tag',
  '--iwb-syn-heading', '--iwb-syn-invalid',
]

test('the stylesheet has no hard-coded smart-code colours left', () => {
  for (const value of FORBIDDEN_IN_STYLES) {
    const pattern = typeof value === 'string' ? value : value.source
    assert.doesNotMatch(styles, new RegExp(pattern, 'i'), `styles.js must not contain ${pattern}`)
  }
})

test('the stylesheet has no hard-coded syntax palette left', () => {
  for (const value of OLD_SYNTAX_PALETTE) {
    assert.ok(!styles.includes(value), `styles.js must not contain ${value}`)
  }
})

test('every theme token exists and is defined through a host alias', () => {
  for (const token of THEME_TOKENS) {
    const declaration = new RegExp(`${token}:\\s*var\\(--dsw-alias-[a-z0-9-]+,[^;]+;`)
    assert.match(styles, declaration, `${token} must come from a --dsw-alias-* token`)
  }
})

test('the text on the accent colour falls back to a dark colour', () => {
  // A light brand colour with white text is unreadable, so the fallback has
  // to be dark - the host decides the real value when it knows its brand.
  const declaration = /--iwb-on-accent:\s*var\(--dsw-alias-[a-z0-9-]+,\s*([^)]+)\);/
  const match = declaration.exec(styles)
  assert.ok(match !== null, '--iwb-on-accent is declared')
  const fallback = match[1].trim().toLowerCase()
  assert.match(fallback, /^#[0-9a-f]{6}$/, 'the fallback is a hex colour')
  const red = parseInt(fallback.slice(1, 3), 16)
  const green = parseInt(fallback.slice(3, 5), 16)
  const blue = parseInt(fallback.slice(5, 7), 16)
  assert.ok((red + green + blue) / 3 < 128, `the fallback ${fallback} is a dark colour`)
})

test('the syntax fallbacks are readable on a light background', () => {
  // Every fallback has to clear the 4.5:1 contrast against white, the
  // surface of a light host theme.
  const luminance = (hex) => {
    const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map(channel => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }
  for (const token of THEME_TOKENS.filter(name => name.startsWith('--iwb-syn-'))) {
    const match = new RegExp(`${token}:\\s*var\\(--dsw-alias-[a-z0-9-]+,\\s*(#[0-9a-f]{6})\\);`).exec(styles)
    assert.ok(match !== null, `${token} has a hex fallback`)
    const ratio = 1.05 / (luminance(match[1].toLowerCase()) + 0.05)
    assert.ok(ratio >= 4.5, `${token} (${match[1]}) needs 4.5:1 on white, has ${ratio.toFixed(2)}`)
  }
})

test('the tooltip widgets clear their own background', () => {
  // A library element with a background of its own would leak a white block
  // into a dark card (and a black one into a light card).
  assert.match(styles, /\.iwb-codemirror \.cm-tooltip \* \{[^}]*background: transparent/)
})

test('the popups take their shadow from a token', () => {
  const shadows = styles.match(/box-shadow: 0 8px 24px [^;]+;/g) ?? []
  assert.ok(shadows.length >= 3, 'the three popup shadows are still there')
  for (const shadow of shadows) {
    assert.match(shadow, /var\(--iwb-shadow\)/, `${shadow} comes from the token`)
  }
})

test('the editor syntax palette comes from the tokens', () => {
  for (const value of OLD_SYNTAX_PALETTE) {
    assert.ok(!editor.includes(value), `CodeEditor.jsx must not contain ${value}`)
  }
  assert.doesNotMatch(editor, /rgba\(\s*76\s*,\s*154\s*,\s*255/i, 'the fixed accent rgba values are gone')
  for (const token of THEME_TOKENS.filter(name => name.startsWith('--iwb-syn-'))) {
    assert.match(editor, new RegExp(`var\\(${token}\\)`), `the editor uses ${token}`)
  }
})

test('the editor selection and the search hits are mixed from the tokens', () => {
  assert.match(editor, /\.cm-selectionBackground[^{]*\{[^}]*color-mix\(in srgb, var\(--iwb-accent\)/)
  assert.match(editor, /\.cm-matchingBracket[^{]*\{[^}]*color-mix\(in srgb, var\(--iwb-accent\)/)
  assert.match(editor, /\.cm-searchMatch[^{]*\{[^}]*color-mix\(in srgb, var\(--iwb-warn\)/)
  // The host theme is not the system theme.
  assert.doesNotMatch(editor, /@media[^{]*prefers-color-scheme/)
})

test('the blocking confirmation sits above the dialog it answers', () => {
  assert.match(styles, /\.iwb-modal-backdrop\.iwb-confirm-backdrop \{[^}]*z-index: 55;/)
  assert.match(styles, /\.iwb-modal-backdrop\.iwb-confirm-backdrop \{[^}]*background: rgba\(0, 0, 0, \.6\);/)
  // The default scope of the confirmation uses the deeper backdrop, the
  // editor scope keeps its own class.
  assert.match(ui, /'iwb-modal-backdrop iwb-confirm-backdrop'/)
  assert.match(ui, /'iwb-modal-backdrop iwb-editor-scoped-backdrop'/)
})
