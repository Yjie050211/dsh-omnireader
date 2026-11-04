import React, { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Document outline. PDF entries carry a page; flow entries carry a chapter and
 * block index. Entries marked as external links open outside the reader.
 */
export function Outline({ t, model, tab, location, onJump, onOpenExternal }) {
  const items = model?.outline ?? []
  const activeRef = useRef(null)
  const activeChapter = Number(location?.chapter)
  const activePage = Number(location?.page)
  const activeIndex = useMemo(() => {
    let found = -1
    items.forEach((item, index) => {
      if (typeof item.page === 'number') {
        if (item.page <= (Number.isFinite(activePage) ? activePage : 1)) found = index
      } else if (typeof item.chapter === 'number') {
        if (item.chapter <= (Number.isFinite(activeChapter) ? activeChapter : 0)) found = index
      }
    })
    return found
  }, [items, activeChapter, activePage])

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (items.length === 0) {
    return (
      <div className="omr-aside" aria-label={t('outline.title')}>
        <div className="omr-section-label">{t('outline.title')}</div>
        <p className="omr-empty">{t('outline.empty')}</p>
      </div>
    )
  }

  return (
    <nav className="omr-aside" aria-label={t('outline.title')}>
      <div className="omr-section-label">{t('outline.title')}</div>
      {items.some((item) => item.unreliable === true) ? (
        <p className="omr-outline-note">{t('outline.unreliableNotice')}</p>
      ) : null}
      <div className="omr-outline">
        {items.map((item, index) => {
          const level = Math.max(1, Math.min(Number(item.level) || 1, 6))
          const active = index === activeIndex
          const unreliable = item.unreliable === true
          const hasPage = typeof item.page === 'number' && !unreliable
          const hasChapter = typeof item.chapter === 'number'
          const hasTarget = hasPage || hasChapter || Boolean(item.externalUrl)
          return (
            <button
              key={`outline-${index}`}
              ref={active ? activeRef : null}
              type="button"
              className={`omr-outline-item${hasTarget ? '' : ' omr-outline-item--untargeted'}${unreliable ? ' omr-outline-item--unreliable' : ''}`}
              data-level={level}
              aria-current={active ? 'location' : undefined}
              aria-disabled={hasTarget ? undefined : true}
              title={unreliable ? `${item.label} · ${t('outline.unreliableTitle')}` : item.label}
              onClick={() => {
                if (!hasTarget) return
                if (item.externalUrl) {
                  onOpenExternal?.(item.externalUrl)
                  return
                }
                if (hasPage) onJump?.({ page: item.page })
                else onJump?.({ chapter: item.chapter, block: item.block ?? 0, anchor: item.anchor })
              }}
            >
              {item.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
