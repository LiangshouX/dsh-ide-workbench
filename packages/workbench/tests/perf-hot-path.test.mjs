/**
 * The hot paths of the workbench (PRD-v5 §7.3, §7.4, §7.5).
 *
 *   - PERF-02: the file index is sorted with a plain comparison, not with
 *     `localeCompare` (the ICU collation is about six times slower, and the
 *     order was never promised to be a collation);
 *   - PERF-03: the CodeMirror language packages are *initialised* on demand.
 *     The product build (`scripts/build.mjs`) writes ONE file - a CommonJS
 *     script, without code splitting - so the thirteen language packages and
 *     their grammars are inlined in that file. What the dynamic import buys
 *     is therefore not a smaller bundle but a bundle whose language packages
 *     are not *evaluated* when the page loads: esbuild wraps every module of
 *     the dynamic graph in a lazy `__esm` initializer, and that initializer
 *     runs the first time a file of that language is opened. The tests below
 *     therefore build the artifact the product really ships - with the
 *     options of `scripts/build.mjs` - and measure that property. A test
 *     with a code-splitting configuration would measure a bundle the
 *     product does not build, and could stay green while the product does
 *     not do what it claims;
 *   - PERF-04: the stylesheet of the workbench is concatenated once, when
 *     the module is loaded, and not on every render.
 *
 * The client modules are bundled with esbuild (the same way
 * `tests/perf-slice-project.test.mjs` does), because this package has no
 * jsdom and the sources are JSX with CSS imports.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { listFiles } from '../src/host/search.js'
import { pdfLicenseBanner, pdfVirtualPlugin } from '../../../scripts/pdf-assets.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// The workspace hoists the packages to the root of the repository.
const repoRoot = resolve(root, '..', '..')
// The workspace hoists the packages to the root of the repository: the
// terminal stylesheet is resolved, not guessed.
const moduleRequire = createRequire(import.meta.url)
const require = createRequire(import.meta.url)

// A tiny DOM surface: the bundled client modules touch browser globals at
// import time, the helpers under test never read the DOM.
globalThis.window = {
  innerWidth: 1440,
  innerHeight: 900,
  location: { href: 'http://localhost/' },
  addEventListener() {},
  removeEventListener() {},
}
globalThis.self = globalThis.window
globalThis.HTMLElement = class HTMLElement {}
globalThis.Element = class Element {}
const elementStub = () => ({
  style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false },
  setAttribute() {}, removeAttribute() {}, remove() {}, appendChild() {}, insertBefore() {},
  addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
  querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  getContext: () => null,
})
globalThis.document = {
  baseURI: 'http://localhost/',
  documentElement: { ...elementStub(), style: {} },
  head: { appendChild() {} },
  body: { style: {}, appendChild() {}, removeChild() {} },
  createElement: elementStub,
  createElementNS: elementStub,
  createTextNode: () => ({ style: {}, remove() {} }),
  createRange: () => ({
    setStart() {}, setEnd() {},
    getBoundingClientRect: () => ({ top: 0, left: 0 }),
    getClientRects: () => [],
  }),
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener() {},
}
globalThis.window.getComputedStyle = () => ({ getPropertyValue: () => '', fontSize: '13px' })
globalThis.window.matchMedia = () => ({
  matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
})
globalThis.window.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0)
globalThis.window.cancelAnimationFrame = (handle) => clearTimeout(handle)
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  // The user agent is read by the terminal, which the product bundle carries
  // with it: the artifact is a browser script, and the test loads it.
  value: {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
    clipboard: { writeText: async () => {}, readText: () => '' },
  },
})
globalThis.ResizeObserver = class { observe() {} disconnect() {} }

/**
 * The thirteen language packages of the editor, and the grammars they pull in.
 *
 * `@lezer/common` and `@lezer/highlight` belong to the editor core and are
 * loaded with it; every other `@lezer/*` package is a grammar and belongs to
 * a language package.
 */
const LANGUAGE_PACKAGES = [
  'javascript', 'json', 'css', 'html', 'markdown', 'python',
  'java', 'sql', 'yaml', 'xml', 'cpp', 'go', 'rust',
]

