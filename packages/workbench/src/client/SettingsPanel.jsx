/**
 * Tool Windows Settings: shortcuts, terminal profile, file tree, Git and
 * appearance. The same form serves the in-workbench modal and the native
 * settings.section page.
 *
 * The settings of the code intelligence are NOT here (PRD-v6 §2.2): the
 * language servers, their memory budget and their four shortcuts belong to
 * the codeintel, which brings its own group through the `settingsSection`
 * slot.
 *
 * The page is built on a model (`settings-model.js`): the categories, the
 * settings they hold and the words the filter matches them by live there, so
 * the panel only has to render them. That keeps the filter instant (the
 * index is built once per language, the keystrokes only narrow it) and it
 * keeps the behaviour testable on its own.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ShortcutCapture } from './ui.jsx'
import { SLOT_KEYS } from '../contract/index.js'
import { DEFAULT_ENTRY_SIDE } from './layout.js'
import { useStoreSlice } from './hooks.js'
import {
  SETTINGS_CATEGORIES, buildSearchIndex, countByCategory, filterSettings,
  groupByCategory, pathOf, readSetting,
} from './settings-model.js'

/** The category that shows every setting of the page. */
const ALL = 'all'

/**
 * The id of the control of one setting.
 *
 * The id is stable - it is built from the key of the setting - so the label
 * of a row keeps pointing at its control, and a label that is not bound to
 * its control is a label a screen reader cannot use.
 *
 * @param {string} key the key of the setting
 * @returns {string} the id
 */
function controlId(key) {
  return `iwb-settings-${String(key).replace(/[^A-Za-z0-9_-]/g, '-')}`
}

/**
 * The default cap of the output of one terminal session (8 MiB).
 *
 * The host owns the value and falls back to the same number when the
 * document carries none (PRD-v8 TERM-05). The constant is repeated here
 * because the settings form lives in the browser and the host module reads
 * the file system - it cannot be imported into the client bundle.
 */
const DEFAULT_TERMINAL_OUTPUT_LIMIT = 8 * 1024 * 1024

/**
 * The cap of the output, in MiB - the unit the field speaks.
 * @param {any} bytes the value of the document
 * @returns {number} the cap in MiB, at least one
 */
export function outputLimitMib(bytes) {
  const value = typeof bytes === 'number' || typeof bytes === 'string' ? Number(bytes) : Number.NaN
  const limit = Number.isFinite(value) && value > 0 ? value : DEFAULT_TERMINAL_OUTPUT_LIMIT
  return Math.max(1, Math.round(limit / (1024 * 1024)))
}

/**
 * The cap of the output in bytes.
 * @param {number} mib the cap in MiB
 * @returns {number} the cap in bytes
 */
export function mibToBytes(mib) {
  const value = Number(mib)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TERMINAL_OUTPUT_LIMIT
  return Math.round(value * 1024 * 1024)
}

/**
 * The patch of the "reset to defaults" button.
 *
 * The core resets the sections it owns. The section of the code intelligence
 * is not among them: it lives in the settings document of the codeintel, and
 * the core does not even know that it exists (PRD-v6 D8).
 *
 * The patch is also the table of the defaults of the client: the rows that
 * differ from it are the rows the user changed, and the page marks them.
 * @returns {object} the patch the host merges into the document
 */
export function resetPatch() {
  return {
    git: { path: '', colors: true, commitTemplate: '' },
    idea: { path: '' },
    webstorm: { path: '' },
    vscode: { path: '' },
    terminal: { shell: 'auto', copyOnSelect: false, fontSize: 13, outputLimitBytes: DEFAULT_TERMINAL_OUTPUT_LIMIT },
    project: { alwaysSelectOpened: true, showHidden: true, showIgnored: false, singleClickOpen: false },
    commit: { groupByDirectory: false },
    delete: { useRecycleBin: true },
    editor: { fontSize: 13, highlight: true, openMode: 'auto', editableMaxBytes: 1 << 20, markdownPreview: true },
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
  }
}

/**
 * The defaults of the page, as the paths of the settings document.
 *
 * @returns {Record<string, any>} the default of every setting the page shows
 */
