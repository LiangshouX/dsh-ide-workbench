# 验收记录（V1.1 / M0–M4 合并验收）

> 环境：DSH Desktop（Web GUI 由 Desktop 内嵌），Windows 11，zh-CN，Claude 皮肤；
> 实测窗口 1938×1038 物理像素（1.25 DPI）。插件以本地 linked bundle 安装，
> `plugin_manager install_bundle` 结果 `application: applied`、`warnings: []`。

## 自动化测试（37 项全部通过）

```sh
cd dsh-ide-toolwindows && npm test
# 37 pass / 0 fail
```

覆盖：

| 文件 | 覆盖 |
|---|---|
| `tests/diff.test.mjs` | unified diff 解析、行号、hunk、side-by-side 配对、patch 选择重建（含新增文件）、未选行上下文转换 |
| `tests/graph.test.mjs` | 线性/分支/合并的 lane 布局与几何 |
| `tests/git.test.mjs` | porcelain v2、numstat、路径围栏 |
| `tests/staging.git.test.mjs` | **真实 git**：仅暂存选中新增行、整块暂存、反向取消暂存后 index 精确归零 |
| `tests/file-types.test.mjs` | Java/TS/Python/Markdown/JSON/SQL/Shell/图片等图标分类与特殊文件名（`.env`、`Dockerfile`、锁文件） |
| `tests/markdown-outline.test.mjs` | 标题提取（忽略 fenced code）、slug、重复标题去重 |
| `tests/workspace-write.test.mjs` | 原子写入、UTF-8/BOM/UTF-16 编码保持、路径越界与缺失文件拒绝 |
| `tests/projects.test.mjs` | 项目候选 = 根目录 + 一级子目录（跳过隐藏/`node_modules`）、Git 标记；**真实 git**：容器根无仓库、选中子目录后 `isRepo=true` |
| `tests/render.test.mjs` | 真实 React SSR：Workbench / Project / Commit / Git / Diff / Code / **Markdown 预览 + 目录** / **编辑态工具栏** / **项目选择器** / **非仓库 Git 提示** |

另用 `.verify/patch-test.mjs`（临时脚本，已随 `.verify` 清理）在真实 git 仓库中复核：
选择 2 个新增行 → `git diff --cached` 恰好只有这 2 行；整块 → 删除+新增；
`git apply -R` 取消暂存后 index 为空。

## 实机验收（截图人工核对）

