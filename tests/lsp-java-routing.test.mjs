/**
 * The routing of the host language servers to the Java runtime (PRD-v5.1
 * JS-01…JS-05, `src/host/lsp.js`).
 *
 * Why this file exists: "Java does not work" had a second root besides the
 * broken launcher - the ROUTING. A mixed repository (a `package.json` next to
 * a `pom.xml`) was always detected as TypeScript, so the Java server never
 * started at all (JS-04). The host now starts the server of the language the
 * client names, and the run of a root keeps its language once it was
 * decided. What has to be proven here:
 *
 *   - a requested `languageId` reaches the server, and the JVM argv comes from
 *     the java plan (JS-01) - not from the `.bat`/script branch;
 *   - a root without a requested language is decided by the vote over its
 *     source files (JS-04);
 *   - a running session is reused when another language arrives later, so the
 *     server does not start/stop in a loop (PRD §5.2);
 *   - the settings page (`servers()`) carries the JDK diagnostics (PRD §7.2);
 *   - a Java plan that cannot start degrades the session with the plan's hint
 *     instead of a generic "not installed" (PRD §3.5).
 *
 * The Java runtime is a DOUBLE here: the plan and the sweep are injected, so
 * no JDK, IDE or jdtls installation is needed and the routing can be asserted
 * exactly. The manager is the real one, with the process and worker doubles
 * of `lsp-fixtures.mjs`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ceilingMBOf, DEFAULT_LSP_SETTINGS, LspManager, scopeRootOf } from '../src/host/lsp.js'
import { encodeFrame } from '../src/host/lsp-frame.js'
import { makeFakeHandle, makeFakeWorker, makeManager, sleep } from './lsp-fixtures.mjs'

/** One megabyte in bytes. */
const MB = 1024 * 1024

/**
 * The comparable form of one path: the Windows comparison is case-insensitive
 * and accepts both separators, and the tests must not depend on which one
 * `path.resolve()` produces.
 * @param {string} path the path
 * @returns {string}
 */
function comparablePath(path) {
  return String(path).replace(/\//g, '\\').toLowerCase()
}

/**
 * One java plan that starts the JVM directly, in the shape the host consumes.
 * @param {object} [overrides] the fields to replace
 * @returns {object} the plan
 */
function javaPlan(overrides = {}) {
  return {
    ok: true,
    launcher: 'java',
    path: 'C:\\fake\\jbr\\bin\\java.exe',
    source: 'jdtls',
    mode: 'jvm',
    supportsMemoryLimit: true,
    jdtlsHome: 'D:\\fake\\jdtls-1.63.0',
    javaHome: 'C:\\fake\\jbr',
    javaVersion: 25,
    jdkCandidates: [{ path: 'C:\\fake\\jbr', version: 25, source: 'bundled-jbr' }],
    workspaceDir: 'C:\\fake\\profile\\ide-workbench\\lsp-workspace\\jdtls-0123456789abcdef',
    argv: [
      'C:\\fake\\jbr\\bin\\java.exe',
      '-Xms1024m',
      '-Xmx2048m',
      '-jar',
      'D:\\fake\\jdtls-1.63.0\\plugins\\org.eclipse.equinox.launcher_1.8.0.jar',
      '-data',
      'C:\\fake\\profile\\ide-workbench\\lsp-workspace\\jdtls-0123456789abcdef',
    ],
    ...overrides,
  }
}

/**
 * One injected Java runtime: it records the calls and answers the plan and the
 * sweep with what the test says.
 * @param {object | ((input: object) => object)} plan the plan, or a function
 * @returns {object} the double
 */
function fakeJavaRuntime(plan) {
  const calls = []
  const sweeps = []
  return {
    calls,
    sweeps,
    javaServerPlan(input) {
      calls.push(input)
      return typeof plan === 'function' ? plan(input) : plan
    },
    sweepJavaWorkspaces(knownRoots, options) {
      sweeps.push({ knownRoots, options })
      return []
    },
  }
}

/**
 * Create one temporary project root.
 * @param {string} prefix the prefix of the directory name
 * @returns {string} the absolute root
 */
function makeRoot(prefix) {
  return mkdtempSync(join(tmpdir(), `iwb-${prefix}-`))
}

/**
 * Remove one temporary root.
 * @param {string} root the root
 */
function removeRoot(root) {
  rmSync(root, { recursive: true, force: true })
}

/**
 * Wait until the session of one root reaches one of the wanted states.
 * @param {object} manager the manager
 * @param {string} root the project root
 * @param {string[]} states the states to wait for
 * @param {number} [timeoutMs] how long to wait at most
 * @returns {Promise<string>} the state that was reached (or the last one seen)
 */
async function waitForState(manager, root, states, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  let state = ''
  while (Date.now() < deadline) {
    state = (await manager.status({ root })).state
    if (states.includes(state)) return state
    await sleep(20)
  }
  return state
}

// ── JS-01: the requested language reaches the JVM argv ────────────────────

test('an explicit java languageId spawns the argv of the java plan', async (t) => {
  const root = makeRoot('javaRoutingExplicit')
  const plan = javaPlan()
  const javaRuntime = fakeJavaRuntime(plan)
  const { manager, spawned } = makeManager({ javaRuntime })
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  await manager.start({ root, languageId: 'java' })

  assert.equal(spawned.length, 1, 'one server was started')
  // The argv is the whole plan (executable first): jdtls is a JVM, not the
  // Python script PATH resolves - spawning that script is an ENOENT (JS-01).
  assert.deepEqual(spawned[0].spec.argv, plan.argv)

  const status = await manager.status({ root })
  assert.equal(status.languageId, 'java')
  assert.equal(status.serverId, 'jdtls')
  assert.equal(status.source, 'jdtls')
  assert.ok(['starting', 'building', 'ready'].includes(status.state), status.state)
})

test('the java plan is asked with the root and the effective memory ceiling', async (t) => {
  const root = makeRoot('javaRoutingPlanScope')
  const javaRuntime = fakeJavaRuntime(javaPlan())
  const { manager } = makeManager({ javaRuntime })
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  await manager.start({ root, languageId: 'java' })

  const call = javaRuntime.calls[javaRuntime.calls.length - 1]
  assert.notEqual(call, undefined, 'the java runtime was asked for a plan')
  assert.equal(call.command, 'jdtls', 'the configured command is the probe target')
  // The root is what makes `-data` per-project (PRD §4.1): without it the
  // plan cannot isolate the jdtls workspace.
  assert.equal(comparablePath(call.root), comparablePath(root))
  assert.ok(Number.isFinite(call.memoryLimitMB) && call.memoryLimitMB > 0, 'the ceiling of the session is passed')
})

test('the configured idea path travels into the java plan', async (t) => {
  // The bundled JBR of an IDE that is not on PATH is only reachable through
  // the launcher the user gave the plugin for "open in IDE": the plan has to
  // receive it (PRD §3.2 #5).
  const root = makeRoot('javaRoutingIdeaPath')
  const ideaPath = 'E:\\ides\\rider\\bin\\rider64.exe'
  const javaRuntime = fakeJavaRuntime(javaPlan())
  const { manager } = makeManager({ javaRuntime, document: { idea: { path: ideaPath } } })
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  await manager.start({ root, languageId: 'java' })

  const call = javaRuntime.calls[javaRuntime.calls.length - 1]
  assert.equal(call.ideaPath, ideaPath)

  // The settings page resolves the same plan: the same launcher is passed.
  await manager.servers()
  assert.equal(javaRuntime.calls[javaRuntime.calls.length - 1].ideaPath, ideaPath)
})

// ── JS-04: the vote over the sources when nobody names the language ──────

test('the source vote picks java for a mixed root without a languageId', async (t) => {
  const root = makeRoot('javaRoutingVote')
  const plan = javaPlan()
  const javaRuntime = fakeJavaRuntime(plan)
  const { manager, spawned } = makeManager({ javaRuntime })
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })
  // The incident shape: a Java project that also carries TypeScript files.
  // The marker rule of the older versions answered "TypeScript" whenever a
  // `package.json` existed; the vote counts the sources instead (PRD §5.4).
  writeFileSync(join(root, 'Alpha.java'), 'class Alpha {}\n')
  writeFileSync(join(root, 'Beta.java'), 'class Beta {}\n')
  writeFileSync(join(root, 'Gamma.java'), 'class Gamma {}\n')
  writeFileSync(join(root, 'app.ts'), 'export const app = 1\n')

  await manager.start({ root })

  assert.equal(spawned.length, 1, 'one server was started')
  assert.deepEqual(spawned[0].spec.argv, plan.argv, 'it is the java plan, not the TypeScript server')
  const status = await manager.status({ root })
  assert.equal(status.languageId, 'java')
})

