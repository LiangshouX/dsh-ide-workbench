/** Shared choices for file-tree and editor-tab context menus. */
export const IDE_OPTIONS = [
  { id: 'idea', title: 'IntelliJ IDEA' },
  { id: 'webstorm', title: 'WebStorm' },
  { id: 'vscode', title: 'Visual Studio Code' },
]

export function openInIdeMenu(store, path, disabled = false) {
  const unavailable = disabled || typeof path !== 'string' || path === ''
  return {
    key: 'open-in-ide', text: store.t('project.openInIde'), disabled: unavailable,
    submenu: IDE_OPTIONS.map(ide => ({
      key: ide.id, text: ide.title, disabled: unavailable,
      action: () => { if (!unavailable) void store.openInIde(ide.id, path) },
    })),
  }
}
