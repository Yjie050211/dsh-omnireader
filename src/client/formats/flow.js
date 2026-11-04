/**
 * HTML → reflowable document model.
 *
 * EPUB chapters, MOBI/KF8 text and DOCX XML all end up in the same small block
 * model so the viewer has exactly one text renderer. The converter is a strict
 * allow-list sanitizer: unknown elements are flattened, scripts/iframes/SVG and
 * dangerous URL schemes are dropped, and every image goes through a resolver
 * that the format module controls. Nothing from the document is inserted as
 * raw HTML anywhere.
 */

const DROP_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'select',
  'option',
  'textarea',
  'link',
  'meta',
  'base',
  'video',
  'audio',
  'canvas',
  'svg',
  'math',
  'noscript',
  'template',
  'dialog',
  'portal',
  'map',
  'area',
  'track',
  'source',
])

const BLOCK_CONTAINER_TAGS = new Set([
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'aside',
  'figure',
  'figcaption',
  'center',
  'address',
  'details',
  'summary',
  'hgroup',
])

const HEADING_LEVELS = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 }

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'file:'])
const MAX_DEPTH = 80
const MAX_NODES = 200_000

function isSafeUrl(raw) {
  if (typeof raw !== 'string') return false
  const value = raw.trim()
  if (value.length === 0) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    try {
      return SAFE_SCHEMES.has(new URL(value).protocol)
    } catch {
      return false
    }
  }
  // Relative URLs are only used for document-internal navigation.
  return !value.startsWith('//')
}

export function tagNameOf(node) {
  if (node === null || node === undefined || node.nodeType !== 1) return ''
  return String(node.localName ?? node.tagName ?? '').toLowerCase()
}

export function runsPlainText(runs) {
  if (!Array.isArray(runs)) return ''
  let text = ''
  for (const run of runs) text += run && typeof run.text === 'string' ? run.text : ''
  return text
}

export function blockPlainText(block) {
  if (block === null || block === undefined) return ''
  switch (block.type) {
    case 'heading':
    case 'paragraph':
    case 'quote':
      return runsPlainText(block.runs)
    case 'code':
    case 'math':
      return block.text ?? ''
    case 'list':
      return (block.items ?? [])
        .map((item) => `${item.checked === true ? '[x] ' : item.checked === false ? '[ ] ' : ''}${runsPlainText(item.runs)}`)
        .join('\n')
    case 'table': {
      const head = (block.head ?? []).map((cell) => runsPlainText(cell)).join(' | ')
      const rows = (block.rows ?? []).map((row) => row.map((cell) => runsPlainText(cell)).join(' | '))
      return [head, ...rows].filter((line) => line.length > 0).join('\n')
    }
    case 'image':
      return block.alt ?? ''
    default:
      return ''
  }
}

export function chapterText(chapter) {
  return (chapter.blocks ?? []).map((block) => blockPlainText(block)).filter((text) => text.length > 0).join('\n')
}

export function buildSearchIndex(chapters) {
  const index = []
  chapters.forEach((chapter, chapterIndex) => {
    chapter.blocks.forEach((block, blockIndex) => {
      const text = blockPlainText(block)
      if (text.trim().length > 0) index.push({ chapter: chapterIndex, block: blockIndex, text })
    })
  })
  return index
}

export function buildOutline(chapters) {
  const outline = []
  chapters.forEach((chapter, chapterIndex) => {
    chapter.blocks.forEach((block, blockIndex) => {
      if (block.type !== 'heading') return
      const label = runsPlainText(block.runs).trim()
      if (label.length === 0) return
      outline.push({ chapter: chapterIndex, block: blockIndex, label, level: block.level ?? 1 })
    })
  })
  return outline
}

export function makeChapter(index, title, blocks) {
  return { id: `chapter-${index}`, title: title ?? '', blocks }
}

/** Merge a list of chapter candidates into one model with derived indices. */
export function createFlowModel({ format, title, author, chapters, assets, notes }) {
  const normalized = chapters.map((chapter, index) => ({
    id: chapter.id ?? `chapter-${index}`,
    title: chapter.title ?? '',
    blocks: Array.isArray(chapter.blocks) ? chapter.blocks : [],
  }))
  const model = {
    kind: 'flow',
    format,
    title: title ?? '',
    author: author ?? '',
    chapters: normalized,
    notes: Array.isArray(notes) ? notes : [],
    assets: assets ?? null,
    get outline() {
      return buildOutline(normalized)
    },
    get searchIndex() {
      return buildSearchIndex(normalized)
    },
    dispose() {
      assets?.dispose?.()
    },
  }
  return model
}

