# Issue #3 — 实现契约（团队共享）

> 本文件是 `feat(core)/issue-fixing-and-enhancement` 分支上 R1–R11 + A1 的**共享契约**。
> 需求正文见 `docs/issues/issue#3.md`；根因分析见 `docs/issues/2026-11-11-用户实测问题整理.md`。
> **所有参与者必须先读本文件再动手**；任何与本文件冲突的实现都要先回报，不得各自发明。

## 0. 基线

- 分支：`feat(core)/issue-fixing-and-enhancement`（工作区根目录 `dsh-ide-workbench/`）
- 包：`packages/workbench`（插件 ID `dsh-ide-workbench`，v0.6.0）
- 基线测试：`packages/workbench` 下 `node --test tests/*.test.mjs` → **496/496 全绿**
  （注：`pdfjs-dist` 之前没装，先跑过一次 `npm install --workspace packages/workbench` 补齐）
- 构建：`npm run build:core`（等价于 `node packages/workbench/scripts/build.mjs`）。
  **`packages/workbench/dist/client.js` 已入库，源码改完必须重建产物**。
- 行号口径：一律以磁盘当前内容为准，CodeGraph 索引可能过期。

## 1. 文件归属（**互斥**，越界修改前必须先在群里报备）

| 负责人 | 需求 | 可写文件（仅这些） |
|:--|:--|:--|
| T-links | R1 + R2 | `src/client/index.jsx`、`src/client/file-link.js`、`src/client/file-address.js`、`src/client/changes-review.js`（新）、`src/client/diff.js`、`src/client/DiffView.jsx`、`src/index.js` |
| T-editor | R3 | `src/client/CodeEditor.jsx`、`src/client/util.js` |
| T-tree | R4 + R5 | `src/client/ProjectPanel.jsx`、`src/host/fileops.js` |
| T-git | R6 + R7 + R8 | `src/host/git.js`、`src/client/git-colors.js`、`src/client/GitPanel.jsx` |
| T-term | R9 + R10 | `src/client/TerminalPanel.jsx` |
| T-browser | R11 | `src/host/shell.js`、`src/client/EditorArea.jsx` |
| T-store | A1 | `src/client/store.js`、`src/client/Workbench.jsx` |
| **lead** | 集成 | `src/client/i18n.js`、`src/client/styles.js`、`src/client/compact-path.js`（新）、`docs/` |

> `src/client/store.js`、`src/client/i18n.js`、`src/client/styles.js` 是**共享热点文件**：
> 只有上表列出的负责人可以改。需要热点文件改动时，**在群里提出需求**（给出确切插入位置与文案），
> 由 lead 落盘；不要自己抢写。

## 2. `src/client/compact-path.js`（lead 提供，T-tree 与 T-git 共用）

纯函数、零依赖、可单测，导出三个 API：

```js
/**
 * @typedef {object} CompactNode
 * @property {string} name        显示名（单段名）
 * @property {string} path        该节点的真实完整路径
 * @property {'dir'|'file'} kind
 * @property {CompactNode[]} [children]  仅目录节点有
 */

/** 目录节点是否可被折叠：恰好 1 个子节点且该子节点是目录（无文件）。 */
export function isCompactable(node)      // → boolean

/** 把一层 children 里的“单子目录链”合并成合并节点。 */
export function compactTree(nodes)        // → CompactNode[]

/** 合并节点的显示标签。 */
export function compactLabel(node, sep)   // sep 默认 '.'
```

### 2.1 折叠规则（**统一规则**，VS Code compact folders 语义）

- 一个目录节点**可折叠** ⟺ 它**恰好有 1 个子节点，且该子节点是目录**（链上任一层出现文件或多个子目录 → 该层开始分叉）。
- `compactTree` 把一条连续的可折叠链合并成**一个**节点：
  - `segments`: `string[]`，链上各段的目录名（`['com','liangshou','adapter','controller']`）
  - `path`: 链**最深**那一层的真实路径（合并节点的“叶子目录”，右键新建/删除都作用在它身上）
  - `children`: 叶子目录的子节点
  - `merged: true`
- **树根节点不参与合并**（R7 修正 ①）：根的子节点可以与**自己的**子节点合并，但根本身不与子节点合并。
- **只折叠已加载的链**（零额外 IO）：某一级目录尚未加载（`children === undefined`）时，链在此处停止。

### 2.2 标签规则

