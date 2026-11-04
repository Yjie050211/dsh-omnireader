import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet } from '../lib/http.js'
import { basename, formatBytes, formatTime } from '../lib/util.js'
import { FORMAT_LABELS, extensionOf, isReadable } from '../formats/index.js'

const ROOT_LABELS = {
  workspace: 'library.rootWorkspace',
  home: 'library.rootHome',
  desktop: 'library.rootDesktop',
  documents: 'library.rootDocuments',
  downloads: 'library.rootDownloads',
}

/**
 * File picker for local documents. Browsing is served by the plugin's own host
 * route, which only exposes directory listings — the reader never widens the
 * Harness workspace permissions.
 */
export function Library({ t, snapshot, onOpen }) {
  const [roots, setRoots] = useState([])
  const [directory, setDirectory] = useState(null)
  const [listing, setListing] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [pathInput, setPathInput] = useState('')
  const [filter, setFilter] = useState('readable')

  useEffect(() => {
    let cancelled = false
    apiGet('roots', {})
      .then((response) => {
        if (cancelled) return
        const list = Array.isArray(response?.roots) ? response.roots : []
        setRoots(list)
        if (list.length > 0) setDirectory(list[0].path)
      })
      .catch((failure) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback(
    (path) => {
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
    },
    [],
  )

  useEffect(() => {
    if (directory === null) return undefined
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

  return (
    <div className="omr-library">
      <div className="omr-library__roots">
        <div className="omr-section-label">{t('library.title')}</div>
        {roots.map((root) => (
          <button
            key={root.path}
            type="button"
            className="omr-row omr-row--button"
            data-active={root.path === directory ? 'true' : undefined}
            title={root.path}
            onClick={() => setDirectory(root.path)}
          >
            {ROOT_LABELS[root.label] ? t(ROOT_LABELS[root.label]) : root.label}
          </button>
        ))}
        <div className="omr-section-label">{t('library.recent')}</div>
        {(snapshot.recent ?? []).length === 0 ? (
          <p className="omr-empty">{t('library.recentEmpty')}</p>
        ) : (
          (snapshot.recent ?? []).slice(0, 12).map((path) => (
            <button key={path} type="button" className="omr-row omr-row--button" title={path} onClick={() => openPath(path)}>
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
          >
            ↑
          </button>
          <input
            className="omr-input"
            value={pathInput}
            placeholder={t('library.openPlaceholder')}
            onChange={(event) => setPathInput(event.target.value)}
            aria-label={t('library.openPlaceholder')}
          />
          <button type="submit" className="omr-btn omr-btn--primary">
            {t('library.open')}
          </button>
        </form>
        <div className="omr-library__toolbar">
          <span className="omr-library__cwd" title={listing?.path ?? directory ?? ''}>
            {listing?.path ?? directory ?? ''}
          </span>
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
        {loading ? <div className="omr-center"><span className="omr-spinner" /> {t('library.loading')}</div> : null}
        {error !== null ? <p className="omr-empty omr-empty--error">{t('library.failed')}: {error}</p> : null}
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
                      {entry.type === 'directory' ? '▸' : '·'}
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
