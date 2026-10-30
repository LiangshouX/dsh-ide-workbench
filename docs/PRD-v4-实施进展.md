# PRD-v4 实施进展（1030 优化需求）

> **对应规格**：`docs/PRD-v4.md` —— 本轮**唯一规格**。实现细节、代码锚点、验收口径、里程碑顺序均以该文档为准，本文件不重复展开。
> **对应输入**：`1030优化需求.md`（工作区根目录，原文保留不改）。
> **状态**：待实施。
> **本文件职责**：只记录**本轮**的进展、实测数据与决定。**不回溯、不续写**已归档轮次
> （上一轮见 `docs/1023优化需求-实施进展.md`，已完成归档）。
> **命名规则**：实施记录的文件名 = **该轮规格文件名 + `-实施进展`**；该轮没有规格时，用需求输入文件名 + `-实施进展`。
> 即：有规格 → `PRD-vN-实施进展.md`（如 `PRD-v3-实施进展.md`、`PRD-v4-实施进展.md`）；
> 无规格 → `<需求输入名>-实施进展.md`（如 `1023优化需求-实施进展.md`）。
> **不使用 V 编号** —— V 编号与 PRD 版本号并不同步，是此前编号混乱的根源。

---

## 1. 范围

> 详细规格见 `docs/PRD-v4.md` §0.1 范围表。此处只维护**状态**。

| ID | 条目 | 状态 |
|---|---|---|
| PERF-01~09 | 切会话卡顿（插件侧 9 项改造） | ✅ 已完成 |
| UP-01~06 | 切会话卡顿（插件外，上游待办） | 🟨 UP-04/UP-05 已核实并结案；UP-01~03 仍待反馈给上游 |
| TREE-01 | 目录箭头单击展开/折叠 | ✅ 已完成 |
| TREE-02 | 新增【文件定位】按钮 | ✅ 已完成 |
| TREE-03 | 彻底移除【收藏夹】 | ✅ 已完成 |
| TREE-04 | 隐藏【全项目查找】+ 快捷键改 `Ctrl+Shift+R` | ✅ 已完成 |
| COMMIT-01 | 勾选未版本控制文件不自动 Add | ✅ 已完成 |
| GIT-01 | Git 历史页仓库自治（脱离 Project） | ✅ 已完成 |
| GIT-02 | 去掉变更文件预览（冗余） | ✅ 已完成 |
| GIT-03 | 变更文件改文件树 | ✅ 已完成 |
| LAYOUT-01 | Terminal/Git 通栏 | ✅ 已完成 |
| EDITOR-01 | 外部修改冲突提示改为文档区居中弹窗 | ✅ 已完成 |
| EDITOR-02 | 面包屑窄屏不折行 | ✅ 已完成 |
| FILE-01 | 聊天 File link 的相对路径解析 | ✅ 已完成 |

图例：⬜ 未开始 / 🟨 进行中 / ✅ 已完成 / ⛔ 阻塞（附原因）

---

## 2. 里程碑进度

> 里程碑定义与依赖关系见 `docs/PRD-v4.md` §9。

| 里程碑 | 条目 | 状态 | 完成日期 | 备注 |
|---|---|---|---|---|
| M0 | 开工前置：UP-04（`Ctrl+Shift+R` 占用核查）、UP-05（槽位渲染粒度）、性能基线 | ✅ | 2026-10-30 | 见 §2.1；UP-04/UP-05 均已核实，不阻塞后续条目 |
| M1 | 性能止血：PERF-01/03/05/06/08/09 | ✅ | 2026-10-30 | 实测值见 §3.1 |
| M2 | 交互清理：TREE-01、TREE-03、EDITOR-02 | ✅ | 2026-10-30 | |
| M3 | Commit 语义修正：COMMIT-01 + buckets 修复 | ✅ | 2026-10-30 | 真实 git 用例见 `tests/commit-staging.test.mjs` / `tests/git-panel.test.mjs` |
| M4 | Git 面板内部改造：GIT-02、GIT-03 | ✅ | 2026-10-30 | |
| M5 | Git 仓库自治：GIT-01 | ✅ | 2026-10-30 | 路径口径回归见 `tests/git-repo-scope.test.mjs` / `tests/git-panel.test.mjs` |
| M6 | 文件链接相对路径 + 工具条与快捷键：FILE-01、TREE-02、TREE-04 | ✅ | 2026-10-30 | FILE-01 先于 TREE-02 |
| M7 | 布局与冲突弹窗：LAYOUT-01、EDITOR-01 | ✅ | 2026-10-30 | |
| M8 | 性能结构化：PERF-02、PERF-04、PERF-07 | ✅ | 2026-10-30 | 6 个面板 + 2 个视图迁移到 slice 订阅 |

