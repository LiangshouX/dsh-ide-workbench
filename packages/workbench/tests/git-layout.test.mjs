import test from 'node:test'
import assert from 'node:assert/strict'
import { gitLayout } from '../src/client/git-layout.js'
import { CSS } from '../src/client/styles.js'
import { formatGitDate } from '../src/client/util.js'

test('a normal bottom dock keeps the Drawer side-by-side', () => {
  const layout = gitLayout({ mainWidth: 1326, configuredWidth: 420, drawerOpen: true })
  assert.equal(layout.drawerNarrow, false)
  assert.equal(layout.drawerWidth, 420)
  assert.equal(layout.tableWidth, 906)
  assert.equal(layout.tableNarrow, false)
})

test('a medium dock keeps the log visible and compacts the author/date columns', () => {
  const layout = gitLayout({ mainWidth: 700, configuredWidth: 420, drawerOpen: true })
  assert.equal(layout.drawerNarrow, false)
  assert.ok(layout.drawerWidth < 420)
  assert.ok(layout.tableWidth > 250)
  assert.equal(layout.tableNarrow, true)
})

test('only a genuinely narrow dock turns the Drawer into an overlay', () => {
  const layout = gitLayout({ mainWidth: 400, configuredWidth: 420, drawerOpen: true })
  assert.equal(layout.drawerNarrow, true)
  assert.equal(layout.drawerWidth, 340)
})

test('author/date columns stay visible when no Drawer is open', () => {
  const layout = gitLayout({ mainWidth: 700, configuredWidth: 420, drawerOpen: false })
  assert.equal(layout.tableNarrow, false)
})

test('narrow Git CSS compresses author/date instead of hiding them', () => {
  assert.match(CSS, /\.iwb-git-narrow[^{]*\{[^}]*66px 78px/)
  assert.doesNotMatch(CSS, /\.iwb-git-narrow[^{]*nth-child\(4\)[^{]*\{[^}]*display:\s*none/)
})

test('the Git root fills the bottom dock instead of shrink-wrapping its content', () => {
  assert.match(CSS, /\.iwb-git \{[^}]*flex: 1 1 auto[^}]*width: 100%/)
})

test('compact Git date keeps month/day and time visible', () => {
  assert.equal(formatGitDate('2026-10-23 00:24:25 +0800', true), '10-23 00:24')
  assert.equal(formatGitDate('2026-10-23 00:24:25 +0800', false), '2026-10-23 00:24')
})
