/**
 * The contract test of the fault isolation (PRD-v6 §6, acceptance I1/I2/I3).
 *
 * The contract is inlined into BOTH plugins, so each of them carries its own
 * copy of `packages/contract/src/fault-registry.js`. Two copies of a module
 * variable are two variables - and two `uncaughtException` handlers would
 * hand the same error on twice (core -> codeintel -> host). The registry
 * therefore lives behind `Symbol.for` + `globalThis`, which is unique per
 * process across every copy of the module.
 *
 * This test therefore loads the module TWICE - once from its file, once from
 * a `data:` URL - and proves that the two copies share ONE registry and ONE
 * boundary:
 *
 *   - I1: an error is handed to the owner whose directory its stack hits;
 *   - I2: an error that nobody claims belongs to the host (the fail-loud
 *         policy of the DSH host must survive);
 *   - I3: `installFaultBoundary` is idempotent - a second copy of the module
 *         must NOT install a second handler.
 *
 * The handler behaviour is exercised against a stand-in for `process`, so the
 * test never takes the real host handlers over and never breaks the other
 * tests of the run.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as copyA from '../packages/contract/src/fault-registry.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const sourcePath = resolve(root, 'packages', 'contract', 'src', 'fault-registry.js')

/**
 * The second copy of the module: the same source, but a different module
 * instance (a `data:` URL is a different specifier, so Node evaluates the
 * source again). This is exactly what `scripts/sync-contract.mjs` produces
 * when it inlines the contract into the second plugin.
 * @returns {Promise<any>} the module namespace of the second copy
 */
