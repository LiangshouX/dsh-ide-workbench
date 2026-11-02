/**
 * Copy the contract into the two plugins.
 *
 * The DSH plugin format publishes the host half as plain source files, so a
 * plugin may only import files that are inside its own directory. The
 * contract is therefore INLINED into each plugin: `packages/contract` is the
 * single source of truth, and this script copies it into
 * `packages/<plugin>/src/contract/`.
 *
 * The copies are committed (the host half is published as source), so the
 * build runs this script first and fails when the copy is out of date.
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'packages', 'contract', 'src')
const targets = [
  join(root, 'packages', 'workbench', 'src', 'contract'),
  join(root, 'packages', 'codeintel', 'src', 'contract'),
]

const files = (await readdir(source)).filter(name => name.endsWith('.js'))
for (const target of targets) {
  await mkdir(target, { recursive: true })
  for (const name of files) {
    const content = await readFile(join(source, name), 'utf8')
    await writeFile(join(target, name), content, 'utf8')
  }
  // The declaration files travel with the sources: they document the contract
  // for the readers of the plugin.
  for (const name of (await readdir(source)).filter(n => n.endsWith('.d.ts'))) {
    await writeFile(join(target, name), await readFile(join(source, name), 'utf8'), 'utf8')
  }
}
console.log(`synced ${files.length} contract file(s) into ${targets.length} package(s)`)
