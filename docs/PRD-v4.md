# PRD v4 — 会话切换性能、Project 工具条精简与 Git 历史仓库自治

> **状态**：待实施。规格已拍板，**无需再向用户确认任何条目**。
> **输入**：`1030优化需求.md`（原始需求，原文保留未改）。
> **配套**：`docs/VERIFICATION.md`（累计验收记录）、`docs/1023优化需求-实施进展.md`（上一轮，已归档）、`docs/PRD-v4-实施进展.md`（本轮进展记录）、`docs/M0-api-findings.md`（DSH API 契约）。
> **对应记录**：`docs/PRD-v4-实施进展.md`。
> **代码基线**：`dsh-ide-workbench` v0.4.0，HEAD `79140b0`，分支 `main`。
> **本文档定位**：这是**实施规格**，不是问题清单。每一项都含：结论 → 代码锚点（`file:line`）→ 改法 → 验收口径 → 风险。
> 开发时请**按 §9 里程碑顺序**推进，每完成一个里程碑即跑一次 `npm test` + `npm run build`。

---

## 0. 一页速览

### 0.1 本轮范围

| ID | 条目 | 模块 | 优先级 | 核心锚点 | 一句话验收 |
|---|---|---|---|---|---|
| PERF-01~09 | 切会话卡顿（插件侧） | store / ProjectPanel / host | **P0** | `store.js:214`、`ProjectPanel.jsx:209`、`host/git.js:236` | 切热工作区不再触发 git 子进程与全树重渲染 |
| UP-01~06 | 切会话卡顿（插件外，上游） | DSH 核心 / better-sidebar | **P0 待上游** | 见 §1.4 | 附证据与核查清单，本仓库不实施 |
| TREE-01 | 目录箭头单击展开/折叠 | ProjectPanel | P1 | `ProjectPanel.jsx:591` | 单击箭头 = 双击效果，双击保留 |
| TREE-02 | 【文件定位】按钮 | ProjectPanel | P1 | `ProjectPanel.jsx:655-687` | 定位到当前活跃文件并滚动可见 |
| TREE-03 | 彻底移除【收藏夹】 | ProjectPanel / store / settings | P1 | `ProjectPanel.jsx:667` | 无入口、无右键项、无快捷键、无残留状态 |
| TREE-04 | 隐藏【全项目查找】+ 快捷键改 `Ctrl+Shift+R` | 全局 | P1 | `EditorArea.jsx:447`（**硬编码，必改**） | 全局查找仅快捷键可达，`Ctrl+Shift+F` 不再触发 |
| COMMIT-01 | 勾选未版本控制文件不自动 Add | store / CommitPanel | P0 | `store.js:2026`、`store.js:2247` | 勾选不写 index，提交时才 Add |
| GIT-01 | Git 历史页仓库自治（脱离 Project） | store / GitPanel / BottomTabs | P1 | `store.js:653`、`Workbench.jsx:128` | 切仓库不动文件树/Tab |
| GIT-02 | 去掉变更文件预览（冗余） | GitPanel | P2 | `GitPanel.jsx:269-274` | Drawer 不再渲染 InlinePatch |
| GIT-03 | 变更文件改文件树 | GitPanel | P2 | `GitPanel.jsx:253-268` | 按目录成树，目录可折叠 |
| LAYOUT-01 | Terminal/Git 通栏，Project/Commit 收其上方 | Workbench / styles | P1 | `Workbench.jsx:437-440` | 底部栏横跨整个工作台宽度 |
| EDITOR-01 | 外部修改冲突提示改为文档区居中弹窗 | EditorArea / ui / styles | P1 | `EditorArea.jsx:316-328` | 弹窗居中于文档窗口，窄屏不换行 |
| EDITOR-02 | 面包屑窄屏不折行 | styles / EditorArea | P2 | `styles.js:207` | 单行显示，中间段省略 |
| FILE-01 | 聊天 File link 的相对路径解析 | file-address / store | **P0** | `file-address.js:70-72`、`:116-124`、`store.js:364-400` | 工作区内的相对路径 File link 在工作台直接打开，不再"打不开" |

### 0.2 三处事实纠正（务必先读，否则会做错）

原始需求里有三处描述与代码实际不符。**按原始描述实现会做错方向**，特此纠正：

1. **目录箭头已经存在，不需要新建。**
   `ProjectPanel.jsx:591` 已经渲染 `ChevronDown`/`ChevronRight`（图标定义在 `ui.jsx:225-233`，**不在** `icons.jsx`；`icons.jsx:82-85` 的 `IconChevron` 未被使用）。
   现状是：箭头只显示、**没有 onClick、没有 `cursor:pointer`**（样式 `styles.js:333`）。
   → TREE-01 只需**加点击处理**，不是新增图标。工作量远小于原描述。

2. **勾选未版本控制文件，并没有真的"跨组移动"。**
   分组由 `splitCommitGroups(entries, buckets)`（`commit-model.js:23-34`）判定，`buckets` 已把勾选过的路径钉在 untracked 组（`store.js:2025` 写入，`commit-model.js:29` 读取）。
   真实症状是：**自动执行了 `git add`**（`store.js:2026` → `:2034` → `host/git.js:293-296`），add 后 host status 返回 `untracked:false, xy:'A.'`（`host/git.js:250-263`），于是状态字母 `U`→`A`、`iwb-file-untracked` 类被摘掉（`CommitPanel.jsx:31/33`）、配色由红转绿（`git-colors.js:28-47`）——**观感上"移进了改动区"，但分组没动**。
   → COMMIT-01 的本质是**把 `git add` 推迟到提交时**，不是修分组逻辑。分组逻辑本来就是对的。

3. **O(工作区数 × 会话数) 的分组/排序不在本插件内。**
   全仓库唯一的会话列表访问是 `workspace-scope.js:59-62` 的 `list?.byId?.[sessionId]` —— **单键查找，O(1)**。插件内不存在任何遍历会话列表、按 cwd 分组或排序会话的代码。
   → 该症状属于 **DSH 前端会话表** 与 **`dsh-better-sidebar`**，见 §1.4 上游待办。插件侧有另一组真实的性能成本（§1.2），不能混为一谈。

> 附带一条事实澄清：`1030优化需求.md` 所说"重新从磁盘加载的弹窗在顶部"，在本插件中**不是弹窗**，而是编辑器工具条内的一个 inline chip（`EditorArea.jsx:316-328`，`.iwb-conflict-chip`）。宽度变窄时它换行，因此被感知为"看不清"。EDITOR-01 把它改成真正的居中弹窗。

### 0.3 非目标（本轮明确不做）

- 不做会话列表/工作区分组排序的改造（不在本仓库，见 §1.4）。
- 不做 Project 根目录选择器的能力扩展（保持"工作区根 + 一级子目录"扫描口径，用户已确认）。
- 不做 Git 仓库候选的**递归扫描**（用户已确认维持一级）。
- 不做浮动工具窗 / Split / Local History。
- 不做递归的 Git 仓库发现；更深层仓库需先打开其上级目录（沿用 V1.2 已知限制）。
- 不改 DSH 宿主源码（无可用源码，改动需走上游流程）。
- 不重构 Diff 渲染器。

---

## 1. PERF — 切换会话卡顿（致命）

### 1.1 责任边界

| 层 | 是否本轮实施 | 说明 |
|---|---|---|
| 插件侧（`dsh-ide-workbench`） | ✅ 实施 | §1.2，共 9 项，锚点全部在本仓库 |
| DSH 核心前端（会话表） | ❌ 上游 | 本仓库无源码，见 §1.4 |
| `dsh-better-sidebar`（工作区分组排序） | ❌ 上游 | 本仓库无源码，见 §1.4 |

**结论口径**：插件侧改造能显著降低"插件自身在切会话时的开销"，但**不能单独根治**用户描述的卡顿（会话表全量重渲染在宿主侧）。实施完成后必须按 §1.4 把上游项一并反馈，否则用户体感改善有限。

### 1.2 插件侧改造项

#### PERF-01 — store 通知跳过无效变更

**现状**：`store.js:214-217`

```js
set(patch) {
  this.state = { ...this.state, ...patch }
  for (const listener of this.listeners) listener()
}
```

每次 `set` 都**无条件替换 state 对象并同步遍历所有 listener**，无脏检查、无批处理。一次 `set` = 一次全工作台重渲染（`hooks.js:4-5` 的 `useWorkbench` 订阅整个快照）。

**改法**：在 `set` 中比较 patch 每个 key 与 `this.state[key]`，**全部 `===` 相等时直接 return**，不替换 state、不通知。

**验收**：连续两次 `set({ x: 相同值 })` 只产生 1 次通知；新增单测断言通知计数。

**风险**：低。注意 `Set`/`Map` 等引用类型按引用比较即可（内容变化时业务代码本就应产生新引用）。

---

#### PERF-02 — 按 slice 订阅，避免全树重渲染

**现状**：`hooks.js:1-6`

```js
export function useWorkbench(store) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
```

订阅的是**整个 state**。消费者只有 `Workbench.jsx:335`（根）与 `index.jsx:176`（设置页），但根把 `state` 作为 prop 传给全部面板 → 任一字段变化 = 整棵工作台重渲染。

**全仓库无 `React.memo` / `shouldComponentUpdate` / `useDeferredValue` / `startTransition`**（grep 零命中）。

**改法**：

1. `hooks.js` 新增：

   ```js
   export function useStoreSlice(store, selector, isEqual = Object.is) { ... }
   ```

   内部用 `useSyncExternalStore`，subscribe 回调里用 `selector` 取快照并做 `isEqual` 比较，只有选中切片真的变了才触发重渲染。
2. 迁移顺序（**按收益排序，逐个提交**）：`ProjectPanel` → `EditorArea` → `GitPanel` → `CommitPanel` → `TerminalPanel`。
   迁移后这些面板不再依赖 `state` prop 传值，`Workbench` 的重渲染成本降到"只影响未迁移的面板"。
