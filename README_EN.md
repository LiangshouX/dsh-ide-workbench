![IDE Workbench](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/icon.svg)

# IDE Workbench

**A JetBrains-style IDE workspace, docked in the DeepSeek Harness sidebar.**

Project, Commit, Git and Terminal tool windows surround a plugin-owned editor, side by side with the chat — no more jumping between the conversation, the terminal and your IDE.

[![npm package · MIT license · DSH ≥ 0.1.7 · Windows / macOS / Linux](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/badges.svg)](https://github.com/LiangshouX/dsh-ide-workbench)

English · [简体中文](https://github.com/LiangshouX/dsh-ide-workbench/blob/main/README.md)

![IDE Workbench overview: Commit window, diff in the editor and Git log together](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/hero.png)

## Why IDE Workbench?

DSH conversations are great for "chat and change at the same time", but editing code still means bouncing between the chat, a terminal, a file manager and an IDE. IDE Workbench puts a full JetBrains-style workspace into the right sidebar, **always attached to the current session**:

- **Chat-native**: file links in the conversation open in the workbench at the referenced line; from the tree or the editor, **Send to chat** inserts an `@path` reference into the composer — with the line range and code when you select code.
- **IDEA muscle memory**: `Alt+1` / `Alt+0` / `Alt+9` / `Alt+F12` for the tool windows, preview/pinned tabs on single/double click, `Alt+Insert` to create, `F2` to rename, `Ctrl+K` to focus the commit message, `Ctrl+Shift+K` to push.
- **Real repository and terminal**: Git is the system CLI (your credential manager, hooks and config apply), the terminal is a real PTY, and file I/O is path-fenced and encoding-preserving.
- **Follows DSH**: host theme tokens, a native right-sidebar tab, session continuity and a settings page; works in DSH Desktop and the Web profile.

## Features

| Preview | Feature |
|:--|:--|
| ![Project tool window](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/project.png) | **Project tool window.** Lazy-loading tree with JetBrains status colors (red = untracked, green = added, blue = modified, recursively on folders). Single click selects, double click opens or expands; the folder twisty toggles on a single click. Ctrl/Shift multi-select; drag to move (Ctrl = copy). New file/folder, `F2` rename, `Delete` (recycle bin first), `F5` duplicate, `F6` move, cut/copy/paste. **Locate File** jumps to the open file, tree filter and whole-project file filter; **Send to chat** in the context menu. |
| ![CodeMirror editor](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/editor.png) | **Embedded editor.** CodeMirror 6 with syntax highlighting; auto / always-editable / always-read-only open modes, where auto makes text up to 1 MiB editable (Markdown opens in the rendered preview). `Ctrl+S` saves atomically and preserves UTF-8 / BOM / UTF-16 and CRLF; dirty markers are explicit. Concurrent edits raise a conflict dialog **centred on the document pane** with *Reload from disk* or *Overwrite*; a file you just saved no longer reports a false conflict. In-file find/replace, cursor position and encoding in the status bar. |
| ![Markdown preview and outline](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/markdown.png) | **Markdown preview.** Rendered with the host's `MarkdownText`, matching DSH chat typography for tables, task lists and code cards. Opens directly in the rendered view; Preview / Source / Edit switch from the toolbar; the outline jumps and highlights while scrolling. No more landing in the source buffer first. |
| ![Find in Files](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/search.png) | **Find in Files and Quick Open.** `Ctrl+Shift+R` searches the whole project (in a plain browser use the `Ctrl+Alt+F` fallback); Aa / whole word / regexp all work. Results are grouped by file with counts and elapsed time; a hit opens the file at its line. `Ctrl+P` / `Ctrl+Shift+N` opens files by name. |
| ![Commit tool window](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/commit.png) | **Commit tool window.** `Changes` / `Unversioned` groups; checking a row stages it without reordering the list; changelists and group-by-directory. Change View (working tree / last revision / latest), jump to source, revert; hunk-level staging in the diff toolbar. Commit, Commit and Push, Amend, recent messages and optional pre-commit commands. |
| ![Unified diff](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/diff-unified.png) | **Diff.** Side-by-side or unified layouts, word-level highlights and collapsible unchanged blocks. Compare against the working tree, the last revision, a commit or two commits (Ctrl+click); stage or discard a single hunk. HTML and binary files fall back to the DSH sidebar or the OS default app. |
| ![Git history and details drawer](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/git.png) | **Git history.** Paged commit table with a swimlane commit graph; filter by branch, author, message or path. Single click selects, double click (or Enter) opens the details drawer: metadata, full message and changed files with per-file diffs. Copy SHA, checkout, revert, compare two commits; show history for a tree path. |
| ![Terminal](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/terminal.png) | **Terminal.** Real PTY over WebSocket + xterm.js; multiple sessions, rename, close; shell profiles (PowerShell, Git Bash, cmd, …). Refits and resizes the PTY when the dock is resized or toggled between docked and full screen. Copy on select, `Ctrl+Shift+V` pastes; the cwd follows the project root or the active file. |
| ![Send to chat from the editor](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/send-chat.png) | **Chat collaboration.** Chat file links open in the workbench at `#L24`; files outside the workspace fall back to DSH's own sidebar. **Send to chat** from the tree or the editor: files and folders become `@path` references; selected code carries the line range and a code block. HTML can preview in the DSH sidebar or the OS browser; the chat input keeps working normally. |
| ![IDE Workbench settings](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/settings.png) | **Settings and shortcuts.** Tool-window/command shortcuts, default shell, terminal font size, open mode, Markdown preview, hidden/ignored files, chat-link behavior, external IDE paths, Git path and commit commands. Changes persist about 300 ms later with a "Saved" indicator; closing the panel flushes the last edit. The modal keeps its title and close control while the long form scrolls. |
| **Code intelligence** | **Completion, go to definition and find usages.** Every language has **local completion** (zero dependencies, Tab / Enter to accept, Esc to close). With a language server configured you also get **semantic completion**, **hover documentation** and **signature help**: `Ctrl+click` or `F12` jumps to the definition (across files, opening the tab and landing on the column), `Alt+F7` lists the **semantic references** (occurrences in comments and strings excluded), and `Alt+F8` is the always-available **text** version of find-usages (every row is marked "text match"). Opening an unindexed folder asks whether to build the index, with an extra warning for the workspace root (it usually holds several independent repositories); when the memory is short the workbench falls back to the **basic mode** (local completion + text search), and the status bar always shows the state of the semantic analysis. The memory that the index needs is estimated per language and configurable — see [The memory configuration of the code index](#the-memory-configuration-of-the-code-index). |

## Installation

**Requires** DSH ≥ 0.1.7 (DSH Desktop 0.2.x or a Web profile). The plugin is published on npm: [dsh-ide-workbench](https://www.npmjs.com/package/dsh-ide-workbench).

### Option 1: DSH Desktop (recommended)

1. Open **Settings → Plugins**.
2. Click **Add plugin** and enter `dsh-ide-workbench` (optionally with a version, e.g. `dsh-ide-workbench@0.4.1`). You can also paste the `.tgz` URL of a Release asset (see Option 4).
3. After installation, open it from the IDE Workbench button in the session header (or the footer entry).

> The Desktop profile is owned exclusively by the Electron app; `dsh plugin --profile desktop ...` is refused. Use the Plugins page on Desktop — it runs in the Host, so it installs into the Desktop profile itself.

### Option 2: CLI / npm

```sh
# Install into one profile (for example the web profile)
dsh plugin --profile web add dsh-ide-workbench

# Pin a version
dsh plugin --profile web add dsh-ide-workbench@0.4.1
```

Restart that profile, then enable **IDE Workbench** in **Settings → Plugins** if the bundle is still off.

### Option 3: Git or a local checkout

```sh
# Install straight from GitHub (the repository ships the built dist/client.js)
dsh plugin --profile web add git+https://github.com/LiangshouX/dsh-ide-workbench.git

# Or clone and install from the directory
git clone https://github.com/LiangshouX/dsh-ide-workbench.git
dsh plugin --profile web add ./dsh-ide-workbench
```

### Option 4: The offline Release bundle (installs without a registry)

Every [Release](https://github.com/LiangshouX/dsh-ide-workbench/releases) ships an npm
build bundle with `node_modules` already inside
(`dsh-ide-workbench-<version>.tgz`), so installing it never touches the npm
registry:

```sh
# Replace <version> with the release tag (e.g. v0.5.0)
dsh plugin --profile web add https://github.com/LiangshouX/dsh-ide-workbench/releases/download/v0.5.0/dsh-ide-workbench-0.5.0.tgz
```

The release page also carries the changelog (taken from
[CHANGELOG.md](CHANGELOG.md)) and the source archives (attached by GitHub).

> That `.tgz` URL can also be pasted straight into **Settings → Plugins → Add
> plugin** — the Host's install-spec parser accepts an http(s) address ending in
> `.tgz` / `.tar.gz`. Installing by npm name is the cleaner route: a tarball
> install records a non-registry URL in the lockfile, and a later package
> operation against the default registry can then fail with
> `ERR_PNPM_TARBALL_URL_MISMATCH`.

### After installation

- Three entry points: the session-header button, the new-session row and the sidebar footer action.
- The workbench is a native right-sidebar tab; it can sit beside the chat and toggles between docked and full screen with `F11`.
- The first open picks the current DSH workspace; the project header lets you switch the IDE project root between the workspace root and a first-level subdirectory.

## Quick start

1. **Open the workbench** from the session header (or press `Alt+1` to focus Project).
2. **Choose a project** in the project-header dropdown: the workspace root or a first-level folder (repositories carry a Git badge).
3. **Work**: double-click a file, `Ctrl+Shift+R` to search, `Alt+0` to commit, `Alt+F12` for the terminal, `Ctrl+K` for the commit message.

### Common shortcuts

| Action | Shortcut |
|:--|:--|
| Tool windows | `Alt+1` Project · `Alt+0` Commit · `Alt+9` Git · `Alt+F12` Terminal |
| Focus commit message / push | `Ctrl+K` / `Ctrl+Shift+K` |
| Find in Files / fallback | `Ctrl+Shift+R` / `Ctrl+Alt+F` |
| Quick Open | `Ctrl+P` or `Ctrl+Shift+N` |
| Full screen / docked | `F11` |
| Hide all tool windows | `Ctrl+Shift+F12` |
| In-file find | `Ctrl+F`, `F3` |
| Save / close tab | `Ctrl+S` / `Ctrl+W` |
| File actions | `Alt+Insert` new · `F2` rename · `F5` duplicate · `F6` move · `Delete` · `Ctrl+Alt+Shift+C` copy path |
| Commit details | `Ctrl+Alt+D` |

> Tool-window, commit, push, find and quick-open shortcuts are rebindable in **Settings → IDE Workbench**; `F2` / `F5` / `F6` / `Delete`, `Ctrl+Alt+D` and `Ctrl+Shift+F12` keep their defaults (editable in the settings file).

## Workspace vs. IDE project root

A DSH workspace is often a container whose root is not a Git repository while first-level folders are. The project-header dropdown selects either the **workspace root** or any first-level subfolder; the choice is persisted per workspace (`projectRoots`). Switching updates the Project tree, Git/Commit data, the cwd of new terminal sessions and the restored tabs together. When the folder is not a repository, every tool window offers a "choose a Git subproject" hint.

## Code intelligence and indexing

The editor ships with **local completion** (available in every language, no language server required). Install a language server — TypeScript / JavaScript / Python / YAML ship with the package, Java / Go / Rust / C++ are detected on `PATH` — and you also get **semantic completion**, **hover documentation**, **signature help**, **go to definition** and **semantic find-usages**.

- **An index is not a file on disk**: it is the type information the language server builds in its own process. The first build can take a minute or two and may be cancelled at any time; an idle language server exits after ten minutes to release its memory and rebuilds on the next visit (usually faster, because the files are still in the system page cache).
- **Opening an unindexed folder asks first**: build the index, stay in the basic mode (local completion + text search), or cancel. The workspace root is often just a container with several independent repositories below it — indexing there is noticeably slower and heavier, so it warns about that too.
- **No memory, no server**: when the free memory is below the threshold the workbench falls back to the basic mode and the status bar shows the numbers it needed and the numbers it had.
- **The status bar always shows the state** of the semantic analysis (off / not installed / starting / indexing / ready / basic mode / crashed); indexing past one minute offers a **Cancel index** action.
- The **indexed** badge in the project picker means "this folder was indexed before". It does **not** mean there is an index file on disk.

> The language servers' rename and formatting are not enabled: `F2` is already taken by "rename file".
> The **offline install does not include the bundled language servers** (size); install them onto `PATH` yourself for that kind of install.

### The memory configuration of the code index

The memory an index uses belongs to the **language server process**; the workbench can only **estimate** it. Two independent numbers are involved, and they mean different things:

| Number | Meaning | What it does |
|---|---|---|
| **Ceiling** | The memory ceiling handed to the language server | Caps the estimate before the start; **only TypeScript** really passes it to the server process |
| **Estimate** | The **typical** footprint of that language server (not its worst case) | Compared against the free memory to decide whether the server may start |

At the moment of the start the check is `need = min(estimate, effective ceiling) × headroom`: enough free memory starts the server right away; a "tight" window **asks you** ("start anyway / use the basic mode"); below the hard floor (256 MB by default) it falls back to the basic mode.

**How to configure**: Settings → IDE Workbench → Semantic analysis (the global ceiling, the conservative floor, the headroom factor, the hard floor, plus a ceiling and a switch per language) — or edit the `lsp` section of `~/.dsh/ide-workbench/settings.json` directly.

**The three traps**:

- **The global ceiling can only lower things.** The effective value is `min(the language's own built-in ceiling, the global ceiling)` — raise the global one to 4096 and TypeScript is still capped at 2048. **To give one language more, use the ceiling in its own row** (a per-language value *replaces* the global one and may be higher).
- **Only the TypeScript server really honours that ceiling** (`maxTsServerMemory`). jdtls / gopls / rust-analyzer / clangd / basedpyright only use it to cap the *estimate*; it does **not** limit the process.
- **The estimate is a typical footprint, not a worst case.** A large project needs far more (the TypeScript server builds the program of the whole project), so the estimate decides *whether to ask you*, not *whether it will hold up*.

> On a large project the **first** semantic request can take more than ten minutes (building the program was measured at over ten). The request budget is ten minutes until the server has answered one real request, so the first completion popup may take a long time to return — that is the index being built, and the status bar says "Semantic analysis: indexing…".

The full reference (how the effective ceiling is computed, the three gates, a field-by-field configuration table, the known limitations and a troubleshooting table) is in **[docs/代码索引内存配置.md](docs/代码索引内存配置.md)** (Chinese).

## DSH integration

- **Entry points**: session header, new-session row and the persistent sidebar-footer action; the workbench is a native `sidebar.right.pane.tab` beside the chat, so it also works when a skin hides the header utilities.
- **Session continuity**: sessions of the same DSH workspace share one workbench state — the tree, open tabs and Git context survive session switches; when the workbench was visible in the session you leave, it reopens in the arriving one. Switching the conversation does not kill terminal sessions; switching sessions recreates the terminal process and editor undo stack.
- **Chat file links**: files mentioned with `@` and Markdown links from the assistant open in the workbench and reveal the tree at `#L24`; files outside the workspace fall back to DSH's own sidebar; files inside the workspace but outside the IDE project ask before widening the project. Settings → IDE Workbench → Chat file links switches back to always using the DSH sidebar.
- **Send to chat**: from the Project tree or the editor context menu, send one or more files/folders or the selected code to the chat composer. Files and folders become `@path` references; code carries `(Lx-Ly)` and a fenced block.
- **Preview fallback**: right-click a file or tab → open in a sidebar tab for DSH's own preview; HTML files get two floating actions (preview in the DSH sidebar, open in the default browser).
- **Theme**: only `--dsw-alias-*` tokens, so light/dark and custom skins follow the host.

## Security and data

- Git always runs the system CLI with argv arrays (never a shell string); your credential manager, hooks and git config apply unchanged. Paths are parsed from `status --porcelain=v2 -z`, `diff --numstat -z` and `log`.
- File reads and writes are path-fenced (403 outside the workspace); saves are atomic and preserve the original encoding and line endings.
- Every HTTP / WebSocket route passes the same Connection admission fence as `/api`.
- Settings live in `$DSH_HOME/ide-workbench/settings.json` (`~/.dsh`, or the profile directory when the host exports `DSH_PROFILE_DIR`): shortcuts, shell, Git path, open mode, UI geometry, expanded folders and open tabs per workspace.

## Known limitations

- The project picker scans only the **first level** of the workspace; repositories are not discovered recursively.
- DSH restart does not restore terminal sessions (the PTY ends with the host process).
- Host sidebar entries cannot render numeric badges (the count lives on the plugin's own stripe).
- The Markdown preview does not rewrite relative images/links to local paths yet (http(s) works).
- Not implemented: interactive rebase, three-way merge editing, stash, blame, fetch/pull, split terminals.
- **Code index memory**: the global ceiling is a cap over *every* language and cannot break through a language's own built-in ceiling (raise the global one to 4096 and TypeScript is still 2048) — use the per-language ceiling to raise one. **Only the TypeScript server limits itself by that ceiling**; the other language servers use it to cap the estimate only. The estimate is a **typical** footprint, and a large project needs much more. See
  [The memory configuration of the code index](docs/代码索引内存配置.md) (Chinese).
- **The first semantic request on a large project can take more than ten minutes** (building the program); the request budget is ten minutes until the server answers one real request, so the first completion popup may take a long time to return.
- `Ctrl+Shift+R` is Chromium's **hard reload** shortcut in a plain browser (DSH Web, Chromium-based browsers) and a page cannot intercept it — the page reloads and the editor buffer is lost. **Use the `Ctrl+Alt+F` fallback in a browser**; the desktop build (DSH Desktop) is unaffected.
- **Send to chat** needs the host's per-session composer actions. When a host does not publish them, the action reports "The chat input is not available right now" instead of silently dropping the reference. Code ranges use `@file (Lx-Ly)` plus a fenced block because the `@` grammar has no line suffix.
- The editor context menu replaces the native one only when there is a selection (Send to chat / Copy); an empty selection keeps the native menu.

## Development

```sh
npm install
npm run build      # bundles src/client into dist/client.js (React external, xterm inlined)
npm test           # host git/diff/graph + SSR component + client regression tests
```

Source layout:

```
src/index.js                Host half: fenced HTTP API + terminal WebSocket
src/host/git.js             Git CLI adapter (status/log/numstat parsing)
src/host/workspace.js       path fence, directory tree, file preview, shell
src/host/fileops.js         create/rename/duplicate/move/delete (recycle bin)
src/host/settings-store.js  JSON settings persistence
src/client/index.jsx        client entry: sidebar tab, shortcuts, chat input bridge
src/client/store.js         workbench state machine (project, tabs, search, Git, settings)
src/client/*.jsx            tool windows and editor UI
src/client/chat-bridge.js   send to chat: @ references and code blocks
```

Rebuild `dist/client.js` and run `npm test` (180 tests) before publishing.

README screenshots and the badge strip live in `docs/readme/` and are referenced through `main`-branch raw URLs — neither DSH nor npm resolves relative image paths, while raw URLs also work on GitHub, IDEA and Typora. `badges.svg` combines the npm / license / DSH / platform badges into one image because DSH renders standalone images as blocks, which would put four separate badges on four lines. The source captures are in `qa-screenshots/` in the workspace repo; export new ones at 720 px wide and update `docs/readme/`.

## Feedback and license

- Issues and ideas: [GitHub Issues](https://github.com/LiangshouX/dsh-ide-workbench/issues)
- Releases: [GitHub Releases](https://github.com/LiangshouX/dsh-ide-workbench/releases) · [npm versions](https://www.npmjs.com/package/dsh-ide-workbench?activeTab=versions)
- License: MIT. xterm.js and ws keep their own MIT licenses.

> Screenshots come from DSH Desktop 0.2.1 on Windows 11 (light theme); the UI language follows DSH. The sample project is a test Git sandbox.
