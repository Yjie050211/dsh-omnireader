# OmniReader

A local-first, multi-format document reader plugin for **DeepSeek Harness** (`dsh`).
It opens **Markdown, PDF, DOCX, EPUB and MOBI/AZW3** files from the workspace or the
local disk, and adds both a quick side preview and a full immersive reading panel to
the Harness Web UI.

OmniReader is a *reader*: it never uploads a document, never calls a model, and never
sends what you read into an agent conversation unless you explicitly ask for that.

```text
┌──────────────────────────────────────────────────────────────┐
│ OmniReader        tabs · search · outline · notes · theme    │
├────────────┬──────────────────────────────┬──────────────────┤
│  Outline   │        document body         │  Notes / Marks   │
│  chapters  │  reflowed blocks / PDF pages │  bookmarks       │
├────────────┴──────────────────────────────┴──────────────────┤
│ format · page/chapter · progress · host status               │
└──────────────────────────────────────────────────────────────┘
```

## Features

### Two reading surfaces

| | where | best for |
|---|---|---|
| **Quick preview** | the existing right-hand document pane (`sidebar.right.tab.document`) | clicking a file in the file tree, peeking at an agent-generated document, glimpsing a chapter without leaving the conversation |
| **Immersive reader** | a first-class `main` panel with its own sidebar entry | papers, ebooks, long DOCX documents, large technical docs |

The quick preview reuses Harness' own document-preview slot machinery: for EPUB/MOBI/
AZW3 the plugin registers a new renderer body, and for **every** previewed file it adds
an **Open in OmniReader** button to the preview header. The built-in Markdown, PDF,
DOCX, XLSX, image and HTML previews are left untouched — OmniReader never replaces an
existing renderer, so disabling the plugin restores the original behaviour exactly.

### Formats

| format | engine | outline | search | text selection | page jump | progress anchor |
|---|---|---|---|---|---|---|
| Markdown / GFM | own parser (`src/client/formats/markdown.js`) | ✅ headings + frontmatter title | ✅ | ✅ native text | – | chapter + block |
| PDF | bundled `pdf.js` (worker inlined) | ✅ embedded outline | ✅ full text | ✅ text layer | ✅ page / zoom / rotate | page + scale + rotation |
| DOCX | OOXML → reflowable blocks | ✅ heading styles | ✅ | ✅ native text | – | chapter + block |
| EPUB 2/3 | own ZIP + OPF/NCX/nav parser | ✅ nav / NCX | ✅ | ✅ native text | – | chapter + block |
| MOBI / KF8 / AZW / AZW3 | PalmDOC/KF8 text + image records | ✅ generated | ✅ | ✅ native text | – | chapter + block |

Every format has a real open path — the file is parsed and rendered, not just
recognised by extension. Encrypted (DRM), HUFF/CDIC-compressed, truncated or
otherwise unreadable files fail with a readable, specific error instead of a blank pane.

### Reading features

- **Navigation** — outline sidebars (collapsible), per-format location jumps, PDF page
  number entry, previous/next page or chapter, `Ctrl/Cmd+O` library.
- **Search** — in-document search with debounce and cancellation, result highlighting,
  jump-to-hit; PDF search runs across pages and reports per-hit page numbers. Scanned
  PDFs (no text layer) honestly report zero hits instead of pretending.
- **Reading progress** — saved per absolute path (`page + scale + rotation` for PDF,
  `chapter + block` for reflowed formats), restored on reopen, and kept across panel
  switches.
- **Appearance** — DSH theme integration, `auto/light/sepia/dark` reading themes,
  font-size steps for reflowed text, PDF zoom (fit-width or 75 %–300 %) and rotation.
- **Bookmarks & notes** — stored Host-side per document, jumpable, deletable.
- **Multi-document tabs** — up to 8 open documents (oldest evicted), tabs survive panel
  switches and are restored from the library/recent list.
- **Keyboard** — `Ctrl/Cmd+F` search, `Ctrl/Cmd+O` library, `Ctrl/Cmd+=` / `Ctrl/Cmd+-`
  font or zoom, `Esc` close search/library, `Ctrl/Cmd+W` close tab, fullscreen toggle.

