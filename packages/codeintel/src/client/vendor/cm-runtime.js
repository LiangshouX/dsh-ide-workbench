/**
 * The bridge to the one CodeMirror runtime of the process.
 *
 * The core owns the CodeMirror runtime (PRD-v6 §3.5): it is the only plugin
 * that bundles `@codemirror/state` and its friends. The codeintel reaches it
 * through this module.
 *
 * The runtime is published on `globalThis` under a `Symbol.for` key, so the
 * two plugins find the SAME object even though each of them carries its own
 * copy of the contract.
 */

/** The key of the one CodeMirror runtime of the process. */
export const CM_RUNTIME_KEY = Symbol.for('dsh.ide-workbench.codemirror')

/**
 * The runtime of the core.
 *
 * @returns {{state: object, view: object, language: object, autocomplete: object, lint: object, commands: object, search: object}}
 * @throws when the IDE workbench plugin is not installed
 */
export function cmRuntime() {
  const runtime = globalThis[CM_RUNTIME_KEY]
  if (runtime === undefined || runtime === null) {
    throw new Error('The CodeMirror runtime is not bound - the IDE workbench plugin (dsh-ide-workbench) is not installed.')
  }
  return runtime
}

/**
 * A lazy proxy for one export of one namespace of the runtime.
 *
 * The proxy resolves the property when it is read, so a plugin that is
 * installed alone does not fail while it is being loaded. `instanceof` keeps
 * working: the `prototype` of the proxy is the prototype of the real class,
 * so an extension that the core created is recognised by the codeintel.
 *
 * @param {string} namespace the namespace of the runtime ('state', 'view', ...)
 * @param {string} name the name of the export inside the namespace
 * @returns {any} the proxy
 */
export function lazyProxy(namespace, name) {
  const target = function () {}
  const resolve = () => cmRuntime()[namespace][name]
  return new Proxy(target, {
    get(_target, key) {
      return resolve()[key]
    },
    apply(_target, _thisArg, args) {
      return Reflect.apply(resolve(), undefined, args)
    },
    construct(_target, args) {
      return Reflect.construct(resolve(), args)
    },
  })
}
