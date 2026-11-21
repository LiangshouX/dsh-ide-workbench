/**
 * The faces of the workbench ship with it (PRD-v8 §6.7).
 *
 * The workbench USED to ask for Inter and JetBrains Mono and hope the
 * machine had them. Most machines do not: a Windows box has Segoe UI and
 * Consolas, and the workbench looked like every other tool on it. The faces
 * are now part of the plugin - the latin subset of the variable Inter and of
 * the variable JetBrains Mono.
 *
 * They are inlined as data URIs rather than fetched, because the plugin
 * cannot count on the host serving a static file of its package. The
 * injection happens in the BUILD, through a placeholder in the stylesheet,
 * so that the source of the client stays free of binary imports: every test
 * suite bundles the client with a plain esbuild call, and a `.woff2` import
 * would need a loader in each of them.
 *
 * The faces are under the SIL Open Font License 1.1, so their licenses
 * have to travel with them.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const styles = await readFile(join(root, 'src/client/styles.js'), 'utf8')
const builder = await readFile(join(root, '../../scripts/build-client.mjs'), 'utf8')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

test('the stylesheet carries the placeholder of the faces', () => {
  assert.match(styles, /\/\*__DSH_FONT_CSS__\*\//,
    'the stylesheet has a place for the faces')
  // The placeholder must be a COMMENT: a test suite that bundles the client
  // without the fonts has to end up with a stylesheet that still works.
  const marker = 'export const CSS ='
  const start = styles.indexOf(marker)
  const literal = styles.slice(start)
  assert.equal((literal.match(/`/g) ?? []).length, 2,
    'the stylesheet holds exactly the two backticks of its own literal')
})

test('the build replaces the placeholder with the faces', () => {
  assert.match(builder, /__DSH_FONT_CSS__/, 'the build knows the placeholder')
  assert.match(builder, /assets['"],\s*['"]fonts['"]/, 'the build reads the fonts of the package')
  assert.match(builder, /data:font\/woff2;base64,/, 'the faces are inlined as data URIs')
  assert.match(builder, /family: 'Inter'/, 'Inter is one of the faces')
  assert.match(builder, /family: 'JetBrains Mono'/, 'JetBrains Mono is the other one')
})

test('both faces are in the repository', async () => {
  for (const file of [
    'inter-latin-opsz-normal.woff2',
    'jetbrains-mono-latin-wght-normal.woff2',
  ]) {
    const info = await stat(join(root, 'assets/fonts', file))
    assert.ok(info.size > 10_000, `${file} is a real font (${info.size} bytes)`)
  }
})

test('the licenses of the faces travel with them', async () => {
  for (const file of ['LICENSE-Inter.txt', 'LICENSE-JetBrains-Mono.txt']) {
    const text = await readFile(join(root, 'assets/fonts', file), 'utf8')
    assert.match(text, /SIL OPEN FONT LICENSE Version 1\.1/i,
      `${file} is the license of the face`)
  }
  // The fonts are inlined into the artifact, so the licenses have to be in the
  // PACKAGE as well - a font without its license is not distributable.
  assert.ok(manifest.files.includes('assets/fonts'),
    'the package ships the fonts and their licenses')
})
