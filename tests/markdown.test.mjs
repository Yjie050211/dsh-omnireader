import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'

import { openMarkdown, parseMarkdownDocument } from '../src/client/formats/markdown.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.join(here, 'fixtures', 'note.md')

function flatten(model) {
  const blocks = []
  for (const chapter of model.chapters) {
    for (const block of chapter.blocks) blocks.push(block)
  }
  return blocks
}

test('parses the Markdown fixture into a chapter/block model', async () => {
  const bytes = new Uint8Array(readFileSync(fixture))
  const model = await openMarkdown({
    name: 'note.md',
    path: fixture,
    bytes,
    resolveImage: (source) => ({ url: `api/omnireader/file?path=${encodeURIComponent(source)}` }),
  })
  assert.equal(model.kind, 'flow')
  assert.equal(model.format, 'md')
  assert.ok(model.title && model.title.length > 0, 'a title is derived from the document')
  assert.ok(model.chapters.length >= 1, 'at least one chapter')
  assert.ok(model.outline.length >= 2, 'headings produce outline entries')

  const blocks = flatten(model)
  const types = new Set(blocks.map((block) => block.type))
  for (const expected of ['heading', 'paragraph', 'code', 'list', 'table', 'quote', 'math']) {
    assert.ok(types.has(expected), `expected a ${expected} block in the fixture`)
  }

  const table = blocks.find((block) => block.type === 'table')
  assert.ok(table.head.length >= 3 && table.rows.length >= 3, 'table keeps header cells and body rows')

  const list = blocks.find((block) => block.type === 'list')
  assert.ok(Array.isArray(list.items) && list.items.length >= 2, 'list items are parsed')
  assert.ok(list.items.some((item) => item.checked === false), 'task list items carry a checked flag')

  const imageRun = blocks
    .flatMap((block) => (Array.isArray(block.runs) ? block.runs : []))
    .find((run) => run.image)
  assert.ok(imageRun, 'the fixture image becomes an inline image run')
  assert.match(imageRun.image.url, /chart\.png/, 'relative image paths are resolved through the supplied resolver')

  const code = blocks.find((block) => block.type === 'code')
  assert.equal(typeof code.text, 'string')
  assert.ok(code.text.length > 0)
  assert.equal(code.lang, 'js')
})

test('frontmatter is stripped from the rendered body', () => {
  const model = parseMarkdownDocument('---\ntitle: Demo\nauthor: Tester\n---\n\n# Real heading\n\nBody text.')
  assert.equal(model.title, 'Demo')
  const text = flatten(model).map((block) => JSON.stringify(block)).join('\n')
  assert.equal(text.includes('author: Tester'), false, 'frontmatter must not leak into the body')
})

test('raw HTML tags are dropped but their text survives', () => {
  const model = parseMarkdownDocument('# Title\n\n<script>alert(1)</script>\n\nVisible <b>bold</b> text.')
  const text = flatten(model)
    .flatMap((block) => (block.runs ? block.runs : []))
    .map((run) => run.text)
    .join('')
  assert.equal(text.includes('<script'), false)
  assert.ok(text.includes('Visible'))
})

test('links to external sites and in-document anchors are distinguished', () => {
  const model = parseMarkdownDocument('[site](https://example.com) and [jump](#annex)')
  const run = flatten(model)
    .flatMap((block) => (block.runs ? block.runs : []))
    .find((candidate) => candidate.link)
  assert.ok(run, 'a link run exists')
  const links = flatten(model)
    .flatMap((block) => (block.runs ? block.runs : []))
    .filter((candidate) => candidate.link)
    .map((candidate) => candidate.link)
  assert.ok(links.some((link) => typeof link === 'string' && link.startsWith('https://')))
  assert.ok(links.some((link) => link && typeof link === 'object' && link.anchor === 'annex'))
})
