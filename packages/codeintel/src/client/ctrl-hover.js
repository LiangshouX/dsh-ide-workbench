/**
 * The Ctrl+hover jump hint of the plugin (NAV-01).
 *
 * JetBrains promises the target before the click: holding the modifier turns
 * the identifier under the pointer blue and underlines it. The hint is a
 * decoration mark, and a Ctrl+click on an identifier jumps to its
 * definition.
 *
 * The module is careful about the CodeMirror runtime (PRD-v6 §3.5, R1): the
 * packages are aliased to the Proxy shim, so the state field and the effect
 * may only be created when the runtime is there - and the runtime is there
 * when the contract of the core arrived. Everything is therefore built
 * lazily and cached.
 */
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import { ensureSyntaxTree } from '@codemirror/language'
import { lspLibrary } from './lsp-lib.js'

/**
 * The node names that stand for an identifier.
 *
 * A Ctrl+click may only trigger on one of them: on whitespace, on
 * punctuation, on a comment or inside a string it must do nothing. The
 * second group holds the names the grammars really produce - a JavaScript
 * variable is a `VariableDefinition`, a Java method a `MethodName`.
 */
const IDENTIFIER_NODE_NAMES = new Set([
  'Name', 'VariableName', 'FunctionName', 'PropertyName', 'ClassName',
  'TypeName', 'LabelName', 'TagName', 'AttributeName', 'Identifier',
  'VariableDefinition', 'PrivatePropertyName', 'JSXIdentifier', 'MethodName',
  'ScopedIdentifier', 'FieldName', 'DefName', 'TypeIdentifier', 'FieldIdentifier',
  'ScopeIdentifier', 'IdName', 'PseudoClassName', 'NamespaceName', 'Label',
])

/**
 * The state of the lazy parts of the module.
 *
 * @type {{field: any, effect: any, mark: any}}
 */
const lazy = { field: null, effect: null, mark: null }

/**
 * The mark of the symbol a Ctrl+click would jump to.
 * @returns {any} the mark
 */
function ctrlHoverMark() {
  if (lazy.mark === null) lazy.mark = Decoration.mark({ class: 'iwb-ctrl-hover-symbol' })
  return lazy.mark
}

/**
 * The effect that replaces the highlighted range.
 *
 * The effect is a value, not a class: the field of the state and the effect
 * belong together, and both are created once.
 * @returns {any} the effect
 */
export function setCtrlHover() {
  if (lazy.effect === null) lazy.effect = StateEffect.define()
  return lazy.effect
}

/**
 * The state field that carries the highlighted range.
 *
 * A state field (and not a plugin-local value) so the decoration survives a
 * document edit and is mapped through it.
 * @returns {any} the field
 */
export function ctrlHoverField() {
  if (lazy.field === null) {
    const effect = setCtrlHover()
    const mark = ctrlHoverMark()
    lazy.field = StateField.define({
      create: () => Decoration.none,
      update(value, transaction) {
        let next = value.map(transaction.changes)
        for (const item of transaction.effects) {
          if (!item.is(effect)) continue
          const range = item.value
          next = range === null
            ? Decoration.none
            : Decoration.set([mark.range(range.from, range.to)])
        }
        return next
      },
      provide: field => EditorView.decorations.from(field),
    })
  }
  return lazy.field
}

/**
 * The range of the identifier at one position.
 *
 * The Ctrl+hover hint needs the range, not only the text: the decoration is
 * put on exactly the word that a Ctrl+click would jump to.
 * @param {any} state the editor state
 * @param {number} pos the document offset
 * @returns {{from: number, to: number} | null} the range
 */
export function identifierRangeAt(state, pos) {
  if (state === null || state === undefined) return null
  if (!Number.isInteger(pos) || pos < 0 || pos > state.doc.length) return null
  let node = null
  try {
    // `ensureSyntaxTree` and not `syntaxTree`: the background parser works
    // on a time budget, so on a busy machine the tree around the cursor can
    // still be incomplete - and then the identifier is not found at all, so a
    // Ctrl+click would silently do nothing.
    const tree = ensureSyntaxTree(state, pos, 1000)
    if (tree === null || tree === undefined) return null
    node = tree.resolveInner(pos, 1)
  } catch {
    return null
  }
  for (let depth = 0; node !== null && node !== undefined && depth < 3; depth += 1) {
    if (IDENTIFIER_NODE_NAMES.has(node.name)) {
      if (node.to <= node.from) return null
      return { from: node.from, to: node.to }
    }
    node = node.parent
  }
  return null
}

