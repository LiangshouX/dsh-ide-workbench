/**
 * Durable plugin settings.
 *
 * DSH has no "plugin KV" service in this build; the profile directory is the
 * one durable, profile-scoped location every deployment has. One JSON file per
 * profile, written atomically (temp + rename), read once and cached in memory.
 */
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { ApiError } from './wire.js'
import { DEFAULT_LSP_SETTINGS, IDLE_POLICIES, INDEX_SCOPES } from './settings-defaults.js'

/** The settings schema version this build writes. */
export const SETTINGS_VERSION = 5

/**
 * The free-memory threshold of the documents written before schema 4.
 *
 * It was the hard gate of the semantic analysis then, and its default was
 * two gigabytes. The value is only rewritten when it is exactly this one:
 * a threshold the user chose is never touched.
 */
const LEGACY_FREE_MEMORY_THRESHOLD_MB = 2048

/** Deep defaults; a saved document is merged over this at load time. */
export const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  /** Last root the user worked in (absolute path). */
  lastRoot: '',
  idea: { path: '' },
  webstorm: { path: '' },
  vscode: { path: '' },
  git: {
    path: '',
    colors: true,
    commitTemplate: '',
    diffStyle: 'side',
    structuralOnly: false,
    logPageSize: 200,
  },
  terminal: {
    /** 'auto' or a shell id from terminal.shells. */
    shell: 'auto',
    cwdMode: 'root',
    copyOnSelect: false,
    fontSize: 13,
  },
  project: {
    alwaysSelectOpened: true,
    showHidden: true,
    /** List .gitignore'd entries (greyed) in the tree. */
    showIgnored: false,
    /** IDEA "Open files with single click": single click opens a preview tab. */
    singleClickOpen: false,
    /** Directories treated as excluded (yellow-brown background). */
    excluded: [],
    /** Per-path file type overrides (`{ path: kind }`). */
    fileTypes: {},
  },
  editor: {
    fontSize: 13,
    wordWrap: false,
    sideBySide: true,
    highlight: true,
    /**
     * 'auto' = editable up to editableMaxBytes, read-only above it.
     * 'editable' / 'readonly' force one mode. `defaultReadOnly` is kept for
     * documents written by 0.3.x (read-only when true, but 'auto' wins).
     */
    openMode: 'auto',
    editableMaxBytes: 1 << 20,
    /** @deprecated V2 behaviour; migrated by the client to openMode. */
    defaultReadOnly: true,
    /** Markdown files open rendered rather than as source. */
    markdownPreview: true,
  },
  commit: {
    groupByDirectory: false,
    testCommand: '',
    cleanupCommand: '',
    optimizeImportsCommand: '',
  },
  /** Where links to files in the conversation open. */
  links: {
    /** 'ide' = this plugin's workbench; 'sidebar' = DSH's own right-sidebar preview. */
    chatFiles: 'ide',
  },
  /** Tool-window layout, per tool: dock side, mode, pin/auto-hide, size. */
  layout: {
    tools: {
      project: { dock: 'left', mode: 'docked', pinned: true, autoHide: false, size: 300 },
      commit: { dock: 'left', mode: 'docked', pinned: true, autoHide: false, size: 300 },
      terminal: { dock: 'bottom', mode: 'docked', pinned: true, autoHide: false, size: 270 },
      git: { dock: 'bottom', mode: 'docked', pinned: true, autoHide: false, size: 270 },
    },
    floating: {},
    split: {},
  },
  /** Changelists per workspace root (client-side grouping only). */
  changelists: {},
  /** Local-history retention policy. */
  history: { maxPerFile: 100, maxBytes: 209715200, maxDays: 90 },
  delete: { useRecycleBin: true, confirm: true },
  ui: { showStatusBar: true },
  /**
   * Semantic analysis (LSP) settings (PRD-v5 §6.1).
   *
   * `enabled` is the master switch: with it off no language server is ever
   * started and the workbench keeps its conservative mode (local completion
   * plus text search for usages).
   */
  lsp: { ...DEFAULT_LSP_SETTINGS },
  shortcuts: {
    project: 'Alt+1',
    commit: 'Alt+0',
    git: 'Alt+9',
    terminal: 'Alt+F12',
    focusCommit: 'Ctrl+K',
    push: 'Ctrl+Shift+K',
    synchronize: 'Ctrl+Alt+Y',
    compare: 'Ctrl+D',
    findInFiles: 'Ctrl+Shift+R',
    /** Fallback because some Electron shells swallow Ctrl+Shift+… combos. */
    findInFilesAlt: 'Ctrl+Alt+F',
    openCommitDetail: 'Ctrl+Alt+D',
    quickOpen: 'Ctrl+Shift+N',
    rename: 'F2',
    renameRefs: 'Shift+F6',
    duplicate: 'F5',
    move: 'F6',
    delete: 'Delete',
    hideAll: 'Ctrl+Shift+F12',
    searchEverywhere: 'Ctrl+Shift+A',
    revertCommit: 'Ctrl+Alt+Z',
    jumpToSource: 'F4',
    openEntry: 'Enter',
    /** PRD-v5 §6.4: the semantic navigation keys. */
    findUsages: 'Alt+F7',
    findUsagesText: 'Alt+F8',
    goToDefinition: 'F12',
    complete: 'Ctrl+Space',
  },
  /** Selected IDE project root per workspace root. */
  projectRoots: {},
  /** Per-project UI state: expanded dirs, open tabs, dock geometry. */
  workspaceState: {},
}

