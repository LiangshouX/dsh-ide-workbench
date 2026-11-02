/**
 * The status item of the code intelligence plugin.
 *
 * The status bar is the only place where the state of the semantic analysis
 * reaches the user, and it used to say the SAME sentence for four different
 * states: "basic mode". A server that was released to save memory, a server
 * that never ran, a server that could not be started and a server that broke
 * all looked like a fault - and the user could not tell them apart.
 *
 * The mapping lives here, in the plugin: the core renders the item in its
 * `statusItem` slot and hands it the contract, and the item reads the state
 * of the store of the plugin.
 *
 * The rules are the ones of PRD-v5 §2.4 (the elapsed time of a session that
 * is coming up), of §4.3 (the host owns the state machine) and of the
 * connection-state review (a dead client session wins over a host that claims
 * to be fine, but not over a host that knows the reason).
 */
import React from 'react'
import { LSP_HOST_HEALTHY_STATES } from './lsp-session.js'

/**
 * How many failed semantic requests make the session "unstable".
 *
 * The host owns the state machine, but it cannot see a request that timed
 * out: only the client knows that the server stopped answering. Three
 * failures (or two timeouts, which is the most typical silent failure) turn
 * the status bar yellow instead of green.
 */
export const LSP_UNSTABLE_FAILURES = 3
export const LSP_UNSTABLE_TIMEOUTS = 2

/**
 * Fill in the `{placeholder}` slots of one text.
 * @param {string} text the text
 * @param {Record<string, string | number>} values the values
 * @returns {string} the text with its slots filled in
 */
export function interpolate(text, values) {
  let out = typeof text === 'string' ? text : ''
  for (const [name, value] of Object.entries(values ?? {})) {
    out = out.replaceAll(`{${name}}`, String(value))
  }
  return out
}

/**
 * One text of the dictionary, with a fallback.
 *
 * A key that the table does not carry (an older table) falls back to the
 * second text instead of showing the key itself.
 * @param {(key: string) => string} t the translator
 * @param {string} key the key
 * @param {string} fallback the fallback
 * @returns {string} the text
 */
function label(t, key, fallback) {
  const value = t(key)
  return typeof value === 'string' && value !== '' && value !== key ? value : fallback
}

/**
 * The two numbers of a waited time.
 *
 * The status text of a session that is coming up has to say how long the
 * user has been waiting: a bare "starting…" looked like a hang.
 * @param {number} elapsedMs the milliseconds since the session started
 * @returns {{minutes: number, seconds: number}} the two numbers
 */
export function waitedFor(elapsedMs) {
  const value = Number.isFinite(elapsedMs) ? elapsedMs : 0
  const total = Math.max(0, Math.floor(value / 1000))
  return { minutes: Math.floor(total / 60), seconds: total % 60 }
}

/**
 * A waited time as one readable string.
 *
 * The units belong to the language of the interface, so they are a parameter
 * and not a constant: "2 min 14 s" and "2 分 14 秒" say the same thing.
 * @param {number} minutes the whole minutes
 * @param {number} seconds the seconds left
 * @param {'en'|'zh'} [locale] the language of the units
 * @returns {string} "2 min 14 s" / "2 分 14 秒"
 */
export function formatWaited(minutes, seconds, locale = 'en') {
  return locale === 'zh'
    ? `${minutes} 分 ${seconds} 秒`
    : `${minutes} min ${seconds} s`
}

/**
 * Whether one translated text is Chinese.
 *
 * The store does not carry the locale of the interface, but the text does:
 * the Chinese table is Chinese. The status item only needs it to pick the
 * units of the waited time.
 * @param {string} text a translated text
 * @returns {boolean} true for a Chinese text
 */
function isChineseText(text) {
  return /[\u3400-\u9fff]/.test(typeof text === 'string' ? text : '')
}

/**
 * The client states that say the problem is on the CLIENT side.
 *
 * 'failed' = the session is dead, 'starting' = the session is still being
 * established, 'idle' = there is NO session at all.
 */
const CLIENT_SESSION_PROBLEMS = ['failed', 'starting', 'idle']

/**
 * Whether the status bar offers the rebuild button.
 *
 * The button is NOT offered when the problem is on the client side: the
 * reconnect button does everything the rebuild button does (the host stops
 * and starts its server) PLUS the client handshake, so showing both would
 * offer two buttons for one problem - and the weaker one first.
 * @param {string} viewKey the key of the status view
 * @param {object} [lsp] the `lsp` slice of the state
 * @returns {boolean} true when the button is shown
 */
