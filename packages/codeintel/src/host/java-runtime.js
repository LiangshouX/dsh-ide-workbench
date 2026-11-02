/**
 * The Java runtime of the jdtls language server (PRD-v5.1 JS-01…JS-05).
 *
 * jdtls is not one executable: it is an Eclipse OSGi application that needs a
 * JDK to run, a configuration directory and an equinox launcher. The install
 * of the user is the official tarball layout, whose `bin/jdtls` is a *Python*
 * script - and a Python script cannot be spawned directly on Windows (the
 * kernel looks for `jdtls.exe` and reports ENOENT). The host therefore starts
 * the JVM itself (`java … -jar org.eclipse.equinox.launcher_*.jar …`) instead
 * of the launcher script: the JVM is then the DIRECT child of the plugin, so
 * the memory valve and the idle exit can really stop it (PRD §2.1).
 *
 * What this module answers:
 *
 *   1. WHERE is jdtls (the installation root, its configuration directory and
 *      the equinox launcher jar) - from the settings, from `JDTLS_HOME`, or by
 *      walking up from the `jdtls` that PATH resolves (JS-01);
 *   2. WHERE is a JDK that jdtls accepts - discovered, never hard-coded
 *      (JS-02). The machine of the user may have the IDE on another drive, or
 *      not installed at all; the discoverer only reads what the operating
 *      system and the IDE itself wrote down (environment variables, the
 *      `jdk.table.xml` registry of the IDE, the `jbr` bundled with the IDE);
 *   3. WHICH workspace every project root gets (`-data`): jdtls hashes the
 *      NAME of its working directory, so two projects called `app` share one
 *      index and poison each other. The host passes an explicit, per-root
 *      directory under the plugin profile (JS-03);
 *   4. the full argv of the JVM, including the heap of the effective ceiling
 *      of the session - the number the settings page shows (JS-05).
 *
 * Portability is a rule of the document (PRD §3.1), not a preference: this
 * module contains no absolute path, no drive letter, no user name and no IDE
 * version. Everything is derived from the injected environment and file
 * system; the injectable seams (`platform`, `env`, `home`, `stat`, `readFile`,
 * `readdir`, `remove`) are the same ones `idea.js` established, so the tests
 * can build a fake machine without touching the real one.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

/**
 * The Eclipse application of the Java language server.
 *
 * The value is the contract of every jdtls 1.x release (it is what
 * `config_win/config.ini` declares); the arguments around it are the set that
 * was measured to start jdtls 1.63.0 (PRD §2.3).
 */
export const JDTLS_APPLICATION = 'org.eclipse.jdt.ls.core.id1'

/** The Eclipse product of the Java language server. */
export const JDTLS_PRODUCT = 'org.eclipse.jdt.ls.core.product'

/**
 * The directory name of the jdtls configuration area, per platform.
 *
 * The official distribution ships one directory per operating system; the
 * JVM needs the one of the platform it runs on.
 * @param {string} platform a `process.platform` value
 * @returns {string}
 */
export function jdtlsConfigDirName(platform) {
  if (platform === 'win32') return 'config_win'
  if (platform === 'darwin') return 'config_mac'
  return 'config_linux'
}

/**
 * The file name of the Java launcher, per platform.
 * @param {string} platform a `process.platform` value
 * @returns {string}
 */
export function javaExecutableName(platform) {
  return platform === 'win32' ? 'java.exe' : 'java'
}

/** The largest number of directories one fallback scan may enter. */
const MAX_SCAN_DIRECTORIES = 600

/** The largest depth of one fallback scan below its root. */
const MAX_SCAN_DEPTH = 4

/**
 * The IDE launchers whose directory carries a bundled JetBrains Runtime.
 *
 * A JetBrains IDE ships its own JDK under `<ideHome>/jbr`; the launcher in
 * `<ideHome>/bin` is the reliable way to find an IDE that is on PATH. The
 * names are the documented binaries of the products, not a path: which one
 * exists is decided by the file system of the machine.
 */
const IDE_LAUNCHER_NAMES = {
  win32: [
    'idea64.exe', 'idea.exe',
    'webstorm64.exe', 'webstorm.exe',
    'pycharm64.exe', 'pycharm.exe',
    'goland64.exe', 'goland.exe',
    'clion64.exe', 'clion.exe',
    'rubymine64.exe', 'rubymine.exe',
    'phpstorm64.exe', 'phpstorm.exe',
    'datagrip64.exe', 'datagrip.exe',
    'rider64.exe', 'rider.exe',
    'rustrover64.exe', 'rustrover.exe',
    'studio64.exe', 'studio.exe',
    'gateway64.exe', 'gateway.exe',
  ],
  darwin: ['idea', 'webstorm', 'pycharm', 'goland', 'clion', 'rubymine', 'phpstorm', 'datagrip', 'rider', 'rustrover', 'studio', 'gateway'],
  other: ['idea.sh', 'webstorm.sh', 'pycharm.sh', 'goland.sh', 'clion.sh', 'rubymine.sh', 'phpstorm.sh', 'datagrip.sh', 'rider.sh', 'rustrover.sh', 'studio.sh', 'gateway.sh'],
}

/** The names of the Java binary inside a JetBrains Runtime, per platform. */
const JBR_BINARY_NAMES = {
  win32: ['java.exe'],
  darwin: ['java'],
  other: ['java'],
}

// ── the injectable machine ────────────────────────────────────────────────

/** The `stat` of this machine. */
function defaultStat(path) {
  return statSync(path)
}

/** The `readdir` of this machine, with the file types. */
function defaultReaddir(path) {
  return readdirSync(path, { withFileTypes: true })
}

/** The `readFile` of this machine (UTF-8). */
function defaultReadFile(path) {
  return readFileSync(path, 'utf8')
}

/** The `remove` of this machine (recursive, best effort). */
function defaultRemove(path) {
  rmSync(path, { recursive: true, force: true })
}

/** The `writeFile` of this machine (UTF-8). */
function defaultWriteFile(path, text) {
  writeFileSync(path, text, 'utf8')
}

/** The `mkdir` of this machine. */
function defaultMkdir(path, options) {
  mkdirSync(path, options)
}

/** The `rename` of this machine (atomic replacement of the marker). */
function defaultRename(from, to) {
  renameSync(from, to)
}

/**
 * Whether one process id is alive.
 *
 * `process.kill(pid, 0)` sends no signal, it only asks the operating system
 * whether the process exists: the check has no side effect on the process.
 * `EPERM` means "the process exists but belongs to somebody else" - it is
 * ALIVE, and treating it as dead would allow the sweep of a workspace that a
 * foreign (administrator) host still uses.
 * @param {number} pid the process id
 * @returns {boolean}
 */
function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error !== null && typeof error === 'object' && error.code === 'EPERM'
  }
}

/**
 * The file system and the environment one call works on.
 *
 * Every value can be injected. The defaults are the real machine.
 * @param {object} [options] the options of the caller
 * @returns {object} the environment of one call
 */
function machineOf(options = {}) {
  const platform = typeof options.platform === 'string' ? options.platform : process.platform
  return {
    platform,
    env: options.env ?? process.env,
    home: typeof options.home === 'string' ? options.home : homedir(),
    stat: typeof options.stat === 'function' ? options.stat : defaultStat,
    readdir: typeof options.readdir === 'function' ? options.readdir : defaultReaddir,
    readFile: typeof options.readFile === 'function' ? options.readFile : defaultReadFile,
    remove: typeof options.remove === 'function' ? options.remove : defaultRemove,
    writeFile: typeof options.writeFile === 'function' ? options.writeFile : defaultWriteFile,
    mkdir: typeof options.mkdir === 'function' ? options.mkdir : defaultMkdir,
    rename: typeof options.rename === 'function' ? options.rename : defaultRename,
    isProcessAlive: typeof options.isProcessAlive === 'function' ? options.isProcessAlive : defaultIsProcessAlive,
    paths: platform === 'win32' ? win32 : posix,
  }
}

