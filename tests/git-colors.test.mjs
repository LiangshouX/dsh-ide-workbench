/**
 * JetBrains status colouring: classification and recursive directory rollup.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateStatus, fileStatusKind, sameStatusEntries, stableAggregateStatus, statusClass } from '../src/client/git-colors.js'

test('classifies the IDEA highlight states', () => {
  assert.equal(fileStatusKind({ xy: '??', untracked: true }), 'untracked')
  assert.equal(fileStatusKind({ xy: 'A.', staged: true }), 'added')
  assert.equal(fileStatusKind({ xy: '.M' }), 'modified')
  assert.equal(fileStatusKind({ xy: 'M.' , staged: true }), 'modified')
  assert.equal(fileStatusKind({ xy: 'MD' }), 'deleted')
  assert.equal(fileStatusKind({ xy: 'D.' }), 'deleted')
  assert.equal(fileStatusKind({ xy: 'UU', conflict: true }), 'conflict')
  assert.equal(fileStatusKind({ xy: '!!', ignored: true }), 'ignored')
  assert.equal(fileStatusKind({ xy: '..' }), null)
  assert.equal(fileStatusKind(undefined), null)
})

test('class maps to the JetBrains colour classes', () => {
  assert.equal(statusClass('untracked'), 'iwb-git-untracked')
  assert.equal(statusClass('added'), 'iwb-git-added')
  assert.equal(statusClass('modified'), 'iwb-git-modified')
  assert.equal(statusClass('conflict'), 'iwb-git-conflict')
  assert.equal(statusClass('ignored'), 'iwb-git-ignored')
  assert.equal(statusClass(null), '')
})

test('a modified file wins over an untracked sibling (conflict > modified > added > untracked)', () => {
  const rollup = aggregateStatus([
    { path: 'src/new.ts', xy: '??', untracked: true },
    { path: 'src/a.ts', xy: '.M' },
  ])
  assert.equal(rollup.dirs.get('src'), 'modified')
  assert.equal(rollup.files.get('src/new.ts'), 'untracked')
  assert.equal(rollup.files.get('src/a.ts'), 'modified')
})

test('a conflict escalates every ancestor', () => {
  const rollup = aggregateStatus([
    { path: 'pkg/ui/main.ts', xy: 'UU', conflict: true },
    { path: 'pkg/ui/other.ts', xy: '??', untracked: true },
  ])
  assert.equal(rollup.dirs.get('pkg'), 'conflict')
  assert.equal(rollup.dirs.get('pkg/ui'), 'conflict')
  assert.equal(rollup.conflictDirs.has('pkg/ui'), true)
})

test('ignored entries colour nothing and are exposed as a set', () => {
  const rollup = aggregateStatus([
    { path: 'dist/bundle.js', xy: '!!', ignored: true },
    { path: 'dist/keep.ts', xy: '.M' },
  ])
  assert.equal(rollup.ignored.has('dist/bundle.js'), true)
  assert.equal(rollup.files.has('dist/bundle.js'), false)
  assert.equal(rollup.dirs.get('dist'), 'modified')
})

test('an ignored-only directory gets no colour', () => {
  const rollup = aggregateStatus([{ path: 'dist/out.js', xy: '!!', ignored: true }])
  assert.equal(rollup.dirs.get('dist'), undefined)
})

test('the root itself is never a colour key (paths are relative)', () => {
  const rollup = aggregateStatus([{ path: 'a.ts', xy: '.M' }])
  assert.equal(rollup.dirs.size, 0)
  assert.equal(rollup.files.get('a.ts'), 'modified')
})

test('two entry lists describe the same status when path and kind agree', () => {
  const first = [{ path: 'a.ts', xy: '.M' }, { path: 'b.ts', xy: '??', untracked: true }]
  const second = [{ path: 'a.ts', xy: ' M' }, { path: 'b.ts', xy: '??', untracked: true }]
  assert.equal(sameStatusEntries(first, second), true)
  // A different kind for the same path is a different status.
  assert.equal(sameStatusEntries(first, [{ path: 'a.ts', xy: 'A.' }, { path: 'b.ts', xy: '??', untracked: true }]), false)
  // A different path is a different status.
  assert.equal(sameStatusEntries(first, [{ path: 'c.ts', xy: '.M' }, { path: 'b.ts', xy: '??', untracked: true }]), false)
  // A different length is a different status.
  assert.equal(sameStatusEntries(first, [first[0]]), false)
})

test('the aggregate keeps its identity while the status is unchanged', () => {
  // The poll hands over a fresh list every two seconds; the aggregate must
  // not become a new object, or every memo keyed on it rebuilds the tree.
  const first = stableAggregateStatus(undefined, [{ path: 'a.ts', xy: '.M' }])
  const second = stableAggregateStatus(first, [{ path: 'a.ts', xy: '.M' }])
  assert.equal(second, first)
  assert.equal(second.ignored, first.ignored)
})

test('the aggregate is a new object when the status changed', () => {
  const first = stableAggregateStatus(undefined, [{ path: 'a.ts', xy: '.M' }])
  const second = stableAggregateStatus(first, [{ path: 'a.ts', xy: 'A.' }])
  assert.notEqual(second, first)
  assert.equal(second.files.get('a.ts'), 'added')
  // The previous aggregate is left alone.
  assert.equal(first.files.get('a.ts'), 'modified')
})

test('an unchanged ignored set keeps the tree inputs stable', () => {
  const entries = [{ path: 'dist/x.js', xy: '!!', ignored: true }, { path: 'a.ts', xy: '.M' }]
  const first = stableAggregateStatus(undefined, entries)
  const second = stableAggregateStatus(first, entries.map(entry => ({ ...entry })))
  assert.equal(second.ignored, first.ignored)
  assert.equal(second.dirs, first.dirs)
})
