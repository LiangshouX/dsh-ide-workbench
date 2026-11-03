/**
 * The four tool-window entries dock on the left or on the right (v6 layout).
 *
 * The left side is the original layout and must stay pixel-identical; the
 * right side is a mirror built on the order property plus mirrored borders,
 * so the DOM order (stripe, dock, editor) never changes. Both facts are
 * invisible to a type checker (there is none) and easy to break in a later
 * stylesheet edit, so this file pins down the source contract:
 *
 *   - the default side is the right one, and an unloaded settings document
 *     falls back to it (the entries must not wait for the host);
 *   - the shell puts the resolved side on the root class and mirrors the
 *     resizer direction;
 *   - the stylesheet mirrors order, borders, the active marker and the drag
 *     handle only under iwb-side-right, and undoes the mirror when the body
 *     stacks so the stripe stays the top bar;
 *   - the settings page offers the choice and writes it through.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_ENTRY_SIDE, STACK_WIDTH } from '../src/client/layout.js'
import { CSS } from '../src/client/styles.js'
import { en, zh } from '../src/client/i18n.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const clientDir = join(root, 'src/client')

const workbench = await readFile(join(clientDir, 'Workbench.jsx'), 'utf8')
const settingsPanel = await readFile(join(clientDir, 'SettingsPanel.jsx'), 'utf8')
const i18nSource = await readFile(join(clientDir, 'i18n.js'), 'utf8')

/** The stylesheet's stacking query: everything after it applies when stacked. */
const STACK_QUERY = `@container ide-workbench (max-width: ${STACK_WIDTH}px)`
const stackAt = CSS.indexOf(STACK_QUERY)
assert.ok(stackAt >= 0, 'the stylesheet still has the stacking container query')
const stacked = CSS.slice(stackAt)

test('the entries dock on the right by default', () => {
  // The default lives in layout.js so the shell and the settings page cannot
  // disagree about it.
  assert.equal(DEFAULT_ENTRY_SIDE, 'right')
})

test('the side of the root class comes from the setting with a default fallback', () => {
  // Only an explicit 'left' moves the stripe; an absent setting (still
  // loading, or written by an older host) keeps the default side.
  assert.match(
    workbench,
    /state\.settings\?\.layout\?\.entrySide === 'left' \? 'left' : DEFAULT_ENTRY_SIDE/,
    'the resolved side falls back to DEFAULT_ENTRY_SIDE',
  )
  assert.match(
    workbench,
    /import \{ DEFAULT_ENTRY_SIDE, STACK_WIDTH \} from '\.\/layout\.js'/,
    'the shell takes the fallback from layout.js',
  )
})

test('the root class carries the resolved side', () => {
  // A single class on the root switches the stylesheet; the existing classes
  // of the root are kept.
  assert.ok(
    workbench.includes('className: `iwb-root iwb-side-${entrySide}`'),
    'the root class is iwb-root plus the side class',
  )
  // The left side adds no stylesheet rule of its own: it is the untouched
  // original layout, so no iwb-side-left selector may exist (the comment in
  // layout.js may name it, a selector may not).
  assert.ok(!CSS.includes('.iwb-side-left'), 'the left side needs no rule - it is the base layout')
})

test('the resizer grows the dock away from the editor on either side', () => {
  // The dock is left of the editor in left mode and right of it in right
  // mode, so the horizontal delta is mirrored for the right side.
  assert.match(
    workbench,
    /entrySide === 'right' \? -\(moveEvent\.clientX - startX\) : moveEvent\.clientX - startX/,
    'the drag delta is mirrored for the right side',
  )
  assert.match(
    workbench,
    /Math\.max\(220, Math\.min\(680, startWidth \+ delta\)\)/,
    'the width clamp is unchanged',
  )
})

test('the right side repaints the body through order without touching the DOM order', () => {
  // The DOM stays stripe, left, center: every ref and key of the body keeps
  // its meaning while the paint order mirrors to center, left, stripe.
  assert.match(CSS, /\.iwb-side-right \.iwb-body > \.iwb-center \{ order: 1; \}/)
  assert.match(CSS, /\.iwb-side-right \.iwb-body > \.iwb-left \{ order: 2; \}/)
  assert.match(CSS, /\.iwb-side-right \.iwb-body > \.iwb-stripe \{ order: 3; \}/)
  // The body still lists them in the original order in the shell.
  const body = /className: 'iwb-body'[\s\S]*?iwb-center/.exec(workbench)
  assert.ok(body !== null, 'the body keeps its tree')
})

test('the right side mirrors the borders to the editor-facing edge', () => {
  // The dock sits directly against the editor on its left, and the stripe is
  // the outer right edge - a border on the old side would draw a second line
  // between them.
  assert.match(
    CSS,
    /\.iwb-side-right \.iwb-left \{[^}]*border-right: 0;[^}]*border-left: 1px solid var\(--iwb-border\);/,
    'the dock draws its border on its left edge',
  )
  assert.match(
    CSS,
    /\.iwb-side-right \.iwb-stripe \{[^}]*border-right: 0;[^}]*border-left: 1px solid var\(--iwb-border\);/,
    'the stripe draws its border on its left edge',
  )
})

