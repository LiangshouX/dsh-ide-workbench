import test from 'node:test'
import assert from 'node:assert/strict'
import { isMarkdownFile } from '../src/client/file-types.js'

// The visual family of a file is the harness's own now (`FileTypeIcon` from
// `@deepseek-ai/dsh-client-ui-primitives`), so only the Markdown question —
// which the host cannot answer for the editor — is left to this module.
test('markdown detection', () => {
  assert.equal(isMarkdownFile('README.md'), true)
  assert.equal(isMarkdownFile('doc.MARKDOWN'), true)
  assert.equal(isMarkdownFile('doc.mdx'), true)
  assert.equal(isMarkdownFile('main.ts'), false)
  assert.equal(isMarkdownFile(''), false)
})
