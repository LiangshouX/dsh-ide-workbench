import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFindRegExp, findMatches, replaceAllMatches } from '../src/client/find.js'

test('literal find is case-insensitive by default with line/column', () => {
  const text = 'const A = 1\nconst a = 2\n'
  const matches = findMatches(text, 'a')
  assert.equal(matches.length, 2)
  assert.equal(matches[0].line, 1)
  assert.equal(matches[0].column, 7)
  assert.equal(matches[1].line, 2)
})

test('case-sensitive and whole-word flags are honored', () => {
  assert.equal(findMatches('a A b', 'a', { caseSensitive: true }).length, 1)
  assert.equal(findMatches('foo food foo', 'foo', { wholeWord: true }).length, 2)
})

test('regexp mode matches groups and rejects an invalid pattern', () => {
  assert.equal(findMatches('x1 y2', '\\w\\d', { regexp: true }).length, 2)
  assert.throws(() => buildFindRegExp('[', { regexp: true }))
})

test('replacement escapes literal metacharacters and replaces all', () => {
  const result = replaceAllMatches('a.b a.b', 'a.b', {}, 'x')
  assert.deepEqual(result, { text: 'x x', count: 2 })
})

test('replacement in regexp mode can use capture groups', () => {
  const result = replaceAllMatches('foo=1 bar=2', '(\\w+)=(\\d+)', { regexp: true }, '$1:$2')
  assert.deepEqual(result, { text: 'foo:1 bar:2', count: 2 })
})
