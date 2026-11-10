/**
 * The arithmetic and the byte handling of the PDF preview.
 *
 * Kept free of React and of PDF.js so it can be tested without a browser:
 * the viewer asks these helpers where a page is and how big it should be,
 * and only the canvas painting needs the engine.
 */

/** Whether a path is a PDF document. */
export function isPdfPath(path) {
  return typeof path === 'string' && /\.pdf$/i.test(path)
}

/** The smallest / largest zoom the toolbar allows (1 = PDF points). */
export const PDF_MIN_SCALE = 0.25
export const PDF_MAX_SCALE = 4

/** Hard boundary for the bytes the host is willing to inline. */
export const PDF_MAX_BYTES = 32 << 20

/**
 * Decode the base64 payload of `fs.read` into the bytes PDF.js takes.
 *
 * `atob` is the browser decoder; a very large document is decoded in one
 * pass, which is what the worker needs anyway (it takes ownership of the
 * ArrayBuffer).
 * @param {string} data base64 (no data URL prefix)
 * @returns {Uint8Array} the decoded bytes
 */
export function decodePdfBase64(data) {
  if (typeof data !== 'string' || data === '') throw new Error('empty PDF payload')
  const binary = globalThis.atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Clamp one scale to the range of the viewer. */
export function clampPdfScale(scale) {
  const value = Number(scale)
  if (!Number.isFinite(value)) return 1
  return Math.min(Math.max(value, PDF_MIN_SCALE), PDF_MAX_SCALE)
}

/**
 * The scale that fits one page in the available width.
 * @param {number} availableWidth the width of the scroll area (CSS px)
 * @param {number} pageWidth the page width at scale 1
 * @param {number} [padding] the gap kept on both sides of the page
 * @returns {number} the scale
 */
export function pdfFitScale(availableWidth, pageWidth, padding = 32) {
  if (!Number.isFinite(availableWidth) || !Number.isFinite(pageWidth) || pageWidth <= 0) return 1
  const width = Math.max(1, availableWidth - padding)
  return clampPdfScale(width / pageWidth)
}

/**
 * One zoom step. The buttons multiply instead of walking a table, so a
 * fitted scale (which is rarely a round number) keeps its exact ratio.
 * @param {number} scale current scale
 * @param {number} direction positive zooms in, negative zooms out
 * @returns {number} the next scale, clamped
 */
export function pdfZoomStep(scale, direction) {
  return clampPdfScale(Number(scale) * (direction > 0 ? 1.2 : 1 / 1.2))
}

/** The percentage the toolbar prints. */
export function pdfPercent(scale) {
  return `${Math.round(Number(scale) * 100)}%`
}

/**
 * The canvas resolution of one page.
 *
 * Rendering at the device pixel ratio keeps the text sharp on a retina
 * screen; capping it at 2 keeps the memory of a long document sane (a page is
 * a full RGBA bitmap).
 * @param {number} [ratio] `window.devicePixelRatio`
 * @returns {number} the output scale
 */
export function pdfOutputScale(ratio = 1) {
  const value = Number(ratio)
  if (!Number.isFinite(value) || value <= 0) return 1
  return Math.min(Math.max(value, 1), 2)
}

/**
 * The page whose middle is closest to the reading position.
 *
 * `pages` is the laid-out geometry of the document: `{ top, height }` in
 * scroll coordinates, one entry per page. The answer is 1-based.
 * @param {Array<{ top: number, height: number }>} pages page geometry
 * @param {number} scrollTop the scroll offset of the viewport
 * @param {number} viewportHeight the height of the viewport
 * @returns {number} the current page number
 */
export function pdfPageAtOffset(pages, scrollTop, viewportHeight) {
  if (!Array.isArray(pages) || pages.length === 0) return 1
  const target = Number(scrollTop) + Math.max(0, Number(viewportHeight)) * 0.35
  let low = 0
  let high = pages.length - 1
  let found = 0
  while (low <= high) {
    const middle = (low + high) >> 1
    if (pages[middle].top <= target) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found + 1
}

/**
 * The pages that are within the painted window of the viewport.
 *
 * A page is painted when it is inside the viewport plus `margin` on either
 * side, so a small scroll reveals the next page before it is fully visible
 * and a fast scroll does not leave a blank strip behind.
 * @param {Array<{ top: number, height: number }>} pages page geometry
 * @param {number} scrollTop the scroll offset of the viewport
 * @param {number} viewportHeight the height of the viewport
 * @param {number} [margin] the extra window on both ends
 * @returns {{ first: number, last: number }} 1-based, inclusive
 */
export function pdfVisibleRange(pages, scrollTop, viewportHeight, margin = 360) {
  if (!Array.isArray(pages) || pages.length === 0) return { first: 1, last: 1 }
  const start = Number(scrollTop) - margin
  const end = Number(scrollTop) + Number(viewportHeight) + margin
  let first = pages.length - 1
  let low = 0
  let high = pages.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const page = pages[middle]
    if (page.top + page.height >= start) {
      first = middle
      high = middle - 1
    } else {
      low = middle + 1
    }
  }
  let last = first
  low = first
  high = pages.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const page = pages[middle]
    if (page.top <= end) {
      last = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return { first: first + 1, last: last + 1 }
}
