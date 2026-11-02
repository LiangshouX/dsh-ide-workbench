/**
 * The contract between the IDE workbench (core) and the code intelligence
 * plugin (codeintel).
 *
 * This module is the SINGLE SOURCE OF TRUTH of the contract. It is not a
 * runtime dependency of either plugin: both plugins INLINE a copy of it (see
 * `scripts/sync-contract.mjs`), because the DSH plugin format publishes the
 * host half as plain source files and a package outside the plugin's own
 * directory would not be there at runtime.
 *
 * The two copies are kept honest by two mechanisms:
 *
 *   - the copies share their state through `Symbol.for` + `globalThis`, so a
 *     registry or a runtime that both plugins touch is really ONE object
 *     (see `fault-registry.js` and the CodeMirror runtime of the editor);
 *   - the constants below are frozen and are compared by value, never by
 *     identity.
 *
 * The rule of this file: **what is written here, nobody may rename or
 * re-interpret**. What is NOT written here is decided by each module on its
 * own.
 */

/** The major version of the contract. A breaking change increments it. */
export const CONTRACT_VERSION = 1

/**
 * The Cordis service the core provides and the codeintel consumes.
 *
 * The name is deliberately long: the DSH host has no namespace for plugin
 * services (N2 of PRD-v6 §1.5), so the name has to be unique on its own.
 */
export const HOST_SERVICE = 'dsh-ide-workbench.contract'

/**
 * The client-side slots the core declares and the codeintel fills.
 *
 * A slot is the delivery mechanism of the contract on the client side: the
 * core declares the slot together with the sidebar tab it owns, the codeintel
 * registers an occupant, and the two meet whatever order the plugins are
 * loaded in.
 */
export const SLOT_KEYS = Object.freeze({
  /** The contract bridge: the codeintel puts a component here, the core hands it the contract as a prop. */
  editorBridge: 'ide-workbench.editor.bridge',
  /** The entries of the status bar. */
  statusItem: 'ide-workbench.status.item',
  /** The groups of the settings page. */
  settingsSection: 'ide-workbench.settings.section',
  /** The editor commands (context menu / command palette). */
  commandItem: 'ide-workbench.command.item',
})

/**
 * Merge the extension slots of every contributor.
 *
 * The rules are fixed (PRD-v6 §3.4.1) and must not be re-interpreted by
 * either side:
 *
 *   1. the contributors hand in their slots, each with a `key`, a `priority`
 *      and a list of CodeMirror extensions;
 *   2. the slots are grouped by `key`;
 *   3. of one group only the slot with the highest `priority` survives; on a
 *      tie the slot that was registered LAST wins (the codeintel registers
 *      after the core);
 *   4. the slots that lost are NOT installed at all - they are not installed
 *      and then disabled, they are never installed, so there is no second
 *      `StateField` and no second input handler in the editor;
 *   5. the merge is recomputed on every refresh.
 *
 * The result is a flat list of extensions, in the order of the contributors.
 *
 * @param {Array<Array<{key: string, priority: number, extensions: unknown[]}>>} contributions
 * @returns {unknown[]} the extensions of the winning slots
 */
export function mergeExtensionSlots(contributions) {
  const winners = new Map()
  const order = []
  for (const slots of contributions) {
    if (!Array.isArray(slots)) continue
    for (const slot of slots) {
      if (slot === null || typeof slot !== 'object') continue
      const key = typeof slot.key === 'string' ? slot.key : ''
      if (key === '') continue
      const priority = Number.isFinite(slot.priority) ? slot.priority : 0
      const extensions = Array.isArray(slot.extensions) ? slot.extensions : []
      const previous = winners.get(key)
      if (previous === undefined) {
        winners.set(key, { key, priority, extensions })
        order.push(key)
        continue
      }
      // A tie goes to the later registration (>= compares equal priorities
      // in favour of the newcomer).
      if (priority >= previous.priority) {
        winners.set(key, { key, priority, extensions })
      }
    }
  }
  const extensions = []
  for (const key of order) {
    const winner = winners.get(key)
    if (winner === undefined) continue
    for (const extension of winner.extensions) extensions.push(extension)
  }
  return extensions
}

/**
 * The priority the core claims for an extension slot.
 *
 * The codeintel uses `CODEINTEL_PRIORITY`; the core uses this one. The core
 * keeps a lower priority on purpose: the automatic closing of the brackets is
 * a general editing ability that BOTH sides can offer, and the codeintel's
 * copy wins when both are installed - deterministically, whatever order the
 * plugins were loaded in.
 */
export const CORE_PRIORITY = 0

/** The priority the codeintel claims for an extension slot. */
export const CODEINTEL_PRIORITY = 100
