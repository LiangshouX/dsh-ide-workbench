/**
 * The Java runtime of jdtls (PRD-v5.1 JS-01…JS-05, `src/host/java-runtime.js`).
 *
 * Why this file exists: the "Java does not work" incident had two host-side
 * roots, and both are invisible to a test that runs on the machine of the
 * developer:
 *
 *   - the launcher is a Python script, so spawning it directly is an ENOENT
 *     on every machine - the argv has to start a JVM (JS-01);
 *   - the JDK has to be DISCOVERED from what the operating system and the
 *     IDE itself wrote down, never from a path literal - the machine of the
 *     user has the IDE on another drive, or not at all (JS-02, the red line
 *     of PRD §3.1).
 *
 * The machine is therefore built here: `fakeMachine()` implements the
 * injectable seams (`stat` / `readFile` / `readdir` / `remove` / `writeFile` /
 * `mkdir` / `rename` / `isProcessAlive`) over a plain map of absolute paths,
 * and every call passes an injected `platform`, `env`, `home` and
 * `profileBase`. No test in this file reads or writes the real disk, and none
 * of them needs a JDK, an IDE or jdtls to be installed.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  buildJavaArgv,
  discoverJdks,
  expandHomeMacros,
  jdtlsConfigDirName,
  jdtlsDataDir,
  jdtlsDataDirName,
  jdtlsLayoutOf,
  javaMajorOf,
  javaServerPlan,
  markJavaWorkspaceOwner,
  parseJavaVersion,
  pathKey,
  resolveJavaHome,
  resolveJdtls,
  sweepJavaWorkspaces,
} from '../src/host/java-runtime.js'
import { DEFAULT_LSP_SETTINGS } from '../src/host/settings-defaults.js'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ── the fake machine ──────────────────────────────────────────────────────

/**
 * The path flavor of one platform.
 * @param {string} platform a `process.platform` value
 * @returns {typeof win32}
 */
function pathsOf(platform) {
  return platform === 'win32' ? win32 : posix
}

/**
 * The file name of the Java binary of one platform.
 * @param {string} platform a `process.platform` value
 * @returns {string}
 */
function javaBinaryOf(platform) {
  return platform === 'win32' ? 'java.exe' : 'java'
}

/**
 * One fake machine: a plain path → node map behind the injectable file
 * system seams of `java-runtime.js`.
 *
 * `stat` answers a `{ isFile(), isDirectory() }` object (or throws ENOENT),
 * `readFile` answers the recorded content, `readdir` answers `Dirent`-like
 * objects and `remove` deletes a directory and everything below it. Parent
 * directories are added automatically, so a test only names the files it
 * cares about.
 * @param {object} [options]
 * @param {string} [options.platform] a `process.platform` value (default `win32`)
 * @param {Record<string, string>} [options.env] the environment
 * @param {string} [options.home] the home directory
 * @returns {object} the machine and its injectable options
 */
function fakeMachine(options = {}) {
  const platform = options.platform ?? 'win32'
  const paths = pathsOf(platform)
  /** @type {Map<string, { path: string, type: 'file' | 'dir', content: string }>} */
  const nodes = new Map()
  const removed = []

  const keyOf = (path) => pathKey(String(path), platform)

  const addDirectory = (directory) => {
    let current = paths.normalize(String(directory))
    const pending = []
    for (;;) {
      const key = keyOf(current)
      if (nodes.has(key)) break
      pending.push(current)
      const parent = paths.dirname(current)
      if (parent === current) break
      current = parent
    }
    for (const directory of pending.reverse()) {
      nodes.set(keyOf(directory), { path: directory, type: 'dir', content: '' })
    }
  }

  const addFile = (path, content = '') => {
    const normalized = paths.normalize(String(path))
    addDirectory(paths.dirname(normalized))
    nodes.set(keyOf(normalized), { path: normalized, type: 'file', content: String(content) })
  }

  const enoent = (path) => Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: 'ENOENT' })

  const recordOf = (path) => nodes.get(keyOf(path))

  const direntOf = (node) => ({
    name: paths.basename(node.path),
    isDirectory: () => node.type === 'dir',
    isFile: () => node.type === 'file',
    isSymbolicLink: () => false,
  })

  const stat = (path) => {
    const node = recordOf(path)
    if (node === undefined) throw enoent(path)
    return {
      isFile: () => node.type === 'file',
      isDirectory: () => node.type === 'dir',
      isSymbolicLink: () => false,
    }
  }

  const readFile = (path) => {
    const node = recordOf(path)
    if (node === undefined || node.type !== 'file') throw enoent(path)
    return node.content
  }

  const readdir = (path) => {
    const node = recordOf(path)
    if (node === undefined || node.type !== 'dir') throw enoent(path)
    const ownKey = keyOf(node.path)
    const entries = []
    for (const child of nodes.values()) {
      const childKey = keyOf(child.path)
      if (childKey === ownKey) continue
      if (keyOf(paths.dirname(child.path)) !== ownKey) continue
      entries.push(direntOf(child))
    }
    return entries.sort((left, right) => (left.name < right.name ? -1 : (left.name > right.name ? 1 : 0)))
  }

  const remove = (path) => {
    const targetKey = keyOf(path)
    const target = recordOf(path)
    if (target === undefined) return
    removed.push(target.path)
    for (const [nodeKey, node] of nodes) {
      if (nodeKey !== targetKey && !nodeKey.startsWith(`${targetKey}/`)) continue
      nodes.delete(nodeKey)
    }
  }

  const writeFile = (path, text) => {
    const normalized = paths.normalize(String(path))
    const parent = recordOf(paths.dirname(normalized))
    if (parent === undefined || parent.type !== 'dir') throw enoent(paths.dirname(normalized))
    nodes.set(keyOf(normalized), { path: normalized, type: 'file', content: String(text) })
  }

  const mkdir = (path, options = {}) => {
    const normalized = paths.normalize(String(path))
    if (options.recursive === true) {
      addDirectory(normalized)
      return
    }
    const parent = recordOf(paths.dirname(normalized))
    if (parent === undefined || parent.type !== 'dir') throw enoent(paths.dirname(normalized))
    if (recordOf(normalized) === undefined) {
      nodes.set(keyOf(normalized), { path: normalized, type: 'dir', content: '' })
    }
  }

  const rename = (from, to) => {
    const source = recordOf(from)
    if (source === undefined) throw enoent(from)
    const sourceKey = keyOf(from)
    const fromPath = source.path
    const target = paths.normalize(String(to))
    const targetKey = keyOf(target)
    // An atomic replacement: an existing target (and its content) is gone.
    for (const [nodeKey] of [...nodes]) {
      if (nodeKey === targetKey || nodeKey.startsWith(`${targetKey}/`)) nodes.delete(nodeKey)
    }
    const moved = [...nodes.entries()]
      .filter(([nodeKey]) => nodeKey === sourceKey || nodeKey.startsWith(`${sourceKey}/`))
    for (const [nodeKey] of moved) nodes.delete(nodeKey)
    for (const [, node] of moved) {
      const suffix = keyOf(node.path).slice(sourceKey.length)
      nodes.set(`${targetKey}${suffix}`, { ...node, path: target + node.path.slice(fromPath.length) })
    }
  }

  /** The process ids the fake operating system reports as alive. */
  const alivePids = new Set()

  const machine = {
    platform,
    paths,
    env: options.env ?? {},
    home: options.home ?? (platform === 'win32' ? 'C:\\Users\\tester' : '/home/tester'),
    nodes,
    removed,
    alivePids,
    addDirectory,
    addFile,
    /** Whether one path exists in the fake machine. */
    has: (path) => nodes.has(keyOf(path)),
    /** The node of one path, or undefined. */
    node: (path) => recordOf(path),
    /**
     * The options of one `java-runtime.js` call: every seam is injected, so
     * the production code never falls back to the real machine.
     * @returns {object}
     */
    options() {
      return {
        platform: this.platform,
        env: this.env,
        home: this.home,
        stat,
        readFile,
        readdir,
        remove,
        writeFile,
        mkdir,
        rename,
        isProcessAlive: (pid) => alivePids.has(pid),
      }
    },
  }
  return machine
}

/**
 * Add one JDK (or one JetBrains Runtime) to a fake machine: a `bin/java.exe`
 * and a `release` file carrying `JAVA_VERSION`.
 * @param {object} machine the fake machine
 * @param {string} home the JDK directory
 * @param {number} major the major version
 * @returns {object} the machine (for chaining)
 */
function addJdk(machine, home, major) {
  const version = major === 8 ? '1.8.0_392' : `${major}.0.3`
  machine.addFile(machine.paths.join(home, 'bin', javaBinaryOf(machine.platform)))
  machine.addFile(machine.paths.join(home, 'release'), `JAVA_VERSION="${version}"\n`)
  return machine
}

