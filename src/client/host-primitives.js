/**
 * Access to the harness's own client UI primitives.
 *
 * `@deepseek-ai/dsh-client-ui-primitives` is seeded into the DSH browser
 * module table by the web shell, so a plugin bundle can `require` it the same
 * way the shell's own plugins do — `dsh-better-sidebar` uses this exact
 * specifier for its file-tree artwork, and so does this plugin's Markdown
 * preview for `MarkdownText`.
 *
 * The shell seeds the module eagerly, so the synchronous `require` normally
 * answers right away. A stripped deployment may not expose it at all; then the
 * async `modules.import` loader wired in `index.jsx` is the second chance.
 * `null` is the honest answer when neither path yields the module, and every
 * consumer degrades instead of throwing.
 */
import { useEffect, useState } from 'react'

/** The primitives module once it is known (`null` while unavailable). */
let primitives = null
/** The in-flight async resolution, shared by every caller. */
let loading = null
/** The async resolver installed by `setPrimitivesLoader`. */
let loader = null
/** Callbacks waiting for the module to arrive. */
const listeners = new Set()

try {
  // The factory `require` resolves the shell's module table synchronously for
  // baseline modules; a stripped host throws and the async loader below (or a
  // caller's own fallback) takes over.
  // eslint-disable-next-line no-undef
  primitives = require('@deepseek-ai/dsh-client-ui-primitives') ?? null
} catch {
  primitives = null
}

/**
 * Give the async path a resolver (the client `modules` service).
 * @param {unknown} next a function returning a promise of the module
 */
export function setPrimitivesLoader(next) {
  loader = typeof next === 'function' ? next : null
}

/**
 * The primitives module right now, without waiting.
 * @returns {object|null} the module, or `null` while it is unavailable
 */
export function getPrimitives() {
  return primitives
}

/**
 * Resolve the primitives module, awaiting the async loader when the
 * synchronous lookup did not find it.
 * @returns {Promise<object|null>} the module, or `null` when it stays missing
 */
export function ensurePrimitives() {
  if (primitives !== null) return Promise.resolve(primitives)
  if (loading !== null) return loading
  if (loader === null) return Promise.resolve(null)
  loading = loader()
    .then((module) => {
      primitives = module ?? null
      for (const listener of listeners) listener()
      return primitives
    })
    .catch(() => null)
  return loading
}

/**
 * The primitives module as a React value.
 *
 * The first render uses whatever the synchronous `require` found. When the
 * module only arrives through the async loader, the hook re-renders with it so
 * the host artwork replaces the local fallback without a remount.
 * @returns {object|null} the module, or `null` while it is unavailable
 */
export function useHostPrimitives() {
  const [module, setModule] = useState(primitives)
  useEffect(() => {
    if (module !== null) return undefined
    let alive = true
    void ensurePrimitives().then((loaded) => {
      if (alive && loaded !== null) setModule(loaded)
    })
    const listener = () => {
      if (alive && primitives !== null) setModule(primitives)
    }
    listeners.add(listener)
    return () => {
      alive = false
      listeners.delete(listener)
    }
  }, [module])
  return module
}
