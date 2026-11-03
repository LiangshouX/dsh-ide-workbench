/**
 * The editor seam of the client contract (PRD-v6 §4).
 *
 * The seam is the ONLY way into the editor of the workbench for another
 * plugin. The core declares four slots and hands every occupant the contract
 * as a prop; the editor part of that contract is this seam.
 *
 * The seam has three jobs:
 *
 *   1. it collects the extension slots of every contributor and merges them
 *      with the rules of the contract (PRD-v6 §3.4.1): of one key only the
 *      slot with the highest priority survives, and the loser is NOT
 *      installed at all;
 *   2. it collects the key bindings and the commands of the contributors, so
 *      the editor can offer them;
 *   3. it broadcasts the open document, so a consumer can follow the edits.
 *
 * The core does NOT know the codeintel (D8): it merges by key and priority
 * and nothing else. The automatic closing of the brackets is the proof - the
 * core offers it with priority 0, the codeintel offers it with priority 100,
 * and the winner is the same whatever order the plugins were loaded in.
 */
import { Compartment } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { CORE_PRIORITY, mergeExtensionSlots } from '../contract/index.js'
import { cmRuntime } from './cm-runtime.js'

/**
 * The compartment that holds the extensions of the contributors.
 *
 * The extensions may appear (or disappear) while an editor is open - a
 * contributor registers late, a plugin is unloaded - so they live in a
 * compartment that is reconfigured without rebuilding the document. The name
 * is neutral, because the compartment does not know who fills it.
 */
export const extensionCompartment = new Compartment()

/**
 * The compartment that holds the key bindings of the contributors.
 *
 * The bindings have to come BEFORE the default keymap of CodeMirror, otherwise
 * `Enter` and `Tab` would be swallowed by the default ones and a registered
 * shortcut could never fire. A compartment keeps that order stable while the
 * set of the bindings changes.
 */
export const keymapCompartment = new Compartment()

/**
 * The extension slots of the core itself.
 *
 * The automatic closing of the brackets is a general editing ability, not
 * code intelligence (D9): the core keeps a copy, so the workbench alone still
 * closes the brackets. When the codeintel is installed as well, it offers the
 * same slot with a higher priority - and the core steps aside.
 *
 * The slots are built ONCE: `closeBrackets()` returns a state field, and a
 * new one on every refresh would throw the state of the editor away.
 *
 * The binding list has to be wrapped in `keymap.of`: a raw list of key
 * bindings is NOT an extension, and handing it to the editor as one made
 * `EditorState.create` throw ("Unrecognized extension value in extension
 * set"). The workbench without the codeintel has no higher-priority slot to
 * replace this one, so the core-only editor could never mount.
 *
 * The core declares NO completion: the completion of the local words belongs
 * to the codeintel (PRD-v6 §2.2, acceptance R8).
 *
 * @returns {Array<{key: string, priority: number, extensions: unknown[]}>}
 */
export function coreExtensionSlots() {
  return [
    {
      key: 'closeBrackets',
      priority: CORE_PRIORITY,
      extensions: [closeBrackets(), keymap.of(closeBracketsKeymap)],
    },
  ]
}

/**
 * The seam between the workbench and the plugins that extend its editor.
 *
 * One seam belongs to one workbench store, so the extensions of one session
 * never leak into another one.
 */
export class EditorSeam {
  /**
   * @param {{coreSlots?: Array<object>, reveal?: (path: string, line: number, column?: number) => void,
   *   readDocument?: () => object|null, subscribeDocument?: (cb: () => void) => () => void}} [options]
   */
  constructor(options = {}) {
    /** The slots the core declares itself. */
    this.coreSlots = Array.isArray(options.coreSlots) ? options.coreSlots : coreExtensionSlots()
    /** The providers of the other plugins, in registration order. */
    this.providers = []
    /** The key bindings of the other plugins. */
    this.keymapEntries = []
    /** The commands of the other plugins. */
    this.commandItems = []
    /** The listeners of the merged extensions. */
    this.listeners = new Set()
    /** The listeners of the open document. */
    this.documentListeners = new Set()
    /** The host of the seam: the workbench store behind it. */
    this.host = options
    /** The last document that was broadcast, so it is sent only on a change. */
    this.lastDocument = undefined
    if (typeof options.subscribeDocument === 'function') {
      this.unsubscribeDocument = options.subscribeDocument(() => { this.broadcastDocument() })
    }
  }

