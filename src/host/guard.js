/**
 * The error boundary of one emitter.
 *
 * An 'error' event without a listener is an **uncaught exception**, and an
 * uncaught exception ends the DSH host process (the host installs a
 * fail-loud handler that writes a diagnostic and calls `process.exit(1)`).
 * Every socket and every server that the plugin owns therefore carries a
 * listener: a terminal that cannot be opened must cost the user the
 * terminal, not the whole IDE.
 *
 * The module is deliberately free of any import, so the host half and the
 * plugin entry can both use it.
 */

/**
 * Make one emitter safe.
 *
 * @param {any} ctx the cordis host context
 * @param {any} emitter the emitter
 * @param {string} what what the emitter carries, for the log
 */
export function guardEmitter(ctx, emitter, what) {
  if (emitter === null || emitter === undefined || typeof emitter.on !== 'function') return
  emitter.on('error', (error) => {
    ctx.logger?.warn?.('dsh-ide-workbench: the %s failed: %s', what, error instanceof Error ? error.message : String(error))
  })
}
