/**
 * The settings page renders its rows through the `Row` and `Group`
 * components.
 *
 * Both were once written as `React.createElement('Row', ...)` - the
 * component passed as a **string**. React then rendered an unknown `<Row>`
 * element: the label and the hint became invisible HTML attributes and
 * only the control survived, so a whole group of settings showed a column
 * of bare inputs without a single word on them.
 *
 * The bug is invisible in the source review and in the type checker (there
 * is none), so it gets a test: a component name is never a string.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const clientDir = join(root, 'src/client')

/**
 * Every source file of the client.
 * @returns {Promise<string[]>} the paths
 */
async function clientSources() {
  const names = await readdir(clientDir)
  return names.filter(name => name.endsWith('.js') || name.endsWith('.jsx')).map(name => join(clientDir, name))
}

test('a component is never passed to createElement as a string', async () => {
  const offenders = []
  for (const file of await clientSources()) {
    const source = await readFile(file, 'utf8')
    // `createElement('Row', ...)` - a string that starts with a capital
    // letter is a component name, never an HTML tag.
    const matches = source.matchAll(/createElement\(\s*'[A-Z][A-Za-z0-9]*'/g)
    for (const match of matches) {
      offenders.push(`${file}: ${match[0]}`)
    }
  }
  assert.deepEqual(offenders, [], 'a component passed as a string renders as an unknown element')
})

test('the settings rows carry their label and their hint', async () => {
  const source = await readFile(join(clientDir, 'SettingsPanel.jsx'), 'utf8')
  // The row component itself renders the label and the hint.
  assert.match(source, /className: 'iwb-settings-title'/, 'the row renders a title')
  assert.match(source, /className: 'iwb-settings-hint'/, 'the row renders a hint')
  // Every row of the semantic-analysis group goes through the component.
  const group = source.slice(source.indexOf("settings.lspGroup"), source.indexOf("settings.lspServersGroup"))
  const rows = group.match(/createElement\(\s*'Row'/g) ?? []
  assert.deepEqual(rows, [], 'no row of the group may be a string')
  assert.ok(group.includes('createElement(Row'), 'the rows are the component')
})

test('the field inputs are painted by the same rule as the row inputs', async () => {
  const css = await readFile(join(clientDir, 'styles.js'), 'utf8')
  // The inputs of the settings page are painted by one rule. A field whose
  // wrapper is missing from that selector list falls back to the browser's
  // own input - a black frame on a white fill, which looks like a hole in
  // the page.
  const selector = /\.iwb-settings-control input\[type="text"\][\s\S]*?\{/.exec(css)
  assert.ok(selector !== null, 'the settings inputs are painted by one rule')
  assert.match(
    selector[0],
    /\.iwb-settings-field-control input\[type="number"\]/,
    'the field inputs share the rule of the row inputs',
  )
  assert.match(
    selector[0],
    /\.iwb-settings-field-control select/,
    'the field selects share the rule of the row selects',
  )
  // The per-language ceiling of the language-server list lives outside of
  // both wrappers, so it needs the rule by name - otherwise it falls back to
  // the browser's own input and the row looks broken.
  assert.match(
    selector[0],
    /\.iwb-settings-language input\[type="number"\]/,
    'the per-language ceiling shares the rule of the row inputs',
  )
})

test('the per-language ceiling input has a width of its own', async () => {
  const css = await readFile(join(clientDir, 'styles.js'), 'utf8')
  // The language row is a compact line, not a settings row: the ceiling
  // field is narrower than the number fields of the rows.
  const width = /\.iwb-settings-language input\[type="number"\]\s*\{[^}]*width:\s*\d+px/.exec(css)
  assert.ok(width !== null, 'the per-language ceiling input has a width')
})
