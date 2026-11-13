/**
 * The tree search of the Project panel — the pure part of it.
 *
 *   - the file name is what the search matches on, and the case does not
 *     matter;
 *   - the name index is sorted with the PLAIN comparison of the repository
 *     (never `localeCompare` - the ICU collation is about six times slower);
 *   - a lookup is a binary search plus the walk over the block of the names
 *     that share the prefix: O(log n + k), not a scan over every file;
 *   - the chain of the match is the set of folders that lead to it, and the
 *     visibility layer keeps the rows of that chain and the match - and only
 *     those.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildNameIndex,
  buildPathIndex,
  expandPathsOf,
  findByPrefix,
  findByText,
  nameOf,
  visibleTreeRows,
} from '../src/client/tree-search.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The name of a path is its last segment. */
test('the name of a path is its last segment, in lower case', () => {
  assert.equal(nameOf('src/client/client-api.d.ts'), 'client-api.d.ts')
  assert.equal(nameOf('client-api.ts'), 'client-api.ts')
  assert.equal(nameOf('src/client/Client-API.TS'), 'client-api.ts')
  assert.equal(nameOf('src\\client\\client-api.ts'), 'client-api.ts')
  assert.equal(nameOf(''), '')
  assert.equal(nameOf(undefined), '')
})

/** The index sorts the names with the plain comparison. */
test('the name index is sorted with the plain comparison, not with the collation', () => {
  const index = buildNameIndex([
    'src/a.ts',
    'src/B.ts',
    'src/c.ts',
  ])
  // The code-unit order puts the upper case first: the collation of
  // `localeCompare` would not.
  assert.deepEqual(index.names, ['a.ts', 'b.ts', 'c.ts'])
  assert.deepEqual(index.paths, ['src/a.ts', 'src/B.ts', 'src/c.ts'])
  assert.equal(index.count, 3)
  // The names are the lowercased file names, and the paths keep the order of
  // the names.
  assert.deepEqual(index.names, index.names.map(name => name.toLowerCase()))
})

test('the name index keeps the order of the index for two files of the same name', () => {
  const index = buildNameIndex([
    'a/one.ts',
    'b/one.ts',
    'c/two.ts',
  ])
  assert.deepEqual(index.names, ['one.ts', 'one.ts', 'two.ts'])
  assert.deepEqual(index.paths, ['a/one.ts', 'b/one.ts', 'c/two.ts'])
})

test('the name index of nothing is empty', () => {
  const index = buildNameIndex([])
  assert.equal(index.count, 0)
  assert.deepEqual(index.names, [])
  assert.deepEqual(index.paths, [])
  assert.deepEqual(findByPrefix(index, 'a'), [])
})

/** The lookup: the prefix of the file name, and nothing else. */
test('the lookup finds the files whose name starts with the query', () => {
  const index = buildNameIndex([
    'packages/workbench/src/client-api.d.ts',
    'packages/workbench/src/client-api.ts',
    'packages/workbench/src/client-api.js',
    'packages/workbench/src/other.ts',
  ])
  assert.deepEqual(findByPrefix(index, 'client-api'), [
    'packages/workbench/src/client-api.d.ts',
    'packages/workbench/src/client-api.js',
    'packages/workbench/src/client-api.ts',
  ])
})

test('the lookup does not care about the case', () => {
  const index = buildNameIndex(['src/Client-API.ts'])
  assert.deepEqual(findByPrefix(index, 'client-api'), ['src/Client-API.ts'])
  assert.deepEqual(findByPrefix(index, 'CLIENT-API'), ['src/Client-API.ts'])
})

test('the lookup matches the name of the file, not the text of its path', () => {
  const index = buildNameIndex(['packages/workbench/src/client-api.ts'])
  // `packages` is a folder of the path, not the name of a file.
  assert.deepEqual(findByPrefix(index, 'packages'), [])
  assert.deepEqual(findByPrefix(index, 'workbench'), [])
})

test('the lookup of an empty query finds nothing', () => {
  const index = buildNameIndex(['src/a.ts'])
  assert.deepEqual(findByPrefix(index, ''), [])
  assert.deepEqual(findByPrefix(index, '   '), [])
})

test('the lookup stops at the limit', () => {
  const paths = []
  for (let index = 0; index < 1000; index += 1) paths.push(`src/client-api-${index}.ts`)
  const index = buildNameIndex(paths)
  assert.equal(findByPrefix(index, 'client-api', 300).length, 300)
  assert.equal(findByPrefix(index, 'client-api', 1).length, 1)
  // Without a limit every match comes back.
  assert.equal(findByPrefix(index, 'client-api').length, 1000)
})

test('the lookup of a name that is not there finds nothing', () => {
  const index = buildNameIndex(['src/a.ts', 'src/b.ts'])
  assert.deepEqual(findByPrefix(index, 'zzz'), [])
})

/* ── the file list: the WHOLE path, not only the name of the file ───────── */

