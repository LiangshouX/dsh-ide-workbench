/**
 * Tool Windows Settings: shortcuts, terminal profile, file tree, Git and
 * appearance. The same form serves the in-workbench modal and the native
 * settings.section page.
 */
import React, { useEffect, useRef, useState } from 'react'
import { ShortcutCapture } from './ui.jsx'
import { IDE_OPTIONS } from './ide-menu.js'
import { DEFAULT_LSP_SETTINGS } from '../host/settings-defaults.js'

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

function Row({ label, hint, children }) {
  return React.createElement('div', { className: 'iwb-settings-row' },
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
    lsp: { ...DEFAULT_LSP_SETTINGS, servers: null, indexedRoots: null, memoryWarnedRoots: null },
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

export function SettingsForm({ store, state, compact, onStatusChange }) {
  const t = store.t
  const settings = state.settings ?? {}
  /** Language servers the host could not find on this machine. */
  const missingServers = Array.isArray(state.lsp?.servers?.missing) ? state.lsp.servers.missing : []
  /** Language servers that are switched off in the settings file. */
  const disabledServers = Array.isArray(state.lsp?.servers?.disabled) ? state.lsp.servers.disabled : []
  /** The language servers the host found and that are not switched off. */
  const availableServers = Array.isArray(state.lsp?.servers?.available) ? state.lsp.servers.available : []
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
      React.createElement(SubGroup, { title: t('settings.lspTimeoutGroup') },
        React.createElement(Field, { label: t('settings.lspIdleTimeout'), hint: t('settings.lspIdleTimeoutShort'), title: t('settings.lspIdleTimeoutHint') },
          React.createElement('input', {
            type: 'number', min: 1, max: 240,
            value: Math.round((draft.lsp?.idleTimeoutMs ?? 600000) / 60000),
            onChange: event => update({ lsp: { idleTimeoutMs: (Number(event.target.value) || 10) * 60000 } }),
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
      React.createElement(Row, { label: t('settings.lspAutoExit') },
        React.createElement('input', {
          type: 'checkbox',
          checked: draft.lsp?.autoExit !== false,
          onChange: event => update({ lsp: { autoExit: event.target.checked } }),
        }),
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
      // A language that is switched off in the settings file is a fact of
      // the configuration, not of the machine: it stays in the basic mode.
      disabledServers.length > 0
        ? React.createElement(Row, { label: t('settings.lspServersDisabled'), hint: t('settings.lspServersDisabledHint') },
            React.createElement('span', { className: 'iwb-settings-value' },
              disabledServers.map(server => `${server.languageId} (${server.command})`).join(', '),
            ),
          )
        : null,
      React.createElement('div', { className: 'iwb-settings-hint' }, t('settings.lspOfflineNote')),
      // The memory situation of the machine, as a fact the user can judge:
      // "384 MB needed" is a number, "the machine is short on memory" is a
      // decision. Without an open project there is no language to estimate,
      // so only the free memory is shown.
      lspResources !== null
        ? React.createElement('div', { className: 'iwb-settings-hint' },
            typeof lspResources.languageId === 'string' && lspResources.languageId !== ''
              ? interpolate(t('settings.lspMemoryNow'), {
                  free: Math.round((lspResources.freeBytes ?? 0) / (1024 * 1024)),
                  need: Math.round(lspResources.needMB ?? 0),
                  threshold: Math.round((lspResources.thresholdBytes ?? 0) / (1024 * 1024)),
                  floor: Math.round(lspResources.hardFloorMB ?? 256),
                  language: lspResources.languageId,
                  state: lspResources.tight === true
                    ? t('settings.lspMemoryState.tight')
                    : (lspResources.canIndex === false ? t('settings.lspMemoryState.low') : t('settings.lspMemoryState.ok')),
                })
              : interpolate(t('settings.lspMemoryNowNoProject'), {
                  free: Math.round((lspResources.freeBytes ?? 0) / (1024 * 1024)),
                }),
          )
        : null,
    ),
    // The language servers of the machine, one switch and one ceiling each
    // (SET-02). The field `lsp.servers[languageId].enabled` existed but had
    // no control, and the global ceiling could only lower a language: the
    // user had no way to give one language more than the global cap.
    availableServers.length > 0
      ? React.createElement(Group, { title: t('settings.lspServersGroup'), description: t('settings.lspServersGroupHint') },
          // One line per language, not one settings row per language: a
          // dozen rows of "a switch and a command" is a wall of text.
          React.createElement('div', { className: 'iwb-settings-languages' },
            availableServers.map(server => {
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
                  title: server.resolvedPath ?? server.command,
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
