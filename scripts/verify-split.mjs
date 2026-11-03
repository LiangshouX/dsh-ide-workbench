/**
 * The mechanical acceptance of the split (PRD-v6 §5.5, R5 - R8, ISO-03).
 *
 * The acceptance of the split is mostly about what is NOT there, so it is
 * checked by reading the sources rather than by running them:
 *
 *   R5  no import crosses the two plugins;
 *   R6  the core carries no code intelligence (the white list is
 *       `closeBrackets` / `closeBracketsKeymap`);
 *   R7  the core has no language server dependency;
 *   R8  the core installs no completion extension;
 *   ISO-03  the core never spawns a language server.
 *
 * The script exits with a non-zero status when a check fails, so it can be
 * a step of the CI.
 */
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const core = resolve(root, 'packages', 'workbench')
const intel = resolve(root, 'packages', 'codeintel')

/**
 * Every source file of one package.
 * @param {string} directory the directory of the package
 * @returns {Promise<string[]>} the absolute paths
 */
async function sourcesOf(directory) {
  const out = []
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) { await walk(path); continue }
      if (/\.(js|jsx|mjs)$/.test(entry.name)) out.push(path)
    }
  }
  await walk(resolve(directory, 'src'))
  return out
}

/**
 * The text of one file.
 * @param {string} path the path
 * @returns {Promise<string>} the text
 */
const textOf = (path) => readFile(path, 'utf8')

/**
 * The code of one file: the comments are removed.
 *
 * The checks below are about what the code DOES, not about what it says: a
 * comment that mentions `@codemirror/lsp-client` to explain why the core does
 * NOT have it is not a violation.
 * @param {string} text the text of the file
 * @returns {string} the code without its comments
 */
function codeOf(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
}

/**
 * The module specifiers one file imports.
 * @param {string} text the text of the file
 * @returns {string[]} the specifiers
 */
function importsOf(text) {
  const specifiers = []
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) specifiers.push(match[1])
  }
  return specifiers
}

const results = []
/**
 * Record one check.
 * @param {string} name the name of the check
 * @param {boolean} ok whether it passed
 * @param {string} detail the detail
 */
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const coreSources = await sourcesOf(core)
const intelSources = await sourcesOf(intel)

// ── R5: no import crosses the two plugins ───────────────────────────────────
for (const [label, files, forbidden] of [
  ['core', coreSources, /dsh-ide-codeintel|codeintel/],
  ['codeintel', intelSources, /dsh-ide-workbench|workbench/],
]) {
  const hits = []
  for (const file of files) {
    for (const specifier of importsOf(codeOf(await textOf(file)))) {
      if (forbidden.test(specifier)) hits.push(`${relative(root, file)} → ${specifier}`)
    }
  }
  check(`R5  the ${label} does not import the other plugin`, hits.length === 0, hits.join('; '))
}

