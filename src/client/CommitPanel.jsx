/**
 * Commit tool window — JetBrains model.
 *
 *   Changes / Unversioned Files
 *     checkbox = "include in this commit"; the row never changes group
 *     (checking stages the file, unchecking restages it);
 *     optional Group by Directory and client-side Changelists;
 *     double click opens the Change View, right click the file actions.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ContextMenu } from './ui.jsx'
import { FileTypeIcon, IconRefresh } from './icons.jsx'
import { headerState, groupByChangelist, groupByDirectory, changelistOf, DEFAULT_CHANGELIST } from './commit-model.js'
import { dirName } from './util.js'
import { shallowEqual, useStoreSlice } from './hooks.js'

/**
 * Fields of the workbench state the Commit panel renders.
 *
 * `entries` is part of the slice even though the groups are read through the
 * store getters: the panel has to re-render when the changed-file list moves.
 * `workspaceRoot` is there for the same reason — the changelists live under
 * the workspace key in the settings.
 *
 * @param {object} state workbench state
 * @returns {object} the panel's slice
 */
export function commitSlice(state) {
  return {
    commit: state.commit,
    entries: state.status.entries,
    isRepo: state.status.isRepo,
    branch: state.status.branch,
    detached: state.status.detached,
    oid: state.status.oid,
    settings: state.settings,
    workspaceRoot: state.workspaceRoot,
  }
}

function LineStats({ stats }) {
  if (stats === undefined || stats === null) return null
  if (stats.binary === true) return React.createElement('span', { className: 'iwb-file-stat' }, 'bin')
  return React.createElement('span', { className: 'iwb-file-stat' },
    React.createElement('span', { className: 'iwb-additions' }, `+${stats.additions}`),
    React.createElement('span', { className: 'iwb-deletions' }, `-${stats.deletions}`),
  )
}

/** One changed file row: checkbox, icon, name, folder, stats, status letter. */
function FileRow({ store, selected, entry, checked, onOpen, onMenu }) {
  const name = entry.path.split(/[\\/]/).pop()
  const parent = dirName(entry.path)
  const stats = entry.staged ? entry.stagedLines : entry.unstagedLines
  const letter = entry.conflict === true ? '!' : entry.untracked === true ? 'U' : (entry.xy ?? '').replace(/\./g, '')
  return React.createElement('div', {
    className: `iwb-file-row ${selected ? 'iwb-selected' : ''} ${entry.untracked === true ? 'iwb-file-untracked' : ''} ${entry.conflict === true ? 'iwb-file-conflict' : ''}`,
    title: entry.path,
    onClick: () => store.patch('commit', { selectedPath: entry.path }),
    onDoubleClick: () => onOpen(entry),
    onContextMenu: event => onMenu(event, entry),
  },
    React.createElement('input', {
      type: 'checkbox',
      checked,
      disabled: entry.conflict === true,
      title: store.t('commit.check'),
      style: { accentColor: 'var(--iwb-accent)', margin: 0 },
      onClick: event => event.stopPropagation(),
      onChange: () => { void store.toggleCommitEntry(entry) },
    }),
    React.createElement(FileTypeIcon, { path: name, size: 14 }),
    React.createElement('span', { className: 'iwb-file-name', style: entry.conflict === true ? { color: 'var(--iwb-error)' } : undefined }, name),
    parent !== '' ? React.createElement('span', { className: 'iwb-file-dir' }, parent) : null,
    React.createElement('span', { className: 'iwb-file-status' }, letter),
    React.createElement(LineStats, { stats }),
  )
}

/** Group header with a tri-state "include all" checkbox. */
function GroupHeader({ store, title, entries, checkedPaths }) {
  const ref = useRef(null)
  const tri = headerState(entries, checkedPaths)
  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = tri === 'some'
  }, [tri])
  return React.createElement('div', { className: 'iwb-group-header' },
    React.createElement('input', {
      ref,
      type: 'checkbox',
      checked: tri === 'all',
      disabled: entries.length === 0,
      title: tri === 'all' ? store.t('commit.uncheckAll') : store.t('commit.checkAll'),
      style: { accentColor: 'var(--iwb-accent)', margin: 0 },
      onChange: () => { void store.setCommitChecked(entries, tri !== 'all') },
    }),
    React.createElement('span', null, title),
    React.createElement('span', { className: 'iwb-count' }, entries.length),
  )
}

