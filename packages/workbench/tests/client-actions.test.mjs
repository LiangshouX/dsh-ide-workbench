import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkbenchStore } from '../src/client/store.js'

const t = key => key

test('fullscreen targets the IDE pane without calling browser fullscreen APIs', () => {
  const element = { marker: 'IDE fullscreen button' }
  const target = { sessionId: 'session-1', paneId: 'ide-pane' }
  const calls = []
  const previous = globalThis.document
  globalThis.document = {
    documentElement: { requestFullscreen: () => assert.fail('browser fullscreen was requested') },
    exitFullscreen: () => assert.fail('browser fullscreen was exited'),
  }
  try {
    const store = new WorkbenchStore({ sidebarRight: {
      commandTarget: node => { assert.equal(node, element); return target },
      toggleFullscreen: captured => calls.push(captured),
    } }, t)
    assert.equal(store.toggleFullscreen(element), true)
    assert.equal(store.toggleFullscreen(element), true)
    assert.deepEqual(calls, [target, target])
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
})

test('fullscreen without a current pane does not fall back to whole-page fullscreen', () => {
  const store = new WorkbenchStore({ sidebarRight: {
    commandTarget: () => undefined,
    toggleFullscreen: () => assert.fail('missing pane must not be toggled'),
  } }, t)
  assert.equal(store.toggleFullscreen(), false)
  assert.equal(new WorkbenchStore({}, t).toggleFullscreen(), false)
})

test('IDEA request uses the selected IDE project and the exact clicked file', async () => {
  const store = new WorkbenchStore({}, t)
  store.state.workspaceRoot = 'D:\\workspace'
  store.state.root = 'D:\\workspace\\project with spaces'
  const path = 'D:\\workspace\\project with spaces\\src\\中文 file.ts'
  const toasts = []
  store.toast = (...args) => toasts.push(args)
  const previous = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) })
    return { ok: true, json: async () => ({ ok: true, value: { accepted: true } }) }
  }
  try {
    assert.deepEqual(await store.openInIdea(path), { accepted: true })
    assert.equal(requests.length, 1)
    assert.match(requests[0].url, /\/ide-workbench\/api\/fs\.openInIde$/)
    assert.deepEqual(requests[0].body, { ide: 'idea', root: store.state.root, path })
    assert.deepEqual(toasts[0], ['success', 'project.ideRequested'])
  } finally {
    globalThis.fetch = previous
  }
})

test('IDEA launch errors are shown to the user without reporting success', async () => {
  const store = new WorkbenchStore({}, t)
  const toasts = []
  store.toast = (...args) => toasts.push(args)
  const previous = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    json: async () => ({ ok: false, error: { code: 'idea-not-found', message: 'IDEA executable not found' } }),
  })
  try {
    assert.equal(await store.openInIdea('/workspace/a.ts'), undefined)
    assert.deepEqual(toasts, [['error', 'project.ideFailed', 'IDEA executable not found']])
  } finally {
    globalThis.fetch = previous
  }
})