/**
 * Add one jdtls installation (the official tarball layout) to a fake machine.
 * @param {object} machine the fake machine
 * @param {string} root the installation root
 * @param {object} [options]
 * @param {boolean} [options.config] whether the configuration directory exists
 * @param {boolean} [options.launcher] whether the equinox launcher jar exists
 * @param {string[]} [options.jars] the launcher jar names
 * @returns {object} the machine (for chaining)
 */
function addJdtls(machine, root, options = {}) {
  const platform = machine.platform
  if (options.config !== false) {
    machine.addFile(machine.paths.join(root, jdtlsConfigDirName(platform), 'config.ini'), 'osgi.bundles=…\n')
  }
  if (options.launcher !== false) {
    const jars = options.jars ?? ['org.eclipse.equinox.launcher_1.8.0.v20260804-1928.jar']
    for (const jar of jars) machine.addFile(machine.paths.join(root, 'plugins', jar), '')
  }
  machine.addFile(machine.paths.join(root, 'bin', 'jdtls'), '#!/usr/bin/env python3\n# jdtls launcher\n')
  return machine
}

// ── the version of a JDK (PRD §3.3) ───────────────────────────────────────

test('parseJavaVersion reads the JAVA_VERSION line of a release file', () => {
  assert.equal(parseJavaVersion('JAVA_VERSION="25.0.3"\n'), 25)
  assert.equal(parseJavaVersion('JAVA_VERSION="1.8.0_392"\n'), 8)
  assert.equal(parseJavaVersion('JAVA_VERSION="21"\n'), 21)
  assert.equal(parseJavaVersion('IMPLEMENTOR="Eclipse Adoptium"\nJAVA_VERSION="17.0.8"\nOS_ARCH="x86_64"\n'), 17)
})

test('parseJavaVersion answers null for a release file without a usable version', () => {
  assert.equal(parseJavaVersion(''), null)
  assert.equal(parseJavaVersion('IMPLEMENTOR="Eclipse Adoptium"\n'), null)
  assert.equal(parseJavaVersion('JAVA_VERSION="not a version"\n'), null)
  assert.equal(parseJavaVersion(undefined), null)
  assert.equal(parseJavaVersion(null), null)
})

test('the major version of the pre-9 scheme is the number after the 1.', () => {
  assert.equal(javaMajorOf('1.8.0_392'), 8)
  assert.equal(javaMajorOf('1.7.0_80'), 7)
  assert.equal(javaMajorOf('25.0.3'), 25)
  assert.equal(javaMajorOf('21'), 21)
})

// ── resolving one configured javaHome (PRD §7.1) ──────────────────────────

test('resolveJavaHome accepts a JDK directory and the java executable inside it', () => {
  const machine = fakeMachine()
  addJdk(machine, 'C:\\jdks\\jdk-25', 25)
  const fromDirectory = resolveJavaHome('C:\\jdks\\jdk-25', machine.options())
  assert.notEqual(fromDirectory, null)
  assert.equal(fromDirectory.home, 'C:\\jdks\\jdk-25')
  assert.equal(fromDirectory.executable, 'C:\\jdks\\jdk-25\\bin\\java.exe')
  assert.equal(fromDirectory.version, 25)

  const fromExecutable = resolveJavaHome('C:\\jdks\\jdk-25\\bin\\java.exe', machine.options())
  assert.deepEqual(fromExecutable, fromDirectory)
})

test('resolveJavaHome refuses an empty, relative or nonexistent value', () => {
  const machine = fakeMachine()
  addJdk(machine, 'C:\\jdks\\jdk-25', 25)
  const options = machine.options()
  assert.equal(resolveJavaHome('', options), null)
  assert.equal(resolveJavaHome('   ', options), null)
  assert.equal(resolveJavaHome(undefined, options), null)
  assert.equal(resolveJavaHome(null, options), null)
  // A relative path would depend on the working directory of the host: the
  // value has to be absolute (the settings document says so).
  assert.equal(resolveJavaHome('jdks/jdk-25', options), null)
  assert.equal(resolveJavaHome('C:\\jdks\\jdk-missing', options), null)
})

test('a directory without a release file is not a JDK and is never guessed', () => {
  const machine = fakeMachine()
  // A `bin/java.exe` without a `release` file: the version cannot be read,
  // and guessing it would select a JDK of an unknown version (PRD §3.3).
  machine.addFile('C:\\jdks\\broken\\bin\\java.exe')
  assert.equal(resolveJavaHome('C:\\jdks\\broken', machine.options()), null)

  // A directory where the executable is not the Java launcher.
  machine.addFile('C:\\jdks\\not-java\\bin\\javac.exe')
  machine.addFile('C:\\jdks\\not-java\\release', 'JAVA_VERSION="21.0.1"\n')
  assert.equal(resolveJavaHome('C:\\jdks\\not-java\\bin\\javac.exe', machine.options()), null)
})

// ── the discovery (PRD §3.2) ──────────────────────────────────────────────

test('a candidate without a release file is skipped by the discovery', () => {
  const machine = fakeMachine({ env: { JAVA_HOME: 'C:\\jdks\\broken' } })
  machine.addFile('C:\\jdks\\broken\\bin\\java.exe')
  const { candidates, selected } = discoverJdks(machine.options())
  assert.deepEqual(candidates, [])
  assert.equal(selected, null)
})

test('the explicit javaHome wins over a higher version that was discovered', () => {
  const machine = fakeMachine({ env: { PATH: 'C:\\tools\\jdk25\\bin' } })
  addJdk(machine, 'C:\\jdks\\jdk17', 17)
  addJdk(machine, 'C:\\tools\\jdk25', 25)
  const { candidates, selected } = discoverJdks({
    ...machine.options(),
    lsp: { servers: { java: { javaHome: 'C:\\jdks\\jdk17' } } },
  })
  assert.equal(selected.version, 17, 'the explicit setting is the user asking for THIS JDK')
  assert.equal(selected.source, 'setting')
  assert.equal(selected.path, 'C:\\jdks\\jdk17')
  // The settings page still lists the highest version first.
  assert.equal(candidates[0].version, 25)
  assert.deepEqual(candidates.map(candidate => candidate.version).sort((left, right) => right - left), [25, 17])
})

test('JAVA_HOME and the PATH java at 17 do not hide the JBR at 25', () => {
  // The machine of the incident: JAVA_HOME and PATH both point at a 17, and
  // the only runtime jdtls 1.63.0 accepts is the 25 bundled with the IDE.
  // "The first usable" would pick the wrong one; the highest wins (PRD §3.2).
  const machine = fakeMachine({
    env: {
      JAVA_HOME: 'C:\\jdks\\jdk17',
      PATH: 'C:\\jdks\\jdk17\\bin;D:\\ides\\IDEA\\bin',
    },
  })
  addJdk(machine, 'C:\\jdks\\jdk17', 17)
  addJdk(machine, 'D:\\ides\\IDEA\\jbr', 25)
  machine.addFile('D:\\ides\\IDEA\\bin\\idea64.exe')
  const { candidates, selected } = discoverJdks(machine.options())
  assert.equal(selected.version, 25)
  assert.equal(selected.source, 'bundled-jbr')
  assert.equal(selected.path, 'D:\\ides\\IDEA\\jbr')
  // JAVA_HOME and PATH name the same JDK: it is one candidate, not two.
  assert.equal(candidates.filter(candidate => candidate.path === 'C:\\jdks\\jdk17').length, 1)
  assert.equal(candidates.length, 2)
})

test('the JBR of an IDE that is not on PATH is found through the configured launcher', () => {
  const machine = fakeMachine()
  addJdk(machine, 'E:\\tools\\rider\\jbr', 25)
  machine.addFile('E:\\tools\\rider\\bin\\rider64.exe')
  const { selected } = discoverJdks({
    ...machine.options(),
    ideaPath: 'E:\\tools\\rider\\bin\\rider64.exe',
  })
  assert.equal(selected.version, 25)
  assert.equal(selected.path, 'E:\\tools\\rider\\jbr')
  assert.equal(selected.source, 'bundled-jbr')
})

// ── the macros of the IDE path table (PRD §3.2 #4) ───────────────────────

