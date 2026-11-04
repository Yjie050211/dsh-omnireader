import assert from 'node:assert/strict'
import test from 'node:test'

import { restoreLocation } from '../src/client/lib/store.js'

function pdfModel(numPages) {
  return { kind: 'pdf', numPages }
}

function flowModel(chapterCounts) {
  return {
    kind: 'flow',
    chapters: chapterCounts.map((blocks, index) => ({
      id: `chapter-${index}`,
      title: `Chapter ${index}`,
      blocks: Array.from({ length: blocks }, (_, i) => ({ type: 'paragraph', runs: [{ text: `b${i}` }] })),
    })),
  }
}

test('restoreLocation returns null when there is no model', () => {
  assert.equal(restoreLocation(null, { page: 3 }), null)
})

test('restoreLocation clamps PDF pages into range', () => {
  assert.deepEqual(restoreLocation(pdfModel(10), { page: 4, scale: 1.5, rotation: 90 }), {
    page: 4,
    scale: 1.5,
    rotation: 90,
  })
  assert.equal(restoreLocation(pdfModel(10), { page: 99 }).page, 10)
  assert.equal(restoreLocation(pdfModel(10), { page: -2 }).page, 1)
  assert.equal(restoreLocation(pdfModel(0), { page: 5 }).page, 1)
})

test('restoreLocation defaults PDF scale to fit width (0) and rotation to 0', () => {
  assert.deepEqual(restoreLocation(pdfModel(3), { page: 2 }), { page: 2, scale: 0, rotation: 0 })
  assert.deepEqual(restoreLocation(pdfModel(3), { page: 2, scale: 'nope', rotation: null }), {
    page: 2,
    scale: 0,
    rotation: 0,
  })
})

test('restoreLocation clamps flow chapters and blocks into range', () => {
  const model = flowModel([3, 5, 2])
  assert.deepEqual(restoreLocation(model, { chapter: 1, block: 2 }), { chapter: 1, block: 2 })
  assert.deepEqual(restoreLocation(model, { chapter: 99, block: 99 }), { chapter: 2, block: 1 })
  assert.deepEqual(restoreLocation(model, { chapter: -1, block: -1 }), { chapter: 0, block: 0 })
})

test('restoreLocation keeps a stale anchor but never a stale index', () => {
  const model = flowModel([3, 3])
  assert.deepEqual(restoreLocation(model, { chapter: 7, block: 0, anchor: 'section-9' }), {
    chapter: 1,
    block: 0,
    anchor: 'section-9',
  })
})

test('restoreLocation tolerates a flow model without chapters', () => {
  assert.equal(restoreLocation({ kind: 'flow', chapters: [] }, { chapter: 2 }), null)
  assert.equal(restoreLocation({ kind: 'flow' }, { chapter: 2 }), null)
})
