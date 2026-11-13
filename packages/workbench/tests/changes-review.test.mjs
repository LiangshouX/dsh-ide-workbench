/**
 * The review of the changes of one chat turn (issue #3, R2).
 *
 * A turn that changed files ends with a link to its review:
 * `dsh-resource://changes-review/session/<sessionId>/<seq>/<turn>`. The host
 * opens it with the index of the changed file, so the review has to open on
 * THAT file.
 *
 * The data of a turn lives in the host and is delivered as STRUCTURED hunks -
 * not as a unified diff text. The adapter of diff.js turns the hunks into the
 * row model of the diff viewer, so the turn review and the git diff read one
 * model; that is what the first half of this file pins down. The second half
 * pins down the probe that reads the documents: the host's own origin first,
 * the plugin's own route second, and a readable failure when neither answers.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CHANGES_REVIEW_PREFIX, changesReviewAddress, fetchReviewDiff, fetchReviewSummary,
  isChangesReviewAddress, isOutsideWorkspace, parseChangesReviewAddress, readReviewDiff,
  readReviewSummary, reviewIndexOf, reviewMessageKey, reviewQuery,
} from '../src/client/changes-review.js'
import { hunksToDiffFile, sideBySideRows, unifiedRows } from '../src/client/diff.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const clientEntry = await readFile(join(root, 'src/client/index.jsx'), 'utf8')
const diffView = await readFile(join(root, 'src/client/DiffView.jsx'), 'utf8')

const ADDRESS = 'dsh-resource://changes-review/session/s1/12/3'

/* ── the address grammar ─────────────────────────────────────────────────── */

test('the review address is read as the coordinates of one turn', () => {
  assert.deepEqual(parseChangesReviewAddress(ADDRESS), { sessionId: 's1', seq: '12', turn: '3' })
  assert.equal(isChangesReviewAddress(ADDRESS), true)
  assert.equal(isChangesReviewAddress('dsh-resource://file/session/s1/a.ts'), false)
  assert.equal(CHANGES_REVIEW_PREFIX, 'dsh-resource://changes-review/')
})

test('a broken review address is not a review address', () => {
  for (const address of [
    'dsh-resource://changes-review/session/s1',
    'dsh-resource://changes-review/session/s1/12',
    'dsh-resource://changes-review/session//12/3',
    'dsh-resource://changes-review/session/s1/12/3/extra',
    'dsh-resource://changes-review/other/s1/12/3',
    'dsh-resource://changes-review/session/s1/%E0%A4%A/3',
  ]) {
    assert.equal(parseChangesReviewAddress(address), undefined, `${address} is not a turn`)
    assert.equal(isChangesReviewAddress(address) && parseChangesReviewAddress(address) !== undefined, false)
  }
})

test('the review address is built from the coordinates of a turn', () => {
  assert.equal(changesReviewAddress('s 1', 12, 3), 'dsh-resource://changes-review/session/s%201/12/3')
  assert.deepEqual(
    parseChangesReviewAddress(changesReviewAddress('s 1', 12, 3)),
    { sessionId: 's 1', seq: '12', turn: '3' },
  )
})

/* ── the documents of the host ────────────────────────────────────────────── */

test('the summary of a turn names its files and their line counts', () => {
  const summary = readReviewSummary({
    turn: 3,
    files: [
      { path: 'src/a.ts', display: 'a.ts', added: 3, deleted: 1 },
      { path: 'assets/logo.png', display: 'logo.png', added: 0, deleted: 0, binary: true },
    ],
    total: 2,
    added: 3,
    deleted: 1,
  })
  assert.equal(summary.files.length, 2)
  assert.equal(summary.files[0].display, 'a.ts')
  assert.equal(summary.files[0].added, 3)
  assert.equal(summary.files[0].deleted, 1)
  assert.equal(summary.files[1].binary, true)
  assert.equal(summary.added, 3)
  assert.equal(summary.deleted, 1)
})

test('a document that is not a summary is not a summary', () => {
  assert.equal(readReviewSummary(null), undefined)
  assert.equal(readReviewSummary({ turn: 3 }), undefined)
  assert.equal(readReviewSummary({ files: 'nope' }), undefined)
  // The envelope of the plugin's own protocol is unwrapped by the reader of
  // the probe, not here: the reader sees the document itself.
  assert.equal(readReviewSummary({ files: [] }).files.length, 0)
})

test('the diff of a file keeps its kind, so a binary file is never blank', () => {
  const binary = readReviewDiff({ kind: 'binary', path: 'a.png', display: 'a.png' })
  assert.equal(binary.kind, 'binary')
  assert.deepEqual(binary.hunks, [])
  const oversized = readReviewDiff({ kind: 'oversized', path: 'a.bin' })
  assert.equal(oversized.kind, 'oversized')
  assert.equal(readReviewDiff({ path: 'a.ts' }), undefined)
  assert.equal(readReviewDiff(null), undefined)
})

