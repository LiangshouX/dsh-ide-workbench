/**
 * The lazy loader of `@codemirror/lsp-client`.
 *
 * The library is the only part of the plugin that really needs the CodeMirror
 * runtime: its module body creates a `ViewPlugin` and a `StateField` out of
 * `@codemirror/view` and `@codemirror/state`, and those two packages are
 * aliased to the Proxy shim of the plugin (PRD-v6 §3.5). Reading a property
 * of the shim before the core bound the runtime throws - so a STATIC import
 * of the library would make the plugin throw while it is being loaded, and a
 * plugin that is installed alone must load without an error (DEG-01,
 * acceptance B1).
 *
 * The dynamic import moves the body of the library into the first call that
 * really needs it: by then the contract arrived, and the contract only
 * exists while the core is there - and the core binds the runtime before it
 * renders anything.
 *
 * The library itself stays REAL: it is not aliased, only its own
 * `@codemirror/*` dependencies are (the alias of the build applies to the
 * whole dependency graph).
 */

/** @type {any} the library, once it was loaded */
let library = null

/** @type {Promise<any> | null} the pending load */
let pending = null

/**
 * Load the library of the language-server client.
 *
 * The load happens once: the second call answers with the same promise (and
 * the same module) as the first one.
 * @returns {Promise<any>} the library
 */
export function loadLspLibrary() {
  if (library !== null) return Promise.resolve(library)
  if (pending === null) {
    pending = import('@codemirror/lsp-client').then(
      (module) => {
        library = module
        return module
      },
      (error) => {
        // A failed load may be retried: the runtime may not have been bound
        // yet.
        pending = null
        throw error
      },
    )
  }
  return pending
}

/**
 * The library, when it was loaded.
 *
 * The functions that cannot wait (the extension provider of the editor) use
 * this one: without the library there are no semantic extensions.
 * @returns {any} the library, or `null`
 */
export function lspLibrary() {
  return library
}

/**
 * Whether the library was loaded.
 * @returns {boolean} true when the library is there
 */
export function isLspLibraryLoaded() {
  return library !== null
}
