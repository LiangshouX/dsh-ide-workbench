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
