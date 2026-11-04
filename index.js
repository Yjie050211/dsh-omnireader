/**
 * DSH OmniReader — Host half.
 *
 * Registers a small authenticated-by-locality HTTP surface used by the browser
 * half of this same package:
 *
 *   GET  /api/omnireader/health          liveness + configuration report
 *   GET  /api/omnireader/roots           suggested browsing roots for the reader
 *   GET  /api/omnireader/list?path=      one directory listing (no content)
 *   GET  /api/omnireader/meta?path=      size/mtime identity of one file
 *   GET  /api/omnireader/text?path=      UTF-8 text of one file (capped)
 *   GET  /api/omnireader/file?path=       raw bytes of one file (capped)
 *   GET  /api/omnireader/asset?name=     one packaged runtime asset (allowlisted)
 *   GET  /api/omnireader/state           persisted reader state (JSON)
 *   POST /api/omnireader/state           replace persisted reader state atomically
 *   GET  /api/omnireader/diag            recent diagnostics written by the UI
 *   POST /api/omnireader/diag            append one diagnostic record
 *
 * Design notes:
 * - Only loopback callers are accepted. The reader is a local-first tool; the
 *   route never widens file access beyond what the local OS user already has.
 * - Every file response is bounded (`maxFileBytes` / `maxTextBytes`) so a
 *   damaged or oversized document cannot exhaust the host process.
 * - State and diagnostics live under `$DSH_HOME/omnireader/`, never inside the
 *   workspace, and are written atomically so a crash cannot corrupt them.
 * - All resources are registered inside `apply` through `ctx.effect`-owned
 *   registrations, so disabling the plugin removes every route again.
 *
 * @module dsh-omnireader
 */

import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, rename, stat, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-omnireader'

/** Host services required before `apply` runs. */
export const inject = ['webServer']

const API_PREFIX = '/api/omnireader'
const DEFAULT_MAX_FILE_BYTES = 256 * 1024 * 1024
const DEFAULT_MAX_TEXT_BYTES = 32 * 1024 * 1024
const MAX_STATE_BYTES = 8 * 1024 * 1024
const MAX_DIAG_BODY_BYTES = 256 * 1024
const MAX_DIAG_LINES = 5000
const MAX_LIST_ENTRIES = 2000

/**
 * Packaged runtime assets that the browser half may fetch. Explicitly
 * allowlisted: the route never reads a path supplied by the caller.
 */
const ASSET_ALLOWLIST = Object.freeze({
  'pdf-worker': ['lib', 'pdf.worker.min.mjs'],
})

const MIME_BY_EXTENSION = Object.freeze({
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.epub': 'application/epub+zip',
  '.mobi': 'application/x-mobipocket-ebook',
  '.azw': 'application/vnd.amazon.ebook',
  '.azw3': 'application/vnd.amazon.ebook',
  '.kf8': 'application/vnd.amazon.ebook',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
})

/** Directory roots the reader may suggest as browsing starting points. */
function suggestedRoots(workspaceRoot) {
  const roots = []
  const seen = new Set()
  const push = (label, path) => {
    if (typeof path !== 'string' || path.length === 0) return
    let normalized
    try {
      normalized = resolvePath(path)
    } catch {
      return
    }
    const key = normalized.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    roots.push({ label, path: normalized })
  }
  push('workspace', workspaceRoot)
  push('home', homedir())
  push('desktop', join(homedir(), 'Desktop'))
  push('documents', join(homedir(), 'Documents'))
  push('downloads', join(homedir(), 'Downloads'))
  return roots
}

/** True when the socket peer is this machine. */
function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? ''
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1' ||
    address.startsWith('127.')
  )
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

function sendFailure(res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, message } })
}

/**
 * Normalize one user-supplied absolute path. Returns `null` for anything that
 * is not a plain absolute path: no control characters, no UNC/device paths,
 * bounded length. Traversal is impossible for an absolute path; the file
 * identity checks below reject directories and special files.
 */
function normalizeAbsolutePath(raw) {
  if (typeof raw !== 'string') return null
  if (raw.length === 0 || raw.length > 4096) return null
  if (!isAbsolute(raw)) return null
  // Reject control characters (including NUL) outright.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null
  // Reject Windows device namespaces and UNC roots: the reader only browses
  // ordinary drive/posix paths that a file manager can open as well.
  if (raw.startsWith('\\\\') || raw.startsWith('//')) return null
  try {
    return resolvePath(raw)
  } catch {
    return null
  }
}