function defaultsByKey() {
  const map = {}
  for (const [section, value] of Object.entries(resetPatch())) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, inner] of Object.entries(value)) map[`${section}.${key}`] = inner
    } else {
      map[section] = value
    }
  }
  return map
}

/** The defaults of the page, computed once. */
const SETTING_DEFAULTS = defaultsByKey()

/**
 * Every leaf of a patch, as the paths of the settings document.
 * @param {any} patch
 * @param {string} [prefix]
 * @returns {string[]} the paths
 */
function leafPaths(patch, prefix = '') {
  const paths = []
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return paths
  for (const [key, value] of Object.entries(patch)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) paths.push(...leafPaths(value, path))
    else paths.push(path)
  }
  return paths
}

/**
 * One block of settings: a titled group of rows.
 *
 * The title is the name of the category, the description is what the whole
 * group is about - it is said once, instead of under every row.
 *
 * @param {{id: string, title: string, description?: string, children: any}} props
 */
function Group({ id, title, description, children }) {
  return React.createElement('section', {
    className: 'iwb-settings-group',
    id: `iwb-settings-group-${id}`,
    'aria-labelledby': `iwb-settings-group-title-${id}`,
  },
    React.createElement('h3', { className: 'iwb-settings-group-title', id: `iwb-settings-group-title-${id}` }, title),
    description !== undefined
      ? React.createElement('p', { className: 'iwb-settings-group-desc' }, description)
      : null,
    React.createElement('div', { className: 'iwb-settings-rows' }, children),
  )
}

/**
 * One settings row: a label with its hint on the left, a control on the right.
 *
 * The label is a real `<label>`: it is bound to the control of the row, so
 * clicking the name of a setting changes it and a screen reader announces
 * the name with the control. The hint is the description of the control
 * (`aria-describedby`), not part of its name.
 *
 * The row is a pure component with stable props, so the filter does not
 * rebuild the rows that stay on the screen.
 *
 * @param {object} props the row
 */
const Row = React.memo(function Row({
  descriptor, label, hint, changed, deferred, failed, external, danger, control, onReset,
}) {
  const id = controlId(descriptor.key)
  const hintId = `${id}-hint`
  return React.createElement('div', {
    className: `iwb-settings-row${failed === true ? ' iwb-settings-row-failed' : ''}`,
    'data-setting': descriptor.key,
  },
    React.createElement('div', { className: 'iwb-settings-label' },
      control.labelable === true
        ? React.createElement('label', { className: 'iwb-settings-title', htmlFor: id }, label)
        : React.createElement('span', { className: 'iwb-settings-title', id: `${id}-label` }, label),
      hint !== '' ? React.createElement('div', { className: 'iwb-settings-hint', id: hintId }, hint) : null,
      React.createElement('div', { className: 'iwb-settings-badges' },
        changed === true
          ? React.createElement('span', { className: 'iwb-settings-badge iwb-settings-badge-changed' }, descriptor.changedLabel)
          : null,
        deferred === true
          ? React.createElement('span', { className: 'iwb-settings-badge iwb-settings-badge-deferred' }, descriptor.deferredLabel)
          : null,
        danger === true
          ? React.createElement('span', { className: 'iwb-settings-badge iwb-settings-badge-danger' }, descriptor.dangerLabel)
          : null,
        external === true
          ? React.createElement('span', { className: 'iwb-settings-badge iwb-settings-badge-external' }, descriptor.externalLabel)
          : null,
        failed === true
          ? React.createElement('span', { className: 'iwb-settings-badge iwb-settings-badge-failed' }, descriptor.failedLabel)
          : null,
        changed === true
          ? React.createElement('button', {
            type: 'button', className: 'iwb-settings-reset-row', title: descriptor.resetLabel,
            'aria-label': descriptor.resetLabel, onClick: () => onReset(descriptor.key),
          }, descriptor.resetLabel)
          : null,
      ),
    ),
    React.createElement('div', {
      className: 'iwb-settings-control',
      role: control.labelable === true ? undefined : 'group',
      'aria-labelledby': control.labelable === true ? undefined : `${id}-label`,
    }, control.element),
  )
})

