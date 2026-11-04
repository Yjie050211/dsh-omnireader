/**
 * Drive / volume discovery for the file picker.
 *
 * The plugin's host route only exposes directory listings, so volumes are
 * discovered from the client by probing each candidate root with a HEAD
 * request: the host answers `not-a-file` (HTTP 400) for a directory it can
 * reach and `not-found` (HTTP 404) for a volume that does not exist or is not
 * readable. That keeps the probe cheap (one stat per candidate) and avoids
 * widening any permission: a volume the reader cannot read is simply not
 * offered.
 *
 * The result is memoised for the lifetime of the page; a volume appearing
 * later can be reached through the path field or the system folder chooser.
 */

import { probeDirectory } from './http.js'

const WINDOWS_LETTERS = 'CDEFGHIJKLMNOPQRSTUVWXYZAB'.split('')
const PROBE_TIMEOUT_MS = 2200

let cached = null
let inflight = null

function isWindows() {
  if (typeof navigator === 'undefined') return false
  return /windows/i.test(String(navigator.userAgent ?? ''))
}

function deadline(signal, ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  const forward = () => controller.abort()
  if (signal !== undefined && signal !== null) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', forward, { once: true })
  }
  return {
    signal: controller.signal,
    done() {
      clearTimeout(timer)
      if (signal !== undefined && signal !== null) signal.removeEventListener('abort', forward)
    },
  }
}

async function probeRoot(path, signal) {
  const timer = deadline(signal, PROBE_TIMEOUT_MS)
  try {
    return await probeDirectory(path, timer.signal)
  } finally {
    timer.done()
  }
}

/**
 * Volumes the reader can browse.
 *
 * @param {AbortSignal} [signal] cancels the pending probes.
 * @returns {Promise<Array<{ label: string, path: string, kind: 'drive' }>>}
 */
export function discoverDrives(signal) {
  if (cached !== null) return Promise.resolve(cached)
  if (inflight !== null) return inflight
  inflight = (async () => {
    if (!isWindows()) {
      const ok = await probeRoot('/', signal)
      cached = ok ? [{ label: '/', path: '/', kind: 'drive' }] : []
      return cached
    }
    const claims = WINDOWS_LETTERS.map(async (letter) => {
      const path = `${letter}:\\`
      const ok = await probeRoot(path, signal)
      return ok ? { label: `${letter}:`, path, kind: 'drive' } : null
    })
    const settled = await Promise.all(claims)
    const found = settled.filter((entry) => entry !== null)
    // A probe that could not reach even one volume must not leave the picker
    // without a starting point.
    cached = found.length > 0 ? found : [{ label: 'C:', path: 'C:\\', kind: 'drive' }]
    return cached
  })().finally(() => {
    inflight = null
  })
  return inflight
}

/** Test seam: forget the memoised volume list. */
export function resetDriveCache() {
  cached = null
  inflight = null
}
