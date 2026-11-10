/**
 * Build-time resources of the PDF preview.
 *
 * PDF.js needs its worker as a separate module. The workbench ships as ONE
 * CommonJS file (the client module loader loads a single script), so the
 * worker cannot be fetched from its own URL: this plugin turns the minified
 * worker into a string that the bundle carries, and the engine creates a
 * blob URL from it at runtime.
 *
 * The worker is read from `pdfjs-dist` while building; the published
 * `dist/client.js` is self-contained and the runtime dependency is not
 * needed.
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const moduleRequire = createRequire(import.meta.url)

/** The virtual module id the engine imports. */
export const PDF_WORKER_MODULE = 'virtual:pdf-worker'

/**
 * The license banner of the bundle.
 *
 * PDF.js is Apache-2.0 and its minified file marks the notice with
 * `@licstart`, which esbuild does not treat as a legal comment. The full
 * license is therefore written into the artifact explicitly: the plugin ships
 * the parser, so it has to ship the license with it.
 * @returns {string} a JavaScript block comment
 */
export function pdfLicenseBanner() {
  const root = dirname(moduleRequire.resolve('pdfjs-dist/package.json'))
  const license = readFileSync(join(root, 'LICENSE'), 'utf8').trimEnd()
  const notice = [
    'PDF.js 6.3.289 - https://github.com/mozilla/pdf.js',
    'Copyright 2024 Mozilla Foundation',
    'Licensed under the Apache License, Version 2.0.',
    '',
    license,
  ].join('\n')
  return `/*!\n${notice.split('\n').map(line => (line === '' ? ' *' : ` * ${line}`)).join('\n')}\n */\n`
}

/**
 * The esbuild plugin that resolves the virtual PDF worker module.
 * @returns {import('esbuild').Plugin} the plugin
 */
export function pdfVirtualPlugin() {
  return {
    name: 'iwb-pdf-worker',
    setup(build) {
      build.onResolve({ filter: /^virtual:pdf-worker$/ }, () => ({ path: 'worker', namespace: 'iwb-pdf' }))
      build.onLoad({ filter: /.*/, namespace: 'iwb-pdf' }, async () => {
        const root = dirname(moduleRequire.resolve('pdfjs-dist/package.json'))
        const source = await readFile(join(root, 'build', 'pdf.worker.min.mjs'), 'utf8')
        // `export default` keeps the module a normal ESM module of the build;
        // the string is the whole worker, and the engine appends its ready
        // marker when it creates the blob.
        return { contents: `export default ${JSON.stringify(source)}`, loader: 'js' }
      })
    },
  }
}
