import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'

import { ZipArchive } from '../src/client/formats/zip.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.join(here, 'fixtures')

/** Build a STORE-only zip archive; enough to exercise the reader. */
function makeZip(entries) {
  const encoder = new TextEncoder()
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const dataBytes = encoder.encode(entry.data)
    const local = new Uint8Array(30 + nameBytes.length + dataBytes.length)
    const view = new DataView(local.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 0, true)
    view.setUint16(8, 0, true) // stored
    view.setUint32(14, 0, true)
    view.setUint32(18, dataBytes.length, true)
    view.setUint32(22, dataBytes.length, true)
    view.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    local.set(dataBytes, 30 + nameBytes.length)
    locals.push(local)

    const central = new Uint8Array(46 + nameBytes.length)
    const cview = new DataView(central.buffer)
    cview.setUint32(0, 0x02014b50, true)
    cview.setUint16(4, 20, true)
    cview.setUint16(6, 20, true)
    cview.setUint16(10, 0, true) // stored
    cview.setUint32(20, dataBytes.length, true)
    cview.setUint32(24, dataBytes.length, true)
    cview.setUint16(28, nameBytes.length, true)
    cview.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    centrals.push(central)
    offset += local.length
  }
  const centralSize = centrals.reduce((total, part) => total + part.length, 0)
  const eocd = new Uint8Array(22)
  const eview = new DataView(eocd.buffer)
  eview.setUint32(0, 0x06054b50, true)
  eview.setUint16(8, entries.length, true)
  eview.setUint16(10, entries.length, true)
  eview.setUint32(12, centralSize, true)
  eview.setUint32(16, offset, true)
  const total = offset + centralSize + eocd.length
  const output = new Uint8Array(total)
  let cursor = 0
  for (const part of [...locals, ...centrals, eocd]) {
    output.set(part, cursor)
    cursor += part.length
  }
  return output
}

test('reads stored entries and text content', async () => {
  const bytes = makeZip([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: '<container><rootfile full-path="OEBPS/content.opf"/></container>' },
  ])
  const archive = await ZipArchive.open(bytes)
  try {
    assert.equal(archive.has('META-INF/container.xml'), true)
    assert.equal(await archive.text('mimetype'), 'application/epub+zip')
    assert.match(await archive.text('META-INF/container.xml'), /content\.opf/)
  } finally {
    archive.close()
  }
})

test('drops entries that would escape the archive root', async () => {
  const bytes = makeZip([
    { name: 'safe.txt', data: 'ok' },
    { name: '../evil.txt', data: 'nope' },
    { name: '/absolute.txt', data: 'nope' },
    { name: 'a/../../evil2.txt', data: 'nope' },
  ])
  const archive = await ZipArchive.open(bytes)
  try {
    assert.equal(archive.has('safe.txt'), true)
    assert.equal(archive.has('../evil.txt'), false)
    assert.equal(archive.has('/absolute.txt'), false)
    assert.equal(archive.has('a/../../evil2.txt'), false)
  } finally {
    archive.close()
  }
})

test('rejects bytes that are not a zip archive', async () => {
  await assert.rejects(() => ZipArchive.open(new TextEncoder().encode('not a zip file')), /zip|end of central directory/i)
})

test('reads the EPUB fixture container and OPF metadata', async () => {
  const bytes = new Uint8Array(readFileSync(path.join(fixtures, 'book.epub')))
  const archive = await ZipArchive.open(bytes)
  try {
    const container = await archive.text('META-INF/container.xml')
    const match = /full-path="([^"]+)"/.exec(container)
    assert.ok(match, 'container.xml must name a rootfile')
    const opf = await archive.text(match[1])
    assert.match(opf, /<dc:title[^>]*>[^<]+<\/dc:title>/)
    assert.match(opf, /<itemref\b/)
  } finally {
    archive.close()
  }
})

test('reads the DOCX fixture main part', async () => {
  const bytes = new Uint8Array(readFileSync(path.join(fixtures, 'report.docx')))
  const archive = await ZipArchive.open(bytes)
  try {
    assert.equal(archive.has('word/document.xml'), true)
    const document = await archive.text('word/document.xml')
    assert.match(document, /<w:body>/)
    assert.match(document, /<w:tbl>/)
    assert.ok(archive.names.some((name) => name.startsWith('word/media/')), 'the fixture embeds an image')
  } finally {
    archive.close()
  }
})
