import React, { useMemo, useState } from 'react'

/**
 * Bookmarks and reading notes for the active document. Both are anchored to the
 * reader location captured when they were created (page for PDF, chapter+block
 * for reflowable formats) so they stay valid when the file is reopened.
 */
export function NotesPanel({ t, tab, snapshot, location, onJump, onAddBookmark, onRemoveBookmark, onAddNote, onRemoveNote }) {
  const [draft, setDraft] = useState('')
  const bookmarks = useMemo(() => (tab ? snapshot.bookmarks?.[tab.path] ?? [] : []), [snapshot.bookmarks, tab])
  const notes = useMemo(() => (tab ? snapshot.notes?.[tab.path] ?? [] : []), [snapshot.notes, tab])

  const describe = (target) => {
    if (target === null || target === undefined) return ''
    if (typeof target.page === 'number') return t('reader.pageOf', { page: target.page })
    if (typeof target.chapter === 'number') return t('reader.chapterOf', { index: target.chapter + 1 })
    return ''
  }

  const currentLabel = describe(location)

  return (
    <aside className="omr-aside omr-aside--right omr-notes" aria-label={t('notes.title')}>
      <div className="omr-section-label">{t('notes.bookmarks')}</div>
      <button
        type="button"
        className="omr-btn omr-btn--wide"
        onClick={() => onAddBookmark?.(currentLabel)}
        title={t('notes.bookmarkAdd')}
      >
        {t('notes.bookmarkAdd')}
      </button>
      {bookmarks.length === 0 ? (
        <p className="omr-empty">{t('notes.noBookmarks')}</p>
      ) : (
        <ul className="omr-note-list">
          {bookmarks.map((mark) => (
            <li key={mark.id} className="omr-note">
              <button type="button" className="omr-note__jump" onClick={() => onJump?.(mark.location)}>
                <span className="omr-note__label">{mark.label || describe(mark.location) || '•'}</span>
                <span className="omr-note__meta">{describe(mark.location)}</span>
              </button>
              <button
                type="button"
                className="omr-btn omr-btn--ghost"
                title={t('common.remove')}
                onClick={() => onRemoveBookmark?.(mark.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="omr-section-label">{t('notes.notes')}</div>
      <textarea
        className="omr-input omr-textarea"
        placeholder={t('notes.placeholder')}
        value={draft}
        rows={3}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button
        type="button"
        className="omr-btn omr-btn--wide"
        disabled={draft.trim().length === 0}
        onClick={() => {
          if (draft.trim().length === 0) return
          onAddNote?.(draft.trim())
          setDraft('')
        }}
      >
        {t('notes.save')}
      </button>
      {notes.length === 0 ? (
        <p className="omr-empty">{t('notes.noNotes')}</p>
      ) : (
        <ul className="omr-note-list">
          {notes.map((note) => (
            <li key={note.id} className="omr-note omr-note--text">
              <p className="omr-note__text">{note.text}</p>
              <div className="omr-note__row">
                <button
                  type="button"
                  className="omr-btn omr-btn--ghost"
                  onClick={() => onJump?.(note.location)}
                  title={t('notes.jump')}
                >
                  {describe(note.location) || t('notes.jump')}
                </button>
                <button
                  type="button"
                  className="omr-btn omr-btn--ghost"
                  onClick={() => onRemoveNote?.(note.id)}
                  title={t('common.delete')}
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
