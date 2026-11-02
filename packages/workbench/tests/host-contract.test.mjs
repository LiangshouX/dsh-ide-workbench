import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.js'
import { CONTRACT_VERSION, HOST_SERVICE } from '../src/contract/index.js'

/**
 * A Cordis-like context that records the services the plugin provides.
 * @returns {{ctx: any, services: Map<string, any>, routes: any[], disposers: Function[]}} the context and its records
 */
function fakeContext() {
  const services = new Map()
  const routes = []
  const disposers = []
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    get: (service) => services.get(service),
    provide(service, value) {
      services.set(service, value)
      return () => services.delete(service)
    },
    effect(execute) {
      const result = execute()
      if (typeof result === 'function') disposers.push(result)
      return () => {}
    },
    subprocess: { spawn() { throw new Error('the contract test must not start a process') } },
    connection: { requestRejection: () => undefined },
    workspaceRegistry: { list: () => [], create: async () => ({ id: 'x', path: 'C:\\', title: 'x' }) },
    webServer: {
      register(spec) { routes.push(spec); return () => {} },
      registerUpgrade() { return () => {} },
    },
  }
  return { ctx, services, routes, disposers }
}

/**
 * A request with a JSON body, for the JSON route of the workbench.
 * @param {string} method the API method
 * @param {object} body the body of the request
 * @returns {any} the request
 */
function fakeRequest(method, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  return {
    method: 'POST',
    url: `/ide-workbench/api/${method}`,
    async *[Symbol.asyncIterator]() { yield payload },
  }
}

/**
 * A response that keeps what was written into it.
 * @returns {any} the response
 */
function fakeResponse() {
  return {
    headersSent: false,
    status: 0,
    body: '',
    writeHead(status) { this.status = status },
    end(chunk) { this.body = String(chunk) },
  }
}

/**
 * Wait until a condition holds.
 * @param {() => boolean} predicate the condition
 * @returns {Promise<void>} the wait
 */
async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('the condition did not hold in time')
}

test('the core provides the host service of the contract', async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'iwb-contract-'))
  t.after(() => rm(profile, { recursive: true, force: true }))
  process.env.DSH_PROFILE_DIR = profile
  const { ctx, services, disposers } = fakeContext()
  t.after(() => { for (const dispose of disposers) dispose() })
  apply(ctx)

  // The service is read with a soft `ctx.get`: a consumer that is not there
  // must not keep the consumer from applying at all.
  const service = ctx.get(HOST_SERVICE)
  assert.ok(service, 'the core must provide the host service')
  assert.equal(services.get(HOST_SERVICE), service)
  assert.equal(service.version, CONTRACT_VERSION)
  for (const method of ['getProjectRoot', 'getScopeRoot', 'readFile', 'searchFiles', 'onProjectChanged', 'health']) {
    assert.equal(typeof service[method], 'function', `the service must offer ${method}`)
  }
  assert.deepEqual(service.health(), { ok: true })
})

test('the service knows the project the user is working in', async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'iwb-contract-'))
  t.after(() => rm(profile, { recursive: true, force: true }))
  process.env.DSH_PROFILE_DIR = profile
  const workspace = await mkdtemp(join(tmpdir(), 'iwb-workspace-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const project = join(workspace, 'packages')
  await mkdir(project, { recursive: true })
  await mkdir(join(profile, 'ide-workbench'), { recursive: true })
  await writeFile(
    join(profile, 'ide-workbench', 'settings.json'),
    JSON.stringify({ version: 3, lastRoot: workspace, projectRoots: { [workspace]: project } }),
    'utf8',
  )

  const { ctx, disposers } = fakeContext()
  t.after(() => { for (const dispose of disposers) dispose() })
  apply(ctx)
  const service = ctx.get(HOST_SERVICE)

  await waitFor(() => service.getProjectRoot() !== '')
  assert.equal(service.getProjectRoot(), project)
  assert.equal(service.getScopeRoot(), project)
})