/* ── the file the link points at ─────────────────────────────────────────── */

test('the index of the link decides the file the review opens on', () => {
  assert.equal(reviewIndexOf(3, 0), 0)
  assert.equal(reviewIndexOf(3, 2), 2)
  assert.equal(reviewIndexOf(3, '1'), 1)
  // A link without an index, or with one past the end, opens the first file -
  // never nothing.
  assert.equal(reviewIndexOf(3, undefined), 0)
  assert.equal(reviewIndexOf(3, 9), 2)
  assert.equal(reviewIndexOf(3, -1), 0)
  assert.equal(reviewIndexOf(0, 0), 0)
})

test('a changed file outside the workspace is told to the reader', () => {
  assert.equal(isOutsideWorkspace('src/a.ts', 'C:\\work\\demo'), false)
  assert.equal(isOutsideWorkspace('C:\\other\\a.ts', 'C:\\work\\demo'), true)
  assert.equal(isOutsideWorkspace('/etc/hosts', 'C:\\work\\demo'), true)
  assert.equal(isOutsideWorkspace('', 'C:\\work\\demo'), false)
  assert.equal(isOutsideWorkspace('C:\\other\\a.ts', ''), false)
})

test('the query of the host carries the coordinates of the turn', () => {
  const query = new URLSearchParams(reviewQuery({ sessionId: 's1', seq: '12', turn: '3' }, { index: 2 }))
  assert.equal(query.get('sessionId'), 's1')
  assert.equal(query.get('seq'), '12')
  assert.equal(query.get('turn'), '3')
  assert.equal(query.get('index'), '2')
})

/* ── the hunks of a turn become the rows of the diff viewer ──────────────── */

test('the hunks of a turn become the file the diff viewer reads', () => {
  const file = hunksToDiffFile({
    kind: 'text',
    path: 'src/a.ts',
    display: 'a.ts',
    hunks: [{
      oldStart: 10, oldLines: 3, newStart: 10, newLines: 4,
      lines: [
        { type: ' ', text: 'const a = 1' },
        { type: '-', text: 'const b = 2' },
        { type: '+', text: 'const b = 3' },
      ],
    }],
  })
  assert.equal(file.hunks.length, 1)
  assert.equal(file.additions, 1)
  assert.equal(file.deletions, 1)
  assert.equal(file.hunks[0].header, '@@ -10,3 +10,4 @@')
  const rows = unifiedRows(file)
  assert.deepEqual(rows.map(row => row.kind), ['hunk', 'context', 'del', 'add'])
  // The line numbers are the ones of the parser: a context line advances both
  // sides, a deletion the old one and an addition the new one.
  assert.equal(rows[1].oldNo, 10)
  assert.equal(rows[1].newNo, 10)
  assert.equal(rows[2].oldNo, 11)
  assert.equal(rows[3].newNo, 11)
})

test('the side by side rows of a turn are the rows of the viewer', () => {
  const file = hunksToDiffFile({
    kind: 'text',
    hunks: [{
      oldStart: 1, oldLines: 1, newStart: 1, newLines: 1,
      lines: [{ type: '-', text: 'old' }, { type: '+', text: 'new' }],
    }],
  })
  const rows = sideBySideRows(file)
  assert.deepEqual(rows.map(row => row.kind), ['hunk', 'change'])
  assert.equal(rows[1].left.text, 'old')
  assert.equal(rows[1].right.text, 'new')
})

test('a line of a hunk is read in every spelling the host may use', () => {
  const file = hunksToDiffFile({
    kind: 'text',
    hunks: [{
      oldStart: 1, oldLines: 2, newStart: 1, newLines: 2,
      lines: ['-removed', '+added', 'context', { marker: '+', text: 'marked' }, { text: 'plain' }],
    }],
  })
  const lines = file.hunks[0].lines
  assert.deepEqual(lines.map(line => line.type), ['-', '+', ' ', '+', ' '])
  assert.deepEqual(lines.map(line => line.text), ['removed', 'added', 'context', 'marked', 'plain'])
  assert.equal(file.additions, 2)
  assert.equal(file.deletions, 1)
})

/* ── the probe that reads the documents ──────────────────────────────────── */

/**
 * Install a fetch mock.
 * @param {(url: string, init: any) => Promise<any>} handler
 */
function mockFetch(handler) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => handler(String(url), init)
  return () => { globalThis.fetch = original }
}

/** A response of the plugin's own protocol. */
const ok = value => ({ ok: true, status: 200, async json() { return { ok: true, value } } })

test('the host answers the review on its own origin', async () => {
  const calls = []
  const restore = mockFetch(async url => {
    calls.push(url)
    return ok({ turn: 3, files: [{ path: 'a.ts', display: 'a.ts', added: 1, deleted: 0 }] })
  })
  try {
    const result = await fetchReviewSummary({ sessionId: 's1', seq: '12', turn: '3' })
    assert.equal(result.ok, true)
    assert.equal(result.document.files.length, 1)
    // The host's own route answered: the plugin's route was not needed.
    assert.equal(calls.length, 1)
    assert.ok(calls[0].includes('/api/changes.summary'))
    assert.ok(calls[0].includes('sessionId=s1'))
  } finally {
    restore()
  }
})

