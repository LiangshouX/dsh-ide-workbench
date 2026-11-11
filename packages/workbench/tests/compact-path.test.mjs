/**
 * The compact-folder rule shared by the Project tree (R5) and the Git
 * changed-file tree (R7).
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compactLabel, compactLabelFitted, compactTree, isCompactable, isMergedNode, segmentsOf,
} from '../src/client/compact-path.js'

/** One directory node with the given children. */
function dir(name, path, children) {
  return { name, path, kind: 'dir', children }
}

/** One file node. */
function file(name, path) {
  return { name, path, kind: 'file' }
}

test('a directory with one sub-directory and no file is compactable', () => {
  assert.equal(isCompactable(dir('com', 'com', [dir('liangshou', 'com/liangshou', [])])), true)
  assert.equal(isCompactable(dir('com', 'com', [file('a.txt', 'com/a.txt')])), false)
  assert.equal(isCompactable(dir('com', 'com', [dir('a', 'com/a', []), dir('b', 'com/b', [])])), false)
  assert.equal(isCompactable(dir('com', 'com', [])), false)
  assert.equal(isCompactable(file('a.txt', 'a.txt')), false)
  assert.equal(isCompactable(undefined), false)
})

test('a directory that is not loaded yet ends a chain', () => {
  // `children === undefined` means "not loaded": it must not be compactable,
  // so no extra directory read is ever needed to decide.
  assert.equal(isCompactable({ name: 'com', path: 'com', kind: 'dir' }), false)
})

test('a package chain collapses into one node', () => {
  const chain = dir('com', 'com', [
    dir('liangshou', 'com/liangshou', [
      dir('adapter', 'com/liangshou/adapter', [
        dir('controller', 'com/liangshou/adapter/controller', [
          file('UserController.java', 'com/liangshou/adapter/controller/UserController.java'),
        ]),
      ]),
    ]),
  ])
  const merged = compactTree([chain])
  assert.equal(merged.length, 1)
  assert.equal(isMergedNode(merged[0]), true)
  assert.deepEqual(segmentsOf(merged[0]), ['com', 'liangshou', 'adapter', 'controller'])
  // The merged node stands for the LEAF of the chain.
  assert.equal(merged[0].path, 'com/liangshou/adapter/controller')
  // Expanding it shows the leaf's content right away.
  assert.equal(merged[0].children.length, 1)
  assert.equal(merged[0].children[0].name, 'UserController.java')
})

test('the chain forks where a file or a second folder appears', () => {
  const nodes = compactTree([
    dir('com', 'com', [
      dir('liangshou', 'com/liangshou', [
        file('A.java', 'com/liangshou/A.java'),
        dir('adapter', 'com/liangshou/adapter', []),
      ]),
    ]),
  ])
  assert.equal(nodes.length, 1)
  assert.deepEqual(segmentsOf(nodes[0]), ['com', 'liangshou'])
  assert.equal(nodes[0].path, 'com/liangshou')
})

test('a folder with two sub-folders is not merged', () => {
  const nodes = compactTree([
    dir('src', 'src', [dir('main', 'src/main', []), dir('test', 'src/test', [])]),
  ])
  assert.equal(nodes.length, 1)
  assert.equal(isMergedNode(nodes[0]), false)
  assert.deepEqual(segmentsOf(nodes[0]), ['src'])
})

test('files are never merged', () => {
  const nodes = compactTree([file('a.txt', 'a.txt')])
  assert.equal(nodes.length, 1)
  assert.equal(isMergedNode(nodes[0]), false)
})

test('the label joins the chain with the separator', () => {
  const merged = compactTree([
    dir('com', 'com', [dir('liangshou', 'com/liangshou', [dir('adapter', 'com/liangshou/adapter', [])])]),
  ])[0]
  assert.equal(compactLabel(merged, '.'), 'com.liangshou.adapter')
  assert.equal(compactLabel(merged, '/'), 'com/liangshou/adapter')
})

test('a segment that contains the separator falls back to the slash spelling', () => {
  const merged = compactTree([
    dir('a', 'a', [dir('b.c', 'a/b.c', [dir('d', 'a/b.c/d', [])])]),
  ])[0]
  // `a.b.c.d` would be ambiguous, so the label shows which is which.
  assert.equal(compactLabel(merged, '.'), 'a/b.c/d')
  assert.equal(compactLabel(merged, '/'), 'a/b.c/d')
})

test('a plain node keeps its own name', () => {
  const nodes = compactTree([dir('src', 'src', [dir('main', 'src/main', []), dir('test', 'src/test', [])])])
  assert.equal(compactLabel(nodes[0], '.'), 'src')
})

test('the fitted label degrades to first…last and then to the last segment', () => {
  const merged = compactTree([
    dir('com', 'com', [dir('liangshou', 'com/liangshou', [dir('adapter', 'com/liangshou/adapter', [])])]),
  ])[0]
  assert.equal(compactLabelFitted(merged, 100, '/'), 'com/liangshou/adapter')
  assert.equal(compactLabelFitted(merged, 12, '/'), 'com…adapter')
  assert.equal(compactLabelFitted(merged, 5, '/'), 'adapter')
})