- `compactLabel(node, '.')`：`segments.join('.')`。
- **若任一段本身含 `.`**，为示区分，整条标签改用斜杠连接：`segments.join('/')`。
- R7（Git 树）用 `compactLabel(node, '/')` 得到完整斜杠路径，再按可用宽度降级：
  ① 完整斜杠路径 → ② 首尾形式（首段 + `…` + 末段）→ ③ 只显示最后一段。
  完整路径始终写进 `title`。

## 3. i18n 键契约（**lead 落盘到 `src/client/i18n.js`**）

各负责人**按下面的键名使用**；需要新增键时先在群里报，lead 统一加（en + zh 都要）。
`store.t(key)` **不支持占位符插值**；需要带变量时用 `store.toast(kind, t(key), detail)` 的 `detail` 位。

| 键 | en | zh | 归属 |
|:--|:--|:--|:--|
| `changesReview.title` | Changes in this turn | 本轮变更 | R2 |
| `changesReview.empty` | No file changes in this turn | 本轮没有文件变更 | R2 |
| `changesReview.files` | Changed files | 变更文件 | R2 |
| `changesReview.unified` | Unified | 统一 | R2 |
| `changesReview.sideBySide` | Side by side | 并排 | R2 |
| `changesReview.binary` | Binary file — no text diff | 二进制文件，无文本差异 | R2 |
| `changesReview.oversized` | File is too large to show a diff | 文件过大，无法显示差异 | R2 |
| `changesReview.expired` | The data of this turn is no longer available | 本轮数据已过期 | R2 |
| `changesReview.loadFailed` | Could not load the changes of this turn | 无法加载本轮的变更 | R2 |
| `changesReview.outsideWorkspace` | Outside the workspace — shown read-only | 工作区之外，仅只读展示 | R2 |
| `editor.foldAll` | Fold all | 全部折叠 | R3 |
| `editor.unfoldAll` | Unfold all | 全部展开 | R3 |
| `project.currentFolder` | Current folder | 当前目录 | R4 |
| `project.pathLabel` | Full path | 完整路径 | R5 |
| `project.pathHint` | Relative to the project root. Leave it unchanged to create in the current folder. | 相对于项目根目录；不修改则在当前目录创建。 | R5 |
| `project.pathInvalid` | Invalid path — it must stay inside the project root. | 路径无效：必须位于项目根目录内。 | R5 |
| `project.compactDir` | Merged folder | 合并目录 | R5 |
| `project.compactRenameDenied` | A merged folder cannot be renamed | 合并目录不支持重命名 | R5 |
| `git.expandOriginalTree` | Expand as original folders | 展开为原始目录 | R7 |
| `git.copySha`（改） | Copy SHA | 复制 SHA | R8 |
| `git.copyFullSha` | Copy Full SHA | 复制完整 SHA | R8 |
| `git.copyShortSha` | Copy Short SHA (7) | 复制短 SHA（7 位） | R8 |
| `browser.unsavedChanges` | Save the file before opening it in the browser | 请先保存文件再在浏览器中打开 | R11 |
| `status.words` | words | 字 | A1 |

> `settings.showIgnored` / `settings.showIgnoredHint` 的文案由 lead 按 R6 统一改
> （“显示被忽略的文件和目录” / “以灰色列出 .gitignore 命中的文件与目录（默认隐藏）”）。

## 4. CSS 类契约（**lead 落盘到 `src/client/styles.js`**）

样式**必须走 `var(--iwb-*)` 主题 token**，禁止硬编码 rgba/hex（`tests/styles-theme.test.mjs` 有守卫）。

| 类名 | 用途 | 归属 |
|:--|:--|:--|
| `.cm-foldGutter` / `.cm-foldPlaceholder` | CodeMirror 折叠 gutter 与占位符（类名由 CodeMirror 自己定，lead 已落盘） | R3 |
| `.iwb-tree-sticky` | 顶部冻结面包屑条 | R4 |
| `.iwb-tree-sticky-sep` | 面包屑分隔符 | R4 |
| `.iwb-tree-sticky-item` | 面包屑里的一级目录 | R4 |
| `.iwb-terminal-theme-*` | 终端调色板 token 组 | R9 |

> lead 已把 i18n 键（§3）与折叠/冻结条的 CSS（§4）**先行落盘**，各负责人直接使用即可。
> 需要额外 CSS 时按上表的命名规则自行提出（lead 落盘）。

## 5. 跨需求约定

### 5.1 R6 ignored 键口径（host ↔ client 必须一致）

- host 侧 `git status --porcelain=v1 --ignored=matching` 的 ignored 条目**保留尾斜杠**
  （porcelain 原样：`target/`）；`src/host/git.js` 下发时**统一去掉尾斜杠**再给客户端。
