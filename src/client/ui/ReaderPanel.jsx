import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { readerStore } from '../lib/store.js'
import { abbreviation, dirname } from '../lib/util.js'
import { report } from '../lib/http.js'
import { FORMAT_LABELS } from '../formats/index.js'
import { CSS } from './styles.js'
import { FlowView } from './FlowView.jsx'
import { PdfView } from './PdfView.jsx'
import { Outline } from './Outline.jsx'
import { SearchPanel } from './SearchPanel.jsx'
import { NotesPanel } from './NotesPanel.jsx'
import { Library } from './Library.jsx'
import { Glyph } from './icons.jsx'

const THEMES = ['auto', 'light', 'sepia', 'dark']
const FONT_STEPS = [80, 90, 100, 110, 125, 140, 160]
const ZOOM_STEPS = [0, 0.75, 1, 1.25, 1.5, 2, 3]
const THEME_KEYS = {
  auto: 'toolbar.themeAuto',
  light: 'toolbar.themeLight',
  sepia: 'toolbar.themeSepia',
  dark: 'toolbar.themeDark',
}
const THEME_ICONS = { auto: 'auto', light: 'sun', sepia: 'sun', dark: 'moon' }

function isWebUrl(href) {
  return typeof href === 'string' && /^(https?:|mailto:)/i.test(href)
}

function openExternal(href) {
  if (!isWebUrl(href)) return
  try {
    window.open(href, '_blank', 'noopener,noreferrer')
  } catch {
    // Pop-up blocking is fine; the link is still visible in the document.
  }
}

function nearestStep(steps, value) {
  let index = 0
  for (let cursor = 0; cursor < steps.length; cursor += 1) {
    if (steps[cursor] <= value) index = cursor
  }
  return index
}

function StatusBar({ t, tab, snapshot, progress, model }) {
  const formatLabel = FORMAT_LABELS[model?.format ?? tab.format] ?? tab.format ?? ''
  const location = tab.location
  let locationText = ''
  if (model?.kind === 'pdf' && location) {
    locationText = t('reader.pageOf', { page: location.page, pages: model.numPages })
  } else if (model?.chapters && location) {
    locationText = t('reader.chapterOf', { index: (location.chapter ?? 0) + 1, total: model.chapters.length })
  }
  const percent = Math.round((progress ?? 0) * 100)
  return (
    <footer className="omr-footer">
      <span className="omr-footer__item omr-badge">{formatLabel}</span>
      {locationText ? <span className="omr-footer__item">{locationText}</span> : null}
      <span className="omr-footer__item omr-footer__progress" title={t('status.progress', { percent })}>
        <span className="omr-progress">
          <span style={{ width: `${Math.max(percent, 1)}%` }} />
        </span>
        {percent}%
      </span>
      {tab.sourceChanged ? <span className="omr-footer__item omr-footer__warn">{t('reader.changed')}</span> : null}
      <span className="omr-footer__spacer" />
      <span className="omr-footer__item" data-host={snapshot.host.status}>
        {snapshot.host.status === 'online' ? t('panel.connected') : snapshot.host.status === 'offline' ? t('panel.disconnected') : '…'}
      </span>
    </footer>
  )
}

function ErrorState({ t, tab, failure, onRetry, onOpenLibrary }) {
  return (
    <div className="omr-center omr-center--error">
      <div className="omr-error__badge">{FORMAT_LABELS[tab.format] ?? tab.format}</div>
      <h2>{t(failure?.key ?? 'reader.error')}</h2>
      <p className="omr-error__message">{failure?.message ?? ''}</p>
      <div className="omr-error__actions">
        <button type="button" className="omr-btn omr-btn--primary" onClick={onRetry}>
          {t('common.retry')}
        </button>
        <button type="button" className="omr-btn" onClick={onOpenLibrary}>
          {t('panel.library')}
        </button>
      </div>
    </div>
  )
}

