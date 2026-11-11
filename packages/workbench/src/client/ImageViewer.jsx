/**
 * The image preview.
 *
 * The picture of a tab sits on a surface that clips it: the wheel zooms it
 * around the centre of the view, the left button drags it, and a double
 * click puts it back to 100 %. The zoom is a CSS transform, so a change
 * never relayouts the picture - the browser only repaints the surface.
 *
 * The gesture itself lives in `image-zoom.js` (pure maths, unit-tested);
 * this component owns the surface, the measurements and the pointer
 * handling.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  clampPan, nextZoom, zoomAroundCentre, zoomPercent,
} from './image-zoom.js'

/**
 * The image preview of one file tab.
 *
 * @param {{ src: string, alt?: string, caption?: string, t?: Function }} props
 *   `src` is the data URL of the picture, `caption` the line below it (the
 *   zoom is appended to it).
 */
export function ImageViewer({ src, alt = '', caption = '', t = key => key }) {
  const surfaceRef = useRef(null)
  const imgRef = useRef(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState({ zoom: 1, pan: { x: 0, y: 0 } })
  const [dragging, setDragging] = useState(false)
  const zoom = view.zoom
  const pan = view.pan

  // ── the measurements ───────────────────────────────────────────────────
  // The surface is the view; the picture is measured in its own layout box
  // (the transform does not change it), so the clamp of the pan knows how
  // big the picture really is.
  useEffect(() => {
    const surface = surfaceRef.current
    if (surface === null) return undefined
    const measure = () => {
      setViewport(previous => (previous.width === surface.clientWidth && previous.height === surface.clientHeight
        ? previous
        : { width: surface.clientWidth, height: surface.clientHeight }))
    }
    measure()
    if (typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(surface)
    return () => observer.disconnect()
  }, [])

  // The picture changes its layout box when the surface is resized and when
  // it has loaded; the box is read after the layout, never during a render.
  //
  // The observer watches the PICTURE itself: a picture that is already in the
  // cache never fires a load event again, and a picture that is not loaded
  // yet has no size at all. The observer reports the size in both cases - and
  // a pan that is clamped against an unknown size would pin the picture in
  // place for good.
  useEffect(() => {
    const img = imgRef.current
    if (img === null) return undefined
    const measure = () => {
      const width = img.offsetWidth
      const height = img.offsetHeight
      setImageSize(previous => (previous.width === width && previous.height === height ? previous : { width, height }))
    }
    measure()
    if (typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(img)
    return () => observer.disconnect()
  }, [])

  /**
   * The pan that is allowed for a zoom: the picture may never leave the view.
   * @param {{ x: number, y: number }} value the wanted pan
   * @param {number} factor the zoom the pan belongs to
   * @returns {{ x: number, y: number }}
   */
  const clampFor = useCallback((value, factor) => {
    // Without a measurement of the picture there is nothing to measure the
    // overflow against; the centre of the picture may then move half of the
    // view, so it always keeps some of the picture on screen.
    if (imageSize.width === 0 || imageSize.height === 0) {
      return clampPan(
        value,
        { width: viewport.width * 2, height: viewport.height * 2 },
        { width: viewport.width, height: viewport.height },
      )
    }
    return clampPan(
      value,
      { width: imageSize.width * factor, height: imageSize.height * factor },
      { width: viewport.width, height: viewport.height },
    )
  }, [imageSize.width, imageSize.height, viewport.width, viewport.height])

  // A resize or a new picture can leave the pan outside of the view; the
  // clamp runs after every measurement.
  useLayoutEffect(() => {
    setView(previous => {
      const clamped = clampFor(previous.pan, previous.zoom)
      if (clamped.x === previous.pan.x && clamped.y === previous.pan.y) return previous
      return { zoom: previous.zoom, pan: clamped }
    })
  }, [clampFor])

  // ── the wheel ──────────────────────────────────────────────────────────
  // The listener is NOT passive: the zoom owns the wheel over the picture, so
  // the page must not scroll while the user zooms.
  useEffect(() => {
    const surface = surfaceRef.current
    if (surface === null) return undefined
    const onWheel = (event) => {
      if (event.deltaY === 0) return
      event.preventDefault()
      const notches = event.deltaY < 0 ? 1 : -1
      setView(previous => {
        // The wheel decides the next zoom, the anchor moves the pan with it:
        // the detail under the wheel stays under the wheel.
        const next = nextZoom(previous.zoom, notches)
        const factor = previous.zoom > 0 ? next / previous.zoom : 1
        const centred = zoomAroundCentre(previous.zoom, previous.pan, factor)
        return { zoom: centred.zoom, pan: clampFor(centred.pan, centred.zoom) }
      })
    }
    surface.addEventListener('wheel', onWheel, { passive: false })
    return () => surface.removeEventListener('wheel', onWheel)
  }, [clampFor])

  // ── the drag ───────────────────────────────────────────────────────────
  // The left button drags the picture.
  //
  // The listeners are NATIVE and not React's synthetic ones: the wheel above
  // is native too, and a pointer that is swallowed somewhere on its way up
  // (a listener of the host that stops the propagation) would leave the
  // picture undraggable.
  //
  // BOTH the pointer and the mouse events are watched: the pointer events
  // come first and mark the drag as started, so the mouse events are only a
  // fallback for a host that swallows them. The move and the release are
  // watched on the WINDOW, so the drag continues when the pointer leaves the
  // picture.
  useEffect(() => {
    const surface = surfaceRef.current
    if (surface === null) return undefined
    let drag = null

    const onMove = (event) => {
      if (drag === null) return
      const dx = event.clientX - drag.x
      const dy = event.clientY - drag.y
      setView(previous => ({
        zoom: previous.zoom,
        pan: clampFor({ x: previous.pan.x + dx, y: previous.pan.y + dy }, previous.zoom),
      }))
    }
    const onUp = () => {
      if (drag === null) return
      drag = null
      setDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    const onDown = (event) => {
      if (drag !== null) return
      if (typeof event.button === 'number' && event.button !== 0) return
      // The picture is dragged by the surface, never by the browser.
      if (typeof event.preventDefault === 'function') event.preventDefault()
      drag = { x: event.clientX, y: event.clientY }
      setDragging(true)
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      try {
        if (typeof surface.setPointerCapture === 'function' && typeof event.pointerId === 'number') {
          surface.setPointerCapture(event.pointerId)
        }
      } catch { /* the pointer is already gone */ }
    }
    // The reset: 100 % and centred again.
    const onDouble = () => {
      drag = null
      setDragging(false)
      setView({ zoom: 1, pan: { x: 0, y: 0 } })
    }

    surface.addEventListener('pointerdown', onDown)
    surface.addEventListener('mousedown', onDown)
    surface.addEventListener('dblclick', onDouble)
    return () => {
      surface.removeEventListener('pointerdown', onDown)
      surface.removeEventListener('mousedown', onDown)
      surface.removeEventListener('dblclick', onDouble)
      onUp()
    }
  }, [clampFor])

  return React.createElement('div', { className: 'iwb-image' },
    React.createElement('div', {
      className: 'iwb-image-surface',
      ref: surfaceRef,
      'data-dragging': dragging ? 'true' : 'false',
      // The state of the gesture, so a reader can see where the picture sits.
      title: `${zoomPercent(zoom)} · ${Math.round(pan.x)}, ${Math.round(pan.y)}`,
      'aria-label': alt !== '' ? alt : t('common.image'),
    },
      React.createElement('img', {
        ref: imgRef,
        className: 'iwb-image-img',
        src,
        alt,
        // The picture is dragged by the surface, never by the browser.
        draggable: false,
        style: {
          // A transform, not a layout: the zoom never relayouts the picture.
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        },
      }),
    ),
    React.createElement('div', { className: 'iwb-image-caption' },
      caption === '' ? zoomPercent(zoom) : `${caption} · ${zoomPercent(zoom)}`),
  )
}
