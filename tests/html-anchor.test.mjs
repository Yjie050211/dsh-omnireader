import assert from 'node:assert/strict'
import test from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { JSDOM } from 'jsdom'
import esbuild from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.DOMParser = dom.window.DOMParser
globalThis.Node = dom.window.Node
globalThis.Element = dom.window.Element

const bundle = esbuild.buildSync({
  stdin: {
    contents: `export { htmlToBlocks } from '../src/client/formats/flow.js'`,
    resolveDir: here,
    sourcefile: 'anchor-entry.js',
    loader: 'js',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  logLevel: 'silent',
})

const tempPath = join(here, '.tmp-flow-anchor.mjs')
const { writeFileSync, unlinkSync } = await import('node:fs')
writeFileSync(tempPath, bundle.outputFiles[0].text)
const { htmlToBlocks } = await import(pathToFileURL(tempPath).href)

test('wrapper anchors survive conversion into the first block', () => {
  try {
    const root = document.createElement('div')
    root.innerHTML = [
      '<section id="chapter-1"><h2>First</h2><p>Alpha</p></section>',
      '<div id="chapter-2"><p>Beta</p></div>',
    ].join('')
    const blocks = htmlToBlocks(root, {
      resolveImage: () => null,
      resolveLink: () => null,
    })
    const ids = blocks.map((block) => block.id ?? null)
    assert.equal(ids[0], 'chapter-1', `expected the section anchor on its first block, got ${JSON.stringify(ids)}`)
    assert.equal(ids[ids.length - 1], 'chapter-2', `expected the div anchor on its first block, got ${JSON.stringify(ids)}`)

    // A heading keeps its own id instead of inheriting the wrapper's.
    const headingRoot = document.createElement('div')
    headingRoot.innerHTML = '<section id="outer"><h2 id="inner">Title</h2></section>'
    const headingBlocks = htmlToBlocks(headingRoot, {
      resolveImage: () => null,
      resolveLink: () => null,
    })
    assert.equal(headingBlocks[0].id, 'inner')
  } finally {
    try {
      unlinkSync(tempPath)
    } catch {
      // best effort cleanup
    }
    dom.window.close()
  }
})
