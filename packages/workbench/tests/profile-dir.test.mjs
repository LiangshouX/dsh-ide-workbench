/**
 * Which profile directory the settings of the workbench belong to.
 *
 * The bug this file pins: the plugin used to resolve the profile from
 * `DSH_PROFILE_DIR` alone. That variable comes from the shell that launched
 * the app, so a DSH instance started from another DSH's terminal carried the
 * variable of the OTHER profile - and its settings write landed in that
 * profile's `ide-workbench/settings.json`. During the V6 verification this
 * really happened: a scratch profile overwrote the settings document of the
 * desktop profile.
 *
 * The host publishes the truth as the `profileContext` service; the plugin
 * records it before the first read or write, and the variable stays as the
 * fallback for the cases without a context (the tests of this package, a
 * plugin mounted outside the CLI).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { profileBase, setProfileBase, settingsFile } from '../src/host/settings-store.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Run one body with `DSH_PROFILE_DIR` set to a known value, then restore it. */
function withEnv(value, body) {
  const previous = Object.hasOwn(process.env, 'DSH_PROFILE_DIR') ? process.env.DSH_PROFILE_DIR : undefined
  if (value === undefined) delete process.env.DSH_PROFILE_DIR
  else process.env.DSH_PROFILE_DIR = value
  try {
    return body()
  } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previous
  }
}

test('the booted profile wins over the inherited variable', () => {
  withEnv('C:\\profiles\\desktop', () => {
    setProfileBase('C:\\profiles\\core')
    assert.equal(profileBase(), 'C:\\profiles\\core', 'the context is the truth, the variable only a fallback')
    assert.equal(settingsFile(), join('C:\\profiles\\core', 'ide-workbench', 'settings.json'))
  })
})

test('without a context the variable is used, and an empty one is ignored', () => {
  withEnv('C:\\profiles\\desktop', () => {
    setProfileBase('')
    assert.equal(profileBase(), 'C:\\profiles\\desktop')
    setProfileBase('   ')
    assert.equal(profileBase(), 'C:\\profiles\\desktop', 'a blank context must not become a path')
  })
})

test('the plugin records the profile before the settings store can run', async () => {
  // The order matters: the store is constructed right after the recording, so
  // a write triggered by the mount already sees the right directory. A source
  // assertion is the only way to pin the order across an async `apply`.
  const source = await readFile(join(root, 'src/index.js'), 'utf8')
  const record = source.indexOf("setProfileBase(ctx.get?.('profileContext')?.dir ?? '')")
  const store = source.indexOf('new SettingsStore(ctx)')
  assert.ok(record >= 0, 'apply() records the booted profile')
  assert.ok(store >= 0, 'apply() builds the settings store')
  assert.ok(record < store, 'the profile is recorded before the store exists')
  const applyStart = source.indexOf('export function apply(ctx)')
  assert.ok(applyStart >= 0 && record > applyStart, 'the recording belongs to apply()')
})
