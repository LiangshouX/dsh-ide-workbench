/**
 * Open one URL in the operating system's default handler.
 *
 * Used by the workbench's "open in default browser" action. Only `http`,
 * `https` and `file` URLs are accepted.
 *
 * Two rules shape this module (R11):
 *
 * 1. **A launcher is judged by its exit code, not by its birth.** The old
 *    implementation resolved on the `spawn` event and threw the exit code
 *    and the standard error away, so every open "succeeded" - including the
 *    Windows `file:` case, where the URL protocol handler starts happily
 *    and then does nothing at all, because `file:` has no `open` verb on
 *    Windows. A launcher that reports a non-zero code opened nothing, and
 *    that has to reach the user instead of being swallowed.
 * 2. **A `file:` URL is opened by the desktop, not by the URL protocol
 *    handler.** On Windows that means the shell's own dispatch, because the
 *    protocol handler cannot open a local document. The user's *registered*
 *    default browser is resolved from the registry first, so a `.html`
 *    association that points at an editor does not hijack the button.
 */
import { spawn } from 'node:child_process'
import { ApiError, requireString } from './wire.js'

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'file:'])

/**
 * How long a launcher may take before the open counts as failed.
 *
 * The launchers used here (the desktop's own dispatch, `open`,
 * `xdg-open`) return as soon as the request reached the desktop, so a long
 * silence means the request never arrived.
 */
const LAUNCH_TIMEOUT_MS = 10000

/**
 * How long a registry query may take before it counts as "not found".
 */
const REGISTRY_TIMEOUT_MS = 3000

/**
 * How long the launcher's own complaint is waited for.
 *
 * The standard error of a failing launcher is written before the process
 * ends, but the pipe delivers it asynchronously - and the program that was
 * started may keep the pipe open for a long time (a browser inherits it).
 * The verdict therefore comes from the exit code; the text is only a
 * decoration, and it is not worth waiting for more than a moment.
 */
const STDERR_GRACE_MS = 150

/**
 * The registry key that holds the user's registered default browser.
 *
 * `http` is the scheme every browser registers itself for. The `file:`
 * scheme is not one of them - a local document is opened through the file
 * association - which is exactly why the button has to resolve the browser
 * itself instead of handing the URL to a protocol handler.
 */
const WINDOWS_BROWSER_USER_CHOICE = 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice'

/**
 * The environment variables that carry the Windows command line.
 *
 * The target travels through the environment and never through the command
 * line: the shell reads it as a *value*, so a path with a space, an `&` or
 * a `%` in it cannot become a second command.
 */
const ENV_TARGET = 'IWB_OPEN_TARGET'
const ENV_EXE = 'IWB_OPEN_EXE'
const ENV_ARG = 'IWB_OPEN_ARG'

/** Human-readable message for any thrown value. */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * One dispatch plan: the command, its argv and the environment it needs.
 *
 * @typedef {object} LaunchPlan
 * @property {string} command the program to run
 * @property {string[]} argv its arguments (never a shell string)
 * @property {Record<string, string>} [env] extra environment variables
 */

/**
 * The native path of one `file:` URL.
 *
 * `url.fileURLToPath` follows the *host* platform, which is wrong when the
 * platform is injected (the tests) or when a URL of another platform
 * arrives. The conversion is therefore done for the platform that will
 * open the file.
 * @param {URL} url the file URL
 * @param {NodeJS.Platform} platform the platform that opens it
 * @returns {string | undefined} the path, or `undefined` when the URL does
 *   not name one
 */
export function filePathFromUrl(url, platform) {
  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    // A malformed escape is not a path.
    return undefined
  }
  if (platform !== 'win32') return pathname
  const slashed = pathname.replace(/\//g, '\\')
  const host = url.hostname
  // A UNC path keeps its host: `\\server\share\file.html`.
  if (host !== '') return `\\\\${host}${slashed}`
  // A drive path loses the separator the URL put in front of it.
  return slashed.replace(/^\\(?=[A-Za-z]:)/, '')
}

