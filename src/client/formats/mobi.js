/**
 * MOBI / PalmDOC / KF8 (AZW3) reader.
 *
 * Supports unencrypted PalmDOC- and plain-compressed books, including their
 * image records. HUFF/CDIC compression and DRM-encrypted books are rejected
 * with an explicit error instead of producing garbage: removing DRM is out of
 * scope, and a silent failure would look like a reader bug.
 *
 * Structure: PalmDB record table → record 0 (PalmDOC + MOBI headers + EXTH) →
 * text records (decompressed LZ77) → HTML-ish markup → sanitized block flow.
 */

import { decodeText, parseHtmlDocument } from './dom.js'
import { createFlowModel, htmlToBlocks, makeChapter } from './flow.js'

const MAX_RECORDS = 60_000
const MAX_TEXT_BYTES = 64 * 1024 * 1024
const NO_IMAGE_INDEX = 0xffffffff

function latin1(bytes, start, length) {
  let out = ''
  for (let index = 0; index < length; index += 1) out += String.fromCharCode(bytes[start + index] ?? 0)
  return out
}

/** PalmDB / PalmDOC / MOBI headers are all big-endian. */
function u16(bytes, offset) {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
}

function u32(bytes, offset) {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  )
}

/** PalmDOC LZ77: literals, length-prefixed copies and 11-bit back references. */
export function decompressPalmDoc(input) {
  let output = new Uint8Array(input.length * 8 + 1024)
  let outLength = 0
  const ensure = (extra) => {
    if (outLength + extra <= output.length) return
    const grown = new Uint8Array(Math.max(output.length * 2, outLength + extra + 1024))
    grown.set(output.subarray(0, outLength))
    output = grown
  }
  let index = 0
  while (index < input.length) {
    const byte = input[index]
    index += 1
    if (byte === 0) {
      ensure(1)
      output[outLength] = 0
      outLength += 1
    } else if (byte <= 8) {
      ensure(byte)
      for (let count = 0; count < byte && index < input.length; count += 1) {
        output[outLength] = input[index]
        outLength += 1
        index += 1
      }
    } else if (byte <= 0x7f) {
      ensure(1)
      output[outLength] = byte
      outLength += 1
    } else if (byte <= 0xbf) {
      if (index >= input.length) break
      const pair = (byte << 8) | input[index]
      index += 1
      const distance = (pair & 0x3fff) >> 3
      const length = (pair & 0x7) + 3
      if (distance === 0 || distance > outLength) continue
      ensure(length)
      for (let count = 0; count < length; count += 1) {
        output[outLength] = output[outLength - distance]
        outLength += 1
      }
    } else {
      ensure(2)
      output[outLength] = 0x20
      output[outLength + 1] = byte ^ 0x80
      outLength += 2
    }
  }
  return output.slice(0, outLength)
}

function trimTrailingPadding(bytes) {
  let end = bytes.length
  while (end > 0 && (bytes[end - 1] === 0 || bytes[end - 1] === 0x20)) end -= 1
  return bytes.subarray(0, end)
}

function parseExth(record, start, end) {
  if (start + 12 > end) return new Map()
  if (latin1(record, start, 4) !== 'EXTH') return new Map()
  const count = u32(record, start + 8)
  if (count > 10_000) return new Map()
  const entries = new Map()
  let cursor = start + 12
  for (let index = 0; index < count && cursor + 8 <= end; index += 1) {
    const type = u32(record, cursor)
    const length = u32(record, cursor + 4)
    if (length < 8 || cursor + length > end) break
    const data = record.subarray(cursor + 8, cursor + length)
    if (!entries.has(type)) entries.set(type, data)
    cursor += length
  }
  return entries
}

function imageMime(bytes) {
  if (bytes.length < 8) return null
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  const header = latin1(bytes, 0, 6)
  if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif'
  return null
}

function decodeRecordText(bytes, encoding) {
  if (encoding === 65001) return decodeText(bytes, { hint: 'utf-8' })
  return decodeText(bytes, { hint: 'windows-1252' })
}

function stripTrailingNul(text) {
  // Text records are padded with NULs and control bytes; keep the readable tail.
  let value = text.replace(/\u0000+$/u, '')
  value = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+$/u, '')
  return value
}