### 2.1 M0 核实结论（2026-10-30）

**UP-04 —— DSH 宿主是否占用 `Ctrl+Shift+R`？结论：未占用 → TREE-04 按 `Ctrl+Shift+R` 实施。**

核查方式：从 `resources/app.asar` 解包出宿主自身的运行时文件（`dsh/desktop-runtime.json`、
`lib/main.js`、`@deepseek-ai/dsh-client-ui-shortcuts/lib/client.js`、
`@deepseek-ai/dsh-client-ui-conversation/lib/client.js`），逐项检索：

| 位置 | 事实 |
|---|---|
| Electron 应用菜单（`lib/main.js:12842-12859`、`:12788-12795`） | 加速键只有 `Ctrl+Z`、`Ctrl+Y`、`Ctrl+X`、`Ctrl+C`、`Ctrl+V`、`Delete`、`Ctrl+A`、`F12` —— **无 `Ctrl+Shift+R`** |
| 宿主快捷键目录（`dsh-client-ui-shortcuts`） | 全文没有 `Ctrl+Shift+` 的**默认绑定**，唯一出现处是帮助文案「可设置 … `Ctrl+Shift+按键`」（描述"可用的组合"，不是绑定） |
| Chromium DevTools 前端 | 整个安装里唯一的 `Shift+Ctrl+R` 是 DevTools 的 hard-reload，仅在 DevTools 窗口获得焦点时生效（DSH 以分离窗口打开 DevTools，主窗口的 DevTools 菜单项 `visible:false`） |

残留风险（已记录）：宿主自身的帮助文案明确提示「浏览器或系统占用的组合可能无法送达页面」。
因此 `findInFilesAlt = Ctrl+Alt+F` **保留为备用别名**（`host/settings-store.js:108-109`）。

**UP-05 —— 宿主是否按会话行渲染 `conversation.session.header.utilities`？结论：不是 → 不需要 PERF-10。**

- 槽位契约：`conversation.session.header.utilities` 是 `kind: "list"`、`scope: "session"`；
  宿主文档写明它「在其宿主条目挂载期间存在」，宿主条目是 `conversation.session.header`（`kind:"single"`、`scope:"session"`）。
- 渲染点唯一：`dsh-client-ui-conversation/lib/client.js:18197-18198` 的 `renderSlot("conversation.session.header.utilities", {})`
  位于 `ConversationRoot`（**对话区骨架**）的页眉里，**每个挂载的会话页眉一个实例**。
- `dsh-client-ui-sidebar-right/lib/client.js` **不含任何 `ConversationRoot` 引用** → 侧边栏的会话**行**不渲染该槽位。
- 结论：插件注册的入口（`src/client/index.jsx:359-364`）在任意时刻只有 **1 个实例**（当前活动会话），
  不存在「S 个会话 → S 个入口实例」的放大问题，**追加 PERF-10 无必要**。

**性能基线**：`window.__iwbPerf` 开发态计数器已随 PERF 改造一并落地（见 §3.1 实测列）。


---

## 3. 实测数据

> 指标定义见 `docs/PRD-v4.md` §1.3。**每个里程碑结束后回填实测值**，不要只写"通过"。

### 3.1 性能指标

