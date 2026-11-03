/**
 * The editor contributions of the code intelligence plugin.
 *
 * The plugin does not own the editor: it hands its extensions, its key
 * bindings and its commands to the core through the contract (PRD-v6 §3.4),
 * and the core puts them into its own CodeMirror instance.
 *
 * Two rules shape this module:
 *
 * 1. **No CodeMirror class may be used at module scope.** The plugin does not
 *    bundle `@codemirror/*`: the packages are aliased to the Proxy shim of
 *    `vendor/`, and the shim resolves the runtime when the property is read.
 *    A class that is touched while the module is evaluated would therefore
 *    throw in a plugin that is installed alone (DEG-01) - so every extension
 *    is built inside a function that runs after the contract arrived
 *    (PRD-v6 §3.5, R1).
 * 2. **The slots are pinned.** The three slots below - `closeBrackets`,
 *    `autocomplete` and `lsp` - are the ones of the implementation contract
 *    (§4.1); the priority of 100 is what makes the codeintel win over the
 *    core when both are installed.
 */
import { CODEINTEL_PRIORITY } from '../contract/index.js'
import { autocompletion, closeBrackets, closeBracketsKeymap, startCompletion } from '@codemirror/autocomplete'
// The keymap facet comes from the shim of the view package (the runtime of the
// core), so the wrapping lives in the same CodeMirror instance as the editor.
import { keymap } from '@codemirror/view'
import { lspLibrary } from './lsp-lib.js'
import { findUsagesText as runTextUsageSearch, keymapKeyFor, lspExtensions } from './lsp-session.js'

/**
 * The extension slots of the plugin.
 *
 * The core keeps a copy of the automatic closing of the brackets and the
 * plugin brings one too (decision D9): the slot with the higher priority
 * wins, and the loser is never installed - so there is no second state field
 * and no second input handler in the editor.
 *
 * The key bindings are wrapped in `keymap.of`: a raw list of key bindings is
 * NOT an extension, and handing it to the editor as one makes
 * `EditorState.create` throw ("Unrecognized extension value in extension
 * set"). With both plugins installed THIS slot wins, so the editor of a
 * double install crashed on its first mount and the workbench panel went
 * blank - the same failure the core had alone (see the core's
 * `editor-seam.js`). The core alone never hit this one.
 *
 * The call has to happen AFTER the contract arrived: the extensions are
 * built from the CodeMirror runtime of the core, and the runtime only exists
 * while the core is installed.
 *
 * @returns {Array<{key: string, priority: number, extensions: unknown[]}>} the slots
 */
export function codeintelExtensionSlots() {
  return [
    {
      key: 'closeBrackets',
      priority: CODEINTEL_PRIORITY,
      extensions: [closeBrackets(), keymap.of(closeBracketsKeymap)],
    },
    {
      key: 'autocomplete',
      priority: CODEINTEL_PRIORITY,
      // `icons: false` keeps the popup free of the icon set of the library.
      extensions: [autocompletion({ activateOnTyping: true, icons: false })],
    },
    {
      key: 'lsp',
      priority: CODEINTEL_PRIORITY,
      extensions: lspExtensions(),
    },
  ]
}

/**
 * The word around one position, whatever the language is.
 *
 * The text version of "find usages" has to work in a file without a grammar
 * too, so it uses the plain word characters instead of the syntax tree.
 * @param {any} state the editor state
 * @param {number} pos the document offset
 * @returns {string | null} the word, or `null`
 */
export function wordAtCursor(state, pos) {
  if (state === null || state === undefined) return null
  if (!Number.isInteger(pos) || pos < 0 || pos > state.doc.length) return null
  const line = state.doc.lineAt(pos)
  const text = line.text
  let start = Math.min(pos - line.from, text.length)
  let end = start
  while (start > 0 && /[\w$]/.test(text[start - 1])) start -= 1
  while (end < text.length && /[\w$]/.test(text[end])) end += 1
  if (end <= start) return null
  return text.slice(start, end)
}

/**
 * The command of the text version of "find usages" (NAV-03).
 * @param {any} view the editor
 * @returns {boolean} true when a word was found
 */
export function findUsagesTextCommand(view) {
  if (view === null || view === undefined) return false
  const word = wordAtCursor(view.state, view.state.selection.main.head)
  if (word === null) return false
  runTextUsageSearch(word)
  return true
}

/**
 * The key bindings of the plugin.
 *
 * The keys come from the settings of the plugin (`goToDefinition`,
 * `findUsages`, `findUsagesText`, `complete`), so a user can move them.
 *
 * The rename and format keys of the language server stay free: `F2` renames
 * a file and `Shift-Alt-f` updates the references of the workbench.
 *
 * @returns {Array<{key: string, run: Function, preventDefault?: boolean}>} the bindings
 */
export function codeintelKeymap() {
  const entries = []
  // The library of the language-server client is loaded lazily (see
  // `lsp-lib.js`): the semantic commands are bound as soon as it is there.
  const library = lspLibrary()
  const goToDefinition = keymapKeyFor('goToDefinition')
  if (goToDefinition !== '' && library !== null) {
    entries.push({ key: goToDefinition, run: library.jumpToDefinition, preventDefault: true })
  }
  const findUsages = keymapKeyFor('findUsages')
  if (findUsages !== '' && library !== null) {
    entries.push({ key: findUsages, run: library.findReferences, preventDefault: true })
  }
  const findUsagesText = keymapKeyFor('findUsagesText')
  if (findUsagesText !== '') entries.push({ key: findUsagesText, run: findUsagesTextCommand, preventDefault: true })
  const complete = keymapKeyFor('complete')
  if (complete !== '') entries.push({ key: complete, run: startCompletion, preventDefault: true })
  return entries
}

/**
 * The commands of the plugin (the context menu of the editor).
 *
 * The semantic entries need a language server; the text entry is always
 * available, so the user always has a way to find the usages of a symbol.
 * @param {{semanticNavigation: () => any, t: (key: string) => string}} store the store of the plugin
 * @returns {Array<{key: string, label: string, shortcut?: string, run: Function, enabled?: () => boolean}>} the commands
 */
export function codeintelCommands(store) {
  const navigation = store.semanticNavigation()
  return [
    {
      key: 'codeintel.goToDefinition',
      label: store.t('nav.goToDefinition'),
      shortcut: keymapKeyFor('goToDefinition'),
      run: () => {},
      enabled: () => navigation.findUsages.enabled,
    },
    {
      key: 'codeintel.findUsages',
      label: store.t('nav.findUsages'),
      shortcut: keymapKeyFor('findUsages'),
      run: () => {},
      enabled: () => navigation.findUsages.enabled,
    },
    {
      key: 'codeintel.findUsagesText',
      label: store.t('nav.findUsagesText'),
      shortcut: keymapKeyFor('findUsagesText'),
      run: () => {},
      enabled: () => true,
    },
  ]
}
