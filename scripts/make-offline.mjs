/**
 * Build the intranet / offline packages (PRD-v6 release tooling).
 *
 * `npm pack` ships only the files of the `files` allow-list: the runtime
 * dependencies (`ws` for the core; the language servers for the codeintel) stay
 * outside, and a machine without a registry cannot fetch them. This script
 * turns one package into a self-contained archive:
 *
 *   1. packs the package exactly as it would be published and unpacks it into
 *      `package/` of the archive;
 *   2. installs the PRODUCTION dependencies INTO that directory
 *      (`node_modules/` next to the plugin), so the archive runs without any
 *      package manager;
 *   3. rewrites the copied `package.json`: `dependencies` becomes `{}` and
 *      `bundleDependencies` is dropped, so a later `pnpm install` in the
 *      profile never tries to fetch them from a registry again;
 *   4. adds the offline installer (`install-offline.ps1` / `.sh`), the profile
 *      patcher and an `README-OFFLINE.md`;
 *   5. zips the result as `<name>-<version>-offline.zip` and lists its SHA-256.
 *
 * Usage:
 *
 *   node scripts/make-offline.mjs                 # both packages, into ../.offline-stage/offline
 *   node scripts/make-offline.mjs --only workbench
 *   node scripts/make-offline.mjs --no-build --out D:/releases
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const templates = join(root, 'scripts/offline')

/** `--name value` / `--name=value` / bare flags. */
function argOf(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`)
  if (index >= 0 && index + 1 < process.argv.length) return process.argv[index + 1]
  const prefixed = process.argv.find(value => value.startsWith(`--${name}=`))
  return prefixed === undefined ? fallback : prefixed.slice(name.length + 3)
}

const outDir = resolve(argOf('out', join(root, '..', '.offline-stage/offline')))
const only = argOf('only', '')
const shouldBuild = !process.argv.includes('--no-build')
const shell = process.platform === 'win32'
const run = (command, args, options = {}) => execFileSync(command, args, {
  cwd: root, stdio: 'inherit', shell, ...options,
})
const output = (command, args, options = {}) => execFileSync(command, args, {
  cwd: root, encoding: 'utf8', shell, ...options,
})

const PACKAGES = [
  { dir: 'packages/workbench', key: 'workbench' },
  { dir: 'packages/codeintel', key: 'codeintel' },
]

/**
 * Drop directories that hold nothing (npm leaves `@scope/` placeholders after
 * omitting the dev dependencies; `.bin` is not touched because its symlinks are
 * the CLI shims of the installed packages).
 * @param {string} dir a `node_modules` directory
 */
function pruneEmptyDirs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.bin') continue
    const path = join(dir, entry.name)
    if (entry.name.startsWith('@')) {
      pruneEmptyDirs(path)
      if (readdirSync(path).length === 0) rmSync(path, { recursive: true, force: true })
      continue
    }
    if (readdirSync(path).length === 0) rmSync(path, { recursive: true, force: true })
  }
}

if (shouldBuild) {
  console.log('[offline] building both client bundles')
  run('npm', ['run', 'build'])
}

mkdirSync(outDir, { recursive: true })
const built = []

for (const entry of PACKAGES) {
  if (only !== '' && only !== entry.key) continue
  const manifestPath = join(root, entry.dir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const name = manifest.name
  const version = manifest.version
  const stageName = `${name}-${version}-offline`
  const stage = join(outDir, stageName)
  const packageDir = join(stage, 'package')

  console.log(`[offline] ${name}@${version}`)
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(packageDir, { recursive: true })

  // 1. pack and unpack: the archive carries exactly the published file set.
  const tarDir = join(outDir, '.pack')
  mkdirSync(tarDir, { recursive: true })
  const tarName = output('npm', ['pack', '--workspace', entry.dir, '--pack-destination', tarDir]).trim().split(/\r?\n/).at(-1)
  const tarball = join(tarDir, tarName)
  run('tar', ['-xzf', tarball, '-C', packageDir, '--strip-components=1'])

  // 2. the production dependencies, inside the archive's package directory.
  //
  // The install runs in a DETACHED copy: npm walks up from the package to the
  // monorepo root and would otherwise install the dev dependencies of the
  // workspace there (CodeMirror, xterm, esbuild…). Outside the repository the
  // only manifest npm sees is the plugin's own, so `--omit=dev` means exactly
  // what it says.
  console.log('[offline]   installing production dependencies')
  const build = join(outDir, '.build', name)
  rmSync(build, { recursive: true, force: true })
  mkdirSync(build, { recursive: true })
  run('tar', ['-xzf', tarball, '-C', build, '--strip-components=1'])
  run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock'], { cwd: build })
  const installed = join(build, 'node_modules')
  if (existsSync(installed)) {
    rmSync(join(installed, '.package-lock.json'), { force: true })
    // npm leaves empty `@scope/` placeholders behind when it prunes the dev
    // dependencies it resolved on the way; they mean nothing on disk.
    pruneEmptyDirs(installed)
    cpSync(installed, join(packageDir, 'node_modules'), { recursive: true, force: true })
  }
  rmSync(build, { recursive: true, force: true })

  // 3. no declared dependency may survive: the next `pnpm install` must not
  //    try to reach a registry from a machine that has none.
  const offlineManifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  offlineManifest.dependencies = {}
  delete offlineManifest.bundleDependencies
  writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify(offlineManifest, null, 2)}\n`, 'utf8')

  // 4. the installer and its notes.
  for (const file of ['install-offline.ps1', 'install-offline.sh', 'patch-profile.mjs', 'README-OFFLINE.md']) {
    copyFileSync(join(templates, file), join(stage, file))
  }
  const nodeModules = join(packageDir, 'node_modules')
  const dependencyCount = existsSync(nodeModules) ? readdirSync(nodeModules).length : 0
  const notes = readFileSync(join(stage, 'README-OFFLINE.md'), 'utf8')
    .replaceAll('{{NAME}}', name)
    .replaceAll('{{VERSION}}', version)
    .replaceAll('{{DEPENDENCIES}}', String(dependencyCount))
  writeFileSync(join(stage, 'README-OFFLINE.md'), notes, 'utf8')

  // 5. the archive itself (+ its digest, recorded next to the archive).
  const zipName = `${stageName}.zip`
  const zipPath = join(outDir, zipName)
  rmSync(zipPath, { force: true })
  run('tar', ['-a', '-c', '-f', zipPath, '-C', outDir, stageName])
  const digest = createHash('sha256').update(readFileSync(zipPath)).digest('hex')
  const sizeMb = (readFileSync(zipPath).length / (1024 * 1024)).toFixed(1)
  built.push({ name, version, zip: zipPath, sha256: digest, sizeMb, dependencyCount })
  console.log(`[offline]   ${basename(zipPath)}  ${sizeMb} MB  sha256 ${digest.slice(0, 16)}…`)
  rmSync(tarball, { force: true })
  // The staging copy has served its purpose: the archive carries it.
  rmSync(stage, { recursive: true, force: true })
}

rmSync(join(outDir, '.pack'), { recursive: true, force: true })

if (built.length === 0) {
  console.error(`[offline] nothing matched --only ${only}`)
  process.exit(1)
}
writeFileSync(join(outDir, 'SHA256SUMS.txt'), built.map(item => `${item.sha256}  ${basename(item.zip)}`).join('\n') + '\n', 'utf8')
console.log('\n[offline] done')
for (const item of built) {
  console.log(`  ${item.name}@${item.version}: ${item.zip}`)
  console.log(`    ${item.sizeMb} MB · ${item.dependencyCount} node_modules entries · sha256 ${item.sha256}`)
}
console.log(`  checksums: ${join(outDir, 'SHA256SUMS.txt')}`)