3. 保留 `useWorkbench` 供设置页与确需全量的场景使用。

**验收**：切会话时 ProjectPanel 不因 `state` 中无关字段（如 toast、terminal 输出）变化而重渲染；单测断言 slice 订阅的渲染次数。

**风险**：**中高**。迁移时容易漏读某个 `state` 字段导致渲染不同步。缓解：每迁移一个面板，跑一次该面板的既有交互回归（文件树展开、右键菜单、Git 抽屉、终端输入）。

---

#### PERF-03 — 文件树 flatten 记忆化依赖修正

**现状**：`ProjectPanel.jsx:209`

```js
useMemo(() => flatten(state, ...), [state, ...])
```

依赖是**整个 state 对象**，而 `set()` 每次都换新对象（`store.js:215`）→ **memo 永不命中**，每次通知都重算全树 flatten。`ProjectPanel.jsx:252` 的 `selectedEntries` 连 memo 都没有。

**改法**：

- `flatten` 的依赖改为实际输入。`flatten(state, filter, showIgnored, ignored, mode)` 实际只读 6 项：
  `state.dirs`、`state.expanded`、`state.root`、`state.filter`、`showIgnored`、`status.ignored`、`filterMode`
  → 依赖数组改为 `[state.dirs, state.expanded, state.root, state.filter, showIgnored, status.ignored, filterMode]`。
  > ✅ **已核实可安全替换**：`dirs` 与 `expanded` 每次写入都是**不可变替换**（`store.js:939/946/948/951/953` 换新 Map，`:986`/`:1005` 换新 Set），不存在原地 mutate → 依赖数组能正确触发重算。
- `selectedEntries`（`ProjectPanel.jsx:252`，当前 `rows.filter(...)` 无 memo）用 `useMemo([rows, selection])` 包裹。

**验收**：切会话/切终端时，文件树 flatten 不再重复执行；单测断言 memo 命中。

**风险**：低。**必须确认 `flatten` 真正读取的字段都在依赖里**，漏一个会导致树不更新——改完必须验证展开/折叠/筛选/状态色四种变化都能正确刷新。

---

#### PERF-04 — 行组件提取并 memo 化

**现状**：文件树行是 `ProjectPanel.jsx:544-635` 里**内联**的 `React.createElement('div', ...)`，**没有独立 Row 组件，也没有 memo**。每次重渲染都重建全部行元素。文件树已做窗口化（`ROW_HEIGHT=22`，`ProjectPanel.jsx:21`；窗口 `start/end` 计算在 `:247-249`），但**窗口内的行仍全量重建**。

**改法**：把目录行（`:576-594`）与文件行（`:598-...`）提取为 `TreeRow` 组件并用 `React.memo` 包裹，props 只传行数据与回调（回调需 `useCallback` 稳定化，否则 memo 同样失效）。

**验收**：单条文件状态变化时，只有该行 DOM 被更新（可用 `React.Profiler` 或 DOM diff 断言）。

**风险**：中。回调不稳定会静默击穿 memo。**注意 `onRowClick` 等回调目前在 render 内定义，需一并 `useCallback` 化**。

---

#### PERF-05 — store 缓存淘汰，内存不随工作区数线性增长

**现状**：`index.jsx:225-232` 按工作区 key 懒创建 store，**只在插件卸载时 `stores.clear()`（`index.jsx:515-521`）**。切会话**不销毁**旧 store，`deactivate()`（`store.js:793-802`）仅置 `active:false`、停轮询、落盘，`dirs`/`expanded`/`fileIndex`/`tabs`/`status.entries` **全部常驻内存**。

→ 内存占用 = O(工作区数 × 每个工作区的完整文件树缓存)。

**改法**：对 `stores` Map 实施 LRU 淘汰：

- 保留最近 **3** 个工作区的 store（可配），淘汰时先 `deactivate()` 再 `delete`。
- 被淘汰 store 的**持久化数据不丢失**（`workspaceState` 已在 `store.js:738-774` 落盘），重新进入时从 `workspaceState` 恢复。
- 淘汰时机：创建新 store 时检查；以及插件 `deactivate` 时。

**验收**：连续打开 10 个不同工作区后，内存中存活的 store ≤ 3；重新进入早期工作区，文件树/展开态/标签从持久化恢复。

**风险**：中。**淘汰必须晚于该工作区最后一个会话卸载**，否则会丢失内存态。`index.jsx:322` 的 `keepMounted:true` 意味着会话 tab body 常驻挂载 —— **淘汰条件必须基于"会话是否还挂载"，不能只看"最后访问时间"**。

---

#### PERF-06 — 切会话不再触发全量 git status

**现状**：`store.js:787`（activate 且 `statusAt===0`）→ `refreshStatus`（`store.js:848-888`）→ host `git.js:230-276`，**一次调用起 3 个 git 子进程**：

- `git status --porcelain=v2 --branch -z --ignored=matching`（`:236-237`）—— `--ignored=matching` 需遍历整棵工作树；
- `git diff --numstat` × 2（`:243`、`:245`）。

触发时机：`init`（`store.js:312`）、**activate 且无缓存**（`:787`）、切工作区（`:623`）、切项目（`:673`）、**每 2 秒轮询**（`:785`→`:807`）。

**改法**：

1. **切回热工作区**时复用已有 `status` 缓存，**不立即拉取**；标记为 stale，由后台轮询按原有节奏刷新。
2. `--ignored=matching` **仅在设置开启"显示忽略文件"时**才传入。
3. `--numstat` **仅在 Commit 面板可见时**计算（不可见时省掉 2 个子进程）。

**验收**：切到已访问过的工作区 → **0 个 git 子进程**；轮询一次的子进程数从 3 降到 1（默认设置下）。

**风险**：中。状态显示可能短暂滞后（几百毫秒级），属可接受；需保证"提交前"仍然强制刷新一次 status（`store.commit` `store.js:2220-2270` 已有 refresh 逻辑，需复核仍在）。

---

#### PERF-07 — 冷会话不整段重放

**现状**：冷 store 初始化时（`store.js:692-736`）：

- `:735` → `ensureTabContent`（`store.js:1574-1637`）**重新从磁盘读**每个已打开文件（上限 24 个）→ 24 次 `fs.read`；
- `:964-973` `loadRestoredTree` **重列根目录 + 所有展开目录**（上限 200）→ 每目录 `loadDir`（`:928-955`）→ host `listDirectory` **逐条 lstat**（`host/workspace.js:144`，单目录上限 5000）。

**改法**：

1. 已打开文件改为**懒加载**：首次聚焦某个标签时才读盘（`ensureTabContent` 已有幂等保护，确认可在 `openFile`/`activateTab` 路径上按需触发）。
2. 冷启动**只列根目录**；展开目录在用户展开时按需加载（`loadDir` 已具备按需能力）。
3. 恢复出的标签先以"仅路径 + 文件名"占位，内容加载完成后再填充。

**验收**：冷工作区首次进入的 `fs.read` 次数 = 0（未聚焦）；目录列表请求 = 1（仅根目录）；展开目录时再按需请求。

**风险**：**中高**。懒加载会改变"打开标签即有内容"的既有语义，可能出现短暂空白。缓解：占位态需明确（如灰底 + 文件名），不得显示为"加载中"假象（沿用 V3 对树过滤的同类要求）。

---

#### PERF-08 — 目录列举去掉逐条 lstat

**现状**：`host/workspace.js:144` 对每个条目调用 `lstat` 以取 size/mtime，单目录上限 5000（`:161`）→ 5k 文件目录 = 5k 次串行 stat。

**改法**：改用 `readdir(withFileTypes)` 一次拿全；**树不需要 size/mtime 时不再 stat**；需要时按需单独取（且并发限流）。

**验收**：5k 文件目录的列举耗时下降一个数量级；单测断言 `listDirectory` 不再对每项调用 `lstat`（用桩计数）。

**风险**：中。`size`/`mtime` 若在 UI 或排序中被使用，需同步补齐取数路径——**改前先 grep 全部消费点**。

---

#### PERF-09 — render 期不再读宿主 session 快照

**现状**：`index.jsx:149` **在 render 期**调用 `getStore(sessionId)` → `sessionCwdOf` → `sessions.list.getSnapshot()`（`workspace-scope.js:59-62`）。因 `keepMounted:true`（`index.jsx:322`）每个会话的 tab body 常驻挂载 → **每轮渲染、每个会话都读一次宿主 session 快照**。

**改法**：缓存 `sessionId → cwd` 映射，在会话切换时失效；或把 `getStore` 调用移出 render（useMemo / 订阅式获取）。

**验收**：切会话时宿主 session 快照读取次数为 0（切后 1 次）。

**风险**：低—中。缓存失效时机若判错，会取到旧 cwd。**必须与 `workspace-scope.js:56-66` 的归一化规则保持一致**。

---

### 1.3 性能验收口径（可量化）

实施前先建立基线，再验收：

| 指标 | 基线（现状） | 目标 |
|---|---|---|
| 切到**热**工作区时的 git 子进程数 | 3 | **0** |
| 单次轮询的 git 子进程数 | 3 | **1** |
| 冷工作区首次进入的 `fs.read` 次数 | ≤24 | **0**（未聚焦标签） |
| 冷工作区首次进入的目录列表请求数 | ≤201 | **1** |
| 切会话时 ProjectPanel 树行重建次数 | 全树 | **与切会话无关**（仅受状态变化影响） |
| 常驻 store 数（开 10 个工作区后） | 10 | **≤3** |

**测量方法**：在 store 增加开发态计数器（`window.__iwbPerf`，仅 dev 构建暴露），记录 notify 次数、git 子进程数、fs 调用数。**该计数器须在生产构建中关闭或置空。**

### 1.4 上游待办（插件外，本仓库不实施）

