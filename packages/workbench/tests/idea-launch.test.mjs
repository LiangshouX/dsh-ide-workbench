import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openInIdea, resolveIdeaExecutable, openInIde, resolveIdeExecutable } from '../src/host/idea.js'
import { DEFAULT_SETTINGS, SettingsStore } from '../src/host/settings-store.js'

const missing = async () => { throw new Error('missing') }
const file = { isFile: () => true }
const access = async () => {}

test('Windows resolves native IDEA from PATH and rejects batch launchers', async () => {
  const executable = 'C:\\IDEA With Spaces\\bin\\idea64.exe'
  const stat = async path => path === executable ? file : missing()
  assert.equal(await resolveIdeaExecutable('', {
    platform: 'win32', env: { Path: 'relative;"C:\\IDEA With Spaces\\bin"' }, stat, access, readdir: missing,
  }), executable)
  await assert.rejects(() => resolveIdeaExecutable('C:\\Toolbox\\idea.cmd', {
    platform: 'win32', stat: async () => file, access,
  }), error => error.code === 'idea-unavailable')
})

test('Windows auto-detects Program Files installations and prefers newer versions', async () => {
  const expected = 'C:\\Program Files\\JetBrains\\IntelliJ IDEA 2025.2\\bin\\idea64.exe'
  const entries = ['IntelliJ IDEA 2022.1.4', 'IntelliJ IDEA 2025.2', 'WebStorm 2025.2']
    .map(name => ({ name, isDirectory: () => true }))
  assert.equal(await resolveIdeaExecutable('', {
    platform: 'win32', env: { ProgramFiles: 'C:\\Program Files', PATH: 'C:\\Toolbox' },
    stat: async path => /IntelliJ IDEA.*idea64\.exe$/.test(path) ? file : missing(),
    access, readdir: async path => path === 'C:\\Program Files\\JetBrains' ? entries : [],
  }), expected)
})

test('an invalid configured launcher reports an error instead of falling back', async () => {
  await assert.rejects(() => resolveIdeaExecutable('C:\\missing\\idea64.exe', {
    platform: 'win32', env: { PATH: 'C:\\valid' }, stat: async path => path === 'C:\\valid\\idea64.exe' ? file : missing(), access,
  }), error => error.code === 'idea-unavailable')
  await assert.rejects(() => resolveIdeaExecutable('', {
    platform: 'linux', env: {}, stat: missing, access,
  }), error => error.code === 'idea-unavailable')
})

test('macOS accepts an app bundle and Linux resolves an executable launcher', async () => {
  assert.equal(await resolveIdeaExecutable('/Applications/IntelliJ IDEA.app', {
    platform: 'darwin', stat: async () => file, access,
  }), '/Applications/IntelliJ IDEA.app/Contents/MacOS/idea')
  assert.equal(await resolveIdeaExecutable('', {
    platform: 'linux', env: { PATH: '.:/usr/local/bin' },
    stat: async path => path === '/usr/local/bin/idea' ? file : missing(), access,
  }), '/usr/local/bin/idea')
})

async function fixture(t) {
  const outer = await mkdtemp(join(tmpdir(), 'iwb-idea-'))
  t.after(() => rm(outer, { recursive: true, force: true }))
  const project = join(outer, '项目 with spaces')
  await mkdir(project)
  const selected = join(project, '中文 file & value.ts')
  await writeFile(selected, 'export const value = 1\n')
  return { outer, project, selected }
}

function spawnFixture(calls, error) {
  return (executable, argv, options) => {
    const child = new EventEmitter()
    child.unref = () => calls.push({ unref: true })
    calls.push({ executable, argv, options })
    queueMicrotask(() => child.emit(error ? 'error' : 'spawn', error))
    return child
  }
}

test('launch keeps the selected project and Unicode file as separate argv without a shell', async t => {
  const { project, selected } = await fixture(t)
  const calls = []
  const result = await openInIdea({ root: project, path: selected }, 'custom', {
    resolveExecutable: async configured => { assert.equal(configured, 'custom'); return 'IDEA executable' },
    spawn: spawnFixture(calls),
  })
  assert.deepEqual(calls[0], {
    executable: 'IDEA executable', argv: [await realpath(project), await realpath(selected)],
    options: { cwd: await realpath(project), detached: true, stdio: 'ignore', shell: false, windowsHide: false },
  })
  assert.equal(calls[1].unref, true)
  assert.equal(result.accepted, true)
  assert.equal(result.path, await realpath(selected))
})

