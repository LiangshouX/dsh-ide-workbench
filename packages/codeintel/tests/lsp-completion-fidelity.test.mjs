/**
 * The completion of the language server may not rewrite the text of the user.
 *
 * The defect: typing `#`, `*`, `+`, `/` or `.` in the content area rewrote the
 * line - the characters the user had just typed were swallowed, the line was
 * converted and the indentation was changed. The cause was in the library:
 *
 *   1. `serverCompletionSource` of `@codemirror/lsp-client` computes the range
 *      the completion will REPLACE from the answer of the SERVER and maps it
 *      onto the current line by character offset. The server computes it on
 *      ITS copy of the document, which is behind by the time the answer
 *      arrives - so the range covers the characters of the user;
 *   2. `@codemirror/autocomplete` ACCEPTS the open completion BY ITSELF when a
 *      "commit character" is typed - and the commit characters of a language
 *      server are exactly the symbols a user types while writing prose.
 *
 * The fix has two halves, and this file guards both:
 *
 *   1. the completion publishes NO commit characters (the user accepts it with
 *      Enter or Tab, like VS Code with
 *      `editor.acceptSuggestionOnCommitCharacter: false`);
 *   2. the range of the completion is clamped to the word at the cursor, so it
 *      can never reach over the characters before the cursor.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EditorState } from '@codemirror/state'

import {
  clampCompletionRange,
  faithfulCompletionSource,
  faithfulResult,
  faithfulServerCompletionExtensions,
  withoutCommitCharacters,
} from '../src/client/lsp-completion.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * A completion context of a document.
 * @param {string} doc the document
 * @param {number} pos the position of the cursor
 * @returns {any} the context
 */
function contextOf(doc, pos) {
  return { state: EditorState.create({ doc }), pos, explicit: true, view: null }
}

/**
 * The answer of a server that wants to replace the whole line.
 * @param {number} [to] the end of the range of the server
 * @param {string} [text] the text of the completion
 * @returns {any} the answer
 */
function serverAnswer(to = 8, text = 'server-suggestion') {
  return {
    from: 0,
    to,
    options: [
      { label: text, apply: text, commitCharacters: ['#', '.'] },
      { label: 'other', apply: 'other' },
    ],
    commitCharacters: ['#', '*', '+', '/', '.'],
  }
}

test('the completion publishes no commit characters', async () => {
  const context = contextOf('alpha fo', 8)
  const source = faithfulCompletionSource(() => Promise.resolve(serverAnswer()))
  const result = await source(context)
  assert.equal(result.commitCharacters, undefined, 'the source has no commit characters')
  for (const option of result.options) {
    assert.equal(option.commitCharacters, undefined, 'no option has commit characters')
  }
})

test('the range of the completion never reaches before the word at the cursor', async () => {
  const context = contextOf('alpha fo', 8)
  // The server answers with a range that covers the whole line - the server
  // computes it on its own copy of the document, and that copy is behind.
  const source = faithfulCompletionSource(() => Promise.resolve(serverAnswer()))
  const result = await source(context)
  const word = context.state.wordAt(context.pos)
  assert.ok(word !== null, 'there is a word at the cursor')
  assert.equal(result.from, word.from, 'the range starts at the word')
  assert.equal(result.to, word.to, 'the range ends at the word')
  assert.ok(result.from >= word.from, 'the range never reaches before the word')
})

test('without a word at the cursor the completion may only insert', async () => {
  // The user typed `###` - there is no word, so there is nothing that a
  // completion may replace.
  const context = contextOf('###', 3)
  const source = faithfulCompletionSource(() => Promise.resolve(serverAnswer()))
  const result = await source(context)
  assert.equal(result.from, 3)
  assert.equal(result.to, 3)
})

test('the range of the answer is clamped, even when it lies behind the word', () => {
  // The server answers with a range that ends BEFORE the word - the range is
  // not about the word at all, so the completion may only be inserted at the
  // cursor.
  const context = contextOf('alpha fo', 8)
  const range = clampCompletionRange({ from: 1, to: 3 }, context)
  assert.equal(range.from, 8)
  assert.equal(range.to, 8)
})

test('a range that reaches over the word is pulled onto it', () => {
  const context = contextOf('alpha fo', 8)
  const range = clampCompletionRange({ from: 0, to: 8 }, context)
  assert.equal(range.from, 6)
  assert.equal(range.to, 8)
})

test('the answer keeps its options, its detail and its snippets', () => {
  const context = contextOf('alpha fo', 8)
  const answer = {
    ...serverAnswer(),
    validFor: /^\w*$/,
    options: [{ label: 'foo', detail: 'the detail', apply: 'foo' }],
  }
  const result = faithfulResult(answer, context)
  assert.equal(result.options.length, 1, 'the options stay')
  assert.equal(result.options[0].detail, 'the detail', 'the detail stays')
  assert.equal(result.validFor.source, answer.validFor.source, 'the validFor stays')
})

test('an option without commit characters is left alone', () => {
  const option = { label: 'foo', apply: 'foo' }
  assert.equal(withoutCommitCharacters(option), option, 'the option is not copied for nothing')
})

test('the extensions of the completion keep the source reachable', () => {
  const extensions = faithfulServerCompletionExtensions(() => null)
  assert.ok(Array.isArray(extensions), 'the extensions are a list')
  const state = EditorState.create({ doc: '', extensions })
  const data = state.languageDataAt('autocomplete', 0)
  assert.equal(data.length, 1, 'the source of the language server is published')
  assert.equal(typeof data[0], 'function', 'and it is a function')
})

test('the codeintel installs the faithful completion', async () => {
  const source = await readFile(join(root, 'src/client/lsp-session.js'), 'utf8')
  // The library's own `serverCompletion()` is NOT installed any more: it
  // publishes the commit characters and the range of the server.
  assert.doesNotMatch(source, /library\.serverCompletion\(\)/)
  assert.match(source, /faithfulServerCompletionExtensions\(library\.serverCompletionSource\)/)
})