test('a requested language that the registry does not serve is not honoured', async (t) => {
  const root = makeRoot('javaRoutingUnknown')
  const javaRuntime = fakeJavaRuntime(javaPlan())
  const { manager, spawned } = makeManager({ javaRuntime })
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })
  writeFileSync(join(root, 'Alpha.java'), 'class Alpha {}\n')
  // 'unknown' is not a language of the registry, so the vote decides; the
  // host must not refuse the start because of a typo of the client.
  await manager.start({ root, languageId: 'unknown' })
  assert.equal(spawned.length, 1)
  const status = await manager.status({ root })
  assert.equal(status.languageId, 'java')
})

test('a language id that shadows an Object member does not poison the root', async (t) => {
  // `__proto__` / `constructor` / `toString` are inherited members of every
  // object: a registry lookup without an own-property check would select them
  // and the root would be stuck with a language that has no server (JS-04).
  const root = makeRoot('javaRoutingProto')
  const plan = javaPlan()
  const javaRuntime = fakeJavaRuntime(plan)
  const { manager, spawned } = makeManager({ javaRuntime })
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })
  writeFileSync(join(root, 'Alpha.java'), 'class Alpha {}\n')

  for (const languageId of ['__proto__', 'constructor', 'toString']) {
    await manager.start({ root, languageId })
    const status = await manager.status({ root })
    assert.equal(status.languageId, 'java', `${languageId} must not become the language of the root`)
  }
  assert.equal(spawned.length, 1, 'the running session is reused and nothing was poisoned')
  assert.equal(({}).languageId, undefined, 'no inherited member was written')

  // The root still starts normally afterwards.
  await manager.start({ root })
  assert.equal((await manager.status({ root })).languageId, 'java')
})

test('an alias languageId reaches the server that serves it', async (t) => {
  // The client derives the language from the file extension: `.tsx` is
  // 'typescriptreact', `.jsx' is 'javascriptreact'. The host looks a session
  // up by REGISTRY KEY, so an alias that is passed through unchanged would be
  // ignored and the root would keep another server (JS-04).
  const root = makeRoot('javaRoutingAlias')
  const { manager, spawned } = makeManager({ javaRuntime: fakeJavaRuntime(javaPlan()) })
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  await manager.start({ root, languageId: 'typescriptreact' })
  assert.equal(spawned.length, 1)
  const status = await manager.status({ root })
  assert.equal(status.languageId, 'typescript', 'the alias is canonicalised to a registry key')
  assert.equal(status.serverId, 'typescript-language-server')
})

test('the jsx alias maps to the javascript override', async (t) => {
  // `.jsx` is the `javascriptreact` id of the client, and the host has an
  // EXPLICIT alias map: `.jsx` has to land on the `javascript` entry, or the
  // `servers.javascript` override would silently control nothing.
  const root = makeRoot('javaRoutingJsxAlias')
  const javaRuntime = fakeJavaRuntime(javaPlan())
  const { manager, spawned } = makeManager({
    javaRuntime,
    lsp: { servers: { javascript: { memoryLimitMB: 512 } } },
  })
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  await manager.start({ root, languageId: 'javascriptreact' })
  assert.equal(spawned.length, 1)
  const status = await manager.status({ root })
  assert.equal(status.languageId, 'javascript', 'the alias is canonicalised to the javascript entry')
  assert.equal(status.serverId, 'typescript-language-server')

  const resources = await manager.resources({ root })
  assert.equal(resources.languageId, 'javascript')
  assert.equal(resources.memoryLimitMB, 512, 'servers.javascript really controls the jsx alias')
})