- client 侧 `git-colors.js` 的 `aggregateStatus`：
  - `ignored` 集合里存**不带尾斜杠**的路径；
  - 对每个 ignored 条目，把它的**所有祖先目录**也加入 `ignored` 集合（**前缀继承**），
    使整棵子树灰显（git 在 `--ignored=matching` 下不下降到目录内部，子树在状态数据里没有任何条目）；
  - ignored 条目**不进**目录状态表（`dirs`），也不进 `files`（保持既有约定）。
- 客户端行着色复用既有 `iwb-git-ignored` 类（棕 `#b08b4f` + `opacity:.65`），不另设配色。
- 「显示被忽略的文件」关闭时，ignored 目录**与其子树一起隐藏**（现有 `flatten` 的 `visible` 谓词已按
  `ignored.has(rel)` 过滤；前缀继承让整棵子树一起被过滤）。

### 5.2 R2 changes-review 地址文法

- 地址：`dsh-resource://changes-review/session/<sessionId>/<seq>/<turn>`
- 插件的 tab 类型注册**新增** pattern `dsh-resource://changes-review/**`，
  `priority: 'extension'`（band 3 > 宿主 builtin band 2 → 插件抢下）。
- `canOpen` 必须**按地址族分派**：file 族走现有工作区判定；changes-review 族走
  「本会话 + 本回合」判定（会话不存在或已切换 → 否决）。
- 数据来源：宿主 `GET /api/changes.summary` 与 `GET /api/changes.diff`，
  返回的是**结构化 hunks**，不是 unified diff 文本：
  - summary: `{ turn, files: [{ path, display, added, deleted, binary?, oversized? }], total, added, deleted }`
  - diff: `{ kind: 'text'|'binary'|'oversized', path, display, before, after, coarse, hunks: [{ oldStart, oldLines, newStart, newLines, lines[] }] }`
- **降级**：宿主 API 不可达 / 回合数据过期 → 降级到宿主默认侧栏（`openInDefaultSidebar` 语义），
  并给出可读提示；不得白屏、不得抛错。
- `params.index` = 变更文件列表中的下标，打开时**直接定位到该文件**。

### 5.3 R1 承载 tab 归宿

- 承载 tab 的最终归宿必须**可判定**：被宿主替换 **或** 被插件显式关闭，二者必居其一。
- 判定“宿主是否真的替换了”不能只看 `openTab` 是否抛异常（宿主 `openTab` 返回 void）。
  可行手段：在调用 `openTab(..., { replaceTab })` **之后**检查承载 tab 是否还在
  （`ctx.sidebarRight.openTabs.getSnapshot()` / `ctx.sidebarRight.active()`），
  若仍在 → 插件显式 `ctx.sidebarRight.close(tab.id)` 兜底，并把 `view.phase` 推进到终态。
- 再次点击同一链接：**只聚焦已有文件标签页**，不新开、不重复加载。
- 工作区外文件 / 二进制 / Office / PDF → 仍降级到宿主侧栏（**不得回归**）。

### 5.4 R3 折叠快捷键写法

- CodeMirror 侧必须写 `"Ctrl-Shift-="` / `"Ctrl-Shift--"`（**不是** `Ctrl+Shift++`）。
- 本仓库 `src/client/util.js` 的 `normalizeShortcut` 用 `value.split('+')`，
  会把 `Ctrl+Shift++` 解析坏 → **不要**用 `+` 号写快捷键。
- 不做可配置（拍板）。

## 6. 测试要求

- 每个需求**必须**补自己的回归用例，文件名 `tests/<topic>-<topic>.test.mjs`。
- 既有断言**不得回归**：特别是
  `tests/render.test.mjs`（tab 类型注册 / patterns / canOpen）、
  `tests/perf-slice-project.test.mjs`（`projectSlice` 字段集合 + 源码里不得出现 `state.`）、
  `tests/perf-hot-path.test.mjs`（语言包数量 / promise site 数量）、
  `tests/styles-theme.test.mjs`（禁硬编码颜色、禁特定选择器）、
  `tests/tree-twisty.test.mjs` / `tests/status-basis.test.mjs`（twisty 单击/双击）、
  `tests/shortcuts.test.mjs`（快捷键集合）。
- 新增 `src/client/**` 源码时，`tests/client-contract.test.mjs` / `tests/perf-hot-path.test.mjs`
  可能有**字面量级**断言，先读再写。
