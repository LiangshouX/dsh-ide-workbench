/**
 * Durable settings of the code intelligence plugin (PRD-v6 §7, MIG-01).
 *
 * DSH has no "plugin KV" service in this build; the profile directory is the
 * one durable, profile-scoped location every deployment has. The codeintel
 * owns a document of its own - `<profile>/dsh-codeintel/settings.json` - and
 * it is written atomically (temp + rename), read once and cached in memory.
 *
 * The document holds the `lsp` section (the language servers, their memory
 * budget and the index memory) and the four semantic shortcuts. It does NOT
 * hold the settings of the IDE workbench: the workbench keeps its own
 * document, and neither plugin knows anything about the sections of the
 * other one.
 *
 * The one exception is the ONE-TIME import (MIG-01): when the user upgrades
 * from the single-plugin build, the `lsp` section and the four shortcuts
 * live in the document of the workbench. The codeintel reads that document
 * once, takes the two parts over and marks the import as done. The document
 * of the workbench is NOT touched: it keeps the section, so a user who
 * downgrades again finds everything where it was.
 */
import { readFileSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { ApiError } from './wire.js'
import { DEFAULT_LSP_SETTINGS, IDLE_POLICIES, INDEX_SCOPES } from './settings-defaults.js'

/**
 * The settings schema version this build writes.
 *
 * The codeintel has its OWN version line (PRD-v6 §7): its document is a new
 * file, so the version starts at 1. The number has nothing to do with the
 * version of the document of the workbench.
 */
export const SETTINGS_VERSION = 1

/**
 * The free-memory threshold of the documents written before schema 4.
 *
 * It was the hard gate of the semantic analysis then, and its default was
 * two gigabytes. The value is only rewritten when it is exactly this one:
 * a threshold the user chose is never touched.
 */
const LEGACY_FREE_MEMORY_THRESHOLD_MB = 2048

/**
 * The four semantic shortcuts the codeintel owns (PRD-v5 §6.4).
 *
 * They are the only shortcuts of the document of the workbench that belong
 * to the code intelligence - every other shortcut (save, find, quick open…)
 * stays with the workbench.
 */
export const SEMANTIC_SHORTCUT_KEYS = Object.freeze(['findUsages', 'findUsagesText', 'goToDefinition', 'complete'])

/** Deep defaults; a saved document is merged over this at load time. */
export const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  /**
   * Semantic analysis (LSP) settings (PRD-v5 §6.1).
   *
   * `enabled` is the master switch: with it off no language server is ever
   * started and the plugin keeps its conservative mode (local completion
   * plus text search for usages).
   */
  lsp: { ...DEFAULT_LSP_SETTINGS },
  /** The semantic navigation keys. */
  shortcuts: {
    findUsages: 'Alt+F7',
    findUsagesText: 'Alt+F8',
    goToDefinition: 'F12',
    complete: 'Ctrl+Space',
  },
  /**
   * Whether the one-time import from the document of the workbench already
   * happened (MIG-01).
   *
   * The flag lives in the document of the codeintel, so the import happens
   * exactly once per profile - and it survives the restarts of DSH.
   */
  legacyImported: false,
}

/**
 * The profile directory the running app was actually booted for.
 *
 * `DSH_PROFILE_DIR` comes from the shell that launched the app, so a DSH
 * booted from another DSH's terminal carries the variable of the OTHER
 * profile and would write its settings there. The host publishes the truth as
 * the `profileContext` service (`{ name, dir }`), and `apply()` records it
 * here before the first write. `''` means "no context yet, use the variable".
 * @type {string}
 */
let bootedProfileDir = ''

/**
 * Record the profile directory of the running app (or forget it with `''`).
 * @param {string} [directory] the directory the app was booted for
 */
export function setProfileBase(directory) {
  bootedProfileDir = typeof directory === 'string' ? directory.trim() : ''
}

/** The directory of the active DSH profile (falls back to the home install). */
export function profileBase() {
  if (bootedProfileDir !== '') return bootedProfileDir
  const profileDir = process.env.DSH_PROFILE_DIR
  if (typeof profileDir === 'string' && profileDir !== '') return profileDir
  const dshHome = process.env.DSH_HOME
  if (typeof dshHome === 'string' && dshHome !== '') return dshHome
  return join(homedir(), '.dsh')
}

/** Absolute path of the settings document of the codeintel. */
export function settingsFile() {
  return join(profileBase(), 'dsh-codeintel', 'settings.json')
}

/**
 * Absolute path of the settings document of the IDE workbench.
 *
 * The file is only READ: the import takes the `lsp` section and the four
 * shortcuts out of it, and the workbench keeps its own copy (a downgrade has
 * to keep working).
 * @returns {string} the absolute path
 */
export function coreSettingsFile() {
  return join(profileBase(), 'ide-workbench', 'settings.json')
}

/**
 * Whether one value is a plain object.
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Recursive merge of `patch` into a clone of `base`.
 * @param {any} base
 * @param {any} patch
 * @returns {any} the merged document
 */
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
 * The imported document of the workbench is a document of schema 5, so this
 * migration is a no-op for it - it is kept because the codeintel may write a
 * document of its own that a user edited by hand.
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
 * The part of the document of the workbench the codeintel takes over.
 *
 * Only the `lsp` section and the four semantic shortcuts move: every other
 * setting of that document belongs to the workbench and stays there.
 * @param {unknown} coreDocument the document of the workbench
 * @returns {object} the patch for the document of the codeintel
 */