/**
 * The grammars the language packages pull in.
 *
 * `@codemirror/lang-sql` has no grammar of its own - it reads SQL with a
 * stream parser - and the other twelve languages have one each.
 */
const GRAMMAR_PACKAGES = [
  'javascript', 'json', 'markdown', 'html', 'css', 'python',
  'java', 'yaml', 'xml', 'cpp', 'go', 'rust',
]

/** The esbuild options every client bundle of this file shares. */
const commonBuild = {
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node20'],
  external: ['react', 'react-dom', 'react-dom/server', '@deepseek-ai/dsh-client-ui-primitives'],
  alias: {
    '@xterm/xterm/css/xterm.css': moduleRequire.resolve('@xterm/xterm/css/xterm.css'),
    '@xterm/xterm': join(root, 'tests/stubs/xterm.js'),
    '@xterm/addon-fit': join(root, 'tests/stubs/addon-fit.js'),
    'virtual:pdf-worker': join(root, 'tests/stubs/pdf-worker.js'),
  },
  loader: { '.css': 'text' },
  jsx: 'transform',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
}

/**
 * The object literal of the esbuild call of a build script.
 *
 * The scan counts the braces and skips the strings and the comments, so the
 * literal is found whatever the script looks like.
 * @param {string} source the source of the build script
 * @returns {string} the literal of the call
 */
function buildCallLiteral(source) {
  const call = source.indexOf('await build(')
  assert.ok(call >= 0, 'the build script must call esbuild')
  const start = source.indexOf('{', call)
  assert.ok(start >= 0, 'the esbuild call must take an object literal')
  let depth = 0
  let quote = ''
  let index = start
  while (index < source.length) {
    const char = source[index]
    if (quote !== '') {
      if (char === '\\') { index += 2; continue }
      if (char === quote) quote = ''
      index += 1
      continue
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; index += 1; continue }
    if (char === '/' && source[index + 1] === '/') {
      const end = source.indexOf('\n', index)
      index = end < 0 ? source.length : end
      continue
    }
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index)
      index = end < 0 ? source.length : end + 2
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
    index += 1
  }
  throw new Error('the esbuild call of the build script is not an object literal')
}

/**
 * The esbuild options of the product build.
 *
 * The options are read from the shared builder of the repository
 * (`scripts/build-client.mjs`) instead of being repeated here: a test that
 * repeats the configuration of the build can drift away from it unnoticed,
 * and a test that has drifted is worse than no test at all. When the build
 * script changes shape, this helper fails loudly.
 * @param {string} outfile where the bundle is written
 * @returns {Promise<object>} the options of the product build
 */
async function productionBuildOptions(outfile) {
  const source = await readFile(resolve(root, '..', '..', 'scripts', 'build-client.mjs'), 'utf8')
  const literal = buildCallLiteral(source)
  // `dev` is false: the shipped artifact is always a production build.
  // The core bundles the REAL CodeMirror packages - it is their owner - so
  // the alias table of the builder is empty here.
  const options = vm.runInNewContext(`(${literal})`, {
    packageRoot: root,
    alias: {},
    dev: false,
    bundlePath: outfile,
    JSON,
    resolve,
    pdfVirtualPlugin,
    pdfLicenseBanner,
    banner: { js: pdfLicenseBanner() },
  })
  // The options come from another realm: a copy puts them back into this one,
  // so that a deep comparison against a plain array works. The plugin list is
  // the one exception: its entries are functions, which `structuredClone`
  // refuses - it is carried over as it is.
  const { plugins, ...rest } = options
  const cloned = structuredClone(rest)
  if (plugins !== undefined) cloned.plugins = plugins
  return cloned
}

/**
 * Build the client with the options of the product build.
 * @param {string} outfile where the bundle is written
 * @param {object} [extra] options that are added to the product ones
 * @returns {Promise<{text: string, bytes: number, outfile: string}>} the artifact
 */
