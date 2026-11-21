/**
 * The server-side render of the settings page, for the tests of the panel.
 *
 * The entry renders the page with a store of its own, so a test can look at
 * the markup the user sees: the rows, their labels, the category bar and the
 * honest states.
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsForm } from '../src/client/SettingsPanel.jsx'

/** The document the tests render. */
export function settingsDocument(overrides = {}) {
  return {
    git: { path: '', colors: true, commitTemplate: '' },
    idea: { path: '' },
    webstorm: { path: '' },
    vscode: { path: '' },
    terminal: { shell: 'auto', copyOnSelect: false, fontSize: 13, outputLimitBytes: 8 * 1024 * 1024 },
    project: { alwaysSelectOpened: true, showHidden: true, showIgnored: false, singleClickOpen: false },
    commit: { groupByDirectory: false, testCommand: '', cleanupCommand: '', optimizeImportsCommand: '' },
    delete: { useRecycleBin: true },
    editor: { fontSize: 13, highlight: true, openMode: 'auto', editableMaxBytes: 1048576, markdownPreview: true },
    links: { chatFiles: 'ide' },
    layout: { entrySide: 'right' },
    ui: { density: 'comfortable' },
    shortcuts: {
      project: 'Alt+1', commit: 'Alt+0', git: 'Alt+9', terminal: 'Alt+F12',
      focusCommit: 'Ctrl+K', push: 'Ctrl+Shift+K', findInFiles: 'Ctrl+Shift+R', findInFilesAlt: 'Ctrl+Alt+F',
      openCommitDetail: 'Ctrl+Alt+D', quickOpen: 'Ctrl+Shift+N',
      rename: 'F2', delete: 'Delete', duplicate: 'F5', move: 'F6',
      synchronize: 'Ctrl+Alt+Y', jumpToSource: 'F4', hideAll: 'Ctrl+Shift+F12',
    },
    ...overrides,
  }
}

/**
 * Render the settings page.
 * @param {object} [options] the overrides of the document and of the props
 * @returns {string} the markup
 */
export function renderSettingsPage(options = {}) {
  const { document = {}, props = {}, ...rest } = options
  const published = settingsDocument(document)
  const store = {
    t: key => key,
    updateSettings: async () => {},
    getSnapshot: () => ({ settings: published }),
    toast: () => {},
    ...rest,
  }
  const state = {
    settings: published,
    terminal: { shells: [{ id: 'pwsh', label: 'PowerShell' }] },
  }
  return renderToStaticMarkup(React.createElement(SettingsForm, { store, state, ...props }))
}
