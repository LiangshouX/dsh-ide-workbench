/**
 * The model of the settings page.
 *
 * The page is a list of settings, and a list of settings is data: which
 * category a setting belongs to, how it is labelled, what its control is and
 * which words the filter matches it by. The model holds that data, and the
 * panel renders it.
 *
 * The model is the single source of the row metadata: the panel renders what
 * is written here, and the filter matches the very same words (the label,
 * the explanation, the key and the name of the category). A setting that is
 * found by the filter is therefore a setting the user can see, and a setting
 * that is on the page is a setting the filter can find.
 *
 * The model is a plain module without React and without the browser, so the
 * behaviour of the filter can be tested on its own (and so the panel does
 * not have to rebuild the index on every keystroke: the index is built once
 * per language and filtered afterwards).
 */

/**
 * The categories of the settings page, in the order they are shown.
 *
 * The order is deliberate. The categories the user comes back to come
 * first, the ones that are touched once come last:
 *
 *   1. general  - the choices that belong to no other category;
 *   2. editor   - how a document opens and reads;
 *   3. files    - what the tree shows and how a file behaves;
 *   4. deletion - the one destructive choice, on its own so it is seen;
 *   5. terminal - the shell of the embedded terminal;
 *   6. git      - the repository and its commit message;
 *   7. commit   - the tasks that run before a commit;
 *   8. shortcuts- the keys of the whole workbench (the longest block);
 *   9. ide      - the external IDEs, touched once;
 *  10. layout   - where the tool windows sit.
 *
 * Every setting sits in the category that owns its subject: the colours of
 * the file status belong to Git, the grouping of the changes belongs to the
 * Commit window, the syntax highlighting belongs to the editor.
 */
export const SETTINGS_CATEGORIES = Object.freeze([
  { id: 'general', labelKey: 'settings.categoryGeneral' },
  { id: 'editor', labelKey: 'settings.editorGroup' },
  { id: 'files', labelKey: 'settings.filesGroup' },
  { id: 'deletion', labelKey: 'settings.categoryDeletion' },
  { id: 'terminal', labelKey: 'settings.terminalGroup' },
  { id: 'git', labelKey: 'settings.gitGroup' },
  { id: 'commit', labelKey: 'settings.commitGroup' },
  { id: 'shortcuts', labelKey: 'settings.shortcuts' },
  { id: 'ide', labelKey: 'settings.ideGroup' },
  { id: 'layout', labelKey: 'settings.layoutGroup' },
])

/** The category of the shortcut rows. */
const SHORTCUTS = 'shortcuts'

/**
 * Every setting of the page, with the words the filter matches it by.
 *
 * `key` is the path of the setting in the settings document - the same path
 * the host writes. `labelKey` and `hintKey` are the words of the interface;
 * the filter matches the label, the hint, the key and the name of the
 * category, in the language of the user.
 *
 * Only settings that are really read by the workbench are listed here. A
 * setting that nothing reads would be worse than no setting at all: the
 * user changes it and nothing happens.
 */
