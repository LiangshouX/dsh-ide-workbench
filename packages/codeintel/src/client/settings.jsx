/**
 * The settings of the code intelligence plugin.
 *
 * The plugin owns the `lsp` section and the four semantic shortcuts; the core
 * of the workbench keeps the rest (CUT-10 / CUT-11 of PRD-v6 鎼?.3). The
 * group is rendered in the settings page of the core (through the
 * `settingsSection` slot of the contract) and - when the core is missing - in
 * the settings page of the plugin itself, where it also carries the guidance
 * of the degraded mode (DEG-01).
 *
 * The settings live in the document of the plugin
 * (`<profile>/dsh-codeintel/settings.json`); the store writes them.
 */
import React, { useMemo, useState } from 'react'
import { IDLE_POLICIES } from '../host/settings-defaults.js'
import { memoryDecisionOf } from './store.js'
import { useStoreState } from './hooks.js'
import { storeOf } from './registry.js'
import { interpolate, Toast } from './status.jsx'

/**
 * One row of the settings: a label, a hint and the control.
 *
 * @param {{label: string, hint?: string, children: any}} props the row
 * @returns {React.ReactElement} the row
 */
function Row({ label, hint, children }) {
  return React.createElement('div', { className: 'iwb-settings-row' },
    React.createElement('div', { className: 'iwb-settings-label' }, label),
    hint === undefined || hint === ''
      ? null
      : React.createElement('div', { className: 'iwb-settings-hint' }, hint),
    React.createElement('div', { className: 'iwb-settings-control' }, children))
}

/**
 * The note of the degraded mode.
 *
 * The plugin needs the IDE workbench: without it there is no editor, no
 * project and no file - and the user has to know that, instead of wondering
 * why the features are missing.
 *
 * @param {{store: object, state: object}} props the store and its snapshot
 * @returns {React.ReactElement} the note
 */
export function DegradedNote({ store, state }) {
  const t = store.t
  if (state?.degraded !== true) return null
  return React.createElement('div', { className: 'iwb-settings-note iwb-settings-note-warn' },
    React.createElement('div', { className: 'iwb-settings-note-title' }, t('codeintel.degradedTitle')),
    React.createElement('div', { className: 'iwb-settings-note-body' }, t('codeintel.degradedBody')))
}

/**
 * The budget share of the machine, as the host accepts it.
 *
 * The host only takes a ratio greater than zero and falls back to 0.25 for
 * anything else: a 0 in the field would be a lie (review A5).
 * @param {unknown} value the value of the field
 * @returns {number} the share
 */
export function clampBudgetRatio(value) {
  const number = Number(value)
  if (value === '' || value === null || value === undefined || !Number.isFinite(number)) return 0.25
  if (number <= 0) return 0.05
  if (number > 1) return 1
  return number
}

/**
 * The worst case of the memory snapshot.
 *
 * What the machine would be left with if the next server grew into its own
 * ceiling. The number may be negative - that is the point of the band.
 * @param {{t: (key: string) => string}} store the store of the plugin
 * @param {any} resources the memory snapshot of the host
 * @returns {string} the text, `''` when the host does not know the numbers
 */
function worstCaseText(store, resources) {
  const worstBytes = Number.isFinite(resources?.worstCaseBytes) ? resources.worstCaseBytes : null
  const ceilingMB = Number.isFinite(resources?.ceilingMB) ? resources.ceilingMB : null
  if (worstBytes === null || ceilingMB === null) return ''
  return interpolate(store.t('lsp.diagnostics.memoryWorstText'), {
    ceiling: ceilingMB,
    left: Math.round(worstBytes / (1024 * 1024)),
  })
}

/**
 * The memory the running language servers have reserved, in megabytes.
 *
 * The reservation is what the servers may STILL grow into - their ceiling
 * minus what they have taken already - and not what they use right now
 * (PRD-v5.1 MEM-05).
 * @param {any} resources the memory snapshot of the host
 * @returns {number} the reserved megabytes
 */
function reservedMB(resources) {
  const bytes = Number.isFinite(resources?.reservedBytes) ? resources.reservedBytes : 0
  return Math.round(bytes / (1024 * 1024))
}

/**
 * The sentence of the memory row of the settings page.
 *
 * The number is the AVAILABLE one - the number the gate of the host judges
 * the start by - and not the free memory of the machine: the free memory
 * alone would say "plenty of memory" while the gate says "not enough"
 * (PRD-v5.1 MEM-09).
 * @param {{t: (key: string) => string}} store the store of the plugin
 * @param {any} resources the memory snapshot of the host
 * @returns {string} the sentence
 */