| 验收点 | 结果 | 证据 |
|---|---|---|
| 侧条图标 + 一级面板注册 | ✅ | `Slots.listSubTree`：`sidebar.panellist` 与 `main` 均出现 `ide-toolwindows`，active |
| 设置分区注册 | ✅ | 设置页导航出现「IDE 工具窗口」 |
| 单击文件 → 预览标签；内容渲染 + 语法高亮 | ✅ | 打开 `patch-test.mjs`，标签斜体+圆点，行号/高亮/面包屑正确 |
| 双击固定、固定标签不被替换 | ✅（代码路径 + SSR） | `pinTab`/preview 复用逻辑；实机预览标签存在 |
| Git 着色 | ✅ | 深色/浅色皮肤下 modified=蓝、untracked=绿；状态栏「2 项改动」 |
| Commit 三组 + 徽标 | ✅ | 真实仓库：已暂存 0 / 未暂存 0 / 未版本控制 2；未跟踪行复选框未勾选，组按钮为「全部暂存」 |
| Commit 详情 + Diff | ✅ | 非合并提交显示元信息、full SHA、refs、作者/日期、+222 −222 与逐文件 hunk diff |
| 合并提交详情 | ✅ | 重启后实测：`Merge pull request #2519` 显示元信息 + **+445 −446** 首父差异（`apps/cli/package.json` 的 version/access 变更） |
| Git 日志 + 提交图谱 | ✅ | 真实仓库 200 条分页表，Graph 车道/节点/合并连线渲染；HEAD→master / origin/master 标签 |
| 分支区 + 快速切换 | ✅（UI） | 当前分支 chip + 切换分支下拉 + 历史过滤下拉 |
| 终端 PTY | ✅ | PowerShell 7 会话启动，提示符 `PS D:\...`，xterm 渲染 |
| **Windows 中文编码** | ✅ | 粘贴并执行 `echo 中文你好` → 输出 `中文你好`，无乱码 |
| 多终端会话 + 徽标 | ✅ | 侧条/底部 Terminal 徽标显示会话数 |
| 快捷键 | ✅ | Alt+1 打开/聚焦 Project、Alt+0 Commit、Alt+9 Git、Alt+F12 Terminal；从会话页首次按下会“显示”而非“关闭” |
| 设置持久化 | ✅ | `C:\Users\<user>\.dsh\ide-toolwindows\settings.json` 由客户端写入 lastRoot / projectRoots / workspaceState |
| **项目根目录选择器** | ✅ | Project 标题旁下拉打开「选择 IDE 项目」；列出工作区根目录 + 一级子目录，子目录带 **Git** 标记、当前项带「当前」标记 |
| **容器工作区 + 嵌套 Git** | ✅ | 工作区根 `DSH-IDE-TOOLWINDOWS-ROOT` 无 repo 时 Git 显示提示；选 `dsh-ide-toolwindows` 后文件树切到插件目录、分支 `main`、Git 日志 2 条提交、状态栏 16 项改动 |
| **项目选择持久化** | ✅ | 选择子目录后刷新整个页面：Project 根、Git 分支/日志与状态栏均恢复为子目录（`projectRoots` 映射生效） |
| **非仓库回退提示** | ✅ | Git / Commit 窗口和欢迎页显示「当前目录不是 Git 仓库」+「选择 Git 子项目」按钮，点击打开同一选择器 |
| 路径围栏 / 同源准入 | ✅ | 未认证请求返回 403；`..` 越界被拒绝 |
| 主题跟随 | ✅ | 全部使用 `--dsw-alias-*`；Claude 皮肤下按钮/高亮随品牌色 |
| **按类型文件图标** | ✅ | 实机放大核对：`Main.java` 咖啡杯、`app.ts` TS、`data.json` `{}`、`SVG` 图片、`query.sql` 数据库、`README.md` M↓、`run.ps1` `>_`、`style.css` `#`、普通文件灰色文档 |
| **Markdown 只读渲染** | ✅ | 打开 PRD：标题、表格、任务列表、emoji、代码卡片与 DSH 聊天一致（复用宿主 `MarkdownText`） |
| **Markdown 目录** | ✅ | 工具栏目录按钮打开右上角浮层；标题按层级缩进、当前标题高亮；点击标题滚动定位 |
| **只读 / 编辑开关** | ✅ | 默认只读；点击「编辑」进入 CodeMirror（行号、Markdown 语法高亮）；点击「只读」回到渲染预览 |
| **未保存状态** | ✅ | 编辑后标签出现橙点、工具栏「未保存」、保存按钮变主色；`Ctrl+Z` 回到原文后脏标记消失 |
| **保存（Ctrl+S / 按钮）** | ✅ | 实机保存 `save-test.md`：toast「已保存」、脏标记清除；磁盘内容更新且 **UTF-8 BOM 保持不变**（`EF BB BF` 开头，49 字节） |
| **未保存关闭确认** | ✅ | 修改后点标签 × 打开「未保存的修改」确认；「放弃修改」关闭标签并丢弃草稿，磁盘保持已保存版本 |
| 设置新增项 | ✅（实机） | 设置 → IDE 工具窗口 → 编辑器：打开文件默认只读、渲染 Markdown，默认均开启；说明文案正确 |

## 已知限制（V1 规格内）

- 项目根目录选择器只扫描工作区根目录的**一级**子目录；更深层的独立仓库需先打开
  其上级目录，或将其作为工作区打开。
- 终端会话随面板卸载结束；DSH 重启不恢复（规格允许）。
- 宿主侧条图标无法显示数字徽标，徽标画在插件自绘 stripe。
- 关闭工作台面板即关闭所有终端会话（`deactivate` 清空会话）。
- 开发期直接改 `dist/client.js` 会触发 Client HMR 重载并重置面板选择；
  正式使用无此现象。

