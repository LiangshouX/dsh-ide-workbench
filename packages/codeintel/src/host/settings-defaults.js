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
 * The idle policies of the `lsp` section (PRD-v5 §3.2, PRD-v5.1 §5).
 *
 * 'never' = the language server stays until the user stops it; 'after' = it
 * is released after `idleTimeoutMs` without a request; 'onMemoryPressure' =
 * it is released when the machine runs out of free memory; 'always' = it is
 * released in both cases - after the idle timeout *and* when the machine
 * asks for the memory back.
 *
 * The list lives here and not in the host, because the settings page needs
 * it to offer the choices - and a second copy would drift away.
 */
export const IDLE_POLICIES = ['never', 'after', 'onMemoryPressure', 'always']

/**
 * The index scopes of the `lsp` section (PRD-v5 §4.2).
 *
 * 'auto' = the nearest sub-project root when the root is not a project of
 * its own; 'root' = the whole root (a workspace with several projects);
 * 'project' = always the nearest sub-project root.
 */
export const INDEX_SCOPES = ['auto', 'root', 'project']

/**
 * The language ids the host registry can start a language server for.
 *
 * Both halves of the plugin import this list: the host refuses a `languageId`
 * that is not in its registry, and the client only reports a language it can
 * see a server for (PRD-v5.1 JS-04). One list keeps the two halves from
 * disagreeing about which languages have a server - a second copy would drift
 * away, and a language the client names while the host does not know it is a
 * start that fails without a hint.
 *
 * The list is maintained by hand next to `LSP_REGISTRY`: adding a server there
 * means adding its language ids here.
 */
export const LSP_LANGUAGE_IDS = [
  'typescript',
  'javascript',
  'javascriptreact',
  'typescriptreact',
  'python',
  'yaml',
  'java',
  'go',
  'rust',
  'c',
  'cpp',
]

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
  /**
   * The machine-level total budget, as a fraction of the total memory
   * (PRD-v5.1 MEM-08).
   *
   * The per-server gate answers one question only: "may the next server
   * start". It cannot answer "may three servers grow to their ceiling at the
   * same time" - and that is the question that ends in the swap. The budget
   * is the last gate: the sum of the ceilings of the running servers never
   * exceeds `totalBytes × budgetRatio`.
   *
   * A quarter of the memory is the default: a machine that gives a quarter
   * of its memory to the language servers still has room for the editor, the
   * build and the agent - and on a large machine the absolute cap
   * (`budgetCapMB`) takes over anyway.
   */
  budgetRatio: 0.25,
  /**
   * The absolute cap of the machine-level total budget (MB, MEM-08).
   *
   * The ratio alone would hand a 64 GB machine 16 GB of language servers,
   * which is more than any machine needs. The cap is the ceiling of the
   * budget: `min(totalBytes × budgetRatio, budgetCapMB)`. Four gigabytes
   * hold about four TypeScript indexes of the default size, which is what
   * the budget is meant to allow.
   */
  budgetCapMB: 4096,
  /**
   * The number of indexes that may run at the same time (0 = no limit).
   *
   * The budget decides how many servers fit into the machine; this setting
   * is the user's own limit on top of it. When both apply, the stricter one
   * wins: a limit of 1 keeps a single index even on a machine with room for
   * four. 0 leaves the decision to the budget alone.
   */
  maxConcurrentIndexes: 0,
  /** Idle time after which the language server exits (ms). */
  idleTimeoutMs: 600000,
  /**
   * When an idle language server may release its memory (PRD-v5 §3.2).
   *
   * 'never' = never because of idleness; 'after' = after `idleTimeoutMs`
   * without a request; 'onMemoryPressure' = only when the machine runs out
   * of free memory; 'always' = the idle timeout *and* the pressure yield.
   *
   * The idle half of the policy never exempts the machine from the memory
   * pressure: 'never' means "not because of idleness", not "not even when
   * the machine is dying" (PRD-v5.1 MEM-12). The pressure valve has a
   * switch of its own - `pressureYield` - and that is the only way to
   * switch it off.
   *
   * `autoExit: false` still means "never" for the documents that were
   * written before this setting existed - the host honours the older
   * switch over the newer policy.
   */
  idlePolicy: 'after',
  /**
   * Whether a language server may be released when the machine runs out of
   * memory (PRD-v5.1 MEM-12).
   *
   * The pressure valve is the last defence against the swap: when the
   * available memory falls below the hard floor, the least active server is
   * released and the machine gets its memory back. The valve is independent
   * of `idlePolicy` - "never" means "never because of idleness", not "not
   * even when the machine is dying" - and it is installed by default.
   *
   * `false` is the one and only way to switch the valve off: the host does
   * not install the pressure timer at all. The user who switches it off
   * gives up the protection against the swap, so the switch has to be an
   * explicit one.
   */
  pressureYield: true,
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
   *
   * The java server has four keys of its own under `servers.java` (PRD-v5.1
   * JS-02). Every one of them defaults to empty and every default is
   * environment-derived: a path written into this file would work on one
   * machine and nowhere else.
   *
   *   - `javaHome` (string, default `''`): the JDK that starts jdtls. A
   *     directory that contains `bin/java[.exe]`, or the executable itself.
   *     Empty = discover one, in the order explicit setting > `JAVA_HOME` >
   *     `java` on PATH > the IDE's JDK table > the IDE's bundled runtime >
   *     a scan of environment-derived roots.
   *   - `jdtlsHome` (string, default `''`): the jdtls installation root.
   *     Empty = `JDTLS_HOME`, else the layout is derived from the resolved
   *     `jdtls` command.
   *   - `javaSearchRoots` (string[], default `[]`): EXTRA roots to scan for a
   *     JDK, for the user whose IDE is installed where nothing looks. It is a
   *     fallback, not the normal path - the discovered sources above already
   *     cover a standard machine.
   *   - `javaArgs` (string[], default `[]`): extra JVM arguments appended to
   *     the JVM part of the generated command line, before `-jar` (for
   *     debugging, e.g. `-Dxxx` or an extra `-Xmx`; after the jar, `java`
   *     would pass them to the Eclipse application instead of the JVM).
   *
   * `servers` is a free object: the settings store only guarantees that it is
   * an object, so a missing key means "the default above" and no migration is
   * needed when one of the keys is added.
   */
  servers: {},
  /** Project roots that completed a first build: { [absPath]: { at, languageId } }. */
  indexedRoots: {},
  /** Project roots the user has already been warned about on a tight memory
   * budget: { [absPath]: true }. The same project is not asked twice. */
  memoryWarnedRoots: {},
  /**
   * The semantic-analysis default state of every workspace:
   * `{ [scopePath]: 'build' | 'conservative' }` (PRD-v5.1 WS-04).
   *
   * `indexOnOpen` is the global policy, and this map outranks it: a
   * workspace whose user once chose the basic mode stays in the basic mode
   * even when `indexOnOpen` is 'always'. The decision of the user is
   * persistent - it lives in the settings document, so it survives a
   * workspace switch and a restart of DSH, which the memory of the client
   * does not.
   *
   * Only a decision the user made belongs here. A decision the policy
   * derived (the automatic start of the 'always' policy) stays in the
   * memory of the client - written here it would take the choice away from
   * the user, who could never turn the index of that workspace off again.
   */
  workspaceDefaults: {},
}