/**
 * Whether one path is a regular file.
 * @param {object} machine the machine of the call
 * @param {string} path the path
 * @returns {boolean}
 */
function isFileAt(machine, path) {
  try {
    return machine.stat(path).isFile()
  } catch {
    return false
  }
}

/**
 * Whether one path is a directory (a symlink to a directory counts: the
 * JetBrains Toolbox links its applications into `Toolbox\apps`).
 * @param {object} machine the machine of the call
 * @param {string} path the path
 * @returns {boolean}
 */
function isDirectoryAt(machine, path) {
  try {
    return machine.stat(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * The value of one environment variable, case-insensitively.
 *
 * Windows spells the same variable in several ways (`Path` / `PATH`,
 * `ProgramFiles` / `PROGRAMFILES`), and a test that injects an environment
 * must not have to guess the spelling the production code uses.
 * @param {object} env the environment
 * @param {string} name the name of the variable
 * @returns {string | null}
 */
export function envValue(env, name) {
  if (env === null || typeof env !== 'object') return null
  const wanted = name.toUpperCase()
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() !== wanted) continue
    if (typeof value !== 'string' || value === '') continue
    return value
  }
  return null
}

/**
 * The comparison key of one directory: paths that name the same place have
 * the same key (case-insensitive on Windows).
 * @param {string} path the absolute path
 * @param {string} [platform] a `process.platform` value
 * @returns {string}
 */
export function pathKey(path, platform = process.platform) {
  const paths = platform === 'win32' ? win32 : posix
  const normalized = paths.normalize(String(path)).replace(/[\\/]+$/, '')
  const slashed = normalized.replace(/\\/g, '/')
  return platform === 'win32' ? slashed.toLowerCase() : slashed
}

// ── JDK versions ──────────────────────────────────────────────────────────

/** The `JAVA_VERSION` line of a `release` file. */
const JAVA_VERSION_LINE = /^JAVA_VERSION\s*=\s*"?([^"\r\n]+)"?\s*$/m

/**
 * The major version of a Java version string.
 *
 * `25.0.3` is 25 and `1.8.0_392` is 8: the "1." prefix of the pre-9 releases
 * is the oddity of the version scheme, not a major version.
 * @param {string} version the version string
 * @returns {number | null} the major version, or null when unreadable
 */
