/**
 * The PDF preview.
 *
 * PDF.js paints the pages into canvases; the viewer around it is the IDE's
 * own: page navigation, a measured fit width, zoom and the same theme as the
 * rest of the document pane. The engine lives behind a dynamic import
 * (`pdf-engine.js`), so opening a text file never loads the parser.
 *
 * Only the pages inside the painted window are mounted, and leaving the
 * window unmounts the canvas again. A long document therefore holds a few
 * bitmaps, not one per page.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { IconChevron, IconExternal, IconFit, IconWarning } from './icons.jsx'
import { formatBytes } from './util.js'
import {
  PDF_MAX_SCALE, PDF_MIN_SCALE, clampPdfScale, pdfFitScale, pdfOutputScale, pdfPageAtOffset,
  pdfPercent, pdfVisibleRange, pdfZoomStep,
} from './pdf-view.js'

/** The gap the scroll area keeps around the page (two sides). */
const PAGE_PADDING = 48
/** The default page, used until the document reports its own first page. */
const A4 = { width: 595, height: 842 }

/** Read the geometry of the rendered page wrappers, one entry per page. */
function readPageGeometry(pagesElement) {
  const pages = []
  for (const child of pagesElement.children) {
    pages.push({ top: child.offsetTop, height: child.offsetHeight })
  }
  return pages
}

/**
 * One page of the document.
 *
 * The canvas is created by the parent only while the page is inside the
 * painted window; this component then asks PDF.js for the page and paints it.
 * A scale change cancels the previous render before starting the next one.
 */
function PdfPage({ t, document, pageNumber, scale, onMeasured }) {
  const canvasRef = useRef(null)
  const [state, setState] = useState('loading')
  useEffect(() => {
    let cancelled = false
    let task = null
    setState('loading')
    const canvas = canvasRef.current
    if (canvas === null) return undefined
    void (async () => {
      try {
        const page = await document.getPage(pageNumber)
        if (cancelled) return
        const viewport = page.getViewport({ scale })
        const outputScale = pdfOutputScale(typeof window === 'undefined' ? 1 : window.devicePixelRatio)
        canvas.width = Math.max(1, Math.floor(viewport.width * outputScale))
        canvas.height = Math.max(1, Math.floor(viewport.height * outputScale))
        const context = canvas.getContext('2d', { alpha: false })
        if (context === null) throw new Error('canvas 2d is not available')
        if (!cancelled) onMeasured(pageNumber, viewport.width, viewport.height)
        task = page.render({
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
        })
        await task.promise
        if (cancelled) return
        setState('ready')
      } catch (error) {
        if (cancelled || error?.name === 'RenderingCancelledException') return
        setState('error')
      }
    })()
    return () => {
      cancelled = true
      try { task?.cancel() } catch { /* the render already finished */ }
    }
  }, [document, pageNumber, scale, onMeasured])
  return React.createElement('canvas', {
    ref: canvasRef,
    className: 'iwb-pdf-canvas',
    'data-state': state,
    'aria-label': `${t('pdf.pageName')} ${pageNumber}`,
    role: 'img',
  })
}

/**
 * The toolbar of the preview: page navigation, zoom and the escape hatches.
 */
