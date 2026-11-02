import { useCallback, useRef, useSyncExternalStore } from 'react'

/** Subscribe one component to the whole workbench snapshot. */
export function useWorkbench(store) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

/**
 * Compare two objects one field at a time.
 *
 * The slice selectors below build a fresh object on every read, so a plain
 * `Object.is` would report a change on every notification. With this
 * comparator the cached object is kept while its fields are unchanged.
 * @param {any} left
 * @param {any} right
 * @returns {boolean}
 */
export function shallowEqual(left, right) {
  if (Object.is(left, right)) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  for (const key of leftKeys) {
    if (!Object.is(left[key], right[key])) return false
  }
  return true
}

/**
 * Subscribe one component to one slice of the workbench snapshot.
 *
 * The whole store notifies every subscriber on every change, so a panel that
 * only reads a few fields still re-rendered for every unrelated write (a
 * toast, a terminal chunk). This hook keeps the last slice and returns the
 * **cached** value while the comparator says the slice is unchanged, so
 * React only re-renders when the selected data really moved.
 *
 * The selector may be an inline arrow: the cached value is kept as long as
 * the comparator agrees, so the snapshot identity stays stable even when the
 * selector itself is a new function on every render.
 *
 * A language switch changes the labels without touching the selected data,
 * so the store's locale tick is part of the slice identity — otherwise a
 * panel that only subscribes to a slice would keep the old wording.
 *
 * @param {{ subscribe: Function, getSnapshot: Function }} store
 * @param {(state: any) => any} selector picks the slice out of the state
 * @param {(left: any, right: any) => boolean} [isEqual] slice comparator
 * @returns {any} the selected slice
 */
export function useStoreSlice(store, selector, isEqual = Object.is) {
  const selectorRef = useRef(selector)
  const isEqualRef = useRef(isEqual)
  selectorRef.current = selector
  isEqualRef.current = isEqual
  const cacheRef = useRef({ value: undefined, ready: false, localeTick: undefined })

  const getSnapshot = useCallback(() => {
    const cache = cacheRef.current
    const state = store.getSnapshot()
    const next = selector(state)
    const localeTick = state?.localeTick
    if (cache.ready && cache.localeTick === localeTick && isEqualRef.current(cache.value, next)) return cache.value
    cache.value = next
    cache.localeTick = localeTick
    cache.ready = true
    return next
  }, [store])

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}
