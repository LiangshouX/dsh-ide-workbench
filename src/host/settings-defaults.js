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
/**
 * The budget of one request while the language server is still building its
 * program (ms).
 *
 * The default request timeout (30 s) is meant for the *incremental* requests
 * of a server that is up and answering. The first semantic request of a
 * large project is a different animal: PRD-v5 §0.2 #3 measured it at more
 * than ten minutes, because the server is busy building the program of the
 * whole project. A 30 s budget turns that into a "Request timed out" that
 * the user cannot do anything about - and, because the host counts the
 * unanswered requests, into a server that is killed and restarted (and
 * therefore into the "building → killed → rebuilding" loop).
 *
 * The value is a constant and not a setting: it is a fact about the language
 * servers, not a preference of the user, and both halves of the plugin (the
 * host watchdog and the client budget) have to agree on it.
 */
export const BUILD_REQUEST_TIMEOUT_MS = 600000

/**
 * The idle policies of the `lsp` section (PRD-v5 §3.2).
 *
 * 'never' = the language server stays until the user stops it; 'after' = it
 * is released after `idleTimeoutMs` without a request; 'onMemoryPressure' =
 * it is released when the machine runs out of free memory.
 *
 * The list lives here and not in the host, because the settings page needs
 * it to offer the three choices - and a second copy would drift away.
 */
export const IDLE_POLICIES = ['never', 'after', 'onMemoryPressure']

/**
 * The index scopes of the `lsp` section (PRD-v5 §4.2).
 *
 * 'auto' = the nearest sub-project root when the root is not a project of
 * its own; 'root' = the whole root (a workspace with several projects);
 * 'project' = always the nearest sub-project root.
 */
export const INDEX_SCOPES = ['auto', 'root', 'project']

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
  /**
   * When an idle language server may release its memory (PRD-v5 §3.2).
   *
   * 'never' = never on its own; 'after' = after `idleTimeoutMs` without a
   * request; 'onMemoryPressure' = when the machine runs out of free memory.
   *
   * `autoExit: false` still means "never" for the documents that were
   * written before this setting existed - the host honours the older
   * switch over the newer policy.
   */
  idlePolicy: 'after',
  /**
   * The scope of the program the language server builds (PRD-v5 §4.2).
   *
   * 'auto' = the nearest sub-project root when the root is not a project of
   * its own; 'root' = the whole root; 'project' = always the nearest
   * sub-project root. A workspace root with several projects in it makes
   * the language server merge them into one program (measured: 2,335 files
   * / 84 MB), so the scope is converged onto one project.
   */
  indexScope: 'auto',
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
