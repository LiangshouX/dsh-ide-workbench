/**
 * Commit tool-window model: grouping, checkbox state and changelists.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_CHANGELIST, assignChangelist, changelistOf, checkedPathsOf, groupByChangelist,
  groupByDirectory, headerState, isEntryChecked, splitCommitGroups, statusLabel,
} from '../src/client/commit-model.js'

const entries = [
  { path: 'src/a.ts', xy: '.M', staged: false, unstaged: true },
  { path: 'src/b.ts', xy: 'A.', staged: true, unstaged: false },
  { path: 'new.txt', xy: '??', untracked: true, staged: false, unstaged: false },
  { path: 'ignored.log', xy: '!!', ignored: true, staged: false, unstaged: false },
]

test('splits tracked changes from unversioned and drops ignored entries', () => {
  const groups = splitCommitGroups(entries)
  assert.deepEqual(groups.changes.map(entry => entry.path), ['src/a.ts', 'src/b.ts'])
  assert.deepEqual(groups.unversioned.map(entry => entry.path), ['new.txt'])
})

test('a checked unversioned file stays in the Unversioned group (bucket)', () => {
  const added = { path: 'new.txt', xy: 'A.', staged: true, unstaged: false, untracked: false }
  const groups = splitCommitGroups([added], { 'new.txt': 'untracked' })
  assert.equal(groups.unversioned.length, 1)
  assert.equal(groups.changes.length, 0)
})

test('checkbox derives from explicit check, explicit uncheck, then index state', () => {
  const staged = entries[1]
  const unstaged = entries[0]
  assert.equal(isEntryChecked(staged, { checked: new Set(), unchecked: new Set() }), true)
  assert.equal(isEntryChecked(unstaged, { checked: new Set(), unchecked: new Set() }), false)
  assert.equal(isEntryChecked(staged, { checked: new Set(), unchecked: new Set(['src/b.ts']) }), false)
  assert.equal(isEntryChecked(unstaged, { checked: new Set(['src/a.ts']), unchecked: new Set() }), true)
})

test('checkedPathsOf and the tri-state header', () => {
  const checked = checkedPathsOf(entries, { checked: new Set(['src/a.ts']), unchecked: new Set(['src/b.ts']) })
  assert.deepEqual([...checked], ['src/a.ts'])
  assert.equal(headerState([], checked), 'none')
  assert.equal(headerState([entries[0], entries[1]], new Set()), 'none')
  assert.equal(headerState([entries[0]], new Set(['src/a.ts'])), 'all')
  assert.equal(headerState([entries[0], entries[1]], new Set(['src/a.ts'])), 'some')
})

test('groups by directory with sorted headings', () => {
  const sections = groupByDirectory([
    { path: 'b/x.ts' }, { path: 'b/y.ts' }, { path: 'a/z.ts' }, { path: 'root.ts' },
  ])
  assert.deepEqual(sections.map(section => section.dir), ['', 'a', 'b'])
  assert.equal(sections[2].entries.length, 2)
})

test('changelists: default first, empty custom lists omitted', () => {
  const lists = { Default: ['src/a.ts'], '支付重构': ['src/b.ts'], Empty: [] }
  assert.equal(changelistOf('src/a.ts', lists), DEFAULT_CHANGELIST)
  assert.equal(changelistOf('src/b.ts', lists), '支付重构')
  assert.equal(changelistOf('other.ts', lists), DEFAULT_CHANGELIST)
  const groups = groupByChangelist([
    { path: 'src/a.ts' }, { path: 'src/b.ts' }, { path: 'other.ts' },
  ], lists)
  assert.deepEqual(groups.map(group => group.name), [DEFAULT_CHANGELIST, '支付重构'])
  assert.deepEqual(groups[0].entries.map(entry => entry.path), ['src/a.ts', 'other.ts'])
})

test('assignChangelist moves paths out of every other list', () => {
  const lists = { Default: ['a.ts', 'b.ts'], Other: ['b.ts'] }
  const next = assignChangelist(lists, ['b.ts'], 'Fresh')
  assert.deepEqual(next.Default, ['a.ts'])
  assert.deepEqual(next.Other, [])
  assert.deepEqual(next.Fresh, ['b.ts'])
})

test('statusLabel summarises the porcelain state', () => {
  assert.equal(statusLabel({ xy: 'A.' }), 'added')
  assert.equal(statusLabel({ xy: '.M' }), 'modified')
  assert.equal(statusLabel({ xy: 'D.' }), 'deleted')
  assert.equal(statusLabel({ xy: '??', untracked: true }), 'unversioned')
  assert.equal(statusLabel({ xy: 'UU', conflict: true }), 'conflict')
})
