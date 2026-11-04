/**
 * Outline trust heuristics shared by the PDF adapter and the outline view.
 *
 * Some PDFs ship an outline whose destinations are degenerate: dozens of
 * chapter entries point at the same front-matter page. Jumping there cannot
 * reach the chapter, so those entries are marked `unreliable` and the view
 * disables them instead of pretending to navigate.
 */

const MIN_ENTRIES = 8
const MIN_DUPLICATES = 4
const DUPLICATE_RATIO = 0.1

export function markUnreliableOutline(entries) {
  if (!Array.isArray(entries) || entries.length < MIN_ENTRIES) return entries
  const counts = new Map()
  for (const entry of entries) {
    if (typeof entry?.page !== 'number') continue
    counts.set(entry.page, (counts.get(entry.page) ?? 0) + 1)
  }
  if (counts.size === 0) return entries
  const threshold = Math.max(MIN_DUPLICATES, Math.ceil(entries.length * DUPLICATE_RATIO))
  return entries.map((entry) => {
    if (typeof entry?.page !== 'number') return entry
    if (entry.externalUrl) return entry
    if ((counts.get(entry.page) ?? 0) < threshold) return entry
    return { ...entry, unreliable: true }
  })
}