/**
 * Read one `REG_SZ` value out of the output of `reg query`.
 *
 * `reg query` prints the key on the first line and one indented line per
 * value: `    ProgId    REG_SZ    ChromeHTML`.
 * @param {string} output the command output
 * @param {string} valueName the value to read (`ProgId`, `(Default)`)
 * @returns {string | undefined} the value
 */
export function parseRegistryValue(output, valueName) {
  if (typeof output !== 'string' || output === '') return undefined
  const wanted = String(valueName).toLowerCase()
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s+(\S+)\s+REG_(?:EXPAND_)?SZ\s+(.*)$/.exec(line)
    if (match === null) continue
    if (match[1].toLowerCase() !== wanted) continue
    const value = match[2].trim()
    return value === '' ? undefined : value
  }
  return undefined
}

/**
 * Split one shell command template into its program and its arguments.
 *
 * The registry stores the command of a ProgID as a template: the program
 * may be quoted and the arguments carry a `%1` placeholder for the URL.
 * @param {string} template the stored command
 * @returns {{ exe: string, args: string[] } | undefined} the parsed command
 */
export function parseShellCommandTemplate(template) {
  if (typeof template !== 'string') return undefined
  const text = template.trim()
  if (text === '') return undefined
  let exe
  let rest
  if (text.startsWith('"')) {
    const end = text.indexOf('"', 1)
    if (end === -1) return undefined
    exe = text.slice(1, end)
    rest = text.slice(end + 1).trim()
  } else {
    const space = text.indexOf(' ')
    if (space === -1) {
      exe = text
      rest = ''
    } else {
      exe = text.slice(0, space)
      rest = text.slice(space + 1).trim()
    }
  }
  if (exe === '') return undefined
  const args = rest === '' ? [] : rest.split(/\s+/).map((argument) => {
    const value = argument.trim()
    // A quoted argument keeps its spaces; the quotes are not part of it.
    return value.length > 1 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value
  })
  return { exe, args }
}

/**
 * Expand the `%NAME%` placeholders of a registry value.
 *
 * A command may be stored with an expandable path (`REG_EXPAND_SZ`); the
 * environment of this process is the only one that can be expanded here.
 * @param {string} value the raw value
 * @returns {string} the expanded value
 */
function expandEnvironment(value) {
  return value.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (match, name) => process.env[name] ?? match)
}

/**
 * Run `reg query` and return its output.
 *
 * @param {Function} run the injected `spawn`
 * @param {string} key the registry key
 * @param {string} valueName the value to read
 * @returns {Promise<string | undefined>} the output, or `undefined` when the
 *   key or the value does not exist
 */
function runRegQuery(run, key, valueName) {
  return new Promise((resolve) => {
    let child
    try {
      child = run('reg.exe', ['query', key, '/v', valueName], {
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: false,
        windowsHide: true,
      })
    } catch {
      resolve(undefined)
      return
    }
    let output = ''
    const stdout = child.stdout
    const readable = stdout !== undefined && stdout !== null && typeof stdout.on === 'function'
    if (readable) {
      stdout.setEncoding?.('utf8')
      stdout.on('data', (chunk) => { output += chunk })
    }
    let settled = false
    const settle = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => settle(undefined), REGISTRY_TIMEOUT_MS)
    child.once('error', () => settle(undefined))
    // `close` waits for the pipe to be drained, so the output is complete.
    child.once('close', (code) => settle(code === 0 ? output : undefined))
    child.once('exit', (code) => {
      // A query that never closes its pipes still has an answer in its
      // exit code.
      if (!readable) settle(code === 0 ? output : undefined)
    })
  })
}

/**
 * Read one registry value.
 * @param {Function} run the injected `spawn`
 * @param {string} key the registry key
 * @param {string} valueName the value to read
 * @returns {Promise<string | undefined>} the value
 */
async function readRegistryValue(run, key, valueName) {
  const output = await runRegQuery(run, key, valueName)
  if (output === undefined) return undefined
  return parseRegistryValue(output, valueName)
}

/**
 * The user's registered default browser on Windows.
 *
 * The ProgID of the `http` association names the browser the user picked in
 * "Default apps"; its command template names the program to run. The
 * template's `%1` is the URL.
 * @param {URL} url the URL the browser has to open
 * @param {{ run: Function }} context the injected `spawn`
 * @returns {Promise<{ exe: string, args: string[], hasSlot: boolean } | undefined>}
 *   the browser, or `undefined` when it cannot be determined
 */