/* -------------------------------------------------------------------------- */
/* Converter                                                                   */
/* -------------------------------------------------------------------------- */

function createRunCollector() {
  return { runs: [] }
}

function pushRun(collector, text, marks) {
  if (typeof text !== 'string' || text.length === 0) return
  const last = collector.runs[collector.runs.length - 1]
  if (last !== undefined && last.link === marks.link && last.b === marks.b && last.i === marks.i) {
    last.text += text
    return
  }
  const run = { text }
  if (marks.b) run.b = true
  if (marks.i) run.i = true
  if (marks.code) run.code = true
  if (marks.strike) run.strike = true
  if (marks.sub) run.sub = true
  if (marks.sup) run.sup = true
  if (marks.link !== undefined) run.link = marks.link
  collector.runs.push(run)
}

function inlineRuns(node, options, marks, budget, depth) {
  const collector = createRunCollector()
  if (node === null || node === undefined || depth > MAX_DEPTH) return collector.runs
  for (const child of node.childNodes) {
    if (budget.left <= 0) break
    budget.left -= 1
    if (child.nodeType === 3) {
      pushRun(collector, child.nodeValue.replace(/[\t\r\n ]+/g, ' '), marks)
      continue
    }
    if (child.nodeType !== 1) continue
    const tag = tagNameOf(child)
    if (DROP_TAGS.has(tag)) continue
    if (tag === 'br') {
      pushRun(collector, '\n', marks)
      continue
    }
    if (tag === 'img') {
      const alt = child.getAttribute('alt') ?? ''
      if (alt.length > 0) pushRun(collector, alt, marks)
      continue
    }
    const next = { ...marks }
    if (tag === 'b' || tag === 'strong') next.b = true
    else if (tag === 'i' || tag === 'em' || tag === 'cite' || tag === 'dfn') next.i = true
    else if (tag === 'code' || tag === 'kbd' || tag === 'samp' || tag === 'tt' || tag === 'var') next.code = true
    else if (tag === 's' || tag === 'strike' || tag === 'del') next.strike = true
    else if (tag === 'sub') next.sub = true
    else if (tag === 'sup') next.sup = true
    if (tag === 'a') {
      const href = child.getAttribute('href')
      // MOBI/KF8 use byte offsets (`filepos`) instead of hyperlinks.
      const filepos = href === null ? child.getAttribute('filepos') : null
      const target = href !== null && href.trim().length > 0 ? href : filepos === null ? null : `filepos:${filepos}`
      if (target !== null) {
        const resolved = options.resolveLink?.(target, child) ?? (isSafeUrl(target) ? target : undefined)
        if (resolved !== undefined && resolved !== null) next.link = resolved
      }
    }
    collector.runs.push(...inlineRuns(child, options, next, budget, depth + 1))
  }
  // Trim leading/trailing pure whitespace runs, which HTML formatting creates.
  while (collector.runs.length > 0) {
    const first = collector.runs[0]
    if (typeof first.text !== 'string' || first.text.trim().length > 0) break
    collector.runs.shift()
  }
  while (collector.runs.length > 0) {
    const last = collector.runs[collector.runs.length - 1]
    if (typeof last.text !== 'string' || last.text.trim().length > 0) break
    collector.runs.pop()
  }
  return collector.runs
}

function imageBlock(element, options, budget, depth) {
  const src =
    element.getAttribute('src') ??
    element.getAttribute('data-src') ??
    // MOBI/KF8 reference images by record index instead of a path.
    element.getAttribute('recindex') ??
    null
  if (src === null) return null
  const alt = element.getAttribute('alt') ?? ''
  const resolved = options.resolveImage?.(src, alt, element)
  if (resolved === null || resolved === undefined) return null
  const block = {
    type: 'image',
    url: resolved.url ?? null,
    alt: resolved.alt ?? alt,
    width: resolved.width,
    height: resolved.height,
  }
  if (resolved.pending !== undefined) block.pending = resolved.pending
  return block
}

