/**
 * Pre-commit command runner: exit codes and captured output.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCommand } from '../src/host/workspace.js'

test('runs a successful command and captures stdout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'iwb-run-'))
  const result = await runCommand(root, 'echo hello-iwb')
  assert.equal(result.code, 0)
  assert.match(result.output, /hello-iwb/)
})

test('reports a non-zero exit code and keeps stderr', async () => {
  const root = await mkdtemp(join(tmpdir(), 'iwb-run-'))
  const result = await runCommand(root, process.platform === 'win32' ? 'exit 3' : 'exit 3')
  assert.equal(result.code, 3)
})

test('runs in the given working directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'iwb-run-'))
  const result = await runCommand(root, process.platform === 'win32' ? 'cd' : 'pwd')
  assert.equal(result.code, 0)
  assert.ok(result.output.toLowerCase().includes(root.toLowerCase().slice(0, 8)))
})
