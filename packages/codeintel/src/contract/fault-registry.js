/**
 * The fault ownership registry (PRD-v6 §3.7).
 *
 * Two plugins, one process. The DSH host installs a fail-loud handler: an
 * uncaught exception ends the host process. A plugin must not be able to do
 * that - one broken language server may cost the user the semantic features,
 * not the IDE.
 *
 * The hard part is that the contract is inlined into both plugins, so each of
 * them carries its OWN COPY of this module. Two copies of a module variable
 * are two variables, and two plugins would install two `uncaughtException`
 * handlers: the same error would be handed on twice (core → codeintel →
 * host). `Symbol.for` is unique per process across every copy of the module,
 * so the registry - and with it the single handler - really is one object.
 */

/** The key of the one registry of the process. */
const REGISTRY_KEY = Symbol.for('dsh.ide-workbench.fault-registry')

/**
 * The registry of the process.
 * @returns {{owners: Map<string, (error: unknown) => void>, handler: Function|null, previous: Function[]|null}}
 */
export function registry() {
  let reg = globalThis[REGISTRY_KEY]
  if (reg === undefined || reg === null) {
    reg = { owners: new Map(), handler: null, previous: null, uninstall: null }
    globalThis[REGISTRY_KEY] = reg
  }
  return reg
}

/**
 * The stack of one error, with its causes, normalized to forward slashes.
 *
 * A stack trace prints the source as a `file://` URL on every platform, so
 * the paths have to be compared in that form: a Windows path with
 * backslashes would never match.
 * @param {unknown} error the error
 * @returns {string} the stack
 */
export function stackOf(error) {
  const parts = []
  const seen = new Set()
  let current = error
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current)
    if (typeof current.stack === 'string') parts.push(current.stack)
    current = current.cause
  }
  return parts.join('\n').split('\\').join('/')
}

/**
 * Declare "the code below this directory is mine".
 *
 * The directory has to be the plugin's OWN source directory: the path of the
 * plugin is part of the stack of every frame of its own code, and of no other.
 * The declaration is idempotent - the last declaration of a directory wins.
 *
 * @param {string} dir the absolute directory of the plugin's own sources
 * @param {(error: unknown) => void} onFault what to do with a fault of this plugin
 * @returns {() => void} the undo
 */
export function claimFaultOwnership(dir, onFault) {
  if (typeof dir !== 'string' || dir === '') return () => {}
  const reg = registry()
  const key = dir.split('\\').join('/')
  reg.owners.set(key, typeof onFault === 'function' ? onFault : () => {})
  return () => {
    if (reg.owners.get(key) === onFault) reg.owners.delete(key)
  }
}

/**
 * Install the boundary of ONE plugin: its ownership and the process boundary.
 *
 * The two belong together, because their lifetimes are entangled: the
 * process has ONE handler, and the plugin that installed it owns the
 * uninstaller. A plugin that mounts second gets a no-op uninstaller - so the
 * plugin that mounts FIRST must not remove the handler on its teardown while
 * the other plugin is still mounted: that plugin would lose its boundary and
 * its faults would reach the fail-loud handler of the host, which ends the
 * host process.
 *
 * Leaving the boundary installed is harmless: it hands every UNCLAIMED fault
 * to the handlers the host had installed before the takeover, exactly as
 * before.
 *
 * @param {any} ctx the cordis host context
 * @param {string} dir the absolute directory of the plugin's own sources
 * @param {(error: unknown) => void} onFault what to do with a fault of this plugin
 * @returns {() => void} the uninstaller
 */
export function installPluginFaultBoundary(ctx, dir, onFault) {
  const release = claimFaultOwnership(dir, onFault)
  // Whether THIS call is the one that installs the handler of the process:
  // the second plugin gets a no-op uninstaller, and it must not take the
  // place of the real one in the registry.
  const owned = registry().handler === null
  const uninstall = installFaultBoundary(ctx)
  const reg = registry()
  // The uninstaller of the process boundary lives in the REGISTRY, not in the
  // plugin that installed it: the plugin that mounts first may be torn down
  // first, and the plugin that mounts second holds a no-op uninstaller. The
  // registry is shared by every copy of this module, so the LAST plugin to
  // release its claim is the one that removes the boundary - and the boundary
  // never outlives the last claim.
  if (owned && typeof uninstall === 'function' && reg.uninstall === null) reg.uninstall = uninstall
  return () => {
    release()
    if (registry().owners.size === 0) {
      const remove = registry().uninstall
      registry().uninstall = null
      remove?.()
    }
  }
}