export function showRebuildButton(viewKey, lsp = {}) {
  if (lsp.rebuilding === true) return false
  if (CLIENT_SESSION_PROBLEMS.includes(lsp.clientState)) return false
  return ['degraded', 'failed', 'cancelled', 'idle', 'suspended'].includes(viewKey)
}

/**
 * Whether the status bar offers the reconnect button.
 *
 * The button follows the PROBLEM and not the display winner: the exit has to
 * be there whenever the session is dead - the greyed menu item points at it,
 * and a tooltip that promises a button that is not there is a lie.
 * @param {string} viewKey the key of the status view
 * @param {string} [clientState] the state of the client session
 * @returns {boolean} true when the button is shown
 */
export function showReconnectButton(viewKey, clientState = '') {
  if (viewKey === 'sessionFailed' || viewKey === 'sessionConnecting' || viewKey === 'sessionIdle') return true
  return CLIENT_SESSION_PROBLEMS.includes(clientState)
}

/**
 * Whether the status bar offers the cancel button.
 *
 * The argument is the state of the HOST and not the key of the status view:
 * the client session may hide the state of the host behind "connecting…",
 * but the build it waits for can still be cancelled.
 * @param {string} hostState the state the host reports
 * @param {boolean} cancellable whether the host says the build may be cancelled
 * @returns {boolean} true when the button is shown
 */
export function showCancelButton(hostState, cancellable) {
  return cancellable === true && ['building', 'starting', 'restarting'].includes(hostState)
}

/**
 * The numbers of the memory row of the diagnostics panel.
 *
 * "Available" is the memory a new language server may really use - the free
 * memory of the machine minus what the running servers have reserved. It is
 * the number the host judges the start by, so it is the number the panel has
 * to show: the free memory of the machine alone would say "plenty of memory"
 * while the gate says "not enough".
 *
 * "Needs" is what the next server would take, and "Reserved" is what the
 * running servers may STILL GROW INTO - the ceiling they were granted minus
 * the memory they have taken already. The semantics changed with PRD-v5.1
 * MEM-05: the reservation used to be the whole ceiling, which charged every
 * running server twice (once for what it used, once for what it might still
 * take).
 *
 * The memory the running servers have taken already has NO row of its own:
 * it is already subtracted from the free memory of the machine, which is why
 * the panel shows the AVAILABLE memory and not "free minus used". "Reserved"
 * is neither their usage nor their ceiling - it is the room they may still
 * take. The reservation is only shown when there is one: a row that always
 * says "reserved 0 MB" is noise.
 *
 * The panel shows TWO bands (PRD-v5.1 MEM-07): the typical one above ("the
 * server needs 651 MB, the machine has 1206 MB") and the worst one below
 * ("if this server takes its ceiling of 2048 MB, the machine will be left
 * with -842 MB"). One band alone is a promise the machine may not keep: the
 * gate judges the estimate, but the server may grow into its ceiling.
 *
 * The PRESSURE MARGIN is the third number of the host (`safeAvailableBytes`):
 * the memory the machine has left when the running servers are charged with
 * their CONFIRMED footprint. The pressure valve works with that number, the
 * gate and the accounting with the other one. The row appears only when the
 * two numbers differ: a row that says the same thing twice is noise.
 * @param {{t: (key: string) => string}} store the store of the plugin
 * @param {object | null} resources the memory snapshot of the host
 * @returns {{availableMB: number|null, needMB: number|null, reservedMB: number, text: string, worstMB: number|null, worstText: string, safeAvailableMB: number|null}} the numbers
 */
