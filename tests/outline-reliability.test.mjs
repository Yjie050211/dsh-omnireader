import assert from 'node:assert/strict'
import test from 'node:test'

import { markUnreliableOutline } from '../src/client/formats/outline.js'

test('short outlines are left untouched', () => {
  const entries = [
    { label: 'A', page: 1 },
    { label: 'B', page: 1 },
    { label: 'C', page: 2 },
  ]
  assert.deepEqual(markUnreliableOutline(entries), entries)
})

test('entries sharing one destination page are marked unreliable', () => {
  const entries = []
  for (let index = 0; index < 20; index += 1) entries.push({ label: `c${index}`, page: index < 12 ? 2 : index + 10 })
  const marked = markUnreliableOutline(entries)
  assert.equal(marked.filter((entry) => entry.unreliable === true).length, 12)
  for (const entry of marked.slice(12)) assert.equal(entry.unreliable, undefined)
  // The original array is not mutated.
  assert.equal(entries[0].unreliable, undefined)
})

test('external links and page-less entries are never flagged', () => {
  const entries = [
    { label: 'web', page: null, externalUrl: 'https://example.com/' },
    { label: 'break', page: 2 },
    { label: 'a', page: 2 },
    { label: 'b', page: 2 },
    { label: 'c', page: 2 },
    { label: 'd', page: 2 },
    { label: 'e', page: 2 },
    { label: 'f', page: 2 },
    { label: 'g', page: 2 },
  ]
  const marked = markUnreliableOutline(entries)
  assert.equal(marked[0].unreliable, undefined)
  assert.equal(marked[1].unreliable, true)
})

test('a realistic broken outline only flags the degenerate page', () => {
  const entries = []
  for (let index = 0; index < 152; index += 1) {
    entries.push({ label: `t${index}`, page: index < 117 ? 2 : index })
  }
  const marked = markUnreliableOutline(entries)
  assert.equal(marked.filter((entry) => entry.unreliable === true).length, 117)
  assert.equal(marked[117].unreliable, undefined)
  assert.equal(marked[151].unreliable, undefined)
})
