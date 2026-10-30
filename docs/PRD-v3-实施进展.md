# PRD-v3 实施进展（第一轮）

> 对应决策：`docs/PRD-v3.md`。
> 状态：已进入实施，M1 主体 + M2 搜索/Git Drawer 已落地；部分实机交互仍待补验。

## 1. 已完成

### 编辑器与数据安全

- **默认打开模式 C**：`editor.openMode = auto|editable|readonly`，`editableMaxBytes` 默认 1 MiB；超过限制自动只读，设置可覆盖。
- **只读复用 CodeMirror**：只读面支持拖选、`Ctrl+A`、`Ctrl+C`；代码区不再依赖根节点的 `user-select`。
- **插件自有 FindBar**（`src/client/FindBar.jsx`）：
  - 计数 `当前/总数`；
  - 大小写、整词、正则；
  - `Enter` / `Shift+Enter` / `F3` / `Shift+F3` 循环；
  - `Esc` 关闭；
  - 编辑态替换 / 全部替换；
  - 无 CodeMirror 英文黑块面板。
- **外部修改检测**：
  - 保存携带 `expectedMtimeMs`，冲突返回 `stale-file`，不覆盖磁盘；
  - 轮询用 `fs.stat` 检查活动文件 mtime，显示“磁盘内容已变化”，提供重新加载 / 覆盖磁盘。
- **关闭脏标签三选一**：保存并关闭 / 放弃 / 取消；取消为默认焦点。`Ctrl+W` 可关闭当前标签。
- **确认框**：默认焦点在取消，`Esc` 取消，危险操作不再 `autoFocus`。
- **回滚修复**：`git restore --source=HEAD --staged --worktree`，已暂存文件不再残留 `M `。
- **删除**：回收站失败返回 `trash-failed`，客户端二次确认后才永久删除，宿主不再静默降级。

### 搜索

- `fs.files`：仓库走 `git ls-files -co --exclude-standard`，非仓库走受限遍历；Quick Open 使用。
- `fs.search`：仓库走 `git grep`，非仓库走遍历；支持大小写/整词/正则、结果上限、耗时；`[` 等字符按字面量处理。
- **Quick Open**：`Ctrl+Shift+N` 与 `Ctrl+P`，文件索引缓存，模糊匹配，方向键/Enter/Esc。
- **Find in Files**：编辑器标签页，按文件分组、命中数、耗时、点击/Enter 定位行，F8/Shift+F8 循环命中；顶部工具栏、Project 面板头部与右键菜单均提供入口。`Ctrl+Alt+F` 作为 `Ctrl+Shift+F` 被外壳占用时的备用快捷键。
- **搜索排除**：git grep 默认排除 `dist/build/out/node_modules/coverage/.next` 等生成目录，避免搜到构建产物。
- **Diff 查找**：Diff 标签内 `Ctrl+F` 打开同一 FindBar，按行计数、上下跳转并滚动/高亮当前行。
- **Markdown 预览查找**：`DomFindBar` 使用 CSS Custom Highlight API，支持计数/大小写/整词/正则/上下跳转。
- **树过滤 A+B**：
  - 文件模式默认全项目扁平定位；
  - 树模式只过滤已加载目录，明确提示，不再出现永久“加载中”。

### Git

- **右侧 Drawer**：日志全高；宽屏右侧 420px，可拖拽并持久化到 `layout.gitDrawerWidth`；窄屏覆盖式。
- **点击语义**：单击只选中；双击/Enter 打开 Drawer；Esc 关闭并回焦行；工具栏提供“打开详情”按钮；日志加载后默认选中最新提交，`Ctrl+Alt+D` 可直接打开详情（键盘兜底）。已实机验证该快捷键与 Esc。
- **Drawer 布局修复**：打开 Drawer 不再把面板切成覆盖式；只有主区 < 520px 才覆盖。日志区变窄时对作者/日期列做压缩而不是隐藏，普通底部面板与分栏 Drawer 下都能看到作者/时间。新增 `gitLayout()` 纯函数与 5 项单测。
- **Git 根节点宽度修复**：`.itw-git` 之前作为 flex item 按内容 shrink-wrap，导致右侧留白；现改为 `flex: 1 1 auto; width: 100%`，半屏/全屏都会铺满底部 dock。
- **树键盘入口**：`Alt+1` 打开 Project 时递增 `treeFocusTick`，ProjectPanel 自动聚焦树容器，便于 ArrowDown / Ctrl+A。
- **Drawer 内容**：subject、完整/短 SHA、作者、邮箱、时间、refs、parents、完整消息、文件列表（状态/+/-）、选中文件内联 diff、打开完整 diff。
- **分支控件去重**：当前分支按钮（弹出可搜索分支列表）+ “仅当前分支/所有分支”切换，不再并排两个 `main` 下拉。
- **检出保护**：工作区有改动时阻止检出；确认后执行；失败显示真实 stderr。
- **筛选**：日期预设、作者、消息、路径；消息按固定字符串匹配。

