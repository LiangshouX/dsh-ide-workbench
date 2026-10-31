/**
 * Tool Windows Settings: shortcuts, terminal profile, file tree, Git and
 * appearance. The same form serves the in-workbench modal and the native
 * settings.section page.
 */
import React, { useEffect, useRef, useState } from 'react'
import { ShortcutCapture } from './ui.jsx'
import { IDE_OPTIONS } from './ide-menu.js'

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

export function SettingsForm({ store, state, compact, onStatusChange }) {
  const t = store.t
  const settings = state.settings ?? {}
  /** Language servers the host could not find on this machine. */
  const missingServers = Array.isArray(state.lsp?.servers?.missing) ? state.lsp.servers.missing : []
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
      React.createElement('Row', { label: t('settings.lspEnabled'), hint: t('settings.lspEnabledHint') },
        React.createElement('input', {
          type: 'checkbox',
          checked: draft.lsp?.enabled !== false,
          onChange: event => update({ lsp: { enabled: event.target.checked } }),
        }),
      ),
      React.createElement('Row', { label: t('settings.lspIndexOnOpen'), hint: t('settings.lspIndexOnOpenHint') },
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
      React.createElement('Row', { label: t('settings.lspMemoryLimit'), hint: t('settings.lspMemoryLimitHint') },
        React.createElement('input', {
          type: 'number', min: 256, max: 32768, step: 256,
          value: draft.lsp?.memoryLimitMB ?? 2048,
          onChange: event => update({ lsp: { memoryLimitMB: Number(event.target.value) || 2048 } }),
        }),
      ),
      React.createElement('Row', { label: t('settings.lspFreeMemory'), hint: t('settings.lspFreeMemoryHint') },
        React.createElement('input', {
          type: 'number', min: 256, max: 32768, step: 256,
          value: draft.lsp?.freeMemoryThresholdMB ?? 2048,
          onChange: event => update({ lsp: { freeMemoryThresholdMB: Number(event.target.value) || 2048 } }),
        }),
      ),
      React.createElement('Row', { label: t('settings.lspIdleTimeout'), hint: t('settings.lspIdleTimeoutHint') },
        React.createElement('input', {
          type: 'number', min: 1, max: 240,
          value: Math.round((draft.lsp?.idleTimeoutMs ?? 600000) / 60000),
          onChange: event => update({ lsp: { idleTimeoutMs: (Number(event.target.value) || 10) * 60000 } }),
        }),
      ),
      React.createElement('Row', { label: t('settings.lspRequestTimeout'), hint: t('settings.lspRequestTimeoutHint') },
        React.createElement('input', {
          type: 'number', min: 30000, max: 600000, step: 1000,
          value: draft.lsp?.requestTimeoutMs ?? 30000,
          onChange: event => update({ lsp: { requestTimeoutMs: Math.max(30000, Number(event.target.value) || 30000) } }),
        }),
      ),
      React.createElement('Row', { label: t('settings.lspAutoExit') },
        React.createElement('input', {
          type: 'checkbox',
          checked: draft.lsp?.autoExit !== false,
          onChange: event => update({ lsp: { autoExit: event.target.checked } }),
        }),
      ),
      React.createElement('Row', { label: t('settings.lspAutoRestart') },
        React.createElement('input', {
          type: 'checkbox',
          checked: draft.lsp?.autoRestart !== false,
          onChange: event => update({ lsp: { autoRestart: event.target.checked } }),
        }),
      ),
      // The missing servers are a fact of the machine, not a setting: they are
      // listed so the user knows which language stays in the basic mode.
      missingServers.length > 0
        ? React.createElement('Row', { label: t('settings.lspServersMissing'), hint: t('settings.lspServersMissingHint') },
            React.createElement('span', { className: 'iwb-settings-value' },
              missingServers.map(server => `${server.languageId} (${server.command})`).join(', '),
            ),
          )
        : null,
      React.createElement('div', { className: 'iwb-settings-hint', style: { gridColumn: '1 / -1' } }, t('settings.lspOfflineNote')),
    ),
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
          const reset = {
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
            shortcuts: {
              project: 'Alt+1', commit: 'Alt+0', git: 'Alt+9', terminal: 'Alt+F12',
              focusCommit: 'Ctrl+K', push: 'Ctrl+Shift+K', findInFiles: 'Ctrl+Shift+R', findInFilesAlt: 'Ctrl+Alt+F', openCommitDetail: 'Ctrl+Alt+D', quickOpen: 'Ctrl+Shift+N',
            },
          }
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
