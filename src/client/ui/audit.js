/**
 * Gated UI audit probe.
 *
 * Builds are made with `__OMNIREADER_AUDIT__` replaced at bundle time (see
 * build.mjs). In normal builds the whole module is dead code. In an audit
 * build it mounts the real reader panel in the real application shell, measures
 * geometry, stacking, colours, overflow and pointer hit testing, reports the
 * measurements to the host diagnostics route, and finally returns the shell to
 * the conversation panel.
 *
 * The report is deliberately made of numbers so that a visual bug can be
 * verified without a screenshot: whether an element leaks outside the panel,
 * whether the left rail is covered, and whether the reading surface keeps a
 * readable contrast ratio.
 */
import { report } from '../lib/http.js'
import { readerStore } from '../lib/store.js'
import { discoverDrives } from '../lib/drives.js'
import { pathBreadcrumbs } from '../lib/util.js'

const PANEL_ID = 'omnireader'
const READER_FIXTURE = 'F:/vibe-coding/dsh-omnireader/tests/fixtures/note.md'
const FORMAT_FIXTURES = [
  { name: 'note.md', path: 'F:/vibe-coding/dsh-omnireader/tests/fixtures/note.md' },
  { name: 'report.docx', path: 'F:/vibe-coding/dsh-omnireader/tests/fixtures/report.docx' },
  { name: 'sample.pdf', path: 'F:/vibe-coding/dsh-omnireader/tests/fixtures/sample.pdf' },
  { name: 'book.epub', path: 'F:/vibe-coding/dsh-omnireader/tests/fixtures/book.epub' },
  { name: 'book.mobi', path: 'F:/vibe-coding/dsh-omnireader/tests/fixtures/book.mobi' },
]
const SERVICE_WAIT_MS = 20000
const MAX_REPORTED_LEAKS = 24

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function rectOf(element) {
  const rect = element.getBoundingClientRect()
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    w: Math.round(rect.width),
    h: Math.round(rect.height),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom),
  }
}

function styleOf(element) {
  const style = getComputedStyle(element)
  return {
    position: style.position,
    zIndex: style.zIndex,
    display: style.display,
    background: style.backgroundColor,
    color: style.color,
    overflow: `${style.overflowX}/${style.overflowY}`,
  }
}

function hitAt(x, y) {
  const element = document.elementFromPoint(x, y)
  if (element === null) return { x, y, hit: null }
  return {
    x,
    y,
    tag: element.tagName.toLowerCase(),
    cls: String(element.className || '').slice(0, 64),
    insideRoot: element.closest('.omr-root') !== null,
    insideLibrary: element.closest('.omr-library') !== null,
  }
}

function inside(outer, inner) {
  return (
    inner.x >= outer.x - 1 &&
    inner.y >= outer.y - 1 &&
    inner.right <= outer.right + 1 &&
    inner.bottom <= outer.bottom + 1
  )
}

function parseColor(value) {
  const match = /rgba?\(([^)]+)\)/.exec(String(value))
  if (match === null) return null
  const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()))
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
}

