/**
 * Geometry for the Git log + commit Drawer.
 *
 * The Drawer is a side panel whenever the dock has room; it becomes an
 * overlay only below a genuinely narrow width. Column hiding is based on the
 * *remaining table* width, not on the whole dock, so opening a Drawer on a
 * normal bottom panel must not flip the whole panel into overlay mode.
 */
export const DRAWER_MIN = 340
export const DRAWER_DEFAULT = 420
export const OVERLAY_BELOW = 520
export const COLUMNS_BELOW = 560

export function gitLayout({ mainWidth = 0, configuredWidth = DRAWER_DEFAULT, drawerOpen = false } = {}) {
  const width = Number.isFinite(mainWidth) ? Math.max(0, mainWidth) : 0
  const desired = Number.isFinite(configuredWidth) ? configuredWidth : DRAWER_DEFAULT
  const drawerNarrow = width > 0 && width < OVERLAY_BELOW
  const drawerWidth = Math.max(DRAWER_MIN, Math.min(
    desired,
    width > 0 ? Math.max(DRAWER_MIN, width * 0.55) : desired,
    width > 0 ? Math.max(DRAWER_MIN, width - 300) : desired,
  ))
  const tableWidth = width > 0 ? (width - (drawerOpen ? drawerWidth : 0)) : 0
  return {
    drawerNarrow,
    drawerWidth,
    tableWidth,
    tableNarrow: tableWidth > 0 && tableWidth < COLUMNS_BELOW,
  }
}