export function javaMajorOf(version) {
  if (typeof version !== 'string') return null
  const cleaned = version.trim().replace(/^["']|["']$/g, '')
  const match = /^(\d+)(?:\.(\d+))?/.exec(cleaned)
  if (match === null) return null
  const first = Number(match[1])
  if (first === 1 && match[2] !== undefined) return Number(match[2])
  return first
}

/**
 * The major version declared by the `release` file of a JDK.
 * @param {string} text the contents of the `release` file
 * @returns {number | null} the major version, or null
 */
export function parseJavaVersion(text) {
  if (typeof text !== 'string') return null
  const match = JAVA_VERSION_LINE.exec(text)
  if (match === null) return null
  return javaMajorOf(match[1])
}

/**
 * Expand the macros an IDE writes into its own path table.
 *
 * IntelliJ writes `$USER_HOME$/.jdks/corretto-21.0.3` into `jdk.table.xml`;
 * a reader that does not expand the macro finds no such directory and
 * silently loses the candidate (PRD §3.2 #4).
 * @param {string} value the raw value
 * @param {string} home the home directory of the user
 * @param {string} [platform] a `process.platform` value
 * @returns {string}
 */
export function expandHomeMacros(value, home, platform = process.platform) {
  if (typeof value !== 'string') return ''
  const paths = platform === 'win32' ? win32 : posix
  let expanded = value.replace(/\$USER_HOME\$/g, home)
  if (expanded === '~') return home
  if (expanded.startsWith('~/') || expanded.startsWith('~\\')) {
    expanded = paths.join(home, expanded.slice(2))
  }
  return expanded
}

// ── the JDK candidates ────────────────────────────────────────────────────

/**
 * The sources of the JDK discovery, in the order of the document.
 *
 * The order is the priority of the discovery: the explicit setting wins over
 * everything, and among the discovered candidates the HIGHEST version wins
 * (Java is backwards compatible - a Java 26 can run the Java 25 bundles of
 * jdtls, the reverse is not true; and the `JAVA_HOME` of the machine is
 * usually an old one, so "the first usable" would be the wrong one).
 */
export const JDK_SOURCES = ['setting', 'JAVA_HOME', 'path', 'jdk-table', 'bundled-jbr', 'scan']

/**
 * Resolve one JDK directory or executable into a usable JDK.
 *
 * The value may be the JDK directory (with `bin\java.exe` inside) or the Java
 * executable itself - both are accepted by the settings (PRD §7.1). A
 * directory that does not hold a JDK, or a version that cannot be read from
 * its `release` file, is not a candidate: guessing a version would be worse
 * than skipping the candidate.
 * @param {string} value the configured value
 * @param {object} [options] the machine (see {@link machineOf})
 * @returns {{ home: string, executable: string, version: number } | null}
 */
export function resolveJavaHome(value, options = {}) {
  const machine = machineOf(options)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.includes('\0')) return null
  const expanded = expandHomeMacros(trimmed, machine.home, machine.platform)
  if (!machine.paths.isAbsolute(expanded)) return null
  let home
  let executable
  if (isFileAt(machine, expanded)) {
    // The value is the Java executable itself.
    const name = machine.paths.basename(expanded).toLowerCase()
    if (name !== 'java' && name !== 'java.exe') return null
    home = machine.paths.dirname(machine.paths.dirname(expanded))
    executable = expanded
  } else if (isDirectoryAt(machine, expanded)) {
    home = expanded
    executable = machine.paths.join(expanded, 'bin', javaExecutableName(machine.platform))
  } else {
    return null
  }
  if (!isFileAt(machine, executable)) return null
  const version = javaVersionOf(home, options)
  if (version === null) return null
  return { home: machine.paths.normalize(home), executable: machine.paths.normalize(executable), version }
}

/**
 * The major version of the JDK in one directory (read from its `release`).
 * @param {string} home the JDK directory
 * @param {object} [options] the machine (see {@link machineOf})
 * @returns {number | null}
 */
export function javaVersionOf(home, options = {}) {
  const machine = machineOf(options)
  const release = machine.paths.join(home, 'release')
  if (!isFileAt(machine, release)) return null
  try {
    return parseJavaVersion(machine.readFile(release))
  } catch {
    return null
  }
}

/**
 * Collect the JDKs a machine offers, from every source of the document.
 *
 * Sources (all derived from the environment or from files an IDE wrote):
 *
 *   1. `lsp.servers.java.javaHome` - the explicit choice of the user;
 *   2. `JAVA_HOME`;
 *   3. every `java` on PATH;
 *   4. the JDK table of the IDEs (`<config root>/<product>/options/jdk.table.xml`);
 *   5. the JetBrains Runtime bundled with an IDE (`<ideHome>/jbr`), found
 *      through the launcher of the IDE on PATH or in the settings;
 *   6. the fallback scan of the environment-derived roots and of the
 *      `javaSearchRoots` the user added.
 *
 * @param {object} [options] the machine and the settings
 * @param {object} [options.lsp] the `lsp` section of the settings
 * @returns {{ candidates: Array<{ path: string, version: number, source: string }>, selected: { path: string, executable: string, version: number, source: string } | null, invalidJavaHome: boolean }}
 *   the candidates (highest version first, for the settings page), the one
 *   the server would start with - null when the CONFIGURED `javaHome` is not
 *   a usable JDK, because silently starting another one is the "silently
 *   picked a wrong JDK" the document warns about - and whether that was the
 *   reason for it
 */
export function discoverJdks(options = {}) {
  const machine = machineOf(options)
  const java = javaSettingsOf(options.lsp)
  /** @type {Array<{ path: string, executable: string, version: number, source: string }>} */
  const found = []
  const seen = new Set()
  const add = (value, source) => {
    const resolved = resolveJavaHome(value, options)
    if (resolved === null) return
    const key = pathKey(resolved.home, machine.platform)
    if (seen.has(key)) return
    seen.add(key)
    found.push({ path: resolved.home, executable: resolved.executable, version: resolved.version, source })
  }
  // 1. the explicit setting
  const configured = typeof java.javaHome === 'string' && java.javaHome.trim() !== '' ? java.javaHome : null
  if (configured !== null) add(configured, 'setting')
  // 2. JAVA_HOME
  const envJavaHome = envValue(machine.env, 'JAVA_HOME')
  if (envJavaHome !== null) add(envJavaHome, 'JAVA_HOME')
  // 3. every java on PATH
  for (const executable of executablesOnPath(machine, ['java', 'java.exe'])) add(executable, 'path')
  // 4. the JDK table the IDEs wrote
  for (const home of jdkTableHomes(machine)) add(home, 'jdk-table')
  // 5. the JetBrains Runtime of an installed IDE
  for (const home of bundledJbrHomes(machine, options)) add(home, 'bundled-jbr')
  // 6. the fallback scan (only roots derived from the environment)
  for (const home of scannedJdkHomes(machine, java.javaSearchRoots)) add(home, 'scan')

  // The settings page shows the highest version first; the order among equal
  // versions stays the priority order of the sources (the sort is stable).
  const candidates = [...found]
    .sort((left, right) => right.version - left.version)
    .map(candidate => ({ path: candidate.path, version: candidate.version, source: candidate.source }))
  const explicit = found.find(candidate => candidate.source === 'setting') ?? null
  const highest = found.reduce((best, candidate) => (best === null || candidate.version > best.version ? candidate : best), null)
  // A configured JDK that cannot be used is NOT replaced by a discovered one:
  // the user asked for that JDK, and starting another one hides the typo
  // (PRD §8.2 #7). The failure names the setting instead.
  const invalidJavaHome = configured !== null && explicit === null
  const selected = invalidJavaHome ? null : (explicit ?? highest)
  return {
    candidates,
    selected: selected === null
      ? null
      : { path: selected.path, executable: selected.executable, version: selected.version, source: selected.source },
    invalidJavaHome,
  }
}

/**
 * The `java` section of the `lsp` settings.
 * @param {object} lsp the `lsp` section
 * @returns {object}
 */
function javaSettingsOf(lsp) {
  const servers = lsp !== null && typeof lsp === 'object' && typeof lsp.servers === 'object' && lsp.servers !== null
    ? lsp.servers
    : {}
  const java = servers.java
  return java !== null && typeof java === 'object' ? java : {}
}

/**
 * Every executable of one list of names on PATH.
 * @param {object} machine the machine of the call
 * @param {string[]} names the file names to look for
 * @returns {string[]} the absolute paths, in the order of PATH
 */
function executablesOnPath(machine, names) {
  const value = envValue(machine.env, 'PATH') ?? ''
  const separator = machine.platform === 'win32' ? ';' : ':'
  const found = []
  for (const raw of value.split(separator)) {
    const directory = raw.trim().replace(/^"(.*)"$/, '$1')
    if (directory === '' || !machine.paths.isAbsolute(directory)) continue
    for (const name of names) {
      const candidate = machine.paths.join(directory, name)
      if (isFileAt(machine, candidate)) found.push(candidate)
    }
  }
  return found
}

/**
 * The JDK homes the IDE path tables of the machine declare.
 *
 * IntelliJ writes every JDK the user configured into
 * `<configRoot>/<product>/options/jdk.table.xml`, with an ABSOLUTE
 * `homePath`. That is the most portable source of the document: it does not
 * depend on where the IDE is installed (PRD §3.2 #4).
 * @param {object} machine the machine of the call
 * @returns {string[]} the home directories (macros already expanded)
 */
function jdkTableHomes(machine) {
  const homes = []
  for (const configRoot of jetbrainsConfigRoots(machine)) {
    let entries
    try {
      entries = machine.readdir(configRoot)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const file = machine.paths.join(configRoot, entry.name, 'options', 'jdk.table.xml')
      if (!isFileAt(machine, file)) continue
      let text
      try {
        text = machine.readFile(file)
      } catch {
        continue
      }
      for (const match of text.matchAll(/<homePath\s+value="([^"]*)"/g)) {
        const expanded = expandHomeMacros(match[1], machine.home, machine.platform)
        if (expanded !== '' && machine.paths.isAbsolute(expanded)) homes.push(expanded)
      }
    }
  }
  return homes
}

/**
 * The configuration directories of the JetBrains IDEs, per platform.
 *
 * The roots are DERIVED from the environment (`APPDATA`, `XDG_CONFIG_HOME`,
 * the home directory); the product directories below them are read from the
 * file system, so a new IDE version is found without a code change.
 * @param {object} machine the machine of the call
 * @returns {string[]}
 */
function jetbrainsConfigRoots(machine) {
  const roots = []
  if (machine.platform === 'win32') {
    const appData = envValue(machine.env, 'APPDATA')
    if (appData !== null && machine.paths.isAbsolute(appData)) roots.push(machine.paths.join(appData, 'JetBrains'))
    const localAppData = envValue(machine.env, 'LOCALAPPDATA')
    if (localAppData !== null && machine.paths.isAbsolute(localAppData)) roots.push(machine.paths.join(localAppData, 'JetBrains'))
  } else if (machine.platform === 'darwin') {
    roots.push(machine.paths.join(machine.home, 'Library', 'Application Support', 'JetBrains'))
  } else {
    const xdg = envValue(machine.env, 'XDG_CONFIG_HOME')
    roots.push(xdg !== null && machine.paths.isAbsolute(xdg)
      ? machine.paths.join(xdg, 'JetBrains')
      : machine.paths.join(machine.home, '.config', 'JetBrains'))
  }
  return [...new Set(roots)]
}

/**
 * The JetBrains Runtimes of the IDEs of the machine.
 *
 * The JBR is NOT in the JDK table of the IDE (it is the implicit runtime of
 * the IDE), so it has to be found through the IDE itself: the launcher lives
 * in `<ideHome>/bin`, the runtime in `<ideHome>/jbr` (on macOS both are below
 * `Contents`, so the two `dirname` calls give the same shape).
 * @param {object} machine the machine of the call
 * @param {object} [options] the machine and the settings
 * @returns {string[]} the `jbr` directories
 */
