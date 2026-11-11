/**
 * R11 - "open in the default browser" has to open something.
 *
 * The old host resolved on the `spawn` event, so every open was reported as
 * a success - including the Windows `file:` case, where the URL protocol
 * handler starts happily and then does nothing, because `file:` has no
 * `open` verb on Windows. The user got no browser and no message.
 *
 * These cases pin the three things that changed:
 * - a Windows `file:` URL goes to the user's *registered* default browser,
 *   and falls back to the shell's file association when the registry says
 *   nothing;
 * - a launcher that reports a non-zero exit code is a failure, not a
 *   success;
 * - the target never travels through a command line, so a path with a
 *   space, an `&` or a `%` in it cannot become a second command.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import {
  filePathFromUrl,
  openExternalUrl,
  parseRegistryValue,
  parseShellCommandTemplate,
} from '../src/host/shell.js'

const USER_CHOICE = 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice'

/** One fake child process: closed streams and an exit code. */
function fakeChild({ code = 0, stdout = '', stderr = '' } = {}) {
  const child = new EventEmitter()
  child.stdout = Readable.from(stdout === '' ? [] : [stdout])
  child.stderr = Readable.from(stderr === '' ? [] : [stderr])
  child.unref = () => { child.unrefed = true }
  return child
}

/**
 * A `spawn` double that answers the registry queries and runs the launcher.
 * @param {Array<object>} calls every spawn is recorded in
 * @param {{registry?: Record<string, string>, code?: number, stderr?: string, fail?: boolean}} [options]
 */
function fakeSpawn(calls, { registry = {}, code = 0, stderr = '', fail = false } = {}) {
  return (command, argv, options) => {
    calls.push({ command, argv, options })
    if (command === 'reg.exe') {
      const answer = registry[argv[1]]
      const child = fakeChild({ code: answer === undefined ? 1 : 0, stdout: answer ?? '' })
      // The query ends with its pipes closed, so the output is complete.
      child.stdout.on('end', () => child.emit('close', answer === undefined ? 1 : 0))
      return child
    }
    const child = fakeChild({ code, stderr })
    setImmediate(() => {
      if (fail) child.emit('error', new Error('spawn failed'))
      else {
        child.emit('exit', code, null)
        child.emit('close', code, null)
      }
    })
    return child
  }
}

/** The registry answers of a machine whose default browser is Chrome. */
const CHROME_REGISTRY = {
  [USER_CHOICE]: [
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice',
    '    ProgId    REG_SZ    ChromeHTML',
    '',
  ].join('\r\n'),
  'HKCR\\ChromeHTML\\shell\\open\\command': [
    'HKEY_CLASSES_ROOT\\ChromeHTML\\shell\\open\\command',
    '    (Default)    REG_SZ    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --single-argument %1',
    '',
  ].join('\r\n'),
}

