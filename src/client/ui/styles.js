/**
 * Reader styles.
 *
 * Rules:
 *  - every colour comes from a DSH theme token (`--dsw-alias-*`), with a
 *    scheme-aware system colour fallback so a missing token can never paint a
 *    dark surface into a light shell;
 *  - the panel roots itself with `position: relative; isolation: isolate;
 *    overflow: hidden`, so no descendant can escape the reader area and cover
 *    the application shell (the sidebar included);
 *  - the file library is an inline surface, not a full-window modal scrim;
 *  - the explicit light / dark / sepia reading themes only reskin the reader,
 *    never the shell around it.
 */
export const CSS = `.omr-root {
  --omr-bg: var(--dsw-alias-bg-base, Canvas);
  --omr-fg: var(--dsw-alias-label-primary, CanvasText);
  --omr-fg-secondary: var(--dsw-alias-label-secondary, #5f6368);
  --omr-fg-tertiary: var(--dsw-alias-label-tertiary, #7d8288);
  --omr-border: var(--dsw-alias-border-l1, rgba(127,127,127,.22));
  --omr-border-strong: var(--dsw-alias-border-l2, rgba(127,127,127,.38));
  --omr-layer-1: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.05));
  --omr-layer-2: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.10));
  --omr-layer-3: var(--dsw-alias-bg-layer-3, rgba(127,127,127,.16));
  --omr-hover: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12));
  --omr-page-bg: var(--dsw-alias-bg-document-preview, var(--omr-bg));
  --omr-page-fg: var(--dsw-alias-label-primary, CanvasText);
  --omr-radius-sm: var(--dsw-radius-sm, 4px);
  --omr-radius-md: var(--dsw-radius-md, 8px);
  --omr-mono: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  --omr-font-family: var(--dsw-font-family, var(--dsw-font, system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif));
  --omr-doc-font: var(--omr-font-family);
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  background: var(--omr-bg);
  color: var(--omr-fg);
  font-family: var(--omr-font-family);
  font-size: 13px;
}
.omr-root *,
.omr-root *::before,
.omr-root *::after { box-sizing: border-box; }
.omr-root button { font: inherit; }
.omr-root :focus-visible { outline: 2px solid var(--omr-fg-secondary); outline-offset: 1px; }
.omr-root[data-theme="light"] {
  --omr-page-bg: #ffffff; --omr-page-fg: #1b1b1b; --omr-layer-1: #f7f7f8; --omr-layer-2: #efeff1;
  --omr-fg-secondary: #5c6167; --omr-fg-tertiary: #666b71;
}
.omr-root[data-theme="sepia"] {
  --omr-page-bg: #f6ecd9; --omr-page-fg: #3d3223; --omr-layer-1: #f1e6d0; --omr-layer-2: #e9dcc2; --omr-layer-3: #e0d0b1;
  --omr-fg-secondary: #6b5a44; --omr-fg-tertiary: #74624a;
}
.omr-root[data-theme="dark"] {
  --omr-page-bg: #16181c; --omr-page-fg: #e4e6ea; --omr-bg: #101216;
  --omr-layer-1: #1a1d22; --omr-layer-2: #20242b; --omr-layer-3: #282d36;
  --omr-border: rgba(255,255,255,.09); --omr-border-strong: rgba(255,255,255,.16);
  --omr-hover: rgba(255,255,255,.07);
  --omr-fg: #e4e6ea; --omr-fg-secondary: #a5adb8; --omr-fg-tertiary: #939ba6;
}
.omr-header {
  display: flex; align-items: center; gap: 4px; flex: none;
  padding: 5px 8px; min-height: 40px;
  border-bottom: 1px solid var(--omr-border);
  background: var(--omr-layer-1);
}
.omr-header__title { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1 1 auto; padding: 0 2px; }
.omr-header__actions { display: flex; align-items: center; gap: 1px; flex: none; }
.omr-title-text { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.omr-title-sub { display: flex; align-items: baseline; gap: 6px; font-size: 11px; color: var(--omr-fg-secondary); min-width: 0; }
.omr-title-name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--omr-fg); font-weight: 500; }
.omr-title-path { font-family: var(--omr-mono); font-size: 11px; color: var(--omr-fg-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.omr-spacer { flex: 1 1 auto; }
.omr-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  height: 28px; min-width: 28px; padding: 0 7px;
  border: 0; border-radius: var(--omr-radius-sm); cursor: pointer;
  color: var(--omr-fg-secondary); background: transparent;
  font-size: 12px; line-height: 1;
}
.omr-btn--icon { width: 28px; padding: 0; }
.omr-btn:hover { background: var(--omr-hover); color: var(--omr-fg); }
.omr-btn:active { background: var(--omr-layer-3); }
.omr-btn[aria-pressed="true"] { background: var(--omr-layer-3); color: var(--omr-fg); }
.omr-btn:disabled { opacity: .4; cursor: default; background: transparent; }
.omr-btn--primary { background: var(--omr-layer-3); color: var(--omr-fg); }
.omr-btn--primary:hover { background: var(--omr-layer-2); }
.omr-btn__label { font-size: 12px; }
.omr-tabs { display: flex; align-items: center; gap: 4px; flex: none; min-width: 0; overflow-x: auto; padding: 4px 8px; border-bottom: 1px solid var(--omr-border); background: var(--omr-bg); scrollbar-width: none; }
.omr-tabs::-webkit-scrollbar { display: none; }
.omr-tab {
  display: inline-flex; align-items: center; gap: 2px; flex: none; max-width: 200px;
  height: 26px; padding: 0 3px 0 9px; border-radius: var(--omr-radius-sm);
  border: 1px solid transparent; background: transparent; color: var(--omr-fg-secondary);
  font-size: 12px;
}
.omr-tab:hover { background: var(--omr-hover); }
.omr-tab[data-active="true"] { background: var(--omr-layer-2); border-color: var(--omr-border-strong); color: var(--omr-fg); }
.omr-tab__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 0; background: transparent; color: inherit; font-size: 12px; padding: 0; cursor: pointer; }
.omr-tab-close { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border: 0; padding: 0; border-radius: var(--omr-radius-sm); background: transparent; color: inherit; cursor: pointer; opacity: .7; }
.omr-tab-close:hover { background: var(--omr-hover); opacity: 1; }
.omr-body { display: flex; flex: 1 1 auto; min-width: 0; min-height: 0; }
.omr-aside {
  flex: none; width: 248px; min-width: 0; overflow: auto;
  border-right: 1px solid var(--omr-border); background: var(--omr-layer-1);
  padding: 6px 5px 16px; overscroll-behavior: contain;
}
.omr-aside--right { border-right: 0; border-left: 1px solid var(--omr-border); width: 300px; }
.omr-aside__title { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 6px 8px 8px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--omr-fg-tertiary); }
.omr-viewer { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--omr-page-bg); color: var(--omr-page-fg); }
.omr-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; }
.omr-flow { max-width: var(--omr-flow-width, 760px); margin: 0 auto; padding: 30px 34px 96px; font-size: calc(16px * var(--omr-font-scale, 1)); line-height: var(--omr-line-height, 1.75); color: var(--omr-page-fg); }
.omr-flow.omr-flow--compact { padding: 12px 16px 40px; max-width: none; font-size: 13px; line-height: 1.7; }
.omr-flow h1, .omr-flow h2, .omr-flow h3, .omr-flow h4, .omr-flow h5, .omr-flow h6 { line-height: 1.3; margin: 1.5em 0 .6em; font-weight: 600; scroll-margin-top: 12px; }
.omr-flow h1 { font-size: 1.7em; margin-top: .3em; }
.omr-flow h2 { font-size: 1.38em; }
.omr-flow h3 { font-size: 1.18em; }
.omr-flow h4 { font-size: 1.04em; }
.omr-flow h5, .omr-flow h6 { font-size: 1em; }
.omr-flow p { margin: .75em 0; }
.omr-flow a { color: inherit; text-decoration: underline; text-underline-offset: 2px; text-decoration-color: var(--omr-border-strong); cursor: pointer; }
.omr-flow a:hover { text-decoration-color: currentColor; }
.omr-flow del { opacity: .7; }
.omr-flow ul, .omr-flow ol { margin: .6em 0; padding-left: 1.6em; }
.omr-flow li { margin: .25em 0; }
.omr-flow li[data-checked] { list-style: none; margin-left: -1.3em; }
.omr-flow blockquote { margin: .9em 0; padding: .1em 1em; border-left: 3px solid var(--omr-border-strong); color: var(--omr-fg-secondary); }
.omr-flow hr { border: 0; border-top: 1px solid var(--omr-border); margin: 1.6em 0; }
.omr-flow pre { margin: .9em 0; padding: 12px 14px; overflow: auto; background: var(--omr-layer-2); border: 1px solid var(--omr-border); border-radius: var(--omr-radius-md); font-family: var(--omr-mono); font-size: .86em; line-height: 1.55; }
.omr-code-wrap { position: relative; margin: .9em 0; }
.omr-code-wrap pre { margin: 0; }
.omr-code-copy { position: absolute; top: 6px; right: 6px; background: var(--omr-layer-3) !important; }
.omr-flow code { font-family: var(--omr-mono); font-size: .88em; background: var(--omr-layer-2); padding: .1em .32em; border-radius: 3px; }
.omr-flow pre code { background: transparent; padding: 0; font-size: 1em; }
.omr-flow table { border-collapse: collapse; margin: .9em 0; width: 100%; font-size: .94em; }
.omr-flow th, .omr-flow td { border: 1px solid var(--omr-border-strong); padding: 6px 10px; text-align: left; vertical-align: top; }
.omr-flow th { background: var(--omr-layer-2); font-weight: 600; }
.omr-flow img { max-width: 100%; height: auto; display: block; margin: 1em auto; border-radius: var(--omr-radius-sm); }
.omr-flow figure { margin: 1em 0; }
.omr-flow figcaption { font-size: .86em; color: var(--omr-fg-secondary); text-align: center; }
.omr-flow .omr-math { font-family: var(--omr-mono); background: var(--omr-layer-2); display: block; padding: 10px 14px; margin: .9em 0; border-radius: var(--omr-radius-md); overflow: auto; white-space: pre-wrap; }
.omr-flow mark.omr-hl, .omr-flow .omr-block-hl { background: rgba(255, 214, 0, .32); border-radius: 2px; }
.omr-chapter { scroll-margin-top: 8px; }
.omr-chapter + .omr-chapter { border-top: 1px solid var(--omr-border); margin-top: 2em; padding-top: 1em; }
.omr-outline { display: flex; flex-direction: column; gap: 1px; }
.omr-outline-item {
  display: block; width: 100%; text-align: left; border: 0; background: transparent;
  color: var(--omr-fg-secondary); font-size: 12px; line-height: 1.4;
  padding: 5px 8px; border-radius: var(--omr-radius-sm); cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.omr-outline-item:hover { background: var(--omr-hover); color: var(--omr-fg); }
.omr-outline-item[data-active="true"],
.omr-outline-item[aria-current="location"] { background: var(--omr-layer-3); color: var(--omr-fg); }
.omr-outline-item[data-level="1"] { padding-left: 20px; }
.omr-outline-item[data-level="2"] { padding-left: 32px; }
.omr-outline-item[data-level="3"] { padding-left: 44px; }
.omr-outline-item--untargeted {
  color: var(--omr-fg-tertiary);
  cursor: default;
}
.omr-outline-item--untargeted:hover { background: transparent; color: var(--omr-fg-tertiary); }
.omr-pdf-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 16px; display: flex; flex-direction: column; align-items: center; gap: 14px; background: var(--omr-layer-2); overscroll-behavior: contain; }
.omr-pdf-page { position: relative; background: #fff; box-shadow: var(--dsw-elevation-prominent, 0 2px 10px rgba(0,0,0,.18)); }
.omr-pdf-page canvas { display: block; }
.omr-pdf-textlayer { position: absolute; inset: 0; overflow: hidden; opacity: 1; line-height: 1; }
.omr-pdf-textlayer span { position: absolute; color: transparent; white-space: pre; transform-origin: 0 0; cursor: text; }
.omr-pdf-textlayer ::selection { background: rgba(76, 141, 255, .35); }
.omr-pdf-placeholder { display: flex; align-items: center; justify-content: center; color: var(--omr-fg-tertiary); font-size: 12px; background: #fff; }
.omr-footer {
  display: flex; align-items: center; gap: 12px; flex: none;
  padding: 5px 12px; border-top: 1px solid var(--omr-border);
  background: var(--omr-layer-1); color: var(--omr-fg-secondary); font-size: 11px;
  white-space: nowrap; overflow: hidden;
}
.omr-footer__item { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
.omr-footer__spacer { flex: 1 1 auto; }
.omr-footer__progress { display: inline-flex; align-items: center; gap: 6px; }
.omr-footer__warn { color: var(--dsw-alias-state-warn-label, #b45309); }
.omr-progress { width: 120px; height: 3px; flex: none; background: var(--omr-layer-3); border-radius: 2px; overflow: hidden; }
.omr-progress > span { display: block; height: 100%; background: var(--dsw-alias-label-secondary, #888); }
.omr-center { flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 32px; text-align: center; color: var(--omr-fg-secondary); min-height: 0; }
.omr-center h2 { margin: 0; font-size: 15px; color: var(--omr-fg); font-weight: 600; }
.omr-center p { margin: 0; max-width: 460px; line-height: 1.6; }
.omr-center--error h2 { color: var(--dsw-alias-state-warn-label, #b45309); }
.omr-error__badge { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--omr-fg-secondary); border: 1px solid var(--omr-border-strong); border-radius: 999px; padding: 1px 8px; }
.omr-error__message { font-family: var(--omr-mono); font-size: 11px; color: var(--omr-fg-secondary); max-width: 560px; word-break: break-word; }
.omr-error__actions { display: flex; gap: 8px; margin-top: 4px; }
.omr-spinner { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--omr-layer-3); border-top-color: var(--omr-fg-secondary); animation: omr-spin .8s linear infinite; }
@keyframes omr-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .omr-spinner { animation-duration: 2.4s; } }
.omr-library { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; background: var(--omr-bg); }
.omr-library__roots { flex: 0 0 220px; min-height: 0; overflow: auto; border-right: 1px solid var(--omr-border); padding: 6px 4px 16px; background: var(--omr-layer-1); overscroll-behavior: contain; }
.omr-library__main { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; }
.omr-library__pathbar { display: flex; align-items: center; gap: 6px; flex: none; margin: 0; }
.omr-library__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex: none; min-width: 0; }
.omr-library__crumbs { display: flex; align-items: center; gap: 2px; flex: 1 1 auto; min-width: 0; overflow-x: auto; white-space: nowrap; font-family: var(--omr-mono); font-size: 11px; scrollbar-width: thin; overscroll-behavior-x: contain; }
.omr-crumb { flex: none; max-width: 220px; overflow: hidden; text-overflow: ellipsis; border: 0; background: transparent; color: var(--omr-fg-tertiary); font: inherit; padding: 3px 5px; border-radius: 4px; cursor: pointer; }
.omr-crumb:hover { background: var(--omr-hover); color: var(--omr-fg); }
.omr-crumb:active { background: var(--omr-layer-3); }
.omr-crumb:focus-visible { outline: 2px solid var(--omr-fg-secondary); outline-offset: 1px; }
.omr-crumb[aria-current="true"] { color: var(--omr-fg); font-weight: 600; cursor: default; }
.omr-crumb[aria-current="true"]:hover { background: transparent; }
.omr-crumb__sep { flex: none; color: var(--omr-fg-tertiary); opacity: .6; }
.omr-library__cwd { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--omr-mono); font-size: 11px; color: var(--omr-fg-tertiary); }
.omr-library__list { list-style: none; margin: 0; padding: 0; flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; }
.omr-library__list > li { display: block; }
.omr-input { flex: 1 1 auto; min-width: 0; height: 30px; padding: 0 10px; font-size: 12px; font-family: var(--omr-mono); color: var(--omr-fg); background: var(--omr-layer-2); border: 1px solid var(--omr-border-strong); border-radius: var(--omr-radius-sm); outline: none; }
.omr-input::placeholder { color: var(--omr-fg-tertiary); }
.omr-input:focus { border-color: var(--omr-fg-tertiary); }
.omr-row { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: transparent; color: var(--omr-fg); font-size: 12px; text-align: left; padding: 6px 8px; border-radius: var(--omr-radius-sm); cursor: pointer; }
.omr-row:hover { background: var(--omr-hover); }
.omr-row[data-active="true"] { background: var(--omr-layer-3); }
.omr-row[data-readonly="true"] { opacity: .5; cursor: default; }
.omr-row[data-readonly="true"]:hover { background: transparent; }
.omr-row__name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.omr-row__meta { flex: none; color: var(--omr-fg-tertiary); font-size: 11px; }
.omr-row__icon { flex: none; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; color: var(--omr-fg-tertiary); }
.omr-section-label { padding: 8px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--omr-fg-tertiary); }
.omr-search { display: flex; flex-direction: column; gap: 6px; padding: 8px; }
.omr-search__meta { font-size: 11px; color: var(--omr-fg-tertiary); padding: 0 8px 4px; }
.omr-result { display: block; width: 100%; text-align: left; border: 0; background: transparent; color: var(--omr-fg); font-size: 12px; line-height: 1.45; padding: 6px 8px; border-radius: var(--omr-radius-sm); cursor: pointer; }
.omr-result:hover { background: var(--omr-hover); }
.omr-result__where { display: block; font-size: 10px; font-weight: 600; letter-spacing: .03em; color: var(--omr-fg-tertiary); margin-bottom: 2px; }
.omr-result__excerpt { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.omr-result mark { background: rgba(255, 214, 0, .4); color: inherit; padding: 0; }
.omr-note { display: flex; flex-direction: column; gap: 4px; padding: 8px; border-bottom: 1px solid var(--omr-border); }
.omr-note__meta { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 10px; color: var(--omr-fg-tertiary); }
.omr-note__body { font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.omr-note textarea { width: 100%; min-height: 64px; resize: vertical; font-size: 12px; line-height: 1.5; padding: 6px 8px; color: var(--omr-fg); background: var(--omr-layer-2); border: 1px solid var(--omr-border-strong); border-radius: var(--omr-radius-sm); outline: none; }
.omr-note-actions { display: flex; justify-content: flex-end; gap: 6px; }
.omr-outline-item--unreliable {
  opacity: 0.55;
  cursor: not-allowed;
}
.omr-outline-note {
  margin: 0;
  padding: 7px 10px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--omr-fg-secondary);
  border-bottom: 1px solid var(--omr-border);
}
.omr-empty { padding: 18px 12px; text-align: center; color: var(--omr-fg-tertiary); font-size: 12px; line-height: 1.6; }
.omr-empty--tight { padding: 6px 8px; text-align: left; }
.omr-empty--error { color: var(--dsw-alias-state-warn-label, #b45309); }
.omr-kbd { display: inline-block; min-width: 16px; padding: 1px 5px; border: 1px solid var(--omr-border-strong); border-radius: 3px; font-family: var(--omr-mono); font-size: 10px; color: var(--omr-fg-secondary); background: var(--omr-layer-2); }
.omr-hidden { display: none !important; }
.omr-seg { display: inline-flex; align-items: center; gap: 2px; padding: 2px; background: var(--omr-layer-2); border-radius: var(--omr-radius-sm); }
.omr-seg .omr-btn { height: 24px; min-width: 24px; }
.omr-badge { display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border-radius: 9px; font-size: 10px; background: var(--omr-layer-3); color: var(--omr-fg-secondary); }
.omr-root:fullscreen { width: 100vw; height: 100vh; background: var(--omr-bg); }
@media (max-width: 1000px) {
  .omr-aside { width: 200px; }
  .omr-aside--right { display: none; }
  .omr-flow { padding: 22px 20px 80px; }
}
@media (max-width: 760px) {
  .omr-aside { display: none; }
  .omr-library__roots { flex-basis: 150px; }
}
@media (max-width: 620px) {
  .omr-library__roots { display: none; }
  .omr-library__main { padding: 8px; }
}
/* Embedded quick preview inside the built-in document preview body. */
.omr-root--embedded { display: block; height: auto; min-height: 0; overflow: visible; background: transparent; }
.omr-root--embedded .omr-flow { padding: 10px 4px 40px; }
.omr-root--embedded .omr-flow--compact { font-size: 13px; }
`