function bundledJbrHomes(machine, options = {}) {
  const homes = []
  const launchers = []
  // The explicit launcher of the settings comes first: it is the reliable
  // way for an IDE that is not on PATH (PRD §3.2 #5).
  if (typeof options.ideaPath === 'string' && options.ideaPath !== '') {
    const expanded = expandHomeMacros(options.ideaPath, machine.home, machine.platform)
    if (machine.paths.isAbsolute(expanded)) launchers.push(expanded)
  }
  const names = machine.platform === 'win32'
    ? IDE_LAUNCHER_NAMES.win32
    : (machine.platform === 'darwin' ? IDE_LAUNCHER_NAMES.darwin : IDE_LAUNCHER_NAMES.other)
  for (const launcher of executablesOnPath(machine, names)) launchers.push(launcher)
  for (const launcher of launchers) {
    const ideHome = machine.paths.dirname(machine.paths.dirname(launcher))
    const jbr = machine.paths.join(ideHome, 'jbr')
    if (jbrOf(machine, jbr) !== null) homes.push(jbr)
  }
  return homes
}

/**
 * Whether one directory is a JetBrains Runtime, and its Java executable.
 * @param {object} machine the machine of the call
 * @param {string} jbr the candidate `jbr` directory
 * @returns {string | null} the Java executable, or null
 */
function jbrOf(machine, jbr) {
  if (!isDirectoryAt(machine, jbr)) return null
  for (const name of JBR_BINARY_NAMES[machine.platform === 'win32' ? 'win32' : (machine.platform === 'darwin' ? 'darwin' : 'other')]) {
    const executable = machine.paths.join(jbr, 'bin', name)
    if (isFileAt(machine, executable)) return executable
  }
  return null
}

/**
 * The JDK homes of the fallback scan.
 *
 * The roots are DERIVED from the environment (never written down as a
 * literal path): the Program Files folders and the Toolbox folder on Windows,
 * `/Applications` on macOS, `/opt` on Linux - plus the roots the user added
 * in `lsp.servers.java.javaSearchRoots`.
 *
 * Every root is walked but depth-bounded: the layouts that have to be
 * recognised are the flat one (`<root>/<product> <version>/jbr`), the one
 * with a vendor directory (`<root>/<vendor>/<product> <version>/jbr`) and the
 * Toolbox one (`<root>/<product>/ch-0/<build>/jbr`). A recursive search for
 * `java.exe` is what the document forbids - an IDE directory is gigabytes
 * big; the walk visits directories only and stops after
 * {@link MAX_SCAN_DIRECTORIES}.
 * @param {object} machine the machine of the call
 * @param {unknown} searchRoots the `javaSearchRoots` of the settings
 * @returns {string[]} the JDK homes (a JDK root, or a `jbr` directory)
 */
function scannedJdkHomes(machine, searchRoots) {
  const roots = []
  const userRoots = Array.isArray(searchRoots) ? searchRoots : []
  for (const value of userRoots) {
    if (typeof value !== 'string' || value.trim() === '') continue
    const expanded = expandHomeMacros(value.trim(), machine.home, machine.platform)
    if (machine.paths.isAbsolute(expanded)) roots.push(expanded)
  }
  if (machine.platform === 'win32') {
    for (const name of ['ProgramFiles', 'ProgramFiles(x86)']) {
      const base = envValue(machine.env, name)
      if (base !== null && machine.paths.isAbsolute(base)) roots.push(machine.paths.join(base, 'JetBrains'))
    }
    const localAppData = envValue(machine.env, 'LOCALAPPDATA')
    if (localAppData !== null && machine.paths.isAbsolute(localAppData)) {
      roots.push(machine.paths.join(localAppData, 'JetBrains', 'Toolbox', 'apps'))
    }
  } else if (machine.platform === 'darwin') {
    roots.push('/Applications', machine.paths.join(machine.home, 'Applications'))
  } else {
    roots.push('/opt', machine.paths.join(machine.home, '.local', 'share', 'JetBrains'))
  }

  const homes = []
  const seen = new Set()
  let visited = 0
  const visit = (directory, depth) => {
    if (depth > MAX_SCAN_DEPTH || visited >= MAX_SCAN_DIRECTORIES) return
    // A directory that is a JDK itself (the layout of a custom install
    // location: the user points the search root at a folder of JDKs).
    const homeOfDirectory = jdkHomeOfDirectory(machine, directory)
    if (homeOfDirectory !== null && !seen.has(pathKey(homeOfDirectory, machine.platform))) {
      seen.add(pathKey(homeOfDirectory, machine.platform))
      homes.push(homeOfDirectory)
    }
    // A JetBrains Runtime DIRECTLY below this directory: the search root is
    // the IDE home (`<ideHome>/jbr`), which is the natural value a user adds
    // for an IDE that is installed where nothing looks. The loop below skips
    // the `jbr` child before it could be examined, so the runtime of the root
    // itself is tested here.
    const ownJbr = machine.paths.join(directory, 'jbr')
    if (jbrOf(machine, ownJbr) !== null && !seen.has(pathKey(ownJbr, machine.platform))) {
      seen.add(pathKey(ownJbr, machine.platform))
      homes.push(ownJbr)
    }
    let entries
    try {
      entries = machine.readdir(directory)
    } catch {
      return
    }
    for (const entry of entries) {
      if (visited >= MAX_SCAN_DIRECTORIES) return
      if (!(entry.isDirectory() || entry.isSymbolicLink())) continue
      const name = entry.name
      if (name.startsWith('.') || name === 'jbr' || name === 'plugins' || name === 'node_modules') continue
      const child = machine.paths.join(directory, name)
      visited += 1
      // Layout A and B: the `jbr` of an IDE below this directory.
      const jbr = machine.paths.join(child, 'jbr')
      if (jbrOf(machine, jbr) !== null && !seen.has(pathKey(jbr, machine.platform))) {
        seen.add(pathKey(jbr, machine.platform))
        homes.push(jbr)
      }
      visit(child, depth + 1)
    }
  }
  for (const root of roots) if (isDirectoryAt(machine, root)) visit(root, 0)
  return homes
}

/**
 * Whether one directory is a JDK root (a `release` file and a Java binary).
 * @param {object} machine the machine of the call
 * @param {string} directory the directory
 * @returns {string | null} the JDK home, or null
 */
function jdkHomeOfDirectory(machine, directory) {
  if (!isDirectoryAt(machine, directory)) return null
  if (!isFileAt(machine, machine.paths.join(directory, 'release'))) return null
  if (!isFileAt(machine, machine.paths.join(directory, 'bin', javaExecutableName(machine.platform)))) return null
  return directory
}

// ── the jdtls installation ────────────────────────────────────────────────

/**
 * The installation root of jdtls and the two things the JVM needs from it.
 *
 * The roots come from the settings, from `JDTLS_HOME`, or from walking up
 * from the launcher that PATH resolves (`…/bin/jdtls` → `…`). The launcher
 * itself is never spawned: on Windows it is a Python script and then an
 * `.bat`, neither of which can be started without a shell (PRD §1.2).
 * @param {object} [options] the machine and the settings
 * @param {string} [options.command] the configured command (default `jdtls`)
 * @returns {{ root: string, configDir: string, launcherJar: string, source: string } | null}
 */
