/**
 * The editing fidelity of the buffer ("the content is 100 % faithful").
 *
 * The promise of the workbench: **in edit mode the file shows exactly what
 * the user typed**. No extension may swallow a character, re-format a line or
 * change the indentation of what the user typed.
 *
 * The promise has to be kept in the CORE, not in the plugin that breaks it:
 * the editor is the only party that sees every transaction, and a plugin that
 * installs a destructive extension must not be able to rewrite the text of the
 * user behind the back of the workbench.
 *
 * The guard is an `EditorState.transactionFilter`: it sees every transaction
 * and refuses (or trims) the ones that rewrite the text of the user.
 *
 * The three kinds of transaction are treated differently:
 *
 *   1. **A gesture of the user** (`input.type`, `input.paste`, `delete.*`,
 *      `move.drop`, `undo`, `redo`, `indent`, …) is allowed. The user did it.
 *   2. **A completion** (`input.complete`) is the ONE case that needs a closer
 *      look, because the library of the completion uses the same user event
 *      for two very different things:
 *        - the completion the user ACCEPTED (Enter or Tab) - the range is the
 *          word the user is typing;
 *        - the completion the library applied BY ITSELF, when the user typed
 *          a "commit character" - and the commit characters of a language
 *          server are exactly the symbols a user types while writing prose
 *          (`#`, `*`, `+`, `/`, `.`). The range of that one comes from the
 *          SERVER, which computes it on ITS copy of the document: when the
 *          copy is behind, the range reaches over the characters the user has
 *          just typed - and the library replaces them without any gesture.
 *      So the RANGE is what is checked: a completion may only replace the word
 *      at the cursor. Everything else is left to the codeintel, which does not
 *      publish commit characters at all (see `lsp-completion.js`).
 *   3. **A programmatic change** (no user event at all - a formatter, a
 *      plugin that rewrites a range) may insert and may delete, but it may not
 *      REPLACE text the user did not select.
 *
 * The module is pure: it needs no browser and no CodeMirror view, so the
 * rules can be tested one by one.
 */
import { EditorState, Transaction } from '@codemirror/state'

/**
 * The user event of a transaction, or '' when it has none.
 *
 * The annotation of the transaction is the plain event name (`input.type`,
 * `delete.backward`, …); an empty string means "nobody did this".
 *
 * The annotations are scanned instead of `tr.annotation(...)`: the helper of
 * CodeMirror throws when a transaction carries the same annotation twice, and
 * a guard must never be the reason an editor breaks.
 * @param {any} tr the transaction
 * @returns {string} the name of the event
 */
function userEventOf(tr) {
  for (const annotation of tr.annotations) {
    // The annotation carries its type: `Transaction.userEvent` is the TYPE,
    // not a class, so `instanceof` cannot be used with it.
    if (annotation.type === Transaction.userEvent) {
      return typeof annotation.value === 'string' ? annotation.value : ''
    }
  }
  return ''
}

/**
 * Whether the user event is the one of a completion.
 *
 * The rule of CodeMirror: an event matches itself and every event below it
 * (`input.complete` matches `input.complete.anything`).
 * @param {string} event the name of the event
 * @returns {boolean} true when the event is the one of a completion
 */
function isCompletionEvent(event) {
  return event === 'input.complete' || event.startsWith('input.complete.')
}

/**
 * The word at the cursor of the transaction.
 *
 * The word is taken from the state BEFORE the change: the cursor of the user
 * is where the completion happened. A file without a grammar has no word
 * characters at all - and then there is no word, and a completion may not
 * replace anything.
 * @param {any} tr the transaction
 * @returns {{from: number, to: number} | null} the word, or `null`
 */
function wordAtCursor(tr) {
  const head = tr.startState.selection.main.head
  const word = tr.startState.wordAt(head)
  if (word === null || word === undefined) return null
  return { from: word.from, to: word.to }
}

/**
 * Whether one change of a transaction REPLACES text.
 *
 * A change of CodeMirror is one of three things: an insertion (`from === to`),
 * a deletion (`from > to`) or a replacement (`from < to` and a text). Only the
 * replacement puts OTHER text where the text of the user was - that is the
 * thing the guard is about.
 * @param {{from: number, to: number, insert: any}} change the change
 * @returns {boolean} true when the change replaces text
 */
function isReplacement(change) {
  return change.from < change.to && change.insert.length > 0
}

/**
 * Whether one selection range covers a change.
 *
 * "Covered" means the whole removed text was inside the range the user had
 * selected - so the user pointed at it.
 * @param {any} range the range of the selection
 * @param {{from: number, to: number}} change the change
 * @returns {boolean} true when the range covers the change
 */
function rangeCovers(range, change) {
  return range.from <= change.from && change.to <= range.to
}

/**
 * Whether a change may happen, when nothing but the selection decides.
 *
 * The text the user selected may be replaced - that is the user's own
 * gesture, and a plugin that works on the selection does exactly that.
 * @param {any} tr the transaction
 * @param {{from: number, to: number, insert: any}} change the change
 * @returns {boolean} true when the change may happen
 */
