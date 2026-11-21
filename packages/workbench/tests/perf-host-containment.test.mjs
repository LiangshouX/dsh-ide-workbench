/**
 * The plugin must not reach the DOM of the host.
 *
 * The host draws a CodeMirror of its own (its chat input), and the
 * stylesheet of the workbench carried four rules that named CodeMirror's
 * classes without a scope: those rules reached the editor of the host and
 * restyled it. A plugin that restyles the host is the failure mode this
 * repository has to rule out.
 *
 * The gate is a property of the stylesheet itself, so it fails as soon as a
 * rule that names a class of CodeMirror is added without the scope.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { CSS } from '../src/client/styles.js'

/**
 * The scope the rules of the workbench carry.
 *
 * `:where()` weighs nothing, so the specificity of a scoped rule is the one
 * it had before - the workbench looks exactly the way it looked.
 */
const WORKBENCH_SCOPE = ':where(.iwb-root)'

/**
 * The selectors of one stylesheet.
 *
 * The scan walks the rules of the sheet and returns the selector of each of
 * them. A selector list is split at the commas that are not inside a
 * parenthesis, so `:is(a, b)` stays one selector.
 * @param {string} css the stylesheet
 * @returns {string[]} the selectors
 */
function selectorsOf(source) {
  // The comments are not rules: they are stripped before the scan, or the
  // text of a comment would be read as a selector.
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors = []
  let index = 0
  while (index < css.length) {
    const open = css.indexOf('{', index)
    if (open < 0) break
    const prelude = css.slice(index, open).trim()
    // The end of the block: the braces of the nested blocks count.
    let depth = 1
    let cursor = open + 1
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth += 1
      else if (css[cursor] === '}') depth -= 1
      cursor += 1
    }
    index = cursor
    if (prelude.startsWith('@')) continue
    // Split the list at the commas that are not inside a parenthesis.
    let parenthesis = 0
    let start = 0
    for (let at = 0; at <= prelude.length; at += 1) {
      const char = prelude[at]
      if (char === '(') parenthesis += 1
      else if (char === ')') parenthesis -= 1
      if ((char === ',' && parenthesis === 0) || at === prelude.length) {
        const selector = prelude.slice(start, at).trim()
        if (selector !== '') selectors.push(selector)
        start = at + 1
      }
    }
  }
  return selectors
}

test('no rule of the workbench reaches the CodeMirror of the host', () => {
  // The stylesheet itself is scanned - not a rewritten copy of it: the scope
  // lives where the rule lives, so a rule that is added later is caught here
  // and not only where somebody remembers to add it to a list.
  const selectors = selectorsOf(CSS)
  assert.ok(selectors.length > 100, `the stylesheet must carry its rules, found ${selectors.length}`)
  const leaked = selectors.filter(selector => {
    if (!selector.includes('.cm-')) return false
    // The LEFTMOST compound decides where the rule can match: if it needs a
    // class of the workbench, the rule cannot reach the DOM of the host.
    const leftmost = selector.split(/[\s>+~]+/).filter(part => part !== '')[0]
    if (leftmost === undefined) return true
    return !/\.iwb-/.test(leftmost)
  })
  assert.deepEqual(leaked, [], `the rules of the host must not be reachable: ${leaked.join(', ')}`)
})

test('the fold gutter of the workbench keeps its own theme', () => {
  // The rules are still there - the scope changes where they match, not what
  // they say.
  assert.ok(CSS.includes(`${WORKBENCH_SCOPE} .cm-foldGutter { color: var(--iwb-muted); }`))
  assert.ok(CSS.includes(`${WORKBENCH_SCOPE} .cm-foldPlaceholder {`))
  // The scope weighs nothing: the specificity of the rule is the one it had.
  assert.ok(!CSS.includes('.iwb-root .cm-foldGutter'), 'the scope must not weigh anything')
})

test('the scope of the workbench is the editor of the workbench', async () => {
  // The rules are bound to `.iwb-root`, and that is the class of the root of
  // the workbench: a rule that is scoped to a class that does not exist
  // would leave the workbench without its theme.
  const source = await readPackageFile('src/client/Workbench.jsx')
  assert.match(source, /className: `iwb-root iwb-side-\$\{entrySide\}`/)
})

/**
 * Read one file of the package.
 * @param {string} relative the path, relative to the package
 * @returns {Promise<string>} the content
 */
async function readPackageFile(relative) {
  const { dirname, resolve } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  return readFile(resolve(root, relative), 'utf8')
}