/** The directory of the active DSH profile (falls back to the home install). */
export function profileBase() {
  const profileDir = process.env.DSH_PROFILE_DIR
  if (typeof profileDir === 'string' && profileDir !== '') return profileDir
  const dshHome = process.env.DSH_HOME
  if (typeof dshHome === 'string' && dshHome !== '') return dshHome
  return join(homedir(), '.dsh')
}

/** Absolute settings file path. */
export function settingsFile() {
  return join(profileBase(), 'ide-workbench', 'settings.json')
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Recursive merge of `patch` into a clone of `base`. */
export function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return base
  const output = isPlainObject(base) ? { ...base } : {}
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(output[key])) output[key] = deepMerge(output[key], value)
    else output[key] = value
  }
  return output
}

/**
 * Rewrite the shortcut combos that PRD-v4 moved.
 *
 * The global find moved to `Ctrl+Shift+R`; a document written before that
 * still carries the old combo, and keeping it would make `Ctrl+Shift+F` open
 * the global view again — the one thing the change must prevent. Only the
 * exact legacy combo is rewritten, so a shortcut the user picked themselves
 * is never touched, and nothing else in the document is migrated.
 * @param {any} value the merged settings document
 * @returns {any} the same document, migrated in place
 */
export function migrateLegacyShortcuts(value) {
  if (!isPlainObject(value) || !isPlainObject(value.shortcuts)) return value
  if (value.shortcuts.findInFiles === 'Ctrl+Shift+F') value.shortcuts.findInFiles = 'Ctrl+Shift+R'
  return value
}

/**
 * Fill in the `lsp` section of a document written before schema 4, 5 or the
 * PRD-v5.1 additions.
 *
 * The migration only touches the `lsp` section: every other setting the user
 * made survives untouched, which is the whole point of the schema bump. A
 * request timeout below the library's own 3000 ms default is raised, because
 * that value silently times out on a large project.
 *
 * The memory threshold changes its meaning with schema 4: it was the hard
 * gate that kept every language behind two gigabytes, and it is the
 * conservative fallback now (PRD §4.4). A document that still carries the old
 * default would keep that gate alive, so the exact legacy value is rewritten.
 * A value the user chose is never touched.
 *
 * Schema 5 added the idle policy and the index scope. A document that does
 * not carry them keeps the behaviour it had: the server is released after
 * the idle timeout, and the program is built for the whole root.
 *
 * PRD-v5.1 added the machine-level budget (MEM-08), the pressure valve
 * (MEM-12) and the workspace-level default state (WS-04). A document written
 * before them gets the defaults - the missing keys are filled in by the
 * merge over `DEFAULT_SETTINGS.lsp` - and a value the user chose survives.
 * @param {any} value the merged settings document
 * @returns {any} the same document, migrated in place
 */