test('expandHomeMacros expands $USER_HOME$ and ~/', () => {
  const home = 'C:\\Users\\tester'
  assert.equal(expandHomeMacros('$USER_HOME$/.jdks/corretto-21.0.3', home, 'win32'), 'C:\\Users\\tester/.jdks/corretto-21.0.3')
  assert.equal(expandHomeMacros('~/jdks/temurin-17', home, 'win32'), 'C:\\Users\\tester\\jdks\\temurin-17')
  assert.equal(expandHomeMacros('~', home, 'win32'), home)
  assert.equal(expandHomeMacros('D:\\jdks\\jdk21', home, 'win32'), 'D:\\jdks\\jdk21')
  assert.equal(expandHomeMacros(undefined, home, 'win32'), '')
})

test('the jdk.table.xml of the IDE is read with its macros expanded', () => {
  const home = 'C:\\Users\\tester'
  const table = join(home, 'AppData', 'Roaming', 'JetBrains', 'IntelliJ IDEA 2026.1', 'options', 'jdk.table.xml')
  const machine = fakeMachine({
    home,
    env: { APPDATA: join(home, 'AppData', 'Roaming') },
  })
  machine.addFile(table, [
    '<application>',
    '  <component name="ProjectJdkTable">',
    '    <jdk version="2"><name value="corretto-21" /><homePath value="$USER_HOME$/.jdks/corretto-21.0.3" /></jdk>',
    '    <jdk version="2"><name value="temurin-17" /><homePath value="~/jdks/temurin-17" /></jdk>',
    '    <jdk version="2"><name value="gone" /><homePath value="$USER_HOME$/.jdks/gone" /></jdk>',
    '  </component>',
    '</application>',
  ].join('\n'))
  addJdk(machine, join(home, '.jdks', 'corretto-21.0.3'), 21)
  addJdk(machine, join(home, 'jdks', 'temurin-17'), 17)

  const { candidates, selected } = discoverJdks(machine.options())
  const found = candidates.map(candidate => candidate.path)
  assert.ok(found.includes(join(home, '.jdks', 'corretto-21.0.3')), 'the $USER_HOME$ entry is expanded')
  assert.ok(found.includes(join(home, 'jdks', 'temurin-17')), 'the ~/ entry is expanded')
  // The macro was expanded, but the directory does not exist: the candidate
  // is skipped instead of being reported as a JDK that is not there.
  assert.ok(!found.some(path => path.includes('gone')), 'a path that does not exist is skipped')
  for (const candidate of candidates) assert.equal(candidate.source, 'jdk-table')
  assert.equal(selected.version, 21)
})

test('without ProgramFiles the JDK is still found through PATH and the IDE path table', () => {
  // The machine of the incident: `%ProgramFiles%` points at a directory the
  // IDE is not under, so the fallback scan finds nothing. The deterministic
  // sources (PATH, jdk.table.xml) must carry the discovery (PRD §3.2).
  const home = 'C:\\Users\\tester'
  const machine = fakeMachine({
    home,
    env: {
      PATH: 'C:\\tools\\jdk21\\bin',
      APPDATA: join(home, 'AppData', 'Roaming'),
    },
  })
  machine.addFile(join(home, 'AppData', 'Roaming', 'JetBrains', 'IntelliJ IDEA 2026.1', 'options', 'jdk.table.xml'), [
    '<application><component name="ProjectJdkTable">',
    `  <jdk version="2"><homePath value="${join(home, '.jdks', 'temurin-17')}" /></jdk>`,
    '</component></application>',
  ].join('\n'))
  addJdk(machine, 'C:\\tools\\jdk21', 21)
  addJdk(machine, join(home, '.jdks', 'temurin-17'), 17)

  const { candidates, selected } = discoverJdks(machine.options())
  assert.equal(selected.version, 21)
  assert.equal(selected.path, 'C:\\tools\\jdk21')
  assert.deepEqual(
    [...new Set(candidates.map(candidate => candidate.source))].sort(),
    ['jdk-table', 'path'],
  )
})

// ── the two layouts of an IDE installation (PRD §3.2 #6) ─────────────────

test('the fallback scan finds the JBR in the flat, the vendor and the Toolbox layout', () => {
  // The scan roots are DERIVED from the injected environment, and every root
  // is tried in two layouts: flat `<root>/<product> <version>/jbr` and with a
  // vendor directory `<root>/<vendor>/<product> <version>/jbr`. Toolbox uses
  // a third one: `<root>/<product>/ch-0/<build>/jbr`.
  const localAppData = 'C:\\Users\\tester\\AppData\\Local'
  const machine = fakeMachine({
    env: {
      ProgramFiles: 'C:\\ides',
      LOCALAPPDATA: localAppData,
    },
  })
  addJdk(machine, 'C:\\ides\\JetBrains\\IntelliJ IDEA 2026.1.4\\jbr', 25)
  addJdk(machine, 'D:\\apps\\JetBrains\\WebStorm 2026.1.4\\jbr', 25)
  addJdk(machine, join(localAppData, 'JetBrains', 'Toolbox', 'apps', 'PyCharm', 'ch-0', '2026.1', 'jbr'), 24)

  const { candidates, selected } = discoverJdks({
    ...machine.options(),
    lsp: { servers: { java: { javaSearchRoots: ['D:\\apps'] } } },
  })
  const found = candidates.map(candidate => candidate.path)
  assert.equal(found.length, 3)
  assert.ok(found.includes('C:\\ides\\JetBrains\\IntelliJ IDEA 2026.1.4\\jbr'), 'the flat layout')
  assert.ok(found.includes('D:\\apps\\JetBrains\\WebStorm 2026.1.4\\jbr'), 'the vendor layout')
  assert.ok(found.includes(join(localAppData, 'JetBrains', 'Toolbox', 'apps', 'PyCharm', 'ch-0', '2026.1', 'jbr')), 'the Toolbox layout')
  for (const candidate of candidates) assert.equal(candidate.source, 'scan')
  assert.equal(selected.version, 25)
})

test('a search root that is a JDK itself is a candidate (custom install location)', () => {
  const machine = fakeMachine()
  addJdk(machine, 'E:\\java\\jdk-25', 25)
  const { selected } = discoverJdks({
    ...machine.options(),
    lsp: { servers: { java: { javaSearchRoots: ['E:\\java\\jdk-25'] } } },
  })
  assert.equal(selected.path, 'E:\\java\\jdk-25')
  assert.equal(selected.version, 25)
})

test('a search root that is the IDE home finds the jbr directly below it', () => {
  // The natural value a user adds for an IDE installed where nothing looks is
  // the IDE home itself (`javaSearchRoots: ['…\\IntelliJ IDEA 2026.1']`): its
  // `jbr/` is directly below the root, and the walk has to test the root as
  // well as its children (the loop skips the `jbr` child by name).
  const machine = fakeMachine()
  addJdk(machine, 'D:\\ides\\IntelliJ IDEA 2026.1\\jbr', 25)
  const { selected } = discoverJdks({
    ...machine.options(),
    lsp: { servers: { java: { javaSearchRoots: ['D:\\ides\\IntelliJ IDEA 2026.1'] } } },
  })
  assert.equal(selected.path, 'D:\\ides\\IntelliJ IDEA 2026.1\\jbr')
  assert.equal(selected.version, 25)
  assert.equal(selected.source, 'scan')
})

// ── the jdtls installation (PRD §2.1) ────────────────────────────────────

test('resolveJdtls finds the installation through JDTLS_HOME', () => {
  const machine = fakeMachine({ env: { JDTLS_HOME: 'D:\\tools\\jdtls-1.63.0' } })
  addJdtls(machine, 'D:\\tools\\jdtls-1.63.0')
  const resolution = resolveJdtls(machine.options())
  assert.notEqual(resolution, null)
  assert.equal(resolution.root, 'D:\\tools\\jdtls-1.63.0')
  assert.equal(resolution.configDir, 'D:\\tools\\jdtls-1.63.0\\config_win')
  assert.equal(resolution.launcherJar, 'D:\\tools\\jdtls-1.63.0\\plugins\\org.eclipse.equinox.launcher_1.8.0.v20260804-1928.jar')
  assert.equal(resolution.source, 'JDTLS_HOME')
})

test('resolveJdtls walks two levels up from the jdtls that PATH resolves', () => {
  // The official distribution: `…/bin/jdtls` (a Python script) and the
  // installation root two directories above it. The launcher is never
  // spawned - only its directory is read (PRD §1.2).
  const machine = fakeMachine({ env: { PATH: 'D:\\tools\\jdtls-1.63.0\\bin' } })
  addJdtls(machine, 'D:\\tools\\jdtls-1.63.0')
  const resolution = resolveJdtls(machine.options())
  assert.equal(resolution.root, 'D:\\tools\\jdtls-1.63.0')
  assert.equal(resolution.source, 'command')
})