/** The path index is the lowercased twin of the file index. */
test('the path index carries the lowercased paths of the file index', () => {
  const paths = ['packages/workbench/src/Client-API.ts', 'a.ts']
  const index = buildPathIndex(paths)
  assert.equal(index.count, 2)
  assert.deepEqual(index.paths, paths)
  assert.deepEqual(index.lowered, ['packages/workbench/src/client-api.ts', 'a.ts'])
})

/** The old semantics of the file list: the whole path, case-insensitively. */
test('the file list matches the whole path, and not only the name of the file', () => {
  const paths = [
    'packages/workbench/src/client-api.ts',
    'packages/workbench/src/other.ts',
    'docs/readme.md',
  ]
  const index = buildPathIndex(paths)
  // A folder name lists the files under that folder.
  assert.deepEqual(findByText(index, 'packages'), [
    'packages/workbench/src/client-api.ts',
    'packages/workbench/src/other.ts',
  ])
  // A part of a path does as well.
  assert.deepEqual(findByText(index, 'workbench/src'), [
    'packages/workbench/src/client-api.ts',
    'packages/workbench/src/other.ts',
  ])
  // The name of a file is a part of its path, so it is found as well.
  assert.deepEqual(findByText(index, 'client-api'), ['packages/workbench/src/client-api.ts'])
})

test('the file list does not care about the case', () => {
  const index = buildPathIndex(['Packages/Workbench/Client-API.ts'])
  assert.deepEqual(findByText(index, 'packages'), ['Packages/Workbench/Client-API.ts'])
  assert.deepEqual(findByText(index, 'CLIENT-API'), ['Packages/Workbench/Client-API.ts'])
})

test('the file list stops at the limit', () => {
  const paths = []
  for (let index = 0; index < 1000; index += 1) paths.push(`src/client-api-${index}.ts`)
  const index = buildPathIndex(paths)
  assert.equal(findByText(index, 'client-api', 300).length, 300)
  assert.equal(findByText(index, 'client-api', 1).length, 1)
  assert.equal(findByText(index, 'client-api').length, 1000)
})

test('the file list of an empty query finds nothing', () => {
  const index = buildPathIndex(['src/a.ts'])
  assert.deepEqual(findByText(index, ''), [])
  assert.deepEqual(findByText(index, 'zzz'), [])
})

/** The chain of the match. */
test('the chain of a match is every folder between the root and the file', () => {
  const { dirs, files } = expandPathsOf(
    ['packages/codeintel/src/contract/client-api.d.ts'],
    'C:\\work\\demo',
  )
  assert.deepEqual(dirs, [
    'C:\\work\\demo\\packages',
    'C:\\work\\demo\\packages\\codeintel',
    'C:\\work\\demo\\packages\\codeintel\\src',
    'C:\\work\\demo\\packages\\codeintel\\src\\contract',
  ])
  assert.deepEqual(files, ['C:\\work\\demo\\packages\\codeintel\\src\\contract\\client-api.d.ts'])
})

test('the chain of a file at the root of the project is empty', () => {
  const { dirs, files } = expandPathsOf(['a.ts'], 'C:\\work\\demo')
  assert.deepEqual(dirs, [])
  assert.deepEqual(files, ['C:\\work\\demo\\a.ts'])
})

test('the chain of two matches carries every folder of both of them', () => {
  const { dirs, files } = expandPathsOf(
    ['packages/a/x.ts', 'packages/b/y.ts'],
    'C:\\work\\demo',
  )
  assert.deepEqual(dirs, [
    'C:\\work\\demo\\packages',
    'C:\\work\\demo\\packages\\a',
    'C:\\work\\demo\\packages\\b',
  ])
  assert.deepEqual(files, [
    'C:\\work\\demo\\packages\\a\\x.ts',
    'C:\\work\\demo\\packages\\b\\y.ts',
  ])
})

test('the chain follows the separator of the root', () => {
  const { dirs, files } = expandPathsOf(['src/a.ts'], '/work/demo')
  assert.deepEqual(dirs, ['/work/demo/src'])
  assert.deepEqual(files, ['/work/demo/src/a.ts'])
})

/** The visibility layer. */
test('the visibility layer keeps the chain of the match and the match itself', () => {
  const rows = [
    { kind: 'dir', key: 'd1', entry: { path: 'C:\\work\\demo\\packages' } },
    { kind: 'dir', key: 'd2', entry: { path: 'C:\\work\\demo\\packages\\codeintel' } },
    { kind: 'file', key: 'f1', entry: { path: 'C:\\work\\demo\\packages\\codeintel\\client-api.ts' } },
    { kind: 'file', key: 'f2', entry: { path: 'C:\\work\\demo\\packages\\codeintel\\other.ts' } },
  ]
  const visible = visibleTreeRows(
    rows,
    new Set(['C:\\work\\demo\\packages', 'C:\\work\\demo\\packages\\codeintel']),
    new Set(['C:\\work\\demo\\packages\\codeintel\\client-api.ts']),
  )
  assert.deepEqual(visible.map(row => row.key), ['d1', 'd2', 'f1'])
  // The rows are REUSED: the model of the tree is not rebuilt.
  assert.equal(visible[0], rows[0])
  assert.equal(visible[1], rows[1])
  assert.equal(visible[2], rows[2])
})

