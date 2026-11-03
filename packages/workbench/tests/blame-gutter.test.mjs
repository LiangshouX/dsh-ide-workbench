/**
 * The inline Git Blame column (V6, IDE-style annotate).
 *
 * The reference view shows the annotation as a COLUMN LEFT OF THE LINE NUMBERS,
 * one cell per line with `date author`, and a blank cell for a line that is not
 * committed yet. This file pins the label/date formatting, the line map (which
 * deliberately drops the uncommitted lines), and the wiring (a CodeMirror
 * gutter ordered before the line numbers, fed by a state field).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EditorState } from '@codemirror/state'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const clientDir = join(root, 'src/client')

let modulePromise

/**
 * The module, loaded after a minimal browser surface is in place: the
 * annotation module pulls `@codemirror/view`, which probes `document` and
 * `navigator` while it is evaluated.
 * @returns {Promise<object>} the module
 */
async function blameModule() {
  if (modulePromise !== undefined) return modulePromise
  modulePromise = (async () => {
    const stubElement = () => ({
      style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false },
      setAttribute() {}, removeAttribute() {}, appendChild() {}, remove() {},
      addEventListener() {}, removeEventListener() {},
    })
    globalThis.window ??= {
      innerWidth: 1440,
      innerHeight: 900,
      location: { href: 'http://localhost/' },
      addEventListener() {}, removeEventListener() {},
      requestAnimationFrame: (callback) => setTimeout(() => callback(Date.now()), 0),
    }
    globalThis.document ??= {
      baseURI: 'http://localhost/',
      documentElement: stubElement(),
      createElement: stubElement,
      createTextNode: () => ({}),
      addEventListener() {}, removeEventListener() {},
    }
    globalThis.navigator ??= { userAgent: 'node' }
    return import('../src/client/blame-gutter.js')
  })()
  return modulePromise
}

test('a line is labelled with the day and the author only', async () => {
  const mod = await blameModule()
  const entry = { author: 'LiangshouX', authorTime: Date.UTC(2026, 9, 30, 4, 0, 0) / 1000, committed: true }
  // The day is the local one (the commit list of the Git window shows local
  // days too), and the month/day are not zero padded (`2026/8/21`).
  const local = new Date(entry.authorTime * 1000)
  const expected = `${local.getFullYear()}/${local.getMonth() + 1}/${local.getDate()}`
  assert.equal(mod.blameDate(entry.authorTime), expected)
  assert.equal(mod.blameLabel(entry), `${expected} LiangshouX`)
  // A missing author is still a usable cell: the day alone.
  assert.equal(mod.blameLabel({ author: '', authorTime: entry.authorTime, committed: true }), expected)
})

test('a line without a commit has NO cell (the reference view leaves it blank)', async () => {
  const mod = await blameModule()
  assert.equal(mod.blameLabel({ author: 'Not Committed Yet', authorTime: 0, committed: false }), '')
  assert.equal(mod.blameLabel({ author: 'x', authorTime: 0, committed: false }), '')
  assert.equal(mod.blameLabel(null), '')
  assert.equal(mod.blameLabel(undefined), '')
})

test('the line map drops the uncommitted and the malformed records', async () => {
  const mod = await blameModule()
  const time = Date.UTC(2026, 7, 21) / 1000
  const map = mod.blameMapOf([
    { line: 3, hash: 'a'.repeat(40), committed: true, author: 'jinliyl', authorTime: time },
    { line: 4, hash: '0'.repeat(40), committed: false, author: 'Not Committed Yet', authorTime: 0 },
    { line: 5, hash: 'b'.repeat(40), committed: true, author: '', authorTime: time },
    { line: Number.NaN, hash: 'c'.repeat(40), committed: true, author: 'x', authorTime: time },
    null,
  ])
  assert.deepEqual([...map.keys()], [3, 5], 'only the committed lines with a real hash are in the column')
  assert.equal(map.get(3).author, 'jinliyl')
})

test('the state field takes the annotation through an effect', async () => {
  const mod = await blameModule()
  const map = mod.blameMapOf([
    { line: 1, hash: 'a'.repeat(40), committed: true, author: 'LiangshouX', authorTime: Date.UTC(2026, 9, 30) / 1000 },
  ])
  const state = EditorState.create({ doc: 'one\ntwo\n', extensions: [mod.blameField] })
  assert.equal(state.field(mod.blameField).size, 0, 'an unannotated document has no cells')
  const next = state.update({ effects: mod.setBlameAnnotations.of(map) })
  assert.equal(next.state.field(mod.blameField).get(1).author, 'LiangshouX')
  // The document itself is untouched: painting the column must not clear the
  // undo history or look like an edit.
  assert.equal(next.state.doc.toString(), 'one\ntwo\n')
})

test('the column is a gutter ordered before the line numbers', async () => {
  const source = await readFile(join(clientDir, 'blame-gutter.js'), 'utf8')
  // CodeMirror orders gutters by extension priority: `Prec.high` is what puts
  // the annotation left of the numbers, as the reference view shows.
  assert.match(source, /Prec\.high\(gutter\(/)
  assert.match(source, /class: 'iwb-blame-gutter'/)
  assert.match(source, /lineMarker\(view, line\)/)
})

test('the editor owns the column through a compartment and passes the jump on', async () => {
  const editor = await readFile(join(clientDir, 'CodeEditor.jsx'), 'utf8')
  assert.match(editor, /const blameCompartment = new Compartment\(\)/)
  assert.match(editor, /blameCompartment\.of\(blameActive \? buildBlameGutter\(\) : \[\]\)/)
  assert.match(editor, /blameCompartment\.reconfigure\(blameActive \? buildBlameGutter\(\) : \[\]\)/)
  assert.match(editor, /setBlameAnnotations\.of\(blameMapOf\(blameActive \? blameLines : \[\]\)\)/)
  assert.match(editor, /blameGutter\(hash => onBlameCommitRef\.current\?\.\(hash\)\)/)
  // The "close" entry of the gutter menu is what switches the column off.
  assert.match(editor, /key: 'blame-close'/)
})

test('the editor area only hands the annotation to the document it belongs to', async () => {
  const area = await readFile(join(clientDir, 'EditorArea.jsx'), 'utf8')
  assert.match(area, /slice\.blame\?\.open === true && slice\.blame\.path === tab\.path \? slice\.blame : null/)
  assert.match(area, /onBlameCommit: hash => store\.openBlameCommit\(hash\)/)
  // The old right-hand panel is gone: the annotation is IN the editor.
  await assert.rejects(stat(join(clientDir, 'BlameView.jsx')))
})

test('the column has its own stylesheet', async () => {
  const css = await readFile(join(clientDir, 'styles.js'), 'utf8')
  assert.match(css, /\.iwb-blame-gutter\s*\{/)
  assert.match(css, /\.iwb-blame-note\s*\{/)
  assert.match(css, /white-space:\s*nowrap/, 'one cell is one line, never wrapped')
  assert.doesNotMatch(css, /\.iwb-blame-row\s*\{/, 'the row-based panel is gone')
})
