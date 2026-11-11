/**
 * The stylesheet lives in a JS template literal.
 *
 * A backtick inside a CSS comment ends the literal, and the rest of the
 * stylesheet is then parsed as JavaScript: esbuild fails and EVERY test that
 * bundles the client dies with an error that points at the stylesheet instead
 * of at the comment. This test makes that trap impossible to step into again.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(join(root, 'src/client/styles.js'), 'utf8')

test('the stylesheet holds no stray backtick', () => {
  const marker = 'export const CSS ='
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, 'styles.js must export the stylesheet')
  // Everything from the template literal onwards may carry exactly the two
  // backticks that open and close it.
  const literal = source.slice(start)
  const ticks = (literal.match(/`/g) ?? []).length
  assert.equal(ticks, 2, `the stylesheet holds ${ticks} backticks, it may only hold the two of its own template literal`)
})

test('the stylesheet is a string', async () => {
  const module = await import('../src/client/styles.js')
  assert.equal(typeof module.CSS, 'string')
  assert.ok(module.CSS.length > 1000, 'the stylesheet must not be empty')
})