function PdfToolbar({ t, numPages, currentPage, scale, zoomMode, size, onJump, onZoom, onFit, onActual, onOpenExternal }) {
  const [pageText, setPageText] = useState(String(currentPage))
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setPageText(String(currentPage))
  }, [currentPage, editing])
  const commit = () => {
    setEditing(false)
    const value = Number.parseInt(pageText, 10)
    if (!Number.isFinite(value)) {
      setPageText(String(currentPage))
      return
    }
    const page = Math.min(Math.max(value, 1), Math.max(1, numPages))
    setPageText(String(page))
    if (page !== currentPage) onJump(page)
  }
  const previous = () => onJump(Math.max(1, currentPage - 1))
  const next = () => onJump(Math.min(numPages, currentPage + 1))
  return React.createElement('div', { className: 'iwb-pdf-bar' },
    React.createElement('div', { className: 'iwb-pdf-nav' },
      React.createElement('button', {
        type: 'button', className: 'iwb-iconbtn', title: t('pdf.previous'), 'aria-label': t('pdf.previous'),
        disabled: currentPage <= 1, onClick: previous,
      }, React.createElement('span', { style: { transform: 'rotate(180deg)', display: 'inline-flex' } },
        React.createElement(IconChevron, { width: 13, height: 13 }))),
      React.createElement('div', { className: 'iwb-pdf-pagebox' },
        React.createElement('input', {
          className: 'iwb-pdf-pageinput',
          'aria-label': t('pdf.pageInput'),
          title: t('pdf.pageInput'),
          value: pageText,
          inputMode: 'numeric',
          onFocus: () => setEditing(true),
          onChange: event => setPageText(event.target.value.replace(/[^\d]/g, '')),
          onBlur: commit,
          onKeyDown: (event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            } else if (event.key === 'Escape') {
              setEditing(false)
              setPageText(String(currentPage))
              event.currentTarget.blur()
            }
          },
        }),
        React.createElement('span', { className: 'iwb-pdf-pagecount' }, `/ ${numPages}`),
      ),
      React.createElement('button', {
        type: 'button', className: 'iwb-iconbtn', title: t('pdf.next'), 'aria-label': t('pdf.next'),
        disabled: currentPage >= numPages, onClick: next,
      }, React.createElement(IconChevron, { width: 13, height: 13, down: false })),
    ),
    React.createElement('span', { className: 'iwb-pdf-sep' }),
    React.createElement('button', {
      type: 'button', className: 'iwb-iconbtn', title: t('pdf.zoomOut'), 'aria-label': t('pdf.zoomOut'),
      disabled: scale <= PDF_MIN_SCALE + 1e-6, onClick: () => onZoom(-1),
    }, '−'),
    React.createElement('button', {
      type: 'button',
      className: `iwb-pdf-zoom ${zoomMode === 'custom' && Math.abs(scale - 1) < 1e-6 ? 'iwb-on' : ''}`,
      title: t('pdf.actualSize'),
      onClick: onActual,
    }, pdfPercent(scale)),
    React.createElement('button', {
      type: 'button', className: 'iwb-iconbtn', title: t('pdf.zoomIn'), 'aria-label': t('pdf.zoomIn'),
      disabled: scale >= PDF_MAX_SCALE - 1e-6, onClick: () => onZoom(1),
    }, '+'),
    React.createElement('button', {
      type: 'button', className: 'iwb-textbtn iwb-small iwb-pdf-fit', title: t('pdf.fitWidth'),
      onClick: onFit,
    },
      React.createElement('span', { className: 'iwb-pdf-fit-icon', 'aria-hidden': 'true' }, React.createElement(IconFit, { width: 13, height: 13 })),
      React.createElement('span', { className: 'iwb-pdf-fit-label' }, t('pdf.fitWidth')),
    ),
    React.createElement('span', { className: 'iwb-pdf-grow' }),
    size > 0 ? React.createElement('span', { className: 'iwb-pdf-size' }, formatBytes(size)) : null,
    typeof onOpenExternal === 'function'
      ? React.createElement('button', {
          type: 'button', className: 'iwb-iconbtn', title: t('pdf.openExternal'), 'aria-label': t('pdf.openExternal'),
          onClick: onOpenExternal,
        }, React.createElement(IconExternal, { width: 14, height: 14 }))
      : null,
  )
}

function statusOf(error) {
  if (error === null || error === undefined) return ''
  if (error.name === 'PasswordException') return 'password'
  if (error.name === 'InvalidPDFException') return 'invalid'
  return 'error'
}

/**
 * The PDF preview of one file tab.
 * @param {{ t: Function, data: string, size?: number, name?: string, onOpenExternal?: Function }} props
 */