test('the c extension alias maps to the cpp server entry', async (t) => {
  // `.c` is served by the C++ server: the entry lists both ids, and the
  // registry key of the entry has to be what the session records.
  const root = makeRoot('javaRoutingCAlias')
  const { manager } = makeManager({ javaRuntime: fakeJavaRuntime(javaPlan()) })
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  await manager.start({ root, languageId: 'c' })
  const status = await manager.status({ root })
  assert.equal(status.languageId, 'cpp')
  assert.equal(status.serverId, 'clangd')
  // clangd may be missing on the machine: the start then degrades, but the
  // language of the root is still the one the client asked for.
  assert.ok(['starting', 'building', 'ready', 'degraded'].includes(status.state), status.state)
})

// ── PRD §5.2: the language of a root is stable ──────────────────────────

test('a running session is reused when another languageId arrives later', async (t) => {
  const root = makeRoot('javaRoutingStable')
  const plan = javaPlan()
  const javaRuntime = fakeJavaRuntime(plan)
  const { manager, spawned } = makeManager({ javaRuntime })
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  await manager.start({ root, languageId: 'java' })
  assert.equal(spawned.length, 1)

  // The user switches to a TypeScript file of the same root. Starting a
  // TypeScript server here would stop the Java one and start it again on the
  // next switch - a 30 s start/stop loop (PRD §5.2).
  await manager.start({ root, languageId: 'typescript' })
  assert.equal(spawned.length, 1, 'the running session is reused, no second spawn')

  const status = await manager.status({ root })
  assert.equal(status.languageId, 'java', 'the language of the root is fixed once')
})

test('a root that lost its server keeps the language it started with', async (t) => {
  const root = makeRoot('javaRoutingRestart')
  const javaRuntime = fakeJavaRuntime(javaPlan())
  const fixture = makeManager({ javaRuntime })
  const { manager } = fixture
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  await manager.start({ root, languageId: 'java' })
  await manager.shutdown({ root })
  // Without the stored language the next start would detect the root again.
  // The entry keeps `java`, so an idle Java root wakes as a Java root.
  await manager.start({ root })
  assert.equal((await manager.status({ root })).languageId, 'java')
})

test('an explicit java language is pinned across a release and another request', async (t) => {
  const root = makeRoot('javaRoutingPinned')
  const plan = javaPlan()
  const javaRuntime = fakeJavaRuntime(plan)
  const { manager, spawned } = makeManager({ javaRuntime })
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  await manager.start({ root, languageId: 'java' })
  assert.equal(spawned.length, 1)
  await manager.shutdown({ root })

  // The user opens a Python file of the same root after the Java server was
  // released. The root was EXPLICITLY started as Java, so it is pinned: the
  // release must not turn it into a Python root (PRD §5.2).
  await manager.start({ root, languageId: 'python' })
  assert.equal(spawned.length, 2)
  assert.deepEqual(spawned[1].spec.argv, plan.argv, 'the second spawn is still the java plan')
  assert.equal((await manager.status({ root })).languageId, 'java')
})

test('a detected language can be replaced once by an explicit request, then stays', async (t) => {
  const root = makeRoot('javaRoutingDetected')
  const plan = javaPlan()
  const javaRuntime = fakeJavaRuntime(plan)
  const { manager, spawned } = makeManager({ javaRuntime })
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })
  // The vote detects TypeScript (two .ts against one .java).
  writeFileSync(join(root, 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(root, 'b.ts'), 'export const b = 2\n')
  writeFileSync(join(root, 'C.java'), 'class C {}\n')

  await manager.start({ root })
  assert.equal((await manager.status({ root })).languageId, 'typescript', 'the vote detected TypeScript')
  await manager.shutdown({ root })

  // The user opens the Java file and asks for the Java server. A DETECTED
  // language is not pinned, so the explicit request wins ONCE (the recovery
  // path of JS-04) and is pinned from then on.
  await manager.start({ root, languageId: 'java' })
  assert.equal((await manager.status({ root })).languageId, 'java')
  await manager.shutdown({ root })
  await manager.start({ root })
  assert.equal((await manager.status({ root })).languageId, 'java', 'the explicit java request is pinned')
  assert.deepEqual(spawned[spawned.length - 1].spec.argv, plan.argv)
})

test('a wake does not pin the language of the root', async (t) => {
  // The idle policy released the server; the first payload wakes it. A wake
  // is not an explicit request: it reuses the language the root already has
  // and must NOT pin it, or the document payload of a file of another
  // language would freeze the old server before the user rebuilds (JS-04).
  const root = makeRoot('javaRoutingWake')
  const plan = javaPlan()
  const javaRuntime = fakeJavaRuntime(plan)
  const { manager, spawned } = makeManager({ javaRuntime, lsp: { idleTimeoutMs: 60 } })
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })
  writeFileSync(join(root, 'app.ts'), 'export const app = 1\n')

  await manager.start({ root })
  assert.equal((await manager.status({ root })).languageId, 'typescript')
  const released = await waitForState(manager, root, ['suspended'])
  assert.equal(released, 'suspended', 'the idle policy released the server')

  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: {
      textDocument: {
        uri: `file:///${root.replace(/\\/g, '/')}/app.ts`,
        languageId: 'typescript',
        version: 1,
        text: 'export const app = 1\n',
      },
    },
  }))
  const woken = await waitForState(manager, root, ['starting', 'building', 'ready'])
  assert.ok(['starting', 'building', 'ready'].includes(woken), `the payload woke the server (state ${woken})`)

  // If the wake had pinned, the explicit java request below would be ignored.
  await manager.shutdown({ root })
  await manager.start({ root, languageId: 'java' })
  assert.equal((await manager.status({ root })).languageId, 'java', 'the wake must not have pinned the detected typescript')
  assert.deepEqual(spawned[spawned.length - 1].spec.argv, plan.argv)
})

