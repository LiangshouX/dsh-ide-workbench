/**
 * The error boundary of one emitter.
 *
 * An 'error' event without a listener is an **uncaught exception**, and an
 * uncaught exception ends the DSH host process (the host installs a
 * fail-loud handler that writes a diagnostic and calls `process.exit(1)`).
 * Every socket and every server that the plugin owns therefore carries a
 * listener: a language server relay that cannot be opened must cost the user
 * the semantic features, not the whole IDE.
 *
 * The module is deliberately free of any import, so the host half and the
 * plugin entry can both use it.
 *
 * It is a COPY of the guard of the IDE workbench (PRD-v6 CUT-02): the two
 * plugins must not depend on each other, so the 27 lines are duplicated on
 * purpose.
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
    ctx.logger?.warn?.('dsh-ide-codeintel: the %s failed: %s', what, error instanceof Error ? error.message : String(error))
  })
}
