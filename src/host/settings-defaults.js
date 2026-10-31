/**
 * The defaults of the `lsp` section of the settings document.
 *
 * The module is deliberately free of any import: the host reads it, and the
 * client reads it too. The client needs the defaults because the "reset to
 * defaults" button of the settings page has to put the semantic-analysis
 * section back to the state of a fresh installation - and a copy of the
 * numbers in the client would drift away from the document the host writes.
 *
 * `src/host/settings-store.js` builds its `DEFAULT_SETTINGS.lsp` from this
 * object, so the two can never disagree.
 */
export const DEFAULT_LSP_SETTINGS = {
  /** Master switch. false = never start a language server. */
  enabled: true,
  /** 'ask' = ask; 'always' = always index; 'never' = never index. */
  indexOnOpen: 'ask',
  /** Memory ceiling handed to the language server (MB). */
  memoryLimitMB: 2048,
  /**
   * Conservative fallback floor (MB): the free memory that is required when
   * no estimate of the language is known. It is not a gate for a language
   * that has an estimate (PRD §4.4).
   */
  freeMemoryThresholdMB: 512,
  /** Factor between the estimate of a language server and the memory it needs. */
  memoryHeadroom: 1.5,
  /** Free memory below which no language server starts at all (MB). */
  memoryHardFloorMB: 256,
  /** Idle time after which the language server exits (ms). */
  idleTimeoutMs: 600000,
  /** LSP request timeout (ms). Must stay >= 30000: the client library's own
   * default is 3000, which silently times out on large projects. */
  requestTimeoutMs: 30000,
  /** How long an index may run before the cancel button appears (ms). */
  cancelAfterMs: 60000,
  /** Whether an idle language server may exit on its own. */
  autoExit: true,
  /** Whether a crashed language server is restarted once. */
  autoRestart: true,
  /**
   * Per-language overrides: { [languageId]: { enabled, command, args } }.
   *
   * `enabled: false` switches one language off: its server is never
   * started and the language stays in the conservative mode. `command` and
   * `args` replace the registered ones; `memoryLimitMB` lowers the
   * ceiling of one language; `memoryBaselineMB` replaces the estimate the
   * free memory is compared with.
   */
  servers: {},
  /** Project roots that completed a first build: { [absPath]: { at, languageId } }. */
  indexedRoots: {},
  /** Project roots the user has already been warned about on a tight memory
   * budget: { [absPath]: true }. The same project is not asked twice. */
  memoryWarnedRoots: {},
}
