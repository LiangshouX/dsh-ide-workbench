/**
 * One stylesheet for the whole workbench, inserted through the package-owned
 * `styles` builtin (removed with the Client run). Every surface uses the
 * `--dsw-alias-*` tokens with a neutral fallback, so the panel follows the
 * harness light/dark theme and transparent skins.
 */
import { LEFT_PANE_RATIO, STACK_WIDTH } from './layout.js'

export const CSS = `
.iwb-root, .iwb-settings, .iwb-link-shell {
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
     The SHARE of the hue is what differs per theme, and it has to: in a light
     theme the text is near-black, so a LARGE share of the hue keeps the token
     a colour (with the dark theme's 52% the violet washed out to near-black
     and the code looked unhighlighted); in a dark theme the text is
     near-white, so a SMALL share lifts the hue just far enough to clear the
     dark code layer. The branch follows the host through light-dark(),
     which resolves on the color-scheme the host declares for its theme
     (the DSH host writes :root { color-scheme: light|dark } for every
     theme - app or system). Nothing switches on prefers-color-scheme, and
     nothing waits for the host. tests/styles-theme.test.mjs does the oklab
     maths and checks every token, in both branches, on all three surfaces
     (white, the editor background and the code layer). */
  --iwb-syn-comment-light: color-mix(in oklab, #6b7482 80%, var(--iwb-fg) 20%);
  --iwb-syn-comment-dark: color-mix(in oklab, #6b7482 52%, var(--iwb-fg) 48%);
  --iwb-syn-comment: light-dark(var(--iwb-syn-comment-light), var(--iwb-syn-comment-dark));
  --iwb-syn-string-light: color-mix(in oklab, #2a8359 80%, var(--iwb-fg) 20%);
  --iwb-syn-string-dark: color-mix(in oklab, #2a8359 52%, var(--iwb-fg) 48%);
  --iwb-syn-string: light-dark(var(--iwb-syn-string-light), var(--iwb-syn-string-dark));
  --iwb-syn-keyword-light: color-mix(in oklab, #9455b5 80%, var(--iwb-fg) 20%);
  --iwb-syn-keyword-dark: color-mix(in oklab, #9455b5 52%, var(--iwb-fg) 48%);
  --iwb-syn-keyword: light-dark(var(--iwb-syn-keyword-light), var(--iwb-syn-keyword-dark));
  --iwb-syn-type-light: color-mix(in oklab, #12838d 80%, var(--iwb-fg) 20%);
  --iwb-syn-type-dark: color-mix(in oklab, #12838d 52%, var(--iwb-fg) 48%);
  --iwb-syn-type: light-dark(var(--iwb-syn-type-light), var(--iwb-syn-type-dark));
  --iwb-syn-number-light: color-mix(in oklab, #a1651c 80%, var(--iwb-fg) 20%);
  --iwb-syn-number-dark: color-mix(in oklab, #a1651c 52%, var(--iwb-fg) 48%);
  --iwb-syn-number: light-dark(var(--iwb-syn-number-light), var(--iwb-syn-number-dark));
  --iwb-syn-function-light: color-mix(in oklab, #2a6cbd 80%, var(--iwb-fg) 20%);
  --iwb-syn-function-dark: color-mix(in oklab, #2a6cbd 52%, var(--iwb-fg) 48%);
  --iwb-syn-function: light-dark(var(--iwb-syn-function-light), var(--iwb-syn-function-dark));
  --iwb-syn-property-light: color-mix(in oklab, #4a63b8 80%, var(--iwb-fg) 20%);
  --iwb-syn-property-dark: color-mix(in oklab, #4a63b8 52%, var(--iwb-fg) 48%);
  --iwb-syn-property: light-dark(var(--iwb-syn-property-light), var(--iwb-syn-property-dark));
  --iwb-syn-tag-light: color-mix(in oklab, #bb404f 80%, var(--iwb-fg) 20%);
  --iwb-syn-tag-dark: color-mix(in oklab, #bb404f 52%, var(--iwb-fg) 48%);
  --iwb-syn-tag: light-dark(var(--iwb-syn-tag-light), var(--iwb-syn-tag-dark));
  --iwb-syn-heading-light: color-mix(in oklab, #1e70e2 80%, var(--iwb-fg) 20%);
  --iwb-syn-heading-dark: color-mix(in oklab, #1e70e2 52%, var(--iwb-fg) 48%);
  --iwb-syn-heading: light-dark(var(--iwb-syn-heading-light), var(--iwb-syn-heading-dark));
  --iwb-syn-invalid-light: color-mix(in oklab, #bb352c 80%, var(--iwb-fg) 20%);
  --iwb-syn-invalid-dark: color-mix(in oklab, #bb352c 52%, var(--iwb-fg) 48%);
  --iwb-syn-invalid: light-dark(var(--iwb-syn-invalid-light), var(--iwb-syn-invalid-dark));
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
.iwb-root {
  container-type: inline-size;
  container-name: ide-workbench;
  position: relative;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--iwb-bg);
  color: var(--iwb-fg);
  font-family: var(--iwb-font);
  font-size: 13px;
  line-height: 1.45;
  user-select: none;
  -webkit-app-region: no-drag;
}
.iwb-root *, .iwb-root *::before, .iwb-root *::after { box-sizing: border-box; }
.iwb-root button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
.iwb-root input, .iwb-root textarea, .iwb-root select { font: inherit; color: inherit; }
.iwb-root ::-webkit-scrollbar { width: 10px; height: 10px; }
.iwb-root ::-webkit-scrollbar-thumb { background: var(--iwb-border-strong); border-radius: 6px; border: 2px solid transparent; background-clip: content-box; }
.iwb-root ::-webkit-scrollbar-thumb:hover { background: var(--iwb-muted); border: 2px solid transparent; background-clip: content-box; }
.iwb-root ::-webkit-scrollbar-track { background: transparent; }
.iwb-root ::-webkit-scrollbar-corner { background: transparent; }

.iwb-topbar {
  height: 36px; flex: 0 0 36px; display: flex; align-items: center; gap: 8px;
  padding: 0 10px; border-bottom: 1px solid var(--iwb-border); background: var(--iwb-panel);
  position: relative; z-index: 6;
}
.iwb-topbar button { position: relative; z-index: 7; }
.iwb-project-select {
  display: flex; align-items: center; gap: 6px; height: 26px; padding: 0 8px;
  border-radius: 6px; max-width: 320px; min-width: 0; cursor: pointer;
}
.iwb-project-select:hover { background: rgba(127, 127, 127, .12); }
.iwb-project-select .iwb-project-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iwb-project-select .iwb-project-path { color: var(--iwb-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iwb-branch-chip {
  display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px;
  border: 1px solid var(--iwb-border); border-radius: 999px; color: var(--iwb-muted); font-size: 11.5px;
  max-width: 240px; overflow: hidden;
}
.iwb-branch-chip .iwb-branch-name { color: var(--iwb-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iwb-ahead { color: var(--iwb-success); font-variant-numeric: tabular-nums; }
.iwb-behind { color: var(--iwb-warn); font-variant-numeric: tabular-nums; }
/* The badge is a button (PUSH-02): it keeps the colour of the badge it
   replaces and only adds the affordance of something clickable. */
.iwb-ahead-btn { background: transparent; border: 0; padding: 0 2px; cursor: pointer; }
.iwb-ahead-btn:hover { text-decoration: underline; }
.iwb-top-spacer { flex: 1; }
.iwb-iconbtn {
  width: 26px; height: 26px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center;
  color: var(--iwb-muted);
}
.iwb-iconbtn:hover { background: rgba(127, 127, 127, .14); color: var(--iwb-fg); }
.iwb-iconbtn:disabled { opacity: .4; cursor: default; }
.iwb-iconbtn.iwb-on { color: var(--iwb-accent); }
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

.iwb-body { flex: 1; min-height: 0; display: flex; }
.iwb-stripe {
  width: 44px; flex: 0 0 44px; background: var(--iwb-sidebar); border-right: 1px solid var(--iwb-border);
  display: flex; flex-direction: column; align-items: center; padding: 6px 0; gap: 4px;
}
.iwb-stripe-spacer { flex: 1; }
.iwb-stripe-btn {
  position: relative; width: 34px; height: 34px; border-radius: 7px; display: flex; align-items: center; justify-content: center;
  color: var(--iwb-muted);
}
.iwb-stripe-btn:hover { background: rgba(127, 127, 127, .12); color: var(--iwb-fg); }
.iwb-stripe-btn.iwb-on { color: var(--iwb-accent); background: rgba(76, 154, 255, .13); }
.iwb-stripe-btn.iwb-on::before {
  content: ''; position: absolute; left: -6px; top: 8px; bottom: 8px; width: 2px; border-radius: 2px; background: var(--iwb-accent);
}
/* The badge counts something on the brand colour: its text is the host's
   "on brand" label, so a pale brand colour keeps the number readable. */
.iwb-badge {
  position: absolute; top: 2px; right: 1px; min-width: 15px; height: 15px; padding: 0 4px;
  border-radius: 999px; background: var(--iwb-accent); color: var(--iwb-on-accent); font-size: 10px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center; line-height: 1;
}
.iwb-badge.iwb-badge-dirty { background: var(--iwb-success); }

.iwb-left {
  position: relative; flex: 0 0 auto; width: var(--iwb-left-width, 300px);
  min-width: 200px; max-width: 640px; display: flex; flex-direction: column;
  background: var(--iwb-panel); border-right: 1px solid var(--iwb-border);
}
.iwb-left-resizer {
  position: absolute; top: 0; right: -3px; bottom: 0; width: 6px; cursor: col-resize; z-index: 5;
}
.iwb-left-resizer:hover { background: rgba(76, 154, 255, .25); }
.iwb-panel-header {
  height: 32px; flex: 0 0 32px; display: flex; align-items: center; gap: 6px; padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--iwb-border); background: var(--iwb-panel);
}
.iwb-panel-title { font-size: 12px; font-weight: 700; letter-spacing: .02em; }
.iwb-panel-sub { color: var(--iwb-muted); font-size: 11px; }
.iwb-project-sub-btn {
  display: flex; align-items: center; gap: 4px; min-width: 0; max-width: 64%; padding: 2px 5px;
  border-radius: 5px; color: var(--iwb-muted); font-size: 11px; text-align: left;
}
.iwb-project-sub-btn:hover { background: rgba(127, 127, 127, .12); color: var(--iwb-fg); }
.iwb-project-workspace-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 110px; }
.iwb-project-sep { opacity: .55; }
.iwb-project-sub-name { color: var(--iwb-fg); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iwb-project-current { color: var(--iwb-accent); font-weight: 500; }
.iwb-panel-header .iwb-spacer { flex: 1; }
.iwb-panel-body { flex: 1; min-height: 0; overflow: auto; position: relative; }

.iwb-center { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--iwb-bg); }

/* ── the side of the four tool-window entries (v6 layout) ─────────────────
   The left side is the original layout: every base rule above stays
   unprefixed and is the pixel-identical fallback for iwb-side-left. The
   right side is a mirror built on the order property, so the DOM order (stripe, dock,
   editor) and every ref/key stay as they were - only the paint order and
   the edges change. The stack query at the end of this file resets these
   rules: stacked, the stripe is a top bar again, exactly as before. */
.iwb-side-right .iwb-body > .iwb-center { order: 1; }
.iwb-side-right .iwb-body > .iwb-left { order: 2; }
.iwb-side-right .iwb-body > .iwb-stripe { order: 3; }
/* The divider belongs to the editor-facing edge of each panel now. */
.iwb-side-right .iwb-left { border-right: 0; border-left: 1px solid var(--iwb-border); }
.iwb-side-right .iwb-stripe { border-right: 0; border-left: 1px solid var(--iwb-border); }
/* The active marker of the stripe points into the editor column. */
.iwb-side-right .iwb-stripe-btn.iwb-on::before { left: auto; right: -6px; }
/* The drag handle of the dock faces the editor, which is on its left. */
.iwb-side-right .iwb-left-resizer { right: auto; left: -3px; }
.iwb-tabbar {
  height: 34px; flex: 0 0 34px; display: flex; align-items: stretch; border-bottom: 1px solid var(--iwb-border);
  background: var(--iwb-panel); overflow-x: auto; overflow-y: hidden; scrollbar-width: none;
}
.iwb-tabbar::-webkit-scrollbar { height: 0; }
.iwb-tab {
  display: flex; align-items: center; gap: 6px; padding: 0 8px 0 10px; min-width: 90px; max-width: 220px;
  border-right: 1px solid var(--iwb-border); color: var(--iwb-muted); position: relative; cursor: pointer; flex: 0 0 auto;
}
.iwb-tab:hover { background: rgba(127, 127, 127, .07); }
.iwb-tab.iwb-active { background: var(--iwb-bg); color: var(--iwb-fg); }
.iwb-tab.iwb-active::after { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 2px; background: var(--iwb-accent); }
.iwb-tab .iwb-tab-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.iwb-tab.iwb-preview .iwb-tab-name { font-style: italic; }
.iwb-tab .iwb-tab-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--iwb-muted); flex: 0 0 6px; }
.iwb-tab.iwb-preview .iwb-tab-dot { background: var(--iwb-accent); }
.iwb-tab .iwb-tab-dirty { width: 7px; height: 7px; border-radius: 50%; background: var(--iwb-warn); flex: 0 0 7px; box-shadow: 0 0 0 2px rgba(215, 162, 74, .18); }
.iwb-toolbar-dirty { color: var(--iwb-warn); font-size: 10.5px; margin-left: 6px; }
.iwb-tab .iwb-tab-close {
  width: 18px; height: 18px; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center;
  color: var(--iwb-muted); opacity: 0; margin-left: auto; flex: 0 0 18px;
}
.iwb-tab:hover .iwb-tab-close, .iwb-tab.iwb-active .iwb-tab-close { opacity: 1; }
.iwb-tab .iwb-tab-close:hover { background: rgba(127, 127, 127, .2); color: var(--iwb-fg); }
.iwb-tabbar-actions { display: flex; align-items: center; gap: 2px; padding: 0 6px; margin-left: auto; position: sticky; right: 0; background: var(--iwb-panel); }

.iwb-editor { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; overflow: hidden; }
/* Floating HTML preview actions, top-right of the content area. */
.iwb-html-actions {
  position: absolute; top: 70px; right: 14px; z-index: 12;
  display: flex; gap: 4px; padding: 4px; color: var(--iwb-muted);
  border: 1px solid var(--iwb-border); border-radius: 8px;
  background: var(--iwb-overlay); box-shadow: 0 6px 18px rgba(0, 0, 0, .18);
}
.iwb-html-action {
  width: 28px; height: 28px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center;
}
.iwb-html-action:hover { color: var(--iwb-fg); background: rgba(127, 127, 127, .14); }
.iwb-html-action.iwb-chrome { color: #4285f4; }
.iwb-html-action.iwb-chrome:hover { color: #4285f4; filter: brightness(1.12); }
.iwb-editor-toolbar {
  height: 30px; flex: 0 0 30px; display: flex; align-items: center; gap: 8px; padding: 0 10px;
  border-bottom: 1px solid var(--iwb-border); background: var(--iwb-bg); color: var(--iwb-muted); font-size: 11.5px;
}
/* One line, always: a squeezed segment must clip, never wrap inside the
   30px toolbar. The breadcrumb takes the free width, so its box is exactly
   the width the path may use - that is what the overflow check measures. */
.iwb-breadcrumb {
  position: relative; flex: 1 1 auto; display: flex; align-items: center; gap: 4px;
  min-width: 0; overflow: hidden; white-space: nowrap;
}
/* The controls of the bar never wrap and never shrink: a button that is too
   narrow for its label would otherwise break the label onto a second line
   inside the 30px bar (the "编/辑", "utf-/8" look). When the bar cannot hold
   the labels any more, the measured marker below drops them instead. */
.iwb-editor-toolbar > button,
.iwb-editor-toolbar > .iwb-seg,
.iwb-editor-toolbar > .iwb-encoding,
.iwb-toolbar-actions > button,
.iwb-toolbar-actions > .iwb-seg,
.iwb-toolbar-actions > .iwb-encoding { flex: 0 0 auto; white-space: nowrap; }
/* The right-hand cluster is measured as one block: its natural width plus the
   room a readable breadcrumb needs is what decides the compact mode. */
.iwb-toolbar-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; min-width: 0; }
.iwb-toolbar-label { white-space: nowrap; }
.iwb-encoding {
  font-family: var(--iwb-mono); font-size: 11px; letter-spacing: .02em;
  color: var(--iwb-muted);
}
/* The compact spelling is off until the bar is narrow (see the query below). */
.iwb-encoding-short { display: none; }
/* A narrow document pane shows ICON-ONLY controls: the labels live in the
   tooltip of each button (they are set as the button title), and the encoding
   keeps its first letter (utf-8 -> u, GBK -> G) with the whole value on hover.
   The compact spelling is driven by a MEASURED marker (the data-compact
   attribute), not by a fixed width: the toolbar measures how wide its controls
   really are and how much room a readable breadcrumb needs, so a longer
   translation or a bigger font drops the labels at the right moment. */
.iwb-editor-toolbar[data-compact='true'] .iwb-toolbar-label { display: none; }
.iwb-editor-toolbar[data-compact='true'] .iwb-encoding-full { display: none; }
.iwb-editor-toolbar[data-compact='true'] .iwb-encoding-short { display: inline; }
.iwb-editor-toolbar[data-compact='true'] .iwb-textbtn { gap: 0; padding: 0 6px; }
.iwb-editor-toolbar[data-compact='true'] .iwb-encoding { letter-spacing: 0; }
.iwb-breadcrumb > * { flex-shrink: 0; }
.iwb-breadcrumb .iwb-sep { opacity: .5; }
.iwb-breadcrumb b { color: var(--iwb-fg); font-weight: 600; flex-shrink: 0; }
/* The middle segments give up their space first: the first segment and the
   file name always stay visible. */
.iwb-breadcrumb .iwb-crumb-mid { flex-shrink: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* The full path, measured but never shown: it tells whether the breadcrumb
   really overflows, whatever the collapse state is. */
.iwb-breadcrumb-measure {
  position: absolute; left: 0; top: 0; width: max-content; max-width: none;
  display: inline-flex; align-items: center; gap: 4px;
  visibility: hidden; white-space: nowrap; pointer-events: none;
}
/* The middle segments collapse into one ellipsis when the path really does
   not fit; the toolbar sets data-overflow when that is the case. */
.iwb-breadcrumb .iwb-crumb-more { display: none; color: var(--iwb-muted); }
.iwb-editor-toolbar[data-overflow='true'] .iwb-breadcrumb .iwb-crumb-mid { display: none; }
.iwb-editor-toolbar[data-overflow='true'] .iwb-breadcrumb .iwb-crumb-more { display: inline-flex; }
.iwb-editor-toolbar .iwb-spacer { flex: 0 0 auto; }
.iwb-seg {
  display: inline-flex; border: 1px solid var(--iwb-border); border-radius: 6px; overflow: hidden; background: var(--iwb-panel);
}
.iwb-seg button { height: 22px; padding: 0 8px; font-size: 11.5px; color: var(--iwb-muted); }
.iwb-seg button.iwb-on { background: var(--iwb-active-bg, rgba(76,154,255,.16)); color: var(--iwb-fg); }
.iwb-seg button + button { border-left: 1px solid var(--iwb-border); }

.iwb-code {
  flex: 1; min-height: 0; overflow: auto; font-family: var(--iwb-mono); font-size: 12.5px; line-height: var(--iwb-line, 20px);
  background: var(--iwb-bg);
}
.iwb-code-inner { position: relative; min-width: 100%; }
.iwb-code-line { display: flex; align-items: flex-start; height: var(--iwb-line, 20px); white-space: pre; }
.iwb-code-line:hover { background: rgba(127, 127, 127, .055); }
.iwb-ln {
  flex: 0 0 var(--iwb-gutter, 52px); width: var(--iwb-gutter, 52px); text-align: right; padding-right: 12px;
  color: var(--iwb-muted); opacity: .65; font-variant-numeric: tabular-nums; user-select: none;
}
.iwb-code-text { flex: 1; padding-right: 24px; tab-size: 4; }
/* The read-only preview shares the syntax palette of the editor, so both
   read the same way and the host theme reaches both of them. */
.iwb-tok-comment { color: var(--iwb-syn-comment); font-style: italic; }
.iwb-tok-string { color: var(--iwb-syn-string); }
.iwb-tok-number { color: var(--iwb-syn-number); }
.iwb-tok-keyword { color: var(--iwb-syn-keyword); }
.iwb-tok-type { color: var(--iwb-syn-type); }
.iwb-tok-fn { color: var(--iwb-syn-function); }
.iwb-tok-tag { color: var(--iwb-syn-tag); }
.iwb-tok-attr { color: var(--iwb-syn-property); }
.iwb-editor-empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--iwb-muted); padding: 24px; text-align: center; }

.iwb-codemirror { flex: 1; min-height: 0; min-width: 0; display: flex; }
.iwb-codemirror .cm-content, .iwb-codemirror .cm-line { user-select: text; }
.iwb-codemirror > .cm-editor { flex: 1; min-width: 0; height: 100%; }
.iwb-markdown-wrap { flex: 1; min-height: 0; min-width: 0; position: relative; display: flex; }
.iwb-markdown {
  flex: 1; min-width: 0; overflow: auto; padding: 22px max(24px, calc((100% - 920px) / 2)) 80px;
  font-size: 13.5px; line-height: 1.72; color: var(--iwb-fg); user-select: text;
}
.iwb-markdown img { max-width: 100%; height: auto; }
.iwb-markdown table { border-collapse: collapse; }
.iwb-markdown .iwb-markdown-fallback h1, .iwb-markdown .iwb-markdown-fallback h2, .iwb-markdown .iwb-markdown-fallback h3 { margin: 1.2em 0 .5em; }
.iwb-markdown .iwb-markdown-fallback p { margin: .7em 0; }
.iwb-markdown .iwb-markdown-fallback pre { background: var(--iwb-panel); border: 1px solid var(--iwb-border); border-radius: 7px; padding: 10px 12px; overflow: auto; }
.iwb-markdown .iwb-markdown-fallback code { font-family: var(--iwb-mono); font-size: 11.5px; }
.iwb-outline {
  position: absolute; top: 10px; right: 14px; width: 274px; max-height: min(62%, 520px); z-index: 12;
  display: flex; flex-direction: column; border-radius: 8px; border: 1px solid var(--iwb-border-strong);
  background: var(--iwb-overlay); box-shadow: 0 14px 40px rgba(0, 0, 0, .35); overflow: hidden;
}
.iwb-outline-head { display: flex; align-items: center; gap: 6px; padding: 6px 6px 6px 10px; color: var(--iwb-muted); font-size: 11px; border-bottom: 1px solid var(--iwb-border); }
.iwb-outline-list { overflow: auto; padding: 4px; }
.iwb-outline-item {
  display: block; width: 100%; text-align: left; padding: 4px 8px; border-radius: 5px;
  color: var(--iwb-fg); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.iwb-outline-item:hover { background: rgba(127, 127, 127, .14); }
.iwb-outline-item.iwb-active { background: rgba(76, 154, 255, .16); color: var(--iwb-accent); }
.iwb-outline-empty { padding: 14px; color: var(--iwb-muted); font-size: 11.5px; text-align: center; }

.iwb-welcome { flex: 1; display: flex; align-items: center; justify-content: center; padding: 32px; overflow: auto; }
.iwb-welcome-card { max-width: 560px; width: 100%; }
.iwb-welcome-title { font-size: 26px; font-weight: 700; letter-spacing: -.01em; margin: 0 0 6px; }
.iwb-welcome-sub { color: var(--iwb-muted); margin: 0 0 22px; font-size: 13px; }
.iwb-welcome-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 20px; }
.iwb-welcome-action {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--iwb-border);
  border-radius: 8px; background: var(--iwb-panel); color: var(--iwb-fg); text-align: left;
}
.iwb-welcome-action:hover { border-color: var(--iwb-border-strong); background: var(--iwb-panel-2); }
.iwb-welcome-action .iwb-kbd { margin-left: auto; }
.iwb-welcome-meta { display: flex; gap: 16px; color: var(--iwb-muted); font-size: 12px; border-top: 1px solid var(--iwb-border); padding-top: 14px; }
.iwb-welcome-hint { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 12px; padding: 8px 10px; border: 1px solid var(--iwb-border); border-radius: 7px; color: var(--iwb-muted); font-size: 12px; }
.iwb-commit-hint { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 7px 10px; border-bottom: 1px solid var(--iwb-border); color: var(--iwb-muted); font-size: 11.5px; background: var(--iwb-panel-2); }
.iwb-kbd {
  display: inline-flex; align-items: center; height: 19px; padding: 0 6px; border-radius: 4px;
  border: 1px solid var(--iwb-border-strong); border-bottom-width: 2px; background: var(--iwb-panel-2);
  color: var(--iwb-muted); font-size: 10.5px; font-family: var(--iwb-mono); white-space: nowrap;
}

/* The bottom dock is a direct child of .iwb-root, so it spans the whole
   workbench width. Its content keeps a 44px left gutter so it never slides
   under the tool-window stripe. */
.iwb-bottom {
  position: relative; flex: 0 0 auto; display: flex; flex-direction: column; min-height: 90px;
  border-top: 1px solid var(--iwb-border); background: var(--iwb-panel);
}
.iwb-bottom-resizer {
  position: absolute; top: -3px; left: 0; right: 0; height: 6px; cursor: row-resize; z-index: 5;
}
.iwb-bottom-resizer:hover { background: rgba(76, 154, 255, .22); }
.iwb-bottom-tabs {
  height: 30px; flex: 0 0 30px; display: flex; align-items: stretch; gap: 2px; padding: 0 8px 0 44px;
  border-bottom: 1px solid var(--iwb-border); background: var(--iwb-panel);
}
.iwb-bottom-tab {
  display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; border-radius: 6px 6px 0 0;
  color: var(--iwb-muted); font-size: 12px; border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.iwb-bottom-tab:hover { color: var(--iwb-fg); background: rgba(127, 127, 127, .07); }
.iwb-bottom-tab.iwb-on { color: var(--iwb-fg); border-bottom-color: var(--iwb-accent); }
.iwb-bottom-tab .iwb-badge { position: static; margin-left: 2px; }
/* The repository picker in the Terminal/Git dock header. It is a chip of its
   own rather than more tab label: the tab names the WINDOW, the chip names
   the REPOSITORY that window works on, and running them together as one
   crowded label made the two hard to tell apart. Scoped under the dock tabs
   so the Git panel's own switcher keeps its look. */
.iwb-bottom-tabs .iwb-dock-repo {
  align-self: center; gap: 7px; height: 22px; max-width: 260px; margin-left: 14px;
  padding: 0 11px; border-radius: 11px;
  background: rgba(127, 127, 127, .07); color: var(--iwb-fg);
}
.iwb-bottom-tabs .iwb-dock-repo:hover:not(:disabled) {
  border-color: var(--iwb-border-strong); background: rgba(127, 127, 127, .14);
}
.iwb-bottom-tabs .iwb-dock-repo:disabled { opacity: .5; cursor: default; }
.iwb-bottom-tabs .iwb-dock-repo-dot {
  width: 6px; height: 6px; border-radius: 50%; flex: none; background: var(--iwb-accent);
}
.iwb-bottom-body { flex: 1; min-height: 0; display: flex; padding-left: 44px; }
.iwb-bottom-content { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.iwb-bottom-hidden { min-height: 0 !important; border-top: 0 !important; overflow: hidden; }
.iwb-bottom-hidden .iwb-bottom-body { display: none; }
.iwb-term-hidden { display: none; }
.iwb-bottom-close { margin-left: auto; align-self: center; }

.iwb-statusbar {
  height: 22px; flex: 0 0 22px; display: flex; align-items: center; gap: 12px; padding: 0 10px;
  border-top: 1px solid var(--iwb-border); background: var(--iwb-sidebar); color: var(--iwb-muted); font-size: 11px;
}
.iwb-statusbar .iwb-spacer { flex: 1; }
.iwb-status-item { display: inline-flex; align-items: center; gap: 4px; }
.iwb-status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--iwb-success); }
.iwb-status-dot.iwb-busy { background: var(--iwb-warn); }
/* A narrow pane only has room for the dot: the label folds away. */

.iwb-tree { padding: 4px 0 12px; font-size: 12.5px; }
.iwb-tree-row {
  display: flex; align-items: center; gap: 5px; height: 22px; padding-right: 8px; white-space: nowrap;
  cursor: pointer; position: relative;
}
.iwb-tree-row:hover { background: rgba(127, 127, 127, .1); }
.iwb-tree-row.iwb-selected { background: rgba(76, 154, 255, .18); }
.iwb-tree:focus { outline: none; }
.iwb-tree:focus-visible { outline: 1px solid rgba(76, 154, 255, .35); outline-offset: -1px; }
.iwb-tree-twisty { width: 16px; flex: 0 0 16px; display: inline-flex; align-items: center; justify-content: center; color: var(--iwb-muted); }
/* Only a directory twisty is a control; a file row keeps an empty spacer, so
   the pointer is limited to the rows that can actually be toggled. */
.iwb-tree-twisty.iwb-tree-twisty-click,
.iwb-tree-row:has(> .iwb-tree-name.iwb-dir) > .iwb-tree-twisty { cursor: pointer; border-radius: 3px; }
.iwb-tree-twisty.iwb-tree-twisty-click:hover,
.iwb-tree-row:has(> .iwb-tree-name.iwb-dir) > .iwb-tree-twisty:hover { color: var(--iwb-fg); background: rgba(127, 127, 127, .16); }
/* The host's file glyph is an inline SVG in a flex row: keep it from being
   squeezed when a long name squeezes the row. */
.iwb-file-icon { flex: 0 0 auto; }
.iwb-tree-name { overflow: hidden; text-overflow: ellipsis; }
.iwb-tree-name.iwb-dir { font-weight: 500; }
.iwb-tree-row.iwb-git-untracked .iwb-tree-name { color: var(--iwb-git-untracked); }
.iwb-tree-row.iwb-git-added .iwb-tree-name { color: var(--iwb-git-added); }
.iwb-tree-row.iwb-git-modified .iwb-tree-name { color: var(--iwb-git-modified); }
.iwb-tree-row.iwb-git-conflict .iwb-tree-name { color: var(--iwb-git-conflict); font-weight: 600; }
.iwb-tree-row.iwb-git-conflict .iwb-tree-name::after { content: ' !'; color: var(--iwb-git-conflict); font-weight: 700; }
.iwb-tree-row.iwb-git-deleted .iwb-tree-name { color: var(--iwb-git-deleted); text-decoration: line-through; }
.iwb-tree-row.iwb-git-ignored .iwb-tree-name { color: var(--iwb-git-ignored); }
.iwb-tree-row.iwb-git-ignored { opacity: .65; }
.iwb-tree-row.iwb-excluded { background: var(--iwb-excluded-bg); }
.iwb-tree-row.iwb-excluded .iwb-tree-name { color: var(--iwb-git-ignored); }
.iwb-tree-row.iwb-drop-target { outline: 1px solid var(--iwb-accent); outline-offset: -1px; background: rgba(76, 154, 255, .12); }
.iwb-rename-input {
  flex: 1; min-width: 0; height: 18px; padding: 0 4px; border: 1px solid var(--iwb-accent); border-radius: 3px;
  background: var(--iwb-panel-2); color: var(--iwb-fg); font-size: 12px; outline: none;
}
.iwb-tree-msg { color: var(--iwb-muted); font-style: italic; padding: 2px 8px 2px 30px; font-size: 11.5px; }
.iwb-vlist { position: relative; }
.iwb-vlist-row { position: absolute; left: 0; right: 0; height: 22px; }

.iwb-filter {
  display: flex; align-items: center; gap: 6px; margin: 6px 8px; height: 26px; padding: 0 8px;
  border: 1px solid var(--iwb-border); border-radius: 6px; background: var(--iwb-panel-2); color: var(--iwb-muted);
}
.iwb-filter input { flex: 1; min-width: 0; background: none; border: 0; outline: none; color: var(--iwb-fg); font-size: 12px; }
.iwb-filter input::placeholder { color: var(--iwb-muted); }

.iwb-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 26px 20px; color: var(--iwb-muted); text-align: center; font-size: 12px; }
.iwb-empty-title { color: var(--iwb-fg); font-size: 13px; font-weight: 600; }
/* The file-link carrier tab is not inside the workbench root, so it carries
   its own token scope and a centered dialog card. Without this the primary
   button's white label sits on an unresolved (transparent) accent background. */
.iwb-link-shell {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex: 1 1 auto; width: 100%; height: 100%; min-height: 0; padding: 16px; overflow: auto;
  background: var(--iwb-bg); color: var(--iwb-fg);
  font-family: var(--iwb-font); font-size: 13px; line-height: 1.45;
  -webkit-app-region: no-drag;
}
.iwb-link-shell *, .iwb-link-shell *::before, .iwb-link-shell *::after { box-sizing: border-box; }
.iwb-link-shell .iwb-textbtn { font: inherit; cursor: pointer; }
.iwb-link-prompt {
  width: 100%; max-width: 480px; padding: 22px 20px;
  border: 1px solid var(--iwb-border); border-radius: 12px;
  background: var(--iwb-panel); box-shadow: 0 12px 32px rgba(0, 0, 0, .18);
}
.iwb-link-body { color: var(--iwb-fg); font-size: 12.5px; line-height: 1.5; }
.iwb-link-path {
  max-width: 100%; color: var(--iwb-muted); font-family: var(--iwb-mono, ui-monospace, Consolas, monospace);
  font-size: 11px; line-height: 1.45; word-break: break-all; user-select: text;
}
.iwb-link-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 2px; }
.iwb-link-actions .iwb-textbtn { height: auto; min-height: 28px; padding: 5px 14px; white-space: normal; text-align: center; }
.iwb-error-box { margin: 8px; padding: 8px 10px; border: 1px solid rgba(226, 104, 111, .4); border-radius: 6px; background: rgba(226, 104, 111, .08); color: var(--iwb-error); font-size: 11.5px; white-space: pre-wrap; word-break: break-word; user-select: text; }

.iwb-menu {
  position: fixed; z-index: 40; padding: 4px; border-radius: 8px;
  border: 1px solid var(--iwb-border-strong); background: var(--iwb-overlay);
  box-shadow: 0 12px 32px rgba(0, 0, 0, .38);
  max-height: calc(100vh - 12px); overflow-y: auto; overflow-x: hidden;
}
.iwb-menu-sub { z-index: 41; }
.iwb-menu .iwb-menu-item {
  display: flex; align-items: center; gap: 6px; width: 100%; padding: 5px 6px 5px 4px; border-radius: 5px;
  text-align: left; font-size: 12px; color: var(--iwb-fg); white-space: nowrap;
}
.iwb-menu .iwb-menu-item:hover:not(:disabled) { background: rgba(127, 127, 127, .16); }
.iwb-menu .iwb-menu-item:disabled { opacity: .4; }
.iwb-menu .iwb-menu-item.iwb-menu-danger { color: var(--iwb-error); }
.iwb-menu-check { width: 12px; flex: 0 0 12px; text-align: center; color: var(--iwb-accent); }
.iwb-menu-icon { width: 14px; flex: 0 0 14px; display: inline-flex; align-items: center; justify-content: center; }
.iwb-menu-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.iwb-menu-shortcut { flex: 0 0 auto; margin-left: 22px; color: var(--iwb-muted); font-size: 10.5px; font-family: var(--iwb-font); letter-spacing: .01em; }
.iwb-menu-arrow { width: 10px; flex: 0 0 10px; text-align: right; color: var(--iwb-muted); }
.iwb-menu .iwb-menu-sep { height: 1px; margin: 4px 2px; background: var(--iwb-border); }
.iwb-menu .iwb-menu-label { padding: 5px 8px; color: var(--iwb-muted); font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; }

.iwb-field { display: flex; flex-direction: column; gap: 5px; margin: 10px 0; font-size: 12px; color: var(--iwb-muted); }
.iwb-field input, .iwb-field select {
  height: 30px; padding: 0 9px; border-radius: 6px; border: 1px solid var(--iwb-border);
  background: var(--iwb-panel-2); color: var(--iwb-fg); font-size: 12.5px; outline: none;
}
.iwb-field input:focus, .iwb-field select:focus { border-color: var(--iwb-accent); }

.iwb-commit { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.iwb-commit-message { padding: 8px; border-bottom: 1px solid var(--iwb-border); }
.iwb-commit-message textarea {
  width: 100%; resize: vertical; min-height: 76px; max-height: 220px; padding: 8px 10px; border-radius: 6px;
  border: 1px solid var(--iwb-border); background: var(--iwb-panel-2); outline: none; font-size: 12.5px;
  line-height: 1.5; user-select: text;
}
.iwb-commit-message textarea:focus { border-color: var(--iwb-accent); }
.iwb-commit-actions { display: flex; align-items: center; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.iwb-commit-actions .iwb-spacer { flex: 1; }
.iwb-commit-tasks { display: flex; align-items: center; gap: 14px; margin-top: 6px; flex-wrap: wrap; }
.iwb-check { display: inline-flex; align-items: center; gap: 5px; color: var(--iwb-muted); font-size: 12px; cursor: pointer; }
.iwb-check input { accent-color: var(--iwb-accent); }
.iwb-groups { flex: 1; min-height: 0; overflow: auto; padding-bottom: 8px; }
.iwb-group { border-bottom: 1px solid var(--iwb-border); }
.iwb-group-header {
  display: flex; align-items: center; gap: 6px; height: 27px; padding: 0 8px; color: var(--iwb-muted);
  font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; position: sticky; top: 0;
  background: var(--iwb-panel); z-index: 2;
}
.iwb-group-header .iwb-count {
  min-width: 16px; height: 16px; padding: 0 5px; border-radius: 999px; background: rgba(127, 127, 127, .18);
  color: var(--iwb-fg); font-size: 10px; display: inline-flex; align-items: center; justify-content: center;
}
.iwb-group-header .iwb-spacer { flex: 1; }
.iwb-file-row {
  display: flex; align-items: center; gap: 6px; height: 23px; padding: 0 8px 0 12px; cursor: pointer; font-size: 12px;
}
.iwb-file-row:hover { background: rgba(127, 127, 127, .1); }
.iwb-file-row.iwb-active { background: rgba(76, 154, 255, .16); }
.iwb-file-row.iwb-selected { background: rgba(76, 154, 255, .16); }
.iwb-file-row.iwb-file-untracked .iwb-file-name { color: var(--iwb-git-untracked); }
.iwb-file-row.iwb-file-conflict .iwb-file-name { color: var(--iwb-git-conflict); font-weight: 600; }
.iwb-file-row .iwb-file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iwb-file-row .iwb-file-dir { color: var(--iwb-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iwb-file-row .iwb-file-status { color: var(--iwb-muted); font-size: 10px; width: 12px; text-align: center; font-family: var(--iwb-mono); }
.iwb-group-empty { padding: 8px 12px; color: var(--iwb-muted); font-size: 11.5px; font-style: italic; }
.iwb-commit-toolbar { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-top: 1px solid var(--iwb-border); border-bottom: 1px solid var(--iwb-border); }
.iwb-changelist-head { height: 24px; display: flex; align-items: center; gap: 6px; padding: 0 10px; color: var(--iwb-muted); font-size: 11px; background: rgba(127, 127, 127, .06); }
.iwb-changelist-head .iwb-count { font-size: 10px; }
.iwb-dir-heading { height: 22px; display: flex; align-items: center; padding: 0 10px 0 22px; color: var(--iwb-muted); font-size: 11px; }
.iwb-file-row .iwb-file-stat { margin-left: auto; display: flex; gap: 5px; font-size: 10.5px; font-variant-numeric: tabular-nums; }
.iwb-additions { color: var(--iwb-add); }
.iwb-deletions { color: var(--iwb-del); }
.iwb-file-row .iwb-row-actions { display: none; margin-left: auto; gap: 2px; }
.iwb-file-row:hover .iwb-row-actions { display: flex; }
.iwb-file-row:hover .iwb-file-stat { display: none; }

.iwb-diff { flex: 1; min-height: 0; display: flex; flex-direction: column; }
/* The single scroll surface of the unified view (and of the empty state).
   tab-size: 4 is the tab stop the width measure of diff.js assumes
   (DIFF_TAB_SIZE): a tab in a line must reserve the same four columns the
   stylesheet gives it. */
.iwb-diff-scroll { flex: 1; min-height: 0; overflow: auto; font-family: var(--iwb-mono); font-size: 12.5px; line-height: 20px; position: relative; tab-size: 4; }
/* Side by side is two panes that always split the content area in half: the
   tracks are minmax(0, 1fr), so neither a long line nor a scrollbar can move
   the split, and both panes follow the width of the editor - not the width of
   the text inside them. */
.iwb-diff-split {
  flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  font-family: var(--iwb-mono); font-size: 12.5px; line-height: 20px; tab-size: 4;
}
/* Each pane scrolls inside its own region: its horizontal bar pans its own
   longest line, and the two bars are linked by the viewer (same distance from
   the left edge, so the halves keep telling the same story). The vertical
   scrollbar is shown on the right pane only: a second one against the split
   would take a scrollbar's width out of the left half and make the two halves
   look unequal. The left pane keeps its horizontal bar - width 0 hides the
   vertical one, height stays the shared 10px of the root scrollbar rule. */
.iwb-diff-pane { position: relative; overflow: auto; min-width: 0; }
.iwb-diff-pane-left::-webkit-scrollbar { width: 0; }
/* Rows are absolutely positioned (left: 0; right: 0), so the viewer writes the
   measured width of the longest visible line onto this element; that is what
   gives the scroll surface a scrollable width and lets the row backgrounds
   cover every pixel of it. Every surface - the one of the unified view, and
   each pane of the side-by-side view - has its own measure. The 100% min-width
   keeps the fallback width (no measurement) at the width of the surface. */
.iwb-diff-inner { position: relative; min-width: 100%; }
.iwb-diff-row { display: flex; height: 20px; white-space: pre; }
.iwb-diff-row.iwb-add { background: rgba(79, 180, 119, .12); }
.iwb-diff-row.iwb-del { background: rgba(226, 104, 111, .12); }
.iwb-diff-row .iwb-diff-gutter {
  width: 22px; flex: 0 0 22px; display: flex; align-items: center; justify-content: center; color: var(--iwb-muted);
  cursor: pointer; user-select: none; font-size: 11px;
}
.iwb-diff-row.iwb-add:hover .iwb-diff-gutter { color: var(--iwb-add); background: rgba(79, 180, 119, .2); }
.iwb-diff-row.iwb-del:hover .iwb-diff-gutter { color: var(--iwb-del); background: rgba(226, 104, 111, .2); }
.iwb-diff-num {
  width: 44px; flex: 0 0 44px; text-align: right; padding-right: 8px; color: var(--iwb-muted); opacity: .6;
  font-variant-numeric: tabular-nums; user-select: none;
}
.iwb-diff-sign { width: 16px; flex: 0 0 16px; text-align: center; user-select: none; color: var(--iwb-muted); }
/* The text of a row takes the rest of the row; it carries no min-width of its
   own, because the same class is used in the side-by-side cells, whose two
   columns must stay deterministic (see the minmax() tracks below). */
.iwb-diff-text { flex: 1; padding-right: 24px; }
/* Only the unified row needs the flex item to keep its whole line: the row has
   no second column that could be pushed around, so the line overflows
   horizontally into the shared scroll surface instead of being shrunk. */
.iwb-diff-row .iwb-diff-text { min-width: max-content; }
.iwb-diff-row.iwb-selected { outline: 1px solid rgba(76, 154, 255, .55); background: rgba(76, 154, 255, .22) !important; }
.iwb-diff-row.iwb-diff-find, .iwb-diff-side.iwb-diff-find { outline: 1px solid rgba(215,162,74,.65); outline-offset: -1px; }
.iwb-diff-row.iwb-diff-find-active, .iwb-diff-side.iwb-diff-find-active { outline: 2px solid var(--iwb-accent); outline-offset: -2px; background: rgba(76,154,255,.2); }
.iwb-word-add { background: rgba(79, 180, 119, .38); border-radius: 2px; }
.iwb-word-del { background: rgba(226, 104, 111, .38); border-radius: 2px; }
.iwb-diff-hunk { display: flex; align-items: center; height: 22px; background: rgba(127, 127, 127, .09); color: var(--iwb-muted); font-size: 11.5px; }
.iwb-diff-collapsed {
  display: flex; align-items: center; justify-content: center; height: 20px; cursor: pointer;
  color: var(--iwb-muted); font-size: 11px; background: rgba(127, 127, 127, .07);
  border-top: 1px dashed var(--iwb-border); border-bottom: 1px dashed var(--iwb-border);
}
.iwb-diff-collapsed:hover { color: var(--iwb-fg); background: rgba(127, 127, 127, .14); }
.iwb-diff-hunk .iwb-hunk-text { padding: 0 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; }
.iwb-diff-hunk .iwb-hunk-actions { display: none; padding-right: 6px; }
.iwb-diff-hunk:hover .iwb-hunk-actions { display: flex; }
.iwb-diff-toolbar {
  height: 30px; flex: 0 0 30px; display: flex; align-items: center; gap: 8px; padding: 0 10px;
  border-bottom: 1px solid var(--iwb-border); background: var(--iwb-bg); font-size: 11.5px; color: var(--iwb-muted);
}
.iwb-diff-toolbar .iwb-spacer { flex: 1; }
/* A side-by-side row lives inside ONE pane: it is a flex line holding the
   single cell of that pane, so the two halves can scroll independently while
   their rows stay on the same line (both panes share the row list). */
.iwb-diff-side { display: flex; height: 20px; }
/* The cell renders the raw text: white-space: pre keeps the leading
   indentation, the runs of spaces and the trailing spaces that normal
   collapses (the package-lock.json indentation bug). It fills the pane's
   measured inner width (flex: 1), which is why it never needs to push the
   other half around - there is no other half inside this row. overflow: hidden
   only clips the estimation error of the measurement. */
.iwb-diff-side-cell { display: flex; flex: 1 1 auto; height: 20px; min-width: 0; white-space: pre; overflow: hidden; border-right: 1px solid var(--iwb-border); }
.iwb-diff-side-cell.iwb-add { background: rgba(79, 180, 119, .12); }
.iwb-diff-side-cell.iwb-del { background: rgba(226, 104, 111, .12); }
.iwb-diff-side-cell.iwb-blank { background: rgba(127, 127, 127, .05); }
.iwb-diff-side .iwb-diff-num { width: 44px; flex: 0 0 44px; }
.iwb-diff-side-head { display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; color: var(--iwb-muted); font-size: 11px; background: var(--iwb-panel); border-bottom: 1px solid var(--iwb-border); }
.iwb-binary { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--iwb-muted); }

.iwb-git { display: flex; flex-direction: column; height: 100%; min-height: 0; flex: 1 1 auto; width: 100%; min-width: 0; }
.iwb-git-filters { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--iwb-border); flex-wrap: wrap; }
.iwb-path-chip {
  display: inline-flex; align-items: center; gap: 4px; max-width: 260px; height: 22px; padding: 0 4px 0 8px;
  border: 1px solid var(--iwb-border-strong); border-radius: 999px; background: var(--iwb-panel-2);
  color: var(--iwb-fg); font-size: 11px;
}
.iwb-path-chip-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--iwb-mono); }
.iwb-path-chip-clear { width: 16px; height: 16px; border-radius: 50%; color: var(--iwb-muted); font-size: 13px; line-height: 1; }
.iwb-path-chip-clear:hover { background: rgba(127, 127, 127, .2); color: var(--iwb-fg); }
.iwb-select, .iwb-input {
  height: 24px; border-radius: 5px; border: 1px solid var(--iwb-border); background: var(--iwb-panel-2);
  padding: 0 7px; font-size: 11.5px; outline: none; color: var(--iwb-fg);
}
.iwb-input { width: 150px; }
.iwb-select:focus, .iwb-input:focus { border-color: var(--iwb-accent); }
.iwb-git-table { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.iwb-git-head, .iwb-git-row {
  display: grid; grid-template-columns: var(--iwb-graph-w, 96px) 70px minmax(160px, 1fr) 110px 120px;
  align-items: center; height: 24px; padding-right: 10px; white-space: nowrap;
}
.iwb-git-narrow .iwb-git-head, .iwb-git-narrow .iwb-git-row {
  grid-template-columns: var(--iwb-graph-w, 96px) 54px minmax(60px, 1fr) 66px 78px;
  padding-right: 4px;
}
/* Never remove the author/date columns; compress them instead. */
.iwb-git-head { height: 26px; flex: 0 0 26px; border-bottom: 1px solid var(--iwb-border); color: var(--iwb-muted); font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; background: var(--iwb-panel); }
.iwb-git-head > span, .iwb-git-row > span { overflow: hidden; text-overflow: ellipsis; }
.iwb-git-scroll { flex: 1; min-height: 0; overflow: auto; position: relative; }
.iwb-git-rows { position: relative; }
.iwb-git-row { position: absolute; left: 0; right: 0; cursor: pointer; font-size: 12px; }
.iwb-git-row:hover { background: rgba(127, 127, 127, .09); }
.iwb-git-row.iwb-selected { background: rgba(76, 154, 255, .16); }
.iwb-git-row.iwb-compare { box-shadow: inset 2px 0 0 var(--iwb-warn); background: rgba(215, 162, 74, .12); }
.iwb-compare-chip {
  display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 4px 0 8px;
  border: 1px solid var(--iwb-warn); border-radius: 999px; color: var(--iwb-warn); font-size: 11px;
  font-family: var(--iwb-mono);
}
.iwb-git-row .iwb-sha { font-family: var(--iwb-mono); color: var(--iwb-accent); font-size: 11.5px; }
.iwb-git-row .iwb-subject { font-size: 12.5px; }
.iwb-git-row .iwb-author, .iwb-git-row .iwb-date { color: var(--iwb-muted); font-size: 11px; }
.iwb-git-graph { height: 100%; display: flex; align-items: center; }
.iwb-git-empty { padding: 24px; text-align: center; color: var(--iwb-muted); }
.iwb-git-detail {
  flex: 0 0 auto; max-height: 42%; overflow: auto; border-top: 1px solid var(--iwb-border);
  background: var(--iwb-panel); padding: 6px 10px 8px;
}
.iwb-git-detail-head { display: flex; align-items: center; gap: 6px; }
.iwb-git-detail-subject { font-weight: 600; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iwb-git-detail-meta { display: flex; gap: 10px; flex-wrap: wrap; color: var(--iwb-muted); font-size: 11px; margin-top: 3px; }
.iwb-git-detail-sha { font-family: var(--iwb-mono); color: var(--iwb-accent); }
.iwb-git-detail-dim { opacity: .75; }
.iwb-git-detail-body { margin: 6px 0 0; white-space: pre-wrap; color: var(--iwb-muted); font-size: 11.5px; font-family: var(--iwb-font); }
.iwb-git-detail-foot { display: flex; align-items: center; gap: 10px; margin-top: 6px; font-size: 11px; }
.iwb-git-detail-hint { color: var(--iwb-muted); margin-left: auto; }
.iwb-git-files { display: flex; flex-direction: column; gap: 1px; margin-top: 6px; max-height: 120px; overflow: auto; }
.iwb-git-file {
  display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; padding: 2px 6px; border-radius: 4px;
  font-size: 11.5px; color: var(--iwb-fg);
}
.iwb-git-file:hover { background: rgba(127, 127, 127, .14); }
.iwb-git-file-name { font-family: var(--iwb-mono); }

.iwb-term { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.iwb-term-tabs { display: flex; align-items: center; gap: 2px; padding: 3px 6px; border-bottom: 1px solid var(--iwb-border); overflow-x: auto; }
.iwb-term-tab {
  display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: 5px;
  color: var(--iwb-muted); font-size: 11.5px; cursor: pointer; white-space: nowrap;
}
.iwb-term-tab:hover { background: rgba(127, 127, 127, .12); }
.iwb-term-tab.iwb-on { color: var(--iwb-fg); background: rgba(76, 154, 255, .16); }
.iwb-term-tab .iwb-term-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--iwb-success); }
.iwb-term-tab .iwb-term-dot.iwb-exited { background: var(--iwb-muted); }
.iwb-term-panes { flex: 1; min-height: 0; position: relative; }
.iwb-term-pane { position: absolute; inset: 0; padding: 4px 0 0 8px; }
.iwb-term-pane.iwb-hidden { visibility: hidden; pointer-events: none; }
.iwb-term-host { width: 100%; height: 100%; }
.iwb-term-host .xterm { height: 100%; }
/* xterm's viewport is absolutely positioned over the whole terminal and ships a
   hard-coded black background, while the screen inside it is only
   rows * cellHeight tall — the leftover strip at the bottom of the pane showed
   that black instead of the terminal background. The terminal's own background
   is --iwb-bg, so the viewport must let it through. */
.iwb-term-host .xterm-viewport { background-color: transparent; }
.iwb-term-error { padding: 16px; color: var(--iwb-error); font-size: 12px; white-space: pre-wrap; user-select: text; }

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
/* The inputs of the settings page are painted by ONE rule: a control whose
   wrapper is missing from the selector list falls back to the browser's own
   input - a black frame on a white fill, which looks like a hole in the
   page. */
.iwb-settings-control input[type="text"], .iwb-settings-control input[type="number"],
.iwb-settings-control select,
.iwb-settings-field-control input[type="text"], .iwb-settings-field-control input[type="number"],
.iwb-settings-field-control select {
  height: 32px; min-width: 0; padding: 0 10px; color: var(--iwb-fg);
  border: 1px solid var(--iwb-border-strong); border-radius: 6px; background: var(--iwb-bg);
  font-size: 13px; outline: none; transition: border-color .12s ease, box-shadow .12s ease;
}
.iwb-settings-control :is(input[type="text"], input[type="number"], select):hover,
.iwb-settings-field-control :is(input[type="text"], input[type="number"], select):hover { border-color: var(--iwb-muted); }
.iwb-settings-control :is(input[type="text"], input[type="number"], select):focus,
.iwb-settings-field-control :is(input[type="text"], input[type="number"], select):focus {
  border-color: var(--iwb-accent); box-shadow: 0 0 0 1px var(--iwb-accent);
}
.iwb-settings-control input[type="text"], .iwb-settings-field-control input[type="text"] { width: 300px; }
.iwb-settings-control select, .iwb-settings-field-control select { width: 220px; padding-right: 26px; }
.iwb-settings-control input[type="number"], .iwb-settings-field-control input[type="number"] {
  width: 96px; padding-right: 8px; text-align: right; font-variant-numeric: tabular-nums;
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
.iwb-root-picker { display: flex; flex-direction: column; gap: 8px; }
.iwb-root-list { display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow: auto; }
.iwb-root-item { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 6px; border: 1px solid var(--iwb-border); text-align: left; }
.iwb-root-item:hover { background: rgba(127, 127, 127, .1); }
.iwb-root-item .iwb-root-path { color: var(--iwb-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; }
.iwb-project-picker { width: min(620px, calc(100% - 40px)); max-height: min(80vh, 720px); display: flex; flex-direction: column; }
.iwb-modal-hint { color: var(--iwb-muted); font-size: 12px; margin: -2px 0 12px; }
.iwb-project-picker-list { display: flex; flex-direction: column; gap: 3px; overflow: auto; min-height: 0; margin-bottom: 12px; }
.iwb-project-group { color: var(--iwb-muted); font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; padding: 8px 4px 3px; }
.iwb-project-choice {
  display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 8px; border-radius: 7px;
  border: 1px solid transparent; text-align: left;
}
.iwb-project-choice:hover { background: rgba(127, 127, 127, .1); }
.iwb-project-choice.iwb-current { border-color: var(--iwb-border-strong); background: rgba(76, 154, 255, .07); }
.iwb-project-choice-icon { display: flex; align-items: center; justify-content: center; flex: 0 0 18px; color: var(--iwb-muted); }
.iwb-project-choice-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.iwb-project-choice-text b { font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iwb-project-choice-path { color: var(--iwb-muted); font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iwb-project-repo-badge { font-size: 9.5px; color: var(--iwb-git-add, #57a86b); border: 1px solid currentColor; border-radius: 999px; padding: 1px 6px; flex: 0 0 auto; }
.iwb-project-current-badge { font-size: 9.5px; color: var(--iwb-accent); border: 1px solid currentColor; border-radius: 999px; padding: 1px 6px; flex: 0 0 auto; }
.iwb-project-empty { padding: 10px 8px; color: var(--iwb-muted); font-size: 11.5px; }
.iwb-sidebar-open {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border: 0; border-radius: 8px; padding: 0;
  color: var(--dsw-alias-label-secondary); background: transparent; cursor: pointer;
}
.iwb-sidebar-open:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.iwb-sidebar-open:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.iwb-center { min-height: 0; }

/* ── editor FindBar / Search / Quick Open ─────────────────────────────── */
.iwb-findbar {
  flex: 0 0 auto; padding: 4px 8px; border-bottom: 1px solid var(--iwb-border);
  background: var(--iwb-panel); display: flex; flex-direction: column; gap: 4px;
}
.iwb-find-row { display: flex; align-items: center; gap: 5px; min-width: 0; }
.iwb-find-label { width: 34px; flex: 0 0 34px; color: var(--iwb-muted); font-size: 11px; text-align: right; }
.iwb-find-input {
  flex: 1; min-width: 80px; height: 24px; padding: 0 7px; border-radius: 5px;
  border: 1px solid var(--iwb-border); background: var(--iwb-panel-2); color: var(--iwb-fg);
  font-size: 12px; outline: none; user-select: text;
}
.iwb-find-input:focus { border-color: var(--iwb-accent); }
.iwb-find-input.iwb-invalid { border-color: var(--iwb-error); }
.iwb-find-count { min-width: 44px; text-align: center; color: var(--iwb-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.iwb-find-count.iwb-invalid { color: var(--iwb-error); }
.iwb-find-btn {
  width: 24px; height: 24px; border-radius: 5px; color: var(--iwb-muted); display: inline-flex;
  align-items: center; justify-content: center; font-size: 13px;
}
.iwb-find-btn:hover:not(:disabled) { background: rgba(127,127,127,.14); color: var(--iwb-fg); }
.iwb-find-btn:disabled { opacity: .35; }
.iwb-find-flag {
  min-width: 26px; height: 22px; padding: 0 5px; border-radius: 4px; border: 1px solid transparent;
  color: var(--iwb-muted); font-family: var(--iwb-mono); font-size: 10.5px;
}
.iwb-find-flag:hover { background: rgba(127,127,127,.14); color: var(--iwb-fg); }
.iwb-find-flag.iwb-on { border-color: var(--iwb-accent); color: var(--iwb-accent); background: rgba(76,154,255,.12); }
.iwb-dom-findbar { position: absolute; top: 0; left: 0; right: 0; z-index: 14; box-shadow: 0 4px 12px rgba(0,0,0,.25); }
::highlight(iwb-dom-find) { background-color: rgba(215, 162, 74, .38); }
::highlight(iwb-dom-find-active) { background-color: rgba(76, 154, 255, .55); color: inherit; }
/* Editor-owned dialogs center on the *document* window, not on the whole
   workbench root: the backdrop is scoped to the editor pane so the top bar
   and the status bar stay untouched. */
.iwb-editor-scoped-backdrop {
  position: absolute; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, .45); padding: 0 12px;
}
.iwb-editor-scoped-backdrop .iwb-modal { width: min(440px, 100%); }
/* The title stays on one line; the body explains the conflict and may wrap -
   it is clamped to three lines and carries the full text in its title. */
.iwb-editor-scoped-backdrop .iwb-modal h2 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iwb-editor-scoped-backdrop .iwb-modal p {
  white-space: normal; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.iwb-editor-scoped-backdrop .iwb-modal-actions { flex-wrap: wrap; }

/* A bare word of the search slice (the tab view of the results is gone; the
   popup below carries the rest). */
.iwb-search-warn { color: var(--iwb-warn); }
.iwb-search-error { padding: 12px; color: var(--iwb-error); font-size: 12px; white-space: pre-wrap; }

/* ── Find in Files popup (PRD-v5 FIND-01 / FIND-02) ─────────────────────────
   The popup reuses the Quick Open skeleton: the same backdrop (z-index 70,
   above every modal), the same panel, the same head and foot. Only the body
   differs - the files on top (40%), the context of the selected file below
   (60%), so a project-wide search never takes the code away from the user. */
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
/* The upper half is a plain list of the files that matched - one row per file,
   with its match count. The matches themselves are the preview below:
   repeating them under the file row made the list a wall of text and left the
   preview empty. */
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

/* ── Project filter modes / opened-vs-selected ───────────────────────── */
.iwb-filter-mode { display: inline-flex; border: 1px solid var(--iwb-border); border-radius: 4px; overflow: hidden; flex: 0 0 auto; }
.iwb-filter-mode button { height: 20px; padding: 0 6px; color: var(--iwb-muted); font-size: 10.5px; }
.iwb-filter-mode button.iwb-on { background: rgba(76,154,255,.18); color: var(--iwb-fg); }
.iwb-filter-mode button + button { border-left: 1px solid var(--iwb-border); }
.iwb-filter-hint { padding: 0 12px 5px; color: var(--iwb-muted); font-size: 10.5px; }
.iwb-error-text { color: var(--iwb-error); }
.iwb-tree-row.iwb-opened .iwb-tree-name { color: var(--iwb-accent); font-weight: 600; }
.iwb-tree-row.iwb-opened::before {
  content: ''; position: absolute; left: 0; top: 2px; bottom: 2px; width: 2px; border-radius: 2px;
  background: var(--iwb-accent);
}
.iwb-tree-relative { margin-left: auto; color: var(--iwb-muted); font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 46%; }

/* ── Git Drawer ──────────────────────────────────────────────────────── */
.iwb-branch-switch {
  display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 7px; border-radius: 5px;
  border: 1px solid var(--iwb-border); color: var(--iwb-fg); font-size: 11.5px; max-width: 210px;
}
.iwb-branch-switch:hover { border-color: var(--iwb-border-strong); background: rgba(127,127,127,.08); }
.iwb-branch-caret { color: var(--iwb-muted); font-size: 9px; }
.iwb-branch-popover {
  position: fixed; z-index: 42; width: 260px; padding: 6px; border-radius: 8px;
  border: 1px solid var(--iwb-border-strong); background: var(--iwb-overlay);
  box-shadow: 0 14px 36px rgba(0,0,0,.4);
}
.iwb-branch-list { max-height: 280px; overflow: auto; margin-top: 5px; }
.iwb-branch-row {
  display: flex; align-items: center; gap: 6px; width: 100%; height: 25px; padding: 0 6px;
  border-radius: 4px; text-align: left; font-size: 12px;
}
.iwb-branch-row.iwb-selected { background: rgba(76,154,255,.2); }
.iwb-branch-check { width: 12px; flex: 0 0 12px; color: var(--iwb-accent); }
.iwb-git-main { flex: 1; min-height: 0; display: flex; position: relative; }
.iwb-git-table { flex: 1; min-width: 0; }
.iwb-git-drawer {
  position: relative; flex: 0 0 auto; min-width: 300px; display: flex; flex-direction: column; min-height: 0;
  border-left: 1px solid var(--iwb-border-strong); background: var(--iwb-panel);
}
.iwb-git-drawer-overlay {
  position: absolute; inset: 0; width: 100% !important; min-width: 0; z-index: 12; border-left: 0;
}
.iwb-git-drawer-backdrop { position: absolute; inset: 0; z-index: 11; background: rgba(0,0,0,.42); }
.iwb-git-drawer-resizer { position: absolute; left: -3px; top: 0; bottom: 0; width: 6px; cursor: col-resize; z-index: 13; }
.iwb-git-drawer-resizer:hover { background: rgba(76,154,255,.28); }
.iwb-git-drawer-head {
  display: flex; align-items: center; gap: 6px; min-height: 34px; padding: 5px 6px 5px 10px;
  border-bottom: 1px solid var(--iwb-border); background: var(--iwb-panel);
}
.iwb-git-drawer-title { font-weight: 600; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iwb-git-drawer-head .iwb-spacer { flex: 1; }
.iwb-git-drawer-body { flex: 1; min-height: 0; overflow: auto; padding: 8px 10px 24px; }
.iwb-git-drawer-meta { display: flex; flex-wrap: wrap; gap: 7px 10px; color: var(--iwb-muted); font-size: 11px; }
.iwb-git-drawer-sha { font-family: var(--iwb-mono); color: var(--iwb-accent); }
.iwb-git-open-full { margin-top: 7px; }
.iwb-git-drawer-body-text {
  margin: 7px 0 0; white-space: pre-wrap; color: var(--iwb-muted); font-size: 11.5px;
  font-family: var(--iwb-font); max-height: 120px; overflow: auto; user-select: text;
}
.iwb-git-drawer-section-title {
  display: flex; align-items: center; gap: 5px; margin: 10px 0 4px; color: var(--iwb-muted);
  font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
}
.iwb-git-drawer-files { display: flex; flex-direction: column; gap: 1px; }
.iwb-git-drawer-file {
  display: flex; align-items: center; gap: 5px; width: 100%; min-height: 23px; padding: 0 5px;
  border-radius: 4px; text-align: left; font-size: 11.5px;
}
.iwb-git-drawer-file:hover { background: rgba(127,127,127,.12); }
.iwb-git-drawer-file.iwb-selected { background: rgba(76,154,255,.16); }
.iwb-git-drawer-file .iwb-git-file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iwb-git-drawer-file .iwb-additions, .iwb-git-drawer-file .iwb-deletions { margin-left: 0; font-size: 10px; }
/* Changed files render as a collapsible directory tree. */
.iwb-git-tree { display: flex; flex-direction: column; gap: 1px; }
.iwb-git-tree-dir {
  display: flex; align-items: center; gap: 5px; width: 100%; min-height: 23px; padding: 0 5px;
  border-radius: 4px; text-align: left; font-size: 11.5px;
}
.iwb-git-tree-dir:hover { background: rgba(127,127,127,.12); }
.iwb-git-tree-caret { width: 10px; flex: 0 0 10px; color: var(--iwb-muted); font-size: 9px; text-align: center; }
.iwb-git-tree-dir-name {
  font-family: var(--iwb-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.iwb-git-tree-file { padding-left: 20px; }
/* The Git panel's own repository switcher, mirroring the branch switch. */
.iwb-repo-switch { max-width: 190px; }
.iwb-repo-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iwb-git-no-repo {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  padding: 26px 20px; color: var(--iwb-muted); text-align: center; font-size: 12px;
}
.iwb-git-file-status { width: 13px; flex: 0 0 13px; text-align: center; font-family: var(--iwb-mono); font-size: 10px; color: var(--iwb-muted); }
.iwb-status-A { color: var(--iwb-add); } .iwb-status-D { color: var(--iwb-del); } .iwb-status-R { color: var(--iwb-warn); }

/* Read-only code / diff must be copyable despite the root user-select:none. */
.iwb-code, .iwb-diff-text, .iwb-diff-side-cell, .iwb-diff-row { user-select: text; }
.iwb-diff-row .iwb-diff-num, .iwb-diff-row .iwb-diff-sign, .iwb-diff-row .iwb-diff-gutter { user-select: none; }

/* ── Git Blame annotation (V6 blame) ────────────────────────────────────────
   The annotation is an INLINE COLUMN: a CodeMirror gutter of its own, placed
   left of the line numbers (see blame-gutter.js), not a side panel. It is
   painted by the gutter machinery, so it scrolls with the document and stays
   fixed horizontally like the numbers do. One cell carries the day and the
   author; a line that is not committed yet has no cell at all. */
.iwb-blame-gutter { border-right: 1px solid var(--iwb-border); }
/* The numbers keep their own padding; the annotate cell only needs a small gap
   from the number column so the two do not touch. */
.iwb-blame-gutter .cm-gutterElement { padding: 0 8px 0 6px; }
.iwb-blame-note {
  font-family: var(--iwb-mono); font-size: 11px; line-height: 20px;
  color: var(--iwb-muted); white-space: nowrap; cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.iwb-blame-note:hover { color: var(--iwb-accent); text-decoration: underline; }
/* The active line is part of the annotate column too, so it answers the same
   way the numbers do instead of looking like a hole. */
.iwb-blame-gutter .cm-activeLineGutter { background: transparent; color: var(--iwb-fg); }

@container ide-workbench (max-width: 760px) {
  .iwb-topbar { gap: 4px; padding: 0 6px; }
  .iwb-project-select { flex: 1; padding: 0 3px; }
  .iwb-project-path, .iwb-top-spacer { display: none; }
  .iwb-branch-chip { max-width: 100px; padding: 0 4px; }
  .iwb-topbar > button { flex-shrink: 0; }
  /* Keep a readable editor: below this width the left dock follows the pane
     instead of holding its remembered pixel width. */
  .iwb-left { width: min(var(--iwb-left-width, 300px), ${LEFT_PANE_RATIO}cqw); }
  .iwb-statusbar { overflow-x: auto; white-space: nowrap; }
  .iwb-status-item { flex-shrink: 0; }
  .iwb-editor-toolbar { overflow-x: auto; flex-shrink: 0; }
  .iwb-modal { max-width: calc(100% - 16px); }
}

/* Stack only when a side-by-side layout would leave the editor too narrow.
   Most laptop windows put the right sidebar at ~45% of the frame, well above
   this width; docking vertically is the fallback, not the normal mode. */
@container ide-workbench (max-width: ${STACK_WIDTH}px) {
  .iwb-body { flex-direction: column; }
  .iwb-stripe { width: 100%; flex: 0 0 38px; flex-direction: row; padding: 2px 6px; border-right: 0; border-bottom: 1px solid var(--iwb-border); }
  .iwb-stripe-spacer { flex: 1; }
  .iwb-stripe-btn { width: 30px; height: 30px; }
  .iwb-stripe-btn.iwb-on::before { left: 6px; right: 6px; top: auto; bottom: -3px; width: auto; height: 2px; }
  .iwb-left { width: 100% !important; min-width: 0; max-width: none; flex: 0 1 38%; min-height: 120px; border-right: 0; border-bottom: 1px solid var(--iwb-border); }
  .iwb-left-resizer { display: none; }
  .iwb-center { min-height: 140px; }
  /* Right mode stacks exactly like the left one: the paint order and the
     mirrored edges of the side-by-side layout are undone, so the stripe is
     the top bar and the dock sits between it and the editor again. Without
     this reset the right-side rules would leak their order (the stripe
     would fall to the bottom) and their border (a stray left line). */
  .iwb-side-right .iwb-body > .iwb-center,
  .iwb-side-right .iwb-body > .iwb-left,
  .iwb-side-right .iwb-body > .iwb-stripe { order: 0; }
  .iwb-side-right .iwb-stripe { border-left: 0; }
  .iwb-side-right .iwb-left { border-left: 0; }
  .iwb-side-right .iwb-stripe-btn.iwb-on::before {
    left: 6px; right: 6px; top: auto; bottom: -3px; width: auto; height: 2px;
  }
  /* Stacked: the stripe is a horizontal bar, so the dock needs no left gutter.
     The percentage basis is the root height now, not the editor column. */
  .iwb-bottom { max-height: 60%; min-height: 100px; }
  .iwb-bottom-tabs { padding-left: 8px; }
  .iwb-bottom-body { padding-left: 0; }
}
`
