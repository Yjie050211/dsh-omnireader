/**
 * Reader state store.
 *
 * Persistence is two-layered on purpose:
 *  - canonical JSON under `$DSH_HOME/omnireader/state.json` (host route), which
 *    survives browser-storage clears and is shared by every DSH window;
 *  - a localStorage mirror, used when the host half is not reachable (for
 *    example while the plugin is being reinstalled) and for instant startup.
 *
 * Only metadata is persisted: preferences, per-document reading location,
 * recent list, bookmarks and notes. Document bytes are never stored.
 */

import { apiGet, apiPost, fetchDocumentBytes, report } from './http.js'
import { basename, debounce } from './util.js'
import { detectFormat, openDocument } from '../formats/index.js'

const STORAGE_KEY = 'omnireader.state.v1'
const MAX_TABS = 8
const MAX_RECENT = 30

const DEFAULT_PREFS = Object.freeze({
  theme: 'auto',
  fontSize: 100,
  lineHeight: 1.75,
  flowWidth: 760,
  fontFamily: 'sans',
  showOutline: true,
  showNotes: false,
})

function emptyPersisted() {
  return { version: 1, updatedAt: 0, prefs: { ...DEFAULT_PREFS }, docs: {}, recent: [], bookmarks: {}, notes: {} }
}

function emptyUi() {
  return { search: false, fullscreen: false }
}

function normalizePersisted(value) {
  const base = emptyPersisted()
  if (value === null || typeof value !== 'object') return base
  return {
    version: 1,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
    prefs: { ...DEFAULT_PREFS, ...(value.prefs && typeof value.prefs === 'object' ? value.prefs : {}) },
    docs: value.docs && typeof value.docs === 'object' ? value.docs : {},
    recent: Array.isArray(value.recent) ? value.recent.filter((item) => typeof item === 'string') : [],
    bookmarks: value.bookmarks && typeof value.bookmarks === 'object' ? value.bookmarks : {},
    notes: value.notes && typeof value.notes === 'object' ? value.notes : {},
  }
}

function readLocal() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

function writeLocal(value) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // A full or disabled localStorage must not break reading.
  }
}

function progressOf(tab) {
  const location = tab.location
  if (location === null || location === undefined) return 0
  const model = tab.model
  if (model === null) return 0
  if (model.kind === 'pdf') {
    const page = Number(location.page) || 1
    return Math.min(100, Math.round((page / Math.max(model.numPages, 1)) * 100))
  }
  const chapters = model.chapters ?? []
  const chapter = Math.max(0, Math.min(Number(location.chapter) || 0, Math.max(chapters.length - 1, 0)))
  const blocks = chapters[chapter]?.blocks ?? []
  const block = Math.max(0, Math.min(Number(location.block) || 0, Math.max(blocks.length - 1, 0)))
  const ratio = chapters.length === 0 ? 0 : (chapter + (blocks.length === 0 ? 0 : block / blocks.length)) / chapters.length
  return Math.min(100, Math.max(0, Math.round(ratio * 100)))
}

function describeFailure(error) {
  const message = error instanceof Error ? error.message : String(error)
  const code = message.split(':')[0]
  const known = {
    'unsupported-format': 'error.kindUnsupported',
    'drm-protected': 'error.drm',
    'huff-compression-unsupported': 'error.huff',
    'too-large': 'error.tooLarge',
    'not-a-mobi': 'error.parseFailed',
    'not-an-epub': 'error.parseFailed',
    'not-a-docx': 'error.parseFailed',
    'corrupt-epub': 'error.parseFailed',
    'corrupt-docx': 'error.parseFailed',
    'corrupt-mobi': 'error.parseFailed',
    empty: 'error.empty',
    'archive-too-large': 'error.tooLarge',
  }
  return { message, key: known[code] ?? 'error.parseFailed', detail: message }
}

