/**
 * DOCX reader (WordprocessingML).
 *
 * Only the documented WordprocessingML parts are read (`word/document.xml`,
 * relationships, styles, media). Everything is converted into the neutral
 * block flow by hand — no HTML is produced, so no unsanitized markup can reach
 * the DOM. This is the "immersive reflow" reading mode: the original paginated
 * layout of a DOCX is not reproduced (a converted-PDF preview remains available
 * in the built-in document preview).
 */

import { ZipArchive } from './zip.js'
import { attr, attrAny, decodeText, descendants, localName, parseXmlDocument, textOf } from './dom.js'
import { createFlowModel, makeChapter } from './flow.js'

const MAX_ENTRIES = 4000
const MAX_PARAGRAPHS = 60_000

const IMAGE_MIME_BY_EXTENSION = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  emf: 'image/emf',
  wmf: 'image/wmf',
  tiff: 'image/tiff',
  tif: 'image/tiff',
}

function mimeForPath(path) {
  return IMAGE_MIME_BY_EXTENSION[path.split('.').pop()?.toLowerCase() ?? ''] ?? null
}

/** Normalize an OPC part name and reject traversal / absolute escape. */
function resolvePartPath(baseDirectory, target) {
  const cleaned = String(target).replace(/\\/g, '/').split('#')[0]
  if (/^[a-z]+:/i.test(cleaned)) return null
  const segments = cleaned.startsWith('/') ? cleaned.slice(1).split('/') : `${baseDirectory}/${cleaned}`.split('/')
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

function readRelationships(xmlText, baseDirectory) {
  const relationships = new Map()
  const document = parseXmlDocument(xmlText)
  if (document === null) return relationships
  for (const relationship of descendants(document, 'relationship')) {
    const id = attr(relationship, 'id')
    const target = attr(relationship, 'target')
    if (id === null || target === null) continue
    const external = (attr(relationship, 'targetmode') ?? '').toLowerCase() === 'external'
    relationships.set(id, {
      target,
      external,
      part: external ? null : resolvePartPath(baseDirectory, target),
    })
  }
  return relationships
}

function readStyles(xmlText) {
  const styles = new Map()
  const document = parseXmlDocument(xmlText)
  if (document === null) return styles
  for (const style of descendants(document, 'style')) {
    const styleId = attr(style, 'styleid')
    if (styleId === null) continue
    const nameElement = descendants(style, 'name')[0]
    const name = nameElement === undefined ? '' : (attr(nameElement, 'val') ?? '').trim()
    const basedOn = descendants(style, 'basedon')[0]
    styles.set(styleId, { name, basedOn: basedOn === undefined ? null : attr(basedOn, 'val') })
  }
  return styles
}

function headingLevelOf(styleId, styles) {
  if (styleId === null) return 0
  let current = styleId
  for (let depth = 0; depth < 8 && current !== null; depth += 1) {
    const direct = /^(?:heading|标题)\s*([1-6])$/i.exec(current)
    if (direct !== null) return Number(direct[1])
    const style = styles.get(current)
    if (style !== undefined) {
      const byName = /^(?:heading|标题)\s*([1-6])$/i.exec(style.name)
      if (byName !== null) return Number(byName[1])
      current = style.basedOn
      continue
    }
    current = null
  }
  return 0
}

function isListParagraph(paragraph) {
  const paragraphProperties = descendants(paragraph, 'ppr')[0]
  if (paragraphProperties === undefined) return false
  return descendants(paragraphProperties, 'numpr').length > 0
}

function runText(run) {
  let text = ''
  for (const child of run.children) {
    const name = localName(child)
    if (name === 't') text += textOf(child)
    else if (name === 'tab') text += '\t'
    else if (name === 'br' || name === 'cr') text += '\n'
    else if (name === 'sym') text += ''
  }
  return text
}

function runFormatting(run) {
  const properties = descendants(run, 'rpr')[0]
  if (properties === undefined) return {}
  const has = (name) => descendants(properties, name).length > 0
  const formatting = {}
  if (has('b')) formatting.b = true
  if (has('i')) formatting.i = true
  if (has('strike') || has('dstrike')) formatting.strike = true
  const verticalAlign = descendants(properties, 'vertalign')[0]
  const alignValue = verticalAlign === undefined ? '' : (attr(verticalAlign, 'val') ?? '')
  if (alignValue === 'superscript') formatting.sup = true
  if (alignValue === 'subscript') formatting.sub = true
  const styleElement = descendants(properties, 'rstyle')[0]
  if (styleElement !== undefined && /code|icode/i.test(attr(styleElement, 'val') ?? '')) formatting.code = true
  return formatting
}

function pushRun(runs, text, formatting) {
  if (text.length === 0) return
  runs.push({ text, ...formatting })
}

function imageUrlFor(drawing, relationships, assetStore) {
  const blip = descendants(drawing, 'blip')[0]
  if (blip === undefined) return null
  const embed = attrAny(blip, 'embed')
  if (embed === null) return null
  const relationship = relationships.get(embed)
  if (relationship === undefined || relationship.external || relationship.part === null) return null
  const extent = descendants(drawing, 'extent')[0]
  const width = extent === undefined ? undefined : Math.round(Number(attr(extent, 'cx') ?? 0) / 9525) || undefined
  const height = extent === undefined ? undefined : Math.round(Number(attr(extent, 'cy') ?? 0) / 9525) || undefined
  return { part: relationship.part, width, height }
}

async function convertParagraph(paragraph, context, blocks) {
  const paragraphProperties = descendants(paragraph, 'ppr')[0]
  const styleId =
    paragraphProperties === undefined ? null : (descendants(paragraphProperties, 'pstyle')[0]?.getAttribute('w:val') ?? null)
  const level = headingLevelOf(styleId, context.styles)
  const runs = []
  const images = []
  const collectRun = (run) => {
    const text = runText(run)
    pushRun(runs, text, runFormatting(run))
    for (const drawing of descendants(run, 'drawing')) {
      const image = imageUrlFor(drawing, context.relationships, context.assetStore)
      if (image !== null) images.push(image)
    }
  }
  for (const child of paragraph.children) {
    const name = localName(child)
    if (name === 'r') {
      collectRun(child)
    } else if (name === 'hyperlink') {
      const relationshipId = attrAny(child, 'id')
      const relationship = relationshipId === null ? undefined : context.relationships.get(relationshipId)
      let link
      const anchor = attr(child, 'anchor')
      if (relationship !== undefined && relationship.external) link = relationship.target
      else if (anchor !== null) link = { anchor }
      const before = runs.length
      for (const run of child.children) {
        if (localName(run) === 'r') collectRun(run)
        else if (localName(run) === 'drawing') {
          const image = imageUrlFor(run, context.relationships, context.assetStore)
          if (image !== null) images.push(image)
        }
      }
      if (link !== undefined && link !== null) for (let index = before; index < runs.length; index += 1) runs[index].link = link
    } else if (name === 'drawing') {
      const image = imageUrlFor(child, context.relationships, context.assetStore)
      if (image !== null) images.push(image)
    } else if (name === 'smarttag' || name === 'sdt' || name === 'sdtcontent') {
      for (const run of descendants(child, 'r')) collectRun(run)
    }
  }
  const id = paragraph.getAttribute('w14:paraId') ?? undefined
  if (runs.length > 0 || level > 0) {
    if (level > 0) blocks.push({ type: 'heading', level, runs: runs.length > 0 ? runs : [{ text: '' }], id })
    else if (isListParagraph(paragraph)) blocks.push({ type: 'listItem', runs, id })
    else blocks.push({ type: 'paragraph', runs, id })
  }
  for (const image of images) {
    const url = await context.assetStore.url(image.part)
    if (url !== null) blocks.push({ type: 'image', url, alt: '', width: image.width, height: image.height })
  }
}

function convertTable(table, context, blocks) {
  const rows = []
  for (const row of table.children) {
    if (localName(row) !== 'tr') continue
    const cells = []
    for (const cell of row.children) {
      if (localName(cell) !== 'tc') continue
      const cellBlocks = []
      for (const child of cell.children) {
        if (localName(child) === 'p') {
          const runs = []
          for (const run of descendants(child, 'r')) pushRun(runs, runText(run), runFormatting(run))
          if (runs.length > 0) cellBlocks.push(runs)
        }
      }
      cells.push(cellBlocks.flat())
    }
    if (cells.length > 0) rows.push(cells)
  }
  if (rows.length === 0) return
  blocks.push({ type: 'table', head: rows[0].map((runs) => runs), rows: rows.slice(1) })
}

function finalizeListBlocks(blocks) {
  // Turn consecutive listItem entries into real list blocks.
  const output = []
  let pending = []
  const flush = () => {
    if (pending.length === 0) return
    output.push({ type: 'list', ordered: false, items: pending.map((runs) => ({ runs, level: 0 })) })
    pending = []
  }
  for (const block of blocks) {
    if (block.type === 'listItem') {
      pending.push(block.runs)
      continue
    }
    flush()
    output.push(block)
  }
  flush()
  return output
}

function collectMetadata(coreXmlText) {
  if (coreXmlText === null) return { title: '', author: '' }
  const document = parseXmlDocument(coreXmlText)
  if (document === null) return { title: '', author: '' }
  const pick = (name) => {
    const element = descendants(document, name)[0]
    return element === undefined ? '' : textOf(element).trim()
  }
  return { title: pick('title'), author: pick('creator') }
}

export async function openDocx({ name, bytes, path, signal }) {
  const archive = await ZipArchive.open(bytes)
  if (archive.names.length > MAX_ENTRIES) throw new Error(`archive-too-large: ${archive.names.length} ZIP entries`)
  const documentBytes = await archive.read('word/document.xml')
  if (documentBytes === null) throw new Error('not-a-docx: word/document.xml is missing')
  const document = parseXmlDocument(decodeText(documentBytes))
  if (document === null) throw new Error('corrupt-docx: word/document.xml is not valid XML')
  const body = descendants(document, 'body')[0]
  if (body === undefined) throw new Error('corrupt-docx: the document body is missing')

  const relationshipsXml = await archive.text('word/_rels/document.xml.rels')
  const relationships = relationshipsXml === null ? new Map() : readRelationships(relationshipsXml, 'word')
  const stylesXml = await archive.text('word/styles.xml')
  const styles = stylesXml === null ? new Map() : readStyles(stylesXml)
  const coreXml = await archive.text('docProps/core.xml')
  const metadata = collectMetadata(coreXml)

  const urls = new Map()
  const assetStore = {
    async url(part) {
      const cached = urls.get(part)
      if (cached !== undefined) return cached
      const mime = mimeForPath(part)
      if (mime === null) return null
      const bytes = await archive.read(part)
      if (bytes === null) return null
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
      urls.set(part, url)
      return url
    },
    dispose() {
      for (const url of urls.values()) URL.revokeObjectURL(url)
      urls.clear()
    },
  }

  const context = { relationships, styles, assetStore }
  const flat = []
  let paragraphCount = 0
  try {
    for (const child of body.children) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      const nameOfChild = localName(child)
      if (nameOfChild === 'p') {
        paragraphCount += 1
        if (paragraphCount > MAX_PARAGRAPHS) throw new Error('too-large: the DOCX has too many paragraphs')
        await convertParagraph(child, context, flat)
      } else if (nameOfChild === 'tbl') {
        convertTable(child, context, flat)
      }
    }
  } finally {
    archive.close()
  }

  const blocks = finalizeListBlocks(flat)
  if (blocks.length === 0) throw new Error('empty: the DOCX contains no readable paragraphs')

  // Split at level-1 headings so that the outline doubles as navigation.
  const chapters = []
  let current = { title: metadata.title.length > 0 ? metadata.title : name.replace(/\.[^.]+$/, ''), blocks: [] }
  for (const block of blocks) {
    if (block.type === 'heading' && block.level === 1 && current.blocks.length > 0) {
      chapters.push(current)
      current = { title: block.runs.map((run) => run.text ?? '').join(''), blocks: [block] }
      continue
    }
    current.blocks.push(block)
  }
  chapters.push(current)

  const model = createFlowModel({
    format: 'docx',
    title: metadata.title.length > 0 ? metadata.title : name.replace(/\.[^.]+$/, ''),
    author: metadata.author,
    chapters: chapters.map((chapter, index) => makeChapter(index, chapter.title, chapter.blocks)),
    assets: { dispose: () => assetStore.dispose() },
  })
  model.notes.push(
    'docx: shown as a reflowed reading flow (headings, paragraphs, tables, images, links). The exact paginated layout is available in the built-in document preview, which converts DOCX to PDF.',
  )
  model.path = path
  return model
}