/**
 * The identifier at one position.
 *
 * Only an identifier counts: on whitespace, on punctuation, on a comment or
 * inside a string the function answers `null`.
 * @param {any} state the editor state
 * @param {number} pos the document offset
 * @returns {string | null} the identifier
 */
export function identifierAt(state, pos) {
  const range = identifierRangeAt(state, pos)
  if (range === null) return null
  return state.doc.sliceString(range.from, range.to)
}

/**
 * The range currently highlighted by the Ctrl+hover hint.
 * @param {any} state the editor state
 * @returns {{from: number, to: number} | null} the range
 */
export function currentCtrlHover(state) {
  const field = ctrlHoverField()
  const value = state.field(field, false)
  if (value === undefined || value === null || value.size === 0) return null
  const first = value.iter()
  return { from: first.from, to: first.to }
}

/**
 * Highlight (or clear) the symbol the modifier points at.
 *
 * The dispatch only happens when the range really changes: a pointer that
 * moves inside one word must not push a transaction per pixel.
 * @param {any} view the editor
 * @param {{from: number, to: number} | null} range the wanted range
 */
export function highlightCtrlHover(view, range) {
  if (view === null || view === undefined) return
  const current = currentCtrlHover(view.state)
  const same = (current === null && range === null)
    || (current !== null && range !== null && current.from === range.from && current.to === range.to)
  if (same) return
  try {
    view.dispatch({ effects: setCtrlHover().of(range) })
  } catch {
    /* the editor may already be gone */
  }
}

/**
 * The range the modifier points at, with the current pointer position.
 * @param {any} view the editor
 * @param {{x: number, y: number} | null} pointer the last known pointer
 * @returns {{from: number, to: number} | null} the range
 */
export function ctrlHoverRangeAt(view, pointer) {
  if (pointer === null || pointer === undefined) return null
  const pos = view.posAtCoords({ x: pointer.x, y: pointer.y })
  if (typeof pos !== 'number') return null
  return identifierRangeAt(view.state, pos)
}

/**
 * The Ctrl+click handler of the editor (NAV-01).
 *
 * CodeMirror 6 has no built-in "click to go to definition", so the handler
 * is added by hand. It only reacts on an identifier and only when the
 * modifier key is pressed; on a hit it prevents the default action, so the
 * mouse does not start a text selection at the same time.
 * @param {any} event the mouse event
 * @param {any} view the editor
 * @param {{trigger?: (view: any) => boolean, requirePlugin?: boolean}} [options]
 *   `trigger` replaces the jump (the tests count it), `requirePlugin` says
 *   whether a language server has to be attached
 * @returns {boolean} true when the event was handled
 */
export function handleCtrlClick(event, view, options = {}) {
  if (event === null || event === undefined) return false
  if (!(event.ctrlKey === true || event.metaKey === true)) return false
  if (view === null || view === undefined) return false
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
  if (typeof pos !== 'number') return false
  if (identifierAt(view.state, pos) === null) return false
  // Without a language server there is nothing to jump to; the click keeps
  // its normal meaning (a selection), so the modifier drag still works.
  const library = lspLibrary()
  if (options.requirePlugin !== false) {
    if (library === null || library.LSPPlugin.get(view) === null) return false
  }
  event.preventDefault()
  view.dispatch({ selection: { anchor: pos } })
  const trigger = options.trigger ?? (library === null ? null : library.jumpToDefinition)
  if (trigger !== null) trigger(view)
  return true
}

/**
 * The extensions of the Ctrl+hover hint.
 *
 * The handler of the mouse is a CodeMirror extension: the seam of the core
 * installs the extensions of the contributors, and the editor of the core
 * knows nothing about the plugin.
 * @returns {Array<any>} the extensions
 */
export function ctrlHoverExtensions() {
  /** The last pointer position over the editor. */
  let pointer = null
  return [
    ctrlHoverField(),
    EditorView.domEventHandlers({
      mousemove: (event, view) => {
        pointer = { x: event.clientX, y: event.clientY }
        highlightCtrlHover(view, (event.ctrlKey || event.metaKey) ? ctrlHoverRangeAt(view, pointer) : null)
        return false
      },
      mousedown: (event, view) => handleCtrlClick(event, view),
    }),
  ]
}