/**
 * The settings form of the workbench.
 *
 * The `contract` and the `renderSlot` come from the workbench: the settings
 * page is the render point of the `settingsSection` slot (PRD-v6 §3.3), the
 * one that carries the groups of the plugins.
 *
 * The form is memoized: it is a pure component of the settings document, and
 * a change of the store that does not touch the document must not rebuild
 * the page (perf-notify).
 *
 * @param {{store: object, state: object, compact?: boolean, contract?: object, renderSlot?: Function}} props
 */
export const SettingsForm = React.memo(function SettingsForm({
  store, state, settings: settingsProp, shells: shellsProp, localeTick,
  compact, contract = null, renderSlot = null, onStatusChange,
}) {
  const t = store.t
  const settings = settingsProp ?? state?.settings ?? {}
  const shells = shellsProp ?? state?.terminal?.shells ?? []
  // The side is read from the live store state, not from the local draft:
  // this row writes straight through, so the workbench flips while the page
  // is still open and a draft copy would only lag behind it.
  // The live value is the slice the page was given, or the state of the
  // store - the native settings page hands over the slice and no state at
  // all, so the state may not be there.
  const entrySide = settings.layout?.entrySide === 'left' ? 'left' : DEFAULT_ENTRY_SIDE
  const [draft, setDraft] = useState(settings)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failedSave, setFailedSave] = useState(false)
  const [capturing, setCapturing] = useState(null)
  const [filter, setFilter] = useState('')
  const [category, setCategory] = useState(ALL)
  const [resetArmed, setResetArmed] = useState(false)
  const [failedKeys, setFailedKeys] = useState(() => new Set())
  const [externalKeys, setExternalKeys] = useState(() => new Set())
  const timer = useRef(null)
  const savedTimer = useRef(null)
  const resetTimer = useRef(null)
  const rootRef = useRef(null)
  const filterRef = useRef(null)
  const tabRefs = useRef(new Map())
  const scrollRef = useRef({ parent: null, top: 0 })
  /** Settings changed but not yet sent; merged so rapid edits never drop one. */
  const pendingPatch = useRef({})
  /** The draft of the moment, for the callbacks that must not change. */
  const draftRef = useRef(draft)
  draftRef.current = draft
  const alive = useRef(true)

  // The native settings page owns the scroll container around this section.
  // Remember where the user was before a debounced save and put it back after
  // the settings document publishes, so editing a low row does not jump to
  // the top of a long page.
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
    // The document is the truth: a value that changed under the user - in
    // another window, in the settings of the host - is marked, not silently
    // overwritten and not silently ignored.
    const touched = new Set()
    for (const key of Object.keys(SETTING_DEFAULTS)) {
      if (readSetting(settings, key) === undefined) continue
      if (readSetting(draftRef.current, key) !== readSetting(settings, key)) touched.add(key)
    }
    setDraft(settings)
    if (touched.size > 0) {
      setExternalKeys(touched)
      if (savedTimer.current !== null) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => { if (alive.current) setExternalKeys(new Set()) }, 4000)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  // The in-workbench modal renders the feedback in its sticky header; the
  // native settings page reads it from the sticky footer below.
  useEffect(() => {
    onStatusChange?.({ saving, saved, failed: failedSave })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, saved, failedSave])

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
      // Did the write land? The store publishes the document it committed; a
      // value that is not in it never reached the file, and the row says so
      // instead of pretending the change was saved.
      const published = typeof store.getSnapshot === 'function' ? store.getSnapshot().settings : null
      const broken = []
      if (published !== null && published !== undefined) {
        for (const path of leafPaths(patch)) {
          if (readSetting(published, path) !== readSetting(patch, path)) broken.push(path)
        }
      }
      if (broken.length > 0) {
        setFailedKeys(previous => new Set([...previous, ...broken]))
        setFailedSave(true)
      } else {
        setFailedSave(false)
        setSaved(true)
        if (savedTimer.current !== null) clearTimeout(savedTimer.current)
        savedTimer.current = setTimeout(() => { if (alive.current) setSaved(false) }, 1800)
      }
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
      if (resetTimer.current !== null) clearTimeout(resetTimer.current)
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
      ui: { ...draft.ui, ...(patch.ui ?? {}) },
      shortcuts: { ...draft.shortcuts, ...(patch.shortcuts ?? {}) },
    }
    setDraft(next)
    commit(patch)
  }

  /**
   * Change one setting.
   *
   * The callback is stable: the rows are memoized, and a callback that
   * changed with every keystroke would rebuild every row of the page.
   *
   * @param {string} key the key of the setting
   * @param {any} value the new value
   */
  const change = useCallback((key, value) => {
    const path = pathOf(key)
    const section = path[0]
    const leaf = path.slice(1)
    update(leaf.length === 1 ? { [section]: { [leaf[0]]: value } } : { [section]: value })
    // The row that was touched is not "changed elsewhere" any more.
    setExternalKeys(previous => {
      if (!previous.has(key)) return previous
      const next = new Set(previous)
      next.delete(key)
      return next
    })
    setFailedKeys(previous => {
      if (!previous.has(key)) return previous
      const next = new Set(previous)
      next.delete(key)
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  /**
   * Put one setting back to its default.
   * @param {string} key the key of the setting
   */
  const resetOne = useCallback((key) => {
    const fallback = SETTING_DEFAULTS[key]
    if (fallback === undefined) return
    change(key, fallback)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change])

  // ── the index and the filter ────────────────────────────────────────────
  //
  // The index is built once per language and narrowed afterwards: a
  // keystroke walks a list of strings, it never rebuilds the page.
  const index = useMemo(() => buildSearchIndex(t), [t, localeTick])
  const entries = useMemo(() => filterSettings(index.entries, filter), [index, filter])
  const counts = useMemo(() => countByCategory(entries), [entries])
  const visible = useMemo(
    () => (category === ALL ? entries : entries.filter(entry => entry.category === category)),
    [entries, category],
  )
  const groups = useMemo(() => groupByCategory(visible), [visible])

  /** The categories the bar shows: every one, or only the ones with hits. */
  const tabs = useMemo(() => {
    const list = [{ id: ALL, label: t('settings.categoryAll'), count: counts.total }]
    for (const item of SETTINGS_CATEGORIES) {
      const count = counts.byCategory[item.id] ?? 0
      if (filter !== '' && count === 0) continue
      list.push({ id: item.id, label: t(item.labelKey), count })
    }
    return list
  }, [counts, filter, t])

  /** Move the selection of the category bar. */
  const selectTab = useCallback((id, focus = false) => {
    setCategory(id)
    const node = tabRefs.current.get(id)
    if (node === undefined || node === null) return
    // The bar scrolls sideways instead of wrapping, so a category that is
    // out of sight has to be brought into it - otherwise the user picks a
    // category and sees nothing happen.
    if (typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    if (focus) node.focus()
  }, [])

  /**
   * The keyboard of the category bar.
   *
   * The bar is a tablist: the arrow keys walk it, Home and End jump to its
   * ends. There is no trap - Tab leaves the bar as it does everywhere else.
   *
   * @param {any} event the key event
   */
  const onTabKeyDown = useCallback((event) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const current = tabs.findIndex(tab => tab.id === category)
    let next = current
    if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + tabs.length) % tabs.length
    else next = (current + 1) % tabs.length
    selectTab(tabs[next].id, true)
  }, [tabs, category, selectTab])

  /**
   * The keyboard of the filter.
   *
   * Escape clears the filter - and only leaves the field when the filter is
   * already empty, so a stray Escape never throws away a half-written word
   * and a second one leaves the field.
   *
   * @param {any} event the key event
   */
  const onFilterKeyDown = useCallback((event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (filter !== '') {
      setFilter('')
      return
    }
    if (typeof event.currentTarget?.blur === 'function') event.currentTarget.blur()
  }, [filter])

  /** The keyboard of the page: "/" puts the cursor into the filter. */
  const onRootKeyDown = useCallback((event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
    const target = event.target
    const tag = target instanceof Element ? target.tagName : ''
    // A field that takes text keeps the slash: the user is typing there.
    if (tag === 'TEXTAREA') return
    if (tag === 'INPUT') {
      const type = (target.getAttribute('type') ?? 'text').toLowerCase()
      if (!['checkbox', 'radio', 'button', 'submit', 'reset'].includes(type)) return
    }
    if (target instanceof Element && target.isContentEditable === true) return
    event.preventDefault()
    filterRef.current?.focus()
    filterRef.current?.select?.()
  }, [])

  /** The control of one setting. */
  const controlOf = useCallback((descriptor, value) => {
    const spec = descriptor.control
    const id = controlId(descriptor.key)
    const hintId = `${id}-hint`
    const labelable = spec.type !== 'shortcut' && spec.type !== 'value'
    const described = descriptor.hintKey === undefined ? undefined : hintId
    switch (spec.type) {
      case 'checkbox':
        return {
          labelable,
          element: React.createElement('input', {
            type: 'checkbox', id, checked: value === true,
            'aria-describedby': described,
            onChange: event => change(descriptor.key, event.target.checked),
          }),
        }
      case 'text':
        return {
          labelable,
          element: React.createElement('input', {
            type: 'text', id, className: 'iwb-input',
            value: typeof value === 'string' ? value : '',
            placeholder: spec.placeholder ?? (spec.placeholderKey === undefined ? '' : t(spec.placeholderKey)),
            'aria-describedby': described,
            onChange: event => change(descriptor.key, event.target.value),
          }),
        }
      case 'number': {
        const factor = spec.view === 'mib' ? 1024 * 1024 : spec.view === 'kb' ? 1024 : 1
        const shown = typeof value === 'number' && Number.isFinite(value) ? Math.round(value / factor) : ''
        return {
          labelable,
          element: React.createElement('input', {
            type: 'number', id, min: spec.min, max: spec.max, step: spec.step ?? 1,
            value: shown,
            'aria-describedby': described,
            onChange: event => {
              const number = Number(event.target.value)
              change(descriptor.key, Number.isFinite(number) ? number * factor : 0)
            },
          }),
        }
      }
      case 'select': {
        const options = spec.optionsFrom === 'shells'
          ? [{ value: 'auto', labelKey: 'settings.auto' }, ...shells.map(shell => ({ value: shell.id, label: shell.label }))]
          : spec.options
        // The row that writes through: the root class of the workbench
        // follows the saved settings, so the entries move as the user picks
        // a side instead of waiting for the debounced form save.
        const live = descriptor.writeThrough === 'entrySide'
        const write = event => {
          if (live) {
            void store.updateSettings({ layout: { entrySide: event.target.value === 'left' ? 'left' : 'right' } })
            return
          }
          change(descriptor.key, event.target.value)
        }
        const control = live
          ? { id, className: 'iwb-input', value: entrySide, 'aria-describedby': described, onChange: write }
          : {
            id,
            className: 'iwb-input',
            value: typeof value === 'string' ? value : '',
            'aria-describedby': described,
            onChange: write,
          }
        return {
          labelable,
          element: React.createElement('select', control, options.map(option => React.createElement('option', {
            key: option.value, value: option.value,
          }, option.label !== undefined ? option.label : t(option.labelKey)))),
        }
      }
      case 'shortcut':
        return {
          labelable,
          element: React.createElement(ShortcutCapture, {
            value: typeof value === 'string' ? value : '',
            active: capturing === descriptor.key,
            onActivate: active => setCapturing(active ? descriptor.key : null),
            onCapture: next => change(descriptor.key, next),
            pressText: t('settings.pressKeys'),
            hint: t('settings.recordShortcutHint'),
          }),
        }
      default:
        return {
          labelable,
          element: React.createElement('span', { className: 'iwb-settings-value' }, t('settings.followDsh')),
        }
    }
  }, [change, capturing, entrySide, shells, store, t])

  // The rows of one group. They are built once per filter change, and the
  // rows that stay on the screen keep their props - so a keystroke in the
  // filter does not rebuild them.
  const rowOf = useCallback((entry) => {
    const descriptor = index.byKey[entry.key]
    const value = readSetting(draft, entry.key)
    const fallback = SETTING_DEFAULTS[entry.key]
    const changed = fallback !== undefined && value !== undefined && value !== fallback
    return React.createElement(Row, {
      key: entry.key,
      descriptor: {
        ...descriptor,
        changedLabel: t('settings.changedBadge'),
        deferredLabel: t('settings.deferredBadge'),
        externalLabel: t('settings.externalBadge'),
        failedLabel: t('settings.failedBadge'),
        dangerLabel: t('settings.dangerBadge'),
        resetLabel: t('settings.resetOne'),
      },
      label: entry.label,
      hint: entry.hint,
      changed,
      deferred: descriptor.defer === 'sessions',
      failed: failedKeys.has(entry.key),
      external: externalKeys.has(entry.key),
      danger: descriptor.danger === true && value === false,
      control: controlOf(descriptor, value),
      onReset: resetOne,
    })
  }, [index, draft, failedKeys, externalKeys, controlOf, resetOne, t])

  // The groups of the page, in the order of the categories.
  const blocks = useMemo(() => groups.map(group => {
    const description = group.category.id === 'shortcuts'
      ? t('settings.shortcutsGroupHint')
      : group.category.id === 'ide' ? t('settings.idePathHint') : undefined
    return React.createElement(Group, {
      key: group.category.id,
      id: group.category.id,
      title: t(group.category.labelKey),
      description,
    }, group.entries.map(entry => rowOf(entry)))
  }), [groups, rowOf, t])

  const density = draft.ui?.density === 'compact' ? 'compact' : 'comfortable'

  /**
   * Put every setting back to its default.
   *
   * The button asks first: the reset touches every setting of the core at
   * once, and a setting the user spent an afternoon on is gone in one click
   * without a way back.
   */
  const armReset = useCallback(() => {
    setResetArmed(true)
    if (resetTimer.current !== null) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => { if (alive.current) setResetArmed(false) }, 8000)
  }, [])

  const doReset = useCallback(() => {
    const reset = resetPatch()
    setDraft({ ...draftRef.current, ...reset })
    commit(reset)
    setResetArmed(false)
    if (resetTimer.current !== null) clearTimeout(resetTimer.current)
    store.toast?.('success', t('settings.resetDone'), '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, t])

  // A settings group is a titled block of rows. The description is shared by
  // every row (instead of repeating the same hint under each control).
  // Label and hint form the reading column; every control sits in the same
  // right-hand column so switches, selects and text fields line up.
  return React.createElement('div', {
    className: `iwb-settings iwb-settings-${density}`,
    ref: rootRef,
    onKeyDown: onRootKeyDown,
  },
    // ── the header: the filter, the categories and the reset ─────────────
    React.createElement('div', { className: 'iwb-settings-header' },
      React.createElement('div', { className: 'iwb-settings-header-row' },
        React.createElement('div', { className: 'iwb-settings-search', role: 'search' },
          React.createElement('input', {
            ref: filterRef,
            type: 'search',
            id: 'iwb-settings-filter',
            className: 'iwb-settings-filter',
            placeholder: t('settings.filterPlaceholder'),
            'aria-label': t('settings.filterLabel'),
            'aria-controls': 'iwb-settings-panel',
            value: filter,
            onChange: event => setFilter(event.target.value),
            onKeyDown: onFilterKeyDown,
          }),
          React.createElement('span', {
            className: 'iwb-settings-count', role: 'status', 'aria-live': 'polite',
          }, `${counts.total} ${filter === '' ? t('settings.countAll') : t('settings.countMatches')}`),
        ),
        resetArmed === true
          ? React.createElement('div', { className: 'iwb-settings-reset-confirm' },
            React.createElement('span', null, t('settings.resetConfirm')),
            React.createElement('button', {
              type: 'button', className: 'iwb-textbtn iwb-small iwb-danger-solid',
              onClick: doReset,
            }, t('settings.resetConfirmYes')),
            React.createElement('button', {
              type: 'button', className: 'iwb-textbtn iwb-small',
              onClick: () => { setResetArmed(false); if (resetTimer.current !== null) clearTimeout(resetTimer.current) },
            }, t('common.cancel')),
          )
          : React.createElement('button', {
            type: 'button', className: 'iwb-textbtn iwb-small iwb-settings-reset',
            title: t('settings.resetTitle'), 'aria-label': t('settings.resetTitle'),
            onClick: armReset,
          }, t('settings.reset')),
      ),
      React.createElement('div', {
        className: 'iwb-settings-tabs', role: 'tablist', 'aria-label': t('settings.categoriesLabel'),
        onKeyDown: onTabKeyDown,
      }, tabs.map(tab => React.createElement('button', {
        key: tab.id,
        type: 'button',
        role: 'tab',
        id: `iwb-settings-tab-${tab.id}`,
        className: 'iwb-settings-tab',
        'aria-selected': category === tab.id,
        'aria-controls': 'iwb-settings-panel',
        tabIndex: category === tab.id ? 0 : -1,
        ref: node => { if (node === null) tabRefs.current.delete(tab.id); else tabRefs.current.set(tab.id, node) },
        onClick: () => selectTab(tab.id),
      }, tab.label,
        React.createElement('span', { className: 'iwb-settings-tab-count' }, String(tab.count))))),
    ),
    // ── the panel: the rows of the selected category ──────────────────────
    React.createElement('div', {
      className: 'iwb-settings-panel',
      id: 'iwb-settings-panel',
      role: 'tabpanel',
      'aria-labelledby': `iwb-settings-tab-${category}`,
      // The panel holds the controls of the rows: it is named by its tab and
      // it is not a stop of the tab order (the controls are).
      tabIndex: -1,
    },
      blocks.length === 0
        ? React.createElement('div', { className: 'iwb-settings-empty' },
          React.createElement('p', { className: 'iwb-settings-empty-title' },
            t('settings.emptyTitle'),
            React.createElement('code', { className: 'iwb-settings-empty-query' }, filter)),
          React.createElement('p', { className: 'iwb-settings-empty-hint' }, t('settings.emptyHint')),
          React.createElement('button', {
            type: 'button', className: 'iwb-textbtn iwb-small',
            onClick: () => { setFilter(''); selectTab(ALL) },
          }, t('settings.emptyClear')),
        )
        : blocks,
      // The settings groups of the plugins (PRD-v6 §3.3). The codeintel brings
      // its language-server group here; the core does not know who occupies
      // the slot. The slot is part of the full page - a single category is a
      // view of the core's own settings.
      category === ALL && renderSlot !== null && contract !== null
        ? renderSlot(SLOT_KEYS.settingsSection, { contract })
        : null,
    ),
    compact === true ? null : React.createElement('div', { className: 'iwb-settings-footer' },
      saving === true
        ? React.createElement('div', { className: 'iwb-settings-saved', role: 'status', 'aria-live': 'polite' }, t('settings.saving'))
        : (failedSave === true
          ? React.createElement('div', { className: 'iwb-settings-saved iwb-settings-saved-failed', role: 'status', 'aria-live': 'polite' }, t('settings.saveFailed'))
          : (saved === true
            ? React.createElement('div', { className: 'iwb-settings-saved', role: 'status', 'aria-live': 'polite' }, t('settings.saved'))
            : null)),
    ),
  )
})

/**
 * The native settings.section page: the shell already owns the close action.
 *
 * The page reads the two slices it needs instead of the whole store: the
 * settings document and the list of the shells. Every other change of the
 * store leaves the page alone.
 *
 * @param {{store: object, state: object}} props
 */
export function SettingsSection({ store, state }) {
  const settings = useStoreSlice(store, current => current.settings)
  const shells = useStoreSlice(store, current => current.terminal?.shells)
  const localeTick = useStoreSlice(store, current => current.localeTick)
  // Only the three slices the page reads are handed to the form: the rest of
  // the state of the store (a terminal chunk, a toast) must not rebuild it.
  return React.createElement(SettingsForm, { store, settings, shells, localeTick })
}
