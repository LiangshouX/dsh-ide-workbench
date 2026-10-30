# PRD-v4 复核记录（对 DSH 实现 `de3625f` 的代码复核）

> **对应规格**：`docs/PRD-v4.md`
> **对应实现**：`de3625f`（"feat: implement PRD-v4 (session-switch performance, Project toolbar, Git repo autonomy)"）
> **复核基线**：`e6f491d`（实现提交的前一个）
> **复核日期**：2026-10-30
> **本文件职责**：记录**代码复核**发现的问题，作为下一轮修复的施工清单。
> 它**不改写** `docs/PRD-v4.md`（规格）、`docs/PRD-v4-实施进展.md`（实施记录）、`docs/VERIFICATION.md`（验收记录）——
> 三者的状态由 DSH 在修复时自行更新。
> **命名规则**：复核记录的文件名 = **该轮规格文件名 + `-复核记录`**。

---

## 0. 结论摘要

### 0.1 一句话结论

**主体实现质量高、达标项多，但存在 3 条严重缺陷（其中 1 条是数据丢失路径）、1 条核心验收未达成，另有 9 条中等、7 条轻微问题。**
建议：**先修严重项与验收项，再按本文 §0.3 的顺序推进**；§0.4 列出的"已核实无误"清单**不要动**。

### 0.2 分级统计

| 级别 | 数量 | 编号 | 是否阻塞验收 |
|---|---|---|---|
| 🔴 严重 | 3 | R1 / R2 / R3 | 是 |
| ⛔ 核心验收未达成 | 1 | A1 | 是（TREE-04 直接不达标） |
| 🟡 中等 | 9 | M1 ~ M9 | 否，但多数会导致"看起来做了、实际不对" |
| 🔵 轻微 | 7 | L1 ~ L7 | 否 |
| ⚠️ 环境风险 | 1 | E1 | 待用户判断 |

### 0.3 建议修复顺序

1. **R1（数据丢失）** —— 唯一会永久丢失用户内容的路径，优先级最高。
2. **R3（写坏用户仓库）** —— 会往用户 `.gitignore` 里写非法条目，属于"破坏外部状态"，与 R1 同级。
3. **R2（Git 着色整体失配）** —— GIT-01 的核心效果在"项目根非仓库"这一常见场景下整片失效。
4. **A1（`Ctrl+Shift+F` 仍开全项目查找）** —— TREE-04 的明文验收项未达成，且**测试盲区**导致绿灯假象。
5. **M1 / M2 / M3（commit 生命周期）** —— 相互关联，建议一次性改：`pendingStage` 与 `buckets` 的状态机要统一。
6. **M9（"常驻 store ≤3"不成立）** —— 验收表的 ✅ 建立在错误前提上，需要**改正验收结论**，不一定需要改代码。
7. **M4 ~ M8、L1 ~ L7** —— 逐条收拾。
8. **E1** —— 需用户拍板后再决定是否改。

### 0.5 修复状态（2026-10-30，DSH 实施完毕）

