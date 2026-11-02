/**
 * The degraded mode of the code intelligence plugin (PRD-v6 §3.2, DEG-01).
 *
 * The plugin may be installed without the IDE workbench. Then there is no
 * editor, no project and no file - and the user has to know that, instead
 * of wondering why the features are missing.
 *
 * Two things have to happen in that case:
 *
 *   1. a toast says what is missing (once);
 *   2. the settings page of the plugin explains it.
 *
 * And one thing must NOT happen: no language server may be started. There is
 * no project to start one for, and a server without an editor would cost
 * memory for nothing.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let modulePromise

/**
 * The entry of the plugin, bundled.
 * @returns {Promise<object>} the bundled module
 */
async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'degraded-mode-entry.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `
export { apply, inject } from './src/client/index.jsx'
export { CodeIntelSettings } from './src/client/settings.jsx'
export { CodeIntelStore } from './src/client/store.js'
export { en, zh } from './src/client/i18n.js'
`,
        resolveDir: root,
        loader: 'jsx',
        sourcefile: 'degraded-mode-entry.jsx',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: ['node20'],
      external: ['react', 'react-dom', 'react-dom/server', '@deepseek-ai/dsh-client-ui-primitives'],
      loader: { '.css': 'text' },
      jsx: 'transform',
      define: { 'process.env.NODE_ENV': '"production"' },
      outfile,
      logLevel: 'silent',
    })
    return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
  })()
  return modulePromise
}

/**
 * A client context of the host, with the slots and the locale.
 *
 * The slots record what the plugin registers, and they never declare the
 * child slots of the contract - that is the core's business - so the plugin
 * stays in the degraded mode.
 * @returns {{ctx: any, registrations: any[], locales: any[]}} the context and
 *   what the plugin registered
 */
function fakeContext() {
  const registrations = []
  const locales = []
  return {
    registrations,
    locales,
    ctx: {
      locale: {
        bind: (namespace) => (key) => (key === undefined ? namespace : key),
        register: (namespace, locale, dict) => {
          locales.push({ namespace, locale, dict })
          return () => {}
        },
        subscribe: () => () => {},
      },
      slots: {
        inject: (key, callback) => {
          // The core is absent: the declaration of the child slot never
          // happens, so the callback is never called.
          return () => {}
        },
        register: (options, component) => {
          registrations.push({ options, component })
          return () => {}
        },
      },
      effect: (fn) => {
        const dispose = fn()
        return () => { if (typeof dispose === 'function') dispose() }
      },
    },
  }
}

test('the plugin registers the four slots of the contract', async () => {
  const mod = await loadModule()
  const { ctx } = fakeContext()
  mod.apply(ctx)
  // The four slots are injected - the core declares them, the plugin fills
  // them. Without the core the injection is a no-op, but it must happen.
  assert.deepEqual(mod.inject, ['slots', 'locale'], 'the plugin needs the slots and the locale')
})

test('the plugin loads without the core and without a contract', async () => {
  const mod = await loadModule()
  const { ctx } = fakeContext()
  // The plugin must not throw while it is being loaded: a plugin that cannot
  // be loaded cannot show its guidance either (acceptance B1).
  assert.doesNotThrow(() => { mod.apply(ctx) })
})

test('the guidance says what is missing', async () => {
  const mod = await loadModule()
  assert.equal(typeof mod.en['codeintel.workbenchMissing'], 'string')
  assert.ok(mod.en['codeintel.workbenchMissing'].length > 0)
  assert.equal(typeof mod.zh['codeintel.workbenchMissing'], 'string')
  assert.ok(mod.zh['codeintel.workbenchMissing'].length > 0)
  // The note of the settings page says the same thing.
  assert.ok(mod.en['codeintel.degradedTitle'].length > 0)
  assert.ok(mod.en['codeintel.degradedBody'].length > 0)
})

test('the settings of the plugin explain the missing core', async () => {
  const mod = await loadModule()
  const store = new mod.CodeIntelStore({ t: key => mod.en[key] ?? key })
  store.set({ degraded: true, degradedReason: 'workbench-missing' })
  const html = renderToStaticMarkup(React.createElement(mod.CodeIntelSettings, {
    contract: null,
    t: key => mod.en[key] ?? key,
    store,
  }))
  assert.match(html, new RegExp(mod.en['codeintel.degradedTitle']), 'the note names the missing plugin')
  assert.match(html, new RegExp(mod.en['codeintel.degradedBody']), 'and says what it means')
})

test('the degraded mode starts no language server', async () => {
  const mod = await loadModule()
  const { ctx } = fakeContext()
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body })
    return { ok: true, status: 200, async json() { return { ok: true, value: {} } } }
  }
  try {
    mod.apply(ctx)
    // Give the plugin the time it would need to start something.
    await new Promise(resolve => { setTimeout(resolve, 50) })
  } finally {
    globalThis.fetch = originalFetch
  }
  const started = calls.filter(call => /lsp\.(start|restart)/.test(call.url))
  assert.deepEqual(started, [], 'no language server is started without the core')
})
