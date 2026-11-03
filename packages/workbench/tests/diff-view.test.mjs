/**
 * Source-level contract of the V6 diff enhancements.
 *
 * These checks are about the CSS/JS wiring that the pure-function tests in
 * diff.test.mjs cannot see: that the side-by-side cells preserve raw
 * whitespace, that every scroll surface measures its own lines, that the two
 * panes of the side-by-side view are linked by scroll position, that 'Aa'
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

test('the side-by-side body is two panes that always split it in half', () => {
  const split = ruleOf('.iwb-diff-split')
  const tracks = /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/.exec(split)
  assert.ok(tracks !== null, 'both panes must be minmax(0, 1fr)')
  // A plain 1fr takes its minimum from the content, so a long line would push
  // the split around; the tracks have to be exactly half of the body.
  assert.doesNotMatch(split, /grid-template-columns:\s*1fr\s+1fr/)
  // Each pane is its own scroll surface (both axes), and a long line inside
  // one pane may not widen the pane: the track owns the width.
  const pane = ruleOf('.iwb-diff-pane')
  assert.match(pane, /overflow:\s*auto/)
  assert.match(pane, /min-width:\s*0/)
  // One visible vertical scrollbar only: the left pane hides its own (width 0
  // removes the vertical bar and keeps the 10px-high horizontal one), so the
  // split line does not grow a second bar and the halves stay equal boxes.
  assert.match(styles, /\.iwb-diff-pane-left::-webkit-scrollbar \{ width: 0; \}/)
})

test('the line text keeps its whole line in unified mode and the surface sets the tab stop', () => {
  // min-width: max-content is what stops the unified flex row from shrinking a
  // long line to the panel width. It is scoped to the unified row: in the
  // side-by-side cell the pane's measured width decides how far the text may
  // run, and the cell must fill that width instead of pushing it.
  assert.match(ruleOf('.iwb-diff-row .iwb-diff-text'), /min-width:\s*max-content/)
  assert.doesNotMatch(ruleOf('.iwb-diff-text'), /min-width/)
  const scroll = ruleOf('.iwb-diff-scroll')
  assert.match(scroll, /tab-size:\s*4/)
  assert.match(scroll, /overflow:\s*auto/)
  // The tab stop of the stylesheet and the measure's tab stop are one number.
  assert.equal(DIFF_TAB_SIZE, 4)
  // The split body carries the same font and tab stop as the single surface:
  // a tab must reserve four columns in both layouts.
  assert.match(ruleOf('.iwb-diff-split'), /tab-size:\s*4/)
  // The inner element brings no scroller of its own: the panes and the single
  // surface are the scroll boxes, not the measured child.
  assert.doesNotMatch(ruleOf('.iwb-diff-inner'), /overflow/)
  // The side-by-side row is a flex line of ONE pane cell.
  assert.match(ruleOf('.iwb-diff-side'), /display:\s*flex/)
  assert.match(ruleOf('.iwb-diff-side-cell'), /flex:\s*1 1 auto/)
})

test('the inner surface of each layout is measured from the visible rows', () => {
  // Unified: one surface, one measure.
  assert.match(diffView, /const innerWidth = useMemo\(\(\) => diffInnerWidth\(viewRows\)/)
  // Side by side: one measure per pane, each from its own side's lines.
  assert.match(diffView, /const paneWidths = useMemo\(\(\) => diffPaneWidths\(viewRows\)/)
  assert.match(diffView, /style: \{ height: `\$\{viewRows\.length \* LINE_HEIGHT\}px`, minWidth: width \}/)
  assert.match(diffView, /rowsOf\(side, paneWidths\[side\]\.width\)/)
  assert.match(diffView, /rowsOf\(null, innerWidth\.width\)/)
})

test('the two panes scroll as one, by position and not by ratio', () => {
  // Every pane reports its own scroll box; the handler writes the same
  // scrollTop/scrollLeft into the other pane, so both stand for the same
  // distance from the left edge (and the same row at the top).
  assert.match(diffView, /const onPaneScroll = \(side\) => \(event\) => \{/)
  assert.match(diffView, /const target = side === 'left' \? paneRightRef\.current : scrollRef\.current/)
  assert.match(diffView, /target\.scrollTop = top/)
  assert.match(diffView, /target\.scrollLeft = left/)
  // A shorter pane clamps the assignment; the echo of that write must not
  // travel back and drag the pane the user is dragging to its own end.
  assert.match(diffView, /const seen = echoRef\.current\[side\]/)
  assert.match(diffView, /Math\.abs\(seen\.left - left\) <= 1/)
  // Both panes are wired with it, and each carries its side for the CSS.
  assert.match(diffView, /onScroll: onPaneScroll\(side\)/)
  assert.match(diffView, /className: `iwb-diff-pane iwb-diff-pane-\$\{side\}`/)
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

test('the collapsed band occupies the slot of the rows it stands for', () => {
  // Every row is absolutely positioned by its offset; the band is one of them.
  // Without the offset it is the only row in normal flow, so it renders on top
  // of the first lines instead of where the hidden run was (and in both panes
  // of the side-by-side view at once).
  assert.match(diffView, /className: 'iwb-diff-collapsed',[\s\S]{0,300}?style: rowStyle\(offset\)/)
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
