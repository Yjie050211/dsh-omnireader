/**
 * Client → Host transport.
 *
 * Everything goes through the loopback HTTP surface mounted by this package's
 * host half under `/api/omnireader`. The page is served with `<base href="./">`,
 * so request paths stay document-relative (same convention as other Harness
 * plugins). Requests are same-origin and therefore authenticated by the session
 * cookie the browser already holds.
 */

export const API_PREFIX = 'api/omnireader'

export function apiUrl(name, params) {
  const query = params === undefined ? '' : `?${new URLSearchParams(params).toString()}`
  return `${API_PREFIX}/${name}${query}`
}

export function assetUrl(name) {
  return apiUrl('asset', { name })
}

function errorFromBody(body, fallback) {
  const error = body && body.error
  if (error && typeof error === 'object') {
    return new Error(`${error.code ?? 'error'}: ${error.message ?? ''}`)
  }
  if (typeof error === 'string') return new Error(error)
  return new Error(fallback)
}

export async function apiGet(name, params, signal) {
  const response = await fetch(apiUrl(name, params), {
    cache: 'no-store',
    headers: { accept: 'application/json' },
    signal,
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    // An unmounted route answers with plain text, so report that distinctly.
    throw new Error(`${name}: unexpected response (HTTP ${response.status})`)
  }
  if (!response.ok || body.ok === false) throw errorFromBody(body, `${name}: HTTP ${response.status}`)
  return body
}

export async function apiPost(name, payload, signal) {
  const response = await fetch(apiUrl(name), {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`${name}: unexpected response (HTTP ${response.status})`)
  }
  if (!response.ok || body.ok === false) throw errorFromBody(body, `${name}: HTTP ${response.status}`)
  return body
}

/** Raw bytes of one document, read with the host's file-size cap. */
export async function fetchDocumentBytes(path, signal) {
  const response = await fetch(apiUrl('file', { path }), { cache: 'no-store', signal })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let message = `HTTP ${response.status}`
    try {
      message = errorFromBody(JSON.parse(text), message).message
    } catch {
      /* keep the status text */
    }
    throw new Error(message)
  }
  const buffer = await response.arrayBuffer()
  return new Uint8Array(buffer)
}

/**
 * Cheap reachability probe for a directory.
 *
 * A HEAD on the file route stats the path without reading it: the host answers
 * `not-a-file` for a directory it can reach (HTTP 400) and `not-found` for a
 * path that does not exist or cannot be read (HTTP 404). Used to discover the
 * volumes offered by the file picker without listing them.
 */
export async function probeDirectory(path, signal) {
  try {
    const response = await fetch(apiUrl('file', { path }), {
      method: 'HEAD',
      cache: 'no-store',
      signal,
    })
    return response.status === 400 || response.status === 200
  } catch {
    return false
  }
}

/** Best-effort diagnostics; never throws into a render pass. */
/** Serialized so concurrent diagnostics never interleave on the host file. */
let diagQueue = Promise.resolve()

export function report(event, detail) {
  const record = { source: 'client', event, detail }
  diagQueue = diagQueue.then(() => apiPost('diag', record)).catch(() => {})
  return diagQueue
}