  /**
   * The merged extensions of every contributor.
   *
   * The core contributes FIRST, so the order of the plugins does not matter:
   * the merge takes the highest priority of a key, and a tie goes to the
   * later registration.
   * @returns {unknown[]}
   */
  get extensionSlots() {
    const contributions = [this.coreSlots]
    for (const provider of this.providers) {
      let slots = []
      try {
        slots = provider()
      } catch {
        // A contributor that throws must not take the editor with it: it
        // simply contributes nothing this time.
        slots = []
      }
      contributions.push(Array.isArray(slots) ? slots : [])
    }
    return mergeExtensionSlots(contributions)
  }

  /** The key bindings of the contributors, flattened. */
  get keymap() {
    return this.keymapEntries.flat()
  }

  /**
   * Register a provider of extension slots.
   *
   * The provider is called on every refresh, so it may answer with different
   * extensions over time (a language server that starts, a document that
   * changes).
   *
   * @param {() => Array<{key: string, priority: number, extensions: unknown[]}>} provider
   * @returns {{refresh: () => void, dispose: () => void}}
   */
  registerExtensions(provider) {
    if (typeof provider !== 'function') {
      return { refresh: () => {}, dispose: () => {} }
    }
    this.providers.push(provider)
    const refresh = () => { this.notify() }
    const dispose = () => {
      const index = this.providers.indexOf(provider)
      if (index >= 0) this.providers.splice(index, 1)
      this.notify()
    }
    this.notify()
    return { refresh, dispose }
  }

  /**
   * Register key bindings.
   * @param {Array<unknown>} entries
   * @returns {() => void} the undo
   */
  registerKeymap(entries) {
    const list = Array.isArray(entries) ? entries : []
    this.keymapEntries.push(list)
    this.notify()
    return () => {
      const index = this.keymapEntries.indexOf(list)
      if (index >= 0) this.keymapEntries.splice(index, 1)
      this.notify()
    }
  }

  /**
   * Register commands (context menu / command palette).
   * @param {Array<{key: string, label: string, run: () => void}>} items
   * @returns {() => void} the undo
   */
  registerCommands(items) {
    const list = Array.isArray(items) ? items : []
    this.commandItems.push(list)
    this.notify()
    return () => {
      const index = this.commandItems.indexOf(list)
      if (index >= 0) this.commandItems.splice(index, 1)
      this.notify()
    }
  }

  /**
   * Subscribe to the changes of the open document.
   * @param {(doc: object|null) => void} cb
   * @returns {() => void} the unsubscribe
   */
  onDocument(cb) {
    if (typeof cb !== 'function') return () => {}
    this.documentListeners.add(cb)
    // The consumer wants the document it missed, not only the next change.
    try {
      cb(this.host.readDocument?.() ?? null)
    } catch {
      /* the consumer must not break the editor */
    }
    return () => { this.documentListeners.delete(cb) }
  }

  /**
   * Scroll the editor to a position of a file.
   * @param {string} absolutePath
   * @param {number} line
   * @param {number} [column]
   */
  reveal(absolutePath, line, column) {
    this.host.reveal?.(absolutePath, line, column)
  }

  /** The one CodeMirror runtime of the process (PRD-v6 §3.5). */
  get codemirror() {
    return cmRuntime
  }

  /**
   * Subscribe to the changes of the seam.
   *
   * The editor uses it to reconfigure its compartments when a contributor
   * registers or gives up its slot.
   * @param {() => void} cb
   * @returns {() => void} the unsubscribe
   */
  subscribe(cb) {
    if (typeof cb !== 'function') return () => {}
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  /** Wake every listener of the seam. */
  notify() {
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        // A listener that throws must not stop the others.
      }
    }
  }

  /** Send the open document to the consumers, when it changed. */
  broadcastDocument() {
    let document = null
    try {
      document = this.host.readDocument?.() ?? null
    } catch {
      document = null
    }
    const before = JSON.stringify(this.lastDocument ?? null)
    const after = JSON.stringify(document ?? null)
    if (before === after) return
    this.lastDocument = document
    for (const listener of [...this.documentListeners]) {
      try {
        listener(document)
      } catch {
        /* a consumer must not break the editor */
      }
    }
  }

  /** Release everything the seam holds. */
  dispose() {
    this.providers = []
    this.keymapEntries = []
    this.commandItems = []
    this.listeners.clear()
    this.documentListeners.clear()
    if (typeof this.unsubscribeDocument === 'function') this.unsubscribeDocument()
  }
}