test('the plugin route answers when the host origin does not', async () => {
  const calls = []
  const restore = mockFetch(async url => {
    calls.push(url)
    if (url.includes('/ide-workbench/api/')) {
      return ok({ kind: 'text', path: 'a.ts', hunks: [] })
    }
    return { ok: false, status: 404, async json() { return { ok: false, error: { code: 'not-found', message: 'no route' } } } }
  })
  try {
    const result = await fetchReviewDiff({ sessionId: 's1', seq: '12', turn: '3' }, { params: { index: 0 } })
    assert.equal(result.ok, true)
    assert.equal(result.document.kind, 'text')
    // Both paths were tried, in that order.
    assert.equal(calls.length, 2)
    assert.ok(calls[0].includes('/api/changes.diff'))
    assert.ok(calls[1].includes('/ide-workbench/api/changes.diff'))
  } finally {
    restore()
  }
})

test('a turn that is gone is expired, an unreachable host is not', async () => {
  const restore = mockFetch(async () => ({
    ok: false, status: 404, async json() { return { ok: false, error: { code: 'not-found', message: 'no route' } } },
  }))
  try {
    const gone = await fetchReviewSummary({ sessionId: 's1', seq: '12', turn: '3' })
    assert.equal(gone.ok, false)
    assert.equal(gone.reason, 'expired')
  } finally {
    restore()
  }

  const offline = mockFetch(async () => { throw new Error('offline') })
  try {
    const unreachable = await fetchReviewSummary({ sessionId: 's1', seq: '12', turn: '3' })
    assert.equal(unreachable.ok, false)
    assert.equal(unreachable.reason, 'unreachable')
  } finally {
    offline()
  }
})

test('a document of the wrong shape is a failed path, not a turn', async () => {
  const restore = mockFetch(async () => ok({ nothing: true }))
  try {
    const result = await fetchReviewSummary({ sessionId: 's1', seq: '12', turn: '3' })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'unreachable')
  } finally {
    restore()
  }
})

/* ── what the review says when it cannot show a diff ─────────────────────── */

test('a review that cannot be shown says why, and never shows nothing', () => {
  assert.equal(reviewMessageKey({ phase: 'loading' }), 'common.loading')
  assert.equal(reviewMessageKey({ phase: 'failed', reason: 'expired' }), 'changesReview.expired')
  assert.equal(reviewMessageKey({ phase: 'failed', reason: 'unreachable' }), 'changesReview.loadFailed')
  assert.equal(reviewMessageKey({ phase: 'ready', diffPhase: 'loading' }), 'common.loading')
  assert.equal(reviewMessageKey({ phase: 'ready', diffPhase: 'idle' }), 'common.loading')
  assert.equal(reviewMessageKey({ phase: 'ready', diffPhase: 'failed', reason: 'expired' }), 'changesReview.expired')
  assert.equal(reviewMessageKey({ phase: 'ready', diffPhase: 'ready', diff: { kind: 'binary' } }), 'changesReview.binary')
  assert.equal(reviewMessageKey({ phase: 'ready', diffPhase: 'ready', diff: { kind: 'oversized' } }), 'changesReview.oversized')
  // The one case in which nothing is said: the diff itself is shown.
  assert.equal(reviewMessageKey({ phase: 'ready', diffPhase: 'ready', diff: { kind: 'text' } }), '')
})

/* ── the wiring of the view ───────────────────────────────────────────────── */

test('the workbench claims the review address and shows the turn', () => {
  // The address family of the turn is claimed by the tab type of the IDE.
  assert.match(clientEntry, /'dsh-resource:\/\/changes-review\/\*\*'/)
  // The claim is decided apart from the claim of a file link.
  assert.match(clientEntry, /if \(isChangesReviewAddress\(address\)\) return canOpenChangesReview\(address\)/)
  // The tab body of a review shows the review, not a second workbench.
  assert.match(clientEntry, /React\.createElement\(ChangesReviewBridge, \{ store, tab, ctx, suppressSelf \}\)/)
  // The file the link points at decides the file the review opens on.
  assert.match(clientEntry, /reviewIndexOf\(result\.document\.files\.length, requestedIndex\)/)
  // A turn that cannot be read goes back to the sidebar of the host.
  assert.match(clientEntry, /openInDefaultSidebar\(ctx, address, \{/)
})

test('the diff viewer reads the hunks of a turn', () => {
  // The viewer takes the structured hunks of the turn and adapts them to the
  // row model of the parser - one model, two sources.
  assert.match(diffView, /hunksToDiffFile\(payload\)/)
  assert.match(diffView, /source\.file === undefined/)
})