function memoryNowText(store, resources) {
  const t = store.t
  const mib = 1024 * 1024
  const availableBytes = Number.isFinite(resources?.availableBytes)
    ? resources.availableBytes
    : (Number.isFinite(resources?.freeBytes) ? resources.freeBytes : 0)
  const available = Math.round(availableBytes / mib)
  const need = Math.round(Number.isFinite(resources?.needMB) ? resources.needMB : 0)
  const threshold = Math.round((Number.isFinite(resources?.thresholdBytes) ? resources.thresholdBytes : 0) / mib)
  const floor = Number.isFinite(resources?.hardFloorMB) ? resources.hardFloorMB : 0
  const language = typeof resources?.languageId === 'string' && resources.languageId !== ''
    ? resources.languageId
    : t('settings.lspServersGroup')
  const state = memoryDecisionOf(resources) === 'tight'
    ? t('settings.lspMemoryState.tight')
    : (memoryDecisionOf(resources) === 'low'
      ? t('settings.lspMemoryState.low')
      : t('settings.lspMemoryState.ok'))
  return interpolate(t('settings.lspMemoryNow'), {
    available,
    language,
    need,
    state,
    threshold,
    floor,
  })
}
/**
 * The form of the settings of the plugin.
 *
 * The form reads the state of the store and writes through the store; it
 * never talks to the host itself.
 *
 * @param {{store: object, state: object}} props the store and its snapshot
 * @returns {React.ReactElement} the form
 */
