/**
 * The stylesheet of the code intelligence plugin.
 *
 * The rules are the ones of the IDE workbench that belong to the plugin
 * (CUT-09 of PRD-v6 §4.3): the status cell of the semantic analysis, the
 * diagnostics panel, the search popup, the Ctrl+hover hint and the rows of
 * the settings page.
 *
 * The stylesheet is inserted once, when the module is loaded: it is a string
 * of ~30 KB, and parsing it on every render of every Session would cost
 * more than the plugin saves (the same rule as the core, PRD-v5 PERF-04).
 */
export const CSS = `
.iwb-codeintel, .iwb-settings {
  --iwb-bg: var(--dsw-alias-bg-base, #15171c);
  --iwb-panel: var(--dsw-alias-bg-layer-1, #191d24);
  --iwb-panel-2: var(--dsw-alias-bg-layer-2, #22262e);
  --iwb-overlay: var(--dsw-alias-bg-overlay, #262b34);
  --iwb-border: var(--dsw-alias-border-l1, #2c313a);
  --iwb-border-strong: var(--dsw-alias-border-l2, #3b424e);
  --iwb-divider: var(--dsw-alias-border-l2, #3b424e);
  --iwb-fg: var(--dsw-alias-label-primary, #ccd2da);
  --iwb-muted: var(--dsw-alias-label-secondary, #8a93a1);
  --iwb-accent: var(--dsw-alias-brand-primary, #4c9aff);
  --iwb-error: var(--dsw-alias-state-error-primary, #e2686f);
  --iwb-success: var(--dsw-alias-state-success-primary, #4fb477);
  --iwb-warn: var(--dsw-alias-state-warn-primary, #d7a24a);
  /* ── smart-code surfaces (THEME-01 / THEME-02 / THEME-03) ─────────────────
     The completion popup, the hover card, the signature help and the
     reference panel used to carry a fixed dark palette, so they kept a
     black code block and white text in a light host theme. Every colour of
     those widgets now comes from a token, and the token comes from the host
     design system - so the widgets follow the theme instead of fighting it.
     A code block is a *layer* of the host, not a dark hole: in a light theme
     it is a light surface with dark text, in a dark theme a dark surface
     with light text. */
  --iwb-code-bg: var(--dsw-alias-bg-layer-2, #232830);
  --iwb-code-fg: var(--dsw-alias-label-primary, #ccd2da);
  --iwb-code-border: var(--dsw-alias-border-l1, #333a45);
  --iwb-code-muted: var(--dsw-alias-label-secondary, #8a93a1);
  /* The text on a solid brand surface. The host knows how bright its brand
     colour is; the fallback is dark on purpose - a light brand colour with
     white text is unreadable. */
  --iwb-on-accent: var(--dsw-alias-label-on-brand, #0d1117);
  --iwb-shadow: var(--dsw-alias-shadow-1, rgba(0, 0, 0, .32));
  /* ── the syntax palette (THEME-03) ──────────────────────────────────────
     The host has no syntax aliases, and no single colour can serve both of
     its themes: a colour that clears 4.5:1 on white needs a relative
     luminance of 0.183 or less, while the dark code layer #232830 needs
     0.269 or more. A fixed palette therefore cannot follow the host - it
     can only be right in one of the two themes, and it is the wrong one in
     the other (that is what the last round of this palette did).
     So the palette is theme-relative: every token is its own hue mixed with
     the theme's text colour, in oklab. The mix only scales the chroma of
     the hue, so a string still reads as green and a keyword as violet,
     while the lightness comes from the host - and that is what makes one
     token readable on a light theme and on a dark one. Nothing switches on
     prefers-color-scheme, and nothing waits for the host.
     52% hue / 48% theme text is the largest share of the hue that keeps
     every token at 5:1 or better on white, on the editor background and on
     the code layer; tests/styles-theme.test.mjs does the oklab maths and
     checks all three surfaces. */
  --iwb-syn-comment: color-mix(in oklab, #6b7482 52%, var(--iwb-fg) 48%);
  --iwb-syn-string: color-mix(in oklab, #2a8359 52%, var(--iwb-fg) 48%);
  --iwb-syn-keyword: color-mix(in oklab, #9455b5 52%, var(--iwb-fg) 48%);
  --iwb-syn-type: color-mix(in oklab, #12838d 52%, var(--iwb-fg) 48%);
  --iwb-syn-number: color-mix(in oklab, #a1651c 52%, var(--iwb-fg) 48%);
  --iwb-syn-function: color-mix(in oklab, #2a6cbd 52%, var(--iwb-fg) 48%);
  --iwb-syn-property: color-mix(in oklab, #4a63b8 52%, var(--iwb-fg) 48%);
  --iwb-syn-tag: color-mix(in oklab, #bb404f 52%, var(--iwb-fg) 48%);
  --iwb-syn-heading: color-mix(in oklab, #1e70e2 52%, var(--iwb-fg) 48%);
  --iwb-syn-invalid: color-mix(in oklab, #bb352c 52%, var(--iwb-fg) 48%);
  --iwb-sidebar: var(--dsw-specific-sidebar-fill, #181b21);
  --iwb-mod: #4c9aff;
  --iwb-add: #4fb477;
  --iwb-del: #e2686f;
  --iwb-conflict: #e2686f;
  /* JetBrains default VCS highlights (IntelliJ Light / Darcula semantics). */
  --iwb-git-untracked: #e2686f;
  --iwb-git-added: #4fb477;
  --iwb-git-modified: #4c9aff;
  --iwb-git-deleted: #e2686f;
  --iwb-git-conflict: #f14c4c;
  --iwb-git-ignored: #b08b4f;
  --iwb-excluded-bg: rgba(176, 139, 79, .16);
  --iwb-font: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif;
  --iwb-mono: "JetBrains Mono", "Cascadia Code", "SF Mono", Consolas, "Courier New", monospace;
}

.iwb-textbtn {
  height: 26px; padding: 0 10px; border-radius: 6px; display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--iwb-border); color: var(--iwb-fg); background: var(--iwb-panel-2);
}

.iwb-textbtn:hover { border-color: var(--iwb-border-strong); }

/* The primary button sits on the brand colour, so its text is the host's
   "on brand" label - a pale brand colour would make white text unreadable. */
.iwb-textbtn.iwb-primary { background: var(--iwb-accent); border-color: transparent; color: var(--iwb-on-accent); }

.iwb-textbtn.iwb-primary:hover { filter: brightness(1.08); }

.iwb-textbtn:disabled { opacity: .45; cursor: default; }

.iwb-textbtn.iwb-danger { color: var(--iwb-error); }

/* The solid danger button sits on the error colour, not on the brand colour,
   so it keeps its own white text. */
.iwb-textbtn.iwb-danger-solid { background: var(--iwb-error); color: #fff; border-color: transparent; }

.iwb-textbtn.iwb-small { height: 22px; padding: 0 8px; font-size: 11.5px; }

.iwb-status-item { display: inline-flex; align-items: center; gap: 4px; }

/* ── semantic analysis status (PRD-v5 §4.3) ───────────────────────────── */
.iwb-lsp-status { display: inline-flex; align-items: center; gap: 5px; color: var(--iwb-muted); }

.iwb-lsp-status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

.iwb-lsp-status-ready { color: var(--iwb-success); }

.iwb-lsp-status-warn { color: var(--iwb-warn); }

.iwb-lsp-status-error { color: var(--iwb-error); }

.iwb-lsp-status-muted { color: var(--iwb-muted); }

.iwb-lsp-status-label { white-space: nowrap; }

.iwb-lsp-cancel {
  border: 1px solid var(--iwb-border-strong); border-radius: 999px; padding: 0 7px;
  background: transparent; color: var(--iwb-warn); font-size: 10px; line-height: 15px; cursor: pointer;
}

.iwb-lsp-cancel:hover { background: rgba(215, 162, 74, .14); }

/* The host's file glyph is an inline SVG in a flex row: keep it from being
   squeezed when a long name squeezes the row. */
.iwb-file-icon { flex: 0 0 auto; }

.iwb-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 26px 20px; color: var(--iwb-muted); text-align: center; font-size: 12px; }

.iwb-empty-title { color: var(--iwb-fg); font-size: 13px; font-weight: 600; }

.iwb-link-shell .iwb-textbtn { font: inherit; cursor: pointer; }

.iwb-link-actions .iwb-textbtn { height: auto; min-height: 28px; padding: 5px 14px; white-space: normal; text-align: center; }

/*
 * Settings also render outside the .iwb-root pane (the native settings.section
 * page), so the block above carries the design tokens and this section
 * re-declares only what it needs. Hierarchy: group title -> row title -> row
 * hint -> control.
 */
.iwb-settings-section { width: 100%; }

.iwb-settings {
  container-type: inline-size;
  container-name: iwb-settings;
  width: 100%;
  max-width: 720px;
  padding: 8px 0;
  color: var(--iwb-fg);
  font-family: var(--iwb-font);
  font-size: 14px;
  line-height: 1.45;
}

.iwb-settings *, .iwb-settings *::before, .iwb-settings *::after { box-sizing: border-box; }

.iwb-settings :where(button, input, select) { font: inherit; color: inherit; }

.iwb-settings :where(button) { background: none; border: 0; padding: 0; cursor: pointer; }

.iwb-settings-group { margin: 0; }

.iwb-settings-group + .iwb-settings-group {
  margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--iwb-divider);
}

.iwb-settings-group-title {
  margin: 0; color: var(--iwb-fg); font-size: 15px; font-weight: 600; line-height: 24px;
  letter-spacing: 0; text-transform: none;
}

.iwb-settings-group-desc { margin: 2px 0 0; max-width: 560px; color: var(--iwb-muted); font-size: 12px; line-height: 18px; }

.iwb-settings-rows { display: flex; flex-direction: column; margin-top: 4px; }

.iwb-settings-row {
  display: flex; align-items: center; gap: 24px; min-height: 48px; padding: 12px 0;
  border-bottom: .5px solid var(--iwb-divider);
}

.iwb-settings-rows > .iwb-settings-row:last-child { border-bottom: 0; }

.iwb-settings-label { flex: 1 1 auto; min-width: 0; }

.iwb-settings-title { color: var(--iwb-fg); font-size: 14px; line-height: 22px; }

.iwb-settings-hint { margin-top: 2px; color: var(--iwb-muted); font-size: 12px; line-height: 18px; }

.iwb-settings-control {
  flex: 0 0 auto; margin-left: auto; display: flex; align-items: center; justify-content: flex-end; gap: 8px;
}

.iwb-settings-control input[type="text"], .iwb-settings-control input[type="number"],
.iwb-settings-control select,
.iwb-settings-field-control input[type="text"], .iwb-settings-field-control input[type="number"],
.iwb-settings-field-control select,
.iwb-settings-language input[type="number"] {
  height: 32px; min-width: 0; padding: 0 10px; color: var(--iwb-fg);
  border: 1px solid var(--iwb-border-strong); border-radius: 6px; background: var(--iwb-bg);
  font-size: 13px; outline: none; transition: border-color .12s ease, box-shadow .12s ease;
}

.iwb-settings-control input[type="text"], .iwb-settings-field-control input[type="text"] { width: 300px; }

.iwb-settings-control select, .iwb-settings-field-control select { width: 220px; padding-right: 26px; }

.iwb-settings-control input[type="number"], .iwb-settings-field-control input[type="number"] {
  width: 96px; padding-right: 8px; text-align: right; font-variant-numeric: tabular-nums;
}

.iwb-settings-control :is(input[type="text"], input[type="number"], select):hover,
.iwb-settings-field-control :is(input[type="text"], input[type="number"], select):hover,
.iwb-settings-language input[type="number"]:hover { border-color: var(--iwb-muted); }

.iwb-settings-control :is(input[type="text"], input[type="number"], select):focus,
.iwb-settings-field-control :is(input[type="text"], input[type="number"], select):focus,
.iwb-settings-language input[type="number"]:focus {
  border-color: var(--iwb-accent); box-shadow: 0 0 0 1px var(--iwb-accent);
}

.iwb-settings-control input[type="checkbox"] {
  width: 16px; height: 16px; margin: 0; accent-color: var(--iwb-accent); cursor: pointer;
}

.iwb-settings-value { color: var(--iwb-muted); font-size: 13px; }

/* A block of related fields: the numbers keep their own label above them
   and the block takes a third of the height of one row per number. */
.iwb-settings-subgroup { padding: 10px 0 4px; }

.iwb-settings-subgroup-title {
  margin-bottom: 8px; color: var(--iwb-muted); font-size: 11px; font-weight: 600;
  letter-spacing: .04em; text-transform: uppercase;
}

.iwb-settings-fields {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px 20px;
}

.iwb-settings-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }

.iwb-settings-field-label { color: var(--iwb-fg); font-size: 12.5px; line-height: 18px; }

.iwb-settings-field-hint { color: var(--iwb-muted); font-size: 11px; line-height: 16px; }

.iwb-settings-field-control { display: flex; }

/* The language servers: one compact line per language. */
.iwb-settings-languages { display: flex; flex-wrap: wrap; gap: 6px 18px; }

.iwb-settings-language {
  display: inline-flex; align-items: center; gap: 6px; min-width: 0;
  font-size: 12.5px; color: var(--iwb-fg);
}

/* The switch and the name of the language: one label, so clicking the name
   switches the language off. The ceiling input stands outside of it - a
   label hands its click to the first control it holds. */
.iwb-settings-language-toggle { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }

.iwb-settings-language input[type="checkbox"] {
  width: 16px; height: 16px; margin: 0; accent-color: var(--iwb-accent); cursor: pointer;
}

.iwb-settings-language-name { white-space: nowrap; }

.iwb-settings-language-command {
  color: var(--iwb-muted); font-size: 11px; font-family: var(--iwb-mono);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* The ceiling of one language: narrow, because the row is a compact line and
   not a settings row. */
.iwb-settings-language input[type="number"] {
  width: 76px; padding-right: 8px; text-align: right; font-variant-numeric: tabular-nums;
}

.iwb-settings-language-unit { color: var(--iwb-muted); font-size: 11px; }

.iwb-settings-shortcut {
  display: inline-flex; align-items: center; justify-content: center; min-width: 150px; height: 32px; padding: 0 12px;
  border: 1px solid var(--iwb-border-strong); border-radius: 7px; background: var(--iwb-panel-2);
  color: var(--iwb-fg); font-family: var(--iwb-mono); font-size: 12px; letter-spacing: .02em;
  cursor: pointer; transition: border-color .12s ease, background .12s ease, color .12s ease;
}

.iwb-settings-shortcut:hover { border-color: var(--iwb-muted); background: var(--iwb-bg); }

.iwb-settings-shortcut:focus-visible { outline: 2px solid var(--iwb-accent); outline-offset: 1px; }

.iwb-settings-shortcut.iwb-capturing {
  border-color: var(--iwb-accent); color: var(--iwb-accent); background: var(--iwb-bg);
}

.iwb-settings .iwb-textbtn {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: 6px;
  border: 1px solid var(--iwb-border-strong); color: var(--iwb-fg); background: transparent; font-size: 12.5px;
}

.iwb-settings .iwb-textbtn:hover { border-color: var(--iwb-muted); background: var(--iwb-panel-2); }

.iwb-settings-footer {
  display: flex; align-items: center; gap: 12px; margin-top: 22px; padding: 10px 0 6px;
  border-top: 1px solid var(--iwb-divider);
  /* Keep the save feedback visible while a long settings page scrolls. */
  position: sticky; bottom: 0; z-index: 2; background: var(--iwb-bg);
}

.iwb-settings-saved { margin-left: auto; color: var(--iwb-success); font-size: 12px; }

@container iwb-settings (max-width: 520px) {
  .iwb-settings-row { flex-wrap: wrap; gap: 8px 16px; padding: 12px 0; }
  .iwb-settings-control { width: 100%; justify-content: flex-start; }
  .iwb-settings-control input[type="text"] { width: 100%; }
  .iwb-settings-control select { width: 100%; }
  .iwb-settings-shortcut { min-width: 132px; }
}

.iwb-modal-backdrop {
  position: absolute; inset: 0; background: rgba(0, 0, 0, .45); display: flex; align-items: center; justify-content: center; z-index: 50;
}

/* A blocking confirmation has to be above the dialog it answers: the
   "unsaved changes" warning is raised while the project picker is still
   open, and both backdrops share the same z-index and the same containing
   block - so the later one in the DOM would cover the warning. The deeper
   dim also keeps the two layers from stacking into a black screen. */
.iwb-modal-backdrop.iwb-confirm-backdrop { z-index: 55; background: rgba(0, 0, 0, .6); }

.iwb-modal {
  width: min(440px, calc(100% - 40px)); border-radius: 10px; border: 1px solid var(--iwb-border-strong);
  background: var(--iwb-overlay); box-shadow: 0 24px 60px rgba(0, 0, 0, .45); padding: 16px 18px;
}

.iwb-modal h2 { font-size: 15px; margin: 0 0 8px; }

.iwb-modal p { margin: 0 0 16px; color: var(--iwb-muted); font-size: 12.5px; white-space: pre-wrap; user-select: text; }

/* Long forms (settings) keep their title, close control and save feedback in
   place while the body scrolls; the body owns the scroll, not the modal. */
.iwb-modal.iwb-settings-modal {
  width: min(620px, calc(100% - 40px)); max-height: 82%; padding: 0; overflow: hidden;
  display: flex; flex-direction: column;
}

.iwb-modal-head {
  display: flex; align-items: center; gap: 8px; flex: 0 0 auto;
  padding: 13px 16px 9px 18px; border-bottom: 1px solid var(--iwb-border);
  background: var(--iwb-overlay); position: relative; z-index: 3;
}

.iwb-modal-head h2 { margin: 0; flex: 1; }

.iwb-modal-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 0 18px; }

.iwb-modal-foot { flex: 0 0 auto; padding: 10px 18px 13px; border-top: 1px solid var(--iwb-border); background: var(--iwb-overlay); }

.iwb-modal-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }

/* The buttons of a dialog have to read as buttons. The plain border of a
   text button is one hairline on the dialog surface - invisible in practice
   - so a dialog gets a stronger border, a little more room and a background
   that is one layer away from the surface it sits on. */
.iwb-modal-actions .iwb-textbtn {
  height: 30px; padding: 0 14px; font-size: 12.5px;
  border-color: var(--iwb-border-strong); background: var(--iwb-panel-2);
}

.iwb-modal-actions .iwb-textbtn:hover {
  border-color: var(--iwb-muted); background: var(--iwb-panel);
}

/* The primary and the solid danger button carry their own colour and must
   keep it - the rule above would otherwise repaint them like a plain one. */
.iwb-modal-actions .iwb-textbtn.iwb-primary {
  background: var(--iwb-accent); border-color: transparent; color: var(--iwb-on-accent);
}

.iwb-modal-actions .iwb-textbtn.iwb-primary:hover {
  background: var(--iwb-accent); border-color: transparent; filter: brightness(1.08);
}

.iwb-modal-actions .iwb-textbtn.iwb-danger-solid {
  background: var(--iwb-error); border-color: transparent; color: #fff;
}

.iwb-toast {
  position: absolute; right: 14px; bottom: 34px; max-width: 420px; padding: 9px 12px; border-radius: 8px;
  border: 1px solid var(--iwb-border-strong); background: var(--iwb-overlay); box-shadow: 0 10px 30px rgba(0,0,0,.4);
  font-size: 12px; z-index: 60; display: flex; gap: 8px; align-items: flex-start;
}

.iwb-toast.iwb-error { border-color: rgba(226, 104, 111, .55); }

.iwb-toast.iwb-success { border-color: rgba(79, 180, 119, .55); }

.iwb-toast-text { min-width: 0; }

.iwb-toast-detail { color: var(--iwb-muted); font-size: 11px; margin-top: 3px; white-space: pre-wrap; word-break: break-word; user-select: text; }

.iwb-toast-action { margin-top: 8px; align-self: flex-start; }

.iwb-modal-hint { color: var(--iwb-muted); font-size: 12px; margin: -2px 0 12px; }

.iwb-editor-scoped-backdrop .iwb-modal { width: min(440px, 100%); }

/* The title stays on one line; the body explains the conflict and may wrap -
   it is clamped to three lines and carries the full text in its title. */
.iwb-editor-scoped-backdrop .iwb-modal h2 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.iwb-editor-scoped-backdrop .iwb-modal p {
  white-space: normal; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}

.iwb-editor-scoped-backdrop .iwb-modal-actions { flex-wrap: wrap; }

.iwb-search-warn { color: var(--iwb-warn); }

.iwb-search-hit {
  display: flex; align-items: center; gap: 10px; width: 100%; height: 23px; padding: 0 12px 0 20px;
  text-align: left; font-family: var(--iwb-mono); font-size: 11.5px; color: var(--iwb-fg);
}

.iwb-search-hit:hover { background: rgba(76,154,255,.12); }

.iwb-search-error { padding: 12px; color: var(--iwb-error); font-size: 12px; white-space: pre-wrap; }

.iwb-quick-backdrop { position: absolute; inset: 0; z-index: 70; background: rgba(0,0,0,.38); display: flex; align-items: flex-start; justify-content: center; padding-top: 9vh; }

.iwb-quick {
  width: min(680px, calc(100% - 32px)); max-height: 72%; display: flex; flex-direction: column;
  border-radius: 10px; border: 1px solid var(--iwb-border-strong); background: var(--iwb-overlay);
  box-shadow: 0 24px 70px rgba(0,0,0,.5); overflow: hidden;
}

.iwb-quick-head { display: flex; align-items: center; gap: 8px; padding: 9px 10px; border-bottom: 1px solid var(--iwb-border); }

.iwb-quick-title { color: var(--iwb-muted); font-size: 11px; white-space: nowrap; }

.iwb-quick-input { flex: 1; min-width: 80px; height: 30px; padding: 0 7px; border: 0; background: transparent; color: var(--iwb-fg); outline: none; font-size: 14px; user-select: text; }

.iwb-quick-list { overflow: auto; padding: 4px; min-height: 40px; }

.iwb-quick-row { display: flex; align-items: center; gap: 10px; width: 100%; height: 27px; padding: 0 9px; border-radius: 5px; text-align: left; }

.iwb-quick-row.iwb-selected { background: rgba(76,154,255,.2); }

.iwb-quick-name { font-size: 12.5px; white-space: nowrap; }

.iwb-quick-dir { color: var(--iwb-muted); font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.iwb-quick-empty { padding: 18px; text-align: center; color: var(--iwb-muted); font-size: 12px; }

.iwb-quick-foot { padding: 6px 10px; border-top: 1px solid var(--iwb-border); color: var(--iwb-muted); font-size: 10.5px; }

/* ── Find in Files popup (FIND-01 / FIND-02) ───────────────────────────── */
/* The popup reuses the Quick Open skeleton: the same backdrop (z-index 70,
   above every modal), the same panel, the same head and foot. Only the body
   differs - the hits on top (40%), the context of the selected hit below
   (60%), so a click never takes the code away from the user. */
.iwb-search-popup-backdrop { padding-top: 4vh; }

.iwb-search-popup {
  width: min(900px, 92vw); height: min(640px, 80vh); max-height: none;
  display: flex; flex-direction: column;
}

.iwb-search-popup-meta {
  display: flex; align-items: center; gap: 8px; padding: 5px 10px;
  border-bottom: 1px solid var(--iwb-border); color: var(--iwb-muted); font-size: 10.5px;
}

.iwb-search-popup-list { flex: 0 0 40%; min-height: 0; overflow: auto; padding: 4px; }

/* The upper half is a plain list of the files that matched - one row per
   file, with its match count. The matches themselves are the preview below:
   repeating them under the file row made the list a wall of text and left
   the preview empty. */
.iwb-search-popup-file {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 4px 9px;
  border-radius: 5px; text-align: left; font-size: 12px; color: var(--iwb-fg);
}

.iwb-search-popup-file:hover { background: rgba(127, 127, 127, .1); }

.iwb-search-popup-file.iwb-selected { background: color-mix(in srgb, var(--iwb-accent) 20%, transparent); }

.iwb-search-popup-file-name { flex: 0 0 auto; white-space: nowrap; }

.iwb-search-popup-file-dir { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--iwb-muted); font-size: 10.5px; }

.iwb-search-popup-file-count {
  flex: 0 0 auto; margin-left: auto; color: var(--iwb-muted); font-size: 10.5px;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}

.iwb-search-popup-preview { flex: 1 1 60%; min-height: 0; overflow: auto; border-top: 1px solid var(--iwb-border); }

.iwb-search-popup-blocks { padding: 6px 0 12px; }

/* One hit of the selected file with the lines around it. */
.iwb-search-popup-block { padding-bottom: 8px; }

.iwb-search-popup-block-head {
  display: flex; align-items: baseline; gap: 10px; padding: 2px 10px;
  color: var(--iwb-muted); font-size: 10.5px;
}

.iwb-search-popup-block-pos { flex: 0 0 auto; font-family: var(--iwb-mono); }

.iwb-search-popup-block-preview {
  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.iwb-search-popup-code { padding: 2px 0; font-family: var(--iwb-mono); font-size: 11.5px; line-height: 1.6; }

.iwb-search-popup-line { display: flex; gap: 10px; padding: 0 10px; color: var(--iwb-muted); opacity: .75; }

.iwb-search-popup-line.iwb-hit { background: color-mix(in srgb, var(--iwb-accent) 16%, transparent); color: var(--iwb-fg); opacity: 1; }

.iwb-search-popup-number {
  flex: 0 0 44px; width: 44px; text-align: right; color: var(--iwb-muted);
  font-variant-numeric: tabular-nums; user-select: none;
}

.iwb-search-popup-text { flex: 1 1 auto; min-width: 0; white-space: pre; }

/* ── completion popup (COMP-01 / COMP-02) ──────────────────────────────── */
.iwb-codemirror .cm-tooltip.cm-tooltip-autocomplete {
  background: var(--iwb-overlay) !important;
  border: 1px solid var(--iwb-border-strong) !important;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 8px 24px var(--iwb-shadow);
}

.iwb-codemirror .cm-tooltip-autocomplete > ul {
  font-family: var(--iwb-mono);
  font-size: 12px;
  max-height: 240px;
  min-width: 220px;
  background: transparent;
}

.iwb-codemirror .cm-tooltip-autocomplete > ul > li {
  padding: 3px 9px;
  line-height: 1.5;
  color: var(--iwb-fg) !important;
  border-radius: 4px;
  margin: 1px 3px;
}

/* The selected row is a solid accent bar: the text colour is the host's "on
   brand" label, so it stays readable on a light brand colour instead of
   forcing white text onto it. */
.iwb-codemirror .cm-tooltip-autocomplete > ul > li[aria-selected] {
  background: var(--iwb-accent) !important;
  color: var(--iwb-on-accent) !important;
}

.iwb-codemirror .cm-tooltip-autocomplete > ul > li[aria-selected] * { color: var(--iwb-on-accent) !important; }

.iwb-codemirror .cm-tooltip-autocomplete-disabled > ul > li[aria-selected] {
  background: var(--iwb-muted) !important;
  color: var(--iwb-bg) !important;
}

.iwb-codemirror .cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail { color: color-mix(in srgb, var(--iwb-on-accent) 82%, transparent) !important; }

.iwb-codemirror .cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionMatchedText { text-decoration: underline; }

/* ── hover card and signature help (NAV-04) ────────────────────────────── */
/* The library wraps these in .cm-lsp-hover-tooltip and
   .cm-lsp-signature-tooltip; the -documentation class is only the inner
   block. Styling .cm-lsp-hover - as the first version did - matched nothing
   at all, which is why the card kept the library's colours. */
.iwb-codemirror .cm-tooltip.cm-lsp-hover-tooltip,
.iwb-codemirror .cm-tooltip.cm-lsp-signature-tooltip {
  background: var(--iwb-overlay) !important;
  color: var(--iwb-fg) !important;
  border: 1px solid var(--iwb-border-strong) !important;
  border-radius: 6px;
  padding: 7px 10px;
  max-width: 34em;
  font-size: 12px;
  line-height: 1.55;
  box-shadow: 0 8px 24px var(--iwb-shadow);
}

/* JSDoc and signatures are rendered as highlighted code. The block is a
   layer of the host theme - a light surface with dark text in a light theme,
   a dark surface with light text in a dark one - so the card never carries
   a foreign black rectangle. */
.iwb-codemirror .cm-lsp-documentation pre,
.iwb-codemirror .cm-lsp-documentation code,
.iwb-codemirror .cm-lsp-signature {
  font-family: var(--iwb-mono);
  background: var(--iwb-code-bg) !important;
  color: var(--iwb-code-fg) !important;
  border-radius: 4px;
}

.iwb-codemirror .cm-lsp-signature { padding: 4px 7px; }

.iwb-codemirror .cm-lsp-signature-num { color: var(--iwb-code-muted) !important; }

/* ── the Ctrl+hover jump hint (NAV-01) ───────────────────────────────── */
/* JetBrains promises the target before the click: holding the modifier turns
   the identifier under the pointer blue and underlines it. The rule has to
   beat the syntax-highlight colours of the token inside the mark, so the
   colour is forced on the mark and on its children. */
.iwb-codemirror .iwb-ctrl-hover-symbol,
.iwb-codemirror .iwb-ctrl-hover-symbol * {
  color: var(--iwb-accent) !important;
  text-decoration: underline !important;
  text-decoration-color: var(--iwb-accent) !important;
  text-underline-offset: 2px;
  text-decoration-thickness: 1px;
  cursor: pointer;
}

/* ── text-match marker for the conservative Find Usages (NAV-03) ───────── */
.iwb-search-textmatch-note {
  display: inline-flex; align-items: center; gap: 5px; margin-bottom: 6px;
  padding: 2px 8px; border-radius: 999px; font-size: 10.5px;
  color: var(--iwb-warn); border: 1px solid currentColor; background: rgba(215, 162, 74, .08);
}

.iwb-search-textmatch {
  font-size: 9.5px; line-height: 15px; color: var(--iwb-warn);
  border: 1px solid currentColor; border-radius: 999px; padding: 0 5px; flex: 0 0 auto;
}

/* ── semantic diagnostics panel (MEM-03) ───────────────────────────────── */
/* The panel answers "what is the language server doing": the state, the
   failure counter, the memory estimate and the tail of its stderr. The body
   scrolls, so a long log never pushes the actions out of the dialog. */
.iwb-lsp-diagnostics {
  width: min(520px, calc(100% - 40px)); max-height: 82%;
  display: flex; flex-direction: column;
}

.iwb-lsp-diagnostics-body { flex: 1 1 auto; min-height: 0; overflow: auto; }

.iwb-lsp-diagnostics-row { display: flex; gap: 10px; padding: 5px 0; border-bottom: 1px solid var(--iwb-border); }

.iwb-lsp-diagnostics-key { flex: 0 0 130px; color: var(--iwb-muted); font-size: 11.5px; }

.iwb-lsp-diagnostics-value { flex: 1 1 auto; min-width: 0; word-break: break-word; font-size: 12px; }

.iwb-lsp-diagnostics-logs {
  font-family: var(--iwb-mono); font-size: 10.5px; color: var(--iwb-muted);
  max-height: 160px; overflow: auto; white-space: pre-wrap; user-select: text;
  background: var(--iwb-panel); border: 1px solid var(--iwb-border); border-radius: 6px; padding: 6px 8px;
}
`
