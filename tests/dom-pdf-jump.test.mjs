import assert from 'node:assert/strict'
import test from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { writeFileSync, unlinkSync } from 'node:fs'

import { JSDOM } from 'jsdom'
import esbuild from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = join(here, '.tmp-dom-pdf-jump.cjs')

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

function pdfModel(numPages = 12) {
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
    path: 'C:/docs/long.pdf',
    title: 'long pdf',
    numPages,
    doc: {
      getPage: async () => page,
      getDestination: async () => null,
      getPageIndex: async () => 0,
      destroy: async () => {},
    },
  }
}

test('PdfView jumps to any page from the outline', async () => {
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
  delete globalThis.IntersectionObserver

  const result = esbuild.buildSync({
    stdin: { contents: ENTRY, resolveDir: here, sourcefile: 'dom-pdf-jump-entry.jsx', loader: 'jsx' },
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
  const model = pdfModel(12)
  const tab = { id: 'pdf-tab', path: 'C:/docs/long.pdf', status: 'ready', location: { page: 1, scale: 0, rotation: 0 } }

  try {
    view.render({ model, tab, t, jump: null })
    await sleep(200)
    scrolled.length = 0
    view.render({ model, tab, t, jump: { seq: 1, page: 9 } })
    await sleep(400)
    assert.ok(
      scrolled.some((page) => page === 9),
      `expected a jump to page 9, got ${JSON.stringify(scrolled)}`,
    )

    scrolled.length = 0
    view.render({ model, tab, t, jump: { seq: 2, page: 2 } })
    await sleep(400)
    assert.ok(
      scrolled.some((page) => page === 2),
      `expected a jump back to page 2, got ${JSON.stringify(scrolled)}`,
    )
  } finally {
    view.unmount()
    dom.window.close()
    try {
      unlinkSync(bundlePath)
    } catch {
      // The temporary bundle is best-effort cleanup.
    }
  }
})
