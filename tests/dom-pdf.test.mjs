import assert from 'node:assert/strict'
import test from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { writeFileSync, unlinkSync } from 'node:fs'

import { JSDOM } from 'jsdom'
import esbuild from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = join(here, '.tmp-dom-pdf.cjs')

const ENTRY = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { PdfView } from '../src/client/ui/PdfView.jsx'

export function mount(container) {
  const root = createRoot(container)
  return {
    render(props) {
      root.render(React.createElement(PdfView, props))
    },
    unmount() {
      root.unmount()
    },
  }
}
`

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Fake pdf.js document: enough surface for PdfView + renderPdfPage. */
function pdfModel(numPages = 3) {
  const page = {
    getViewport: ({ scale = 1, rotation = 0 } = {}) => ({
      width: 612 * scale,
      height: 792 * scale,
      rotation,
      transform: [scale, 0, 0, -scale, 0, 792 * scale],
    }),
    render: () => ({ promise: Promise.resolve() }),
    getTextContent: async () => ({ items: [] }),
    cleanup: () => {},
  }
  return {
    kind: 'pdf',
    format: 'pdf',
    path: 'C:/docs/fixture.pdf',
    title: 'fixture',
    numPages,
    doc: {
      getPage: async () => page,
      getDestination: async () => null,
      getPageIndex: async () => 0,
      destroy: async () => {},
    },
  }
}

function pdfTab(page, scale = 0) {
  return {
    id: `pdf-${page}-${scale}`,
    path: 'C:/docs/fixture.pdf',
    status: 'ready',
    location: { page, scale, rotation: 0 },
    model: pdfModel(),
  }
}

test('PdfView restores the saved page on mount and ignores a page-1 tab', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  })
  const { window } = dom
  const scrolled = []
  window.Element.prototype.scrollIntoView = function scrollIntoView() {
    const pageNode = this.closest('[data-page]') ?? this.querySelector('[data-page]')
    scrolled.push(pageNode === null ? null : Number(pageNode.getAttribute('data-page')))
  }
  // jsdom has no layout; give the scroll port a height so the restore retry
  // loop can complete on the first frames.
  Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 900 })
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 800 })
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 900 })
  window.fetch = async () => ({ ok: true, json: async () => ({ ok: true }) })
  if (window.HTMLCanvasElement !== undefined) {
    window.HTMLCanvasElement.prototype.getContext = () => null
  }

  globalThis.window = window
  globalThis.document = window.document
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
  globalThis.HTMLElement = window.HTMLElement
  globalThis.Element = window.Element
  globalThis.Node = window.Node
  globalThis.getComputedStyle = window.getComputedStyle.bind(window)
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window)
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window)
  // No IntersectionObserver in jsdom: PdfPage falls back to rendering every
  // page immediately, which is deterministic for this test.
  delete globalThis.IntersectionObserver

  const result = esbuild.buildSync({
    stdin: { contents: ENTRY, resolveDir: here, sourcefile: 'dom-pdf-entry.jsx', loader: 'jsx' },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'silent',
  })
  writeFileSync(bundlePath, result.outputFiles[0].text)
  const module = await import(pathToFileURL(bundlePath).href)
  const { mount } = module.default ?? module

  const host = window.document.getElementById('host')
  const view = mount(host)
  const t = (key) => key

  try {
    view.render({ model: pdfModel(), tab: pdfTab(2), t, jump: null, onLocation: () => {} })
    await sleep(400)
    assert.ok(scrolled.includes(2), `expected a scroll to page 2, got ${JSON.stringify(scrolled)}`)

    // A tab saved on page 1 is already at the top: no scroll needed.
    scrolled.length = 0
    const secondHost = window.document.createElement('div')
    window.document.body.appendChild(secondHost)
    const second = mount(secondHost)
    second.render({ model: pdfModel(), tab: pdfTab(1), t, jump: null, onLocation: () => {} })
    await sleep(250)
    assert.deepEqual(scrolled, [], 'page-1 documents must not scroll on mount')
    second.unmount()
  } finally {
    view.unmount()
    dom.window.close()
    try {
      unlinkSync(bundlePath)
    } catch {
      // Best-effort cleanup of the temporary test bundle.
    }
  }
})