test('the active marker of the stripe points into the editor column', () => {
  assert.match(
    CSS,
    /\.iwb-side-right \.iwb-stripe-btn\.iwb-on::before \{ left: auto; right: -6px; \}/,
    'the marker moves to the editor side of the stripe',
  )
})

test('the drag handle of the dock faces the editor', () => {
  assert.match(
    CSS,
    /\.iwb-side-right \.iwb-left-resizer \{ right: auto; left: -3px; \}/,
    'the resizer moves to the editor side of the dock',
  )
})

test('stacked, the right side is the same top bar as the left side', () => {
  // Stacking is a column: order would put the stripe at the bottom, and the
  // mirrored borders would leave a stray line at the left edge. The query
  // resets both so a narrow right-mode pane keeps the original top bar.
  assert.match(stacked, /\.iwb-body \{ flex-direction: column; \}/, 'the body stacks')
  assert.match(
    stacked,
    /\.iwb-side-right \.iwb-body > \.iwb-center,\s*\.iwb-side-right \.iwb-body > \.iwb-left,\s*\.iwb-side-right \.iwb-body > \.iwb-stripe \{ order: 0; \}/,
    'the side-by-side paint order is undone',
  )
  assert.match(stacked, /\.iwb-side-right \.iwb-stripe \{ border-left: 0; \}/, 'the top bar keeps no left line')
  assert.match(stacked, /\.iwb-side-right \.iwb-left \{ border-left: 0; \}/, 'the stacked dock keeps no left line')
  // The base stacked border of the top bar survives the mirror.
  assert.match(
    stacked,
    /\.iwb-stripe \{[^}]*border-right: 0; border-bottom: 1px solid var\(--iwb-border\);/,
    'the top bar keeps its bottom border',
  )
  // The marker is an underline again, not a vertical bar hanging off the
  // right edge of the button.
  assert.match(
    stacked,
    /\.iwb-side-right \.iwb-stripe-btn\.iwb-on::before \{[^}]*bottom: -3px;[^}]*height: 2px;/,
    'the marker becomes the stacked underline again',
  )
  assert.match(stacked, /\.iwb-left-resizer \{ display: none; \}/, 'stacked keeps no drag handle')
})

test('the settings page offers the side and writes it through', () => {
  assert.match(settingsPanel, /t\('settings\.layoutGroup'\)/, 'the group has its title')
  assert.match(settingsPanel, /t\('settings\.toolWindowSide'\)/, 'the row has its label')
  assert.match(settingsPanel, /t\('settings\.toolWindowSideHint'\)/, 'the row has its hint')
  assert.match(settingsPanel, /t\('settings\.toolWindowSideLeft'\)/, 'the left option is translated')
  assert.match(settingsPanel, /t\('settings\.toolWindowSideRight'\)/, 'the right option is translated')
  assert.match(settingsPanel, /className: 'iwb-input'/, 'the select follows the settings input skin')
  // The current value is the resolved side of the store, not a local copy:
  // the row writes through, so a draft would lag one save behind.
  assert.match(
    settingsPanel,
    /state\.settings\?\.layout\?\.entrySide === 'left' \? 'left' : DEFAULT_ENTRY_SIDE/,
    'the select shows the resolved side',
  )
  assert.match(settingsPanel, /value: entrySide/, 'the select is controlled by the resolved side')
  assert.doesNotMatch(settingsPanel, /useState\([^)]*entrySide/, 'the row keeps no local side state')
  // The change is written to the settings document, the one write path that
  // updates state.settings and therefore the root class.
  assert.match(
    settingsPanel,
    /store\.updateSettings\(\{ layout: \{ entrySide: event\.target\.value === 'left' \? 'left' : 'right' \} \}\)/,
    'the select writes layout.entrySide through updateSettings',
  )
  assert.match(settingsPanel, /import \{ DEFAULT_ENTRY_SIDE \} from '\.\/layout\.js'/)
})

test('both locales carry the layout keys', () => {
  const keys = [
    'settings.layoutGroup',
    'settings.toolWindowSide',
    'settings.toolWindowSideHint',
    'settings.toolWindowSideLeft',
    'settings.toolWindowSideRight',
  ]
  for (const key of keys) {
    assert.ok(typeof en[key] === 'string' && en[key] !== '', `en is missing ${key}`)
    assert.ok(typeof zh[key] === 'string' && zh[key] !== '', `zh is missing ${key}`)
  }
  assert.equal(en['settings.layoutGroup'], 'Layout')
  assert.equal(zh['settings.layoutGroup'], '布局')
  assert.equal(en['settings.toolWindowSideLeft'], 'Left')
  assert.equal(zh['settings.toolWindowSideLeft'], '左侧')
  // The new keys are marked in both dictionaries so a later merge can find
  // them (the marker is a comment, not a key).
  const markers = i18nSource.match(/\/\/ v6 layout/g) ?? []
  assert.equal(markers.length, 2, 'both dictionaries mark the v6 layout keys')
})