// ── R6: the core carries no code intelligence ───────────────────────────────
{
  const hits = []
  for (const file of coreSources) {
    const code = codeOf(await textOf(file))
    const relativePath = relative(core, file).split('\\').join('/')
    if (relativePath.startsWith('contract/')) continue
    if (/autocompletion\s*\(|@codemirror\/lsp-client|LSPPlugin|lspCompartment|\blsp\.[a-z]/i.test(code)) {
      hits.push(relativePath)
    }
  }
  check('R6  the core carries no code intelligence', hits.length === 0, hits.join(', '))
}

// ── R7: the core has no language server dependency ─────────────────────────
{
  const manifest = JSON.parse(await textOf(resolve(core, 'package.json')))
  const forbidden = ['typescript', 'basedpyright', 'yaml-language-server', 'typescript-language-server']
  const found = forbidden.filter(name => manifest.dependencies?.[name] !== undefined)
  check('R7  the core has no language server dependency', found.length === 0, found.join(', '))
}

// ── R8: the core installs no completion ─────────────────────────────────────
{
  const hits = []
  for (const file of coreSources) {
    if (/autocompletion\s*\(/.test(codeOf(await textOf(file)))) hits.push(relative(core, file))
  }
  check('R8  the core installs no completion extension', hits.length === 0, hits.join(', '))
}

// ── ISO-03: the core never spawns a language server ─────────────────────────
{
  const hits = []
  for (const file of coreSources) {
    if (/typescript-language-server|basedpyright|yaml-language-server|jdtls/i.test(codeOf(await textOf(file)))) {
      hits.push(relative(core, file))
    }
  }
  check('ISO-03  the core never names a language server', hits.length === 0, hits.join(', '))
}

// ── the codeintel owns the language servers ─────────────────────────────────
{
  const manifest = JSON.parse(await textOf(resolve(intel, 'package.json')))
  const needed = ['typescript', 'basedpyright', 'yaml-language-server', 'typescript-language-server']
  const missing = needed.filter(name => manifest.dependencies?.[name] === undefined)
  check('the codeintel carries the language servers', missing.length === 0, missing.join(', '))
}

// ── the artifacts exist ─────────────────────────────────────────────────────
for (const [label, directory] of [['core', core], ['codeintel', intel]]) {
  const manifest = JSON.parse(await textOf(resolve(directory, 'package.json')))
  const plugin = JSON.parse(await textOf(resolve(directory, 'dsh.plugin.json')))
  check(
    `the ${label} has a matching version in package.json and dsh.plugin.json`,
    manifest.version === plugin.version,
    `${manifest.version} != ${plugin.version}`,
  )
}

// ── the contract copies are in sync ─────────────────────────────────────────
{
  const source = await readFile(resolve(root, 'packages', 'contract', 'src', 'index.js'), 'utf8')
  const copies = await Promise.all([
    textOf(resolve(core, 'src', 'contract', 'index.js')),
    textOf(resolve(intel, 'src', 'contract', 'index.js')),
  ])
  check('the contract copies are in sync', copies.every(copy => copy === source))
}

// ── the worker of the codeintel is published ────────────────────────────────
{
  const manifest = JSON.parse(await textOf(resolve(intel, 'package.json')))
  const publishes = manifest.files.includes('src/host')
  const exists = existsSync(resolve(intel, 'src', 'host', 'lsp-worker.js'))
  check('the worker of the codeintel is published', publishes && exists)
}

// ── every file the entry imports is actually published ──────────────────────
//
// The defect behind the white screen of a core-only install: the split moved
// the contract into `src/contract/` and updated the imports, but the `files`
// whitelist of `package.json` was not extended. `npm pack` then shipped a
// package whose `src/index.js` imported a file that was not inside the
// tarball: the host half failed to import, the plugin never mounted, and the
// IDE tab of a previous version rendered an empty pane. A source-level check
// cannot see this - the file IS on disk - so the check walks the import graph
// of the published entry and asks the whitelist whether each file ships.
{
  /**
   * Whether one package-relative path is covered by the `files` whitelist.
   * npm's rules are simple enough for the shapes this repository uses:
   * a plain path, a directory prefix, or a `*`/`**` glob.
   * @param {string[]} files the `files` array of the manifest
   * @param {string} path package-relative path with forward slashes
   * @returns {boolean} whether npm would ship the file
   */
  const isPublished = (files, path) => files.some((entry) => {
    const target = String(entry).split('\\').join('/').replace(/\/+$/, '')
    if (target === path) return true
    if (path.startsWith(`${target}/`)) return true
    if (!target.includes('*')) return false
    const pattern = new RegExp(`^${target
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\u0000/g, '.*')}$`)
    return pattern.test(path)
  })

  /**
   * The package-relative files one entry imports, resolved on the disk.
   * @param {string} directory the package directory
   * @returns {Promise<string[]>} package-relative paths
   */
  const importedFilesOf = async (directory) => {
    const out = new Set()
    const queue = ['src/index.js']
    while (queue.length > 0) {
      const current = queue.shift()
      if (out.has(current)) continue
      out.add(current)
      const source = await textOf(resolve(directory, current))
      for (const match of source.matchAll(/(?:from|import)\s*\(?\s*'(\.[^']+)'/g)) {
        const base = resolve(directory, current, '..', match[1])
        const candidate = [base, `${base}.js`, `${base}.jsx`, join(base, 'index.js')]
          .find(path => existsSync(path) && /\.(js|jsx)$/.test(path))
        if (candidate === undefined) continue
        const rel = relative(directory, candidate).split('\\').join('/')
        // The published entry must not reach into another package.
        if (rel.startsWith('..')) continue
        queue.push(rel)
      }
    }
    return [...out]
  }

  for (const [label, directory] of [['core', core], ['codeintel', intel]]) {
    const manifest = JSON.parse(await textOf(resolve(directory, 'package.json')))
    const files = Array.isArray(manifest.files) ? manifest.files : []
    const imported = await importedFilesOf(directory)
    const unpublished = imported.filter(path => !isPublished(files, path))
    check(
      `every file the ${label} entry imports is published`,
      unpublished.length === 0,
      unpublished.join(', '),
    )
    // The two artifacts a plugin cannot run without: the host entry itself and
    // the client bundle the host serves.
    for (const required of ['src/index.js', 'dist/client.js', 'cordis.patch.yml', 'dsh.plugin.json']) {
      check(
        `the ${label} publishes ${required}`,
        existsSync(resolve(directory, required)) && isPublished(files, required),
      )
    }
  }
}

// ── the ONE CodeMirror runtime (the strongest form of R6 / ISO-03) ─────────
//
// The build of the codeintel ALIASES the CodeMirror packages to the shims,
// so its artifact must not contain a copy of the library. The marker is the
// error text of @codemirror/state itself - it is the proof that a second copy
// of the library would break the `instanceof` checks of the editor.
{
  const marker = 'Unrecognized extension value in extension set'
  const coreBundle = resolve(core, 'dist', 'client.js')
  const intelBundle = resolve(intel, 'dist', 'client.js')
  if (existsSync(coreBundle) && existsSync(intelBundle)) {
    const coreText = await textOf(coreBundle)
    const intelText = await textOf(intelBundle)
    check('the core bundles the CodeMirror runtime', coreText.includes(marker))
    check('the codeintel bundles NO copy of CodeMirror', !intelText.includes(marker))
    check(
      'the codeintel reaches the runtime through the shim',
      intelText.includes('dsh.ide-workbench.codemirror'),
    )
  } else {
    check('the artifacts exist (run npm run build first)', false, 'a dist/client.js is missing')
  }
}

// ── B1: the codeintel loads WITHOUT the core ────────────────────────────────
//
// The plugin installed alone must load without a console error: the guidance
// of DEG-01 is what the user sees, and it can only appear if the plugin
// loaded. The bundle is loaded into a bare sandbox - no CodeMirror runtime,
// no DOM - and it must not throw.
{
  const intelBundle = resolve(intel, 'dist', 'client.js')
  if (existsSync(intelBundle)) {
    const bundle = await textOf(intelBundle)
    try {
      // The DSH client module loader hands the plugin a `require` and gets
      // the module back. The stub below is that loader.
      let declaration = null
      const sandbox = {
        console,
        window: { __ModuleLoader__: { load: (value) => { declaration = value } } },
        document: { baseURI: 'http://dsh.internal/' },
        globalThis: undefined,
      }
      sandbox.globalThis = sandbox
      vm.runInNewContext(bundle, sandbox, { timeout: 5000 })
      if (declaration === null) throw new Error('the bundle did not register itself')
      // The bundle asks the loader for its externals (React and the host
      // primitives). They are stubs here: the check is about the module
      // LOADING, not about rendering.
      const stub = new Proxy(function () {}, {
        get: (_target, key) => (key === '__esModule' ? true : () => stub),
      })
      const exports = declaration.factory(() => stub)
      check(
        'the codeintel loads without the core (B1 / DEG-01)',
        exports !== null && typeof exports === 'object' && typeof exports.apply === 'function',
      )
    } catch (error) {
      check('the codeintel loads without the core (B1 / DEG-01)', false, String(error))
    }
  } else {
    check('the codeintel loads without the core (B1 / DEG-01)', false, 'the artifact is missing')
  }
}

const failed = results.filter(result => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