/**
 * The owner of one error, if any.
 *
 * The order of the decision is fixed:
 *
 *   1. the stack hits a directory that an owner declared ⇒ the error is that
 *      owner's business;
 *   2. no owner claims it ⇒ it belongs to the host and the host's own
 *      fail-loud policy applies.
 *
 * @param {unknown} error the error
 * @returns {{owner: (error: unknown) => void, dir: string}|null} the owner
 */
export function ownerOf(error) {
  if (error === null || typeof error !== 'object') return null
  const stack = stackOf(error)
  const reg = registry()
  for (const [dir, onFault] of reg.owners) {
    if (stack.includes(dir)) return { owner: onFault, dir }
  }
  return null
}

/**
 * Install the ONE error boundary of the process.
 *
 * The handler takes the event over (it does not merely listen to it): Node
 * copies the handler array before it calls the handlers, so a listener that
 * removes the other handlers while it runs could not stop them from being
 * called in the same turn - the host's fail-loud handler would end the
 * process before the boundary could do anything about it.
 *
 * The handlers that were installed before are remembered and called for every
 * error that no owner claims, so the host keeps its policy unchanged.
 *
 * @param {any} ctx the cordis host context
 * @returns {() => void} the uninstaller
 */
export function installFaultBoundary(ctx) {
  const reg = registry()
  if (reg.handler !== null) {
    // The boundary is already installed - a second copy of this module (the
    // codeintel carries one too) must NOT take the event over a second time.
    return () => {}
  }
  /**
   * Take one event over.
   * @param {'uncaughtException' | 'unhandledRejection'} event the event
   */
  const takeover = (event) => {
    const inherited = process.listeners(event)
    if (inherited.length === 0) {
      ctx?.logger?.warn?.(
        'dsh-ide-workbench: no handler for %s was installed before the plugin took the event over; the host may end the process for a fault of a plugin',
        event,
      )
    }
    /**
     * Take a handler over that was installed AFTER the takeover.
     *
     * Node copies the handler array before it calls the handlers, so a
     * handler that appears later is called by Node itself - and the host's
     * fail-loud handler would end the process even for a fault of a plugin.
     * Such a handler is therefore adopted: it is remembered and called by
     * this boundary, and removed from the process.
     *
     * The one error that cannot be saved is the FIRST one after the late
     * installation: it is already in the copy Node made.
     */
    const adoptLateHandlers = () => {
      const late = process.listeners(event).filter(listener => listener !== handler && !inherited.includes(listener))
      if (late.length === 0) return
      for (const listener of late) {
        inherited.push(listener)
        process.removeListener(event, listener)
      }
      ctx?.logger?.warn?.(
        'dsh-ide-workbench: a handler for %s was installed after the plugin took the event over; the boundary calls it from now on',
        event,
      )
    }
    const handler = function boundary(error) {
      adoptLateHandlers()
      const claimed = ownerOf(error)
      if (claimed !== null) {
        try {
          ctx?.logger?.error?.(
            'dsh-ide-workbench: contained a %s of %s: %s',
            event === 'uncaughtException' ? 'fatal exception' : 'rejected promise',
            claimed.dir,
            error instanceof Error ? (error.stack ?? error.message) : String(error),
          )
          claimed.owner(error)
        } catch (fault) {
          ctx?.logger?.error?.('dsh-ide-workbench: the fault handler failed: %s', fault instanceof Error ? fault.stack : String(fault))
        }
        return
      }
      // Not the business of any plugin: the host's own handlers see it
      // exactly as before. The second argument is Node's `origin`, and the
      // host may branch on it, so it is handed on unchanged.
      for (const listener of inherited) {
        try { listener(error, event) } catch { /* the host decides what happens next */ }
      }
    }
    process.removeAllListeners(event)
    process.on(event, handler)
    return { handler, inherited }
  }
  const exceptions = takeover('uncaughtException')
  const rejections = takeover('unhandledRejection')
  reg.handler = exceptions.handler
  reg.previous = [...exceptions.inherited, ...rejections.inherited]
  const uninstall = () => {
    process.removeListener('uncaughtException', exceptions.handler)
    process.removeListener('unhandledRejection', rejections.handler)
    for (const listener of exceptions.inherited) {
      if (!process.listeners('uncaughtException').includes(listener)) process.on('uncaughtException', listener)
    }
    for (const listener of rejections.inherited) {
      if (!process.listeners('unhandledRejection').includes(listener)) process.on('unhandledRejection', listener)
    }
    reg.handler = null
    reg.previous = null
    // The registry must not keep a pointer to an uninstaller that is gone.
    if (reg.uninstall === uninstall) reg.uninstall = null
  }
  return uninstall
}