export function migrateLspSettings(value) {
  if (!isPlainObject(value)) return value
  const current = isPlainObject(value.lsp) ? value.lsp : {}
  const migrated = deepMerge(DEFAULT_SETTINGS.lsp, current)
  if (!Number.isSafeInteger(migrated.requestTimeoutMs) || migrated.requestTimeoutMs < 30000) {
    migrated.requestTimeoutMs = DEFAULT_SETTINGS.lsp.requestTimeoutMs
  }
  if (!isPlainObject(migrated.indexedRoots)) migrated.indexedRoots = {}
  if (!isPlainObject(migrated.servers)) migrated.servers = {}
  if (!isPlainObject(migrated.memoryWarnedRoots)) migrated.memoryWarnedRoots = {}
  if (migrated.freeMemoryThresholdMB === LEGACY_FREE_MEMORY_THRESHOLD_MB) {
    migrated.freeMemoryThresholdMB = DEFAULT_SETTINGS.lsp.freeMemoryThresholdMB
  }
  if (!Number.isFinite(migrated.memoryHeadroom) || migrated.memoryHeadroom <= 0) {
    migrated.memoryHeadroom = DEFAULT_SETTINGS.lsp.memoryHeadroom
  }
  if (!Number.isSafeInteger(migrated.memoryHardFloorMB) || migrated.memoryHardFloorMB < 0) {
    migrated.memoryHardFloorMB = DEFAULT_SETTINGS.lsp.memoryHardFloorMB
  }
  // The idle policy of schema 5: a document that does not carry one (or
  // carries a value this build does not know) keeps the behaviour of
  // schema 4 - the server is released after the idle timeout. A value the
  // user chose is never touched.
  if (!IDLE_POLICIES.includes(migrated.idlePolicy)) {
    migrated.idlePolicy = DEFAULT_SETTINGS.lsp.idlePolicy
  }
  // The index scope of schema 5: the same rule - an unknown value falls
  // back to the conservative default.
  if (!INDEX_SCOPES.includes(migrated.indexScope)) {
    migrated.indexScope = DEFAULT_SETTINGS.lsp.indexScope
  }
  // The machine-level budget of PRD-v5.1 (MEM-08). A ratio or a cap that is
  // not a finite number - a hand-edited document, a value that came from a
  // form as a string - would make the budget of the host meaningless, so it
  // falls back to the default. A number the user chose survives.
  if (!Number.isFinite(migrated.budgetRatio) || migrated.budgetRatio < 0) {
    migrated.budgetRatio = DEFAULT_SETTINGS.lsp.budgetRatio
  }
  if (!Number.isFinite(migrated.budgetCapMB) || migrated.budgetCapMB < 0) {
    migrated.budgetCapMB = DEFAULT_SETTINGS.lsp.budgetCapMB
  }
  // The number of indexes at the same time: 0 means "the budget decides", a
  // negative number means nothing at all.
  if (!Number.isFinite(migrated.maxConcurrentIndexes) || migrated.maxConcurrentIndexes < 0) {
    migrated.maxConcurrentIndexes = DEFAULT_SETTINGS.lsp.maxConcurrentIndexes
  }
  // The pressure valve of PRD-v5.1 (MEM-12) is a switch, so only a boolean
  // is a valid value. The default is "on" - the valve is what keeps the
  // machine out of the swap.
  if (typeof migrated.pressureYield !== 'boolean') {
    migrated.pressureYield = DEFAULT_SETTINGS.lsp.pressureYield
  }
  // The workspace-level default state of PRD-v5.1 (WS-04) is a map from the
  // scope path to 'build' or 'conservative'. A document that carries
  // something else there has no decision to keep, so the empty map takes its
  // place.
  if (!isPlainObject(migrated.workspaceDefaults)) {
    migrated.workspaceDefaults = {}
  } else {
    // The map is copied into a fresh object: the default object is shared by
    // every document this process loads, and a client that writes into it
    // would change the defaults of every later document.
    migrated.workspaceDefaults = { ...migrated.workspaceDefaults }
  }
  value.lsp = migrated
  return value
}

/**
 * One settings document for the lifetime of the plugin fiber.
 */
export class SettingsStore {
  /**
   * @param {any} [ctx] the context of the host; it carries the logger of
   *   the plugin, which takes the warning of a write that failed
   */
  constructor(ctx = null) {
    this.value = DEFAULT_SETTINGS
    this.ready = null
    this.pending = Promise.resolve()
    this.ctx = ctx ?? null
  }

  /** Load (once) and return the current document. */
  async get() {
    if (this.ready === null) this.ready = this.#load()
    return this.ready
  }

