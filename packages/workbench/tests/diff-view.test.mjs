/**
 * Source-level contract of the V6 diff enhancements.
 *
 * These checks are about the CSS/JS wiring that the pure-function tests in
 * diff.test.mjs cannot see: that the side-by-side cells preserve raw
 * whitespace, that the shared scroll surface measures its lines, that 'Aa'
 * defaults to on and is persisted, and that the measured chrome widths are
 * still the widths of the stylesheet. A rendered check would need a browser,
 * but every failure here is a one-line change in the source, so reading the
 * source is the honest place to pin it down.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DIFF_GUTTER_WIDTH,
  DIFF_LINE_NUMBER_WIDTH,
  DIFF_SIDE_BORDER,
  DIFF_SIGN_WIDTH,
  DIFF_TAB_SIZE,
  DIFF_TEXT_PADDING,
} from '../src/client/diff.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const styles = await readFile(join(root, 'src/client/styles.js'), 'utf8')
const diffView = await readFile(join(root, 'src/client/DiffView.jsx'), 'utf8')

/** The body of the CSS rule whose selector starts a line of the stylesheet. */
function ruleOf(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Anchoring the selector at the start of a line keeps a compound rule such
  // as `.iwb-diff-row .iwb-diff-text` from being read as the base
  // `.iwb-diff-text` rule (and the other way round).
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(styles)
  assert.ok(match !== null, `styles.js must define ${selector}`)
  return match[1]
}

test('the side-by-side cells render the raw text at the measured column edge', () => {
  // `normal` collapses leading indentation and runs of spaces - the
  // package-lock.json bug. Both cells keep `pre`.
  const cell = ruleOf('.iwb-diff-side-cell')
  assert.match(cell, /white-space:\s*pre/, 'the side cells must preserve whitespace')
  // The cell keeps overflow: hidden on purpose: the inner width has been
  // measured wide enough for the longest line, so only an estimation error of
  // a few pixels can be clipped - spilling into the other column would move
  // the split, which is the worse failure.
  assert.match(cell, /overflow:\s*hidden/)
  assert.match(cell, /min-width:\s*0/)
  // The unified rows already had `pre`; it is what keeps that layout honest.
  assert.match(ruleOf('.iwb-diff-row'), /white-space:\s*pre/)
  // No ellipsis anywhere in the line text of either layout.
  assert.doesNotMatch(ruleOf('.iwb-diff-text'), /text-overflow/)
})

test('the two side-by-side columns are deterministic halves of the surface', () => {
  const side = ruleOf('.iwb-diff-side')
  const tracks = /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/.exec(side)
  assert.ok(tracks !== null, 'both columns must be minmax(0, 1fr)')
  // A plain 1fr takes its minimum from the text, so every long line would
  // push the second column around and the split would jump between rows.
  assert.doesNotMatch(side, /grid-template-columns:\s*1fr\s+1fr/)
})

test('the line text keeps its whole line in unified mode and the surface sets the tab stop', () => {
  // min-width: max-content is what stops the unified flex row from shrinking a
  // long line to the panel width. It is scoped to the unified row: in the
  // side-by-side cells the same class must NOT carry it, or the two grid
  // tracks would grow with the text and the columns would not stay equal.
  assert.match(ruleOf('.iwb-diff-row .iwb-diff-text'), /min-width:\s*max-content/)
  assert.doesNotMatch(ruleOf('.iwb-diff-text'), /min-width/)
  const scroll = ruleOf('.iwb-diff-scroll')
  assert.match(scroll, /tab-size:\s*4/)
  assert.match(scroll, /overflow:\s*auto/)
  // The tab stop of the stylesheet and the measure's tab stop are one number.
  assert.equal(DIFF_TAB_SIZE, 4)
  // One horizontal surface only: the inner element must not bring a second
  // scroller of its own.
  assert.doesNotMatch(ruleOf('.iwb-diff-inner'), /overflow/)
})

test('the inner surface is measured from the visible rows', () => {
  assert.match(diffView, /const innerWidth = useMemo\(\(\) => diffInnerWidth\(viewRows, mode\)/)
  // The computed width must be what the inner style carries.
  assert.match(diffView, /minWidth:\s*innerWidth\.width/)
})

test('the measured chrome widths are the widths of the stylesheet', () => {
  const gutter = ruleOf('.iwb-diff-row .iwb-diff-gutter')
  const number = ruleOf('.iwb-diff-num')
  const sign = ruleOf('.iwb-diff-sign')
  const text = ruleOf('.iwb-diff-text')
  const cell = ruleOf('.iwb-diff-side-cell')
  const px = (source, property) => {
    const match = new RegExp(`${property}:\\s*(\\d+)px`).exec(source)
    assert.ok(match !== null, `the rule must declare ${property}`)
    return Number(match[1])
  }
  assert.equal(px(gutter, 'width'), DIFF_GUTTER_WIDTH)
  assert.equal(px(number, 'width'), DIFF_LINE_NUMBER_WIDTH)
  assert.equal(px(sign, 'width'), DIFF_SIGN_WIDTH)
  assert.equal(px(text, 'padding-right'), DIFF_TEXT_PADDING)
  assert.equal(px(cell, 'border-right'), DIFF_SIDE_BORDER)
  // The tab stop of the stylesheet and the measure's tab stop are one number.
  assert.equal(DIFF_TAB_SIZE, 4)
})

test('word-level highlighting starts enabled unless it was explicitly turned off', () => {
  // The default policy itself is the pure function wordLevelDefault of
  // diff.js; diff.test.mjs checks the behaviour (null settings, an old
  // document without the key, and an explicit false). Here only the wiring:
  // the viewer reads the saved choice, so an unloaded document starts on.
  assert.match(diffView, /import \{[^}]*\bwordLevelDefault\b[^}]*\} from '\.\/diff\.js'/)
  assert.match(diffView, /useState\(\(\) => wordLevelDefault\(store\.state\.settings\)\)/)
})

test('the Aa toggle flips locally first and persists the choice', () => {
  const body = /const toggleWordLevel = \(\) => \{([\s\S]*?)\n  \}/.exec(diffView)
  assert.ok(body !== null, 'DiffView must define toggleWordLevel')
  const code = body[1]
  const localFlip = code.indexOf('setWordLevel(next)')
  const write = code.indexOf('store.updateSettings({ git: { wordLevel: next } })')
  assert.ok(localFlip >= 0, 'the toggle must update the local state')
  assert.ok(write >= 0, 'the toggle must persist the choice in git.wordLevel')
  assert.ok(localFlip < write, 'the local state flips before the slow settings write')
  // A failed write may not become an unhandled rejection, and it may not roll
  // the UI back: the state was already committed above the write.
  assert.match(code, /catch\(\(\) => \{\}\)/)
})
