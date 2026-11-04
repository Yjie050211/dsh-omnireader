/**
 * PDF support, built on the PDF.js build that DSH already ships as a bundle.
 *
 * The worker script is served by the plugin's own host route
 * (`/api/omnireader/asset?name=pdf-worker`) and materialized as a same-origin
 * blob URL, so no third-party CDN is contacted and the reader keeps working
 * offline. Pages are rendered on demand by the view layer; this module only
 * owns document loading, text extraction, outline resolution and search.
 */

import { assetUrl, report } from '../lib/http.js'
import { PDF_WORKER_TEXT } from '../generated/pdf-worker.js'

let pdfjsPromise = null
let workerObjectUrl = null

async function loadWorkerText() {
  if (typeof PDF_WORKER_TEXT === 'string' && PDF_WORKER_TEXT.length > 0) return PDF_WORKER_TEXT
  // Fallback for builds where the worker was not inlined: fetch it from the
  // host asset route (requires a host half that exposes the route).
  const workerUrl = assetUrl('pdf-worker')
  const response = await fetch(workerUrl, { cache: 'force-cache' })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    report('asset-probe', {
      url: workerUrl,
      resolved: response.url,
      base: typeof document === 'undefined' ? null : document.baseURI,
      status: response.status,
      type: response.headers.get('content-type'),
      body: detail.slice(0, 200),
    })
    throw new Error(`pdf-worker-unavailable: ${response.status} ${detail.slice(0, 160)}`)
  }
  return response.text()
}

async function ensureWorker(pdfjs) {
  if (pdfjs.GlobalWorkerOptions.workerSrc) return
  if (workerObjectUrl === null) {
    const text = await loadWorkerText()
    workerObjectUrl = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }))
  }
  pdfjs.GlobalWorkerOptions.workerSrc = workerObjectUrl
}

async function loadPdfjs() {
  if (pdfjsPromise === null) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist/build/pdf.min.mjs')
      await ensureWorker(pdfjs)
      return pdfjs
    })()
  }
  try {
    return await pdfjsPromise
  } catch (error) {
    pdfjsPromise = null
    throw error
  }
}

export async function destinationToPage(doc, destination) {
  if (destination === null || destination === undefined) return null
  if (typeof destination === 'string') {
    // Named destinations are resolved asynchronously by pdf.js; treating the
    // promise as an array made every named outline entry unclickable.
    const resolved = await doc.getDestination(destination)
    if (resolved === null || resolved === undefined) return null
    return resolved
  }
  return destination
}

export async function pageIndexOfDestination(doc, destination) {
  try {
    const resolved = await destinationToPage(doc, destination)
    if (resolved === null || resolved === undefined) return null
    // A bare number is an explicit zero-based page index.
    if (typeof resolved === 'number') return resolved + 1
    if (resolved.length === 0) return null
    const reference = resolved[0]
    if (typeof reference === 'number') return reference + 1
    const index = await doc.getPageIndex(reference)
    return index + 1
  } catch {
    return null
  }
}

function flattenOutline(items, level, output, doc) {
  return (async () => {
    for (const item of items) {
      const page = item.dest === undefined ? null : await pageIndexOfDestination(doc, item.dest)
      const externalUrl = typeof item.url === 'string' ? item.url : null
      // A title whose destination cannot be resolved (damaged or unsupported
      // link) is not clickable in a normal viewer; keep walking its children.
      const label = String(item.title ?? '').trim()
      // Keep entries whose destination could not be resolved: the outline
      // still shows the document structure and they render as non-clickable.
      if (label.length > 0) {
        output.push({ label, level, page, externalUrl })
      }
      if (Array.isArray(item.items) && item.items.length > 0) await flattenOutline(item.items, level + 1, output, doc)
    }
  })()
}

