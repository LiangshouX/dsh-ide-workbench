/**
 * Build the client artifact of the code intelligence plugin (codeintel).
 *
 * The heavy lifting lives in the shared builder of the repository; this
 * script only names the package. The builder aliases the CodeMirror packages
 * to the Proxy shim of the plugin, so the codeintel never carries its own
 * copy of `@codemirror/state` (PRD-v6 §3.5).
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// A Windows path is not a URL: `import()` needs one.
await import(pathToFileURL(resolve(packageRoot, '..', '..', 'scripts', 'build-client.mjs')).href)