export const SETTING_DESCRIPTORS = Object.freeze([
  // ── general ────────────────────────────────────────────────────────────
  {
    key: 'ui.density',
    category: 'general',
    labelKey: 'settings.density',
    hintKey: 'settings.densityHint',
    control: { type: 'select', options: [
      { value: 'comfortable', labelKey: 'settings.densityComfortable' },
      { value: 'compact', labelKey: 'settings.densityCompact' },
    ] },
  },
  {
    key: 'ui.language',
    category: 'general',
    labelKey: 'settings.language',
    hintKey: 'settings.languageHint',
    control: { type: 'value' },
  },

  // ── editor ─────────────────────────────────────────────────────────────
  {
    key: 'editor.openMode',
    category: 'editor',
    labelKey: 'settings.openMode',
    hintKey: 'settings.openModeHint',
    control: { type: 'select', options: [
      { value: 'auto', labelKey: 'settings.openModeAuto' },
      { value: 'editable', labelKey: 'settings.openModeEditable' },
      { value: 'readonly', labelKey: 'settings.openModeReadonly' },
    ] },
  },
  {
    key: 'editor.editableMaxBytes',
    category: 'editor',
    labelKey: 'settings.editableMaxBytes',
    hintKey: 'settings.editableMaxBytesHint',
    control: { type: 'number', min: 64, max: 16384, step: 64, view: 'kb' },
  },
  {
    key: 'editor.fontSize',
    category: 'editor',
    labelKey: 'settings.editorFontSize',
    control: { type: 'number', min: 10, max: 20, step: 1 },
  },
  {
    key: 'editor.markdownPreview',
    category: 'editor',
    labelKey: 'settings.markdownPreview',
    hintKey: 'settings.markdownPreviewHint',
    control: { type: 'checkbox' },
  },
  {
    key: 'editor.highlight',
    category: 'editor',
    labelKey: 'settings.highlight',
    control: { type: 'checkbox' },
  },

  // ── file tree ──────────────────────────────────────────────────────────
  {
    key: 'project.alwaysSelectOpened',
    category: 'files',
    labelKey: 'project.alwaysSelect',
    control: { type: 'checkbox' },
  },
  {
    key: 'project.showHidden',
    category: 'files',
    labelKey: 'settings.showHidden',
    control: { type: 'checkbox' },
  },
  {
    key: 'project.showIgnored',
    category: 'files',
    labelKey: 'settings.showIgnored',
    hintKey: 'settings.showIgnoredHint',
    control: { type: 'checkbox' },
  },
  {
    key: 'project.singleClickOpen',
    category: 'files',
    labelKey: 'settings.singleClickOpen',
    hintKey: 'settings.singleClickOpenHint',
    control: { type: 'checkbox' },
  },
  {
    key: 'links.chatFiles',
    category: 'files',
    labelKey: 'settings.chatFileLinks',
    hintKey: 'settings.chatFileLinksHint',
    control: { type: 'select', options: [
      { value: 'ide', labelKey: 'settings.chatFileLinksIde' },
      { value: 'sidebar', labelKey: 'settings.chatFileLinksSidebar' },
    ] },
  },

  // ── deletion ───────────────────────────────────────────────────────────
  {
    key: 'delete.useRecycleBin',
    category: 'deletion',
    labelKey: 'settings.useRecycleBin',
    hintKey: 'settings.useRecycleBinHint',
    control: { type: 'checkbox' },
    danger: true,
  },

  // ── terminal ───────────────────────────────────────────────────────────
  {
    key: 'terminal.shell',
    category: 'terminal',
    labelKey: 'settings.defaultShell',
    hintKey: 'settings.defaultShellHint',
    control: { type: 'select', optionsFrom: 'shells' },
    defer: 'sessions',
  },
  {
    key: 'terminal.copyOnSelect',
    category: 'terminal',
    labelKey: 'settings.copyOnSelect',
    control: { type: 'checkbox' },
  },
  {
    key: 'terminal.fontSize',
    category: 'terminal',
    labelKey: 'settings.terminalFontSize',
    control: { type: 'number', min: 10, max: 20, step: 1 },
  },
  {
    key: 'terminal.outputLimitBytes',
    category: 'terminal',
    labelKey: 'settings.terminalOutputLimit',
    hintKey: 'settings.terminalOutputLimitHint',
    control: { type: 'number', min: 1, max: 512, step: 1, view: 'mib' },
    defer: 'sessions',
  },

  // ── git ────────────────────────────────────────────────────────────────
  {
    key: 'git.path',
    category: 'git',
    labelKey: 'settings.gitPath',
    hintKey: 'settings.gitPathHint',
    control: { type: 'text', placeholder: 'git' },
  },
  {
    key: 'git.commitTemplate',
    category: 'git',
    labelKey: 'settings.commitTemplate',
    hintKey: 'settings.commitTemplateHint',
    control: { type: 'text' },
  },
  {
    key: 'git.colors',
    category: 'git',
    labelKey: 'project.gitColors',
    control: { type: 'checkbox' },
  },

  // ── commit ─────────────────────────────────────────────────────────────
  {
    key: 'commit.groupByDirectory',
    category: 'commit',
    labelKey: 'settings.groupByDirectory',
    hintKey: 'settings.groupByDirectoryHint',
    control: { type: 'checkbox' },
  },
  {
    key: 'commit.testCommand',
    category: 'commit',
    labelKey: 'settings.testCommand',
    hintKey: 'settings.testCommandHint',
    control: { type: 'text', placeholder: 'npm test' },
  },
  {
    key: 'commit.optimizeImportsCommand',
    category: 'commit',
    labelKey: 'settings.optimizeCommand',
    hintKey: 'settings.optimizeCommandHint',
    control: { type: 'text' },
  },
  {
    key: 'commit.cleanupCommand',
    category: 'commit',
    labelKey: 'settings.cleanupCommand',
    hintKey: 'settings.cleanupCommandHint',
    control: { type: 'text' },
  },

  // ── shortcuts ──────────────────────────────────────────────────────────
  //
  // Every shortcut the workbench really reads is here. The ones that were
  // missing before (the keys of the file tree, the commit detail, the jump
  // to the source, the hide of the tool windows) were live in the code and
  // unreachable in the settings page.
  ...[
    ['shortcuts.project', 'settings.projectShortcut', 'settings.projectShortcutHint'],
    ['shortcuts.commit', 'settings.commitShortcut', 'settings.commitShortcutHint'],
    ['shortcuts.git', 'settings.gitShortcut', 'settings.gitShortcutHint'],
    ['shortcuts.terminal', 'settings.terminalShortcut', 'settings.terminalShortcutHint'],
    ['shortcuts.focusCommit', 'settings.focusCommitShortcut', 'settings.focusCommitShortcutHint'],
    ['shortcuts.push', 'settings.pushShortcut', 'settings.pushShortcutHint'],
    ['shortcuts.findInFiles', 'settings.findInFilesShortcut', 'settings.findInFilesShortcutHint'],
    ['shortcuts.findInFilesAlt', 'settings.findInFilesAltShortcut', 'settings.findInFilesAltShortcutHint'],
    ['shortcuts.quickOpen', 'settings.quickOpenShortcut', 'settings.quickOpenShortcutHint'],
    ['shortcuts.openCommitDetail', 'settings.openCommitDetailShortcut', 'settings.openCommitDetailShortcutHint'],
    ['shortcuts.rename', 'settings.renameShortcut', 'settings.renameShortcutHint'],
    ['shortcuts.delete', 'settings.deleteShortcut', 'settings.deleteShortcutHint'],
    ['shortcuts.duplicate', 'settings.duplicateShortcut', 'settings.duplicateShortcutHint'],
    ['shortcuts.move', 'settings.moveShortcut', 'settings.moveShortcutHint'],
    ['shortcuts.synchronize', 'settings.synchronizeShortcut', 'settings.synchronizeShortcutHint'],
    ['shortcuts.jumpToSource', 'settings.jumpToSourceShortcut', 'settings.jumpToSourceShortcutHint'],
    ['shortcuts.hideAll', 'settings.hideAllShortcut', 'settings.hideAllShortcutHint'],
  ].map(([key, labelKey, hintKey]) => ({
    key,
    category: SHORTCUTS,
    labelKey,
    hintKey,
    control: { type: 'shortcut' },
  })),

  // ── external IDEs ──────────────────────────────────────────────────────
  // The names of the IDEs are brand names: they read the same in every
  // language, exactly as the menus of the file tree carry them.
  ...[
    ['idea.path', 'IntelliJ IDEA'],
    ['webstorm.path', 'WebStorm'],
    ['vscode.path', 'Visual Studio Code'],
  ].map(([key, label]) => ({
    key,
    category: 'ide',
    label,
    control: { type: 'text', placeholderKey: 'settings.ideAuto' },
  })),

  // ── layout ─────────────────────────────────────────────────────────────
  {
    key: 'layout.entrySide',
    category: 'layout',
    labelKey: 'settings.toolWindowSide',
    hintKey: 'settings.toolWindowSideHint',
    control: { type: 'select', options: [
      { value: 'left', labelKey: 'settings.toolWindowSideLeft' },
      { value: 'right', labelKey: 'settings.toolWindowSideRight' },
    ] },
    // The side of the tool windows is written through, not debounced: the
    // root class of the workbench follows the saved settings, so the entries
    // move as the user picks a side.
    writeThrough: 'entrySide',
  },
])