  /**
   * Read the document of the profile, migrate it and keep it in the memory.
   *
   * A document that cannot be read is not a reason to refuse the work: the
   * defaults are a working state, and the next write replaces the file.
   * @returns {Promise<object>} the document of the profile
   */
  async #load() {
    try {
      const text = await readFile(settingsFile(), 'utf8')
      const parsed = JSON.parse(text)
      if (isPlainObject(parsed) && parsed.version !== SETTINGS_VERSION) {
        // Keep the pre-migration document so a bad migration never loses data.
        await copyFile(settingsFile(), `${settingsFile()}.v${parsed.version ?? 1}.bak.json`).catch(() => {})
      }
      this.value = deepMerge(DEFAULT_SETTINGS, isPlainObject(parsed) ? { ...parsed, version: SETTINGS_VERSION } : {})
      migrateLegacyShortcuts(this.value)
      migrateLspSettings(this.value)
      for (const ide of ['idea', 'webstorm', 'vscode']) {
        if (!isPlainObject(this.value[ide]) || typeof this.value[ide].path !== 'string' || this.value[ide].path.includes('\0')) {
          this.value[ide] = { ...DEFAULT_SETTINGS[ide] }
        }
      }
    } catch {
      this.value = structuredClone(DEFAULT_SETTINGS)
    }
    return this.value
  }

  /**
   * Merge one patch and persist it (serialized).
   *
   * The patch is merged onto the value of the LAST SUCCESSFUL write, and the
   * new value is committed to the memory only after the file is on the disk.
   * The other order - merge into the memory, then write - lets the memory be
   * newer than the disk when the write fails: the host would act on a
   * decision the file does not know, the client would believe that its
   * decision was saved, and the next start of DSH would silently undo it.
   *
   * A failed write rejects. The caller - the client - has to learn that its
   * decision was lost, so that it can roll its own state back; a write that
   * fails quietly is the one failure the user never hears about.
   *
   * The queue of the writes survives a failure: the next write is chained
   * onto a promise that resolves, not onto the rejection of this one.
   * @param {object} patch the settings to merge into the document
   * @returns {Promise<object>} the committed document
   */
  async update(patch) {
    for (const ide of ['idea', 'webstorm', 'vscode']) {
      if (Object.hasOwn(patch, ide)) {
        const config = patch[ide]
        if (!isPlainObject(config) || (Object.hasOwn(config, 'path') && (typeof config.path !== 'string' || config.path.includes('\0')))) {
          throw new ApiError('bad-request', `${ide}.path must be a string without NUL characters`)
        }
      }
    }
    await this.get()
    // The patch is merged when its turn comes, and not before: the merge has
    // to see the result of the writes that came before it, and a write that
    // failed must not leave a value behind that the next one would build on.
    const written = this.pending.then(async () => {
      const next = deepMerge(this.value, patch)
      await this.#write(structuredClone(next))
      // The disk has the value now: the memory may follow.
      this.value = next
    })
    // The queue must survive the failure: the next write is chained onto a
    // promise that resolves. The rejection itself goes to the caller below.
    this.pending = written.catch(() => {})
    try {
      await written
    } catch (error) {
      this.#reportWriteFailure(error)
      throw error
    }
    return this.value
  }

  /**
   * Write the document to the file of the profile, atomically.
   *
   * The document goes into a temporary file first and is renamed afterwards:
   * a crash in the middle of the write may not leave a half-written settings
   * document behind - the plugin would read it as a broken one and lose
   * everything the user had configured.
   * @param {object} snapshot the document to write
   */
  async #write(snapshot) {
    const file = settingsFile()
    await mkdir(dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    await rename(temp, file)
  }

  /**
   * Write a line into the log of the host.
   *
   * The settings document is the only durable place of the decisions of the
   * user, so a write that fails has to leave a trace: without it the failure
   * is silent in three places at once - the store, the route and the client.
   *
   * The store is built before the fiber is mounted, so the logger of the
   * plugin is not always at hand: the warning goes to the console of the
   * host process when there is no context, and to the log of the plugin when
   * there is one.
   * @param {unknown} error the error of the write
   */
  #reportWriteFailure(error) {
    const reason = error instanceof Error ? error.message : String(error)
    try {
      if (typeof this.ctx?.logger?.warn === 'function') {
        this.ctx.logger.warn('dsh-ide-workbench: the settings document could not be written: %s', reason)
        return
      }
      console.warn(`dsh-ide-workbench: the settings document could not be written: ${reason}`)
    } catch { /* a broken logger may not take the host down */ }
  }
}
