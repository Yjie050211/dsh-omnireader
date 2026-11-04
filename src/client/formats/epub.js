/**
 * EPUB 2 / EPUB 3 reader (non-DRM).
 *
 * Pipeline: ZIP → META-INF/container.xml → OPF package (metadata, manifest,
 * spine, guide) → optional navigation document (EPUB 3 `nav`) or NCX (EPUB 2)
 * → one sanitized block flow per spine item.
 *
 * Embedded resources are materialized as object URLs from inside the archive;
 * `javascript:` links, remote resources and scripts are dropped by the block
 * converter, so a hostile EPUB can only ever produce inert text and images.
 */

import { ZipArchive } from './zip.js'
import { attr, decodeText, descendants, localName, parseHtmlDocument, parseXmlDocument, textOf } from './dom.js'
import { createFlowModel, htmlToBlocks, makeChapter } from './flow.js'

const MAX_CHAPTERS = 600
const MAX_ARCHIVE_ENTRIES = 5000

const MIME_BY_EXTENSION = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
}

function mimeForPath(path) {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXTENSION[extension]
}

/** Resolve a relative archive path against a directory, rejecting escapes. */
export function resolveArchivePath(baseDirectory, href) {
  const cleaned = String(href).split('#')[0].split('?')[0]
  let decoded
  try {
    decoded = decodeURIComponent(cleaned)
  } catch {
    decoded = cleaned
  }
  if (decoded.startsWith('/')) return decoded.slice(1)
  const segments = `${baseDirectory}/${decoded}`.split('/')
  const result = []
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.') continue
    if (segment === '..') {
      if (result.length === 0) return null
      result.pop()
      continue
    }
    result.push(segment)
  }
  return result.join('/')
}

function directoryOf(path) {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '' : path.slice(0, index)
}

function createAssetStore() {
  const urls = new Map()
  return {
    async url(archive, entryPath, signal) {
      const cached = urls.get(entryPath)
      if (cached !== undefined) return cached
      const bytes = await archive.read(entryPath)
      if (bytes === null) return null
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      const mime = mimeForPath(entryPath) ?? 'application/octet-stream'
      // SVG inside a document is treated as an image, never as markup.
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
      urls.set(entryPath, url)
      return url
    },
    dispose() {
      for (const url of urls.values()) URL.revokeObjectURL(url)
      urls.clear()
    },
  }
}

function readMetadata(opf) {
  const metadata = descendants(opf, 'metadata')[0] ?? opf
  const pick = (tag) => {
    const elements = descendants(metadata, tag)
    if (elements.length === 0) return ''
    return textOf(elements[0]).replace(/\s+/g, ' ').trim()
  }
  return {
    title: pick('title'),
    author: pick('creator'),
    language: pick('language'),
    publisher: pick('publisher'),
  }
}

function readManifest(opf) {
  const manifestElement = descendants(opf, 'manifest')[0]
  const items = new Map()
  if (manifestElement === undefined) return items
  for (const item of manifestElement.children) {
    if (localName(item) !== 'item') continue
    const id = attr(item, 'id')
    const href = attr(item, 'href')
    if (id === null || href === null) continue
    items.set(id, {
      id,
      href: href.split('#')[0],
      mediaType: (attr(item, 'media-type') ?? '').toLowerCase(),
      properties: (attr(item, 'properties') ?? '').split(/\s+/).filter((value) => value.length > 0),
    })
  }
  return items
}

function readSpine(opf, manifest) {
  const spineElement = descendants(opf, 'spine')[0]
  if (spineElement === undefined) return { items: [], tocId: null }
  const tocId = attr(spineElement, 'toc')
  const items = []
  for (const itemref of spineElement.children) {
    if (localName(itemref) !== 'itemref') continue
    const idref = attr(itemref, 'idref')
    const item = idref === null ? undefined : manifest.get(idref)
    if (item === undefined) continue
    if (!/(xhtml|html|xml)/.test(item.mediaType)) continue
    items.push({ idref, href: item.href, linear: attr(itemref, 'linear') !== 'no' })
  }
  return { items, tocId }
}

function flattenNavList(listElement, basePath, level, output) {
  for (const child of listElement.children) {
    if (localName(child) !== 'li') continue
    const anchor = descendantAnchor(child)
    const label = anchor === null ? '' : textOf(anchor).replace(/\s+/g, ' ').trim()
    if (label.length > 0) {
      const href = anchor === null ? null : attr(anchor, 'href')
      output.push({
        label,
        level,
        href: href === null ? null : resolveArchivePath(basePath, href),
        anchor: href !== null && href.includes('#') ? href.split('#').slice(1).join('#') : null,
      })
    }
    for (const nested of child.children) {
      if (localName(nested) === 'ol' || localName(nested) === 'ul') {
        flattenNavList(nested, basePath, level + 1, output)
      }
    }
  }
}

