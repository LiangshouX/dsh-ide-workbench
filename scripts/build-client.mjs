/**
 * The shared client build of the two plugins.
 *
 * The DSH client module loader expects one script per package:
 *   window.__ModuleLoader__.load({ id, factory(require) { ... return { apply } } })
 * React comes from the browser module table (`require('react')` stays
 * external); everything else is bundled in, so a plugin works without any
 * other runtime dependency.
 *
 * The codeintel is built with the CodeMirror packages ALIASED to its own
 * Proxy shim: the CodeMirror runtime of the process belongs to the core
 * (PRD-v6 §3.5), and two copies of `@codemirror/state` would break every
 * `instanceof` check of the editor.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const dev = process.argv.includes('--dev')
const packageRoot = resolve(process.argv[2] ?? process.cwd())
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundlePath = resolve(packageRoot, dev ? 'dist/client.dev.bundle.cjs' : 'dist/client.bundle.cjs')
const outPath = resolve(packageRoot, dev ? 'dist/client.dev.js' : 'dist/client.js')
const packageJson = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))

const shimDirectory = resolve(packageRoot, 'src', 'client', 'vendor')
// The packages the codeintel must NOT bundle: the core owns the one
// CodeMirror runtime of the process (PRD-v6 §3.5). `@codemirror/lsp-client`
// is NOT in this list on purpose: its own code is needed, only its
// `@codemirror/*` dependencies are aliased to the shims.
//
// The core bundles the REAL packages - it is their owner.
const CM_PACKAGES = ['state', 'view', 'commands', 'language', 'search', 'autocomplete', 'lint']
const alias = {}
if (packageJson.name === 'dsh-ide-codeintel') {
  for (const name of CM_PACKAGES) {
    alias[`@codemirror/${name}`] = resolve(shimDirectory, `cm-${name}.js`)
  }
}

await mkdir(resolve(packageRoot, 'dist'), { recursive: true })

await build({
  absWorkingDir: packageRoot,
  entryPoints: [resolve(packageRoot, 'src', 'client', 'index.jsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome110'],
  external: ['react', '@deepseek-ai/dsh-client-ui-primitives'],
  alias,
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
