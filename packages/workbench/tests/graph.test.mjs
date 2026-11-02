import test from 'node:test'
import assert from 'node:assert/strict'
import { layoutGraph, rowGeometry } from '../src/client/graph.js'

const commits = [
  { hash: 'm', parents: ['a', 'b'] },
  { hash: 'a1', parents: ['a'] },
  { hash: 'b1', parents: ['b'] },
  { hash: 'a', parents: ['base'] },
  { hash: 'b', parents: ['base'] },
  { hash: 'base', parents: [] },
]

test('lays out a merge without losing lanes', () => {
  const { rows, maxLanes } = layoutGraph(commits)
  assert.equal(rows.length, commits.length)
  assert.ok(maxLanes >= 2)
  const merge = rows[0]
  assert.equal(merge.commit.hash, 'm')
  assert.equal(merge.primary, 0)
  // A merge commit forks one lane per extra parent; both lanes wait for a1/b1.
  assert.equal(merge.edges.length, 2)
  assert.deepEqual(merge.after.filter(hash => hash !== undefined).sort(), ['a', 'b'])
  for (const row of rows) assert.ok(row.primary >= 0)
})

test('row geometry draws vertical pass-through lanes only', () => {
  const { rows } = layoutGraph(commits)
  const branchRow = rows[1]
  const geometry = rowGeometry(branchRow)
  assert.ok(Array.isArray(geometry.vertical))
  for (const lane of geometry.vertical) assert.notEqual(lane, branchRow.primary)
})

test('linear history stays on one lane', () => {
  const linear = [
    { hash: 'c3', parents: ['c2'] },
    { hash: 'c2', parents: ['c1'] },
    { hash: 'c1', parents: [] },
  ]
  const { rows, maxLanes } = layoutGraph(linear)
  assert.equal(maxLanes, 1)
  for (const row of rows) assert.equal(row.primary, 0)
})
