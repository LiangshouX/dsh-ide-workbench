import test from 'node:test'
import assert from 'node:assert/strict'
import { extractHeadings, slugifyHeading, plainHeadingText } from '../src/client/markdown-outline.js'

test('extracts ATX headings and ignores fenced code', () => {
  const markdown = [
    '# Title',
    '',
    '## Section **One**',
    '',
    '```js',
    '# not a heading',
    '```',
    '',
    '### `code` heading',
    '####### not a heading',
  ].join('\n')
  const headings = extractHeadings(markdown)
  assert.deepEqual(headings.map(h => [h.level, h.text]), [
    [1, 'Title'],
    [2, 'Section One'],
    [3, 'code heading'],
  ])
  assert.deepEqual(headings.map(h => h.slug), ['title', 'section-one', 'code-heading'])
})

test('deduplicates slugs', () => {
  const headings = extractHeadings('# Intro\n# Intro\n# Intro')
  assert.deepEqual(headings.map(h => h.slug), ['intro', 'intro-1', 'intro-2'])
})

test('slugs strip punctuation and links', () => {
  assert.equal(slugifyHeading('API: `GET /users/{id}`'), 'api-get-usersid')
  assert.equal(plainHeadingText('**Bold** and [link](https://x)'), 'Bold and link')
})

test('headings inside tilde fences are ignored too', () => {
  const headings = extractHeadings('~~~\n# nope\n~~~\n# yes')
  assert.deepEqual(headings.map(h => h.text), ['yes'])
})
