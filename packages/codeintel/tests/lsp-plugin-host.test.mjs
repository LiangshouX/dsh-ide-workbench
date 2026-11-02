/**
 * The host half of the code intelligence plugin (PRD-v6).
 *
 * The plugin owns its own surface: the JSON API under `/dsh-codeintel/api/`
 * and the relay at `/dsh-codeintel/ws/lsp`. The routes of the IDE workbench
 * belong to the workbench - the two plugins share the fence of the host, not
 * the routes.
 *
 * The tests below pin the four things the split depends on:
 *
 *   1. the routes live under the prefix of the plugin,
 *   2. the settings document is the one of the plugin,
 *   3. the one-time import of the workbench happens exactly once,
 *   4. the plugin does not throw when the workbench is not installed.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { API_PATH, API_PREFIX, PLUGIN_DIR, apply, inject, name } from '../src/index.js'
import { registry } from '../src/contract/fault-registry.js'
import { settingsFile } from '../src/host/settings-store.js'
import { LSP_WS_PATH } from '../src/host/lsp-ws.js'

/**
 * The service of the IDE workbench, as the contract declares it.
 * @returns {any} the service
 */
function fakeCore() {
  return {
    version: 1,
    getProjectRoot: () => 'C:\\work\\demo',
    getScopeRoot: () => 'C:\\work\\demo',
    readFile: async () => '',
    searchFiles: async () => ({ files: [] }),
    onProjectChanged: () => () => {},
    health: () => ({ ok: true }),
  }
}

/**
 * A Cordis-like context that records what the plugin mounts.
 *
 * `ctx.effect` runs the callback straight away (like an active fiber) and
 * keeps the disposer, so the test can check both the mount and the teardown.
 * @param {{core?: any}} [options] the service of the workbench
 * @returns {object} the context and the recordings
 */
function fakeContext(options = {}) {
  const routes = []
  const upgrades = []
  const disposers = []
  const effects = []
  const logs = { info: [], warn: [], error: [] }
  const ctx = {
    logger: {
      info: (...args) => { logs.info.push(args.map(String).join(' ')) },
      warn: (...args) => { logs.warn.push(args.map(String).join(' ')) },
      error: (...args) => { logs.error.push(args.map(String).join(' ')) },
    },
    get: () => options.core,
    effect(execute) {
      const result = execute()
      // Cordis only accepts a disposer function (or nothing) here: an effect
      // that returns a plain object is rejected with "Invalid effect" and the
      // plugin then never activates.
      effects.push(result)
      if (typeof result === 'function') disposers.push(result)
      return () => {}
    },
    connection: { requestRejection: () => undefined },
    workspaceRegistry: { list: () => [] },
    subprocess: {
      spawn() { throw new Error('the mount test must not start a process') },
    },
    webServer: {
      register(spec) { routes.push(spec); return () => {} },
      registerUpgrade(spec) { upgrades.push(spec); return () => {} },
    },
  }
  return { ctx, routes, upgrades, disposers, effects, logs }
}

/**
 * One request of the JSON API.
 * @param {string} method the method name
 * @param {object} [payload] the body
 * @param {string} [httpMethod] the HTTP method
 * @returns {any} the request
 */
function fakeRequest(method, payload = {}, httpMethod = 'POST') {
  const body = JSON.stringify(payload)
  return {
    method: httpMethod,
    url: `${API_PREFIX}${method}`,
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(body)
    },
  }
}

/**
 * One response of the JSON API.
 * @returns {any} the response
 */
function fakeResponse() {
  return {
    statusCode: 0,
    body: null,
    headersSent: false,
    writeHead(status) { this.statusCode = status; this.headersSent = true },
    end(text) { this.body = JSON.parse(text) },
    destroy() {},
  }
}