test('a plain start after a release does not pin the detected language', async (t) => {
  const root = makeRoot('javaRoutingPlainStart')
  const plan = javaPlan()
  const javaRuntime = fakeJavaRuntime(plan)
  const { manager, spawned } = makeManager({ javaRuntime })
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })
  writeFileSync(join(root, 'app.ts'), 'export const app = 1\n')

  await manager.start({ root })
  await manager.shutdown({ root })
  // A start without a languageId is not a decision of the user: it reuses the
  // detected language and leaves the root replaceable.
  await manager.start({ root })
  assert.equal((await manager.status({ root })).languageId, 'typescript')
  await manager.shutdown({ root })
  await manager.start({ root, languageId: 'java' })
  assert.equal((await manager.status({ root })).languageId, 'java')
  assert.deepEqual(spawned[spawned.length - 1].spec.argv, plan.argv)
})

test('a failed explicit java start does not pin the root', async (t) => {
  // The plan cannot start (no JDK). The request never reached a process, so
  // the root must not stay "java" - a typo in javaHome would otherwise lock
  // the root for the rest of the process (PRD-v5.1 §5.2).
  const root = makeRoot('javaRoutingFailedPin')
  const javaRuntime = fakeJavaRuntime({
    ok: false,
    reason: 'jdk-missing',
    hint: 'no JDK was found on this machine',
    jdtlsHome: null,
    javaHome: null,
    javaVersion: null,
    jdkCandidates: [],
  })
  const { manager, spawned } = makeManager({ javaRuntime })
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  const failed = await manager.start({ root, languageId: 'java' })
  assert.equal(failed.state, 'degraded')
  assert.equal(spawned.length, 0, 'nothing was spawned')

  await manager.start({ root, languageId: 'typescript' })
  assert.equal(spawned.length, 1, 'another language can still start the root')
  const status = await manager.status({ root })
  assert.equal(status.languageId, 'typescript')
  assert.equal(status.serverId, 'typescript-language-server')
})

test('a polyglot workspace switches its scope with the language of the session', async (t) => {
  // A workspace with a TypeScript web/ and a Python server/ sub-project. The
  // scope is chosen by the sources of the SESSION language: the server has to
  // learn which sub-project to build, not the whole workspace (PRD-v5 §4.2).
  const root = makeRoot('javaRoutingPolyglot')
  const web = join(root, 'web')
  const server = join(root, 'server')
  mkdirSync(web, { recursive: true })
  mkdirSync(server, { recursive: true })
  writeFileSync(join(web, 'tsconfig.json'), '{}\n')
  for (let index = 0; index < 5; index += 1) writeFileSync(join(web, `file${index}.ts`), 'export const x = 1\n')
  writeFileSync(join(server, 'pyproject.toml'), '[project]\nname = "server"\n')
  const { manager, spawned } = makeManager()
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  // Two .py sources against five .ts sources: the vote detects TypeScript,
  // and the TypeScript server is scoped to web/.
  writeFileSync(join(server, 'mod0.py'), 'x = 1\n')
  writeFileSync(join(server, 'mod1.py'), 'x = 1\n')
  await manager.start({ root })
  assert.equal((await manager.status({ root })).languageId, 'typescript')
  assert.equal(comparablePath(spawned[0].spec.cwd), comparablePath(web))
  assert.equal(comparablePath((await manager.status({ root })).scopeRoot), comparablePath(web))
  await manager.shutdown({ root })

  // The Python project grows; an explicit python request switches the scope.
  for (let index = 2; index < 20; index += 1) writeFileSync(join(server, `mod${index}.py`), 'x = 1\n')
  await manager.start({ root, languageId: 'python' })
  assert.equal((await manager.status({ root })).languageId, 'python')
  assert.equal(comparablePath(spawned[spawned.length - 1].spec.cwd), comparablePath(server))
  assert.equal(comparablePath((await manager.status({ root })).scopeRoot), comparablePath(server))
})

