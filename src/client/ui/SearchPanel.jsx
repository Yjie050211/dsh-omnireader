import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const MAX_RESULTS = 200

function excerptAround(text, index, queryLength) {
  const start = Math.max(index - 40, 0)
  const end = Math.min(index + queryLength + 40, text.length)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

/**
 * In-document search. Flow documents are searched in their prebuilt plain-text
 * index; PDFs are searched through the PDF.js text layer, page by page.
 */
export function SearchPanel({ t, model, tab, onJump, onOpenExternal, onClose }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const capability = model?.capability ?? {}
  const canSearch = capability.search !== false

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2 || !canSearch) {
      setResults([])
      setSearching(false)
      setProgress(null)
      setError(null)
      return undefined
    }
    const controller = new AbortController()
    setSearching(true)
    setError(null)
    setProgress(null)
    const timer = window.setTimeout(async () => {
      try {
        if (model?.kind === 'pdf') {
          const found = await model.search(trimmed, {
            signal: controller.signal,
            limit: MAX_RESULTS,
            onProgress: (state) => {
              if (!controller.signal.aborted) setProgress(state)
            },
          })
          if (!controller.signal.aborted) setResults(found)
        } else {
          const needle = trimmed.toLocaleLowerCase()
          const index = model?.searchIndex ?? []
          const found = []
          for (const entry of index) {
            const text = String(entry.text ?? '')
            const at = text.toLocaleLowerCase().indexOf(needle)
            if (at === -1) continue
            found.push({
              chapter: entry.chapter,
              block: entry.block,
              excerpt: excerptAround(text, at, trimmed.length),
              index: found.length,
            })
            if (found.length >= MAX_RESULTS) break
          }
          setResults(found)
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setResults([])
          setError(failure instanceof Error ? failure.message : String(failure))
        }
      } finally {
        if (!controller.signal.aborted) {
          setSearching(false)
          setProgress(null)
        }
      }
    }, 280)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query, model, canSearch])

  const jumpTo = useCallback(
    (result) => {
      if (typeof result.page === 'number') onJump?.({ page: result.page })
      else onJump?.({ chapter: result.chapter, block: result.block ?? 0 })
    },
    [onJump],
  )

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose?.()
        return
      }
      if (event.key === 'ArrowDown' && results.length > 0) {
        event.preventDefault()
        setActiveIndex((current) => Math.min(current + 1, results.length - 1))
      } else if (event.key === 'ArrowUp' && results.length > 0) {
        event.preventDefault()
        setActiveIndex((current) => Math.max(current - 1, 0))
      } else if (event.key === 'Enter' && results.length > 0) {
        event.preventDefault()
        jumpTo(results[Math.min(activeIndex, results.length - 1)])
      }
    },
    [activeIndex, jumpTo, onClose, results],
  )

  const countLabel = useMemo(() => {
    if (searching) {
      return typeof progress?.page === 'number'
        ? t('search.searching') + ` ${progress.page}/${progress.pages ?? '?'}`
        : t('search.searching')
    }
    return t('search.resultCount', { count: results.length })
  }, [progress, results.length, searching, t])

  return (
    <section className="omr-aside omr-aside--right omr-search" aria-label={t('search.title')}>
      <div className="omr-search__head">
        <div className="omr-section-label">{t('search.title')}</div>
        <button type="button" className="omr-btn omr-btn--ghost" onClick={onClose} title={t('common.close')}>
          ×
        </button>
      </div>
      <input
        ref={inputRef}
        className="omr-input"
        type="search"
        value={query}
        placeholder={t('search.placeholder')}
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(0)
        }}
        onKeyDown={handleKeyDown}
        aria-label={t('search.placeholder')}
      />
      {!canSearch ? (
        <p className="omr-empty">{t('search.noTextLayer')}</p>
      ) : (
        <>
          <div className="omr-search__status">
            {query.trim().length < 2 ? t('search.placeholder') : countLabel}
          </div>
          {error !== null ? <p className="omr-empty omr-empty--error">{error}</p> : null}
          {results.length === 0 && !searching && query.trim().length >= 2 && error === null ? (
            <p className="omr-empty">{t('search.noResults')}</p>
          ) : null}
          <div className="omr-results">
            {results.map((result, index) => {
              const key = `${result.page ?? result.chapter}-${result.block ?? result.index ?? index}`
              const label =
                typeof result.page === 'number'
                  ? t('reader.pageOf', { page: result.page })
                  : t('reader.chapterOf', { index: (result.chapter ?? 0) + 1 })
              return (
                <button
                  key={key}
                  type="button"
                  className="omr-result"
                  data-active={index === activeIndex ? 'true' : undefined}
                  onClick={() => {
                    setActiveIndex(index)
                    jumpTo(result)
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span className="omr-result__meta">{label}</span>
                  <span className="omr-result__excerpt">{result.excerpt}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
