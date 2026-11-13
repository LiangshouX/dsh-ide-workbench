/**
 * Shared helpers of the terminal suites (Issue #3 / R9 and R10).
 *
 * The panel is a `.jsx` module that imports React and xterm, so the suites
 * bundle it with esbuild - the same way the other client suites do - and
 * alias xterm to the stub of the package. The doubles below stand in for the
 * two pieces the terminal talks to: the document that carries the theme of
 * the host, and the xterm instance with its hidden textarea.
 */
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// The workspace hoists the packages to the root of the repository: the
// terminal stylesheet is resolved, not guessed.
const moduleRequire = createRequire(import.meta.url)

let modulePromise

/**
 * The terminal module, bundled so that a `.jsx` file with JSX imports can be
 * loaded from a test.
 *
 * @returns {Promise<object>} the exports of the panel
 */
export async function loadTerminalModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    // The file name differs from the other suites so they can run in
    // parallel.
    const outfile = join(dir, 'terminal-support.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
          export {
            THEME_DARK, THEME_LIGHT,
            TERMINAL_PALETTE_DARK, TERMINAL_PALETTE_LIGHT, TERMINAL_PALETTES,
            relativeLuminance, resolveHostTheme, readThemeEnvironment, readHostTheme,
            readHostThemeService, subscribeHostThemeService,
            watchHostTheme, applyTerminalTheme, createImeGuard, terminalSlice,
          } from './src/client/TerminalPanel.jsx'
        `,
        resolveDir: root,
        loader: 'js',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: ['node20'],
      external: ['react', 'react-dom', 'react-dom/server'],
      alias: {
        '@xterm/xterm/css/xterm.css': moduleRequire.resolve('@xterm/xterm/css/xterm.css'),
        '@xterm/xterm': join(root, 'tests/stubs/xterm.js'),
        '@xterm/addon-fit': join(root, 'tests/stubs/addon-fit.js'),
      },
      loader: { '.css': 'text' },
      jsx: 'transform',
      define: { 'process.env.NODE_ENV': '"production"' },
      outfile,
      logLevel: 'silent',
    })
    return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
  })()
  return modulePromise
}

/**
 * A clock the tests drive by hand.
 *
 * The timers run in the order they were queued, like the timers of a
 * browser - that order is what the guard of the input method relies on.
 */
export function createClock() {
  const timers = []
  let nextId = 0
  return {
    setTimeout(fn, ms) {
      const timer = { id: ++nextId, fn, ms, cancelled: false }
      timers.push(timer)
      return timer
    },
    clearTimeout(timer) {
      if (timer !== null && timer !== undefined) timer.cancelled = true
    },
    /** The timers that are still pending. */
    get pending() { return timers.filter(timer => !timer.cancelled).length },
    /** Run every pending timer, in the order the timers were queued. */
    run() {
      const queued = timers.splice(0, timers.length)
      for (const timer of queued) if (!timer.cancelled) timer.fn()
    },
  }
}

/**
 * A document that says which theme the host is in.
 *
 * @param {object} [options] what the host declares
 * @param {string} [options.colorScheme] the `color-scheme` of the root element
 * @param {string} [options.background] the resolved background colour
 * @param {string} [options.token] an explicit `--iwb-theme` token
 * @returns {object} the document double
 */
export function createDocumentDouble({ colorScheme = 'dark', background = '#15171c', token = '' } = {}) {
  const state = { colorScheme, background, token }
  const style = {
    get colorScheme() { return state.colorScheme },
    getPropertyValue(name) {
      if (name === '--iwb-bg') return state.background
      if (name === '--iwb-theme') return state.token
      return ''
    },
  }
  const root = { style: {}, attributes: {} }
  const head = { children: [] }
  const workbench = { style: {} }
  return {
    documentElement: root,
    head,
    querySelector(selector) { return selector === '.iwb-root' ? workbench : null },
    defaultView: { getComputedStyle: () => style },
    /** Change what the host declares - a theme switch. */
    setTheme(next) {
      if (next.colorScheme !== undefined) state.colorScheme = next.colorScheme
      if (next.background !== undefined) state.background = next.background
      if (next.token !== undefined) state.token = next.token
    },
  }
}

/**
 * A MutationObserver the tests trigger by hand.
 */
export class FakeObserver {
  /** @type {FakeObserver[]} every observer that was built */
  static instances = []

  constructor(callback) {
    this.callback = callback
    this.targets = []
    this.disconnected = false
    FakeObserver.instances.push(this)
  }

  observe(target, options) { this.targets.push({ target, options }) }
  disconnect() { this.disconnected = true }

  /** Pretend that the host rewrote something. */
  trigger() { this.callback([], this) }
}

/**
 * An xterm double that reproduces the composition handling of the library.
 *
 * xterm reads the committed text back from its hidden textarea in a
 * `setTimeout(0)` after the composition ended - the `data` of the
 * composition event is not reliable on Chromium. When the textarea is
 * cleared in between (the input method switched its language and the
 * textarea lost the focus), the read yields nothing and the characters are
 * dropped.
 *
 * @param {object} clock the clock of the test
 * @returns {object} the terminal double
 */
export function createTerminalDouble(clock) {
  const listeners = { compositionstart: [], compositionupdate: [], compositionend: [], keydown: [] }
  const dataListeners = []
  const textarea = {
    value: '',
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn) },
    removeEventListener(type, fn) {
      const list = listeners[type]
      if (list === undefined) return
      const index = list.indexOf(fn)
      if (index >= 0) list.splice(index, 1)
    },
    dispatch(type, event) { for (const fn of [...(listeners[type] ?? [])]) fn(event) },
  }
  const terminal = {
    textarea,
    options: { theme: {} },
    element: { style: { properties: {}, setProperty(name, value) { this.properties[name] = value } } },
    onData(fn) {
      dataListeners.push(fn)
      return { dispose() { const index = dataListeners.indexOf(fn); if (index >= 0) dataListeners.splice(index, 1) } }
    },
    /** The terminal sends data to the shell. */
    send(text) { for (const fn of [...dataListeners]) fn(text) },
    dispose() { terminal.disposed = true },
    disposed: false,
  }
  // xterm registers its own listeners when the terminal opens, so they run
  // before the ones of the guard - and the send of the committed text is
  // queued before the check of the guard.
  let sentLength = 0
  textarea.addEventListener('compositionstart', () => { sentLength = 0 })
  textarea.addEventListener('compositionend', () => {
    clock.setTimeout(() => {
      const input = textarea.value.substring(sentLength)
      if (input.length > 0) terminal.send(input)
    }, 0)
  })
  // The keydown of the library: a key that is not a modifier finishes the
  // composition at once and sends what was composed.
  textarea.addEventListener('keydown', (event) => {
    if (event?.keyCode === 13) {
      const input = textarea.value
      if (input.length > 0) {
        terminal.send(input)
        sentLength = input.length
      }
    }
  })
  return terminal
}
