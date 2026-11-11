/**
 * Terminal tool window: real PTY sessions over a package WebSocket, rendered
 * with xterm.js. One socket == one session; closing the tab terminates it.
 *
 * The terminal follows the theme of the host (Issue #3 / R9). xterm paints on
 * its own canvas, so a CSS variable never reaches the screen: the palette is
 * built in JS and pushed into the live instance when the host switches
 * between its light and its dark theme. The switch only repaints the canvas -
 * the instance, the socket, the session and the scrollback stay untouched.
 */
import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { wsUrl, call } from './api.js'
import { FileTypeIcon, IconPlus, IconTerminal } from './icons.jsx'
import { dirName } from './util.js'
import { shallowEqual, useStoreSlice } from './hooks.js'

/**
 * Fields of the workbench state the terminal panel renders.
 *
 * The panel only shows the session list; the PTY itself lives in the xterm
 * instance, so nothing else has to be in the slice. A session that starts,
 * exits or is renamed replaces `state.terminal`, which re-renders the tabs.
 *
 * @param {object} state workbench state
 * @returns {object} the panel's slice
 */
export function terminalSlice(state) {
  return { terminal: state.terminal }
}

/* ── the theme of the terminal (Issue #3 / R9) ─────────────────────────────────
   The host declares its theme declaratively: it writes `color-scheme: light |
   dark` on the root element for every theme it ships, and the plugin CSS
   follows it through `light-dark()`. The terminal cannot use that: xterm
   draws on its own canvas, so only a concrete colour reaches the screen -
   the computed value of `light-dark()` or of a `color-mix()` is not
   something xterm can parse. So the palette is built here, in JS, as two
   explicit sets, and pushed into the live instance when the theme changes. */

/** The two themes the host ships. */
export const THEME_DARK = 'dark'
export const THEME_LIGHT = 'light'

/**
 * The terminal palette of the dark host theme (JetBrains Darcula).
 *
 * The hues are the ones the workbench uses everywhere else - the git and
 * the status colours are the same red, green, yellow and blue - so the
 * terminal sits in the panel instead of punching a hole into it.
 *
 * Every one of the sixteen ANSI colours clears 4.5:1 against the background
 * of its own palette (the regression test computes the ratios). Two slots
 * had to move away from the canonical values for that: ANSI black on a dark
 * surface has no contrast at all (#000000 on #15171c is 1.1:1), and ANSI
 * white on a light surface is white on white. They are a readable slate and
 * a readable grey instead - the same trade every terminal theme makes.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const TERMINAL_PALETTE_DARK = Object.freeze({
  background: '#15171c',
  foreground: '#d8dce3',
  cursor: '#4c9aff',
  cursorAccent: '#15171c',
  selectionBackground: '#4c9aff55',
  black: '#7d8593',
  red: '#e2686f',
  green: '#4fb477',
  yellow: '#d7a24a',
  blue: '#4c9aff',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#d8dce3',
  brightBlack: '#8a93a1',
  brightRed: '#ff7b86',
  brightGreen: '#6fd08c',
  brightYellow: '#e8bd6a',
  brightBlue: '#6cb0ff',
  brightMagenta: '#d79ae8',
  brightCyan: '#7fd4df',
  brightWhite: '#ffffff',
})

/**
 * The terminal palette of the light host theme (JetBrains Light).
 *
 * The same hues as the dark palette, darkened for a light surface. A light
 * theme inverts the meaning of the slots: the "bright" variants are the
 * more saturated ones and the neutral slots have to be dark enough to be
 * read - the same layout the light terminal themes of the editors use.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const TERMINAL_PALETTE_LIGHT = Object.freeze({
  background: '#ffffff',
  foreground: '#1f1f1f',
  cursor: '#1558b0',
  cursorAccent: '#ffffff',
  selectionBackground: '#1558b033',
  black: '#33383f',
  red: '#b3261e',
  green: '#2e7d32',
  yellow: '#8a6100',
  blue: '#1558b0',
  magenta: '#7b3fa4',
  cyan: '#0f6f78',
  white: '#4f5661',
  brightBlack: '#6a7280',
  brightRed: '#c0271c',
  brightGreen: '#157f3d',
  brightYellow: '#7a5800',
  brightBlue: '#0d5bc0',
  brightMagenta: '#9c27b0',
  brightCyan: '#00796b',
  brightWhite: '#11141a',
})

/** The palettes of the terminal, by the theme of the host. */
export const TERMINAL_PALETTES = Object.freeze({
  [THEME_DARK]: TERMINAL_PALETTE_DARK,
  [THEME_LIGHT]: TERMINAL_PALETTE_LIGHT,
})

