import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Build the icon entry twice: once with the harness's primitives stubbed in
 * (the host path) and once with the package left external (the fallback path
 * a stripped deployment takes).
 *
 * @param {string} name the output file name
 * @param {object} extra esbuild options that distinguish the two builds
 * @returns {Promise<object>} the imported module
 */
async function buildEntry(name, extra) {
  const dir = join(root, '.host-icons-tmp')
  await mkdir(dir, { recursive: true })
  const outfile = join(dir, name)
  await rm(outfile, { force: true })
  await build({
    absWorkingDir: root,
    entryPoints: ['tests/host-icons-entry.jsx'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: ['node20'],
    external: ['react', 'react-dom', 'react-dom/server'],
    jsx: 'transform',
    define: { 'process.env.NODE_ENV': '"production"' },
    outfile,
    logLevel: 'silent',
    ...extra,
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

let hostModule
let fallbackModule

/**
 * The build whose `require` finds the harness's primitives stub.
 * @returns {Promise<object>} the imported module
 */
async function loadHostModule() {
  if (hostModule === undefined) {
    hostModule = buildEntry('entry-host.mjs', {
      // The stub stands in for the module the DSH shell seeds into the
      // browser module table; aliasing it here makes the plugin's synchronous
      // `require` resolve to the stub, so the HOST path is what renders.
      alias: {
        '@deepseek-ai/dsh-client-ui-primitives': join(root, 'tests/stubs/host-primitives.js'),
      },
    })
  }
  return hostModule
}

/**
 * The build whose `require` misses, so the local fallback renders.
 * @returns {Promise<object>} the imported module
 */
async function loadFallbackModule() {
  if (fallbackModule === undefined) {
    fallbackModule = buildEntry('entry-fallback.mjs', {
      external: ['react', 'react-dom', 'react-dom/server', '@deepseek-ai/dsh-client-ui-primitives'],
    })
  }
  return fallbackModule
}

test('a file glyph is the host component, classified from the path', async () => {
  const mod = await loadHostModule()
  const html = mod.renderFile('app.tsx', 15)
  assert.match(html, /data-host-file-icon="path:app\.tsx"/)
  assert.match(html, /data-size="15"/)
  assert.match(html, /class="iwb-file-icon"/)
})

test('a folder glyph asks the host for the folder kind', async () => {
  const mod = await loadHostModule()
  const html = mod.renderFolder(15)
  assert.match(html, /data-host-file-icon="kind:folder"/)
  assert.match(html, /data-size="15"/)
})

test('an extra class name is merged with the layout class', async () => {
  const mod = await loadHostModule()
  const html = mod.renderFileWithClass('a.ts', 'iwb-extra')
  assert.match(html, /class="iwb-file-icon iwb-extra"/)
})

test('without the host module the neutral fallback renders instead', async () => {
  const mod = await loadFallbackModule()
  const html = mod.renderFile('app.tsx', 15)
  assert.doesNotMatch(html, /data-host-file-icon/)
  assert.match(html, /<svg/)
  assert.match(html, /class="iwb-file-icon"/)
})
