/**
 * The contract test of the version negotiation (PRD-v6 §2).
 *
 * The codeintel talks to the core through the Cordis service
 * `HOST_SERVICE` and compares the version of the core with
 * `CONTRACT_VERSION`:
 *
 *   - equal      -> normal operation;
 *   - greater    -> only the capabilities of the same major are used;
 *   - smaller    -> the codeintel refuses to start;
 *   - no core    -> degraded mode.
 *
 * The constants are written down in the contract and may neither be renamed
 * nor re-interpreted, so they are compared by value here. The slot keys are
 * the delivery mechanism of the client side contract and are frozen, so that
 * a copy of the contract that is edited by accident cannot silently change
 * the wire between the two plugins.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CONTRACT_VERSION,
  HOST_SERVICE,
  SLOT_KEYS,
} from '../packages/contract/src/index.js'

test('the contract version is 1', () => {
  assert.equal(CONTRACT_VERSION, 1)
})

test('the host service name is the one the contract fixes', () => {
  assert.equal(HOST_SERVICE, 'dsh-ide-workbench.contract')
})

test('the four slot keys are the ones the contract fixes', () => {
  assert.deepEqual(SLOT_KEYS, {
    editorBridge: 'ide-workbench.editor.bridge',
    statusItem: 'ide-workbench.status.item',
    settingsSection: 'ide-workbench.settings.section',
    commandItem: 'ide-workbench.command.item',
  })
})

test('the slot keys are frozen', () => {
  assert.equal(Object.isFrozen(SLOT_KEYS), true)
  assert.throws(() => { SLOT_KEYS.editorBridge = 'hijacked' }, TypeError)
  assert.equal(SLOT_KEYS.editorBridge, 'ide-workbench.editor.bridge')
})
