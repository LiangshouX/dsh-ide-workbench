/**
 * Tool Windows Settings: shortcuts, terminal profile, file tree, Git and
 * appearance. The same form serves the in-workbench modal and the native
 * settings.section page.
 */
import React, { useEffect, useRef, useState } from 'react'
import { ShortcutCapture } from './ui.jsx'
import { IDE_OPTIONS } from './ide-menu.js'
import { DEFAULT_LSP_SETTINGS } from '../host/settings-defaults.js'
import { memoryDecisionOf } from './store.js'

/**
 * The word of the memory snapshot, in the wording of the settings page.
 *
 * The page and the memory popup show the SAME snapshot, so they have to use
 * the same word for it: the page read the flag `tight` while the popup read
 * the field `decision`, and the two fields answered differently for a whole
 * round - the page said "may start" while the dialog asked the user to
 * decide (review A2). The decision itself comes from the store, which reads
 * ONE field (`decision`).
 * @param {any} resources the memory snapshot of the host
 * @param {(key: string) => string} t the translator
 * @returns {string} the localized state
 */
function memoryStateOf(resources, t) {
  const decision = memoryDecisionOf(resources)
  if (decision === 'tight') return t('settings.lspMemoryState.tight')
  if (decision === 'low') return t('settings.lspMemoryState.low')
  return t('settings.lspMemoryState.ok')
}

/**
 * The default share of the memory the language servers may use together.
 *
 * It is the default of the host (`lsp.budgetRatio`), so the page and the
 * document agree on what an untouched field means.
 */
const DEFAULT_BUDGET_RATIO = 0.25

/**
 * The smallest share the page accepts.
 *
 * The host only takes a ratio greater than zero and falls back to the
 * default for anything else, so a zero in the field would show a budget the
 * machine does not use (review A5). Five per cent is the smallest share
 * that still means something: it is a budget, not a rounding error.
 */
const MIN_BUDGET_RATIO = 0.05

/**
 * The budget share the page writes for one field value.
 *
 * An empty field falls back to the default of the host, a typed zero is
 * raised to the smallest share the host accepts, and a share above one is
 * capped: the field may not write a value the host would silently replace
 * with its default (review A5).
 * @param {unknown} raw the value of the field
 * @returns {number} the share to write
 */
export function clampBudgetRatio(raw) {
  const text = String(raw ?? '').trim()
  if (text === '') return DEFAULT_BUDGET_RATIO
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) return DEFAULT_BUDGET_RATIO
  return Math.min(1, Math.max(MIN_BUDGET_RATIO, parsed))
}

const SHORTCUT_FIELDS = [
  ['project', 'projectShortcut'],
  ['commit', 'commitShortcut'],
  ['git', 'gitShortcut'],
  ['terminal', 'terminalShortcut'],
  ['focusCommit', 'focusCommitShortcut'],
  ['push', 'pushShortcut'],
  ['findInFiles', 'findInFilesShortcut'],
  ['findInFilesAlt', 'findInFilesAltShortcut'],
  ['quickOpen', 'quickOpenShortcut'],
  ['findUsages', 'findUsagesShortcut'],
  ['findUsagesText', 'findUsagesTextShortcut'],
  ['goToDefinition', 'goToDefinitionShortcut'],
  ['complete', 'completeShortcut'],
]

// These two presentational components are deliberately top-level: defining
// them inside `SettingsForm` would give every render a new component type,
// making React unmount/remount the whole form. On a long settings page that
// remount is what threw the page back to the top after a change.
function Group({ title, description, children }) {
  return React.createElement('section', { className: 'iwb-settings-group' },
    React.createElement('h3', { className: 'iwb-settings-group-title' }, title),
    description !== undefined
      ? React.createElement('p', { className: 'iwb-settings-group-desc' }, description)
      : null,
    React.createElement('div', { className: 'iwb-settings-rows' }, children),
  )
}

/**
 * One settings row: a label with its hint on the left, a control on the right.
 *
 * The optional `title` is the tooltip of the row. It carries the long
 * explanation of a control whose visible hint has to stay short.
 * @param {{label: string, hint?: string, title?: string, children: any}} props
 *   the label, the optional hint, the optional tooltip and the control
 */
function Row({ label, hint, title, children }) {
  return React.createElement('div', { className: 'iwb-settings-row', title },
    React.createElement('div', { className: 'iwb-settings-label' },
      React.createElement('div', { className: 'iwb-settings-title' }, label),
      hint !== undefined ? React.createElement('div', { className: 'iwb-settings-hint' }, hint) : null,
    ),
    React.createElement('div', { className: 'iwb-settings-control' }, children),
  )
}

/**
 * Fill the `{placeholder}` slots of one text.
 *
 * The harness translate function does not interpolate, so the settings page
 * completes the numbers of the memory line here.
 * @param {string} text
 * @param {Record<string, string|number>} values
 * @returns {string}
 */
function interpolate(text, values) {
  let out = typeof text === 'string' ? text : ''
  for (const [name, value] of Object.entries(values)) {
    out = out.replaceAll(`{${name}}`, String(value))
  }
  return out
}

/**
 * A block of related fields with a caption.
 *
 * The settings rows are wide and airy; a block of numbers (the memory
 * model, the timeouts) reads better as one dense grid with a caption than
 * as four full-width rows that each carry a single number.
 * @param {{title: string, children: any}} props the caption and the fields
 */
function SubGroup({ title, children }) {
  return React.createElement('div', { className: 'iwb-settings-subgroup' },
    React.createElement('div', { className: 'iwb-settings-subgroup-title' }, title),
    React.createElement('div', { className: 'iwb-settings-fields' }, children),
  )
}

