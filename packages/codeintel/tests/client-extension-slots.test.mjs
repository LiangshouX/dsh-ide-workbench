/**
 * The extension slots of the code intelligence plugin (PRD-v6 §3.4.1).
 *
 * The editor of the IDE workbench is extended by every plugin that fills the
 * seam of the contract. The slots of one key compete: only the one with the
 * highest priority is installed, and the loser is NOT installed at all - so
 * there is no second state field and no second input handler in the editor.
 *
 * This file pins the declaration of the plugin: the three keys and their
 * priority of 100. The core declares `closeBrackets` with the priority 0,
 * and the codeintel wins - deterministically, whatever order the plugins were
 * loaded in (acceptance C16/C17).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let modulePromise

/**
 * The modules of the plugin that declare the slots, bundled.
 * @returns {Promise<object>} the bundled module
 */
async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'extension-slots-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
export { codeintelExtensionSlots } from './src/client/extensions.js'
export { CODEINTEL_PRIORITY, CORE_PRIORITY, mergeExtensionSlots } from './src/contract/index.js'
`,
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'extension-slots-entry.jsx',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: ['node20'],
      external: ['react', 'react-dom', 'react-dom/server', '@deepseek-ai/dsh-client-ui-primitives'],
      loader: { '.css': 'text' },
      jsx: 'transform',
      define: { 'process.env.NODE_ENV': '"production"' },
      outfile,
      logLevel: 'silent',
    })
    return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
  })()
  return modulePromise
}

test('the plugin declares exactly three slots', async () => {
  const mod = await loadModule()
  const slots = mod.codeintelExtensionSlots()
  assert.deepEqual(
    slots.map(slot => slot.key),
    ['closeBrackets', 'autocomplete', 'lsp'],
    'the three slots of the implementation contract (§4.1)',
  )
})

test('every slot of the plugin claims the priority 100', async () => {
  const mod = await loadModule()
  const slots = mod.codeintelExtensionSlots()
  for (const slot of slots) {
    assert.equal(slot.priority, 100, `the slot ${slot.key} claims the priority 100`)
    assert.equal(slot.priority, mod.CODEINTEL_PRIORITY, 'the priority is the one of the contract')
    assert.ok(Array.isArray(slot.extensions), `the slot ${slot.key} carries extensions`)
  }
})

test('the plugin wins over the core when both are installed', async () => {
  const mod = await loadModule()
  // The core declares the automatic closing of the brackets with the
  // priority 0; the codeintel offers the same key with the priority 100.
  const core = [{ key: 'closeBrackets', priority: mod.CORE_PRIORITY, extensions: ['core'] }]
  const merged = mod.mergeExtensionSlots([core, mod.codeintelExtensionSlots()])
  assert.equal(merged.includes('core'), false, 'the core steps aside')
  assert.ok(merged.length > 0, 'the winner is installed')
})

test('the order of the plugins does not change the winner', async () => {
  const mod = await loadModule()
  const core = [{ key: 'closeBrackets', priority: mod.CORE_PRIORITY, extensions: ['core'] }]
  const codeintel = mod.codeintelExtensionSlots()
  const first = mod.mergeExtensionSlots([core, codeintel])
  const second = mod.mergeExtensionSlots([codeintel, core])
  assert.equal(first.includes('core'), false, 'the core steps aside in the first order')
  assert.equal(second.includes('core'), false, 'and in the second order as well')
})
