/**
 * R7 — the changed-file tree of a commit merges the directory chains that
 * hold no changed file.
 *
 * A commit that touches one deep file used to need eight clicks to show it;
 * now the chain is one row and the leaf is open (0 clicks). The double
 * click on a merged row opens the original folders again, so the sense of
 * hierarchy is never lost.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let modulePromise

async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'git-compact-tree.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `export * from './src/client/GitPanel.jsx'`,
        resolveDir: root,
        loader: 'js',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: ['node20'],
      external: ['react', 'react-dom', 'react-dom/server'],
      jsx: 'transform',
      define: { 'process.env.NODE_ENV': '"production"' },
      outfile,
      logLevel: 'silent',
    })
    return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
  })()
  return modulePromise
}

const DEEP_FILE = 'hivemind-agent-engine/src/main/java/com/liangshou/agentic/agents/hooks/StudioForwardMiddleware.java'
const DEEP_DIR = 'hivemind-agent-engine/src/main/java/com/liangshou/agentic/agents/hooks'

/** One changed file as a patch the drawer understands. */
function diffOf(path) {
  return `diff --git a/${path} b/${path}
index 1111111..2222222 100644
--- a/${path}
+++ b/${path}
@@ -1 +1 @@
-old
+new
`
}

/** The options `fileTreeRows` reads. */
function treeOptions(overrides = {}) {
  return {
    collapsed: new Set(),
    selectedPath: '',
    depth: 0,
    onToggleDir: () => {},
    onSelectFile: () => {},
    onOpenFile: () => {},
    ...overrides,
  }
}

/** The directory rows of one rendering. */
function dirRows(rows) {
  return rows.filter(row => row.props?.className === 'iwb-git-tree-dir')
}

/** The file rows of one rendering. */
function fileRows(rows) {
  return rows.filter(row => row.props?.className?.includes('iwb-git-tree-file'))
}

test('one deep file is one directory row, and the leaf is visible without a click', async () => {
  const mod = await loadModule()
  const files = mod.diffFiles(diffOf(DEEP_FILE))
  const tree = mod.compactChangedFileTree(mod.buildChangedFileTree(files))

  // The nine directories of the path became one row.
  assert.deepEqual([...tree.dirs.keys()], ['hivemind-agent-engine'])
  const merged = tree.dirs.get('hivemind-agent-engine')
  assert.equal(merged.merged, true)
  assert.equal(merged.path, DEEP_DIR)

  // A merged chain is open by default: the changed file is right there.
  assert.deepEqual([...mod.defaultCollapsedDirs(tree)], [])
  const rows = mod.fileTreeRows(tree, treeOptions())
  assert.equal(dirRows(rows).length, 1)
  assert.equal(fileRows(rows).length, 1)
  assert.equal(fileRows(rows)[0].props.title, DEEP_FILE)
})

test('the merged row shows the whole path and keeps it in the title', async () => {
  const mod = await loadModule()
  const files = mod.diffFiles(diffOf(DEEP_FILE))
  const tree = mod.compactChangedFileTree(mod.buildChangedFileTree(files))
  const rows = mod.fileTreeRows(tree, treeOptions())
  const html = renderToStaticMarkup(React.createElement('div', null, rows))
  // The label is the full slash path of the chain.
  assert.match(html, new RegExp(`>${DEEP_DIR}<`))
  // The title is the full repository-relative path.
  assert.match(html, new RegExp(`title="${DEEP_DIR}"`))
})

test('the merged label degrades to the width that is available', async () => {
  const mod = await loadModule()
  const files = mod.diffFiles(diffOf(DEEP_FILE))
  const tree = mod.compactChangedFileTree(mod.buildChangedFileTree(files))

  const labelOf = width => {
    const rows = mod.fileTreeRows(tree, treeOptions({ width }))
    return rows[0].props.children[1].props.children
  }
  // Wide enough: the whole path.
  assert.equal(labelOf(900), DEEP_DIR)
  // Too narrow for the whole path: the first and the last segment.
  assert.equal(labelOf(320), 'hivemind-agent-engine…hooks')
  // Too narrow even for that: the last segment alone.
  assert.equal(labelOf(160), 'hooks')
  // The title always keeps the full path.
  const html = renderToStaticMarkup(React.createElement('div', null, mod.fileTreeRows(tree, treeOptions({ width: 160 }))))
  assert.match(html, new RegExp(`title="${DEEP_DIR}"`))
})

test('branching directories stay collapsible', async () => {
  const mod = await loadModule()
  const files = mod.diffFiles([
    diffOf('src/app.js'),
    diffOf('src/util/deep.js'),
    diffOf('docs/readme.md'),
  ].join(''))
  const tree = mod.compactChangedFileTree(mod.buildChangedFileTree(files))
  // `src` holds a file and a folder: it branches, so it is not merged.
  assert.deepEqual([...tree.dirs.keys()], ['docs', 'src'])
  // The folder below the first level is closed by default, as before.
  const collapsed = mod.defaultCollapsedDirs(tree)
  assert.ok(collapsed.has('src/util'), 'the deeper folder is closed')
  assert.equal(collapsed.has('src'), false)
  const rows = mod.fileTreeRows(tree, treeOptions({ collapsed }))
  assert.deepEqual(fileRows(rows).map(row => row.props.title), ['docs/readme.md', 'src/app.js'])
})

