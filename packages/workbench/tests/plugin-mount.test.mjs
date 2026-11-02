import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply, guardEmitter, inject, name } from '../src/index.js'
import { registry, claimFaultOwnership } from '../src/contract/fault-registry.js'

/**
 * The directory of the plugin's sources, in the form a stack trace prints.
 *
 * A stack trace prints the source as a `file://` URL with forward slashes,
 * so the path of the plugin is compared in that form.
 */
const SRC_DIR = `${dirname(dirname(fileURLToPath(import.meta.url))).split(sep).join('/')}/src`

/**
 * An error whose stack points into the plugin's own sources.
 * @param {string} message the message
 * @returns {Error} the error
 */
function ownFault(message) {
  const error = new Error(message)
  error.stack = `Error: ${message}\n    at #writeToServer (${SRC_DIR}/host/shell.js:52:9)`
  return error
}

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
  const services = new Map()
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    get: (service) => services.get(service),
    provide(service, value) {
      services.set(service, value)
      return () => services.delete(service)
    },
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
  return { ctx, routes, upgrades, disposers, effects, services }
}

test('the plugin declares the services it needs', () => {
  assert.equal(name, 'dsh-ide-workbench')
  assert.deepEqual(inject, ['webServer', 'connection', 'subprocess', 'workspaceRegistry'])
})

test('the plugin mounts its routes and its WebSocket upgrades', () => {
  const { ctx, routes, upgrades, disposers } = fakeContext()
  apply(ctx)
  const prefix = routes.filter(route => route.kind === 'prefix')
  assert.equal(prefix.length, 1)
  assert.equal(prefix[0].path, '/ide-workbench/api')
  // The terminal is the only socket of the core: the socket of the language
  // servers belongs to the plugin that runs them.
  const paths = upgrades.map(upgrade => upgrade.path).sort()
  assert.deepEqual(paths, ['/ide-workbench/ws/terminal'])
  for (const dispose of disposers) dispose()
})

test('every effect hands back a disposer Cordis accepts', () => {
  // Cordis rejects an effect whose callback returns a plain object with
  // "TypeError: Invalid effect" - the plugin then never activates.
  const { ctx, effects, disposers } = fakeContext()
  apply(ctx)
  for (const result of effects) {
    const ok = result === undefined || result === null || typeof result === 'function'
    assert.ok(ok, `an effect returned ${Object.prototype.toString.call(result)} instead of a disposer`)
  }
  for (const dispose of disposers) dispose()
})

test('the teardown disposes every mount', () => {
  const { ctx, disposers } = fakeContext()
  apply(ctx)
  assert.ok(disposers.length > 0)
  for (const dispose of disposers) dispose()
})

