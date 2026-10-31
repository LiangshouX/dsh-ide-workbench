import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, inject, name } from '../src/index.js'

/**
 * A Cordis-like context that records what the plugin mounts.
 *
 * `ctx.effect` runs the callback straight away (like an active fiber) and
 * keeps the disposer, so the test can check both the mount and the teardown.
 */
function fakeContext() {
  const routes = []
  const upgrades = []
  const disposers = []
  const effects = []
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    get: () => undefined,
    effect(execute) {
      const result = execute()
      // Cordis only accepts a disposer function (or nothing) here: an effect
      // that returns a plain object is rejected with "Invalid effect" and the
      // plugin then never activates.
      effects.push(result)
      if (typeof result === 'function') disposers.push(result)
      return () => {}
    },
    subprocess: {
      spawn() { throw new Error('the mount test must not start a process') },
    },
    connection: { requestRejection: () => undefined },
    workspaceRegistry: { list: () => [], create: async () => ({ id: 'x', path: 'C:\\', title: 'x' }) },
    webServer: {
      register(spec) { routes.push(spec); return () => {} },
      registerUpgrade(spec) { upgrades.push(spec); return () => {} },
    },
  }
  return { ctx, routes, upgrades, disposers, effects }
}

test('the plugin declares the services it needs', () => {
  assert.equal(name, 'dsh-ide-workbench')
  assert.deepEqual(inject, ['webServer', 'connection', 'subprocess', 'workspaceRegistry'])
})

test('the plugin mounts its routes and its WebSocket upgrades', () => {
  const { ctx, routes, upgrades } = fakeContext()
  apply(ctx)
  const prefix = routes.filter(route => route.kind === 'prefix')
  assert.equal(prefix.length, 1)
  assert.equal(prefix[0].path, '/ide-workbench/api')
  const paths = upgrades.map(upgrade => upgrade.path).sort()
  assert.deepEqual(paths, ['/ide-workbench/ws/lsp', '/ide-workbench/ws/terminal'])
})

test('every effect hands back a disposer Cordis accepts', () => {
  // Cordis rejects an effect whose callback returns a plain object with
  // "TypeError: Invalid effect" - the plugin then never activates.
  const { ctx, effects } = fakeContext()
  apply(ctx)
  for (const result of effects) {
    const ok = result === undefined || result === null || typeof result === 'function'
    assert.ok(ok, `an effect returned ${Object.prototype.toString.call(result)} instead of a disposer`)
  }
})

test('the teardown disposes every mount', () => {
  const { ctx, disposers } = fakeContext()
  apply(ctx)
  assert.ok(disposers.length > 0)
  for (const dispose of disposers) dispose()
})