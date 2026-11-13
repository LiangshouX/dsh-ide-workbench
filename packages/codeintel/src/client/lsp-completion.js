/**
 * The completion of the language server, without the power to rewrite the
 * text of the user.
 *
 * The defect this module exists for: typing `#`, `*`, `+`, `/` or `.` in the
 * content area REWROTE the line. The user typed `###` and the editor showed
 * `#` - the characters were swallowed, the line was converted and the
 * indentation was changed. Nothing was lost in the file; the editor simply
 * painted the lily over what the user had typed.
 *
 * The mechanism has two halves, and both of them live in the library:
 *
 *   1. `@codemirror/lsp-client` computes the range the completion will
 *      REPLACE from the answer of the SERVER (`completionResultRange`) and
 *      maps it onto the current line by character offset. The server computes
 *      that range on ITS copy of the document - and the copy is behind by the
 *      time the answer arrives. The range then covers the characters the user
 *      has just typed.
 *   2. `@codemirror/autocomplete` ACCEPTS the open completion BY ITSELF when a
 *      "commit character" is typed. The commit characters of a language server
 *      are exactly the symbols a user types while writing prose (`#`, `*`,
 *      `+`, `/`, `.`) - so the mere typing of a symbol applied a completion
 *      without any gesture of the user.
 *
 * The fix has two halves as well:
 *
 *   1. **No commit characters.** The completion may only be accepted with
 *      Enter or Tab - like VS Code with
 *      `editor.acceptSuggestionOnCommitCharacter: false`. The popup, the
 *      list, the detail and the snippets stay as they are.
 *   2. **The range is clamped to the word at the cursor.** A completion may
 *      only replace the word that is being typed - never the characters
 *      around it, and never the characters BEFORE the cursor.
 *
 * The module is written against the SOURCE of the completion, not against the
 * library: the library is loaded lazily (`lsp-lib.js`), and the source is
 * handed in - so the rules can be tested without a language server.
 */
import { EditorState } from '@codemirror/state'
import { autocompletion } from '@codemirror/autocomplete'

/**
 * The range of a completion, clamped to the word at the cursor.
 *
 * The word is the plain word of the document (`state.wordAt`), so the rule
 * holds for every language - and for a file without a grammar as well.
 *
 * A file whose cursor is not inside a word (the user typed a symbol or a
 * space) has NOTHING that may be replaced: the range collapses to the cursor,
 * so the completion can only INSERT there.
 * @param {{from: number, to: number}} range the range of the server
 * @param {any} context the completion context
 * @returns {{from: number, to: number}} the clamped range
 */
export function clampCompletionRange(range, context) {
  const pos = context?.pos ?? 0
  const word = context?.state?.wordAt?.(pos) ?? null
  if (word === null || word === undefined) return { from: pos, to: pos }
  // A range that does not touch the word is not about the word at all - the
  // server answered for something else (its copy of the document is behind).
  // The completion may then only be INSERTED at the cursor.
  if (range.to <= word.from || range.from >= word.to) return { from: pos, to: pos }
  // Otherwise the range is pulled onto the word: it may never reach over the
  // characters before the cursor.
  const from = Math.min(Math.max(range.from, word.from), word.to)
  const to = Math.max(Math.min(range.to, word.to), from)
  return { from, to }
}

/**
 * One option of a completion, without its commit characters.
 *
 * The commit characters of an option are read by the library when a key is
 * typed (`option.completion.commitCharacters || result.result.commitCharacters`)
 * - so both places have to be free of them.
 * @param {any} option the option of the completion
 * @returns {any} the option without commit characters
 */
export function withoutCommitCharacters(option) {
  if (option === null || option === undefined || typeof option !== 'object') return option
  if (option.commitCharacters === undefined) return option
  const { commitCharacters, ...rest } = option
  return rest
}

/**
 * The answer of the server, made faithful.
 *
 * @param {any} result the answer of the completion source
 * @param {any} context the completion context
 * @returns {any} the answer without commit characters and with a clamped range
 */
export function faithfulResult(result, context) {
  if (result === null || result === undefined) return result
  const range = clampCompletionRange({ from: result.from, to: result.to }, context)
  const options = Array.isArray(result.options)
    ? result.options.map(option => withoutCommitCharacters(option))
    : result.options
  return { ...result, from: range.from, to: range.to, commitCharacters: undefined, options }
}

/**
 * The completion source of the language server, made faithful.
 *
 * The source of the library is wrapped, not replaced: it still asks the server
 * (and it still knows when to ask), but its answer can no longer rewrite the
 * text of the user.
 * @param {Function} source the source of the library
 * @returns {Function} the faithful source
 */
export function faithfulCompletionSource(source) {
  return (context) => {
    const result = typeof source === 'function' ? source(context) : null
    if (result === null || result === undefined) return result
    // A source that answers at once (a test double, a cache) is answered at
    // once - the rules are the same.
    if (typeof result.then !== 'function') return faithfulResult(result, context)
    return result.then(resolved => faithfulResult(resolved, context))
  }
}

/**
 * The extensions of the faithful completion.
 *
 * The shape is the one of `serverCompletion()` of the library: the local
 * completion stays as it is (the semantic one must not override it), and the
 * semantic source is published through the language data.
 * @param {Function} source the source of the library
 * @returns {Array<any>} the extensions
 */
export function faithfulServerCompletionExtensions(source) {
  return [
    autocompletion(),
    EditorState.languageData.of(() => [{ autocomplete: faithfulCompletionSource(source) }]),
  ]
}
