import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { collectPdfTextItems, renderPdfPage } from '../formats/pdf.js'
import { report } from '../lib/http.js'

function PdfPage({ model, pageNumber, scale, rotation, baseSize, t }) {
  const wrapperRef = useRef(null)
  const canvasRef = useRef(null)
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState(null)
  const [textItems, setTextItems] = useState([])

  useEffect(() => {
    const node = wrapperRef.current
    if (node === null) return undefined
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return undefined
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setVisible(entry.isIntersecting)
      },
      { rootMargin: '900px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) {
      // Release the bitmap of pages that scrolled far away; a long PDF would
      // otherwise keep every visited page in GPU memory.
      const canvas = canvasRef.current
      if (canvas !== null && canvas.width > 0) {
        canvas.width = 1
        canvas.height = 1
        setTextItems([])
      }
      return undefined
    }
    let cancelled = false
    const canvas = canvasRef.current
    if (canvas === null) return undefined
    ;(async () => {
      try {
        const viewport = await renderPdfPage(model, pageNumber, canvas, { scale, rotation })
        if (cancelled) return
        const items = await collectPdfTextItems(model, pageNumber, viewport)
        if (cancelled) return
        setTextItems(items)
        setError(null)
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [model, pageNumber, scale, rotation, visible])

  const swapped = rotation % 180 !== 0
  const width = (swapped ? baseSize.height : baseSize.width) * scale
  const height = (swapped ? baseSize.width : baseSize.height) * scale

  return (
    <div
      ref={wrapperRef}
      className="omr-pdf-page"
      data-page={pageNumber}
      style={{ width: Math.round(width), height: Math.round(height) }}
    >
      <canvas ref={canvasRef} width={1} height={1} />
      {error !== null ? (
        <div className="omr-pdf-placeholder" style={{ position: 'absolute', inset: 0 }}>
          {t('reader.pageFailed', { page: pageNumber })}: {error}
        </div>
      ) : null}
      {textItems.length > 0 ? (
        <div className="omr-pdf-textlayer" aria-hidden="false">
          {textItems.map((item, index) => (
            <span
              key={`t-${index}`}
              style={{
                left: `${item.left}px`,
                top: `${item.top}px`,
                width: `${item.width}px`,
                height: `${item.height}px`,
                fontSize: `${item.height}px`,
              }}
            >
              {item.text}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Page-virtualized PDF view: only pages near the viewport are rasterized, and
 * bitmaps of pages that leave the window are released again.
 */
export function PdfView({ model, tab, t, jump, onLocation, quick = false }) {
  const containerRef = useRef(null)
  const pageRefs = useRef(new Map())
  const baseSize = useRef(null)
  const frame = useRef(0)
  const lastReported = useRef({ page: 0, at: 0 })
  // Same trick as FlowView: the location updates while scrolling, but the
  // restore pass must only run on mount / tab switch.
  const tabRef = useRef(tab)
  tabRef.current = tab
  const restoredRef = useRef(null)
  const location = tab?.location ?? {}
  const rotation = Number(location.rotation) || 0
  const requestedScale = Number(location.scale) || 0
  const [fitScale, setFitScale] = useState(0)
  const [firstSize, setFirstSize] = useState(null)

  useEffect(() => {
    report('pdf-rendered', { pages: model.numPages, title: model.title ?? null })
  }, [model])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const page = await model.doc.getPage(1)
        const viewport = page.getViewport({ scale: 1, rotation: 0 })
        if (!cancelled) {
          baseSize.current = { width: viewport.width, height: viewport.height }
          setFirstSize({ width: viewport.width, height: viewport.height })
        }
      } catch {
        // The page list still renders with a conservative 3:4 placeholder.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [model])

  const measure = useCallback(() => {
    const container = containerRef.current
    const size = baseSize.current ?? firstSize
    if (container === null || size === null) return 1
    const available = Math.max(container.clientWidth - 34, 240)
    return Math.min(available / size.width, 3)
  }, [firstSize])

  useEffect(() => {
    const update = () => setFitScale(measure())
    update()
    const container = containerRef.current
    if (container === null || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => observer.disconnect()
  }, [measure])

  const scale = requestedScale > 0 ? requestedScale : fitScale || 1

  const setPageRef = useCallback((pageNumber, node) => {
    if (node === null) pageRefs.current.delete(pageNumber)
    else pageRefs.current.set(pageNumber, node)
  }, [])

  const scrollToPage = useCallback((pageNumber) => {
    window.requestAnimationFrame(() => {
      const node = pageRefs.current.get(pageNumber)
      if (node !== undefined) node.scrollIntoView({ block: 'start' })
    })
  }, [])

  useEffect(() => {
    if (!jump) return
    const page = Math.min(Math.max(Number(jump.page) || 1, 1), model.numPages)
    scrollToPage(page)
  }, [jump?.seq, model.numPages, scrollToPage])

  // Restore the saved page after a reopen or a tab switch. Pages are laid out
  // synchronously as placeholders, so this can retry a few frames until the
  // scroll port has a real height.
  useEffect(() => {
    if (quick) return undefined
    const tabId = tabRef.current?.id ?? 'detached'
    const restoreKey = `${tabId}:${model?.path ?? model?.title ?? 'model'}`
    if (restoredRef.current === restoreKey) return undefined
    restoredRef.current = restoreKey
    const page = Math.min(Math.max(Number(tabRef.current?.location?.page) || 1, 1), model.numPages)
    if (page <= 1) return undefined
    let cancelled = false
    let tries = 0
    let handle = 0
    const tick = () => {
      if (cancelled) return
      const container = containerRef.current
      const node = pageRefs.current.get(page)
      if (container !== null && node !== undefined && container.scrollHeight > 0) {
        node.scrollIntoView({ block: 'start' })
        report('position-restored', { kind: 'pdf', page, applied: true })
        return
      }
      tries += 1
      if (tries < 48) handle = window.requestAnimationFrame(tick)
      else report('position-restored', { kind: 'pdf', page, applied: false })
    }
    handle = window.requestAnimationFrame(tick)
    return () => {
      cancelled = true
      window.cancelAnimationFrame(handle)
    }
  }, [quick, tab?.id, model, model.numPages, scrollToPage])

  const handleScroll = useCallback(() => {
    if (frame.current !== 0) return
    frame.current = window.requestAnimationFrame(() => {
      frame.current = 0
      const container = containerRef.current
      if (container === null) return
      const top = container.getBoundingClientRect().top
      let current = 1
      for (let pageNumber = 1; pageNumber <= model.numPages; pageNumber += 1) {
        const node = pageRefs.current.get(pageNumber)
        if (node === undefined) continue
        const rect = node.getBoundingClientRect()
        if (rect.top - top <= 90) current = pageNumber
        else break
      }
      if (current !== lastReported.current.page) {
        lastReported.current = { page: current, at: Date.now() }
        onLocation?.({ page: current, scale: requestedScale, rotation })
      }
    })
  }, [model.numPages, onLocation, requestedScale, rotation])

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return undefined
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  const placeholder = firstSize ?? { width: 595, height: 842 }
  const pages = useMemo(() => Array.from({ length: model.numPages }, (_, index) => index + 1), [model.numPages])

  return (
    <div className="omr-pdf-scroll" ref={containerRef} data-quick={quick ? 'true' : undefined}>
      {pages.map((pageNumber) => (
        <div key={pageNumber} ref={(node) => setPageRef(pageNumber, node)} style={{ scrollMarginTop: '8px' }}>
          <PdfPage
            model={model}
            pageNumber={pageNumber}
            scale={scale}
            rotation={rotation}
            baseSize={placeholder}
            t={t}
          />
        </div>
      ))}
    </div>
  )
}
