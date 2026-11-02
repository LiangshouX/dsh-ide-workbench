import test from 'node:test'
import assert from 'node:assert/strict'
import { openInIdeMenu } from '../src/client/ide-menu.js'
import { zh, en } from '../src/client/i18n.js'
import { WorkbenchStore } from '../src/client/store.js'

test('Open in IDE groups exactly three launch choices for the clicked file', () => {
  const calls = []
  const path = 'D:\\project with spaces\\中文 file.ts'
  const menu = openInIdeMenu({ t: key => zh[key], openInIde: (...args) => calls.push(args) }, path)
  assert.equal(menu.text, '在 IDE 中打开')
  assert.equal(menu.action, undefined)
  assert.deepEqual(menu.submenu.map(item => item.text), ['IntelliJ IDEA', 'WebStorm', 'Visual Studio Code'])
  for (const item of menu.submenu) item.action()
  assert.deepEqual(calls, [['idea', path], ['webstorm', path], ['vscode', path]])
  assert.equal(en['project.openInIde'], 'Open in IDE')
})

test('missing files and non-file menu contexts cannot launch an IDE', () => {
  const store = { t: key => key, openInIde: () => assert.fail('disabled menu must not launch') }
  for (const [path, disabled] of [[undefined, false], ['', false], ['/project/folder', true]]) {
    const menu = openInIdeMenu(store, path, disabled)
    assert.equal(menu.disabled, true)
    for (const item of menu.submenu) { assert.equal(item.disabled, true); item.action() }
  }
})

test('each IDE client request preserves its selected IDE, project and file', async () => {
  const previous = globalThis.fetch
  const store = new WorkbenchStore({}, key => key)
  store.state.root = 'D:\\selected-project'
  store.state.workspaceRoot = 'D:\\container'
  store.toast = () => {}
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) })
    return { ok: true, json: async () => ({ ok: true, value: { accepted: true } }) }
  }
  try {
    for (const ide of ['idea', 'webstorm', 'vscode']) await store.openInIde(ide, 'D:\\selected-project\\中文 file.ts')
    assert.deepEqual(calls.map(call => call.body), ['idea', 'webstorm', 'vscode'].map(ide => ({
      ide, root: 'D:\\selected-project', path: 'D:\\selected-project\\中文 file.ts',
    })))
    assert.ok(calls.every(call => call.url.endsWith('/fs.openInIde')))
  } finally { globalThis.fetch = previous }
})