| 指标 | 基线（现状） | 目标 | 实测 | 结论 |
|---|---|---|---|---|
| 切到**热**工作区时的 git 子进程数 | 3 | 0 | **0**（`activate()` 命中缓存，置 `statusStale=true`，由 2s 轮询后台刷新） | ✅ |
| 单次轮询的 git 子进程数 | 3 | 1 | **1**（`host/git.js:status()` 内部只有 `git status`）；Commit 窗口可见时为 3 | ✅ 见注 1 |
| 冷工作区首次进入的 `fs.read` 次数 | ≤24 | 0（未聚焦标签） | **未聚焦标签 0**；聚焦的那一个标签 **1** | ✅ 见注 2 |
| 冷工作区首次进入的目录列表请求数 | ≤201 | 1 | **1**（只列根目录；恢复出的展开目录改为后台逐个加载） | ✅ 见注 3 |
| 切会话时 ProjectPanel 树行重建次数 | 全树 | 与切会话无关 | ProjectPanel 已迁移到 slice 订阅：`toast`/`terminal`/`git`/`layout`/`commit` 等无关字段变化**不再**触发重渲染；树行本身由 `React.memo(TreeRow)` 承载 | ✅ |
| 常驻 store 数（开 10 个工作区后） | 10 | ≤3 | **3**（`StoreCache` LRU；仍挂载会话的 store 不淘汰） | ✅ |
| 歧义 File link 的打开增量耗时 | — | < 50 ms | 最多 **3 次 `fs.stat`**（去重后通常 1–2 次），单次 stat 在本地 NTFS 约 0.1–1 ms；仅在用户点击时发生 | ✅ |

> **注 1 —— 口径说明**：PRD §1.2 PERF-06 的基线「3 个子进程」= 1 次 `git status` + 2 次 `git diff --numstat`，
> **不含**宿主路由 `src/index.js:72-81` 的 `repoEnv()` 里那次 `git rev-parse --show-toplevel`。
> 因此本轮实测的 `status()` 内部子进程数为 **1**，而一次轮询在操作系统层面实际会看到 **2** 个 git 进程
> （`rev-parse` + `status`）。要再降到 1，需要在宿主侧缓存仓库 toplevel——
> 本轮**不做**（toplevel 过期会把 git 调用路由到错误的仓库，风险高于收益），记为后续观察项。
>
> **注 2 —— 聚焦标签的那 1 次读盘**：PRD PERF-07 要求「已打开文件改为懒加载：首次聚焦某个标签时才读盘」。
> 冷工作区进入时**未聚焦**的标签读盘次数为 **0**；编辑器正在显示的那一个标签读盘 **1** 次。
> 若把这 1 次也推迟到后台，编辑器会在用户眼前显示空白/占位——PRD §1.2 PERF-07 的风险条目明确要求
> 「占位态需明确，不得显示为『加载中』假象」，因此保留这一次同步读盘。
>
> **注 3 —— 恢复树的后台加载**：`loadRestoredTree({ lazy: true })` 进入时**只列根目录**（1 次请求），
> 恢复出的展开目录改为**后台逐个**加载（首个延迟约 200 ms），不再在进入时阻塞式地批量请求
> （基线是 ≤201 次串行 `loadDir`）。`loadRestoredTree()` 不带参数时保持旧契约（根 + 全部展开目录），
> 以免影响既有调用方与 `tests/regressions.test.mjs`。

**补充实测**（PRD §1.3 之外，用于确认改造确实生效）：

| 场景 | 基线 | 实测 |
|---|---|---|
| 连续 50 次等值 `set()` 触发的通知数 | 50 | **0**（PERF-01 的脏检查） |
| 500 条目目录列举的 `lstat` 次数 | 500 | **0**（1 次 `readdir(withFileTypes)`，耗时 5 ms） |
| 单目录列举耗时 | 500 次串行 `lstat` | 1 次 `readdir` + 0 次 `lstat` |

### 3.2 自动化与构建

| 项 | 基线 | 本轮 | 备注 |
|---|---|---|---|
| `npm test` 通过数 | 159 | **289**（289 通过 + 0 失败 + 0 跳过），连续 4 次全绿 | 新增：`perf-notify`、`tree-twisty`、`git-panel`、`editor-conflict`、`shortcuts`、`commit-staging`、`git-repo-scope`、`file-link-store`、`perf-cold-workspace`、`perf-slice-project`、`perf-slice-editor`、`perf-slice-git` |
| `npm run build` | 通过 | 通过（`dist/client.js`，2414.8 KiB） | 已更新 |
| 新增测试文件数 | — | **12** | 见 `docs/PRD-v4.md` §10.1（规格要求 6 个，实际新增 12 个，覆盖面更广） |

---

## 4. 验收清单

> 完整清单见 `docs/PRD-v4.md` §10.4；勾选状态在这里维护。
>
> **图例**：✅ = 已有自动化用例断言 + 代码走查通过；⬜ = 需实机视觉走查（本轮未在 DSH 里实机操作）。
> 本轮所有**逻辑**类验收点都有对应的自动化用例（见 §3.2 的新增测试文件列表）。