以下三项是用户卡顿的**直接根因**，但不在本仓库，需转交对应仓库：

| ID | 症状 | 证据 | 建议改法 | 归属 |
|---|---|---|---|---|
| UP-01 | 每次切会话都**重建整个会话列表快照**（O(会话数) 的 map 拷贝） | 原始需求给出的链路：`openSession → sessions.retain(mainView)` | 改为**结构共享**快照：只复制受影响分支，而非整表 map 拷贝；或引入版本号 + 增量订阅 | DSH 核心前端 |
| UP-02 | 快照变更**通知所有订阅者**，订阅粒度过粗 | 同上 | 通知时携带变更集，订阅者按需过滤；或引入 selector 订阅 | DSH 核心前端 |
| UP-03 | 工作区侧边栏对**每个工作区 × 每个会话**重新派生分组/排序（O(W×S)） | 原始需求描述；**本仓库无此逻辑**（`workspace-scope.js:59-62` 仅 O(1) 单键查找） | 按工作区缓存派生结果，仅重算**受影响的工作区** | `dsh-better-sidebar` |

**另有两项需在开工前核实（阻塞项，见 §9 M0）：**

| ID | 待核实问题 | 为什么重要 |
|---|---|---|
| UP-04 | DSH 宿主是否已占用 `Ctrl+Shift+R`？ | 若占用，TREE-04 的新快捷键须改用 `Ctrl+Alt+R`（§2.4 有 7 处需同步）。**本仓库 grep 仅命中需求文档本身，但宿主源码不在此处，无法验证。** |
| UP-05 | 宿主是否**按会话行**渲染 `conversation.session.header.utilities` 槽位？ | 插件在该槽注册了入口（`index.jsx:359-364`）。若宿主按会话行渲染，将产生 S 个入口实例 → 需把入口做成轻量组件，避免每个实例持有 store 引用。 |

**反馈要求**：插件侧改造完成后，把 §1.3 的验收表与 §1.4 的 UP-01~03 一并反馈给上游，**不要**在插件内试图"绕过"宿主问题（例如自行缓存会话列表）——那会引入更难维护的影子状态。

---

## 2. TREE — Project 文件树与工具条

### 2.1 TREE-01 目录箭头单击展开/折叠

**结论**：箭头已存在（`ProjectPanel.jsx:591`），**新增的只是点击处理**。

| 项 | 内容 |
|---|---|
| 现状 | `ProjectPanel.jsx:591` 渲染 `span.iwb-tree-twisty`，内含 `ChevronDown`/`ChevronRight`（`ui.jsx:225-233`）。**无 onClick、无 cursor**（`styles.js:333`）。 |
| 改法 | 给该 span 加 `onClick: event => { event.stopPropagation(); store.toggleDir(entry.path) }`；`styles.js:333` 补 `cursor:pointer` 与 hover 反馈。 |
| 保留 | 双击展开/折叠（`onRowDoubleClick` `ProjectPanel.jsx:383-388`，目录行绑定于 `:584`）——**原有设计不变**。 |
| 对齐 | 文件行的同尺寸空占位 span（`:612`）保持不变，确保缩进一致。 |
| 键盘 | 已有的 ArrowRight/ArrowLeft 路径（`ProjectPanel.jsx:436-455`）保持不变。 |

**验收**：单击箭头 → 该目录展开/折叠，**且不触发行选中**；双击目录名 → 效果相同。

**⚠ 风险（必须处理）**：箭头在行内（`ProjectPanel.jsx:577-594`），行上有 `onClick`（`:583`）。不加 `stopPropagation` 会导致**单击箭头同时"选中 + 折叠"两个动作**。`stopPropagation` 是本项的硬性要求。

---

### 2.2 TREE-02 新增【文件定位】按钮

**结论**：**复用已有能力，不新建**。

| 项 | 内容 |
|---|---|
| 现状 | 已打开文件列表 = `state.tabs`（`store.js:108`，项含 `{id, kind:'file', path, rel, ...}`）+ `state.activeId`（`:109`）。展开到指定路径的核心函数 = `store.setSelectedPath(path)`（`store.js:1002-1019`，逐级把祖先目录加入 `expanded` 并 `loadDir`）。滚动定位 = `ProjectPanel.jsx:236-245` 的 reverse-locate 副作用。切 tab 时已自动定位：`store.activateTab`（`store.js:1649-1655`）内调用 `setSelectedPath(tab.path)`。 |
| 位置 | Project 顶部 Header 按钮区（`ProjectPanel.jsx:655-687`）。放在**筛选按钮（`:675-678`）与新建按钮（`:679-682`）之间**。 |
| 行为 | 取 `state.tabs.find(tab => tab.id === state.activeId)`；`kind === 'file'` → `store.showTool('project')` + `store.setSelectedPath(active.path)`；否则按钮 `disabled`。 |
| 文案 | 新增 i18n key `project.locateFile`（en + zh 各一，见 §2.5）。 |

**验收**：打开某文件 → 点【文件定位】→ 文件树自动展开到该文件所在目录、该行进入可视区中部并保持选中。

**⚠ 风险（必须处理）**：

1. `setSelectedPath` 内部 `loadDir` 是**异步**的。若目标文件的父目录尚未加载，`ProjectPanel.jsx:236-245` 的滚动副作用可能因 `rows.length` 未变而**不触发**。→ 需要在"目标目录加载完成"后再滚动一次（把滚动触发条件从"行数变化"改为"目标路径已出现在 rows 中"）。
2. Project 面板不可见时 `setSelectedPath` 的滚动无意义 → 必须先 `showTool('project')`。

> **🔗 关联需求（同一路径解析域，勿重复实现）**：聊天 File link 的**相对路径解析**见本文档
> **§7 FILE-01**（根因在 `file-address.js:70-72` / `:116-124` 的前导斜杠语义 + 相对基准歧义，
> 改法见 §7.4/§7.6）。
> 本条 TREE-02 与之共享"把一个路径定位到项目内文件"的能力域：
> **§7 产出的候选解析语义（基址优先级、工作区围栏判定）必须被 TREE-02 直接复用**，
> 不得在 `ProjectPanel`/`store` 里另写一套相对路径解析，否则两处对"相对谁"的判断会分叉。

---

### 2.3 TREE-03 彻底移除【收藏夹】

**结论**：按"彻底移除"执行，**包含右键菜单项与快捷键**，不留悬空入口。

**波及清单（全部需要清理）**：

| 位置 | 内容 |
|---|---|
| `ProjectPanel.jsx:667-670` | Header 收藏夹按钮（`'★'` 字形） |
| `ProjectPanel.jsx:180` | `favoritesOpen` 组件 state |
| `ProjectPanel.jsx:637-652` | 收藏夹面板渲染 |
| `ProjectPanel.jsx:688` | 收藏夹面板挂载点 |
| `ProjectPanel.jsx:339` | 右键菜单"加入收藏夹"项 |
| `ProjectPanel.jsx:407` | 键盘 `hit('favorite')` 分支 |
| `ProjectPanel.jsx:30` | 键盘 fallback 键 `Alt+Shift+F` |
| `store.js:1369-1379` | `toggleFavorite` |
| `host/settings-store.js:91` | 默认设置 `favorites: []` |
| `host/settings-store.js:117` | 默认快捷键 `favorite: 'Alt+Shift+F'` |
| `styles.js:412-417` | 收藏夹相关样式 |
| `i18n.js` | `project.favorites` / `project.addFavorite` / `project.removeFavorite` |

**兼容策略（已定）**：

- `settings.json` 中已存在的 `favorites` 数组与 `shortcuts.favorite` **保留读取、不再展示、不再生效**——不做破坏性迁移，不删用户文件。
- 设置页**无需改动**：`SettingsPanel.jsx:10-20` 的 `SHORTCUT_FIELDS` 本就不含 favorite。
- 旧配置项在 store 读取时忽略即可（不报错、不提示）。

**验收**：UI 上找不到任何收藏夹入口；右键菜单无"收藏"项；`Alt+Shift+F` 无响应；重启后设置文件不报错。

---

### 2.4 TREE-04 隐藏【全项目查找】+ 快捷键改为 `Ctrl+Shift+R`

**结论**：全局查找改为**仅快捷键可达**，按钮与右键入口一并移除。

**2.4.1 移除的入口（3 处）**

| 位置 | 内容 |
|---|---|
| `ProjectPanel.jsx:671-674` | Project Header 的全项目查找按钮（`'⌕'` 字形） |
| `Workbench.jsx:67-70` | 顶栏的**第二个**全项目查找按钮（需求原文只提了 Project 顶部，但"仅通过快捷键"要求两处都清） |
| `ProjectPanel.jsx:306` | 右键菜单的 find-in-files 项 |

**2.4.2 快捷键改造（7 处同步，漏一处即失败）**

| # | 位置 | 内容 |
|---|---|---|
| 1 | `host/settings-store.js:107` | 默认 `findInFiles` 值改为 `Ctrl+Shift+R` |
| 2 | `index.jsx:432-433` | 全局注册的 fallback 快捷键串 |
| 3 | **`EditorArea.jsx:447-452`** | **硬编码的 `mod && ((shift&&!alt)||(alt&&!shift)) && key==='f'` 分支——不改这里，`Ctrl+Shift+F` 依然会打开全项目查找** |
| 4 | `host/settings-store.js:108-109` | `findInFilesAlt`（`Ctrl+Alt+F`）**保留为备用别名**，注释说明原因（部分 Electron 外壳会占用 `Ctrl+Shift+F`） |
| 5 | `i18n.js:42` / `:480` | `settings.findInFilesAltShortcutHint` 等提示文案 |
| 6 | `SettingsPanel.jsx:17-18` | 快捷键设置项字段 |
| 7 | `SettingsPanel.jsx:402` | "恢复默认"快捷键集合 |

**2.4.3 不动的部分**