All visible text is routed through the Harness client locale service (`en`, `zh`),
and every colour comes from `--dsw-alias-*` design tokens so the UI follows the
Harness theme (including dark mode).

## Installing

OmniReader is an ordinary Cordis plugin bundle (`dsh.bundle.patch` +
`dsh.client.platform: "web"`). Build the client artifact once, then install the
bundle directory by **absolute path** with the Plugin Manager:

```bash
# 1. build the browser artifact (writes lib/client.js and lib/pdf.worker.min.mjs)
pnpm install          # or: npm install --ignore-scripts
node build.mjs

# 2. install in DSH
#    plugin_manager → install_bundle → target = absolute path of this directory
#    (or Settings → Plugins → install from local directory)
```

`install_bundle` reports `application: "applied"` when the plugin is live. Replacing an
already-installed package needs `remove_bundle` first (or a DSH restart for a fresh JS
generation), as with any Harness plugin.

Prebuilt artifacts are committed (`lib/client.js`, `lib/pdf.worker.min.mjs`), so a
fresh clone can be installed immediately; `node build.mjs` is only needed after
editing `src/`.

The Host half (`index.js`) serves a small loopback-only helper API used by the reader
UI (`/api/omnireader/*`: file metadata, bytes, directory listing, persisted state and
diagnostics). It is registered through `ctx.webServer.register` and disposed with the
plugin; there is no external service, no account, no telemetry.

## Project layout

```text
dsh-omnireader/
├── package.json              # bundle manifest (dsh.bundle + dsh.client)
├── cordis.patch.yml          # one insert row: id omnireader
├── index.js                  # Host half: loopback file/state/diagnostics routes
├── icon.svg / locale/*.json  # display metadata for Settings → Plugins
├── build.mjs                 # esbuild bundler + pdf.js worker embedding
├── src/client/
│   ├── entry.jsx             # plugin apply(): slots, preview renderer, action
│   ├── dict.js               # en/zh dictionaries
│   ├── lib/{http,store,util}.js
│   ├── formats/{zip,dom,flow,markdown,pdf,docx,epub,mobi,index}.js
│   └── ui/{ReaderPanel,Library,Outline,SearchPanel,NotesPanel,FlowView,PdfView,styles,context}
├── lib/                      # built client bundle + pdf worker (committed)
└── tests/                    # node --test suites + self-authored fixtures
```

### Architecture notes

- **Host / Client split** — the Host half owns file-system access and persistence
  (atomic JSON writes under `$DSH_HOME/omnireader/`), the Client half owns parsing,
  rendering and interaction. The browser cannot read arbitrary paths, so reads go
  through the authenticated loopback route; the route only accepts absolute local
  paths and enforces size limits.
- **Per-format adapters** — each format returns either a *flow model*
  (`chapters → blocks`) or a *PDF model*. The UI only knows those two shapes and asks
  the model for `outline`, `search`, `capabilities`; there are no extension-name
  branches in the components.
- **Bounded work** — ZIP entry count/size/total caps, archive path-traversal rejection,
  MOBI/EPUB/DOCX byte limits, PDF page virtualization with an IntersectionObserver
  (`900px` margin) that releases off-screen canvases, windowed chapter rendering for
  long flow documents, debounced + cancellable search, and per-tab `AbortController`s
  so switching documents cannot race a slower parse.

## Security posture

- Reads only paths the user picks; no widening of workspace access, no traversal, no
  source file is ever written, moved or deleted.
- Sanitising HTML→block converter: `script/iframe/object/embed/form/svg/math` and
  friends are dropped, `javascript:`/`data:` URLs are refused, only `http/https/mailto/
  file` links survive, images resolve only to local archive/dir paths or the loopback
  file route.
- EPUB embedded scripts are never executed: the reader parses XHTML into a neutral
  block model instead of injecting markup or mounting a browser frame.