### 文件树 / 终端 / Commit

- 打开态与选中态分离：选中用背景色，打开用左侧强调条 + 强调色文件名，不再两行同色。
- 树内 `Ctrl+A` 只选树节点，不再泄漏到 DSH 侧栏。
- 终端 `deactivate` 不再清空 sessions；TerminalPanel 在 Git/收起状态下保持挂载（隐藏而非卸载），切回终端时 PTY 与 scrollback 仍在（待实机复核）。
- Changelist：active 过滤 + 删除（文件回 Default）。
- Commit 未跟踪行增加状态色；分支/日期控件整理。

## 2. 自动化验证

- `npm test`：**123 项全部通过**（2026-10-23）。
- 新增覆盖：
  - `tests/find.test.mjs`：字面量/大小写/整词/正则、替换、捕获组；
  - `tests/search.test.mjs`：非仓库遍历、git grep、忽略文件、`[` 字面量；
  - `tests/git-layout.test.mjs`：Drawer 分栏/覆盖式与作者日期列的几何规则；
  - `tests/store-ui.test.mjs`：搜索标签、单击只选、打开模式 C、关闭三选一、Close Others 保存后再关、Drawer 加载、脏工作区阻止检出、结果打开、stale-file 保存、回收站失败二次确认、缺失文件恢复标签自动关闭；
  - `tests/render.test.mjs`：Drawer、Find in Files、Quick Open、文件过滤、打开态；
  - `tests/workspace-write.test.mjs`：stale-file；
  - `tests/staging.git.test.mjs`：回滚清空 index + worktree。
- `npm run build`：通过，`dist/client.js` 已更新。

## 3. 实机确认

已在 DSH Desktop 实机确认：

- 只读/编辑代码面均可 `Ctrl+F` 打开中文 FindBar，含计数、替换行；
- `Ctrl+Shift+N` Quick Open 可列出项目文件（`fs.files` 新 Host API 生效）；
- `Ctrl+Alt+F` 可打开 Find in Files；搜索 `requestCheckout` 返回 5 处 / 3 文件 / 78ms（其中一处来自本文档），`dist` 构建产物已被排除；
- 新开文件默认编辑（工具栏显示“只读/保存”，非旧版“编辑”）；
- Git 单击提交只选中、不打开详情；
- `Ctrl+A` 选中当前可见的全部树节点，未再泄漏到 DSH 侧栏；
- 外部修改冲突：新建临时文件并在编辑器中打开，磁盘上改成不同内容后，工具栏出现“磁盘内容已变化 / 从磁盘重新加载 / 覆盖磁盘”；删除该文件后重载，缺失文件的恢复标签自动关闭。
- 关闭脏标签三选一：编辑临时文件后按 `Ctrl+W`，出现“取消 / 放弃修改 / 保存并关闭”，默认焦点在取消；用 Tab + Enter 放弃修改后标签关闭。
- `Ctrl+Alt+D` 实机打开右侧/覆盖式 Drawer，显示 SHA、作者、邮箱、时间、refs、parents、完整消息、变更文件列表与 +/-；
- Esc 关闭 Drawer，选中行仍在；
- Git 工具栏只保留一个分支切换按钮 + 一个“仅当前分支”切换，不再有两个 `main` 下拉。

## 4. 尚未完成 / 待补验

- Git Drawer 已通过 `Ctrl+Alt+D` 实机打开/关闭；双击与 Enter 打开仍受点击/焦点问题影响，未单独确认。
- 终端输出 marker 后经过工具窗切换仍在 scrollback 中；跨对话（切到聊天再回 IDE）未实测。
- `Ctrl+F` 实机正常；`Ctrl+Shift+F` 被 DSH/Chromium 外层吞掉；`Ctrl+Alt+F` 备用键可用。顶部按钮点击仍被外层覆盖层拦截，Project 面板头部与右键菜单入口作为兜底。
- Find in Files 结果打开已实机确认：搜索 `requestCheckout` 后按 Enter 打开 `docs/PRD-v3-实施进展.md` 第 75 行；F8 / Shift+F8 可在命中项间循环。
- 回收站失败二次确认、删除/回滚的真实点击流程尚未手工执行。
- 分支检出、删除、回滚未做破坏性实机操作。
- 文件树“打开态 vs 选中态”代码与 SSR 测试已完成；用户真实鼠标点击树/顶栏正常，我的合成点击仍被外壳拦截，因此未取得最终视觉对照。
- 主题/DPI/10k 文件性能/拖拽未复测。