- **裸 `Ctrl+F`**（文件内查找，`EditorArea.jsx:453`/`:462`）**保持不变**。
- `findInFilesAlt = Ctrl+Alt+F` 保留。

**2.4.4 历史佐证（来自 `docs/PRD-v3-实施进展.md:93`）**

> "`Ctrl+Shift+F` 被 DSH/Chromium 外层吞掉；`Ctrl+Alt+F` 备用键可用。顶部按钮点击仍被外层覆盖层拦截，Project 面板头部与右键菜单入口作为兜底。"

这条 V3 轮的实机记录**独立印证了本次改动的两点前提**：

- `Ctrl+Shift+F` **确实**会被外层吞掉 → 用户提出改键的动机成立，且插件早已为此埋了 `Ctrl+Alt+F` 兜底（`host/settings-store.js:108-109` 的注释即为此）。
- 顶栏的搜索按钮**当时就已经点不动**（被外层覆盖层拦截）→ 隐藏它（`Workbench.jsx:67-70`）不但符合"仅通过快捷键"，还顺带消除了一个失效入口。

**2.4.5 阻塞项**

开工前必须完成 **UP-04**：确认 DSH 宿主未占用 `Ctrl+Shift+R`。
- 未占用 → 按上表实施。
- 已占用 → 全部 7 处改用 `Ctrl+Alt+R`，并在 §10 的验收清单中同步替换。

**验收**：

- `Ctrl+Shift+R` 打开全局查找（Find in Files）标签页。
- `Ctrl+Shift+F` **不再**触发全局查找（`Ctrl+F` 仍为文件内查找）。
- UI 上无全项目查找按钮；右键菜单无该入口。

---

### 2.5 i18n 约定

- UI 文案在 **`src/client/i18n.js`**：`en` 对象 `:9-445`，`zh` 对象 `:447-883`，**两段键名完全一致**（zh 行号 = en 行号 + 438）。
- `locale/zh.json` / `locale/en.json` **只含插件 meta**（`meta.title` / `meta.description`），不是 UI 文案表。
- 本轮新增键：`project.locateFile`（en + zh 各一）。
- 本轮删除键：`project.favorites`、`project.addFavorite`、`project.removeFavorite`（TREE-03）。
- 现有符号字形（`'★'` `'⌕'` `'+'` `'×'` `'…'`）**不走 i18n**，属既有惯例，保持一致。

---

## 3. COMMIT — 未版本控制文件的勾选语义

### 3.1 COMMIT-01 勾选不自动 Add，提交时才 Add

**现状链路（已逐行核实）**：

```
CommitPanel.jsx:39-47   checkbox onChange
  → store.js:2002-2004  toggleCommitEntry
  → store.js:2010-2036  setCommitChecked
       :2025            buckets[entry.path] = 'untracked'   ← 分组已被钉住
       :2026            if (entry.staged !== true) toStage.push(entry.path)   ← 罪魁祸首
  → store.js:2034       await this.stage(toStage)
  → store.js:2157-2166  call('git.stage', {root, paths})
  → index.js:304-308    Host 路由
  → host/git.js:293-296 git add -- ...paths                  ← 真的写了 index
```

**问题定性**：文件**没有跨组移动**（`buckets` 已钉住，`commit-model.js:29`），但**index 被写了**，导致状态字母 `U`→`A`、配色红→绿（`host/git.js:250-263`、`CommitPanel.jsx:31/33`、`git-colors.js:28-47`），观感上"移进了改动区"，增加检视困难。

**改法**：

1. **`store.js:2026`**：对 untracked 条目**不** push 到 `toStage`。改为把路径记入 `commit.pendingStage`（新增 Set 字段）。
2. **提交时**：`store.commit`（`store.js:2220-2270`）在 `:2247` 调用 `call('git.commit', ...)` **之前**，先对 `commit.pendingStage` 中的路径调用 `call('git.stage', { root, paths })`。
   - **host 无需任何改动**：`git.stage` 已接受 paths 数组（`index.js:304-308` → `host/git.js:293-296`）。
3. **取消勾选**：`store.js:2030` 的 `toUnstage` 分支保留（对 `entry.staged === true` 的条目才触发）。未 Add 的 untracked 条目 `staged !== true`，因此不会产生 `git reset` → **index 与复选框不会失配**。
4. **提交后**：刷新 status，使状态字母与实际 index 对齐。

**验收**：

- 勾选未版本控制文件 → `git status` **index 不变**（`git diff --cached` 无该文件）、文件**仍留在「未版本控制的文件」分组**、字母仍为 `U`、配色仍为未跟踪色。
- 点击提交 → 该文件**先被 Add**，与「改动」组一起提交成功。
- 取消勾选 → 不产生任何 index 副作用。
- 提交失败（如 message 为空、pre-commit 任务失败）→ **index 回滚**，不留下"已 Add 但没提交"的半截状态。

**⚠ 风险（必须处理）**：

1. `isEntryChecked`（`commit-model.js:40-46`）的默认值是"已 staged 即视为勾选"。改为"提交时才 Add"后，untracked 条目在 Add 之前 `staged` 恒为 false → 必须靠 `checked` 集合兜底（`store.js:2014` 的 `checkedSet`），确认 `isEntryChecked` 的优先级顺序（`unchecked` → `checked` → `staged`）能正确表达"用户勾了但还没 Add"。
2. Add 失败必须**中断提交**并回滚 UI 状态（参照 `store.js:2248-2258` 现有的 patch 复位逻辑）。
3. 组头复选框（`headerState`，`commit-model.js:58-64`）在"全选未版本控制文件"时同样不得触发批量 Add。

### 3.2 附带修复（真实缺陷，独立于本条）

**`commit.buckets` 在切换 Project 时未清理。**
`#switchProject`（`store.js:653-669`）只重置 `status` / `git` / `search`，**不动 `commit.buckets`** → 换仓库后同名路径可能被误钉在「未版本控制」组。

**改法**：在 `#switchProject` 中一并重置 `commit.buckets`（以及 `commit.checked` / `commit.unchecked`，避免跨仓库串状态）。

**验收**：在仓库 A 勾选未跟踪文件 → 切到仓库 B（同名文件）→ B 中该文件**不显示为已勾选**。

---

## 4. GIT — Git 历史面板

### 4.1 GIT-01 Git 历史页仓库自治（与 Project 解耦）

**背景**：DSH 工作区常是"一个根目录下若干微服务仓库"，而不是单一仓库。当前若 Project 根不是 git 仓库，只能显示"当前项目不是 GIT 仓库"（`i18n.js:602` zh / `:164` en，使用点 `GitPanel.jsx:547` / `CommitPanel.jsx:220` / `EditorArea.jsx:57`），想看别的仓库的历史就得切 Project，而切 Project 会**连带重置文件树和标签页**（`store.js:630-651` `selectProject` → `:653-677` `#switchProject`）——这正是要消除的痛点。

**现状要点**：

| 能力 | 现状 | 锚点 |
|---|---|---|
| 仓库探测 | `git rev-parse --show-toplevel`（**不遍历子目录**） | `host/git.js:113-121` |
| 候选仓库来源 | `workspace.projects` → `listProjectCandidates`：扫**工作区根 + 一级子目录**，用 `existsSync(join(dir,'.git'))` 判 isRepo，上限 400 | `host/workspace.js:75-103` |
| 客户端候选 | `store.loadProjects` → `state.projects` | `store.js:541-563` |
| 现有"选择Git子仓库" | `store.openProjectPicker` → ProjectPicker → `selectProject`（**会重置文件树/Tab**） | `store.js:679-686`、`Workbench.jsx:246-303` |

**改法**：

1. **Git 面板自持仓库状态**：新增 store 字段 `state.gitRepoRoot`（字符串路径）。
   - 默认值 = 当前 Project 根；若 Project 根不是仓库，则取候选列表中的第一个仓库。
   - 该字段**只影响 git.* 调用**，不触碰 `state.root`（文件树）、`state.tabs`、`state.projectRoot`。
2. **所有 git 调用改用 `gitRepoRoot`** 作为仓库根参数（Host 侧 `repoEnv` 已有 prefix 桥，见 `index.js:72-81`）。
3. **控件位置**：`BottomTabs`（`Workbench.jsx:128-149`）——即【Terminal/Git】那组 Header。
   - **仅当 `state.layout.bottom === 'git'` 时可点**（活动的是 Git 时才支持选择仓库），其余时候置灰或不渲染。
   - 视觉范式参照 `GitPanel.jsx:452-462` 的 `.iwb-branch-switch` 与 `BranchPopover`（`GitPanel.jsx:123-169`）。
4. **非仓库提示改造**：`GitPanel.jsx:547-553` 的错误块改为引导用户使用 Header 的仓库选择器（不再引导"切换 IDE 项目"）。
5. **Project 侧不受影响**：Project 的项目选择器保持原样，仍用于切换**文件树根目录**——两个选择器语义独立、并存。

**候选扫描深度（已确认）**：**维持"工作区根 + 一级子目录"**，不做递归扩展。更深层仓库（如 `src/services/a`）不被发现——沿用 V1.2 已知限制，需先打开其上级目录。

**验收**：

- Project 根不是仓库时，Git 面板**仍可查看**候选仓库的历史，无需切 Project。
- 在 Header 切换仓库 → **文件树、已打开标签、Project 根目录均不变**；只有 Git 日志/分支/状态随之切换。
- 切到非 Git 活动时，仓库选择控件不可点。
- Project 面板的项目选择器行为完全不变。

**⚠ 风险（必须处理）—— 路径口径**：

- Commit 面板 status 的 path 是**工作区相对**（`index.js:273` `fromRepoPath`）；
- commit 详情里的 path 是**仓库相对**（`GitPanel.jsx:88-112` 解析 `diff --git a/... b/...`）；
- `git.commit-file-diff` 内部走 `toRepoPath`（`index.js:300`）。

