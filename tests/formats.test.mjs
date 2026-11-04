import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FORMAT_CAPABILITIES,
  FORMAT_LABELS,
  READABLE_EXTENSIONS,
  detectFormat,
  extensionOf,
  isReadable,
  openDocument,
} from '../src/client/formats/index.js'
import { openMobi } from '../src/client/formats/mobi.js'

test('detects every supported format from its extension', () => {
  assert.equal(detectFormat('a/b/notes.md'), 'md')
  assert.equal(detectFormat('NOTES.MARKDOWN'), 'md')
  assert.equal(detectFormat('paper.pdf'), 'pdf')
  assert.equal(detectFormat('report.docx'), 'docx')
  assert.equal(detectFormat('book.epub'), 'epub')
  for (const extension of ['mobi', 'azw', 'azw3', 'kf8', 'prc']) {
    assert.equal(detectFormat(`book.${extension}`), 'mobi', extension)
  }
  assert.equal(detectFormat('photo.png'), null)
  assert.equal(detectFormat('README'), null)
  assert.equal(extensionOf('C:\\docs\\book.EPUB'), 'epub')
})

test('declares capabilities per format instead of pretending they are equal', () => {
  assert.equal(isReadable('book.epub'), true)
  assert.equal(isReadable('archive.zip'), false)
  for (const format of ['md', 'pdf', 'docx', 'epub', 'mobi']) {
    assert.ok(READABLE_EXTENSIONS.length > 0)
    assert.ok(FORMAT_LABELS[format], `${format} has a label`)
    const capability = FORMAT_CAPABILITIES[format]
    assert.equal(typeof capability, 'object')
    assert.equal(capability.outline, true, `${format} can produce an outline`)
  }
  assert.equal(FORMAT_CAPABILITIES.pdf.textSelection, true)
  assert.equal(FORMAT_CAPABILITIES.pdf.pageNavigation, true)
  assert.equal(FORMAT_CAPABILITIES.mobi.pageNavigation, false, 'reflowable formats are not page based')
})

test('openDocument rejects files it does not understand', async () => {
  await assert.rejects(
    () => openDocument({ path: 'notes.txt', name: 'notes.txt', bytes: new Uint8Array() }),
    /unsupported-format/,
  )
})

test('MOBI reader states clearly why a non-Kindle file is refused', async () => {
  const bytes = new Uint8Array(4096)
  bytes.set(new TextEncoder().encode('this is not a book'), 0)
  await assert.rejects(
    () => openMobi({ name: 'fake.mobi', path: 'fake.mobi', bytes }),
    /not-a-mobi/,
  )
})
