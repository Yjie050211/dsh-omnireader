/** Small shared helpers for the OmniReader client half. */

export function basename(path) {
  if (typeof path !== 'string') return ''
  const normalized = path.replace(/[\\/]+$/, '')
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return index === -1 ? normalized : normalized.slice(index + 1)
}

export function dirname(path) {
  if (typeof path !== 'string') return ''
  const normalized = path.replace(/[\\/]+$/, '')
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return index <= 0 ? normalized : normalized.slice(0, index)
}

export function extname(path) {
  const name = basename(path)
  const index = name.lastIndexOf('.')
  return index <= 0 ? '' : name.slice(index).toLowerCase()
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

export function formatTime(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const date = new Date(ms)
  const now = Date.now()
  const delta = now - ms
  if (delta >= 0 && delta < 86_400_000) {
    const minutes = Math.floor(delta / 60_000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes} min ago`
    return `${Math.floor(minutes / 60)} h ago`
  }
  return date.toLocaleDateString()
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function debounce(fn, wait) {
  let timer = null
  const wrapped = (...args) => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, wait)
  }
  wrapped.cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  return wrapped
}

export function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

let sequence = 0
export function uid(prefix = 'id') {
  sequence += 1
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`
}

export function abbreviation(text, length = 60) {
  if (typeof text !== 'string') return ''
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= length ? flat : `${flat.slice(0, length - 1)}…`
}

/**
 * Breaks an absolute path into clickable segments. Windows volumes render as a
 * single segment (`D:`); POSIX paths start at `/`. Segments carry the absolute
 * path they address so the picker can jump without re-deriving it.
 */
export function pathBreadcrumbs(path) {
  const value = String(path ?? '')
  if (value.length === 0) return []
  if (/^[A-Za-z]:[\\/]/u.test(value)) {
    const normalized = value.replace(/\//gu, '\\')
    const root = normalized.slice(0, 2).toUpperCase() + normalized.slice(2, 3)
    const crumbs = [{ label: normalized.slice(0, 2).toUpperCase(), path: root }]
    let current = root
    for (const name of normalized.slice(3).split('\\').filter(Boolean)) {
      current = current.endsWith('\\') ? `${current}${name}` : `${current}\\${name}`
      crumbs.push({ label: name, path: current })
    }
    return crumbs
  }
  const crumbs = [{ label: '/', path: '/' }]
  let current = ''
  for (const name of value.split('/').filter(Boolean)) {
    current = `${current}/${name}`
    crumbs.push({ label: name, path: current })
  }
  return crumbs
}