切仓库后这三种口径的换算基准会变 → **必须回归测试 Commit 分组、变更文件树、单文件差异三条链路**。

---

### 4.2 GIT-02 去掉变更文件预览（冗余）

**结论**：删除。

| 位置 | 内容 |
|---|---|
| `GitPanel.jsx:269-274` | `iwb-git-drawer-inline` 区块（内联 `InlinePatch`）—— **本次删除主体** |
| `GitPanel.jsx:114-121` | `InlinePatch` 组件 —— 连带清理 |
| `GitPanel.jsx:174` | `selectedFile` state —— 连带清理 |
| `styles.js:919-921` | `.iwb-git-drawer-inline` 样式 —— 连带清理 |

**保留不动**：`selected`（文件选中态，`GitPanel.jsx:257`）、`files` 列表、单击选中（`:259`）、双击打开完整差异（`:260`）。

**理由**：双击某变更文件已在**内容区**渲染完整差异（`store.openCommitFile` `store.js:1868-1936` → `git.commit-file-diff` `index.js:297-302`），Drawer 内的预览完全冗余，且把 Drawer 挤成"很小一块区域滑动看太多东西"。

**验收**：打开 commit 详情 Drawer → 只有元信息、message、变更文件树三块，无预览区；双击变更文件仍在内容区渲染完整差异。

---

### 4.3 GIT-03 变更文件改为文件树

**现状**：`GitPanel.jsx:253-268` 平铺渲染，每个文件一行（状态字母 + 文件名 + 目录 + `+`/`-` 统计）。

**数据可用性**：`diffFiles`（`GitPanel.jsx:88-112`）已从 patch 头解析出**完整仓库相对路径**（`:94-95`）与 `status`/`additions`/`deletions`（`:102-108`）→ **可直接按 `/` 构树**，无需新增 host 接口。

**改法**：

1. 复用 `groupByDirectory`（`commit-model.js:70-81`）作为第一层分组；需要多层时递归构树。
2. 目录节点可折叠，**默认展开到第一层**；折叠状态为 Drawer 内部局部 state，**不持久化**。
3. 每个文件叶子保留：状态字母、文件名、`+`/`-` 统计（`:262`/`:265`/`:266`）、`title` 完整路径。
4. 单击选中（`:259`）、双击打开完整差异（`:260`）行为不变。
5. **rename（`R`）状态取 `b/` 侧路径**（`GitPanel.jsx:94-95`）。

**验收**：commit 详情 Drawer 中变更文件按目录成树显示；目录可折叠；双击叶子仍在内容区渲染差异。

**⚠ 风险**：目录树的折叠交互需与 Drawer 内的滚动、选中态共存；注意 `selected` 状态与树节点展开态是两套状态，不要混用。

---

## 5. LAYOUT — Terminal/Git 布局

### 5.1 LAYOUT-01 Terminal/Git 通栏

**现状**：`bottomNode` 挂在 `.iwb-center` **内部**（`Workbench.jsx:437-440`），而 `.iwb-body` 是**横向** flex（`styles.js:113`），内含 `.iwb-stripe`(44px, `styles.js:114-117`) + `.iwb-left`（`styles.js:135-139`）+ `.iwb-center`（`styles.js:162`）→ 底部栏天然从左栏右缘开始，**被左侧栏挤窄**。

`styles.js` 全文**没有 `grid-template-areas`** —— 这不是 grid 控制，而是 DOM 嵌套的结果。

**改法（最小且彻底）**：把 `bottomNode` 从 `.iwb-center` 上移为 **`.iwb-root` 的直接子节点**（与 `.iwb-body`、`.iwb-statusbar` 同级，见 `Workbench.jsx:432-442`）。

- `.iwb-root` 已是 column flex（`styles.js:40-62`，`:50-51`）；
- `.iwb-body` 是 `flex:1`（`styles.js:113`）；
- → 底部栏**自动通栏**，左侧栏**自动收缩到其上方**；
- **无需新增任何 store 字段**（`layout.bottom` / `layout.bottomHeight` 已存在，`store.js:87`）。

**验收**：

- 打开 Terminal 或 Git → 底部栏横跨**整个工作台宽度**（含左侧栏所在区域）。
- Project/Commit 侧栏在底部栏上方显示，宽度不变。
- 底部栏高度仍可拖拽调整（`.iwb-bottom-resizer`，`styles.js:293`）。

**⚠ 风险（必须逐条验证）**：

1. **`.iwb-stripe`（44px 竖条）会被底部栏覆盖**。→ 规格：**底部栏内容区左侧保留 44px 空白**，stripe 保持通高可点（与当前视觉一致）。
2. `styles.js:952-962` 的竖排断点中 `.iwb-body{flex-direction:column}` 与 `.iwb-bottom{max-height:65%}` 的**百分比基准**从 `.iwb-center` 变为根高度 → 需复核窄屏表现。
3. `.iwb-term-pane{position:absolute}` 的**定位祖先**改变 → 必须复核终端面板的绝对定位与滚动。
4. **与上下排布（stacked）的关系**：`state.stacked`（`store.js:89`，切换逻辑 `store.js:2550-2565`）为 true 时，Project/Commit 与 Git/Terminal 已互斥（`store.js:2597-2623`），左栏本就不存在 → 通栏天然成立，**无需额外处理**。
5. V4 已实现的"切到上下排布时自动收起全部工具窗"（`store.js:2567-2595`）**不受影响**，不得回退。

---

## 6. EDITOR — 内容区域

### 6.1 EDITOR-01 外部修改冲突提示改为文档区居中弹窗

**现状**：**不是弹窗**，而是编辑器工具条内的 inline chip（`EditorArea.jsx:316-328`，样式 `.iwb-conflict-chip` `styles.js:790-793`），文案为 `editor.externalChanged` / `editor.reloadFromDisk` / `editor.overwriteDisk`（`i18n.js:405/843`、`403/841`、`404/842`）。窄窗口时 chip 文本换行 → "看不清内容"。

> **独立佐证**：`docs/PRD-v3-实施进展.md:83` 的实机记录写明——"磁盘内容已变化 / 从磁盘重新加载 / 覆盖磁盘"出现在**工具栏**上。这确认了"它是个工具栏 chip、不是弹窗"，与本条的现状判定一致。

**改法**：

1. 复用现成的居中弹窗机制：`askChoice`（`store.js:256-264`）→ `state.confirm` → `ConfirmModal`（`ui.jsx:116-164`，渲染于 `Workbench.jsx:457`）→ `.iwb-modal-backdrop`（`styles.js:695-697`，`position:absolute; inset:0`，居中）。
2. **居中基准要下沉**：现遮罩相对 `.iwb-root` 居中（含顶栏与状态栏）；需求要"**文档窗口中间**" → 遮罩需下沉到 `.iwb-center` 或 `.iwb-editor`（`.iwb-editor` 是 `position:relative`，`styles.js:189`）。
   → 新增一个 scoped 变体（如 `.iwb-editor-scoped-backdrop`），**不要改动现有 `ConfirmModal` 的居中基准**（保存冲突等其它场景仍在根级居中）。
3. **去重**：弹窗替代 chip，**移除 `.iwb-conflict-chip` 的渲染**（`EditorArea.jsx:316-328`），避免二者同时出现。
4. 触发点：`store.js:839`（轮询检出外部变更，置 `tab.conflict`）与 `store.js:919`（`#refreshActiveFile`）。

**验收**：外部修改文件 → 弹窗出现在**文档区正中央**；窄屏（≤560px）下文案不换行、不溢出；「从磁盘重新加载」「覆盖磁盘」两个操作均可用。

---

### 6.2 EDITOR-02 面包屑窄屏不折行

**现状**：`EditorArea.jsx:300` `const segments = tab.rel.split(/[\\/]/)`，渲染于 `:308-314`（最后一段 `<b>`，其余为 `<span>` + `›` 分隔符）。完整绝对路径已在 `title`（`:309`）。

**折行根因**：`.iwb-breadcrumb`（`styles.js:207`）为 `display:flex; min-width:0; overflow:hidden`，**未设 `white-space:nowrap`** → 子 span 默认 `flex-shrink:1` 被压窄后**文本在 span 内部换行**，撑破 30px 高的 `.iwb-editor-toolbar`（`styles.js:203-206`）。`.iwb-editor-toolbar` 仅在 ≤760px 容器查询里才 `overflow-x:auto`（`styles.js:945`）。

**改法**：

1. `.iwb-breadcrumb` 加 `white-space:nowrap`；子项 `flex-shrink:0`。
2. **窄容器下中间段折叠为省略号**：段数 ≥ 3 时保留首段与末段（文件名），中间的段折叠为一个 `…`；折叠后的完整路径保留在 `title`（已是 `tab.path`），hover 可见。
3. 不改变正常宽度下的完整路径展示。

**验收**：宽度 320px / 560px 下，面包屑**单行**显示、不换行、不撑破工具条；文件名始终可见；hover 显示完整路径。

---

## 7. FILE — 聊天 File link 的相对路径解析

> **来源**：用户实机反馈（见 `1030优化需求.md` 追加条目）。上一轮交付了聊天文件链接的**认领机制**
> （`docs/1023优化需求-实施进展.md` §1.3），本条修的是其中**相对路径形态**的一个缺口。
> **性能评估结论：成本可忽略，纳入本轮**（逐场景测算见 §7.5）。

### 7.1 FILE-01 现象

工作区文件 `D:/Code/DSH-IDE-TOOLWINDOWS-ROOT/dsh-ide-workbench/docs/PRD-v4.md`
在聊天里以 File link 出现时，路径形态是 `/docs/PRD-v4.md`。

结果：**IDE 工作台不认领**（判定为"不在工作区"）→ 交回 DSH 默认侧栏 → 默认侧栏同样不认识这个路径 → **打不开**。

已用 `node` 直接跑现有解析代码复现，三种地址形态全部确认：