/**
 * The relative luminance of a CSS colour, or null when it cannot be read.
 *
 * @param {string} css a hex or an rgb() colour
 * @returns {number|null} the WCAG relative luminance
 */
export function relativeLuminance(css) {
  const value = String(css ?? '').trim()
  if (value === '') return null
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  let channels = null
  if (hex !== null) {
    const digits = hex[1]
    const full = digits.length === 3 ? digits.split('').map(digit => digit + digit).join('') : digits
    channels = [0, 2, 4].map(index => parseInt(full.slice(index, index + 2), 16) / 255)
  } else {
    const match = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(value)
    if (match === null) return null
    channels = [match[1], match[2], match[3]].map(part => Number(part) / 255)
  }
  if (channels === null || channels.some(channel => !Number.isFinite(channel))) return null
  const linear = channels.map(channel => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

/**
 * Decide which theme of the host is active.
 *
 * The order is deliberate: an explicit token wins, then the `color-scheme`
 * the host declares on the root element (the used value of a list is its
 * last supported keyword), and only then the luminance of the surface. The
 * system theme is never consulted - the host theme is not the system theme,
 * and the repository forbids a query on the system theme.
 *
 * @param {object} [env] what is known about the theme
 * @param {string} [env.token] an explicit theme name ('light' or 'dark')
 * @param {string} [env.colorScheme] the declared `color-scheme`
 * @param {string} [env.background] the resolved background colour
 * @returns {string} 'dark' or 'light'
 */
export function resolveHostTheme(env = {}) {
  const token = String(env.token ?? '').trim().toLowerCase()
  if (token === THEME_LIGHT || token === THEME_DARK) return token
  const scheme = String(env.colorScheme ?? '').trim().toLowerCase()
  const keywords = scheme.split(/[\s,]+/).filter(word => word === THEME_LIGHT || word === THEME_DARK)
  if (keywords.length > 0) return keywords[keywords.length - 1]
  const luminance = relativeLuminance(env.background)
  // 0.18 is where black and white text swap places: below it the surface
  // is a dark one, above it a light one.
  if (luminance !== null) return luminance >= 0.18 ? THEME_LIGHT : THEME_DARK
  return THEME_DARK
}

/**
 * Read what the document says about the theme of the host.
 *
 * Every read is optional and guarded: a host without a palette, a document
 * without a root element or a browser without a computed style must not
 * throw - the terminal falls back to its default palette instead.
 *
 * @param {Document} [doc] the document to read
 * @returns {{token: string, colorScheme: string, background: string}} what is known
 */
export function readThemeEnvironment(doc = typeof document !== 'undefined' ? document : null) {
  const env = { token: '', colorScheme: '', background: '' }
  if (doc === null || doc === undefined) return env
  const view = doc.defaultView ?? (typeof window !== 'undefined' ? window : null)
  const computed = (element) => {
    if (element === null || element === undefined || view === null) return null
    try { return view.getComputedStyle(element) } catch { return null }
  }
  const root = doc.documentElement ?? null
  const rootStyle = computed(root)
  if (rootStyle !== null) {
    try { env.colorScheme = String(rootStyle.colorScheme ?? '') } catch { env.colorScheme = '' }
    try { env.background = String(rootStyle.getPropertyValue?.('--iwb-bg') ?? '') } catch { env.background = '' }
  }
  // An explicit token wins over everything else: a host (or a workbench
  // stylesheet) that publishes `--iwb-theme: light | dark` says so.
  try {
    const workbench = doc.querySelector?.('.iwb-root') ?? null
    const style = computed(workbench)
    if (style !== null) {
      const token = String(style.getPropertyValue?.('--iwb-theme') ?? '').trim()
      if (token !== '') env.token = token
      if (env.background === '') env.background = String(style.getPropertyValue?.('--iwb-bg') ?? '')
    }
  } catch { /* the workbench is not mounted: the other sources decide */ }
  return env
}

/**
 * The theme of the host, read from the document.
 *
 * @param {Document} [doc] the document to read
 * @returns {string} 'dark' or 'light'
 */
export function readHostTheme(doc = typeof document !== 'undefined' ? document : null) {
  return resolveHostTheme(readThemeEnvironment(doc))
}

/**
 * The theme of a snapshot of the host.
 *
 * The host resolves its own themes before it publishes them, so the
 * snapshot carries the colour scheme that is in use - never the id of a
 * theme and never the preference of the system.
 *
 * @param {any} snapshot the snapshot of the theme service
 * @returns {string|null} 'dark', 'light' or null
 */
function themeOfSnapshot(snapshot) {
  if (snapshot === null || snapshot === undefined) return null
  const scheme = snapshot?.active?.colorScheme ?? snapshot?.colorScheme ?? snapshot?.mode ?? ''
  const value = String(scheme).trim().toLowerCase()
  if (value === THEME_LIGHT || value === THEME_DARK) return value
  return null
}

/**
 * The theme of the host, read from the theme service of the host.
 *
 * The service is optional: an older host has none, and a plugin that never
 * asked for it may not see it at all. Every step of it is guarded, and null
 * means "the service cannot answer" - the caller falls back to the
 * document.
 *
 * @param {any} ctx the client context of the plugin
 * @returns {string|null} 'dark', 'light' or null
 */
export function readHostThemeService(ctx) {
  try {
    const theme = ctx?.theme
    if (theme === undefined || theme === null || typeof theme.getTheme !== 'function') return null
    return themeOfSnapshot(theme.getTheme())
  } catch { return null }
}

/**
 * Subscribe to the theme of the host.
 *
 * The host publishes every change of its theme as the event `theme/change`.
 * A host that has no such event, or a context that cannot be asked, gives
 * null back - the caller watches the document then.
 *
 * @param {any} ctx the client context of the plugin
 * @param {(theme: string) => void} onChange called with the new theme
 * @returns {(() => void)|null} the disposer of the subscription, or null
 */
export function subscribeHostThemeService(ctx, onChange) {
  try {
    if (typeof ctx?.on !== 'function' || typeof onChange !== 'function') return null
    const off = ctx.on('theme/change', (snapshot) => {
      const theme = themeOfSnapshot(snapshot)
      if (theme === null) return
      try { onChange(theme) } catch { /* a broken listener must not stop the subscription */ }
    })
    return typeof off === 'function' ? off : null
  } catch { return null }
}

/**
 * Watch the theme of the host and report every change.
 *
 * The document is the safety net of the theme: the host writes the colour
 * scheme of its theme on the root element, so the theme is observed there -
 * the attributes of the root element and the head of the document (a theme
 * switch may swap the stylesheet). A debounce of 150 ms collapses the burst
 * of mutations of a theme switch into one re-read, and every step of it is
 * guarded: a browser without a MutationObserver, a document without a root
 * element or a broken listener must not take the terminal down.
 *
 * @param {(theme: string) => void} onChange called with the new theme
 * @param {object} [deps] the environment to watch
 * @param {Document} [deps.document] the document to watch
 * @param {number} [deps.debounceMs] the debounce of the watcher
 * @returns {() => void} the disposer of the watcher
 */
export function watchHostTheme(onChange, deps = {}) {
  const doc = deps.document ?? (typeof document !== 'undefined' ? document : null)
  const Observer = deps.MutationObserver ?? (typeof MutationObserver !== 'undefined' ? MutationObserver : null)
  const setTimer = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimeout ?? (handle => clearTimeout(handle))
  const debounceMs = deps.debounceMs ?? 150
  if (doc === null || doc === undefined || typeof onChange !== 'function') return () => {}
  let timer = null
  // The theme the terminal is in right now: only a real change is reported.
  let current = readHostTheme(doc)
  const emit = () => {
    timer = null
    const theme = readHostTheme(doc)
    if (theme === current) return
    current = theme
    try { onChange(theme) } catch { /* a broken listener must not stop the watch */ }
  }
  const schedule = () => {
    if (timer !== null) clearTimer(timer)
    timer = setTimer(emit, debounceMs)
  }
  let observer = null
  if (Observer !== null) {
    try {
      observer = new Observer(schedule)
      const root = doc.documentElement ?? null
      if (root !== null) {
        observer.observe(root, {
          attributes: true,
          attributeFilter: ['style', 'class', 'data-theme', 'data-color-scheme'],
        })
      }
      const head = doc.head ?? null
      if (head !== null) {
        observer.observe(head, { childList: true, subtree: true, characterData: true })
      }
    } catch { /* no observer: the terminal keeps the palette it has */ }
  }
  return () => {
    if (timer !== null) { clearTimer(timer); timer = null }
    try { observer?.disconnect() } catch { /* already gone */ }
    observer = null
  }
}

/**
 * Push a palette into a live terminal.
 *
 * xterm compares the theme by reference, so the palette has to be a new
 * object - that is what makes the renderer repaint the canvas. Nothing else
 * is touched: the buffer, the scrollback, the socket and the session stay
 * exactly as they were, and a running command is not interrupted.
 *
 * @param {any} terminal the xterm instance
 * @param {string} theme 'dark' or 'light'
 * @param {any} [element] the element that carries the custom properties
 * @returns {object} the palette that was pushed
 */
export function applyTerminalTheme(terminal, theme, element = null) {
  const palette = TERMINAL_PALETTES[theme] ?? TERMINAL_PALETTES[THEME_DARK]
  const current = terminal?.options?.theme
  if (current === undefined || current === null || current.background !== palette.background || current.foreground !== palette.foreground) {
    try { terminal.options.theme = { ...palette } } catch { /* the terminal is gone */ }
  }
  const target = element ?? terminal?.element ?? null
  if (target !== null && target !== undefined && typeof target.style?.setProperty === 'function') {
    // The IME composition preview is a DOM element and not canvas, so it
    // takes its colours from custom properties that the palette pushes
    // down - xterm ships it with a hard-coded black background.
    target.style.setProperty('--iwb-term-bg', palette.background)
    target.style.setProperty('--iwb-term-fg', palette.foreground)
  }
  return palette
}

/**
 * The guard of the input method (Issue #3 / R10).
 *
 * The characters are lost inside xterm, not in this plugin: when a
 * composition ends, xterm reads the committed text back from its hidden
 * textarea in a `setTimeout(0)` (`CompositionHelper._finalizeComposition`),
 * because the `data` of the composition event is not reliable on Chromium.
 * When the input method switches its language while a composition runs, the
 * textarea is cleared in between - the read yields an empty string and the
 * characters are dropped silently. Windows Terminal does not lose them,
 * because it synthesises the input natively and never reads back.
 *
 * The guard watches the composition and speaks only when the terminal
 * stayed silent: it sends the text the input method reported itself, over
 * the same path the terminal uses for its own input. It acts on the one
 * signature of the bug - a Shift pressed *during* a composition - so the
 * normal way of committing a candidate (space or enter) is never touched,
 * and the text can never be sent twice: the guard only speaks when xterm
 * sent nothing for that composition.
 *
 * @param {any} terminal the xterm instance
 * @param {(text: string) => void} send sends the text to the shell
 * @param {object} [deps] the timers to use
 * @returns {{dispose: () => void}} the disposer of the guard
 */
export function createImeGuard(terminal, send, deps = {}) {
  const setTimer = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimeout ?? (handle => clearTimeout(handle))
  const textarea = terminal?.textarea
  if (textarea === undefined || textarea === null || typeof textarea.addEventListener !== 'function') {
    return { dispose() {} }
  }
  const state = {
    composing: false,
    text: '',
    shift: false,
    spoke: false,
    repaired: false,
    timer: null,
    disposed: false,
  }
  const onCompositionStart = () => {
    state.composing = true
    state.text = ''
    state.shift = false
    state.spoke = false
    state.repaired = false
  }
  const onCompositionUpdate = (event) => {
    const data = event?.data
    // An empty update does not erase what was captured: some input methods
    // report an empty string before they end the composition.
    if (typeof data === 'string' && data !== '') state.text = data
  }
  const onKeyDown = (event) => {
    if (!state.composing) return
    if (event?.key === 'Shift' || event?.keyCode === 16) state.shift = true
  }
  const onCompositionEnd = (event) => {
    state.composing = false
    if (!state.shift) return
    // xterm queues the send of the committed text in a `setTimeout(0)` that
    // it started before this handler ran (its listener is the older one), so
    // the check below is queued after it and sees whether the terminal spoke.
    if (state.timer !== null) clearTimer(state.timer)
    state.timer = setTimer(() => {
      state.timer = null
      if (state.disposed || state.spoke || state.repaired) return
      // The text the input method reported while it composed is what the
      // user typed - the raw string, the way the native terminal of Windows
      // puts it on the screen. Only when the input method reported nothing
      // at all does the text of the composition event stand in for it.
      const committed = typeof event?.data === 'string' ? event.data : ''
      const text = state.text !== '' ? state.text : committed
      if (text === '') return
      state.repaired = true
      try { send(text) } catch { /* the session is gone */ }
    }, 0)
  }
  textarea.addEventListener('compositionstart', onCompositionStart)
  textarea.addEventListener('compositionupdate', onCompositionUpdate)
  textarea.addEventListener('compositionend', onCompositionEnd)
  textarea.addEventListener('keydown', onKeyDown)
  // The terminal speaks through `onData`; the guard listens to the same
  // stream to know that the characters are already on their way.
  const dataDisposable = typeof terminal?.onData === 'function'
    ? terminal.onData(() => { state.spoke = true })
    : null
  return {
    dispose() {
      state.disposed = true
      if (state.timer !== null) { clearTimer(state.timer); state.timer = null }
      textarea.removeEventListener('compositionstart', onCompositionStart)
      textarea.removeEventListener('compositionupdate', onCompositionUpdate)
      textarea.removeEventListener('compositionend', onCompositionEnd)
      textarea.removeEventListener('keydown', onKeyDown)
      dataDisposable?.dispose()
    },
  }
}

/**
 * A terminal narrower than this is treated as a transient state (a collapsing
 * sidebar, a hidden pane, a layout animation). Fitting to it would resize the
 * PTY to a handful of columns, which no shell can recover from gracefully.
 */
const MIN_FIT_WIDTH = 120

function TerminalView({ store, session, active, visible }) {
  const t = store.t
  const hostRef = useRef(null)
  const termRef = useRef(null)
  const fitRef = useRef(null)
  const socketRef = useRef(null)
  const scheduleRef = useRef(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (hostRef.current === null) return undefined
    // The theme of the host is read once here and watched afterwards: the
    // palette is concrete (xterm paints on its own canvas), so it has to be
    // pushed into the instance whenever the host switches its theme. The
    // theme service of the host is the first source; a host that has none
    // (or a plugin that cannot see it) is read from the document.
    const theme = readHostThemeService(store.ctx) ?? readHostTheme()
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: store.state.settings?.terminal?.fontSize ?? 13,
      fontFamily: '"JetBrains Mono", "Cascadia Code", "SF Mono", Consolas, monospace',
      allowProposedApi: true,
      theme: { ...TERMINAL_PALETTES[theme] },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(hostRef.current)
    termRef.current = terminal
    fitRef.current = fit
    // The palette also goes into the DOM: the IME composition preview is a
    // DOM element and not canvas, so it needs the colours of the surface.
    applyTerminalTheme(terminal, theme, terminal.element)

    const send = (frame) => {
      const socket = socketRef.current
      if (socket !== null && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame))
    }

    // The theme of the host is observed in two places: the theme service of
    // the host, when the plugin can see it, and the document, where the host
    // writes the colour scheme of its theme. A switch only repaints the
    // canvas of the running terminal: the instance, the socket, the session,
    // the scrollback and a running command stay as they are.
    const stopThemeWatch = watchHostTheme(next => {
      applyTerminalTheme(terminal, next, terminal.element)
    })
    // The theme service of the host, when there is one. Both sources are
    // used: the service is exact, the document is the safety net, and
    // pushing the same palette twice changes nothing.
    const offThemeService = subscribeHostThemeService(store.ctx, next => {
      applyTerminalTheme(terminal, next, terminal.element)
    })
    // The characters of a composition that the input method dropped when it
    // switched its language (Issue #3 / R10).
    const imeGuard = createImeGuard(terminal, text => send({ type: 'input', data: text }))

    // xterm and the PTY must agree on cols/rows. A fit that runs while the
    // pane is hidden or mid-transition would resize the shell to a few
    // columns, and the old code only told the PTY from the ResizeObserver, so
    // a missed callback left the shell there. Every fit now reconciles the
    // PTY explicitly, and a debounce collapses resize storms (docked →
    // fullscreen animates the width) into one fit at the settled size.
    let fitTimer = null
    let disposed = false
    let sentCols = 0
    let sentRows = 0
    const applyFit = () => {
      fitTimer = null
      if (disposed) return false
      const host = hostRef.current
      if (host === null || host.clientWidth < MIN_FIT_WIDTH || host.clientHeight === 0) return false
      try { fit.fit() } catch { return false }
      if (!(terminal.cols > 0) || !(terminal.rows > 0)) return false
      if (terminal.cols === sentCols && terminal.rows === sentRows) return true
      sentCols = terminal.cols
      sentRows = terminal.rows
      send({ type: 'resize', cols: terminal.cols, rows: terminal.rows })
      return true
    }
    const scheduleFit = (delay = 60) => {
      if (disposed) return
      if (fitTimer !== null) clearTimeout(fitTimer)
      fitTimer = setTimeout(applyFit, delay)
    }
    scheduleRef.current = scheduleFit
    // The first measurement can land before the webfont is ready (cell width
    // is then a fallback-font estimate) or before the pane has a size.
    const firstFit = () => { scheduleFit(0) }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(firstFit)
    else firstFit()
    if (typeof document !== 'undefined' && document.fonts?.ready !== undefined) {
      document.fonts.ready.then(() => scheduleFit(0)).catch(() => {})
    }

    const connect = () => {
      const url = wsUrl('ide-workbench/ws/terminal')
      url.searchParams.set('root', store.state.root)
      if (session.cwd !== undefined && session.cwd !== '') url.searchParams.set('cwd', session.cwd)
      if (session.shell !== undefined && session.shell !== '') url.searchParams.set('shell', session.shell)
      url.searchParams.set('cols', String(terminal.cols || 80))
      url.searchParams.set('rows', String(terminal.rows || 24))
      const socket = new WebSocket(url.href)
      socketRef.current = socket
      socket.addEventListener('open', () => {
        store.patchTerminal(session.key, { status: 'running' })
        // Reconcile unconditionally: the URL carried the size known at connect
        // time, which may already be stale by the time the socket opens.
        sentCols = 0
        sentRows = 0
        applyFit()
        terminal.focus()
      })
      socket.addEventListener('message', (event) => {
        let frame
        try { frame = JSON.parse(event.data) } catch { return }
        if (frame.type === 'ready') {
          store.patchTerminal(session.key, {
            id: frame.info.id,
            status: 'running',
            cwd: frame.info.cwd,
            shell: frame.info.shell.id,
            title: session.titleRenamed === true ? session.title : frame.info.shell.label,
          })
          setError(null)
        } else if (frame.type === 'data') {
          terminal.write(typeof frame.data === 'string' ? frame.data : '')
        } else if (frame.type === 'exit') {
          store.patchTerminal(session.key, { status: 'exited', exitCode: frame.exitCode })
          terminal.write(`\r\n\x1b[90m[process exited${frame.exitCode !== null ? `: ${frame.exitCode}` : ''}]\x1b[0m\r\n`)
        } else if (frame.type === 'error') {
          setError(frame.message)
          store.patchTerminal(session.key, { status: 'failed', error: frame.message })
        }
      })
      socket.addEventListener('close', () => {
        if (socketRef.current === socket) socketRef.current = null
        const current = store.state.terminal.sessions.find(item => item.key === session.key)
        if (current !== undefined && current.status === 'running') {
          store.patchTerminal(session.key, { status: 'exited' })
        }
      })
      socket.addEventListener('error', () => {
        setError(t('terminal.failed'))
      })
    }
    connect()

    const dataDisposable = terminal.onData(data => send({ type: 'input', data }))
    const selectionDisposable = terminal.onSelectionChange(() => {
      if (store.state.settings?.terminal?.copyOnSelect === true) {
        const selection = terminal.getSelection()
        if (selection !== '') void navigator.clipboard.writeText(selection).catch(() => {})
      }
    })
    const resizeObserver = new ResizeObserver(() => {
      if (hostRef.current === null || hostRef.current.clientWidth < MIN_FIT_WIDTH) return
      scheduleFit(60)
    })
    resizeObserver.observe(hostRef.current)
    // A dock resize (pointer drag) and a window resize can both settle outside
    // the observed pane; a single trailing fit keeps them consistent.
    const onWindowResize = () => scheduleFit(80)
    window.addEventListener('resize', onWindowResize)
    // Self-heal: xterm's rendered width and the pane can disagree when a
    // ResizeObserver notification is coalesced with a layout transition (the
    // 9-column terminal came from exactly that). Comparing the two is cheap
    // and recovers from any missed event, not only the known ones.
    const watchdog = setInterval(() => {
      if (disposed) return
      const host = hostRef.current
      const element = terminal.element
      if (host === null || element === null || host.clientWidth < MIN_FIT_WIDTH) return
      if (Math.abs(element.offsetWidth - host.clientWidth) > 32) scheduleFit(0)
    }, 1200)

    const onKeyDown = (event) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        void navigator.clipboard.readText().then(text => { if (text !== '') send({ type: 'input', data: text }) }).catch(() => {})
        return
      }
      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'c' && terminal.hasSelection()) {
        event.preventDefault()
        void navigator.clipboard.writeText(terminal.getSelection()).catch(() => {})
        return
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'f') {
        // The browser's find UI is not available inside a canvas terminal;
        // Ctrl+F stays with the shell.
      }
    }
    hostRef.current.addEventListener('keydown', onKeyDown, true)

    return () => {
      disposed = true
      hostRef.current?.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onWindowResize)
      clearInterval(watchdog)
      if (fitTimer !== null) { clearTimeout(fitTimer); fitTimer = null }
      resizeObserver.disconnect()
      dataDisposable.dispose()
      selectionDisposable.dispose()
      stopThemeWatch()
      offThemeService?.()
      imeGuard.dispose()
      const socket = socketRef.current
      socketRef.current = null
      if (socket !== null) socket.close()
      scheduleRef.current = null
      terminal.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.key])

  useEffect(() => {
    if (active === true && visible !== false) {
      const terminal = termRef.current
      if (terminal !== null) {
        window.setTimeout(() => {
          scheduleRef.current?.()
          try { terminal.focus() } catch { /* disposed while hidden */ }
        }, 30)
      }
    }
  }, [active, visible])

  if (error !== null) {
    return React.createElement('div', { className: 'iwb-term-pane' },
      React.createElement('div', { className: 'iwb-term-error' }, `${t('terminal.failed')}\n${error}`),
    )
  }

  return React.createElement('div', { className: `iwb-term-pane ${active ? '' : 'iwb-hidden'}` },
    React.createElement('div', { className: 'iwb-term-host', ref: hostRef }),
  )
}