/**
 * The description of one category, or undefined.
 * @param {string} id
 * @returns {object|undefined}
 */
export function categoryOf(id) {
  return SETTINGS_CATEGORIES.find(category => category.id === id)
}

/**
 * The path of a setting in the settings document.
 * @param {string} key the dotted key
 * @returns {string[]} the path
 */
export function pathOf(key) {
  return String(key ?? '').split('.')
}

/**
 * Read one setting out of a settings document.
 * @param {any} document the settings document
 * @param {string} key the dotted key
 * @returns {any} the value, undefined when the document does not carry it
 */
export function readSetting(document, key) {
  let value = document
  for (const part of pathOf(key)) {
    if (value === null || typeof value !== 'object') return undefined
    value = value[part]
  }
  return value
}

/**
 * The words one setting is matched by.
 *
 * The label and the hint are the words of the interface in the language of
 * the user, the key is the path in the settings document and the category is
 * the name of the group the setting sits in. A setting that is found by its
 * name ("font size") is found as well by its key ("editor.fontSize") and by
 * the name of its category ("editor").
 *
 * @param {object} descriptor the descriptor of the setting
 * @param {(key: string) => string} t the translate function
 * @param {Record<string, string>} categoryLabels the labels of the categories
 * @returns {{key: string, category: string, label: string, hint: string, haystack: string}}
 */