| 地址形态 | `parseFileAddress` 得到 path | `resolveFileAddress(cwd=工作区根)` | 落在工作区？ | 实际结果 |
|---|---|---|---|---|
| `session/s1//docs/PRD-v4.md` | `/docs/PRD-v4.md` | `/docs/PRD-v4.md` | ❌ | → 默认侧栏 → **打不开** |
| `session/s1/docs/PRD-v4.md` | `docs/PRD-v4.md` | `D:/Code/…-ROOT/docs/PRD-v4.md` | ✅ 但不在项目内 | → 走"切换项目"提示 → 切完仍指向**不存在的路径** → **打开失败** |
| `absolute//docs/PRD-v4.md` | `//docs/PRD-v4.md` | `//docs/PRD-v4.md` | ❌ | → 默认侧栏 → **打不开** |
| `absolute/D:/Code/…/docs/PRD-v4.md` | `D:/Code/…/docs/PRD-v4.md` | 同左 | ✅ 且在项目内 | ✅ **正常打开**（现状正确，不能回归） |

### 7.2 根因

**两个叠加的问题**：

**① 前导斜杠被当成绝对路径，工作区前缀根本没拼上。**
`src/client/file-address.js:70-72` 的 `isAbsoluteFilePath` 对任何以 `/` 开头的路径返回 true；
`src/client/file-address.js:116-124` 的 `resolveFileAddress` 因此在 session 作用域下**直接短路**：

```js
if (isAbsoluteFilePath(path)) return normalizeFilePath(path, cwd)   // ← 不拼 cwd
```

而 session 作用域的语义本应是"相对该 Session 的工作区"（`file-address.js:4-9` 的语法注释：
"addresses a file relative to one Session's workspace (**an absolute path keeps its leading `/`**)"）——
**这条注释正是歧义来源**：它把"前导 `/`"同时解释成"绝对路径"和"相对路径的冗余斜杠"。

**② 相对路径的基准不唯一。**
插件自身的文件寻址基准是 **IDE 项目根** `state.root`
（`src/client/store.js:1183-1185` `#absoluteOf` = `join(state.root, rel)`；
`src/client/store.js:1586` `fs.read({ root: this.state.root, path: tab.path })`），
而链接解析用的是**会话工作区根** `workspaceRoot`（`src/client/store.js:74-77`）。

在用户的实际布局里两者不同：

- `workspaceRoot` = `D:/Code/DSH-IDE-TOOLWINDOWS-ROOT`
- `state.root`（IDE 项目）= `D:/Code/DSH-IDE-TOOLWINDOWS-ROOT/dsh-ide-workbench`
- 链接 `/docs/PRD-v4.md` 相对**项目根**才对，相对**工作区根**是另一个不存在的路径

→ 只修 ① 不够；必须同时解决"相对谁"的歧义。

### 7.3 为什么不能简单地"去掉前导斜杠"

在 **Windows** 上这是安全的：真实绝对路径必带盘符（`C:\`）或 UNC（`\\`），
单斜杠开头的 session 路径**只可能是"带冗余斜杠的相对路径"**。

但在 **POSIX** 上 `/home/me/proj/a.md` 是合法绝对路径。直接剥斜杠会把工作区内的绝对路径
误解成相对路径，**把今天能打开的文件改成打不开**。

→ 判定必须**平台感知**：Windows 上直接按相对路径处理；POSIX 上保留"绝对解释优先"，
仅当绝对解释落在工作区外时，才回退到相对候选。

### 7.4 候选基址

歧义路径按下列顺序取候选，**首个在磁盘上存在者胜出**：

| 序 | 基址 | 来源 | 为什么排这个位置 |
|---|---|---|---|
| 1 | IDE 项目根 `state.root` | `store.js:77` | 插件自身寻址基准（`#absoluteOf`），链接最可能相对当前项目 |
| 2 | 会话工作目录 `sessionCwdOf(ctx, sessionId)` | `workspace-scope.js:56-66` | 链接作者所在的会话 cwd；多仓库工作区里它可能不是工作区根 |
| 3 | DSH 工作区根 `state.workspaceRoot` | `store.js:74-75` | 最外层边界 |

三个基址在常见布局下会**去重**（`state.root` 默认就等于会话 cwd，`store.js:302`），
典型情况只剩 1–2 个候选。

POSIX 上额外把**绝对解释**放在候选之前（仅当它 `isPathWithin` 工作区时才采纳），
以保证今天能打开的 POSIX 绝对路径行为不变。

### 7.5 性能评估

**结论：成本可忽略，纳入本轮。** 逐场景测算：

| 场景 | 额外 I/O | 说明 |
|---|---|---|
| Windows 盘符绝对路径 `D:\…` | **0** | 不进入歧义分支，行为与今天完全一致 |
| 无前导斜杠的纯相对路径 `docs/x.md` | **0** | 行为不变 |
| POSIX 绝对路径且落在工作区内 | **0** | 先用 `isPathWithin` 做**字符串**判定，命中即沿用现逻辑，不触盘 |
| **歧义路径（前导单斜杠）** | **≤3 次 `fs.stat`** | 三个基址各探一次；去重后通常 1–2 次 |
| 候选全不存在的兜底 | 同上（失败的 stat） | 随后回退默认侧栏，与今天一致 |

- 单次 `fs.stat` 在本地 NTFS 约 0.1–1 ms（量级估算，实测值实施时回填）；网络盘可能更慢，
  但这是**用户点击触发的一次性开销**，紧接着还要 `fs.read` 读整个文件——2–3 次 stat 相对 1 次 read 可忽略。
- **不在任何热路径上**：切会话、文件树渲染、2 秒轮询都不经过这段代码。
- 与 §1 的 PERF 系列（store 通知分层、树 memo 化等）**无冲突**，不产生新的重渲染。
- `fs.stat` 是**现成**的 host 接口（`src/index.js:155-164`，插件已在 `store.js:825` 用过），无需新增接口。

**因此判定：纳入本轮。** 若后续实测发现歧义链接高频点击导致感知延迟，
再考虑加一层"地址 → 解析结果"的会话内记忆（切项目时失效），本期不做。

### 7.6 改法

**原则：不改 `resolveFileAddress` 的现有语义**，只在 `store.openExternalFile` 外层增加候选回退。
这样 `tests/file-address.test.mjs:49-63` 的既有断言全部保持有效，回归面最小。

1. **`src/client/file-address.js`** —— 新增纯函数（便于单测，保持文件"无依赖、可单测"的既有风格）：

   ```js
   export function relativeLinkCandidates(path, bases) // → string[]
   ```

   规则：
   - 盘符绝对（`/^[A-Za-z]:[\\/]/`）或 UNC（`\\`）→ 返回 `[]`（无歧义，走绝对逻辑）
   - 以单 `/` 开头 → 候选 = 各 base 与 path 直接拼接（path 已含前导 `/`）
   - 其余（纯相对）→ 候选 = 各 base + `/` + path
   - base 顺序 = §7.4 的顺序；同值去重后保留首次出现的位置

2. **`src/client/store.js` `openExternalFile`（`:364-400`）** —— 候选回退：

   - 保持现有主解析与分流不变；
   - 当主解析结果**不在工作区内**、且路径属于歧义形态时 → 生成候选 →
     依次 `call('fs.stat', { root: base, path: rel })`（路由见 `src/index.js:155-164`）→
     **首个存在者胜出** → 交回现有分流（`#insideRoot` → `opened`；仅在工作区内 → `needs-project-switch`）；
   - 全部候选失败 → 保持现状（`outside-workspace` → 交回默认侧栏）。

3. **`src/client/index.jsx` `FileLinkBridge`（`:56-99`）—— 无需改动**，分流语义不变。

4. **围栏双保险（不可省）**：
   - 客户端侧：每个候选必须通过 `isPathWithin(workspaceRoot, candidate)`（`workspace-scope.js:43-48`）；
   - Host 侧：`resolveInside`（`host/workspace.js:50-59`）对越界输入直接 403，
     `..` 归一化后必须**重新**判定围栏，不能只判原始字符串。

### 7.7 验收

- [ ] 聊天 File link 指向 `…/dsh-ide-workbench/docs/PRD-v4.md`（地址形态 `session/<sid>//docs/PRD-v4.md`）→ **在 IDE 工作台打开**，展开 Project 树并定位到该文件。
- [ ] 同一文件以**无前导斜杠**的相对形态给出 → 也能打开（今天会走到"切换项目"提示后仍然失败）。
- [ ] 绝对路径形态 → 行为与今天一致，**无回归**。
- [ ] POSIX 上工作区内的绝对路径 `/home/me/proj/a.md` → 仍直接打开，不被误判为相对路径。
- [ ] 工作区外的相对路径（`/etc/passwd`、`/../outside` 等）→ **仍然不认领**，交回默认侧栏；**不得因本条打开工作区外的文件**。
- [ ] 目标文件不存在 → 回退默认侧栏，UI 提示与今天一致，不弹错误。
- [ ] 同一工作区内"项目根"与"工作区根"下存在同名文件 → 按 §7.4 顺序命中**项目根**那份。
- [ ] 性能：歧义链接从点击到打开完成，新增耗时 < 50 ms（相对今天）。

### 7.8 风险

| # | 风险 | 处置 |
|---|---|---|
| 1 | **越权打开工作区外文件**（最高） | 候选必须过 `isPathWithin(workspaceRoot, …)`；host `resolveInside` 再兜一道；`..` 归一化后重新判定 |
| 2 | POSIX 上把合法绝对路径误判为相对路径 | 绝对解释优先，且仅在它落在工作区外时才回退 |
| 3 | 同名文件误命中 | 候选顺序即优先级（项目根优先）；按 §7.4 固定 |
| 4 | `fs.stat` 失败不等于文件不存在（权限/网络盘离线） | 全部候选失败即回退默认侧栏，**不报错**、不弹错误 |
| 5 | 候选数膨胀导致 stat 风暴 | 基址去重；上限 3 个候选；失败即止 |
| 6 | 与 §1 的性能项冲突 | 本条不在热路径，不产生新重渲染；两者可并行推进 |

