/**
 * Build the single-file Client artifact.
 *
 * The DSH client module loader expects one script per package:
 *   window.__ModuleLoader__.load({ id, factory(require) { ... return { apply } } })
 * React comes from the browser module table (`require('react')` stays external);
 * xterm and its stylesheet are bundled in, so the panel works without any other
 * runtime dependency.
 *
 * `--dev` writes a second artifact (`dist/client.dev.js`) in which the
 * development counters of PRD §1.3 stay enabled. The shipped artifact
 * (`dist/client.js`) is always a production build.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const dev = process.argv.includes('--dev')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundlePath = resolve(root, dev ? 'dist/client.dev.bundle.cjs' : 'dist/client.bundle.cjs')
const outPath = resolve(root, dev ? 'dist/client.dev.js' : 'dist/client.js')
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

await mkdir(resolve(root, 'dist'), { recursive: true })

await build({
  absWorkingDir: root,
  entryPoints: ['src/client/index.jsx'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome110'],
  external: ['react', '@deepseek-ai/dsh-client-ui-primitives'],
  loader: { '.css': 'text' },
  jsx: 'transform',
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
  legalComments: 'none',
  outfile: bundlePath,
  logLevel: 'info',
})

const bundle = await readFile(bundlePath, 'utf8')
const loader = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(packageJson.name)},
  factory: function(require) {
    var module = { exports: {} };
    var exports = module.exports;
${bundle}
    return module.exports;
  }
});
`
await writeFile(outPath, loader, 'utf8')
console.log(`built ${outPath} (${(loader.length / 1024).toFixed(1)} KiB)`)