export function resolveJdtls(options = {}) {
  const machine = machineOf(options)
  const java = javaSettingsOf(options.lsp)
  const command = typeof options.command === 'string' && options.command !== '' ? options.command : 'jdtls'
  const candidates = []
  if (typeof java.jdtlsHome === 'string' && java.jdtlsHome.trim() !== '') {
    candidates.push({ root: expandHomeMacros(java.jdtlsHome.trim(), machine.home, machine.platform), source: 'setting' })
  }
  const envHome = envValue(machine.env, 'JDTLS_HOME')
  if (envHome !== null) candidates.push({ root: envHome, source: 'JDTLS_HOME' })
  const launcher = resolveCommandPath(command, machine)
  if (launcher !== null) {
    // The official distribution: `<root>/bin/jdtls`, `<root>/bin/jdtls.py`.
    candidates.push({ root: machine.paths.dirname(machine.paths.dirname(launcher)), source: 'command' })
  }
  // A launcher named in the ARGUMENTS: the stop-gap configuration of the
  // document's appendix A puts the jdtls script there (`command: 'python'`,
  // `args: ['…\\bin\\jdtls', …]`). The installation root derived from that
  // path lets the plugin start the JVM directly - the Python interpreter of
  // that configuration becomes unnecessary instead of breaking the setting.
  for (const argument of Array.isArray(options.extraArgs) ? options.extraArgs : []) {
    if (typeof argument !== 'string' || !machine.paths.isAbsolute(argument)) continue
    const name = machine.paths.basename(argument).toLowerCase()
    if (name !== 'jdtls' && name !== 'jdtls.py' && name !== 'jdtls.sh') continue
    candidates.push({ root: machine.paths.dirname(machine.paths.dirname(argument)), source: 'args' })
  }
  for (const candidate of candidates) {
    const layout = jdtlsLayoutOf(candidate.root, options)
    if (layout !== null) return { ...layout, source: candidate.source }
  }
  return null
}

/**
 * The layout of one jdtls installation root.
 *
 * The two facts the JVM needs are the configuration directory of the
 * platform and the equinox launcher jar; a directory that has both is an
 * installation (PRD §2.1).
 * @param {string} root the installation root
 * @param {object} [options] the machine and the settings
 * @returns {{ root: string, configDir: string, launcherJar: string } | null}
 */
export function jdtlsLayoutOf(root, options = {}) {
  const machine = machineOf(options)
  if (typeof root !== 'string' || root.trim() === '' || root.includes('\0')) return null
  const expanded = expandHomeMacros(root.trim(), machine.home, machine.platform)
  if (!isDirectoryAt(machine, expanded)) return null
  const configDir = machine.paths.join(expanded, jdtlsConfigDirName(machine.platform))
  if (!isDirectoryAt(machine, configDir)) return null
  const launcherJar = equinoxLauncherOf(machine, machine.paths.join(expanded, 'plugins'))
  if (launcherJar === null) return null
  return {
    root: machine.paths.normalize(expanded),
    configDir: machine.paths.normalize(configDir),
    launcherJar: machine.paths.normalize(launcherJar),
  }
}

/**
 * The equinox launcher jar of one jdtls `plugins` directory.
 *
 * The jar carries its build stamp in the name of the official distribution
 * (`org.eclipse.equinox.launcher_1.8.0.v…jar`), but the packaging of the
 * mason registry ships it WITHOUT a version (`org.eclipse.equinox.launcher.jar`),
 * and the launcher script of jdtls handles both. An installation that has
 * only the unversioned name is therefore a usable installation, not a
 * broken one. The newest by name wins when several builds were left behind.
 * @param {object} machine the machine of the call
 * @param {string} plugins the `plugins` directory
 * @returns {string | null}
 */
function equinoxLauncherOf(machine, plugins) {
  let entries
  try {
    entries = machine.readdir(plugins)
  } catch {
    return null
  }
  const jars = entries
    .filter(entry => entry.isFile() && /^org\.eclipse\.equinox\.launcher(_.*)?\.jar$/.test(entry.name))
    .map(entry => entry.name)
    // The unversioned name sorts before every versioned one ('.' < '_'), so
    // the last entry is the newest versioned jar - or the unversioned one
    // when it is the only launcher of the installation.
    .sort()
  if (jars.length === 0) return null
  return machine.paths.join(plugins, jars[jars.length - 1])
}

/**
 * Resolve one command to an absolute file, looking on PATH when it is a bare
 * name. Unlike the probing of the spawn path, a batch file and an
 * extension-less script are accepted here: this function only reads the
 * DIRECTORY of the launcher, it never starts it.
 * @param {string} command the command
 * @param {object} machine the machine of the call
 * @returns {string | null}
 */
export function resolveCommandPath(command, machine) {
  if (typeof command !== 'string' || command === '' || command.includes('\0')) return null
  if (machine.paths.isAbsolute(command)) return isFileAt(machine, command) ? command : null
  if (/[\\/]/.test(command)) return null
  const extensions = machine.platform === 'win32' ? ['', '.exe', '.bat', '.cmd', '.py'] : ['', '.py', '.sh']
  const value = envValue(machine.env, 'PATH') ?? ''
  const separator = machine.platform === 'win32' ? ';' : ':'
  for (const raw of value.split(separator)) {
    const directory = raw.trim().replace(/^"(.*)"$/, '$1')
    if (directory === '' || !machine.paths.isAbsolute(directory)) continue
    for (const extension of extensions) {
      const candidate = machine.paths.join(directory, `${command}${extension}`)
      if (isFileAt(machine, candidate)) return candidate
    }
  }
  return null
}

// ── the workspace and the argv ────────────────────────────────────────────

/**
 * The `-data` workspace of one project root.
 *
 * jdtls builds the name of its default workspace from `sha1(basename(cwd))`,
 * so two projects called `app` on two drives share one index and answer with
 * each other's classes (PRD §1.4). The host therefore passes an explicit
 * directory that is derived from the FULL path of the root and lives under
 * the profile of the plugin, next to `settings.json` (PRD §4.1).
 *
 * The directory is persistent: it IS the index cache of the project. It is
 * never deleted on start - only the sweep of {@link sweepJavaWorkspaces}
 * removes the directories of roots that are gone.
 * @param {string} root the absolute project root
 * @param {object} [options] the machine and the profile
 * @param {string} [options.profileBase] the profile directory (default: the
 *   profile directory of DSH)
 * @returns {string} the absolute workspace directory
 */
export function jdtlsDataDir(root, options = {}) {
  const machine = machineOf(options)
  const base = typeof options.profileBase === 'string' && options.profileBase !== ''
    ? options.profileBase
    : profileBaseOf(machine)
  return machine.paths.join(base, 'ide-workbench', 'lsp-workspace', jdtlsDataDirName(root, options))
}

/**
 * The directory NAME of one project root's jdtls workspace.
 *
 * The name is a hash of the comparison key of the root: a Windows path holds
 * characters that are not allowed in a file name (and may be longer than
 * one), and the key is already case-insensitive where the file system is.
 * @param {string} root the absolute project root
 * @param {object} [options] the machine
 * @returns {string} the directory name
 */
export function jdtlsDataDirName(root, options = {}) {
  const machine = machineOf(options)
  const key = pathKey(String(root), machine.platform)
  const digest = createHash('sha1').update(key).digest('hex')
  return `jdtls-${digest.slice(0, 16)}`
}

/**
 * The profile directory of the plugin, derived from the environment.
 * @param {object} machine the machine of the call
 * @returns {string}
 */
function profileBaseOf(machine) {
  const profileDir = envValue(machine.env, 'DSH_PROFILE_DIR')
  if (profileDir !== null) return profileDir
  const dshHome = envValue(machine.env, 'DSH_HOME')
  if (dshHome !== null) return dshHome
  return machine.paths.join(machine.home, '.dsh')
}