| 编号 | 状态 | 处理方式 |
|---|---|---|
| **R1** | ✅ 已修复 | `StoreCache.evict()` 跳过含未保存编辑的 store（草稿不进 `workspaceState`，淘汰即丢）。有未保存编辑时缓存**允许**超过 3 个 —— 这是刻意取舍 |
| **R2** | ✅ 已修复 | 统一到**仓库相对**一条数据流：新增 `workspace-scope.js` 的 `relativePathWithin(base, absolute)`；store 的 `#statusKeyOf` 与树的 `statusKeyOf` 同源；`#invalidateChangedDirs` / `#refreshActiveFile` / 树的行查色 / 忽略过滤全部改用该键。`gitRoot === root` 时与今天逐字一致 |
| **R3** | ✅ 已修复 | 客户端改传**绝对路径 + 绝对 repoRoot + workspace 围栏**；host 的 `appendIgnore` 以仓库根为基准算条目，并**拒绝**仓库外的路径（不再可能写出 `/../…`） |
| **A1** | ✅ 已修复 | 删除 CodeMirror keymap 的 `Mod-Shift-f`，保留 `Mod-Alt-f`；条目抽成导出的 `editorKeymap()` 工厂，测试直接断言**实际安装的整个 keymap 数组** |
| **M1** | ✅ 已修复 | `git.commit` 自身失败时也 `git.unstage` 本轮 Add 的路径 |
| **M2** | ✅ 已修复 | 取消勾选时**无条件**从 `pendingStage` 移除；只有真的在 index 里才 `git.reset` |
| **M3** | ✅ 已修复 | `setGitRepoRoot` 调用 `#resetCommitSelection()` |
| **M4** | ✅ 已修复 | `StoreCache.set(..., { evict: false })` + `setTimeout(…, 0)` → 淘汰（会通知订阅者并写盘）不再发生在 render 期 |
| **M5** | ✅ 已修复 | `nowrap` 只留给 `h2`；正文 `<p>` 可换行（3 行截断）并带 `title` |
| **M6** | ✅ 已修复 | 新增 `store.dismissConflict(tabId)`；取消时清 `tab.conflict`。另：轮询每 2 s 会重新检出同一处分歧 → 弹窗的"已忽略"标记改由**缓冲区时间戳**释放，取消后不再复弹，重新加载/覆盖后仍能报新的外部改动 |
| **M7** | ✅ 已修复 | 删掉写死的 520px 容器查询；改为 `ResizeObserver` 按**真实溢出**折叠（决策函数 `breadcrumbOverflows` 是纯函数、可测）。中间段 `flex-shrink:1`，首段与文件名 `flex-shrink:0` → **文件名永不被裁** |
| **M8** | ✅ 已修复 | `showHistory` 把项目相对路径换算到仓库基准；文件不在所选仓库内则清空过滤 |
| **M9** | ✅ 已修复 | `isMountedSession` 只认**当前挂载**的会话（非当前会话的 body 本来就 `return null`），"开 10 个工作区后常驻 ≤3"在真实宿主下重新成立 |
| **L1** | 📝 已改验收表述 | 纯相对路径在"主解析落在项目根内"时确实是 0 次 stat（PRD §7.5 的原意）；落在项目根外时按 §7.7 第 2 条必须探测项目根那份 → `docs/VERIFICATION.md` 的"0 次 stat"表述已收窄
| **L2** | ✅ 已修复 | 候选探测改用 **workspace** 围栏 + 绝对候选路径，与客户端围栏一致 → 不再静默 403
| **L3** | ✅ 已修复 | 切仓时关闭全部 `kind === 'diff'` 标签（文件标签保留）
| **L4** | 📝 已改验收表述 | 恢复目录仍是后台**串行**加载；`docs/VERIFICATION.md` 已把该条从 ✅ 改成"行为已记录、结论改写"
| **L5** | ✅ 已修复 | 箭头 `stopPropagation` → `event.detail > 1` 不再翻转 → `onDoubleClick` 也 `stopPropagation`；双击箭头只翻一次、不闪；双击**目录名**仍照旧
| **L6** | ✅ 已修复 | README / README_EN 的"收藏夹"文案已改；死键 `editor.externalChanged` 已删除
| **L7** | ✅ 已修复 | `layout.left` 切到 `'commit'` 时补一次带 numstat 的刷新（状态替换**之后**触发）
| **E1** | ⚖️ 接受现状 + 文档化 | `Ctrl+Shift+R` 是**已批准规格**的默认键，桌面形态（DSH Desktop）宿主不占用 → 保留。纯浏览器形态下 `Ctrl+Shift+R` 是 Chromium 硬刷新、网页无法拦截 → 已在 `README.md` / `README_EN.md` 的"已知限制"与设置页提示里写明**浏览器形态请用 `Ctrl+Alt+F`**。此项仍需**用户拍板**是否改默认键 |

> **本轮修复的提交**：见 `docs/PRD-v4-实施进展.md` §7（提交哈希以该处记录为准）。

---

### 0.4 已核实无误（**请勿误改**）
复核过程中逐行确认下列实现是正确的，修复缺陷时**不要顺手重构**：

