/**
 * Which profile directory the settings of the codeintel belong to.
 *
 * The same defect the workbench had: `DSH_PROFILE_DIR` is inherited from the
 * shell that launched the app, so a DSH booted from another DSH's terminal
 * carries the variable of the OTHER profile. The host publishes the truth as
 * the `profileContext` service; `apply()` records it before the first read or
 * write, and the variable remains the fallback for a context-free mount.
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
    assert.equal(settingsFile(), join('C:\\profiles\\core', 'dsh-codeintel', 'settings.json'))
  })
})

test('without a context the variable is used', () => {
  withEnv('C:\\profiles\\desktop', () => {
    setProfileBase('')
    assert.equal(profileBase(), 'C:\\profiles\\desktop')
  })
})

test('the plugin records the profile before the settings store can run', async () => {
  const source = await readFile(join(root, 'src/index.js'), 'utf8')
  const record = source.indexOf("setProfileBase(ctx.get?.('profileContext')?.dir ?? '')")
  const store = source.indexOf('new SettingsStore(ctx)')
  assert.ok(record >= 0, 'apply() records the booted profile')
  assert.ok(store >= 0, 'apply() builds the settings store')
  assert.ok(record < store, 'the profile is recorded before the store exists')
})
