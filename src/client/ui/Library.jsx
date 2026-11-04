import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet } from '../lib/http.js'
import { discoverDrives } from '../lib/drives.js'
import { basename, formatBytes, formatTime, pathBreadcrumbs } from '../lib/util.js'
import { FORMAT_LABELS, extensionOf, isReadable } from '../formats/index.js'
import { Glyph } from './icons.jsx'

// The last directory the user browsed, so reopening the picker resumes there.
let lastBrowsedDirectory = null

const ROOT_LABELS = {
  workspace: 'library.rootWorkspace',
  home: 'library.rootHome',
  desktop: 'library.rootDesktop',
  documents: 'library.rootDocuments',
  downloads: 'library.rootDownloads',
}

/**
 * File picker for local documents. The plugin's host route lists directories
 * under the Harness file policy and never widens it; volumes are discovered
 * from the client, and the system folder chooser is the fast way to jump to a
 * location the reader does not know about yet.
 */
export function Library({ t, snapshot, onOpen, onBrowse, initialPath }) {
  const [roots, setRoots] = useState([])
  const [drives, setDrives] = useState([])
  const [drivesLoading, setDrivesLoading] = useState(true)
  const [directory, setDirectory] = useState(null)
  const [listing, setListing] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [pathInput, setPathInput] = useState('')
  const [filter, setFilter] = useState('readable')
  const [browseBusy, setBrowseBusy] = useState(false)
  const [browseError, setBrowseError] = useState(null)

  useEffect(() => {
    let cancelled = false
    apiGet('roots', {})
      .then((response) => {
        if (cancelled) return
        const list = Array.isArray(response?.roots) ? response.roots : []
        setRoots(list)
        const preferred =
          typeof initialPath === 'string' && initialPath.length > 0 ? initialPath : lastBrowsedDirectory
        if (preferred !== null) setDirectory(preferred)
        else if (list.length > 0) setDirectory(list[0].path)
      })
      .catch((failure) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    discoverDrives()
      .then((list) => {
        if (!cancelled) setDrives(Array.isArray(list) ? list : [])
      })
      .catch(() => {
        if (!cancelled) setDrives([])
      })
      .finally(() => {
        if (!cancelled) setDrivesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback((path) => {
    let cancelled = false
    setLoading(true)
    setError(null)
    apiGet('list', { path })
      .then((response) => {
        if (cancelled) return
        setListing(response)
      })
      .catch((failure) => {
        if (cancelled) return
        setError(failure instanceof Error ? failure.message : String(failure))
        setListing(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (directory === null) return undefined
    lastBrowsedDirectory = directory
    return load(directory)
  }, [directory, load])

  const entries = useMemo(() => {
    const list = listing?.entries ?? []
    if (filter === 'all') return list
    return list.filter((entry) => entry.type === 'directory' || isReadable(entry.path))
  }, [filter, listing])

  const openPath = useCallback(
    (path) => {
      onOpen?.(path)
    },
    [onOpen],
  )

  const browse = useCallback(async () => {
    if (typeof onBrowse !== 'function') return
    setBrowseBusy(true)
    setBrowseError(null)
    try {
      const picked = await onBrowse()
      if (typeof picked === 'string' && picked.length > 0) {
        setPathInput('')
        setDirectory(picked)
      }
    } catch (failure) {
      setBrowseError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBrowseBusy(false)
    }
  }, [onBrowse])

  const crumbs = pathBreadcrumbs(listing?.path ?? directory ?? '')
  const currentPath = listing?.path ?? directory ?? ''

  return (
    <div className="omr-library">
      <div className="omr-library__roots">
        <div className="omr-section-label">{t('library.drives')}</div>
        {drivesLoading ? <p className="omr-empty omr-empty--tight">{t('library.drivesLoading')}</p> : null}
        {drives.map((drive) => (
          <button
            key={drive.path}
            type="button"
            data-drive="true"
            className="omr-row omr-row--button"
            data-active={drive.path === currentPath ? 'true' : undefined}
            title={drive.path}
            onClick={() => setDirectory(drive.path)}
          >
            <span className="omr-row__icon" aria-hidden="true">
              <Glyph name="drive" size={14} />
            </span>
            <span className="omr-row__name">{drive.label}</span>
          </button>
        ))}
        <div className="omr-section-label">{t('library.places')}</div>
        {roots.map((root) => (
          <button
            key={root.path}
            type="button"
            className="omr-row omr-row--button"
            data-active={root.path === currentPath ? 'true' : undefined}
            title={root.path}
            onClick={() => setDirectory(root.path)}
          >
            <span className="omr-row__icon" aria-hidden="true">
              <Glyph name="folder" size={14} />
            </span>
            <span className="omr-row__name">
              {ROOT_LABELS[root.label] ? t(ROOT_LABELS[root.label]) : root.label}
            </span>
          </button>
        ))}
        <div className="omr-section-label">{t('library.recent')}</div>
        {(snapshot.recent ?? []).length === 0 ? (
          <p className="omr-empty omr-empty--tight">{t('library.recentEmpty')}</p>
        ) : (
          (snapshot.recent ?? []).slice(0, 12).map((path) => (
            <button key={path} type="button" className="omr-row omr-row--button" title={path} onClick={() => openPath(path)}>
              <span className="omr-row__icon" aria-hidden="true">
                <Glyph name="file" size={14} />
              </span>
              <span className="omr-row__name">{basename(path)}</span>
              <span className="omr-row__meta">{extensionOf(path).toUpperCase()}</span>
            </button>
          ))
        )}
      </div>
      <div className="omr-library__main">
        <form
          className="omr-library__pathbar"
          onSubmit={(event) => {
            event.preventDefault()
            const value = pathInput.trim()
            if (value.length === 0) return
            if (isReadable(value)) {
              openPath(value)
            } else {
              setDirectory(value)
            }
          }}
        >
          <button
            type="button"
            className="omr-btn"
            disabled={listing?.parent === null || listing?.parent === undefined}
            onClick={() => listing?.parent && setDirectory(listing.parent)}
            title={t('library.up')}
            aria-label={t('library.up')}
          >
            <Glyph name="up" size={14} />
          </button>
          <input
            className="omr-input"
            value={pathInput}
            placeholder={t('library.openPlaceholder')}
            onChange={(event) => setPathInput(event.target.value)}
            aria-label={t('library.openPlaceholder')}
          />
          <button
            type="button"
            className="omr-btn"
            onClick={browse}
            disabled={browseBusy || typeof onBrowse !== 'function'}
            title={t('library.browseHint')}
          >
            {browseBusy ? t('library.browseBusy') : t('library.browse')}
          </button>
          <button type="submit" className="omr-btn omr-btn--primary">
            {t('library.open')}
          </button>
        </form>
        {browseError !== null ? (
          <p className="omr-empty omr-empty--error omr-empty--tight">
            {t('library.browseFailed')}: {browseError}
          </p>
        ) : null}
        <div className="omr-library__toolbar">
          <nav className="omr-library__crumbs" aria-label={t('library.crumbs')}>
            {crumbs.map((crumb, index) => (
              <React.Fragment key={crumb.path}>
                {index > 0 ? <span className="omr-crumb__sep" aria-hidden="true">›</span> : null}
                <button
                  type="button"
                  className="omr-crumb"
                  aria-current={index === crumbs.length - 1 ? 'true' : undefined}
                  title={crumb.path}
                  onClick={() => setDirectory(crumb.path)}
                >
                  {crumb.label}
                </button>
              </React.Fragment>
            ))}
          </nav>
          <div className="omr-seg" role="group" aria-label={t('library.title')}>
            <button
              type="button"
              className="omr-btn"
              aria-pressed={filter === 'readable'}
              onClick={() => setFilter('readable')}
            >
              {t('library.filterReadable')}
            </button>
            <button type="button" className="omr-btn" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              {t('library.filterAll')}
            </button>
          </div>
        </div>
        {loading ? (
          <div className="omr-center">
            <span className="omr-spinner" /> {t('library.loading')}
          </div>
        ) : null}
        {error !== null ? (
          <p className="omr-empty omr-empty--error">
            {t('library.failed')}: {error}
          </p>
        ) : null}
        {!loading && error === null && entries.length === 0 ? <p className="omr-empty">{t('library.emptyDir')}</p> : null}
        {!loading && entries.length > 0 ? (
          <ul className="omr-library__list">
            {entries.map((entry) => {
              const readable = entry.type === 'file' && isReadable(entry.path)
              const label = FORMAT_LABELS[extensionOf(entry.path)] ? extensionOf(entry.path).toUpperCase() : ''
              return (
                <li key={entry.path}>
                  <button
                    type="button"
                    className="omr-row omr-row--button"
                    data-readonly={entry.type === 'file' && !readable ? 'true' : undefined}
                    title={entry.path}
                    onClick={() => {
                      if (entry.type === 'directory') setDirectory(entry.path)
                      else if (readable) openPath(entry.path)
                    }}
                  >
                    <span className="omr-row__icon" aria-hidden="true">
                      <Glyph name={entry.type === 'directory' ? 'folder' : 'file'} size={14} />
                    </span>
                    <span className="omr-row__name">{entry.name}</span>
                    <span className="omr-row__meta">
                      {entry.type === 'file'
                        ? `${label || extensionOf(entry.path)} · ${formatBytes(entry.size)} · ${formatTime(entry.mtimeMs)}`
                        : ''}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
        {listing?.truncated ? <p className="omr-empty">{t('library.truncated')}</p> : null}
      </div>
    </div>
  )
}