test('a double click opens the original folders of a merged chain', async () => {
  const mod = await loadModule()
  const files = mod.diffFiles(diffOf(DEEP_FILE))
  const tree = mod.compactChangedFileTree(mod.buildChangedFileTree(files))

  const expandedOriginal = []
  const toggled = []
  const rows = mod.fileTreeRows(tree, treeOptions({
    onExpandOriginal: path => expandedOriginal.push(path),
    onToggleDir: path => toggled.push(path),
  }))
  const merged = dirRows(rows)[0]
  assert.ok(merged.props.onDoubleClick !== undefined, 'the merged row opens the original folders')
  merged.props.onDoubleClick()
  assert.deepEqual(expandedOriginal, [DEEP_DIR])
  // The two clicks of the double click must not toggle the row.
  merged.props.onClick({ detail: 2 })
  assert.deepEqual(toggled, [])
  // A single click still collapses the row.
  merged.props.onClick({ detail: 1 })
  assert.deepEqual(toggled, [DEEP_DIR])

  // With the fallback open, the original folders are back.
  const fallback = mod.fileTreeRows(tree, treeOptions({ expandedOriginal: new Set([DEEP_DIR]) }))
  assert.deepEqual(dirRows(fallback).map(row => row.props.title), [
    'hivemind-agent-engine',
    'hivemind-agent-engine/src',
    'hivemind-agent-engine/src/main',
    'hivemind-agent-engine/src/main/java',
    'hivemind-agent-engine/src/main/java/com',
    'hivemind-agent-engine/src/main/java/com/liangshou',
    'hivemind-agent-engine/src/main/java/com/liangshou/agentic',
    'hivemind-agent-engine/src/main/java/com/liangshou/agentic/agents',
    'hivemind-agent-engine/src/main/java/com/liangshou/agentic/agents/hooks',
  ])
  // The changed file is still there.
  assert.deepEqual(fileRows(fallback).map(row => row.props.title), [DEEP_FILE])
})

test('a renamed file keeps its path after the merge', async () => {
  const mod = await loadModule()
  const rename = `diff --git a/old/deep/path/File.java b/new/deep/path/File.java
similarity index 100%
rename from old/deep/path/File.java
rename to new/deep/path/File.java
`
  const files = mod.diffFiles(rename)
  const tree = mod.compactChangedFileTree(mod.buildChangedFileTree(files))
  const merged = tree.dirs.get('new')
  assert.equal(merged.merged, true)
  assert.equal(merged.path, 'new/deep/path')
  const rows = mod.fileTreeRows(tree, treeOptions())
  assert.deepEqual(fileRows(rows).map(row => row.props.title), ['new/deep/path/File.java'])
  const html = renderToStaticMarkup(React.createElement('div', null, rows))
  assert.doesNotMatch(html, /old\/deep/)
})

test('a click selects a file and a double click opens the diff', async () => {
  const mod = await loadModule()
  const files = mod.diffFiles(diffOf(DEEP_FILE))
  const tree = mod.compactChangedFileTree(mod.buildChangedFileTree(files))
  const selected = []
  const opened = []
  const rows = mod.fileTreeRows(tree, treeOptions({
    onSelectFile: path => selected.push(path),
    onOpenFile: path => opened.push(path),
  }))
  const leaf = fileRows(rows)[0]
  leaf.props.onClick()
  leaf.props.onDoubleClick()
  assert.deepEqual(selected, [DEEP_FILE])
  assert.deepEqual(opened, [DEEP_FILE])
})

test('the tree root never takes part in a merge', async () => {
  const mod = await loadModule()
  const files = mod.diffFiles(diffOf(DEEP_FILE))
  const raw = mod.buildChangedFileTree(files)
  // The root is not a merged node: a root that merged with its only child
  // would lose the path context completely.
  const tree = mod.compactChangedFileTree(raw)
  assert.equal(tree.merged, undefined)
  assert.equal(tree.dirs.size, 1)
})

test('the compaction is idempotent', async () => {
  const mod = await loadModule()
  const raw = mod.buildChangedFileTree(mod.diffFiles(diffOf(DEEP_FILE)))
  const once = mod.compactChangedFileTree(raw)
  const twice = mod.compactChangedFileTree(once)
  // The chain must not grow with every pass.
  assert.deepEqual([...twice.dirs.keys()], [...once.dirs.keys()])
  assert.equal(twice.dirs.get('hivemind-agent-engine').path, once.dirs.get('hivemind-agent-engine').path)
  assert.deepEqual(twice.dirs.get('hivemind-agent-engine').segments, once.dirs.get('hivemind-agent-engine').segments)
  assert.deepEqual(twice.dirs.get('hivemind-agent-engine').chain, once.dirs.get('hivemind-agent-engine').chain)
})

test('the raw tree renders merged as well', async () => {
  const mod = await loadModule()
  const raw = mod.buildChangedFileTree(mod.diffFiles(diffOf(DEEP_FILE)))
  // Every caller gets the merged rows, no matter how the tree was built.
  const rows = mod.fileTreeRows(raw, treeOptions())
  assert.equal(dirRows(rows).length, 1)
  assert.equal(fileRows(rows)[0].props.title, DEEP_FILE)
  // And the default state of the raw tree is the merged one.
  assert.deepEqual([...mod.defaultCollapsedDirs(raw)], [])
})