test('the scope follows the language even when the other project is bigger', async (t) => {
  // The TypeScript project has 2 sources, the Python one 10: counting EVERY
  // source would scope the TypeScript server to server/. The scope counts the
  // sources of the session language only.
  const root = makeRoot('javaRoutingScopeLanguage')
  const web = join(root, 'web')
  const server = join(root, 'server')
  mkdirSync(web, { recursive: true })
  mkdirSync(server, { recursive: true })
  writeFileSync(join(web, 'tsconfig.json'), '{}\n')
  writeFileSync(join(web, 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(web, 'b.ts'), 'export const b = 2\n')
  writeFileSync(join(server, 'pyproject.toml'), '[project]\nname = "server"\n')
  for (let index = 0; index < 10; index += 1) writeFileSync(join(server, `mod${index}.py`), 'x = 1\n')
  const { manager, spawned } = makeManager()
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  await manager.start({ root, languageId: 'typescript' })
  assert.equal((await manager.status({ root })).languageId, 'typescript')
  assert.equal(comparablePath(spawned[0].spec.cwd), comparablePath(web))
  assert.equal(comparablePath((await manager.status({ root })).scopeRoot), comparablePath(web))
})

// ── PRD §7.2: the settings page carries the JDK diagnostics ─────────────

test('the servers page carries the java runtime diagnostics', async () => {
  const plan = javaPlan()
  const javaRuntime = fakeJavaRuntime(plan)
  const { manager } = makeManager({ javaRuntime })

  const { available, missing } = await manager.servers()

  const entry = available.find(item => item.languageId === 'java')
  assert.ok(entry !== undefined, `java is available: ${JSON.stringify(missing)}`)
  assert.equal(entry.command, 'jdtls')
  assert.equal(entry.source, 'jdtls')
  assert.equal(entry.resolvedPath, plan.path)
  // The four diagnostics fields of PRD §7.2: which installation, which JDK
  // and every candidate that was found - the answers to "why does Java not
  // start on this machine".
  assert.equal(entry.jdtlsHome, plan.jdtlsHome)
  assert.equal(entry.javaHome, plan.javaHome)
  assert.equal(entry.javaVersion, plan.javaVersion)
  assert.deepEqual(entry.jdkCandidates, plan.jdkCandidates)

  // Every other language is reported without the java-only fields.
  const typescript = available.find(item => item.languageId === 'typescript')
  assert.ok(typescript !== undefined, 'the bundled TypeScript server is available')
  assert.equal(typescript.jdkCandidates, undefined)
  assert.equal(typescript.javaHome, undefined)
})

test('the settings page keeps the java diagnostics when the plan cannot start', async () => {
  const plan = {
    ok: false,
    reason: 'jdk-missing',
    hint: 'no JDK was found on this machine',
    jdtlsHome: 'D:\\fake\\jdtls-1.63.0',
    javaHome: null,
    javaVersion: null,
    jdkCandidates: [],
  }
  const { manager } = makeManager({ javaRuntime: fakeJavaRuntime(plan) })

  const { available, missing } = await manager.servers()

  assert.ok(!available.some(item => item.languageId === 'java'), 'a java server that cannot start is missing')
  const entry = missing.find(item => item.languageId === 'java')
  assert.ok(entry !== undefined, 'the java entry is listed in the missing list')
  assert.equal(entry.hint, plan.hint, 'the hint of the plan is the hint of the page')
  assert.equal(entry.jdtlsHome, plan.jdtlsHome)
  assert.equal(entry.javaHome, null)
  assert.equal(entry.jdkCandidates.length, 0)
})

// ── PRD §3.5: a failed java plan explains itself ────────────────────────

test('a java plan that cannot start degrades the session with its hint', async (t) => {
  const root = makeRoot('javaRoutingMissing')
  const hint = 'the Java language server cannot start: no JDK was found. Set lsp.servers.java.javaHome to the JDK your jdtls accepts.'
  const javaRuntime = fakeJavaRuntime({
    ok: false,
    reason: 'jdk-missing',
    hint,
    jdtlsHome: null,
    javaHome: null,
    javaVersion: null,
    jdkCandidates: [],
  })
  const { manager, spawned } = makeManager({ javaRuntime })
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  const started = await manager.start({ root, languageId: 'java' })

  assert.equal(spawned.length, 0, 'nothing was spawned')
  assert.equal(started.state, 'degraded')
  // The detail of the Java branch is the plan's own sentence: a generic
  // "install it and put it on PATH" would send the user to install a JDK
  // version that may be the wrong one (PRD §3.5).
  assert.ok(started.detail.includes(hint), started.detail)
  const status = await manager.status({ root })
  assert.equal(status.state, 'degraded')
  assert.ok(status.detail.includes(hint), status.detail)
  assert.equal(status.languageId, 'java')
})

// ── the wake inherits the language of the refused session (JS-04) ───────

test('a wake after a gate-refused explicit start keeps the requested language', async (t) => {
  // The memory gate refused the java start: no process ran, so nothing is
  // pinned to the entry - but the SESSION remembers what the user asked for.
  // The first payload after the machine recovers is a wake (not a request)
  // and must start the java server, not the detected TypeScript one.
  const root = makeRoot('javaRoutingWakeRefused')
  const plan = javaPlan()
  const javaRuntime = fakeJavaRuntime(plan)
  const machine = { freeMB: 900 }
  const { manager, spawned } = makeManager({
    javaRuntime,
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: machine.freeMB * MB }),
  })
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  const refused = await manager.start({ root, languageId: 'java' })
  assert.equal(refused.state, 'degraded', 'the gate refused the java server (2048 MB baseline, 900 MB free)')
  assert.equal(spawned.length, 0, 'nothing was spawned')
  assert.equal((await manager.status({ root })).languageId, 'java', 'the session keeps the requested language')

  machine.freeMB = 8192
  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: {
      textDocument: {
        uri: `file:///${root.replace(/\\/g, '/')}/Demo.java`,
        languageId: 'java',
        version: 1,
        text: 'class Demo {}\n',
      },
    },
  }))
  const woken = await waitForState(manager, root, ['starting', 'building', 'ready'])
  assert.ok(['starting', 'building', 'ready'].includes(woken), `the wake started the server (state ${woken})`)
  const status = await manager.status({ root })
  assert.equal(status.languageId, 'java', 'the wake inherited the language of the refused session')
  assert.equal(spawned.length, 1)
  assert.deepEqual(spawned[0].spec.argv, plan.argv, 'the java plan, not node.exe')
})

// ── resources() accepts the language the start is about ─────────────────