- 快捷键 7 处同步全部到位：`host/settings-store.js:105`（`findInFiles: 'Ctrl+Shift+R'`）、`:107`（`findInFilesAlt: 'Ctrl+Alt+F'` 保留）、`src/client/index.jsx:505`、`src/client/EditorArea.jsx:507`、`:513`（裸 `Ctrl+F` 保留）、`src/client/ProjectPanel.jsx:32`、`src/client/SettingsPanel.jsx:17/402`、`src/client/i18n.js:42/484`。
- 收藏夹清理彻底：`src/`、`locale/`、`host/settings-store.js` 零残留；旧 `settings.json` 的 `favorites`/`shortcuts.favorite` 经 `deepMerge` 静默保留、不再生效（`host/settings-store.js:146-152,197-198,221`）。
- FILE-01 围栏双保险成立：客户端 `candidate.absolute` 先 `normalizeFilePath` 解析 `..` 再过 `isPathWithin(workspace,…)`（`store.js:598`）；host `resolveInside`（`src/host/workspace.js:50-59`）独立再判，越界抛 403。13 类越界输入无一能打开工作区外文件。`resolveFileAddress` 原有语义未动，`tests/file-address.test.mjs` 的旧断言逐字保留（diff 纯追加 +98/−0）。
- COMMIT-01 核心正确：untracked 进 `pendingStage` 不写 index（`store.js:2346`），tracked 改动仍即时暂存；提交前 `refreshStatus({force:true})`（`:2591`）→ `git.stage` → `git.commit`（`:2598`/`:2609`）；`#resetCommitSelection`（`:927-936`）已用于切项目/切工作区。
- host 路径换算自洽：`repoEnv` → `fromRepoPath`（status 加前缀）/ `toRepoPath`（stage 剥前缀，越界 403）。
- GIT-01 控件位置正确：`RepoSwitch` 在 `src/client/Workbench.jsx:152-158`，`enabled = state.layout.bottom === 'git'`。
- LAYOUT-01：`bottomNode` 已上移为 `.iwb-root` 直子节点（`Workbench.jsx:532-543`）；stripe 44px 让位（`styles.js:324`、`:994-995`）；竖排断点 `max-height:60%` 基准已改为根高度；`.iwb-term-pane` 定位祖先未变（`styles.js:611-612`）；上下排布互斥未回退（`store.js:2913-2986`）。
- TREE-02 滚动触发条件已改为"目标路径出现在 rows 中"（`ProjectPanel.jsx:390-399`），异步 `loadDir` 完成后会再跑一次。
- slice 订阅迁移到位：CommitPanel / DiffView / EditorArea / GitPanel×2 / ProjectPanel / SearchView / TerminalPanel 共 8 处用 `useStoreSlice`；`Workbench.jsx:34-38` 用 `React.memo` 且不再传 `state`。
- EDITOR-01 遮罩下沉正确：`.iwb-editor` 为 `position:relative`（`styles.js:189`），scoped backdrop `absolute/inset:0`（`:808-811`）；根级 `ConfirmModal` 未被改动（`ui.jsx:155-157`、`Workbench.jsx:559`）；`iwb-conflict-chip` 及其样式已彻底移除，两者不会同现。
- 已验证达标项：`PERF-01/02/03/04/06/08`、`GIT-02/03`、`LAYOUT-01`、`TREE-01/02/03`、`FILE-01`。
- `npm test`：**289 pass / 0 fail / 0 skipped**（基线 159，新增 130）。生产包内 perf 计数器分支被折叠为 `if (false)`，永不执行；`scripts/build.mjs --dev` 单独产出带计数器的 `dist/client.dev.js`（已加入 `.gitignore`）。

---

## 1. 🔴 严重（3 条）

### R1 — PERF-05 淘汰 store 静默丢弃未保存编辑

> **状态**：✅ 已修复（2026-10-30）—— `evict()` 跳过含未保存编辑的 store；有未保存编辑时缓存允许超过 3 个（刻意取舍）。验证：`tests/store-lifecycle.test.mjs`

| 项 | 内容 |
|---|---|
| **位置** | `src/client/store.js:3172-3183`（`evict()`）、`:1000-1011`（`#persist`）、`:977-978`（恢复时 `draft: null, dirty: false`） |
| **引入** | 本次改动引入的回归（改动前 store 从不淘汰） |

**触发条件**

1. 工作区 W 打开了一个**有未保存修改**的文件标签（`tab.dirty === true`）；
2. W 对应的会话不再 mounted（切到别的会话）；
3. 再打开 **3 个以上**其它工作区 → W 被 `evict()` 淘汰。

**现象与影响**

- W 的 store 被删除，`#persist` 只落 `path / rel / preview / pinned / scrollTop`（`store.js:1003-1011`），**不含 `draft` / `dirty`**；
- 再次进入 W 时按 `draft: null, dirty: false` 恢复（`store.js:977-978`）→ **未保存内容永久丢失，且没有任何提示**；
- 正常关闭标签有"未保存的修改"确认（见 `docs/VERIFICATION.md:63`），**淘汰路径完全绕过了这道保护**。

> 这是本轮**唯一的数据丢失路径**，也是最严重的问题：用户在 4 个以上工作区之间来回切换、且有未保存编辑时，会静默丢内容。

**修复方向（择一）**

- **方案 A（推荐）**：`evict()` 遍历时跳过含未保存编辑的 store —— 在 `store.js:3174-3182` 的循环里加 `if (store.state.tabs.some(t => t.dirty)) continue`；
- **方案 B**：把 `draft` / `dirty` 写进 `#persist` 的 `workspaceState`（注意体积与敏感内容落盘策略）。

**验收方式**

1. 在 W 中打开文件并改出未保存内容 → 切走 W 会话 → 开 3 个以上其它工作区 → 回到 W → **未保存内容仍在**，且 W **未被淘汰**（或至少内容在）；
2. 补一条单元测试：构造 `dirty: true` 的 tab + 触发 `evict()`，断言该 store 仍存活 / 内容可恢复。

---

### R2 — GIT-01 改 status 路径基准，项目树 Git 着色整体失配

> **状态**：✅ 已修复（2026-10-30）—— 统一到**仓库相对**一条数据流；新增 `relativePathWithin()`，store 与树同源换算。验证：`tests/status-basis.test.mjs` + `tests/store-lifecycle.test.mjs`