function descendantAnchor(node) {
  for (const child of node.children) {
    if (localName(child) === 'a') return child
  }
  return null
}

function readNavToc(navText, navPath, archive) {
  void archive
  const document = parseHtmlDocument(navText)
  const navs = [...document.getElementsByTagName('nav')]
  const tocNav =
    navs.find((nav) => {
      const type = nav.getAttribute('epub:type') ?? nav.getAttribute('type') ?? ''
      return type.split(/\s+/).includes('toc')
    }) ?? navs[0]
  if (tocNav === undefined) return []
  const basePath = directoryOf(navPath)
  const output = []
  const firstList = [...tocNav.children].find((child) => localName(child) === 'ol' || localName(child) === 'ul')
  if (firstList !== undefined) flattenNavList(firstList, basePath, 0, output)
  return output
}

function readNcxToc(ncxText, ncxPath) {
  const document = parseXmlDocument(ncxText)
  if (document === null) return []
  const navMap = descendants(document, 'navmap')[0]
  if (navMap === undefined) return []
  const basePath = directoryOf(ncxPath)
  const output = []
  const visit = (node, level) => {
    for (const child of node.children) {
      if (localName(child) !== 'navpoint') continue
      const labelElement = descendants(child, 'text')[0]
      const contentElement = descendants(child, 'content')[0]
      const label = labelElement === undefined ? '' : textOf(labelElement).replace(/\s+/g, ' ').trim()
      const src = contentElement === undefined ? null : attr(contentElement, 'src')
      if (label.length > 0) {
        output.push({
          label,
          level,
          href: src === null ? null : resolveArchivePath(basePath, src),
          anchor: src !== null && src.includes('#') ? src.split('#').slice(1).join('#') : null,
        })
      }
      visit(child, level + 1)
    }
  }
  visit(navMap, 0)
  return output
}

