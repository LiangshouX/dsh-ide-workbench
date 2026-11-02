/**
 * One number for the "available memory" (PRD-v5.1 §3.5, MEM-09).
 *
 * The host had THREE wording paths and TWO numbers: the startup path and
 * the restart path wrote the free memory of the machine into their
 * message, while the crash path wrote the available memory. The gate
 * itself decides with the available memory - the free memory minus what
 * the running servers may still grow into (MEM-05) - so the user was told
 * "2648 MB available" by a dialog while the gate said "600 MB".
 *
 * Two screens, one question, two opposite answers.
 *
 * The rule of the contract (§7) is therefore simple: every message the
 * host builds uses `availableBytes`, and the worst case of MEM-07 is part
 * of it. The check below walks the source of the host and proves that no
 * message is built from the free memory - the kind of regression that the
 * eye misses and a test does not.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { makeManager } from './lsp-fixtures.mjs'

const MB = 1024 * 1024
const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(HERE, '..', 'src', 'host', 'lsp.js')

/** A project root that no other test uses. */
function rootOf(name) {
  return join(tmpdir(), `iwb-lsp-wording-${name}`)
}

/**
 * Every template literal of a JavaScript source.
 *
 * The scan is a small tokenizer and not a regular expression: the source
 * of the host contains backticks inside comments and inside a regular
 * expression (the characters a shell command may not contain), and a
 * naive pattern would read half of the file as one template literal.
 *
 * @param {string} source the JavaScript source
 * @returns {string[]} the texts of the template literals
 */
function templateLiteralsOf(source) {
  const texts = []
  let index = 0
  const length = source.length
  /**
   * Skip a string that is quoted with `quote`.
   * @param {string} quote the quote character
   */
  const skipQuoted = (quote) => {
    index += 1
    while (index < length && source[index] !== quote) {
      if (source[index] === '\\') index += 1
      index += 1
    }
    index += 1
  }
  /**
   * Skip a regular expression literal.
   */
  const skipRegex = () => {
    index += 1
    while (index < length && source[index] !== '/') {
      if (source[index] === '\\') index += 1
      else if (source[index] === '[') {
        // A character class may contain a slash.
        index += 1
        while (index < length && source[index] !== ']') {
          if (source[index] === '\\') index += 1
          index += 1
        }
      }
      index += 1
    }
    index += 1
  }
  while (index < length) {
    const char = source[index]
    if (char === '/' && source[index + 1] === '/') {
      while (index < length && source[index] !== '\n') index += 1
      continue
    }
    if (char === '/' && source[index + 1] === '*') {
      index += 2
      while (index < length && !(source[index] === '*' && source[index + 1] === '/')) index += 1
      index += 2
      continue
    }
    if (char === "'" || char === '"') {
      skipQuoted(char)
      continue
    }
    if (char === '/' && startsRegex(source, index)) {
      skipRegex()
      continue
    }
    if (char === '`') {
      const start = index
      index += 1
      while (index < length && source[index] !== '`') {
        if (source[index] === '\\') index += 2
        else index += 1
      }
      texts.push(source.slice(start, index + 1))
      index += 1
      continue
    }
    index += 1
  }
  return texts
}

/**
 * Whether a slash starts a regular expression and not a division.
 *
 * The rule is the usual one: a regular expression may only follow an
 * operator, a bracket or the start of the file - a division follows a
 * value.
 * @param {string} source the JavaScript source
 * @param {number} index the position of the slash
 * @returns {boolean}
 */
function startsRegex(source, index) {
  let before = index - 1
  while (before >= 0 && /\s/.test(source[before])) before -= 1
  if (before < 0) return true
  const char = source[before]
  if (char === ')' || char === ']' || char === '}') return false
  if (/[A-Za-z0-9_$]/.test(char)) return false
  return true
}

test('no message of the host is built from the free memory', () => {
  const source = readFileSync(SOURCE, 'utf8')
  const literals = templateLiteralsOf(source)
  // The scan has to find the messages at all - a scanner that finds
  // nothing would pass every case.
  assert.ok(literals.length > 20, `the scan found ${literals.length} template literals`)
  const offenders = literals.filter(text => text.includes('freeBytes'))
  assert.deepEqual(offenders, [], 'a message may only name the available memory')
})

test('the source of the host still knows the free memory', () => {
  // The gate itself needs it: the free memory is the base of the
  // accounting. The rule is about the MESSAGES, not about the number.
  const source = readFileSync(SOURCE, 'utf8')
  assert.ok(source.includes('freeBytes'), 'the gate reads the free memory')
  assert.ok(source.includes('availableBytes'), 'the gate decides with the available memory')
})

test('the message of a tight machine names the available memory', async () => {
  // One server is running and holds 1442 MB of headroom, so the machine
  // has 386 MB of the 2000 MB it has free.
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 2000 * MB }),
  })
  await manager.start({ root: rootOf('tight') })
  const result = await manager.start({ root: rootOf('tight-other') })
  assert.equal(result.state, 'degraded')
  assert.match(result.detail, /386 MB available/, 'the message names the available memory')
  assert.doesNotMatch(result.detail, /2000 MB/, 'the free memory of the machine is not the number')
})

test('the message of a machine without memory names the available memory', async () => {
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 64 * MB }),
  })
  const result = await manager.start({ root: rootOf('low') })
  assert.equal(result.state, 'degraded')
  assert.match(result.detail, /64 MB available/)
})

test('the message of a tight machine names the worst case', async () => {
  // MEM-07: the diagnostic of a tight machine says what happens if the
  // server grows to the permission it was given. The number may be
  // negative - that is the point of it.
  const { manager } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 900 * MB }),
  })
  const result = await manager.start({ root: rootOf('worst') })
  assert.equal(result.state, 'degraded')
  assert.match(result.detail, /ceiling of 2048 MB/, 'the message names the ceiling')
  assert.match(result.detail, /-1148 MB/, 'the message names what the machine would have left')
})

test('the restart path names the available memory too', async () => {
  // The restart path used the free memory while the crash path used the
  // available one: the same fault showed two different numbers.
  let freeBytes = 8 * 1024 ** 3
  const { manager, handle } = makeManager({
    lsp: { memoryLimitMB: 2048 },
    restartBackoffMs: 10,
    readMemory: () => ({ totalBytes: 16 * 1024 ** 3, freeBytes }),
  })
  const root = rootOf('restart')
  await manager.start({ root })
  freeBytes = 64 * MB
  handle().exit(134)
  await new Promise(resolveDelay => setTimeout(resolveDelay, 200))
  const status = await manager.status({ root })
  assert.equal(status.state, 'degraded')
  assert.match(status.detail, /64 MB available/)
  assert.doesNotMatch(status.detail, /8192 MB/)
})