/**
 * The patch of the "reset to defaults" button.
 *
 * The semantic-analysis section goes back to the defaults of the settings
 * document, so a reset really resets it: the memory numbers, the request
 * timeout, the per-language switches and the warned roots used to survive it
 * (R10).
 *
 * The three maps are sent as null on purpose. The host merges a patch into
 * the document, and an empty object would be merged into the old entries
 * instead of replacing them - the old switches would survive the reset. A
 * null replaces the whole map, and the migration of the document turns it
 * back into an empty map.
 *
 * `workspaceDefaults` is one of them (PRD-v5.1 WS-04): the workspace-scoped
 * default state is kept by the workbench, not by the user, so a reset has to
 * clear it as well - otherwise the projects the user put into the basic mode
 * would stay there after a reset that promised a fresh start.
 * @returns {object} the patch the host merges into the document
 */
export function resetPatch() {
  return {
    git: { path: '', colors: true, commitTemplate: '' },
    idea: { path: '' },
    webstorm: { path: '' },
    vscode: { path: '' },
    terminal: { shell: 'auto', copyOnSelect: false, fontSize: 13 },
    project: { alwaysSelectOpened: true, showHidden: true, showIgnored: false, singleClickOpen: false },
    commit: { groupByDirectory: false },
    delete: { useRecycleBin: true },
    editor: { fontSize: 13, highlight: true, openMode: 'auto', editableMaxBytes: 1 << 20, markdownPreview: true },
    links: { chatFiles: 'ide' },
    lsp: {
      ...DEFAULT_LSP_SETTINGS,
      servers: null,
      indexedRoots: null,
      memoryWarnedRoots: null,
      workspaceDefaults: null,
    },
    shortcuts: {
      project: 'Alt+1', commit: 'Alt+0', git: 'Alt+9', terminal: 'Alt+F12',
      focusCommit: 'Ctrl+K', push: 'Ctrl+Shift+K', findInFiles: 'Ctrl+Shift+R', findInFilesAlt: 'Ctrl+Alt+F', openCommitDetail: 'Ctrl+Alt+D', quickOpen: 'Ctrl+Shift+N',
    },
  }
}

/**
 * One labelled control inside a field block.
 *
 * The label sits above the control, so a number always carries its own
 * meaning - a bare input in a column of inputs says nothing. The long
 * explanation lives in the tooltip: the field itself stays short.
 * @param {{label: string, hint?: string, title?: string, children: any}} props
 *   the label, the optional hint, the optional tooltip and the control
 */
function Field({ label, hint, title, children }) {
  return React.createElement('div', { className: 'iwb-settings-field', title },
    React.createElement('div', { className: 'iwb-settings-field-label' }, label),
    hint !== undefined
      ? React.createElement('div', { className: 'iwb-settings-field-hint' }, hint)
      : null,
    React.createElement('div', { className: 'iwb-settings-field-control' }, children),
  )
}

/**
 * The language servers the settings page shows a switch for.
 *
 * One switch per language is enough: a language that is switched off stays
 * in the list with an empty box, so the user can switch it on again. Before
 * that a language that was switched off vanished from the list and landed in
 * a second section ("已关闭的语言服务器"), and from there it could never be
 * switched on again.
 *
 * The host lists a language that is switched off in `available` with
 * `enabled: false`. A host that still runs the old code puts such a language
 * into a separate `disabled` bucket instead, and that bucket is merged in
 * here as well: the running host only answers differently after it is
 * restarted, and the user must not have to wait for that to switch a
 * language back on.
 *
 * A language that is switched off AND not installed lands in the bucket of
 * the missing servers (the host carries the `enabled` flag there too). It
 * is merged in as well - otherwise it has no row in the switch list at all,
 * and the user could only switch it on again by editing the settings file
 * (review R6-2).
 *
 * @param {{available?: unknown[], disabled?: unknown[], missing?: unknown[]}|undefined} servers
 *   the registry the host reported
 * @returns {object[]} one entry per language, in the order of the host
 */
export function mergeServerToggles(servers) {
  const available = Array.isArray(servers?.available) ? servers.available : []
  const legacy = Array.isArray(servers?.disabled) ? servers.disabled : []
  const missing = Array.isArray(servers?.missing) ? servers.missing : []
  const merged = []
  const seen = new Set()
  // The bucket of the new host wins over the bucket of the old one: it
  // carries the resolved path of the command and the effective switch.
  const add = (server, enabled) => {
    if (server === null || typeof server !== 'object') return
    const languageId = server.languageId
    if (typeof languageId !== 'string' || languageId === '') return
    if (seen.has(languageId)) return
    seen.add(languageId)
    merged.push({ ...server, enabled })
  }
  for (const server of available) add(server, server?.enabled !== false)
  // A language of the old bucket is switched off by definition - that is the
  // only thing the old host knew about it.
  for (const server of legacy) add(server, false)
  // A language that is not installed carries the switch of the settings file
  // as well: the host reports it there.
  for (const server of missing) add(server, server?.enabled !== false)
  return merged
}