async function loadSecondCopy() {
  const source = await readFile(sourcePath, 'utf8')
  const url = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`
  return import(url)
}

const copyB = await loadSecondCopy()

/** The global key of the one registry of the process. */
const REGISTRY_KEY = Symbol.for('dsh.ide-workbench.fault-registry')

/**
 * A directory that no real stack of this test file contains, so a match can
 * only come from the stack this helper builds.
 */
const OWNER_DIR = 'D:/dsh-contract-test/owner-core'
/** A second owner directory, used for the "nobody claims it" case. */
const OTHER_DIR = 'D:/dsh-contract-test/owner-other'

/**
 * An error whose stack pretends to come from `dir`.
 *
 * The registry decides by the stack, so the stack is what the test controls.
 * @param {string} dir the directory the error appears to come from
 * @param {string} [message] the message of the error
 * @returns {Error} the error
 */
function makeErrorIn(dir, message = 'boom') {
  const error = new Error(message)
  error.stack = `Error: ${message}\n    at handler (${dir}/host/index.js:10:5)`
  return error
}

/**
 * A stand-in for `process` that records the listeners of the events.
 *
 * The boundary takes the event over (`removeAllListeners` + `on`); doing
 * that on the real process of the test runner would unhook the runner's own
 * handlers. The stand-in keeps the real process untouched.
 * @returns {any} the fake process
 */
function makeFakeProcess() {
  const events = new Map()
  const fake = {
    /**
     * The listeners of one event.
     * @param {string} event the event
     * @returns {Function[]} the listeners
     */
    listeners (event) {
      return [...(events.get(event) ?? [])]
    },
    /**
     * Add a listener.
     * @param {string} event the event
     * @param {Function} listener the listener
     * @returns {any} the fake process
     */
    on (event, listener) {
      const list = events.get(event) ?? []
      list.push(listener)
      events.set(event, list)
      return fake
    },
    /**
     * Drop every listener of an event.
     * @param {string} event the event
     * @returns {any} the fake process
     */
    removeAllListeners (event) {
      events.set(event, [])
      return fake
    },
    /**
     * Drop one listener of an event.
     * @param {string} event the event
     * @param {Function} listener the listener
     * @returns {any} the fake process
     */
    removeListener (event, listener) {
      const list = events.get(event) ?? []
      const index = list.indexOf(listener)
      if (index >= 0) list.splice(index, 1)
      events.set(event, list)
      return fake
    },
  }
  return fake
}

/**
 * Run `body` with the global `process` replaced by the fake.
 *
 * The window is strictly synchronous: no `await` inside it, so no other
 * task of the test runner can observe the swapped global.
 * @param {any} fake the fake process
 * @param {() => any} body the code to run
 * @returns {any} the result of the body
 */
function withFakeProcess (fake, body) {
  const original = globalThis.process
  globalThis.process = fake
  try {
    return body()
  } finally {
    globalThis.process = original
  }
}

/**
 * A cordis-like context with a logger that swallows everything.
 * @returns {any} the context
 */
function makeCtx () {
  return {
    logger: {
      /** @param {...any} _args the log arguments */
      warn (..._args) {},
      /** @param {...any} _args the log arguments */
      error (..._args) {},
    },
  }
}

test('the two copies of the module share one registry', () => {
  assert.notEqual(copyA, copyB, 'the two imports must be two module instances')
  assert.equal(copyA.registry(), copyB.registry(), 'both copies must see the same registry')
  assert.equal(globalThis[REGISTRY_KEY], copyA.registry(), 'the registry must live on globalThis')
  assert.equal(typeof globalThis[REGISTRY_KEY].owners, 'object')
})

test('a claim made in one copy is seen by the other copy', () => {
  const seen = []
  const onFault = (error) => { seen.push(error) }
  const undo = copyB.claimFaultOwnership(OWNER_DIR, onFault)
  try {
    const error = makeErrorIn(OWNER_DIR)
    const claimed = copyA.ownerOf(error)
    assert.ok(claimed, 'the owner of the other copy must be found')
    assert.equal(claimed.dir, OWNER_DIR)
    assert.equal(claimed.owner, onFault)
    claimed.owner(error)
    assert.deepEqual(seen, [error])
  } finally {
    undo()
  }
})

test('an error that nobody claims belongs to nobody', () => {
  assert.equal(copyA.ownerOf(makeErrorIn(OTHER_DIR)), null)
  assert.equal(copyB.ownerOf(makeErrorIn(OTHER_DIR)), null)
  assert.equal(copyA.ownerOf(null), null)
  assert.equal(copyA.ownerOf('not an error'), null)
})

test('the ownership survives the Windows path form', () => {
  // The stack of an error prints a `file://` URL, so the comparison has to
  // work with forward slashes on every platform.
  const windowsDir = 'D:\\dsh-contract-test\\owner-windows'
  const undo = copyA.claimFaultOwnership(windowsDir, () => {})
  try {
    const error = makeErrorIn('D:/dsh-contract-test/owner-windows')
    const claimed = copyB.ownerOf(error)
    assert.ok(claimed)
    assert.equal(claimed.dir, 'D:/dsh-contract-test/owner-windows')
  } finally {
    undo()
  }
})

test('the boundary installs exactly one handler, even when two copies install it', () => {
  const fake = makeFakeProcess()
  const host = () => {}
  fake.on('uncaughtException', host)
  const ctx = makeCtx()
  withFakeProcess(fake, () => {
    const uninstall = copyA.installFaultBoundary(ctx)
    try {
      assert.equal(fake.listeners('uncaughtException').length, 1, 'the host handler must be taken over')
      const handler = fake.listeners('uncaughtException')[0]
      // The second copy of the module must not add a second handler.
      copyB.installFaultBoundary(ctx)
      assert.equal(fake.listeners('uncaughtException').length, 1, 'there must be exactly one handler')
      assert.equal(fake.listeners('uncaughtException')[0], handler, 'the handler must not be replaced')
    } finally {
      uninstall()
    }
    assert.ok(fake.listeners('uncaughtException').includes(host), 'the host handler must be restored')
  })
})