test('resolveJdtls prefers the configured jdtlsHome over the other sources', () => {
  const machine = fakeMachine({
    env: { JDTLS_HOME: 'D:\\tools\\broken' },
    // The broken installation is what the environment names; the explicit
    // setting is the user's answer and wins.
  })
  addJdtls(machine, 'D:\\tools\\jdtls-1.63.0')
  addJdtls(machine, 'D:\\tools\\broken', { launcher: false })
  const resolution = resolveJdtls({
    ...machine.options(),
    lsp: { servers: { java: { jdtlsHome: 'D:\\tools\\jdtls-1.63.0' } } },
  })
  assert.equal(resolution.root, 'D:\\tools\\jdtls-1.63.0')
  assert.equal(resolution.source, 'setting')
})

test('resolveJdtls derives the installation from a launcher named in the args', () => {
  // The stop-gap configuration of the document's appendix A puts the official
  // launcher script in `args` (`command: 'python'`, args: ['…\\bin\\jdtls']).
  // The installation root derived from that path is what lets the plugin start
  // the JVM directly instead of relying on the Python interpreter.
  const machine = fakeMachine()
  addJdtls(machine, 'D:\\tools\\jdtls-1.63.0')
  machine.addFile('C:\\Python\\python.exe', '#!/usr/bin/env python3\n')
  const resolution = resolveJdtls({
    ...machine.options(),
    command: 'C:\\Python\\python.exe',
    extraArgs: ['D:\\tools\\jdtls-1.63.0\\bin\\jdtls', '--java-executable', 'C:\\jdks\\jdk21\\bin\\java.exe'],
  })
  assert.notEqual(resolution, null)
  assert.equal(resolution.source, 'args')
  assert.equal(resolution.root, 'D:\\tools\\jdtls-1.63.0')
  assert.equal(resolution.configDir, 'D:\\tools\\jdtls-1.63.0\\config_win')
})

test('an installation without the configuration directory or the launcher is not usable', () => {
  const machine = fakeMachine()
  addJdtls(machine, 'D:\\tools\\config-only', { launcher: false })
  addJdtls(machine, 'D:\\tools\\jar-only', { config: false })
  assert.equal(jdtlsLayoutOf('D:\\tools\\config-only', machine.options()), null)
  assert.equal(jdtlsLayoutOf('D:\\tools\\jar-only', machine.options()), null)
  assert.equal(jdtlsLayoutOf('D:\\tools\\missing', machine.options()), null)
  // Two builds of the launcher: the newest one is the entry point.
  addJdtls(machine, 'D:\\tools\\two-jars', {
    jars: ['org.eclipse.equinox.launcher_1.7.0.v20250101-0000.jar', 'org.eclipse.equinox.launcher_1.8.0.v20260804-1928.jar'],
  })
  const layout = jdtlsLayoutOf('D:\\tools\\two-jars', machine.options())
  assert.equal(layout.launcherJar, 'D:\\tools\\two-jars\\plugins\\org.eclipse.equinox.launcher_1.8.0.v20260804-1928.jar')
})

test('an unversioned equinox launcher (the mason packaging) is a usable installation', () => {
  // The mason registry ships `plugins/org.eclipse.equinox.launcher.jar` with
  // no build stamp in the name; the launcher script of jdtls accepts it, so
  // the layout reader must accept it too.
  const machine = fakeMachine()
  addJdtls(machine, 'D:\\tools\\jdtls-mason', { jars: ['org.eclipse.equinox.launcher.jar'] })
  const layout = jdtlsLayoutOf('D:\\tools\\jdtls-mason', machine.options())
  assert.notEqual(layout, null)
  assert.equal(layout.launcherJar, 'D:\\tools\\jdtls-mason\\plugins\\org.eclipse.equinox.launcher.jar')
})

// ── the argv of the JVM (PRD §2.3) ───────────────────────────────────────

/** The layout of one jdtls installation, as `buildJavaArgv` receives it. */
const JDTLS_LAYOUT = {
  root: 'D:\\tools\\jdtls',
  configDir: 'D:\\tools\\jdtls\\config_win',
  launcherJar: 'D:\\tools\\jdtls\\plugins\\org.eclipse.equinox.launcher_1.8.0.jar',
}

/**
 * The numeric value of one `-X…` argument.
 * @param {string[]} argv the argv
 * @param {'Xms' | 'Xmx'} name the flag
 * @returns {number | null}
 */
function heapOf(argv, name) {
  const flag = `-${name}`
  const entry = argv.find(argument => argument.startsWith(flag))
  if (entry === undefined) return null
  const match = /^-(?:Xms|Xmx)(\d+)m$/.exec(entry)
  if (match === null) return null
  return Number(match[1])
}

test('buildJavaArgv keeps -Xms at or below -Xmx for every ceiling', () => {
  for (const limitMB of [512, 1024, 1536, 2048]) {
    const argv = buildJavaArgv({ executable: 'D:\\jbr\\bin\\java.exe', jdtls: JDTLS_LAYOUT, memoryLimitMB: limitMB })
    const xms = heapOf(argv, 'Xms')
    const xmx = heapOf(argv, 'Xmx')
    assert.notEqual(xms, null, `-Xms is absent for ${limitMB} MB`)
    assert.notEqual(xmx, null, `-Xmx is absent for ${limitMB} MB`)
    assert.equal(xmx, limitMB, `the ceiling is not installed for ${limitMB} MB`)
    assert.ok(xms <= xmx, `-Xms ${xms}m > -Xmx ${xmx}m makes the JVM refuse to start (PRD §2.3)`)
  }
})

test('buildJavaArgv builds every flag the Eclipse application needs', () => {
  const workspaceDir = 'C:\\profile\\ide-workbench\\lsp-workspace\\jdtls-0123456789abcdef'
  const argv = buildJavaArgv({
    executable: 'D:\\jbr\\bin\\java.exe',
    jdtls: JDTLS_LAYOUT,
    workspaceDir,
    memoryLimitMB: 1536,
    javaVersion: 25,
    extraArgs: ['-Ddebug.jdt=true'],
  })
  assert.equal(argv[0], 'D:\\jbr\\bin\\java.exe', 'the executable is the first entry')
  const flags = [
    '-Declipse.application=org.eclipse.jdt.ls.core.id1',
    '-Dosgi.bundles.defaultStartLevel=4',
    '-Declipse.product=org.eclipse.jdt.ls.core.product',
    '-Dosgi.checkConfiguration=true',
    '-Dosgi.sharedConfiguration.area=D:\\tools\\jdtls\\config_win',
    '-Dosgi.sharedConfiguration.area.readOnly=true',
    '-Dosgi.configuration.cascaded=true',
    '-Xms1024m',
    '-Xmx1536m',
    '--add-modules=ALL-SYSTEM',
    'java.base/java.util=ALL-UNNAMED',
    'java.base/java.lang=ALL-UNNAMED',
  ]
  for (const flag of flags) assert.ok(argv.includes(flag), `missing ${flag}`)
  assert.equal(argv.filter(argument => argument === '--add-opens').length, 2, 'both --add-opens pairs')
  assert.equal(argv[argv.indexOf('-jar') + 1], JDTLS_LAYOUT.launcherJar)
  const data = argv.indexOf('-data')
  assert.ok(data >= 0, 'the workspace is passed explicitly (PRD §1.4)')
  assert.equal(argv[data + 1], workspaceDir)
})

test('the javaArgs of the settings are JVM arguments: before the jar', () => {
  // `java` stops parsing options at the jar file, so anything after `-jar`
  // reaches the Eclipse application instead of the JVM - an `-Xmx4g` there
  // would silently do nothing (PRD §7.1). `-data` is an APPLICATION argument
  // and stays after the jar.
  const argv = buildJavaArgv({
    executable: 'D:\\jbr\\bin\\java.exe',
    jdtls: JDTLS_LAYOUT,
    workspaceDir: 'C:\\profile\\ide-workbench\\lsp-workspace\\jdtls-0123456789abcdef',
    memoryLimitMB: 1536,
    extraArgs: ['-Ddebug.jdt=true', '-Xmx4g'],
  })
  const jar = argv.indexOf('-jar')
  assert.ok(argv.indexOf('-Ddebug.jdt=true') < jar, 'the custom JVM argument comes before -jar')
  assert.ok(argv.indexOf('-Xmx4g') < jar, 'a custom ceiling would be dead after -jar')
  assert.ok(argv.indexOf('--add-modules=ALL-SYSTEM') < jar)
  const data = argv.indexOf('-data')
  assert.ok(data > jar, '-data is an application argument and stays after the jar')
  assert.equal(argv[data + 1], 'C:\\profile\\ide-workbench\\lsp-workspace\\jdtls-0123456789abcdef')
})