export function memoryFacts(store, resources) {
  const t = store.t
  if (resources === null || resources === undefined) {
    return { availableMB: null, needMB: null, reservedMB: 0, text: '—', worstMB: null, worstText: '', safeAvailableMB: null }
  }
  const mib = 1024 * 1024
  const availableMB = Math.round((resources.availableBytes ?? resources.freeBytes ?? 0) / mib)
  const needMB = Math.round(resources.needMB ?? 0)
  const reservedMB = Math.round((resources.reservedBytes ?? 0) / mib)
  const text = `${t('lsp.diagnostics.memoryAvailable')} ${availableMB} MB · ${t('lsp.diagnostics.memoryNeed')} ${needMB} MB`
    + (reservedMB > 0 ? ` · ${t('lsp.diagnostics.memoryReserved')} ${reservedMB} MB` : '')
  const worstBytes = Number.isFinite(resources.worstCaseBytes) ? resources.worstCaseBytes : null
  const ceilingMB = Number.isFinite(resources.ceilingMB) ? resources.ceilingMB : null
  const worstMB = worstBytes === null ? null : Math.round(worstBytes / mib)
  const worstText = worstMB === null || ceilingMB === null
    ? ''
    : interpolate(t('lsp.diagnostics.memoryWorstText'), { ceiling: ceilingMB, left: worstMB })
  const safeBytes = Number.isFinite(resources.safeAvailableBytes) ? resources.safeAvailableBytes : null
  const safeMB = safeBytes === null ? null : Math.round(safeBytes / mib)
  const safeAvailableMB = safeMB !== null && safeMB < availableMB ? safeMB : null
  return { availableMB, needMB, reservedMB, text, worstMB, worstText, safeAvailableMB }
}

/**
 * The host states in which the client session shows "connecting…".
 *
 * Only "ready" and "building": the label of "starting" and "restarting"
 * carries the elapsed time, and the client session cannot be ready during
 * them anyway.
 */
const HOST_CONNECTING_STATES = ['ready', 'building']

/**
 * How long the session has been coming up.
 * @param {object} lsp the `lsp` slice of the state
 * @returns {{minutes: number, seconds: number}|null} the two numbers
 */
function waitedSince(lsp) {
  const startedAt = typeof lsp?.startedAt === 'number' && lsp.startedAt > 0 ? lsp.startedAt : 0
  if (startedAt === 0) return null
  return waitedFor(Date.now() - startedAt)
}

/**
 * How long the CLIENT has been waiting for its session.
 *
 * The client reports when it started waiting (`clientSince`), and that is
 * the time the user cares about: the age of the host's session says how long
 * the SERVER has been up, which is a different question.
 * @param {object} lsp the `lsp` slice of the state
 * @returns {{minutes: number, seconds: number}|null} the two numbers
 */
function waitedSinceClient(lsp) {
  const since = typeof lsp?.clientSince === 'number' && lsp.clientSince > 0 ? lsp.clientSince : 0
  if (since > 0) return waitedFor(Date.now() - since)
  return waitedSince(lsp)
}

/**
 * The semantic-analysis status of the plugin.
 *
 * The host owns the state machine; this only maps it to a label, a tone and
 * an optional action. Two sources are combined: the state the host reports
 * and the health the client measured - a server that says "ready" while
 * every semantic request fails is not ready.
 *
 * @param {{t: (key: string) => string}} store the store of the plugin
 * @param {object} state the snapshot of the plugin
 * @returns {{key: string, text: string, tone: 'idle'|'warn'|'ok'|'error', title: string, detail: string, action: string|null}} the view
 */