export function SettingsForm({ store, state, compact, onStatusChange }) {
  const t = store.t
  const settings = state.settings ?? {}
  /**
   * Language servers the host could not find on this machine.
   *
   * A language that the user switched off is not missing: it is wanted and
   * not installed, or it is installed and simply off. The status bar filters
   * the same way, so the two interfaces do not use the same word for two
   * different things (review R6-3).
   */
  const missingServers = (Array.isArray(state.lsp?.servers?.missing) ? state.lsp.servers.missing : [])
    .filter(server => server?.enabled !== false)
  /** Every language server of the machine, switched on or off. */
  const toggleServers = mergeServerToggles(state.lsp?.servers)
  /** The memory snapshot of the host, when it was fetched. */
  const lspResources = state.lsp?.resources ?? null
  /** How many language server processes run right now. */
  const runningServers = ['starting', 'building', 'ready', 'restarting'].includes(state.lsp?.state) ? 1 : 0
  const [draft, setDraft] = useState(settings)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const timer = useRef(null)
  const savedTimer = useRef(null)
  const rootRef = useRef(null)
  const scrollRef = useRef({ parent: null, top: 0 })
  /** Settings changed but not yet sent; merged so rapid edits never drop one. */
  const pendingPatch = useRef({})
  const alive = useRef(true)
  /**
   * The idle policy of the semantic analysis.
   *
   * A document written before the policy existed has no such key; the host
   * then behaves like "after an idle time", and so does the page.
   *
   * The old switch `autoExit: false` is the authority of the host: it means
   * "never exit", whatever the policy says. A page that showed "after an idle
   * time" for such a document would contradict the host - the server would
   * never exit while the page promised that it would - so the switch wins
   * here too (PRD-v5 §3.2).
   */
  const idlePolicy = draft.lsp?.autoExit === false
    ? 'never'
    : (typeof draft.lsp?.idlePolicy === 'string' && draft.lsp.idlePolicy !== ''
      ? draft.lsp.idlePolicy
      : 'after')

  // The registry and the memory snapshot are facts of the machine, not
  // settings: they are read when the page opens and never written back.
  useEffect(() => {
    void store.loadLspServers?.()
    void store.loadLspResources?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The native settings page owns the scroll container around this section.
  // Remember where the user was before a debounced save and put it back after
  // the settings document publishes, so editing a low row does not jump to the
  // top of a long page.
  const captureScroll = () => {
    let node = rootRef.current?.parentElement ?? null
    while (node !== null) {
      const overflow = typeof getComputedStyle === 'function' ? getComputedStyle(node).overflowY : ''
      if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
        scrollRef.current = { parent: node, top: node.scrollTop }
        return
      }
      node = node.parentElement
    }
    scrollRef.current = { parent: null, top: typeof window !== 'undefined' ? window.scrollY : 0 }
  }

  const restoreScroll = () => {
    const { parent, top } = scrollRef.current
    const apply = () => {
      if (parent !== null) parent.scrollTop = top
      else if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') window.scrollTo({ top })
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply)
    else apply()
  }

  useEffect(() => {
    // Do not let a completed save overwrite an edit the user made while it was
    // in flight; that edit has its own flush coming.
    if (Object.keys(pendingPatch.current).length > 0) return
    setDraft(settings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  // The in-workbench modal renders the feedback in its sticky header; the
  // native settings page reads it from the sticky footer below.
  useEffect(() => {
    onStatusChange?.({ saving, saved })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, saved])

  /** Deep-merge one settings patch into another (arrays replace). */
  const mergePatch = (base, patch) => {
    const output = { ...base }
    for (const [key, value] of Object.entries(patch)) {
      const current = base[key]
      output[key] = value !== null && typeof value === 'object' && !Array.isArray(value)
        && current !== null && typeof current === 'object' && !Array.isArray(current)
        ? mergePatch(current, value)
        : value
    }
    return output
  }

  // Send everything still pending, including a change made less than the
  // debounce interval before the panel was closed. A close must not silently
  // drop the last toggle.
  const flush = () => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null }
    const patch = pendingPatch.current
    if (Object.keys(patch).length === 0) return Promise.resolve()
    pendingPatch.current = {}
    if (alive.current) setSaving(true)
    return store.updateSettings(patch).finally(() => {
      if (!alive.current) return
      setSaving(false)
      setSaved(true)
      if (savedTimer.current !== null) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => { if (alive.current) setSaved(false) }, 1800)
    })
  }

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      // Unmounting (closing the modal, leaving the settings page) commits the
      // pending edit instead of cancelling it.
      if (Object.keys(pendingPatch.current).length > 0) void flush()
      if (timer.current !== null) clearTimeout(timer.current)
      if (savedTimer.current !== null) clearTimeout(savedTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const commit = (patch) => {
    captureScroll()
    pendingPatch.current = mergePatch(pendingPatch.current, patch)
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void flush().then(() => { if (alive.current) restoreScroll() })
    }, 300)
  }

  const update = (patch) => {
    const next = {
      ...draft,
      ...patch,
      git: { ...draft.git, ...(patch.git ?? {}) },
      idea: { ...draft.idea, ...(patch.idea ?? {}) },
      webstorm: { ...draft.webstorm, ...(patch.webstorm ?? {}) },
      vscode: { ...draft.vscode, ...(patch.vscode ?? {}) },
      terminal: { ...draft.terminal, ...(patch.terminal ?? {}) },
      project: { ...draft.project, ...(patch.project ?? {}) },
      commit: { ...draft.commit, ...(patch.commit ?? {}) },
      delete: { ...draft.delete, ...(patch.delete ?? {}) },
      layout: { ...draft.layout, ...(patch.layout ?? {}) },
      editor: { ...draft.editor, ...(patch.editor ?? {}) },
      links: { ...draft.links, ...(patch.links ?? {}) },
      shortcuts: { ...draft.shortcuts, ...(patch.shortcuts ?? {}) },
      lsp: { ...draft.lsp, ...(patch.lsp ?? {}) },
    }
    setDraft(next)
    commit(patch)
  }

  // A settings group is a titled block of rows. The description is shared by
  // every row (instead of repeating the same hint under each control).
  // Label and hint form the reading column; every control sits in the same
  // right-hand column so switches, selects and text fields line up.
  return React.createElement('div', { className: 'iwb-settings', ref: rootRef },
    React.createElement(Group, {
      title: t('settings.shortcuts'),
      description: t('settings.shortcutsGroupHint'),
    },
      SHORTCUT_FIELDS.map(([field, labelKey]) => React.createElement(Row, {
        key: field,
        label: t(`settings.${labelKey}`),
        hint: t(`settings.${labelKey}Hint`),
      },
        React.createElement(ShortcutCapture, {
          value: draft.shortcuts?.[field] ?? '',
          active: capturing,
          onActivate: setCapturing,
          onCapture: value => update({ shortcuts: { [field]: value } }),
          pressText: t('settings.pressKeys'),
          hint: t('settings.recordShortcutHint'),
        }),
      )),
    ),
    React.createElement(Group, { title: t('settings.terminalGroup') },
      React.createElement(Row, { label: t('settings.defaultShell'), hint: t('settings.defaultShellHint') },
        React.createElement('select', {
          className: 'iwb-select',
          value: draft.terminal?.shell ?? 'auto',
          onChange: event => update({ terminal: { shell: event.target.value } }),
        },
          React.createElement('option', { value: 'auto' }, t('settings.auto')),
          state.terminal.shells.map(shell => React.createElement('option', { key: shell.id, value: shell.id }, shell.label)),
        ),
      ),
      React.createElement(Row, { label: t('settings.copyOnSelect') },
        React.createElement('input', {
          type: 'checkbox',
          checked: draft.terminal?.copyOnSelect === true,
          onChange: event => update({ terminal: { copyOnSelect: event.target.checked } }),
        }),
      ),
      React.createElement(Row, { label: t('settings.terminalFontSize') },
        React.createElement('input', {
          type: 'number', min: 10, max: 20,
          value: draft.terminal?.fontSize ?? 13,
          onChange: event => update({ terminal: { fontSize: Number(event.target.value) || 13 } }),
        }),
      ),
    ),
    React.createElement(Group, { title: t('settings.filesGroup') },
      React.createElement(Row, { label: t('project.alwaysSelect') },
        React.createElement('input', {
          type: 'checkbox',
          checked: draft.project?.alwaysSelectOpened !== false,
          onChange: event => update({ project: { alwaysSelectOpened: event.target.checked } }),
        }),
      ),
      React.createElement(Row, { label: t('project.gitColors') },
        React.createElement('input', {
          type: 'checkbox',
          checked: draft.git?.colors !== false,
          onChange: event => update({ git: { colors: event.target.checked } }),
        }),
      ),
      React.createElement(Row, { label: t('settings.showHidden') },
        React.createElement('input', {
          type: 'checkbox',
          checked: draft.project?.showHidden !== false,
          onChange: event => update({ project: { showHidden: event.target.checked } }),
        }),
      ),
      React.createElement(Row, { label: t('settings.singleClickOpen'), hint: t('settings.singleClickOpenHint') },
        React.createElement('input', {
          type: 'checkbox',
          checked: draft.project?.singleClickOpen === true,
          onChange: event => update({ project: { singleClickOpen: event.target.checked } }),
        }),
      ),
      React.createElement(Row, { label: t('settings.chatFileLinks'), hint: t('settings.chatFileLinksHint') },
        React.createElement('select', {
          className: 'iwb-select',
          value: draft.links?.chatFiles === 'sidebar' ? 'sidebar' : 'ide',
          onChange: event => update({ links: { chatFiles: event.target.value } }),
        },
          React.createElement('option', { value: 'ide' }, t('settings.chatFileLinksIde')),
          React.createElement('option', { value: 'sidebar' }, t('settings.chatFileLinksSidebar')),
        ),
      ),
      React.createElement(Row, { label: t('settings.showIgnored'), hint: t('settings.showIgnoredHint') },
        React.createElement('input', {
          type: 'checkbox',
          checked: draft.project?.showIgnored === true,
          onChange: event => update({ project: { showIgnored: event.target.checked } }),
        }),
      ),
      React.createElement(Row, { label: t('settings.groupByDirectory'), hint: t('settings.groupByDirectoryHint') },
        React.createElement('input', {
          type: 'checkbox',
          checked: draft.commit?.groupByDirectory === true,
          onChange: event => update({ commit: { groupByDirectory: event.target.checked } }),
        }),
      ),
      React.createElement(Row, { label: t('settings.useRecycleBin'), hint: t('settings.useRecycleBinHint') },
        React.createElement('input', {
          type: 'checkbox',
          checked: draft.delete?.useRecycleBin !== false,
          onChange: event => update({ delete: { useRecycleBin: event.target.checked } }),
        }),
      ),
    ),
    React.createElement(Group, { title: t('settings.ideGroup'), description: t('settings.idePathHint') },
      IDE_OPTIONS.map(ide => React.createElement(Row, { key: ide.id, label: ide.title },
        React.createElement('input', {
          type: 'text', className: 'iwb-input', 'aria-label': ide.title,
          value: draft[ide.id]?.path ?? '',
          placeholder: t('settings.ideAuto'),
          onChange: event => update({ [ide.id]: { path: event.target.value } }),
        }),
      )),
    ),
    React.createElement(Group, { title: t('settings.editorGroup') },
      React.createElement(Row, { label: t('settings.openMode'), hint: t('settings.openModeHint') },
        React.createElement('select', {
          value: draft.editor?.openMode ?? 'auto',
          onChange: event => update({ editor: { openMode: event.target.value } }),
        },
          React.createElement('option', { value: 'auto' }, t('settings.openModeAuto')),
          React.createElement('option', { value: 'editable' }, t('settings.openModeEditable')),
          React.createElement('option', { value: 'readonly' }, t('settings.openModeReadonly')),
        ),
      ),
      React.createElement(Row, { label: t('settings.editableMaxBytes'), hint: t('settings.editableMaxBytesHint') },
        React.createElement('input', {
          type: 'number', min: 64, max: 16384, step: 64,
          value: Math.round((draft.editor?.editableMaxBytes ?? (1 << 20)) / 1024),
          onChange: event => update({ editor: { editableMaxBytes: (Number(event.target.value) || 1024) * 1024 } }),
        }),
      ),
      React.createElement(Row, { label: t('settings.editorFontSize') },
        React.createElement('input', {
          type: 'number', min: 10, max: 20,
          value: draft.editor?.fontSize ?? 13,
          onChange: event => update({ editor: { fontSize: Number(event.target.value) || 13 } }),
        }),
      ),
      React.createElement(Row, { label: t('settings.markdownPreview'), hint: t('settings.markdownPreviewHint') },
        React.createElement('input', {
          type: 'checkbox',
          checked: draft.editor?.markdownPreview !== false,
          onChange: event => update({ editor: { markdownPreview: event.target.checked } }),
        }),
      ),
    ),
    React.createElement(Group, { title: t('settings.gitGroup') },
      React.createElement(Row, { label: t('settings.gitPath'), hint: t('settings.gitPathHint') },
        React.createElement('input', {
          type: 'text',
          placeholder: 'git',
          value: draft.git?.path ?? '',
          onChange: event => update({ git: { path: event.target.value } }),
        }),
      ),
      React.createElement(Row, { label: t('settings.commitTemplate'), hint: t('settings.commitTemplateHint') },
        React.createElement('input', {
          type: 'text',
          value: draft.git?.commitTemplate ?? '',
          onChange: event => update({ git: { commitTemplate: event.target.value } }),
        }),
      ),
    ),
    React.createElement(Group, { title: t('settings.commitGroup') },
      React.createElement(Row, { label: t('settings.testCommand'), hint: t('settings.testCommandHint') },
        React.createElement('input', {
          type: 'text',
          placeholder: 'npm test',
          value: draft.commit?.testCommand ?? '',
          onChange: event => update({ commit: { testCommand: event.target.value } }),
        }),
      ),
      React.createElement(Row, { label: t('settings.optimizeCommand'), hint: t('settings.optimizeCommandHint') },
        React.createElement('input', {
          type: 'text',
          value: draft.commit?.optimizeImportsCommand ?? '',
          onChange: event => update({ commit: { optimizeImportsCommand: event.target.value } }),
        }),
      ),
      React.createElement(Row, { label: t('settings.cleanupCommand'), hint: t('settings.cleanupCommandHint') },
        React.createElement('input', {
          type: 'text',
          value: draft.commit?.cleanupCommand ?? '',
          onChange: event => update({ commit: { cleanupCommand: event.target.value } }),
        }),
      ),
    ),
    React.createElement(Group, { title: t('settings.lspGroup'), description: t('settings.lspGroupHint') },
      React.createElement(Row, { label: t('settings.lspEnabled'), hint: t('settings.lspEnabledHint') },
        React.createElement('input', {
          type: 'checkbox',
          checked: draft.lsp?.enabled !== false,
          onChange: event => update({ lsp: { enabled: event.target.checked } }),
        }),
      ),
      React.createElement(Row, { label: t('settings.lspIndexOnOpen'), hint: t('settings.lspIndexOnOpenHint') },
        React.createElement('select', {
          className: 'iwb-select',
          value: draft.lsp?.indexOnOpen ?? 'ask',
          onChange: event => update({ lsp: { indexOnOpen: event.target.value } }),
        },
          React.createElement('option', { value: 'ask' }, t('settings.lspIndexAsk')),
          React.createElement('option', { value: 'always' }, t('settings.lspIndexAlways')),
          React.createElement('option', { value: 'never' }, t('settings.lspIndexNever')),
        ),
      ),
      // The hierarchy of PRD-v5.1 WS-04, in one sentence: the row above is a
      // GLOBAL policy, and the workspace-scoped default of the user outranks
      // it. A project whose user chose the basic mode stays in the basic mode
      // even when the policy says "always index" - that is the behaviour
      // change of WS-04, so the page has to say it out loud.
      React.createElement('div', { className: 'iwb-settings-hint' }, t('settings.lspWorkspaceDefaultHint')),
      // The four memory numbers are one topic, so they are one block: each
      // number keeps its own label, and the block takes a third of the
      // height of four separate rows.
      React.createElement(SubGroup, { title: t('settings.lspMemoryGroup') },
        React.createElement(Field, { label: t('settings.lspMemoryLimit'), hint: t('settings.lspMemoryLimitShort'), title: t('settings.lspMemoryLimitHint') },
          React.createElement('input', {
            type: 'number', min: 256, max: 32768, step: 256,
            value: draft.lsp?.memoryLimitMB ?? 2048,
            onChange: event => update({ lsp: { memoryLimitMB: Number(event.target.value) || 2048 } }),
          }),
        ),
        React.createElement(Field, { label: t('settings.lspFreeMemory'), hint: t('settings.lspFreeMemoryShort'), title: t('settings.lspFreeMemoryHint') },
          React.createElement('input', {
            type: 'number', min: 256, max: 32768, step: 256,
            value: draft.lsp?.freeMemoryThresholdMB ?? 512,
            onChange: event => update({ lsp: { freeMemoryThresholdMB: Number(event.target.value) || 512 } }),
          }),
        ),
        React.createElement(Field, { label: t('settings.lspHeadroom'), hint: t('settings.lspHeadroomShort'), title: t('settings.lspHeadroomHint') },
          React.createElement('input', {
            type: 'number', min: 1, max: 8, step: 0.1,
            value: draft.lsp?.memoryHeadroom ?? 1.5,
            onChange: event => update({ lsp: { memoryHeadroom: Number(event.target.value) || 1.5 } }),
          }),
        ),
        React.createElement(Field, { label: t('settings.lspHardFloor'), hint: t('settings.lspHardFloorShort'), title: t('settings.lspHardFloorHint') },
          React.createElement('input', {
            type: 'number', min: 64, max: 8192, step: 64,
            value: draft.lsp?.memoryHardFloorMB ?? 256,
            onChange: event => update({ lsp: { memoryHardFloorMB: Number(event.target.value) || 256 } }),
          }),
        ),
      ),
      // The machine-level budget of PRD-v5.1 MEM-08.
      //
      // The per-server gate answers one question only: "may the next server
      // start". It cannot answer "may three servers grow to their ceiling at
      // the same time" - and that is the question that ends in the swap. The
      // budget is the last gate: the sum of the ceilings of the running
      // servers never exceeds it.
      React.createElement(SubGroup, { title: t('settings.lspBudgetGroup') },
        React.createElement(Field, { label: t('settings.lspBudgetRatio'), hint: t('settings.lspBudgetRatioShort'), title: t('settings.lspBudgetRatioHint') },
          React.createElement('input', {
            // The share may not be zero: the host only accepts a ratio
            // greater than zero and falls back to 0.25 for anything else, so
            // a 0 in the field would be a lie - the page would show "no
            // budget" while the machine keeps a quarter of its memory for the
            // language servers. The smallest share that still means
            // something is 5 %.
            type: 'number', min: MIN_BUDGET_RATIO, max: 1, step: 0.05,
            value: Number.isFinite(draft.lsp?.budgetRatio) ? draft.lsp.budgetRatio : DEFAULT_BUDGET_RATIO,
            onChange: event => update({ lsp: { budgetRatio: clampBudgetRatio(event.target.value) } }),
          }),
        ),
        React.createElement(Field, { label: t('settings.lspBudgetCap'), hint: t('settings.lspBudgetCapShort'), title: t('settings.lspBudgetCapHint') },
          React.createElement('input', {
            type: 'number', min: 256, max: 32768, step: 256,
            value: draft.lsp?.budgetCapMB ?? 4096,
            onChange: event => update({ lsp: { budgetCapMB: Number(event.target.value) || 4096 } }),
          }),
        ),
        // The user's own limit on top of the budget: when both apply, the
        // stricter one wins.
        React.createElement(Field, { label: t('settings.lspMaxConcurrent'), hint: t('settings.lspMaxConcurrentShort'), title: t('settings.lspMaxConcurrentHint') },
          React.createElement('input', {
            type: 'number', min: 0, max: 16, step: 1,
            value: draft.lsp?.maxConcurrentIndexes ?? 0,
            onChange: event => update({ lsp: { maxConcurrentIndexes: Number(event.target.value) || 0 } }),
          }),
        ),
      ),
      // The pressure valve is the last defence against the swap, and it is on
      // by default (PRD-v5.1 MEM-12). The switch is the only way to turn it
      // off, so it gets a row of its own.
      React.createElement(Row, { label: t('settings.lspPressureYield'), hint: t('settings.lspPressureYieldHint') },
        React.createElement('input', {
          type: 'checkbox',
          checked: draft.lsp?.pressureYield !== false,
          onChange: event => update({ lsp: { pressureYield: event.target.checked } }),
        }),
      ),
      // The idle policy replaces the old "exit the server when idle" switch
      // (PRD-v5 §3.2): one dropdown says *when* the server lets go, and the
      // minutes below it are the length of the "after an idle time" option.
      React.createElement(Row, { label: t('settings.lspIdlePolicy'), hint: t('settings.lspIdlePolicyShort'), title: t('settings.lspIdlePolicyHint') },
        React.createElement('select', {
          className: 'iwb-select',
          value: idlePolicy,
          // The switch travels with the policy: a document that says
          // `autoExit: false` must not keep that value while the page claims
          // the server exits after an idle time. The host honours the switch
          // over the policy, so the page has to write both.
          onChange: event => update({
            lsp: { idlePolicy: event.target.value, autoExit: event.target.value !== 'never' },
          }),
        },
          React.createElement('option', { value: 'never' }, t('settings.lspIdlePolicyNever')),
          React.createElement('option', { value: 'after' }, t('settings.lspIdlePolicyAfter')),
          React.createElement('option', { value: 'onMemoryPressure' }, t('settings.lspIdlePolicyMemory')),
          // 'always' = the idle timeout AND the memory pressure. It is the
          // explicit spelling of the default of PRD-v5.1 MEM-12, which the
          // pressure valve made the default.
          React.createElement('option', { value: 'always' }, t('settings.lspIdlePolicyAlways')),
        ),
      ),
      // "Never exit" is the one option with a price the user has to know:
      // the language server stays resident and takes its memory for good.
      idlePolicy === 'never'
        ? React.createElement('div', { className: 'iwb-settings-hint' }, t('settings.lspIdlePolicyNeverWarning'))
        : null,
      React.createElement(SubGroup, { title: t('settings.lspTimeoutGroup') },
        React.createElement(Field, { label: t('settings.lspIdleTimeout'), hint: t('settings.lspIdleTimeoutShort'), title: t('settings.lspIdleTimeoutHint') },
          React.createElement('input', {
            type: 'number', min: 1, max: 240,
            value: Math.round((draft.lsp?.idleTimeoutMs ?? 600000) / 60000),
            onChange: event => update({ lsp: { idleTimeoutMs: (Number(event.target.value) || 10) * 60000 } }),
          }),
        ),
        // How long an index may run before the cancel button appears. The
        // host owns the threshold, but without a field for it the user could
        // not change it (MEM-04).
        React.createElement(Field, { label: t('settings.lspCancelAfter'), hint: t('settings.lspCancelAfterShort'), title: t('settings.lspCancelAfterHint') },
          React.createElement('input', {
            type: 'number', min: 5, max: 600, step: 5,
            value: Math.round((draft.lsp?.cancelAfterMs ?? 60000) / 1000),
            onChange: event => update({ lsp: { cancelAfterMs: (Number(event.target.value) || 60) * 1000 } }),
          }),
        ),
        React.createElement(Field, { label: t('settings.lspRequestTimeout'), hint: t('settings.lspRequestTimeoutShort'), title: t('settings.lspRequestTimeoutHint') },
          React.createElement('input', {
            type: 'number', min: 30000, max: 600000, step: 1000,
            // The runtime raises anything below 30000 to 30000, so the field
            // shows the value that is actually in effect.
            value: Math.max(30000, draft.lsp?.requestTimeoutMs ?? 30000),
            onChange: event => update({ lsp: { requestTimeoutMs: Math.max(30000, Number(event.target.value) || 30000) } }),
          }),
        ),
      ),
      React.createElement(Row, { label: t('settings.lspAutoRestart') },
        React.createElement('input', {
          type: 'checkbox',
          checked: draft.lsp?.autoRestart !== false,
          onChange: event => update({ lsp: { autoRestart: event.target.checked } }),
        }),
      ),
      // The missing servers are a fact of the machine, not a setting: they are
      // listed so the user knows which language stays in the basic mode.
      missingServers.length > 0
        ? React.createElement(Row, { label: t('settings.lspServersMissing'), hint: t('settings.lspServersMissingHint') },
            React.createElement('span', { className: 'iwb-settings-value' },
              missingServers.map(server => `${server.languageId} (${server.command})`).join(', '),
            ),
          )
        : null,

      // No second list of the languages that are switched off: every language
      // has its own row in the switch list below.
      React.createElement('div', { className: 'iwb-settings-hint' }, t('settings.lspOfflineNote')),
      // The memory situation of the machine, as a fact the user can judge:
      // "384 MB needed" is a number, "the machine is short on memory" is a
      // decision. Without an open project there is no language to estimate,
      // so only the free memory is shown.
      //
      // The number is the one the host judges the start by - the free memory
      // of the machine minus what the running servers have reserved. The free
      // memory alone would say "plenty" while the gate says "tight", and two
      // screens that answer the same question differently are worse than one
      // screen with an honest number (PRD-v5 §3.2 / MEM-02).
      lspResources !== null
        ? React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'iwb-settings-hint' },
              typeof lspResources.languageId === 'string' && lspResources.languageId !== ''
                ? interpolate(t('settings.lspMemoryNow'), {
                    available: Math.round((lspResources.availableBytes ?? lspResources.freeBytes ?? 0) / (1024 * 1024)),
                    need: Math.round(lspResources.needMB ?? 0),
                    threshold: Math.round((lspResources.thresholdBytes ?? 0) / (1024 * 1024)),
                    floor: Math.round(lspResources.hardFloorMB ?? 256),
                    language: lspResources.languageId,
                    // The word of the snapshot comes from the SAME field the
                    // popup reads (`decision`), so the settings page and the
                    // dialog cannot answer the same question two ways
                    // (review A2).
                    state: memoryStateOf(lspResources, t),
                  })
                : interpolate(t('settings.lspMemoryNowNoProject'), {
                    available: Math.round((lspResources.availableBytes ?? lspResources.freeBytes ?? 0) / (1024 * 1024)),
                  }),
            ),
            // The reservation gets its own line, and only when there is one:
            // it is the reason the available memory is smaller than the free
            // memory of the machine.
            Math.round((lspResources.reservedBytes ?? 0) / (1024 * 1024)) > 0
              ? React.createElement('div', { className: 'iwb-settings-hint' },
                  interpolate(t('settings.lspMemoryReserved'), {
                    reserved: Math.round((lspResources.reservedBytes ?? 0) / (1024 * 1024)),
                  }))
              : null,
            // The worst case belongs where the user already looks at the live
            // snapshot. It is INFORMATION, not a verdict: the host reports it
            // and never blocks on it (MEM-07), so it must not turn into a
            // question the user has to answer - it is a line that says what
            // the machine would be left with if the next server grew into the
            // ceiling it was granted.
            Number.isFinite(lspResources.worstCaseBytes) && Number.isFinite(lspResources.ceilingMB)
              ? React.createElement('div', { className: 'iwb-settings-hint' },
                  interpolate(t('lsp.diagnostics.memoryWorstText'), {
                    ceiling: lspResources.ceilingMB,
                    left: Math.round(lspResources.worstCaseBytes / (1024 * 1024)),
                  }))
              : null,
          )
        : null,
    ),
    // The language servers of the machine, one switch and one ceiling each
    // (SET-02). The field `lsp.servers[languageId].enabled` existed but had
    // no control, and the global ceiling could only lower a language: the
    // user had no way to give one language more than the global cap.
    //
    // The list holds every language of the machine, switched on or off: a
    // language that is switched off keeps its row with an empty box, so the
    // user can switch it on again.
    toggleServers.length > 0
      ? React.createElement(Group, { title: t('settings.lspServersGroup'), description: t('settings.lspServersGroupHint') },
          // One line per language, not one settings row per language: a
          // dozen rows of "a switch and a command" is a wall of text.
          React.createElement('div', { className: 'iwb-settings-languages' },
            toggleServers.map(server => {
              const servers = draft.lsp?.servers ?? {}
              const entry = servers[server.languageId] ?? {}
              const enabled = entry.enabled !== false
              // The ceiling of this language. `null` and a missing key both
              // mean "no ceiling of its own" - the global one applies.
              const limit = entry.memoryLimitMB
              return React.createElement('div', {
                key: server.languageId,
                className: 'iwb-settings-language',
              },
                // The switch and the name stay in one label, so clicking the
                // name switches the language off. The ceiling input is
                // outside of it: a label hands its click to the first
                // control it holds, and that has to stay the switch.
                React.createElement('label', {
                  className: 'iwb-settings-language-toggle',
                  // The hint of the host is the install advice. A language
                  // that is switched off AND not installed only shows up in
                  // this list (the "not found" row lists the languages that
                  // are wanted), so its title is the last place that can say
                  // "this one is not installed, here is how to install it".
                  title: server.resolvedPath ?? server.hint ?? server.command,
                },
                  React.createElement('input', {
                    type: 'checkbox',
                    checked: enabled,
                    onChange: event => {
                      const nextServers = {
                        ...servers,
                        [server.languageId]: { ...entry, enabled: event.target.checked },
                      }
                      update({ lsp: { servers: nextServers } })
                    },
                  }),
                  React.createElement('span', { className: 'iwb-settings-language-name' }, server.languageId),
                  React.createElement('span', { className: 'iwb-settings-language-command' }, server.command),
                ),
                // The ceiling of this one language. Empty means "no ceiling
                // of its own": the global one applies. A number here
                // replaces the global ceiling for this language, so it may
                // be higher than the global one.
                React.createElement('input', {
                  type: 'number',
                  className: 'iwb-settings-language-limit',
                  min: 64, max: 32768, step: 64,
                  value: Number.isFinite(limit) ? String(limit) : '',
                  'aria-label': `${server.languageId}: ${t('settings.lspServerMemoryLimit')}`,
                  title: t('settings.lspServerMemoryLimitHint'),
                  onChange: event => {
                    const raw = String(event.target.value ?? '').trim()
                    const parsed = Number(raw)
                    const nextEntry = { ...entry }
                    if (raw === '' || !Number.isFinite(parsed) || parsed <= 0) {
                      // `null` and not a missing key: the host merges a
                      // patch into the document, and a missing key would
                      // leave the old ceiling standing - the field would
                      // fill itself again after the next save.
                      nextEntry.memoryLimitMB = null
                    } else {
                      nextEntry.memoryLimitMB = parsed
                    }
                    const nextServers = {
                      ...servers,
                      [server.languageId]: nextEntry,
                    }
                    update({ lsp: { servers: nextServers } })
                  },
                }),
                React.createElement('span', { className: 'iwb-settings-language-unit' }, 'MB'),
              )
            }),
          ),
          // A language server that is running right now: the master switch
          // ends it, and the user deserves to know that.
          runningServers > 0
            ? React.createElement('div', { className: 'iwb-settings-hint' },
                interpolate(t('settings.lspServerRunning'), { count: runningServers }))
            : null,
        )
      : null,
    React.createElement(Group, { title: t('settings.appearanceGroup') },
      React.createElement(Row, { label: t('settings.highlight') },
        React.createElement('input', {
          type: 'checkbox',
          checked: draft.editor?.highlight !== false,
          onChange: event => update({ editor: { highlight: event.target.checked } }),
        }),
      ),
      React.createElement(Row, { label: t('settings.language'), hint: t('settings.languageHint') },
        React.createElement('span', { className: 'iwb-settings-value' }, t('settings.followDsh')),
      ),
    ),
    compact === true ? null : React.createElement('div', { className: 'iwb-settings-footer' },
      React.createElement('button', {
        type: 'button', className: 'iwb-textbtn iwb-small iwb-settings-reset',
        onClick: () => {
          const reset = resetPatch()
          setDraft({ ...draft, ...reset })
          commit(reset)
        },
      }, t('settings.reset')),
      saving === true
        ? React.createElement('div', { className: 'iwb-settings-saved', role: 'status', 'aria-live': 'polite' }, t('settings.saving'))
        : (saved === true
            ? React.createElement('div', { className: 'iwb-settings-saved', role: 'status', 'aria-live': 'polite' }, t('settings.saved'))
            : null),
    ),
  )
}

/** The native settings.section page: the shell already owns the close action. */
export function SettingsSection({ store, state }) {
  return React.createElement('div', { className: 'iwb-settings-section' },
    React.createElement(SettingsForm, { store, state }),
  )
}