export function PdfViewer({ t, data, size = 0, name = '', onOpenExternal }) {
  const scrollRef = useRef(null)
  const pagesRef = useRef(null)
  const engineRef = useRef(null)
  const currentPageRef = useRef(1)
  const pendingPageRef = useRef(null)
  const scrollFrameRef = useRef(0)
  const [doc, setDoc] = useState({ status: 'loading', numPages: 0, error: null, progress: 0 })
  const [retryTick, setRetryTick] = useState(0)
  const [dims, setDims] = useState(() => new Map())
  const [zoom, setZoom] = useState({ mode: 'fit', scale: 1 })
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [currentPage, setCurrentPage] = useState(1)
  const [range, setRange] = useState({ first: 1, last: 1 })

  // ── the engine ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setDoc({ status: 'loading', numPages: 0, error: null, progress: 0 })
    setDims(new Map())
    setCurrentPage(1)
    currentPageRef.current = 1
    engineRef.current = null
    void import('./pdf-engine.js')
      .then(engine => engine.openPdf(data, {
        onProgress: (progress) => {
          if (cancelled) return
          const ratio = progress.total > 0 ? Math.min(1, progress.loaded / progress.total) : 0
          setDoc(previous => (previous.status === 'loading' ? { ...previous, progress: ratio } : previous))
        },
      }))
      .then((opened) => {
        if (cancelled) {
          opened.destroy()
          return
        }
        engineRef.current = opened
        setDoc({ status: 'ready', numPages: opened.document.numPages, error: null, progress: 1 })
      })
      .catch((error) => {
        if (cancelled) return
        setDoc({ status: 'error', numPages: 0, error, progress: 0 })
      })
    return () => {
      cancelled = true
      if (engineRef.current !== null) {
        engineRef.current.destroy()
        engineRef.current = null
      }
    }
  }, [data, retryTick])

  // The first page supplies the aspect ratio of the whole document. Every
  // page refines its own ratio when it is painted, so a mixed document still
  // gets the right placeholders after the first visit.
  useEffect(() => {
    if (doc.status !== 'ready' || engineRef.current === null) return undefined
    let cancelled = false
    const document = engineRef.current.document
    void document.getPage(1).then((page) => {
      if (cancelled) return
      const pageViewport = page.getViewport({ scale: 1 })
      setDims(previous => {
        const known = previous.get(1)
        if (known !== undefined && Math.abs(known.width - pageViewport.width) < 0.5 && Math.abs(known.height - pageViewport.height) < 0.5) return previous
        const next = new Map(previous)
        next.set(1, { width: pageViewport.width, height: pageViewport.height })
        return next
      })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [doc.status, doc.numPages])

  // ── the layout ─────────────────────────────────────────────────────────
  const base = dims.get(1) ?? A4
  // Before the scroll area has been measured (the first layout pass) the
  // page keeps its natural scale; the fit follows the measurement.
  const fitted = viewport.width > 0 ? pdfFitScale(viewport.width, base.width, PAGE_PADDING) : 1
  const scale = zoom.mode === 'fit' ? fitted : clampPdfScale(zoom.scale)

  const pageBox = useCallback((pageNumber) => {
    const size = dims.get(pageNumber) ?? base
    return { width: size.width * scale, height: size.height * scale }
  }, [dims, base.width, base.height, scale])

  const updateReadingPosition = useCallback(() => {
    const scroll = scrollRef.current
    const pages = pagesRef.current
    if (scroll === null || pages === null) return
    const geometry = readPageGeometry(pages)
    const page = pdfPageAtOffset(geometry, scroll.scrollTop, scroll.clientHeight)
    currentPageRef.current = page
    setCurrentPage(previous => (previous === page ? previous : page))
    const visible = pdfVisibleRange(geometry, scroll.scrollTop, scroll.clientHeight)
    setRange(previous => (previous.first === visible.first && previous.last === visible.last ? previous : visible))
  }, [])

  // The rAF-throttled scroll listener: a fast wheel must not rebuild the
  // geometry for every event.
  useEffect(() => {
    if (doc.status !== 'ready') return undefined
    const scroll = scrollRef.current
    if (scroll === null) return undefined
    const onScroll = () => {
      if (scrollFrameRef.current !== 0) return
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = 0
        updateReadingPosition()
      })
    }
    scroll.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroll.removeEventListener('scroll', onScroll)
      if (scrollFrameRef.current !== 0) {
        window.cancelAnimationFrame(scrollFrameRef.current)
        scrollFrameRef.current = 0
      }
    }
  }, [doc.status, updateReadingPosition])

  // Measure the scroll area; the fit width follows a pane resize and the
  // reading position is restored around the page the user was on.
  useLayoutEffect(() => {
    if (doc.status !== 'ready') return undefined
    const scroll = scrollRef.current
    if (scroll === null) return undefined
    const measure = () => {
      setViewport(previous => (previous.width === scroll.clientWidth && previous.height === scroll.clientHeight
        ? previous
        : { width: scroll.clientWidth, height: scroll.clientHeight }))
    }
    measure()
    if (typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [doc.status])

  // After a zoom change (or a resize) the page wrappers have new heights: put
  // the page the user was reading back under the viewport.
  useLayoutEffect(() => {
    if (doc.status !== 'ready') return undefined
    updateReadingPosition()
    const target = pendingPageRef.current
    if (target === null) return undefined
    pendingPageRef.current = null
    const scroll = scrollRef.current
    const pages = pagesRef.current
    const node = pages?.children[Math.min(Math.max(target, 1), doc.numPages) - 1]
    if (scroll !== null && node !== undefined) {
      scroll.scrollTop = Math.max(0, node.offsetTop - 8)
      updateReadingPosition()
    }
    return undefined
  }, [doc.status, doc.numPages, scale, viewport.width, dims, updateReadingPosition])

  // A new page ratio may change the height of the wrappers above the current
  // page; keep the reading position instead of jumping a page up.
  const measuredPage = useCallback((pageNumber, width, height) => {
    if (!Number.isFinite(width) || !Number.isFinite(height) || scale <= 0) return
    const baseWidth = width / scale
    const baseHeight = height / scale
    setDims((previous) => {
      const known = previous.get(pageNumber)
      if (known !== undefined && Math.abs(known.width - baseWidth) < 0.5 && Math.abs(known.height - baseHeight) < 0.5) return previous
      const next = new Map(previous)
      next.set(pageNumber, { width: baseWidth, height: baseHeight })
      return next
    })
  }, [scale])

  const jumpTo = useCallback((pageNumber) => {
    const scroll = scrollRef.current
    const pages = pagesRef.current
    const page = Math.min(Math.max(1, pageNumber), Math.max(1, doc.numPages))
    const node = pages?.children[page - 1]
    if (scroll !== null && node !== undefined) scroll.scrollTop = Math.max(0, node.offsetTop - 8)
    currentPageRef.current = page
    setCurrentPage(page)
    // The painted window follows the scroll event; it is not narrowed here,
    // otherwise a jump would unmount the pages on the way and flash white.
  }, [doc.numPages])

  const changeZoom = (direction) => {
    pendingPageRef.current = currentPageRef.current
    setZoom({ mode: 'custom', scale: pdfZoomStep(scale, direction) })
  }
  const fitWidth = () => {
    pendingPageRef.current = currentPageRef.current
    setZoom({ mode: 'fit', scale: 1 })
  }
  const actualSize = () => {
    pendingPageRef.current = currentPageRef.current
    setZoom({ mode: 'custom', scale: 1 })
  }

  const pages = useMemo(() => {
    if (doc.status !== 'ready') return []
    const list = []
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      list.push(pageNumber)
    }
    return list
  }, [doc.status, doc.numPages])

  if (doc.status === 'loading') {
    const percent = doc.progress > 0 ? ` ${Math.round(doc.progress * 100)}%` : ''
    return React.createElement('div', { className: 'iwb-pdf iwb-pdf-status' },
      React.createElement('div', { className: 'iwb-pdf-spinner', 'aria-hidden': 'true' }),
      React.createElement('div', null, `${t('pdf.loading')}${percent}`),
    )
  }
  if (doc.status === 'error') {
    const kind = statusOf(doc.error)
    const message = kind === 'password'
      ? t('pdf.passwordRequired')
      : kind === 'invalid'
        ? t('pdf.invalid')
        : `${t('pdf.error')}${doc.error?.message ? `: ${doc.error.message}` : ''}`
    return React.createElement('div', { className: 'iwb-pdf iwb-pdf-status' },
      React.createElement(IconWarning, { width: 22, height: 22, style: { color: 'var(--iwb-warn)' } }),
      React.createElement('div', { className: 'iwb-error-box' }, message),
      React.createElement('div', { className: 'iwb-pdf-status-actions' },
        React.createElement('button', {
          type: 'button', className: 'iwb-textbtn iwb-small', onClick: () => setRetryTick(tick => tick + 1),
        }, t('common.retry')),
        typeof onOpenExternal === 'function'
          ? React.createElement('button', {
              type: 'button', className: 'iwb-textbtn iwb-small', onClick: onOpenExternal,
            }, t('pdf.openExternal'))
          : null,
      ),
      name !== '' ? React.createElement('div', { className: 'iwb-pdf-hint' }, name) : null,
    )
  }

  return React.createElement('div', { className: 'iwb-pdf' },
    React.createElement(PdfToolbar, {
      t,
      numPages: doc.numPages,
      currentPage,
      scale,
      zoomMode: zoom.mode,
      size,
      onJump: jumpTo,
      onZoom: changeZoom,
      onFit: fitWidth,
      onActual: actualSize,
      onOpenExternal,
    }),
    React.createElement('div', {
      className: 'iwb-pdf-scroll',
      ref: scrollRef,
      // Keyboard scrolling (PageDown/PageUp) needs a focusable surface; a
      // click on the page gives it the focus.
      tabIndex: 0,
      'aria-label': t('editor.pdf'),
    },
      React.createElement('div', { className: 'iwb-pdf-pages', ref: pagesRef },
        pages.map((pageNumber) => {
          const box = pageBox(pageNumber)
          const visible = pageNumber >= range.first && pageNumber <= range.last
          return React.createElement('div', {
            key: pageNumber,
            className: 'iwb-pdf-page',
            'data-page': pageNumber,
            style: { width: `${Math.max(1, box.width)}px`, height: `${Math.max(1, box.height)}px` },
          },
            visible
              ? React.createElement(PdfPage, {
                  t,
                  document: engineRef.current.document,
                  pageNumber,
                  scale,
                  onMeasured: measuredPage,
                })
              : null,
            !visible
              ? React.createElement('span', { className: 'iwb-pdf-placeholder' }, String(pageNumber))
              : null,
          )
        }),
      ),
    ),
  )
}