async function buildProductBundle(outfile, extra = {}) {
  const options = await productionBuildOptions(outfile)
  await mkdir(dirname(outfile), { recursive: true })
  // A caller's plugin is ADDED to the plugins of the product build (the PDF
  // worker resolver); replacing them would build an artifact the product
  // never ships.
  const merged = { ...options, ...extra, logLevel: 'silent' }
  if (Array.isArray(extra.plugins)) merged.plugins = [...(options.plugins ?? []), ...extra.plugins]
  await build(merged)
  const text = await readFile(outfile, 'utf8')
  return { text, bytes: Buffer.byteLength(text), outfile }
}

/** The directory of the artifacts of this file. */
const workDir = join(root, '.render-tmp', 'perf-hot-path')

let productBundlePromise = null

/**
 * The artifact of the product build: one file, CommonJS, no code splitting.
 * @returns {Promise<{text: string, bytes: number, outfile: string}>} the artifact
 */
function productBundle() {
  if (productBundlePromise === null) {
    productBundlePromise = buildProductBundle(join(workDir, 'product', 'client.bundle.cjs'))
  }
  return productBundlePromise
}

/**
 * A plugin that marks the language packages.
 *
 * Every language package (and every grammar that belongs to one) appends one
 * line that pushes its own path into `globalThis.__iwbEvaluated`. That line
 * is the only change to the package: the module graph, the lazy `__esm`
 * wrappers and the dynamic imports are the ones of the product build. The
 * marker is what makes "the package was not evaluated" observable - without
 * it, a module that was never run and a module that was run look the same in
 * the artifact.
 */