export function legacyImportPatch(coreDocument) {
  if (!isPlainObject(coreDocument)) return {}
  const patch = {}
  if (isPlainObject(coreDocument.lsp)) patch.lsp = coreDocument.lsp
  const shortcuts = {}
  for (const key of SEMANTIC_SHORTCUT_KEYS) {
    const value = coreDocument.shortcuts?.[key]
    if (typeof value === 'string' && value !== '') shortcuts[key] = value
  }
  if (Object.keys(shortcuts).length > 0) patch.shortcuts = shortcuts
  return patch
}

/**
 * The project roots the settings document still knows.
 *
 * The live map of the language server manager only holds the roots that were
 * opened in THIS process, and the jdtls workspace of a project is its index
 * cache: a project the user did not open today must not lose it. The
 * settings document outlives the process, so its `lsp.indexedRoots` map are
 * the roots the unload sweep has to keep.
 *
 * The document is read from the FILE as well: the in-memory `value` is the
 * snapshot this process loaded, and another DSH host of the same profile may
 * have written a project into it since. A teardown is rare and the file is
 * small, so the synchronous read is cheaper than a wrong sweep - the sweep
 * may delete a workspace that a project of another host still uses.
 * @param {any} settings the settings store of this plugin fiber
 * @returns {string[]} the absolute roots the settings remember
 */
export function knownRootsOfSettings(settings) {
  const roots = []
  const collect = (document) => {
    if (document === null || typeof document !== 'object') return
    const indexedRoots = document.lsp?.indexedRoots
    if (indexedRoots !== null && typeof indexedRoots === 'object') {
      for (const root of Object.keys(indexedRoots)) {
        if (root !== '') roots.push(root)
      }
    }
  }
  collect(settings !== null && typeof settings === 'object' ? settings.value : null)
  try {
    // The read is synchronous on purpose: the teardown has to know the roots
    // before the process goes away, and a promise would not be awaited there.
    collect(JSON.parse(readFileSync(settingsFile(), 'utf8')))
  } catch {
    // A settings file that cannot be read adds nothing; the in-memory
    // snapshot above is still a (smaller) answer.
  }
  return roots
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
   * Read one JSON document of the profile.
   *
   * A document that cannot be read is not a reason to refuse the work: the
   * defaults are a working state, and the next write replaces the file.
   * @param {string} file the absolute path
   * @returns {Promise<object>} the document, or an empty one
   */
  async #readDocument(file) {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'))
      return isPlainObject(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  /**
   * Read the document of the profile, import the legacy parts and keep it in
   * the memory.
   *
   * The import happens exactly once (MIG-01): the flag `legacyImported` in
   * the document of the codeintel says that it already happened. A document
   * that carries the flag is never compared with the document of the
   * workbench again.
   * @returns {Promise<object>} the document of the profile
   */
  async #load() {
    let own = {}
    try {
      const text = await readFile(settingsFile(), 'utf8')
      const parsed = JSON.parse(text)
      if (isPlainObject(parsed)) {
        if (parsed.version !== SETTINGS_VERSION) {
          // Keep the pre-migration document so a bad migration never loses data.
          await copyFile(settingsFile(), `${settingsFile()}.v${parsed.version ?? 1}.bak.json`).catch(() => {})
        }
        own = parsed
      }
    } catch {
      own = {}
    }
    const alreadyImported = own.legacyImported === true
    // The legacy document is only read when the import still has to happen.
    // The document of the workbench is READ ONLY: it keeps its `lsp` section,
    // so a user who downgrades again finds everything where it was.
    const legacy = alreadyImported ? {} : legacyImportPatch(await this.#readDocument(coreSettingsFile()))
    // The values of the codeintel win over the imported ones: the import
    // fills in what the user had configured before the split, and it never
    // overwrites a decision the user made after it.
    const merged = deepMerge(legacy, own)
    this.value = deepMerge(DEFAULT_SETTINGS, { ...merged, version: SETTINGS_VERSION })
    migrateLspSettings(this.value)
    if (!alreadyImported) {
      // The import is done - the flag says so, and it is written to the disk
      // so the next start of DSH does not import again.
      this.value.legacyImported = true
      await this.#persistImport()
    }
    return this.value
  }

  /**
   * Write the document after the one-time import.
   *
   * A failure is logged but not thrown: the import itself succeeded (the
   * values are in the memory and in use), and the next start of DSH simply
   * imports again - the import is idempotent, because the values of the
   * codeintel win over the imported ones.
   */
  async #persistImport() {
    try {
      await this.#write(structuredClone(this.value))
    } catch (error) {
      this.#reportWriteFailure(error)
    }
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
    if (!isPlainObject(patch)) {
      throw new ApiError('bad-request', 'the settings patch must be an object')
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
        this.ctx.logger.warn('dsh-ide-codeintel: the settings document could not be written: %s', reason)
        return
      }
      console.warn(`dsh-ide-codeintel: the settings document could not be written: ${reason}`)
    } catch { /* a broken logger may not take the host down */ }
  }
}
