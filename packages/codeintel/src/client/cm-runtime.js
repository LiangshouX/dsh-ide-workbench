/**
 * The binding of the one CodeMirror runtime of the process.
 *
 * The core owns the runtime and publishes it on `globalThis` under a
 * `Symbol.for` key (PRD-v6 §3.5); the shim of `vendor/` reads it from there.
 * The contract delivers the same object as `contract.editor.codemirror`, so
 * the plugin can publish it itself when the core has not done it yet - the
 * shim then finds the runtime, whatever the order of the two plugins is.
 */
import { CM_RUNTIME_KEY } from './vendor/cm-runtime.js'

/**
 * Publish the CodeMirror runtime of the core.
 *
 * The runtime is published only when there is none: the core owns it, and a
 * second publication would hide a newer runtime behind an older one.
 * @param {any} runtime the runtime of the core
 * @returns {boolean} true when the runtime was published by this call
 */
export function bindCodemirror(runtime) {
  if (runtime === null || runtime === undefined) return false
  if (typeof runtime !== 'object') return false
  if (globalThis[CM_RUNTIME_KEY] !== undefined) return false
  globalThis[CM_RUNTIME_KEY] = runtime
  return true
}

/**
 * Whether the CodeMirror runtime is bound.
 * @returns {boolean} true when the core published its runtime
 */
export function isCodemirrorBound() {
  return globalThis[CM_RUNTIME_KEY] !== undefined && globalThis[CM_RUNTIME_KEY] !== null
}