const markerPlugin = {
  name: 'iwb-marker',
  setup(buildApi) {
    buildApi.onLoad({ filter: /[\\/]node_modules[\\/](@codemirror[\\/]lang-|@lezer[\\/])/ }, async (args) => {
      // The workspace hoists the packages to the root of the repository, so
      // the path of a module is relative to THAT root.
      const relative = args.path.slice(repoRoot.length + 1).replace(/\\/g, '/')
      // The editor core (`@lezer/common`, `@lezer/highlight`) is loaded with
      // the editor; the language packages and the grammars are the ones that
      // must wait for the first file of their language.
      if (!/^node_modules\/(@codemirror\/lang-[^/]+|@lezer\/(?!common|highlight)[^/]+)\//.test(relative)) return null
      const contents = await readFile(args.path, 'utf8')
      const marker = `;(globalThis.__iwbEvaluated = globalThis.__iwbEvaluated || []).push(${JSON.stringify(relative)});`
      return { contents: `${contents}\n${marker}\n`, loader: 'js' }
    })
  },
}

let instrumentedBundlePromise = null

/**
 * The product artifact, with the marker in the language packages.
 * @returns {Promise<{text: string, bytes: number, outfile: string}>} the artifact
 */
function instrumentedBundle() {
  if (instrumentedBundlePromise === null) {
    instrumentedBundlePromise = buildProductBundle(
      join(workDir, 'instrumented', 'client.bundle.cjs'),
      { plugins: [markerPlugin] },
    )
  }
  return instrumentedBundlePromise
}

const harnessPromises = new Map()

/**
 * The editor, bundled like the product and marked like the instrumented
 * artifact.
 *
 * The entry point is the only difference to the product build: the product
 * entry is the whole workbench, and the editor API is not exported by it.
 * The bundling is the one of the product - one file, CommonJS, no splitting
 * - so the language packages are inlined and initialized lazily, exactly as
 * they are in the shipped artifact.
 *
 * Every label gets its own file, and therefore its own module: a test that
 * watches the load of the editor needs an editor that was not loaded yet.
 * @param {string} [label] the name of the harness
 * @returns {Promise<{module: object, outfile: string}>} the editor module
 */
function editorHarness(label = 'default') {
  if (harnessPromises.has(label)) return harnessPromises.get(label)
  const promise = (async () => {
    const outfile = join(workDir, `harness-${label}`, 'editor.cjs')
    const options = await productionBuildOptions(outfile)
    await mkdir(dirname(outfile), { recursive: true })
    await build({
      ...options,
      logLevel: 'silent',
      plugins: [markerPlugin],
      entryPoints: undefined,
      stdin: {
        contents: `
export { languageKeyForPath, loadLanguageForPath } from './src/client/CodeEditor.jsx'
export { Compartment, EditorState } from '@codemirror/state'
export { language as languageFacet } from '@codemirror/language'
`,
        resolveDir: root,
        loader: 'js',
        sourcefile: 'perf-editor-entry.js',
      },
    })
    globalThis.__iwbEvaluated = []
    const module = require(outfile)
    return { module, outfile }
  })()
  harnessPromises.set(label, promise)
  return promise
}

/**
 * The lazy initializers of a bundle.
 *
 * esbuild wraps a module of a dynamic graph in `__esm({ "path"() { ... } })`:
 * the body of the module is a method of an object literal, and it only runs
 * when the initializer is called.
 * @param {string} text the bundle
 * @returns {Map<string, string>} the path of every module -> its initializer
 */
function lazyInitializers(text) {
  const initializers = new Map()
  for (const match of text.matchAll(/var (init_[A-Za-z0-9_$]+) = __esm\(\{\s*"([^"]+)"\(\) \{/g)) {
    initializers.set(match[2], match[1])
  }
  return initializers
}

/**
 * The initializer of the module whose path ends with the given suffix.
 *
 * The workspace hoists the packages to the root of the repository, so the
 * path of a module in the bundle is relative to the package and carries the
 * `../../` of the way back to the root. The suffix is what identifies it.
 * @param {Map<string, string>} initializers the initializers of the bundle
 * @param {string} suffix the end of the path of the module
 * @returns {string|undefined} the initializer, or undefined
 */
function initializerOf(initializers, suffix) {
  for (const [path, initializer] of initializers) {
    if (path.endsWith(suffix)) return initializer
  }
  return undefined
}

/**
 * Whether one of the paths ends with the given suffix.
 * @param {string[]} paths the paths
 * @param {string} suffix the end of the path
 * @returns {boolean} true when one of them matches
 */
function includesPath(paths, suffix) {
  return paths.some(path => path.endsWith(suffix))
}

/**
 * The size of the body of every lazy module of a bundle.
 *
 * The body is measured, because the truth about the product build is that
 * the language packages are *in* the file - the dynamic import only defers
 * their evaluation.
 * @param {string} text the bundle
 * @returns {Map<string, number>} the path of every module -> the bytes of its body
 */
function lazyModuleSizes(text) {
  const sizes = new Map()
  for (const match of text.matchAll(/var init_[A-Za-z0-9_$]+ = __esm\(\{\s*"([^"]+)"\(\) \{/g)) {
    const start = match.index + match[0].length
    let depth = 1
    let index = start
    let quote = ''
    while (index < text.length && depth > 0) {
      const char = text[index]
      if (quote !== '') {
        if (char === '\\') { index += 2; continue }
        if (char === quote) quote = ''
        index += 1
        continue
      }
      if (char === '"' || char === "'" || char === '`') { quote = char; index += 1; continue }
      if (char === '{') depth += 1
      else if (char === '}') depth -= 1
      index += 1
    }
    sizes.set(match[1], index - start)
  }
  return sizes
}

/**
 * Bundle the client entry and import it.
 * @returns {Promise<object>} the module of the client entry
 */
async function loadIndexBundle() {
  const dir = join(root, '.render-tmp', 'perf-index')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const outfile = join(dir, 'perf-index-entry.mjs')
  await build({
    ...commonBuild,
    stdin: {
      contents: `
export { WORKBENCH_CSS, Styles } from './src/client/index.jsx'
`,
      resolveDir: root,
      loader: 'js',
      sourcefile: 'perf-index-entry.js',
    },
    outfile,
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

/**
 * The order of the file index.
 *
 * The same plain comparison the host uses (PRD-v5 PERF-02): the code-unit
 * order of the path, a total order and therefore a predictable one.
 * @param {string} left the first path
 * @param {string} right the second path
 * @returns {number} -1, 0 or 1
 */
function comparePaths(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

/**
 * A realistic list of project paths.
 * @param {number} count how many paths
 * @returns {string[]} the paths
 */
function manyPaths(count = 50_000) {
  const dirs = ['src', 'src/client', 'src/host', 'tests', 'docs', 'packages/ui/src']
  const names = ['index', 'main', 'util', 'helper', 'CodeEditor', 'Workbench', 'store']
  const exts = ['.js', '.jsx', '.mjs', '.ts', '.tsx', '.json', '.css', '.md']
  const paths = []
  for (let index = 0; index < count; index += 1) {
    const dir = dirs[index % dirs.length]
    const name = names[(index * 7) % names.length]
    const ext = exts[(index * 3) % exts.length]
    paths.push(`${dir}/${name}-${index % 977}${ext}`)
  }
  return paths
}

/**
 * The fastest of three rounds - the minimum is the round the scheduler did
 * not interrupt.
 * @param {() => void} round the measured round
 * @returns {number} the milliseconds of the fastest round
 */
function fastestOfThree(round) {
  const times = []
  for (let index = 0; index < 3; index += 1) {
    const started = performance.now()
    round()
    times.push(performance.now() - started)
  }
  return Math.min(...times)
}

test('PERF-02: the plain comparison sorts 50,000 paths far faster than the collation', () => {
  const paths = manyPaths()
  const sort = (compare) => {
    const copy = paths.slice()
    copy.sort(compare)
    return copy
  }
  const plain = fastestOfThree(() => sort(comparePaths))
  const collated = fastestOfThree(() => sort((left, right) => left.localeCompare(right)))
  // Measured on the development machine (i5-10300H @ 2.5 GHz, Windows,
  // Node 22): the plain comparison ≈ 50 ms, `localeCompare` ≈ 330 ms - the
  // same ≈ 6x factor the PRD measured.
  //
  // The RATIO is the assertion that matters: both sorts pay the same load of
  // a busy machine, so the factor survives it. The absolute bound is only
  // there to catch a pathological regression (a locale-aware comparator that
  // slipped back in, a quadratic sort) - and it has to be generous enough
  // that a machine that runs the whole test suite in parallel does not fail
  // it: the suite runs the test FILES in parallel, and a sort that is
  // contending for the CPU with a dozen of them takes two to three times
  // its own time. The bound was 100 ms and the measurement is ≈ 50 ms, so it
  // failed about every third run of the suite on a busy machine (the review
  // round of 2026-11-01 hit it twice in five runs). 400 ms is still eight
  // times the measurement and far below the ≈ 330 ms of the collation, so a
  // comparator that reverted to the collation would still fail the bound.
  assert.ok(plain < 400, `the plain comparison took ${plain.toFixed(1)} ms`)
  if (process.platform === 'win32') {
    // The RATIO is the assertion that matters on the platform the factor was
    // measured on: both sorts pay the same load of a busy machine, so the
    // factor survives it.
    //
    // The factor is a property of the platform's collation data: on Linux the
    // collation of these ASCII paths is only a little slower than the plain
    // comparison (measured: 21.7 ms vs 28.3 ms), so a factor of three cannot
    // be asserted there. The comparator the production code uses is pinned by
    // the next test (the order of the file index), not by this one - this one
    // only measures how fast the two comparators are on this machine.
    assert.ok(
      plain * 3 < collated,
      `the plain comparison took ${plain.toFixed(1)} ms, the collation ${collated.toFixed(1)} ms`,
    )
  }
})

test('PERF-02: the file index is ordered by the plain comparison, and the order is stable', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'iwb-perf-order-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  // The names differ in case on purpose: the collation would put 'a.ts'
  // before 'B.ts', the code-unit order puts 'B.ts' first.
  await writeFile(join(dir, 'B.ts'), 'export const b = 1\n')
  await writeFile(join(dir, 'a.ts'), 'export const a = 1\n')
  await writeFile(join(dir, 'c.ts'), 'export const c = 1\n')
  const env = { root: dir, workspaceRoot: dir, prefix: '', isRepo: false }

  const first = await listFiles(env)
  const second = await listFiles(env)
  assert.deepEqual(first.files, ['B.ts', 'a.ts', 'c.ts'])
  // The same input always gives the same output.
  assert.deepEqual(second.files, first.files)
  // The order is the plain one, and it is a total order.
  assert.deepEqual(first.files, [...first.files].sort(comparePaths))
  for (let index = 1; index < first.files.length; index += 1) {
    assert.ok(comparePaths(first.files[index - 1], first.files[index]) < 0)
  }
})

test('PERF-03: the production bundle defers the language packages to the first file of that language', async () => {
  const artifact = await productBundle()
  const text = artifact.text

  // The language packages are not statically required. Nothing of them is:
  // the product build has no chunk to require them from.
  assert.doesNotMatch(text, /require\(["']@codemirror\/lang-/)
  assert.doesNotMatch(text, /require\(["']@lezer\/(javascript|json|markdown|html|css|python|java|yaml|xml|cpp|go|rust)["']/)

  // Every language package is in the bundle - but only as a lazy initializer.
  // The body of the module is a method of the object literal that `__esm`
  // gets, and it only runs when the initializer is called.
  const initializers = lazyInitializers(text)
  assert.ok(initializers.size > 0, 'the bundle must have lazy initializers')
  for (const name of LANGUAGE_PACKAGES) {
    const path = `node_modules/@codemirror/lang-${name}/dist/index.js`
    assert.ok(initializerOf(initializers, path) !== undefined, `the ${name} package must be in the bundle`)
  }
  // The grammars belong to the language packages, and they are in the file
  // as well.
  for (const name of GRAMMAR_PACKAGES) {
    const path = `node_modules/@lezer/${name}/dist/index.js`
    assert.ok(initializerOf(initializers, path) !== undefined, `the ${name} grammar must be in the bundle`)
  }

  // The initializers are reached through the dynamic-import promise: sixteen
  // loaders for thirteen language packages (the JavaScript variants share
  // one package), plus the PDF engine, which is loaded on the first PDF.
  const promiseSites = [...text.matchAll(/Promise\.resolve\(\)\.then\(\(\) => \((init_[A-Za-z0-9_$]+)\(\), /g)]
  assert.equal(promiseSites.length, 17, `seventeen loaders are expected, found ${promiseSites.length}`)
  const promised = new Set(promiseSites.map(match => match[1]))
  assert.equal(promised.size, 14, `fourteen modules are loaded on demand (thirteen packages and the PDF engine), found ${promised.size}`)
  for (const name of LANGUAGE_PACKAGES) {
    const initializer = initializerOf(initializers, `node_modules/@codemirror/lang-${name}/dist/index.js`)
    assert.ok(promised.has(initializer), `the ${name} package must be reached through the dynamic import`)
  }

  // The truth about the product build: the dynamic import does NOT take the
  // packages out of the file. They are inlined - the single file carries
  // their code (measured on the shipped artifact: ≈ 880 KB of language
  // packages and grammars), and the file is bigger than it was with static
  // imports. A test that claimed the opposite would be lying about the
  // product.
  const sizes = lazyModuleSizes(text)
  const inline = [...sizes.entries()]
    .filter(([path]) => path.includes('@codemirror/lang-') || path.includes('@lezer/'))
    .reduce((sum, [, bytes]) => sum + bytes, 0)
  assert.ok(inline > 400_000, `the language packages must be inlined in the file, found ${inline} bytes`)
  assert.match(text, /jsonLanguage/, 'the code of the language packages must be in the file')
})

test('PERF-03: the artifact of the test is the artifact of the product', async (t) => {
  const artifact = await productBundle()
  const options = await productionBuildOptions(artifact.outfile)

  // The options are the ones of the shared builder - and they are the ones
  // that make the artifact a single CommonJS file.
  assert.equal(options.format, 'cjs')
  assert.equal(options.bundle, true)
  assert.equal(options.platform, 'browser')
  assert.equal(options.splitting, undefined, 'the product build does not split')
  assert.equal(options.outdir, undefined, 'the product build writes one file')
  assert.equal(typeof options.outfile, 'string')
  assert.equal(options.entryPoints.length, 1, 'the product build has one entry point')
  assert.match(options.entryPoints[0], /src[\\/]client[\\/]index\.jsx$/, 'the entry point is the client entry')
  assert.deepEqual(options.target, ['chrome110'])

  // One file, and nothing else: a build with splitting would drop the
  // language packages into chunks of their own.
  const files = await readdir(dirname(artifact.outfile))
  assert.deepEqual(files, ['client.bundle.cjs'])

  // It is a CommonJS script: esbuild hands the exports to `module.exports`,
  // and the packages that stay external are required - that is the contract
  // of the client loader, which hands the artifact to `require`.
  assert.match(artifact.text, /module\.exports = __toCommonJS\(/)
  assert.match(artifact.text, /require\("react"\)/)
  // An ESM bundle would end with an `export { ... }` statement.
  assert.doesNotMatch(artifact.text, /\nexport \{/)

  // The shipped artifact has the same shape. It is not built here (the build
  // writes into `dist/`), but it is the artifact the product serves, and it
  // must not be a code-split bundle either.
  let shipped = null
  try {
    shipped = await readFile(join(root, 'dist/client.bundle.cjs'), 'utf8')
  } catch {
    shipped = null
  }
  if (shipped === null) {
    t.diagnostic('dist/client.bundle.cjs is not built here: the product artifact was not compared')
    return
  }
  assert.doesNotMatch(shipped, /require\(["']@codemirror\/lang-/)
  assert.equal(
    (shipped.match(/__esm\(\{/g) ?? []).length,
    (artifact.text.match(/__esm\(\{/g) ?? []).length,
    'the shipped artifact must have the same number of lazy initializers',
  )
  assert.equal(
    (shipped.match(/Promise\.resolve\(\)\.then\(\(\) => \(init_/g) ?? []).length,
    (artifact.text.match(/Promise\.resolve\(\)\.then\(\(\) => \(init_/g) ?? []).length,
    'the shipped artifact must have the same number of dynamic imports',
  )
  assert.equal(
    [...lazyInitializers(shipped).keys()].sort().join('\n'),
    [...lazyInitializers(artifact.text).keys()].sort().join('\n'),
    'the shipped artifact must carry the same modules',
  )
})

test('PERF-03: the product bundle evaluates no language package when it loads', async () => {
  const artifact = await instrumentedBundle()
  // The load itself is the measurement: the marker of every language package
  // and every grammar tells whether the package was evaluated.
  globalThis.__iwbEvaluated = []
  const module = require(artifact.outfile)
  // The artifact is a CommonJS module: the client loader hands it to
  // `require` as well.
  assert.equal(typeof module.apply, 'function')
  assert.deepEqual(
    globalThis.__iwbEvaluated,
    [],
    `no language package may be evaluated when the bundle loads, found ${globalThis.__iwbEvaluated.join(', ')}`,
  )
})

test('PERF-03: the editor renders before the language package arrives, and the grammar replaces it', async () => {
  const { module } = await editorHarness('behaviour')
  const { Compartment, EditorState, languageFacet, languageKeyForPath, loadLanguageForPath } = module

  // The language of a file is known before its package is there.
  assert.equal(languageKeyForPath('src/app.tsx'), 'javascript-tsx')
  assert.equal(languageKeyForPath('src/app.py'), 'python')
  assert.equal(languageKeyForPath('notes.txt'), '')
  assert.equal(languageKeyForPath('src/app.unknownext'), '')

  // The editor starts without a grammar - CodeMirror is perfectly happy with
  // that, and the document is rendered as plain text.
  const compartment = new Compartment()
  const languageOf = state => state.facet(languageFacet, false) ?? null
  let state = EditorState.create({ doc: 'const a = 1\n', extensions: [compartment.of([])] })
  assert.equal(state.doc.toString(), 'const a = 1\n')
  assert.equal(languageOf(state), null)

  // The package arrives, and the compartment takes the grammar in place.
  const typescript = await loadLanguageForPath('src/app.tsx')
  assert.equal(typescript.length, 1)
  state = state.update({ effects: compartment.reconfigure(typescript) }).state
  const language = languageOf(state)
  assert.ok(language !== null, 'the document is highlighted once the package arrived')
  assert.match(language.name, /typescript/)

  // A file that changes its language gets the grammar of the new language -
  // the old one is gone.
  const python = await loadLanguageForPath('src/app.py')
  state = state.update({ effects: compartment.reconfigure(python) }).state
  const switched = languageOf(state)
  assert.ok(switched !== null)
  assert.match(switched.name, /python/)
  assert.notEqual(switched.name, language.name)

  // A file without a language stays plain text.
  const plain = await loadLanguageForPath('notes.txt')
  assert.deepEqual(plain, [])
  state = state.update({ effects: compartment.reconfigure(plain) }).state
  assert.equal(languageOf(state), null)
})

test('PERF-03: the language package is evaluated when the file of that language is opened', async () => {
  // A harness of its own: this test watches the load of the editor, so the
  // editor must not have been loaded before.
  const { module } = await editorHarness('timing')
  const evaluated = globalThis.__iwbEvaluated
  // Nothing has been evaluated yet: the editor was loaded, the grammar was
  // not asked for.
  assert.deepEqual(evaluated, [], 'the editor load must not evaluate a language package')

  await module.loadLanguageForPath('src/app.tsx')
  // Now the package of the language of the file - and its grammar - are
  // evaluated. That is what the dynamic import bought: the work of the
  // package happens when the package is needed, and not before.
  assert.ok(
    includesPath(evaluated, 'node_modules/@codemirror/lang-javascript/dist/index.js'),
    `the javascript package must be evaluated, found ${evaluated.join(', ')}`,
  )
  assert.ok(
    includesPath(evaluated, 'node_modules/@lezer/javascript/dist/index.js'),
    'the grammar of the language must be evaluated with the package',
  )
})

test('PERF-03 (source level): the editor source has no static import of a language package', async () => {
  const source = await readFile(join(root, 'src/client/CodeEditor.jsx'), 'utf8')
  assert.doesNotMatch(source, /^\s*import\s+.*from\s+'@codemirror\/lang-/m)
  assert.doesNotMatch(source, /require\('@codemirror\/lang-/)
  // Every package is reached through a dynamic import: sixteen expressions
  // for thirteen packages (the JavaScript variants share one package).
  const loaders = [...source.matchAll(/import\('(@codemirror\/lang-[^']+)'\)/g)].map(match => match[1])
  assert.equal(loaders.length, 16, `sixteen loaders are expected, found ${loaders.length}`)
  assert.equal(new Set(loaders).size, 13, 'thirteen packages are loaded on demand')
  // The grammar starts empty and is replaced when the package arrives.
  assert.match(source, /languageCompartment\.of\(\[\]\)/)
  assert.match(source, /languageCompartment\.reconfigure\(extension\)/)
})

test('PERF-04: the stylesheet is built once, not on every render', async () => {
  const source = await readFile(join(root, 'src/client/index.jsx'), 'utf8')
  // The concatenation happens exactly once, and it is a module constant: it
  // stands above the `apply` function, so it is evaluated when the module is
  // loaded and not when a Session renders.
  const concatenations = source.split('${xtermCss}').length - 1
  assert.equal(concatenations, 1, 'the stylesheet is concatenated exactly once')
  const applyIndex = source.indexOf('export function apply(')
  const concatenationIndex = source.indexOf('${xtermCss}')
  assert.ok(concatenationIndex >= 0 && concatenationIndex < applyIndex, 'the concatenation is a module constant')
  // The render function itself does not build the string.
  const stylesIndex = source.indexOf('export const Styles')
  const stylesEnd = source.indexOf('\n', source.indexOf('WORKBENCH_CSS)', stylesIndex))
  assert.ok(stylesIndex >= 0)
  assert.doesNotMatch(source.slice(stylesIndex, stylesEnd), /\$\{/, 'the render function must not build the string')

  const module = await loadIndexBundle()
  assert.equal(typeof module.WORKBENCH_CSS, 'string')
  // The constant carries both stylesheets: the terminal one and the
  // workbench one.
  assert.ok(module.WORKBENCH_CSS.includes('.xterm'), 'the terminal stylesheet is part of it')
  assert.ok(module.WORKBENCH_CSS.includes('.iwb-root'), 'the workbench stylesheet is part of it')
  // Every render uses the very same string: the module hands out one
  // instance, and the element carries it unchanged.
  assert.equal(module.WORKBENCH_CSS, module.WORKBENCH_CSS)
  const first = module.Styles()
  const second = module.Styles()
  assert.equal(first.props.children, module.WORKBENCH_CSS)
  assert.equal(second.props.children, module.WORKBENCH_CSS)
})
