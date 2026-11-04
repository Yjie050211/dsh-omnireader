/**
 * Markdown → reflowable document model.
 *
 * A deliberately small CommonMark/GFM subset is implemented here because the
 * reader has to be able to (a) produce a real table of contents, (b) jump to
 * headings and (c) search with stable block anchors — all of which need the
 * parsed structure, not an opaque HTML string. Supported: ATX/setext headings,
 * paragraphs, lists (nested, task lists), tables, fenced code, block quotes,
 * horizontal rules, images, links, emphasis, strikethrough, inline code and
 * inline/display math (displayed as a formula block; no TeX engine is bundled).
 */

import { createFlowModel, isSafeUrl, makeChapter } from './flow.js'
import { extname } from '../lib/util.js'

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const SETEXT = /^ {0,3}(=+|-{2,})\s*$/
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const QUOTE = /^ {0,3}>\s?(.*)$/
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const MATH_BLOCK_OPEN = /^\s*\$\$\s*$/

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function splitFrontmatter(lines) {
  if (lines.length === 0 || lines[0].trim() !== '---') return { meta: {}, rest: lines }
  let end = -1
  for (let index = 1; index < Math.min(lines.length, 200); index += 1) {
    if (lines[index].trim() === '---') {
      end = index
      break
    }
  }
  if (end === -1) return { meta: {}, rest: lines }
  const meta = {}
  for (const line of lines.slice(1, end)) {
    const match = /^([\w-]+)\s*:\s*(.*)$/.exec(line.trim())
    if (match === null) continue
    meta[match[1].toLowerCase()] = match[2].replace(/^["']|["']$/g, '').trim()
  }
  return { meta, rest: lines.slice(end + 1) }
}

/* -------------------------------------------------------------------------- */
/* Inline parsing                                                              */
/* -------------------------------------------------------------------------- */

function pushRun(runs, run) {
  if (run.text.length === 0) return
  const last = runs[runs.length - 1]
  if (
    last !== undefined &&
    last.link === run.link &&
    last.b === run.b &&
    last.i === run.i &&
    last.code === run.code &&
    last.math === run.math
  ) {
    last.text += run.text
    return
  }
  runs.push(run)
}

function resolveLinkTarget(href, options) {
  if (typeof href !== 'string' || href.length === 0) return undefined
  const trimmed = href.trim()
  if (trimmed.startsWith('#')) return { anchor: trimmed.slice(1) }
  const resolved = options.resolveLink?.(trimmed)
  if (resolved !== undefined && resolved !== null) return typeof resolved === 'string' ? resolved : resolved
  return isSafeUrl(trimmed) ? trimmed : undefined
}

function parseInline(text, options) {
  const runs = []
  let index = 0
  let buffer = ''
  const flush = () => {
    if (buffer.length > 0) {
      pushRun(runs, { text: decodeEntities(buffer) })
      buffer = ''
    }
  }
  while (index < text.length) {
    const ch = text[index]
    if (ch === '\\' && index + 1 < text.length) {
      buffer += text[index + 1]
      index += 2
      continue
    }
    // Images: ![alt](src "title")
    if (ch === '!' && text[index + 1] === '[') {
      const match = /^!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/.exec(text.slice(index))
      if (match !== null) {
        flush()
        const resolved = options.resolveImage?.(match[2], match[1]) ?? null
        if (resolved !== null) {
          runs.push({ text: resolved.alt ?? match[1], image: resolved, b: false })
        } else {
          pushRun(runs, { text: `[图片: ${match[1] || match[2]}]` })
        }
        index += match[0].length
        continue
      }
    }
    // Links: [text](href)
    if (ch === '[') {
      const match = /^\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/.exec(text.slice(index))
      if (match !== null) {
        flush()
        const innerRuns = parseInline(match[1], options)
        const link = resolveLinkTarget(match[2], options)
        for (const run of innerRuns) {
          pushRun(runs, link === undefined ? run : { ...run, link })
        }
        index += match[0].length
        continue
      }
    }
    // Autolink: <https://example.com>
    if (ch === '<') {
      const match = /^<(https?:\/\/[^\s>]+)>/.exec(text.slice(index))
      if (match !== null) {
        flush()
        const link = resolveLinkTarget(match[1], options)
        pushRun(runs, link === undefined ? { text: match[1] } : { text: match[1], link })
        index += match[0].length
        continue
      }
      // Raw HTML tag: drop the tag but keep surrounding text (no HTML insertion).
      const tagMatch = /^<\/?[a-zA-Z][^>]*>/.exec(text.slice(index))
      if (tagMatch !== null) {
        flush()
        index += tagMatch[0].length
        continue
      }
    }
    // Code span
    if (ch === '`') {
      const match = /^(`+)([\s\S]*?)\1/.exec(text.slice(index))
      if (match !== null) {
        flush()
        pushRun(runs, { text: match[2], code: true })
        index += match[0].length
        continue
      }
    }
    // Inline math: $...$ (escaped dollar sign is handled above)
    if (ch === '$' && text[index + 1] !== '$') {
      const match = /^\$([^$\n]+)\$/.exec(text.slice(index))
      if (match !== null) {
        flush()
        pushRun(runs, { text: match[1], code: true, math: true })
        index += match[0].length
        continue
      }
    }
    // Strong / emphasis / strikethrough
    if (ch === '*' || ch === '_' || ch === '~') {
      const match = /^(\*\*|__|~~|\*|_)(?=\S)([\s\S]*?\S)\1/.exec(text.slice(index))
      if (match !== null) {
        flush()
        const marker = match[1]
        const marks =
          marker === '**' || marker === '__'
            ? { b: true }
            : marker === '~~'
              ? { strike: true }
              : { i: true }
        const innerRuns = parseInline(match[2], options)
        for (const run of innerRuns) pushRun(runs, { ...run, ...marks })
        index += match[0].length
        continue
      }
    }
    buffer += ch
    index += 1
  }
  flush()
  return runs
}

/* -------------------------------------------------------------------------- */
/* Block parsing                                                               */
/* -------------------------------------------------------------------------- */

function parseTableRow(line) {
  let trimmed = line.trim()
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)
  return trimmed.split('|').map((cell) => cell.trim())
}

function parseBlocks(lines, options) {
  const blocks = []
  let index = 0
  const pushParagraph = (textLines) => {
    const joined = textLines.join('\n').trim()
    if (joined.length === 0) return
    const runs = parseInline(joined.replace(/\n+$/, ''), options)
    if (runs.length > 0) blocks.push({ type: 'paragraph', runs })
  }
  while (index < lines.length) {
    const line = lines[index]
    if (line.trim().length === 0) {
      index += 1
      continue
    }
    // Fenced code
    const fence = FENCE.exec(line)
    if (fence !== null) {
      const marker = fence[1]
      const lang = fence[2].toLowerCase()
      const body = []
      index += 1
      while (index < lines.length && !lines[index].trimStart().startsWith(marker)) {
        body.push(lines[index])
        index += 1
      }
      index += 1
      blocks.push({ type: 'code', lang, text: body.join('\n') })
      continue
    }
    // Display math block
    if (MATH_BLOCK_OPEN.test(line)) {
      const body = []
      index += 1
      while (index < lines.length && !/^\s*\$\$\s*$/.test(lines[index])) {
        body.push(lines[index])
        index += 1
      }
      index += 1
      if (body.length > 0) blocks.push({ type: 'math', text: body.join('\n') })
      continue
    }
    // Heading
    const heading = HEADING.exec(line)
    if (heading !== null) {
      const runs = parseInline(heading[2].trim(), options)
      if (runs.length > 0) blocks.push({ type: 'heading', level: heading[1].length, runs })
      index += 1
      continue
    }
    // Setext heading (=== / ---) under a paragraph line
    if (
      index + 1 < lines.length &&
      line.trim().length > 0 &&
      SETEXT.test(lines[index + 1]) &&
      !line.trimStart().startsWith('|')
    ) {
      const level = lines[index + 1].trim().startsWith('=') ? 1 : 2
      const runs = parseInline(line.trim(), options)
      if (runs.length > 0) blocks.push({ type: 'heading', level, runs })
      index += 2
      continue
    }
    if (HR.test(line)) {
      blocks.push({ type: 'hr' })
      index += 1
      continue
    }
    // Block quote
    if (QUOTE.test(line)) {
      const body = []
      while (index < lines.length && QUOTE.test(lines[index])) {
        body.push(QUOTE.exec(lines[index])[1])
        index += 1
      }
      const quoted = parseBlocks(body, options)
      if (quoted.length > 0) {
        for (const block of quoted) {
          if (block.type === 'paragraph' || block.type === 'heading') {
            blocks.push({ type: 'quote', runs: block.runs })
          } else {
            blocks.push(block)
          }
        }
      }
      continue
    }
    // Table
    if (line.includes('|') && index + 1 < lines.length && TABLE_DIVIDER.test(lines[index + 1])) {
      const head = parseTableRow(line).map((cell) => parseInline(cell, options))
      const rows = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim().length > 0) {
        rows.push(parseTableRow(lines[index]).map((cell) => parseInline(cell, options)))
        index += 1
      }
      if (head.length > 0) blocks.push({ type: 'table', head, rows })
      continue
    }
    // List
    const listMatch = LIST_ITEM.exec(line)
    if (listMatch !== null) {
      const ordered = /\d/.test(listMatch[2])
      const items = []
      while (index < lines.length) {
        const itemMatch = LIST_ITEM.exec(lines[index])
        if (itemMatch !== null) {
          const indent = itemMatch[1].replace(/\t/g, '  ').length
          let text = itemMatch[3]
          let checked
          const task = /^\[([ xX])\]\s+(.*)$/.exec(text)
          if (task !== null) {
            checked = task[1].toLowerCase() === 'x'
            text = task[2]
          }
          index += 1
          // Continuation lines (indented, not a new item).
          while (index < lines.length) {
            const continuation = lines[index]
            if (continuation.trim().length === 0) break
            if (LIST_ITEM.test(continuation)) break
            if (!/^\s{2,}\S/.test(continuation)) break
            text += `\n${continuation.trim()}`
            index += 1
          }
          items.push({ level: Math.floor(indent / 2), checked, runs: parseInline(text, options) })
          continue
        }
        if (lines[index].trim().length === 0) {
          // A blank line continues the list only when the next line is an item.
          let probe = index + 1
          while (probe < lines.length && lines[probe].trim().length === 0) probe += 1
          if (probe < lines.length && LIST_ITEM.test(lines[probe])) {
            index = probe
            continue
          }
        }
        break
      }
      if (items.length > 0) blocks.push({ type: 'list', ordered, items })
      continue
    }
    // Paragraph: gather until a blank line or the start of another block.
    const paragraphLines = []
    while (index < lines.length) {
      const current = lines[index]
      if (current.trim().length === 0) break
      if (paragraphLines.length > 0) {
        if (
          FENCE.test(current) ||
          HEADING.test(current) ||
          HR.test(current) ||
          QUOTE.test(current) ||
          LIST_ITEM.test(current) ||
          MATH_BLOCK_OPEN.test(current) ||
          (current.includes('|') && index + 1 < lines.length && TABLE_DIVIDER.test(lines[index + 1]))
        ) {
          break
        }
      }
      paragraphLines.push(current)
      index += 1
    }
    pushParagraph(paragraphLines)
  }
  return blocks
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

export function parseMarkdownDocument(text, options = {}) {
  const normalized = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const { meta, rest } = splitFrontmatter(lines)
  const blocks = parseBlocks(rest, options)
  // Chapters follow the level-1 headings so long documents stay light in the DOM.
  const chapters = []
  let current = { title: meta.title ?? options.title ?? '', blocks: [] }
  for (const block of blocks) {
    if (block.type === 'heading' && block.level === 1) {
      const label = block.runs.map((run) => run.text).join('').trim()
      if (current.blocks.length > 0) chapters.push(current)
      current = { title: label, blocks: [block] }
    } else {
      current.blocks.push(block)
    }
  }
  if (current.blocks.length > 0 || chapters.length === 0) chapters.push(current)
  const model = createFlowModel({
    format: 'md',
    title: meta.title ?? options.title ?? '',
    author: meta.author ?? meta.creator ?? '',
    chapters: chapters.map((chapter, index) => makeChapter(index, chapter.title, chapter.blocks)),
  })
  if (model.title.length === 0) {
    const firstHeading = model.outline[0]?.label
    if (firstHeading !== undefined) model.title = firstHeading
  }
  if (model.title.length === 0) model.title = options.title ?? ''
  return model
}

export async function openMarkdown({ name, bytes, path, signal }) {
  const text = new TextDecoder('utf-8').decode(bytes)
  const baseDirectory = path.replace(/[\\/][^\\/]*$/, '')
  const imageBase = path.replace(/\\/g, '/').replace(/\/[^/]*$/, '')
  const model = parseMarkdownDocument(text, {
    title: name.replace(/\.[^.]+$/, ''),
    resolveImage(src, alt) {
      const value = String(src).trim()
      if (value.length === 0) return null
      if (/^https?:/i.test(value) || value.startsWith('//')) {
        // Remote images are not fetched: a local-first reader must not phone
        // home. The alt text stays visible instead.
        return null
      }
      if (/^data:/i.test(value)) return null
      const decoded = decodeURIComponent(value.split('#')[0].split('?')[0])
      const absolute = decoded.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(decoded) ? decoded : `${imageBase}/${decoded}`
      const normalized = normalizePath(absolute)
      return { url: `api/omnireader/file?path=${encodeURIComponent(normalized)}`, alt }
    },
    resolveLink(href) {
      const value = String(href)
      if (/^https?:/i.test(value) || /^mailto:/i.test(value)) return value
      if (value.startsWith('#')) return { anchor: value.slice(1) }
      return undefined
    },
  })
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
  if (model.chapters.length === 0 || model.searchIndex.length === 0) {
    throw new Error('empty: the Markdown document has no readable content')
  }
  void baseDirectory
  return model
}

/** Normalize `..`/`.` segments in an absolute native path without a win32 dep. */
export function normalizePath(input) {
  const isWindows = /^[a-zA-Z]:/.test(input) || input.includes('\\')
  const separator = isWindows ? '\\' : '/'
  const unified = input.replace(/\\/g, '/')
  const parts = []
  for (const segment of unified.split('/')) {
    if (segment.length === 0 || segment === '.') continue
    if (segment === '..') {
      if (parts.length > 0) parts.pop()
      continue
    }
    parts.push(segment)
  }
  let prefix = ''
  if (/^[a-zA-Z]:/.test(unified)) prefix = `${parts.shift()}`
  else if (unified.startsWith('/')) prefix = ''
  const joined = parts.join('/')
  return isWindows ? `${prefix}${separator}${joined.replace(/\//g, '\\')}` : `/${joined}`
}

export function markdownExtensionLabel(path) {
  return extname(path) === '.markdown' ? 'Markdown' : 'Markdown'
}
