/**
 * The maths of the image preview: the range of the zoom, the step of the
 * wheel, the anchor of the zoom and the clamp of the pan.
 *
 * Pure functions, so the whole gesture can be checked without a browser.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_ZOOM, MIN_ZOOM, ZOOM_STEP, clampPan, clampZoom, nextZoom, zoomAroundCentre, zoomPercent,
} from '../src/client/image-zoom.js'

test('the zoom stays inside its range', () => {
  assert.equal(clampZoom(1), 1)
  assert.equal(clampZoom(0.01), MIN_ZOOM)
  assert.equal(clampZoom(100), MAX_ZOOM)
  assert.equal(clampZoom(-3), MIN_ZOOM)
  assert.equal(clampZoom(Number.NaN), MIN_ZOOM)
  // a range of its own
  assert.equal(clampZoom(5, 1, 4), 4)
  assert.equal(clampZoom(0.5, 1, 4), 1)
})

test('one wheel notch multiplies the zoom by 1.1', () => {
  assert.ok(Math.abs(nextZoom(1, 1) - 1.1) < 1e-9)
  assert.ok(Math.abs(nextZoom(2, 1) - 2.2) < 1e-9)
  // a notch down divides by the same factor
  assert.ok(Math.abs(nextZoom(1, -1) - 1 / 1.1) < 1e-9)
  // two notches are two factors
  assert.ok(Math.abs(nextZoom(1, 2) - 1.21) < 1e-9)
  // no notch, no change
  assert.equal(nextZoom(1.5, 0), 1.5)
})

test('the wheel never leaves the range', () => {
  assert.equal(nextZoom(MAX_ZOOM, 1), MAX_ZOOM)
  assert.equal(nextZoom(MIN_ZOOM, -1), MIN_ZOOM)
  // a range of its own
  assert.equal(nextZoom(1, 1, 1, 2), 1.1)
  assert.equal(nextZoom(2, 1, 1, 2), 2)
  assert.equal(nextZoom(1, -1, 1, 2), 1)
})

test('the zoom around the centre scales the pan with the zoom', () => {
  const result = zoomAroundCentre(1, { x: 100, y: -50 }, ZOOM_STEP)
  assert.ok(Math.abs(result.zoom - 1.1) < 1e-9)
  // The pan grows with the zoom, so the point under the centre of the view
  // stays under the centre of the view - also after the picture was dragged.
  assert.ok(Math.abs(result.pan.x - 110) < 1e-9)
  assert.ok(Math.abs(result.pan.y + 55) < 1e-9)
})

test('the anchor does not move at the end of the range', () => {
  // At the maximum the zoom grows no more, so the pan must not move either:
  // otherwise the picture would slide away under the pointer.
  const result = zoomAroundCentre(MAX_ZOOM, { x: 40, y: 0 }, ZOOM_STEP)
  assert.equal(result.zoom, MAX_ZOOM)
  assert.deepEqual(result.pan, { x: 40, y: 0 })
})

test('a zoom out moves the pan back with the picture', () => {
  const result = zoomAroundCentre(1.1, { x: 110, y: 0 }, 1 / ZOOM_STEP)
  assert.ok(Math.abs(result.zoom - 1) < 1e-9)
  assert.ok(Math.abs(result.pan.x - 100) < 1e-9)
})

test('the point under the centre of the view does not move while zooming', () => {
  const fit = { width: 400, height: 200 }
  // The content point (0..1) that is drawn under the centre of the view.
  const contentPoint = (state) => ({
    x: 0.5 - state.pan.x / (fit.width * state.zoom),
    y: 0.5 - state.pan.y / (fit.height * state.zoom),
  })
  const dragged = { zoom: 1, pan: { x: 30, y: -10 } }
  const before = contentPoint(dragged)
  const after = contentPoint(zoomAroundCentre(dragged.zoom, dragged.pan, ZOOM_STEP))
  assert.ok(Math.abs(before.x - after.x) < 1e-9)
  assert.ok(Math.abs(before.y - after.y) < 1e-9)
})

test('a picture that fits the view stays centred', () => {
  const clamped = clampPan({ x: 40, y: -30 }, { width: 100, height: 100 }, { width: 400, height: 400 })
  assert.deepEqual(clamped, { x: 0, y: 0 })
})

test('a bigger picture may be dragged, but never out of the view', () => {
  // The picture is twice as wide as the view: it may be dragged until its
  // edge reaches the centre of the view, so it always keeps half of it.
  assert.deepEqual(
    clampPan({ x: 500, y: 0 }, { width: 800, height: 200 }, { width: 400, height: 400 }),
    { x: 200, y: 0 },
  )
  assert.deepEqual(
    clampPan({ x: -500, y: 0 }, { width: 800, height: 200 }, { width: 400, height: 400 }),
    { x: -200, y: 0 },
  )
  // A pan inside the range is kept as it is.
  assert.deepEqual(
    clampPan({ x: 120, y: 0 }, { width: 800, height: 200 }, { width: 400, height: 400 }),
    { x: 120, y: 0 },
  )
  // The axes are independent: the picture is taller than the view, not wider.
  assert.deepEqual(
    clampPan({ x: 10, y: 400 }, { width: 200, height: 800 }, { width: 400, height: 400 }),
    { x: 0, y: 200 },
  )
})

test('the caption prints the zoom as a percentage', () => {
  assert.equal(zoomPercent(1), '100%')
  assert.equal(zoomPercent(1.1), '110%')
  assert.equal(zoomPercent(0.1), '10%')
  assert.equal(zoomPercent(Number.NaN), '100%')
})