async function resolveWindowsDefaultBrowser(url, context) {
  const progId = await readRegistryValue(context.run, WINDOWS_BROWSER_USER_CHOICE, 'ProgId')
  if (progId === undefined || progId === '') return undefined
  const template = await readRegistryValue(context.run, `HKCR\\${progId}\\shell\\open\\command`, '(Default)')
  if (template === undefined) return undefined
  const parsed = parseShellCommandTemplate(expandEnvironment(template))
  if (parsed === undefined) return undefined
  // The template's `%1` is the slot the URL belongs in. A template without
  // one gets the URL as its last argument.
  const hasSlot = parsed.args.some((argument) => argument.includes('%1'))
  const args = parsed.args.map((argument) => argument.replace(/%1/g, url.href))
  return { exe: parsed.exe, args, hasSlot }
}

/**
 * The PowerShell command that hands one file or program to the desktop.
 *
 * `Start-Process` calls `ShellExecuteEx` with `SEE_MASK_FLAG_NO_UI`: the
 * document goes to the program the shell registered for it, a failure is
 * reported through the exit code, and no message box waits for an answer.
 *
 * @param {string} target the PowerShell expression of the target
 * @returns {string} the command
 */
function startProcessCommand(target) {
  return [
    // The error text is written in the console's own code page otherwise,
    // and the host reads the pipe as UTF-8.
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8;',
    `try { Start-Process -FilePath ${target} -ErrorAction Stop }`,
    'catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }',
  ].join(' ')
}

/**
 * The plan that opens one local file on Windows.
 *
 * The URL protocol handler has no `open` verb for `file:` on Windows, so a
 * local document has to go through the shell: the handler starts, reports
 * success and opens nothing (R11).
 *
 * The desktop's own dispatch is used - `Start-Process` - because it is the
 * only entry point that reports a verdict without blocking:
 * - `cmd /c start` opens the shell's "cannot find" message box when the
 *   target is missing and waits for it: a modal dialog on the user's
 *   desktop and a host that hangs until its timeout;
 * - `explorer.exe` always exits with 1, so it cannot tell "opened" from
 *   "did nothing" at all.
 *
 * @param {URL} url the file URL
 * @param {{ run: Function }} context the injected `spawn`
 * @returns {Promise<LaunchPlan>} the plan
 */
async function windowsFilePlan(url, context) {
  const browser = await resolveWindowsDefaultBrowser(url, context)
  if (browser !== undefined) {
    const env = { [ENV_EXE]: browser.exe }
    // The URL is the template's own slot, or the last argument of a
    // template that has none.
    const args = browser.hasSlot ? browser.args : [...browser.args, url.href]
    const list = args.map((argument, index) => {
      const name = `${ENV_ARG}${index}`
      env[name] = argument
      return `$env:${name}`
    })
    const argumentList = list.length === 0 ? '' : ` -ArgumentList ${list.join(',')}`
    return {
      command: 'powershell.exe',
      argv: ['-NoProfile', '-NonInteractive', '-Command', startProcessCommand(`$env:${ENV_EXE}${argumentList}`)],
      env,
    }
  }
  const target = filePathFromUrl(url, 'win32')
  if (target === undefined) {
    throw new ApiError('open-external-failed', 'The file URL does not name a local path', 400)
  }
  return {
    command: 'powershell.exe',
    argv: ['-NoProfile', '-NonInteractive', '-Command', startProcessCommand(`$env:${ENV_TARGET}`)],
    env: { [ENV_TARGET]: target },
  }
}

/**
 * The plan that opens one URL with the desktop's own launcher.
 *
 * `rundll32 url.dll,FileProtocolHandler` hands the URL to the shell's
 * default handler without a command interpreter, so query text and `&` in a
 * path can never become a second command. `open` and `xdg-open` are the
 * desktop's own launchers; on macOS and Linux they also open a local
 * document with the handler the desktop registered for it.
 * @param {URL} url the URL
 * @param {NodeJS.Platform} platform the platform that opens it
 * @returns {LaunchPlan} the plan
 */
