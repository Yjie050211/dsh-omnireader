/**
 * Document parsing helpers: byte decoding, DOM parsing and namespace-aware
 * traversal. Everything here is defensive: a malformed document must surface a
 * readable error, never an unhandled exception in a render pass.
 */

const HTML_NAMESPACES = ['http://www.w3.org/1999/xhtml']

export function decodeText(bytes, options = {}) {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const hint = options.hint ?? 'auto'
  // Byte-order marks win over every heuristic.
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buffer.subarray(3))
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer.subarray(2))
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer.subarray(2))
  }
  if (hint === 'utf-8') return new TextDecoder('utf-8').decode(buffer)
  if (hint === 'windows-1252' || hint === 'latin1') {
    return new TextDecoder('windows-1252').decode(buffer)
  }
  // Sniff the XML/HTML declaration for a charset first.
  const head = new TextDecoder('windows-1252').decode(buffer.subarray(0, 512))
  const declared = /encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)
  if (declared !== null) {
    const label = declared[1].toLowerCase()
    if (label !== 'utf-8' && label !== 'utf8') {
      try {
        return new TextDecoder(label).decode(buffer)
      } catch {
        /* unknown label: fall through */
      }
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('windows-1252').decode(buffer)
  }
}

export function parseHtmlDocument(text) {
  const document = new DOMParser().parseFromString(text, 'text/html')
  return document
}

/** Parse an XML document; returns null when the XML is not well formed. */
export function parseXmlDocument(text) {
  try {
    const document = new DOMParser().parseFromString(text, 'application/xml')
    if (document.getElementsByTagName('parsererror').length > 0) return null
    return document
  } catch {
    return null
  }
}

/** Parse an HTML fragment into a detached, inert template content node. */
export function parseFragment(text) {
  const template = document.createElement('template')
  template.innerHTML = text
  return template.content
}

export function localName(node) {
  return node && typeof node.localName === 'string' ? node.localName.toLowerCase() : ''
}

/** Direct element children matching one local name (namespace agnostic). */
export function childElements(node, name) {
  const result = []
  if (!node) return result
  for (const child of node.children) {
    if (name === undefined || localName(child) === name) result.push(child)
  }
  return result
}

/** First descendant element with one local name (namespace agnostic). */
export function descendant(node, name) {
  if (!node) return null
  for (const child of node.children) {
    if (localName(child) === name) return child
    const nested = descendant(child, name)
    if (nested !== null) return nested
  }
  return null
}

export function descendants(node, name) {
  const result = []
  const visit = (current) => {
    if (!current) return
    for (const child of current.children) {
      if (localName(child) === name) result.push(child)
      visit(child)
    }
  }
  visit(node)
  return result
}

export function attr(node, name) {
  if (!node || typeof node.getAttribute !== 'function') return null
  return node.getAttribute(name)
}

/** Namespaced attribute lookup by local name (e.g. r:id, xlink:href). */
export function attrAny(node, name) {
  if (!node) return null
  const direct = node.getAttribute(name)
  if (direct !== null) return direct
  for (const attribute of node.attributes) {
    if (attribute.localName === name) return attribute.value
  }
  return null
}

export function textOf(node) {
  return node === null || node === undefined ? '' : (node.textContent ?? '')
}

export function isHtmlNamespace(node) {
  return node !== null && HTML_NAMESPACES.includes(node.namespaceURI)
}