export function lspStatusView(store, state) {
  const t = store.t
  const lsp = state?.lsp ?? {}
  const settingsLsp = state?.settings?.lsp ?? {}
  const language = typeof lsp.languageId === 'string' ? lsp.languageId : ''
  const current = typeof lsp.state === 'string' && lsp.state !== '' ? lsp.state : 'idle'
  const detail = typeof lsp.detail === 'string' ? lsp.detail : ''
  const base = { title: t('lsp.statusTitle'), detail, action: null }
  // A poll that failed leaves the client with a value that may be minutes
  // old: showing that value is exactly what made the status bar lie.
  if (state?.lspStatusStale === true) {
    return { ...base, key: 'unknown', text: t('lsp.status.unknown'), tone: 'idle' }
  }
  if (settingsLsp.enabled === false || lsp.enabled === false || current === 'disabled') {
    return { ...base, key: 'disabled', text: t('lsp.status.disabled'), tone: 'idle' }
  }
  const clientState = typeof lsp.clientState === 'string' ? lsp.clientState : ''
  const clientDetail = typeof lsp.clientDetail === 'string' ? lsp.clientDetail : ''
  // A language without a server is a different state than a failing server:
  // the user has to install something, so the item points at the settings.
  // A language that the user switched off is not missing.
  const missing = (lsp.servers?.missing ?? []).filter(entry => typeof entry?.languageId === 'string' && entry.enabled !== false)
  const missingHere = missing.find(entry => entry.languageId === language)
  const missingOnly = missingHere ?? (missing.length === 1 ? missing[0] : undefined)
  if (missingOnly !== undefined && current !== 'ready' && current !== 'building' && current !== 'starting') {
    return {
      ...base,
      key: 'missing',
      text: interpolate(t('lsp.status.missing'), { language: missingOnly.languageId }),
      tone: 'idle',
      action: 'settings',
      title: interpolate(t('lsp.serverMissing'), { language: missingOnly.languageId }),
    }
  }
  // The state of the client session wins over a host that claims to be fine:
  // a dead session means that the semantic features do not work, whatever the
  // host says about its process.
  if (clientState === 'failed' && LSP_HOST_HEALTHY_STATES.includes(current)) {
    return {
      ...base,
      key: 'sessionFailed',
      text: t('lsp.status.sessionFailed'),
      tone: 'error',
      action: 'diagnostics',
      detail: clientDetail === '' ? base.detail : clientDetail,
    }
  }
  if (clientState === 'starting' && HOST_CONNECTING_STATES.includes(current)) {
    const waited = waitedSinceClient(lsp)
    const waitedText = waited === null
      ? ''
      : formatWaited(waited.minutes, waited.seconds, isChineseText(t('lsp.status.sessionConnecting')) ? 'zh' : 'en')
    const hostText = current === 'building' ? t('lsp.status.building') : ''
    return {
      ...base,
      key: 'sessionConnecting',
      text: t('lsp.status.sessionConnecting'),
      tone: 'idle',
      detail: base.detail === '' ? (waitedText !== '' ? waitedText : hostText) : base.detail,
    }
  }
  if (clientState === 'idle' && LSP_HOST_HEALTHY_STATES.includes(current)) {
    // There is NO client session, and the host still says the server is
    // alive: the bar has to say so - "connecting…" and "ready" would both be
    // lies.
    return {
      ...base,
      key: 'sessionIdle',
      text: t('lsp.status.sessionIdle'),
      tone: 'warn',
      action: 'diagnostics',
    }
  }
  const failures = Number.isFinite(lsp.consecutiveFailures) ? lsp.consecutiveFailures : 0
  const timeouts = Number.isFinite(lsp.consecutiveTimeouts) ? lsp.consecutiveTimeouts : 0
  switch (current) {
    case 'starting':
    case 'restarting': {
      const waited = waitedSince(lsp)
      if (waited === null) {
        const plain = current === 'starting' ? t('lsp.status.starting') : t('lsp.status.restarting')
        return { ...base, key: current, text: plain, tone: 'idle' }
      }
      const template = current === 'starting' ? t('lsp.status.startingWait') : t('lsp.status.restartingWait')
      return {
        ...base,
        key: current,
        text: interpolate(template, { minutes: waited.minutes, seconds: waited.seconds }),
        tone: 'idle',
        detail: base.detail === ''
          ? formatWaited(waited.minutes, waited.seconds, isChineseText(template) ? 'zh' : 'en')
          : base.detail,
      }
    }
    case 'building':
      return { ...base, key: 'building', text: t('lsp.status.building'), tone: 'warn' }
    case 'cancelling':
      return {
        ...base,
        key: 'cancelling',
        text: label(t, 'lsp.status.cancelling', t('lsp.status.cancelled')),
        tone: 'idle',
      }
    case 'ready':
      if (failures >= LSP_UNSTABLE_FAILURES || timeouts >= LSP_UNSTABLE_TIMEOUTS) {
        const text = timeouts >= LSP_UNSTABLE_TIMEOUTS
          ? interpolate(t('lsp.status.unstableTimeout'), { count: timeouts })
          : interpolate(t('lsp.status.unstable'), { count: failures })
        return { ...base, key: 'unstable', text, tone: 'warn', action: 'diagnostics' }
      }
      if (lsp.buildingProgram === true) {
        return { ...base, key: 'buildingProgram', text: t('lsp.status.buildingProgram'), tone: 'warn' }
      }
      return { ...base, key: 'ready', text: t('lsp.status.ready'), tone: 'ok' }
    case 'crashed':
      return { ...base, key: 'crashed', text: t('lsp.status.crashed'), tone: 'error', action: 'crash' }
    case 'cancelled':
      return { ...base, key: 'cancelled', text: t('lsp.status.cancelled'), tone: 'warn', action: 'diagnostics' }
    case 'degraded':
      return { ...base, key: 'degraded', text: t('lsp.status.degraded'), tone: 'warn', action: 'diagnostics' }
    case 'failed':
      return { ...base, key: 'failed', text: t('lsp.status.failed'), tone: 'error', action: 'diagnostics' }
    case 'idle':
      // When the USER chose the basic mode for this project, the status says
      // so as well (PRD-v5.1 WS-04): a grey dot with no reason reads like a
      // broken feature.
      if (typeof store.lspWorkspaceDefault === 'function'
        && store.lspWorkspaceDefault(state?.root) === 'conservative') {
        return {
          ...base,
          key: 'workspaceOff',
          text: t('lsp.status.workspaceOff'),
          tone: 'idle',
          action: 'diagnostics',
          detail: t('lsp.workspaceOffHint'),
        }
      }
      return { ...base, key: 'idle', text: t('lsp.status.idle'), tone: 'idle', action: 'diagnostics' }
    case 'suspended':
      return { ...base, key: 'suspended', text: t('lsp.status.suspended'), tone: 'idle', action: 'diagnostics' }
    default:
      return { ...base, key: 'idle', text: t('lsp.status.idle'), tone: 'idle', action: 'diagnostics' }
  }
}