export function createReaderStore() {
  const persisted = { value: emptyPersisted() }
  let runtime = { tabs: [], activeTabId: null, ui: emptyUi() }
  let host = { status: 'unknown', info: null }
  let ready = false
  let revision = 0
  let snapshotCache = null
  let snapshotRevision = -1
  const listeners = new Set()

  const notify = () => {
    revision += 1
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // A broken subscriber must not break the reader.
      }
    }
  }

  const flushPersist = debounce(() => {
    persisted.value.updatedAt = Date.now()
    writeLocal(persisted.value)
    apiPost('state', { state: persisted.value }).catch(() => {
      // The localStorage mirror remains authoritative until the host returns.
    })
  }, 600)

  const touch = () => {
    flushPersist()
    notify()
  }

  const docRecord = (path) => {
    const existing = persisted.value.docs[path]
    if (existing !== undefined) return existing
    const created = { path, title: basename(path), format: detectFormat(path), location: null, progress: 0, lastOpenedAt: 0 }
    persisted.value.docs[path] = created
    return created
  }

  const saveTabProgress = (tab) => {
    if (tab.path === null || tab.model === null) return
    const record = docRecord(tab.path)
    record.title = tab.title ?? record.title
    record.format = tab.format ?? record.format
    record.location = tab.location
    record.progress = progressOf(tab)
    record.lastOpenedAt = Date.now()
    if (tab.identity !== undefined) record.identity = tab.identity
  }

  const rememberRecent = (path) => {
    const recent = persisted.value.recent.filter((item) => item !== path)
    recent.unshift(path)
    persisted.value.recent = recent.slice(0, MAX_RECENT)
  }

  const disposeTab = (tab) => {
    tab.controller?.abort?.()
    try {
      tab.model?.dispose?.()
    } catch {
      // Disposal is best effort.
    }
    tab.model = null
  }

  const setTab = (id, patch) => {
    runtime = { ...runtime, tabs: runtime.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)) }
  }

  const store = {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot() {
      // React's useSyncExternalStore compares snapshots by identity, so the
      // object is cached per revision instead of being rebuilt on every call.
      if (snapshotCache !== null && snapshotRevision === revision) return snapshotCache
      snapshotRevision = revision
      snapshotCache = {
        revision,
        ready,
        host,
        prefs: persisted.value.prefs,
        docs: persisted.value.docs,
        recent: persisted.value.recent,
        bookmarks: persisted.value.bookmarks,
        notes: persisted.value.notes,
        tabs: runtime.tabs,
        activeTabId: runtime.activeTabId,
        ui: runtime.ui,
      }
      return snapshotCache
    },
    getTab(id) {
      return runtime.tabs.find((tab) => tab.id === id) ?? null
    },
    getActiveTab() {
      return runtime.tabs.find((tab) => tab.id === runtime.activeTabId) ?? null
    },
    progressOf,
    async init() {
      if (ready) return
      const local = readLocal()
      const localValue = local === null ? null : normalizePersisted(local)
      let candidate = localValue
      try {
        const response = await apiGet('state', {})
        host = { status: 'online', info: null }
        const remote = response && response.state ? normalizePersisted(response.state) : null
        if (remote !== null && (candidate === null || remote.updatedAt > candidate.updatedAt)) candidate = remote
        if (remote !== null) host = { ...host, info: response.path ?? null }
      } catch {
        host = { status: 'offline', info: null }
        report('host-offline', {})
      }
      persisted.value = candidate ?? emptyPersisted()
      ready = true
      try {
        const health = await apiGet('health', {})
        host = { status: 'online', info: health }
      } catch {
        host = { status: 'offline', info: null }
      }
      notify()
    },
    setHostStatus(status, info) {
      host = { status, info: info ?? host.info }
      notify()
    },
    async openPath(path, options = {}) {
      if (typeof path !== 'string' || path.length === 0) throw new Error('invalid-path: empty path')
      const name = options.name ?? basename(path)
      const existing = runtime.tabs.find((tab) => tab.path === path)
      if (existing !== undefined) {
        runtime = { ...runtime, activeTabId: existing.id }
        notify()
        return existing
      }
      if (runtime.tabs.length >= MAX_TABS) {
        const victim = runtime.tabs[0]
        store.closeTab(victim.id)
      }
      const tab = {
        id: `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        path,
        name,
        format: detectFormat(name),
        title: name,
        author: '',
        status: 'loading',
        error: null,
        model: null,
        location: null,
        pendingLocation: null,
        identity: undefined,
        controller: new AbortController(),
        startedAt: Date.now(),
      }
      runtime = { ...runtime, tabs: [...runtime.tabs, tab], activeTabId: tab.id }
      notify()
      const started = Date.now()
      try {
        let meta = null
        try {
          meta = await apiGet('meta', { path }, tab.controller.signal)
        } catch {
          meta = null
        }
        const bytes = await fetchDocumentBytes(path, tab.controller.signal)
        if (tab.controller.signal.aborted || store.getTab(tab.id) === null) {
          return null
        }
        const model = await openDocument({ path, name, bytes, signal: tab.controller.signal })
        if (tab.controller.signal.aborted || store.getTab(tab.id) === null) {
          model.dispose?.()
          return null
        }
        const record = docRecord(path)
        const identity = meta === null ? undefined : `${meta.size}:${Math.round(meta.mtimeMs)}`
        const changed = identity !== undefined && record.identity !== undefined && record.identity !== identity
        setTab(tab.id, {
          status: 'ready',
          model,
          title: model.title || name,
          author: model.author ?? '',
          format: model.format ?? detectFormat(name),
          identity,
          location: restoreLocation(model, record.location),
          pendingLocation: null,
          sourceChanged: changed,
        })
        saveTabProgress({ ...tab, model, title: model.title || name, format: model.format, location: restoreLocation(model, record.location), identity })
        rememberRecent(path)
        touch()
        report('opened', {
          path,
          format: model.format,
          ms: Date.now() - started,
          pages: model.numPages ?? null,
          chapters: model.chapters?.length ?? null,
          sourceChanged: changed,
        })
        return store.getTab(tab.id)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return null
        const failure = describeFailure(error)
        setTab(tab.id, { status: 'error', error: failure })
        report('open-failed', { path, message: failure.message })
        notify()
        return store.getTab(tab.id)
      }
    },
    closeTab(id) {
      const tab = runtime.tabs.find((item) => item.id === id)
      if (tab === undefined) return
      saveTabProgress(tab)
      disposeTab(tab)
      const remaining = runtime.tabs.filter((item) => item.id !== id)
      const activeTabId = runtime.activeTabId === id ? (remaining[remaining.length - 1]?.id ?? null) : runtime.activeTabId
      runtime = { ...runtime, tabs: remaining, activeTabId }
      touch()
    },
    closeActiveTab() {
      if (runtime.activeTabId !== null) store.closeTab(runtime.activeTabId)
    },
    activateTab(id) {
      if (runtime.tabs.some((tab) => tab.id === id)) {
        runtime = { ...runtime, activeTabId: id }
        notify()
      }
    },
    setLocation(id, location) {
      const tab = store.getTab(id)
      if (tab === null) return
      setTab(id, { location })
      saveTabProgress({ ...tab, location })
      touch()
    },
    requestJump(id, target) {
      const tab = store.getTab(id)
      if (tab === null) return
      setTab(id, { pendingLocation: { seq: (tab.pendingLocation?.seq ?? 0) + 1, ...target } })
      notify()
    },
    consumeJump(id, seq) {
      const tab = store.getTab(id)
      if (tab !== null && tab.pendingLocation?.seq === seq) setTab(id, { pendingLocation: null })
    },
    setPrefs(patch) {
      persisted.value.prefs = { ...persisted.value.prefs, ...patch }
      touch()
    },
    setUi(patch) {
      runtime = { ...runtime, ui: { ...runtime.ui, ...patch } }
      notify()
    },
    listBookmarks(path) {
      return persisted.value.bookmarks[path] ?? []
    },
    addBookmark(id, label) {
      const tab = store.getTab(id)
      if (tab === null || tab.location === null) return null
      const list = [...(persisted.value.bookmarks[tab.path] ?? [])]
      const bookmark = {
        id: `bm-${Date.now().toString(36)}`,
        label: label ?? tab.model?.chapters?.[tab.location.chapter]?.title ?? `${tab.location.page ?? ''}`,
        location: tab.location,
        createdAt: Date.now(),
      }
      list.unshift(bookmark)
      persisted.value.bookmarks = { ...persisted.value.bookmarks, [tab.path]: list.slice(0, 200) }
      touch()
      return bookmark
    },
    removeBookmark(path, bookmarkId) {
      const list = (persisted.value.bookmarks[path] ?? []).filter((item) => item.id !== bookmarkId)
      persisted.value.bookmarks = { ...persisted.value.bookmarks, [path]: list }
      touch()
    },
    listNotes(path) {
      return persisted.value.notes[path] ?? []
    },
    addNote(id, text) {
      const tab = store.getTab(id)
      const value = String(text ?? '').trim()
      if (tab === null || value.length === 0) return null
      const notes = [...(persisted.value.notes[tab.path] ?? [])]
      const note = { id: `note-${Date.now().toString(36)}`, text: value, location: tab.location, createdAt: Date.now() }
      notes.unshift(note)
      persisted.value.notes = { ...persisted.value.notes, [tab.path]: notes.slice(0, 500) }
      touch()
      return note
    },
    removeNote(path, noteId) {
      const notes = (persisted.value.notes[path] ?? []).filter((item) => item.id !== noteId)
      persisted.value.notes = { ...persisted.value.notes, [path]: notes }
      touch()
    },
    forgetDocument(path) {
      delete persisted.value.docs[path]
      delete persisted.value.bookmarks[path]
      delete persisted.value.notes[path]
      persisted.value.recent = persisted.value.recent.filter((item) => item !== path)
      touch()
    },
    resetPreferences() {
      persisted.value.prefs = { ...DEFAULT_PREFS }
      touch()
    },
    /** Host-persisted state, exposed for the settings / export view. */
    exportState() {
      return JSON.parse(JSON.stringify(persisted.value))
    },
    importState(value) {
      persisted.value = normalizePersisted(value)
      touch()
    },
  }
  return store
}

/** Map a persisted location onto a freshly parsed model, clamping stale data. */
export function restoreLocation(model, location) {
  if (model === null) return null
  if (model.kind === 'pdf') {
    const page = Math.min(Math.max(Number(location?.page) || 1, 1), Math.max(model.numPages, 1))
    const scale = Number(location?.scale)
    return { page, scale: Number.isFinite(scale) ? scale : 0, rotation: Number(location?.rotation) || 0 }
  }
  const chapters = model.chapters ?? []
  if (chapters.length === 0) return null
  const chapter = Math.min(Math.max(Number(location?.chapter) || 0, 0), chapters.length - 1)
  const blocks = chapters[chapter]?.blocks ?? []
  const block = Math.min(Math.max(Number(location?.block) || 0, 0), Math.max(blocks.length - 1, 0))
  return { chapter, block, ...(location?.anchor ? { anchor: location.anchor } : {}) }
}

export const readerStore = createReaderStore()