- DOCX/EPUB/MOBI containers are read with a custom ZIP decoder that rejects
  `..`/absolute/UNC entries and caps decompression (zip-slip/zip-bomb safe).
- The Host routes are loopback-only, JSON content-type checked and size capped; state
  files are written atomically.
- No network requests for content (no CDN, no remote fonts, no telemetry); remote
  images inside Markdown are shown as alt text rather than fetched.

## Verification

`node --test "tests/**/*.test.mjs"` — 17 tests covering the ZIP decoder (including
traversal rejection), Markdown parsing, MOBI PalmDOC decompression, format detection and
capability declarations.

End-to-end behaviour was verified inside the live DSH page (the plugin's client bundle
reports structured diagnostics to `/api/omnireader/diag`, which were read back from
`$DSH_HOME/omnireader/diagnostics.jsonl`):

- all five formats open and reach `ready` in the immersive reader;
- PDF multi-page search (`hits: 3` across pages 1–2), page+scale+rotation restored after
  close/reopen, scanned PDF correctly yields `0` hits;
- EPUB: 31 chapters, 32 outline entries, 112-block search index, bookmarks/notes
  round-trip, reading location restored after a document switch;
- MOBI: 31 chapters rendered from the PalmDOC text records;
- quick preview renders EPUB through the real `sidebar.right.tab.document` body, and
  "Open in OmniReader" is registered in the preview header;
- corrupt EPUB/MOBI and an unsupported `.txt` each produce a specific error state
  instead of crashing;
- theme switching (dark) and font-size changes apply, and the panel stays mounted across
  a DSH panel switch.

## Limitations (honest list)

- **Immutable Host code until restart.** The Host half is loaded when the plugin is
  installed; edits to `index.js` require a DSH restart. (The client bundle hot-reloads.)
- **DOCX is reflow-only.** The exact paginated layout is available through Harness'
  built-in DOCX→PDF preview; OmniReader's own DOCX mode is a clean reading flow
  (headings, tables, images, links). LibreOffice/Word files with complex section
  layouts may reflow differently.
- **Markdown extras.** Tables, task lists, code fences, math and images are supported,
  but Mermaid diagrams are shown as code and math is shown as a formula block — no TeX
  or Mermaid engines are bundled (the built-in Markdown preview still renders the
  original if you need its exact output). Syntax highlighting is per-code-block only,
  not Shiki-level.
- **No PDF form fields, annotations or OCR.** Scanned PDFs display but are not
  searchable. (OCR is planned as an opt-in future feature.)
- **Fixed-layout EPUB** is read as a reflowed flow (the layout is not recreated).
- **DRM is not supported** — a book that declares encryption is refused with an explicit
  message.
- **No AI features.** Summarisation / Q&A / translate are intentionally absent; the
  reader spends no tokens to display a document.

## Development

```bash
node build.mjs                       # esbuild bundle → lib/client.js
node --test "tests/**/*.test.mjs"    # unit tests
```

The bundle is wrapped in `window.__ModuleLoader__.load({ id, factory })`, so the only
external module is React from the Harness platform module table; `pdfjs-dist` and every
parser are bundled. Only `react` and the platform table packages are `external` in
`build.mjs`.

## Updating, disabling, uninstalling

- **Update**: edit `src/`, run `node build.mjs` (a linked workspace bundle hot-reloads in
  the running page). If the package version or `index.js` changed, remove and reinstall
  the bundle (or restart DSH) so the Host half is reloaded.
- **Disable**: Settings → Plugins → disable `dsh-omnireader`. The preview renderer
  registration and the sidebar/panel entries disappear; built-in document previews keep
  working unchanged.
- **Uninstall**: `plugin_manager` → `remove_bundle` (`dsh-omnireader`), or remove it in
  Settings → Plugins. Bookmarks/notes/progress live in `$DSH_HOME/omnireader/state.json`
  and are not deleted by uninstalling — delete that directory to forget everything.

## License

MIT. Fixtures under `tests/fixtures/` are self-authored except the public-domain
Gutenberg ebook; see `tests/fixtures/README.md`.