## 最终状态

- **全部验收项均已通过**（37 项自动化测试 + 实机核对，含重启后合并提交 first-parent 差异）。
- V1.1 增强（0.2.0）：按类型文件图标、Markdown 只读渲染 + 目录、默认只读的编辑开关（CodeMirror）、
  脏标记 / 保存 / 还原 / 关闭确认、BOM 与换行保持；`fs.write` 已由 bundle reload 加载并实机保存成功。
- V1.2（0.2.1）：IDE 项目根目录选择（工作区根目录 + 一级子目录、Git 标记、按工作区持久化），
  非仓库时的 Git/Commit/欢迎页回退提示；刷新页面后选择与 Git 数据均恢复。
- Git 表新增窄宽响应：底部面板宽度 < 640px 时隐藏作者/日期两列，把空间留给提交消息。
- 验收过程只读取了 `D:\Harness\deepseek-harness`（打开日志/差异、输入消息但未提交）；
  曾弹出的 Discard 对话框已取消，文件与 index 均未改动（`git status` 仍为两个 untracked 文件）。
- 本插件测试用的临时仓库、演示文件、截图与 `.render-tmp` 均已清理；`settings.json` 的 `lastRoot`
  为 `D:\Code\Node\DSH-IDE-TOOLWINDOWS-ROOT`，`projectRoots` 保留本次验证选中的
  `dsh-ide-toolwindows` 子目录，`workspaceState` 清空。

## V2（0.3.0）验收记录（2026-10-22）

- 自动化：65 项测试通过（新增 commit-model / fileops / git-colors / run-command）。
- 实机：Project 选中模型/双击打开/多选/文件操作/拖拽/右键菜单（快捷键列）、IDEA 着色与目录递归上色、忽略文件、品牌图标；Commit 两组勾选与 index 一致、变更列表、按目录分组、Change View、提交前任务；Git 详情底部面板、文件列表与单文件提交 diff、路径历史、双提交 Compare、未变更块折叠、单词级高亮；布局点击开合（Project/Commit 互斥）、收起全部、全屏、状态栏行列与编码。
- 移入 V3：Local History、分支 Compare、Cherry-pick、Create Branch/Tag、Annotate、Floating/Split。

---

## PRD-v4 验收记录（2026-10-30）

> 对应规格：`docs/PRD-v4.md`；对应进展：`docs/PRD-v4-实施进展.md`。
> 本轮**未做实机走查**（未在 DSH 里实际操作），下面的「自动化」列给出可复现的用例位置，
> 「实机」列留给下一轮补做。

### 自动化（289 项全部通过，连续 4 次全绿）

```sh
cd dsh-ide-workbench && npm test
# 289 pass / 0 fail / 0 skipped
npm run build   # dist/client.js 已更新
```

