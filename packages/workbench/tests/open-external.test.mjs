import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { openExternalUrl } from '../src/host/shell.js'

/**
 * One fake child process.
 *
 * The verdict of a launcher is its exit code, so the double ends like a
 * real one: the streams are closed and the process reports its code.
 */
function fakeChild({ code = 0, stdout = '', stderr = '' } = {}) {
  const child = new EventEmitter()
  child.stdout = Readable.from(stdout === '' ? [] : [stdout])
  child.stderr = Readable.from(stderr === '' ? [] : [stderr])
  child.unref = () => { child.unrefed = true }
  return child
}

function fakeSpawn(calls, { fail = false } = {}) {
  return (command, argv, options) => {
    calls.push({ command, argv, options })
    const child = fakeChild()
    setImmediate(() => {
      if (fail) child.emit('error', new Error('spawn failed'))
      else {
        child.emit('exit', 0, null)
        child.emit('close', 0, null)
      }
    })
    return child
  }
}

test('opens an http URL with the Windows default handler', async () => {
  const calls = []
  const result = await openExternalUrl(
    { url: 'https://example.com/a?b=1' },
    { platform: 'win32', spawn: fakeSpawn(calls) },
  )
  assert.equal(result.opened, true)
  assert.equal(calls[0].command, 'rundll32.exe')
  assert.deepEqual(calls[0].argv, ['url.dll,FileProtocolHandler', 'https://example.com/a?b=1'])
  assert.equal(calls[0].options.shell, false)
  // The launcher is not detached: a detached Windows process has no console,
  // and a program that is started through the shell from such a process
  // never comes up.
  assert.equal(calls[0].options.detached, undefined)
})

test('opens a file URL with the macOS/Linux default handler', async () => {
  for (const [platform, command] of [['darwin', 'open'], ['linux', 'xdg-open']]) {
    const calls = []
    const result = await openExternalUrl(
      { url: 'file:///C:/work/index.html' },
      { platform, spawn: fakeSpawn(calls) },
    )
    assert.equal(result.opened, true)
    assert.equal(calls[0].command, command)
    assert.deepEqual(calls[0].argv, ['file:///C:/work/index.html'])
  }
})

test('rejects unsupported protocols and malformed URLs without spawning', async () => {
  const calls = []
  await assert.rejects(
    () => openExternalUrl({ url: 'ftp://example.com/a' }, { spawn: fakeSpawn(calls) }),
    error => error.code === 'bad-request',
  )
  await assert.rejects(
    () => openExternalUrl({ url: 'not a url' }, { spawn: fakeSpawn(calls) }),
    error => error.code === 'bad-request',
  )
  assert.equal(calls.length, 0)
})

test('reports a spawn failure as open-external-failed', async () => {
  await assert.rejects(
    () => openExternalUrl({ url: 'https://example.com' }, { platform: 'win32', spawn: fakeSpawn([], { fail: true }) }),
    error => error.code === 'open-external-failed',
  )
})