| 项 | 内容 |
|---|---|
| **位置** | `src/client/store.js:1139`（`const root = this.gitRoot`）、`src/client/ProjectPanel.jsx:736`（`status.files.get(entry.rel)`）、`src/index.js:277`（`fromRepoPath`）、`src/index.js:72-81`（`repoEnv` 按 `payload.root` 算 prefix） |

**触发条件**

项目根 `W` **不是** Git 仓库，而 Git 窗口指向了 `W/app`（子目录仓库）。这是 GIT-01"Git 历史页仓库自治"最典型的使用场景。

**现象与影响**

- `refreshStatus()` 现在按 `this.gitRoot` 取 status（`store.js:1139`），所以 `status.files` 的键是**仓库相对路径**（`app/` 前缀已被 host 剥掉）；
- 而项目树行的 `entry.rel = toRelative(state.root, …)` 是**项目根相对路径**；
- 于是 `ProjectPanel.jsx:736` 的 `status.files.get(entry.rel)` **全部查不到** → **树的新增 / 修改 / 未跟踪 / 忽略配色与角标整体消失**；
- 更糟：两个仓库存在**同名相对路径**时，会**给错误的文件上色**；
- Commit 面板徽标 `changeCount`（`store.js:2310`）也变成**另一个仓库**的变更数量。

**修复方向（择一）**

- **方案 A（推荐）**：`state.status` 保持"项目根相对"口径 —— `refreshStatus` 用 `this.state.root` 取 status；Git 面板要仓库口径时，**另取一份** `gitRepoRoot` 状态（如 `state.gitStatus`）；
- **方案 B**：统一改成仓库相对，并同步改造项目树 `entry.rel` 的比较基准（`ProjectPanel` 与 `store.js` 的所有 `status.*.get(rel)` 调用点一起改）。

> 无论选哪个，都要**在一条数据流上统一基准**，不要出现"一半仓库相对、一半项目根相对"的混合状态。

**验收方式**

在"项目根非仓库 + Git 窗口指向子仓库"场景下：树中该子仓库的文件**正确着色**，且与非仓库目录的文件**不混淆**；`changeCount` 与实际仓库一致。

---

### R3 — "加入 .gitignore" 向用户仓库写入非法条目 `/../xxx`

> **状态**：✅ 已修复（2026-10-30）—— 客户端传绝对路径 + 绝对 repoRoot，host 以仓库根为基准并拒绝仓库外路径。验证：`tests/status-basis.test.mjs`（含 `git check-ignore`）

| 项 | 内容 |
|---|---|
| **位置** | `src/client/store.js:2434-2438`（`ignoreEntry`）、`src/host/fileops.js:274-290`（`appendIgnore`） |

**问题代码**

```js
// src/client/store.js:2434-2438
await call('git.ignore', {
  root: this.state.root,          // ← 项目根
  path,                           // ← 已经是 gitRoot 相对
  repoRoot: this.state.status.repoRoot ?? undefined,  // ← 绝对 toplevel
})
```

```js
// src/host/fileops.js:274-280
const absolute = resolveInside(root, input.path)            // 以项目根解析
const repoRoot = typeof input.repoRoot === 'string' && input.repoRoot !== ''
  ? resolveInside(root, input.repoRoot) : root
const line = `/${toRelative(repoRoot, absolute).split(sep).join('/')}`  // ← 跨仓相对
const file = join(repoRoot, '.gitignore')
```

**现象与影响**

- `path` 是 **gitRoot 相对**，`repoRoot` 是**绝对 toplevel**，两者基准不同 → `toRelative(repoRoot, absolute)` 算出 `../src/a.ts` → 最终**把 `/../src/a.ts` 写进用户的 `.gitignore`**（非法条目，git 不会按预期忽略该文件）；
- `resolveInside(state.root, path)` 在 gitRoot 不在项目根内时直接抛 403 → 功能报"path is outside the workspace"。

**与自身记录矛盾**

`docs/PRD-v4-实施进展.md:216`（§6）明确记录了这条决定：

> **GIT-01 的 `git.ignore`**：唯一一个**不**跟随 `gitRepoRoot` 的 `git.*` 调用 —— 它的路径是**工作区相对**的（文件树上的「加入 .gitignore」动作），必须留在工作区/项目根上

代码注释（`store.js:2431-2433`）也写了同样的意图："must not follow the Git window's repository"。**但实际传入的数据与该意图不一致**：`path` 恰恰是 gitRoot 相对的，而 `repoRoot` 又指向了 Git 窗口的仓库。实现与决策、注释三者互相矛盾。

**修复方向**

让 `path` 与 `repoRoot` **同基准**，二者要么都换算到 `gitRoot`，要么都到 `state.root`；并同步修正 `store.js:2431-2433` 的注释与 `docs/PRD-v4-实施进展.md:216` 的表述（若最终决定跟随 gitRoot）。

**验收方式**