| 验收点 | 结果 | 自动化用例 |
|---|---|---|
| 切到**热**工作区 **0** 个 git 子进程 | ✅ | `tests/perf-notify.test.mjs` |
| 单次轮询 **1** 个 git 子进程（Commit 窗口可见时 3） | ✅ | `tests/perf-notify.test.mjs` + `src/host/git.js` 的 `subprocesses` 计数 |
| 连续 50 次等值 `set()` → **0** 次通知 | ✅ | `tests/perf-notify.test.mjs` |
| 开 10 个工作区后常驻 store **≤ 3**；**有未保存编辑的 store 不淘汰**（宁可超过 3 也不丢草稿） | ✅ | `tests/perf-notify.test.mjs` + `tests/store-lifecycle.test.mjs` |
| 500 条目目录列举 **0** 次 `lstat` | ✅ | `tests/perf-notify.test.mjs` |
| 冷工作区进入：**0** 次未聚焦标签读盘、**1** 次目录列表请求 | ✅ | `tests/perf-cold-workspace.test.mjs` |
| 6 个面板 + 2 个视图迁移到 slice 订阅，无关字段变化不再触发重渲染 | ✅ | `tests/perf-slice-{project,editor,git}.test.mjs`（含「`state` prop 一读即抛」的 Proxy 守卫） |
| 文件树 flatten 的 memo 依赖正确（展开/折叠/筛选/状态色四种变化都刷新） | ✅ | `tests/tree-twisty.test.mjs` |
| 目录箭头单击展开/折叠，**不**触发行选中；双击仍有效 | ✅ | `tests/tree-twisty.test.mjs` |
| 【文件定位】按钮：仅文件标签可点，展开并滚动到该文件 | ✅ | `tests/tree-twisty.test.mjs` |
| 收藏夹彻底移除（按钮 / 右键项 / 快捷键 / 状态），旧配置静默加载 | ✅ | `tests/tree-twisty.test.mjs` + `src/client/host/settings-store.js` 源码守卫 |
| `Ctrl+Shift+R` 打开全局查找；`Ctrl+Shift+F` **不**触发；裸 `Ctrl+F` 仍是文件内查找 | ✅ | `tests/shortcuts.test.mjs` |
| 外部修改 → 文档区**居中弹窗**（无 chip），两个操作都可用 | ✅ | `tests/editor-conflict.test.mjs` |
| 面包屑单行不折行，中间段折叠为 `…`，完整路径在 `title` | ✅ | `tests/editor-conflict.test.mjs` + `src/client/styles.js` 契约 |
| 底部栏通栏（`bottomNode` 是 `.iwb-root` 的直接子节点，不在 `.iwb-center` 内） | ✅ | `tests/editor-conflict.test.mjs` |
| 勾选未版本控制文件**不写 index**（`git diff --cached` 为空、字母仍 `U`） | ✅ | `tests/commit-staging.test.mjs`（**真实 git**） |
| 点提交时先 Add 再一起提交；Add 失败 → 提交中断 + index 回滚 | ✅ | `tests/commit-staging.test.mjs`（**真实 git**） |
| 勾选**已跟踪**的改动仍会立即暂存，并进入提交 | ✅ | `tests/git-panel.test.mjs`（**真实 git**） |
| 切项目/切工作区后不残留旧的勾选与分组 | ✅ | `tests/commit-staging.test.mjs` |
| Git 面板的仓库自治：切仓库不动文件树与标签页，git 调用换根 | ✅ | `tests/git-repo-scope.test.mjs` + `tests/git-panel.test.mjs` |
| Commit 抽屉：删除冗余预览、变更文件成树且可折叠、rename 取 `b/` 侧路径 | ✅ | `tests/git-panel.test.mjs` |
| 聊天 File link 的相对路径可打开；**工作区外**的链接被拒（歧义形态 0 次 stat 探测；纯相对形态若主解析落在项目根内也是 0 次，落在项目根外时按 PRD §7.7 第 2 条要探测项目根那份，最多 3 次） | ✅ | `tests/file-link-store.test.mjs` + `tests/file-address.test.mjs` |
| 绝对路径形态无回归；POSIX 工作区内绝对路径不被改写 | ✅ | `tests/file-link-store.test.mjs` |

### 实机（待补）

- [ ] 底部栏通栏的视觉效果、终端输入与滚动（§10.4 布局）
- [ ] 窄屏（≤560）上下排布与 320px 面包屑（§10.4 内容区）
- [ ] 文档区居中弹窗的观感与窄屏不换行（§10.4 内容区）
- [ ] 【文件定位】滚动到文件中部（§10.4 Project）
- [ ] 10 个工作区后的内存曲线（§10.4 性能）

### 本轮新增的已知限制

- **另一个仓库的文件不能在编辑器里打开**：编辑器读写围栏是项目根，GIT-01 不允许放宽它；
  「跳到源文件」遇到这类文件会提示而不是打开（见 `docs/PRD-v4-实施进展.md` §6）。
- **一次轮询在操作系统层面是 2 个 git 进程**（`rev-parse` + `status`）：PRD §1.2 PERF-06 的基线口径
  只统计 `status()` 内部的 3 个，宿主 `repoEnv()` 的那次 `rev-parse` 不在其内（见 §3.1 注 1）。
