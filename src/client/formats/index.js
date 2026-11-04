/**
 * Format detection and the per-format adapter dispatch.
 *
 * Every adapter returns a model that follows one of two shapes:
 *  - flow model (Markdown, DOCX, EPUB, MOBI): chapters of neutral blocks
 *  - PDF model: page-based, rendered by the PDF view
 * This keeps UI code free of extension-name branching and lets each format
 * declare the capabilities it can actually provide.
 */

import { openMarkdown } from './markdown.js'
import { openPdf } from './pdf.js'
import { openDocx } from './docx.js'
import { openEpub } from './epub.js'
import { openMobi } from './mobi.js'

const KIND_BY_EXTENSION = {
  md: 'md',
  markdown: 'md',
  mdown: 'md',
  mkd: 'md',
  pdf: 'pdf',
  docx: 'docx',
  epub: 'epub',
  mobi: 'mobi',
  azw: 'mobi',
  azw3: 'mobi',
  kf8: 'mobi',
  prc: 'mobi',
}

/** Formats the immersive reader can open. */
export const READABLE_EXTENSIONS = Object.keys(KIND_BY_EXTENSION)

export const FORMAT_LABELS = {
  md: 'Markdown',
  pdf: 'PDF',
  docx: 'Word',
  epub: 'EPUB',
  mobi: 'MOBI',
}

export const FORMAT_CAPABILITIES = {
  md: { outline: true, search: true, textSelection: true, pageNavigation: false, zoom: false, fontSize: true },
  pdf: { outline: true, search: true, textSelection: true, pageNavigation: true, zoom: true, fontSize: false },
  docx: { outline: true, search: true, textSelection: true, pageNavigation: false, zoom: false, fontSize: true },
  epub: { outline: true, search: true, textSelection: true, pageNavigation: false, zoom: false, fontSize: true },
  mobi: { outline: true, search: true, textSelection: true, pageNavigation: false, zoom: false, fontSize: true },
}

export function extensionOf(pathOrName) {
  const value = String(pathOrName ?? '')
  const index = value.lastIndexOf('.')
  return index === -1 ? '' : value.slice(index + 1).toLowerCase()
}

export function detectFormat(pathOrName) {
  return KIND_BY_EXTENSION[extensionOf(pathOrName)] ?? null
}

export function isReadable(pathOrName) {
  return detectFormat(pathOrName) !== null
}

/**
 * @param {{ path: string, name: string, bytes: Uint8Array, signal?: AbortSignal }} input
 */
export async function openDocument({ path, name, bytes, signal }) {
  const kind = detectFormat(name ?? path)
  const options = { path, name, bytes, signal }
  switch (kind) {
    case 'md':
      return openMarkdown(options)
    case 'pdf':
      return openPdf(options)
    case 'docx':
      return openDocx(options)
    case 'epub':
      return openEpub(options)
    case 'mobi':
      return openMobi(options)
    default:
      throw new Error(`unsupported-format: ${extensionOf(name ?? path) || 'unknown'}`)
  }
}