test('the JVM heap flags come in the -Xms then -Xmx order', () => {
  const argv = buildJavaArgv({ executable: 'D:\\jbr\\bin\\java.exe', jdtls: JDTLS_LAYOUT, memoryLimitMB: 1536 })
  assert.ok(argv.indexOf('-Xms1024m') < argv.indexOf('-Xmx1536m'))
})

test('the XML entity limits are lifted only for Java 24 and newer', () => {
  // Java 24 tightened the default XML entity-expansion limits; the Eclipse
  // metadata import of a large Maven project fails on them, and the upstream
  // jdtls launcher lifts the limits for exactly this reason.
  const limits = ['-Djdk.xml.maxGeneralEntitySizeLimit=0', '-Djdk.xml.totalEntitySizeLimit=0']
  for (const javaVersion of [25, 24]) {
    const argv = buildJavaArgv({ executable: 'D:\\jbr\\bin\\java.exe', jdtls: JDTLS_LAYOUT, javaVersion })
    for (const flag of limits) assert.ok(argv.includes(flag), `Java ${javaVersion} needs ${flag}`)
  }
  for (const javaVersion of [21, 17, 8]) {
    const argv = buildJavaArgv({ executable: 'D:\\jbr\\bin\\java.exe', jdtls: JDTLS_LAYOUT, javaVersion })
    for (const flag of limits) assert.ok(!argv.includes(flag), `Java ${javaVersion} must not carry ${flag}`)
  }
})

test('buildJavaArgv installs no heap when there is no ceiling', () => {
  const argv = buildJavaArgv({ executable: 'D:\\jbr\\bin\\java.exe', jdtls: JDTLS_LAYOUT })
  assert.ok(!argv.some(argument => argument.startsWith('-Xm') || argument.startsWith('-Xms')))
  assert.ok(argv.includes('-jar'))
})

// ── the -data isolation (PRD §4.1) ──────────────────────────────────────

test('two roots with the same folder name get two different workspaces', () => {
  // jdtls hashes the NAME of its working directory by default, so `D:\a\app`
  // and `D:\b\app` would share one Eclipse workspace and poison each other's
  // index. The host passes a directory derived from the FULL path (PRD §1.4).
  const profileBase = 'C:\\Users\\tester\\.dsh'
  const options = { platform: 'win32', profileBase }
  const first = jdtlsDataDir('D:\\a\\app', options)
  const second = jdtlsDataDir('D:\\b\\app', options)
  assert.notEqual(pathKey(first), pathKey(second))
  assert.ok(first.startsWith('C:\\Users\\tester\\.dsh\\ide-workbench\\lsp-workspace\\'))
  assert.match(jdtlsDataDirName('D:\\a\\app', options), /^jdtls-[0-9a-f]{16}$/)
})

test('the workspace of one root is stable and case-insensitive on Windows', () => {
  const options = { platform: 'win32', profileBase: 'C:\\profile' }
  assert.equal(jdtlsDataDir('D:\\projects\\app', options), jdtlsDataDir('D:\\projects\\app', options))
  // The same directory spelled with another case is the same root: the key
  // of `rootKey()` is case-insensitive where the file system is.
  assert.equal(pathKey(jdtlsDataDir('D:/Projects/App', options)), pathKey(jdtlsDataDir('d:\\projects\\app', options)))
})

test('the workspace lives under the profile the environment names', () => {
  const options = {
    platform: 'win32',
    env: { DSH_PROFILE_DIR: 'E:\\profile-dir' },
  }
  const directory = jdtlsDataDir('D:\\projects\\app', options)
  assert.ok(directory.startsWith('E:\\profile-dir\\ide-workbench\\lsp-workspace\\'), directory)
  // With no profile in the environment the home directory of the user is
  // the base - never a path literal of this machine.
  const fromHome = jdtlsDataDir('D:\\projects\\app', { platform: 'win32', home: 'C:\\Users\\tester', env: {} })
  assert.ok(fromHome.startsWith('C:\\Users\\tester\\.dsh\\ide-workbench\\lsp-workspace\\'), fromHome)
})

// ── the plan the manager consumes ────────────────────────────────────────

test('the plan starts the JVM directly when both halves are present', () => {
  const machine = fakeMachine({
    env: { JDTLS_HOME: 'D:\\tools\\jdtls-1.63.0' },
    home: 'C:\\Users\\tester',
  })
  addJdtls(machine, 'D:\\tools\\jdtls-1.63.0')
  addJdk(machine, 'D:\\ides\\IDEA\\jbr', 25)
  const plan = javaServerPlan({
    ...machine.options(),
    root: 'D:\\projects\\app',
    memoryLimitMB: 2048,
    profileBase: 'C:\\profile',
    lsp: { servers: { java: { javaHome: 'D:\\ides\\IDEA\\jbr' } } },
  })
  assert.equal(plan.ok, true)
  assert.equal(plan.mode, 'jvm')
  assert.equal(plan.launcher, 'java')
  assert.equal(plan.supportsMemoryLimit, true, 'the ceiling reaches the JVM through -Xmx')
  assert.equal(plan.jdtlsHome, 'D:\\tools\\jdtls-1.63.0')
  assert.equal(plan.javaHome, 'D:\\ides\\IDEA\\jbr')
  assert.equal(plan.javaVersion, 25)
  assert.equal(plan.workspaceDir, jdtlsDataDir('D:\\projects\\app', { ...machine.options(), profileBase: 'C:\\profile' }))
  assert.deepEqual(plan.jdkCandidates, [{ path: 'D:\\ides\\IDEA\\jbr', version: 25, source: 'setting' }])
  assert.equal(plan.argv[0], 'D:\\ides\\IDEA\\jbr\\bin\\java.exe')
  assert.ok(plan.argv.includes('-Xmx2048m'))
  const data = plan.argv.indexOf('-data')
  assert.equal(plan.argv[data + 1], plan.workspaceDir)
})

test('a packaging without a readable layout falls back to the Python launcher script', () => {
  // The risk table of the PRD: a distribution whose layout the reader does
  // not understand is still usable through the official launcher script,
  // but only when the command really IS that script - a Python interpreter
  // that happens to be configured as the command is not a language server.
  const machine = fakeMachine({
    env: { PATH: 'D:\\tools\\jdtls\\bin;C:\\Python' },
  })
  machine.addFile('D:\\tools\\jdtls\\bin\\jdtls', '#!/usr/bin/env python3\n# org.eclipse.jdt.ls launcher\n')
  machine.addFile('C:\\Python\\python.exe')
  addJdk(machine, 'C:\\jdks\\jdk21', 21)
  const plan = javaServerPlan({
    ...machine.options(),
    root: 'D:\\projects\\app',
    memoryLimitMB: 2048,
    profileBase: 'C:\\profile',
    lsp: { servers: { java: { javaHome: 'C:\\jdks\\jdk21' } } },
  })
  assert.equal(plan.ok, true)
  assert.equal(plan.mode, 'script')
  assert.equal(plan.supportsMemoryLimit, false, 'the JVM is a grandchild: no ceiling is promised')
  assert.equal(plan.jdtlsHome, null)
  assert.equal(plan.argv[0], 'C:\\Python\\python.exe')
  assert.equal(plan.argv[1], 'D:\\tools\\jdtls\\bin\\jdtls')
  assert.equal(plan.argv[plan.argv.indexOf('--java-executable') + 1], 'C:\\jdks\\jdk21\\bin\\java.exe')
  assert.equal(plan.argv[plan.argv.indexOf('-data') + 1], plan.workspaceDir)
})

test('the script fallback does not accept a Python interpreter as the command', () => {
  const machine = fakeMachine({ env: { PATH: 'C:\\Python' } })
  machine.addFile('C:\\Python\\python.exe', '#!/usr/bin/env python3\n')
  addJdk(machine, 'C:\\jdks\\jdk21', 21)
  const plan = javaServerPlan({
    ...machine.options(),
    root: 'D:\\projects\\app',
    command: 'C:\\Python\\python.exe',
    memoryLimitMB: 2048,
    profileBase: 'C:\\profile',
    lsp: { servers: { java: { javaHome: 'C:\\jdks\\jdk21' } } },
  })
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, 'jdtls-missing')
  assert.equal(plan.mode, undefined)
})

