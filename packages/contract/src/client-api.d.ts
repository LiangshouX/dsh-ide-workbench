/**
 * The client-side contract of PRD-v6 §3.3 / §3.4.
 *
 * The contract reaches the codeintel as the `contract` PROP of the bridge
 * component the core renders in its `editorBridge` slot. There is no global
 * variable and no namespace: the prop is typed, scoped to the session and
 * gone when the component is unmounted.
 */

import type { WorkbenchHostApi } from './host-api.js'

export interface WorkbenchClientContract {
  /** The major version of the contract (= CONTRACT_VERSION). */
  readonly version: number

  /** The seam of the editor. */
  readonly editor: EditorSeam

  /** The host side, seen through the proxy of the codeintel. */
  readonly host: WorkbenchHostApi
}

export interface EditorSeam {
  /**
   * Register a provider of extension slots.
   *
   * The provider is called on every refresh; the slots of one key compete
   * with each other and only the one with the highest priority is installed.
   */
  registerExtensions(provider: () => ExtensionSlot[]): { refresh(): void; dispose(): void }

  /** Register key bindings. Returns the undo. */
  registerKeymap(entries: unknown[]): () => void

  /** Register commands (context menu / command palette). Returns the undo. */
  registerCommands(items: CommandItem[]): () => void

  /** Subscribe to the changes of the open document. Returns the unsubscribe. */
  onDocument(cb: (doc: DocumentInfo) => void): () => void

  /** Scroll the editor to a position of a file. */
  reveal(absolutePath: string, line: number, column?: number): void

  /** The one CodeMirror runtime of the process (PRD-v6 §3.5). */
  readonly codemirror: CmRuntime
}

/**
 * One extension slot.
 *
 * The slots of one `key` compete: only the one with the highest `priority`
 * is installed. That is the mechanism that lets the core keep the automatic
 * closing of the brackets while the codeintel takes it over when both are
 * installed - deterministically, whatever order the plugins were loaded in.
 */
export interface ExtensionSlot {
  /** The identity of the slot, e.g. 'closeBrackets' / 'autocomplete' / 'lsp'. */
  readonly key: string
  /** The bigger the number, the stronger the claim. The core uses 0, the codeintel 100. */
  readonly priority: number
  /** The CodeMirror extensions this slot carries. */
  readonly extensions: unknown[]
}

export interface DocumentInfo {
  /** The `file:` URI of the document. */
  uri: string
  /** The absolute path of the document. */
  absolutePath: string
  /** The language of the document. */
  languageId: string
  /** The current content, the unsaved draft included. */
  content: string
  /** Whether the document has unsaved changes. */
  dirty: boolean
}

export interface CommandItem {
  key: string
  label: string
  shortcut?: string
  run(): void
  enabled?: () => boolean
}

/**
 * The CodeMirror runtime the core owns.
 *
 * The codeintel must NOT bundle its own copy of `@codemirror/state` and
 * friends: the extensions of CodeMirror are checked with `instanceof`, and
 * two copies of the library break that check. The runtime is therefore
 * delivered through the contract, and the codeintel reaches it through a
 * Proxy that resolves the properties at the moment of the access.
 */
export interface CmRuntime {
  state: Record<string, unknown>
  view: Record<string, unknown>
  commands: Record<string, unknown>
  language: Record<string, unknown>
  search: Record<string, unknown>
  autocomplete: Record<string, unknown>
  lsp?: Record<string, unknown>
}
