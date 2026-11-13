/**
 * R8 — the commit history can copy the short SHA as well.
 *
 * The commit menu is a parent item with a submenu: "Copy SHA" offers the
 * full SHA (40 characters) and the short one (exactly seven), which is what
 * a user types into `git show`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { en, zh } from '../src/client/i18n.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let modulePromise

async function loadModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const dir = join(root, '.render-tmp')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, 'git-short-sha.mjs')
    await rm(outfile, { force: true })
    await build({
      absWorkingDir: root,
      stdin: {
        contents: `export * from './src/client/GitPanel.jsx'`,
        resolveDir: root,
        loader: 'js',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: ['node20'],
      external: ['react', 'react-dom', 'react-dom/server'],
      jsx: 'transform',
      define: { 'process.env.NODE_ENV': '"production"' },
      outfile,
      logLevel: 'silent',
    })
    return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
  })()
  return modulePromise
}

const HASH = 'a41eb8e9c0d1f2e3a4b5c6d7e8f9012345678abc'
const SHORT = 'a41eb8e'

/** The tools `commitMenuItems` needs. */
function tools(copied) {
  return {
    t: key => key,
    openDetail: () => {},
    copy: text => { copied.push(text) },
    store: {
      openCompare: () => {},
      requestCheckout: () => {},
      askConfirm: () => {},
      revert: () => {},
    },
  }
}

test('the short SHA is exactly seven characters', async () => {
  const mod = await loadModule()
  assert.equal(mod.shortShaOf({ hash: HASH, shortHash: SHORT }), SHORT)
  assert.equal(mod.shortShaOf({ hash: HASH, shortHash: SHORT }).length, 7)
  // Git abbreviates longer than seven characters when it has to: the length
  // is fixed anyway.
  assert.equal(mod.shortShaOf({ hash: HASH, shortHash: 'a41eb8e9c0' }), SHORT)
  // A commit without an abbreviated hash falls back to its own.
  assert.equal(mod.shortShaOf({ hash: HASH }), SHORT)
  assert.equal(mod.shortShaOf(undefined), '')
})

test('the commit menu offers the full and the short SHA', async () => {
  const mod = await loadModule()
  const copied = []
  const items = mod.commitMenuItems({ hash: HASH, shortHash: SHORT, subject: 'fix' }, tools(copied))
  const parent = items.find(item => item.key === 'copy-sha')
  assert.ok(parent !== undefined, 'the parent item exists')
  assert.equal(parent.text, 'git.copySha')
  assert.ok(Array.isArray(parent.submenu), 'the parent item has a submenu')
  assert.deepEqual(parent.submenu.map(item => item.key), ['copy-sha-full', 'copy-sha-short'])
  assert.equal(parent.submenu[0].text, 'git.copyFullSha')
  assert.equal(parent.submenu[1].text, 'git.copyShortSha')
})

test('the full SHA stays forty characters and the short one seven', async () => {
  const mod = await loadModule()
  const copied = []
  const items = mod.commitMenuItems({ hash: HASH, shortHash: SHORT, subject: 'fix' }, tools(copied))
  const submenu = items.find(item => item.key === 'copy-sha').submenu
  submenu[0].action()
  submenu[1].action()
  assert.deepEqual(copied, [HASH, SHORT])
  assert.equal(copied[0].length, 40)
  assert.equal(copied[1].length, 7)
})

test('the toast shows the text that was copied', async () => {
  const mod = await loadModule()
  const toasts = []
  const store = { toast: (kind, text, detail) => { toasts.push({ kind, text, detail }) } }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async () => {} } },
    configurable: true,
    writable: true,
  })
  try {
    await mod.copyToClipboard(store, key => key, SHORT)
  } finally {
    if (original === undefined) delete globalThis.navigator
    else Object.defineProperty(globalThis, 'navigator', original)
  }
  assert.equal(toasts.length, 1)
  assert.equal(toasts[0].kind, 'success')
  assert.equal(toasts[0].detail, SHORT)
})

test('the menu texts exist in both dictionaries', () => {
  for (const dictionary of [en, zh]) {
    assert.ok(typeof dictionary['git.copySha'] === 'string', 'git.copySha')
    assert.ok(typeof dictionary['git.copyFullSha'] === 'string', 'git.copyFullSha')
    assert.ok(typeof dictionary['git.copyShortSha'] === 'string', 'git.copyShortSha')
  }
  // The short SHA is announced as the seven characters it is.
  assert.match(en['git.copyShortSha'], /7/)
  assert.match(zh['git.copyShortSha'], /7/)
})