export function SettingsForm({ store, state }) {
  const t = store.t
  const settings = state.settings ?? {}
  const lsp = settings.lsp ?? {}
  const shortcuts = settings.shortcuts ?? {}
  /**
   * The ceilings the user typed.
   *
   * The field shows the number the user typed right away: the document of
   * the host is written afterwards, and a field that waits for the answer
   * would look like it swallowed the number.
   */
  const [ceilings, setCeilings] = useState({})
  /**
   * The switches the user clicked.
   *
   * The page shows what it wrote, not what the document said a moment ago:
   * a switch that only turns on after the round trip looks broken.
   */
  const [switches, setSwitches] = useState({})
  const resources = state.lsp?.resources ?? null
  const servers = state.lsp?.servers ?? { available: [], missing: [] }
  // One row per language: a language that is switched off used to leave the
  // list and to show up in a second group ("the language servers that are
  // turned off") - and from there it could never be switched on again.
  // The bucket of an older host is merged into the list.
  const languages = [
    ...(servers.available ?? []),
    ...(servers.missing ?? []),
    ...(servers.disabled ?? []),
  ]
  // The languages that are wanted but not installed: they keep their own
  // rows, and they are announced apart.
  const missingLanguages = (servers.missing ?? []).filter(language => language?.enabled !== false)
  const writeLsp = (patch) => { void store.updateSettings({ lsp: { ...lsp, ...patch } }) }
  const writeShortcut = (name, value) => {
    void store.updateSettings({ shortcuts: { ...shortcuts, [name]: value } })
  }
  // The switch of the document wins over the policy: a profile written
  // before the policy existed says `autoExit: false`, and the host honours
  // the older switch - so the page has to show "never" (PRD-v5 鎼?.2).
  const idlePolicy = lsp.autoExit === false ? 'never' : (lsp.idlePolicy ?? 'after')
  return React.createElement('div', { className: 'iwb-settings-group' },
    React.createElement(DegradedNote, { store, state }),
    React.createElement('div', { className: 'iwb-settings-group-title' }, t('settings.lspGroup')),
    React.createElement('div', { className: 'iwb-settings-group-hint' }, t('settings.lspGroupHint')),
    React.createElement(Row, { label: t('settings.lspEnabled'), hint: t('settings.lspEnabledHint') },
      React.createElement('input', {
        type: 'checkbox',
        checked: lsp.enabled !== false,
        onChange: event => { writeLsp({ enabled: event.target.checked }) },
      })),
    React.createElement(Row, { label: t('settings.lspIndexOnOpen'), hint: t('settings.lspIndexOnOpenHint') },
      React.createElement('select', {
        value: lsp.indexOnOpen ?? 'ask',
        onChange: event => { writeLsp({ indexOnOpen: event.target.value }) },
      },
        React.createElement('option', { value: 'ask' }, t('settings.lspIndexAsk')),
        React.createElement('option', { value: 'always' }, t('settings.lspIndexAlways')),
        React.createElement('option', { value: 'never' }, t('settings.lspIndexNever')))),
    React.createElement(Row, { label: t('settings.lspIdlePolicy'), hint: t('settings.lspIdlePolicyHint') },
      React.createElement('select', {
        value: idlePolicy,
        onChange: event => {
          // The switch travels with the policy: the host reads the switch, so
          // a document that keeps `autoExit: false` while the policy says
          // "after" would contradict itself.
          writeLsp({ idlePolicy: event.target.value, autoExit: event.target.value !== 'never' })
        },
      }, IDLE_POLICIES.map(policy => React.createElement('option', { key: policy, value: policy },
        t(`settings.lspIdlePolicy${policy.charAt(0).toUpperCase()}${policy.slice(1)}`))))),
    idlePolicy === 'never'
      ? React.createElement('div', { className: 'iwb-settings-warning' }, t('settings.lspIdlePolicyNeverWarning'))
      : null,
    React.createElement(Row, { label: t('settings.lspCancelAfter'), hint: t('settings.lspCancelAfterHint') },
      React.createElement('input', {
        type: 'number',
        min: 1,
        value: Math.round((lsp.cancelAfterMs ?? 60000) / 1000),
        onChange: event => { writeLsp({ cancelAfterMs: Number(event.target.value) * 1000 }) },
      })),
    React.createElement(Row, { label: t('settings.lspRequestTimeout'), hint: t('settings.lspRequestTimeoutHint') },
      React.createElement('input', {
        type: 'number',
        min: 30,
        value: Math.round((lsp.requestTimeoutMs ?? 30000) / 1000),
        onChange: event => { writeLsp({ requestTimeoutMs: Number(event.target.value) * 1000 }) },
      })),
    React.createElement(Row, { label: t('settings.lspMemoryLimit'), hint: t('settings.lspMemoryLimitHint') },
      React.createElement('input', {
        type: 'number',
        min: 128,
        value: lsp.memoryLimitMB ?? 2048,
        onChange: event => { writeLsp({ memoryLimitMB: Number(event.target.value) }) },
      })),
    React.createElement(Row, { label: t('settings.lspFreeMemory'), hint: t('settings.lspFreeMemoryHint') },
      React.createElement('input', {
        type: 'number',
        min: 0,
        value: lsp.freeMemoryThresholdMB ?? 512,
        onChange: event => { writeLsp({ freeMemoryThresholdMB: Number(event.target.value) }) },
      })),
    React.createElement(Row, { label: t('settings.lspHeadroom'), hint: t('settings.lspHeadroomHint') },
      React.createElement('input', {
        type: 'number',
        step: '0.1',
        min: '1',
        value: lsp.memoryHeadroom ?? 1.5,
        onChange: event => { writeLsp({ memoryHeadroom: Number(event.target.value) }) },
      })),
    React.createElement(Row, { label: t('settings.lspHardFloor'), hint: t('settings.lspHardFloorHint') },
      React.createElement('input', {
        type: 'number',
        min: 0,
        value: lsp.memoryHardFloorMB ?? 256,
        onChange: event => { writeLsp({ memoryHardFloorMB: Number(event.target.value) }) },
      })),
    resources === null
      ? null
      : React.createElement('div', { className: 'iwb-settings-note' },
        React.createElement('div', { className: 'iwb-settings-note-body' }, memoryNowText(store, resources)),
        reservedMB(resources) > 0
          ? React.createElement('div', { className: 'iwb-settings-note-body' },
            interpolate(t('settings.lspMemoryReserved'), { reserved: reservedMB(resources) }))
          : null,
        // The worst case is information, not a verdict: the host reports it
        // and never blocks on it. It belongs where the user looks at the
        // live numbers.
        worstCaseText(store, resources) === ''
          ? null
          : React.createElement('div', { className: 'iwb-settings-note-body' }, worstCaseText(store, resources))),
    React.createElement(Row, { label: t('settings.lspBudgetRatio'), hint: t('settings.lspBudgetRatioHint') },
      React.createElement('input', {
        type: 'number',
        min: '0.05',
        max: '1',
        step: '0.05',
        value: lsp.budgetRatio ?? 0.25,
        onChange: event => { writeLsp({ budgetRatio: clampBudgetRatio(event.target.value) }) },
      })),
    React.createElement('div', { className: 'iwb-settings-group-title' }, t('settings.lspServersGroup')),
    React.createElement('div', { className: 'iwb-settings-group-hint' }, t('settings.lspServersGroupHint')),
    ...languages.map(language => {
      const languageId = typeof language?.languageId === 'string' ? language.languageId : ''
      if (languageId === '') return null
      // The settings of the language: the switch and its own ceiling.
      const entry = (lsp.servers ?? {})[languageId] ?? {}
      const ceiling = Number.isFinite(entry.memoryLimitMB) ? entry.memoryLimitMB : null
      const written = ceilings[languageId]
      const shown = written !== undefined
        ? written
        : (ceiling === null ? '' : String(ceiling))
      const writeLanguage = (patch) => {
        const servers = { ...(lsp.servers ?? {}) }
        servers[languageId] = { ...entry, ...patch }
        writeLsp({ servers })
      }
      return React.createElement('div', {
        key: languageId,
        className: 'iwb-settings-language',
      },
        React.createElement('div', {
          className: 'iwb-settings-language-toggle',
          // The title of the row is the install advice of the host: the
          // language shows up nowhere else, so this is the last place that
          // can say how to install it.
          title: typeof language.hint === 'string' ? language.hint : '',
        },
          React.createElement('input', {
            type: 'checkbox',
            checked: switches[languageId] !== undefined
              ? switches[languageId]
              : (entry.enabled !== false && language.enabled !== false),
            onChange: event => {
              setSwitches(current => ({ ...current, [languageId]: event.target.checked }))
              writeLanguage({ enabled: event.target.checked })
            },
          }),
          React.createElement('span', { className: 'iwb-settings-language-name' }, languageId)),
        // The ceiling of THIS language: an empty field means that the global
        // ceiling applies (the user could otherwise only lower a language,
        // never raise it).
        React.createElement('input', {
          type: 'number',
          min: 0,
          'aria-label': `${languageId} ${t('settings.lspServerMemoryLimit')}`,
          title: t('settings.lspServerMemoryLimitHint'),
          value: shown,
          onChange: event => {
            const raw = event.target.value
            const value = Number(raw)
            // An empty field means "no ceiling of its own": a number the
            // user did not type - and no zero - may not be written.
            if (raw !== '' && !Number.isFinite(value)) return
            setCeilings(current => ({ ...current, [languageId]: raw }))
            // An empty field means "no ceiling of its own": the number goes
            // away, so the global ceiling applies again.
            writeLanguage(raw === '' ? { memoryLimitMB: undefined } : { memoryLimitMB: value })
          },
        }))
    }),
    // The languages that are wanted but not installed: they are announced
    // here, because the status bar of the plugin filters the languages the
    // user switched off - and the two interfaces must not use the same word
    // for two different things (review R6-3).
    missingLanguages.length === 0
      ? null
      : React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'iwb-settings-group-title' }, t('settings.lspServersMissing')),
          React.createElement('div', { className: 'iwb-settings-group-hint' }, t('settings.lspServersMissingHint')),
          ...missingLanguages.map(language => React.createElement('div', {
            key: language.languageId,
            className: 'iwb-settings-value',
          }, `${language.languageId} 閳?${typeof language.hint === 'string' ? language.hint : ''}`))),
    React.createElement('div', { className: 'iwb-settings-group-title' }, t('settings.shortcuts')),
    ...[
      ['goToDefinition', t('settings.goToDefinitionShortcut'), t('settings.goToDefinitionShortcutHint')],
      ['findUsages', t('settings.findUsagesShortcut'), t('settings.findUsagesShortcutHint')],
      ['findUsagesText', t('settings.findUsagesTextShortcut'), t('settings.findUsagesTextShortcutHint')],
      ['complete', t('settings.completeShortcut'), t('settings.completeShortcutHint')],
    ].map(([name, label, hint]) => React.createElement(Row, { key: name, label, hint },
      React.createElement('input', {
        type: 'text',
        value: shortcuts[name] ?? '',
        onChange: event => { writeShortcut(name, event.target.value) },
      }))))
}

/**
 * The settings group of the plugin, as the core renders it.
 *
 * The core hands the contract as a prop; the group reads the store of the
 * contract and writes through it. Without a contract the plugin shows its
 * own page: the guidance of the degraded mode and the settings of the
 * plugin.
 *
 * @param {{contract: any, t: (key: string) => string, store?: any}} props the
 *   contract, the translator of the plugin and (in the degraded mode) the
 *   store of the plugin
 * @returns {React.ReactElement} the group
 */
export function CodeIntelSettings({ contract, t, store: provided }) {
  const fromRegistry = useMemo(() => storeOf(contract, t), [contract, t])
  const store = provided ?? fromRegistry
  const state = useStoreState(store)
  if (store === null || state === null) {
    return React.createElement('div', { className: 'iwb-settings-group' },
      React.createElement('div', { className: 'iwb-settings-note iwb-settings-note-warn' },
        React.createElement('div', { className: 'iwb-settings-note-title' }, t('codeintel.degradedTitle')),
        React.createElement('div', { className: 'iwb-settings-note-body' }, t('codeintel.degradedBody'))))
  }
  return React.createElement(React.Fragment, null,
    React.createElement(Toast, { store, state }),
    React.createElement(SettingsForm, { store, state }))
}


