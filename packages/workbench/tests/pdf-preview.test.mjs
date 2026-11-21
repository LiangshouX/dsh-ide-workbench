/**
 * The PDF preview: the host side that finds the document and the arithmetic
 * of the viewer.
 *
 * The canvas painting itself needs a browser; the parts that can be wrong
 * silently (the byte payload, the page geometry, the zoom limits) are pure
 * functions and are tested here.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_PDF_BYTES, readFileForPreview } from '../src/host/workspace.js'
import {
  PDF_MAX_SCALE, PDF_MIN_SCALE, clampPdfScale, fetchPdfBytes, isPdfPath, pdfFitScale,
  pdfOutputScale, pdfPageAtOffset, pdfPercent, pdfVisibleRange, pdfZoomStep,
} from '../src/client/pdf-view.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('the host answers the metadata of a PDF instead of calling it binary', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'iwb-pdf-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  // "%PDF-1.7" plus a NUL byte: the old heuristic called this file binary.
  const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37, 0x00, 0xFF])
  await writeFile(join(dir, 'report.PDF'), bytes)
  const preview = await readFileForPreview(dir, join(dir, 'report.PDF'))
  assert.equal(preview.kind, 'pdf')
  assert.equal(preview.mime, 'application/pdf')
  assert.equal(preview.size, bytes.length)
  assert.equal(preview.path, 'report.PDF')
  // The bytes do not travel through the JSON API: they are served by the
  // binary route of the plugin (PRD-v8 PDF-01).
  assert.equal('data' in preview, false, 'the answer of the read carries no bytes')
  assert.equal('dataUrl' in preview, false, 'the answer of the read carries no bytes')
})

test('a PDF above the inline cap is handed to the external viewer', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'iwb-pdf-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'huge.pdf')
  // A sparse file: the host answers from `stat` before it reads anything.
  const handle = await open(file, 'w')
  await handle.truncate(MAX_PDF_BYTES + 1)
  await handle.close()
  const preview = await readFileForPreview(dir, file)
  assert.equal(preview.kind, 'too-large')
  assert.equal(preview.size, MAX_PDF_BYTES + 1)
})

test('a binary file with another extension still says it is binary', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'iwb-pdf-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'payload.bin'), Buffer.from([0x00, 0x01, 0x02]))
  const preview = await readFileForPreview(dir, join(dir, 'payload.bin'))
  assert.equal(preview.kind, 'binary')
})

test('the PDF path test is extension-only and case-insensitive', () => {
  assert.equal(isPdfPath('a/report.pdf'), true)
  assert.equal(isPdfPath('a/REPORT.PDF'), true)
  assert.equal(isPdfPath('a/report.pdf.txt'), false)
  assert.equal(isPdfPath('a/report'), false)
  assert.equal(isPdfPath(undefined), false)
})

test('the bytes of the document come from the binary route, as bytes', async () => {
  const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255])
  const asked = []
  const result = await fetchPdfBytes('http://dsh.internal/ide-workbench/raw?root=r&path=a.pdf', {
    fetch: async (url) => {
      asked.push(url)
      return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer }
    },
  })
  assert.deepEqual(Array.from(result), Array.from(bytes), 'the bytes arrive unchanged')
  assert.equal(asked.length, 1, 'the document is fetched once')
})

test('fit width keeps the page inside the pane and inside the zoom range', () => {
  // 595 points wide, a 900px pane: 852px of room, so the page is 143% wide.
  assert.ok(Math.abs(pdfFitScale(900, 595, 48) - 852 / 595) < 1e-9)
  assert.equal(pdfFitScale(100, 595, 48), PDF_MIN_SCALE)
  assert.equal(pdfFitScale(100000, 595, 48), PDF_MAX_SCALE)
  assert.equal(pdfFitScale(900, 0), 1)
  assert.equal(pdfFitScale(Number.NaN, 595), 1)
})

test('zoom steps multiply and stay inside the range', () => {
  assert.ok(pdfZoomStep(1, 1) > 1)
  assert.ok(pdfZoomStep(1, -1) < 1)
  assert.equal(pdfZoomStep(PDF_MAX_SCALE, 1), PDF_MAX_SCALE)
  assert.equal(pdfZoomStep(PDF_MIN_SCALE, -1), PDF_MIN_SCALE)
  assert.equal(pdfZoomStep('nonsense', 1), 1)
  assert.equal(clampPdfScale(99), PDF_MAX_SCALE)
  assert.equal(clampPdfScale(-99), PDF_MIN_SCALE)
  assert.equal(clampPdfScale(undefined), 1)
  assert.equal(pdfPercent(1.234), '123%')
})

test('the canvas follows the screen but stops at 2x', () => {
  assert.equal(pdfOutputScale(1), 1)
  assert.equal(pdfOutputScale(1.5), 1.5)
  assert.equal(pdfOutputScale(3), 2)
  assert.equal(pdfOutputScale(0), 1)
  assert.equal(pdfOutputScale(Number.NaN), 1)
})

test('the reading position names the page under the viewport', () => {
  const pages = [
    { top: 0, height: 1000 },
    { top: 1016, height: 1000 },
    { top: 2032, height: 1000 },
  ]
  assert.equal(pdfPageAtOffset(pages, 0, 600), 1)
  assert.equal(pdfPageAtOffset(pages, 900, 600), 2)
  assert.equal(pdfPageAtOffset(pages, 2100, 600), 3)
  assert.equal(pdfPageAtOffset(pages, 99999, 600), 3)
  assert.equal(pdfPageAtOffset([], 0, 600), 1)
})

test('the painted window includes the pages around the viewport', () => {
  const pages = [
    { top: 0, height: 1000 },
    { top: 1016, height: 1000 },
    { top: 2032, height: 1000 },
    { top: 3048, height: 1000 },
  ]
  assert.deepEqual(pdfVisibleRange(pages, 0, 600), { first: 1, last: 1 })
  assert.deepEqual(pdfVisibleRange(pages, 1016, 600), { first: 1, last: 2 })
  assert.deepEqual(pdfVisibleRange(pages, 2032, 600), { first: 2, last: 3 })
  assert.deepEqual(pdfVisibleRange(pages, 3048, 600), { first: 3, last: 4 })
  assert.deepEqual(pdfVisibleRange([], 0, 600), { first: 1, last: 1 })
})

test('the engine is loaded on demand, never with the workbench bundle', async () => {
  const viewer = await readFile(join(root, 'src/client/PdfViewer.jsx'), 'utf8')
  const engine = await readFile(join(root, 'src/client/pdf-engine.js'), 'utf8')
  // A static import would put the parser (and the worker string) on every
  // page load, including sessions that never open a PDF.
  assert.doesNotMatch(viewer, /^\s*import\s+.*pdf-engine/m)
  assert.match(viewer, /import\('\.\/pdf-engine\.js'\)/)
  // The worker is created from the bundled source and torn down with the
  // document: a closed tab must not leave a worker behind.
  assert.match(engine, /^import \* as pdfjs from 'pdfjs-dist\/build\/pdf\.min\.mjs'/m)
  assert.match(engine, /import workerSource from 'virtual:pdf-worker'/)
  assert.match(engine, /new Worker\(url, \{ type: 'module'/)
  assert.match(engine, /worker\.terminate\(\)/)
  assert.match(engine, /URL\.revokeObjectURL\(url\)/)
  // The bytes are handed to PDF.js as they are: there is no base64 of the
  // document left in the client (PRD-v8 PDF-04).
  assert.match(engine, /getDocument\(\{/)
  assert.doesNotMatch(engine, /atob|base64|decodePdfBase64/)
})
