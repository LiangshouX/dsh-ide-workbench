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

/** The settings schema version this build writes. */
export const SETTINGS_VERSION = 2

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
 * One settings document for the lifetime of the plugin fiber.
 */
export class SettingsStore {
  constructor() {
    this.value = DEFAULT_SETTINGS
    this.ready = null
    this.pending = Promise.resolve()
  }

  /** Load (once) and return the current document. */
  async get() {
    if (this.ready === null) this.ready = this.#load()
    return this.ready
  }

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

  /** Merge one patch and persist atomically (serialized). */
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
    this.value = deepMerge(this.value, patch)
    const snapshot = structuredClone(this.value)
    this.pending = this.pending.then(() => this.#write(snapshot)).catch(() => {})
    await this.pending
    return this.value
  }

  async #write(snapshot) {
    const file = settingsFile()
    await mkdir(dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    await rename(temp, file)
  }
}
