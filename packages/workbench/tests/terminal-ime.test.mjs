/**
 * R10 - the characters of a composition survive an input method switch.
 *
 * The characters are lost inside xterm, not in this plugin: when a
 * composition ends, xterm reads the committed text back from its hidden
 * textarea in a `setTimeout(0)`, because the `data` of the composition
 * event is not reliable on Chromium. When the input method switches its
 * language while a composition runs, the textarea is cleared in between -
 * the read yields nothing and the characters are dropped silently. Windows
 * Terminal does not lose them, because it synthesises the input natively.
 *
 * The guard of the plugin speaks only when the terminal stayed silent, and
 * only for the one signature of the bug: a Shift pressed during a
 * composition. Everything else - the normal way of committing a candidate,
 * the English input, the commands - has to behave exactly as before.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createClock, createTerminalDouble, loadTerminalModule } from './terminal-support.mjs'

const mod = await loadTerminalModule()
const { createImeGuard } = mod

/**
 * A terminal with its guard, and the list of what reached the shell.
 *
 * @returns {object} the terminal, the guard and the sent texts
 */
/**
 * A terminal with its guard, and the list of what reached the shell.
 *
 * `sent` is everything the shell receives - the data of the terminal and
 * the rescue of the guard. `rescued` is only what the guard added, so a
 * test can tell "the characters are there" from "the characters are there
 * twice".
 *
 * @returns {object} the terminal, the guard and the sent texts
 */
