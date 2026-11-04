import assert from 'node:assert/strict'
import test from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { writeFileSync, unlinkSync } from 'node:fs'

import { JSDOM } from 'jsdom'
import esbuild from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const bundlePath = join(here, '.tmp-dom-flow.cjs')

const ENTRY = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { FlowView } from '../src/client/ui/FlowView.jsx'

export function mount(container) {
  const root = createRoot(container)
  let current = null
  return {
    render(props) {
      current = props
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

function flowModel(chapters = 5, blocks = 3) {
  return {
    kind: 'flow',
    format: 'md',
    title: 'fixture',
    path: 'C:/docs/fixture.md',
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

function tab(id, chapter, block) {
  return { id, path: 'C:/docs/fixture.md', status: 'ready', location: { chapter, block }, model: flowModel() }
}

test('FlowView restores the saved chapter and block on mount', async () => {
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
    stdin: { contents: ENTRY, resolveDir: here, sourcefile: 'dom-flow-entry.jsx', loader: 'jsx' },
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
  const first = mount(host)
  const t = (key) => key
  const prefs = { fontSize: 100, lineHeight: 1.75, flowWidth: 760 }

  try {
    // 1. A doc reopened at chapter 2 / block 1 must scroll that block into view.
    first.render({ model: flowModel(), tab: tab('tab-a', 2, 1), t, jump: null, prefs })
    await sleep(150)
    assert.ok(
      scrolled.some((entry) => entry.chapter === '2' && entry.block === '1'),
      `expected a scroll to chapter 2 block 1, got ${JSON.stringify(scrolled)}`,
    )

    // 2. Updating the tab object while the same view stays mounted must not
    //    scroll again (silent restore runs once per tab+document).
    scrolled.length = 0
    first.render({ model: flowModel(), tab: tab('tab-a', 4, 2), t, jump: null, prefs })
    await sleep(150)
    assert.deepEqual(scrolled, [], 'silent restore must not run twice for the same tab')

    // 3. Switching to another tab restores that tab's own position.
    scrolled.length = 0
    first.render({ model: flowModel(), tab: tab('tab-b', 3, 2), t, jump: null, prefs })
    await sleep(150)
    assert.ok(
      scrolled.some((entry) => entry.chapter === '3'),
      `expected the second tab to restore chapter 3, got ${JSON.stringify(scrolled)}`,
    )

    // 4. Chapter 0 block 0 is the natural top: no scroll needed.
    scrolled.length = 0
    const secondHost = window.document.createElement('div')
    window.document.body.appendChild(secondHost)
    const second = mount(secondHost)
    second.render({ model: flowModel(), tab: tab('tab-c', 0, 0), t, jump: null, prefs })
    await sleep(150)
    assert.deepEqual(scrolled, [], 'a fresh document at the top must not scroll')
    second.unmount()
  } finally {
    first.unmount()
    dom.window.close()
    try {
      unlinkSync(bundlePath)
    } catch {
      // The temporary bundle is best-effort cleanup.
    }
  }
})
