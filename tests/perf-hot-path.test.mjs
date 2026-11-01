/**
 * The hot paths of the workbench (PRD-v5 §7.3, §7.4, §7.5).
 *
 *   - PERF-02: the file index is sorted with a plain comparison, not with
 *     `localeCompare` (the ICU collation is about six times slower, and the
 *     order was never promised to be a collation);
 *   - PERF-03: the CodeMirror language packages are loaded on demand, so
 *     they are not part of the static module graph of the client bundle;
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
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { listFiles } from '../src/host/search.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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
  removeEventListener() {},
}
globalThis.window.getComputedStyle = () => ({ getPropertyValue: () => '', fontSize: '13px' })
globalThis.window.matchMedia = () => ({
  matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
})
globalThis.window.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0)
globalThis.window.cancelAnimationFrame = (handle) => clearTimeout(handle)
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { clipboard: { writeText: async () => {}, readText: () => '' } },
})
globalThis.ResizeObserver = class { observe() {} disconnect() {} }

/** The esbuild options every client bundle of this file shares. */
const commonBuild = {
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node20'],
  external: ['react', 'react-dom', 'react-dom/server', '@deepseek-ai/dsh-client-ui-primitives'],
  alias: {
    '@xterm/xterm/css/xterm.css': join(root, 'node_modules/@xterm/xterm/css/xterm.css'),
    '@xterm/xterm': join(root, 'tests/stubs/xterm.js'),
    '@xterm/addon-fit': join(root, 'tests/stubs/addon-fit.js'),
  },
  loader: { '.css': 'text' },
  jsx: 'transform',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
}

/**
 * Bundle the editor with code splitting and import it.
 *
 * The splitting is what makes the static graph observable: a package that is
 * only reached through a dynamic import ends up in its own chunk, and the
 * metafile then says so.
 * @returns {Promise<{module: object, meta: object}>}
 */
async function loadEditorBundle() {
  const dir = join(root, '.render-tmp', 'perf-editor')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const result = await build({
    ...commonBuild,
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
    splitting: true,
    outdir: dir,
    metafile: true,
  })
  const outputs = Object.entries(result.metafile.outputs)
  // The entry chunk is the one of the source of this test; every other chunk
  // with an entry point is a language package that is imported on demand.
  const entry = outputs.find(([, info]) => info.entryPoint !== undefined
    && !info.entryPoint.includes('node_modules/'))
  assert.ok(entry !== undefined, 'the bundle has an entry chunk')
  const entryFile = join(root, entry[0])
  const module = await import(`${pathToFileURL(entryFile).href}?t=${Date.now()}`)
  return { module, meta: result.metafile }
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
  // same ≈ 6x factor the PRD measured. The bound below is generous on
  // purpose: a busy machine must not fail the test, and the factor is what
  // the change is about.
  assert.ok(plain < 100, `the plain comparison took ${plain.toFixed(1)} ms`)
  assert.ok(
    plain * 3 < collated,
    `the plain comparison took ${plain.toFixed(1)} ms, the collation ${collated.toFixed(1)} ms`,
  )
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

test('PERF-03: the language packages are not part of the static module graph', async () => {
  const { meta } = await loadEditorBundle()
  const outputs = Object.entries(meta.outputs)
  const entry = outputs.find(([, info]) => info.entryPoint !== undefined
    && !info.entryPoint.includes('node_modules/'))
  assert.ok(entry !== undefined, 'the bundle has an entry chunk')
  const [entryPath, entryInfo] = entry
  const entryInputs = Object.keys(entryInfo.inputs)

  // No language package and no grammar may be reachable without a dynamic
  // import: a static import anywhere in the module graph would put all of
  // them back into the bundle.
  const languagePackages = entryInputs.filter(input => input.includes('@codemirror/lang-'))
  assert.deepEqual(languagePackages, [], 'the language packages must not be in the static graph')
  // `@lezer/common`, `@lezer/lr` and `@lezer/highlight` belong to the editor
  // core and stay where they are; the grammars belong to the language
  // packages and have to move out with them.
  const grammars = entryInputs.filter(input => input.includes('@lezer/')
    && !input.includes('@lezer/common/')
    && !input.includes('@lezer/lr/')
    && !input.includes('@lezer/highlight/'))
  assert.deepEqual(grammars, [], 'the grammars must not be in the static graph')

  // They are not gone either: every package is in a chunk of its own, which
  // is only loaded when a file of that language is opened.
  const dynamicChunks = outputs.filter(([path, info]) => path !== entryPath
    && Object.keys(info.inputs).some(input => input.includes('@codemirror/lang-')))
  const packages = new Set(dynamicChunks.flatMap(([, info]) => Object.keys(info.inputs)
    .filter(input => input.includes('@codemirror/lang-'))))
  assert.equal(packages.size, 13, `every language package has to be a dynamic chunk, found ${packages.size}`)
})

test('PERF-03: the editor renders before the language package arrives, and the grammar replaces it', async () => {
  const { module } = await loadEditorBundle()
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

test('PERF-03: the editor source has no static import of a language package', async () => {
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