function luminance(color) {
  const channel = (value) => {
    const scaled = value / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

function contrastRatio(foreground, background) {
  const fg = parseColor(foreground)
  const bg = parseColor(background)
  if (fg === null || bg === null) return null
  const lighter = Math.max(luminance(fg), luminance(bg))
  const darker = Math.min(luminance(fg), luminance(bg))
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100
}

function leakingNodes(root) {
  const rootRect = rectOf(root)
  const leaks = []
  const nodes = root.querySelectorAll('.omr-root, .omr-root *')
  const limit = Math.min(nodes.length, 600)
  for (let index = 0; index < limit; index += 1) {
    const node = nodes[index]
    if (!(node instanceof HTMLElement)) continue
    if (hasScrollAncestor(node, root)) continue
    const rect = node.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    const outside =
      rect.right > rootRect.right + 2 ||
      rect.bottom > rootRect.bottom + 2 ||
      rect.left < rootRect.left - 2 ||
      rect.top < rootRect.top - 2
    if (!outside) continue
    leaks.push({
      cls: String(node.className || '').slice(0, 48),
      position: getComputedStyle(node).position,
      rect: rectOf(node),
    })
    if (leaks.length >= MAX_REPORTED_LEAKS) break
  }
  return leaks
}

function hasScrollAncestor(node, root) {
  let current = node.parentElement
  while (current !== null && current !== root) {
    const overflow = getComputedStyle(current).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return true
    current = current.parentElement
  }
  return false
}

function railPoints() {
  const height = window.innerHeight
  return [
    { x: 10, y: 120 },
    { x: 10, y: Math.round(height * 0.45) },
    { x: 10, y: height - 120 },
    { x: 52, y: Math.round(height * 0.3) },
    { x: Math.round(window.innerWidth / 2), y: 6 },
  ]
}

async function waitForService(ctx, name) {
  const started = Date.now()
  while (Date.now() - started < SERVICE_WAIT_MS) {
    const service = ctx.get(name)
    if (service !== undefined && service !== null) return service
    await sleep(200)
  }
  return null
}

function baseline() {
  const html = document.documentElement
  const body = document.body
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    theme: {
      htmlDataTheme: html.dataset.theme ?? null,
      htmlClass: String(html.className || '').slice(0, 80),
      bodyBackground: getComputedStyle(body).backgroundColor,
      bodyColor: getComputedStyle(body).color,
      colorScheme: getComputedStyle(html).colorScheme,
    },
    scroll: {
      htmlClientWidth: html.clientWidth,
      htmlScrollWidth: html.scrollWidth,
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
    },
    points: railPoints().map((point) => hitAt(point.x, point.y)),
  }
}

function measurePanel() {
  const root = document.querySelector('.omr-root')
  if (root === null) return { mounted: false }
  const body = root.querySelector('.omr-body')
  const library = root.querySelector('.omr-library')
  const rootsColumn = root.querySelector('.omr-library__roots')
  const mainColumn = root.querySelector('.omr-library__main')
  const header = root.querySelector('.omr-header')
  const rootRect = rectOf(root)
  const style = styleOf(root)
  const mounted = {
    mounted: true,
    root: { rect: rootRect, style, dataTheme: root.getAttribute('data-theme') },
    body: body === null ? null : { rect: rectOf(body), style: styleOf(body) },
    header: header === null ? null : { rect: rectOf(header), overflow: header.scrollWidth > header.clientWidth },
    library:
      library === null
        ? null
        : {
            rect: rectOf(library),
            style: styleOf(library),
            insideRoot: inside(rootRect, rectOf(library)),
            roots: rootsColumn === null ? null : rectOf(rootsColumn),
            main: mainColumn === null ? null : rectOf(mainColumn),
          },
    contrast: {
      root: contrastRatio(style.color, style.background),
      viewer: (() => {
        const viewer = root.querySelector('.omr-viewer')
        if (viewer === null) return null
        const viewerStyle = styleOf(viewer)
        return contrastRatio(viewerStyle.color, viewerStyle.background)
      })(),
    },
    overflow: {
      rootScrollX: root.scrollWidth > root.clientWidth,
      bodyScrollX: body === null ? null : body.scrollWidth > body.clientWidth,
      documentScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    },
    fixedNodes: root.querySelectorAll('.omr-root *').length === 0 ? 0 : 0,
    fixedInside: Array.from(root.querySelectorAll('.omr-root *')).filter(
      (node) => node instanceof HTMLElement && getComputedStyle(node).position === 'fixed',
    ).length,
    leaks: leakingNodes(root),
    points: railPoints().map((point) => hitAt(point.x, point.y)),
    buttons: root.querySelectorAll('button').length,
    a11y: (() => {
      const buttons = Array.from(root.querySelectorAll('button'))
      const unnamed = buttons.filter((button) => {
        const label = button.getAttribute('aria-label') ?? button.getAttribute('title') ?? button.textContent
        return label === null || String(label).trim().length === 0
      })
      return { buttons: buttons.length, unnamedButtons: unnamed.length }
    })(),
    // A light fill inside a dark shell is the classic "hardcoded background"
    // defect; count them so the audit can assert zero.
    lightSurfaces: (() => {
      const light = []
      for (const node of root.querySelectorAll('*')) {
        const color = parseColor(getComputedStyle(node).backgroundColor)
        if (color !== null && color.a > 0.6 && luminance(color) > 0.6) {
          light.push({
            tag: node.tagName.toLowerCase(),
            cls: String(node.className || '').slice(0, 40),
            background: getComputedStyle(node).backgroundColor,
          })
          if (light.length >= 8) break
        }
      }
      return { count: light.length, list: light }
    })(),
  }
  return mounted
}

function effectiveBackground(element) {
  let node = element
  while (node !== null && node !== document.documentElement) {
    const background = getComputedStyle(node).backgroundColor
    const parsed = parseColor(background)
    if (parsed !== null && parsed.a > 0.5) return background
    node = node.parentElement
  }
  return getComputedStyle(document.body).backgroundColor
}

/**
 * Cross-drive browsing. Clicks a volume that is not C:, then enters its first
 * directory. This proves the volumes discovered by the client are wired into
 * the same listing code path as the starting points, which is what the user
 * asked for: any drive, without typing a path.
 */
async function auditCrossDrive(aliveFn) {
  const result = {
    clicked: null,
    path: null,
    entries: 0,
    directories: 0,
    breadcrumbs: 0,
    navigated: null,
    navigatedEntries: null,
    loaded: false,
    error: null,
  }
  const driveRows = Array.from(document.querySelectorAll('.omr-root [data-drive="true"]'))
  const target =
    driveRows.find((row) => String(row.textContent ?? '').trim().toUpperCase() !== 'C:') ?? null
  if (target === null) {
    result.error = 'no-secondary-drive'
    return result
  }
  result.clicked = String(target.textContent ?? '').trim()
  target.click()
  let rows = []
  for (let attempt = 0; attempt < 45; attempt += 1) {
    if (!aliveFn()) return result
    await sleep(120)
    rows = Array.from(document.querySelectorAll('.omr-root .omr-library__list li > button'))
    if (rows.length > 0) break
  }
  const pathOf = (row) => String(row.getAttribute('title') ?? '')
  const looksLikeDirectory = (value) => !/[.][A-Za-z0-9]{1,8}$/u.test(value)
  result.entries = rows.length
  result.directories = rows.filter((row) => looksLikeDirectory(pathOf(row))).length
  const crumbs = () => Array.from(document.querySelectorAll('.omr-root .omr-crumb'))
  result.breadcrumbs = crumbs().length
  result.path = result.breadcrumbs > 0 ? String(crumbs()[result.breadcrumbs - 1].getAttribute('title') ?? '') : null
  const firstDirectory = rows.find((row) => looksLikeDirectory(pathOf(row)))
  if (firstDirectory === undefined) {
    result.error = 'no-directory-at-volume-root'
    return result
  }
  firstDirectory.click()
  for (let attempt = 0; attempt < 45; attempt += 1) {
    if (!aliveFn()) return result
    await sleep(120)
    const current = crumbs()
    if (current.length > result.breadcrumbs) {
      result.navigated = String(current[current.length - 1].getAttribute('title') ?? '')
      for (let settle = 0; settle < 20; settle += 1) {
        if (!aliveFn()) return result
        await sleep(120)
        const rowsInside = document.querySelectorAll('.omr-root .omr-library__list li > button').length
        const emptyState = document.querySelector('.omr-root .omr-library__main .omr-empty')
        if (rowsInside > 0 || emptyState !== null) {
          result.navigatedEntries = rowsInside
          result.loaded = rowsInside > 0
          break
        }
      }
      break
    }
    if (document.querySelector('.omr-root .omr-empty--error') !== null) {
      result.error = 'navigate-failed'
      break
    }
  }
  return result
}

/**
 * Measures the file picker: whether the DSH folder chooser is reachable, which
 * volumes the client discovered, and whether the picker rendered them.
 */
function measurePicker(ctx, discovered) {
  const root = document.querySelector('.omr-root')
  const uiWorkspace = ctx.get('uiWorkspace')
  const driveRows =
    root === null
      ? []
      : Array.from(root.querySelectorAll('[data-drive="true"]')).map((node) => ({
          label: String(node.textContent ?? '').trim(),
          path: node.getAttribute('title'),
        }))
  const pathbarButtons =
    root === null
      ? []
      : Array.from(root.querySelectorAll('.omr-library__pathbar button')).map((node) =>
          String(node.textContent ?? '').trim(),
        )
  return {
    uiWorkspace: uiWorkspace !== undefined && uiWorkspace !== null,
    pickDirectory: typeof uiWorkspace?.pickDirectory === 'function',
    discovered: Array.isArray(discovered) ? discovered.map((drive) => drive.path) : null,
    renderedDrives: driveRows,
    breadcrumbs: pathBreadcrumbs('F:/vibe-coding/dsh-omnireader/src'),
    breadcrumbButtons: root === null ? 0 : root.querySelectorAll('.omr-crumb').length,
    pathbarButtons,
    browseEnabled:
      root === null
        ? null
        : Array.from(root.querySelectorAll('.omr-library__pathbar button')).some(
            (node) => node.disabled === false && /Browse|浏览/.test(String(node.textContent ?? '')),
          ),
  }
}

const SAMPLE_SELECTORS = [
  '.omr-title-text',
  '.omr-title-path',
  '.omr-row__name',
  '.omr-crumb',
  '.omr-library__cwd',
  '.omr-flow h1',
  '.omr-flow p',
]

function measureTheme() {
  const root = document.querySelector('.omr-root')
  if (root === null) return { theme: null }
  const rootStyle = styleOf(root)
  const viewer = root.querySelector('.omr-viewer')
  const viewerStyle = viewer === null ? null : styleOf(viewer)
  const flow = root.querySelector('.omr-flow')
  const flowStyle = flow === null ? null : getComputedStyle(flow)
  const samples = []
  for (const selector of SAMPLE_SELECTORS) {
    const node = root.querySelector(selector)
    if (node === null) continue
    const style = getComputedStyle(node)
    const background = effectiveBackground(node)
    samples.push({
      selector,
      color: style.color,
      background,
      contrast: contrastRatio(style.color, background),
      fontSize: style.fontSize,
    })
  }
  return {
    theme: root.getAttribute('data-theme'),
    surface: {
      background: rootStyle.background,
      color: rootStyle.color,
      contrast: contrastRatio(rootStyle.color, rootStyle.background),
    },
    page:
      viewer === null
        ? null
        : {
            background: viewerStyle.background,
            color: viewerStyle.color,
            contrast: contrastRatio(viewerStyle.color, viewerStyle.background),
          },
    flow: flowStyle === null
      ? null
      : {
          color: flowStyle.color,
          fontSize: flowStyle.fontSize,
          lineHeight: flowStyle.lineHeight,
          fontFamily: String(flowStyle.fontFamily).slice(0, 90),
          contrast: contrastRatio(flowStyle.color, viewerStyle?.background ?? rootStyle.background),
        },
    samples,
  }
}

function measureReader() {
  const root = document.querySelector('.omr-root')
  if (root === null) return { reader: 'no-root' }
  const viewer = root.querySelector('.omr-viewer')
  const flow = root.querySelector('.omr-flow')
  const scroller = root.querySelector('.omr-scroll') ?? root.querySelector('.omr-pdf-scroll')
  const rootRect = rectOf(root)
  return {
    activeTab: readerStore.getActiveTab()?.path ?? null,
    status: readerStore.getActiveTab()?.status ?? null,
    viewer: viewer === null ? null : { rect: rectOf(viewer), insideRoot: inside(rootRect, rectOf(viewer)) },
    flow:
      flow === null
        ? null
        : {
            rect: rectOf(flow),
            insideRoot: inside(rootRect, rectOf(flow)),
            scrollX: flow.scrollWidth > flow.clientWidth,
          },
    scroller: scroller === null ? null : { rect: rectOf(scroller), overflow: styleOf(scroller).overflow },
    points: railPoints().map((point) => hitAt(point.x, point.y)),
  }
}

export function installAudit(ctx, token) {
  if (typeof token !== 'string' || token === '') return () => {}
  // One probe run per built generation, per page session. A plugin reload must
  // not start a second probe while the previous one still holds the panel, and
  // a probe from an older generation must stop touching the shell.
  if (globalThis.__omrAuditToken === token) return () => {}
  globalThis.__omrAuditToken = token
  const gen = (globalThis.__omrAuditGen = (globalThis.__omrAuditGen ?? 0) + 1)
  let cancelled = false
  const alive = () => globalThis.__omrAuditGen === gen && !cancelled
  const send = (event, detail = {}) => report(event, { runId: token, ...detail })
  // Marker for the next normal apply: if this run freezes while the shell is
  // on a test theme, the following build restores it instead of trapping it.
  globalThis.__omrAuditArmed = true
  send('audit-install', { href: String(globalThis.location?.href ?? '') })

  ;(async () => {
    try {
      // The probe runs inside the real application shell. Normalise the shell
      // theme first so measurements are comparable across runs, and so a
      // crashed earlier probe can never leave the application on a test theme.
      const themeService = await waitForService(ctx, 'theme')
      if (!alive()) return
      if (themeService !== null) {
        try {
          themeService.setTheme('light')
        } catch {
          // A missing/unregistered theme id only affects the probe.
        }
        await sleep(250)
        if (!alive()) return
      }
      const earlyServices = { theme: ctx.get('theme') !== undefined, layout: ctx.get('layout') !== undefined }
      send('audit-baseline', { ...baseline(), earlyServices })
      const layout = await waitForService(ctx, 'layout')
      if (!alive()) return
      if (layout === null) {
        send('audit-failed', { reason: 'layout-unavailable' })
        return
      }
      try {
        layout.selectPanel?.(PANEL_ID)
      } catch (error) {
        send('audit-select-failed', { message: String(error?.message ?? error) })
        return
      }
      await sleep(1600)
      if (!alive()) return
      send('audit-panel', measurePanel())
      // File picker: volumes, breadcrumb segmentation and folder-chooser
      // availability. The chooser itself is never opened here; that would put
      // a native dialog on the host display during a measurement run.
      let discoveredDrives = null
      try {
        discoveredDrives = await discoverDrives()
      } catch {
        discoveredDrives = null
      }
      for (let attempt = 0; attempt < 24; attempt += 1) {
        if (!alive()) return
        if (document.querySelector('.omr-root [data-drive="true"]') !== null) break
        await sleep(150)
      }
      send('audit-picker', measurePicker(ctx, discoveredDrives))
      send('audit-browse', await auditCrossDrive(alive))
      await readerStore.init().catch(() => {})
      if (!alive()) return
      try {
        await readerStore.openPath(READER_FIXTURE)
      } catch (error) {
        send('audit-open-failed', { message: String(error?.message ?? error) })
      }
      await sleep(2200)
      if (!alive()) return
      send('audit-reader', measureReader())
      // Reading themes: measure every explicit surface, then put the user's
      // preference back exactly as it was before the probe ran.
      // A probe from an older generation may have switched the panel away; bring
      // the reader back before measuring its surfaces.
      if (document.querySelector('.omr-root') === null) {
        layout.selectPanel?.(PANEL_ID)
        await sleep(900)
        if (!alive()) return
      }
      const previousTheme = readerStore.getSnapshot().prefs.theme
      const themeReports = []
      for (const theme of ['dark', 'sepia', 'light']) {
        readerStore.setPrefs({ theme })
        await sleep(320)
        if (!alive()) return
        themeReports.push(measureTheme())
      }
      readerStore.setPrefs({ theme: previousTheme })
      await sleep(240)
      if (!alive()) return
      send('audit-theme', { previousTheme, reports: themeReports })
      // Dark-shell integration: DSH can run a dark theme while the reader keeps
      // its own preference. In `auto` the reader must inherit the shell tokens,
      // so no light-filled surface may appear inside a dark shell.
      if (themeService !== null) {
        if (document.querySelector('.omr-root') === null && readerStore.getSnapshot().tabs.length === 0) {
          await readerStore.openPath(READER_FIXTURE).catch(() => {})
          await sleep(900)
          if (!alive()) return
        }
        const shellSnapshot = themeService.getTheme()
        const shellPrevious =
          typeof shellSnapshot === 'string' ? shellSnapshot : shellSnapshot?.id ?? shellSnapshot?.active ?? null
        if (shellPrevious !== null) {
          try {
            themeService.setTheme('dark')
            readerStore.setPrefs({ theme: 'auto' })
            await sleep(900)
            if (!alive()) return
            const shellDark = {
              shellPrevious,
              shell: baseline().theme,
              panel: measurePanel(),
              reader: measureReader(),
              theme: measureTheme(),
            }
            readerStore.closeActiveTab?.()
            await sleep(600)
            if (!alive()) return
            shellDark.library = measurePanel()
            send('audit-shell-dark', shellDark)
          } finally {
            try {
              themeService.setTheme('light')
              if (globalThis.__omrAuditGen === gen) globalThis.__omrAuditArmed = false
            } catch {
              // The shell theme is cosmetic; never let the audit trap it.
            }
            readerStore.setPrefs({ theme: previousTheme })
            await sleep(400)
          }
        }
      }
      // Functional smoke: every supported format must still open through the
      // rewritten reader surface, not only the markdown fixture.
      const formats = []
      for (const fixture of FORMAT_FIXTURES) {
        try {
          const tab = await readerStore.openPath(fixture.path)
          await sleep(1400)
          if (!alive()) return
          const current = readerStore.getTab(tab.id) ?? tab
          formats.push({
            name: fixture.name,
            status: current.status,
            format: current.format,
            error: current.error === null || current.error === undefined ? null : String(current.error?.message ?? current.error),
          })
        } catch (error) {
          formats.push({ name: fixture.name, status: 'throw', error: String(error?.message ?? error) })
        }
      }
      send('audit-formats', { formats })
      if (!alive()) return
      try {
        layout.selectPanel?.('conversation')
      } catch (error) {
        send('audit-restore-failed', { message: String(error?.message ?? error) })
      }
      await sleep(400)
      if (globalThis.__omrAuditGen === gen) globalThis.__omrAuditArmed = false
      if (!alive()) return
      send('audit-done', { ok: true })
    } catch (error) {
      send('audit-crashed', { message: String(error?.message ?? error), stack: String(error?.stack ?? '').slice(0, 600) })
    }
  })()

  // The probe must outlive plugin effect disposal; a newer generation stops it
  // through the generation guard instead of a disposer.
  return () => {}
}