function tableBlock(element, options, budget, depth) {
  const head = []
  const rows = []
  const rowElements = []
  const collectRows = (node) => {
    for (const child of node.children) {
      const tag = tagNameOf(child)
      if (tag === 'tr') rowElements.push(child)
      else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') collectRows(child)
    }
  }
  collectRows(element)
  let headDone = false
  const inlineBudget = () => ({ left: 12_000 })
  for (const row of rowElements) {
    const cells = []
    let headerRow = row.parentElement !== null && tagNameOf(row.parentElement) === 'thead'
    for (const cell of row.children) {
      const tag = tagNameOf(cell)
      if (tag !== 'td' && tag !== 'th') continue
      if (tag === 'th') headerRow = true
      const runs = inlineRuns(cell, options, {}, inlineBudget(), depth + 1)
      const flat = runs.filter((run) => run !== undefined)
      if (typeof cell.colSpan === 'number' && cell.colSpan > 1) {
        // Preserve the visual grid without rendering into other columns.
        flat.push({ text: '' })
      }
      cells.push(flat)
    }
    if (cells.length === 0) continue
    if (!headDone && headerRow) {
      head.push(...cells)
      headDone = true
    } else {
      rows.push(cells)
    }
  }
  if (head.length === 0 && rows.length > 0) {
    head.push(...rows.shift())
  }
  if (head.length === 0 && rows.length === 0) return null
  return { type: 'table', head, rows }
}

function listBlock(element, options, budget, depth, ordered) {
  const items = []
  const visitList = (listElement, level) => {
    for (const child of listElement.children) {
      if (tagNameOf(child) !== 'li') continue
      if (budget.left <= 0) return
      budget.left -= 1
      const runs = []
      let checked
      for (const node of child.childNodes) {
        if (node.nodeType === 1) {
          const tag = tagNameOf(node)
          if (tag === 'ul' || tag === 'ol') {
            visitList(node, level + 1)
            continue
          }
          if (tag === 'input' && node.getAttribute('type') === 'checkbox') {
            checked = node.hasAttribute('checked') || node.getAttribute('checked') === 'checked'
            continue
          }
        }
        const nested = inlineRuns(node, options, {}, budget, depth + 1)
        runs.push(...nested)
      }
      items.push({ runs, level, checked })
    }
  }
  visitList(element, 0)
  if (items.length === 0) return null
  return { type: 'list', ordered, items }
}

function blockFromElement(element, options, budget, depth) {
  const blocks = blockFromElementInner(element, options, budget, depth)
  if (blocks.length === 0) return blocks
  // EPUB/MOBI anchors usually sit on a wrapper (<section id="chapter1">) that
  // the converter flattens away. Keep the id on the first produced block so
  // the table of contents can still scroll to the exact section.
  const ownId = typeof element.getAttribute === 'function' ? element.getAttribute('id') : null
  if (ownId !== null && ownId !== '' && blocks[0].id === undefined) {
    blocks[0] = { ...blocks[0], id: ownId }
  }
  return blocks
}