/**
 * Run one case with a recorder in place of the host's fail-loud handler.
 *
 * The test runner installs its own 'uncaughtException' handler and reports
 * an emitted error as a failure of the case, so it is taken away for the
 * duration and put back afterwards. The plugin takes the event over when it
 * mounts, and the recorder stands in for the handler of the host.
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

test('a fault of the plugin does not take the host down', () => {
  // The DSH host ends its process on an uncaught exception (its fail-loud
  // handler writes a diagnostic and calls process.exit(1)). A broken feature
  // of the plugin must cost the user that feature, not the whole IDE - so
  // the plugin claims the faults of its own sources and takes them away from
  // the host.
  withHostHandler((hostFailures) => {
    const { ctx, disposers } = fakeContext()
    try {
      apply(ctx)
      process.emit('uncaughtException', ownFault('write EPIPE'))
      assert.equal(hostFailures.length, 0, 'the host must not be asked to die for a fault of the plugin')
    } finally {
      for (const dispose of disposers) dispose()
    }
  })
})

test('a failure of the host itself is still the host\'s business', () => {
  // The boundary is narrow on purpose: a plugin that swallowed every
  // uncaught exception would turn the host's safety net into a no-op.
  withHostHandler((hostFailures) => {
    const { ctx, disposers } = fakeContext()
    try {
      apply(ctx)
      const foreign = new Error('the host broke')
      foreign.stack = 'Error: the host broke\n    at something (file:///nowhere/else/core.js:1:1)'
      process.emit('uncaughtException', foreign)
      assert.equal(hostFailures.length, 1, 'a failure that is not the plugin\'s must reach the host')
    } finally {
      for (const dispose of disposers) dispose()
    }
  })
})

test('the boundary leaves no listener behind when the plugin is torn down', () => {
  const before = process.listeners('uncaughtException').length
  const beforeRejections = process.listeners('unhandledRejection').length
  const { ctx, disposers } = fakeContext()
  apply(ctx)
  assert.ok(process.listeners('uncaughtException').length > 0)
  assert.ok(process.listeners('unhandledRejection').length > 0)
  for (const dispose of disposers) dispose()
  assert.equal(process.listeners('uncaughtException').length, before)
  assert.equal(process.listeners('unhandledRejection').length, beforeRejections)
})

test('the terminal socket and the WebSocket server survive an error', () => {
  // An 'error' event without a listener is an uncaught exception, and that
  // ends the DSH host process. The plugin's own sockets therefore carry a
  // listener: a terminal that cannot be opened must not take the IDE down.
  const { ctx } = fakeContext()
  const socket = new EventEmitter()
  guardEmitter(ctx, socket, 'test socket')
  assert.equal(socket.listenerCount('error'), 1)
  // The error is swallowed by the listener: nothing is thrown.
  socket.emit('error', new Error('the socket broke'))
})

test('the guard leaves an emitter without an error method alone', () => {
  const { ctx } = fakeContext()
  guardEmitter(ctx, null, 'nothing')
  guardEmitter(ctx, {}, 'nothing')
})

test('the core claims the faults of its own sources', () => {
  // The registry is the one of the contract: it is shared by every plugin of
  // the family through `Symbol.for`, so there is one attribution and one
  // error boundary in the process. The core claims the directory of its own
  // sources - and only that one.
  const { ctx, disposers } = fakeContext()
  try {
    apply(ctx)
    const owners = [...registry().owners.keys()]
    assert.ok(owners.includes(SRC_DIR), 'the core must claim the directory of its own sources')
    assert.equal(owners.length, 1, 'the core must not claim anything else')
  } finally {
    for (const dispose of disposers) dispose()
  }
  assert.equal([...registry().owners.keys()].includes(SRC_DIR), false, 'the claim goes away with the plugin')
})

test('the boundary of the process stays while another plugin claims a directory', () => {
  // There is ONE boundary in the process, and the plugin that mounted second
  // has no uninstaller of its own. The plugin that installed the boundary
  // therefore has to leave it alone as long as another plugin claims a
  // directory - otherwise the other plugin would lose its boundary, and a
  // fault of it would end the host.
  const before = process.listeners('uncaughtException')
  const beforeRejections = process.listeners('unhandledRejection')
  const releaseOther = claimFaultOwnership('D:/nowhere/else', () => {})
  try {
    const { ctx, disposers } = fakeContext()
    apply(ctx)
    const boundary = process.listeners('uncaughtException')[0]
    for (const dispose of disposers) dispose()
    assert.equal(
      process.listeners('uncaughtException').includes(boundary),
      true,
      'the boundary must stay while another plugin claims a directory',
    )
    assert.equal([...registry().owners.keys()].includes(SRC_DIR), false, 'the core released its own claim')
  } finally {
    releaseOther()
    // The boundary stayed installed on purpose: the test puts the process
    // back into the state it found it in.
    process.removeAllListeners('uncaughtException')
    for (const listener of before) process.on('uncaughtException', listener)
    process.removeAllListeners('unhandledRejection')
    for (const listener of beforeRejections) process.on('unhandledRejection', listener)
    registry().handler = null
    registry().previous = null
  }
})

test('a fault of another plugin is not the business of the core', () => {
  // Every plugin claims its own sources, so a fault of the other plugin is
  // contained by THAT plugin - and a fault that no plugin claims stays the
  // business of the host, with its fail-loud policy unchanged.
  withHostHandler((hostFailures) => {
    const { ctx, disposers } = fakeContext()
    try {
      apply(ctx)
      const foreign = new Error('the other plugin broke')
      foreign.stack = 'Error: the other plugin broke\n    at something (file:///nowhere/else/codeintel.js:1:1)'
      process.emit('uncaughtException', foreign)
      assert.equal(hostFailures.length, 1, 'the host decides what happens to a fault of nobody')
    } finally {
      for (const dispose of disposers) dispose()
    }
  })
})

test('the host handler receives the origin of the failure', () => {
  // Node's handlers take (error, origin), and the origin is
  // 'uncaughtException' or 'unhandledRejection'. The host may branch on it,
  // so the takeover has to hand it on unchanged.
  const runners = process.listeners('uncaughtException')
  const rejectionRunners = process.listeners('unhandledRejection')
  const origins = []
  process.removeAllListeners('uncaughtException')
  process.removeAllListeners('unhandledRejection')
  process.on('uncaughtException', (_error, origin) => { origins.push(origin) })
  // The handler of the host for the second event. The origin it receives is
  // the one the boundary hands on.
  process.on('unhandledRejection', (_reason, origin) => { origins.push(origin) })
  try {
    const { ctx, disposers } = fakeContext()
    try {
      apply(ctx)
      const foreign = new Error('the host broke')
      foreign.stack = 'Error: the host broke\n    at something (file:///nowhere/else/core.js:1:1)'
      process.emit('uncaughtException', foreign, 'uncaughtException')
      process.emit('unhandledRejection', foreign, 'unhandledRejection')
      assert.deepEqual(origins, ['uncaughtException', 'unhandledRejection'])
    } finally {
      for (const dispose of disposers) dispose()
    }
  } finally {
    process.removeAllListeners('uncaughtException')
    for (const listener of runners) process.on('uncaughtException', listener)
    process.removeAllListeners('unhandledRejection')
    for (const listener of rejectionRunners) process.on('unhandledRejection', listener)
  }
})

test('a handler installed after the takeover is taken over', () => {
  // The host installs its fail-loud handler while it boots, long before a
  // plugin is loaded - the takeover relies on that order. A handler that
  // appears later would be called by Node itself (the handler array is
  // copied before the handlers run) and would end the process even for a
  // fault of the plugin. The boundary adopts it instead.
  withHostHandler(() => {
    const { ctx, disposers } = fakeContext()
    try {
      apply(ctx)
      const seen = []
      const lateHandler = (_error, origin) => { seen.push(origin) }
      process.on('uncaughtException', lateHandler)

      process.emit('uncaughtException', ownFault('write EPIPE'), 'uncaughtException')
      assert.equal(
        process.listeners('uncaughtException').includes(lateHandler),
        false,
        'the late handler must not stay in the process',
      )

      // From now on the boundary calls it - with the origin.
      const foreign = new Error('the host broke')
      foreign.stack = 'Error: the host broke\n    at something (file:///nowhere/else/core.js:1:1)'
      process.emit('uncaughtException', foreign, 'uncaughtException')
      assert.ok(seen.includes('uncaughtException'), 'the late handler is called by the boundary')
    } finally {
      for (const dispose of disposers) dispose()
    }
  })
})
