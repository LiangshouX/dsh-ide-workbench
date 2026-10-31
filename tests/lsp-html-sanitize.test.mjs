import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeHTML } from '../src/client/lsp-sanitize.js'

/**
 * The sanitizer is the XSS barrier of the semantic features (PRD-v5 §7.3):
 * a language server answers hover requests with Markdown that may contain
 * arbitrary HTML, and the library injects it into the page.
 */

test('a script element is removed with its content', () => {
  const out = sanitizeHTML('<p>hello</p><script>alert(1)</script>')
  assert.ok(!out.includes('<script'), out)
  assert.ok(!out.includes('alert(1)'), out)
  assert.match(out, /<p>hello<\/p>/)
})

test('an iframe is removed with its content', () => {
  const out = sanitizeHTML('<div><iframe src="https://example.com/evil"></iframe>ok</div>')
  assert.ok(!out.includes('<iframe'), out)
  assert.ok(!out.includes('evil'), out)
  assert.match(out, /ok/)
})

test('an object and an embed are removed', () => {
  const out = sanitizeHTML('<object data="x.swf"></object><embed src="y.swf">')
  assert.ok(!out.includes('<object'), out)
  assert.ok(!out.includes('<embed'), out)
})

test('an event handler attribute is removed', () => {
  const out = sanitizeHTML('<img src="x.png" onerror="alert(1)">')
  assert.ok(!out.includes('onerror'), out)
  assert.match(out, /<img src="x\.png">/)
})

test('an event handler attribute with single quotes is removed', () => {
  const out = sanitizeHTML("<img src='x.png' onload='alert(1)'>")
  assert.ok(!out.includes('onload'), out)
  assert.ok(!out.includes('alert'), out)
})

test('a javascript URL is neutralized', () => {
  const out = sanitizeHTML('<a href="javascript:alert(1)">click</a>')
  assert.ok(!out.includes('javascript:'), out)
  assert.match(out, /click/)
})

test('a javascript URL written with entities is neutralized', () => {
  const out = sanitizeHTML('<a href="&#106;avascript:alert(1)">click</a>')
  assert.ok(!out.includes('avascript:alert'), out)
  assert.ok(!out.toLowerCase().includes('javascript:'), out)
})

test('a javascript URL with whitespace inside is neutralized', () => {
  const out = sanitizeHTML('<a href="java\tscript:alert(1)">click</a>')
  assert.ok(!out.toLowerCase().includes('javascript:'), out)
})

test('a script URL outside an attribute is neutralized as well', () => {
  const out = sanitizeHTML('<p>use javascript:void(0) carefully</p>')
  assert.ok(!out.toLowerCase().includes('javascript:'), out)
})

test('harmless markup survives', () => {
  const out = sanitizeHTML('<p>see <code>foo()</code> and <a href="https://example.com">the docs</a></p>')
  assert.match(out, /<code>foo\(\)<\/code>/)
  assert.match(out, /href="https:\/\/example\.com"/)
})

test('an empty or invalid input is answered with an empty string', () => {
  assert.equal(sanitizeHTML(''), '')
  assert.equal(sanitizeHTML(null), '')
  assert.equal(sanitizeHTML(undefined), '')
})