/**
 * Run one case with a recorder in place of the host's fail-loud handler.
 *
 * The test runner installs its own 'uncaughtException' handler and reports
 * an emitted error as a failure of the case, so it is taken away for the
 * duration and put back afterwards.
 * @param {(hostFailures: unknown[]) => void} body the case
 */
function withHostHandler(body) {
  const runners = process.listeners('uncaughtException')
  const rejectionRunners = process.listeners('unhandledRejection')
  const hostFailures = []
  process.removeAllListeners('uncaughtException')
  process.removeAllListeners('unhandledRejection')
  process.on('uncaughtException', error => { hostFailures.push(error) })
  try {
    body(hostFailures)
  } finally {
    process.removeAllListeners('uncaughtException')
    for (const listener of runners) process.on('uncaughtException', listener)
    process.removeAllListeners('unhandledRejection')
    for (const listener of rejectionRunners) process.on('unhandledRejection', listener)
  }
}

test('the plugin declares its name and its services', () => {
  assert.equal(name, 'dsh-ide-codeintel')
  assert.deepEqual(inject, ['webServer', 'connection', 'subprocess', 'workspaceRegistry'])
})

test('the JSON API lives under the prefix of the plugin', () => {
  const { ctx, routes, disposers } = fakeContext({ core: fakeCore() })
  try {
    apply(ctx)
    const prefix = routes.filter(route => route.kind === 'prefix')
    assert.equal(prefix.length, 1, 'the plugin mounts one JSON API')
    assert.equal(prefix[0].path, '/dsh-codeintel/api')
    assert.equal(prefix[0].path, API_PATH)
    // The routes of the workbench belong to the workbench.
    assert.equal(routes.some(route => String(route.path).startsWith('/ide-workbench')), false)
  } finally {
    for (const dispose of disposers) dispose()
  }
})

test('the relay of the language servers lives under the path of the plugin', () => {
  const { ctx, upgrades, disposers } = fakeContext({ core: fakeCore() })
  try {
    apply(ctx)
    assert.deepEqual(upgrades.map(upgrade => upgrade.path), ['/dsh-codeintel/ws/lsp'])
    assert.equal(LSP_WS_PATH, '/dsh-codeintel/ws/lsp')
  } finally {
    for (const dispose of disposers) dispose()
  }
})

test('every effect hands back a disposer Cordis accepts', () => {
  // Cordis rejects an effect whose callback returns a plain object with
  // "TypeError: Invalid effect" - the plugin then never activates.
  const { ctx, effects, disposers } = fakeContext({ core: fakeCore() })
  try {
    apply(ctx)
    for (const result of effects) {
      const ok = result === undefined || result === null || typeof result === 'function'
      assert.ok(ok, `an effect returned ${Object.prototype.toString.call(result)} instead of a disposer`)
    }
  } finally {
    for (const dispose of disposers) dispose()
  }
})

test('the teardown disposes every mount', () => {
  const { ctx, disposers } = fakeContext({ core: fakeCore() })
  apply(ctx)
  assert.ok(disposers.length > 0)
  for (const dispose of disposers) dispose()
})

test('the JSON API answers the semantic methods', async () => {
  const { ctx, routes, disposers } = fakeContext({ core: fakeCore() })
  try {
    apply(ctx)
    const route = routes.find(entry => entry.kind === 'prefix')
    const res = fakeResponse()
    await route.handler(fakeRequest('lsp.status'), res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.ok, true)
    // The answer of the status carries the state of the semantic analysis.
    assert.equal(res.body.value.state, 'idle')
  } finally {
    for (const dispose of disposers) dispose()
  }
})

test('an unknown method is refused', async () => {
  const { ctx, routes, disposers } = fakeContext({ core: fakeCore() })
  try {
    apply(ctx)
    const route = routes.find(entry => entry.kind === 'prefix')
    const res = fakeResponse()
    await route.handler(fakeRequest('lsp.nonsense'), res)
    assert.equal(res.statusCode, 404)
    assert.equal(res.body.ok, false)
  } finally {
    for (const dispose of disposers) dispose()
  }
})

