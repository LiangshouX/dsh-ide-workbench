/**
 * Register one offline plugin in a DSH profile (called by the installers).
 *
 * Everything here is local: the plugin directory is copied by the caller, this
 * script only edits `<profile>/package.json`:
 *
 *   - `dependencies[name] = "file:./offline-plugins/<name>"` (a local spec, so
 *     a later `pnpm install` links the same copy instead of fetching it);
 *   - `dsh.profile.bundles` gains the plugin name — that is how the DSH loader
 *     knows to load it.
 *
 * Usage: node patch-profile.mjs <profile-dir> <package-name>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [profileDir, name] = process.argv.slice(2)
if (profileDir === undefined || name === undefined) {
  console.error('usage: node patch-profile.mjs <profile-dir> <package-name>')
  process.exit(2)
}

const manifestPath = join(profileDir, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

manifest.dependencies = { ...(manifest.dependencies ?? {}) }
manifest.dependencies[name] = `file:./offline-plugins/${name}`

manifest.dsh = { ...(manifest.dsh ?? {}) }
manifest.dsh.profile = { ...(manifest.dsh.profile ?? {}) }
const bundles = Array.isArray(manifest.dsh.profile.bundles) ? [...manifest.dsh.profile.bundles] : []
if (!bundles.includes(name)) bundles.push(name)
manifest.dsh.profile.bundles = bundles

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`[offline] registered ${name} in ${manifestPath}`)
