/**
 * Open one validated URL in the operating system's default handler.
 *
 * Used by the workbench's "open in default browser" action. Only `http`,
 * `https` and `file` URLs are accepted; the command is an argv entry, never a
 * shell string, so query text cannot become a second command.
 */
import { spawn } from 'node:child_process'
import { ApiError, requireString } from './wire.js'

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'file:'])

/** Human-readable message for any thrown value. */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Open a URL with the desktop's default handler.
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
  // `rundll32 url.dll,FileProtocolHandler` hands the URL to the shell's
  // default handler without a command interpreter, so query text and `&` in a
  // path can never become a second command.
  const command = platform === 'win32' ? 'rundll32.exe' : platform === 'darwin' ? 'open' : 'xdg-open'
  const argv = platform === 'win32'
    ? ['url.dll,FileProtocolHandler', url.href]
    : [url.href]
  await new Promise((resolve, reject) => {
    let child
    try {
      child = run(command, argv, { detached: true, stdio: 'ignore', shell: false, windowsHide: true })
    } catch (error) {
      reject(new ApiError('open-external-failed', `Cannot open the default browser: ${errorMessage(error)}`, 500))
      return
    }
    child.once('error', error => reject(new ApiError('open-external-failed', `Cannot open the default browser: ${errorMessage(error)}`, 500)))
    child.once('spawn', () => { child.unref(); resolve() })
  })
  return { opened: true, url: url.href }
}
