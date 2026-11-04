import assert from 'node:assert/strict'
import test from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { writeFileSync, unlinkSync } from 'node:fs'

import { JSDOM } from 'jsdom'
import esbuild from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = join(here, '.tmp-dom-flow-jump.cjs')

const ENTRY = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { FlowView } from '../src/client/ui/FlowView.jsx'

export function mount(container) {
  const root = createRoot(container)
  return {
    render(props) {
      root.render(React.createElement(FlowView, props))
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

/** A long document: the jump target is outside the initially rendered slice. */
function longModel(chapters = 40, blocks = 3) {
  return {
    kind: 'flow',
    format: 'epub',
    title: 'long fixture',
    path: 'C:/docs/long.epub',
    chapters: Array.from({ length: chapters }, (_, chapter) => ({
      id: `chapter-${chapter}`,
      title: `Chapter ${chapter}`,
      blocks: Array.from({ length: blocks }, (_, block) => ({
        type: 'paragraph',
        id: `p-${chapter}-${block}`,
        runs: [{ text: `chapter ${chapter} block ${block}` }],
      })),
    })),
    outline: [],
    searchIndex: [],
    notes: [],
    assets: { dispose() {} },
    dispose() {},
  }
}

function tabAt(path, chapter, block) {
  return { id: 'tab-jump', path, status: 'ready', location: { chapter, block } }
}

test('FlowView jumps to chapters outside the rendered window', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  })
  const { window } = dom
  const scrolled = []
  window.Element.prototype.scrollIntoView = function scrollIntoView() {
    const chapterNode = this.closest('[data-chapter]')
    scrolled.push({
      chapter: chapterNode === null ? null : chapterNode.getAttribute('data-chapter'),
      block: this.getAttribute('data-block'),
    })
  }
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
    stdin: { contents: ENTRY, resolveDir: here, sourcefile: 'dom-flow-jump-entry.jsx', loader: 'jsx' },
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
  const prefs = { fontSize: 100, lineHeight: 1.75, flowWidth: 760 }
  const model = longModel()

  try {
    // The document opens at the top, so the first render must not scroll.
    scrolled.length = 0
    view.render({ model, tab: tabAt('C:/docs/long.epub', 0, 0), t, jump: null, prefs })
    await sleep(150)
    assert.deepEqual(scrolled, [], 'opening at the top must not scroll')

    // 1. Outline click far ahead: chapter 25 is not in the first rendered slice.
    scrolled.length = 0
    view.render({
      model,
      tab: tabAt('C:/docs/long.epub', 0, 0),
      t,
      jump: { seq: 1, chapter: 25, block: 0 },
      prefs,
    })
    await sleep(400)
    assert.ok(
      scrolled.some((entry) => entry.chapter === '25'),
      `expected a jump to chapter 25, got ${JSON.stringify(scrolled)}`,
    )

    // 2. Jump back before the rendered window: chapter 3.
    scrolled.length = 0
    view.render({
      model,
      tab: tabAt('C:/docs/long.epub', 0, 0),
      t,
      jump: { seq: 2, chapter: 3, block: 1 },
      prefs,
    })
    await sleep(400)
    assert.ok(
      scrolled.some((entry) => entry.chapter === '3' && entry.block === '1'),
      `expected a jump to chapter 3 block 1, got ${JSON.stringify(scrolled)}`,
    )

    // 3. Anchor jump: the outline entry carries an element id inside a
    //    chapter that must be brought into the window first.
    scrolled.length = 0
    view.render({
      model,
      tab: tabAt('C:/docs/long.epub', 0, 0),
      t,
      jump: { seq: 3, chapter: 32, block: 2, anchor: 'p-32-2' },
      prefs,
    })
    await sleep(400)
    assert.ok(
      scrolled.some((entry) => entry.chapter === '32' && entry.block === '2'),
      `expected the anchor p-32-2 to be scrolled into view, got ${JSON.stringify(scrolled)}`,
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