test('resources accepts the language of the session that is about to start', async (t) => {
  // The memory prompt and the start have to judge the same language: a mixed
  // root whose user is on a `.java` file must be measured as a java server
  // (baseline 2048 MB), not as the detected TypeScript one (434 MB).
  const root = makeRoot('javaRoutingResourcesLanguage')
  writeFileSync(join(root, 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(root, 'b.ts'), 'export const b = 2\n')
  writeFileSync(join(root, 'C.java'), 'class C {}\n')
  const { manager } = makeManager({ javaRuntime: fakeJavaRuntime(javaPlan()) })
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  const asJava = await manager.resources({ root, languageId: 'java' })
  assert.equal(asJava.languageId, 'java')
  assert.equal(asJava.baselineMB, 2048, 'the java baseline is the memory gate number')
  // The estimate never asks for more than the ceiling of the project allows:
  // the two .ts files put the root in the small tier (1024 MB), so the 2048 MB
  // baseline is lowered to it before the 1.5 headroom is applied.
  assert.equal(asJava.needMB, 1536, 'the baseline and the small tier decide the need')

  // Without a language the host detects one: two .ts against one .java.
  const detected = await manager.resources({ root })
  assert.equal(detected.languageId, 'typescript', 'no session and no request: the detection decides')
  assert.equal(detected.baselineMB, 434, 'the TypeScript baseline, not the java one')
})

// ── manager.scope(): one host-authoritative answer (PRD-v5 §4.2) ────────

/**
 * Build a polyglot workspace: a TypeScript `web/` and a Python `server/`.
 * @param {string} root the workspace root
 * @param {number} tsFiles the .ts sources of web/
 * @param {number} pyFiles the .py sources of server/
 * @returns {{ web: string, server: string }} the two sub-projects
 */
function makePolyglot(root, tsFiles, pyFiles) {
  const web = join(root, 'web')
  const server = join(root, 'server')
  mkdirSync(web, { recursive: true })
  mkdirSync(server, { recursive: true })
  writeFileSync(join(web, 'tsconfig.json'), '{}\n')
  for (let index = 0; index < tsFiles; index += 1) writeFileSync(join(web, `file${index}.ts`), 'export const x = 1\n')
  writeFileSync(join(server, 'pyproject.toml'), '[project]\nname = "server"\n')
  for (let index = 0; index < pyFiles; index += 1) writeFileSync(join(server, `mod${index}.py`), 'x = 1\n')
  return { web, server }
}

test('manager.scope answers with the pinned language, exactly as the start would', async (t) => {
  const root = makeRoot('javaRoutingScopePinned')
  const { web } = makePolyglot(root, 5, 11)
  const { manager } = makeManager()
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  // An explicit TypeScript start pins the root.
  await manager.start({ root, languageId: 'typescript' })
  const started = await manager.scope({ root })
  assert.equal(started.languageId, 'typescript')
  assert.equal(comparablePath(started.scopeRoot), comparablePath(web))
  await manager.shutdown({ root })

  // A later python request does NOT change the pinned language: the scope
  // answer must be the same one the next start would decide with.
  const scope = await manager.scope({ root, languageId: 'python' })
  assert.equal(scope.languageId, 'typescript', 'the pin wins in scope() too')
  assert.equal(comparablePath(scope.scopeRoot), comparablePath(web))
  const status = await manager.status({ root })
  assert.equal(comparablePath(scope.scopeRoot), comparablePath(status.scopeRoot), 'scope() and status() agree')
})

test('manager.scope detects the language of a root that was never started', async (t) => {
  const root = makeRoot('javaRoutingScopeFresh')
  const { server } = makePolyglot(root, 3, 11)
  const { manager } = makeManager()
  t.after(() => removeRoot(root))

  const scope = await manager.scope({ root, languageId: 'python' })
  assert.equal(scope.languageId, 'python')
  assert.equal(comparablePath(scope.scopeRoot), comparablePath(server))
})

// ── scopeRootOf: a language with no source in a sub-project stays home ──

test('scopeRootOf keeps the root when the language has no source in any sub-project', (t) => {
  // Java sources at the root next to a TS and a Python sub-project: the java
  // "invisible project" belongs to the root, not to one of the sub-projects.
  const root = makeRoot('javaRoutingScopeZero')
  const web = join(root, 'web')
  const server = join(root, 'server')
  mkdirSync(web, { recursive: true })
  mkdirSync(server, { recursive: true })
  writeFileSync(join(web, 'package.json'), '{}\n')
  writeFileSync(join(web, 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(web, 'b.ts'), 'export const b = 2\n')
  writeFileSync(join(server, 'pyproject.toml'), '[project]\nname = "server"\n')
  for (let index = 0; index < 3; index += 1) writeFileSync(join(server, `mod${index}.py`), 'x = 1\n')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'Demo.java'), 'class Demo {}\n')
  t.after(() => removeRoot(root))

  assert.equal(comparablePath(scopeRootOf(root, 'auto', 'java')), comparablePath(root), 'no sub-project holds java')
  assert.equal(comparablePath(scopeRootOf(root, 'auto', 'typescript')), comparablePath(web))
  assert.equal(comparablePath(scopeRootOf(root, 'auto', 'python')), comparablePath(server))
  // An unknown language keeps the older count-all behaviour: the biggest
  // project (three .py) wins.
  assert.equal(comparablePath(scopeRootOf(root, 'auto', 'unknownlang')), comparablePath(server))
})