/**
 * The full argv of one jdtls JVM (PRD §2.3).
 *
 * The parameters are the contract of the Eclipse application; the heap comes
 * from the effective ceiling of the session, and `-Xms` is lowered WITH it:
 * jdtls' own launcher script hard-codes `-Xms1G`, and a `-Xmx512m` next to an
 * `-Xms1G` makes the JVM refuse to start ("Initial heap size set to a larger
 * value than the maximum heap size"). `-Xms` <= `-Xmx` is therefore a rule,
 * not a coincidence.
 *
 * The `javaArgs` of the settings are JVM arguments and come BEFORE `-jar`:
 * the `java` launcher stops parsing options at the jar file, so anything
 * after it reaches the Eclipse application instead of the JVM - a `-Xmx4g`
 * there would silently do nothing (PRD §7.1). The `-data` workspace stays
 * after the jar: it is an argument of the application.
 *
 * Java 24 and newer log a warning for XML entity expansion (and the measured
 * launcher of jdtls lifts the entity limits for them); the two flags keep a
 * large Maven/Eclipse metadata import from failing on the modern runtime
 * that jdtls 1.63.0 needs.
 * @param {object} options
 * @param {string} options.executable the Java executable
 * @param {{ configDir: string, launcherJar: string }} options.jdtls the layout
 * @param {string | null} [options.workspaceDir] the `-data` directory
 * @param {number} [options.memoryLimitMB] the effective ceiling (MB)
 * @param {number | null} [options.javaVersion] the major version of the JDK
 * @param {string[]} [options.extraArgs] the `javaArgs` of the settings (JVM arguments)
 * @returns {string[]} the argv (the executable is its first entry)
 */
export function buildJavaArgv(options = {}) {
  const executable = typeof options.executable === 'string' ? options.executable : ''
  const jdtls = options.jdtls !== null && typeof options.jdtls === 'object' ? options.jdtls : {}
  const limit = Number.isFinite(options.memoryLimitMB) && options.memoryLimitMB > 0
    ? Math.floor(options.memoryLimitMB)
    : 0
  const javaVersion = Number.isFinite(options.javaVersion) ? options.javaVersion : 0
  const argv = [
    executable,
    `-Declipse.application=${JDTLS_APPLICATION}`,
    '-Dosgi.bundles.defaultStartLevel=4',
    `-Declipse.product=${JDTLS_PRODUCT}`,
    '-Dosgi.checkConfiguration=true',
    `-Dosgi.sharedConfiguration.area=${jdtls.configDir}`,
    '-Dosgi.sharedConfiguration.area.readOnly=true',
    '-Dosgi.configuration.cascaded=true',
  ]
  if (javaVersion >= 24) {
    // The Eclipse metadata and the Maven POMs are large XML documents, and
    // Java 24 tightened the default entity-expansion limits (the upstream
    // launcher lifts them for exactly this reason).
    argv.push('-Djdk.xml.maxGeneralEntitySizeLimit=0', '-Djdk.xml.totalEntitySizeLimit=0')
  }
  if (limit > 0) {
    // `-Xms` follows `-Xmx`: the JVM refuses to start otherwise.
    argv.push(`-Xms${Math.min(1024, limit)}m`, `-Xmx${limit}m`)
  }
  argv.push('--add-modules=ALL-SYSTEM', '--add-opens', 'java.base/java.util=ALL-UNNAMED', '--add-opens', 'java.base/java.lang=ALL-UNNAMED')
  // The custom JVM arguments go before the jar: `java` treats everything after
  // `-jar <file>` as an argument of the application, not of the JVM.
  const extraArgs = Array.isArray(options.extraArgs) ? options.extraArgs.map(String) : []
  argv.push(...extraArgs)
  argv.push('-jar', typeof jdtls.launcherJar === 'string' ? jdtls.launcherJar : '')
  if (typeof options.workspaceDir === 'string' && options.workspaceDir !== '') {
    argv.push('-data', options.workspaceDir)
  }
  return argv
}

// ── the plan the manager consumes ─────────────────────────────────────────

/**
 * Everything the manager needs to start jdtls for one project root.
 *
 * Four answers are possible:
 *
 *   - `ok: true` with `mode: 'jvm'`: the JVM is started directly and the heap
 *     of the session reaches it through `-Xmx` (JS-01, JS-05);
 *   - `ok: true` with `mode: 'script'`: the installation has no readable
 *     layout (a packaging that differs from the official one), but the
 *     configured command is the official Python launcher and a Python is on
 *     PATH. The JVM is then a grandchild of the plugin: the fallback of the
 *     PRD risk table, slower and without a heap ceiling, and the manager
 *     does not claim one;
 *   - `ok: true` with `mode: 'executable'`: the configured command is a
 *     self-contained launcher of the platform (a pip `jdtls.exe`), which is
 *     spawned as it is; the plugin has no say about its JVM then;
 *   - `ok: false` with a `hint` that lists every JDK that was found, so
 *     "Java does not start" is answerable instead of a guess (JS-02).
 * @param {object} [options] the machine and the settings
 * @param {object} [options.lsp] the `lsp` section of the settings
 * @param {string} [options.command] the configured command
 * @param {string | null} [options.root] the project root (`-data` isolation)
 * @param {number} [options.memoryLimitMB] the effective ceiling of the session
 * @param {string[]} [options.extraArgs] the JVM arguments of the settings
 *   (`servers.java.javaArgs`); they are NOT the launcher arguments of the
 *   stop-gap configuration
 * @param {string[]} [options.discoveryArgs] the configured `servers.java.args`:
 *   launcher/script arguments of a foreign packaging, used ONLY to find the
 *   installation (and, in the script fallback, the script). They must never
 *   become JVM arguments - a `bin/jdtls` script path before `-jar` makes the
 *   JVM treat it as the main class
 * @returns {object} the plan: `ok`, the resolution fields and the argv
 */