test('launch errors reach the caller', async t => {
  const { project, selected } = await fixture(t)
  await assert.rejects(() => openInIdea({ root: project, path: selected }, '', {
    resolveExecutable: async () => 'missing executable', spawn: spawnFixture([], new Error('ENOENT')),
  }), error => error.code === 'idea-launch-failed' && error.message.includes('ENOENT'))
})

test('outside, missing and directory paths are rejected before launching', async t => {
  const { outer, project } = await fixture(t)
  const outside = join(outer, 'outside.txt')
  await writeFile(outside, 'outside')
  const options = { resolveExecutable: () => assert.fail('must not reach launcher resolution') }
  for (const path of [outside, '../outside.txt', 'missing.txt', project]) {
    await assert.rejects(() => openInIdea({ root: project, path }, '', options))
  }
})

test('a symlink or junction escaping the project is rejected before launching', async t => {
  const { outer, project } = await fixture(t)
  const external = join(outer, 'external')
  await mkdir(external)
  await writeFile(join(external, 'secret.txt'), 'outside')
  const linked = join(project, 'linked')
  await symlink(external, linked, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(() => openInIdea({ root: project, path: join(linked, 'secret.txt') }, '', {
    resolveExecutable: () => assert.fail('outside links must not launch'),
  }), error => error.code === 'forbidden')
})

test('all IDE settings default to auto-detection and reject malformed path patches', async () => {
  for (const ide of ['idea', 'webstorm', 'vscode']) {
    assert.deepEqual(DEFAULT_SETTINGS[ide], { path: '' })
    for (const config of [null, { path: 42 }, { path: 'invalid\0path' }]) {
      await assert.rejects(() => new SettingsStore().update({ [ide]: config }), error => error.code === 'bad-request')
    }
  }
})

for (const ide of ['webstorm', 'vscode']) {
  test(`${ide} opens the selected project and file with its own CLI arguments`, async t => {
    const { project, selected } = await fixture(t)
    const calls = []
    const result = await openInIde({ ide, root: project, path: selected }, 'configured', {
      resolveExecutable: async configured => { assert.equal(configured, 'configured'); return `${ide}.exe` },
      spawn: spawnFixture(calls),
    })
    const root = await realpath(project)
    const file = await realpath(selected)
    assert.deepEqual(calls[0].argv, ide === 'vscode' ? ['--new-window', root, '--goto', file] : [root, file])
    assert.equal(calls[0].options.shell, false)
    assert.equal(result.ide, ide)
    assert.equal(result.accepted, true)
  })
}

test('WebStorm is discovered in JetBrains installations and VS Code in user installations', async () => {
  const webstorm = 'C:\\Program Files\\JetBrains\\WebStorm 2025.2\\bin\\webstorm64.exe'
  assert.equal(await resolveIdeExecutable('webstorm', '', {
    platform: 'win32', env: {}, access,
    stat: async path => path === webstorm ? file : missing(),
    readdir: async () => [{ name: 'WebStorm 2025.2', isDirectory: () => true }],
  }), webstorm)
  const vscode = 'C:\\Users\\user\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe'
  assert.equal(await resolveIdeExecutable('vscode', '', {
    platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\user\\AppData\\Local' }, access,
    stat: async path => path === vscode ? file : missing(),
  }), vscode)
})

test('new IDE choices support macOS bundles and Linux launchers', async () => {
  for (const [ide, app, binary] of [['webstorm', 'WebStorm', 'webstorm'], ['vscode', 'Visual Studio Code', 'Electron']]) {
    assert.equal(await resolveIdeExecutable(ide, `/Applications/${app}.app`, {
      platform: 'darwin', stat: async () => file, access,
    }), `/Applications/${app}.app/Contents/MacOS/${binary}`)
    const name = ide === 'vscode' ? 'code' : 'webstorm'
    assert.equal(await resolveIdeExecutable(ide, '', {
      platform: 'linux', env: { PATH: '/usr/local/bin' }, stat: async () => file, access,
    }), `/usr/local/bin/${name}`)
  }
})

test('unsupported IDE values are rejected before resolving or spawning', async () => {
  for (const ide of ['unknown', '__proto__', 'constructor']) {
    await assert.rejects(() => openInIde({ ide }, '', {
      resolveExecutable: () => assert.fail('unsupported IDE must not resolve a launcher'),
    }), error => error.code === 'bad-request')
  }
})