export function searchEntry(descriptor, t, categoryLabels) {
  const label = descriptor.labelKey !== undefined ? t(descriptor.labelKey) : (descriptor.label ?? '')
  const hint = descriptor.hintKey === undefined ? '' : t(descriptor.hintKey)
  const category = categoryLabels[descriptor.category] ?? ''
  const haystack = `${label} ${hint} ${descriptor.key} ${category}`.toLowerCase()
  return { key: descriptor.key, category: descriptor.category, label, hint, haystack }
}

/**
 * Build the search index of the page.
 *
 * The index is built once per language: the panel keeps it and filters it,
 * so a keystroke never rebuilds it.
 *
 * @param {(key: string) => string} t the translate function
 * @returns {{entries: object[], byKey: Record<string, object>}} the entries
 *   of the index and the descriptor of every setting
 */
export function buildSearchIndex(t) {
  const categoryLabels = {}
  for (const category of SETTINGS_CATEGORIES) categoryLabels[category.id] = t(category.labelKey)
  const entries = SETTING_DESCRIPTORS.map(descriptor => searchEntry(descriptor, t, categoryLabels))
  const byKey = {}
  for (const descriptor of SETTING_DESCRIPTORS) byKey[descriptor.key] = descriptor
  return { entries, byKey }
}

/**
 * Normalise the text of the filter.
 * @param {any} query
 * @returns {string}
 */
export function normalizeQuery(query) {
  return String(query ?? '').trim().toLowerCase()
}

/**
 * Whether one entry matches the text of the filter.
 *
 * Every word of the filter has to be found - "font size" finds the row whose
 * label is "Editor font size" - and the search is case insensitive, so
 * "ctrl" finds "editor.ctrl".
 *
 * @param {object} entry an entry of the search index
 * @param {string} query the text of the filter
 * @returns {boolean}
 */
export function matchesEntry(entry, query) {
  const text = normalizeQuery(query)
  if (text === '') return true
  const words = text.split(/\s+/).filter(word => word !== '')
  return words.every(word => entry.haystack.includes(word))
}

/**
 * Narrow the search index to the settings that match the filter.
 *
 * @param {object[]} entries the entries of the index
 * @param {string} query the text of the filter
 * @returns {object[]} the entries that match
 */
export function filterSettings(entries, query) {
  const text = normalizeQuery(query)
  if (text === '') return entries
  return entries.filter(entry => matchesEntry(entry, text))
}

/**
 * Count the entries of every category.
 *
 * The counts are what the category bar shows next to every category: the
 * user sees where the matches are before opening anything.
 *
 * @param {object[]} entries the entries to count
 * @returns {{total: number, byCategory: Record<string, number>}}
 */
export function countByCategory(entries) {
  const byCategory = {}
  for (const category of SETTINGS_CATEGORIES) byCategory[category.id] = 0
  for (const entry of entries) byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1
  return { total: entries.length, byCategory }
}

/**
 * Group the entries by category, keeping the order of the categories.
 *
 * @param {object[]} entries the entries to group
 * @returns {{category: object, entries: object[]}[]} the groups, without the
 *   empty ones
 */
export function groupByCategory(entries) {
  const groups = []
  for (const category of SETTINGS_CATEGORIES) {
    const own = entries.filter(entry => entry.category === category.id)
    if (own.length === 0) continue
    groups.push({ category, entries: own })
  }
  return groups
}
