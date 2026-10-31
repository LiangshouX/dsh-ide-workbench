import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { LSP_REGISTRY, validateServerCommand } from '../src/host/lsp.js'
import { makeManager } from './lsp-fixtures.mjs'

const require = createRequire(import.meta.url)

/** The language ids of PRD §1.4 (the table of the language servers). */
const EXPECTED_LANGUAGE_IDS = [
  'typescript',
  'javascript',
  'javascriptreact',
  'typescriptreact',
  'python',
  'yaml',
  'java',
  'go',
  'rust',
  'c',
  'cpp',
]

test('every registry entry names a command, an argument list and a memory ceiling', () => {
  for (const [languageId, entry] of Object.entries(LSP_REGISTRY)) {
    assert.equal(typeof entry.command, 'string', languageId)
    assert.ok(entry.command.trim() !== '', `${languageId} needs a command`)
    assert.ok(Array.isArray(entry.args), `${languageId} needs an args array`)
    assert.ok(entry.args.every(argument => typeof argument === 'string'), `${languageId} args must be strings`)
    assert.ok(Number.isFinite(entry.memoryLimitMB) && entry.memoryLimitMB > 0, `${languageId} needs a positive memory limit`)
  }
})

test('the registry covers every language of the PRD table', () => {
  const covered = new Set(Object.values(LSP_REGISTRY).flatMap(entry => entry.languageIds))
  for (const languageId of EXPECTED_LANGUAGE_IDS) {
    assert.ok(covered.has(languageId), `${languageId} is not covered by the registry`)
  }
})

test('every language id belongs to exactly one language server', () => {
  const owners = new Map()
  for (const entry of Object.values(LSP_REGISTRY)) {
    for (const languageId of entry.languageIds) {
      assert.equal(entry.languageIds.filter(id => id === languageId).length, 1, `${languageId} is listed twice in one entry`)
      const owner = owners.get(languageId)
      // The typescript and javascript entries are aliases of one server, so a
      // language id may be claimed twice — but only by the same command.
      assert.equal(owner === undefined || owner === entry.command, true, `${languageId} is claimed by two different servers`)
      owners.set(languageId, entry.command)
    }
  }
  assert.deepEqual([...owners.keys()].sort(), [...EXPECTED_LANGUAGE_IDS].sort())
})

test('the javascript entry is an alias of the typescript server', () => {
  assert.equal(LSP_REGISTRY.javascript.command, LSP_REGISTRY.typescript.command)
  assert.deepEqual(LSP_REGISTRY.javascript.args, LSP_REGISTRY.typescript.args)
  assert.equal(LSP_REGISTRY.javascript.memoryLimitMB, LSP_REGISTRY.typescript.memoryLimitMB)
})

test('the bundled servers are the ones of the PRD table', () => {
  assert.equal(LSP_REGISTRY.typescript.command, 'typescript-language-server')
  assert.deepEqual(LSP_REGISTRY.typescript.args, ['--stdio'])
  assert.equal(LSP_REGISTRY.python.command, 'basedpyright-langserver')
  assert.deepEqual(LSP_REGISTRY.python.args, ['--stdio'])
  assert.equal(LSP_REGISTRY.yaml.command, 'yaml-language-server')
  assert.deepEqual(LSP_REGISTRY.yaml.args, ['--stdio'])
  assert.equal(LSP_REGISTRY.java.command, 'jdtls')
  assert.equal(LSP_REGISTRY.go.command, 'gopls')
  assert.equal(LSP_REGISTRY.rust.command, 'rust-analyzer')
  assert.equal(LSP_REGISTRY.cpp.command, 'clangd')
})

test('the probed servers state what they need', () => {
  assert.equal(LSP_REGISTRY.java.requires, 'JDK 21+')
  assert.equal(LSP_REGISTRY.go.requires, 'Go toolchain')
  assert.equal(LSP_REGISTRY.rust.requires, 'rustup component')
  assert.equal(LSP_REGISTRY.cpp.requires, 'LLVM')
})

test('the packaged typescript is the 5.x line, never the 7.x compiler', () => {
  const manifest = JSON.parse(readFileSync(require.resolve('typescript/package.json'), 'utf8'))
  assert.ok(manifest.version.startsWith('5.'), `typescript resolved to ${manifest.version}, not 5.x`)
})

test('a command with shell metacharacters is refused', () => {
  for (const command of ['server&whoami', 'server|whoami', 'server;whoami', 'server>out', 'a$b', 'a`b`', 'a"b', "a'b", 'a*b', 'a?b', 'a(b)', 'a\nb']) {
    assert.notEqual(validateServerCommand(command), null, `${command} must be refused`)
  }
})

test('a bare executable name and an absolute path are accepted', () => {
  const absolute = process.platform === 'win32'
    ? 'C:\\Program Files\\jdtls\\bin\\jdtls.exe'
    : '/usr/local/bin/gopls'
  assert.equal(validateServerCommand('typescript-language-server'), null)
  assert.equal(validateServerCommand(absolute), null)
})

test('an empty or relative command is refused', () => {
  assert.notEqual(validateServerCommand(''), null)
  assert.notEqual(validateServerCommand('   '), null)
  assert.notEqual(validateServerCommand(undefined), null)
  assert.notEqual(validateServerCommand('bin/gopls'), null)
  assert.notEqual(validateServerCommand('my server'), null)
})

test('the bundled language servers are found inside the package', async () => {
  const { manager } = makeManager()
  const { available, missing } = await manager.servers()
  for (const languageId of ['typescript', 'javascript', 'python', 'yaml']) {
    const entry = available.find(item => item.languageId === languageId)
    assert.ok(entry !== undefined, `${languageId} must be available`)
    assert.equal(entry.source, 'bundled')
    assert.equal(entry.command, LSP_REGISTRY[languageId].command)
    assert.equal(typeof entry.resolvedPath, 'string')
    assert.equal(entry.memoryLimitMB, LSP_REGISTRY[languageId].memoryLimitMB)
  }
  for (const entry of missing) {
    assert.equal(typeof entry.languageId, 'string', 'the missing list names the language')
    assert.equal(typeof entry.command, 'string')
    assert.equal(typeof entry.hint, 'string')
    assert.ok(entry.hint.length > 0, 'the missing list explains how to install the server')
  }
})

test('every language of the registry is either available or missing', async () => {
  const { manager } = makeManager()
  const { available, missing } = await manager.servers()
  const known = new Set([...available.map(item => item.languageId), ...missing.map(item => item.languageId)])
  assert.deepEqual([...known].sort(), Object.keys(LSP_REGISTRY).sort())
})
