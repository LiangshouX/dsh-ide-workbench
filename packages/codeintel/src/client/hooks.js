/**
 * The React hooks of the code intelligence plugin.
 */
import { useSyncExternalStore } from 'react'

/**
 * The current state of one store.
 *
 * The store of the plugin is an external store: the components subscribe to
 * it and re-render when it changes. A store that is not there yet (the
 * degraded mode) simply has no state.
 *
 * @param {any} store the store of the plugin
 * @returns {any} the state
 */
export function useStoreState(store) {
  return useSyncExternalStore(
    (callback) => (typeof store?.subscribe === 'function' ? store.subscribe(callback) : () => {}),
    () => store?.getSnapshot?.() ?? null,
    () => null,
  )
}