test('the single-child shortcut does not win when the language has no source in it', (t) => {
  const root = makeRoot('javaRoutingScopeSingleChild')
  const web = join(root, 'web')
  mkdirSync(web, { recursive: true })
  writeFileSync(join(web, 'package.json'), '{}\n')
  writeFileSync(join(web, 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(root, 'Main.java'), 'class Main {}\n')
  t.after(() => removeRoot(root))

  // One sub-project, but the java sources live at the root: the single-child
  // shortcut would scope the java server into web/ - it must not.
  assert.equal(comparablePath(scopeRootOf(root, 'auto', 'java')), comparablePath(root))
  assert.equal(comparablePath(scopeRootOf(root, 'auto', 'typescript')), comparablePath(web))
})

// ── MEM-11: the size tier stays on the TypeScript-family extensions ─────

test('the MEM-11 size tier keeps the previous extension set', (t) => {
  // The ceiling was calibrated against the TypeScript-family set: widening it
  // would lower the ceiling of a small Java project to 1 GB, below the
  // footprint jdtls measured (JS-05). A java-only/py-only root is "unknown"
  // and keeps the default ceiling of its language.
  const root = makeRoot('javaRoutingCeiling')
  const javaDir = join(root, 'java-only')
  const pyDir = join(root, 'py-only')
  const tsDir = join(root, 'ts-only')
  for (const directory of [javaDir, pyDir, tsDir]) mkdirSync(directory, { recursive: true })
  for (let index = 0; index < 10; index += 1) {
    writeFileSync(join(javaDir, `C${index}.java`), 'class C {}\n')
    writeFileSync(join(pyDir, `m${index}.py`), 'x = 1\n')
    writeFileSync(join(tsDir, `f${index}.ts`), 'export const x = 1\n')
  }
  t.after(() => removeRoot(root))

  assert.equal(ceilingMBOf('java', javaDir, {}), 2048, 'a java-only root keeps the java ceiling')
  assert.equal(ceilingMBOf('python', pyDir, {}), 1536, 'a python-only root keeps the python ceiling')
  assert.equal(ceilingMBOf('typescript', tsDir, {}), 1024, 'a small TypeScript root still gets the small tier')
})

// ── the crash diagnostics of a dead JVM (PRD-v5.1 §3.5, §8.2 #6, §9) ────

test('a dead JVM explains which JDK, which installation and which command it used', async (t) => {
  const root = makeRoot('javaRoutingJvmCrash')
  const plan = javaPlan()
  const fixture = makeManager({
    javaRuntime: fakeJavaRuntime(plan),
    lsp: { autoRestart: false },
    onSpawn: (spec, handle) => handle.exit(13),
  })
  const { manager } = fixture
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  await manager.start({ root, languageId: 'java' })
  await waitForState(manager, root, ['degraded'])

  const status = await manager.status({ root })
  assert.equal(status.state, 'degraded')
  assert.ok(status.detail.includes('The server was started with the JDK'), status.detail)
  assert.ok(status.detail.includes('The jdtls installation is at'), status.detail)
  assert.ok(status.detail.includes('The command was:'), status.detail)
  assert.ok(status.detail.includes('C:\\fake\\jbr'), 'the JDK that was chosen is named')
  assert.ok(status.detail.includes('D:\\fake\\jdtls-1.63.0'), 'the installation is named')
})

test('a non-java crash gets no Java runtime advice', async (t) => {
  const root = makeRoot('javaRoutingTsCrash')
  const fixture = makeManager({
    lsp: { autoRestart: false },
    onSpawn: (spec, handle) => handle.exit(9),
  })
  const { manager } = fixture
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  await manager.start({ root, languageId: 'typescript' })
  await waitForState(manager, root, ['degraded'])

  const status = await manager.status({ root })
  assert.equal(status.state, 'degraded')
  assert.ok(!status.detail.includes('JDKs of this machine'), status.detail)
  assert.ok(!status.detail.includes('The server was started with'), status.detail)
})

test('a frame worker failure is not a JVM failure', async (t) => {
  // The channel died, not the JVM: the JDK advice would be a false alarm.
  const root = makeRoot('javaRoutingWorkerCrash')
  const plan = javaPlan()
  const fixture = makeManager({
    javaRuntime: fakeJavaRuntime(plan),
    lsp: { autoRestart: false },
  })
  const { manager } = fixture
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  await manager.start({ root, languageId: 'java' })
  fixture.workers[0].emit('error', new Error('the frame channel died'))
  await waitForState(manager, root, ['degraded'])

  const status = await manager.status({ root })
  assert.equal(status.state, 'degraded')
  assert.ok(status.detail.includes('the frame worker failed'), status.detail)
  assert.ok(!status.detail.includes('The server was started with'), 'no JDK advice for a channel failure')
  assert.ok(!status.detail.includes('JDKs of this machine'))
})

test('a request timeout is not a JVM failure', async (t) => {
  // Three requests the server never answers. The timeout crashes the session,
  // but the JVM was alive: the JDK advice must not be appended.
  const root = makeRoot('javaRoutingTimeoutCrash')
  const plan = javaPlan()
  const fixture = makeManager({
    javaRuntime: fakeJavaRuntime(plan),
    lsp: { autoRestart: false, requestTimeoutMs: 60 },
    timeoutLimit: 3,
  })
  const { manager } = fixture
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  await manager.start({ root, languageId: 'java' })
  // One SEMANTIC answer: from then on the configured timeout applies (the
  // first semantic request is allowed the long build patience).
  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0',
    id: 11,
    method: 'textDocument/hover',
    params: { textDocument: { uri: 'file:///demo/Demo.java' }, position: { line: 0, character: 0 } },
  }))
  fixture.handle().stdout.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 11, result: null })))
  await sleep(20)
  // Three requests the server never answers.
  for (const id of [21, 22, 23]) {
    manager.relayToServer(root, JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'textDocument/hover',
      params: { textDocument: { uri: 'file:///demo/Demo.java' }, position: { line: 0, character: 0 } },
    }))
  }
  const state = await waitForState(manager, root, ['degraded'], 5000)
  assert.equal(state, 'degraded', 'the timeout crashed and degraded the session')

  const status = await manager.status({ root })
  assert.ok(status.detail.includes('request timeouts'), status.detail)
  assert.ok(!status.detail.includes('The server was started with'), 'no JDK advice for a timeout')
  assert.ok(!status.detail.includes('JDKs of this machine'))
})

// ── R4-1: a wake keeps the refused language of an already-started root ──

test('a wake keeps the refused language even when the root had started another one', async (t) => {
  // The root WAS started as TypeScript before (entry.languageId is set), then
  // released. A java start is refused by the gate: the wake must start java,
  // the most recent intent of the user, not fall back to the entry.
  const root = makeRoot('javaRoutingWakeAfterOther')
  const plan = javaPlan()
  const javaRuntime = fakeJavaRuntime(plan)
  const machine = { freeMB: 8192 }
  const { manager, spawned } = makeManager({
    javaRuntime,
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: machine.freeMB * MB }),
  })
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })
  writeFileSync(join(root, 'app.ts'), 'export const app = 1\n')

  await manager.start({ root })
  assert.equal((await manager.status({ root })).languageId, 'typescript')
  await manager.shutdown({ root })

  machine.freeMB = 900
  const refused = await manager.start({ root, languageId: 'java' })
  assert.equal(refused.state, 'degraded', 'the gate refused the java server')
  assert.equal(spawned.length, 1, 'the refused start spawned nothing')
  assert.equal((await manager.status({ root })).languageId, 'java')

  machine.freeMB = 8192
  manager.relayToServer(root, JSON.stringify({
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: {
      textDocument: {
        uri: `file:///${root.replace(/\\/g, '/')}/Demo.java`,
        languageId: 'java',
        version: 1,
        text: 'class Demo {}\n',
      },
    },
  }))
  const woken = await waitForState(manager, root, ['starting', 'building', 'ready'])
  assert.ok(['starting', 'building', 'ready'].includes(woken), `the wake started the server (state ${woken})`)
  assert.equal(
    (await manager.status({ root })).languageId,
    'java',
    'the wake keeps the refused java language, not the typescript of the entry',
  )
  assert.equal(spawned.length, 2)
  assert.deepEqual(spawned[spawned.length - 1].spec.argv, plan.argv, 'the java plan, not the TypeScript server')
})

// ── R4-2: scope, resources and the start agree on a non-running session ─

