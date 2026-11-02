/**
 * The ONE CodeMirror runtime of the process (PRD-v6 §3.5).
 *
 * The extensions of CodeMirror are checked with `instanceof`, and the ids of
 * the state fields come from a module level counter - so two copies of
 * `@codemirror/state` in the page break the editor:
 *
 *   "Unrecognized extension value in extension set (...). This sometimes
 *    happens because multiple instances of @codemirror/state are loaded,
 *    breaking instanceof checks."  (@codemirror/state)
 *
 * The core therefore OWNS the CodeMirror packages, and the codeintel reaches
 * them through a Proxy shim that resolves the properties at the moment of
 * the access. The runtime is published here, at module evaluation time:
 * the codeintel may be materialised before the core is, and it must not throw
 * while it is loaded (DEG-01) - only when it really uses a capability.
 *
 * The key is a `Symbol.for`, so the two copies of the contract package (one
 * per plugin) agree on it without knowing each other.
 */
import * as state from '@codemirror/state'
import * as view from '@codemirror/view'
import * as language from '@codemirror/language'
import * as autocomplete from '@codemirror/autocomplete'
import * as lint from '@codemirror/lint'
import * as commands from '@codemirror/commands'
import * as search from '@codemirror/search'

/** The global key the runtime is published under. */
export const CODEMIRROR_KEY = Symbol.for('dsh.ide-workbench.codemirror')

/**
 * The runtime itself.
 *
 * `lint` is part of it because the language-server client of the codeintel
 * imports `setDiagnostics` from `@codemirror/lint` - and that import is
 * aliased to the shim, so the runtime has to carry the namespace.
 */
export const cmRuntime = Object.freeze({
  state,
  view,
  language,
  autocomplete,
  lint,
  commands,
  search,
})

globalThis[CODEMIRROR_KEY] = cmRuntime

export default cmRuntime