- **恢复出的展开目录是后台逐个（串行）加载**，不是严格等到用户展开才加载（见 §3.1 注 3）；冷进入本身只发 1 次目录列表请求。
- **`Ctrl+Shift+R` 在纯浏览器形态是 Chromium 的硬刷新**，网页无法拦截 → 浏览器形态请用备用键 `Ctrl+Alt+F`；桌面形态不受影响（见 README「已知限制」）。
- `BottomTabs`（底部栏组标题）仍随 Workbench 一起重渲染（它是 dock chrome，代价很小）。

---

# 验收记录（PRD-v5 — 代码智能）

> 环境：Windows 11 / Node v22 / `dsh-ide-workbench` 基线 commit `dd6dc175f8cf1b6a891cc37f81ac21a3d81839a4`。
> 规格：`docs/PRD-v5.md`；实施记录与偏差：`docs/PRD-v5-实施进展.md`。

## 自动化测试（493 项全部通过）

```sh
cd dsh-ide-workbench && npm test
# 493 pass / 0 fail   （基线 329 + 本轮新增 164）
```

新增 17 个测试文件、164 个用例：

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `tests/settings-lsp.test.mjs` | 12 | schema 2→3 迁移（旧设置不丢、`lsp` 段补齐）、`requestTimeoutMs` ≥ 30000、四个新快捷键的默认值与不冲突、迁移只动 `lsp` 段 |
| `tests/lsp-registry.test.mjs` | 12 | 语言注册表完整性、`languageIds` 唯一、`memoryLimitMB > 0`、**`typescript` 不得解析到 7.x** |
| `tests/lsp-resources.test.mjs` | 7 | 内存预检：低于阈值 → `canIndex === false`；阈值取 `max(memoryLimitMB, freeMemoryThresholdMB)` |
| `tests/lsp-lifecycle.test.mjs` | 13 | 状态机迁移合法、非法迁移被拒、`lsp.start` 幂等（不重复 spawn） |
| `tests/lsp-cancel-atomic.test.mjs` | 5 | 取消后进程已终止、状态 `cancelled`、已开文档已关闭、重复取消不报错、**编辑器状态未变** |
| `tests/lsp-recovery.test.mjs` | 7 | 崩溃三信号（exit / EOF / 超时）、自动重启**一次**、二次崩溃 → `degraded`、内存不足**不重启** |
| `tests/lsp-idle-exit.test.mjs` | 6 | 空闲超阈值 → 进程退出、`indexedRoots` **不清除**、再次 `lsp.start` 能重启 |
| `tests/lsp-frame.test.mjs` | 11 | `Content-Length` 帧编解码：半包、粘包、UTF-8 多字节、非法头 |
| `tests/lsp-ws.test.mjs` | 8 | `/ide-workbench/ws/lsp` 中继的端到端行为、围栏、非 JSON 载荷被丢弃 |
| `tests/lsp-reconnect.test.mjs` | 7 | 断线重连：transport 报告 `reopened`、排队消息冲刷、**第二次 `initialize` 由缓存回答** |
| `tests/lsp-html-sanitize.test.mjs` | 11 | `sanitizeHTML` 剥离 `<script>` / `<iframe>` / `onerror=` / `javascript:`（含实体与空白变体） |
| `tests/lsp-workspace.test.mjs` | 14 | 自定义 `Workspace`：`syncFiles` 用 **`tab.draft`** 而非磁盘内容、`displayFile` 走 `store.openFile`、**围栏外返回 `null` 且不读文件**、`closeFile` 触发 `didClose` |
| `tests/lsp-mapping.test.mjs` | 4 | 请求期间继续编辑，返回位置经 `withMapping` 后仍指向正确符号（用库真实的 `WorkspaceMapping`） |
| `tests/completion.test.mjs` | 7 | `autocompletion` 已挂载、**`completionKeymap` 在 `defaultKeymap` 之前**（按数组下标断言）、`Esc` 不插入文本、`@codemirror/autocomplete` 在 `devDependencies` |
| `tests/definition.test.mjs` | 10 | Ctrl+点击只在标识符上触发、命中时 `preventDefault()`、跨文件走 `displayFile`、围栏外不打开 |
| `tests/find-usages.test.mjs` | 10 | 语义版不可用时置灰并带说明、文本版**始终可用**且每条结果带「文本匹配」标注、`Alt+F7`/`Alt+F8`/`F12`/`Ctrl+Space` 键位 |
| `tests/idx-decision.test.mjs` | 20 | §2.3 决策矩阵逐行覆盖、根目录 `isRepo` 两版警告、**「取消」不切换项目**、`canIndex === false` 不弹窗、徽标顺序【Git】→【已索引】→【当前】、状态栏七种状态 |

