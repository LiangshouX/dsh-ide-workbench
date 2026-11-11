/**
 * R9 - the terminal follows the theme of the host.
 *
 * The terminal used to take a snapshot of the theme when it was mounted and
 * never read it again, and its sixteen ANSI colours were hard-coded dark:
 * in a light host theme the git output of `git commit` blended into the
 * background. The terminal paints on its own canvas, so a CSS variable never
 * reaches the screen - the palette has to be concrete and it has to be
 * pushed into the live instance when the host switches its theme.
 *
 * The suite pins down the four things that can go wrong: a palette that
 * cannot be read (a colour that is not a concrete value), a palette that
 * cannot be read *by a human* (a colour below the 4.5:1 bar), a theme that
 * is not detected (the host declares it, the plugin has to read it) and a
 * theme switch that does more than repaint (the session must survive it).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createClock, createDocumentDouble, createTerminalDouble, FakeObserver, loadTerminalModule,
} from './terminal-support.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(join(root, 'src/client/TerminalPanel.jsx'), 'utf8')
const mod = await loadTerminalModule()

const {
  THEME_DARK, THEME_LIGHT,
  TERMINAL_PALETTE_DARK, TERMINAL_PALETTE_LIGHT, TERMINAL_PALETTES,
  resolveHostTheme, readHostTheme, watchHostTheme, applyTerminalTheme,
  readHostThemeService, subscribeHostThemeService,
} = mod

/** The sixteen ANSI slots of a palette, in the order of the ANSI codes. */
const ANSI_SLOTS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
]

/* ── the colour maths (WCAG 2.x) ───────────────────────────────────────────── */

const toLinear = (channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)

const hexToRgb = (hex) => {
  const digits = hex.replace('#', '').slice(0, 6)
  return [0, 2, 4].map(index => parseInt(digits.slice(index, index + 2), 16) / 255)
}

/** The WCAG relative luminance of a colour. */
const relativeLuminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The WCAG contrast ratio of two colours. */
const contrastRatio = (a, b) => {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [high, low] = la > lb ? [la, lb] : [lb, la]
  return (high + 0.05) / (low + 0.05)
}

test('both palettes carry the sixteen ANSI colours and the surface', () => {
  for (const palette of [TERMINAL_PALETTE_DARK, TERMINAL_PALETTE_LIGHT]) {
    for (const slot of [...ANSI_SLOTS, 'background', 'foreground', 'cursor', 'selectionBackground']) {
      assert.equal(typeof palette[slot], 'string', `the palette has a ${slot}`)
      assert.notEqual(palette[slot].trim(), '', `the ${slot} is not empty`)
    }
  }
})