export function ReaderPanel({ t, onLeave, onBrowse }) {
  const snapshot = useSyncExternalStore(readerStore.subscribe, readerStore.getSnapshot, readerStore.getSnapshot)
  const [showLibrary, setShowLibrary] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const rootRef = useRef(null)
  const hasTabs = snapshot.tabs.length > 0

  useEffect(() => {
    readerStore.init().catch(() => {})
    report('panel-mount', {})
  }, [])

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const activeTab = useMemo(
    () => snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId) ?? null,
    [snapshot.tabs, snapshot.activeTabId],
  )
  const model = activeTab?.model ?? null
  const isPdf = model?.kind === 'pdf'
  const prefs = snapshot.prefs
  const theme = prefs.theme ?? 'auto'
  const progress = activeTab ? readerStore.progressOf(activeTab) : 0
  const capability = model?.capability ?? {}

  const jump = activeTab?.pendingLocation ?? null
  useEffect(() => {
    if (jump === null || activeTab === null) return undefined
    const tabId = activeTab.id
    const seq = jump.seq
    const frame = window.requestAnimationFrame(() => readerStore.consumeJump(tabId, seq))
    return () => window.cancelAnimationFrame(frame)
  }, [jump?.seq, activeTab?.id])

  const openPath = useCallback(async (path) => {
    setShowLibrary(false)
    try {
      await readerStore.openPath(path)
    } catch {
      // The tab reports the failure itself.
    }
  }, [])

  const retry = useCallback(() => {
    if (activeTab === null) return
    const path = activeTab.path
    readerStore.closeTab(activeTab.id)
    openPath(path)
  }, [activeTab, openPath])

  const requestJump = useCallback(
    (target) => {
      if (activeTab === null) return
      readerStore.requestJump(activeTab.id, target)
    },
    [activeTab],
  )

  const setLocation = useCallback(
    (location) => {
      if (activeTab === null) return
      readerStore.setLocation(activeTab.id, location)
    },
    [activeTab],
  )

  const cycleTheme = useCallback(() => {
    const index = THEMES.indexOf(theme)
    const next = THEMES[(index + 1) % THEMES.length]
    readerStore.setPrefs({ theme: next })
  }, [theme])

  const setFontSize = useCallback(
    (direction) => {
      const index = nearestStep(FONT_STEPS, prefs.fontSize ?? 100)
      const next = FONT_STEPS[Math.max(0, Math.min(FONT_STEPS.length - 1, index + direction))]
      readerStore.setPrefs({ fontSize: next })
    },
    [prefs.fontSize],
  )

  const setPdfZoom = useCallback(
    (direction) => {
      if (activeTab === null) return
      const current = Number(activeTab.location?.scale) || 0
      const index = nearestStep(ZOOM_STEPS, current)
      const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, index + direction))]
      readerStore.setLocation(activeTab.id, { ...activeTab.location, scale: next })
    },
    [activeTab],
  )

  const rotate = useCallback(() => {
    if (activeTab === null) return
    const rotation = ((Number(activeTab.location?.rotation) || 0) + 90) % 360
    readerStore.setLocation(activeTab.id, { ...activeTab.location, rotation })
  }, [activeTab])

  const toggleFullscreen = useCallback(async () => {
    const node = rootRef.current
    if (node === null) return
    try {
      if (document.fullscreenElement === null) {
        await node.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch {
      setFullscreen((current) => !current)
    }
  }, [])

  const leave = useCallback(() => {
    if (typeof onLeave === 'function') onLeave()
  }, [onLeave])

  useEffect(() => {
    const onKeyDown = (event) => {
      const mod = event.ctrlKey || event.metaKey
      if (!mod && event.key === 'Escape') {
        if (searchOpen) {
          setSearchOpen(false)
          event.preventDefault()
        } else if (showLibrary && hasTabs) {
          setShowLibrary(false)
          event.preventDefault()
        }
        return
      }
      if (!mod) return
      const key = event.key.toLowerCase()
      if (key === 'f' && model !== null && capability.search !== false) {
        event.preventDefault()
        setSearchOpen(true)
      } else if (key === 'o') {
        event.preventDefault()
        setShowLibrary(true)
      } else if (key === '=' || key === '+') {
        event.preventDefault()
        if (isPdf) setPdfZoom(1)
        else setFontSize(1)
      } else if (key === '-') {
        event.preventDefault()
        if (isPdf) setPdfZoom(-1)
        else setFontSize(-1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [capability.search, hasTabs, isPdf, model, searchOpen, setFontSize, setPdfZoom, showLibrary])

  const frame = hasTabs && (showLibrary || activeTab !== null)
  const showReader = frame && !showLibrary && activeTab !== null && activeTab.status === 'ready'
  const showLibrarySurface = showLibrary || !hasTabs

  return (
    <div
      ref={rootRef}
      className={`omr-root ${fullscreen ? 'omr-fullscreen' : ''}`}
      data-theme={theme}
      data-plugin="omnireader"
    >
      <style>{CSS}</style>
      <header className="omr-header">
        <button
          type="button"
          className="omr-btn omr-btn--icon"
          onClick={leave}
          title={t('panel.back')}
          aria-label={t('panel.back')}
        >
          <Glyph name="back" />
        </button>
        <div className="omr-header__title">
          <span className="omr-title-text">OmniReader</span>
          {activeTab !== null ? (
            <span className="omr-title-sub">
              <span className="omr-title-name" title={activeTab.title}>
                {activeTab.title}
              </span>
              <span className="omr-title-path" title={activeTab.path ?? ''}>
                {abbreviation(activeTab.path ?? '', 64)}
              </span>
            </span>
          ) : (
            <span className="omr-title-sub">
              <span className="omr-title-name">{t('panel.subtitle')}</span>
            </span>
          )}
        </div>
        <div className="omr-header__actions">
          <button
            type="button"
            className="omr-btn omr-btn--icon"
            aria-pressed={showLibrarySurface}
            aria-label={t('library.title')}
            title={t('library.title')}
            onClick={() => setShowLibrary((current) => !current)}
          >
            <Glyph name="library" />
          </button>
          <button
            type="button"
            className="omr-btn omr-btn--icon"
            aria-pressed={searchOpen}
            aria-label={t('toolbar.search')}
            disabled={!showReader || capability.search === false}
            title={t('toolbar.search')}
            onClick={() => setSearchOpen((current) => !current)}
          >
            <Glyph name="search" />
          </button>
          <button
            type="button"
            className="omr-btn omr-btn--icon"
            aria-pressed={prefs.showOutline}
            aria-label={t('toolbar.outline')}
            disabled={!showReader}
            title={t('toolbar.outline')}
            onClick={() => readerStore.setPrefs({ showOutline: !prefs.showOutline })}
          >
            <Glyph name="outline" />
          </button>
          <button
            type="button"
            className="omr-btn omr-btn--icon"
            aria-pressed={prefs.showNotes}
            aria-label={t('toolbar.notes')}
            disabled={!showReader}
            title={t('toolbar.notes')}
            onClick={() => readerStore.setPrefs({ showNotes: !prefs.showNotes })}
          >
            <Glyph name="notes" />
          </button>
          <button
            type="button"
            className="omr-btn omr-btn--icon"
            aria-label={t(THEME_KEYS[theme] ?? 'toolbar.theme')}
            title={t(THEME_KEYS[theme] ?? 'toolbar.theme')}
            onClick={cycleTheme}
          >
            <Glyph name={THEME_ICONS[theme] ?? 'auto'} />
          </button>
          {showReader && !isPdf ? (
            <>
              <button
                type="button"
                className="omr-btn"
                aria-label={t('toolbar.fontSmaller')}
                title={t('toolbar.fontSmaller')}
                onClick={() => setFontSize(-1)}
              >
                A−
              </button>
              <button
                type="button"
                className="omr-btn"
                aria-label={t('toolbar.fontLarger')}
                title={t('toolbar.fontLarger')}
                onClick={() => setFontSize(1)}
              >
                A+
              </button>
            </>
          ) : null}
          {showReader && isPdf ? (
            <>
              <button
                type="button"
                className="omr-btn"
                aria-label={t('toolbar.zoomOut')}
                title={t('toolbar.zoomOut')}
                onClick={() => setPdfZoom(-1)}
              >
                −
              </button>
              <button
                type="button"
                className="omr-btn"
                aria-label={t('toolbar.zoomIn')}
                title={t('toolbar.zoomIn')}
                onClick={() => setPdfZoom(1)}
              >
                +
              </button>
              <button
                type="button"
                className="omr-btn omr-btn--icon"
                aria-pressed={(Number(activeTab.location?.scale) || 0) === 0}
                aria-label={t('toolbar.fitWidth')}
                title={t('toolbar.fitWidth')}
                onClick={() => readerStore.setLocation(activeTab.id, { ...activeTab.location, scale: 0 })}
              >
                <Glyph name="fit" />
              </button>
              <button
                type="button"
                className="omr-btn omr-btn--icon"
                aria-label={t('toolbar.rotate')}
                title={t('toolbar.rotate')}
                onClick={rotate}
              >
                <Glyph name="rotate" />
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="omr-btn omr-btn--icon"
            aria-pressed={fullscreen}
            aria-label={t('toolbar.fullscreen')}
            title={t('toolbar.fullscreen')}
            onClick={toggleFullscreen}
          >
            <Glyph name="fullscreen" />
          </button>
        </div>
      </header>

      {hasTabs ? (
        <div className="omr-tabs" role="tablist" aria-label={t('toolbar.tabs')}>
          {snapshot.tabs.map((tab) => (
            <div key={tab.id} className="omr-tab" data-active={tab.id === snapshot.activeTabId ? 'true' : undefined}>
              <button
                type="button"
                className="omr-tab__label"
                role="tab"
                aria-selected={tab.id === snapshot.activeTabId}
                title={tab.path}
                onClick={() => readerStore.activateTab(tab.id)}
              >
                {tab.title}
              </button>
              <button
                type="button"
                className="omr-tab-close"
                title={t('toolbar.close')}
                aria-label={t('toolbar.close')}
                onClick={() => readerStore.closeTab(tab.id)}
              >
                <Glyph name="close" size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="omr-body">
        {!snapshot.ready ? (
          <div className="omr-center">
            <span className="omr-spinner" />
            <p>{t('reader.loading')}</p>
          </div>
        ) : showLibrarySurface ? (
          <Library
            t={t}
            snapshot={snapshot}
            onOpen={openPath}
            onBrowse={onBrowse}
            initialPath={activeTab === null ? '' : dirname(activeTab.path)}
          />
        ) : activeTab === null ? (
          <div className="omr-center">
            <p>{t('reader.empty')}</p>
          </div>
        ) : activeTab.status === 'loading' ? (
          <div className="omr-center">
            <span className="omr-spinner" />
            <p>{t('reader.loading')}</p>
            <p className="omr-title-path">{abbreviation(activeTab.path ?? '', 80)}</p>
          </div>
        ) : activeTab.status === 'error' ? (
          <ErrorState t={t} tab={activeTab} failure={activeTab.error} onRetry={retry} onOpenLibrary={() => setShowLibrary(true)} />
        ) : (
          <>
            {prefs.showOutline ? (
              <Outline
                t={t}
                model={model}
                tab={activeTab}
                location={activeTab.location}
                onJump={requestJump}
                onOpenExternal={openExternal}
              />
            ) : null}
            <main className="omr-viewer">
              {isPdf ? (
                <PdfView key={activeTab.id} model={model} tab={activeTab} t={t} jump={jump} onLocation={setLocation} />
              ) : (
                <FlowView
                  key={activeTab.id}
                  model={model}
                  tab={activeTab}
                  t={t}
                  jump={jump}
                  prefs={prefs}
                  onLocation={setLocation}
                  onLink={(target) => requestJump(target)}
                  onOpenExternal={openExternal}
                />
              )}
            </main>
            {searchOpen ? (
              <SearchPanel t={t} model={model} tab={activeTab} onJump={requestJump} onClose={() => setSearchOpen(false)} />
            ) : prefs.showNotes ? (
              <NotesPanel
                t={t}
                tab={activeTab}
                snapshot={snapshot}
                location={activeTab.location}
                onJump={(target) => requestJump(target)}
                onAddBookmark={(label) => readerStore.addBookmark(activeTab.id, label)}
                onRemoveBookmark={(id) => readerStore.removeBookmark(activeTab.path, id)}
                onAddNote={(text) => readerStore.addNote(activeTab.id, text)}
                onRemoveNote={(id) => readerStore.removeNote(activeTab.path, id)}
              />
            ) : null}
          </>
        )}
      </div>

      {activeTab !== null && !showLibrarySurface ? (
        <StatusBar t={t} tab={activeTab} snapshot={snapshot} progress={progress} model={model} />
      ) : (
        <footer className="omr-footer">
          <span className="omr-footer__item">{t('status.ready')}</span>
          <span className="omr-footer__spacer" />
          <span className="omr-footer__item" data-host={snapshot.host.status}>
            {snapshot.host.status === 'online' ? t('panel.connected') : snapshot.host.status === 'offline' ? t('panel.disconnected') : '…'}
          </span>
        </footer>
      )}
    </div>
  )
}