function blockFromElementInner(element, options, budget, depth) {
  const tag = tagNameOf(element)
  if (DROP_TAGS.has(tag)) return []
  if (budget.left <= 0) return []
  budget.left -= 1
  if (depth > MAX_DEPTH) return []
  const headingLevel = HEADING_LEVELS[tag]
  if (headingLevel !== undefined) {
    const runs = inlineRuns(element, options, {}, budget, depth + 1)
    if (runs.length === 0) return []
    return [{ type: 'heading', level: headingLevel, runs, id: element.getAttribute('id') ?? undefined }]
  }
  if (tag === 'p') {
    const images = []
    for (const child of element.children) {
      if (tagNameOf(child) === 'img') {
        const image = imageBlock(child, options, budget, depth + 1)
        if (image !== null) images.push(image)
      }
    }
    const runs = inlineRuns(element, options, {}, budget, depth + 1)
    const blocks = []
    const id = element.getAttribute('id') ?? undefined
    if (runs.length > 0) blocks.push({ type: 'paragraph', runs, id })
    blocks.push(...images)
    return blocks
  }
  if (tag === 'img') {
    const image = imageBlock(element, options, budget, depth + 1)
    return image === null ? [] : [image]
  }
  if (tag === 'hr') return [{ type: 'hr' }]
  if (tag === 'br') return []
  if (tag === 'pre') {
    const code = element.textContent ?? ''
    if (code.trim().length === 0) return []
    const className = element.getAttribute('class') ?? ''
    const langMatch = /(?:language|lang)-([\w+#.-]+)/i.exec(className)
    const childCode = element.querySelector('code')
    const childClass = childCode?.getAttribute('class') ?? ''
    const childMatch = /(?:language|lang)-([\w+#.-]+)/i.exec(childClass)
    return [{ type: 'code', lang: (langMatch?.[1] ?? childMatch?.[1] ?? '').toLowerCase(), text: code }]
  }
  if (tag === 'blockquote') {
    const inner = element.children.length === 0 ? inlineRuns(element, options, {}, budget, depth + 1) : null
    if (inner !== null && inner.length > 0) return [{ type: 'quote', runs: inner }]
    return textsToQuoteBlocks(convertChildren(element, options, budget, depth + 1))
  }
  if (tag === 'ul' || tag === 'ol') {
    const list = listBlock(element, options, budget, depth, tag === 'ol')
    return list === null ? [] : [list]
  }
  if (tag === 'table') {
    const table = tableBlock(element, options, budget, depth)
    return table === null ? [] : [table]
  }
  if (tag === 'dl') {
    const blocks = []
    for (const child of element.children) {
      const childTag = tagNameOf(child)
      if (childTag !== 'dt' && childTag !== 'dd') continue
      const runs = inlineRuns(child, options, {}, budget, depth + 1)
      if (runs.length === 0) continue
      blocks.push(childTag === 'dt' ? { type: 'heading', level: 4, runs } : { type: 'paragraph', runs })
    }
    return blocks
  }
  if (tag === 'figure') {
    const blocks = []
    for (const child of element.children) {
      const childTag = tagNameOf(child)
      if (childTag === 'figcaption') continue
      blocks.push(...blockFromElement(child, options, budget, depth + 1))
    }
    const caption = element.querySelector('figcaption')
    if (caption !== null) {
      const runs = inlineRuns(caption, options, {}, budget, depth + 1)
      if (runs.length > 0) blocks.push({ type: 'caption', runs })
    }
    return blocks
  }
  if (tag === 'figcaption') {
    const runs = inlineRuns(element, options, {}, budget, depth + 1)
    return runs.length === 0 ? [] : [{ type: 'caption', runs }]
  }
  if (BLOCK_CONTAINER_TAGS.has(tag)) {
    return convertChildren(element, options, budget, depth + 1)
  }
  // Any other element: treat its inline content as a paragraph so no text is
  // silently lost (this keeps unknown-but-inline markup readable).
  const runs = inlineRuns(element, options, {}, budget, depth + 1)
  return runs.length === 0 ? [] : [{ type: 'paragraph', runs }]
}

function textsToQuoteBlocks(blocks) {
  const quoted = []
  for (const block of blocks) {
    if (block.type === 'paragraph' || block.type === 'quote' || block.type === 'caption') {
      quoted.push({ type: 'quote', runs: block.runs })
    } else {
      quoted.push(block)
    }
  }
  return quoted
}

function convertChildren(root, options, budget, depth) {
  const blocks = []
  for (const child of root.childNodes) {
    if (budget.left <= 0) break
    if (child.nodeType === 3) {
      const text = child.nodeValue.replace(/\s+/g, ' ').trim()
      if (text.length > 0) blocks.push({ type: 'paragraph', runs: [{ text }] })
      continue
    }
    if (child.nodeType !== 1) continue
    blocks.push(...blockFromElement(child, options, budget, depth))
  }
  return blocks
}

/**
 * Convert a DOM node (document body or an XML element) into blocks.
 *
 * @param {Node} root
 * @param {{
 *   resolveImage?: (src: string, alt: string, element: Element) => ({url: string, alt?: string} | null),
 *   resolveLink?: (href: string, element: Element) => (string | {chapter: number, anchor?: string} | null),
 * }} options
 */
export function htmlToBlocks(root, options = {}) {
  const budget = { left: MAX_NODES }
  return convertChildren(root, options, budget, 0)
}

export { isSafeUrl }