/** One directory heading inside a group (Group by Directory). */
function DirectorySection({ store, dir, entries, checkedPaths, selectedPath, onOpen, onMenu }) {
  return React.createElement('div', { className: 'iwb-dir-section' },
    React.createElement('div', { className: 'iwb-dir-heading' }, dir === '' ? store.t('common.root') : dir),
    entries.map(entry => React.createElement(FileRow, {
      key: entry.path, store, selected: selectedPath === entry.path, entry,
      checked: checkedPaths.has(entry.path), onOpen, onMenu,
    })),
  )
}

export function CommitPanel({ store, state }) {
  const t = store.t
  // `state` is still accepted (the Workbench cleanup drops the prop in a
  // parallel step) but the panel reads its own slice from now on.
  const slice = useStoreSlice(store, commitSlice, shallowEqual)
  const groups = store.commitGroups
  const commit = slice.commit
  const checkedPaths = store.checkedCommitPaths
  const changelists = store.changelists
  const groupByDir = slice.settings?.commit?.groupByDirectory === true
  const textareaRef = useRef(null)
  const initial = slice.oid === undefined
  const [menu, setMenu] = useState(null)
  const [dialog, setDialog] = useState(null)
  const history = useMemo(() => commit.messages.map(message => ({
    value: message,
    label: message.split('\n')[0].slice(0, 70),
  })), [commit.messages])

  useEffect(() => {
    if ((commit.focusTick ?? 0) > 0) {
      window.setTimeout(() => {
        const element = textareaRef.current
        if (element !== null) {
          element.focus()
          element.setSelectionRange(element.value.length, element.value.length)
        }
      }, 30)
    }
  }, [commit.focusTick])

  const canCommit = commit.committing !== true && (checkedPaths.size > 0 || commit.amend === true)
  const commitSettings = slice.settings?.commit ?? {}
  const taskDefs = [
    ['tests', t('commit.taskTests'), commitSettings.testCommand],
    ['optimize', t('commit.taskOptimize'), commitSettings.optimizeImportsCommand],
    ['cleanup', t('commit.taskCleanup'), commitSettings.cleanupCommand],
  ].filter(([, , command]) => typeof command === 'string' && command.trim() !== '')
  const customLists = Object.keys(changelists.lists).filter(name => name !== DEFAULT_CHANGELIST)

  const openChange = (entry) => {
    if (entry.untracked === true) store.openDiff({ path: entry.path, untracked: true })
    else store.openDiff({ path: entry.path, against: 'head' })
  }

  const openMenuFor = (event, entry) => {
    event.preventDefault()
    event.stopPropagation()
    store.patch('commit', { selectedPath: entry.path })
    setMenu({ x: event.clientX, y: event.clientY, entry })
  }

  const rollback = () => {
    const selected = store.changedEntries.filter(entry => entry.path === commit.selectedPath)
    const entries = selected.length > 0 ? selected : store.changedEntries.filter(entry => checkedPaths.has(entry.path))
    if (entries.length === 0) return
    store.askConfirm(
      t('commit.rollbackTitle'),
      `${t('commit.discardBody')}\n${entries.length}`,
      t('commit.rollback'),
      () => { void store.discardEntries(entries) },
    )
  }

  const menuItems = useMemo(() => {
    if (menu === null) return []
    const entry = menu.entry
    const patchEntry = { path: entry.path, untracked: entry.untracked === true }
    const items = [
      { key: 'show', text: t('commit.showDiff'), action: () => openChange(entry) },
      { key: 'jump', text: t('commit.jumpToSource'), shortcut: slice.settings?.shortcuts?.jumpToSource ?? 'F4', action: () => store.jumpToSource(entry.path) },
      null,
      {
        key: 'changelist', text: t('commit.moveToChangelist'),
        submenu: [
          ...customLists.map(name => ({ key: `cl-${name}`, text: name, action: () => { void store.moveToChangelist([entry.path], name) } })),
          { key: 'cl-default', text: DEFAULT_CHANGELIST, action: () => { void store.moveToChangelist([entry.path], DEFAULT_CHANGELIST) } },
          { key: 'cl-new', text: t('commit.newChangelist'), action: () => setDialog({ kind: 'changelist', name: '', paths: [entry.path] }) },
        ],
      },
      entry.untracked === true
        ? { key: 'ignore', text: t('commit.addToIgnore'), action: () => { void store.ignoreEntry(entry.path) } }
        : null,
      null,
      { key: 'revert', text: t('commit.revert'), danger: true, action: () => store.revertChange(patchEntry) },
    ]
    return items
  }, [menu, customLists.join('|'), t, slice.settings?.shortcuts])

  const renderEntries = (entries) => {
    if (entries.length === 0) return null
    if (!groupByDir) {
      return entries.map(entry => React.createElement(FileRow, {
        key: entry.path, store, selected: commit.selectedPath === entry.path, entry,
        checked: checkedPaths.has(entry.path), onOpen: openChange, onMenu: openMenuFor,
      }))
    }
    return groupByDirectory(entries).map(section => React.createElement(DirectorySection, {
      key: section.dir, store, dir: section.dir, entries: section.entries,
      checkedPaths, selectedPath: commit.selectedPath, onOpen: openChange, onMenu: openMenuFor,
    }))
  }

  const activeList = changelists.active ?? DEFAULT_CHANGELIST
  const visibleChanges = groups.changes.filter(entry => changelistOf(entry.path, changelists.lists) === activeList)
  const changesBody = visibleChanges.length === 0
    ? React.createElement('div', { className: 'iwb-group-empty' }, t('commit.noChangesGroup'))
    : (activeList === DEFAULT_CHANGELIST
        ? renderEntries(visibleChanges)
        : React.createElement('div', { className: 'iwb-changelist' },
            React.createElement('div', { className: 'iwb-changelist-head' }, activeList, React.createElement('span', { className: 'iwb-count' }, visibleChanges.length)),
            renderEntries(visibleChanges),
          ))

  return React.createElement('div', { className: 'iwb-commit' },
    React.createElement('div', { className: 'iwb-panel-header' },
      React.createElement('span', { className: 'iwb-panel-title' }, t('commit.title')),
      slice.isRepo === true
        ? React.createElement('span', { className: 'iwb-panel-sub' }, slice.detached === true ? t('git.detached') : (slice.branch ?? ''))
        : React.createElement('span', { className: 'iwb-panel-sub' }, t('welcome.noRepo')),
      React.createElement('span', { className: 'iwb-spacer' }),
      React.createElement('button', {
        type: 'button',
        className: `iwb-iconbtn ${groupByDir ? 'iwb-on' : ''}`,
        title: t('commit.groupByDirectoryHint'),
        onClick: () => { void store.setGroupByDirectory(!groupByDir) },
      }, '▤'),
      React.createElement('button', {
        type: 'button', className: 'iwb-iconbtn', title: t('common.refresh'),
        onClick: () => { void store.refreshStatus({ initial: true }); void store.loadCommitMessages() },
      }, React.createElement(IconRefresh, { width: 14, height: 14 })),
    ),
    slice.isRepo !== true
      ? React.createElement('div', { className: 'iwb-commit-hint' },
          React.createElement('span', null, t('project.noRepoHint')),
          React.createElement('button', {
            type: 'button', className: 'iwb-textbtn iwb-small',
            onClick: () => store.openProjectPicker(),
          }, t('project.chooseRepo')),
        )
      : null,
    React.createElement('div', { className: 'iwb-commit-message' },
      React.createElement('textarea', {
        ref: textareaRef,
        placeholder: slice.settings?.git?.commitTemplate || t('commit.messagePlaceholder'),
        value: commit.message,
        spellCheck: false,
        onChange: event => store.setCommitMessage(event.target.value),
        onKeyDown: event => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canCommit) {
            event.preventDefault()
            void store.commit(commit.message, commit.amend, false)
          }
        },
      }),
      React.createElement('div', { className: 'iwb-commit-actions' },
        React.createElement('label', { className: 'iwb-check', title: initial ? t('commit.amendDisabled') : t('commit.amend') },
          React.createElement('input', {
            type: 'checkbox', checked: commit.amend, disabled: initial,
            onChange: event => store.setAmend(event.target.checked),
          }),
          t('commit.amend'),
        ),
        React.createElement('select', {
          className: 'iwb-select',
          style: { maxWidth: 120 },
          value: '',
          title: t('commit.history'),
          disabled: history.length === 0,
          onChange: event => { if (event.target.value !== '') store.setCommitMessage(event.target.value) },
        },
          React.createElement('option', { value: '' }, t('commit.history')),
          history.map(item => React.createElement('option', { key: item.value, value: item.value }, item.label)),
        ),
        React.createElement('span', { className: 'iwb-spacer' }),
        React.createElement('button', {
          type: 'button',
          className: 'iwb-textbtn iwb-primary iwb-small',
          disabled: !canCommit,
          onClick: () => { void store.commit(commit.message, commit.amend, false) },
        }, commit.committing ? t('common.loading') : t('commit.commit')),
        React.createElement('button', {
          type: 'button',
          className: 'iwb-textbtn iwb-small',
          disabled: !canCommit,
          onClick: () => { void store.commit(commit.message, commit.amend, true) },
        }, t('commit.commitAndPush')),
      ),
      taskDefs.length > 0
        ? React.createElement('div', { className: 'iwb-commit-tasks' },
            taskDefs.map(([key, label, command]) => React.createElement('label', {
              key, className: 'iwb-check', title: command,
            },
              React.createElement('input', {
                type: 'checkbox',
                checked: commit.tasks?.[key] === true,
                onChange: event => store.setCommitTask(key, event.target.checked),
              }),
              label,
            )),
          )
        : null,
      commit.error !== null && commit.error !== undefined
        ? React.createElement('div', { className: 'iwb-error-box', style: { margin: '8px 0 0' } }, commit.error)
        : null,
    ),
    React.createElement('div', { className: 'iwb-commit-toolbar' },
      React.createElement('select', {
        className: 'iwb-select',
        value: changelists.active,
        title: t('commit.changelist'),
        onChange: event => { void store.setActiveChangelist(event.target.value) },
      },
        React.createElement('option', { value: DEFAULT_CHANGELIST }, DEFAULT_CHANGELIST),
        customLists.map(name => React.createElement('option', { key: name, value: name }, name)),
      ),
      React.createElement('button', {
        type: 'button', className: 'iwb-textbtn iwb-small', title: t('commit.newChangelist'),
        onClick: () => setDialog({ kind: 'changelist', name: '', paths: [] }),
      }, '+'),
      activeList !== DEFAULT_CHANGELIST
        ? React.createElement('button', {
            type: 'button', className: 'iwb-textbtn iwb-small iwb-danger', title: t('commit.deleteChangelist'),
            onClick: () => store.askChoice(
              t('commit.deleteChangelist'),
              t('commit.deleteChangelistBody'),
              [
                { key: 'cancel', label: t('common.cancel'), action: () => {} },
                {
                  key: 'delete', label: t('commit.deleteChangelist'), danger: true,
                  action: () => { void store.deleteChangelist(activeList) },
                },
              ],
            ),
          }, '×')
        : null,
      React.createElement('span', { className: 'iwb-spacer' }),
      React.createElement('button', {
        type: 'button', className: 'iwb-textbtn iwb-small iwb-danger', title: t('commit.rollback'),
        disabled: checkedPaths.size === 0 && commit.selectedPath === '',
        onClick: rollback,
      }, t('commit.rollback')),
    ),
    React.createElement('div', { className: 'iwb-groups' },
      React.createElement('div', { className: 'iwb-group' },
        React.createElement(GroupHeader, { store, title: t('commit.changes'), entries: visibleChanges, checkedPaths }),
        changesBody,
      ),
      React.createElement('div', { className: 'iwb-group' },
        React.createElement(GroupHeader, { store, title: t('commit.unversioned'), entries: groups.unversioned, checkedPaths }),
        groups.unversioned.length === 0
          ? React.createElement('div', { className: 'iwb-group-empty' }, t('commit.noUnversioned'))
          : renderEntries(groups.unversioned),
      ),
    ),
    menu !== null ? React.createElement(ContextMenu, { x: menu.x, y: menu.y, items: menuItems, onClose: () => setMenu(null) }) : null,
    dialog !== null
      ? React.createElement('div', { className: 'iwb-modal-backdrop', onMouseDown: event => { if (event.target === event.currentTarget) setDialog(null) } },
          React.createElement('div', { className: 'iwb-modal', role: 'dialog', 'aria-modal': 'true' },
            React.createElement('h2', null, t('commit.newChangelist')),
            React.createElement('label', { className: 'iwb-field' },
              React.createElement('span', null, t('commit.changelistName')),
              React.createElement('input', {
                autoFocus: true,
                value: dialog.name,
                onChange: event => setDialog({ ...dialog, name: event.target.value }),
                onKeyDown: event => {
                  event.stopPropagation()
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    const name = dialog.name.trim()
                    setDialog(null)
                    if (name !== '') void store.createChangelist(name, dialog.paths)
                  }
                  if (event.key === 'Escape') setDialog(null)
                },
              }),
            ),
            React.createElement('div', { className: 'iwb-modal-actions' },
              React.createElement('button', { type: 'button', className: 'iwb-textbtn', onClick: () => setDialog(null) }, t('common.cancel')),
              React.createElement('button', {
                type: 'button', className: 'iwb-textbtn iwb-primary',
                onClick: () => {
                  const name = dialog.name.trim()
                  setDialog(null)
                  if (name !== '') void store.createChangelist(name, dialog.paths)
                },
              }, t('project.create')),
            ),
          ),
        )
      : null,
  )
}