### 4.1 性能
- [ ] 开 10 个不同工作区后内存不持续增长；回到早期工作区，文件树/展开态/标签完整恢复（自动化：✅ `tests/perf-notify.test.mjs`；实机内存曲线：⬜）
- [ ] 切到已访问过的工作区：无卡顿，且无 git 子进程（自动化：✅ 0 次 git 调用）
- [ ] 冷工作区首次进入：仅根目录被列出，未聚焦标签不读盘（自动化：✅ `tests/perf-cold-workspace.test.mjs`）

### 4.2 Project
- [ ] 单击箭头展开/折叠；双击目录名仍有效；单击箭头不会同时选中该行（自动化：✅ `tests/tree-twisty.test.mjs`）
- [ ] 【文件定位】：打开文件 → 点按钮 → 树自动展开并滚动到该文件（自动化：✅ 按钮行为；滚动时机：⬜ 实机）
- [ ] 收藏夹：无按钮、无右键项、`Alt+Shift+F` 无效、重启不报错（自动化：✅ 源码守卫 + 旧配置静默加载）
- [ ] `Ctrl+Shift+R` 打开全局查找；`Ctrl+Shift+F` 无效；`Ctrl+F` 仍是文件内查找；UI 无查找按钮（自动化：✅ `tests/shortcuts.test.mjs`）

### 4.3 Commit
- [ ] 勾选未版本控制文件：仍留在未版本控制组、字母仍为 `U`、颜色不变、`git diff --cached` 无该文件（自动化：✅ 真实 git 用例）
- [ ] 点提交：该文件被 Add 并与改动一起提交成功（自动化：✅ 真实 git 用例）
- [ ] Add 失败：提交被中断，无半截暂存残留（自动化：✅ `git add` 失败 → 提交被中断 + `git.unstage` 回滚）
- [ ] 切项目后：旧仓库的勾选状态不残留（自动化：✅ `#switchProject` / `#switchWorkspace` 均重置）

### 4.4 Git
- [ ] Project 根不是仓库时，Git 面板仍能选仓库并看历史；文件树不变（自动化：✅ `tests/git-repo-scope.test.mjs`）
- [ ] 在 Header 切仓库：仅 Git 内容变化，标签页与文件树保持（自动化：✅ `tests/git-panel.test.mjs`）
- [ ] Commit 详情 Drawer：无预览区；变更文件成树、可折叠；双击叶子仍在内容区渲染差异（自动化：✅ `tests/git-panel.test.mjs`；Drawer 观感：⬜ 实机）

### 4.5 布局
- [ ] 打开 Terminal/Git → 底部栏通栏；Project/Commit 侧栏在其上方；终端可正常输入与滚动（自动化：✅ DOM 结构断言；终端交互：⬜ 实机）
- [ ] 窄屏（≤560）上下排布：底部栏表现正常，终端面板定位无异常（⬜ 实机）

### 4.6 内容区
- [ ] 外部修改 → 弹窗居中于文档区；窄屏文案不换行；两个操作均可用（自动化：✅ `tests/editor-conflict.test.mjs`；居中观感：⬜ 实机）
- [ ] 320px 宽：面包屑单行不折行，文件名可见，hover 显示完整路径（自动化：✅ 折叠标记 + CSS 契约；实际宽度：⬜ 实机）

### 4.7 聊天文件链接（FILE-01）
- [ ] 相对路径 File link（`/docs/…` 形态）在工作台内直接打开，不再"打不开"（自动化：✅ `tests/file-link-store.test.mjs`）
- [ ] 无前导斜杠的相对形态同样能打开（自动化：✅）
- [ ] 绝对路径形态无回归（自动化：✅）
- [ ] 工作区外的相对路径仍不认领、不打开（自动化：✅ 0 次 stat 探测）

---

## 5. 上游待办

> 插件外的改动，本仓库无源码，需转交对应仓库。定义见 `docs/PRD-v4.md` §1.4。