既有测试全部保持全绿：`editor-conflict` / `shortcuts` / `render` / `store-ui` / `store-lifecycle` /
`projects` / `status-basis` / `perf-*` 均未回归。

## 构建产物

| 项 | 数值 | 预算 |
|---|---|---|
| `dist/client.js` | 2,762,422 字节（2,695.8 KiB） | — |
| 相对基线的增量 | **+284 KB** | ≤ 400 KB ✅ |

## 真机端到端验证（`docs/bench/live-lsp.mjs`）

用**真的** `typescript-language-server` 跑通了完整链路：宿主 `apply()` → `ctx.subprocess.spawn` → worker_thread 帧编解码 →
`/ide-workbench/ws/lsp` 中继 → `initialize` → 语义请求 → 断线重连。

```text
lsp.start -> {"state":"building","detail":"building the program"}
websocket open
initialize ok - capabilities: textDocumentSync, completionProvider, definitionProvider, referencesProvider,
  hoverProvider, signatureHelpProvider, documentSymbolProvider, semanticTokensProvider, ...
lsp.status -> ready | language: typescript | source: bundled
lsp.index  -> {"state":"ready","progress":"ready","cancellable":false}
textDocument/definition -> [{"uri":"file:///.../src/client/lsp-uri.js","range":{"start":{"line":1,"character":16},"end":{"line":1,"character":17}}}]
reconnect initialize -> answered, capabilities: 23
```

| 验收点 | 结果 |
|---|---|
| 打包语言服务器能真的启动（`source: 'bundled'`） | ✅ |
| `Content-Length` 帧编解码双向都通 | ✅ |
| `initialize` 握手拿到 23 项能力 | ✅ |
| 状态机 `building → ready`，`cancellable` 正确 | ✅ |
| **跨文件跳转定义**返回真实文件里的真实位置 | ✅ |
| 断线重连的二次握手（宿主用缓存的 capabilities 回答） | ✅ |
| `lsp.servers` 的 bundled / PATH 探测分流 | ✅ `typescript/javascript/python/yaml` = bundled；`java/go/rust/cpp` = missing（未装） |
| `lsp.resources` 的内存预检 | ✅ `canIndex: true`，阈值 `max(2048, 2048)` MB |

## 已知限制（本轮）

- **Windows 上不能用 `.cmd` shim 启动打包的语言服务器**（实测 `spawn EINVAL`：Node 不经 shell 无法执行 batch 文件）。
  落地为 `process.execPath` + 包自己的 JS 入口；`.bat` 启动脚本（如 `jdtls.bat`）在 PATH 探测里会被报成 missing。
- **决策弹窗在切换项目之前**（§2.3 的「取消 → 不切换项目」只能在先问后切的前提下成立）。
- **文件链接桥跳过决策弹窗**（那条路径上工作台可能没挂载，弹窗没人答会挂死）。
- **崩溃态的「点击进日志」改为 tooltip + 重播建议文案**（客户端没有日志视图；stderr 由 `lsp.logs` API 暴露给宿主日志面）。
- **`tests/perf-cold-workspace.test.mjs:123` 在机器满载时偶发失败**（时序敏感用例，单独跑必绿；与本轮改动无关）。
- **界面层面的验收还没走完**：补全弹窗观感、Ctrl+点击的手感、引用面板、索引取消 / 崩溃恢复 / 空闲退出的界面表现，
  逐条清单见 `docs/PRD-v5-实施进展.md` §5.3。



