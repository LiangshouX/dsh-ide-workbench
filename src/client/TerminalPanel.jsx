/**
 * Terminal tool window: real PTY sessions over a package WebSocket, rendered
 * with xterm.js. One socket == one session; closing the tab terminates it.
 */
import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { wsUrl, call } from './api.js'
import { IconFolder, IconPlus, IconTerminal } from './icons.jsx'
import { dirName } from './util.js'

/** Read one theme token from the workbench root (with a neutral fallback). */
function token(root, name, fallback) {
  const element = root?.current ?? document.querySelector('.iwb-root')
  if (element === null) return fallback
  const value = getComputedStyle(element).getPropertyValue(name).trim()
  return value === '' ? fallback : value
}

/**
 * A terminal narrower than this is treated as a transient state (a collapsing
 * sidebar, a hidden pane, a layout animation). Fitting to it would resize the
 * PTY to a handful of columns, which no shell can recover from gracefully.
 */
const MIN_FIT_WIDTH = 120

function TerminalView({ store, state, session, active, visible }) {
  const t = store.t
  const hostRef = useRef(null)
  const termRef = useRef(null)
  const fitRef = useRef(null)
  const socketRef = useRef(null)
  const scheduleRef = useRef(null)
  const [error, setError] = useState(null)
  const rootRef = useRef(null)

  useEffect(() => {
    if (hostRef.current === null) return undefined
    rootRef.current = document.querySelector('.iwb-root')
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: state.settings?.terminal?.fontSize ?? 13,
      fontFamily: '"JetBrains Mono", "Cascadia Code", "SF Mono", Consolas, monospace',
      allowProposedApi: true,
      theme: {
        background: token(rootRef, '--iwb-bg', '#15171c'),
        foreground: token(rootRef, '--iwb-fg', '#d8dce3'),
        cursor: token(rootRef, '--iwb-accent', '#4c9aff'),
        selectionBackground: 'rgba(76,154,255,.32)',
        black: '#1c1f26', red: '#e2686f', green: '#4fb477', yellow: '#d7a24a',
        blue: '#4c9aff', magenta: '#c678dd', cyan: '#56b6c2', white: '#d8dce3',
        brightBlack: '#8a93a1', brightRed: '#ff7b86', brightGreen: '#6fd08c', brightYellow: '#e8bd6a',
        brightBlue: '#6cb0ff', brightMagenta: '#d79ae8', brightCyan: '#7fd4df', brightWhite: '#ffffff',
      },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(hostRef.current)
    termRef.current = terminal
    fitRef.current = fit

    const send = (frame) => {
      const socket = socketRef.current
      if (socket !== null && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame))
    }

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
      url.searchParams.set('root', state.root)
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
  const sessions = state.terminal.sessions
  const activeKey = state.terminal.activeKey ?? sessions[0]?.key ?? null
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
          const active = state.tabs.find(tab => tab.id === state.activeId)
          if (active?.kind === 'file') store.addTerminal({ cwd: dirName(active.path) })
          else store.addTerminal()
        },
      }, React.createElement(IconFolder, { width: 13, height: 13 })),
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
            key: session.key, store, state, session, active: session.key === activeKey, visible,
          })),
    ),
  )
}