/**
 * The transient notice of the plugin.
 *
 * The plugin has no surface of its own: it is rendered inside the surfaces
 * of the core (the status bar) or inside its own settings page (the degraded
 * mode). The notice is therefore drawn by the component that owns the
 * surface, and it disappears on its own.
 *
 * @param {{store: object, state: object}} props the store and its snapshot
 * @returns {React.ReactElement | null} the notice
 */
export function Toast({ store, state }) {
  const toast = state?.toast ?? null
  if (toast === null) return null
  return React.createElement('div', { className: `iwb-toast iwb-toast-${toast.kind ?? 'info'}`, role: 'status' },
    React.createElement('span', { className: 'iwb-toast-text' }, toast.text),
    toast.detail === '' || toast.detail === undefined
      ? null
      : React.createElement('span', { className: 'iwb-toast-detail' }, toast.detail))
}

/**
 * The semantic-analysis item of the status bar.
 *
 * The item is always visible: a missing capability has to be visible, not
 * hidden. The dot carries the state by its colour, and the label folds away
 * in a narrow pane - the stylesheet owns that part.
 *
 * @param {{store: object, state: object, onOpenSettings?: Function, onOpenDiagnostics?: Function}} props the store and its snapshot
 * @returns {React.ReactElement} the item
 */
export function LspStatus({ store, state, onOpenSettings, onOpenDiagnostics }) {
  const t = store.t
  const lsp = state.lsp ?? {}
  const view = lspStatusView(store, state)
  const cancelAfter = state.settings?.lsp?.cancelAfterMs ?? 60000
  const startedAt = typeof lsp.startedAt === 'number' ? lsp.startedAt : 0
  const cancellable = lsp.cancellable === true
    || (startedAt > 0 && Date.now() - startedAt > cancelAfter)
  const showCancel = showCancelButton(lsp.state, cancellable)
  const showRebuild = showRebuildButton(view.key, lsp)
  const showReconnect = showReconnectButton(view.key, lsp.clientState)
  const tone = view.tone === 'ok' ? ' iwb-lsp-status-ready'
    : (view.tone === 'warn' ? ' iwb-lsp-status-warn' : (view.tone === 'error' ? ' iwb-lsp-status-error' : ' iwb-lsp-status-muted'))
  const title = view.detail === '' ? view.title : `${view.title} — ${view.detail}`
  const onClick = view.action === 'settings'
    ? () => { onOpenSettings?.() }
    : (view.action === 'crash' ? () => { store.toast('error', t('lsp.crashedToast'), view.detail) }
      : (view.action === 'diagnostics' ? () => { onOpenDiagnostics?.() } : undefined))
  return React.createElement('span', {
    className: `iwb-status-item iwb-lsp-status${tone}`,
    title,
    'data-lsp-state': view.key,
    style: onClick === undefined ? undefined : { cursor: 'pointer' },
    onClick,
  },
    React.createElement('span', { className: 'iwb-lsp-status-dot' }),
    React.createElement('span', { className: 'iwb-lsp-status-label' }, view.text),
    showCancel
      ? React.createElement('button', {
          type: 'button',
          className: 'iwb-lsp-cancel',
          title: t('lsp.cancelIndex'),
          onClick: event => {
            event.stopPropagation()
            void store.cancelLspIndex()
          },
        }, t('lsp.cancelIndex'))
      : null,
    showRebuild
      ? React.createElement('button', {
          type: 'button',
          className: 'iwb-lsp-cancel',
          title: t('lsp.rebuildIndex'),
          onClick: event => {
            event.stopPropagation()
            void store.restartLsp()
          },
        }, t('lsp.rebuildIndex'))
      : null,
    showReconnect
      ? React.createElement('button', {
          type: 'button',
          className: 'iwb-lsp-cancel',
          title: t('lsp.reconnect'),
          onClick: event => {
            event.stopPropagation()
            void store.reconnectLsp()
          },
        }, t('lsp.reconnect'))
      : null,
    lsp.rebuilding === true
      ? React.createElement('span', { className: 'iwb-lsp-status-label' }, t('lsp.diagnostics.rebuilding'))
      : null,
  )
}

