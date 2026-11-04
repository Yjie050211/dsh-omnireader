/**
 * OmniReader client half.
 *
 * Registers:
 *  - the immersive reader panel (`main` slot, keyed `omnireader`) and its
 *    sidebar entry;
 *  - EPUB/MOBI/AZW3 quick-preview renderers through the document preview
 *    registry (`ctx.get('documentPreviews')`), so the built-in right-hand
 *    preview can render ebooks instead of falling back to plain text;
 *  - an "Open in OmniReader" action in the document preview header, which is
 *    the bridge between the quick preview and the full reader.
 *
 * Everything is bundled by build.mjs from src/client; the bundle is loaded as
 * `window.__ModuleLoader__.load({ id: 'dsh-omnireader', factory })`.
 *
 * Boot order matters: this client half is loaded with `immediately: true`,
 * which can be earlier than the plugins that provide `documentPreviews` and
 * `layout`. Nothing here may assume those services exist at apply time: the
 * preview registry is acquired by a short bounded poll, and the layout service
 * is resolved lazily through `ctx.get()` at click time.
 */
import React, { useEffect, useRef, useState } from 'react'
import { NS, en, zh } from './dict.js'
import { CSS } from './ui/styles.js'
import { ReaderPanel } from './ui/ReaderPanel.jsx'
import { FlowView } from './ui/FlowView.jsx'
import { installAudit } from './ui/audit.js'
import { openDocument } from './formats/index.js'
import { basename } from './lib/util.js'
import { readerStore } from './lib/store.js'
import { report } from './lib/http.js'

const PANEL_ID = 'omnireader'
const PREVIEW_ID = 'omnireader-preview'
const ACTION_ID = 'omnireader.open'
/** Ebook containers the built-in preview cannot render on its own. */
const PREVIEW_EXTENSIONS = ['epub', 'mobi', 'azw', 'azw3', 'kf8', 'prc']
/** Panel id used by the harness shell for the conversation surface. */
const CONVERSATION_PANEL_ID = 'conversation'
/** How long to wait for the document preview registry to appear. */
const PREVIEW_WAIT_MS = 20000
const PREVIEW_POLL_MS = 250

const ACTION_CSS = `
.omr-open-action {
  display: inline-flex; align-items: center; gap: 4px;
  height: 24px; padding: 0 8px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35));
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.10));
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap;
}
.omr-open-action:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.14)); }
.omr-open-action:active { background: var(--dsw-alias-bg-layer-3, rgba(127,127,127,.18)); }
.omr-open-action:focus-visible { outline: 2px solid var(--dsw-alias-label-secondary, currentColor); outline-offset: 1px; }
.omr-open-action:disabled { opacity: .55; cursor: default; }
`

/** Services captured at apply time; read through getters, never cached. */
let services = null

/** Sidebar glyph: the shell owns the button, this draws the book mark. */
function ReaderGlyph({ size = 16, active = false }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-active={active ? 'true' : undefined}
    >
      <path d="M2.4 3.3c1.6-.7 3.4-.7 5.6.35 2.2-1.05 4-1.05 5.6-.35v9.2c-1.6-.7-3.4-.7-5.6.35-2.2-1.05-4-1.05-5.6-.35z" />
      <path d="M8 3.65v9.2" />
    </svg>
  )
}

/**
 * Quick preview body for EPUB/MOBI inside the built-in document preview.
 *
 * The preview reads the bytes through the sanctioned workspace file reader and
 * hands them over as `content.kind === 'bytes'`. This body parses the container
 * with the same adapters the full reader uses and renders the first chapters;
 * the header action opens the full reader panel.
 */
