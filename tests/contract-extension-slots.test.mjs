/**
 * The contract test of the extension slot merge (PRD-v6 §4.1, acceptance
 * C16/C17).
 *
 * The core and the codeintel both want to contribute the automatic closing
 * of the brackets to the editor. Both of them can do it, so the contract
 * fixes the rule instead of letting the two sides negotiate:
 *
 *   1. the slots are grouped by `key`;
 *   2. of one group only the slot with the highest `priority` survives;
 *   3. on a tie the slot that was registered LAST wins;
 *   4. the loser is NOT installed at all - never installed and then
 *      disabled, so there is no second `StateField` and no second input
 *      handler in the editor.
 *
 * The result must not depend on the order in which the plugins are loaded:
 * the codeintel claims priority 100, the core claims 0, so the codeintel
 * wins whichever order the contributions arrive in.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  mergeExtensionSlots,
  CORE_PRIORITY,
  CODEINTEL_PRIORITY,
} from '../packages/contract/src/index.js'

/**
 * The slot of the core: the automatic closing of the brackets.
 * @returns {{key: string, priority: number, extensions: unknown[]}} the slot
 */
function coreSlot () {
  return { key: 'closeBrackets', priority: CORE_PRIORITY, extensions: ['core:closeBrackets'] }
}

/**
 * The slots of the codeintel: the automatic closing of the brackets and the
 * autocompletion.
 * @returns {Array<{key: string, priority: number, extensions: unknown[]}>} the slots
 */
function codeintelSlots () {
  return [
    { key: 'closeBrackets', priority: CODEINTEL_PRIORITY, extensions: ['intel:closeBrackets'] },
    { key: 'autocomplete', priority: CODEINTEL_PRIORITY, extensions: ['intel:autocomplete'] },
  ]
}

test('the priorities of the two sides are the ones the contract fixes', () => {
  assert.equal(CORE_PRIORITY, 0)
  assert.equal(CODEINTEL_PRIORITY, 100)
})

test('only the slot with the highest priority survives', () => {
  const result = mergeExtensionSlots([[coreSlot()], codeintelSlots()])
  assert.deepEqual(result, ['intel:closeBrackets', 'intel:autocomplete'])
})

test('the loser is not in the result at all', () => {
  // Not installed-and-disabled: the extension of the core must not appear
  // in the list, otherwise the editor would run two closing handlers.
  const result = mergeExtensionSlots([[coreSlot()], codeintelSlots()])
  assert.equal(result.includes('core:closeBrackets'), false)
  assert.equal(result.length, 2)
})

test('the result does not depend on the order of the contributions', () => {
  const coreFirst = mergeExtensionSlots([[coreSlot()], codeintelSlots()])
  const codeintelFirst = mergeExtensionSlots([codeintelSlots(), [coreSlot()]])
  assert.deepEqual(coreFirst, codeintelFirst)
  assert.ok(coreFirst.includes('intel:closeBrackets'), 'the codeintel must win')
  assert.equal(coreFirst.includes('core:closeBrackets'), false)
})

test('on a tie the later registration wins', () => {
  const earlier = { key: 'tie', priority: 50, extensions: ['earlier'] }
  const later = { key: 'tie', priority: 50, extensions: ['later'] }
  assert.deepEqual(mergeExtensionSlots([[earlier], [later]]), ['later'])
  assert.deepEqual(mergeExtensionSlots([[later], [earlier]]), ['earlier'])
})

test('a key that only one side declares is kept', () => {
  const result = mergeExtensionSlots([[coreSlot()], codeintelSlots()])
  assert.ok(result.includes('intel:autocomplete'), 'a key only the codeintel declares is kept')
  const onlyCore = { key: 'onlyCore', priority: CORE_PRIORITY, extensions: ['core:only'] }
  const result2 = mergeExtensionSlots([[onlyCore], codeintelSlots()])
  assert.ok(result2.includes('core:only'), 'a key only the core declares is kept')
})

test('all the extensions of the winning slot are present, in order', () => {
  const winner = {
    key: 'multi',
    priority: CODEINTEL_PRIORITY,
    extensions: ['first', 'second', 'third'],
  }
  const loser = { key: 'multi', priority: CORE_PRIORITY, extensions: ['loser'] }
  assert.deepEqual(mergeExtensionSlots([[loser], [winner]]), ['first', 'second', 'third'])
})

test('a slot without a key is ignored', () => {
  const result = mergeExtensionSlots([[{ priority: 100, extensions: ['nameless'] }], codeintelSlots()])
  assert.equal(result.includes('nameless'), false)
})