在"项目根非仓库 + 子仓库"场景下对子仓库文件点"加入 .gitignore"，检查**实际写入 `.gitignore` 的内容**是合法路径（如 `/src/a.ts`），且不是 `/../src/a.ts`；同时该文件确实被 git 忽略。

---

## 2. ⛔ 核心验收未达成（1 条）

### A1 — 编辑器内 `Ctrl+Shift+F` 仍打开全项目查找（TREE-04）

> **状态**：✅ 已修复（2026-10-30）—— 删除 `Mod-Shift-f`，条目抽成导出的 `editorKeymap()` 工厂，测试直接断言实际安装的整个 keymap 数组。验证：`tests/shortcuts.test.mjs`

| 项 | 内容 |
|---|---|
| **位置** | `src/client/CodeEditor.jsx:188`、`src/client/EditorArea.jsx:507`、`:592`、`:666` |
| **规格要求** | PRD-v4 §2.4：「`Ctrl+Shift+F` 不再触发全局查找」 |

**问题代码**

```js
// src/client/CodeEditor.jsx:188 —— CodeMirror keymap，仍挂着 Mod-Shift-f
{ key: 'Mod-Shift-f', run: () => { onFindInFilesRef.current?.(); return true } },
{ key: 'Mod-Alt-f',  run: () => { onFindInFilesRef.current?.(); return true } },
```

```js
// src/client/EditorArea.jsx:507 —— 应用层只认这两种
if (mod && ((event.shiftKey && !event.altKey && key === 'r') || (event.altKey && !event.shiftKey && key === 'f'))) {
```

```js
// src/client/EditorArea.jsx:592 —— 注册在【捕获阶段】
window.addEventListener('keydown', onKeyDown, true)
```

**机制**

1. 用户在编辑器里按 `Ctrl+Shift+F`；
2. 捕获阶段的处理器只认 `Shift+R` 与 `Alt+F` → **不匹配** → 既不 `preventDefault()` 也不 `stopPropagation()`；
3. 事件下沉到 CodeMirror 的 DOM → 命中 CodeEditor.jsx:188 的 `Mod-Shift-f` keymap → `store.openSearchTab()` → **全项目查找照样被打开**。

> 对照：`Ctrl+Shift+R` 之所以**不会**双触发，正是因为捕获阶段命中后 `stopPropagation()`，事件根本没到 CodeMirror。**只有 `Mod-Shift-f` 这一条漏网。**

**测试盲区（为什么绿灯没拦住）**

`tests/shortcuts.test.mjs:142-149` 只调用 `createEditorKeyHandler`（**应用层**），**完全没有触达 CodeEditor 的 keymap** → 测试全绿 ≠ 需求达成。

**修复方向**

- 删除 `src/client/CodeEditor.jsx:188` 的 `Mod-Shift-f` 条目（**保留** `Mod-Alt-f` 兜底）；
- **补一条 CodeEditor keymap 级断言**（例如：构造带 `Mod-Shift-f` 的 keydown，断言 `openSearchTab` 未被调用），避免同一类盲区再次发生。

**验收方式**

1. 焦点在编辑器正文 → 按 `Ctrl+Shift+F` → **不打开**全项目查找，且按键不触发浏览器其它行为；
2. 焦点在编辑器正文 → 按 `Ctrl+Shift+R` → 打开全局查找；
3. 按 `Ctrl+Alt+F` → 打开全局查找（兜底保留）。

---

## 3. 🟡 中等（9 条）

### M1 — `git.commit` 自身失败时没有回滚暂存

> **状态**：✅ 已修复（2026-10-30）—— catch 分支补 `git.unstage` 本轮 Add 的路径。验证：`tests/store-lifecycle.test.mjs`

- **位置**：`src/client/store.js:2609`（`git.commit`）、`:2628-2632`（catch）
- **现象**：`git.stage` 失败的分支（`:2599-2607`）有 `git.unstage` 回滚；但 **`git.commit` 自身失败**（pre-commit / commit-msg 钩子拒绝等）时，catch 里**没有** `git.unstage` → 留下"**已 Add 但没提交**"的半截状态。
- **违反**：PRD-v4 §3.1 明令禁止这种半截状态。
- **修复方向**：在 `store.js:2628-2632` 的 catch 中，对本次已暂存的路径补 `git.unstage` 回滚（注意 `amend` 场景不要误撤原有暂存）。

### M2 — 取消勾选时 `pendingStage` 可能残留，用户明确取消的文件仍被提交

> **状态**：✅ 已修复（2026-10-30）—— 取消时无条件从 `pendingStage` 移除。验证：`tests/store-lifecycle.test.mjs`

- **位置**：`src/client/store.js:2353`
- **现象**：`pendingStage.delete(entry.path)` 被 `entry.untracked === true` 守卫。但若该文件已被**文件树右键 Add**（`src/client/ProjectPanel.jsx:515`）进了 index，host 会改报 `untracked: false, staged: true` → 守卫不成立 → **`pendingStage` 残留** → 用户在 Commit 面板明确取消勾选的文件**仍会被提交**。
- **修复方向**：`pendingStage.delete` 的条件应覆盖"文件已进入 index"的情形；建议改为"只要不在待暂存集合就移除"。

