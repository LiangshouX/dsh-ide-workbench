/**
 * The pan of the image preview (PRD-v8 §6).
 *
 * The bug this file pins down: the drag used to add the WHOLE distance the
 * pointer had travelled to a pan that already contained it, so the pan grew
 * quadratically. A short drag of a few pixels was enough to slam the picture
 * against the clamp, and the user saw the picture jump to the edge instead
 * of following the mouse.
 *
 * The maths is a pure function, so the whole gesture can be checked without
 * a browser.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { beginDrag, dragPan, panFromDrag } from '../src/client/image-zoom.js'

/** A view of 400x300 with a picture of 800x600 drawn in it (zoom 1). */
const VIEW = { width: 400, height: 300 }
const IMAGE = { width: 800, height: 600 }

test('the pan of a drag is the pan of its beginning plus the displacement', () => {
  const origin = { x: 100, y: 100, pan: { x: 0, y: 0 } }
  // One move of 10 pixels to the right: the picture follows by 10 pixels.
  assert.deepEqual(
    panFromDrag(origin, { x: 110, y: 100 }, 1, IMAGE, VIEW),
    { x: 10, y: 0 },
  )
  // The same origin, a different displacement: the answer follows the
  // pointer, not the number of moves that happened to arrive.
  assert.deepEqual(
    panFromDrag(origin, { x: 130, y: 90 }, 1, IMAGE, VIEW),
    { x: 30, y: -10 },
  )
})

test('the pan of a drag does not accumulate', () => {
  // The gesture that used to break: many small moves to the left. The pan
  // of an ABSOLUTE drag is the distance the pointer travelled - not the sum
  // of the distances.
  const origin = { x: 200, y: 150, pan: { x: 0, y: 0 } }
  let pan = { x: 0, y: 0 }
  for (let step = 1; step <= 20; step += 1) {
    pan = panFromDrag(origin, { x: 200 - step, y: 150 }, 1, IMAGE, VIEW)
  }
  assert.equal(pan.x, -20, 'the picture moved by the distance of the pointer')
  // The accumulating form would have ended up at -210 and hit the clamp.
  assert.ok(pan.x > -200, 'the picture did not slam against the edge')
})

test('the pan of a drag keeps the pan the drag started from', () => {
  // The picture was already dragged to the left before this drag started.
  const origin = { x: 100, y: 100, pan: { x: -50, y: 20 } }
  assert.deepEqual(
    panFromDrag(origin, { x: 115, y: 100 }, 1, IMAGE, VIEW),
    { x: -35, y: 20 },
  )
})

test('the pan of a drag is clamped against the picture', () => {
  // The picture is 800x600 in a 400x300 view: it may be dragged until half
  // of the view stays visible, so the pan may not pass 200 pixels.
  const origin = { x: 100, y: 100, pan: { x: 0, y: 0 } }
  const pan = panFromDrag(origin, { x: 900, y: 900 }, 1, IMAGE, VIEW)
  assert.equal(pan.x, 200)
  assert.equal(pan.y, 150)
})

test('the clamp of the drag knows the zoom of the picture', () => {
  // At twice the size the picture is 1600x1200: it may be dragged twice as
  // far before it hits the edge (1200 of slack on each axis, half of it on
  // each side).
  const origin = { x: 0, y: 0, pan: { x: 0, y: 0 } }
  const zoomed = panFromDrag(origin, { x: 900, y: 900 }, 2, IMAGE, VIEW)
  assert.equal(zoomed.x, 600)
  assert.equal(zoomed.y, 450)
})

test('the drag survives a broken measurement', () => {
  // A picture without a size and a pointer without coordinates must not
  // produce a NaN: a NaN transform paints nothing at all.
  const pan = panFromDrag(null, null, 1, { width: 0, height: 0 }, VIEW)
  assert.equal(Number.isFinite(pan.x), true)
  assert.equal(Number.isFinite(pan.y), true)
})

test('the drag measures every displacement from the pan of its beginning', () => {
  // This is the shape of the gesture that used to break. The state of the
  // drag carries the pan of its BEGINNING, and that pan is never overwritten
  // by the result of a move - otherwise the next displacement would be
  // measured from the previous result, and the pan would grow quadratically.
  const drag = beginDrag({ zoom: 1, pan: { x: 0, y: 0 } }, { x: 200, y: 150 })
  let pan = { x: 0, y: 0 }
  for (let step = 1; step <= 4; step += 1) {
    pan = dragPan(drag, { x: 200 - step * 10, y: 150 }, IMAGE, VIEW)
  }
  assert.equal(pan.x, -40, 'the picture moved by the distance of the pointer')
  assert.equal(drag.origin.x, 0, 'the pan of the beginning did not move')
  // The accumulating form would have ended up at -100.
  assert.notEqual(pan.x, -100)
})

test('the drag of a picture that is already panned keeps its place', () => {
  const drag = beginDrag({ zoom: 2, pan: { x: -30, y: 10 } }, { x: 100, y: 100 })
  assert.equal(drag.origin.x, -30)
  assert.equal(drag.origin.y, 10)
  assert.equal(drag.zoom, 2)
  const pan = dragPan(drag, { x: 90, y: 100 }, IMAGE, VIEW)
  assert.equal(pan.x, -40, 'the picture moved by the displacement of the pointer')
  assert.equal(pan.y, 10)
})