### 7.9 测试

- `tests/file-address.test.mjs`：新增 `relativeLinkCandidates` 纯函数断言 —— 盘符绝对/UNC/前导单斜杠/纯相对/基址去重/顺序稳定。
- `tests/store-ui.test.mjs`：新增 `openExternalFile` 用例 ——
  歧义路径命中项目根；工作区外相对路径被拒；POSIX 绝对路径不被改写；不存在路径回退默认侧栏。
- `tests/file-address.test.mjs:49-63` 既有的 `resolveFileAddress` 断言**必须保持原样通过**
  （本条不改它的现有语义）。

---

## 8. 交互契约（速查）

```
【Project 顶部 Header】
┌────────────────────────────────────────────────────────────┐
│ Project   [dsh-ide-workbench ▾]      ⌖定位 │ 🔍筛选 │ + │ ⟳ │  ← 收藏夹★与查找⌕已移除
├────────────────────────────────────────────────────────────┤
│ ▾ src          ← 箭头可单击展开/折叠（双击目录名仍有效）      │
│   ▾ components                                            │
│       App.jsx                                              │
│   ▶ assets                                                  │
└────────────────────────────────────────────────────────────┘
  ⌖ = 文件定位：仅当活跃标签为文件时可点

【Commit 面板】
┌────────────────────────────────────────────────────────────┐
│ [改动 (3)]        │ [未版本控制的文件 (2)]                  │
│  ☑ src/a.js      │  ☐ README.md      ← 勾选不写 index        │
│  ☐ src/b.js      │  ☐ notes.txt       字母仍是 U、仍在此组   │
│                   │      ↓ 点击「提交」时先 Add 再一起提交    │
└────────────────────────────────────────────────────────────┘

【Terminal / Git 组 Header】         ← 底部栏通栏（横跨整个工作台）
┌────────────────────────────────────────────────────────────┤
│ [Terminal(2)] [Git]  [仓库: dsh-ide-workbench ▾] │ ×        │
│                     ↑ 仅当活动的是 Git 时可点，切换仓库不动文件树 │
└────────────────────────────────────────────────────────────┘

【Git Commit 详情 Drawer】
┌──────────────────────────┬──────────────────────────────────┐
│ sha / 作者 / 日期 / parents│                                  │
│ commit message            │   ← 变更预览已删除（冗余）        │
│ 变更文件（树形，可折叠）   │                                  │
│  ▾ src/                   │                                  │
│      A  a.js   +12 −3      │                                  │
│  ▾ docs/                   │                                  │
│      M  b.md   +1  −1      │                                  │
└──────────────────────────┴──────────────────────────────────┘

【外部修改冲突】
        ┌───────────────────────────────┐
        │  文件已被外部修改              │  ← 居中于文档区
        │  [从磁盘重新加载] [覆盖磁盘]    │
        └───────────────────────────────┘
```

---

## 9. 实施顺序与里程碑

> 每个里程碑结束时：**跑 `npm test`（当前 159 项）+ `npm run build`**，并在 `docs/` 下追加实施记录。

### M0 — 开工前置（阻塞项，必须最先完成）

| 任务 | 判定 |
|---|---|
| **UP-04** 核实 DSH 宿主是否占用 `Ctrl+Shift+R` | 占用 → TREE-04 全部 7 处改用 `Ctrl+Alt+R` |
| **UP-05** 核实宿主是否按会话行渲染 `conversation.session.header.utilities` | 是 → 追加 PERF-10（入口组件轻量化） |
| 建立 §1.3 的性能基线（notify 计数 / git 子进程数 / fs 调用数） | 无基线无法验收性能项 |

**产出**：`docs/PRD-v4-实施进展.md` 的开头记录两项核实结论与基线数值。

---

### M1 — 性能止血（低风险、高收益，先让卡顿可测地改善）

**条目**：PERF-01、PERF-03、PERF-05、PERF-06、PERF-08、PERF-09

**理由**：这六项都是**局部改动**，不改交互语义，却能砍掉大部分可测开销（git 子进程、重复 fs、全树 flatten、内存线性增长）。风险低，先拿收益。

**重点**：

- PERF-06 与 COMMIT-01 有耦合（提交前需强制刷新 status）→ **PERF-06 先做，COMMIT-01 在 M3**，两者之间不要并行改同一段代码。
- PERF-03 改依赖数组后，**必须验证树的四种变化**（展开/折叠/筛选/状态色）都能正确刷新。

**验收**：§1.3 表格中除 PERF-02/04/07 外的全部指标达标。

---

### M2 — 交互清理（低风险，视觉收益直接）

**条目**：TREE-01、TREE-03、EDITOR-02

**理由**：都是纯 UI 层改动，半天内可见效，且彼此不冲突。

**重点**：TREE-01 的 `stopPropagation` 是硬性要求；TREE-03 要一次清干净 12 处残留。

---

### M3 — Commit 语义修正（正确性优先）

**条目**：COMMIT-01 + §3.2 的 buckets 修复

**理由**：这是**行为正确性**问题（写了不该写的 index），优先级高于外观类改动；且与 PERF-06 有依赖，需在 M1 之后。

**重点**：`store.js:2026` 的条件改造、`store.commit` 中 `:2247` 前的补 Add、Add 失败回滚、`isEntryChecked` 的优先级复核。

---

### M4 — Git 面板内部改造（局部）

**条目**：GIT-02、GIT-03

**理由**：都在 `GitPanel.jsx` 的 Drawer 内，互不依赖，可并行推进。GIT-02 是纯删除，GIT-03 是数据结构改造。

**重点**：GIT-03 的 rename 取 `b/` 侧路径；目录折叠态为局部 state。

---

### M5 — Git 仓库自治（结构性，风险最高）

**条目**：GIT-01

**理由**：牵涉 store 字段、host git 调用参数、Header 控件、路径口径三套换算，**必须单独一轮**，不要与其它条目混在同一批改动里。

**重点**：路径口径回归（Commit 分组 / 变更文件树 / 单文件差异）；`state.gitRepoRoot` 与 `state.root` 严格分离。

---

### M6 — 文件链接相对路径、Project 工具条与快捷键

**条目**：FILE-01、TREE-02、TREE-04

**依赖**：TREE-04 依赖 M0 的 UP-04 结论；**TREE-02 依赖 FILE-01 产出的候选解析能力**（两者必须共用同一套基址优先级与工作区围栏判定，不得各写一套）；TREE-02 另依赖 PERF-02/04（若 M8 未完成，定位时的重渲染成本较高，但不影响正确性）。

**重点**：FILE-01 先行落地；TREE-02 直接复用它的解析能力。TREE-04 的 **7 处同步**必须一次改完并逐条核对（尤其 `EditorArea.jsx:447` 硬编码）。

---

### M7 — 布局与冲突弹窗

**条目**：LAYOUT-01、EDITOR-01

**理由**：都是 DOM/CSS 结构调整，风险相对独立，适合一轮做完并做实机回归。

**重点**：LAYOUT-01 的 stripe 留白、百分比基准、终端绝对定位三条风险；EDITOR-01 的遮罩下沉**不得改动现有 `ConfirmModal` 的根级居中**。

---

### M8 — 性能结构化（最后做，需前序稳定）

**条目**：PERF-02、PERF-04、PERF-07

**理由**：PERF-02 是**面板级重构**（逐个面板迁移到 slice 订阅），PERF-07 改变"打开即有内容"的语义。放在其它条目都稳定之后，避免与功能改动互相干扰、难以定位回归。

**重点**：PERF-02 每迁移一个面板就回归一次该面板的交互；PERF-07 的懒加载占位态要明确，不得出现"加载中"假象。

---

## 10. 测试要求

### 10.1 新增测试文件

| 文件 | 覆盖 |
|---|---|
| `tests/perf-notify.test.mjs` | `store.set` 跳过等值变更；slice 订阅只在选中切片变化时通知；常驻 store 数 ≤ 3；切热工作区不触发 git 调用 |
| `tests/tree-twisty.test.mjs` | 单击箭头触发展开/折叠；双击目录仍有效；箭头点击不触发行选中（`stopPropagation`） |
| `tests/commit-staging.test.mjs` | 勾选 untracked **不**调用 `git.stage`；提交前先 `git.stage` 再 `git.commit`；Add 失败时提交被中断且 index 回滚；切项目清空 buckets |
| `tests/git-repo-scope.test.mjs` | 切换 `gitRepoRoot` **不**改变 `state.root` / `state.tabs`；`gitRepoRoot` 变更后 git 调用使用新根 |
| `tests/editor-conflict.test.mjs` | 冲突时渲染居中弹窗而非 chip；两个操作按钮均可用 |
| `tests/shortcuts.test.mjs` | `Ctrl+Shift+R` 触发全局查找；`Ctrl+Shift+F` **不**触发；裸 `Ctrl+F` 仍为文件内查找 |

### 10.2 现有测试的回归要求

- `tests/commit-model.test.mjs` —— `splitCommitGroups` / `isEntryChecked` 的语义变更会影响到，**M3 必须让此文件全绿**。
- `tests/render.test.mjs` —— Drawer 结构变化（GIT-02/03）、Header 按钮变化（TREE-03/04）会影响到。
- `tests/staging.git.test.mjs` —— 真实 git 场景，M3 需在此补充"勾选不写 index、提交时一次写"的断言。
- `tests/store-ui.test.mjs` —— 涉及 `setSelectedPath` / `openExternalFile`，TREE-02 需回归。
- 其余 `tests/*.test.mjs` 全部保持全绿。

### 10.3 交付前检查