### M3 — `setGitRepoRoot` 没有重置 commit 选择状态

> **状态**：✅ 已修复（2026-10-30）—— `setGitRepoRoot` 调用 `#resetCommitSelection()`。验证：`tests/store-lifecycle.test.mjs`

- **位置**：`src/client/store.js:296-303`
- **现象**：切换 Git 窗口的仓库后，旧仓库的 `pendingStage` / `buckets` **残留** → 提交时报 pathspec 错误；或**误 add 另一仓库的同名文件**。
- **对照**：`#switchProject`（`:915`）与 `#switchWorkspace`（`:860`）**都有**调用 `#resetCommitSelection()`（`:927-936`），唯独 `setGitRepoRoot` 漏了。
- **修复方向**：在 `setGitRepoRoot` 中同样调用 `#resetCommitSelection()`。

### M4 — `getStore` 仍在 render 期调用

> **状态**：✅ 已修复（2026-10-30）—— 淘汰推迟到 `setTimeout(…, 0)`，不再发生在 render 期。验证：`tests/store-lifecycle.test.mjs`

- **位置**：`src/client/index.jsx:149`（`const store = getStore(sessionId)`）
- **现象**：render 期内建 store → 会对**别的** store 调 `deactivate()` → 触发 `set()` → 通知订阅者更新 + `persistNow()` **写盘**。
- **违反**：规格明确要求把 `getStore` 移出 render。
- **修复方向**：在组件外（事件处理器 / `useEffect` / `useMemo`）解析 store，render 期只读取已解析好的引用。

### M5 — 冲突弹窗正文被裁成一行省略号，用户读不到说明

> **状态**：✅ 已修复（2026-10-30）—— `nowrap` 只留给 `h2`，正文可换行并带 `title`。验证：`tests/editor-conflict.test.mjs`

- **位置**：`src/client/styles.js:813-814`
- **代码**：`.iwb-editor-scoped-backdrop .iwb-modal h2, .iwb-editor-scoped-backdrop .iwb-modal p { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`
- **现象**：`<p>` 段落被裁成单行省略号，且 `<p>` 上**没有 `title`** → 鼠标悬停也读不到全文 → 用户不知道冲突怎么处理。
- **说明**：`white-space: nowrap` 本身是规格要求（标题不折行）；问题在**正文 `<p>` 也被一并 nowrap**。
- **修复方向**：把 `nowrap` 只保留给 `h2`，正文 `<p>` 改为可换行（如 `white-space: normal` + 限制行数），并补 `title` 属性。

### M6 — 保存冲突点"取消"后 `tab.conflict` 未清除，弹窗会再弹一次

> **状态**：✅ 已修复（2026-10-30）—— 新增 `store.dismissConflict(tabId)`；弹窗的"已忽略"标记改由缓冲区时间戳释放，轮询重新检出同一处分歧时不再复弹。验证：`tests/editor-conflict.test.mjs`

- **位置**：`src/client/store.js:2109-2124`、`src/client/EditorArea.jsx:630-635`
- **现象**：用户在冲突弹窗点"取消" → `tab.conflict` 仍在 → 文档区**再次弹出**同一个冲突弹窗。
- **修复方向**：取消时清除 `tab.conflict`（或加 `dismissed` 标记），使"取消"真正表示"这一次不处理"。

### M7 — 面包屑折叠阈值写死 520px，且先裁掉末尾文件名

> **状态**：✅ 已修复（2026-10-30）—— 改为按真实溢出折叠（`ResizeObserver` + 纯函数 `breadcrumbOverflows`）；中间段先让出空间，文件名不被裁。验证：`tests/editor-conflict.test.mjs`

- **位置**：`src/client/styles.js:219-222`
- **现象**：
  1. 折叠阈值**写死 520px**，与"内容是否真的溢出"无关 —— 窗口宽但编辑区窄时不折叠，窗口窄但内容很短时反而折叠；
  2. `flex-shrink:0` + `overflow:hidden` 从**右侧**硬裁 → **先裁掉末尾的文件名**（最重要的信息），而 `…` 此刻 `display:none`。
- **对照**：`docs/PRD-v4-实施进展.md:208` 记录 EDITOR-02 采用**容器查询** `@container iwb-editor-toolbar (max-width: 520px)` —— 阈值写死正是该决定的直接后果，且与"不折行"的意图存在冲突。
- **修复方向**：改为按**实际溢出**折叠（`ResizeObserver` / `scrollWidth > clientWidth`）；折叠时保留**末尾**文件名、裁中间的目录段。

### M8 — 项目树"显示历史"传入的路径基准与 `git log` 不一致

