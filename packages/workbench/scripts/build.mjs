/**
 * Build the client artifact of the IDE workbench (core).
 *
 * The heavy lifting lives in the shared builder of the repository; this
 * script only names the package.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// A Windows path is not a URL: `import()` needs one.
await import(pathToFileURL(resolve(packageRoot, '..', '..', 'scripts', 'build-client.mjs')).href)