- [ ] `npm test` 全绿（基线 159 项 + 新增用例）
- [ ] `npm run build` 成功，`dist/client.js` 已更新并提交
- [ ] §1.3 性能指标逐条达标（附实测数值）
- [ ] 实机走查：§10.4 的清单

### 10.4 实机验收清单

**性能**
- [ ] 打开 10 个不同工作区后内存不持续增长；回到早期工作区，文件树/展开态/标签完整恢复
- [ ] 切到已访问过的工作区：无卡顿，且无 git 子进程（用进程监视器或 `__iwbPerf` 计数确认）
- [ ] 冷工作区首次进入：仅根目录被列出，未聚焦标签不读盘

**Project**
- [ ] 单击箭头展开/折叠；双击目录名仍有效；单击箭头不会同时选中该行
- [ ] 【文件定位】：打开文件 → 点按钮 → 树自动展开并滚动到该文件
- [ ] 收藏夹：无按钮、无右键项、`Alt+Shift+F` 无效、重启不报错
- [ ] `Ctrl+Shift+R` 打开全局查找；`Ctrl+Shift+F` 无效；`Ctrl+F` 仍是文件内查找；UI 无查找按钮

**Commit**
- [ ] 勾选未版本控制文件：仍留在未版本控制组、字母仍为 `U`、颜色不变、`git diff --cached` 无该文件
- [ ] 点提交：该文件被 Add 并与改动一起提交成功
- [ ] Add 失败（如权限/冲突）：提交被中断，无半截暂存残留
- [ ] 切项目后：旧仓库的勾选状态不残留

**Git**
- [ ] Project 根不是仓库时，Git 面板仍能选仓库并看历史；文件树不变
- [ ] 在 Header 切仓库：仅 Git 内容变化，标签页与文件树保持
- [ ] Commit 详情 Drawer：无预览区；变更文件成树、可折叠；双击叶子仍在内容区渲染差异

**布局**
- [ ] 打开 Terminal/Git → 底部栏通栏；Project/Commit 侧栏在其上方；终端可正常输入与滚动
- [ ] 窄屏（≤560）上下排布：底部栏表现正常，终端面板定位无异常

**内容区**
- [ ] 外部修改 → 弹窗居中于文档区；窄屏文案不换行；两个操作均可用
- [ ] 320px 宽：面包屑单行不折行，文件名可见，hover 显示完整路径

---

## 11. 风险与回归清单

| # | 风险 | 关联条目 | 处置 |
|---|---|---|---|
| 1 | 箭头点击冒泡到行 `onClick`，导致"选中+折叠"双动作 | TREE-01 | **必须** `stopPropagation` |
| 2 | `EditorArea.jsx:447` 硬编码 `Ctrl+Shift+F` 分支未改 → 旧快捷键仍生效 | TREE-04 | 7 处逐条核对，列入验收 |
| 3 | 宿主已占用 `Ctrl+Shift+R` | TREE-04 | M0 的 UP-04 前置核查；备选 `Ctrl+Alt+R` |
| 4 | `setSelectedPath` 的 `loadDir` 异步 → 滚动早于子树加载 | TREE-02 | 滚动触发条件改为"目标路径已出现在 rows 中" |
| 5 | 改 `flatten` 依赖漏字段 → 文件树不更新 | PERF-03 | 验证展开/折叠/筛选/状态色四种变化 |
| 6 | `React.memo` 被不稳定回调击穿 | PERF-04 | 回调一并 `useCallback` 化；用渲染计数验证 |
| 7 | 淘汰 store 时仍有会话挂载 → 丢失内存态 | PERF-05 | 淘汰条件基于"会话是否仍挂载"，非仅 LRU 时间 |
| 8 | 提交前补 Add 失败 → index 半截残留 | COMMIT-01 | Add 失败中断提交并回滚 UI |
| 9 | `isEntryChecked` 默认值依赖 `staged`，改动后勾选态失配 | COMMIT-01 | 复核 `unchecked → checked → staged` 优先级 |
| 10 | `buckets` 跨项目残留 → 换仓库后误判分组 | §3.2 | `#switchProject` 中一并重置 |
| 11 | 仓库切换后 workspace 相对 / repo 相对路径换算错位 | GIT-01 | 回归 Commit 分组 / 变更树 / 单文件差异 |
| 12 | `bottomNode` 上移后 `.iwb-term-pane{position:absolute}` 定位祖先改变 | LAYOUT-01 | 实机验证终端滚动与输入 |
| 13 | 底部栏通栏覆盖 `.iwb-stripe`（44px） | LAYOUT-01 | 底部栏内容区左侧留 44px 空白 |
| 14 | 遮罩下沉改动波及其它 `ConfirmModal` 场景 | EDITOR-01 | 新增 scoped 变体，**不改**现有根级居中 |
| 15 | 面包屑省略后路径信息丢失 | EDITOR-02 | `title` 保留完整绝对路径 |
| 16 | 面板迁移到 slice 订阅时漏读字段 → 渲染不同步 | PERF-02 | 逐面板迁移 + 逐面板交互回归 |

---

## 12. 交付物

| # | 交付物 | 位置 |
|---|---|---|
| 1 | 全部代码改动 | `dsh-ide-workbench/src/**` |
| 2 | 新增/更新测试 | `dsh-ide-workbench/tests/**` |
| 3 | 构建产物 | `dsh-ide-workbench/dist/client.js`（`npm run build`） |
| 4 | 本轮实施记录（里程碑、实测数值、上游待办状态） | `dsh-ide-workbench/docs/PRD-v4-实施进展.md` |
| 5 | 验收记录（自动化 + 实机清单勾选结果） | `dsh-ide-workbench/docs/VERIFICATION.md`（追加本轮段） |
| 6 | 上游反馈单（UP-01~05，含证据与建议改法） | 由 §1.4 表格整理，随本轮进展记录一并提交 |
| 7 | 原始需求（保持不改） | `1030优化需求.md` |

---

## 附录 A — 关键锚点速查

| 主题 | 锚点 |
|---|---|
| store 状态与通知 | `store.js:198`（subscribers）、`:206-209`（subscribe）、`:214-217`（set）、`:220-222`（patch） |
| store 生命周期 | `store.js:276-281`（init 缓存）、`:738-774`（持久化）、`:793-802`（deactivate） |
| store 按工作区分组 | `index.jsx:225-232`（懒创建）、`:515-521`（销毁）、`workspace-scope.js:56-77`（key 规则） |
| 订阅 hook | `hooks.js:4-5` |
| 文件树 | `ProjectPanel.jsx:209`（flatten memo）、`:236-245`（反向定位滚动）、`:247-249`（窗口化）、`:252`（selectedEntries）、`:383-388`（双击）、`:544-635`（行渲染）、`:591`（箭头）、`:655-687`（Header） |
| 展开/定位 | `store.js:985-995`（toggleDir）、`:1002-1019`（setSelectedPath）、`:1649-1655`（activateTab） |
| 提交面板 | `commit-model.js:23-34`（分组）、`:40-46`（isEntryChecked）、`:58-64`（headerState）、`:70-81`（groupByDirectory）、`CommitPanel.jsx:31/33`（字母与类）、`:39-47`（checkbox）、`:220`（非仓库提示）、`:261-272`（提交按钮） |
| 提交动作 | `store.js:2010-2036`（setCommitChecked，**:2026** 为改造点）、`:2157-2166`（stage）、`:2220-2270`（commit，**:2247** 为补 Add 点） |
| Git | `GitPanel.jsx:88-112`（diffFiles）、`:114-121`（InlinePatch，删）、`:123-169`（BranchPopover 范式）、`:171-279`（CommitDrawer，**:253-268** 平铺、**:269-274** 冗余预览）、`:451-528`（筛选栏）、`:547-553`（非仓库提示）、**:603-608**（Drawer 挂载点） |
| Git host | `host/git.js:113-121`（rev-parse）、`:230-276`（status，**:236-246** 子进程）、`:293-296`（git add）、`:348-363`（commit）、`:464-484`（commitDetail） |
| 布局 | `Workbench.jsx:128-149`（BottomTabs）、`:432-442`（根结构，**:437-440** 为改造点）、`layout.js:11/14`、`store.js:89`（stacked）、`:2550-2565`（setStacked）、`:2597-2623`（互斥） |
| 内容区 | `EditorArea.jsx:300`（segments）、`:308-314`（面包屑）、`:316-328`（冲突 chip）、`:419`（active tab）、`:447-452`（**硬编码快捷键**）、`styles.js:189/203-207/695-697/790-793/945/952-962` |
| 文件链接 | `file-address.js:29-54`（parseFileAddress）、`:70-72`（isAbsoluteFilePath）、`:116-124`（resolveFileAddress）、`:179-186`（fileAddressFor）、`store.js:364-400`（openExternalFile）、`:1183-1185`（#absoluteOf）、`index.jsx:56-99`（FileLinkBridge）、`index.js:155-164`（fs.stat 路由）、`host/workspace.js:50-59`（resolveInside 围栏）、`workspace-scope.js:43-48`（isPathWithin） |
| 快捷键 | `index.jsx:422-513`（注册，**:432-433** fallback、**:511** listener）、`host/settings-store.js:98-123`（默认表，**:107**）、`util.js:39-42`（匹配） |
| i18n | `i18n.js:9-445`（en）、`:447-883`（zh） |

## 附录 B — 术语对照

| 术语 | 含义 | 锚点 |
|---|---|---|
| twisty | 文件树的展开/折叠箭头 | `ProjectPanel.jsx:591` |
| buckets | 把路径钉在「未版本控制」组的映射 | `store.js:2025`、`commit-model.js:29` |
| stacked | 上下排布（≤560px） | `store.js:89`、`layout.js:11` |
| bottom dock | 底部栏（Terminal/Git 组） | `Workbench.jsx:128-149` |
| `iwb-*` | 本插件自绘的 CSS 类前缀 | `styles.js` |