export async function openMobi({ name, bytes, path, signal }) {
  if (bytes.length < 120) throw new Error('not-a-mobi: file is too small')
  if (latin1(bytes, 60, 8) !== 'BOOKMOBI') {
    throw new Error('not-a-mobi: Palm database type is not BOOKMOBI')
  }
  const numRecords = u16(bytes, 76)
  if (numRecords < 2 || numRecords > MAX_RECORDS) throw new Error(`corrupt-mobi: implausible record count ${numRecords}`)
  // PalmDB record info list: 8 bytes per record (offset u32, attributes u8,
  // unique id u24). Only the offsets are needed here.
  const offsets = []
  for (let index = 0; index < numRecords; index += 1) {
    const offset = u32(bytes, 78 + index * 8)
    if (offset < 78 || offset >= bytes.length) {
      throw new Error(
        `corrupt-mobi: record ${index} starts at ${offset}, outside the ${bytes.length}-byte file`,
      )
    }
    if (index > 0 && offset < offsets[index - 1]) {
      throw new Error('corrupt-mobi: record offsets are not ordered')
    }
    offsets.push(offset)
  }
  offsets.push(bytes.length)
  const readRecord = (index) => bytes.subarray(offsets[index], offsets[index + 1])

  const record0 = readRecord(0)
  const compression = u16(record0, 0)
  const textLength = u32(record0, 4)
  const textRecordCount = u16(record0, 8)
  const encryption = u16(record0, 12)
  if (encryption !== 0) {
    throw new Error(
      `drm-protected: this book declares PalmDOC encryption type ${encryption}; DRM removal is not supported`,
    )
  }
  if (compression === 17480) {
    throw new Error('huff-compression-unsupported: HUFF/CDIC-compressed MOBI books are not supported')
  }
  if (compression !== 1 && compression !== 2) throw new Error(`unsupported-compression: ${compression}`)
  if (textRecordCount === 0 || textRecordCount + 1 > numRecords) {
    throw new Error(`corrupt-mobi: text record count ${textRecordCount} is invalid`)
  }

  // MOBI header (record 0, after the 16-byte PalmDOC header).
  const mobi = 16
  const mobiMagic = latin1(record0, mobi, 4)
  let encoding = 1252
  let fileVersion = 6
  let firstImageIndex = NO_IMAGE_INDEX
  let author = ''
  let fullName = name.replace(/\.[^.]+$/, '')
  let textRecordSize = u16(record0, 10)
  if (mobiMagic !== 'MOBI') {
    if (compression !== 1 && compression !== 2) throw new Error('not-a-mobi: MOBI header is missing')
  } else {
    const headerLength = u32(record0, mobi + 4)
    encoding = u32(record0, mobi + 12)
    fileVersion = u32(record0, mobi + 20)
    const fullNameOffset = u32(record0, mobi + 0x54)
    const fullNameLength = u32(record0, mobi + 0x58)
    firstImageIndex = u32(record0, mobi + 0x6c)
    if (fullNameLength > 0 && fullNameOffset + fullNameLength <= record0.length) {
      const decoded = decodeRecordText(record0.subarray(fullNameOffset, fullNameOffset + fullNameLength), encoding)
      if (decoded.trim().length > 0) fullName = decoded.trim()
    }
    const exthFlags = u32(record0, mobi + 0x80)
    if ((exthFlags & 0x40) !== 0 && headerLength > 0 && mobi + headerLength < record0.length) {
      const exth = parseExth(record0, mobi + headerLength, record0.length)
      const authorBytes = exth.get(100)
      if (authorBytes !== undefined) author = decodeRecordText(authorBytes, encoding).trim()
      const titleBytes = exth.get(503)
      if (titleBytes !== undefined) {
        const title = decodeRecordText(titleBytes, encoding).trim()
        if (title.length > 0) fullName = title
      }
    }
  }
  if (textRecordSize <= 0) textRecordSize = 4096

  // Concatenate and decompress the text records.
  const chunks = []
  let total = 0
  for (let index = 1; index <= textRecordCount; index += 1) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    const raw = trimTrailingPadding(readRecord(index))
    const chunk = compression === 2 ? decompressPalmDoc(raw) : raw
    chunks.push(chunk)
    total += chunk.length
    if (total > MAX_TEXT_BYTES) throw new Error('too-large: the book text exceeds the 64 MiB reader limit')
  }
  const combined = new Uint8Array(Math.max(textLength, total))
  let cursor = 0
  for (const chunk of chunks) {
    combined.set(chunk, cursor)
    cursor += chunk.length
  }
  const textBytes = combined.subarray(0, Math.min(total, textLength > 0 ? textLength : total))
  const text = stripTrailingNul(decodeRecordText(textBytes, encoding))

  // Image records are the run of image-looking records after firstImageIndex.
  const imageRecords = []
  if (firstImageIndex !== NO_IMAGE_INDEX && firstImageIndex < numRecords) {
    for (let index = firstImageIndex; index < numRecords; index += 1) {
      const record = trimTrailingPadding(readRecord(index))
      const mime = imageMime(record)
      if (mime !== null) imageRecords.push({ index, mime })
    }
  }
  const imageUrls = new Map()
  const imageUrl = (ordinal) => {
    const entry = imageRecords[ordinal - 1]
    if (entry === undefined) return null
    const cached = imageUrls.get(entry.index)
    if (cached !== undefined) return cached
    const url = URL.createObjectURL(new Blob([readRecord(entry.index)], { type: entry.mime }))
    imageUrls.set(entry.index, url)
    return url
  }

  // Split into chapters: pagebreak markers first, top-level headings for KF8.
  const breaks = []
  const pagebreak = /<mbp:pagebreak[^>]*>/gi
  let match
  while ((match = pagebreak.exec(text)) !== null) breaks.push(match.index)
  let segments
  if (breaks.length > 0) {
    segments = []
    let start = 0
    for (const position of breaks) {
      segments.push({ start, html: text.slice(start, position) })
      start = position + 1
    }
    segments.push({ start, html: text.slice(start) })
  } else if (fileVersion >= 8) {
    segments = []
    const headingPattern = /<h1[\s>]/gi
    let start = 0
    let headingMatch
    while ((headingMatch = headingPattern.exec(text)) !== null) {
      if (headingMatch.index > start) {
        segments.push({ start, html: text.slice(start, headingMatch.index) })
        start = headingMatch.index
      }
    }
    segments.push({ start, html: text.slice(start) })
  } else {
    // Some MOBI files rely on the guide/NCX for navigation; keep one flow.
    segments = [{ start: 0, html: text }]
  }
  const chapterStarts = segments.map((segment) => segment.start)
  const chapterForFilepos = (filepos) => {
    let found = 0
    for (let index = 0; index < chapterStarts.length; index += 1) {
      if (chapterStarts[index] <= filepos) found = index
      else break
    }
    return found
  }

  const chapters = []
  for (let chapterIndex = 0; chapterIndex < segments.length; chapterIndex += 1) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    const segment = segments[chapterIndex]
    const document = parseHtmlDocument(segment.html)
    const blocks = htmlToBlocks(document.body ?? document.documentElement, {
      resolveImage(src) {
        const value = String(src).trim()
        const recindex = /^(\d+)$/.exec(value)?.[1]
        const embed = /kindle:embed:([0-9a-f]+)/i.exec(value)?.[1]
        const ordinalText = recindex ?? (embed === undefined ? undefined : String(parseInt(embed, 16) || parseInt(embed, 10)))
        if (ordinalText === undefined) return null
        const ordinal = Number.parseInt(ordinalText, 10)
        if (!Number.isFinite(ordinal) || ordinal < 1) return null
        const url = imageUrl(ordinal)
        if (url === null) return null
        return { url }
      },
      resolveLink(href) {
        const value = String(href)
        if (value.startsWith('filepos:')) {
          const filepos = Number.parseInt(value.slice('filepos:'.length), 10)
          if (!Number.isFinite(filepos) || filepos < 0) return null
          return { chapter: chapterForFilepos(filepos) }
        }
        if (/^(https?:|mailto:)/i.test(value)) return value
        return null
      },
    })
    const firstHeading = blocks.find((block) => block.type === 'heading')
    const headingText =
      firstHeading === undefined ? '' : firstHeading.runs.map((run) => run.text ?? '').join('').trim()
    chapters.push({
      title: headingText.length > 0 ? headingText : `Chapter ${chapterIndex + 1}`,
      blocks,
    })
  }
  if (chapters.length === 0) throw new Error('empty: no readable chapters were found in the MOBI file')

  const model = createFlowModel({
    format: 'mobi',
    title: fullName,
    author,
    chapters: chapters.map((chapter, index) => makeChapter(index, chapter.title, chapter.blocks)),
    assets: { dispose: () => { for (const url of imageUrls.values()) URL.revokeObjectURL(url); imageUrls.clear() } },
  })
  model.notes.push(
    fileVersion >= 8
      ? 'kf8: the book declares MOBI file version 8 (KF8/AZW3); it is read as a reflowed text flow.'
      : 'mobi: the book is read as a reflowed text flow; page-break markers become chapter boundaries.',
  )
  model.path = path
  return model
}
