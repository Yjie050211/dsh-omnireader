/**
 * Inline icon set.
 *
 * DSH exposes its own icon primitives through the platform module table, but the
 * reader only needs a small stable set, so the glyphs are drawn here with the
 * same 16px outline language the shell uses: `stroke="currentColor"`,
 * `fill="none"`, 1.4px strokes, rounded caps and joins.
 */
import React from 'react'

const PATHS = {
  back: ['M9.5 3.5 5 8l4.5 4.5', 'M5 8h7.5'],
  library: ['M2.5 4h4.2l1.1 1.5h5.7v6.2h-11z', 'M2.5 4v7.7'],
  search: ['M7 11.2a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4Z', 'M10.2 10.2 13.5 13.5'],
  outline: ['M3.5 4h9', 'M3.5 8h9', 'M3.5 12h6'],
  notes: ['M3.2 3.2h9.6v9.6H3.2z', 'M5.5 6.2h5', 'M5.5 8.6h5', 'M5.5 11h3'],
  fullscreen: ['M3 6V3h3', 'M10 3h3v3', 'M13 10v3h-3', 'M6 13H3v-3'],
  sun: [
    'M8 11.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z',
    'M8 1.5v1.2',
    'M8 13.3v1.2',
    'M1.5 8h1.2',
    'M13.3 8h1.2',
    'M3.4 3.4l.85.85',
    'M11.75 11.75l.85.85',
    'M12.6 3.4l-.85.85',
    'M4.25 11.75l-.85.85',
  ],
  moon: ['M12.8 9.6A5.2 5.2 0 1 1 6.4 3.2a4.1 4.1 0 0 0 6.4 6.4Z'],
  auto: ['M8 2.8a5.2 5.2 0 1 0 0 10.4 5.2 5.2 0 0 0 0-10.4Z', 'M8 2.8a5.2 5.2 0 0 1 0 10.4Z'],
  fit: ['M3 6V3h3', 'M13 6V3h-3', 'M3 10v3h3', 'M13 10v3h-3'],
  rotate: ['M12.9 8A4.9 4.9 0 1 1 11.3 4.4', 'M12.9 2.6V5h-2.4'],
  close: ['M4 4l8 8', 'M12 4l-8 8'],
  up: ['M8 12.2V4', 'M4.6 7.4 8 4l3.4 3.4'],
  chevron: ['M6.2 3.8 10.4 8l-4.2 4.2'],
  file: ['M4 2.6h5.2l2.8 2.8v8H4z', 'M9.2 2.6v2.8h2.8'],
  folder: ['M2.6 4.2h4.1l1.1 1.5h5.6v6.1H2.6z'],
}

export function Glyph({ name, size = 16 }) {
  const paths = PATHS[name] ?? PATHS.file
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((definition) => (
        <path key={definition} d={definition} />
      ))}
    </svg>
  )
}