function selectionAllows(tr, change) {
  for (const range of tr.startState.selection.ranges) {
    if (rangeCovers(range, change)) return true
  }
  return false
}

/**
 * Whether a completion may replace the change.
 *
 * The rule is the one of the requirement: the range of the completion stays
 * inside the word at the cursor. A file without a word at the cursor (the user
 * typed `###`, a symbol, a space) has nothing that may be replaced - so a
 * completion may only INSERT there.
 * @param {{from: number, to: number} | null} word the word at the cursor
 * @param {{from: number, to: number, insert: any}} change the change
 * @returns {boolean} true when the change may happen
 */
function wordAllows(word, change) {
  if (word === null) return false
  return change.from >= word.from && change.to <= word.to
}

/**
 * The changes of a transaction.
 *
 * The callback of `iterChanges` gets the extent of the change in the document
 * BEFORE the change (`from`/`to` - the text that is removed) and the extent
 * in the document AFTER it (`fromB`/`toB` - the text that is inserted).
 * @param {any} tr the transaction
 * @returns {Array<object>} the changes of the transaction
 */
function changesOf(tr) {
  const changes = []
  tr.changes.iterChanges((from, to, fromB, toB, text) => {
    changes.push({ from, to, fromB, toB, insert: text.toString() })
  })
  return changes
}

/**
 * The changes of a transaction that may happen.
 * @param {Array<object>} changes the changes of the transaction
 * @param {(change: object) => boolean} allowed the rule for one change
 * @returns {Array<object>} the changes that may happen
 */
function allowedChanges(changes, allowed) {
  return changes.filter(change => allowed(change))
}

/**
 * The cursor after a completion that was applied.
 *
 * The completion inserts its text where the word was, so the cursor belongs
 * behind the inserted text. The other changes of the transaction (the extra
 * edits of the server) do not move it.
 * @param {any} tr the transaction
 * @param {Array<object>} changes the changes that may happen
 * @returns {{anchor: number} | undefined} the selection, or `undefined`
 */
function selectionAfter(tr, changes) {
  const head = tr.startState.selection.main.head
  for (const change of changes) {
    if (change.from <= head && head <= change.to) {
      return { anchor: change.fromB + change.insert.length }
    }
  }
  return undefined
}

/**
 * Whether the transaction may change the document - and what it may change.
 *
 * The answer is a transaction (or a spec) when the change may happen, and
 * `null` when it may not. The transaction is TRIMMED instead of cancelled
 * when only a part of it is destructive: the completion of the user is then
 * still applied, and only the part that would rewrite the text of the user is
 * dropped.
 * @param {any} tr the transaction
 * @returns {any} the transaction, a spec for it, or `null`
 */
export function fidelityCheck(tr) {
  if (tr === null || tr === undefined) return tr
  if (!tr.docChanged) return tr
  const changes = changesOf(tr)
  const event = userEventOf(tr)

  // The completion: the range may only reach inside the word at the cursor.
  if (isCompletionEvent(event)) {
    const word = wordAtCursor(tr)
    const allowed = allowedChanges(changes, change => !isReplacement(change) || wordAllows(word, change))
    if (allowed.length === changes.length) return tr
    // Something was dropped. The completion itself is kept (its range is
    // inside the word), so the user still gets it - only the part that would
    // rewrite the text around the cursor is gone.
    if (allowed.length === 0) return null
    return {
      changes: allowed,
      selection: selectionAfter(tr, allowed),
      annotations: tr.annotations,
      effects: tr.effects,
      scrollIntoView: tr.scrollIntoView,
    }
  }

  // Every other gesture of the user is allowed: the user did it.
  if (event !== '') return tr

  // A programmatic change: it may insert and it may delete, but it may not
  // replace the text the user did not select.
  const allowed = allowedChanges(changes, change => !isReplacement(change) || selectionAllows(tr, change))
  if (allowed.length === changes.length) return tr
  if (allowed.length === 0) return null
  return {
    changes: allowed,
    selection: selectionAfter(tr, allowed),
    annotations: tr.annotations,
    effects: tr.effects,
    scrollIntoView: tr.scrollIntoView,
  }
}

/**
 * The extension that keeps the buffer faithful.
 *
 * The extension is a transaction filter, so it sees EVERY transaction of the
 * editor - the ones of the plugins of the seam as well.
 *
 * The order inside the extension array matters: the filters of CodeMirror run
 * from the LAST registered to the FIRST one, and a filter that returns a LIST
 * of transactions appends its own changes without running the other filters
 * again. The guard is therefore registered AFTER `indentOnInput()` (which
 * appends the indentation of the line - a change of the leading whitespace
 * that the guard must not touch) and BEFORE the extensions of the seam (so it
 * sees what the plugins did).
 * @returns {any} the CodeMirror extension
 */
export function fidelityGuard() {
  return EditorState.transactionFilter.of(tr => fidelityCheck(tr))
}