test('an owned error goes to its owner and not to the host', () => {
  const fake = makeFakeProcess()
  const seen = { owner: [], host: [] }
  fake.on('uncaughtException', (error) => { seen.host.push(error) })
  const onFault = (error) => { seen.owner.push(error) }
  const undo = copyA.claimFaultOwnership(OWNER_DIR, onFault)
  withFakeProcess(fake, () => {
    const uninstall = copyB.installFaultBoundary(makeCtx())
    try {
      const handler = fake.listeners('uncaughtException')[0]
      const error = makeErrorIn(OWNER_DIR)
      handler(error)
      assert.deepEqual(seen.owner, [error], 'the owner must receive the error')
      assert.deepEqual(seen.host, [], 'the host must not see an owned error')
    } finally {
      uninstall()
    }
  })
  undo()
})

test('an unowned error goes to the host handlers', () => {
  const fake = makeFakeProcess()
  const seen = { owner: [], host: [] }
  fake.on('uncaughtException', (error, origin) => { seen.host.push([error, origin]) })
  const onFault = (error) => { seen.owner.push(error) }
  const undo = copyA.claimFaultOwnership(OWNER_DIR, onFault)
  withFakeProcess(fake, () => {
    const uninstall = copyA.installFaultBoundary(makeCtx())
    try {
      const handler = fake.listeners('uncaughtException')[0]
      const error = makeErrorIn(OTHER_DIR)
      handler(error)
      assert.deepEqual(seen.owner, [], 'no owner may be called')
      assert.equal(seen.host.length, 1, 'the host must see the error exactly once')
      assert.equal(seen.host[0][0], error)
      assert.equal(seen.host[0][1], 'uncaughtException', 'the origin must be handed on unchanged')
    } finally {
      uninstall()
    }
  })
  undo()
})

test('the same error is not handed on twice', () => {
  // I3: the boundary of copy A and the boundary of copy B would both take
  // the event over if the registry were not shared - the error would then
  // reach the host twice.
  const fake = makeFakeProcess()
  const seen = { owner: [], host: [] }
  fake.on('uncaughtException', (error) => { seen.host.push(error) })
  const undo = copyB.claimFaultOwnership(OWNER_DIR, (error) => { seen.owner.push(error) })
  withFakeProcess(fake, () => {
    const uninstall = copyA.installFaultBoundary(makeCtx())
    try {
      copyB.installFaultBoundary(makeCtx())
      const handler = fake.listeners('uncaughtException')[0]
      const error = makeErrorIn(OWNER_DIR)
      handler(error)
      assert.equal(seen.owner.length, 1, 'the owner must receive the error exactly once')
      assert.equal(seen.host.length, 0, 'the host must not see an owned error')
      // The unowned error has to reach the host exactly once too: a second
      // boundary that did not take the event over would hand it on twice.
      const foreign = makeErrorIn(OTHER_DIR)
      handler(foreign)
      assert.equal(seen.host.length, 1, 'the host must see an unowned error exactly once')
      assert.equal(seen.host[0], foreign)
    } finally {
      uninstall()
    }
  })
  undo()
})

test('the boundary of the real process restores the host handlers', () => {
  // The same property against the real `process` of the test runner: the
  // uninstaller has to give the host its own handlers back, otherwise the
  // rest of the run would lose the fail-loud behaviour.
  const before = process.listeners('uncaughtException')
  const uninstall = copyA.installFaultBoundary(makeCtx())
  try {
    // The boundary TAKES the event over: the host's own handler is held by
    // the registry, not called by the process any more. So there is exactly
    // one listener, and it is not one of the host's.
    const during = process.listeners('uncaughtException')
    assert.equal(during.length, 1)
    assert.equal(during.includes(before[0]), false)
    copyB.installFaultBoundary(makeCtx())
    assert.deepEqual(process.listeners('uncaughtException'), during, 'the second copy must not add a handler')
  } finally {
    uninstall()
  }
  assert.deepEqual(process.listeners('uncaughtException'), before)
})