| ID | 事项 | 归属 | 状态 | 反馈时间 |
|---|---|---|---|---|
| UP-01 | 切会话时重建整个会话列表快照（O(会话数) 的 map 拷贝） | DSH 核心前端 | ⬜ | |
| UP-02 | 快照变更通知所有订阅者，订阅粒度过粗 | DSH 核心前端 | ⬜ | |
| UP-03 | 工作区侧边栏 O(工作区×会话) 重算分组/排序 | `dsh-better-sidebar` | ⬜ | |
| UP-04 | 宿主是否已占用 `Ctrl+Shift+R` | DSH 宿主 | ✅ **未占用**（2026-10-30，见 §2.1） | 2026-10-30 |
| UP-05 | 宿主是否按会话行渲染 `conversation.session.header.utilities` | DSH 宿主 | ✅ **不是**（2026-10-30，见 §2.1）→ 无需 PERF-10 | 2026-10-30 |
| UP-06 | 宿主快捷键目录目前**没有**任何 `Ctrl+Shift+*` 默认绑定，但 DSH 快捷键系统允许用户自定义 `Ctrl+Shift+…`；若未来宿主新增该组合的默认绑定，需与本插件的 `Ctrl+Shift+R` 协调 | DSH 宿主 | ⬜（观察项） | |

---

## 6. 补充决定与偏差

> 实施中出现的、**与 `docs/PRD-v4.md` 规格不一致**的决定，一律**先写这里、再改代码**。
> 每条写明：日期 / 事项 / 决定 / 理由 / 影响到的条目。

| 日期 | 事项 | 决定 | 理由 | 影响 |
|---|---|---|---|---|
| 2026-10-30 | UP-04 核实 | `Ctrl+Shift+R` 未被宿主占用 → 按规格实施，**不**切换到 `Ctrl+Alt+R` | 见 §2.1 的逐项证据 | TREE-04 |
| 2026-10-30 | UP-05 核实 | 槽位按"活动会话页眉"渲染，**不**追加 PERF-10 | 见 §2.1 | — |
| 2026-10-30 | TREE-01 的箭头样式 | 新增修饰类 `iwb-tree-twisty-click`；`.iwb-tree-twisty` 基类**不加** `cursor:pointer` | `.iwb-tree-twisty` 同时被"目录箭头"与"文件行空占位"复用，加在基类会让文件行也显示手型 | TREE-01 |
| 2026-10-30 | EDITOR-02 的折叠触发条件 | 用 **`.iwb-editor-toolbar` 自身的容器查询**（`@container iwb-editor-toolbar (max-width: 520px)`），不用根容器查询 | 需求要的是"文档区窄"，而根容器宽度还包含左栏；用文档区容器才能在"窗口宽但编辑区窄"时同样折叠 | EDITOR-02 |
| 2026-10-30 | LAYOUT-01 的 44px 留白落点 | 留白落在**底部栏的组头与内容区**（`.iwb-bottom-tabs` / `.iwb-bottom-body` 的 `padding-left`），`.iwb-stripe` 仍在 `.iwb-body` 内原位、不改为绝对定位 | 规格只要求"底部栏内容区左侧保留 44px 空白，stripe 保持通高可点（与当前视觉一致）"；改 stripe 的定位会连带移动 stripe 按钮位置，超出本条范围 | LAYOUT-01 |
| 2026-10-30 | LAYOUT-01 窄屏百分比基准 | 堆叠断点下 `.iwb-bottom { max-height: 60% }`（原 65%） | 基准从 `.iwb-center` 变为根高度，65% 会让底部栏在窄屏吃掉过多空间 | LAYOUT-01 |
| 2026-10-30 | TREE-04 的旧配置迁移 | 宿主加载配置时**定向**改写 `shortcuts.findInFiles === 'Ctrl+Shift+F'` → `'Ctrl+Shift+R'`（`migrateLegacyShortcuts`） | PRD §2.3 的「不做破坏性迁移」只针对**收藏夹**；而 §2.4 的验收明确要求「`Ctrl+Shift+F` 不再触发全局查找」。若保留旧值，已升级用户的 `Ctrl+Shift+F` 仍会打开全局查找，与验收冲突。只改写这一个精确组合，用户自选的快捷键不受影响 | TREE-04 |
| 2026-10-30 | TREE-03 的旧配置处理 | `settings.json` 里的 `favorites` 数组与 `shortcuts.favorite` **保留读取**（宿主的 `deepMerge` 会保留未知键）、不再展示、不再生效 | 规格要求「不做破坏性迁移，不删用户文件」；插件侧已无任何读写收藏夹的代码 | TREE-03 |
| 2026-10-30 | PERF-02 的订阅机制 | 新增 `hooks.js` 的 `useStoreSlice(store, selector, isEqual)`；`useWorkbench` 保留给根组件与设置页 | PRD §1.2 PERF-02 的「按 slice 订阅」；`useSyncExternalStore` + 缓存快照可以保证渲染期不撕裂，且切片不变时返回**同一个**引用 | PERF-02 |
| 2026-10-30 | PERF-02 的语言切换 | `useStoreSlice` 把 store 的 `localeTick` 计入切片身份（集中实现，非每个面板各加一个字段） | 面板改成 `React.memo` 且不再接收变化中的 prop 后，语言切换没有任何东西唤醒它们 → 标签会停留在旧语言。集中修一处比在 6 个面板里各加一个字段更不易漏 | PERF-02 |
| 2026-10-30 | **GIT-01 已知限制**：另一个仓库的文件无法在编辑器里打开 | 「跳到源文件」在文件不属于当前 IDE 项目时**不打开**，改为提示（`commit.outsideProject`） | 编辑器的读写围栏是**项目根**（`fs.read`/`fs.write` 用 `root: state.root`，宿主 `resolveInside` 对越界路径直接 403）。要打开另一个仓库的文件，就得把围栏放宽到工作区根——那会改变**文件树**的围栏，而 GIT-01 明确要求「不触碰 `state.root`（文件树）」。因此选择「不打开错文件」而不是「打开错文件」 | GIT-01 |
| 2026-10-30 | GIT-01 的 `git.ignore` | 唯一一个**不**跟随 `gitRepoRoot` 的 `git.*` 调用 | 它的路径是**工作区相对**的（文件树上的「加入 .gitignore」动作），必须留在工作区/项目根上 | GIT-01 |
| 2026-10-30 | PERF-07 的恢复树 | 冷进入只列根目录，恢复出的展开目录改为**后台逐个**加载（首个延迟约 200 ms） | 规格写的是「展开目录在用户展开时按需加载」；但恢复出的目录本来就在 `expanded` 里，完全不加载会让它们空着。后台逐个加载既满足「首次进入只有 1 次目录列表请求」，又不留下空的展开目录 | PERF-07 |
| 2026-10-30 | `src/client/store.js` 的**编码事故**与修复 | 该文件被工具链以 **GBK（代码页 936）误读 UTF-8**，且**连续两次**，导致全部非 ASCII 字符（`─` `→` `…` `·` 及新增的 `§`）变成乱码（`閳光偓` / `鎼?` / `搂` …）。已用 .NET 的 `Encoding.GetEncoding(936)` 逆向还原，并对 GBK 解码器**不可逆**的 29 处（`→` `…` `·` `§` 后面被吞掉的空格）按上下文逐条还原 | 乱码只落在注释与一处模板字符串里（`${this.t(labelKey)} · exit …`），功能不受影响，但**不可交付**。已确认**其余所有改动文件都没有这个问题**（脚本逐文件扫描 U+95B3/U+5149/U+5053/U+93BC/U+6402/U+30EE/U+6CE6/U+74BA/U+FFFD 等乱码码位），修复后 `npm test` 289 项全绿、`dist/client.js` 重新构建 | 全部 |

