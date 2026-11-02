/**
 * The client entry of the code intelligence plugin.
 *
 * The plugin is autonomous: it registers its own dictionaries and fills the
 * four slots of the contract (PRD-v6 §3.3):
 *
 *   - `editorBridge`    the component that receives the contract and hands
 *                        its extensions, its key bindings and its commands to
 *                        the editor of the core;
 *   - `statusItem`      the cell of the status bar that shows the state of
 *                        the semantic analysis;
 *   - `settingsSection` the group of the settings page;
 *   - `commandItem`     the entries of the editor menu.
 *
 * The plugin does NOT hard-inject the host service of the core: the core may
 * be absent, and a plugin that never starts cannot show the guidance that
 * says so (PRD-v6 §3.2). The degraded mode (DEG-01 / DEG-02) is therefore
 * the normal path of a plugin that is installed alone: no language server is
 * started, a toast says what is missing, and the settings page explains it.
 */
import React from 'react'
import { SLOT_KEYS } from '../contract/index.js'
import { NS, en, zh } from './i18n.js'
import { CodeIntelBridge } from './bridge.jsx'
import { CodeIntelSettings } from './settings.jsx'
import { IndexDecision, MemoryDecision } from './decision.jsx'
import { LspStatus, Toast } from './status.jsx'
import { codeintelCommands } from './extensions.js'
import { useStoreState } from './hooks.js'
import { storeOf } from './registry.js'
import { CodeIntelStore } from './store.js'

/** The services the plugin needs from the host. */
export const inject = ['slots', 'locale']

/** The id of the plugin as an occupant of the slots of the contract. */
const PLUGIN_ID = 'dsh-ide-codeintel'

/**
 * How long the plugin waits for the contract before it calls the IDE
 * workbench missing.
 *
 * The core declares its slots when it starts, and the plugin is injected
 * into them - the callback runs at that moment, and the contract arrives
 * with the first render of the bridge. The wait is short enough for the
 * guidance to be seen right away and long enough for a slow start of the
 * core not to be taken for a missing plugin.
 */
const DEGRADE_GRACE_MS = 1500

/**
 * The status item of the plugin.
 *
 * @param {{contract: any, t: (key: string) => string}} props the contract
 *   and the translator of the plugin
 * @returns {React.ReactElement} the item
 */
function CodeIntelStatusItem({ contract, t }) {
  const store = storeOf(contract, t)
  const state = useStoreState(store)
  if (store === null || state === null) return null
  return React.createElement(React.Fragment, null,
    React.createElement(LspStatus, { store, state }),
    React.createElement(Toast, { store, state }),
    // The two questions of the plugin (the index decision and the memory
    // warning) are drawn by the plugin's own surfaces.
    React.createElement(IndexDecision, { store, state }),
    React.createElement(MemoryDecision, { store, state }))
}

/**
 * The menu entries of the plugin.
 *
 * The core renders them in the context menu of the editor.
 *
 * @param {{contract: any, t: (key: string) => string}} props the contract
 *   and the translator of the plugin
 * @returns {React.ReactElement} the entries
 */
function CodeIntelCommandItems({ contract, t }) {
  const store = storeOf(contract, t)
  const state = useStoreState(store)
  if (store === null || state === null) return null
  const commands = codeintelCommands(store)
  return React.createElement('div', { className: 'iwb-codeintel-commands' },
    commands.map(command => React.createElement('button', {
      key: command.key,
      type: 'button',
      className: 'iwb-textbtn',
      disabled: command.enabled !== undefined && command.enabled() !== true,
      onClick: () => { command.run() },
    }, command.shortcut === undefined || command.shortcut === ''
      ? command.label
      : `${command.label} (${command.shortcut})`)))
}

/**
 * Install the plugin into the host.
 *
 * @param {any} ctx the client context of the host
 * @returns {void}
 */