export function javaServerPlan(options = {}) {
  const machine = machineOf(options)
  const jdks = options.jdks ?? discoverJdks(options)
  const discoveryArgs = Array.isArray(options.discoveryArgs) ? options.discoveryArgs.map(String) : []
  const jvmArgs = Array.isArray(options.extraArgs) ? options.extraArgs.map(String) : []
  // The root is derived from the launcher arguments when the command alone
  // does not name an installation (see `resolveJdtls`).
  const jdtls = options.jdtls === undefined ? resolveJdtls({ ...options, extraArgs: discoveryArgs }) : options.jdtls
  const command = typeof options.command === 'string' && options.command !== '' ? options.command : 'jdtls'
  const workspaceDir = typeof options.root === 'string' && options.root !== ''
    ? jdtlsDataDir(options.root, options)
    : null
  const base = {
    launcher: 'java',
    jdtlsHome: jdtls === null ? null : jdtls.root,
    javaHome: jdks.selected === null ? null : jdks.selected.path,
    javaVersion: jdks.selected === null ? null : jdks.selected.version,
    jdkCandidates: jdks.candidates,
    workspaceDir,
  }
  if (jdtls !== null && jdks.selected !== null) {
    return {
      ok: true,
      ...base,
      // What the manager records as the executable and as the source of the
      // resolution; `launcher` is what selects the argv branch of the spawn.
      path: jdks.selected.executable,
      source: 'jdtls',
      mode: 'jvm',
      supportsMemoryLimit: true,
      argv: buildJavaArgv({
        executable: jdks.selected.executable,
        jdtls,
        workspaceDir,
        memoryLimitMB: options.memoryLimitMB,
        javaVersion: jdks.selected.version,
        extraArgs: jvmArgs,
      }),
    }
  }
  // A packaging whose command is a self-contained executable (the pip
  // distribution installs `jdtls.exe`): there is no layout to read, but the
  // command itself can be spawned. The plugin has no say about the JVM then,
  // so no heap ceiling is claimed - and no JDK is claimed either: the
  // discovery may find several, but none of them started this server.
  const direct = directLauncherOf(command, machine)
  if (jdtls === null && direct !== null) {
    const argv = [direct]
    if (workspaceDir !== null) argv.push('-data', workspaceDir)
    // The wrapper forwards `--jvm-arg` to the JVM of the launched server.
    argv.push(...jvmArgs.map(argument => `--jvm-arg=${argument}`))
    return {
      ok: true,
      ...base,
      javaHome: null,
      javaVersion: null,
      jdkCandidates: [],
      path: direct,
      source: 'command',
      mode: 'executable',
      supportsMemoryLimit: false,
      argv,
    }
  }
  // The fallback of the risk table: the official launcher script, started by
  // a Python interpreter. No heap ceiling is installed this way, and the
  // memory model of the plugin is weaker (the JVM is a grandchild) - it is
  // still better than "jdtls cannot start at all" on a packaging the layout
  // reader does not understand.
  if (jdtls === null && jdks.selected !== null) {
    const commandPath = resolveCommandPath(command, machine)
    const interpreter = commandPath !== null && isPythonInterpreter(machine.paths.basename(commandPath))
      ? commandPath
      : null
    const script = scriptLauncherOf(command, machine) ?? jdtlsScriptInArgs(machine, discoveryArgs)
    const python = interpreter ?? executableOnPath(machine, machine.platform === 'win32'
      ? ['python.exe', 'python3.exe', 'python']
      : ['python3', 'python'])
    if (script !== null && python !== null) {
      const argv = [python, script, '--java-executable', jdks.selected.executable]
      // The JVM arguments of the settings go through the `--jvm-arg` channel
      // of the launcher script; the launcher arguments themselves are NOT
      // repeated on the command line (they described the same script).
      argv.push(...jvmArgs.map(argument => `--jvm-arg=${argument}`))
      if (workspaceDir !== null) argv.push('-data', workspaceDir)
      return {
        ok: true,
        ...base,
        path: python,
        source: 'script',
        mode: 'script',
        supportsMemoryLimit: false,
        argv,
      }
    }
  }
  return {
    ok: false,
    ...base,
    reason: jdks.invalidJavaHome === true
      ? 'jdk-invalid'
      : (jdks.selected === null ? 'jdk-missing' : 'jdtls-missing'),
    hint: missingJavaHint({ ...options, jdks, jdtls, command }),
  }
}

/**
 * The first executable of one list of names on PATH.
 * @param {object} machine the machine of the call
 * @param {string[]} names the file names to look for
 * @returns {string | null}
 */
function executableOnPath(machine, names) {
  return executablesOnPath(machine, names)[0] ?? null
}

/**
 * Whether one file name is a Python interpreter.
 * @param {string} name the file name
 * @returns {boolean}
 */
function isPythonInterpreter(name) {
  return /^python(3(\.\d+)?)?(\.exe)?$/i.test(String(name).toLowerCase())
}

/**
 * One self-contained launcher behind a configured command.
 *
 * The pip distribution installs the launcher as `jdtls.exe`: a real Windows
 * executable that contains the whole start, so it can be spawned directly.
 * The name has to be the launcher itself - a Python interpreter that happens
 * to be the configured command is not a language server, and neither is an
 * arbitrary executable the user pointed the command at.
 * @param {string} command the configured command
 * @param {object} machine the machine of the call
 * @returns {string | null}
 */
function directLauncherOf(command, machine) {
  const path = resolveCommandPath(command, machine)
  if (path === null) return null
  if (machine.platform !== 'win32') return null
  if (!/^jdtls(\.exe|\.com)$/i.test(machine.paths.basename(path))) return null
  return /\.(exe|com)$/i.test(path) ? path : null
}

/**
 * The jdtls launcher script named in the arguments of the settings.
 *
 * The stop-gap configuration of the document's appendix A starts the script
 * of the official distribution with a Python interpreter and passes the
 * script path in the arguments. Reading the path lets the plugin either
 * derive the installation root ({@link resolveJdtls}) or use the script as
 * the fallback launcher - without changing the setting of the user.
 * @param {object} machine the machine of the call
 * @param {unknown} extraArgs the arguments of the session
 * @returns {string | null}
 */
function jdtlsScriptInArgs(machine, extraArgs) {
  for (const argument of Array.isArray(extraArgs) ? extraArgs : []) {
    if (typeof argument !== 'string' || !machine.paths.isAbsolute(argument)) continue
    if (!isFileAt(machine, argument)) continue
    const name = machine.paths.basename(argument).toLowerCase()
    if (name === 'jdtls' || name === 'jdtls.py' || name === 'jdtls.sh') return argument
  }
  return null
}

/**
 * The official jdtls launcher script behind a configured command, when there
 * is one.
 *
 * Only a file that really is the jdtls launcher qualifies: a Python
 * interpreter that happens to be the `command` of the settings is not a
 * language server (appendix A of the document used exactly that
 * configuration as a stop-gap, and it must not turn into a silent,
 * unreadable candidate here).
 * @param {string} command the configured command
 * @param {object} machine the machine of the call
 * @returns {string | null}
 */
export function scriptLauncherOf(command, machine) {
  const path = resolveCommandPath(command, machine)
  if (path === null) return null
  const name = machine.paths.basename(path).toLowerCase()
  if (name === 'jdtls' || name === 'jdtls.py' || name === 'jdtls.sh') return path
  let head = ''
  try {
    head = String(machine.readFile(path)).slice(0, 400)
  } catch {
    return null
  }
  if (!head.startsWith('#!')) return null
  return /jdtls|org\.eclipse\.jdt\.ls/i.test(head) ? path : null
}

/**
 * The hint of a Java server that cannot start.
 *
 * The message has to be actionable without a debugger (PRD §3.5): it says
 * WHICH half is missing (the installation or the JDK), lists every JDK that
 * WAS found with its version and path, and names the setting that overrides
 * the discovery. The document refuses a hard-coded version number here -
 * which JDK jdtls accepts is decided by the installed release (21 for the
 * older ones, 25 for 1.63.0), so the text must not promise one.
 * @param {object} [options] the machine, the settings and the discovery
 * @returns {string}
 */
export function missingJavaHint(options = {}) {
  const machine = machineOf(options)
  const command = typeof options.command === 'string' && options.command !== '' ? options.command : 'jdtls'
  const jdks = options.jdks ?? discoverJdks(options)
  const jdtls = options.jdtls === undefined ? resolveJdtls(options) : options.jdtls
  const problems = []
  if (jdks.invalidJavaHome === true) {
    // The user asked for a JDK that cannot be used. Naming the setting is
    // better than quietly starting another JDK of the machine (PRD §8.2 #7).
    problems.push('the configured lsp.servers.java.javaHome is not a usable JDK (the directory has no bin/java[.exe], or its release file cannot be read)')
  } else if (jdks.selected === null) {
    problems.push('no JDK was found')
  }
  if (jdtls === null) {
    problems.push(`the jdtls installation was not found (a ${jdtlsConfigDirName(machine.platform)} directory and a plugins/org.eclipse.equinox.launcher_*.jar are expected below its root)`)
  }
  if (problems.length === 0) {
    // The caller reported a failure for a reason of its own (an unreadable
    // installation that still resolved): name the pair that was resolved.
    problems.push(`the jdtls installation at ${jdtls.root} could not be used with the JDK at ${jdks.selected.path}`)
  }
  const found = jdks.candidates.length === 0
    ? 'No JDK was found on this machine.'
    : `The JDKs of this machine are ${jdks.candidates.map(candidate => `${candidate.version} (${candidate.path})`).join(', ')}.`
  const batch = /\.(bat|cmd)$/i.test(command)
    ? ` The launcher "${command}" is a batch file: a .bat/.cmd launcher cannot be spawned without a shell, and this plugin never uses a shell - point the setting at the jdtls installation instead.`
    : ''
  return `the Java language server cannot start: ${problems.join(' and ')}. ${found} Which JDK the installed jdtls accepts is decided by the release of that installation and changes with it, so no version is promised here: set lsp.servers.java.javaHome, or lsp.servers.java.jdtlsHome (or the JDTLS_HOME environment variable), to the one it accepts.${batch}`
}