test('the palette is concrete - xterm cannot parse a computed value', () => {
  // xterm paints on its own canvas: it needs a real colour. The computed
  // value of `light-dark()` or of a `color-mix()` is not one, so the palette
  // may not use them.
  for (const [name, palette] of [['dark', TERMINAL_PALETTE_DARK], ['light', TERMINAL_PALETTE_LIGHT]]) {
    for (const [slot, value] of Object.entries(palette)) {
      assert.match(
        value,
        /^#[0-9a-f]{6}([0-9a-f]{2})?$/i,
        `the ${name} ${slot} is a concrete colour, not ${value}`,
      )
      assert.doesNotMatch(value, /var\(|light-dark\(|color-mix\(/, `the ${name} ${slot} is not a computed value`)
    }
  }
})

test('every ANSI colour and the text are readable on their own surface', () => {
  // The complaint that started this: in the light theme the bright ANSI
  // colours fell onto a white background and the text of a git commit
  // blended into it. Every one of the sixteen colours has to clear 4.5:1
  // against the background of its own palette.
  for (const [name, palette] of [['dark', TERMINAL_PALETTE_DARK], ['light', TERMINAL_PALETTE_LIGHT]]) {
    for (const slot of [...ANSI_SLOTS, 'foreground', 'cursor']) {
      const ratio = contrastRatio(palette[slot], palette.background)
      assert.ok(
        ratio >= 4.5,
        `the ${name} ${slot} (${palette[slot]}) is ${ratio.toFixed(2)}:1 on ${palette.background}, it needs 4.5:1`,
      )
    }
  }
})

test('the palette keeps a margin over the 4.5:1 bar', () => {
  // The bar is 4.5:1; the palette stays at 4.8:1 or better, so a later
  // change of a hue cannot quietly eat the margin.
  let worst = Infinity
  for (const palette of [TERMINAL_PALETTE_DARK, TERMINAL_PALETTE_LIGHT]) {
    for (const slot of [...ANSI_SLOTS, 'foreground']) {
      worst = Math.min(worst, contrastRatio(palette[slot], palette.background))
    }
  }
  assert.ok(worst >= 4.8, `the worst colour of the palettes is ${worst.toFixed(2)}:1, it needs 4.8:1`)
})

test('the two palettes are two different surfaces', () => {
  assert.notEqual(TERMINAL_PALETTE_DARK.background, TERMINAL_PALETTE_LIGHT.background)
  assert.notEqual(TERMINAL_PALETTE_DARK.foreground, TERMINAL_PALETTE_LIGHT.foreground)
  assert.equal(TERMINAL_PALETTES[THEME_DARK], TERMINAL_PALETTE_DARK)
  assert.equal(TERMINAL_PALETTES[THEME_LIGHT], TERMINAL_PALETTE_LIGHT)
})

test('the theme of the host is read from what the host declares', () => {
  // The host writes `color-scheme: light | dark` on the root element for
  // every theme it ships.
  assert.equal(resolveHostTheme({ colorScheme: 'light' }), THEME_LIGHT)
  assert.equal(resolveHostTheme({ colorScheme: 'dark' }), THEME_DARK)
  // A list of them: the used value is the last supported keyword.
  assert.equal(resolveHostTheme({ colorScheme: 'light dark' }), THEME_DARK)
  assert.equal(resolveHostTheme({ colorScheme: 'dark light' }), THEME_LIGHT)
  assert.equal(resolveHostTheme({ colorScheme: 'LIGHT' }), THEME_LIGHT)
})

test('an explicit token wins over the declaration of the host', () => {
  assert.equal(resolveHostTheme({ token: 'light', colorScheme: 'dark' }), THEME_LIGHT)
  assert.equal(resolveHostTheme({ token: 'dark', colorScheme: 'light' }), THEME_DARK)
  // A token that says nothing is no token.
  assert.equal(resolveHostTheme({ token: 'auto', colorScheme: 'light' }), THEME_LIGHT)
})

test('the surface decides when the host declares nothing', () => {
  assert.equal(resolveHostTheme({ background: '#ffffff' }), THEME_LIGHT)
  assert.equal(resolveHostTheme({ background: '#15171c' }), THEME_DARK)
  assert.equal(resolveHostTheme({ background: 'rgb(255, 255, 255)' }), THEME_LIGHT)
})

test('an unreadable theme falls back to the default without throwing', () => {
  assert.equal(resolveHostTheme({}), THEME_DARK)
  assert.equal(resolveHostTheme(), THEME_DARK)
  assert.equal(resolveHostTheme({ colorScheme: 'normal', background: 'not a colour' }), THEME_DARK)
  assert.equal(readHostTheme(null), THEME_DARK)
  assert.equal(readHostTheme({}), THEME_DARK)
})

test('the watcher reports the theme of the host when it changes', () => {
  const doc = createDocumentDouble({ colorScheme: 'dark' })
  const clock = createClock()
  const seen = []
  const stop = watchHostTheme(theme => seen.push(theme), {
    document: doc,
    MutationObserver: FakeObserver,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  })
  const observer = FakeObserver.instances[FakeObserver.instances.length - 1]
  assert.ok(observer.targets.length > 0, 'the watcher observes the document')
  // The host switches its theme: the root element is rewritten.
  doc.setTheme({ colorScheme: 'light' })
  observer.trigger()
  assert.deepEqual(seen, [], 'the change is not reported before the debounce is over')
  clock.run()
  assert.deepEqual(seen, [THEME_LIGHT], 'the watcher reports the new theme')
  stop()
  assert.ok(observer.disconnected, 'the watcher stops observing')
})

test('the watcher debounces a burst of mutations into one report', () => {
  const doc = createDocumentDouble({ colorScheme: 'dark' })
  const clock = createClock()
  const seen = []
  const stop = watchHostTheme(theme => seen.push(theme), {
    document: doc,
    MutationObserver: FakeObserver,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  })
  const observer = FakeObserver.instances[FakeObserver.instances.length - 1]
  doc.setTheme({ colorScheme: 'light' })
  observer.trigger()
  observer.trigger()
  observer.trigger()
  clock.run()
  assert.deepEqual(seen, [THEME_LIGHT], 'the burst is one report')
  stop()
})

test('the watcher sees the colour scheme of the host in the inline style', () => {
  // The host writes the colour scheme of its theme into the *inline style*
  // of the root element (`document.documentElement.style.colorScheme = …`),
  // so the observer has to watch the `style` attribute - not only the
  // attributes a theme would be spelled with.
  const doc = createDocumentDouble({ colorScheme: 'dark' })
  const clock = createClock()
  const stop = watchHostTheme(() => {}, {
    document: doc,
    MutationObserver: FakeObserver,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  })
  const observer = FakeObserver.instances[FakeObserver.instances.length - 1]
  const root = observer.targets.find(entry => entry.target === doc.documentElement)
  assert.ok(root !== undefined, 'the root element is observed')
  assert.equal(root.options.attributes, true, 'its attributes are observed')
  assert.ok(root.options.attributeFilter.includes('style'), 'the inline style of the root element is watched')
  assert.ok(root.options.attributeFilter.includes('class'), 'a class on the root element is watched')
  stop()
})

test('the watcher stays quiet when the theme did not change', () => {
  const doc = createDocumentDouble({ colorScheme: 'dark' })
  const clock = createClock()
  const seen = []
  const stop = watchHostTheme(theme => seen.push(theme), {
    document: doc,
    MutationObserver: FakeObserver,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  })
  const observer = FakeObserver.instances[FakeObserver.instances.length - 1]
  observer.trigger()
  clock.run()
  assert.deepEqual(seen, [], 'nothing changed, nothing is reported')
  stop()
})

test('the watcher survives a browser that cannot observe anything', () => {
  const clock = createClock()
  const stop = watchHostTheme(() => {}, { document: null })
  assert.equal(typeof stop, 'function', 'there is always a disposer')
  stop()
  // A document without a root element and an observer that throws must not
  // take the terminal down.
  const broken = watchHostTheme(() => {}, {
    document: {},
    MutationObserver: class { observe() { throw new Error('no') } disconnect() {} },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  })
  assert.equal(typeof broken, 'function')
  broken()
})

test('a broken listener does not stop the watcher', () => {
  const doc = createDocumentDouble({ colorScheme: 'dark' })
  const clock = createClock()
  const stop = watchHostTheme(() => { throw new Error('broken') }, {
    document: doc,
    MutationObserver: FakeObserver,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  })
  const observer = FakeObserver.instances[FakeObserver.instances.length - 1]
  doc.setTheme({ colorScheme: 'light' })
  observer.trigger()
  clock.run()
  stop()
})

test('a theme switch pushes the palette into the running terminal', () => {
  const clock = createClock()
  const terminal = createTerminalDouble(clock)
  const pushed = applyTerminalTheme(terminal, THEME_LIGHT, terminal.element)
  assert.equal(pushed, TERMINAL_PALETTE_LIGHT)
  assert.equal(terminal.options.theme.background, TERMINAL_PALETTE_LIGHT.background)
  assert.equal(terminal.options.theme.foreground, TERMINAL_PALETTE_LIGHT.foreground)
  for (const slot of ANSI_SLOTS) {
    assert.equal(terminal.options.theme[slot], TERMINAL_PALETTE_LIGHT[slot], `the ${slot} follows the theme`)
  }
})

test('a theme switch does not rebuild the terminal', () => {
  // The instance, the session and the scrollback have to survive the
  // switch: xterm compares the theme by reference, so a new object is what
  // makes it repaint - and that is all that may happen.
  const clock = createClock()
  const terminal = createTerminalDouble(clock)
  const before = terminal.options.theme
  applyTerminalTheme(terminal, THEME_LIGHT, terminal.element)
  assert.notEqual(terminal.options.theme, before, 'the theme is a new object, so the canvas repaints')
  assert.equal(terminal.disposed, false, 'the terminal is not disposed')
  const writes = []
  terminal.write = (data) => writes.push(data)
  applyTerminalTheme(terminal, THEME_DARK, terminal.element)
  assert.equal(terminal.disposed, false, 'the terminal is still alive')
  assert.deepEqual(writes, [], 'the scrollback is untouched')
})

test('the IME composition preview takes the colours of the surface', () => {
  // The composition preview of xterm is a DOM element and not canvas, so it
  // takes its colours from custom properties that the palette pushes down.
  const clock = createClock()
  const terminal = createTerminalDouble(clock)
  applyTerminalTheme(terminal, THEME_LIGHT, terminal.element)
  assert.equal(terminal.element.style.properties['--iwb-term-bg'], TERMINAL_PALETTE_LIGHT.background)
  assert.equal(terminal.element.style.properties['--iwb-term-fg'], TERMINAL_PALETTE_LIGHT.foreground)
})

test('an unknown theme and a broken terminal do not throw', () => {
  const clock = createClock()
  const terminal = createTerminalDouble(clock)
  assert.equal(applyTerminalTheme(terminal, 'sepia', terminal.element), TERMINAL_PALETTE_DARK)
  assert.doesNotThrow(() => applyTerminalTheme(null, THEME_DARK, null))
  assert.doesNotThrow(() => applyTerminalTheme({}, THEME_DARK, null))
})

test('the terminal is built once and is not rebuilt for a theme change', () => {
  // The instance may only be built when the session changes: a theme switch
  // pushes a palette into the live instance.
  const built = source.match(/new Terminal\(/g) ?? []
  assert.equal(built.length, 1, 'the terminal is built once')
  assert.match(source, /terminal\.options\.theme = \{ \.\.\.palette \}/, 'the palette is pushed into the instance')
  assert.match(source, /\}, \[session\.key\]\)/, 'the instance lives as long as the session')
})

test('the theme service of the host is the first source', () => {
  // The host resolves its themes before it publishes them, so the snapshot
  // carries the colour scheme that is in use.
  const ctx = { theme: { getTheme: () => ({ active: { colorScheme: 'light' } }) } }
  assert.equal(readHostThemeService(ctx), THEME_LIGHT)
  assert.equal(readHostThemeService({ theme: { getTheme: () => ({ active: { colorScheme: 'dark' } }) } }), THEME_DARK)
  assert.equal(readHostThemeService({ theme: { getTheme: () => ({ colorScheme: 'light' }) } }), THEME_LIGHT)
})

test('a host without a theme service falls back to the document', () => {
  assert.equal(readHostThemeService({}), null)
  assert.equal(readHostThemeService(null), null)
  assert.equal(readHostThemeService({ theme: {} }), null)
  assert.equal(readHostThemeService({ theme: { getTheme: () => { throw new Error('broken') } } }), null)
  assert.equal(readHostThemeService({ theme: { getTheme: () => ({ active: { colorScheme: 'system' } }) } }), null)
})

test('the subscription of the theme service reports every change', () => {
  const handlers = {}
  const ctx = {
    on(event, handler) { handlers[event] = handler; return () => { delete handlers[event] } },
  }
  const seen = []
  const off = subscribeHostThemeService(ctx, theme => seen.push(theme))
  assert.equal(typeof off, 'function', 'the subscription can be stopped')
  handlers['theme/change']({ active: { colorScheme: 'light' } })
  handlers['theme/change']({ active: { colorScheme: 'dark' } })
  assert.deepEqual(seen, [THEME_LIGHT, THEME_DARK])
  off()
  assert.equal(handlers['theme/change'], undefined, 'the subscription is over')
})

test('a context that cannot be asked for events has no subscription', () => {
  assert.equal(subscribeHostThemeService({}, () => {}), null)
  assert.equal(subscribeHostThemeService(null, () => {}), null)
  assert.equal(subscribeHostThemeService({ on: () => { throw new Error('broken') } }, () => {}), null)
})

test('the terminal does not follow the system theme', () => {
  // The host theme is not the system theme, and the repository forbids a
  // `prefers-color-scheme` query.
  assert.doesNotMatch(source, /prefers-color-scheme/)
  assert.doesNotMatch(source, /matchMedia/)
})

test('the panel watches the theme and cleans the watch up', () => {
  // The watcher has to be stopped when the session ends, otherwise a closed
  // terminal would keep a document observer alive.
  assert.match(source, /const stopThemeWatch = watchHostTheme\(/)
  assert.match(source, /applyTerminalTheme\(terminal, next, terminal\.element\)/)
  assert.match(source, /stopThemeWatch\(\)/)
})

test('the guard of the input method is cleaned up with the session', () => {
  assert.match(source, /createImeGuard\(terminal, text => send\(\{ type: 'input', data: text \}\)\)/)
  assert.match(source, /imeGuard\.dispose\(\)/)
})
