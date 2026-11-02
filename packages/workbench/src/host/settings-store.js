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

/**
 * The settings schema version this build writes.
 *
 * The number went DOWN (5 to 3), and that is not a rollback: the file format
 * changed. The document of the core no longer carries the section of the code
 * intelligence plugin, and the version says so - a document written by this
 * build is not a document of the old schema any more, even though it has
 * fewer keys.
 */
export const SETTINGS_VERSION = 3

/**
 * The keys of the settings document that belong to another plugin.
 *
 * The core does not know the code intelligence plugin: it knows only that
 * these keys are not its own. The migration takes them out of the document
 * the core works with, and the store puts them back into the FILE on the
 * next write - so a user who downgrades the IDE keeps the settings of the
 * other plugin (PRD-v6 §7).
 */
const FOREIGN_SECTION = 'lsp'

/** The shortcuts of the document that belong to another plugin. */
const FOREIGN_SHORTCUTS = Object.freeze(['findUsages', 'findUsagesText', 'goToDefinition', 'complete'])

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
 * Take the keys of the other plugin out of a settings document.
 *
 * The core works with a document that holds its own settings only, and the
 * keys of the code intelligence plugin are not its own. They are dropped
 * EXPLICITLY here - not by accident, and not by the merge over the defaults:
 * a document that still carried them would make the core read settings it
 * does not own, and the settings page of the core would show them.
 *
 * The keys are not removed from the FILE: the store keeps them aside and
 * writes them back, so a user who downgrades the IDE finds the settings of
 * the other plugin where they left them (PRD-v6 §7).
 *
 * @param {any} value the merged settings document
 * @returns {any} the same document, migrated in place
 */
export function dropForeignSettings(value) {
  if (!isPlainObject(value)) return value
  delete value[FOREIGN_SECTION]
  if (isPlainObject(value.shortcuts)) {
    for (const key of FOREIGN_SHORTCUTS) delete value.shortcuts[key]
  }
  return value
}

/**
 * The keys of the other plugin, as the document on the disk carried them.
 *
 * They are kept aside when the document is read, and put back into the file
 * on the next write: the core does not use them, but it must not destroy
 * them either.
 *
 * @param {any} parsed the document read from the file
 * @returns {{section?: any, shortcuts?: Record<string, any>}|null} the kept keys
 */
function foreignSettingsOf(parsed) {
  if (!isPlainObject(parsed)) return null
  const kept = {}
  if (Object.hasOwn(parsed, FOREIGN_SECTION)) kept.section = parsed[FOREIGN_SECTION]
  if (isPlainObject(parsed.shortcuts)) {
    const shortcuts = {}
    for (const key of FOREIGN_SHORTCUTS) {
      if (Object.hasOwn(parsed.shortcuts, key)) shortcuts[key] = parsed.shortcuts[key]
    }
    if (Object.keys(shortcuts).length > 0) kept.shortcuts = shortcuts
  }
  return Object.keys(kept).length > 0 ? kept : null
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
    /**
     * The keys of the other plugin, as the file carried them.
     *
     * The core does not use them, but it must not destroy them: they are put
     * back into the file on every write.
     * @type {{section?: any, shortcuts?: Record<string, any>}|null}
     */
    this.foreign = null
  }

  /**
   * Load (once) and return the current document.
   *
   * The document is read from the disk only once, but the answer is always
   * the CURRENT one: a write replaces the document, and a reader that got
   * the document of the first load would act on a decision the file does
   * not know any more.
   */
  async get() {
    if (this.ready === null) this.ready = this.#load()
    await this.ready
    return this.value
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
      // The keys of the other plugin are taken out of the document the core
      // works with, and kept aside for the next write.
      this.foreign = foreignSettingsOf(parsed)
      dropForeignSettings(this.value)
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
    await writeFile(temp, `${JSON.stringify(this.#withForeignSettings(snapshot), null, 2)}\n`, 'utf8')
    await rename(temp, file)
  }

  /**
   * The document with the keys of the other plugin put back.
   *
   * The core does not read them, but it must not delete them either: the
   * settings of the other plugin have to survive a write of the core, or a
   * user who downgrades the IDE would find them gone (PRD-v6 §7).
   *
   * @param {object} snapshot the document of the core
   * @returns {object} the document to write
   */
  #withForeignSettings(snapshot) {
    const foreign = this.foreign
    if (foreign === null) return snapshot
    const document = { ...snapshot }
    if (foreign.section !== undefined) document[FOREIGN_SECTION] = foreign.section
    if (foreign.shortcuts !== undefined) {
      document.shortcuts = { ...(document.shortcuts ?? {}), ...foreign.shortcuts }
    }
    return document
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