test('the visibility layer keeps the placeholder of a folder of the chain', () => {
  const rows = [
    { kind: 'dir', key: 'd1', entry: { path: 'C:\\work\\demo\\packages' } },
    { kind: 'loading', key: 'loading:C:\\work\\demo\\packages\\codeintel', depth: 1 },
    { kind: 'loading', key: 'loading:C:\\work\\demo\\other', depth: 1 },
  ]
  const visible = visibleTreeRows(rows, new Set(['C:\\work\\demo\\packages\\codeintel']), new Set())
  assert.deepEqual(visible.map(row => row.key), ['loading:C:\\work\\demo\\packages\\codeintel'])
})

test('the visibility layer of an empty search keeps nothing', () => {
  const rows = [{ kind: 'dir', key: 'd1', entry: { path: 'C:\\work\\demo\\packages' } }]
  assert.deepEqual(visibleTreeRows(rows, new Set(), new Set()), [])
})

/** The performance: the index is built once, the lookup is a binary search. */
test('the lookup of a project of fifty thousand files is a binary search', () => {
  const dirs = ['src', 'src/client', 'src/host', 'tests', 'docs', 'packages/ui/src']
  const names = ['index', 'main', 'util', 'helper', 'CodeEditor', 'Workbench', 'store']
  const exts = ['.js', '.jsx', '.mjs', '.ts', '.tsx', '.json', '.css', '.md']
  const paths = []
  for (let index = 0; index < 50_000; index += 1) {
    paths.push(`${dirs[index % dirs.length]}/${names[(index * 7) % names.length]}-${index % 977}${exts[(index * 3) % exts.length]}`)
  }

  const started = performance.now()
  const index = buildNameIndex(paths)
  const build = performance.now() - started

  // The index is sorted, and every name is the name of its path.
  assert.equal(index.count, 50_000)
  for (let position = 1; position < index.count; position += 1) {
    assert.ok(index.names[position - 1] <= index.names[position])
  }
  assert.equal(index.names[0], nameOf(index.paths[0]))

  // The lookup does not walk the whole index: a thousand of them cost a
  // fraction of a millisecond each. The bound is generous - it only catches a
  // scan that came back.
  const lookupStarted = performance.now()
  for (let round = 0; round < 1_000; round += 1) findByPrefix(index, 'client', 300)
  const lookup = (performance.now() - lookupStarted) / 1_000
  assert.ok(lookup < 5, `a lookup took ${lookup.toFixed(3)} ms`)

  // The bound of the build is generous as well: the index is built ONCE per
  // index identity, never per keystroke.
  assert.ok(build < 2_000, `the index took ${build.toFixed(1)} ms`)
})

/** The plain comparison, and never the collation. */
test('the name index never uses the collation of the locale', async () => {
  const source = await readFile(join(root, 'src/client/tree-search.js'), 'utf8')
  // The comments talk about the collation - the CODE may not use it.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(code, /localeCompare/, 'the collation is about six times slower')
})

/** The file list of a project of fifty thousand files. */
test('the file list of a project of fifty thousand files does not allocate per keystroke', () => {
  const dirs = ['src', 'src/client', 'src/host', 'tests', 'docs', 'packages/ui/src']
  const names = ['index', 'main', 'util', 'helper', 'CodeEditor', 'Workbench', 'store']
  const exts = ['.js', '.jsx', '.mjs', '.ts', '.tsx', '.json', '.css', '.md']
  const paths = []
  for (let index = 0; index < 50_000; index += 1) {
    paths.push(`${dirs[index % dirs.length]}/${names[(index * 7) % names.length]}-${index % 977}${exts[(index * 3) % exts.length]}`)
  }

  const buildStarted = performance.now()
  const index = buildPathIndex(paths)
  const build = performance.now() - buildStarted
  assert.equal(index.count, 50_000)

  // The scan of the whole project - the worst case, a query that matches
  // nothing - costs a fraction of a millisecond. The old code lowercased
  // 50 000 paths on EVERY keystroke; that is what made the list look stuck.
  const scanStarted = performance.now()
  for (let round = 0; round < 100; round += 1) findByText(index, 'zzz-not-there', 300)
  const scan = (performance.now() - scanStarted) / 100
  assert.ok(scan < 20, `a scan of 50,000 paths took ${scan.toFixed(2)} ms`)

  // The index is built ONCE per index identity, never per keystroke.
  assert.ok(build < 2_000, `the path index took ${build.toFixed(1)} ms`)
})