test('a pip jdtls.exe is started as it is, without a JDK or a layout', () => {
  // The pip distribution installs `jdtls.exe`, a self-contained launcher: no
  // configuration directory and no launcher jar are readable, but the command
  // itself is spawnable. The plugin has no say about its JVM, so no heap
  // ceiling is claimed - and no JDK is claimed either: the discovery may find
  // several, but none of them started this server.
  const machine = fakeMachine({ env: { PATH: 'C:\\tools\\jdtls' } })
  machine.addFile('C:\\tools\\jdtls\\jdtls.exe')
  const plan = javaServerPlan({
    ...machine.options(),
    root: 'D:\\projects\\app',
    profileBase: 'C:\\profile',
    memoryLimitMB: 2048,
    extraArgs: ['-Dfoo=bar'],
  })
  assert.equal(plan.ok, true)
  assert.equal(plan.mode, 'executable')
  assert.equal(plan.supportsMemoryLimit, false)
  assert.equal(plan.path, 'C:\\tools\\jdtls\\jdtls.exe')
  assert.equal(plan.source, 'command')
  assert.equal(plan.jdtlsHome, null)
  assert.equal(plan.javaHome, null, 'no discovered JDK started this server')
  assert.equal(plan.javaVersion, null)
  assert.deepEqual(plan.jdkCandidates, [])
  // The wrapper forwards `--jvm-arg` to the JVM: the JVM arguments of the
  // settings have a channel there, the raw token is not the wrapper argv.
  assert.deepEqual(plan.argv, [
    'C:\\tools\\jdtls\\jdtls.exe',
    '-data',
    plan.workspaceDir,
    '--jvm-arg=-Dfoo=bar',
  ])
})

test('the appendix-A stop-gap configuration now starts the JVM directly', () => {
  // `command: 'python'` + the jdtls launcher in `servers.java.args` was the
  // stop-gap of the document: it worked, but the JVM was a grandchild of the
  // plugin. That argument list describes the LAUNCHER and is used for
  // DISCOVERY only (`discoveryArgs`) - it must never reach the JVM: a script
  // path before `-jar` is taken as the main class.
  const machine = fakeMachine({ env: { JAVA_HOME: 'C:\\jdks\\jdk21' } })
  addJdtls(machine, 'D:\\tools\\jdtls-1.63.0')
  addJdk(machine, 'C:\\jdks\\jdk21', 21)
  machine.addFile('C:\\Python\\python.exe', '#!/usr/bin/env python3\n')
  const launcherArgs = ['D:\\tools\\jdtls-1.63.0\\bin\\jdtls', '--java-executable', 'C:\\jdks\\jdk21\\bin\\java.exe']
  const plan = javaServerPlan({
    ...machine.options(),
    command: 'C:\\Python\\python.exe',
    discoveryArgs: launcherArgs,
    root: 'D:\\projects\\app',
    memoryLimitMB: 2048,
    profileBase: 'C:\\profile',
  })
  assert.equal(plan.ok, true)
  assert.equal(plan.mode, 'jvm')
  assert.equal(plan.supportsMemoryLimit, true)
  assert.equal(plan.jdtlsHome, 'D:\\tools\\jdtls-1.63.0')
  assert.equal(plan.argv[0], 'C:\\jdks\\jdk21\\bin\\java.exe', 'the JVM is the direct child')
  // The launcher arguments are NOT JVM arguments: none of them may appear.
  assert.ok(!plan.argv.includes('D:\\tools\\jdtls-1.63.0\\bin\\jdtls'), 'the launcher script path must not reach the JVM')
  assert.ok(!plan.argv.includes('--java-executable'), 'a launcher flag must not reach the JVM')
  assert.ok(!plan.argv.some(argument => argument.startsWith('--jvm-arg')), 'the launcher-only prefix must not reach the JVM')
  assert.ok(!plan.argv.includes('C:\\Python\\python.exe'), 'the Python interpreter is not part of the command any more')
  // `-data` is an application argument: after the jar.
  const jar = plan.argv.indexOf('-jar')
  const data = plan.argv.indexOf('-data')
  assert.ok(data > jar, '-data comes after -jar')
  // Every token between the executable and `-jar` is an option - except the
  // VALUE of `--add-opens`, which is a module/package pair and not a path. A
  // bare path there would be the main class of the JVM instead of the Eclipse
  // launcher (the defect the discovery/jvm split fixes).
  for (let index = 1; index < jar; index += 1) {
    const argument = plan.argv[index]
    if (argument.startsWith('-')) continue
    assert.equal(plan.argv[index - 1], '--add-opens', `a non-option token was expected only as the value of --add-opens, got ${argument}`)
    assert.match(argument, /^[\w.]+\/[\w.]+=ALL-UNNAMED$/)
  }
})

test('the script fallback forwards the JVM arguments through --jvm-arg', () => {
  // A packaging whose layout cannot be read falls back to the official
  // launcher script. The script takes the JVM arguments through its
  // `--jvm-arg` channel; the raw `-D…` token must not be put on the command
  // line of the script (the script does not forward unknown arguments).
  const machine = fakeMachine()
  const script = 'D:\\tools\\jdtls\\bin\\jdtls'
  machine.addFile(script, '#!/usr/bin/env python3\n# org.eclipse.jdt.ls launcher\n')
  machine.addFile('C:\\Python\\python.exe', '#!/usr/bin/env python3\n')
  addJdk(machine, 'C:\\jdks\\jdk21', 21)
  const discoveryArgs = [script, '--java-executable', 'C:\\jdks\\jdk21\\bin\\java.exe']
  const plan = javaServerPlan({
    ...machine.options(),
    command: 'C:\\Python\\python.exe',
    jdtls: null,
    discoveryArgs,
    extraArgs: ['-Ddebug.jdt=true'],
    root: 'D:\\projects\\app',
    memoryLimitMB: 2048,
    profileBase: 'C:\\profile',
    lsp: { servers: { java: { javaHome: 'C:\\jdks\\jdk21' } } },
  })
  assert.equal(plan.ok, true)
  assert.equal(plan.mode, 'script')
  const executable = 'C:\\jdks\\jdk21\\bin\\java.exe'
  assert.deepEqual(plan.argv, [
    'C:\\Python\\python.exe',
    script,
    '--java-executable',
    executable,
    '--jvm-arg=-Ddebug.jdt=true',
    '-data',
    plan.workspaceDir,
  ])
  assert.equal(plan.argv.filter(argument => argument === script).length, 1, 'the script appears exactly once')
  assert.ok(!plan.argv.includes('-Ddebug.jdt=true'), 'the raw JVM argument must not be a token of the script argv')
})

test('a missing plan lists the JDKs that were found and names the setting', () => {
  const machine = fakeMachine()
  addJdk(machine, 'C:\\jdks\\jdk21', 21)
  const plan = javaServerPlan({
    ...machine.options(),
    root: 'D:\\projects\\app',
    lsp: { servers: { java: { javaHome: 'C:\\jdks\\jdk21' } } },
  })
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, 'jdtls-missing')
  assert.equal(plan.javaHome, 'C:\\jdks\\jdk21')
  assert.equal(plan.javaVersion, 21)
  assert.deepEqual(plan.jdkCandidates, [{ path: 'C:\\jdks\\jdk21', version: 21, source: 'setting' }])
  assert.match(plan.hint, /jdtls installation was not found/)
  assert.match(plan.hint, /C:\\jdks\\jdk21/, 'the hint lists the JDKs that were found')
  assert.match(plan.hint, /lsp\.servers\.java\.javaHome/, 'the hint names the override')
  // The document refuses a hard-coded requirement version: the installed
  // jdtls decides which JDK it accepts (PRD §3.6).
  assert.ok(!/JDK 21\+/.test(plan.hint))
})

test('a machine without any JDK says so instead of guessing one', () => {
  const machine = fakeMachine({ env: { JDTLS_HOME: 'D:\\tools\\jdtls-1.63.0' } })
  addJdtls(machine, 'D:\\tools\\jdtls-1.63.0')
  const plan = javaServerPlan({ ...machine.options(), root: 'D:\\projects\\app' })
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, 'jdk-missing')
  assert.match(plan.hint, /No JDK was found on this machine/)
})

test('a configured javaHome that is not a JDK is reported, not replaced', () => {
  // The user typed a path that does not exist. Silently starting another JDK
  // of the machine would hide the typo: the selection is null, the reason is
  // its own, and the hint names the setting (PRD §8.2 #7).
  const machine = fakeMachine({ env: { PATH: 'C:\\tools\\jdk21\\bin' } })
  addJdk(machine, 'C:\\tools\\jdk21', 21)
  const { candidates, selected, invalidJavaHome } = discoverJdks({
    ...machine.options(),
    lsp: { servers: { java: { javaHome: 'C:\\does-not-exist' } } },
  })
  assert.equal(invalidJavaHome, true)
  assert.equal(selected, null, 'a discovered JDK must not be used instead of the configured one')
  assert.deepEqual(candidates, [{ path: 'C:\\tools\\jdk21', version: 21, source: 'path' }], 'the discovered candidates are still listed')

  const plan = javaServerPlan({
    ...machine.options(),
    root: 'D:\\projects\\app',
    lsp: { servers: { java: { javaHome: 'C:\\does-not-exist' } } },
  })
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, 'jdk-invalid')
  assert.equal(plan.javaHome, null)
  assert.match(plan.hint, /lsp\.servers\.java\.javaHome/, 'the hint names the setting to fix')
  assert.match(plan.hint, /not a usable JDK/)
  assert.match(plan.hint, /C:\\tools\\jdk21/, 'the hint still lists the JDKs that were found')
})