function launcherPlan(url, platform) {
  if (platform === 'win32') {
    return { command: 'rundll32.exe', argv: ['url.dll,FileProtocolHandler', url.href] }
  }
  return { command: platform === 'darwin' ? 'open' : 'xdg-open', argv: [url.href] }
}

/**
 * Run one launcher and wait for its verdict.
 *
 * The verdict is the exit code. A launcher that ends with a non-zero code
 * opened nothing; that is reported as an error instead of being answered
 * with "opened".
 * @param {LaunchPlan} plan the plan to run
 * @param {{ run: Function }} context the injected `spawn`
 * @returns {Promise<void>} resolves when the launcher reported success
 */
function runLauncher(plan, context) {
  return new Promise((resolve, reject) => {
    const run = context.run
    let child
    try {
      child = run(plan.command, plan.argv, {
        // The child is *not* detached. On Windows a detached process is
        // created without a console, and a program that is started through
        // the shell's `ShellExecute` from such a process never comes up -
        // the browser simply does not open. The launcher is awaited here
        // anyway, so nothing is gained by detaching it.
        stdio: ['ignore', 'ignore', 'pipe'],
        shell: false,
        windowsHide: true,
        ...(plan.env === undefined ? {} : { env: { ...process.env, ...plan.env } }),
      })
    } catch (error) {
      reject(new ApiError('open-external-failed', `Cannot open the default browser: ${errorMessage(error)}`, 500))
      return
    }
    let stderr = ''
    const stream = child.stderr
    const readable = stream !== undefined && stream !== null && typeof stream.on === 'function'
    if (readable) {
      stream.setEncoding?.('utf8')
      stream.on('data', (chunk) => { stderr += chunk })
    }
    let settled = false
    let timer = null
    const settle = (error) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      // The launcher may have handed its standard error to the program it
      // started (a browser keeps it open for minutes). The handles must not
      // hold the host's event loop once the verdict is in.
      try {
        stream?.unref?.()
        child.unref?.()
      } catch {
        // The child is already gone.
      }
      if (error === undefined) resolve()
      else reject(error)
    }
    timer = setTimeout(() => {
      settle(new ApiError('open-external-failed', `The open command did not finish within ${LAUNCH_TIMEOUT_MS} ms`, 500))
    }, LAUNCH_TIMEOUT_MS)
    child.once('error', (error) => {
      settle(new ApiError('open-external-failed', `Cannot open the default browser: ${errorMessage(error)}`, 500))
    })
    child.once('exit', (code, signal) => {
      if (code === 0) {
        settle()
        return
      }
      const reason = code === null ? `it was terminated by ${signal}` : `it exited with code ${code}`
      const report = (detail) => settle(new ApiError(
        'open-external-failed',
        `The open command failed: ${reason}${detail === '' ? '' : ` (${detail})`}`,
        500,
      ))
      if (!readable) {
        report('')
        return
      }
      // The launcher's own complaint is written before it ends, but it
      // arrives asynchronously - and the program it started may keep the
      // pipe open. Wait a moment, then report what came in.
      let done = false
      const finish = () => {
        if (done) return
        done = true
        report(stderr.trim())
      }
      stream.once('end', finish)
      setTimeout(finish, STDERR_GRACE_MS).unref?.()
    })
  })
}

/**
 * Open a URL with the desktop's default handler.
 *
 * @param {unknown} payload `{ url }`
 * @param {{ platform?: NodeJS.Platform, spawn?: typeof spawn }} [options]
 * @returns {Promise<{ opened: true, url: string }>}
 */
export async function openExternalUrl(payload, options = {}) {
  let url
  try {
    url = new URL(requireString(payload, 'url'))
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError('bad-request', 'url must be an absolute URL', 400)
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new ApiError('bad-request', `Unsupported URL protocol: ${url.protocol}`, 400)
  }
  const platform = options.platform ?? process.platform
  const run = options.spawn ?? spawn
  const context = { run, platform }
  const plan = url.protocol === 'file:' && platform === 'win32'
    ? await windowsFilePlan(url, context)
    : launcherPlan(url, platform)
  await runLauncher(plan, context)
  return { opened: true, url: url.href }
}
