/** Native IDE launchers. Project and file paths are argv entries, never shell text. */
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import { canonicalRoot, resolveInside } from './workspace.js'
import { ApiError, requireString } from './wire.js'

const IDE_DEFINITIONS = {
  idea: { name: 'IntelliJ IDEA', win: ['idea64.exe', 'idea.exe', 'idea'], unix: ['idea', 'idea.sh'], directory: /IntelliJ IDEA/i, binaries: ['idea64.exe', 'idea.exe'], apps: ['IntelliJ IDEA.app', 'IntelliJ IDEA Ultimate.app', 'IntelliJ IDEA CE.app'], macBinary: 'idea' },
  webstorm: { name: 'WebStorm', win: ['webstorm64.exe', 'webstorm.exe'], unix: ['webstorm', 'webstorm.sh'], directory: /WebStorm/i, binaries: ['webstorm64.exe', 'webstorm.exe'], apps: ['WebStorm.app'], macBinary: 'webstorm' },
  vscode: { name: 'Visual Studio Code', win: ['Code.exe'], unix: ['code'], apps: ['Visual Studio Code.app'], macBinary: 'Electron' },
}

function definitionOf(ide) {
  if (!Object.hasOwn(IDE_DEFINITIONS, ide)) throw new ApiError('bad-request', 'Unknown IDE: choose idea, webstorm or vscode')
  return IDE_DEFINITIONS[ide]
}

/** Resolve a supported IDE with injectable filesystem/environment for portable tests. */
export async function resolveIdeExecutable(ide, configuredPath = '', options = {}) {
  const definition = definitionOf(ide)
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const paths = platform === 'win32' ? win32 : posix
  const fileStat = options.stat ?? stat
  const fileAccess = options.access ?? access
  const list = options.readdir ?? readdir
  const home = options.home ?? homedir()
  const usable = async (candidate) => {
    if (platform === 'win32' && /\.(cmd|bat)$/i.test(candidate)) return false
    try {
      if (!(await fileStat(candidate)).isFile()) return false
      await fileAccess(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK)
      return true
    } catch { return false }
  }
  const fromPath = (names) => {
    const value = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? ''
    return names.flatMap(name => value.split(platform === 'win32' ? ';' : ':')
      .map(dir => dir.replace(/^"(.*)"$/, '$1'))
      .filter(dir => paths.isAbsolute(dir))
      .map(dir => paths.join(dir, name)))
  }
  if (typeof configuredPath !== 'string' || configuredPath.includes('\0')) {
    throw new ApiError('bad-request', `${ide}.path must be a string without NUL characters`)
  }
  if (configuredPath !== '') {
    let configured = configuredPath
    if (platform === 'darwin' && /\.app\/?$/.test(configured)) configured = paths.join(configured, 'Contents/MacOS', definition.macBinary)
    const candidates = paths.isAbsolute(configured) ? [configured] : fromPath([configured])
    if (!paths.isAbsolute(configured) && /[\\/]/.test(configured)) candidates.length = 0
    for (const candidate of candidates) if (await usable(candidate)) return candidate
    throw new ApiError(`${ide}-unavailable`, `Configured ${definition.name} launcher is not an executable file: ${configuredPath}. Set ${ide}.path to the native launcher (not a .cmd/.bat file).`, 400)
  }
  const candidates = fromPath(platform === 'win32' ? definition.win : definition.unix)
  if (platform === 'win32') {
    const bases = [...new Set([env.ProgramFiles ?? 'C:\\Program Files', env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'])]
    if (ide === 'vscode') {
      if (env.LOCALAPPDATA) candidates.push(paths.join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'))
      for (const base of bases) candidates.push(paths.join(base, 'Microsoft VS Code', 'Code.exe'))
    } else {
      for (const base of bases) {
        const jetbrains = paths.join(base, 'JetBrains')
        let entries = []
        try { entries = await list(jetbrains, { withFileTypes: true }) } catch { /* optional installation directory */ }
        for (const entry of entries.filter(entry => entry.isDirectory() && definition.directory.test(entry.name)).sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))) {
          for (const binary of definition.binaries) candidates.push(paths.join(jetbrains, entry.name, 'bin', binary))
        }
      }
    }
  } else if (platform === 'darwin') {
    for (const base of ['/Applications', paths.join(home, 'Applications')]) {
      for (const app of definition.apps) candidates.push(paths.join(base, app, 'Contents/MacOS', definition.macBinary))
    }
  }
  for (const candidate of candidates) if (await usable(candidate)) return candidate
  throw new ApiError(`${ide}-unavailable`, `${definition.name} launcher was not found. Set ${ide}.path in Settings to its executable path.`, 404)
}

/** Open the selected project and a regular saved file contained within it. */
export async function openInIde(payload, configuredPath = '', options = {}) {
  const ide = requireString(payload, 'ide')
  const definition = definitionOf(ide)
  const root = await canonicalRoot(requireString(payload, 'root'))
  const requested = resolveInside(root, requireString(payload, 'path'))
  let file
  try { file = await realpath(requested) } catch {
    throw new ApiError('not-found', 'Selected file does not exist', 404)
  }
  resolveInside(root, file)
  let info
  try { info = await stat(file) } catch {
    throw new ApiError('not-found', 'Selected file does not exist', 404)
  }
  if (!info.isFile()) throw new ApiError('bad-request', `Select a regular file to open in ${definition.name}`)
  const executable = await (options.resolveExecutable ?? ((configured, opts) => resolveIdeExecutable(ide, configured, opts)))(configuredPath, options)
  const argv = ide === 'vscode' ? ['--new-window', root, '--goto', file] : [root, file]
  await new Promise((resolve, reject) => {
    const fail = error => reject(new ApiError(`${ide}-launch-failed`, `Cannot launch ${definition.name}: ${error instanceof Error ? error.message : String(error)}`, 500))
    try {
      const child = (options.spawn ?? spawn)(executable, argv, {
        cwd: root, detached: true, stdio: 'ignore', shell: false, windowsHide: false,
      })
      child.once('error', fail)
      child.once('spawn', () => { child.unref(); resolve() })
    } catch (error) { fail(error) }
  })
  return { accepted: true, ide, root, path: file, executable, message: `${definition.name} launch accepted; opening is not guaranteed.` }
}

/** Compatibility with the original IDEA-only endpoint. */
export const resolveIdeaExecutable = (configuredPath = '', options = {}) => resolveIdeExecutable('idea', configuredPath, options)
export const openInIdea = (payload, configuredPath = '', options = {}) => openInIde({ ...payload, ide: 'idea' }, configuredPath, options)
