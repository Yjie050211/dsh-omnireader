/**
 * Minimal, read-only ZIP reader used for EPUB and DOCX containers.
 *
 * Security posture (the archive comes from an untrusted local file):
 *  - entry names are normalized and any entry with a traversal segment or an
 *    absolute/UNC path is dropped before it can reach a resolver;
 *  - the entry count, per-entry size and total decompressed budget are capped,
 *    which bounds the classic "zip bomb" blow-up;
 *  - nothing is ever written to disk, so a zip-slip cannot escape anywhere.
 *
 * Only STORE (0) and DEFLATE (8) are supported; those are the only methods the
 * EPUB and OOXML specifications allow.
 */

const MAX_ENTRIES = 6000
const MAX_ENTRY_BYTES = 64 * 1024 * 1024
const MAX_TOTAL_BYTES = 512 * 1024 * 1024
const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

function normalizeEntryName(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1024) return null
  const replaced = raw.replace(/\\/g, '/').replace(/^\.\//, '')
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(replaced)) return null
  if (replaced.startsWith('/') || /^[a-zA-Z]:/.test(replaced) || replaced.startsWith('//')) return null
  const segments = replaced.split('/')
  if (segments.some((segment) => segment === '..')) return null
  return segments.filter((segment) => segment.length > 0).join('/')
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('deflate-unsupported: this runtime has no DecompressionStream')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const buffer = await new Response(stream).arrayBuffer()
  return new Uint8Array(buffer)
}

export class ZipArchive {
  constructor(buffer, entries) {
    this.buffer = buffer
    this.entries = entries
    this.cache = new Map()
    this.totalBytes = 0
  }

  static async open(bytes) {
    const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    // Find the end-of-central-directory record from the tail.
    const scanStart = Math.max(0, buffer.byteLength - 66_000)
    let eocd = -1
    for (let offset = buffer.byteLength - 22; offset >= scanStart; offset -= 1) {
      if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
        eocd = offset
        break
      }
    }
    if (eocd === -1) throw new Error('not-a-zip: end of central directory not found')
    const entryCount = view.getUint16(eocd + 10, true)
    const centralSize = view.getUint32(eocd + 12, true)
    const centralOffset = view.getUint32(eocd + 16, true)
    if (entryCount === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) {
      throw new Error('zip64-unsupported: ZIP64 containers are not supported')
    }
    if (entryCount > MAX_ENTRIES) throw new Error(`archive-too-large: ${entryCount} entries`)
    const entries = new Map()
    let offset = centralOffset
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > buffer.byteLength) throw new Error('corrupt-zip: central directory truncated')
      if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
        throw new Error('corrupt-zip: bad central directory signature')
      }
      const flags = view.getUint16(offset + 8, true)
      const method = view.getUint16(offset + 10, true)
      const compressedSize = view.getUint32(offset + 20, true)
      const uncompressedSize = view.getUint32(offset + 24, true)
      const nameLength = view.getUint16(offset + 28, true)
      const extraLength = view.getUint16(offset + 30, true)
      const commentLength = view.getUint16(offset + 32, true)
      const localOffset = view.getUint32(offset + 42, true)
      const nameBytes = buffer.subarray(offset + 46, offset + 46 + nameLength)
      // Bit 11 marks UTF-8 names; fall back to a latin1 read otherwise.
      const isUtf8 = (flags & 0x0800) !== 0
      let rawName
      try {
        rawName = new TextDecoder(isUtf8 ? 'utf-8' : 'windows-1252').decode(nameBytes)
      } catch {
        rawName = new TextDecoder('utf-8').decode(nameBytes)
      }
      offset += 46 + nameLength + extraLength + commentLength
      const name = normalizeEntryName(rawName)
      if (name === null) continue
      if (flags & 0x0001) continue // encrypted entry: never attempt to read it
      if (method !== 0 && method !== 8) continue // unsupported compression method
      if (uncompressedSize > MAX_ENTRY_BYTES) {
        throw new Error(`entry-too-large: ${name} would expand to ${uncompressedSize} bytes`)
      }
      entries.set(name, { method, compressedSize, uncompressedSize, localOffset })
    }
    return new ZipArchive(buffer, entries)
  }

  get names() {
    return [...this.entries.keys()]
  }

  has(name) {
    return this.entries.has(normalizeEntryName(name) ?? '')
  }

  /** Decompressed bytes of one entry, or null when the entry is absent. */
  async read(name) {
    const key = normalizeEntryName(name)
    if (key === null) return null
    const cached = this.cache.get(key)
    if (cached !== undefined) return cached
    const entry = this.entries.get(key)
    if (entry === undefined) return null
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength)
    const local = entry.localOffset
    if (local + 30 > this.buffer.byteLength) throw new Error(`corrupt-zip: ${key} header truncated`)
    if (view.getUint32(local, true) !== LOCAL_SIGNATURE) {
      throw new Error(`corrupt-zip: bad local header for ${key}`)
    }
    const nameLength = view.getUint16(local + 26, true)
    const extraLength = view.getUint16(local + 28, true)
    const dataStart = local + 30 + nameLength + extraLength
    const dataEnd = dataStart + entry.compressedSize
    if (dataEnd > this.buffer.byteLength) throw new Error(`corrupt-zip: ${key} data truncated`)
    const raw = this.buffer.subarray(dataStart, dataEnd)
    let data
    if (entry.method === 0) {
      data = raw
    } else {
      try {
        data = await inflateRaw(raw)
      } catch (error) {
        throw new Error(`corrupt-zip: ${key} failed to inflate (${String(error && error.message)})`)
      }
    }
    this.totalBytes += data.byteLength
    if (this.totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('archive-too-large: total decompressed size exceeds the limit')
    }
    if (this.cache.size > 256) this.cache.clear()
    this.cache.set(key, data)
    return data
  }

  async text(name, decoder = new TextDecoder('utf-8')) {
    const bytes = await this.read(name)
    return bytes === null ? null : decoder.decode(bytes)
  }

  /** Release cached decompressed bytes. */
  close() {
    this.cache.clear()
  }
}