---

## 7. 提交记录

| 日期 | 提交 | 内容 |
|---|---|---|
| 2026-10-30 | `e6f491d` | docs：V3 三份文档按 `PRD-vN` 命名规范改名（并修正引用）；新增 `docs/PRD-v4.md` 规格 |
| 2026-10-30 | `f7fe228` | feat：PRD-v4 全部条目（PERF-01~09、TREE-01~04、COMMIT-01、GIT-01~03、LAYOUT-01、EDITOR-01/02、FILE-01）+ `dist/client.js` + 本文件与 `docs/VERIFICATION.md`；测试 159 → **289** |

---

## 8. 记录约定

1. **每个里程碑完成后**：跑 `npm test` + `npm run build`，然后在 §2 更新状态与日期、在 §3 填实测值、在 §7 补提交记录。
2. **规格与实现不一致时**：先在 §6 写下决定与理由，再改代码；不要让代码领先于记录。
3. **本文件只服务本轮**：下一轮另起文件，命名规则为 `PRD-vN-实施进展.md`（该轮有规格）或 `<需求输入名>-实施进展.md`（无规格）。
4. **不回溯归档轮次**：已完成的轮次（`1023优化需求-实施进展.md` 等）不再追加内容；发现旧轮次的问题，记在 §6 并注明归属轮次。
5. **验收以实测为准**：§3 的实测值没有填数字的，视为该指标未验收。
