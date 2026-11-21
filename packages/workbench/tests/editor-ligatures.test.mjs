/**
 * The editor must not let the FONT swallow the characters.
 *
 * The skin plugin (dsh-claude-style) loads JetBrains Mono as a web font, so
 * the editor inherits its ligatures even on a machine that never had the font
 * installed. A ligature draws a run like `//` or `/*` as ONE glyph: the user
 * counts fewer characters than he typed and the line moves - the file is
 * right, the picture lies.
 *
 * The promise of the workbench is that the buffer shows exactly what the user
 * typed, so the editor switches the ligatures off.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const moduleRequire = createRequire(import.meta.url)

let modulePromise

/**
 * The theme of the editor, in ONE bundle with the client.
 * @returns {Promise<object>} the module
 */
async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'editor-ligatures-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: "export { EDITOR_THEME_RULES } from './src/client/CodeEditor.jsx'",
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'editor-ligatures-entry.jsx',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: ['node20'],
      alias: {
        '@xterm/xterm/css/xterm.css': moduleRequire.resolve('@xterm/xterm/css/xterm.css'),
        '@xterm/xterm': join(root, 'tests/stubs/xterm.js'),
        '@xterm/addon-fit': join(root, 'tests/stubs/addon-fit.js'),
        'virtual:pdf-worker': join(root, 'tests/stubs/pdf-worker.js'),
      },
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

test('the editor switches the ligatures of the font off', async () => {
  const { EDITOR_THEME_RULES } = await loadModule()
  const scroller = EDITOR_THEME_RULES['.cm-scroller']
  assert.ok(scroller !== undefined, 'the theme must style the scroller')
  assert.equal(
    scroller.fontVariantLigatures,
    'none',
    'a ligature merges characters into one glyph: the buffer would show less than the user typed',
  )
})

test('the editor keeps the monospace font of the workbench', async () => {
  const { EDITOR_THEME_RULES } = await loadModule()
  assert.equal(EDITOR_THEME_RULES['.cm-scroller'].fontFamily, 'var(--iwb-mono)')
})