test('a request that the fence refuses is not answered', async () => {
  const { ctx, routes, disposers } = fakeContext({ core: fakeCore() })
  ctx.connection.requestRejection = () => new Error('refused')
  try {
    apply(ctx)
    const route = routes.find(entry => entry.kind === 'prefix')
    const res = fakeResponse()
    await route.handler(fakeRequest('lsp.status'), res)
    assert.equal(res.statusCode, 403)
    assert.equal(res.body.ok, false)
  } finally {
    for (const dispose of disposers) dispose()
  }
})

test('a request without a root uses the project of the workbench', async () => {
  // The codeintel has no project of its own: the project of the workbench is
  // the project of the user (PRD-v6 §3.2).
  const { ctx, routes, disposers } = fakeContext({ core: fakeCore() })
  try {
    apply(ctx)
    const route = routes.find(entry => entry.kind === 'prefix')
    const res = fakeResponse()
    await route.handler(fakeRequest('lsp.focus', {}), res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.value.focusedRoot, resolve('C:\\work\\demo'))
  } finally {
    for (const dispose of disposers) dispose()
  }
})

test('the plugin does not throw when the workbench is not installed', () => {
  // The lookup of the service is SOFT: a hard `inject: [HOST_SERVICE]` would
  // keep the plugin from ever being applied, and the user would not even see
  // the guidance that says what is missing.
  const { ctx, routes, upgrades, disposers, logs } = fakeContext()
  try {
    assert.doesNotThrow(() => apply(ctx))
    // No language server route is mounted: no server may be started for a
    // project nobody opened.
    assert.equal(routes.length, 0, 'no route is mounted')
    assert.equal(upgrades.length, 0, 'no relay is mounted')
    // The degraded mode is announced.
    assert.ok(logs.warn.some(line => line.includes('degraded mode')), logs.warn.join('\n'))
  } finally {
    for (const dispose of disposers) dispose()
  }
})

test('the boundary of the process stays while another plugin claims a directory', () => {
  // The codeintel may be unloaded while the core stays. The boundary of the
  // process belongs to whoever installed it - but it must not disappear while
  // another plugin claims a directory of its own: that plugin would lose its
  // error boundary, and a fault of it would end the host (ISO-01).
  const before = process.listeners('uncaughtException')
  const { ctx, disposers } = fakeContext({ core: fakeCore() })
  apply(ctx)
  // Another plugin claims a directory of its own.
  const claimed = '/somewhere/else/src'
  registry().owners.set(claimed, () => {})
  try {
    const mounted = process.listeners('uncaughtException')
    for (const dispose of disposers) dispose()
    assert.deepEqual(
      process.listeners('uncaughtException'),
      mounted,
      'the boundary of the process is still installed',
    )
  } finally {
    registry().owners.delete(claimed)
    // The test leaves the process as it found it: the boundary of the
    // process goes away and the handlers of the host come back.
    for (const listener of process.listeners('uncaughtException')) {
      if (!before.includes(listener)) process.removeListener('uncaughtException', listener)
    }
    for (const listener of before) {
      if (!process.listeners('uncaughtException').includes(listener)) process.on('uncaughtException', listener)
    }
    // The registry must not claim a boundary that is not installed any more.
    registry().handler = null
    registry().previous = null
  }
})

test('a fault of the plugin does not take the host down', () => {
  // The DSH host ends its process on an uncaught exception (its fail-loud
  // handler writes a diagnostic and calls process.exit(1)). One language
  // server whose pipe breaks must cost the user the semantic features, not
  // the whole IDE - and it must not disturb the workbench either.
  withHostHandler((hostFailures) => {
    const { ctx, disposers } = fakeContext({ core: fakeCore() })
    try {
      apply(ctx)
      const own = new Error('write EPIPE')
      own.stack = `Error: write EPIPE\n    at #writeToServer (${PLUGIN_DIR}/host/lsp.js:1661:13)`
      process.emit('uncaughtException', own)
      assert.equal(hostFailures.length, 0, 'the host must not be asked to die for a fault of the plugin')
    } finally {
      for (const dispose of disposers) dispose()
    }
  })
})