test('scope, resources and the start agree after a gate-refused start', async (t) => {
  // The refused java session is not running: an explicit TypeScript request
  // must win in ALL THREE answers, or the client's rootUri, the memory prompt
  // and the started process would describe three different languages.
  const root = makeRoot('javaRoutingRefusedConsistency')
  const plan = javaPlan()
  const machine = { freeMB: 900 }
  const { manager, spawned } = makeManager({
    javaRuntime: fakeJavaRuntime(plan),
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: machine.freeMB * MB }),
  })
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  const refused = await manager.start({ root, languageId: 'java' })
  assert.equal(refused.state, 'degraded')
  assert.equal(spawned.length, 0)
  machine.freeMB = 8192

  const resources = await manager.resources({ root, languageId: 'typescript' })
  assert.equal(resources.languageId, 'typescript', 'the explicit request outranks the refused session')
  const scope = await manager.scope({ root, languageId: 'typescript' })
  assert.equal(scope.languageId, 'typescript', 'scope() agrees with resources()')

  await manager.start({ root, languageId: 'typescript' })
  assert.equal((await manager.status({ root })).languageId, 'typescript', 'the start agrees too')
  assert.equal(spawned.length, 1)
  assert.notDeepEqual(spawned[0].spec.argv, plan.argv, 'the TypeScript server was started, not the java plan')
})

// ── R4-3: the persisted language of a fresh host ────────────────────────

/**
 * A fresh manager whose settings already carry one indexed root: the shape of
 * a host that was just restarted.
 * @param {object} javaRuntime the java runtime double
 * @param {object[]} spawned the recorded spawns
 * @param {string} root the persisted root
 * @param {string} [key] the spelling the settings use for the root
 * @returns {object} the manager
 */
function makePersistedManager(javaRuntime, spawned, root, key = root) {
  const settings = {
    lsp: {
      ...DEFAULT_LSP_SETTINGS,
      indexedRoots: { [key]: { at: 1, languageId: 'java' } },
    },
  }
  return new LspManager({
    ctx: {
      subprocess: { spawn: () => { throw new Error('the fixture never uses ctx.subprocess') } },
      logger: { warn: () => {} },
    },
    getSettings: async () => settings,
    spawnServer: async (spec) => {
      const handle = makeFakeHandle()
      spawned.push({ spec, handle })
      return handle
    },
    createWorker: (workerData) => makeFakeWorker(workerData),
    javaRuntime,
    readyDelayMs: 10,
    restartBackoffMs: 10,
    timeoutLimit: 3,
    graceMs: 20,
  })
}

test('a fresh host uses the language the settings persisted for the root', async (t) => {
  const root = makeRoot('javaRoutingPersisted')
  // The vote over the sources would say TypeScript: the persisted record of
  // the last indexed build (java) has to outrank it.
  writeFileSync(join(root, 'app.ts'), 'export const app = 1\n')
  const plan = javaPlan()
  const spawned = []
  const manager = makePersistedManager(fakeJavaRuntime(plan), spawned, root)
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  const scope = await manager.scope({ root })
  assert.equal(scope.languageId, 'java', 'the persisted language outranks the vote')
  assert.equal(comparablePath(scope.scopeRoot), comparablePath(root))

  // An explicit request still outranks the persisted record (the user wins).
  const asked = await manager.scope({ root, languageId: 'python' })
  assert.equal(asked.languageId, 'python')

  // The start without a languageId uses the same rule: the java plan.
  await manager.start({ root })
  assert.equal(spawned.length, 1)
  assert.deepEqual(spawned[0].spec.argv, plan.argv)
  assert.equal((await manager.status({ root })).languageId, 'java')
})

// ── R5-1: a released session's ceiling belongs to ITS language only ─────

test('a released YAML server does not lend its ceiling to a java prompt', async (t) => {
  // The released YAML server holds 512 MB. The java memory prompt must judge
  // the JAVA server (2048 MB), or the gate refuses a start it never asked
  // about; the yaml prompt keeps the session ceiling (same language).
  const root = makeRoot('javaRoutingYamlCeiling')
  writeFileSync(join(root, 'docker-compose.yml'), 'services: {}\n')
  const { manager } = makeManager()
  t.after(async () => {
    await manager.shutdown({ root })
    removeRoot(root)
  })

  await manager.start({ root })
  const whileRunning = await manager.resources({ root })
  assert.equal(whileRunning.languageId, 'yaml', 'the compose file is detected as yaml')
  assert.equal(whileRunning.memoryLimitMB, 512, 'the yaml session ceiling')
  await manager.shutdown({ root })

  // Same language: the released session ceiling is still the right one.
  const yamlAfterRelease = await manager.resources({ root })
  assert.equal(yamlAfterRelease.languageId, 'yaml')
  assert.equal(yamlAfterRelease.memoryLimitMB, 512)

  // Another language: the released yaml ceiling must NOT be borrowed.
  const asJava = await manager.resources({ root, languageId: 'java' })
  assert.equal(asJava.languageId, 'java')
  assert.equal(asJava.memoryLimitMB, 2048, 'the java ceiling is its own')
})

// ── R5-4: the persisted record is matched by the comparison key ─────────

test('the persisted language matches the root through the comparison key', async (t) => {
  // A restart may spell the same Windows root with a different drive-letter
  // case or with slashes. The record is found by rootKey, not by the exact
  // string - or the language of the last indexed build is silently lost.
  const root = makeRoot('javaRoutingPersistedSpelling')
  // The vote over the sources would say TypeScript: only the record can say
  // java here.
  writeFileSync(join(root, 'app.ts'), 'export const app = 1\n')
  t.after(() => removeRoot(root))
  const uppercase = process.platform === 'win32' ? root.toUpperCase() : root
  const slashed = process.platform === 'win32' ? root.toLowerCase().replace(/\\/g, '/') : root

  for (const key of [uppercase, slashed]) {
    const manager = makePersistedManager(fakeJavaRuntime(javaPlan()), [], root, key)
    const scope = await manager.scope({ root })
    assert.equal(scope.languageId, 'java', `the record under "${key}" is found`)
  }
})
