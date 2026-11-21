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
import { pdfLicenseBanner, pdfVirtualPlugin } from './pdf-assets.mjs'
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

// PDF.js is bundled into the core artifact only (Apache-2.0): its license
// rides along with the code that carries it. The codeintel never imports
// the engine, so it does not get the banner.
const banner = packageJson.name === 'dsh-ide-workbench' ? { js: pdfLicenseBanner() } : {}

/**
 * The `@font-face` rules of the two faces of the workbench.
 *
 * The workbench USED to ask for Inter and JetBrains Mono and hope the
 * machine had them. Most machines do not - a Windows box has Segoe UI and
 * Consolas - and the workbench looked like every other tool on it. The faces
 * are therefore SHIPPED with the plugin: the latin subset of the variable
 * Inter and of the variable JetBrains Mono, inlined as data URIs.
 *
 * They are inlined rather than fetched for two reasons: the plugin cannot
 * count on the host serving a static file of its package, and a font that
 * has to be fetched would be a second request per face.
 *
 * The rules are injected into the built stylesheet through a PLACEHOLDER, so
 * the source of the client stays free of binary imports: every test suite
 * bundles the client with a plain esbuild call, and a `.woff2` import would
 * need a loader in each of them.
 *
 * @param {string} packageRoot the root of the package
 * @returns {Promise<string>} the CSS of the faces, '' when there are none
 */
async function fontFacesOf(packageRoot) {
  const faces = [
    { file: 'inter-latin-opsz-normal.woff2', family: 'Inter', weights: '100 900' },
    { file: 'jetbrains-mono-latin-wght-normal.woff2', family: 'JetBrains Mono', weights: '100 800' },
  ]
  const rules = []
  for (const face of faces) {
    const path = resolve(packageRoot, 'assets', 'fonts', face.file)
    let bytes
    try {
      bytes = await readFile(path)
    } catch {
      continue
    }
    const url = `data:font/woff2;base64,${bytes.toString('base64')}`
    rules.push(
      `@font-face{font-family:'${face.family}';font-style:normal;font-weight:${face.weights};` +
      `font-display:swap;src:url(${url}) format('woff2');}`,
    )
  }
  return rules.join('\n')
}

await build({
  absWorkingDir: packageRoot,
  entryPoints: [resolve(packageRoot, 'src', 'client', 'index.jsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome110'],
  external: ['react', '@deepseek-ai/dsh-client-ui-primitives'],
  alias,
  plugins: [pdfVirtualPlugin()],
  banner,
  loader: { '.css': 'text' },
  jsx: 'transform',
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
  // The bundle carries PDF.js (Apache-2.0): its `@licstart` block must
  // survive the build. `eof` collects the legal comments at the end instead
  // of dropping them with the rest of the minification.
  legalComments: 'eof',
  outfile: bundlePath,
  logLevel: 'info',
})

const bundle = await readFile(bundlePath, 'utf8')
// The faces of the workbench take the place of the placeholder in the
// stylesheet. The placeholder is a comment, so a build without the fonts
// (the codeintel) simply keeps it.
const fontFaces = await fontFacesOf(packageRoot)
const styled = fontFaces === '' ? bundle : bundle.replace('/*__DSH_FONT_CSS__*/', fontFaces)
const loader = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(packageJson.name)},
  factory: function(require) {
    var module = { exports: {} };
    var exports = module.exports;
${styled}
    return module.exports;
  }
});
`
await writeFile(outPath, loader, 'utf8')
console.log(`built ${outPath} (${(loader.length / 1024).toFixed(1)} KiB${fontFaces === '' ? '' : `, ${(fontFaces.length / 1024).toFixed(1)} KiB of faces`})`)