> **状态**：✅ 已修复（2026-10-30）—— `showHistory` 换算到仓库基准；文件不在所选仓库内则清空过滤。验证：`tests/store-lifecycle.test.mjs`

- **位置**：`src/client/store.js:2659-2661`（`showHistory(rel)`）
- **现象**：传的是**项目相对** `rel`，但 `git log -- <path>` 按 **gitRoot 口径**执行 → 路径不存在 → **历史列表恒为空**。
- **修复方向**：`showHistory` 内把 `rel` 换算到 gitRoot 基准后再下发。

### M9 — "常驻 store ≤3"在真实宿主下不成立，验收结论需改正

> **状态**：✅ 已修复（2026-10-30）—— `isMountedSession` 只认当前挂载的会话，"开 10 个工作区后常驻 ≤3"在真实宿主下重新成立（不再是"改验收"）。验证：`tests/store-lifecycle.test.mjs`

- **位置**：`src/client/store.js:3177`、`src/client/index.jsx:268-274`
- **现象**：`evict()` 的存活判定是"该工作区下**有任一会话仍 mounted**"（`store.js:3177` 的 `alive`）。真实宿主里，**10 个会话各开一个 IDE 页签** → 全部 `alive` → **一个都不会被淘汰**。
- **因此**：验收表里 "常驻 store ≤3 ✅" 只由 `isMounted` 恒为 `false` 的**测试桩**证明，**在真实宿主下不成立**。
- **修复方向（择一）**：
  - **改实现**：存活判定改为"该工作区有**正在显示**的会话"（而非"有 mounted"），或按会话而非工作区限制；
  - **改验收**：若规格允许这种情形，就**改正验收表的结论**，写明"≤3 是上界，实际由挂载会话数决定"。
- **注意**：R1 的修复（跳过含未保存编辑的 store）会让这条更难达成，两者需一并考虑。

---

## 4. 🔵 轻微（7 条）

| 编号 | 位置 | 问题 |
|---|---|---|
| **L1** | `src/client/store.js:553` | 纯相对路径多付 2 次 `fs.stat`（偏离 PRD-v4 §7.5「纯相对 → 0」）。`docs/VERIFICATION.md:135` 的"0 次 stat"**仅对其测试输入成立**，`/etc/passwd` 类输入仍会 1 次。建议修正 VERIFICATION 的表述或补齐实现。 | ✅已修复（表述收窄）
| **L2** | `src/client/store.js:598` vs `:600` | 客户端围栏根是 **workspace**，host 围栏根是 **candidate.base** —— 两者不一致。候选路径含 `..`、越出自己 base 但仍在工作区内 → host 抛 403 被**静默跳过** → **工作区内的文件打不开且无提示**。非越权，属误伤。建议把 host 围栏根也放到 workspace 根。 | ✅已修复
| **L3** | `src/client/store.js:1920-1936` | 切换 Git 仓库后，已打开的 **diff / commit 标签页仍指向旧仓库** → 变成永久错误页。建议切仓时关闭或刷新这类标签。 | ✅已修复
| **L4** | `src/client/store.js:1282-1296` | PERF-07 恢复出的展开目录改为后台**串行** `loadDir`（改前是 `Promise.all`），每目录 2 次通知。`docs/VERIFICATION.md:152` 已自述此点，但**验收表仍标 ✅** —— 需与验收口径对齐。 | 📝表述已改
| **L5** | `src/client/ProjectPanel.jsx:249` + `:237` | 双击目录箭头会**连翻三次**（2 次 click + 1 次 dblclick），中间态**肉眼可见地闪**。建议在 dblclick 时抑制紧随的 click。 | ✅已修复
| **L6** | `README.md:28`、`README_EN.md:28`、`src/client/i18n.js:409`/`:851` | README 仍写"收藏夹 / Favorites"；`editor.externalChanged` 成了**死键**（对应功能已改）。建议同步文案。 | ✅已修复
| **L7** | `src/client/store.js:1130-1132` + `:2960-2972` | 切到 Commit 面板后 `+N/-N` 最多**缺 2 秒**（`#wantsNumstat()` 才触发 numstat）。提交前已强制刷新，**不影响正确性**，但显示滞后。建议切面板时主动带 `numstat` 刷新。 | ✅已修复

---

## 5. ⚠️ 环境风险（1 条，待用户判断）

### E1 — `Ctrl+Shift+R` 在纯浏览器形态（DSH Web）是 Chromium 硬刷新

> **状态**：⚖️ 接受现状 + 文档化（2026-10-30）—— 保留 `Ctrl+Shift+R`（已批准规格、桌面形态不占用）；浏览器形态的硬刷新风险写进 `README.md` / `README_EN.md` 的"已知限制"与设置页提示。**仍需用户拍板**是否改默认键。