/**
 * The diagnostics panel of the semantic analysis.
 *
 * The toast tells the user in one localized sentence; the panel carries the
 * exact technical reason the host reported - it is the only place where it
 * is readable.
 *
 * @param {{store: object, state: object, onOpenSettings?: Function, onClose?: Function}} props the store and its snapshot
 * @returns {React.ReactElement} the panel
 */
export function LspDiagnosticsModal({ store, state, onOpenSettings, onClose }) {
  const t = store.t
  const lsp = state.lsp ?? {}
  const resources = lsp.resources ?? null
  const facts = memoryFacts(store, resources)
  const rows = [
    React.createElement('div', { key: 'state', className: 'iwb-lsp-row' },
      React.createElement('span', { className: 'iwb-lsp-row-label' }, t('lsp.diagnostics.state')),
      React.createElement('span', { className: 'iwb-lsp-row-value' }, lsp.state ?? 'idle')),
    React.createElement('div', { key: 'health', className: 'iwb-lsp-row' },
      React.createElement('span', { className: 'iwb-lsp-row-label' }, t('lsp.diagnostics.health')),
      React.createElement('span', { className: 'iwb-lsp-row-value' },
        (lsp.consecutiveFailures ?? 0) + ' / ' + (lsp.consecutiveTimeouts ?? 0))),
  ]
  // The reason of the host is the row that matters: it says WHY the session
  // is in its state.
  if (typeof lsp.detail === 'string' && lsp.detail !== '') {
    rows.push(React.createElement('div', { key: 'reason', className: 'iwb-lsp-row' },
      React.createElement('span', { className: 'iwb-lsp-row-label' }, t('lsp.diagnostics.reason')),
      React.createElement('span', { className: 'iwb-lsp-row-value' }, lsp.detail)))
  }
  if (facts.text !== '') {
    rows.push(React.createElement('div', { key: 'memory', className: 'iwb-lsp-row' },
      React.createElement('span', { className: 'iwb-lsp-row-label' }, t('lsp.diagnostics.memory')),
      React.createElement('span', { className: 'iwb-lsp-row-value' }, facts.text)))
  }
  // The pressure margin: the memory the machine has left when the running
  // servers are charged with their CONFIRMED footprint. It appears only when
  // it differs from the available memory - a row that says the same thing
  // twice is noise.
  if (facts.safeAvailableMB !== null) {
    rows.push(React.createElement('div', { key: 'margin', className: 'iwb-lsp-row' },
      React.createElement('span', { className: 'iwb-lsp-row-label' }, t('lsp.diagnostics.memorySafeAvailable')),
      React.createElement('span', { className: 'iwb-lsp-row-value' }, `${facts.safeAvailableMB} MB`)))
  }
  return React.createElement('div', { className: 'iwb-modal-backdrop' },
    React.createElement('div', { className: 'iwb-modal iwb-lsp-diagnostics' },
      React.createElement('div', { className: 'iwb-modal-title' }, t('lsp.diagnostics.title')),
      React.createElement('div', { className: 'iwb-modal-body' }, rows),
      React.createElement('div', { className: 'iwb-modal-actions' },
        React.createElement('button', {
          type: 'button',
          className: 'iwb-textbtn',
          onClick: () => { onOpenSettings?.() },
        }, t('lsp.diagnostics.settings')),
        React.createElement('button', {
          type: 'button',
          className: 'iwb-textbtn',
          onClick: () => { onClose?.() },
        }, t('lsp.diagnostics.closed')))))
}
