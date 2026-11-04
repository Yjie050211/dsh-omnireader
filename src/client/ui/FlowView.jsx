import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { report } from '../lib/http.js'

const WINDOW_SIZE = 12
const EXPAND_STEP = 6

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function windowAround(chapters, center) {
  const total = chapters.length
  if (total === 0) return { start: 0, end: 0 }
  const start = clamp(center - 1, 0, Math.max(total - WINDOW_SIZE, 0))
  return { start, end: clamp(start + WINDOW_SIZE, 0, total) }
}

function renderRuns(runs, keyPrefix, onLink) {
  return (runs ?? []).map((run, index) => {
    const key = `${keyPrefix}-r${index}`
    if (run.image && typeof run.image.url === 'string') {
      return (
        <img
          key={key}
          className="omr-inline-image"
          src={run.image.url}
          alt={typeof run.text === 'string' ? run.text : ''}
          loading="lazy"
          onError={(event) => {
            event.currentTarget.classList.add('omr-inline-image--broken')
          }}
        />
      )
    }
    if (typeof run.text !== 'string') return null
    let node = run.text
    if (run.code || run.math) node = <code key={`${key}-c`}>{node}</code>
    if (run.b) node = <strong key={`${key}-b`}>{node}</strong>
    if (run.i) node = <em key={`${key}-i`}>{node}</em>
    if (run.strike) node = <s key={`${key}-s`}>{node}</s>
    if (run.sup) node = <sup key={`${key}-sup`}>{node}</sup>
    if (run.sub) node = <sub key={`${key}-sub`}>{node}</sub>
    if (run.link !== undefined && run.link !== null) {
      node = (
        <a
          key={`${key}-a`}
          role="link"
          tabIndex={0}
          title={typeof run.link === 'string' ? run.link : undefined}
          onClick={(event) => {
            event.preventDefault()
            onLink(run.link)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onLink(run.link)
            }
          }}
        >
          {node}
        </a>
      )
    }
    return <React.Fragment key={key}>{node}</React.Fragment>
  })
}

function CodeBlock({ block, index, t }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    const text = String(block.text ?? '')
    const done = () => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, () => {})
    } else {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      try {
        document.execCommand('copy')
        done()
      } catch {
        // Clipboard access can be blocked; the code stays selectable regardless.
      } finally {
        area.remove()
      }
    }
  }, [block.text])
  return (
    <div className="omr-code-wrap" data-block={index}>
      <pre>
        <code>{block.text}</code>
      </pre>
      <button type="button" className="omr-btn omr-code-copy" onClick={copy} title={t('toolbar.copy')}>
        {copied ? t('toolbar.copied') : t('toolbar.copy')}
      </button>
    </div>
  )
}