// ── the sweep of the workspaces (PRD §4.3) ───────────────────────────────

test('the sweep removes only the jdtls workspaces of unknown roots', () => {
  const profileBase = 'C:\\Users\\tester\\.dsh'
  const workspaceBase = join(profileBase, 'ide-workbench', 'lsp-workspace')
  const knownRoot = 'D:\\projects\\app'
  const machine = fakeMachine()
  const known = join(workspaceBase, jdtlsDataDirName(knownRoot, machine.options()))
  const orphan = join(workspaceBase, 'jdtls-0123456789abcdef')
  const otherOrphan = join(workspaceBase, 'jdtls-ffffffffffffffff')
  machine.addDirectory(known)
  machine.addFile(join(orphan, 'index', 'cache.bin'), 'cache')
  machine.addDirectory(otherOrphan)
  const foreign = join(workspaceBase, 'not-a-jdtls-workspace')
  machine.addDirectory(foreign)
  const impostor = join(workspaceBase, 'jdtls-aaaaaaaaaaaaaaaa')
  machine.addFile(impostor, 'a file, not a workspace')

  const removed = sweepJavaWorkspaces([knownRoot], { ...machine.options(), profileBase })
  assert.deepEqual(
    removed.map(directory => pathKey(directory, 'win32')).sort(),
    [pathKey(orphan, 'win32'), pathKey(otherOrphan, 'win32')].sort(),
  )
  assert.ok(machine.has(orphan) === false, 'the orphan workspace is gone')
  assert.ok(machine.has(join(orphan, 'index', 'cache.bin')) === false, 'and so is its content')
  assert.ok(machine.has(known), 'the workspace of a known root survives - it IS the index cache')
  assert.ok(machine.has(foreign), 'a directory that is not a jdtls workspace is never touched')
  assert.ok(machine.has(impostor), 'a FILE with the name of a workspace is never touched')
  assert.equal(machine.removed.length, 2)
})

test('the sweep does nothing when the known-root set is empty', () => {
  // "Every workspace is an orphan" is the one conclusion that is always
  // wrong when the list was simply not filled in (PRD §4.3).
  const profileBase = 'C:\\profile'
  const machine = fakeMachine()
  const orphan = join(profileBase, 'ide-workbench', 'lsp-workspace', 'jdtls-0123456789abcdef')
  machine.addDirectory(orphan)
  assert.deepEqual(sweepJavaWorkspaces([], { ...machine.options(), profileBase }), [])
  assert.ok(machine.has(orphan), 'the workspace was not removed')
  assert.deepEqual(sweepJavaWorkspaces(undefined, { ...machine.options(), profileBase }), [])
  assert.ok(machine.has(orphan))
})

test('the sweep keeps the workspace of a live owner process', () => {
  // Two DSH hosts of one profile must not sweep each other's running server:
  // the owner marker next to the workspace names the JVM, and a LIVE process
  // keeps its workspace even when the root is not known to this host.
  const profileBase = 'C:\\profile'
  const workspaceBase = join(profileBase, 'ide-workbench', 'lsp-workspace')
  const live = join(workspaceBase, 'jdtls-0123456789abcdef')
  const dead = join(workspaceBase, 'jdtls-ffffffffffffffff')
  const bare = join(workspaceBase, 'jdtls-1111111111111111')
  const machine = fakeMachine()
  machine.addDirectory(live)
  machine.addDirectory(dead)
  machine.addDirectory(bare)
  machine.alivePids.add(4242)
  assert.equal(markJavaWorkspaceOwner(live, 4242, machine.options()), true)
  assert.equal(markJavaWorkspaceOwner(dead, 9999, machine.options()), true)

  const removed = sweepJavaWorkspaces(['D:\\projects\\app'], { ...machine.options(), profileBase })
  assert.deepEqual(
    removed.map(directory => pathKey(directory, 'win32')).sort(),
    [pathKey(dead, 'win32'), pathKey(bare, 'win32')].sort(),
  )
  assert.ok(machine.has(live), 'the workspace of a live process is kept')
  assert.ok(machine.has(`${live}.pid`), 'and so is its marker')
  assert.ok(machine.has(dead) === false, 'a dead owner does not protect the workspace')
  assert.ok(machine.has(`${dead}.pid`) === false, 'the marker is removed with the workspace')
  assert.ok(machine.has(bare) === false, 'a workspace without a marker is an orphan')
})

test('markJavaWorkspaceOwner writes the marker next to the workspace', () => {
  const machine = fakeMachine()
  const workspaceDir = 'C:\\profile\\ide-workbench\\lsp-workspace\\jdtls-0123456789abcdef'
  machine.addDirectory(workspaceDir)
  assert.equal(markJavaWorkspaceOwner(workspaceDir, 4242, machine.options()), true)
  assert.ok(machine.has(`${workspaceDir}.pid`))
  assert.equal(machine.options().readFile(`${workspaceDir}.pid`).trim(), '4242')
})

test('markJavaWorkspaceOwner refuses invalid input', () => {
  const machine = fakeMachine()
  machine.addDirectory('C:\\profile\\ide-workbench\\lsp-workspace')
  for (const [workspaceDir, pid] of [
    ['', 1],
    [undefined, 1],
    [null, 1],
    ['C:\\profile\\ide-workbench\\lsp-workspace\\jdtls-0123456789abcdef', 0],
    ['C:\\profile\\ide-workbench\\lsp-workspace\\jdtls-0123456789abcdef', -1],
    ['C:\\profile\\ide-workbench\\lsp-workspace\\jdtls-0123456789abcdef', 1.5],
    ['C:\\profile\\ide-workbench\\lsp-workspace\\jdtls-0123456789abcdef', '42'],
    ['C:\\profile\\ide-workbench\\lsp-workspace\\jdtls-0123456789abcdef', null],
  ]) {
    assert.equal(markJavaWorkspaceOwner(workspaceDir, pid, machine.options()), false, `${workspaceDir} / ${pid}`)
  }
  // A machine that cannot write the marker answers false instead of throwing:
  // a workspace that cannot be marked is still a working workspace.
  const unwritable = { ...machine.options(), writeFile: () => { throw new Error('EPERM') } }
  assert.equal(markJavaWorkspaceOwner('C:\\profile\\ide-workbench\\lsp-workspace\\jdtls-0123456789abcdef', 42, unwritable), false)
})

test('markJavaWorkspaceOwner writes one line per owning process', () => {
  // The marker names the JVM and the HOST: the JVM protects the running
  // server, the host protects the workspace of a server that was released on
  // the idle policy (the next payload wakes the same index).
  const machine = fakeMachine()
  const workspaceDir = 'C:\\profile\\ide-workbench\\lsp-workspace\\jdtls-0123456789abcdef'
  machine.addDirectory(workspaceDir)
  assert.equal(markJavaWorkspaceOwner(workspaceDir, [4242, 5151], machine.options()), true)
  const lines = machine.options().readFile(`${workspaceDir}.pid`).split(/\r?\n/).filter(line => line !== '')
  assert.deepEqual(lines, ['4242', '5151'])
  // The marker is written ATOMICALLY (temporary file + rename): a half written
  // marker must never read as "no owner" and let a sweep delete a live
  // workspace.
  assert.ok(!machine.has(`${workspaceDir}.pid.tmp`), 'the temporary file of the atomic write is gone')
})

test('markJavaWorkspaceOwner unions the owners instead of replacing them', () => {
  // Two DSH hosts of one profile may open the same project: the host that
  // writes last must not drop the pid of the JVM the other one still runs.
  const machine = fakeMachine()
  const workspaceDir = 'C:\\profile\\ide-workbench\\lsp-workspace\\jdtls-0123456789abcdef'
  machine.addDirectory(workspaceDir)
  machine.alivePids.add(4242)
  machine.alivePids.add(5151)
  assert.equal(markJavaWorkspaceOwner(workspaceDir, [4242, 5151], machine.options()), true)
  // A third process (another host) joins while the first two are alive.
  assert.equal(markJavaWorkspaceOwner(workspaceDir, [6262], machine.options()), true)
  const lines = () => machine.options().readFile(`${workspaceDir}.pid`).split(/\r?\n/).filter(line => line !== '')
  assert.deepEqual(lines(), ['4242', '5151', '6262'])
  // A pid that already owns the workspace is not repeated.
  assert.equal(markJavaWorkspaceOwner(workspaceDir, [4242, 6262], machine.options()), true)
  assert.deepEqual(lines(), ['4242', '5151', '6262'])
  assert.ok(!machine.has(`${workspaceDir}.pid.tmp`))
})