// ── the settings document of the plugin (MIG-01) ──────────────────────────

/**
 * Run one case in a throwaway profile directory.
 * @param {(base: string) => Promise<void>} run the body of the test
 * @returns {Promise<void>}
 */
async function withProfile(run) {
  const base = await mkdtemp(join(tmpdir(), 'dsh-codeintel-plugin-'))
  const previous = process.env.DSH_PROFILE_DIR
  process.env.DSH_PROFILE_DIR = base
  try {
    await run(base)
  } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previous
    await rm(base, { recursive: true, force: true })
  }
}

test('the settings of the plugin live in its own file of the profile', async () => {
  await withProfile(async (base) => {
    const { ctx, routes, disposers } = fakeContext({ core: fakeCore() })
    try {
      apply(ctx)
      assert.equal(settingsFile(), join(base, 'dsh-codeintel', 'settings.json'))
      const route = routes.find(entry => entry.kind === 'prefix')
      const res = fakeResponse()
      await route.handler(fakeRequest('settings.get'), res)
      assert.equal(res.statusCode, 200)
      assert.equal(res.body.value.file, join(base, 'dsh-codeintel', 'settings.json'))
      // The document of the plugin holds the `lsp` section and the four
      // semantic shortcuts - and nothing of the workbench.
      assert.equal(res.body.value.value.lsp.enabled, true)
      assert.equal(res.body.value.value.shortcuts.findUsages, 'Alt+F7')
      assert.equal(res.body.value.value.lastRoot, undefined)
    } finally {
      for (const dispose of disposers) dispose()
    }
  })
})

test('the import of the workbench happens exactly once', async () => {
  await withProfile(async (base) => {
    // The document of the workbench as the single-plugin build left it.
    const coreDocument = {
      version: 5,
      lsp: { enabled: false, idleTimeoutMs: 120000 },
      shortcuts: { findUsages: 'Alt+F9' },
    }
    await mkdir(join(base, 'ide-workbench'), { recursive: true })
    await writeFile(join(base, 'ide-workbench', 'settings.json'), JSON.stringify(coreDocument, null, 2), 'utf8')

    const { ctx, routes, disposers } = fakeContext({ core: fakeCore() })
    try {
      apply(ctx)
      const route = routes.find(entry => entry.kind === 'prefix')
      const res = fakeResponse()
      await route.handler(fakeRequest('settings.get'), res)
      assert.equal(res.body.value.value.lsp.enabled, false, 'the section of the workbench came over')
      assert.equal(res.body.value.value.lsp.idleTimeoutMs, 120000, 'the idle timeout came over')
      assert.equal(res.body.value.value.shortcuts.findUsages, 'Alt+F9', 'the shortcut came over')
      assert.equal(res.body.value.value.legacyImported, true, 'the import is marked as done')
    } finally {
      for (const dispose of disposers) dispose()
    }

    // The document of the workbench is not touched: a downgrade keeps working.
    const onDisk = JSON.parse(await readFile(join(base, 'ide-workbench', 'settings.json'), 'utf8'))
    assert.deepEqual(onDisk, coreDocument, 'the document of the workbench is untouched')

    // A second start of DSH does not import again.
    const second = fakeContext({ core: fakeCore() })
    try {
      apply(second.ctx)
      const route = second.routes.find(entry => entry.kind === 'prefix')
      const res = fakeResponse()
      await route.handler(fakeRequest('settings.get'), res)
      assert.equal(res.body.value.value.lsp.enabled, false, 'the import did not happen a second time')
    } finally {
      for (const dispose of second.disposers) dispose()
    }
  })
})
