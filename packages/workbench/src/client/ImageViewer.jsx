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
  const dragRef = useRef(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [loads, setLoads] = useState(0)
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
  // The counter of the loads is a dependency of its own: a picture that is
  // replaced (a new file in the same tab) is measured again.
  useLayoutEffect(() => {
    const img = imgRef.current
    if (img === null) return
    const width = img.offsetWidth
    const height = img.offsetHeight
    setImageSize(previous => (previous.width === width && previous.height === height ? previous : { width, height }))
  }, [viewport.width, viewport.height, loads])

  /**
   * The pan that is allowed for a zoom: the picture may never leave the view.
   * @param {{ x: number, y: number }} value the wanted pan
   * @param {number} factor the zoom the pan belongs to
   * @returns {{ x: number, y: number }}
   */
  const clampFor = useCallback((value, factor) => clampPan(
    value,
    { width: imageSize.width * factor, height: imageSize.height * factor },
    { width: viewport.width, height: viewport.height },
  ), [imageSize.width, imageSize.height, viewport.width, viewport.height])

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
  // The left button drags the picture; the pointer is captured, so the drag
  // continues when the pointer leaves the surface.
  const onPointerDown = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    const surface = surfaceRef.current
    if (surface !== null && typeof surface.setPointerCapture === 'function') {
      try {
        surface.setPointerCapture(event.pointerId)
      } catch { /* the pointer is already gone */ }
    }
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    setDragging(true)
  }

  const onPointerMove = (event) => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    setView(previous => ({
      zoom: previous.zoom,
      pan: clampFor({ x: previous.pan.x + dx, y: previous.pan.y + dy }, previous.zoom),
    }))
  }

  const endDrag = (event) => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
    const surface = surfaceRef.current
    if (surface !== null && typeof surface.releasePointerCapture === 'function') {
      try {
        surface.releasePointerCapture(event.pointerId)
      } catch { /* the capture is already gone */ }
    }
  }

  // The reset: 100 % and centred again.
  const onDoubleClick = () => {
    dragRef.current = null
    setDragging(false)
    setView({ zoom: 1, pan: { x: 0, y: 0 } })
  }

  return React.createElement('div', { className: 'iwb-image' },
    React.createElement('div', {
      className: 'iwb-image-surface',
      ref: surfaceRef,
      'data-dragging': dragging ? 'true' : 'false',
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onDoubleClick,
      'aria-label': alt !== '' ? alt : t('common.image'),
    },
      React.createElement('img', {
        ref: imgRef,
        className: 'iwb-image-img',
        src,
        alt,
        // The picture is dragged by the surface, never by the browser.
        draggable: false,
        onLoad: () => setLoads(count => count + 1),
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