export function TerminalPanel({ store, state, visible = true }) {
  const t = store.t
  // `state` is still accepted (the Workbench cleanup drops the prop in a
  // parallel step) but the panel reads its own slice from now on.
  const slice = useStoreSlice(store, terminalSlice, shallowEqual)
  const sessions = slice.terminal.sessions
  const activeKey = slice.terminal.activeKey ?? sessions[0]?.key ?? null
  const [renaming, setRenaming] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  const commitRename = () => {
    if (renaming !== null && renameValue.trim() !== '') {
      store.patchTerminal(renaming, { title: renameValue.trim(), titleRenamed: true })
    }
    setRenaming(null)
  }

  return React.createElement('div', { className: 'iwb-term' },
    React.createElement('div', { className: 'iwb-term-tabs' },
      sessions.map(session => React.createElement('div', {
        key: session.key,
        className: `iwb-term-tab ${session.key === activeKey ? 'iwb-on' : ''}`,
        onClick: () => store.activateTerminal(session.key),
        onDoubleClick: () => { setRenaming(session.key); setRenameValue(session.title) },
        title: `${session.title} — ${session.cwd}`,
      },
        renaming === session.key
          ? React.createElement('input', {
              autoFocus: true,
              className: 'iwb-input',
              style: { height: 20, width: 120, padding: '0 4px' },
              value: renameValue,
              onClick: event => event.stopPropagation(),
              onChange: event => setRenameValue(event.target.value),
              onBlur: commitRename,
              onKeyDown: event => {
                if (event.key === 'Enter') commitRename()
                if (event.key === 'Escape') setRenaming(null)
              },
            })
          : React.createElement('span', null, session.title),
        React.createElement('span', { className: `iwb-term-dot ${session.status === 'running' ? '' : 'iwb-exited'}` }),
        React.createElement('button', {
          type: 'button', className: 'iwb-iconbtn', style: { width: 16, height: 16 }, title: t('terminal.close'),
          onClick: event => { event.stopPropagation(); void store.closeTerminal(session.key) },
        }, React.createElement('span', { style: { fontSize: 13, lineHeight: 1 } }, '×')),
      )),
      React.createElement('button', {
        type: 'button', className: 'iwb-iconbtn', title: t('terminal.new'), onClick: () => store.addTerminal(),
      }, React.createElement(IconPlus, { width: 13, height: 13 })),
      React.createElement('button', {
        type: 'button', className: 'iwb-iconbtn', title: t('terminal.atFile'),
        onClick: () => {
          // Read the live state: the open tabs are not part of the panel's
          // slice, so they must not be captured from an older render.
          const active = store.state.tabs.find(tab => tab.id === store.state.activeId)
          if (active?.kind === 'file') store.addTerminal({ cwd: dirName(active.path) })
          else store.addTerminal()
        },
      }, React.createElement(FileTypeIcon, { kind: 'folder', size: 13 })),
      React.createElement('span', { style: { flex: 1 } }),
      React.createElement('span', { style: { color: 'var(--iwb-muted)', fontSize: 11, marginRight: 6 } },
        activeKey !== null ? (sessions.find(session => session.key === activeKey)?.cwd ?? '') : '',
      ),
    ),
    React.createElement('div', { className: 'iwb-term-panes' },
      sessions.length === 0
        ? React.createElement('div', { className: 'iwb-empty' },
            React.createElement(IconTerminal, { width: 22, height: 22 }),
            React.createElement('div', { className: 'iwb-empty-title' }, t('terminal.hint')),
            React.createElement('button', { type: 'button', className: 'iwb-textbtn iwb-primary', onClick: () => store.addTerminal() }, t('terminal.new')),
          )
        : sessions.map(session => React.createElement(TerminalView, {
            key: session.key, store, session, active: session.key === activeKey, visible,
          })),
    ),
  )
}