test('a Windows file URL opens in the registered default browser', async () => {
  const calls = []
  const result = await openExternalUrl(
    { url: 'file:///C:/work/index.html' },
    { platform: 'win32', spawn: fakeSpawn(calls, { registry: CHROME_REGISTRY }) },
  )
  assert.equal(result.opened, true)
  // The browser is asked for by name - not through the URL protocol handler,
  // which has no `open` verb for `file:` on Windows.
  assert.deepEqual(
    calls.filter(call => call.command === 'reg.exe').map(call => call.argv[1]),
    [USER_CHOICE, 'HKCR\\ChromeHTML\\shell\\open\\command'],
  )
  const launch = calls.find(call => call.command === 'powershell.exe')
  assert.ok(launch !== undefined, 'the desktop opens the browser')
  assert.deepEqual(launch.argv.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command'])
  assert.match(launch.argv[3], /Start-Process -FilePath \$env:IWB_OPEN_EXE/)
  assert.match(launch.argv[3], /-ArgumentList \$env:IWB_OPEN_ARG0,\$env:IWB_OPEN_ARG1/)
  assert.equal(launch.options.env.IWB_OPEN_EXE, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  assert.equal(launch.options.env.IWB_OPEN_ARG0, '--single-argument')
  // The template's `%1` slot carries the URL - the browser is told to open
  // exactly this document, once.
  assert.equal(launch.options.env.IWB_OPEN_ARG1, 'file:///C:/work/index.html')
  assert.equal(launch.options.shell, false)
  // Nothing of the document travels through the command line.
  assert.equal(launch.argv.join(' ').includes('index.html'), false)
})

test('a Windows file URL falls back to the shell file association', async () => {
  const calls = []
  const result = await openExternalUrl(
    { url: 'file:///C:/work/index.html' },
    { platform: 'win32', spawn: fakeSpawn(calls, { registry: {} }) },
  )
  assert.equal(result.opened, true)
  const launch = calls.find(call => call.command === 'powershell.exe')
  assert.ok(launch !== undefined)
  assert.match(launch.argv[3], /Start-Process -FilePath \$env:IWB_OPEN_TARGET/)
  // The path travels through the environment: a command line would have to
  // quote it, and a `%` in it would be expanded by the shell.
  assert.equal(launch.options.env.IWB_OPEN_TARGET, 'C:\\work\\index.html')
  assert.equal(launch.argv.join(' ').includes('index.html'), false, 'the path is not in the command line')
})

test('a path with spaces and an ampersand cannot become a second command', async () => {
  const calls = []
  await openExternalUrl(
    { url: 'file:///C:/Rock%20%26%20Roll/index.html' },
    { platform: 'win32', spawn: fakeSpawn(calls, { registry: {} }) },
  )
  const launch = calls.find(call => call.command === 'powershell.exe')
  assert.equal(launch.options.env.IWB_OPEN_TARGET, 'C:\\Rock & Roll\\index.html')
  // Nothing but the reference reaches the command line.
  assert.equal(launch.argv.some(argument => argument.includes('&')), false)
  assert.equal(launch.argv.some(argument => argument.includes('Roll')), false)
})

test('a launcher that fails is reported, not swallowed', async () => {
  const calls = []
  await assert.rejects(
    () => openExternalUrl(
      { url: 'file:///C:/work/index.html' },
      { platform: 'win32', spawn: fakeSpawn(calls, { registry: {}, code: 1, stderr: 'The system cannot find the file specified.' }) },
    ),
    error => error.code === 'open-external-failed'
      && /exited with code 1/.test(error.message)
      && /cannot find the file/.test(error.message),
  )
})

test('a launcher that cannot even start is reported', async () => {
  const calls = []
  await assert.rejects(
    () => openExternalUrl(
      { url: 'file:///C:/work/index.html' },
      { platform: 'win32', spawn: fakeSpawn(calls, { registry: {}, fail: true }) },
    ),
    error => error.code === 'open-external-failed' && /spawn failed/.test(error.message),
  )
})

test('a failing http open is reported too', async () => {
  const calls = []
  await assert.rejects(
    () => openExternalUrl(
      { url: 'https://example.com' },
      { platform: 'win32', spawn: fakeSpawn(calls, { code: 1 }) },
    ),
    error => error.code === 'open-external-failed' && /exited with code 1/.test(error.message),
  )
})

test('the http mechanism itself did not change', async () => {
  const calls = []
  await openExternalUrl(
    { url: 'https://example.com/a?b=1' },
    { platform: 'win32', spawn: fakeSpawn(calls) },
  )
  assert.equal(calls[0].command, 'rundll32.exe')
  assert.deepEqual(calls[0].argv, ['url.dll,FileProtocolHandler', 'https://example.com/a?b=1'])
})

test('the registry answers are read as values, not as lines', () => {
  const output = [
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice',
    '    ProgId    REG_SZ    ChromeHTML',
    '    Hash    REG_SZ    4EL0=',
    '',
  ].join('\r\n')
  assert.equal(parseRegistryValue(output, 'ProgId'), 'ChromeHTML')
  assert.equal(parseRegistryValue(output, 'progid'), 'ChromeHTML')
  assert.equal(parseRegistryValue(output, 'Hash'), '4EL0=')
  assert.equal(parseRegistryValue(output, 'Missing'), undefined)
  assert.equal(parseRegistryValue('', 'ProgId'), undefined)
})

test('a stored command is split into its program and its arguments', () => {
  const chrome = parseShellCommandTemplate('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --single-argument %1')
  assert.equal(chrome.exe, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  assert.deepEqual(chrome.args, ['--single-argument', '%1'])
  const firefox = parseShellCommandTemplate('"C:\\Program Files\\Mozilla Firefox\\firefox.exe" -osint -url %1')
  assert.deepEqual(firefox.args, ['-osint', '-url', '%1'])
  const plain = parseShellCommandTemplate('C:\\tools\\browser.exe')
  assert.equal(plain.exe, 'C:\\tools\\browser.exe')
  assert.deepEqual(plain.args, [])
  assert.equal(parseShellCommandTemplate('   '), undefined)
})

test('a file URL is turned into the path of the platform that opens it', () => {
  assert.equal(filePathFromUrl(new URL('file:///C:/work/index.html'), 'win32'), 'C:\\work\\index.html')
  assert.equal(filePathFromUrl(new URL('file:///C:/Rock%20%26%20Roll/index.html'), 'win32'), 'C:\\Rock & Roll\\index.html')
  assert.equal(filePathFromUrl(new URL('file://server/share/index.html'), 'win32'), '\\\\server\\share\\index.html')
  assert.equal(filePathFromUrl(new URL('file:///home/dev/index.html'), 'linux'), '/home/dev/index.html')
})