test('a change of the project reaches the subscribers of the service', async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'iwb-contract-'))
  t.after(() => rm(profile, { recursive: true, force: true }))
  process.env.DSH_PROFILE_DIR = profile
  const workspace = await mkdtemp(join(tmpdir(), 'iwb-workspace-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const project = join(workspace, 'packages')
  const other = join(workspace, 'other')
  await mkdir(project, { recursive: true })
  await mkdir(other, { recursive: true })
  await mkdir(join(profile, 'ide-workbench'), { recursive: true })
  await writeFile(
    join(profile, 'ide-workbench', 'settings.json'),
    JSON.stringify({ version: 3, lastRoot: workspace, projectRoots: { [workspace]: project } }),
    'utf8',
  )

  const { ctx, routes, disposers } = fakeContext()
  t.after(() => { for (const dispose of disposers) dispose() })
  apply(ctx)
  const service = ctx.get(HOST_SERVICE)
  await waitFor(() => service.getProjectRoot() !== '')

  const seen = []
  const unsubscribe = service.onProjectChanged(root => { seen.push(root) })
  const response = fakeResponse()
  await routes[0].handler(fakeRequest('settings.update', { patch: { projectRoots: { [workspace]: other } } }), response)
  assert.equal(response.status, 200)
  await waitFor(() => seen.length > 0)
  assert.deepEqual(seen, [other])

  // The unsubscribe really unsubscribes.
  unsubscribe()
  await routes[0].handler(fakeRequest('settings.update', { patch: { projectRoots: { [workspace]: project } } }), fakeResponse())
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.deepEqual(seen, [other])
})

test('the service reads a file of the project and refuses one outside of it', async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'iwb-contract-'))
  t.after(() => rm(profile, { recursive: true, force: true }))
  process.env.DSH_PROFILE_DIR = profile
  const workspace = await mkdtemp(join(tmpdir(), 'iwb-workspace-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const project = join(workspace, 'packages')
  await mkdir(project, { recursive: true })
  await writeFile(join(project, 'a.txt'), 'the content\n', 'utf8')
  await mkdir(join(profile, 'ide-workbench'), { recursive: true })
  await writeFile(
    join(profile, 'ide-workbench', 'settings.json'),
    JSON.stringify({ version: 3, lastRoot: workspace, projectRoots: { [workspace]: project } }),
    'utf8',
  )

  const { ctx, disposers } = fakeContext()
  t.after(() => { for (const dispose of disposers) dispose() })
  apply(ctx)
  const service = ctx.get(HOST_SERVICE)
  await waitFor(() => service.getProjectRoot() !== '')

  assert.equal(await service.readFile(join(project, 'a.txt')), 'the content\n')
  await assert.rejects(
    () => service.readFile(join(workspace, 'outside.txt')),
    /outside/,
    'a path outside of the project has to be refused',
  )
})

test('the service searches the files of the project', async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'iwb-contract-'))
  t.after(() => rm(profile, { recursive: true, force: true }))
  process.env.DSH_PROFILE_DIR = profile
  const workspace = await mkdtemp(join(tmpdir(), 'iwb-workspace-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const project = join(workspace, 'packages')
  await mkdir(project, { recursive: true })
  await writeFile(join(project, 'a.ts'), 'const needle = 1\n', 'utf8')
  await mkdir(join(profile, 'ide-workbench'), { recursive: true })
  await writeFile(
    join(profile, 'ide-workbench', 'settings.json'),
    JSON.stringify({ version: 3, lastRoot: workspace, projectRoots: { [workspace]: project } }),
    'utf8',
  )

  const { ctx, disposers } = fakeContext()
  t.after(() => { for (const dispose of disposers) dispose() })
  apply(ctx)
  const service = ctx.get(HOST_SERVICE)
  await waitFor(() => service.getProjectRoot() !== '')

  const result = await service.searchFiles({ query: 'needle' })
  assert.equal(result.files.length, 1)
  // The paths are relative to the project the search ran in.
  assert.equal(result.files[0].path, 'a.ts')
  assert.equal(result.files[0].hits[0].line, 1)
  assert.equal(result.files[0].hits[0].column, 7)
  assert.match(result.files[0].hits[0].text, /needle/)
  assert.equal(result.truncated, false)
})