function QuickPreviewBody(props) {
  const { content, resourceAddress, useResource, t } = props
  const translate = typeof t === 'function' ? t : services?.t ?? ((key) => key)
  const meta = typeof useResource === 'function' ? useResource(resourceAddress) : null
  const explicitPath = typeof props.absolutePath === 'string' ? props.absolutePath : ''
  const absolutePath = meta?.value?.absolutePath ?? explicitPath
  const metaPending = absolutePath.length === 0 && typeof useResource === 'function'
  const [state, setState] = useState({ status: 'loading', model: null, error: null })
  const modelRef = useRef(null)

  useEffect(() => {
    if (content === null || content === undefined || content.kind !== 'bytes') return undefined
    if (absolutePath.length === 0) return undefined
    let cancelled = false
    setState({ status: 'loading', model: null, error: null })
    report('preview-open-start', { path: absolutePath })
    openDocument({ path: absolutePath, name: basename(absolutePath) || 'document', bytes: content.data })
      .then((model) => {
        if (cancelled) {
          model?.dispose?.()
          return
        }
        modelRef.current = model
        setState({ status: 'ready', model, error: null })
        report('preview-rendered', {
          path: absolutePath,
          format: model.format,
          chapters: model.chapters?.length ?? null,
        })
      })
      .catch((error) => {
        if (cancelled) return
        setState({ status: 'error', model: null, error: error instanceof Error ? error.message : String(error) })
        report('preview-failed', { path: absolutePath, message: String(error?.message ?? error) })
      })
    return () => {
      cancelled = true
      modelRef.current?.dispose?.()
      modelRef.current = null
    }
  }, [content, absolutePath])

  if (absolutePath.length === 0 && !metaPending) {
    return (
      <div className="omr-root omr-root--embedded">
        <style>{CSS}</style>
        <div className="omr-center omr-center--error">
          <h2>{translate('reader.error')}</h2>
          <p className="omr-error__message">preview-unavailable: no document path</p>
        </div>
      </div>
    )
  }
  if (state.status === 'loading') {
    return (
      <div className="omr-root omr-root--embedded">
        <style>{CSS}</style>
        <div className="omr-center">
          <span className="omr-spinner" />
          <p>{translate('reader.loading')}</p>
        </div>
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="omr-root omr-root--embedded">
        <style>{CSS}</style>
        <div className="omr-center omr-center--error">
          <h2>{translate('reader.error')}</h2>
          <p className="omr-error__message">{state.error}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="omr-root omr-root--embedded" data-theme="auto">
      <style>{CSS}</style>
      <FlowView model={state.model} tab={{ location: null }} t={translate} quick prefs={{ fontSize: 100, lineHeight: 1.7 }} />
    </div>
  )
}

/** Header action that hands the previewed file to the full reader panel. */
function OpenInReaderAction({ absolutePath, t }) {
  const translate = typeof t === 'function' ? t : services?.t ?? ((key) => key)
  const [busy, setBusy] = useState(false)
  const open = async () => {
    const target = typeof absolutePath === 'string' ? absolutePath : ''
    if (target.length === 0) return
    setBusy(true)
    try {
      await readerStore.init().catch(() => {})
      await readerStore.openPath(target)
      const layout = services?.layout
      if (layout !== undefined && layout !== null && typeof layout.selectPanel === 'function') {
        layout.selectPanel(PANEL_ID)
      } else {
        report('layout-unavailable', { where: 'open-in-reader' })
      }
      report('preview-open-in-reader', { path: target })
    } catch (error) {
      report('preview-open-in-reader-failed', { path: target, message: String(error?.message ?? error) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <style>{ACTION_CSS}</style>
      <button
        type="button"
        className="omr-open-action"
        disabled={busy || typeof absolutePath !== 'string' || absolutePath.length === 0}
        title={translate('action.openInReaderHint')}
        onClick={open}
      >
        {translate('action.openInReader')}
      </button>
    </>
  )
}

/** Leaves the reader for the conversation surface; never traps the user. */
function leavePanel() {
  const layout = services?.layout
  if (layout !== undefined && layout !== null && typeof layout.selectPanel === 'function') {
    layout.selectPanel(CONVERSATION_PANEL_ID)
    report('panel-leave', { target: CONVERSATION_PANEL_ID })
    return
  }
  report('layout-unavailable', { where: 'leave' })
}

/**
 * Opens the DSH folder chooser (the OS dialog on a local desktop) and returns
 * the picked absolute directory, or `null` when the user cancels. The service
 * may only appear after this plugin's apply, so it is resolved at click time.
 */
async function browseDirectory() {
  const uiWorkspace = services?.uiWorkspace
  if (uiWorkspace === undefined || uiWorkspace === null || typeof uiWorkspace.pickDirectory !== 'function') {
    report('picker-unavailable', {})
    throw new Error('picker-unavailable')
  }
  report('picker-open', {})
  try {
    const picked = await uiWorkspace.pickDirectory()
    const path = typeof picked === 'string' && picked.length > 0 ? picked : null
    report('picker-result', { picked: path })
    return path
  } catch (error) {
    report('picker-failed', { message: String(error?.message ?? error) })
    throw error
  }
}

/** Panel body: supplies locale-bound copy whether or not the slot binds `t`. */
function ReaderPanelEntry(props) {
  const bound = typeof props?.t === 'function' ? props.t : services?.t
  const translate = typeof bound === 'function' ? bound : (key) => key
  return <ReaderPanel t={translate} onLeave={leavePanel} onBrowse={browseDirectory} />
}

/**
 * Registers the ebook preview definition and its body once the registry is
 * available. Returns one disposer for both registrations.
 */
function attachPreview(ctx, t, previews) {
  const disposers = []
  disposers.push(
    previews.register({
      id: PREVIEW_ID,
      extensions: PREVIEW_EXTENSIONS,
      binaryExtensions: PREVIEW_EXTENSIONS,
      title: () => t('viewer.label'),
      loading: 'bytes-complete',
      wrap: false,
    }),
  )
  disposers.push(
    ctx.slots.inject('sidebar.right.tab.document', () =>
      ctx.slots.register({ name: 'sidebar.right.tab.document', key: PREVIEW_ID, locale: NS }, QuickPreviewBody),
    ),
  )
  report('preview-registered', { id: PREVIEW_ID })
  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose?.()
      } catch {
        // A failed teardown must not break plugin unload.
      }
    }
  }
}

export function apply(ctx) {
  // A development audit probe from an earlier client generation must stop when
  // a regular build takes over, otherwise it could still drive the shell.
  if (typeof __OMNIREADER_AUDIT__ === 'string' && __OMNIREADER_AUDIT__ === '' && globalThis.__omrAuditGen !== undefined) {
    globalThis.__omrAuditGen += 1
  }
  ctx.effect(() => ctx.locale.register(NS, 'en', en))
  ctx.effect(() => ctx.locale.register(NS, 'zh', zh))
  const t = ctx.locale.bind(NS)
  services = {
    get layout() {
      return ctx.get('layout')
    },
    get previews() {
      return ctx.get('documentPreviews')
    },
    get uiWorkspace() {
      return ctx.get('uiWorkspace')
    },
    t,
  }
  ctx.effect(() => () => {
    services = null
  })

  // A throttled measurement run can freeze before its cleanup restores the
  // shell theme. Heal that on the next apply, and always report what the shell
  // currently uses so a theme trap is visible in the diagnostics.
  let shellTheme = null
  try {
    const themeService = ctx.get('theme')
    shellTheme = themeService?.getTheme?.()?.id ?? null
    if (globalThis.__omrAuditArmed === true && themeService !== undefined && themeService !== null) {
      themeService.setTheme?.('light')
      globalThis.__omrAuditArmed = false
      report('audit-theme-restored', {})
      shellTheme = themeService?.getTheme?.()?.id ?? 'light'
    }
  } catch {
    shellTheme = null
  }

  // Deferred heal: at apply time the theme service may not exist yet, so a
  // frozen measurement run is healed as soon as the service becomes available.
  if (globalThis.__omrAuditArmed === true) {
    ctx.effect(() => {
      let attempts = 0
      const timer = setInterval(() => {
        attempts += 1
        const themeService = ctx.get('theme')
        if (themeService !== undefined && themeService !== null) {
          let restored = false
          try {
            themeService.setTheme('light')
            restored = true
          } catch {
            restored = false
          }
          if (restored) {
            globalThis.__omrAuditArmed = false
            report('audit-theme-restored', { afterAttempts: attempts })
          }
          clearInterval(timer)
          return
        }
        if (attempts >= 40) clearInterval(timer)
      }, 250)
      return () => clearInterval(timer)
    })
  }

  report('apply', {
    hasSlots: typeof ctx.slots?.register === 'function',
    hasLocale: typeof ctx.locale?.register === 'function',
    hasLayout: ctx.get('layout') !== undefined && ctx.get('layout') !== null,
    hasPreviews: ctx.get('documentPreviews') !== undefined && ctx.get('documentPreviews') !== null,
    previewExtensions: PREVIEW_EXTENSIONS,
    shellTheme,
  })

  // Quick preview renderers for ebook containers. At boot the registry plugin
  // may not have run yet, so poll briefly instead of silently giving up.
  ctx.effect(() => {
    let dispose = null
    let timer = null
    let waited = 0
    const tick = () => {
      if (dispose !== null) return
      const previews = ctx.get('documentPreviews')
      if (previews !== undefined && previews !== null && typeof previews.register === 'function') {
        try {
          dispose = attachPreview(ctx, t, previews)
        } catch (error) {
          report('preview-register-failed', { message: String(error?.message ?? error) })
        }
        return
      }
      waited += PREVIEW_POLL_MS
      if (waited >= PREVIEW_WAIT_MS) {
        report('preview-registry-missing', { waited })
        return
      }
      timer = setTimeout(tick, PREVIEW_POLL_MS)
    }
    tick()
    return () => {
      if (timer !== null) clearTimeout(timer)
      if (dispose !== null) dispose()
    }
  })

  // Bridge from the built-in preview to the immersive reader.
  ctx.effect(() =>
    ctx.slots.inject('sidebar.right.tab.document.actions', () =>
      ctx.slots.register({ name: 'sidebar.right.tab.document.actions', id: ACTION_ID, order: 10, locale: NS }, OpenInReaderAction),
    ),
  )

  // Immersive reader panel and its sidebar entry.
  ctx.effect(() =>
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => t('entry.label') }, ReaderGlyph),
    ),
  )
  ctx.effect(() =>
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, ReaderPanelEntry)),
  )

  // Only present in `OMNIREADER_AUDIT=1` builds; normal builds strip this branch.
  if (typeof __OMNIREADER_AUDIT__ === 'string' && __OMNIREADER_AUDIT__ !== '') {
    ctx.effect(() => installAudit(ctx, __OMNIREADER_AUDIT__))
  }
}

export const inject = ['slots', 'locale']