// ── the sweep of the workspaces ───────────────────────────────────────────

/** The sequence of the marker temp files of this process. */
let markerWriteSequence = 0

/**
 * Remember the processes that own one jdtls workspace.
 *
 * The marker is a file NEXT TO the workspace (`<name>.pid`), not inside it:
 * the workspace belongs to Eclipse, and a plugin file in its root is not the
 * business of the indexer. The sweep of {@link sweepJavaWorkspaces} reads the
 * marker and does not remove a workspace while ANY process it names is alive.
 *
 * The marker names more than one process on purpose:
 *
 *   - the JVM: while it runs, the workspace of a running Eclipse must not be
 *     removed (two DSH hosts of one profile share the directory);
 *   - the HOST: a host that released its server on the idle policy is still
 *     using the workspace (the next payload wakes the same index), and every
 *     other host of the profile must leave it alone while that host lives.
 *
 * A marker of dead processes protects nothing: the workspace is an orphan
 * then and may be swept.
 * @param {string} workspaceDir the `-data` directory of the project root
 * @param {number | number[]} pids the process ids that own it
 * @param {object} [options] the machine
 * @returns {boolean} whether the marker was written
 */
export function markJavaWorkspaceOwner(workspaceDir, pids, options = {}) {
  const machine = machineOf(options)
  if (typeof workspaceDir !== 'string' || workspaceDir === '') return false
  const added = (Array.isArray(pids) ? pids : [pids])
    .filter(pid => Number.isInteger(pid) && pid > 0)
  if (added.length === 0) return false
  const marker = `${workspaceDir}.pid`
  // The existing owners are UNIONED, not replaced: two hosts of one profile
  // may open the same project, and the host that writes last must not drop
  // the pid of the JVM that the other one still runs. Dead owners are dropped
  // while the file is rewritten, so the marker does not grow for ever.
  const owners = []
  const push = (pid) => {
    if (!Number.isInteger(pid) || pid <= 0) return
    if (owners.includes(pid)) return
    owners.push(pid)
  }
  for (const pid of workspaceOwnerPids(machine, workspaceDir)) {
    if (machine.isProcessAlive(pid)) push(pid)
  }
  for (const pid of added) push(pid)
  let temporary = null
  try {
    machine.mkdir(machine.paths.dirname(marker), { recursive: true })
    // Written next to the target and renamed over it: a half written marker
    // must not read as "no owner" and let a sweep delete a live workspace.
    // The temp name is unique per process and write - a fixed name would let
    // two hosts interleave their writes and lose a live pid from the union.
    markerWriteSequence += 1
    temporary = `${marker}.${process.pid}.${markerWriteSequence}.tmp`
    machine.writeFile(temporary, `${owners.join('\n')}\n`)
    machine.rename(temporary, marker)
    return true
  } catch {
    // A workspace that cannot be marked is still a working workspace: the
    // marker only protects it from the sweep of another host process. The
    // temp file must not be left behind - the sweep would see it as garbage.
    if (temporary !== null) {
      try {
        machine.remove(temporary)
      } catch { /* it was not written, or it is already gone */ }
    }
    return false
  }
}

/**
 * The process ids the marker next to one workspace names.
 * @param {object} machine the machine of the call
 * @param {string} workspaceDir the workspace directory
 * @returns {number[]} the process ids (empty when there is no marker)
 */
function workspaceOwnerPids(machine, workspaceDir) {
  const marker = `${workspaceDir}.pid`
  if (!isFileAt(machine, marker)) return []
  try {
    return String(machine.readFile(marker))
      .split(/\r?\n/)
      .map(line => Number(line.trim()))
      .filter(pid => Number.isInteger(pid) && pid > 0)
  } catch {
    return []
  }
}

/**
 * Remove the jdtls workspaces of roots the plugin does not know any more.
 *
 * The workspace of a project IS its index cache: it must survive a restart,
 * so nothing is deleted on start. A root that is gone, however, leaves a
 * multi-hundred-megabyte Eclipse workspace behind for ever, so the plugin
 * sweeps once, when it unloads (PRD §4.3).
 *
 * The sweep only ever removes directories whose name is exactly the
 * `jdtls-…` name of a root. It refuses to run with an empty known-root set:
 * "every workspace is an orphan" is the one conclusion that is always wrong
 * when the list was simply not filled in. A workspace whose owner marker
 * names a LIVE process is kept: another DSH host of the same profile may be
 * running that server (the workspace of a running Eclipse must not be
 * removed under it). The marker names the JVM and the host that opened the
 * workspace: a host that released its server on the idle policy still owns
 * the index and must not lose it to the unload of another host.
 * @param {string[]} knownRoots the absolute roots the plugin still knows
 * @param {object} [options] the machine and the profile
 * @returns {string[]} the directories that were removed
 */
export function sweepJavaWorkspaces(knownRoots, options = {}) {
  const machine = machineOf(options)
  const roots = Array.isArray(knownRoots) ? knownRoots.filter(root => typeof root === 'string' && root !== '') : []
  if (roots.length === 0) return []
  const base = typeof options.profileBase === 'string' && options.profileBase !== ''
    ? options.profileBase
    : profileBaseOf(machine)
  const directory = machine.paths.join(base, 'ide-workbench', 'lsp-workspace')
  if (!isDirectoryAt(machine, directory)) return []
  const known = new Set(roots.map(root => jdtlsDataDirName(root, options)))
  const removed = []
  let entries
  try {
    entries = machine.readdir(directory)
  } catch {
    return removed
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!/^jdtls-[0-9a-f]{16}$/.test(entry.name)) continue
    if (known.has(entry.name)) continue
    const target = machine.paths.join(directory, entry.name)
    // A live owner wins over every heuristic: its workspace is in use.
    const owners = workspaceOwnerPids(machine, target)
    if (owners.some(pid => machine.isProcessAlive(pid))) continue
    try {
      machine.remove(target)
      try {
        machine.remove(`${target}.pid`)
      } catch { /* there was no marker, or it is already gone */ }
      removed.push(target)
    } catch {
      // A workspace that cannot be removed (a locked file of a running
      // Eclipse) is left alone: it is worse to fail the unload than to
      // keep a stale cache.
    }
  }
  // A marker write that was interrupted can leave a temp file behind: it is
  // not an owner file, and it must not accumulate in the workspace folder.
  for (const entry of entries) {
    if (entry.isDirectory()) continue
    if (!/^jdtls-[0-9a-f]{16}\.pid\..*\.tmp$/.test(entry.name)) continue
    try {
      machine.remove(machine.paths.join(directory, entry.name))
    } catch { /* it is already gone */ }
  }
  return removed
}