export function apply(ctx) {
  const t = ctx.locale.bind(NS)

  // The dictionaries of the plugin: the `lsp.*` / `settings.lsp*` /
  // `index.*` families and the labels of the four semantic shortcuts.
  ctx.effect(() => {
    const offZh = ctx.locale.register(NS, 'zh', zh)
    const offEn = ctx.locale.register(NS, 'en', en)
    return () => { offZh(); offEn() }
  }, 'dsh-ide-codeintel: dictionaries')

  /**
   * Whether the core has been seen.
   *
   * The plugin is installed alone as often as it is installed next to the
   * core, and the difference decides what the user sees.
   */
  let contractSeen = false
  /** @type {CodeIntelStore | null} the store of the degraded mode */
  let degradedStore = null
  /** @type {any} the timer that calls the missing core */
  let degradeTimer = null

  /**
   * The store of the degraded mode.
   *
   * The plugin has no contract, so it has no project and no editor - but it
   * still has its own settings, and it still has to say what is missing.
   * @returns {CodeIntelStore} the store
   */
  const degradedMode = () => {
    if (degradedStore === null) {
      degradedStore = new CodeIntelStore({ t })
      degradedStore.set({ degraded: true, degradedReason: 'workbench-missing' })
    }
    return degradedStore
  }

  /**
   * Say that the IDE workbench plugin is missing.
   *
   * Two things happen: a toast (once) and a note in the settings of the
   * plugin. No language server is started - there is no project to start one
   * for, and a server without an editor would cost memory for nothing.
   */
  const enterDegradedMode = () => {
    if (contractSeen) return
    const store = degradedMode()
    store.toast('error', t('codeintel.workbenchMissing'), t('codeintel.workbenchMissingHint'))
    // The settings page of the plugin is registered HERE, in the degraded
    // mode only: with the core installed, the group belongs to the settings
    // page of the core, and a second copy of it would confuse the user.
    ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section', id: PLUGIN_ID, order: 61, label: () => t('codeintel.settingsTitle'),
    }, () => React.createElement(CodeIntelSettings, { contract: null, t, store: degradedStore }))), 'dsh-ide-codeintel: settings section')
  }

  degradeTimer = setTimeout(() => { enterDegradedMode() }, DEGRADE_GRACE_MS)

  /**
   * The contract arrived: the plugin is not degraded any more.
   * @param {any} contract the contract of the core
   */
  const onContract = (contract) => {
    if (contract === null || contract === undefined) return
    contractSeen = true
    if (degradeTimer !== null) {
      clearTimeout(degradeTimer)
      degradeTimer = null
    }
    if (degradedStore !== null) {
      degradedStore.dispose()
      degradedStore = null
    }
  }

  // ── the four slots of the contract ───────────────────────────────────────

  ctx.effect(() => ctx.slots.inject(SLOT_KEYS.editorBridge, () => ctx.slots.register({
    name: SLOT_KEYS.editorBridge, id: PLUGIN_ID,
  }, props => React.createElement(CodeIntelBridge, { ...props, t, onContract }))), 'dsh-ide-codeintel: editor bridge')

  ctx.effect(() => ctx.slots.inject(SLOT_KEYS.statusItem, () => ctx.slots.register({
    name: SLOT_KEYS.statusItem, id: PLUGIN_ID,
  }, props => React.createElement(CodeIntelStatusItem, { ...props, t }))), 'dsh-ide-codeintel: status item')

  ctx.effect(() => ctx.slots.inject(SLOT_KEYS.settingsSection, () => ctx.slots.register({
    name: SLOT_KEYS.settingsSection, id: PLUGIN_ID,
  }, props => React.createElement(CodeIntelSettings, { ...props, t }))), 'dsh-ide-codeintel: settings section')

  ctx.effect(() => ctx.slots.inject(SLOT_KEYS.commandItem, () => ctx.slots.register({
    name: SLOT_KEYS.commandItem, id: PLUGIN_ID,
  }, props => React.createElement(CodeIntelCommandItems, { ...props, t }))), 'dsh-ide-codeintel: commands')

  ctx.effect(() => () => {
    if (degradeTimer !== null) {
      clearTimeout(degradeTimer)
      degradeTimer = null
    }
    if (degradedStore !== null) {
      degradedStore.dispose()
      degradedStore = null
    }
  }, 'dsh-ide-codeintel: teardown')
}