test('a dead owner is dropped when the marker is rewritten', () => {
  const machine = fakeMachine()
  const workspaceDir = 'C:\\profile\\ide-workbench\\lsp-workspace\\jdtls-0123456789abcdef'
  machine.addDirectory(workspaceDir)
  // The first host registered its pid while it was alive; then it died.
  machine.alivePids.add(4242)
  assert.equal(markJavaWorkspaceOwner(workspaceDir, [4242], machine.options()), true)
  machine.alivePids.delete(4242)
  machine.alivePids.add(6262)
  // The rewrite keeps the live owner and adds the new one; the dead 4242 is
  // not carried over, so the marker does not grow for ever.
  assert.equal(markJavaWorkspaceOwner(workspaceDir, [6262], machine.options()), true)
  const lines = machine.options().readFile(`${workspaceDir}.pid`).split(/\r?\n/).filter(line => line !== '')
  assert.deepEqual(lines, ['6262'])
})

test('a marker whose atomic rename fails leaves no temp file behind', () => {
  // The write is temp + rename: an interrupted write must not leave garbage
  // in the workspace folder, and the caller has to hear that it failed.
  const machine = fakeMachine()
  const profileBase = 'C:\\profile'
  const workspaceBase = join(profileBase, 'ide-workbench', 'lsp-workspace')
  const workspaceDir = join(workspaceBase, 'jdtls-0123456789abcdef')
  machine.addDirectory(workspaceDir)
  const failingRename = { ...machine.options(), rename: () => { throw new Error('EPERM') } }

  assert.equal(markJavaWorkspaceOwner(workspaceDir, 4242, failingRename), false, 'the failure is reported')
  assert.ok(!machine.has(`${workspaceDir}.pid`), 'no marker was written')
  const leftovers = machine.options().readdir(workspaceBase)
    .filter(entry => entry.isFile() && entry.name.endsWith('.tmp'))
  assert.deepEqual(leftovers.map(entry => entry.name), [], 'the temporary file is removed')
})

test('the sweep removes the stale marker temp files of the workspace folder', () => {
  const profileBase = 'C:\\profile'
  const workspaceBase = join(profileBase, 'ide-workbench', 'lsp-workspace')
  const knownRoot = 'D:\\projects\\app'
  const machine = fakeMachine()
  const known = join(workspaceBase, jdtlsDataDirName(knownRoot, machine.options()))
  machine.addDirectory(known)
  // A real owner marker of the known root is NOT touched.
  machine.addFile(`${known}.pid`, '4242\n')
  // Temp files of interrupted marker writes (the unique name pattern).
  machine.addFile(join(workspaceBase, 'jdtls-0123456789abcdef.pid.4242.1.tmp'), '4242\n')
  machine.addFile(join(workspaceBase, 'jdtls-0123456789abcdef.pid.5151.2.tmp'), '5151\n')

  const removed = sweepJavaWorkspaces([knownRoot], { ...machine.options(), profileBase })
  assert.deepEqual(removed, [], 'the workspace of the known root is kept')
  assert.ok(machine.has(known))
  assert.ok(machine.has(`${known}.pid`), 'a real owner marker is not swept')
  const leftovers = machine.options().readdir(workspaceBase)
    .filter(entry => entry.isFile() && entry.name.endsWith('.tmp'))
  assert.deepEqual(leftovers, [], 'the stale temp files are gone')
})

test('markJavaWorkspaceOwner deduplicates and refuses a list without a valid pid', () => {
  const machine = fakeMachine()
  const workspaceDir = 'C:\\profile\\ide-workbench\\lsp-workspace\\jdtls-0123456789abcdef'
  machine.addDirectory(workspaceDir)
  // Equal and invalid pids are dropped; the valid ones stay, in order.
  assert.equal(markJavaWorkspaceOwner(workspaceDir, [7, 7, 0, -3, 1.5, '9', 3], machine.options()), true)
  const lines = machine.options().readFile(`${workspaceDir}.pid`).split(/\r?\n/).filter(line => line !== '')
  assert.deepEqual(lines, ['7', '3'])
  // No valid pid at all: nothing is written.
  const untouched = `${workspaceDir}-untouched`
  machine.addDirectory(untouched)
  assert.equal(markJavaWorkspaceOwner(untouched, [0, -1, 1.5, 'x', null], machine.options()), false)
  assert.ok(!machine.has(`${untouched}.pid`))
})

test('the sweep keeps a multi-owner workspace while ANY owner is alive', () => {
  const profileBase = 'C:\\profile'
  const workspaceBase = join(profileBase, 'ide-workbench', 'lsp-workspace')
  const partlyAlive = join(workspaceBase, 'jdtls-0123456789abcdef')
  const allDead = join(workspaceBase, 'jdtls-ffffffffffffffff')
  const machine = fakeMachine()
  machine.addDirectory(partlyAlive)
  machine.addDirectory(allDead)
  machine.alivePids.add(5151)
  assert.equal(markJavaWorkspaceOwner(partlyAlive, [4242, 5151], machine.options()), true)
  assert.equal(markJavaWorkspaceOwner(allDead, [6666, 7777], machine.options()), true)

  const removed = sweepJavaWorkspaces(['D:\\projects\\app'], { ...machine.options(), profileBase })
  assert.deepEqual(removed.map(directory => pathKey(directory, 'win32')), [pathKey(allDead, 'win32')])
  assert.ok(machine.has(partlyAlive), 'one live owner is enough to keep the workspace')
  assert.ok(machine.has(`${partlyAlive}.pid`))
  assert.ok(machine.has(allDead) === false, 'all owners are dead: the workspace is an orphan')
  assert.ok(machine.has(`${allDead}.pid`) === false, 'the marker is removed together with the workspace')
})

// ── the default settings carry no concrete path (PRD §3.1, §7.1) ─────────

test('the default settings carry no concrete java path', () => {
  // `servers` is a FREE object: the four java keys exist only as documented
  // defaults and must never be written into the default document. A default
  // javaHome/jdtlsHome/javaSearchRoots would degrade the plugin to "works on
  // one machine only" (PRD §3.1, §7.1) - and `javaSearchRoots` must default
  // to an empty array in the documentation, i.e. to nothing at all here.
  assert.deepEqual(DEFAULT_LSP_SETTINGS.servers, {})
  const serialized = JSON.stringify(DEFAULT_LSP_SETTINGS.servers)
  assert.ok(!/(?:^|[^\w])[A-Za-z]:[\\/]/.test(serialized), `a drive letter: ${serialized}`)
  assert.ok(!/Program Files[\\/]/i.test(serialized), `a standard install path: ${serialized}`)
  assert.ok(!/(?:^|[\\/])(?:Users|home|opt)[\\/]/.test(serialized), `a user path: ${serialized}`)
})

// ── the portability red line (PRD §3.1) ─────────────────────────────────

test('the Java runtime and the host hold no machine-specific path literal', () => {
  // The rule of PRD §3.1: which JDK/jdtls exists is decided by the machine,
  // never by a literal of the module. Plain folder NAMES are allowed and
  // expected - "JetBrains" and "Program Files" are the vendor folders the
  // fallback scan of PRD §3.2 #6 derives from the environment, and they are
  // not machine-specific. What is forbidden is an absolute path of one
  // machine: a drive letter, a path INTO a standard install folder, the IDE
  // version or the user name of the incident.
  //
  // The drive-letter pattern needs the `[^\w]` guard: `file://` and
  // `http://` carry a letter before the `:` too, and they are not paths.
  const files = [
    join(repoRoot, 'src', 'host', 'java-runtime.js'),
    join(repoRoot, 'src', 'host', 'lsp.js'),
  ]
  const forbidden = [
    { name: 'an absolute Windows path', pattern: /(?:^|[^\w])[A-Za-z]:[\\/]/m },
    { name: 'a path into the standard install folder', pattern: /Program Files[\\/]/i },
    { name: 'the IDE version of the incident', pattern: /IntelliJ IDEA 2026/ },
    { name: 'a Unix user home', pattern: /\/Users\// },
    { name: 'the user of the incident', pattern: /X-L-S/ },
  ]
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const { name, pattern } of forbidden) {
      const match = pattern.exec(source)
      assert.equal(match, null, `${file} contains ${name}: ${match === null ? '' : match[0]}`)
    }
  }
})
