/**
 * Reader styles.
 *
 * Everything is expressed through DSH theme tokens (`--dsw-alias-*`) so the
 * reader follows the Harness theme; the explicit light/dark/sepia reading
 * themes only override the document surface itself. Class names are prefixed
 * with `omr-` to stay clear of other plugins.
 */

export const CSS = `.omr-root {
  --omr-bg: var(--dsw-alias-bg-base, #fff);
  --omr-fg: var(--dsw-alias-label-primary, #1a1a1a);
  --omr-fg-secondary: var(--dsw-alias-label-secondary, #666);
  --omr-fg-tertiary: var(--dsw-alias-label-tertiary, #8a8a8a);
  --omr-border: var(--dsw-alias-border-l1, rgba(0,0,0,.08));
  --omr-border-strong: var(--dsw-alias-border-l2, rgba(0,0,0,.14));
  --omr-layer-1: var(--dsw-alias-bg-layer-1, #fafafa);
  --omr-layer-2: var(--dsw-alias-bg-layer-2, #f2f2f2);
  --omr-layer-3: var(--dsw-alias-bg-layer-3, #eaeaea);
  --omr-hover: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05));
  --omr-page-bg: var(--dsw-alias-bg-document-preview, var(--dsw-alias-bg-base, #fff));
  --omr-page-fg: var(--dsw-alias-label-primary, #1a1a1a);
  --omr-radius-sm: var(--dsw-radius-sm, 4px);
  --omr-radius-md: var(--dsw-radius-md, 8px);
  --omr-mono: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  --omr-font-family: var(--dsw-font-family, var(--dsw-font, system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif));
  --omr-doc-font: var(--omr-font-family);
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--omr-bg);
  color: var(--omr-fg);
  font-family: var(--omr-font-family);
  font-size: 13px;
}
.omr-root[data-theme="light"] { --omr-page-bg: #ffffff; --omr-page-fg: #1b1b1b; --omr-layer-1: #f7f7f8; --omr-layer-2: #efeff1; }
.omr-root[data-theme="sepia"] { --omr-page-bg: #f6ecd9; --omr-page-fg: #3d3223; --omr-layer-1: #f1e6d0; --omr-layer-2: #e9dcc2; --omr-layer-3: #e0d0b1; }
.omr-root[data-theme="dark"] { --omr-page-bg: #16181c; --omr-page-fg: #e4e6ea; --omr-bg: #101216; --omr-layer-1: #1a1d22; --omr-layer-2: #20242b; --omr-layer-3: #282d36; --omr-border: rgba(255,255,255,.09); --omr-border-strong: rgba(255,255,255,.16); --omr-hover: rgba(255,255,255,.07); --omr-fg: #e4e6ea; --omr-fg-secondary: #a5adb8; --omr-fg-tertiary: #7d858f; }
.omr-header {
  display: flex; align-items: center; gap: 6px; flex: none;
  padding: 6px 10px; min-height: 40px;
  border-bottom: 1px solid var(--omr-border);
  background: var(--omr-layer-1);
}
.omr-title { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1 1 auto; }
.omr-title-text { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.omr-title-sub { font-size: 11px; color: var(--omr-fg-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.omr-spacer { flex: 1 1 auto; }
.omr-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  height: 28px; min-width: 28px; padding: 0 6px;
  border: 0; border-radius: var(--omr-radius-sm); cursor: pointer;
  color: var(--omr-fg-secondary); background: transparent;
  font-size: 12px; font-family: inherit;
}
.omr-btn:hover { background: var(--omr-hover); color: var(--omr-fg); }
.omr-btn:focus-visible { outline: 2px solid var(--dsw-alias-state-warn-label, #4c8dff); outline-offset: 1px; }
.omr-btn[aria-pressed="true"] { background: var(--omr-layer-3); color: var(--omr-fg); }
.omr-btn:disabled { opacity: .45; cursor: default; }
.omr-btn--primary { background: var(--omr-layer-3); color: var(--omr-fg); }
.omr-btn__label { font-size: 12px; }
.omr-tabs { display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; }
.omr-tab {
  display: inline-flex; align-items: center; gap: 4px; max-width: 180px;
  height: 28px; padding: 0 6px 0 10px; border-radius: var(--omr-radius-sm);
  border: 1px solid transparent; background: transparent; color: var(--omr-fg-secondary);
  font-size: 12px; cursor: pointer; font-family: inherit;
}
.omr-tab:hover { background: var(--omr-hover); }
.omr-tab[data-active="true"] { background: var(--omr-layer-2); border-color: var(--omr-border-strong); color: var(--omr-fg); }
.omr-tab-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.omr-tab-close { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border: 0; padding: 0; border-radius: var(--omr-radius-sm); background: transparent; color: inherit; cursor: pointer; font-size: 13px; line-height: 1; }
.omr-tab-close:hover { background: var(--omr-hover); }
.omr-body { display: flex; flex: 1 1 auto; min-height: 0; }
.omr-aside { flex: none; width: 248px; min-width: 0; overflow: auto; border-right: 1px solid var(--omr-border); background: var(--omr-layer-1); padding: 8px 6px 16px; }
.omr-aside--right { border-right: 0; border-left: 1px solid var(--omr-border); width: 292px; }
.omr-aside__title { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 4px 8px 8px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--omr-fg-tertiary); }
.omr-viewer { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--omr-page-bg); color: var(--omr-page-fg); }
.omr-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; }
.omr-flow { max-width: var(--omr-flow-width, 760px); margin: 0 auto; padding: 28px 32px 96px; font-size: calc(16px * var(--omr-font-scale, 1)); line-height: var(--omr-line-height, 1.75); color: var(--omr-page-fg); }
.omr-theme-sepia .omr-flow { color: #3d3223; }
.omr-flow.omr-flow--compact { padding: 12px 16px 48px; max-width: none; font-size: 13px; line-height: 1.7; }
.omr-flow h1, .omr-flow h2, .omr-flow h3, .omr-flow h4, .omr-flow h5, .omr-flow h6 { line-height: 1.3; margin: 1.4em 0 .6em; font-weight: 600; scroll-margin-top: 12px; }
.omr-flow h1 { font-size: 1.7em; margin-top: .4em; }
.omr-flow h2 { font-size: 1.38em; }
.omr-flow h3 { font-size: 1.18em; }
.omr-flow h4 { font-size: 1.04em; }
.omr-flow h5, .omr-flow h6 { font-size: 1em; }
.omr-flow p { margin: .75em 0; }
.omr-flow a { color: inherit; text-decoration: underline; text-underline-offset: 2px; text-decoration-color: var(--omr-border-strong); cursor: pointer; }
.omr-flow a:hover { text-decoration-color: currentColor; }
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
  color: var(--omr-fg-secondary); font-size: 12px; line-height: 1.4; font-family: inherit;
  padding: 5px 8px; border-radius: var(--omr-radius-sm); cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.omr-outline-item:hover { background: var(--omr-hover); color: var(--omr-fg); }
.omr-outline-item[data-active="true"] { background: var(--omr-layer-3); color: var(--omr-fg); }
.omr-outline-item[data-level="1"] { padding-left: 20px; }
.omr-outline-item[data-level="2"] { padding-left: 32px; }
.omr-outline-item[data-level="3"] { padding-left: 44px; }
.omr-pdf-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 16px; display: flex; flex-direction: column; align-items: center; gap: 14px; background: var(--omr-layer-2); }
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
.omr-footer__item { display: inline-flex; align-items: center; gap: 4px; }
.omr-footer__warn { color: var(--dsw-alias-state-warn-label, #c47f00); }
.omr-progress { width: 120px; height: 3px; flex: none; background: var(--omr-layer-3); border-radius: 2px; overflow: hidden; }
.omr-progress > span { display: block; height: 100%; background: var(--dsw-alias-label-secondary, #888); }
.omr-center { flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 32px; text-align: center; color: var(--omr-fg-secondary); }
.omr-center h2 { margin: 0; font-size: 15px; color: var(--omr-fg); font-weight: 600; }
.omr-center p { margin: 0; max-width: 460px; line-height: 1.6; }
.omr-center--error h2 { color: var(--dsw-alias-state-warn-label, #c47f00); }
.omr-spinner { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--omr-layer-3); border-top-color: var(--omr-fg-secondary); animation: omr-spin .8s linear infinite; }
@keyframes omr-spin { to { transform: rotate(360deg); } }
.omr-library { position: absolute; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.24); }
.omr-library__panel { width: min(720px, calc(100vw - 64px)); height: min(560px, calc(100vh - 96px)); display: flex; flex-direction: column; background: var(--omr-bg); color: var(--omr-fg); border: 1px solid var(--omr-border-strong); border-radius: var(--omr-radius-md); box-shadow: var(--dsw-elevation-prominent, 0 12px 40px rgba(0,0,0,.28)); overflow: hidden; }
.omr-library__head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--omr-border); }
.omr-input { flex: 1 1 auto; min-width: 0; height: 30px; padding: 0 10px; font-size: 12px; font-family: var(--omr-mono); color: var(--omr-fg); background: var(--omr-layer-2); border: 1px solid var(--omr-border-strong); border-radius: var(--omr-radius-sm); outline: none; }
.omr-input:focus { border-color: var(--dsw-alias-state-warn-label, #4c8dff); }
.omr-library__body { flex: 1 1 auto; min-height: 0; display: flex; }
.omr-library__side { width: 200px; flex: none; overflow: auto; border-right: 1px solid var(--omr-border); padding: 6px; }
.omr-library__list { flex: 1 1 auto; min-width: 0; overflow: auto; padding: 6px; }
.omr-row { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: transparent; color: var(--omr-fg); font-family: inherit; font-size: 12px; text-align: left; padding: 6px 8px; border-radius: var(--omr-radius-sm); cursor: pointer; }
.omr-row:hover { background: var(--omr-hover); }
.omr-row[data-active="true"] { background: var(--omr-layer-3); }
.omr-row__name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.omr-row__meta { flex: none; color: var(--omr-fg-tertiary); font-size: 11px; }
.omr-row__icon { flex: none; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; color: var(--omr-fg-tertiary); }
.omr-section-label { padding: 8px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--omr-fg-tertiary); }
.omr-search { display: flex; flex-direction: column; gap: 6px; padding: 8px; }
.omr-search__meta { font-size: 11px; color: var(--omr-fg-tertiary); padding: 0 8px 4px; }
.omr-result { display: block; width: 100%; text-align: left; border: 0; background: transparent; color: var(--omr-fg); font-family: inherit; font-size: 12px; line-height: 1.45; padding: 6px 8px; border-radius: var(--omr-radius-sm); cursor: pointer; }
.omr-result:hover { background: var(--omr-hover); }
.omr-result__where { display: block; font-size: 10px; font-weight: 600; letter-spacing: .03em; color: var(--omr-fg-tertiary); margin-bottom: 2px; }
.omr-result__excerpt { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.omr-result mark { background: rgba(255, 214, 0, .4); color: inherit; padding: 0; }
.omr-note { display: flex; flex-direction: column; gap: 4px; padding: 8px; border-bottom: 1px solid var(--omr-border); }
.omr-note__meta { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 10px; color: var(--omr-fg-tertiary); }
.omr-note__body { font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.omr-note textarea { width: 100%; min-height: 64px; resize: vertical; font-family: inherit; font-size: 12px; line-height: 1.5; padding: 6px 8px; color: var(--omr-fg); background: var(--omr-layer-2); border: 1px solid var(--omr-border-strong); border-radius: var(--omr-radius-sm); outline: none; }
.omr-note-actions { display: flex; justify-content: flex-end; gap: 6px; }
.omr-empty { padding: 18px 12px; text-align: center; color: var(--omr-fg-tertiary); font-size: 12px; line-height: 1.6; }
.omr-kbd { display: inline-block; min-width: 16px; padding: 1px 5px; border: 1px solid var(--omr-border-strong); border-radius: 3px; font-family: var(--omr-mono); font-size: 10px; color: var(--omr-fg-secondary); background: var(--omr-layer-2); }
.omr-hidden { display: none !important; }
.omr-seg { display: inline-flex; align-items: center; gap: 2px; padding: 2px; background: var(--omr-layer-2); border-radius: var(--omr-radius-sm); }
.omr-seg .omr-btn { height: 24px; min-width: 24px; }
.omr-badge { display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border-radius: 9px; font-size: 10px; background: var(--omr-layer-3); color: var(--omr-fg-secondary); }
@media (max-width: 900px) {
  .omr-aside { width: 200px; }
  .omr-aside--right { display: none; }
  .omr-flow { padding: 20px 18px 80px; }
}
@media (max-width: 720px) {
  .omr-aside { display: none; }
}
/* Embedded quick preview inside the built-in document preview body. */
.omr-root--embedded {
  display: block;
  height: auto;
  min-height: 0;
  background: transparent;
}
.omr-root--embedded .omr-flow { padding: 10px 4px 48px; }
.omr-root--embedded .omr-flow--compact { font-size: 13px; }
`