- **事实**：`Ctrl+Shift+R` 在浏览器里是 Chromium 的**硬刷新**快捷键，`preventDefault()` 对它**无效** → 整页刷新 → **编辑缓冲区丢失**。
- **核实范围**：UP-04 只核实了 **Electron 宿主菜单**未占用该组合（结论见 `docs/PRD-v4-实施进展.md` §2.1），**未覆盖纯浏览器形态**。
- **重要性**：用户原始动机正是"搜狗浏览器容易冲突"，而搜狗/Chromium 内核浏览器**就是**纯浏览器形态。
- **兜底**：`Ctrl+Alt+F` 仍在（`host/settings-store.js:107`）。
- **建议**：由用户拍板 —— (a) 保留 `Ctrl+Shift+R` 并在文档里提示浏览器形态改用 `Ctrl+Alt+F`；(b) 换成浏览器形态更安全的组合；(c) 插件侧对浏览器形态做区分处理。

---

## 6. 复核方法与局限

### 6.1 方法

- **基线**：`e6f491d`（实现提交的前一个）→ 只报**本次引入**的回归，不报既有问题。
- **范围**：`de3625f` 相对基线 **42 文件 / +7687 −1112**（`src` 20 文件 +2159 −532；新增 11 个测试文件）。
- **自动化**：`npm test` → **289 pass / 0 fail / 0 skipped**（基线 159，新增 130）。
- **并行审计**：4 个 verifier 分别审计 PERF / GIT+LAYOUT / TREE+EDITOR / COMMIT+FILE；主流程另做独立复核（快捷键 7 处、FILE 围栏、COMMIT index 语义、host 路径换算、生产包计数器门控、LAYOUT DOM 层级、收藏夹清理、slice 迁移）。
- **证据要求**：每个代码锚点均已**回查源码逐行核对**；本文所有 `文件:行号` 均已在本轮复核时二次确认。结论不靠推断。

### 6.2 局限（**修复时请一并考虑**）

1. **无法实机验收**：本机无 DSH 宿主、无多仓库工作区、无浏览器形态宿主。以下均**未实测**：
   - 终端滚动的实际手感；
   - stripe 点击命中；
   - 弹窗像素位置；
   - 320px 面包屑；
   - 10 工作区的内存曲线。
2. **部分缺陷是"源码路径推导 + host 纯函数离线复算"得出**：未在真实仓库执行 `git add` 或写 `.gitignore`（审计方要求只读）。
3. **macOS / Linux 未实测**：`fs.stat` 行为按 POSIX 语义推断。
4. **`f7fe228` 与 `de3625f` 的关系**：`de3625f` 是 `f7fe228` 的 amend（reflog: `commit` → `commit (amend)`），两者**代码树完全一致**，仅 `docs/PRD-v4-实施进展.md` 不同。
   ⚠️ 但 `docs/PRD-v4-实施进展.md:227` 的 §7 提交表仍记着旧哈希 `f7fe228` —— 该提交已**不在分支历史里**（只能从 reflog 找到）。修复后再提交时，请把 §7 的哈希更新为**新提交的实际哈希**。

### 6.3 上游待办（不在本仓库，勿混）

UP-01~03（DSH 核心会话表全量重建、订阅粒度、better-sidebar 的 O(W×S) 分组）仍**待反馈给上游**；UP-04/UP-05 已由 DSH 解包宿主 `app.asar` 核实并**结案**。本文所有问题均在**插件仓库内**，与上游无关。

---

## 7. 修复建议的落点（不改变既有文档职责）

| 修复完成后应更新 | 内容 |
|---|---|
| `docs/PRD-v4-实施进展.md` §1 范围表 | 把 R1/R2/R3/A1/M1~M9 涉及的条目状态从 ✅ 改为「🔧 复核发现问题，修复中」，再在修复完成后改回 ✅ 并注明复核记录 |
| `docs/PRD-v4-实施进展.md` §6 | 记录本次复核触发的**决定与偏差**（尤其 R3 涉及 GIT-01 的 `git.ignore` 口径，需要改写现有第 216 行的表述） |
| `docs/PRD-v4-实施进展.md` §7 | 提交哈希填**新提交的实际哈希**（不要沿用已失效的 `f7fe228`） |
| `docs/VERIFICATION.md` §PRD-v4 段 | 修正与 M9、L1、L4 相关的验收结论表述（它们目前标 ✅ 但前提不成立） |
| 本文件 `docs/PRD-v4-复核记录.md` | 逐条标注「已修复 / 接受不修 / 延后」及对应提交哈希 |

---

## 8. 记录约定

1. **本文件只服务本轮**（PRD-v4）。下一轮另起文件，命名规则为 `PRD-vN-复核记录.md`。
2. **复核不改代码**：本文产出时对产品源码为**只读**，所有修改由 DSH 实施。
3. **每修一条**：在本文件对应条目下追加「状态 + 修复提交 + 验证方式」，避免"改了但没人知道改没改"。
4. **验收以实测为准**：修复后的验收必须**实测**，不接受"代码看起来对了"作为通过依据。