export async function openPdf({ name, bytes, path, signal }) {
  const pdfjs = await loadPdfjs()
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    // Local-first: never fetch cmaps/standard fonts from a remote server.
    useWorkerFetch: false,
    // Keep the shared memory cost bounded for large documents.
    disableAutoFetch: true,
    disableStream: true,
  })
  const doc = await loadingTask.promise
  const numPages = doc.numPages
  const outline = []
  try {
    const rawOutline = await doc.getOutline()
    if (Array.isArray(rawOutline)) await flattenOutline(rawOutline, 0, outline, doc)
  } catch {
    // A malformed outline must not prevent reading the document.
  }
  let title = name.replace(/\.[^.]+$/, '')
  let author = ''
  try {
    const metadata = await doc.getMetadata()
    const info = metadata?.info ?? {}
    if (typeof info.Title === 'string' && info.Title.trim().length > 0) title = info.Title.trim()
    if (typeof info.Author === 'string') author = info.Author.trim()
  } catch {
    // Metadata is optional.
  }
  const pageTextCache = new Map()
  let destroyed = false
  return {
    kind: 'pdf',
    format: 'pdf',
    path,
    title,
    author,
    numPages,
    pdfjs,
    doc,
    outline,
    capability: {
      outline: outline.length > 0,
      search: true,
      textSelection: true,
      pageNavigation: true,
      zoom: true,
    },
    async pageText(pageNumber) {
      const cached = pageTextCache.get(pageNumber)
      if (cached !== undefined) return cached
      if (destroyed) throw new Error('disposed: the PDF document has been closed')
      const page = await doc.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      pageTextCache.set(pageNumber, text)
      return text
    },
    async search(query, { signal: requestSignal, limit = 200, onProgress } = {}) {
      const needle = String(query).toLowerCase()
      const results = []
      if (needle.length === 0) return results
      for (let pageNumber = 1; pageNumber <= numPages; pageNumber += 1) {
        if (requestSignal?.aborted) throw new DOMException('aborted', 'AbortError')
        const text = await this.pageText(pageNumber)
        const haystack = text.toLowerCase()
        let offset = haystack.indexOf(needle)
        while (offset !== -1 && results.length < limit) {
          results.push({
            page: pageNumber,
            index: results.length,
            excerpt: text.slice(Math.max(0, offset - 40), Math.min(text.length, offset + needle.length + 40)),
          })
          offset = haystack.indexOf(needle, offset + needle.length)
        }
        onProgress?.(pageNumber, numPages)
        if (results.length >= limit) break
      }
      return results
    },
    dispose() {
      if (destroyed) return
      destroyed = true
      pageTextCache.clear()
      doc.destroy().catch(() => {})
    },
  }
}

/**
 * Render one page into a canvas. Kept here so the view stays declarative and
 * every PDF.js interaction happens through this adapter.
 */
export async function renderPdfPage(model, pageNumber, canvas, { scale = 1, rotation = 0 } = {}) {
  const page = await model.doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale, rotation })
  const context = canvas.getContext('2d', { alpha: false })
  if (context === null) throw new Error('canvas-unavailable')
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.floor(viewport.width * ratio)
  canvas.height = Math.floor(viewport.height * ratio)
  canvas.style.width = `${Math.floor(viewport.width)}px`
  canvas.style.height = `${Math.floor(viewport.height)}px`
  const renderTask = page.render({
    canvasContext: context,
    viewport,
    transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
  })
  await renderTask.promise
  return viewport
}

/** Extract per-item text boxes for a simple, selectable text layer. */
export async function collectPdfTextItems(model, pageNumber, viewport) {
  const page = await model.doc.getPage(pageNumber)
  const content = await page.getTextContent()
  const items = []
  for (const item of content.items) {
    if (!('str' in item) || item.str.length === 0) continue
    const transform = item.transform
    const x = transform[4] * viewport.scale
    const y = viewport.height - transform[5] * viewport.scale
    const height = item.height * viewport.scale
    if (height <= 0.5) continue
    items.push({
      text: item.str,
      left: x,
      top: y - height,
      width: Math.max(item.width * viewport.scale, 1),
      height,
    })
  }
  return items
}