export async function openEpub({ name, bytes, path, signal }) {
  const archive = await ZipArchive.open(bytes)
  if (archive.names.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error(`archive-too-large: ${archive.names.length} ZIP entries`)
  }
  const containerBytes = await archive.read('META-INF/container.xml')
  if (containerBytes === null) throw new Error('not-an-epub: META-INF/container.xml is missing')
  const container = parseXmlDocument(decodeText(containerBytes))
  if (container === null) throw new Error('corrupt-epub: container.xml is not valid XML')
  const rootfiles = descendants(container, 'rootfile')
  if (rootfiles.length === 0) throw new Error('corrupt-epub: no rootfile declared')
  const opfPath = (attr(rootfiles[0], 'full-path') ?? '').replace(/\\/g, '/')
  const opfBytes = await archive.read(opfPath)
  if (opfBytes === null) throw new Error(`corrupt-epub: package document ${opfPath} is missing`)
  const opf = parseXmlDocument(decodeText(opfBytes))
  if (opf === null) throw new Error('corrupt-epub: package document is not valid XML')

  const metadata = readMetadata(opf)
  const manifest = readManifest(opf)
  const spine = readSpine(opf, manifest)
  if (spine.items.length === 0) throw new Error('corrupt-epub: the spine is empty')

  const assetStore = createAssetStore()
  const chapterRecords = []
  // The full spine path → index map must exist before conversion so that links
  // pointing *forward* to a later chapter still resolve.
  const spinePaths = spine.items.slice(0, MAX_CHAPTERS).map((item) => resolveArchivePath(directoryOf(opfPath), item.href))
  const spinePathToIndex = new Map()
  spinePaths.forEach((chapterPath, index) => {
    if (chapterPath !== null && !spinePathToIndex.has(chapterPath)) spinePathToIndex.set(chapterPath, index)
  })

  try {
    // Package-level alternative rendition hint (documented, not rendered as such).
    const layoutMeta = descendants(opf, 'meta').find((element) => attr(element, 'property') === 'rendition:layout')
    const fixedLayout = layoutMeta !== undefined && textOf(layoutMeta).trim() === 'pre-paginated'

    for (let spineIndex = 0; spineIndex < spinePaths.length; spineIndex += 1) {
      const chapterPath = spinePaths[spineIndex]
      if (chapterPath === null) continue
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      const chapterBytes = await archive.read(chapterPath)
      if (chapterBytes === null) continue
      const chapterBase = directoryOf(chapterPath)
      const document = parseHtmlDocument(decodeText(chapterBytes))
      const deferred = []
      const blocks = htmlToBlocks(document.body ?? document.documentElement, {
        resolveImage(src) {
          const value = String(src)
          if (/^(https?:|data:|blob:|javascript:)/i.test(value)) return null
          if (value.startsWith('#')) return null
          const entry = resolveArchivePath(chapterBase, value)
          if (entry === null || !archive.has(entry)) return null
          if (mimeForPath(entry) === undefined) return null
          const pending = { entry }
          deferred.push(pending)
          return { url: null, alt: null, pending }
        },
        resolveLink(href) {
          const value = String(href)
          if (/^(https?:|mailto:)/i.test(value)) return value
          if (value.startsWith('#')) return { anchor: value.slice(1) }
          const target = resolveArchivePath(chapterBase, value)
          if (target === null) return null
          const anchor = value.includes('#') ? value.split('#').slice(1).join('#') : undefined
          const targetIndex = spinePathToIndex.get(target)
          if (targetIndex !== undefined) return { chapter: targetIndex, anchor }
          return null
        },
      })
      // Resolve the queued images now that the block tree exists; the ZIP read
      // is cached, so this only pays the decompression cost per unique entry.
      for (const block of blocks) {
        if (block.type !== 'image' || block.url !== null || block.pending === undefined) continue
        const entry = block.pending.entry
        delete block.pending
        const url = await assetStore.url(archive, entry, signal)
        if (url === null) {
          block.type = 'paragraph'
          block.runs = [{ text: `[image: ${block.alt ?? entry}]` }]
        } else {
          block.url = url
        }
      }
      const firstHeading = blocks.find((block) => block.type === 'heading')
      const headingTitle =
        firstHeading === undefined ? '' : firstHeading.runs.map((run) => run.text ?? '').join('').trim()
      chapterRecords[spineIndex] = { path: chapterPath, title: headingTitle, blocks, fixedLayout }
    }

    const chapters = []
    const spineToChapter = new Map()
    chapterRecords.forEach((record, spineIndex) => {
      if (record === undefined) return
      spineToChapter.set(spineIndex, chapters.length)
      chapters.push(record)
    })
    if (chapters.length === 0) throw new Error('empty: no readable chapters were found in the EPUB')

    // Navigation: EPUB 3 nav document first, then NCX.
    let toc = []
    const navItem = [...manifest.values()].find((item) => item.properties.includes('nav'))
    if (navItem !== undefined) {
      const navPath = resolveArchivePath(directoryOf(opfPath), navItem.href)
      const navText = navPath === null ? null : await archive.text(navPath)
      if (navText !== null) toc = readNavToc(navText, navPath, archive)
    }
    if (toc.length === 0 && spine.tocId !== null) {
      const ncxItem = manifest.get(spine.tocId)
      if (ncxItem !== undefined) {
        const ncxPath = resolveArchivePath(directoryOf(opfPath), ncxItem.href)
        const ncxText = ncxPath === null ? null : await archive.text(ncxPath)
        if (ncxText !== null) toc = readNcxToc(ncxText, ncxPath)
      }
    }

    // Attach TOC labels to chapters and build the outline from the TOC order.
    const outline = []
    for (const entry of toc) {
      if (entry.href === null) continue
      const spineIndex = spinePathToIndex.get(entry.href)
      const chapterIndex = spineIndex === undefined ? undefined : spineToChapter.get(spineIndex)
      if (chapterIndex === undefined) continue
      if (chapters[chapterIndex].title.length === 0) chapters[chapterIndex].title = entry.label
      outline.push({ chapter: chapterIndex, block: 0, label: entry.label, level: entry.level, anchor: entry.anchor })
    }

    chapters.forEach((chapter, index) => {
      if (chapter.title.length === 0) {
        const heading = chapter.blocks.find((block) => block.type === 'heading')
        chapter.title = heading === undefined ? `Chapter ${index + 1}` : heading.runs.map((run) => run.text ?? '').join('')
      }
    })

    const model = createFlowModel({
      format: 'epub',
      title: metadata.title.length > 0 ? metadata.title : name.replace(/\.[^.]+$/, ''),
      author: metadata.author,
      chapters: chapters.map((chapter, index) => makeChapter(index, chapter.title, chapter.blocks)),
      assets: { dispose: () => assetStore.dispose() },
    })
    // TOC-derived outline beats the heading scan: it is the publisher's order.
    if (outline.length > 0) {
      Object.defineProperty(model, 'outline', { get: () => outline, configurable: true })
    }
    if (chapters.some((chapter) => chapter.fixedLayout)) {
      model.notes.push('fixed-layout: this EPUB declares a fixed layout; it is shown as a reflowed text flow.')
    }
    model.path = path
    return model
  } finally {
    archive.close()
  }
}