function BlockView({ block, index, t, onLink, active }) {
  const id = block.id ?? undefined
  const className = active ? 'omr-block-hl' : undefined
  switch (block.type) {
    case 'heading': {
      const Tag = `h${clamp(Number(block.level) || 2, 1, 6)}`
      return (
        <Tag id={id} className={className} data-block={index}>
          {renderRuns(block.runs, `h${index}`, onLink)}
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p id={id} className={className} data-block={index}>
          {renderRuns(block.runs, `p${index}`, onLink)}
        </p>
      )
    case 'quote':
      return (
        <blockquote id={id} className={className} data-block={index}>
          {renderRuns(block.runs, `q${index}`, onLink)}
        </blockquote>
      )
    case 'code':
      return <CodeBlock block={block} index={index} t={t} />
    case 'math':
      return (
        <div className="omr-math" data-block={index}>
          {block.text}
        </div>
      )
    case 'hr':
      return <hr data-block={index} />
    case 'image':
      return (
        <figure data-block={index}>
          <img
            src={block.url}
            alt={block.alt ?? ''}
            loading="lazy"
            style={block.width ? { maxWidth: `${block.width}px`, width: '100%' } : undefined}
          />
          {block.alt ? <figcaption>{block.alt}</figcaption> : null}
        </figure>
      )
    case 'caption':
      return (
        <p className={`omr-caption ${className ?? ''}`} data-block={index}>
          {renderRuns(block.runs, `cap${index}`, onLink)}
        </p>
      )
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag data-block={index}>
          {(block.items ?? []).map((item, itemIndex) => (
            <li key={`li-${itemIndex}`} data-checked={item.checked === true ? 'true' : undefined}>
              {item.checked === true ? '☑ ' : item.checked === false ? '☐ ' : ''}
              {renderRuns(item.runs, `li${index}-${itemIndex}`, onLink)}
            </li>
          ))}
        </Tag>
      )
    }
    case 'table':
      return (
        <table data-block={index}>
          <thead>
            <tr>
              {(block.head ?? []).map((cell, cellIndex) => (
                <th key={`th-${cellIndex}`}>{renderRuns(cell, `th${index}-${cellIndex}`, onLink)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(block.rows ?? []).map((row, rowIndex) => (
              <tr key={`tr-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`td-${rowIndex}-${cellIndex}`}>{renderRuns(cell, `td${index}-${rowIndex}-${cellIndex}`, onLink)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    default:
      return null
  }
}

/**
 * Flow reader for Markdown, DOCX, EPUB and MOBI models.
 *
 * Rendering is windowed (a slice of chapters around the reading position) so a
 * 600-chapter book does not create a 100k-node DOM; the slice grows as the
 * reader approaches its end.
 */
export function FlowView({ model, tab, t, jump, onLocation, onLink, onOpenExternal, prefs, quick = false }) {
  const chapters = model?.chapters ?? []
  const initial = clamp(Number(tab?.location?.chapter) || 0, 0, Math.max(chapters.length - 1, 0))
  const [visible, setVisible] = useState(() => windowAround(chapters, quick ? 0 : initial))
  const [activeChapter, setActiveChapter] = useState(initial)
  const [highlight, setHighlight] = useState(null)
  const containerRef = useRef(null)
  const chapterRefs = useRef(new Map())
  const lastReported = useRef({ chapter: -1, block: -1, at: 0 })
  const frame = useRef(0)

  const setChapterRef = useCallback((index, node) => {
    if (node === null) chapterRefs.current.delete(index)
    else chapterRefs.current.set(index, node)
  }, [])

  useEffect(() => {
    report('flow-rendered', {
      format: model?.format ?? null,
      chapters: chapters.length,
      quick: Boolean(quick),
    })
  }, [model, chapters.length, quick])

  const scrollToChapter = useCallback(
    (index, anchor) => {
      window.requestAnimationFrame(() => {
        if (anchor) {
          const node = document.getElementById(String(anchor))
          if (node !== null) {
            node.scrollIntoView({ block: 'start' })
            return
          }
        }
        const node = chapterRefs.current.get(index)
        if (node !== undefined) node.scrollIntoView({ block: 'start' })
      })
    },
    [],
  )

  // External navigation requests (outline, search, bookmarks, restore).
  useEffect(() => {
    if (!jump) return
    const target = clamp(Number(jump.chapter) || 0, 0, Math.max(chapters.length - 1, 0))
    setVisible((current) => {
      if (target >= current.start && target < current.end - 1) return current
      return windowAround(chapters, target)
    })
    setActiveChapter(target)
    if (typeof jump.block === 'number') setHighlight({ chapter: target, block: jump.block })
    scrollToChapter(target, jump.anchor)
    const timer = window.setTimeout(() => setHighlight(null), 2600)
    return () => window.clearTimeout(timer)
  }, [jump?.seq, chapters.length, scrollToChapter])

  // Track the reading position while scrolling and extend the window near the end.
  const handleScroll = useCallback(() => {
    if (frame.current !== 0) return
    frame.current = window.requestAnimationFrame(() => {
      frame.current = 0
      const container = containerRef.current
      if (container === null) return
      const containerTop = container.getBoundingClientRect().top
      let chapter = visible.start
      let block = 0
      for (let index = visible.start; index < visible.end; index += 1) {
        const node = chapterRefs.current.get(index)
        if (node === undefined) continue
        const rect = node.getBoundingClientRect()
        if (rect.top - containerTop <= 80) {
          chapter = index
          const height = Math.max(rect.height, 1)
          const ratio = clamp((containerTop + 40 - rect.top) / height, 0, 1)
          const count = chapters[index]?.blocks?.length ?? 0
          block = clamp(Math.round(ratio * count), 0, Math.max(count - 1, 0))
          if (rect.top - containerTop > 80 && index === visible.start) block = 0
        } else {
          break
        }
      }
      if (chapter !== activeChapter) setActiveChapter(chapter)
      const now = Date.now()
      const changed = chapter !== lastReported.current.chapter || Math.abs(block - lastReported.current.block) > 2
      if (changed && now - lastReported.current.at > 350) {
        lastReported.current = { chapter, block, at: now }
        onLocation?.({ chapter, block })
      }
      if (visible.end < chapters.length && container.scrollTop + container.clientHeight > container.scrollHeight - 900) {
        setVisible((current) => ({ ...current, end: Math.min(current.end + EXPAND_STEP, chapters.length) }))
      }
    })
  }, [activeChapter, chapters, onLocation, visible])

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return undefined
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  const link = useCallback(
    (target) => {
      if (typeof target === 'string') {
        onOpenExternal?.(target)
        return
      }
      if (target !== null && typeof target === 'object') {
        const chapter = Number(target.chapter)
        onLink?.({
          chapter: Number.isFinite(chapter) ? chapter : activeChapter,
          anchor: target.anchor,
        })
      }
    },
    [activeChapter, onLink, onOpenExternal],
  )

  const scale = (prefs?.fontSize ?? 100) / 100
  const style = {
    '--omr-font-scale': String(scale),
    '--omr-line-height': String(prefs?.lineHeight ?? 1.75),
    '--omr-flow-width': `${prefs?.flowWidth ?? 760}px`,
  }

  if (chapters.length === 0) {
    return (
      <div className="omr-center">
        <h2>{t('reader.empty')}</h2>
        <p>{t('reader.emptyHint')}</p>
      </div>
    )
  }

  if (quick) {
    const limit = Math.min(chapters.length, 4)
    return (
      <div className="omr-flow omr-flow--compact" style={style}>
        {chapters.slice(0, limit).map((chapter, index) => (
          <section key={chapter.id ?? `quick-${index}`} className="omr-chapter" data-chapter={index}>
            {(chapter.blocks ?? []).map((block, blockIndex) => (
              <BlockView
                key={`quick-${index}-${blockIndex}`}
                block={block}
                index={blockIndex}
                t={t}
                onLink={link}
                active={false}
              />
            ))}
          </section>
        ))}
        {chapters.length > limit ? <p className="omr-empty">{t('viewer.truncated')}</p> : null}
      </div>
    )
  }

  return (
    <div className="omr-scroll" ref={containerRef} style={style} data-quick={quick ? 'true' : undefined}>
      <div className={`omr-flow ${quick ? 'omr-flow--compact' : ''}`}>
        {chapters.slice(visible.start, visible.end).map((chapter, offset) => {
          const index = visible.start + offset
          return (
            <section
              key={chapter.id ?? `chapter-${index}`}
              className="omr-chapter"
              ref={(node) => setChapterRef(index, node)}
              data-chapter={index}
              aria-label={chapter.title}
            >
              {(chapter.blocks ?? []).map((block, blockIndex) => (
                <BlockView
                  key={`${index}-${blockIndex}`}
                  block={block}
                  index={blockIndex}
                  t={t}
                  onLink={link}
                  active={highlight !== null && highlight.chapter === index && highlight.block === blockIndex}
                />
              ))}
            </section>
          )
        })}
      </div>
    </div>
  )
}
