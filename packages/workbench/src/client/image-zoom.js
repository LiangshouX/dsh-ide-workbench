/**
 * The maths of the image preview.
 *
 * The picture of a tab sits on a surface, and three rules hold at every
 * moment of the gesture:
 *
 *  - the zoom stays inside its range (a tenth .. sixteen times the fitted
 *    size), so a wild wheel can neither shrink the picture into nothing nor
 *    blow it up into a blur,
 *  - the wheel changes the zoom by a fixed factor and keeps the CENTRE of the
 *    view as the anchor: the detail under the wheel stays under the wheel,
 *    also after the picture has been dragged away from the centre,
 *  - the pan never drags the picture out of the view.
 *
 * Pure and dependency-free, so the whole gesture can be unit-tested without
 * a DOM (the same pattern as compact-path.js).
 */

/** The smallest zoom: a tenth of the fitted size. */
export const MIN_ZOOM = 0.1
/** The largest zoom: sixteen times the fitted size. */
export const MAX_ZOOM = 16
/** The factor of one wheel notch. */
export const ZOOM_STEP = 1.1

/**
 * Clamp one number into a range.
 * @param {number} value the value
 * @param {number} low the lower bound
 * @param {number} high the upper bound
 * @returns {number}
 */
function clamp(value, low, high) {
  if (!Number.isFinite(value)) return low
  if (high < low) return low
  const result = Math.min(high, Math.max(low, value))
  // A negative zero would travel into the transform of the picture.
  return result === 0 ? 0 : result
}

/**
 * Clamp a zoom into its range.
 *
 * A zoom that is not a number (a broken measurement, a division by zero)
 * falls back to the smallest one: a picture that is too small is still a
 * picture, a picture with a broken zoom is not.
 *
 * @param {number} zoom the zoom (1 = the fitted size)
 * @param {number} [min] the lower bound, MIN_ZOOM by default
 * @param {number} [max] the upper bound, MAX_ZOOM by default
 * @returns {number}
 */
export function clampZoom(zoom, min = MIN_ZOOM, max = MAX_ZOOM) {
  const low = Number.isFinite(min) ? min : MIN_ZOOM
  const high = Number.isFinite(max) ? max : MAX_ZOOM
  return clamp(Number(zoom), low, high)
}

/**
 * The zoom of the next wheel notch.
 *
 * The step is multiplicative, so a notch feels the same at every zoom level:
 * a tenth of the picture grows by the same factor as the whole one. A
 * negative notch zooms out (the factor is inverted), and the result never
 * leaves the range.
 *
 * @param {number} zoom the current zoom
 * @param {number} delta the notches: positive zooms in, negative zooms out
 * @param {number} [min] the lower bound, MIN_ZOOM by default
 * @param {number} [max] the upper bound, MAX_ZOOM by default
 * @returns {number} the next zoom, clamped
 */
export function nextZoom(zoom, delta, min = MIN_ZOOM, max = MAX_ZOOM) {
  const current = clampZoom(zoom, min, max)
  const notches = Number(delta)
  if (!Number.isFinite(notches) || notches === 0) return current
  return clampZoom(current * (ZOOM_STEP ** notches), min, max)
}

/**
 * The zoom and the pan of a zoom change that keeps the centre of the view.
 *
 * The picture is drawn around its own centre, so the pan is the offset of
 * the picture's centre from the centre of the view. When the picture is
 * scaled by a factor `s`, the point that was under the centre of the view
 * moves to `pan * s` away from the picture's centre - so the pan has to
 * become `pan * s` as well to keep that point under the centre of the view.
 * The anchor therefore survives a drag: the wheel always zooms into what
 * the user is looking at.
 *
 * The factor the pan really scales by is the one the zoom changed by, not
 * the requested one: at the end of the range the clamp would otherwise move
 * the anchor a little.
 *
 * @param {number} zoom the zoom before the change
 * @param {{ x: number, y: number }} pan the pan before the change
 * @param {number} factor the multiplicative factor of the change (1.1 in)
 * @param {number} [min] the lower bound, MIN_ZOOM by default
 * @param {number} [max] the upper bound, MAX_ZOOM by default
 * @returns {{ zoom: number, pan: { x: number, y: number } }}
 */
export function zoomAroundCentre(zoom, pan, factor, min = MIN_ZOOM, max = MAX_ZOOM) {
  const current = clampZoom(zoom, min, max)
  const step = Number.isFinite(factor) && factor > 0 ? factor : 1
  const next = clampZoom(current * step, min, max)
  const scale = current > 0 ? next / current : 1
  const point = pan === null || pan === undefined ? { x: 0, y: 0 } : pan
  return {
    zoom: next,
    pan: { x: point.x * scale, y: point.y * scale },
  }
}

/**
 * The pan that keeps the picture inside the view.
 *
 * A picture that is smaller than the view stays centred: there is nothing to
 * drag. A bigger picture may be dragged until its edge reaches the centre of
 * the view - it always keeps half of the view, so it can never be dragged
 * out of sight.
 *
 * @param {{ x: number, y: number }} pan the wanted pan
 * @param {{ width: number, height: number }} imageSize the size of the
 *   picture as it is drawn (already scaled by the zoom)
 * @param {{ width: number, height: number }} viewportSize the size of the view
 * @returns {{ x: number, y: number }} the clamped pan
 */
export function clampPan(pan, imageSize, viewportSize) {
  const point = pan === null || pan === undefined ? { x: 0, y: 0 } : pan
  const image = imageSize === null || imageSize === undefined ? { width: 0, height: 0 } : imageSize
  const viewport = viewportSize === null || viewportSize === undefined ? { width: 0, height: 0 } : viewportSize
  const maxX = image.width > viewport.width ? (image.width - viewport.width) / 2 : 0
  const maxY = image.height > viewport.height ? (image.height - viewport.height) / 2 : 0
  return {
    x: clamp(Number(point.x), -maxX, maxX),
    y: clamp(Number(point.y), -maxY, maxY),
  }
}

/**
 * The percentage the caption prints.
 * @param {number} zoom the zoom (1 = the fitted size)
 * @returns {string} e.g. `110%`
 */
export function zoomPercent(zoom) {
  const value = Number(zoom)
  if (!Number.isFinite(value)) return '100%'
  return `${Math.round(value * 100)}%`
}
