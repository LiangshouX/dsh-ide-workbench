/**
 * The clipboard of the project tree: where a paste lands, and what may not
 * be pasted at all.
 *
 * These are the rules the panel asks and the store obeys, so they are
 * checked on their own - without a browser and without a DOM.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  commonParentOf, isUnder, parentOf, pasteRefusal, pasteTargetOf,
} from '../src/client/tree-clipboard.js'

const ROOT = 'C:\\work\\demo'
const SRC = `${ROOT}\\src`
const DOCS = `${ROOT}\\docs`
const FILE = `${SRC}\\main.ts`
const OTHER = `${DOCS}\\readme.md`

/** One entry of the tree, as the panel knows it. */
function entry(path, isDir) {
  return { path, isDir, name: path.slice(path.lastIndexOf('\\') + 1), rel: path.slice(ROOT.length + 1) }
}

test('the parent of a path is the folder that holds it', () => {
  assert.equal(parentOf(FILE), SRC)
  assert.equal(parentOf('C:\\a.ts'), 'C:')
  assert.equal(parentOf('/a/b/c.txt'), '/a/b')
  assert.equal(parentOf(''), '')
})

test('a folder holds itself and its own entries, but not a neighbour', () => {
  assert.equal(isUnder(SRC, FILE), true)
  assert.equal(isUnder(SRC, SRC), true)
  // `C:\work\demo2` is NOT under `C:\work\demo`: a plain prefix check would
  // say it is, and the paste would land in the wrong folder.
  assert.equal(isUnder(ROOT, 'C:\\work\\demo2\\x.ts'), false)
  assert.equal(isUnder(SRC, DOCS), false)
})

test('the folder of a selection is the folder the entries share', () => {
  assert.equal(commonParentOf([FILE, `${SRC}\\other.ts`]), SRC)
  assert.equal(commonParentOf([FILE, OTHER]), ROOT)
  assert.equal(commonParentOf([]), '')
})

test('a selected folder receives the paste inside itself', () => {
  // The gesture of the user: one folder is picked, Ctrl+V is pressed. The
  // entry has to land IN that folder - not in the project root, and not
  // somewhere the user has to go looking for.
  assert.equal(pasteTargetOf(ROOT, [entry(SRC, true)], undefined), SRC)
})

test('a selected file receives the paste in its own folder', () => {
  assert.equal(pasteTargetOf(ROOT, [entry(FILE, false)], undefined), SRC)
})

test('a multi-selection receives the paste in the folder the entries share', () => {
  assert.equal(
    pasteTargetOf(ROOT, [entry(FILE, false), entry(`${SRC}\\other.ts`, false)], undefined),
    SRC,
  )
  // Entries of two folders land in the folder that holds them both.
  assert.equal(pasteTargetOf(ROOT, [entry(FILE, false), entry(OTHER, false)], undefined), ROOT)
})

test('the entry of the context menu receives the paste when nothing is selected', () => {
  assert.equal(pasteTargetOf(ROOT, [], entry(SRC, true)), SRC)
  assert.equal(pasteTargetOf(ROOT, [], entry(FILE, false)), SRC)
})

test('the focused entry receives the paste when the search hides its row', () => {
  // The tree search narrows the tree to the chain of a match, so the row
  // the user picked may be gone - the paste still has to know that the
  // focused path is a folder.
  assert.equal(pasteTargetOf(ROOT, [], undefined, entry(SRC, true)), SRC)
  assert.equal(pasteTargetOf(ROOT, [], undefined, entry(FILE, false)), SRC)
})

test('without any hint the paste lands in the project root', () => {
  assert.equal(pasteTargetOf(ROOT, [], undefined), ROOT)
})

test('a folder cannot be pasted into itself, nor into one of its own subfolders', () => {
  assert.equal(pasteRefusal([entry(SRC, true)], SRC), 'self')
  assert.equal(pasteRefusal([entry(SRC, true)], `${SRC}\\inner`), 'inside')
  // A file is not a folder: pasting it into a folder of its own is fine.
  assert.equal(pasteRefusal([entry(FILE, false)], SRC), null)
  assert.equal(pasteRefusal([entry(SRC, true)], DOCS), null)
  assert.equal(pasteRefusal([], SRC), null)
})

test('a paste without a target is refused', () => {
  assert.equal(pasteRefusal([entry(FILE, false)], ''), 'no-target')
})