function session() {
  const clock = createClock()
  const terminal = createTerminalDouble(clock)
  const sent = []
  const rescued = []
  // The path of the plugin: what the terminal sends goes to the shell.
  terminal.onData(text => sent.push(text))
  const guard = createImeGuard(
    terminal,
    text => { rescued.push(text); sent.push(text) },
    { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
  )
  return { clock, terminal, guard, sent, rescued }
}

/** The Shift that switches the language of the input method. */
const SHIFT = { key: 'Shift', keyCode: 16 }

test('the characters of a composition survive the switch of the input method', () => {
  const { clock, terminal, guard, sent, rescued } = session()
  // The user types "nihao" in the Chinese input method - the composition
  // preview shows it - and presses Shift to switch to English.
  terminal.textarea.dispatch('compositionstart', { data: '' })
  terminal.textarea.dispatch('compositionupdate', { data: 'nihao' })
  terminal.textarea.dispatch('keydown', SHIFT)
  terminal.textarea.dispatch('compositionend', { data: '' })
  // The textarea loses the text: this is what the library reads back, and
  // it is empty now.
  terminal.textarea.value = ''
  clock.run()
  assert.deepEqual(sent, ['nihao'], 'the characters are on their way to the shell')
  assert.deepEqual(rescued, ['nihao'], 'the guard is the one that rescued them')
  guard.dispose()
})

test('the characters are not sent twice', () => {
  const { clock, terminal, guard, sent } = session()
  terminal.textarea.dispatch('compositionstart', { data: '' })
  terminal.textarea.dispatch('compositionupdate', { data: 'nihao' })
  terminal.textarea.dispatch('keydown', SHIFT)
  terminal.textarea.dispatch('compositionend', { data: '' })
  terminal.textarea.value = ''
  clock.run()
  clock.run()
  assert.deepEqual(sent, ['nihao'], 'the guard speaks once')
  guard.dispose()
})

test('a candidate that the terminal sends itself is not sent again', () => {
  // The input method committed the text before it switched: the terminal
  // sends it, the guard has to stay quiet.
  const { clock, terminal, guard, sent, rescued } = session()
  terminal.textarea.dispatch('compositionstart', { data: '' })
  terminal.textarea.dispatch('compositionupdate', { data: 'nihao' })
  terminal.textarea.value = 'nihao'
  terminal.textarea.dispatch('keydown', SHIFT)
  terminal.textarea.dispatch('compositionend', { data: 'nihao' })
  clock.run()
  assert.deepEqual(sent, ['nihao'], 'the characters are on their way exactly once')
  assert.deepEqual(rescued, [], 'the terminal sent them, the guard did not')
  guard.dispose()
})

test('the normal way of committing a candidate is unchanged', () => {
  // Space or enter confirms the candidate: the terminal sends it, and the
  // guard does not add anything.
  const { clock, terminal, guard, sent, rescued } = session()
  terminal.textarea.dispatch('compositionstart', { data: '' })
  terminal.textarea.dispatch('compositionupdate', { data: 'nihao' })
  terminal.textarea.value = '你好'
  terminal.textarea.dispatch('keydown', { key: 'Enter', keyCode: 13 })
  terminal.textarea.dispatch('compositionend', { data: '你好' })
  clock.run()
  assert.deepEqual(sent, ['你好'], 'the candidate is on the screen once')
  assert.deepEqual(rescued, [], 'the guard does not repeat the candidate')
  guard.dispose()
})

test('a cancelled composition stays cancelled', () => {
  // Escape throws the composition away - without a Shift there is nothing
  // to rescue.
  const { clock, terminal, guard, sent } = session()
  terminal.textarea.dispatch('compositionstart', { data: '' })
  terminal.textarea.dispatch('compositionupdate', { data: 'nihao' })
  terminal.textarea.dispatch('keydown', { key: 'Escape', keyCode: 27 })
  terminal.textarea.dispatch('compositionend', { data: '' })
  terminal.textarea.value = ''
  clock.run()
  assert.deepEqual(sent, [], 'nothing is sent')
  guard.dispose()
})

test('the English input is untouched', () => {
  const { clock, terminal, guard, sent, rescued } = session()
  terminal.textarea.dispatch('keydown', { key: 'a', keyCode: 65 })
  terminal.send('a')
  clock.run()
  assert.deepEqual(sent, ['a'], 'the key goes to the shell as it always did')
  assert.deepEqual(rescued, [], 'the guard never speaks for a key that is not a composition')
  guard.dispose()
})

test('a Shift outside of a composition is not a composition', () => {
  const { clock, terminal, guard, sent, rescued } = session()
  terminal.textarea.dispatch('keydown', SHIFT)
  terminal.textarea.dispatch('compositionend', { data: '' })
  clock.run()
  assert.deepEqual(sent, [], 'nothing goes to the shell')
  assert.deepEqual(rescued, [], 'the guard never speaks without a composition')
  guard.dispose()
})

test('two sessions do not interfere with each other', () => {
  const first = session()
  const second = session()
  first.terminal.textarea.dispatch('compositionstart', { data: '' })
  first.terminal.textarea.dispatch('compositionupdate', { data: 'nihao' })
  first.terminal.textarea.dispatch('keydown', SHIFT)
  first.terminal.textarea.dispatch('compositionend', { data: '' })
  first.terminal.textarea.value = ''
  first.clock.run()
  second.clock.run()
  assert.deepEqual(first.sent, ['nihao'], 'the session that lost the characters got them back')
  assert.deepEqual(first.rescued, ['nihao'], 'only that session spoke')
  assert.deepEqual(second.sent, [], 'the other session stayed quiet')
  assert.deepEqual(second.rescued, [], 'the other session stayed quiet')
  first.guard.dispose()
  second.guard.dispose()
})

test('an empty update does not erase the characters', () => {
  // Some input methods report an empty string before they end the
  // composition - what the user typed is still there.
  const { clock, terminal, guard, sent } = session()
  terminal.textarea.dispatch('compositionstart', { data: '' })
  terminal.textarea.dispatch('compositionupdate', { data: 'nihao' })
  terminal.textarea.dispatch('compositionupdate', { data: '' })
  terminal.textarea.dispatch('keydown', SHIFT)
  terminal.textarea.dispatch('compositionend', { data: '' })
  terminal.textarea.value = ''
  clock.run()
  assert.deepEqual(sent, ['nihao'], 'the characters are on their way to the shell')
  guard.dispose()
})

test('the text of the composition stands in when the input method reported nothing', () => {
  // An input method that reports no update at all still ends the
  // composition with the text it committed.
  const { clock, terminal, guard, sent } = session()
  terminal.textarea.dispatch('compositionstart', { data: '' })
  terminal.textarea.dispatch('keydown', SHIFT)
  terminal.textarea.dispatch('compositionend', { data: 'nihao' })
  terminal.textarea.value = ''
  clock.run()
  assert.deepEqual(sent, ['nihao'], 'the characters are on their way to the shell')
  guard.dispose()
})

test('a disposed guard speaks no more', () => {
  const { clock, terminal, guard, sent } = session()
  guard.dispose()
  terminal.textarea.dispatch('compositionstart', { data: '' })
  terminal.textarea.dispatch('compositionupdate', { data: 'nihao' })
  terminal.textarea.dispatch('keydown', SHIFT)
  terminal.textarea.dispatch('compositionend', { data: '' })
  clock.run()
  assert.deepEqual(sent, [], 'the guard is gone')
})

test('a terminal without a textarea has no guard', () => {
  const clock = createClock()
  const guard = createImeGuard({}, () => {}, { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout })
  assert.equal(typeof guard.dispose, 'function')
  guard.dispose()
})
