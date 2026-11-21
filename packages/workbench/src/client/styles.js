/**
 * One stylesheet for the whole workbench, inserted through the package-owned
 * `styles` builtin (removed with the Client run). Every surface uses the
 * `--dsw-alias-*` tokens with a neutral fallback, so the panel follows the
 * harness light/dark theme and transparent skins.
 */
import { LEFT_PANE_RATIO, STACK_WIDTH } from './layout.js'

// The two faces of the workbench ride along with it: the build replaces the
// placeholder below with the `@font-face` rules of Inter and JetBrains Mono,
// whose bytes are inlined as data URIs (see `scripts/build-client.mjs`).
//
// The placeholder is a COMMENT on purpose: the source of the client has to
// stay buildable without a binary loader, because every test suite bundles
// it with a plain esbuild call. A comment is a no-op there, and the build
// fills it in.
export const CSS = `/*__DSH_FONT_CSS__*/
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
  /* The text on a solid brand surface. The host's brand colour is
     theme-relative - near-black (#0f1115) in the light theme, near-white
     (#f9fafb) in the dark one - so the readable label is the colour of the
     surface underneath it, which is exactly the bg-base token. (The host
     defines no "on brand" token: a fixed dark fallback made the primary
     button black on black in the light theme.) */
  --iwb-on-accent: var(--dsw-alias-label-on-brand, var(--dsw-alias-bg-base, #fff));
  --iwb-shadow: var(--dsw-alias-shadow-1, rgba(0, 0, 0, .32));
  /* ── the design tokens of this round (PRD-v8 §2.3.1) ───────────────────────
     The host owns the COLOURS of the workbench; this layer owns its SHAPE:
     the radii, the spacing, the shadows, the easing and the type scale.
     Before it, every rule made its own small decision - a 6px radius here,
     a 7px one there, a 120ms transition in one place and none in the next.
     The result looked like a collection of widgets instead of a product.

     The surfaces are the other half of the story. The host gives the workbench
     a base and two layers; what it does not give is a NAME for "the surface
     a row lights up when the pointer is on it" or "the tint of the selected
     row". Those are the surfaces the eye reads as depth, so they get tokens
     of their own - mixed from the theme, never a hard-coded grey. */
  --iwb-radius-xs: 4px;
  --iwb-radius-sm: 6px;
  --iwb-radius-md: 8px;
  --iwb-radius-lg: 12px;
  --iwb-radius-pill: 999px;

  --iwb-space-1: 4px;
  --iwb-space-2: 8px;
  --iwb-space-3: 12px;
  --iwb-space-4: 16px;
  --iwb-space-5: 24px;

  /* One easing and two durations for the whole workbench: a product that
     animates in a hundred different ways reads as a hundred different
     widgets. */
  --iwb-ease: cubic-bezier(.2, .8, .2, 1);
  --iwb-dur-fast: 120ms;
  --iwb-dur: 180ms;

  /* The surfaces, from the deepest to the highest. */
  --iwb-surface-base: var(--iwb-bg);
  --iwb-surface-raised: var(--iwb-panel);
  --iwb-surface-sunken: var(--iwb-panel-2);
  --iwb-surface-overlay: var(--iwb-overlay);
  /* The pointer on a row. Mixed from the theme's own text colour, so the
     hover is a hint of the foreground - never a grey that belongs to
     neither theme. */
  --iwb-surface-hover: color-mix(in srgb, var(--iwb-fg) 7%, transparent);
  --iwb-surface-active: color-mix(in srgb, var(--iwb-fg) 13%, transparent);
  --iwb-surface-selected: color-mix(in srgb, var(--iwb-accent) 17%, transparent);
  --iwb-surface-selected-soft: color-mix(in srgb, var(--iwb-accent) 9%, transparent);
  --iwb-surface-glow: color-mix(in srgb, var(--iwb-accent) 32%, transparent);

  /* The light of the room. A surface is not "flat with a border": it is a
     solid that catches light on its top edge and is shaded underneath. The
     sheen is made of white and black - not of the text colour - so it stays
     a highlight in a light theme and a shade in a dark one. */
  --iwb-sheen: linear-gradient(180deg, color-mix(in srgb, #fff 13%, transparent) 0%, color-mix(in srgb, #000 7%, transparent) 100%);
  --iwb-highlight: inset 0 1px 0 color-mix(in srgb, #fff 12%, transparent);
  --iwb-shadow-sm: 0 1px 2px color-mix(in srgb, #000 26%, transparent);
  --iwb-shadow-md: 0 4px 14px color-mix(in srgb, #000 30%, transparent), 0 1px 2px color-mix(in srgb, #000 22%, transparent);
  --iwb-shadow-lg: 0 18px 48px color-mix(in srgb, #000 44%, transparent), 0 2px 6px color-mix(in srgb, #000 26%, transparent);
  --iwb-focus-ring: 0 0 0 2px var(--iwb-bg), 0 0 0 4px color-mix(in srgb, var(--iwb-accent) 72%, transparent);
  /* ── the glass of the floating layers (PRD-v8 §2.3.5) ─────────────────────
     The material of the recent system UIs: a surface that is partly
     TRANSPARENT, that catches the light on its top edge, and that blurs
     what is behind it.

     It is applied to the FLOATING layers only - the menu, the dialog, the
     popover, the toast. Those are the surfaces that really sit ABOVE the
     content, and there are only a few of them at a time.

     The dense surfaces - the file tree, the editor, the bars - stay SOLID on
     purpose: a tree behind a blur is unreadable, and a blur on every row
     would cost a frame per row. The discipline of the repository (a
     performance gate on every panel) is the reason the effect is small.

     The blur is behind a "@supports" rule (at the end of this stylesheet):
     a browser that cannot do it keeps the plain, opaque surface - the
     workbench never depends on it. */
  --iwb-glass: color-mix(in srgb, var(--iwb-overlay) 74%, transparent);
  --iwb-glass-blur: saturate(180%) blur(20px);
  --iwb-glass-edge: inset 0 1px 0 color-mix(in srgb, #fff 28%, transparent), inset 0 0 0 1px color-mix(in srgb, #fff 9%, transparent);
  --iwb-glass-shadow: 0 20px 52px color-mix(in srgb, #000 46%, transparent), 0 2px 8px color-mix(in srgb, #000 26%, transparent);
  /* ── the syntax palette (THEME-03, redone in PRD-v8) ─────────────────────
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

     The SHARES are the part that decides whether the code looks ALIVE. Each
     branch mixes the hue with the text colour of its theme, and the two
     shares sum to 100%:

       light: 76% hue + 24% near-black   -> the hue darkens into the page
                                            but keeps its identity;
       dark:  86% hue + 14% near-white   -> the hue stays VIVID on the dark
                                            code layer instead of being
                                            washed into a pastel.

     The old palette mixed 80%/52%, and the dark branch came out dusty: a
     keyword was a pale violet and a string a pale olive - readable, but
     nobody would call it modern. The hues below were picked for CHARACTER
     (a keyword never reads as a string, a type never as a function), and
     their lightness was then SOLVED for the most colour that still clears
     5.25:1 on white, on the dark editor and on the dark code layer.

     The branch follows the host through light-dark(), which resolves on the
     color-scheme the host declares for its theme (the DSH host writes
     :root { color-scheme: light|dark } for every theme - app or system).
     Nothing switches on prefers-color-scheme, and nothing waits for the
     host. tests/styles-theme.test.mjs does the oklab maths and checks every
     token, in both branches, on all three surfaces (white, the editor
     background and the code layer). */
  --iwb-syn-comment-light: color-mix(in oklab, #638392 76%, var(--iwb-fg) 24%);
  --iwb-syn-comment-dark: color-mix(in oklab, #638392 50%, var(--iwb-fg) 50%);
  --iwb-syn-comment: light-dark(var(--iwb-syn-comment-light), var(--iwb-syn-comment-dark));
  --iwb-syn-string-light: color-mix(in oklab, #259f56 76%, var(--iwb-fg) 24%);
  --iwb-syn-string-dark: color-mix(in oklab, #259f56 76%, var(--iwb-fg) 24%);
  --iwb-syn-string: light-dark(var(--iwb-syn-string-light), var(--iwb-syn-string-dark));
  --iwb-syn-keyword-light: color-mix(in oklab, #a870e9 76%, var(--iwb-fg) 24%);
  --iwb-syn-keyword-dark: color-mix(in oklab, #a870e9 76%, var(--iwb-fg) 24%);
  --iwb-syn-keyword: light-dark(var(--iwb-syn-keyword-light), var(--iwb-syn-keyword-dark));
  --iwb-syn-type-light: color-mix(in oklab, #0099a8 76%, var(--iwb-fg) 24%);
  --iwb-syn-type-dark: color-mix(in oklab, #0099a8 74%, var(--iwb-fg) 26%);
  --iwb-syn-type: light-dark(var(--iwb-syn-type-light), var(--iwb-syn-type-dark));
  --iwb-syn-number-light: color-mix(in oklab, #d07200 76%, var(--iwb-fg) 24%);
  --iwb-syn-number-dark: color-mix(in oklab, #d07200 74%, var(--iwb-fg) 26%);
  --iwb-syn-number: light-dark(var(--iwb-syn-number-light), var(--iwb-syn-number-dark));
  --iwb-syn-function-light: color-mix(in oklab, #2a8ee7 76%, var(--iwb-fg) 24%);
  --iwb-syn-function-dark: color-mix(in oklab, #2a8ee7 76%, var(--iwb-fg) 24%);
  --iwb-syn-function: light-dark(var(--iwb-syn-function-light), var(--iwb-syn-function-dark));
  --iwb-syn-property-light: color-mix(in oklab, #009b8f 76%, var(--iwb-fg) 24%);
  --iwb-syn-property-dark: color-mix(in oklab, #009b8f 74%, var(--iwb-fg) 26%);
  --iwb-syn-property: light-dark(var(--iwb-syn-property-light), var(--iwb-syn-property-dark));
  --iwb-syn-tag-light: color-mix(in oklab, #e45c79 76%, var(--iwb-fg) 24%);
  --iwb-syn-tag-dark: color-mix(in oklab, #e45c79 74%, var(--iwb-fg) 26%);
  --iwb-syn-tag: light-dark(var(--iwb-syn-tag-light), var(--iwb-syn-tag-dark));
  --iwb-syn-heading-light: color-mix(in oklab, #6684f4 76%, var(--iwb-fg) 24%);
  --iwb-syn-heading-dark: color-mix(in oklab, #6684f4 76%, var(--iwb-fg) 24%);
  --iwb-syn-heading: light-dark(var(--iwb-syn-heading-light), var(--iwb-syn-heading-dark));
  --iwb-syn-invalid-light: color-mix(in oklab, #ee564a 76%, var(--iwb-fg) 24%);
  --iwb-syn-invalid-dark: color-mix(in oklab, #ee564a 74%, var(--iwb-fg) 26%);
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
  /* The type of the workbench (PRD-v8 TYP-01).
     The Latin faces come first and the CJK faces last: a Latin face has no
     CJK glyphs, so the browser walks the list on its own for every script.
     "Segoe UI Variable Text" is the Windows 11 face - the same design as the
     "Inter" it replaces, so the workbench looks the same on every machine.

     Inter and JetBrains Mono are not merely WISHED for any more: they ship
     with the plugin (see fonts.js), so the workbench looks the same on a
     machine that has neither of them. */
  --iwb-font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", system-ui, "Microsoft YaHei UI", "PingFang SC", "Hiragino Sans GB", sans-serif;
  --iwb-mono: "JetBrains Mono", "Cascadia Code", "SFMono-Regular", "SF Mono", Consolas, "Liberation Mono", "Courier New", monospace;
  /* The type scale (PRD-v8 TYP-03): three levels and no more. */
  --iwb-text-title: 12px;
  --iwb-text-label: 11px;
  --iwb-text-body: 13px;
  --iwb-text-mono: 12px;
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
  font-size: var(--iwb-text-body);
  line-height: 1.5;
  /* PRD-v8 TYP-02: the text of a workbench is small and dense, and the
     default rendering on Windows makes it look like it was printed on a
     dot-matrix printer. The smoothing turns the stems back into stems. */
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  /* Every number the workbench shows is a COUNT: the line number, the word
     count, the number of changes. They have to line up in a column, so they
     get tabular figures - proportional digits make a table of counters jump
     around on every update. */
  font-variant-numeric: tabular-nums;
  /* The ligatures of the code face. Cascadia Code and JetBrains Mono draw
     the "not equal", the "greater or equal" and the "arrow" of an operator
     as ONE glyph; on the code of a modern IDE that reads as "this is code",
     and it costs nothing: the face is already there. */
  font-variant-ligatures: contextual;
  /* Segoe UI Variable (Windows 11) is a variable face with an optical size
     axis: it draws itself differently for a 13px label than for a 28px
     title. The browser only uses that axis when it is told to. */
  font-optical-sizing: auto;
  user-select: none;
  -webkit-app-region: no-drag;
}
.iwb-root *, .iwb-root *::before, .iwb-root *::after { box-sizing: border-box; }
/* ── the buttons (PRD-v8 §2.3.3) ────────────────────────────────────────────
   The old buttons were flat: a hairline and a fill, nothing else, and no
   transition at all. A button that does not move and does not react reads
   as a drawing of a button, not as a button.

   The rules below give every control the three states it needs (rest, hover,
   pressed), a focus ring a keyboard user can see, and a motion small enough
   to read as "the surface answered me" rather than as an animation. */
.iwb-root button {
  font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer;
  transition: background-color var(--iwb-dur-fast) var(--iwb-ease),
    color var(--iwb-dur-fast) var(--iwb-ease),
    border-color var(--iwb-dur-fast) var(--iwb-ease),
    box-shadow var(--iwb-dur-fast) var(--iwb-ease),
    transform var(--iwb-dur-fast) var(--iwb-ease),
    opacity var(--iwb-dur-fast) var(--iwb-ease);
}
.iwb-root input, .iwb-root textarea, .iwb-root select { font: inherit; color: inherit; }
.iwb-root button:focus-visible { outline: none; box-shadow: var(--iwb-focus-ring); }
.iwb-root button:disabled { cursor: not-allowed; }

/* The icon button: a ghost until the pointer arrives. */
.iwb-iconbtn {
  width: 26px; height: 26px; border-radius: var(--iwb-radius-sm); display: inline-flex; align-items: center; justify-content: center;
  color: var(--iwb-muted);
}
.iwb-iconbtn:hover:not(:disabled) { background: var(--iwb-surface-hover); color: var(--iwb-fg); transform: translateY(-.5px); }
.iwb-iconbtn:active:not(:disabled) { background: var(--iwb-surface-active); transform: translateY(0); box-shadow: inset 0 1px 2px color-mix(in srgb, #000 22%, transparent); }
.iwb-iconbtn:disabled { opacity: .38; }
.iwb-iconbtn.iwb-on { color: var(--iwb-accent); background: var(--iwb-surface-selected); }

/* The text button: a solid that catches light. */
.iwb-textbtn {
  height: 26px; padding: 0 10px; border-radius: var(--iwb-radius-sm); display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--iwb-border); color: var(--iwb-fg);
  background: var(--iwb-sheen), var(--iwb-panel-2);
  box-shadow: var(--iwb-highlight), var(--iwb-shadow-sm);
}
.iwb-textbtn:hover:not(:disabled) {
  border-color: var(--iwb-border-strong);
  background: var(--iwb-sheen), color-mix(in srgb, var(--iwb-fg) 7%, var(--iwb-panel-2));
  transform: translateY(-.5px);
  box-shadow: var(--iwb-highlight), var(--iwb-shadow-md);
}
.iwb-textbtn:active:not(:disabled) { transform: translateY(0); box-shadow: inset 0 1px 3px color-mix(in srgb, #000 24%, transparent); }
/* The primary button sits on the brand colour, so its text is the host's
   "on brand" label - a pale brand colour would make white text unreadable. */
.iwb-textbtn.iwb-primary {
  background: var(--iwb-sheen), var(--iwb-accent);
  border-color: transparent; color: var(--iwb-on-accent);
  box-shadow: var(--iwb-highlight), 0 4px 14px var(--iwb-surface-glow), var(--iwb-shadow-sm);
}
.iwb-textbtn.iwb-primary:hover:not(:disabled) {
  background: var(--iwb-sheen), color-mix(in srgb, var(--iwb-fg) 10%, var(--iwb-accent));
  border-color: transparent;
}
.iwb-textbtn:disabled { opacity: .42; }
.iwb-textbtn.iwb-danger { color: var(--iwb-error); }
.iwb-textbtn.iwb-danger-solid { background: var(--iwb-sheen), var(--iwb-error); color: #fff; border-color: transparent; }
.iwb-textbtn.iwb-small { height: 22px; padding: 0 8px; font-size: var(--iwb-text-label); }
.iwb-root ::-webkit-scrollbar { width: 10px; height: 10px; }
.iwb-root ::-webkit-scrollbar-thumb { background: var(--iwb-border-strong); border-radius: 6px; border: 2px solid transparent; background-clip: content-box; }
.iwb-root ::-webkit-scrollbar-thumb:hover { background: var(--iwb-muted); border: 2px solid transparent; background-clip: content-box; }
.iwb-root ::-webkit-scrollbar-track { background: transparent; }
.iwb-root ::-webkit-scrollbar-corner { background: transparent; }

.iwb-topbar {
  height: 36px; flex: 0 0 36px; display: flex; align-items: center; gap: 8px;
  padding: 0 10px; border-bottom: 1px solid var(--iwb-border); background: var(--iwb-surface-raised);
  /* The bar is the lid of the workbench: it casts a soft shadow on the body
     below it, so the body reads as "inside" and the bar as "on top". */
  box-shadow: 0 1px 0 var(--iwb-border), 0 3px 10px color-mix(in srgb, #000 16%, transparent);
  position: relative; z-index: 6;
}
.iwb-topbar button { position: relative; z-index: 7; }
.iwb-project-select {
  display: flex; align-items: center; gap: 6px; height: 26px; padding: 0 8px;
  border-radius: var(--iwb-radius-sm); max-width: 320px; min-width: 0; cursor: pointer;
  transition: background-color var(--iwb-dur-fast) var(--iwb-ease);
}
.iwb-project-select:hover { background: var(--iwb-surface-hover); }
.iwb-project-select .iwb-project-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iwb-project-select .iwb-project-path { color: var(--iwb-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iwb-branch-chip {
  display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0 9px;
  border-radius: var(--iwb-radius-pill); color: var(--iwb-muted); font-size: 11.5px;
  max-width: 240px; overflow: hidden;
  /* The chip is PART of the bar, not an object lying on it. A sheen and a
     shadow made it read as a pasted-on sticker from another layer; a tint of
     the brand colour and a hairline of its own say the same thing without
     the seam. */
  background: color-mix(in srgb, var(--iwb-accent) 11%, transparent);
  border: 1px solid color-mix(in srgb, var(--iwb-accent) 24%, transparent);
}
.iwb-branch-chip .iwb-branch-name {
  color: var(--iwb-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: var(--iwb-mono); font-size: 11px; letter-spacing: -.01em;
}
.iwb-ahead { color: var(--iwb-success); font-variant-numeric: tabular-nums; }
.iwb-behind { color: var(--iwb-warn); font-variant-numeric: tabular-nums; }
/* The badge is a button (PUSH-02): it keeps the colour of the badge it
   replaces and only adds the affordance of something clickable. */
.iwb-ahead-btn { background: transparent; border: 0; padding: 0 2px; cursor: pointer; }
.iwb-ahead-btn:hover { text-decoration: underline; }
.iwb-top-spacer { flex: 1; }

.iwb-body { flex: 1; min-height: 0; display: flex; }
.iwb-stripe {
  width: 44px; flex: 0 0 44px; background: var(--iwb-sidebar); border-right: 1px solid var(--iwb-border);
  display: flex; flex-direction: column; align-items: center; padding: 6px 0; gap: 4px;
}
.iwb-stripe-spacer { flex: 1; }
.iwb-stripe-btn {
  position: relative; width: 34px; height: 34px; border-radius: var(--iwb-radius-md); display: flex; align-items: center; justify-content: center;
  color: var(--iwb-muted);
}
.iwb-stripe-btn:hover { background: var(--iwb-surface-hover); color: var(--iwb-fg); transform: translateY(-.5px); }
.iwb-stripe-btn:active { transform: translateY(0); background: var(--iwb-surface-active); }
.iwb-stripe-btn.iwb-on { color: var(--iwb-accent); background: var(--iwb-surface-selected); box-shadow: 0 0 0 1px var(--iwb-surface-glow); }
.iwb-stripe-btn.iwb-on::before {
  content: ''; position: absolute; left: -6px; top: 8px; bottom: 8px; width: 2px; border-radius: 2px; background: var(--iwb-accent);
}
/* The badge counts something on the brand colour: its text is the colour of
   the surface underneath the badge, so the number stays readable in both
   themes. */
.iwb-badge {
  position: absolute; top: 2px; right: 1px; min-width: 15px; height: 15px; padding: 0 4px;
  border-radius: 999px; background: var(--iwb-accent); color: var(--iwb-on-accent); font-size: 10px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center; line-height: 1;
}
.iwb-badge.iwb-badge-dirty { background: var(--iwb-success); }

.iwb-left {
  position: relative; flex: 0 0 auto; width: var(--iwb-left-width, 300px);
  min-width: 200px; max-width: 640px; display: flex; flex-direction: column;
  background: var(--iwb-surface-raised); border-right: 1px solid var(--iwb-border);
}
.iwb-left-resizer {
  position: absolute; top: 0; right: -3px; bottom: 0; width: 6px; cursor: col-resize; z-index: 5;
}
.iwb-left-resizer:hover { background: color-mix(in srgb, var(--iwb-accent) 25%, transparent); }
.iwb-panel-header {
  height: 32px; flex: 0 0 32px; display: flex; align-items: center; gap: 6px; padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--iwb-border); background: var(--iwb-surface-raised);
}
/* The title of a tool window: small, spaced out, and a step quieter than the
   content below it. It is a LABEL, not a heading - the hierarchy of the
   window is carried by the content, not by the bar. */
.iwb-panel-title {
  font-size: var(--iwb-text-title); font-weight: 600; letter-spacing: .06em;
  text-transform: uppercase; color: var(--iwb-muted);
}
.iwb-panel-sub { color: var(--iwb-muted); font-size: 11px; }
.iwb-project-sub-btn {
  display: flex; align-items: center; gap: 4px; min-width: 0; max-width: 64%; padding: 2px 5px;
  border-radius: 5px; color: var(--iwb-muted); font-size: 11px; text-align: left;
}
.iwb-project-sub-btn:hover { background: var(--iwb-surface-hover); color: var(--iwb-fg); }
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
  background: var(--iwb-surface-raised); overflow-x: auto; overflow-y: hidden; scrollbar-width: none;
}
.iwb-tabbar::-webkit-scrollbar { height: 0; }
.iwb-tab {
  display: flex; align-items: center; gap: 6px; padding: 0 8px 0 10px; min-width: 90px; max-width: 220px;
  border-right: 1px solid var(--iwb-border); color: var(--iwb-muted); position: relative; cursor: pointer; flex: 0 0 auto;
  transition: background-color var(--iwb-dur-fast) var(--iwb-ease), color var(--iwb-dur-fast) var(--iwb-ease);
}
.iwb-tab:hover { background: var(--iwb-surface-hover); }
/* The active tab is the sheet in front of the bar: it takes the colour of
   the editor and carries a hairline of the brand colour on its top edge. */
.iwb-tab.iwb-active { background: var(--iwb-surface-base); color: var(--iwb-fg); }
.iwb-tab.iwb-active::after { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 2px; background: var(--iwb-accent); box-shadow: 0 0 8px var(--iwb-surface-glow); }
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
.iwb-tab .iwb-tab-close:hover { background: var(--iwb-surface-active); color: var(--iwb-fg); }
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
.iwb-html-action:hover { color: var(--iwb-fg); background: var(--iwb-surface-active); }
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
/* The segmented control: a sunken track with the chosen segment lifted out
   of it. The old one was a hairline box with a coloured fill - the fill had
   to carry the whole meaning, and a coloured fill on a 10px label is hard to
   read. */
.iwb-seg {
  display: inline-flex; border: 1px solid var(--iwb-border); border-radius: var(--iwb-radius-sm); overflow: hidden;
  background: var(--iwb-surface-sunken); padding: 1px; gap: 1px;
}
.iwb-seg button {
  height: 22px; padding: 0 9px; font-size: 11.5px; color: var(--iwb-muted); border-radius: var(--iwb-radius-xs);
  transition: background-color var(--iwb-dur-fast) var(--iwb-ease), color var(--iwb-dur-fast) var(--iwb-ease);
}
.iwb-seg button:hover { color: var(--iwb-fg); background: var(--iwb-surface-hover); }
.iwb-seg button.iwb-on { background: var(--iwb-surface-raised); color: var(--iwb-fg); box-shadow: var(--iwb-highlight), var(--iwb-shadow-sm); }
.iwb-seg button + button { border-left: 0; }

.iwb-code {
  flex: 1; min-height: 0; overflow: auto; font-family: var(--iwb-mono); font-size: 12.5px; line-height: var(--iwb-line, 20px);
  background: var(--iwb-bg);
}
.iwb-code-inner { position: relative; min-width: 100%; }
.iwb-code-line { display: flex; align-items: flex-start; height: var(--iwb-line, 20px); white-space: pre; }
.iwb-code-line:hover { background: var(--iwb-surface-hover); }
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

/* ── PDF preview ─────────────────────────────────────────────────────────
   The document is a stack of white pages on the pane background; the bar
   above it carries the page navigation and the zoom. A narrow document pane
   drops the labels (the buttons keep their tooltips), so the controls never
   wrap inside the 30px bar. */
.iwb-pdf { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; background: var(--iwb-bg); container-type: inline-size; }
.iwb-pdf-status { align-items: center; justify-content: center; gap: 12px; padding: 32px; color: var(--iwb-muted); text-align: center; }
.iwb-pdf-status-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.iwb-pdf-hint { font-size: 11px; opacity: .8; }
.iwb-pdf-spinner {
  width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--iwb-border-strong);
  border-top-color: var(--iwb-accent); animation: iwb-pdf-spin .8s linear infinite;
}
@keyframes iwb-pdf-spin { to { transform: rotate(360deg); } }
.iwb-pdf-bar {
  height: 30px; flex: 0 0 30px; display: flex; align-items: center; gap: 4px; padding: 0 8px;
  border-bottom: 1px solid var(--iwb-border); background: var(--iwb-panel); color: var(--iwb-muted);
  font-size: 11.5px; white-space: nowrap; overflow: hidden;
}
.iwb-pdf-bar .iwb-iconbtn { width: 22px; height: 22px; flex: 0 0 auto; }
.iwb-pdf-bar .iwb-textbtn { flex: 0 0 auto; height: 22px; }
.iwb-pdf-nav { display: flex; align-items: center; gap: 1px; flex: 0 0 auto; }
.iwb-pdf-pagebox { display: flex; align-items: center; gap: 3px; font-variant-numeric: tabular-nums; }
.iwb-pdf-pageinput {
  width: 38px; height: 20px; padding: 0 3px; text-align: center; font: inherit;
  color: var(--iwb-fg); background: var(--iwb-bg); border: 1px solid var(--iwb-border);
  border-radius: 4px; font-variant-numeric: tabular-nums;
}
.iwb-pdf-pageinput:focus { outline: none; border-color: var(--iwb-accent); }
.iwb-pdf-pagecount { color: var(--iwb-muted); }
.iwb-pdf-zoom {
  height: 22px; min-width: 44px; padding: 0 4px; border-radius: 5px; color: var(--iwb-fg);
  font-variant-numeric: tabular-nums; font-size: 11px;
}
.iwb-pdf-zoom:hover { background: var(--iwb-surface-active); }
.iwb-pdf-zoom.iwb-on { color: var(--iwb-accent); }
.iwb-pdf-sep { width: 1px; height: 15px; background: var(--iwb-border); margin: 0 3px; flex: 0 0 auto; }
.iwb-pdf-grow { flex: 1 1 auto; min-width: 0; }
.iwb-pdf-size { color: var(--iwb-muted); font-variant-numeric: tabular-nums; flex: 0 0 auto; }
.iwb-pdf-fit-icon { display: none; }
.iwb-pdf-fit-label { white-space: nowrap; }
@container (max-width: 440px) {
  .iwb-pdf-size { display: none; }
  .iwb-pdf-fit-label { display: none; }
  .iwb-pdf-fit-icon { display: inline; }
}
.iwb-pdf-scroll { flex: 1; min-height: 0; min-width: 0; overflow: auto; position: relative; background: var(--iwb-panel); }
.iwb-pdf-scroll:focus { outline: none; }
.iwb-pdf-pages { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 16px; min-height: 100%; box-sizing: border-box; }
.iwb-pdf-page {
  position: relative; flex: 0 0 auto; overflow: hidden; background: #fff; border-radius: 2px;
  box-shadow: 0 2px 16px rgba(0, 0, 0, .30);
}
.iwb-pdf-canvas { display: block; width: 100%; height: 100%; }
.iwb-pdf-placeholder {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: #9aa3af; font-size: 11px; font-variant-numeric: tabular-nums;
}

/* ── image preview ───────────────────────────────────────────────────────
   The picture sits on a surface that clips it: the wheel zooms it around
   the centre of the view, the left button drags it, a double click resets
   it. The zoom is a transform, so a change never relayouts the picture -
   the surface only has to be repainted. */
.iwb-image { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; background: var(--iwb-bg); }
.iwb-image-surface {
  flex: 1; min-height: 0; min-width: 0; position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  background: var(--iwb-bg); cursor: grab; touch-action: none;
  /* The picture is dragged by the surface: the browser must not start a
     native drag of it, and the pointer must not select the text around it. */
  user-select: none; -webkit-user-drag: none;
}
.iwb-image-surface[data-dragging='true'] { cursor: grabbing; }
.iwb-image-img {
  display: block; width: auto; height: auto; max-width: 92%; max-height: 82%;
  transform-origin: center center; border-radius: 6px; border: 1px solid var(--iwb-border);
  user-select: none; -webkit-user-drag: none;
}
.iwb-image-caption {
  flex: 0 0 auto; padding: 5px 12px; border-top: 1px solid var(--iwb-border);
  background: var(--iwb-panel); color: var(--iwb-muted); font-size: 11.5px;
  text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
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
.iwb-outline-item:hover { background: var(--iwb-surface-active); }
.iwb-outline-item.iwb-active { background: var(--iwb-surface-selected); color: var(--iwb-accent); }
.iwb-outline-empty { padding: 14px; color: var(--iwb-muted); font-size: 11.5px; text-align: center; }

/* ── the empty state (PRD-v8) ───────────────────────────────────────────────
   The empty workbench used to read like a README: a title, a sentence and
   four rows of shortcut. It is now the FRONT DOOR of the workbench - a mark,
   one sentence, and the four tool windows as CARDS you can walk into.

   The mark sits in a plate of its own and a soft glow sits behind it: the
   window is empty, and an empty window that is flat reads as "nothing is
   here" instead of "nothing is open YET". */
.iwb-welcome {
  flex: 1; min-height: 0; display: flex; overflow: auto; padding: 28px 32px;
  position: relative;
}
.iwb-welcome::before {
  content: ''; position: absolute; left: 50%; top: 32%; pointer-events: none;
  width: 560px; height: 340px; transform: translate(-50%, -50%);
  background: radial-gradient(ellipse at center, color-mix(in srgb, var(--iwb-accent) 15%, transparent), transparent 68%);
}
/* The card is centred by its OWN margins, not by the alignment of the
   parent: a centred flex child that does not fit is clipped at the TOP, and
   the mark - the first thing the reader sees - is what disappears. With the
   margins the card is centred when there is room and starts at the top when
   there is not. */
.iwb-welcome-card {
  position: relative; margin: auto; max-width: 680px; width: 100%;
  display: flex; flex-direction: column; align-items: center; text-align: center;
}
.iwb-welcome-mark {
  display: inline-flex; align-items: center; justify-content: center;
  width: 72px; height: 72px; margin-bottom: 20px; border-radius: 22px;
  color: var(--iwb-accent);
  background: var(--iwb-sheen), var(--iwb-surface-raised);
  border: 1px solid var(--iwb-border);
  box-shadow: var(--iwb-highlight), var(--iwb-shadow-md), 0 0 0 6px color-mix(in srgb, var(--iwb-accent) 8%, transparent);
}
.iwb-welcome-title {
  margin: 0 0 8px; font-size: 26px; font-weight: 650; letter-spacing: -.02em; line-height: 1.15;
}
.iwb-welcome-sub {
  margin: 0 0 26px; color: var(--iwb-muted); font-size: 13px; line-height: 1.6; max-width: 46ch;
}
.iwb-welcome-grid {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px;
  width: 100%; margin-bottom: 22px;
}
/* A card, not a row: the four windows are the doors of the workbench, and a
   door has a face you can read at a glance. */
.iwb-welcome-action {
  display: flex; flex-direction: column; align-items: flex-start; gap: 10px;
  padding: 14px 14px 12px; border-radius: var(--iwb-radius-lg);
  border: 1px solid var(--iwb-border); background: var(--iwb-surface-raised);
  color: var(--iwb-fg); text-align: left;
  box-shadow: var(--iwb-highlight), var(--iwb-shadow-sm);
  transition: border-color var(--iwb-dur-fast) var(--iwb-ease), background-color var(--iwb-dur-fast) var(--iwb-ease), transform var(--iwb-dur-fast) var(--iwb-ease), box-shadow var(--iwb-dur-fast) var(--iwb-ease);
}
.iwb-welcome-action:hover {
  border-color: color-mix(in srgb, var(--iwb-accent) 42%, var(--iwb-border));
  background: var(--iwb-panel-2);
  transform: translateY(-2px); box-shadow: var(--iwb-highlight), var(--iwb-shadow-md);
}
.iwb-welcome-action-icon { color: var(--iwb-accent); display: inline-flex; }
.iwb-welcome-action-name { font-size: 13px; font-weight: 600; letter-spacing: .01em; }
.iwb-welcome-action-key {
  font-family: var(--iwb-mono); font-size: 10.5px; color: var(--iwb-muted); letter-spacing: .02em;
}
.iwb-welcome-meta {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center;
  color: var(--iwb-muted); font-size: 12px; border-top: 1px solid var(--iwb-border);
  padding-top: 16px; width: 100%;
}
.iwb-welcome-meta-label { color: var(--iwb-muted); }
.iwb-welcome-meta-label::after { content: ' ·'; margin-left: 6px; color: var(--iwb-muted); opacity: .6; }
.iwb-welcome-meta-value { font-family: var(--iwb-mono); color: var(--iwb-fg); }
.iwb-welcome-meta-path { font-family: var(--iwb-mono); font-size: 11.5px; opacity: .8; }
.iwb-welcome-hint { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 16px; padding: 8px 10px; border: 1px solid var(--iwb-border); border-radius: var(--iwb-radius-md); color: var(--iwb-muted); font-size: 12px; }
.iwb-commit-hint { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 7px 10px; border-bottom: 1px solid var(--iwb-border); color: var(--iwb-muted); font-size: 11.5px; background: var(--iwb-panel-2); }
/* The key cap: a chip that is PRESSED INTO the surface, not a little 3D
   key drawn with a fat bottom border - that border was the most "retro"
   detail of the old workbench. */
.iwb-kbd {
  display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border-radius: var(--iwb-radius-xs);
  border: 1px solid var(--iwb-border); background: var(--iwb-surface-sunken);
  box-shadow: inset 0 1px 2px color-mix(in srgb, #000 18%, transparent);
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
.iwb-bottom-resizer:hover { background: color-mix(in srgb, var(--iwb-accent) 22%, transparent); }
.iwb-bottom-tabs {
  height: 30px; flex: 0 0 30px; display: flex; align-items: stretch; gap: 2px; padding: 0 8px 0 44px;
  border-bottom: 1px solid var(--iwb-border); background: var(--iwb-panel);
}
.iwb-bottom-tab {
  display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; border-radius: 6px 6px 0 0;
  color: var(--iwb-muted); font-size: 12px; border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.iwb-bottom-tab:hover { color: var(--iwb-fg); background: var(--iwb-surface-hover); }
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
  background: var(--iwb-surface-hover); color: var(--iwb-fg);
}
.iwb-bottom-tabs .iwb-dock-repo:hover:not(:disabled) {
  border-color: var(--iwb-border-strong); background: var(--iwb-surface-active);
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
  box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 5%, transparent);
}
.iwb-statusbar .iwb-spacer { flex: 1; }
.iwb-status-item { display: inline-flex; align-items: center; gap: 4px; }
.iwb-status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--iwb-success); }
.iwb-status-dot.iwb-busy { background: var(--iwb-warn); }
/* A narrow pane only has room for the dot: the label folds away. */

.iwb-tree {
  /* The padding on top of the scroll container. The frozen bar has to cover
     it, so the value lives in a variable that both rules use. */
  --iwb-tree-pad-top: 4px;
  padding: var(--iwb-tree-pad-top) 0 12px; font-size: 12.5px;
}
.iwb-tree-row {
  display: flex; align-items: center; gap: 5px; height: 22px; padding-right: 8px; white-space: nowrap;
  cursor: pointer; position: relative;
}
.iwb-tree-row:hover { background: var(--iwb-surface-hover); }
/* The selected row is marked by a hairline of the brand colour on its left
   edge, not only by a tint: a tint alone is easy to lose in a long list. */
.iwb-tree-row.iwb-selected { background: var(--iwb-surface-selected); box-shadow: inset 2px 0 0 var(--iwb-accent); }
.iwb-tree:focus { outline: none; }
.iwb-tree:focus-visible { outline: 1px solid color-mix(in srgb, var(--iwb-accent) 35%, transparent); outline-offset: -1px; }
.iwb-tree-twisty { width: 16px; flex: 0 0 16px; display: inline-flex; align-items: center; justify-content: center; color: var(--iwb-muted); }
/* Only a directory twisty is a control; a file row keeps an empty spacer, so
   the pointer is limited to the rows that can actually be toggled. */
.iwb-tree-twisty.iwb-tree-twisty-click,
.iwb-tree-row:has(> .iwb-tree-name.iwb-dir) > .iwb-tree-twisty { cursor: pointer; border-radius: 3px; }
.iwb-tree-twisty.iwb-tree-twisty-click:hover,
.iwb-tree-row:has(> .iwb-tree-name.iwb-dir) > .iwb-tree-twisty:hover { color: var(--iwb-fg); background: var(--iwb-surface-active); }
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
.iwb-tree-row.iwb-drop-target { outline: 1px solid var(--iwb-accent); outline-offset: -1px; background: var(--iwb-surface-selected-soft); }
.iwb-rename-input {
  flex: 1; min-width: 0; height: 18px; padding: 0 4px; border: 1px solid var(--iwb-accent); border-radius: 3px;
  background: var(--iwb-panel-2); color: var(--iwb-fg); font-size: 12px; outline: none;
}
.iwb-tree-msg { color: var(--iwb-muted); font-style: italic; padding: 2px 8px 2px 30px; font-size: 11.5px; }
.iwb-vlist { position: relative; }
.iwb-vlist-row { position: absolute; left: 0; right: 0; height: 22px; }

/* ── the frozen "current folder" bar (R4) ───────────────────────────────────
   The tree rows are absolutely positioned (the tree is virtualised), so CSS
   position:sticky cannot hold a row in place: the bar is a layer of its
   own inside the scrolling body and carries the chain of folders the
   viewport sits in - from the project root down to the current one.
   It is a navigation bar, not a tree row - it never joins the selection, and
   it is hidden entirely in the flat quick-file list (there is no hierarchy
   there to point at). */
.iwb-tree-sticky {
  position: sticky;
  /* The scroll container of the tree has a padding on top, and a sticky
     element stops at the edge of that padding - so the bar would float a few
     pixels below the panel header, with a gap between them. The offset lifts
     the bar over that padding, so it sits flush against the header. */
  top: calc(-1 * var(--iwb-tree-pad-top, 4px));
  z-index: 3;
  display: flex; align-items: center; gap: 4px;
  /* The bar is a layer on top of the tree: it must not push the rows down
     when it appears, or the tree would jump on every scroll step. It is one
     row taller than a row, because it now also covers the padding of the
     scroll container - its own padding keeps the text on the line of the
     rows. */
  height: calc(22px + var(--iwb-tree-pad-top, 4px));
  padding: var(--iwb-tree-pad-top, 4px) 8px 0 12px;
  margin: 0 0 calc(-22px - var(--iwb-tree-pad-top, 4px));
  background: var(--iwb-panel); border-bottom: 1px solid var(--iwb-border);
  font-size: 12px; color: var(--iwb-muted); white-space: nowrap; overflow: hidden;
}
/* Every step of the chain is a link; the last one is the folder the viewport
   is in, and it never shrinks away. */
.iwb-tree-sticky-item {
  flex: 0 1 auto; min-width: 0;
  color: var(--iwb-fg); font-weight: 500; padding: 0 4px; border-radius: 4px;
  overflow: hidden; text-overflow: ellipsis; cursor: pointer;
}
.iwb-tree-sticky-item:last-child { flex: 0 0 auto; font-weight: 600; }
.iwb-tree-sticky-item:hover { color: var(--iwb-accent); background: var(--iwb-surface-active); }
.iwb-tree-sticky-sep { opacity: .55; flex: 0 0 auto; }

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

/* The menu floats over the workbench: it has to look like it is ABOVE the
   page, not painted on it. A soft ambient shadow and a hairline of light on
   its top edge do that - a hard border alone reads as a panel. */
.iwb-menu {
  position: fixed; z-index: 40; padding: 4px; border-radius: var(--iwb-radius-md);
  border: 1px solid var(--iwb-border-strong); background: var(--iwb-surface-overlay);
  box-shadow: var(--iwb-highlight), var(--iwb-shadow-lg);
  max-height: calc(100vh - 12px); overflow-y: auto; overflow-x: hidden;
}
.iwb-menu-sub { z-index: 41; }
.iwb-menu .iwb-menu-item {
  display: flex; align-items: center; gap: 6px; width: 100%; padding: 5px 6px 5px 4px; border-radius: var(--iwb-radius-xs);
  text-align: left; font-size: 12px; color: var(--iwb-fg); white-space: nowrap;
}
.iwb-menu .iwb-menu-item:hover:not(:disabled) { background: var(--iwb-surface-active); }
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
/* An input is a well the text sits in: it is SUNKEN, not painted on the
   surface - a soft inner shadow at the top says "this is below the page".
   The focus ring is the brand colour, so the field that is being typed into
   is the one that glows. */
.iwb-field input, .iwb-field select {
  height: 30px; padding: 0 9px; border-radius: var(--iwb-radius-sm); border: 1px solid var(--iwb-border);
  background: var(--iwb-panel-2); color: var(--iwb-fg); font-size: 12.5px; outline: none;
  box-shadow: inset 0 1px 2px color-mix(in srgb, #000 16%, transparent);
  transition: border-color var(--iwb-dur-fast) var(--iwb-ease), box-shadow var(--iwb-dur-fast) var(--iwb-ease);
}
.iwb-field input:focus, .iwb-field select:focus {
  border-color: var(--iwb-accent);
  box-shadow: inset 0 1px 2px color-mix(in srgb, #000 16%, transparent), 0 0 0 3px var(--iwb-surface-glow);
}

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
  min-width: 16px; height: 16px; padding: 0 5px; border-radius: 999px; background: var(--iwb-surface-active);
  color: var(--iwb-fg); font-size: 10px; display: inline-flex; align-items: center; justify-content: center;
}
.iwb-group-header .iwb-spacer { flex: 1; }
.iwb-file-row {
  display: flex; align-items: center; gap: 6px; height: 23px; padding: 0 8px 0 12px; cursor: pointer; font-size: 12px;
}
.iwb-file-row:hover { background: var(--iwb-surface-hover); }
.iwb-file-row.iwb-active { background: var(--iwb-surface-selected); }
.iwb-file-row.iwb-selected { background: var(--iwb-surface-selected); box-shadow: inset 2px 0 0 var(--iwb-accent); }
.iwb-file-row.iwb-file-untracked .iwb-file-name { color: var(--iwb-git-untracked); }
.iwb-file-row.iwb-file-conflict .iwb-file-name { color: var(--iwb-git-conflict); font-weight: 600; }
.iwb-file-row .iwb-file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iwb-file-row .iwb-file-dir { color: var(--iwb-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iwb-file-row .iwb-file-status { color: var(--iwb-muted); font-size: 10px; width: 12px; text-align: center; font-family: var(--iwb-mono); }
.iwb-group-empty { padding: 8px 12px; color: var(--iwb-muted); font-size: 11.5px; font-style: italic; }
.iwb-commit-toolbar { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-top: 1px solid var(--iwb-border); border-bottom: 1px solid var(--iwb-border); }
.iwb-changelist-head { height: 24px; display: flex; align-items: center; gap: 6px; padding: 0 10px; color: var(--iwb-muted); font-size: 11px; background: var(--iwb-surface-hover); }
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
.iwb-diff-row.iwb-selected { outline: 1px solid color-mix(in srgb, var(--iwb-accent) 55%, transparent); background: color-mix(in srgb, var(--iwb-accent) 22%, transparent) !important; }
.iwb-diff-row.iwb-diff-find, .iwb-diff-side.iwb-diff-find { outline: 1px solid rgba(215,162,74,.65); outline-offset: -1px; }
.iwb-diff-row.iwb-diff-find-active, .iwb-diff-side.iwb-diff-find-active { outline: 2px solid var(--iwb-accent); outline-offset: -2px; background: var(--iwb-surface-selected); }
.iwb-word-add { background: rgba(79, 180, 119, .38); border-radius: 2px; }
.iwb-word-del { background: rgba(226, 104, 111, .38); border-radius: 2px; }
.iwb-diff-hunk { display: flex; align-items: center; height: 22px; background: var(--iwb-surface-hover); color: var(--iwb-muted); font-size: 11.5px; }
.iwb-diff-collapsed {
  display: flex; align-items: center; justify-content: center; height: 20px; cursor: pointer;
  color: var(--iwb-muted); font-size: 11px; background: var(--iwb-surface-hover);
  border-top: 1px dashed var(--iwb-border); border-bottom: 1px dashed var(--iwb-border);
}
.iwb-diff-collapsed:hover { color: var(--iwb-fg); background: var(--iwb-surface-active); }
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
.iwb-diff-side-cell.iwb-blank { background: var(--iwb-surface-hover); }
.iwb-diff-side .iwb-diff-num { width: 44px; flex: 0 0 44px; }
.iwb-diff-side-head { display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; color: var(--iwb-muted); font-size: 11px; background: var(--iwb-panel); border-bottom: 1px solid var(--iwb-border); }
.iwb-binary { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--iwb-muted); }

.iwb-git { display: flex; flex-direction: column; height: 100%; min-height: 0; flex: 1 1 auto; width: 100%; min-width: 0; }
/* The filter row reads as TWO clusters (PRD-v8): the SCOPE says WHERE the
   history comes from (which repository, which branch), the FILTERS say what
   of it is shown. One strip of six unrelated controls told the reader
   nothing about which was which. */
.iwb-git-filters {
  display: flex; align-items: center; gap: 10px; padding: 7px 10px;
  border-bottom: 1px solid var(--iwb-border); flex-wrap: wrap;
}
.iwb-git-scope {
  display: flex; align-items: center; gap: 6px; flex: 0 0 auto;
  padding-right: 10px; border-right: 1px solid var(--iwb-border);
}
.iwb-git-filter-fields {
  display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 0;
}
/* The scope control is a segmented switch: it names both options and marks
   the chosen one, so it can never be mistaken for a label. */
.iwb-git-scope .iwb-seg { flex: 0 0 auto; }
.iwb-git-scope .iwb-seg button { white-space: nowrap; }
.iwb-path-chip {
  display: inline-flex; align-items: center; gap: 4px; max-width: 260px; height: 22px; padding: 0 4px 0 8px;
  border: 1px solid var(--iwb-border-strong); border-radius: 999px; background: var(--iwb-panel-2);
  color: var(--iwb-fg); font-size: 11px;
}
.iwb-path-chip-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--iwb-mono); }
.iwb-path-chip-clear { width: 16px; height: 16px; border-radius: 50%; color: var(--iwb-muted); font-size: 13px; line-height: 1; }
.iwb-path-chip-clear:hover { background: var(--iwb-surface-active); color: var(--iwb-fg); }
.iwb-select, .iwb-input {
  height: 24px; border-radius: 5px; border: 1px solid var(--iwb-border); background: var(--iwb-panel-2);
  padding: 0 7px; font-size: 11.5px; outline: none; color: var(--iwb-fg);
}
.iwb-input { width: 150px; }
/* A field that is greyed until the user clicks into it. It must stay
   focusable, so it is readOnly and never disabled - a disabled input
   cannot take the focus, and the click would do nothing at all. The class
   stands on its own: the path box must not carry .iwb-input, whose fixed
   width would shrink it. */
.iwb-input-readonly { opacity: .6; cursor: text; }
.iwb-input-readonly:focus { opacity: 1; }
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
.iwb-git-row:hover { background: var(--iwb-surface-hover); }
.iwb-git-row.iwb-selected { background: var(--iwb-surface-selected); }
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
.iwb-git-file:hover { background: var(--iwb-surface-active); }
.iwb-git-file-name { font-family: var(--iwb-mono); }

.iwb-term { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.iwb-term-tabs { display: flex; align-items: center; gap: 2px; padding: 3px 6px; border-bottom: 1px solid var(--iwb-border); overflow-x: auto; }
.iwb-term-tab {
  display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: 5px;
  color: var(--iwb-muted); font-size: 11.5px; cursor: pointer; white-space: nowrap;
}
.iwb-term-tab:hover { background: var(--iwb-surface-hover); }
.iwb-term-tab.iwb-on { color: var(--iwb-fg); background: var(--iwb-surface-selected); }
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
/* ── the turn change preview (R2) ──────────────────────────────────────────
   The review of one conversation turn: the changed files on the left, the
   diff of the selected file on the right. */
.iwb-review { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.iwb-review-files {
  flex: 0 0 240px; overflow: auto; border-right: 1px solid var(--iwb-border);
  background: var(--iwb-panel);
}
.iwb-review-file { display: flex; align-items: center; gap: 6px; }

/* ── the IME composition preview of the terminal (R9) ──────────────────────
   xterm draws the composing text of the input method into a DOM element and
   ships it with a hard-coded black background and white text - a black box on
   a light terminal. The terminal paints on a canvas, so the colours cannot
   come from a token of this stylesheet: the panel pushes them into the custom
   properties below (--iwb-term-bg / --iwb-term-fg). Only the colours change
   here - xterm positions the box with inline styles and the candidate window
   of the input method is placed from its bounding box, so its geometry
   (display, position, padding) must not be touched. */
.iwb-term-host .xterm .composition-view {
  background: var(--iwb-term-bg, var(--iwb-panel-2));
  color: var(--iwb-term-fg, var(--iwb-fg));
  border-radius: 3px;
}
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
  padding: 0;
  color: var(--iwb-fg);
  font-family: var(--iwb-font);
  font-size: var(--iwb-text-body);
  line-height: 1.45;
  /* The component tokens of the page. They are built from the semantic
     tokens of the theme - the page never names a colour or a length of its
     own (design-system: primitive -> semantic -> component). */
  --iwb-settings-header-height: 96px;
  --iwb-settings-row-pad: var(--iwb-space-3);
  --iwb-settings-row-gap: var(--iwb-space-4);
  --iwb-settings-group-gap: var(--iwb-space-5);
  --iwb-settings-read-measure: 65ch;
  /* The height of the panel of the rows. It is a height and not a minimum:
     the window must not change its size when another category is picked. */
  --iwb-settings-panel-height: min(50vh, 520px);
}
.iwb-settings-compact {
  --iwb-settings-row-pad: var(--iwb-space-2);
  --iwb-settings-row-gap: var(--iwb-space-3);
  --iwb-settings-group-gap: var(--iwb-space-4);
  --iwb-settings-panel-height: min(44vh, 420px);
}
.iwb-settings *, .iwb-settings *::before, .iwb-settings *::after { box-sizing: border-box; }
.iwb-settings :where(button, input, select) { font: inherit; color: inherit; }
.iwb-settings :where(button) { background: none; border: 0; padding: 0; cursor: pointer; }
.iwb-settings-group { margin: 0; }
.iwb-settings-group + .iwb-settings-group {
  margin-top: var(--iwb-settings-group-gap);
  padding-top: var(--iwb-space-4);
  border-top: 1px solid var(--iwb-divider);
}
.iwb-settings-group-title {
  margin: 0; color: var(--iwb-fg); font-size: var(--iwb-text-title); font-weight: 600;
  line-height: 1.6; letter-spacing: 0; text-transform: none;
}
.iwb-settings-group-desc {
  margin: 2px 0 0; max-width: var(--iwb-settings-read-measure);
  color: var(--iwb-muted); font-size: var(--iwb-text-label); line-height: 1.5;
}
.iwb-settings-rows { display: flex; flex-direction: column; margin-top: var(--iwb-space-1); }
/* The row is a grid, not a fixed-height box: the height of a row follows its
   content, so a long explanation is never cut off (ui-ux-pro-max: text
   reflow and spacing - the line height is content driven). */
.iwb-settings-row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start;
  gap: 2px var(--iwb-settings-row-gap);
  padding: var(--iwb-settings-row-pad) 0;
  border-bottom: .5px solid var(--iwb-divider);
  scroll-margin-top: var(--iwb-settings-header-height);
}
.iwb-settings-rows > .iwb-settings-row:last-child { border-bottom: 0; }
.iwb-settings-row-failed { border-left: 2px solid var(--iwb-error); padding-left: var(--iwb-space-2); }
.iwb-settings-label { grid-column: 1; min-width: 0; }
.iwb-settings-title {
  display: inline-block; color: var(--iwb-fg); font-size: var(--iwb-text-body);
  line-height: 1.55; cursor: default;
}
/* The explanation is the description of the control. Its measure is bounded
   in characters, not in pixels, so it reflows with the width of the page. */
.iwb-settings-hint {
  margin-top: 2px; max-width: var(--iwb-settings-read-measure);
  color: var(--iwb-muted); font-size: var(--iwb-text-label); line-height: 1.5;
}
.iwb-settings-control {
  grid-column: 2; grid-row: 1; justify-self: end;
  display: flex; align-items: center; justify-content: flex-end; gap: var(--iwb-space-2);
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
.iwb-settings-saved { margin-left: auto; color: var(--iwb-success); font-size: var(--iwb-text-label); }
.iwb-settings-saved-failed { color: var(--iwb-error); }

/* ── the header of the page ───────────────────────────────────────────────
   The filter comes first (the workspace design system asks for a prominent
   search bar) and it sticks to the top of the scroll container, so it is
   always at hand while the user looks for a setting. */
.iwb-settings-header {
  position: sticky; top: 0; z-index: 3;
  display: flex; flex-direction: column; gap: var(--iwb-space-2);
  padding: var(--iwb-space-3) 0 var(--iwb-space-2);
  background: var(--iwb-bg);
  border-bottom: 1px solid var(--iwb-divider);
}
.iwb-settings-search { display: flex; align-items: center; gap: var(--iwb-space-2); }
.iwb-settings-filter {
  flex: 1 1 auto; min-width: 0; height: 32px; padding: 0 10px;
  color: var(--iwb-fg); background: var(--iwb-bg);
  border: 1px solid var(--iwb-border-strong); border-radius: var(--iwb-radius-sm);
  font-size: var(--iwb-text-body); outline: none;
  transition: border-color var(--iwb-dur-fast) var(--iwb-ease), box-shadow var(--iwb-dur-fast) var(--iwb-ease);
}
.iwb-settings-filter::placeholder { color: var(--iwb-muted); }
.iwb-settings-filter:hover { border-color: var(--iwb-muted); }
.iwb-settings-filter:focus-visible { border-color: var(--iwb-accent); box-shadow: 0 0 0 1px var(--iwb-accent); }
.iwb-settings-count {
  flex: 0 0 auto; color: var(--iwb-muted); font-size: var(--iwb-text-label);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.iwb-settings-header-row { display: flex; align-items: center; gap: var(--iwb-space-2); }
.iwb-settings-header-row .iwb-settings-search { flex: 1 1 auto; min-width: 0; }
/* The reset is a destructive action: its label never wraps (a wrapped button
   reads as two words), and it never shrinks. */
.iwb-settings-header-row .iwb-settings-reset,
.iwb-settings-header-row .iwb-textbtn { flex: 0 0 auto; white-space: nowrap; }
/* The category bar is ONE row that SCROLLS. Ten chips wrapped into a pile
   read as noise in a narrow sidebar, and a chip that is cropped away is a
   category the user cannot find - so the bar is dragged instead of wrapped
   (the chips keep their own room, and the bar scrolls sideways). */
.iwb-settings-tabs {
  display: flex; flex-wrap: nowrap; gap: var(--iwb-space-2);
  flex: 1 1 auto; min-width: 0;
  overflow-x: auto; overflow-y: hidden;
  padding-bottom: var(--iwb-space-1);
  scrollbar-width: thin;
  scrollbar-color: var(--iwb-border-strong) transparent;
}
.iwb-settings-tabs::-webkit-scrollbar { height: 6px; }
.iwb-settings-tabs::-webkit-scrollbar-track { background: transparent; }
.iwb-settings-tabs::-webkit-scrollbar-thumb {
  background: var(--iwb-border-strong); border-radius: 3px;
}
.iwb-settings-tabs::-webkit-scrollbar-thumb:hover { background: var(--iwb-muted); }
/* A chip has room of its own: a category is a place, not a word in a list. */
.iwb-settings-tab {
  display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto;
  height: 32px; padding: 0 14px;
  border: 1px solid var(--iwb-border); border-radius: var(--iwb-radius-sm);
  color: var(--iwb-muted); background: var(--iwb-panel-2);
  font-size: var(--iwb-text-body);
  white-space: nowrap;
  transition: color var(--iwb-dur-fast) var(--iwb-ease), background var(--iwb-dur-fast) var(--iwb-ease), border-color var(--iwb-dur-fast) var(--iwb-ease);
}
.iwb-settings-tab:hover { color: var(--iwb-fg); background: var(--iwb-surface-hover); }
.iwb-settings-tab:focus-visible { outline: 2px solid var(--iwb-accent); outline-offset: 2px; }
.iwb-settings-tab[aria-selected="true"] {
  color: var(--iwb-fg); background: var(--iwb-surface-selected); border-color: var(--iwb-accent);
  font-weight: 600;
}
.iwb-settings-tab-count { color: var(--iwb-muted); font-size: var(--iwb-text-label); font-variant-numeric: tabular-nums; }
.iwb-settings-tab[aria-selected="true"] .iwb-settings-tab-count { color: var(--iwb-fg); }
/* The panel has a HEIGHT, not a minimum: the categories hold a different
   number of rows, and a panel that follows its content makes the whole
   window jump every time another category is picked. The rows scroll
   inside the panel instead. */
.iwb-settings-panel {
  height: var(--iwb-settings-panel-height);
  overflow-y: auto; overscroll-behavior: contain;
  padding-bottom: var(--iwb-space-4); scroll-margin-top: var(--iwb-settings-header-height);
}
.iwb-settings-panel:focus-visible { outline: 2px solid var(--iwb-accent); outline-offset: 2px; }

/* The honest states of a row. The colour is the only thing that changes, and
   it is a state colour of the theme - the page itself stays quiet. */
.iwb-settings-badges { display: flex; flex-wrap: wrap; align-items: center; gap: var(--iwb-space-1); margin-top: 4px; }
.iwb-settings-badge {
  display: inline-flex; align-items: center; height: 18px; padding: 0 6px;
  border: 1px solid var(--iwb-border); border-radius: var(--iwb-radius-xs);
  color: var(--iwb-muted); background: var(--iwb-panel-2);
  font-size: 10.5px; line-height: 1; white-space: nowrap;
}
.iwb-settings-badge-changed { color: var(--iwb-accent); }
.iwb-settings-badge-deferred { color: var(--iwb-warn); }
.iwb-settings-badge-danger { color: var(--iwb-error); }
.iwb-settings-badge-failed { color: var(--iwb-error); }
.iwb-settings-reset-row {
  height: 18px; padding: 0 6px; border: 1px solid var(--iwb-border);
  border-radius: var(--iwb-radius-xs); color: var(--iwb-muted); background: transparent;
  font-size: 10.5px; line-height: 1; white-space: nowrap;
  transition: color var(--iwb-dur-fast) var(--iwb-ease), border-color var(--iwb-dur-fast) var(--iwb-ease);
}
.iwb-settings-reset-row:hover { color: var(--iwb-fg); border-color: var(--iwb-muted); }
.iwb-settings-reset-row:focus-visible { outline: 2px solid var(--iwb-accent); outline-offset: 1px; }
.iwb-settings-reset-confirm {
  display: inline-flex; align-items: center; gap: var(--iwb-space-1); flex: 0 0 auto;
  color: var(--iwb-warn); font-size: var(--iwb-text-label); white-space: nowrap;
}

/* The empty state of the filter is a dead end only when it says nothing: it
   names the word that found nothing, it says what to try, and it offers the
   way out (ui-ux-pro-max: no results - a dead end is not an answer). */
.iwb-settings-empty { padding: var(--iwb-space-5) 0; text-align: center; }
.iwb-settings-empty-title { margin: 0; color: var(--iwb-fg); font-size: var(--iwb-text-body); }
.iwb-settings-empty-query {
  padding: 1px 5px; border-radius: var(--iwb-radius-xs); background: var(--iwb-panel-2);
  color: var(--iwb-fg); font-family: var(--iwb-mono);
}
.iwb-settings-empty-hint { margin: var(--iwb-space-1) 0 var(--iwb-space-3); color: var(--iwb-muted); font-size: var(--iwb-text-label); }

@container iwb-settings (max-width: 560px) {
  /* A narrow page (the modal of the workbench is about 460 px wide): the
     control moves under its label, so the explanation keeps its measure and
     the row stays as tall as its content. */
  .iwb-settings-row { grid-template-columns: minmax(0, 1fr); }
  .iwb-settings-control { grid-column: 1; grid-row: auto; justify-self: start; }
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
  width: min(440px, calc(100% - 40px)); border-radius: var(--iwb-radius-lg); border: 1px solid var(--iwb-border-strong);
  background: var(--iwb-surface-overlay); box-shadow: var(--iwb-highlight), var(--iwb-shadow-lg); padding: 16px 18px;
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
/* ── the "new file / new directory" dialog ─────────────────────────────────
   The path is the CONTEXT of the entry - the folder it lands in - so it is
   read FIRST: it sits at the top of the dialog, in a frame of its own that
   sets it apart from the fields below. The name is the primary input, the
   template is the last field, the actions stay at the bottom. The rules
   live under their own class, so the settings modal and the confirmation
   keep the look they have. Every colour comes from a token, so the dialog
   follows the host theme like the rest of the workbench. */
.iwb-new-entry-modal { width: min(480px, calc(100% - 40px)); }
.iwb-new-entry-title { margin: 0 0 12px; font-size: 15px; }
/* The kind of the entry (PRD-v8 NEW-01): a switch, not a guess. The shortcut
   used to open a dialog that could only create a file, so "I wanted a
   directory" ended up as a file with a directory's name. The kind is the
   first thing the dialog says, and it can be changed without leaving it. */
.iwb-new-entry-kind {
  display: inline-flex; align-items: center; gap: 2px; margin: 0 0 14px; padding: 2px;
  border: 1px solid var(--iwb-border); border-radius: var(--iwb-radius-md);
  background: var(--iwb-surface-sunken);
}
.iwb-new-entry-kind button {
  display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 12px;
  border-radius: var(--iwb-radius-sm); color: var(--iwb-muted); font-size: 12px;
  transition: background-color var(--iwb-dur-fast) var(--iwb-ease), color var(--iwb-dur-fast) var(--iwb-ease);
}
.iwb-new-entry-kind button:hover { color: var(--iwb-fg); background: var(--iwb-surface-hover); }
.iwb-new-entry-kind button.iwb-on {
  color: var(--iwb-fg); background: var(--iwb-surface-raised);
  box-shadow: var(--iwb-highlight), var(--iwb-shadow-sm);
}
/* The frame of the target folder. */
.iwb-new-entry-path {
  display: flex; flex-direction: column; gap: 7px;
  margin: 0 0 14px; padding: 10px 12px 11px;
  border: 1px solid var(--iwb-border); border-radius: 8px; background: var(--iwb-panel);
}
.iwb-new-entry-path-box { display: flex; flex-direction: column; gap: 5px; }
/* The caption of the frame: it names the block, not the field below it. */
.iwb-new-entry-path-label {
  font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--iwb-muted);
}
/* A path is a path: the mono face tells it apart from the name below. */
.iwb-new-entry-path-input {
  width: 100%; height: 30px; padding: 0 9px; border-radius: 6px;
  border: 1px solid var(--iwb-border-strong); background: var(--iwb-panel-2);
  color: var(--iwb-fg); font-family: var(--iwb-mono); font-size: 12px; outline: none;
}
.iwb-new-entry-path-input:focus { border-color: var(--iwb-accent); }
/* The hint is secondary text: one step below the labels in size and in
   weight - it explains the box above it and never competes with a field. */
.iwb-new-entry-hint {
  font-size: 11px; font-weight: 400; line-height: 1.45;
  color: color-mix(in srgb, var(--iwb-muted) 70%, var(--iwb-panel));
}
.iwb-new-entry-modal .iwb-field { margin: 0 0 12px; }
.iwb-new-entry-modal .iwb-field input, .iwb-new-entry-modal .iwb-field select { height: 30px; font-size: 12.5px; }
/* The name is the primary input of the dialog: it gets the stronger border
   and the room it deserves. */
.iwb-new-entry-modal .iwb-new-entry-name input {
  height: 34px; font-size: 13.5px; border-color: var(--iwb-border-strong);
}
.iwb-toast {
  position: absolute; right: 14px; bottom: 34px; max-width: 420px; padding: 9px 12px; border-radius: var(--iwb-radius-md);
  border: 1px solid var(--iwb-border-strong); background: var(--iwb-surface-overlay); box-shadow: var(--iwb-highlight), var(--iwb-shadow-lg);
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
.iwb-root-item:hover { background: var(--iwb-surface-hover); }
.iwb-root-item .iwb-root-path { color: var(--iwb-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; }
.iwb-project-picker { width: min(620px, calc(100% - 40px)); max-height: min(80vh, 720px); display: flex; flex-direction: column; }
.iwb-modal-hint { color: var(--iwb-muted); font-size: 12px; margin: -2px 0 12px; }
.iwb-project-picker-list { display: flex; flex-direction: column; gap: 3px; overflow: auto; min-height: 0; margin-bottom: 12px; }
.iwb-project-group { color: var(--iwb-muted); font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; padding: 8px 4px 3px; }
.iwb-project-choice {
  display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 8px; border-radius: 7px;
  border: 1px solid transparent; text-align: left;
}
.iwb-project-choice:hover { background: var(--iwb-surface-hover); }
.iwb-project-choice.iwb-current { border-color: var(--iwb-border-strong); background: var(--iwb-surface-selected-soft); }
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
.iwb-find-btn:hover:not(:disabled) { background: var(--iwb-surface-active); color: var(--iwb-fg); }
.iwb-find-btn:disabled { opacity: .35; }
.iwb-find-flag {
  min-width: 26px; height: 22px; padding: 0 5px; border-radius: 4px; border: 1px solid transparent;
  color: var(--iwb-muted); font-family: var(--iwb-mono); font-size: 10.5px;
}
.iwb-find-flag:hover { background: var(--iwb-surface-active); color: var(--iwb-fg); }
.iwb-find-flag.iwb-on { border-color: var(--iwb-accent); color: var(--iwb-accent); background: var(--iwb-surface-selected-soft); }
.iwb-dom-findbar { position: absolute; top: 0; left: 0; right: 0; z-index: 14; box-shadow: 0 4px 12px rgba(0,0,0,.25); }
::highlight(iwb-dom-find) { background-color: rgba(215, 162, 74, .38); }
::highlight(iwb-dom-find-active) { background-color: color-mix(in srgb, var(--iwb-accent) 55%, transparent); color: inherit; }
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
.iwb-search-popup-file:hover { background: var(--iwb-surface-hover); }
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
.iwb-quick-row.iwb-selected { background: var(--iwb-surface-selected); }
.iwb-quick-name { font-size: 12.5px; white-space: nowrap; }
.iwb-quick-dir { color: var(--iwb-muted); font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iwb-quick-empty { padding: 18px; text-align: center; color: var(--iwb-muted); font-size: 12px; }
.iwb-quick-foot { padding: 6px 10px; border-top: 1px solid var(--iwb-border); color: var(--iwb-muted); font-size: 10.5px; }

/* ── Project filter modes / opened-vs-selected ───────────────────────── */
.iwb-filter-mode { display: inline-flex; border: 1px solid var(--iwb-border); border-radius: var(--iwb-radius-sm); overflow: hidden; flex: 0 0 auto; background: var(--iwb-surface-sunken); padding: 1px; gap: 1px; }
.iwb-filter-mode button { height: 20px; padding: 0 7px; color: var(--iwb-muted); font-size: 11px; border-radius: var(--iwb-radius-xs); }
.iwb-filter-mode button:hover { color: var(--iwb-fg); background: var(--iwb-surface-hover); }
.iwb-filter-mode button.iwb-on { background: var(--iwb-surface-raised); color: var(--iwb-fg); box-shadow: var(--iwb-highlight); }
.iwb-filter-mode button + button { border-left: 0; }
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
  display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 7px; border-radius: var(--iwb-radius-sm);
  border: 1px solid var(--iwb-border); color: var(--iwb-fg); font-size: 11.5px; max-width: 210px;
  white-space: nowrap;
}
.iwb-branch-switch:hover { border-color: var(--iwb-border-strong); background: var(--iwb-surface-hover); }
/* The branch of the history is the longest name in the row, and it used to
   WRAP onto a second line - which made the whole filter row taller and
   looked broken. It takes the room the second repository switcher used to
   take, and it gives the room back with an ellipsis. */
.iwb-branch-pick {
  flex: 1 1 auto; min-width: 120px; max-width: 46%;
  background: var(--iwb-surface-raised);
}
.iwb-branch-pick-name {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: var(--iwb-mono); font-size: 11.5px; letter-spacing: -.01em;
}
.iwb-branch-caret { color: var(--iwb-muted); font-size: 9px; display: inline-flex; align-items: center; }
.iwb-branch-popover {
  position: fixed; z-index: 42; width: min(340px, calc(100vw - 24px)); padding: 6px; border-radius: 8px;
  border: 1px solid var(--iwb-border-strong); background: var(--iwb-overlay);
  box-shadow: 0 14px 36px rgba(0,0,0,.4);
}
.iwb-branch-list { max-height: 280px; overflow: auto; margin-top: 5px; }
.iwb-branch-row {
  display: flex; align-items: center; gap: 6px; width: 100%; min-height: 25px; padding: 0 6px;
  border-radius: 4px; text-align: left; font-size: 12px;
}
/* The name of a branch is longer than the row. Without the ellipsis it wraps
   onto a second line, and the second line falls out of the row - onto the row
   below it, so the two names lie on top of each other. The row grows instead
   of clipping (min-height), and the name takes what is left of the row. */
.iwb-branch-row .iwb-branch-name {
  flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.iwb-branch-row.iwb-selected { background: var(--iwb-surface-selected); }
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
.iwb-git-drawer-resizer:hover { background: color-mix(in srgb, var(--iwb-accent) 28%, transparent); }
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
.iwb-git-drawer-file:hover { background: var(--iwb-surface-hover); }
.iwb-git-drawer-file.iwb-selected { background: var(--iwb-surface-selected); }
.iwb-git-drawer-file .iwb-git-file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iwb-git-drawer-file .iwb-additions, .iwb-git-drawer-file .iwb-deletions { margin-left: 0; font-size: 10px; }
/* Changed files render as a collapsible directory tree. */
.iwb-git-tree { display: flex; flex-direction: column; gap: 1px; }
.iwb-git-tree-dir {
  display: flex; align-items: center; gap: 5px; width: 100%; min-height: 23px; padding: 0 5px;
  border-radius: 4px; text-align: left; font-size: 11.5px;
}
.iwb-git-tree-dir:hover { background: var(--iwb-surface-hover); }
.iwb-git-tree-caret { width: 10px; flex: 0 0 10px; color: var(--iwb-muted); font-size: 9px; text-align: center; display: inline-flex; align-items: center; justify-content: center; }
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

/* ── code folding (R3) ──────────────────────────────────────────────────────
   CodeMirror draws the fold markers and the placeholder of a collapsed range;
   the workbench only gives them the theme's colours, so they follow the host
   theme like every other part of the editor. The class names are CodeMirror's
   own - foldGutter() installs the gutter as .cm-foldGutter. */
.cm-foldGutter { color: var(--iwb-muted); }
.cm-foldGutter .cm-gutterElement { padding: 0 2px; cursor: pointer; }
.cm-foldGutter .cm-gutterElement:hover { color: var(--iwb-fg); }
.cm-foldPlaceholder {
  color: var(--iwb-muted);
  background: color-mix(in srgb, var(--iwb-accent) 14%, transparent);
  border: none; border-radius: 3px; padding: 0 4px; margin: 0 2px; font-size: .92em;
}

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

/* ── the glass of the floating layers (PRD-v8 §2.3.5) ───────────────────────
   The layers that sit ABOVE the content become translucent: they catch the
   light on their top edge, they blur what is behind them, and they cast a
   wide, soft shadow. A browser that cannot do the blur keeps the opaque
   surface - the effect is an addition, never a requirement. */
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .iwb-menu,
  .iwb-modal,
  .iwb-toast,
  .iwb-outline,
  .iwb-html-actions {
    background: var(--iwb-glass);
    -webkit-backdrop-filter: var(--iwb-glass-blur);
    backdrop-filter: var(--iwb-glass-blur);
  }
  .iwb-menu { box-shadow: var(--iwb-glass-edge), var(--iwb-glass-shadow); }
  .iwb-modal { box-shadow: var(--iwb-glass-edge), var(--iwb-glass-shadow); }
  .iwb-toast { box-shadow: var(--iwb-glass-edge), var(--iwb-glass-shadow); }
  .iwb-outline { box-shadow: var(--iwb-glass-edge), var(--iwb-glass-shadow); }
  .iwb-html-actions { box-shadow: var(--iwb-glass-edge), var(--iwb-glass-shadow); }
}
`
