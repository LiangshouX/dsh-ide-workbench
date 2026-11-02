/**
 * The registry of the stores of the plugin.
 *
 * One contract belongs to one session of the IDE workbench, and one session
 * has one store: the four slots of the plugin (the editor bridge, the status
 * item, the settings group and the commands) all receive the SAME contract,
 * and they all have to see the same state.
 *
 * The registry is keyed by the contract itself, so a store is dropped as soon
 * as the core lets the contract go - and two sessions never share a store.
 */
import { CodeIntelStore } from './store.js'

/** @type {WeakMap<object, CodeIntelStore>} the store of every contract */
const stores = new WeakMap()

/**
 * The store of one contract.
 *
 * The store is created on the first use and kept for the lifetime of the
 * contract.
 * @param {any} contract the contract of the session
 * @param {(key: string) => string} t the translator of the plugin
 * @returns {CodeIntelStore | null} the store, or `null` without a contract
 */
export function storeOf(contract, t) {
  if (contract === null || contract === undefined) return null
  let store = stores.get(contract)
  if (store === undefined) {
    store = new CodeIntelStore({ t })
    stores.set(contract, store)
  }
  return store
}

/**
 * Drop the store of one contract.
 *
 * The core unloaded (or switched the session): the store releases its
 * session and its subscriptions.
 * @param {any} contract the contract of the session
 * @returns {void}
 */
export function releaseStore(contract) {
  if (contract === null || contract === undefined) return
  const store = stores.get(contract)
  if (store === undefined) return
  stores.delete(contract)
  store.dispose()
}
