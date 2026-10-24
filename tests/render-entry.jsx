/**
 * SSR render smoke: mounts the actual workbench tree with a fabricated store
 * so component/reference errors surface without a browser. Effects do not run
 * in `renderToStaticMarkup`, which is exactly the render-only contract here.
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkbenchStore } from '../src/client/store.js'
import { Workbench } from '../src/client/Workbench.jsx'
import { EditorArea } from '../src/client/EditorArea.jsx'
import { DiffView } from '../src/client/DiffView.jsx'
import { SettingsForm } from '../src/client/SettingsPanel.jsx'
import { MarkdownView } from '../src/client/MarkdownView.jsx'
export { apply as applyClient, inject as clientInject } from '../src/client/index.jsx'

const t = (key) => key

function baseStore() {
  const ctx = {
    locale: { subscribe: () => () => {}, bind: () => t },
    layout: { selectPanel: () => {} },
  }
  const store = new WorkbenchStore(ctx, t)
  store.state = {
    ...store.state,
    phase: 'ready',
    workspaceRoot: 'C:\\work\\demo',
    root: 'C:\\work\\demo',
    projects: [{ path: 'C:\\work\\demo', name: 'demo', isRoot: true, isRepo: true }],
    projectPicker: false,
    active: true,
    settings: {
      lastRoot: 'C:\\work\\demo',
      git: { path: '', colors: true, commitTemplate: '' },
      terminal: { shell: 'auto', copyOnSelect: false },
      project: { alwaysSelectOpened: true, showHidden: true },
      editor: { fontSize: 13, highlight: true },
      shortcuts: { project: 'Alt+1', commit: 'Alt+0', git: 'Alt+9', terminal: 'Alt+F12', focusCommit: 'Ctrl+K', push: 'Ctrl+Shift+K' },
      workspaceState: {},
    },
    workspaces: [{ id: 'w1', path: 'C:\\work\\demo', title: 'demo', updatedAt: '2026-10-21T00:00:00Z' }],
    dirs: new Map([
      ['C:\\work\\demo', {
        loading: false,
        entries: [
          { name: 'src', path: 'C:\\work\\demo\\src', rel: 'src', isDir: true, isSymlink: false, hidden: false, size: 0, mtimeMs: 0, ext: '' },
          { name: 'a.ts', path: 'C:\\work\\demo\\a.ts', rel: 'a.ts', isDir: false, isSymlink: false, hidden: false, size: 10, mtimeMs: 0, ext: '.ts' },
        ],
      }],
      ['C:\\work\\demo\\src', {
        loading: false,
        entries: [
          { name: 'main.ts', path: 'C:\\work\\demo\\src\\main.ts', rel: 'src/main.ts', isDir: false, isSymlink: false, hidden: false, size: 10, mtimeMs: 0, ext: '.ts' },
        ],
      }],
    ]),
    expanded: new Set(['C:\\work\\demo']),
    status: {
      isRepo: true,
      branch: 'main',
      detached: false,
      ahead: 1,
      behind: 0,
      entries: [
        { path: 'a.ts', xy: '.M', untracked: false, conflict: false, staged: false, unstaged: true, stagedLines: undefined, unstagedLines: { additions: 2, deletions: 1 } },
        { path: 'b.ts', xy: 'A.', untracked: false, conflict: false, staged: true, unstaged: false, stagedLines: { additions: 4, deletions: 0 } },
        { path: 'new.txt', xy: '??', untracked: true, conflict: false, staged: false, unstaged: false },
      ],
    },
  }
  return store
}

const SAMPLE_DIFF = `diff --git a/a.ts b/a.ts
index 1111111..2222222 100644
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
 const a = 1
-const b = 2
+const b = 3
+const c = 4
`

export function renderFullscreen() {
  return renderToStaticMarkup(React.createElement(Workbench, { store: baseStore(), fullscreen: true }))
}

export function renderProject() {
  const store = baseStore()
  return renderToStaticMarkup(React.createElement(Workbench, { store }))
}

export function renderCommitAndGit() {
  const store = baseStore()
  store.state.layout = { left: 'commit', leftWidth: 300, bottom: 'git', bottomHeight: 260 }
  store.state.git = {
    ...store.state.git,
    commits: [
      { hash: 'aaa', shortHash: 'aaa', parents: ['bbb'], author: 'Ann', email: 'a@x', date: '2026-10-20 10:00:00 +0800', refs: ['HEAD -> main'], subject: 'first' },
      { hash: 'bbb', shortHash: 'bbb', parents: [], author: 'Bob', email: 'b@x', date: '2026-10-19 10:00:00 +0800', refs: [], subject: 'second' },
    ],
    branches: ['main'],
    selectedHash: 'aaa',
    loading: false,
  }
  store.state.commit.messages = ['first\nbody', 'second']
  return renderToStaticMarkup(React.createElement(Workbench, { store }))
}

export function renderDiff() {
  const store = baseStore()
  const tab = {
    id: 'diff:worktree:a.ts',
    kind: 'diff',
    path: 'C:\\work\\demo\\a.ts',
    rel: 'a.ts',
    name: 'a.ts',
    staged: false,
    untracked: false,
    preview: false,
    pinned: true,
    loading: false,
    error: null,
    payload: { untracked: false, diff: SAMPLE_DIFF },
    mode: 'side',
    scrollTop: 0,
  }
  store.state.tabs = [tab]
  store.state.activeId = tab.id
  return renderToStaticMarkup(React.createElement(Workbench, { store }))
}

export function renderCode() {
  const store = baseStore()
  const tab = {
    id: 'file:C:\\work\\demo\\a.ts',
    kind: 'file',
    path: 'C:\\work\\demo\\a.ts',
    rel: 'a.ts',
    name: 'a.ts',
    preview: true,
    pinned: false,
    loading: false,
    error: null,
    payload: { kind: 'text', content: 'const a = 1\nconst b = 2\n', encoding: 'utf-8', size: 24, truncated: false },
    scrollTop: 0,
  }
  store.state.tabs = [tab]
  store.state.activeId = tab.id
  return renderToStaticMarkup(React.createElement(Workbench, { store }))
}

export function renderProjectPicker() {
  const store = baseStore()
  store.state.projectPicker = true
  store.state.projects = [
    { path: 'C:\\work\\demo', name: 'demo', isRoot: true, isRepo: false },
    { path: 'C:\\work\\demo\\repo-a', name: 'repo-a', isRoot: false, isRepo: true },
    { path: 'C:\\work\\demo\\repo-b', name: 'repo-b', isRoot: false, isRepo: false },
  ]
  return renderToStaticMarkup(React.createElement(Workbench, { store }))
}

export function renderGitNoRepo() {
  const store = baseStore()
  store.state.status = { ...store.state.status, isRepo: false, entries: [], branch: undefined }
  store.state.projects = [
    { path: 'C:\\work\\demo', name: 'demo', isRoot: true, isRepo: false },
    { path: 'C:\\work\\demo\\repo-a', name: 'repo-a', isRoot: false, isRepo: true },
  ]
  store.state.layout = { ...store.state.layout, bottom: 'git' }
  store.state.git = { ...store.state.git, error: 'fatal: not a git repository', loading: false, commits: [] }
  return renderToStaticMarkup(React.createElement(Workbench, { store }))
}

export function renderMarkdown() {
  const store = baseStore()
  const content = '# Sample Doc\n\nIntro paragraph.\n\n## Install\n\nRun it.\n\n### Notes\n\nDone.\n'
  const tab = {
    id: 'file:C:\\work\\demo\\README.md',
    kind: 'file',
    path: 'C:\\work\\demo\\README.md',
    rel: 'README.md',
    name: 'README.md',
    preview: false,
    pinned: true,
    loading: false,
    error: null,
    payload: { kind: 'text', content, encoding: 'utf-8', size: content.length, truncated: false, eol: '\n' },
    scrollTop: 0,
    editing: false,
    view: 'preview',
    outlineOpen: true,
    draft: content,
    dirty: false,
    saving: false,
  }
  store.state.tabs = [tab]
  store.state.activeId = tab.id
  return renderToStaticMarkup(React.createElement(Workbench, { store }))
}

export function renderMarkdownEdit() {
  const store = baseStore()
  const content = '# Sample Doc\n\nEdit me.\n'
  const tab = {
    id: 'file:C:\\work\\demo\\README.md',
    kind: 'file',
    path: 'C:\\work\\demo\\README.md',
    rel: 'README.md',
    name: 'README.md',
    preview: false,
    pinned: true,
    loading: false,
    error: null,
    payload: { kind: 'text', content, encoding: 'utf-8', size: content.length, truncated: false, eol: '\n' },
    scrollTop: 0,
    editing: true,
    view: 'code',
    outlineOpen: false,
    draft: `${content}changed\n`,
    dirty: true,
    saving: false,
  }
  store.state.tabs = [tab]
  store.state.activeId = tab.id
  return renderToStaticMarkup(React.createElement(Workbench, { store }))
}

export function renderMarkdownFind() {
  return renderToStaticMarkup(React.createElement(MarkdownView, {
    text: '# Sample Doc\n\nIntro paragraph.\n',
    outlineOpen: false,
    onToggleOutline: () => {},
    findOpen: true,
    onCloseFind: () => {},
    onFindRequest: () => {},
    t: key => key,
    labels: {},
  }))
}

export function renderDiffComponent() {
  const store = baseStore()
  const tab = {
    id: 'diff:worktree:a.ts',
    kind: 'diff',
    path: 'C:\\work\\demo\\a.ts',
    rel: 'a.ts',
    name: 'a.ts',
    staged: false,
    untracked: false,
    payload: { untracked: false, diff: SAMPLE_DIFF },
    mode: 'unified',
  }
  return renderToStaticMarkup(React.createElement(DiffView, { store, state: store.state, tab }))
}

export function renderGitDrawer() {
  const store = baseStore()
  store.state.layout = { ...store.state.layout, bottom: 'git' }
  store.state.git = {
    ...store.state.git,
    commits: [
      { hash: 'aaa', shortHash: 'aaa', parents: ['bbb'], author: 'Ann', email: 'a@x', date: '2026-10-20 10:00:00 +0800', refs: ['HEAD -> main'], subject: 'first' },
    ],
    branches: ['main'],
    selectedHash: 'aaa',
    detailHash: 'aaa',
    detail: {
      hash: 'aaa', shortHash: 'aaa', parents: ['bbb'], author: 'Ann', email: 'a@x',
      date: '2026-10-20 10:00:00 +0800', refs: ['HEAD -> main'], subject: 'first',
      body: 'Body line', diff: SAMPLE_DIFF,
    },
    loading: false,
  }
  return renderToStaticMarkup(React.createElement(Workbench, { store }))
}

export function renderSearchTab() {
  const store = baseStore()
  store.state.tabs = [{ id: 'search:in-files', kind: 'search', name: 'search.title', loading: false, error: null }]
  store.state.activeId = 'search:in-files'
  store.state.search = {
    ...store.state.search,
    query: 'a.ts', results: [{ path: 'a.ts', matches: [{ line: 1, column: 1, preview: 'const a = 1' }] }],
    tookMs: 4, loading: false,
  }
  return renderToStaticMarkup(React.createElement(Workbench, { store }))
}

export function renderQuickOpen() {
  const store = baseStore()
  store.state.quickOpen = true
  store.state.quickOpenQuery = 'ma'
  store.state.fileIndex = ['src/main.ts', 'a.ts']
  return renderToStaticMarkup(React.createElement(Workbench, { store }))
}

export function renderProjectQuickFilter() {
  const store = baseStore()
  store.state.filter = 'ma'
  store.state.filterMode = 'files'
  store.state.fileIndex = ['src/main.ts', 'a.ts']
  return renderToStaticMarkup(React.createElement(Workbench, { store }))
}

export function renderHtmlEditor() {
  const store = baseStore()
  const content = '<!doctype html><h1>Hello</h1>\n'
  const tab = {
    id: 'file:index.html',
    kind: 'file',
    path: 'C:\\work\\demo\\index.html',
    rel: 'index.html',
    name: 'index.html',
    preview: false,
    pinned: true,
    loading: false,
    error: null,
    payload: { kind: 'text', content, encoding: 'utf-8', size: content.length, truncated: false, eol: '\n' },
    scrollTop: 0,
    editing: false,
    view: 'code',
    outlineOpen: false,
    draft: null,
    dirty: false,
    saving: false,
  }
  store.state.tabs = [tab]
  store.state.activeId = tab.id
  return renderToStaticMarkup(React.createElement(Workbench, { store }))
}

export function renderSettings() {
  const store = { t: key => key, updateSettings: async () => {} }
  const state = {
    settings: {
      git: { path: '', colors: true, commitTemplate: '' },
      idea: { path: '' },
      webstorm: { path: '' },
      vscode: { path: '' },
      terminal: { shell: 'auto', copyOnSelect: false, fontSize: 13 },
      project: { alwaysSelectOpened: true, showHidden: true },
      editor: { fontSize: 13, highlight: true },
      links: { chatFiles: 'ide' },
      shortcuts: { project: 'Alt+1', commit: 'Alt+0', git: 'Alt+9', terminal: 'Alt+F12' },
    },
    terminal: { shells: [{ id: 'pwsh', label: 'PowerShell' }] },
  }
  return renderToStaticMarkup(React.createElement(SettingsForm, { store, state }))
}
