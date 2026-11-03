/**
 * Layout constants shared by the React shell and the stylesheet.
 *
 * The workbench keeps its side-by-side (left dock + bottom dock) layout down
 * to a fairly narrow pane, because a laptop's right sidebar defaults to ~45%
 * of the window and users read that as the normal IDE. Only below this width
 * does the body stack vertically and the two tool groups become exclusive.
 * Keeping the number here lets the ResizeObserver and the CSS container query
 * agree exactly.
 */
export const STACK_WIDTH = 560

/** Left dock share of the workbench width; the user's pixel width wins above it. */
export const LEFT_PANE_RATIO = 42

/**
 * The side the four tool-window entries dock on until the user picks another
 * one. The chat sits next to the code in the right sidebar, so docking the
 * entries on the right keeps the two content areas adjacent; the setting
 * `layout.entrySide` overrides it, and the shell and the settings page share
 * this fallback so an unloaded settings document cannot disagree with itself.
 */
export const DEFAULT_ENTRY_SIDE = 'right'