async function readRequestBody(req, maxBytes) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > maxBytes) {
      const error = new Error('request body exceeds limit')
      error.code = 'body-too-large'
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function jsonContentType(req) {
  const header = req.headers['content-type']
  return typeof header === 'string' && header.toLowerCase().startsWith('application/json')
}

/** Read the persisted diagnostic log, tolerating a missing or broken file. */
async function readDiagnostics(file, limit) {
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return { entries: [], total: 0 }
    throw error
  }
  const lines = raw.split('\n').filter((line) => line.trim().length > 0)
  const tail = lines.slice(Math.max(0, lines.length - limit))
  const entries = []
  for (const line of tail) {
    try {
      entries.push(JSON.parse(line))
    } catch {
      entries.push({ kind: 'unparsed', raw: line.slice(0, 400) })
    }
  }
  return { entries, total: lines.length }
}

/**
 * Build the HTTP handler. Kept as a factory so the plugin can share the
 * resolved configuration with closures and dispose everything together.
 */
function createHandler(ctx, options) {
  const { stateFile, diagFile, maxFileBytes, maxTextBytes, assetDir } = options

  const ensureDir = () => mkdir(dirname(stateFile), { recursive: true })

  const routeHandlers = new Map()
  // Serialize diagnostic appends: the file is rewritten atomically, so concurrent
  // read-modify-write cycles would drop records written by another request.
  let diagWriteQueue = Promise.resolve()

  routeHandlers.set(`${API_PREFIX}/health`, async (req, res) => {
    if (req.method !== 'GET') return sendFailure(res, 405, 'method-not-allowed', 'GET required')
    sendJson(res, 200, {
      ok: true,
      name,
      version: options.version,
      maxFileBytes,
      maxTextBytes,
      stateFile,
      diagFile,
      cwd: process.cwd(),
      roots: suggestedRoots(options.workspaceRoot),
    })
  })

  routeHandlers.set(`${API_PREFIX}/roots`, async (req, res) => {
    if (req.method !== 'GET') return sendFailure(res, 405, 'method-not-allowed', 'GET required')
    sendJson(res, 200, { ok: true, roots: suggestedRoots(options.workspaceRoot) })
  })

  routeHandlers.set(`${API_PREFIX}/list`, async (req, res, url) => {
    if (req.method !== 'GET') return sendFailure(res, 405, 'method-not-allowed', 'GET required')
    const target = normalizeAbsolutePath(url.searchParams.get('path'))
    if (target === null) return sendFailure(res, 400, 'invalid-path', 'an absolute path is required')
    let info
    try {
      info = await stat(target)
    } catch (error) {
      return sendFailure(res, 404, 'not-found', describeFsError(error))
    }
    if (!info.isDirectory()) return sendFailure(res, 400, 'not-a-directory', 'path is not a directory')
    let dirents
    try {
      dirents = await readdir(target, { withFileTypes: true })
    } catch (error) {
      return sendFailure(res, 403, 'unreadable', describeFsError(error))
    }
    const entries = []
    for (const dirent of dirents.slice(0, MAX_LIST_ENTRIES)) {
      if (dirent.name.startsWith('.')) continue
      const childPath = join(target, dirent.name)
      let childInfo
      try {
        childInfo = await stat(childPath)
      } catch {
        continue
      }
      const type = childInfo.isDirectory() ? 'directory' : childInfo.isFile() ? 'file' : 'other'
      if (type === 'other') continue
      entries.push({
        name: dirent.name,
        path: childPath,
        type,
        size: type === 'file' ? childInfo.size : 0,
        mtimeMs: childInfo.mtimeMs,
      })
    }
    entries.sort((left, right) => {
      if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
      return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    })
    const parent = dirname(target)
    sendJson(res, 200, {
      ok: true,
      path: target,
      parent: parent === target ? null : parent,
      truncated: dirents.length > MAX_LIST_ENTRIES,
      entries,
    })
  })

  routeHandlers.set(`${API_PREFIX}/meta`, async (req, res, url) => {
    if (req.method !== 'GET') return sendFailure(res, 405, 'method-not-allowed', 'GET required')
    const target = normalizeAbsolutePath(url.searchParams.get('path'))
    if (target === null) return sendFailure(res, 400, 'invalid-path', 'an absolute path is required')
    let info
    try {
      info = await stat(target)
    } catch (error) {
      return sendFailure(res, 404, 'not-found', describeFsError(error))
    }
    if (!info.isFile()) return sendFailure(res, 400, 'not-a-file', 'path is not a regular file')
    sendJson(res, 200, {
      ok: true,
      path: target,
      size: info.size,
      mtimeMs: info.mtimeMs,
      identity: `${info.size}:${Math.round(info.mtimeMs)}`,
      extension: extname(target).toLowerCase(),
      name: basename(target),
    })
  })

  routeHandlers.set(`${API_PREFIX}/text`, async (req, res, url) => {
    if (req.method !== 'GET') return sendFailure(res, 405, 'method-not-allowed', 'GET required')
    const target = normalizeAbsolutePath(url.searchParams.get('path'))
    if (target === null) return sendFailure(res, 400, 'invalid-path', 'an absolute path is required')
    let info
    try {
      info = await stat(target)
    } catch (error) {
      return sendFailure(res, 404, 'not-found', describeFsError(error))
    }
    if (!info.isFile()) return sendFailure(res, 400, 'not-a-file', 'path is not a regular file')
    if (info.size > maxTextBytes) {
      return sendFailure(res, 413, 'too-large', `file exceeds the ${maxTextBytes} byte text limit`)
    }
    const buffer = await readFile(target)
    sendText(res, 200, buffer.toString('utf8'))
  })

  routeHandlers.set(`${API_PREFIX}/file`, async (req, res, url) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendFailure(res, 405, 'method-not-allowed', 'GET or HEAD required')
    }
    const target = normalizeAbsolutePath(url.searchParams.get('path'))
    if (target === null) return sendFailure(res, 400, 'invalid-path', 'an absolute path is required')
    let info
    try {
      info = await stat(target)
    } catch (error) {
      return sendFailure(res, 404, 'not-found', describeFsError(error))
    }
    if (!info.isFile()) return sendFailure(res, 400, 'not-a-file', 'path is not a regular file')
    if (info.size > maxFileBytes) {
      return sendFailure(res, 413, 'too-large', `file exceeds the ${maxFileBytes} byte limit`)
    }
    const contentType = MIME_BY_EXTENSION[extname(target).toLowerCase()] ?? 'application/octet-stream'
    const headers = {
      'content-type': contentType,
      'content-length': info.size,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(basename(target))}`,
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, headers)
      res.end()
      return
    }
    res.writeHead(200, headers)
    const stream = createReadStream(target)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  })

  routeHandlers.set(`${API_PREFIX}/asset`, async (req, res, url) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendFailure(res, 405, 'method-not-allowed', 'GET or HEAD required')
    }
    const name = url.searchParams.get('name') ?? ''
    const segments = ASSET_ALLOWLIST[name]
    if (segments === undefined) return sendFailure(res, 404, 'unknown-asset', 'no such packaged asset')
    if (typeof assetDir !== 'string') return sendFailure(res, 404, 'no-asset-dir', 'assets are not mounted')
    const target = join(assetDir, ...segments)
    let info
    try {
      info = await stat(target)
    } catch (error) {
      return sendFailure(res, 404, 'not-found', describeFsError(error))
    }
    if (!info.isFile()) return sendFailure(res, 404, 'not-found', 'asset is not a regular file')
    const headers = {
      'content-type': 'text/javascript; charset=utf-8',
      'content-length': info.size,
      'cache-control': 'private, max-age=0, must-revalidate',
      'x-content-type-options': 'nosniff',
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, headers)
      res.end()
      return
    }
    res.writeHead(200, headers)
    const stream = createReadStream(target)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  })

  routeHandlers.set(`${API_PREFIX}/state`, async (req, res) => {
    if (req.method === 'GET') {
      try {
        const raw = await readFile(stateFile, 'utf8')
        let parsed = null
        try {
          parsed = JSON.parse(raw)
        } catch {
          parsed = null
        }
        sendJson(res, 200, { ok: true, state: parsed, path: stateFile })
      } catch (error) {
        if (error && error.code === 'ENOENT') {
          sendJson(res, 200, { ok: true, state: null, path: stateFile })
          return
        }
        sendFailure(res, 500, 'state-unreadable', describeFsError(error))
      }
      return
    }
    if (req.method !== 'POST') return sendFailure(res, 405, 'method-not-allowed', 'GET or POST required')
    if (!jsonContentType(req)) return sendFailure(res, 415, 'content-type', 'application/json required')
    let body
    try {
      body = await readRequestBody(req, MAX_STATE_BYTES)
    } catch (error) {
      if (error && error.code === 'body-too-large') return sendFailure(res, 413, 'too-large', error.message)
      return sendFailure(res, 400, 'bad-body', describeFsError(error))
    }
    let payload
    try {
      payload = JSON.parse(body.toString('utf8'))
    } catch {
      return sendFailure(res, 400, 'bad-json', 'body is not valid JSON')
    }
    const state = payload?.state
    if (state === null || typeof state !== 'object' || Array.isArray(state)) {
      return sendFailure(res, 400, 'bad-state', 'payload.state must be an object')
    }
    const serialized = JSON.stringify(state)
    if (serialized.length > MAX_STATE_BYTES) {
      return sendFailure(res, 413, 'too-large', 'serialized state exceeds the limit')
    }
    try {
      await ensureDir()
      const temporary = `${stateFile}.tmp-${process.pid}-${Date.now()}`
      await writeFile(temporary, serialized, 'utf8')
      await rename(temporary, stateFile)
    } catch (error) {
      return sendFailure(res, 500, 'state-unwritable', describeFsError(error))
    }
    sendJson(res, 200, { ok: true, bytes: Buffer.byteLength(serialized), path: stateFile })
  })

  routeHandlers.set(`${API_PREFIX}/diag`, async (req, res, url) => {
    if (req.method === 'GET') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 1000)
      try {
        const { entries, total } = await readDiagnostics(diagFile, limit)
        sendJson(res, 200, { ok: true, total, entries, path: diagFile })
      } catch (error) {
        sendFailure(res, 500, 'diag-unreadable', describeFsError(error))
      }
      return
    }
    if (req.method !== 'POST') return sendFailure(res, 405, 'method-not-allowed', 'GET or POST required')
    if (!jsonContentType(req)) return sendFailure(res, 415, 'content-type', 'application/json required')
    let body
    try {
      body = await readRequestBody(req, MAX_DIAG_BODY_BYTES)
    } catch (error) {
      if (error && error.code === 'body-too-large') return sendFailure(res, 413, 'too-large', error.message)
      return sendFailure(res, 400, 'bad-body', describeFsError(error))
    }
    let record
    try {
      record = JSON.parse(body.toString('utf8'))
    } catch {
      return sendFailure(res, 400, 'bad-json', 'body is not valid JSON')
    }
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      return sendFailure(res, 400, 'bad-record', 'diagnostic record must be an object')
    }
    const line = JSON.stringify({
      at: new Date().toISOString(),
      pid: process.pid,
      ...record,
    })
    try {
      await ensureDir()
      const queued = diagWriteQueue.then(() => appendDiagLine(diagFile, line))
      diagWriteQueue = queued.catch(() => {})
      await queued
      sendJson(res, 200, { ok: true })
    } catch (error) {
      sendFailure(res, 500, 'diag-unwritable', describeFsError(error))
    }
  })

  return async function handler(req, res) {
    const startedAt = Date.now()
    try {
      if (!isLoopback(req)) {
        sendFailure(res, 403, 'forbidden', 'OmniReader routes are loopback-only')
        return
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const pathname = url.pathname.replace(/\/+$/u, '')
      const route = routeHandlers.get(pathname)
      if (route === undefined) {
        sendFailure(res, 404, 'not-found', 'unknown OmniReader route')
        return
      }
      await route(req, res, url)
    } catch (error) {
      if (!res.headersSent) sendFailure(res, 500, 'internal', describeFsError(error))
      else res.destroy()
    } finally {
      ctx.logger?.debug?.(`omnireader ${req.method} ${req.url} ${Date.now() - startedAt}ms`)
    }
  }
}

/** Append one line, rotating the log when it grows past the line budget. */
async function appendDiagLine(file, line) {
  let existing = ''
  try {
    existing = await readFile(file, 'utf8')
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error
  }
  const lines = existing.length === 0 ? [] : existing.split('\n').filter((entry) => entry.trim().length > 0)
  lines.push(line)
  if (lines.length > MAX_DIAG_LINES) lines.splice(0, lines.length - MAX_DIAG_LINES)
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, `${lines.join('\n')}\n`, 'utf8')
  await rename(temporary, file)
}

function describeFsError(error) {
  if (error === null || error === undefined) return 'unknown error'
  const code = typeof error.code === 'string' ? error.code : ''
  const message = typeof error.message === 'string' ? error.message : String(error)
  return code.length > 0 ? `${code}: ${message}` : message
}

/** Resolve the DSH home directory the same way the Harness does. */
function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return resolvePath(fromEnv.trim())
  return join(homedir(), '.dsh')
}

/**
 * Process-wide route bookkeeping shared across generations of this Host half.
 *
 * @returns {{ routes: Array<() => void> }}
 */
function getHostState() {
  const key = Symbol.for('dsh-omnireader.host-state')
  const current = globalThis[key]
  if (current !== null && current !== undefined && Array.isArray(current.routes)) {
    return current
  }
  const state = { routes: [] }
  Object.defineProperty(globalThis, key, {
    value: state,
    configurable: true,
    enumerable: false,
    writable: false,
  })
  return state
}

/**
 * Activate the host half: mount the route table and leak nothing outside the
 * returned disposer.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ workspaceRoot?: string }} [config]
 */
export function apply(ctx, config = {}) {
  const dshHome = resolveDshHome()
  const dataDir = join(dshHome, 'omnireader')
  const workspaceRoot =
    typeof config?.workspaceRoot === 'string' && config.workspaceRoot.length > 0
      ? config.workspaceRoot
      : process.cwd()

  const handler = createHandler(ctx, {
    stateFile: join(dataDir, 'state.json'),
    diagFile: join(dataDir, 'diagnostics.jsonl'),
    assetDir: dirname(fileURLToPath(import.meta.url)),
    maxFileBytes: DEFAULT_MAX_FILE_BYTES,
    maxTextBytes: DEFAULT_MAX_TEXT_BYTES,
    workspaceRoot,
    version: '0.1.0',
  })

  const routes = [
    'health',
    'roots',
    'list',
    'meta',
    'text',
    'file',
    'asset',
    'state',
    'diag',
  ].map((name) => ({
    kind: 'exact',
    path: `${API_PREFIX}/${name}`,
    handler,
  }))

  // Route lifecycle. Routes are owned by a process-wide registry, not only by
  // this fiber: the Host half can be re-activated in the same process (disable
  // then enable) while a previous generation still holds its exact routes, and
  // `webServer.register` rejects duplicates. Disposing the previous generation
  // first keeps re-activation idempotent instead of leaving stale handlers
  // mounted. The registry hangs off globalThis so it also survives a module
  // re-import of this file.
  const hostState = getHostState()
  for (const dispose of hostState.routes.splice(0)) {
    try {
      dispose()
    } catch (error) {
      ctx.logger?.warn?.(`[omnireader] stale route cleanup failed: ${error?.message ?? error}`)
    }
  }
  for (const route of routes) {
    let dispose = null
    try {
      dispose = ctx.webServer.register(route)
    } catch (error) {
      ctx.logger?.warn?.(`[omnireader] route ${route.path} could not be mounted: ${error?.message ?? error}`)
      continue
    }
    hostState.routes.push(dispose)
    let released = false
    const release = () => {
      if (released) return
      released = true
      const index = hostState.routes.indexOf(dispose)
      if (index !== -1) hostState.routes.splice(index, 1)
      try {
        dispose()
      } catch {
        // The route is already gone; nothing left to release.
      }
    }
    ctx.effect(() => release)
  }

  // Best-effort startup diagnostics so the host log records the mounted data
  // directory and limits; this never contains document content.
  ctx.logger?.info?.(
    `[omnireader] host routes mounted at ${API_PREFIX} (data: ${dataDir}, maxFileBytes: ${DEFAULT_MAX_FILE_BYTES})`,
  )

}

export default { name, inject, apply }
