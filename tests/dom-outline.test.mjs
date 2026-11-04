import assert from 'node:assert/strict'
import test from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { writeFileSync, unlinkSync } from 'node:fs'

import { JSDOM } from 'jsdom'
import esbuild from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = join(here, '.tmp-dom-outline.cjs')

const ENTRY = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Outline } from '../src/client/ui/Outline.jsx'

export function mount(container) {
  const root = createRoot(container)
  return {
    render(props) {
      root.render(React.createElement(Outline, props))
    },
    unmount() {
      root.unmount()
    },
  }
}
`

const flowModel = {
  kind: 'flow',
  format: 'epub',
  path: 'C:/docs/book.epub',
  outline: [
    { label: 'Chapter 1', level: 1, chapter: 0, block: 0 },
    { label: 'Chapter 25', level: 1, chapter: 25, block: 3 },
  ],
  chapters: [],
}

const pdfModelWithDeadEntry = {
  kind: 'pdf',
  format: 'pdf',
  path: 'C:/docs/scan.pdf',
  numPages: 20,
  outline: [
    { label: 'Cover', level: 1, page: 1, externalUrl: null },
    { label: 'Broken destination', level: 1, page: null, externalUrl: null },
    { label: 'Unreliable target', level: 1, page: 2, externalUrl: null, unreliable: true },
    { label: 'Web site', level: 1, page: null, externalUrl: 'https://example.com/' },
  ],
}

test('outline entries dispatch exact jump targets and ignore dead ones', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  })
  const { window } = dom
  window.Element.prototype.scrollIntoView = function scrollIntoView() {}
  window.fetch = async () => ({ ok: true, json: async () => ({ ok: true }) })

  globalThis.window = window
  globalThis.document = window.document
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
  globalThis.HTMLElement = window.HTMLElement
  globalThis.Element = window.Element
  globalThis.Node = window.Node
  globalThis.getComputedStyle = window.getComputedStyle.bind(window)
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window)
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window)

  const result = esbuild.buildSync({
    stdin: { contents: ENTRY, resolveDir: here, sourcefile: 'dom-outline-entry.jsx', loader: 'jsx' },
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
  const jumps = []
  const opened = []

  const click = (index) => {
    const buttons = host.querySelectorAll('.omr-outline-item')
    buttons[index].click()
  }

  try {
    // Flow document: outline entries must carry the chapter and block.
    view.render({
      model: flowModel,
      tab: { id: 'tab', path: flowModel.path, location: { chapter: 0, block: 0 } },
      location: { chapter: 0, block: 0 },
      t,
      onJump: (target) => jumps.push(target),
      onOpenExternal: (url) => opened.push(url),
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    click(1)
    assert.deepEqual(jumps, [{ chapter: 25, block: 3, anchor: undefined }])

    // PDF document with a dead and an external entry.
    jumps.length = 0
    view.render({
      model: pdfModelWithDeadEntry,
      tab: { id: 'tab-pdf', path: pdfModelWithDeadEntry.path, location: { page: 1 } },
      location: { page: 1 },
      t,
      onJump: (target) => jumps.push(target),
      onOpenExternal: (url) => opened.push(url),
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    click(0)
    assert.deepEqual(jumps, [{ page: 1 }])
    jumps.length = 0
    click(1)
    assert.deepEqual(jumps, [], 'an entry without a destination must not jump anywhere')
    click(2)
    assert.deepEqual(jumps, [], 'an entry whose outline data is unreliable must not jump anywhere')
    assert.ok(host.querySelector('.omr-outline-note'), 'an unreliable outline shows a notice')
    click(3)
    assert.deepEqual(opened, ['https://example.com/'])
  } finally {
    view.unmount()
    dom.window.close()
    try {
      unlinkSync(bundlePath)
    } catch {
      // best effort cleanup
    }
  }
})
