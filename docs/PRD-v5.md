# PRD v5 — 代码智能：语义补全、Usage 与跳转定义

> **状态**：待实施。规格已拍板（Q1–Q4 见 §0.4），**无需再向用户确认任何条目**。
> **输入**：本次口头需求（两条能力 + 索引决策流程 + 性能缓解要求）。
> **配套**：`docs/代码智能-可行性评估.md`（技术选型与开源可复用清单）、`docs/代码智能-性能开销评估.md`（实测性能基线）、`docs/VERIFICATION.md`（累计验收记录）、`docs/PRD-v5-实施进展.md`（本轮进展记录，本轮新建）、`docs/M0-api-findings.md`（DSH API 契约）。
> **代码基线（必须按提交号对齐，不要按版本号）**：`dsh-ide-workbench` **commit `dd6dc175f8cf1b6a891cc37f81ac21a3d81839a4`**（分支 `main`，提交标题 `perf(tree): keep the status aggregate's identity while the status is unchanged`，2026-10-31 13:09）。测试基线 **329 项（329 全通过，0 失败）**，客户端产物 `dist/client.js` **2,413 KB**。
>
> ⚠️ **不要用 `v0.4.1` 这个 tag 作为基线。** `package.json` 的 `"version"` 在 **tag `v0.4.1`（commit `7895712`，2026-10-30）与本基线 commit 上都是 `"0.4.1"`**，因此**版本号无法区分两棵树**；而 HEAD 实际比 tag **领先 7 个提交**，其中 6 个提交改动了本文档引用的文件。按 tag 实施会让多个锚点错位，最严重的两处：
> - `styles.js` 的 `.iwb-project-repo-badge` / `.iwb-project-current-badge` 在 tag 上是 **`:773` / `:774`**，而本文档写的是 **`:799` / `:800`**（差 26 行；按 `:799` 打开会落到无关的 `.iwb-find-count` 规则上）。
> - `package.json` 的 `bundleDependencies` 与 `publish.yml` 的「Pack the offline bundle」离线打包步骤**在 tag 上根本不存在**（是 `63cdc9d feat(release): publish a GitHub Release with an offline installable bundle` 才引入的）—— §6.3 关于"离线 tarball 体积"与"离线用户拿不到打包语言服务器"的分析**只在基线 commit 上成立**。
>
> 完整锚点漂移见 §附录 D。**开工第一步就是 `git checkout dd6dc175f8cf1b6a891cc37f81ac21a3d81839a4`（或确认 `git rev-parse HEAD` 等于该 SHA）**；若工作区已领先该 SHA 且改动过本文档引用的文件，以 §附录 D 的"基线 commit"列为准重新核对锚点。
>
> **基线测试状态（已复核，全绿）**：`npm test` 于基线 commit 实测 **329 项 / 329 通过 / 0 失败**。此前 PRD-v4 收尾阶段遗留的 `tests/perf-cold-workspace.test.mjs:123` 失败（期望 1 实得 2）**已由基线 commit `dd6dc17`（`perf(tree): keep the status aggregate's identity while the status is unchanged`）自身修复**，本轮无需再处置；但开工前仍须复跑一次确认——若工作区继续领先该 SHA 并改动了状态聚合逻辑，可能引入新的失败（见 M0-6）。
> **本文档定位**：这是**实施规格**，不是问题清单。每一项都含：结论 → 代码锚点（`file:line`）→ 改法 → 验收口径 → 风险。
> 开发时请**按 §8 里程碑顺序**推进，每完成一个里程碑即跑一次 `npm test` + `npm run build`。

---

## 0. 一页速览

### 0.1 本轮范围

| ID | 条目 | 模块 | 优先级 | 核心锚点 | 一句话验收 |
|---|---|---|---|---|---|
| ARCH-01~05 | 三层架构、进程/线程模型、传输、语言服务器供给 | host / client | **P0** | `src/index.js:41`、`src/host/git.js:65` | 宿主以 worker_thread 运行 LSP 客户端；浏览器只渲染不解析 |
| IDX-01 | 项目候选携带索引状态 + 【已索引】标签 | host/workspace / store / Workbench | **P0** | `host/workspace.js:75`、`Workbench.jsx:367-369` | 项目选择器里，已索引目录带独立徽标 |
| IDX-02 | 索引前内存预检 | host/lsp | **P0** | 新增 `host/lsp.js` | 内存不足时不启动语言服务器，直接降级 |
| IDX-03 | 索引决策弹窗（根目录额外警告） | store / Workbench | **P0** | `store.js:908` | 未索引目录首次打开时询问；根目录额外警示 |
| IDX-04 | 手动取消索引（原子操作） | host/lsp / client | **P0** | 新增 `host/lsp.js` | 取消后无残留进程、无中间态、无半开文件 |
| IDX-05 | 空闲自动退出 | host/lsp | **P0** | 新增 `host/lsp.js` | 无活动 N 分钟后进程退出，内存归零 |
| IDX-06 | 崩溃自动恢复 + 明确提示 | host/lsp / client | **P0** | 新增 `host/lsp.js` | 服务器崩溃后自动重启一次，仍失败则降级并提示 |
| LSP-01 | 宿主语言服务器管理器 | host/lsp | **P0** | 新增 `host/lsp.js` | 能拉起并驱动一个语言服务器；argv 数组，绝不 shell |
| LSP-02 | 语言注册表（打包 TS/JS+Python；探测 Java/Go/Rust/C++） | host/lsp | **P0** | `package.json:73-75` | TS/JS、Python 零配置；其余 PATH 探测 |
| LSP-03 | 未保存草稿的文档同步 | client/lsp-workspace | **P0** | `store.js:2109`（updateDraft） | LSP 看到的是 `tab.draft` 而非磁盘内容 |
| LSP-04 | 位置漂移映射 | client/lsp-workspace | **P0** | `@codemirror/lsp-client` `withMapping` | 请求期间继续打字，引用跳转仍落对行 |
| COMP-01 | L0 内置补全（零新依赖兜底） | CodeEditor | **P1** | `CodeEditor.jsx:186` | 所有语言有补全弹窗；JS/Python/HTML/CSS/SQL/Go/XML/MD 有语言数据 |
| COMP-02 | LSP 语义补全 | client/lsp-workspace | **P1** | `@codemirror/lsp-client` `serverCompletion` | 补全带类型信息与签名 |
| COMP-03 | 补全/索引状态提示 | Workbench 状态栏 | **P1** | `Workbench.jsx:269-273` | 状态栏显示 未启用/启动中/索引中/就绪/降级 |
| NAV-01 | Ctrl+点击 / F12 跳转定义 | CodeEditor | **P0** | `CodeEditor.jsx:186-222` | 跨文件跳转并定位到行 |
| NAV-02 | Find Usages 语义版（Alt+F7） | CodeEditor | **P0** | `settings-store.js:96-120` | 引用面板列出语义引用，可点击跳转 |
| NAV-03 | Find Usages 文本版（保留并标注「文本匹配」） | store / SearchView | **P1** | `store.js:1510`（`fs.search`） | 语义不可用时降级为文本版且有明确标注 |
| NAV-04 | 悬停提示与签名帮助 | client/lsp-workspace | **P2** | `@codemirror/lsp-client` `hoverTooltips` | 悬停显示符号文档 |
| SET-01 | 设置项与 schema 升版 | host/settings-store | **P1** | `settings-store.js:14`（SETTINGS_VERSION=2） | 新增 `lsp` 段；schema 升到 3；旧文档自动迁移 |
| I18N-01 | 新增文案 en + zh-CN | client/i18n | **P1** | `i18n.js:9-448`（en）、`:450-889`（zh） | 新 key 在两种语言下均有值 |

### 0.2 六处事实纠正（务必先读，否则会做错方向）

原始需求里有六处描述与代码/协议实际不符。**按原始描述实现会做错方向**，特此纠正：

1. **不存在"代码索引"这个可构建、可持久化的产物。**
   LSP 的"索引"是**语言服务器进程内部的 program / 类型缓存**，没有独立的索引文件可以"构建""落盘""异步增量更新"。实现上"构建索引" ≡ **启动语言服务器并等待它完成首次 program 构建**；"增量更新"由**语言服务器自己的文件监听**完成。
   → 因此本轮**不实现索引器、不实现文件监听器、不落任何索引文件**。按字面实现"构建代码索引 + 异步自动更新索引"会重复造一个 tsserver 已经做好的东西，并且引入一致性风险。§2 的全部"索引"语义都按此理解。

2. **查找引用面板不用自己写。**
   `@codemirror/lsp-client@6.3.0` 已导出 `findReferences`、`closeReferencePanel`、`findReferencesKeymap`，并自带面板渲染。→ NAV-02 只做**接入 + 主题化 + 跨文件跳转适配**，不重建引用视图。

3. **`@codemirror/lsp-client` 的请求默认超时只有 3000 ms。**
   源码 `node_modules/@codemirror/lsp-client/dist/index.js:547`：`this.timeout = (config.timeout) ?? 3000`。
   实测大型 TS 项目首个语义请求**超过 10 分钟**才可能返回 → 默认值下会**静默超时**，用户看到"点了没反应"。
   → **必须**在 `LSPClient` 配置里显式传 `timeout`（§3.3）。

4. **`typescript@7.x` 是 Go 原生编译器，tsserver 语义能力在 5.x 最稳。**
   镜像里 `typescript` 最新为 7.0.2 / 7.1.0-beta。→ 打包依赖**必须钉 `typescript@~5.9.3`**，不得写 `^7`、不得写 `latest`。

5. **语言服务器必须用 `ctx.subprocess.spawn`，不得用裸 `node:child_process.spawn`。**
   DSH 的 `subprocess` service 提供 `scrubbedParentEnv()` 与 `SENSITIVE_ENV_PATTERN`，专门用于**阻止宿主环境变量（如 `DEEPSEEK_API_KEY`）泄漏进子进程**。裸 `node:child_process.spawn` 会把整个父进程环境继承给第三方语言服务器。
   同时 `ctx.subprocess.spawn` 的 `argv` **从不交给 shell 解释**，与插件现有 git 做法（`host/git.js:65`）一致。→ 见 §3.2。

6. **LSP 自带的重命名快捷键与本插件现有快捷键冲突。**
   `@codemirror/lsp-client` 的 `renameKeymap` 绑定 **F2**，而本插件 `settings-store.js:110` 的 `rename` 已是 **F2 = 重命名文件**（IDEA 语义）；`renameRefs`（**Shift+F6**，`settings-store.js:111`）也已被 PRD-v2 13.1 #3 占用为"引用更新"。
   → **本轮不启用 LSP 重命名与 LSP 格式化**（`renameKeymap` / `formatKeymap` 均不引入），列入非目标（§0.3）。

> 附带的两个小事实：
> - **CodeMirror 6 没有内置 Ctrl+点击跳转**。`jumpToDefinition` 只是一个 `Command`，Ctrl+点击必须自己在 `EditorView.domEventHandlers` 里实现（§5.1）。
> - **`@codemirror/autocomplete@6.20.4` 已在 `node_modules` 里**（传递依赖），但 `CodeEditor.jsx:186-222` 的扩展列表**没有启用**它。L0 补全因此是**零新依赖**改动。

### 0.3 非目标（本轮明确不做）

- **不做 LSP 重命名 / 格式化**（与现有 `F2`、`Shift+F6` 冲突，见 §0.2 #6）。
- **不做代码图 / 符号索引**（Q3 决策：不引入 `@colbymchenry/codegraph` 的 265 MB 平台包）。跨文件能力完全依赖 LSP。
- **不做自研 LSP 客户端**。浏览器端只用官方 `@codemirror/lsp-client`。
- **不做自研索引器 / 文件监听器**（见 §0.2 #1）。
- **不做自研补全引擎**。L0 只用 CodeMirror 自带 `autocompletion()` + 各语言包的 `autocomplete` 数据。
- **不做 AI 内联补全（FIM）**。DSH 虽是 AI harness，但 AI 补全需要模型接入与 token 预算，与本轮的"语义补全"是两个产品，列 V6 候选。
- **不做 Java / Go / Rust / C++ 的零配置打包**（Q2 决策：仅 TS/JS + Python 打包，其余 PATH 探测 + 安装引导）。
- **不做 `Ctrl+Shift+F` 全局查找的改动**（PRD-v4 TREE-04 已定，全局查找仍为 `Ctrl+Shift+R`）。
- **不改 DSH 宿主源码**。只使用已公开的 `ctx.subprocess` / `ctx.webServer` / `ctx.connection` / `ctx.workspaceRegistry`（`docs/M0-api-findings.md:13,25-28`）。

### 0.4 决策回填表（已拍板，开发时按此执行）

| # | 决策项 | 结论 | 依据 |
|---|---|---|---|
| 1 | 技术路线 | ✅ **全量 LSP** | 唯一能同时覆盖语义补全 + 跳转定义 + 查找引用的路线；浏览器端复用官方库 |
| 2 | 语言服务器供给 | ✅ **混合**：TS/JS + Python 打包，其余 PATH 探测 | Web 开发者零配置；其余语言用户通常已装对应工具链 |
| 3 | 是否引入代码图 | ✅ **不引入**，只用 LSP + 文本兜底 | 265 MB 平台包对编辑器插件过重；其能力（符号级跳转）已被 LSP 覆盖 |
| 4 | PRD-v2 决策 #6（Find Usages） | ✅ **保留文本版并新增语义版菜单项**；语义不可用时降级到文本版 | 兼容既有决策，不推翻；菜单与 `Alt+F7` 键位不变 |

---

## 1. ARCH — 总体架构

### 1.1 三层职责

```
┌─ 浏览器（DSH Client 渲染进程）─────────────────────────────┐
│  CodeEditor.jsx                                           │
│    ├── L0 内置补全（@codemirror/autocomplete）              │
│    └── LSP 扩展（@codemirror/lsp-client）                  │
│         ├── serverCompletion / hoverTooltips               │
│         ├── jumpToDefinition / findReferences（面板）       │
│         └── 自定义 Workspace：把工作台标签页映射为 LSP 文档  │
│  Transport（WebSocket，字符串 JSON 透传，不解析）             │
└──────────────────────┬───────────────────────────────────┘
                       │ ws://…/ide-workbench/ws/lsp
┌──────────────────────┴───────────────────────────────────┐
│  DSH Host（Node 进程）                                     │
│  ├── 主线程：HTTP API、终端 WS、git 轮询 —— **只转发字节**   │
│  └── worker_thread：LSP 客户端                              │
│        ├── 进程管理（ctx.subprocess.spawn）                 │
│        ├── JSON-RPC 编解码                                 │
│        └── 状态机（starting/building/ready/cancelling/…）   │
└──────────────────────┬───────────────────────────────────┘
                       │ stdio（Content-Length 帧）
              ┌────────┴────────┐
        tsserver            basedpyright          （jdt.ls / gopls / … 按需）
```

### 1.2 进程与线程模型

| 组件 | 位置 | 生命周期 | 内存归属 |
|---|---|---|---|
| LSP 客户端 | Host 的 **worker_thread** | 随 Host 存活 | 宿主进程内存（几 MB） |
| 语言服务器 | Host 的**子进程**（孙进程于宿主视角） | 按需启停（§2.5 / §2.6） | **独立进程**，不占宿主 |
| 浏览器渲染 | DSH Client 渲染进程 | 随 Client | 浏览器进程 |

**硬性要求**：语言服务器进程**必须**与宿主主线程隔离，且宿主主线程**不得**对其 stdout 做 JSON 解析。理由见 §11.1 的实测（412 ms → 8 ms）。

### 1.3 传输

- 新增 WS 路径 **`/ide-workbench/ws/lsp`**，与现有终端 WS（`src/index.js:44` `WS_PATH = '/ide-workbench/ws/terminal'`）**分离**，互不干扰。
- 沿用 `ctx.connection.requestRejection(req)` 围栏校验（与 `src/index.js:62` `fence` 一致）。
- 帧格式：LSP 原始 JSON 字符串，**不封装**（`@codemirror/lsp-client` 的 `Transport` 接口要求 `send(message: string)` / `subscribe(handler)` / `unsubscribe(handler)`，消息内只有 JSON，无 LSP 头）。
- 宿主 → 浏览器方向：**只转发字节**，不在主线程 parse。

### 1.4 语言服务器供给策略（Q2 决策）

| 语言 | 供应方式 | 命令 | 版本约束 |
|---|---|---|---|
| TypeScript / JavaScript | **npm 依赖（打包）** | `typescript-language-server --stdio` | `typescript-language-server@6.0.2` + **`typescript@~5.9.3`**（见 §0.2 #4） |
| Python | **npm 依赖（打包）** | `basedpyright-langserver --stdio` | `basedpyright@1.40.2`（自带 `basedpyright-langserver` bin） |
| YAML | npm 依赖（打包，低优先） | `yaml-language-server --stdio` | `yaml-language-server@2.0.0` |
| Java | **PATH 探测** | `jdtls` | 需 JDK 21+；安装引导文案见 §7 |
| Go | **PATH 探测** | `gopls` | 需 Go 工具链 |
| Rust | **PATH 探测** | `rust-analyzer` | 需 rustup component |
| C / C++ | **PATH 探测** | `clangd` | 需 LLVM |

- **打包**= 写进 `package.json` 的 `dependencies`（npm 安装路径会带上）；**离线 tarball**（`npm pack`，`publish.yml:40-44`）只包含 `bundleDependencies`（当前仅 `ws`），因此打包的语言服务器**不进离线包** —— 见 §6.3 的体积决策。
- **探测**= 在 PATH 上查找可执行文件；找不到时该语言**整体降级**（§2.3 的"仅保守版"），并在设置页给出安装引导链接。

---

## 2. IDX — 索引生命周期

> 全部"索引"语义按 §0.2 #1 理解：**索引 = 语言服务器进程内的 program 构建**。本节管的是它的**决策、启动、取消、增量、退出、恢复**。

### 2.1 IDX-01 项目候选携带索引状态 + 【已索引】标签

**目标**：用户在"选择 IDE 项目"时能一眼看出哪些目录已经索引过。

**代码锚点**

| 位置 | 现状 | 改法 |
|---|---|---|
| `src/host/workspace.js:75-103` `listProjectCandidates` | 返回 `{ path, name, isRepo, isRoot }` | 每个 candidate 增加 `indexState: 'indexed' \| 'ready' \| 'building' \| 'unknown' \| 'failed'` 与 `indexedAt: number \| null` |
| `src/client/store.js:810-838` `loadProjects` | 过滤并映射 candidate | 一并映射 `indexState` / `indexedAt`；保留 `isRepo` / `isRoot` 语义 |
| `src/client/Workbench.jsx:351-373` `choice` | `isRepo` 时渲染 `iwb-project-repo-badge`（`t('project.gitRepo')`，**styles.js:799**） | `indexState === 'indexed'` 时**额外**渲染一个 `iwb-project-index-badge`（`t('project.indexed')`），与【Git】徽标并列 |
| `src/client/styles.js:799-800` | 两个徽标样式 | 新增 `.iwb-project-index-badge`，视觉与 `.iwb-project-repo-badge` 同族但配色区分 |

**标签语义（必须准确，不得夸大）**：
- 【已索引】= **本 profile 历史中，该目录曾成功完成过首次 program 构建**。
- 它**不代表**磁盘上存在任何持久化索引文件；语言服务器被空闲退出后，再次打开需要**重新构建**（只是因为文件已在 OS 页缓存中，通常更快）。
- 徽标 tooltip 必须写明这一点（`t('project.indexedHint')`）。

**状态来源**：由宿主侧维护，按**项目绝对路径**为键，落在 profile 设置文件里（新增 `settings.lsp.indexedRoots: { [absolutePath]: { at: number, languageId: string } }`，schema v3）。

**验收**
- 项目选择器里，已索引目录同时显示【Git】与【已索引】两个徽标；非索引目录不显示【已索引】。
- 徽标顺序固定为【Git】→【已索引】→【当前】（【当前】由既有 `iwb-project-current-badge` 渲染，位于 `Workbench.jsx:370-372`，三者并存时不得互相覆盖或换行）。
- 工作区根目录分组（`Workbench.jsx:384`）内的条目同样可以带【已索引】徽标。
- 重启 DSH 后徽标仍在（状态来自设置文件，非内存）。
- 徽标 tooltip 明确说明"重新打开会更快，但并非零成本"。

### 2.2 IDX-02 索引前内存预检

**目标**：机器内存已严重不足时，**不启动**语言服务器，避免把用户机器拖进换页。

**规则**

```
freeBytes  = os.freemem()          // 宿主进程可见的系统可用内存
needBytes  = lsp.memoryLimitMB * 1024 * 1024
canIndex   = freeBytes >= max(needBytes, lsp.freeMemoryThresholdMB * 1024 * 1024)
```

- `lsp.memoryLimitMB` 默认 **2048**；`lsp.freeMemoryThresholdMB` 默认 **2048**。
- 判定为不可索引时：**不启动语言服务器**，直接把该目录标记为 `indexState: 'failed'`，并按 §2.3 的"仅保守版"路径继续（**不弹窗问用户**——用户此时无论选什么都跑不动，直接降级并给出一次性提示更诚实）。
- 预检必须在**每次启动语言服务器之前**执行，不只在校验设置时。

**宿主 API**

| 方法 | 入参 | 返回 |
|---|---|---|
| `lsp.resources` | `{ root? }` | `{ totalBytes, freeBytes, thresholdBytes, memoryLimitBytes, canIndex }` |

**验收**
- 内存低于阈值时，`lsp.resources.canIndex === false`，且**没有**任何语言服务器进程被创建。
- 预检失败时的提示文案明确说明"系统可用内存不足（需要 X MB，可用 Y MB）"，并给出可操作建议（关闭其它程序 / 在设置里调低内存上限）。

### 2.3 IDX-03 索引决策弹窗

**目标**：用户打开一个未索引的目录时，由他决定是否付出索引成本。

**触发点**：`store.js:908` `selectProject(projectRoot)` → 切换成功之后、用户实际打开文件之前。

**决策矩阵**

| 目录类型 | 已索引？ | 行为 |
|---|---|---|
| 一级子目录 | 是 | 直接打开 + 自动启动语言服务器（增量更新由服务器负责），**不询问** |
| 一级子目录 | 否 | **弹窗询问**：<br>「为 **{name}** 构建代码索引？」<br>说明：首次构建可能需要 1–2 分钟，期间可以随时取消；不构建则只提供保守版（基础补全 + 文本查找引用）。<br>按钮：**构建索引** / **仅保守版** |
| 工作区根目录 | 是 | 直接打开 + 自动启动，**不询问** |
| 工作区根目录 | 否 | **弹窗询问 + 额外风险提示**（见下） |

**根目录额外提示（必须）**

根目录常常**只是工作区容器**，本身不是代码仓库；其下可能包含十几个独立仓库。在根目录构建索引会让语言服务器把**所有子仓库**当成一个 program，索引成本与内存占用**远超**单个子目录仓库。

> 需求原话：「若选择了根目录作为 Project 且尚未索引，还需额外提示 不建议在根目录构建索引除非确认该工作区为独立代码仓库」

**弹窗文案要点**（en / zh 必须都有）：
1. 明确指出「工作区根目录通常包含多个独立仓库」。
2. 明确指出「在根目录索引会显著增加内存占用与构建时间」。
3. 给出**推荐动作**：先切到具体子目录再索引。
4. 按钮：**在此目录索引（不推荐）** / **仅保守版** / **取消**（取消 = 不切换项目）。

**判定"根目录是否本身就是独立仓库"**：复用 `listProjectCandidates` 已有的 `isRepo` 判定（`host/workspace.js:80` 检查 `.git` 存在）。
- `isRepo === true` → 提示文案降级为普通提示（它确实是独立仓库），仍保留"可能很大"的提醒。
- `isRepo === false` → **完整版警告**（上文 1–4 条全上）。

**验收**
- 未索引子目录：弹窗出现，两个按钮均可用；选"仅保守版"后项目正常切换且功能降级正确。
- 未索引根目录（`isRepo === false`）：弹窗**额外**包含完整警告与"取消"按钮；点"取消"不切换项目。
- 已索引目录：不再询问，直接启动。
- 弹窗是**模态**，Esc 等价于"取消"（不切换项目）。

### 2.4 IDX-04 手动取消索引（原子操作）

**目标**：首次索引可能超过 1 分钟，用户必须能随时中止，且中止后**不留任何残留**。

**触发条件**：索引状态进入 `building` 后超过 `lsp.cancelAfterMs`（默认 **60,000 ms**）→ 状态栏出现【取消索引】按钮。

**原子性要求（硬性）**

| 要求 | 判定 |
|---|---|
| 取消后无残留语言服务器进程 | 取消返回时，进程树中不得再有该语言服务器（及其孙进程） |
| 无中间态 | 客户端只会看到 `cancelling` → `cancelled` 两个终态，不会看到 `building` 卡死态 |
| 无半开文档 | 取消前已 `didOpen` 的文档必须 `didClose`（或随进程一起消失），不得残留 |
| 不影响已打开的编辑器 | 用户已打开的标签页、选区、滚动位置**不得**因取消而改变 |
| 取消后立即降级 | 取消完成后 L0 补全与文本版查找引用立即可用 |
| 幂等 | 重复点击取消不报错、不重复 kill |

**实现约束**

- 取消**必须**走宿主侧的单一原子操作：宿主在一个临界区内完成「标记 `cancelling` → 终止进程 → 标记 `cancelled` → 关闭已开文档 → 通知客户端」。
- 客户端**不得**在取消过程中自行置状态（避免两端状态打架）。
- 终止使用 `ctx.subprocess` 的终止语义（带 grace period），**不得**用 `taskkill /IM`（会误杀同名的其它实例）。

**宿主 API**

| 方法 | 入参 | 返回 |
|---|---|---|
| `lsp.cancelIndex` | `{ root }` | `{ state: 'cancelled' }`（幂等；已取消时返回同值，不报错） |

**验收**
- 索引 60 s 后状态栏出现【取消索引】；点击后 ≤ 2 s 内状态变为"已取消（保守版）"。
- 取消后进程监视器中无语言服务器进程。
- 取消后编辑器的标签页、草稿内容、光标位置完全不变。
- 连续点击 3 次取消不报错。

### 2.5 IDX-05 增量更新（不阻塞主路径）

**目标**：文件变化后语义能力自动跟上，且**不阻塞**用户操作。

**实现约束（关键）**

- **插件不实现文件监听**。语言服务器自带监听（tsserver 的 `watchDirectory` / pyright 的 `useWatchFile`），文件变化后由服务器自行增量更新。
- 插件**不得**在文件保存后主动"重建索引"或"重新请求全量符号"。
- 插件**不得**因为索引更新而阻塞任何 UI 操作；索引状态只体现在状态栏。
- 插件**不得**自行 spawn 额外的文件监控进程（否则与语言服务器重复监听，白白吃 CPU 与句柄）。

**可观测口径**：状态栏在 `building` 期间显示进度提示（文案：`正在更新索引…`），更新完成后回到 `ready`。**不得**用模态或遮罩阻断编辑。

**验收**
- 保存文件后 5 s 内，语言服务器能反映新符号（可用补全/查找引用验证）。
- 索引更新期间编辑器可继续输入、可滚动、可切换标签，无卡顿（帧率不掉、输入不延迟）。
- 进程监视器中，插件**没有**新增任何文件监控进程（只有语言服务器自己的）。

### 2.6 IDX-06 空闲自动退出

**目标**：用户不用代码时，内存归零。

**规则**

- 无任何 LSP 活动（无请求、无文档同步、无窗口聚焦）持续 `lsp.idleTimeoutMs`（默认 **600,000 ms = 10 分钟**）→ 关闭语言服务器进程。
- 退出前必须先 `didClose` 全部已开文档，并**清理** `indexedRoots` 之外的运行时状态。
- 退出**不**清除 `settings.lsp.indexedRoots`（§2.1 的徽标仍在，因为"索引过"这个事实仍然成立）。
- 用户再次打开文件 → 按 §2.2 重新做内存预检 → 通过则重启语言服务器。

**验收**
- 空闲 10 分钟后，语言服务器进程消失，内存回落。
- 再次打开文件，语言服务器重新启动且功能恢复（耗时应在数秒内，因文件已在 OS 页缓存）。
- 空闲退出**不**触发任何错误提示或状态栏红字。

### 2.7 IDX-07 崩溃自动恢复 + 明确提示

**目标**：语言服务器崩溃（OOM、segfault、用户手动杀）不能变成"功能静默消失"。

**检测（满足任一即判定崩溃）**

| 信号 | 说明 |
|---|---|
| 进程 `exit` 事件 | 退出码非 0（**实测 OOM 为 exit 134 / SIGABRT**） |
| stdout EOF | 进程还活着但管道关闭 |
| 请求超时 | 连续 N 次请求超时（默认 3 次）且进程已无响应 |

**恢复流程**

```
崩溃 → 标记 crashed → 清理该 server 的所有文档与状态
     → 自动重启 1 次（带 2 s 退避）
     → 重启成功 → 重新 didOpen 当前打开的文档 → 状态回 ready
     → 重启后再次崩溃 → 停止自动重启，状态置为 degraded，状态栏红字 + toast 提示
```

**提示文案要求**

- 崩溃时**必须**有可见提示（状态栏 + 一次 toast），且文案包含：**发生了什么**（语言服务器已退出）、**为什么可能**（内存不足是常见原因）、**用户能做什么**（降低内存上限 / 关闭该语言 / 改用保守版）。
- **不得**只在控制台打日志。

**与 §2.2 的联动**：崩溃后自动重启**前**必须再跑一次内存预检；若内存已不足（很可能是 OOM 的后果），**不重启**，直接降级并提示。

**验收**
- 手动 kill 语言服务器进程 → 状态栏变红 + toast 提示 + 自动重启一次 → 功能恢复。
- 连续崩溃两次 → 停止重启，进入降级态，提示文案包含"降低内存上限"建议。
- 崩溃与恢复期间，用户正在编辑的草稿**不丢失**（LSP 崩溃不得影响编辑器本身）。

---

## 3. LSP — 宿主侧语言服务器管理器

### 3.1 LSP-01 进程管理

**新建 `src/host/lsp.js`**，导出：

| 导出 | 用途 |
|---|---|
| `LSP_REGISTRY` | 语言注册表（§3.2） |
| `class LspManager` | 语言服务器生命周期与状态机 |
| `lspStateOf(root)` | 当前状态快照（供 API 层读） |
| `shutdownAll()` | 宿主卸载时清理全部进程 |

**状态机（单一真相源在宿主侧）**

```
idle → starting → building → ready
              ↘        ↘         ↘
              failed   cancelled  crashed → (restarting) → ready | degraded
```

客户端**不得**自行推导状态，必须通过 `lsp.index` 读取宿主状态。

**宿主 API**

| 方法 | 入参 | 返回 |
|---|---|---|
| `lsp.status` | `{ root? }` | `{ enabled, state, languageId, serverId, source: 'bundled'\|'path'\|null, detail: string\|null, indexedRoots: [...] }` |
| `lsp.index` | `{ root }` | `{ state, progress?: string, startedAt?: number, cancellable: boolean }` |
| `lsp.start` | `{ root, languageId? }` | `{ state }`（幂等：已在 running 时返回当前状态，不重复 spawn） |
| `lsp.cancelIndex` | `{ root }` | `{ state: 'cancelled' }` |
| `lsp.servers` | `{}` | `{ available: [{languageId, command, source}], missing: [{languageId, command, hint}] }` |
| `lsp.resources` | `{}` | `{ totalBytes, freeBytes, thresholdBytes, memoryLimitBytes, canIndex }` |
| `lsp.shutdown` | `{ root? }` | `{ ok: true }` |

> 全部走既有围栏与 `{ok:true,value}` / `{ok:false,error:{code,message}}` 约定（`src/host/wire.js:55-88`）。

### 3.2 LSP-02 语言注册表与内存上限

```js
// src/host/lsp.js
export const LSP_REGISTRY = {
  typescript: { command: 'typescript-language-server', args: ['--stdio'], languageIds: ['typescript', 'javascript', 'javascriptreact', 'typescriptreact'], memoryLimitMB: 2048 },
  javascript: { /* 同上，alias */ },
  python:     { command: 'basedpyright-langserver', args: ['--stdio'], languageIds: ['python'], memoryLimitMB: 1536 },
  yaml:       { command: 'yaml-language-server', args: ['--stdio'], languageIds: ['yaml'], memoryLimitMB: 512 },
  java:       { command: 'jdtls', args: [], languageIds: ['java'], memoryLimitMB: 2048, requires: 'JDK 21+' },
  go:         { command: 'gopls', args: [], languageIds: ['go'], memoryLimitMB: 1536, requires: 'Go toolchain' },
  rust:       { command: 'rust-analyzer', args: [], languageIds: ['rust'], memoryLimitMB: 2048, requires: 'rustup component' },
  cpp:        { command: 'clangd', args: [], languageIds: ['c', 'cpp'], memoryLimitMB: 2048, requires: 'LLVM' },
}
```

**关键约束**

1. **`argv` 永远是数组**，命令名与参数分离；**绝不**拼接 shell 字符串。
2. **必须**用 `ctx.subprocess.spawn({ argv, cwd, stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' } })`（§0.2 #5）。
3. `cwd` = 项目根（语言服务器以此为 workspace root）。
4. **内存上限必须显式传给服务器**：
   - tsserver：`initializationOptions.maxTsServerMemory = memoryLimitMB`（源码 `typescript-language-server/lib/cli.mjs:20185-20186` 会转成 `--max-old-space-size`）。
   - 其余服务器按其各自机制设置；**不支持的**（如 jdt.ls）改用 `ctx.subprocess` 的进程级限制，并在设置页注明"该语言服务器不支持内存上限"。
   - **不设上限的后果已被实测**：tsserver 会一路涨到 **4,225 MB** 后 OOM 崩溃（exit 134），把整机拖进换页。
5. `stderr` **必须**单独收集（stdout 是 LSP 帧通道，绝不能混入日志），写入插件日志面并保留最近 N 行供设置页查看。
6. **Windows**：以**低于正常优先级**启动子进程，避免索引期抢占 DSH agent 的 CPU。

### 3.3 LSP-03 worker_thread 隔离与超时

**要求**

- LSP 客户端（进程管理 + JSON-RPC + 状态机）**整体运行在宿主的一个 `worker_thread`** 里；宿主主线程只做字节转发。
- **理由（实测）**：主线程解析 18 MB 载荷时事件循环漂移 **412 ms**；改为 worker 内解析后漂移 **8 ms**。
- **DSH 已有先例**：`@deepseek-ai/dsh-workflow-worker-thread`、`@deepseek-ai/dsh-code-runtime-worker-thread`。本插件是独立 npm 包，**不得**依赖 DSH 内部包，用 Node 内置 `node:worker_threads` 即可。

**客户端配置（硬性）**

```js
new LSPClient({
  rootUri: fileUriOf(projectRoot),
  timeout: settings.lsp.requestTimeoutMs,   // 默认 30000 —— 必须覆盖库默认的 3000
  sanitizeHTML: html => stripHtml(html),    // 必须提供（XSS 通道，见 §7.3）
  extensions: languageServerExtensions(),
})
```

- `sanitizeHTML` **必须**提供：LSP 服务器返回的 Markdown 可含任意 HTML，直接渲染进页面是 XSS 通道。最低要求：剥离 `<script>` / `<iframe>` / `on*` 属性 / `javascript:` URL。
- `highlightLanguage` 可选：按语言标签返回 CodeMirror `Language`，让悬停里的代码块能高亮。

**宿主侧超时与超时值的传导**：宿主自己的 JSON-RPC 客户端也必须有超时，默认同样取 `settings.lsp.requestTimeoutMs`。

### 3.4 LSP-04 未保存草稿的文档同步

**这是正确性的核心**：工作台编辑器内容是 `tab.draft`（未保存），磁盘内容是 `tab.payload.content`（`EditorArea.jsx:128-133`）。LSP 必须看到草稿。

**必须实现 `@codemirror/lsp-client` 的自定义 `Workspace`**（该类是 `abstract`，默认实现只看已打开且有视图的文件）：

| 抽象方法 | 本插件的实现 |
|---|---|
| `openFile(uri, languageId, view)` | 通知宿主：打开该 URI（宿主据此 `didOpen`，内容取当前编辑器缓冲） |
| `syncFiles()` | 对每个已打开文件，比对"上次同步内容"与"当前内容"，返回 `WorkspaceFileUpdate[]`；**变更走增量**（`ChangeSet`） |
| `displayFile(uri)` | 跨文件跳转：解析 URI → 绝对路径 → `store.openFile(absolute, { line, preview: false })`（`store.js:1877`）→ 返回该 `EditorView`；**路径必须过 `resolveInside` 围栏**（`host/workspace.js:50-59`） |
| `updateFile(uri, transaction)` | 服务器主动改文件时，把事务派发回对应视图 |
| `closeFile(uri, view)` | 通知宿主 `didClose` |

**验收**

- 在编辑器里输入一个新变量名（**不保存**），立刻让 LSP 补全/查找引用 → 必须能看到这个新符号。**若必须先保存才能看到，说明草稿同步没做对。**
- `displayFile` 打开的是**工作台自己的标签页**（不是 DSH 侧栏），且滚动到目标行（复用 `tab.revealLine` → `CodeEditor.jsx:229`）。
- 打开工作区**之外**的文件（围栏外）时，`displayFile` 返回 `null`，并弹出既有 `common.outsideProject` 类提示，**不得**越权读取。

### 3.5 LSP-05 位置漂移

- 所有会返回位置的请求（definition / references / rename 等）**必须**在 `client.withMapping(async mapping => …)` 内发起。
- 理由：请求发出后用户继续打字，服务端返回的位置对应旧文档；`withMapping` 会把位置映射回当前文档。
- **验收**：在慢响应的大项目上，发出"查找引用"后立刻继续打字，点击引用仍跳到正确的行。

### 3.6 LSP-06 能力探测与降级

- 初始化后读 `client.serverCapabilities`；只启用服务器**声明支持**的能力。
- 服务器不支持 `referencesProvider` → NAV-02 菜单项置灰并提示"该语言服务器不支持查找引用"，**降级到 NAV-03 文本版**（§5.3）。
- 服务器不支持 `definitionProvider` → NAV-01 置灰，降级为"同名符号跳转"（若项目里存在同名符号，用保守方式列出候选）。

---

## 4. COMP — 代码提示

### 4.1 COMP-01 L0 内置补全（零新依赖兜底）

**代码锚点**：`src/client/CodeEditor.jsx:186-222`（扩展列表）

**改法**：在扩展列表中加入

```js
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
// 扩展：
autocompletion({ activateOnTyping: true, icons: false }),
closeBrackets(),
// keymap：completionKeymap 置于 defaultKeymap 之前
```

**要点**

- `@codemirror/autocomplete@6.20.4` 已在 `node_modules`（传递依赖），**需在 `package.json` 的 `devDependencies` 中显式声明**（`"@codemirror/autocomplete": "^6.20.4"`），否则依赖是隐式的、npm 可能在任意一次安装时消失。
- **必须**在 `keymap` 中把 `completionKeymap` 放在 `defaultKeymap` **之前**，否则 `Enter` / `Tab` 的补全接受会被默认键位抢走。
- 主题：`CodeEditor.jsx:79-103` 的 `THEME` 需要补 `.cm-tooltip-autocomplete` 样式（当前只有通用 `.cm-tooltip`）。补全项的图标用纯 CSS 字符，不引 SVG。

**语言覆盖（实测 `autocomplete:` 数据）**

| 有语言数据 | 仅词级 |
|---|---|
| JavaScript / TypeScript、Python、HTML、CSS、SQL、Go、XML、Markdown | JSON、Java、C/C++、Rust、YAML |

**验收**

- 在 `.js` / `.py` / `.html` / `.css` / `.sql` / `.go` / `.xml` / `.md` 文件中输入 → 出现补全弹窗；Java/C++/Rust/YAML/JSON 至少出现词级候选。
- `Tab` / `Enter` 接受补全；`Esc` 关闭弹窗且**不**插入文本。
- 补全弹窗**不**遮挡输入位置、不吞掉 `Ctrl+S` / `Ctrl+F` 等既有快捷键。
- 关闭补全后 `defaultKeymap` 行为完全不变（回归 `tests/editor-conflict.test.mjs` 等）。

### 4.2 COMP-02 LSP 语义补全

- 接入 `@codemirror/lsp-client` 的 `serverCompletion()`（或 `serverCompletionSource`）。
- 与 L0 **并存**（不要 `override: true`）：L0 提供本地词与片段，LSP 提供类型感知的成员与导入建议。`validFor` 用库默认表达式。
- `activateOnTyping` 保持开启；LSP 响应期间**不**阻塞输入（库本身异步）。
- 补全项需要**签名与文档**时，走 `completionItem/resolve`（库已支持 resolve）；解析失败时降级为不带文档的项，**不得**报错。

### 4.3 COMP-03 状态提示

**状态栏新增一项**（`src/client/Workbench.jsx:269-278` 状态栏区域），文案随 `lsp.status` 变化：

| 状态 | 文案 | 视觉 |
|---|---|---|
| 未启用（设置关闭） | `语义分析：已关闭` | 灰 |
| 未安装语言服务器 | `语义分析：未安装（Python）` | 灰 + 可点击进设置 |
| 启动中 | `语义分析：启动中…` | 灰 |
| 索引中 | `语义分析：索引中…` + 【取消】按钮（>60 s 时） | 黄 |
| 就绪 | `语义分析：就绪` | 绿 |
| 降级（保守版） | `语义分析：保守版` | 灰 + tooltip 说明原因 |
| 崩溃 | `语义分析：已崩溃` | 红 + 点击进日志 |

**验收**：上述七种状态均可达且文案正确；索引中状态**不阻断**任何操作。

---

## 5. NAV — 跳转定义与 Usage

### 5.1 NAV-01 跳转定义（Ctrl+点击 / F12）

**代码锚点**：`src/client/CodeEditor.jsx:186-222`（扩展列表）、`:123-129`（`editorKeymap`）

**改法**

1. **F12**：`@codemirror/lsp-client` 的 `jumpToDefinitionKeymap` 绑定 F12。F12 与现有快捷键表（`settings-store.js:96-120`）**无冲突**，可直接启用。
2. **Ctrl+点击**：CodeMirror 6 **没有**内置实现，必须自己加：

```js
EditorView.domEventHandlers({
  mousedown(event) {
    if (!(event.ctrlKey || event.metaKey)) return false
    // 只在有标识符的位置触发；命中即调用 jumpToDefinition
    return handleCtrlClick(event, view)
  },
})
```

- Ctrl+点击必须**只对标识符生效**：点在空白/标点/注释上不触发。
- Ctrl+点击命中后，**必须** `event.preventDefault()`（否则会同时触发文本选区拖拽）。
- 在**当前文件**内的定义：直接选中并滚动到该行（不新开标签页）。
- **跨文件**定义：走 `Workspace.displayFile(uri)`（§3.4）→ `store.openFile(absolute, { line })`。
- 目标文件在工作区**之外**（围栏外）→ 不打开，弹提示（沿用既有 `commit.outsideProject` 类文案）。

**验收**

- Ctrl+点击类名/函数名/变量名 → 跳到定义；跨文件时新开/复用标签页并滚动到目标行。
- Ctrl+点击空白处不触发、也不改变选区。
- F12 等价于 Ctrl+点击。
- 围栏外的目标不打开。

### 5.2 NAV-02 Find Usages（语义版，Alt+F7）

- **不要启用库自带的 `findReferencesKeymap`**（它绑 Shift+F12）。改为把 `Alt+F7` 绑到库的 `findReferences` 命令，IDEA 键位与 PRD-v2 `:245` 预留一致。
- 面板用**库自带**的引用面板（§0.2 #2），只做：
  1. **主题化**（`.cm-lsp-*` 系列样式，匹配工作台 `--iwb-*` 令牌）；
  2. **跨文件点击**（库会请求 `displayFile`）；
  3. **命中数上限**（默认 2000 条）+ "还有 N 条"提示，避免上万个 DOM 节点。
- 引用面板的条目点击后**必须**定位到精确列（不只是行）。
- 服务端不支持 `referencesProvider` → 菜单项置灰 + 提示，**自动降级到 NAV-03**。

### 5.3 NAV-03 Find Usages（文本版，保留并标注「文本匹配」）

**这是 PRD-v2 决策 #6 的保留项**（Q4 决策）。它**必须始终可用**，是语义版的兜底。

**实现**：复用既有 `fs.search`（`src/host/search.js:193` `searchFiles`），参数 `wholeWord: true`、`caseSensitive: false`、排除二进制与忽略目录。

**与既有"查找所有文件"视图的关系**

- 既有视图（`SearchView.jsx`）是**全文搜索**，入口 `Ctrl+Shift+R`。
- 文本版 Find Usages 是**按当前光标处标识符**的精确搜索，**独立入口**（`Alt+F8` 或右键菜单项），结果**标注「文本匹配」**。

**菜单项（编辑右键菜单，`CodeEditor.jsx:336-353`）**

| 项 | 快捷键 | 行为 |
|---|---|---|
| 查找用法（语义） | `Alt+F7` | 语义版；不可用时置灰 + 说明 |
| 查找用法（文本） | `Alt+F8` | 文本版；结果标注「文本匹配」 |

**验收**

- 无语言服务器时，`Alt+F7` 置灰但 `Alt+F8` 可用，且结果面板里**每条结果都带「文本匹配」标注**。
- 有语言服务器时，`Alt+F7` 返回语义引用（不含注释与字符串里的同名出现）；`Alt+F8` 始终返回文本命中。

### 5.4 NAV-04 悬停提示与签名帮助

- `hoverTooltips({ hoverTime: 300 })`。
- `signatureHelp({ keymap: false })` —— **不启用库自带的 `signatureKeymap`**（它绑 `Ctrl+Shift+Space` / `Ctrl+Shift+↑↓`，在 Electron 宿主里可能被占用；自动弹出即可，不额外占键位）。
- 悬停内容是服务器返回的 Markdown → **必须**经过 `sanitizeHTML`（§3.3）。

### 5.5 NAV-05 跳转后的定位精度

- 所有跳转（定义 / 引用 / 悬停链接）**必须**落到**列级**，不只是行级。
- 既有 `store.openFile(path, { line })` 只支持行（`store.js:1911`）。需要**扩展**为支持列：`tab.revealLine` + 新增 `tab.revealColumn`，`CodeEditor.jsx:229-232` 与 `:325-328` 两处定位逻辑同步消费它。
  - 兼容：未提供列时行为与现在完全一致（行级定位），**不得**破坏既有跳转。

---

## 6. SET — 设置项

### 6.1 新增 `lsp` 段

在 `src/host/settings-store.js` 的 `DEFAULT_SETTINGS`（`:17-125`）新增：

```js
lsp: {
  /** 总开关。false = 完全不启动语言服务器，只保留 L0 与文本版。 */
  enabled: true,
  /** 'ask' = 询问；'always' = 总是索引；'never' = 从不索引（直接保守版）。 */
  indexOnOpen: 'ask',
  /** 语言服务器内存上限（MB）。 */
  memoryLimitMB: 2048,
  /** 启动前的系统可用内存阈值（MB）。低于此值不启动。 */
  freeMemoryThresholdMB: 2048,
  /** 空闲多少毫秒后退出语言服务器。 */
  idleTimeoutMs: 600000,
  /** LSP 请求超时（毫秒）。必须 ≥ 30000，覆盖库默认的 3000。 */
  requestTimeoutMs: 30000,
  /** 索引进行多久后显示「取消索引」按钮（毫秒）。 */
  cancelAfterMs: 60000,
  /** 是否允许空闲自动退出。 */
  autoExit: true,
  /** 崩溃后是否自动重启一次。 */
  autoRestart: true,
  /** 单语言覆盖：{ [languageId]: { enabled, command, args } } */
  servers: {},
  /** 已完成过首次索引构建的项目目录 → { at, languageId } */
  indexedRoots: {},
},
```

### 6.2 Schema 升版与迁移

- `SETTINGS_VERSION` 由 **2 → 3**（`settings-store.js:14`）。
- 迁移规则：旧文档缺 `lsp` 段时用 `DEFAULT_SETTINGS.lsp` 填充；**不得**因为缺段而重置用户其它设置。
- 现有备份机制（`:193` 写 `.v{old}.bak.json`）保持不变。

### 6.3 打包与体积

- `typescript-language-server` + `typescript@~5.9.3` + `basedpyright` 写进 `dependencies`（**不是** `bundleDependencies`）。
  - 理由：`bundleDependencies` 决定**离线 tarball** 的内容；把语言服务器塞进去会让离线包增加约 **50 MB**（typescript 约 25 MB + basedpyright 约 28 MB），得不偿失。
  - 代价：**离线安装的用户拿不到打包的语言服务器** → 这些用户走 PATH 探测路径；设置页与首次提示必须说清楚。
- `@codemirror/lsp-client@6.3.0` + `marked@15.0.12` 写进 `devDependencies`（客户端侧会被 esbuild 打进 `dist/client.js`，**不影响** npm 运行时依赖）。
- `dist/client.js` 体积增加约 **363 KB**（实测，基线 2,413 KB → ~2,776 KB，+15%），需在交付物里说明。

### 6.4 快捷键

在 `DEFAULT_SETTINGS.shortcuts`（**`:96-120`**）新增：

| 键 | 默认 | 说明 |
|---|---|---|
| `findUsages` | `Alt+F7` | 查找用法（语义） |
| `findUsagesText` | `Alt+F8` | 查找用法（文本） |
| `goToDefinition` | `F12` | 跳转定义 |
| `complete` | `Ctrl+Space` | 手动触发补全 |

- `Alt+F7` 与 PRD-v2 `:245` 预留的键位一致。
- `F12` 与现有表无冲突（现有表 `:96-120` 中未使用 F12）。
- `Ctrl+Space` 需**实测**宿主是否占用；若被占用，改为 `Ctrl+Alt+Space`（与既有 `findInFilesAlt` 的降级做法一致，见 **`:107`**）。

---

## 7. UX — 交互契约

```
【Project 选择器】现有 UI（Workbench.jsx:345-399），本轮只增加【已索引】徽标
┌────────────────────────────────────────────────────────────────┐
│  选择 IDE 项目                                                  │
│  Project 文件树、Git 仓库和新增终端会都使用这个目录。            │
│                                                                │
│  工作区根目录                                                   │
│  📁 DSH-IDE-TOOLWINDOWS-ROOT                    [当前]         │
│     D:\Code\Node\DSH-IDE-TOOLWINDOWS-ROOT                       │
│                                                                │
│  一级子目录                                                     │
│  📁 qa-tools                                                   │
│     D:\Code\Node\DSH-IDE-TOOLWINDOWS-ROOT\qa-tools              │
│  🌿 dsh-ide-workbench                          [Git] [已索引]   │ ← 新增徽标
│     D:\Code\Node\DSH-IDE-TOOLWINDOWS-ROOT\dsh-ide-workbench    │
│  📁 logo-test-empty                                            │
│     D:\Code\Node\DSH-IDE-TOOLWINDOWS-ROOT\logo-test-empty       │
│                                             ⟳ 刷新目录  取消    │
└────────────────────────────────────────────────────────────────┘
  📁 = 文件夹图标（FileTypeIcon kind='folder'）  🌿 = Git 图标（IconGit）
  [当前] = .iwb-project-current-badge（蓝，已有）  [Git] = .iwb-project-repo-badge（绿，已有）
  [已索引] = .iwb-project-index-badge（新增，样式见 §2.1）
  → 徽标顺序固定为【Git】【已索引】【当前】，三者互不排斥

【索引决策弹窗】（未索引目录首次打开）
        ┌──────────────────────────────────────────┐
        │  为 api-server 构建代码索引？              │
        │  首次构建可能需要 1–2 分钟，期间可随时取消。  │
        │  不构建则只提供保守版（基础补全 + 文本查找引用）。│
        │  ─────────────────────────────────────── │
        │  ⚠ 此目录是工作区根目录，通常包含多个独立仓库。 │
        │    在根目录索引会显著增加内存占用与构建时间。   │
        │    建议先切换到具体子目录再索引。              │
        │  [在此目录索引（不推荐）] [仅保守版] [取消]    │
        └──────────────────────────────────────────┘

【状态栏】（Workbench.jsx:269-278 区域新增一项）
  ● 就绪  main  ↑2  −1  │  语义分析：索引中…  [取消索引]  │  Ln:12 Col:34

【编辑器右键菜单】（CodeEditor.jsx:336-353）
  ┌────────────────────────┐
  │ 发送到聊天               │
  │ 复制                    │
  │ ────────────────────    │
  │ 跳转定义           F12 │
  │ 查找用法（语义）  Alt+F7│
  │ 查找用法（文本）  Alt+F8│
  └────────────────────────┘
```

### 7.1 降级态的可见性（硬性）

**任何时候语义能力不可用，用户必须能从界面看出来。** 三条硬性要求：

1. 状态栏常驻一项，反映 §4.3 的七种状态。
2. 语义版菜单项不可用时**置灰并带说明**，不是隐藏（用户需要知道"有这个功能但现在用不了"）。
3. 文本版结果**必须**标注「文本匹配」，让用户知道这不是语义结果。

### 7.2 索引中的非阻断原则

- 索引期间**不弹模态**、**不加遮罩**、**不锁编辑器**。
- 用户可以继续编辑、切换标签、切面板。
- 唯一允许的模态是 §2.3 的**决策弹窗**（在启动之前，不在索引期间）。

### 7.3 安全

| 面 | 措施 |
|---|---|
| LSP 返回的 Markdown/HTML | **必须**经 `sanitizeHTML` 剥离 `<script>` / `<iframe>` / `on*` 属性 / `javascript:` URL |
| 环境变量 | **必须**用 `ctx.subprocess.spawn`（自动 scrub `DEEPSEEK_API_KEY` 等敏感变量） |
| 命令注入 | `argv` 永远是数组；用户自定义的服务器命令行**必须**经白名单校验（可执行名不含 shell 元字符），且**绝不**经 shell |
| 文件访问 | 语言服务器只能看到 `cwd`（项目根）下的内容；插件自身的文件读取仍受 `resolveInside` 围栏约束（`host/workspace.js:50-59`） |
| 围栏外跳转 | `displayFile` 对围栏外路径返回 `null` 并提示，**不得**读取 |

---

## 8. 实施顺序与里程碑

> 每个里程碑结束时：**跑 `npm test`（当前 329 项）+ `npm run build`**，并在 `docs/PRD-v5-实施进展.md` 追加记录。

### M0 — 开工前置（阻塞项）

| 任务 | 判定 |
|---|---|
| **M0-0** **核对代码基线**：`git rev-parse HEAD` 必须等于 `dd6dc175f8cf1b6a891cc37f81ac21a3d81839a4` | 不等 → 先按 §附录 D 判断是否需要重新定位锚点；**不要用 `v0.4.1` tag 当基线**（两棵树的 `package.json` 版本号都是 `0.4.1`，无法区分） |
| **M0-1** 核实宿主是否占用 `Ctrl+Space` | 占用 → `complete` 改 `Ctrl+Alt+Space` |
| **M0-2** 核实宿主是否占用 `Alt+F7` / `Alt+F8` | 占用 → 换键并更新本文档 |
| **M0-3** 核实 `ctx.subprocess.spawn` 在本 DSH 版本可用（含 `stdio: 'pipe'`） | 不可用 → 退回 `node:child_process`，但**必须**自行 scrub 环境变量 |
| **M0-4** 确认 `typescript@~5.9.3` + `typescript-language-server@6.0.2` 在本机 npm 镜像可装 | 不可装 → TS/JS 走 PATH 探测 |
| **M0-5** 建立性能基线：空闲时宿主内存、语言服务器进程树 RSS、宿主事件循环漂移 | 无基线无法验收 §11 |
| **M0-6** 复跑基线测试 `npm test`，确认 **329 项全绿**（基线 commit 已修复 `tests/perf-cold-workspace.test.mjs:123`；本项用于确认工作区没有新的并发失败） | 有失败 → 先处置；无法处置 → 在 §9.3 显式豁免并记录原因 |

**产出**：M0-0~M0-6 的结论写进 `docs/PRD-v5-实施进展.md`；结论与本文档冲突时**以本文档为准**，需回填的按键位改动同步更新本文档。

---

### M1 — L0 补全与文本版 Find Usages（低风险，先出可感知价值）

**条目**：COMP-01、NAV-03、SET-01（部分）、I18N-01（部分）

**理由**：完全不依赖语言服务器，不碰进程管理，风险最低，且立刻让"代码提示"和"查找用法"两个入口存在。

**重点**：`completionKeymap` 必须排在 `defaultKeymap` 之前；`@codemirror/autocomplete` 必须显式进 `devDependencies`。

**验收**：§9.4 的「补全」「文本查找」两组全部通过。

---

### M2 — 宿主语言服务器管理器（结构性，核心）

**条目**：LSP-01、LSP-02、LSP-06、IDX-02、IDX-05、IDX-06、IDX-07

**理由**：进程管理、内存上限、worker_thread 隔离是全部语义能力的地基，且是风险最高的部分，必须单独一轮。

**重点**：
- `ctx.subprocess.spawn` 的 `argv` / `cwd` / `stdio` 契约；stdout 绝不混入日志。
- `maxTsServerMemory` 必须真的传进去（否则 OOM 风险原样保留）。
- worker_thread 与主线程之间的消息协议只传**字符串/Buffer**，主线程不得 parse。
- 崩溃检测的三条信号都要实现。

**验收**：§11 的全部性能指标达标；§9.4 的「服务器生命周期」组通过。

---

### M3 — 客户端接入与导航能力

**条目**：LSP-03、LSP-04、LSP-05、COMP-02、COMP-03、NAV-01、NAV-02、NAV-04、NAV-05

**依赖**：强依赖 M2。

**重点**：
- 自定义 `Workspace` 的五个方法必须全部实现（`displayFile` 走 `store.openFile` + 围栏）。
- `withMapping` 必须包住所有带位置的请求。
- Ctrl+点击的 `preventDefault` 与"只在标识符上触发"两条容易漏。
- 引用面板的命中数上限。

---

### M4 — 索引决策流程与设置

**条目**：IDX-01、IDX-03、IDX-04、SET-01（全部）、I18N-01（全部）

**依赖**：依赖 M2（`lsp.index` / `lsp.cancelIndex` / `lsp.resources`）。

**重点**：
- 取消的**原子性**（§2.4 的六条判定逐条验证）。
- 根目录警告的文案分级（`isRepo` 真假两版）。
- 【已索引】徽标的**语义准确**（§2.1，不得夸大成"磁盘上有索引文件"）。
- settings schema 2 → 3 的迁移。

---

### M5 — 硬化、回归与交付

**条目**：§9 全部测试、§11 性能验收、§9.4 实机清单、交付物

**重点**：跨平台（Win/macOS/Linux）各跑一遍 §9.4；低配机（8 GB）复测内存预检与降级路径。

---

## 9. 测试要求

### 9.1 新增测试文件

| 文件 | 覆盖 |
|---|---|
| `tests/lsp-registry.test.mjs` | 注册表完整性：每个语言的 `languageIds` 唯一且覆盖 §1.4 表格；`command` 非空；`memoryLimitMB > 0`；**`typescript` 不得解析到 7.x** |
| `tests/lsp-resources.test.mjs` | 内存预检：free 低于阈值 → `canIndex === false`；高于阈值 → true；阈值取 `max(memoryLimit, freeMemoryThreshold)` |
| `tests/lsp-lifecycle.test.mjs` | 状态机迁移合法（`idle→starting→building→ready`）；非法迁移被拒；`lsp.start` 幂等（重复调用不重复 spawn）；`lsp.cancelIndex` 幂等 |
| `tests/lsp-cancel-atomic.test.mjs` | 取消后：进程已终止、状态为 `cancelled`、已开文档已关闭、编辑器状态未变、重复取消不报错 |
| `tests/lsp-recovery.test.mjs` | 崩溃检测（exit / EOF / 超时三信号）；自动重启**一次**；二次崩溃 → `degraded`；崩溃前若内存不足则**不重启** |
| `tests/lsp-idle-exit.test.mjs` | 空闲超阈值 → 进程退出；`indexedRoots` **不清除**；再次 `lsp.start` 能重启 |
| `tests/lsp-workspace.test.mjs` | 自定义 `Workspace`：`syncFiles` 用 `tab.draft` 而非磁盘内容；`displayFile` 走 `store.openFile` 且围栏外返回 `null`；`closeFile` 触发 `didClose` |
| `tests/lsp-mapping.test.mjs` | 请求期间继续编辑，返回位置经 `withMapping` 后仍指向正确符号 |
| `tests/completion.test.mjs` | L0：`autocompletion` 已挂载；`completionKeymap` 在 `defaultKeymap` 之前；`Esc` 不插入文本；`@codemirror/autocomplete` 在 `devDependencies` 中 |
| `tests/definition.test.mjs` | Ctrl+点击只在标识符上触发；`preventDefault` 已调用；跨文件走 `displayFile`；围栏外不打开 |
| `tests/find-usages.test.mjs` | 语义版不可用时置灰；文本版始终可用且结果带「文本匹配」标注；`Alt+F7`/`Alt+F8` 键位正确 |
| `tests/idx-decision.test.mjs` | 索引决策矩阵（§2.3 四行逐行覆盖）；根目录 `isRepo === false` 时弹窗含完整警告与取消按钮；「取消」不切换项目 |
| `tests/settings-lsp.test.mjs` | schema 2 → 3 迁移；旧文档缺 `lsp` 段时其它设置不丢；`requestTimeoutMs` 默认 ≥ 30000 |
| `tests/lsp-html-sanitize.test.mjs` | `sanitizeHTML` 剥离 `<script>` / `<iframe>` / `onerror=` / `javascript:` |

### 9.2 现有测试的回归要求

- `tests/editor-conflict.test.mjs` —— `CodeEditor.jsx` 的扩展列表被改动，**必须全绿**。
- `tests/shortcuts.test.mjs` —— 新增 4 个快捷键，**必须全绿**；且要断言 `F12` / `Alt+F7` / `Alt+F8` / `Ctrl+Space` 不与既有键位冲突。
- `tests/render.test.mjs` —— 状态栏新增一项、项目选择器新增徽标，**必须全绿**。
- `tests/store-ui.test.mjs` —— `selectProject` 流程被插入索引决策，**必须全绿**。
- `tests/store-lifecycle.test.mjs` —— 新增 `lsp` 状态字段，不得破坏生命周期断言。
- `tests/projects.test.mjs` —— `listProjectCandidates` 的返回结构变化，**必须全绿**。
- `tests/status-basis.test.mjs`、`tests/perf-*.test.mjs` —— 宿主新增 worker_thread 与子进程，**性能计数器断言不得被打破**。
- 其余 `tests/*.test.mjs` 全部保持全绿。

### 9.3 交付前检查

- [ ] `npm test` 全绿（基线 329 项，基线 commit 实测 329/329 通过；开工前复跑确认无并发引入的新失败 + §9.1 新增用例）
- [ ] `npm run build` 成功，`dist/client.js` 已更新并提交，体积增量 ≤ 400 KB
- [ ] §11 性能指标逐条达标（附实测数值）
- [ ] `package.json` 的 `dependencies` 里 `typescript` 解析到 **5.9.x**（用 `npm ls typescript` 核对）
- [ ] `package.json` 的 `devDependencies` 里显式声明 `@codemirror/autocomplete` 与 `@codemirror/lsp-client`
- [ ] 实机走查：§9.4 的清单

### 9.4 实机验收清单

**补全**
- [ ] `.js` / `.py` / `.html` / `.css` / `.sql` / `.go` / `.xml` / `.md` 输入 → 弹补全；`Tab`/`Enter` 接受，`Esc` 关闭且不插入
- [ ] `.java` / `.cpp` / `.rs` / `.yml` / `.json` 输入 → 至少词级候选
- [ ] 补全弹窗不遮挡输入、不吞 `Ctrl+S` / `Ctrl+F`
- [ ] LSP 可用时，补全项带签名与文档；服务器不支持时降级为无文档项

**跳转定义**
- [ ] Ctrl+点击类名 / 函数名 / 变量名 → 跳到定义；跨文件开新标签并定位到**列**
- [ ] Ctrl+点击空白 / 标点 / 注释 → 不触发、不改选区
- [ ] F12 等价于 Ctrl+点击
- [ ] 目标在工作区外 → 不打开，弹提示

**查找引用**
- [ ] `Alt+F7` → 引用面板列出**语义**引用（不含注释/字符串里的同名出现），点击跳到**列**
- [ ] 无语言服务器 → `Alt+F7` 置灰带说明；`Alt+F8` 可用且每条结果标注「文本匹配」
- [ ] 大符号（>2000 命中）→ 面板截断并提示剩余数量，界面不卡

**服务器生命周期**
- [ ] 未索引子目录首次打开 → 弹决策框；选「构建索引」→ 状态栏显示「索引中…」
- [ ] 索引 >60 s → 状态栏出现【取消索引】；点击 → ≤2 s 变为「已取消（保守版）」，无残留进程，编辑器状态不变
- [ ] 索引完成后状态栏显示「语义分析：就绪」
- [ ] 空闲 10 分钟 → 进程退出，内存回落；再打开文件 → 自动重启并恢复功能
- [ ] 手动 kill 语言服务器 → 状态栏变红 + toast 提示 → 自动重启一次 → 功能恢复
- [ ] 连续崩溃两次 → 进入降级态，提示含「降低内存上限」建议

**索引决策**
- [ ] 项目选择器里已索引目录显示【已索引】徽标；重启 DSH 后仍在
- [ ] 未索引根目录（`isRepo === false`）→ 弹窗含完整警告 + 三个按钮；「取消」不切换项目
- [ ] 内存不足时 → 不弹窗、直接降级，提示含所需/可用 MB 数值

**未保存草稿**
- [ ] 编辑器里输入新变量名**不保存** → 补全与查找引用立即能看到它
- [ ] 打开工作区外的文件 → 拒绝并提示

**安全**
- [ ] 悬停内容含 `<script>` → 不执行
- [ ] 语言服务器进程环境变量中**没有** `DEEPSEEK_API_KEY`

**性能**
- [ ] 空闲时宿主进程内存增量 ≤ 20 MB（相对 M0 基线）
- [ ] 语言服务器进程树 RSS ≤ `memoryLimitMB + 200 MB`
- [ ] 宿主事件循环漂移 p95 ≤ 30 ms（相对 M0 基线）

---

## 10. 风险与回归清单

| # | 风险 | 关联条目 | 处置 |
|---|---|---|---|
| 1 | **误把"索引"实现成自研索引器** | IDX-01~07 | §0.2 #1 已澄清；代码审查时对照该条 |
| 2 | tsserver 无内存上限 → OOM 把整机拖进换页 | LSP-02 | **必须**传 `maxTsServerMemory`；实测 4,225 MB 后 exit 134 |
| 3 | 宿主主线程解析大 JSON → DSH 卡顿 | LSP-03 | worker_thread 隔离；实测 412 ms → 8 ms |
| 4 | 库默认请求超时 3000 ms → 大项目静默超时 | LSP-03 | 显式传 `timeout`（≥30000） |
| 5 | `typescript@7` 被解析出来 → tsserver 行为异常 | LSP-02 | 钉 `~5.9.3`；交付前 `npm ls typescript` 核对 |
| 6 | 裸 `node:child_process` → 宿主密钥泄漏给第三方进程 | LSP-02 | 必须用 `ctx.subprocess.spawn` |
| 7 | LSP 看到磁盘内容而非草稿 → "新建的符号查不到" | LSP-04 | 自定义 `Workspace.syncFiles`；验收项必须用**不保存**的场景验证 |
| 8 | 位置漂移 → 引用跳错行 | LSP-05 | 所有带位置的请求用 `withMapping` |
| 9 | 取消索引不原子 → 残留进程 / 半开文档 / 状态打架 | IDX-04 | 宿主侧单临界区；§2.4 六条判定逐条测 |
| 10 | 崩溃后无提示 → 功能"静默消失" | IDX-07 | 状态栏 + toast 双通道；不得只打日志 |
| 11 | 崩溃后无限重启 → 反复 OOM | IDX-07 | 只自动重启一次；二次崩溃进降级 |
| 12 | 重启前不复查内存 → OOM 循环 | IDX-07 + IDX-02 | 重启前必跑 `lsp.resources` |
| 13 | LSP 重命名/格式化与既有 `F2`/`Shift+F6` 冲突 | §0.2 #6 | 本轮不启用 `renameKeymap` / `formatKeymap` |
| 14 | `completionKeymap` 被 `defaultKeymap` 抢走 → `Enter` 不接受补全 | COMP-01 | keymap 顺序；`tests/completion.test.mjs` 断言 |
| 15 | `@codemirror/autocomplete` 是隐式传递依赖 → 某次安装后消失 | COMP-01 | 显式进 `devDependencies` |
| 16 | Ctrl+点击抢走文本选区 | NAV-01 | `preventDefault` + 仅标识符触发 |
| 17 | 跨文件跳转打开工作区外文件 | LSP-04 / NAV-01 | `displayFile` 走 `resolveInside` 围栏，围栏外返回 `null` |
| 18 | 引用面板一次性渲染上万条 → 浏览器卡 | NAV-02 | 命中数上限 2000 + "还有 N 条" |
| 19 | 悬停 Markdown 含 HTML → XSS | NAV-04 | 必须传 `sanitizeHTML`；`tests/lsp-html-sanitize.test.mjs` |
| 20 | 离线 tarball 不含打包的语言服务器 → 离线用户无 TS/JS 语义能力 | SET-01 / §6.3 | 明确在设置页与首次提示说明；走 PATH 探测路径 |
| 21 | 离线包体积膨胀 50 MB+ | §6.3 | 语言服务器**不进** `bundleDependencies` |
| 22 | 索引期间误用模态阻塞用户 | §7.2 | 索引期间禁止模态；决策弹窗只在启动前 |
| 23 | settings schema 升版重置用户已有设置 | SET-01 | 迁移只填 `lsp` 段，其余不动 |
| 24 | `indexedRoots` 无限增长 | SET-01 | 以项目路径为键，数量天然受工作区数限制；可加 LRU 上限 200 |
| 25 | 新增状态栏项挤压既有布局（窄屏） | COMP-03 | 窄屏（≤560）下折叠为图标；回归 `tests/render.test.mjs` |
| 26 | `store.selectProject` 被插入模态 → 切项目流程变长 | IDX-03 | 决策弹窗只在"未索引"时出现；已索引路径零额外步骤 |

---

## 11. 性能预算与验收口径

> 全部数值来自 `docs/代码智能-性能开销评估.md` 的实测（i5-10300H / 4 核 / 15.8 GB / Windows / Node v22.22.2）。
> 复现脚本已入库 `docs/bench/`（见 `docs/bench/README.md`），验收时可原样复跑下列每条预算。

### 11.1 宿主主线程

| 指标 | 预算 | 实测依据 |
|---|---|---|
| 事件循环漂移 p95 | **≤ 30 ms** | worker_thread 隔离后 max 8 ms；朴素实现 412 ms |
| 事件循环漂移 max | **≤ 120 ms** | 病态载荷（8.9 MB）主线程解析为 188 ms；worker 内为 8 ms |
| 宿主进程内存增量（空闲） | **≤ 20 MB** | LSP 管理器 + JSON-RPC 连接；语言服务器不计入 |

### 11.2 语言服务器进程树

| 指标 | 预算 | 实测依据 |
|---|---|---|
| 进程树 RSS | **≤ `memoryLimitMB` + 200 MB** | 800 文件 strict 实测 1,783 MB；3,000 文件实测 2,202 MB |
| 空闲 CPU | **≤ 1% 单核** | 实测 20 s 空闲消耗 0.00 s（0.0% 单核） |
| 启动到就绪（小项目） | **≤ 3 s** | `initialize` 实测 419 ms |
| 启动到就绪（大型项目） | **不设硬指标**，但必须显示「索引中」并可取消 | 实测大型项目语义请求可超 10 分钟 |

### 11.3 浏览器端

| 指标 | 预算 | 实测依据 |
|---|---|---|
| `dist/client.js` 增量 | **≤ 400 KB** | `@codemirror/lsp-client` + `marked` 实测 363 KB |
| 补全弹窗出现延迟 | **≤ 100 ms（本地源）/ ≤ 400 ms（LSP 源）** | 本地源即时；LSP 实测小项目 84 ms |
| 引用面板渲染（2000 命中） | **≤ 300 ms** | 需实机测；超出则加分页 |

### 11.4 索引决策的内存门槛

| 场景 | 行为 |
|---|---|
| 可用内存 ≥ `max(memoryLimitMB, freeMemoryThresholdMB)` | 允许启动（仍需用户/策略同意，见 §2.3） |
| 可用内存 < 阈值 | **不启动**，直接降级，提示含所需/可用 MB |

---

## 12. 交付物

| # | 交付物 | 位置 |
|---|---|---|
| 1 | 宿主侧 LSP 管理器与语言注册表 | `dsh-ide-workbench/src/host/lsp.js` |
| 2 | 宿主侧 LSP WebSocket 中继 | `dsh-ide-workbench/src/host/lsp-ws.js` |
| 3 | 客户端 Transport 与自定义 Workspace | `dsh-ide-workbench/src/client/lsp-transport.js`、`src/client/lsp-workspace.js` |
| 4 | 编辑器接入（L0 补全 + LSP 扩展 + Ctrl+点击） | `dsh-ide-workbench/src/client/CodeEditor.jsx` |
| 5 | 设置项与 schema 迁移 | `dsh-ide-workbench/src/host/settings-store.js` |
| 6 | 新增文案 en + zh-CN | `dsh-ide-workbench/src/client/i18n.js`、`locale/*.json` |
| 7 | 样式（徽标、状态栏、引用面板、补全弹窗） | `dsh-ide-workbench/src/client/styles.js` |
| 8 | 依赖变更 | `dsh-ide-workbench/package.json` |
| 9 | 新增/更新测试 | `dsh-ide-workbench/tests/**` |
| 10 | 构建产物 | `dsh-ide-workbench/dist/client.js`（`npm run build`） |
| 11 | 本轮实施记录（里程碑、实测数值、M0 结论） | `dsh-ide-workbench/docs/PRD-v5-实施进展.md`（新建） |
| 12 | 验收记录（自动化 + 实机清单勾选结果） | `dsh-ide-workbench/docs/VERIFICATION.md`（追加本轮段） |
| 13 | 配套评估文档 | `docs/代码智能-可行性评估.md`、`docs/代码智能-性能开销评估.md`（已完成） |
| 14 | 性能基准测试脚手架（§11 预算的复现手段） | `dsh-ide-workbench/docs/bench/`（已完成，见 `docs/bench/README.md`；不在 `files` 白名单内，不随插件分发） |

---

## 附录 A — 关键锚点速查

| 主题 | 锚点 |
|---|---|
| 宿主 API 路由表 | `src/index.js:98-441`（`api`）、`:443-472`（前缀路由）、`:62`（`fence`）、`:44`（`WS_PATH`） |
| 宿主围栏与错误封装 | `src/host/wire.js:55-88`（`writeOk`/`writeError`）、`:96-128`（入参校验：requireString / stringArray / optionalBoolean / optionalInteger） |
| 已有子进程 spawn 范式 | `src/host/git.js:11`（`import { spawn }`）、`:65`（spawn 调用） |
| 项目候选 | `src/host/workspace.js:75-103`（`listProjectCandidates`）、`:80`（`isRepo` 判定）、`:66-67`（`MAX_PROJECTS`） |
| 围栏 | `src/host/workspace.js:50-59`（`resolveInside`） |
| 项目选择器 UI | `src/client/Workbench.jsx:345-399`（`ProjectPicker`）、`:351-373`（`choice`）、`:367-369`（【Git】徽标） |
| 徽标样式 | `src/client/styles.js:799`（`.iwb-project-repo-badge`）、`:800`（`.iwb-project-current-badge`） |
| 项目选择与切换 | `src/client/store.js:908-926`（`selectProject`）、`:840-856`（`#projectRootFor` / `#rememberProjectRoot`）、`:810-838`（`loadProjects`） |
| 编辑器扩展列表 | `src/client/CodeEditor.jsx:186-222` |
| 编辑器键位 | `src/client/CodeEditor.jsx:123-129`（`editorKeymap`） |
| 编辑器主题 | `src/client/CodeEditor.jsx:79-103`（`THEME`） |
| 编辑器定位到行 | `src/client/CodeEditor.jsx:229-232`、`:325-328`（`revealLine`） |
| 编辑器右键菜单 | `src/client/CodeEditor.jsx:336-353` |
| 草稿与保存 | `src/client/store.js:2109`（`updateDraft`）、`:1877`（`openFile`）、`:1884`/`:1911`（`revealLine`） |
| 草稿 vs 磁盘内容 | `src/client/EditorArea.jsx:128-133` |
| 状态栏 | `src/client/Workbench.jsx:269-278` |
| 文本搜索（兜底） | `src/host/search.js:193`（`searchFiles`）、`src/client/store.js:1510`（`fs.search` 调用）、`src/client/SearchView.jsx:27-40` |
| 设置默认值 | `src/host/settings-store.js:17-125`（`DEFAULT_SETTINGS`）、`:14`（`SETTINGS_VERSION`）、`:96-120`（`shortcuts`） |
| 设置迁移 | `src/host/settings-store.js:167-175`（`migrateLegacyShortcuts`）、`:193`（备份） |
| i18n | `src/client/i18n.js:9-448`（en，437 key）、`:450-889`（zh） |
| 客户端构建 | `scripts/build.mjs:27-41`（esbuild）、`package.json:36-40`（scripts） |
| 发布流程 | `.github/workflows/publish.yml:26-44`（build/test/publish/pack）、`package.json:102-104`（`bundleDependencies`）、`:23-35`（`files`） |
| DSH API 契约 | `docs/M0-api-findings.md:13`（`ctx.subprocess`）、`:25-28`（spawn / 无文件事件 / `node:child_process`） |
| LSP 客户端实测依据 | `node_modules/@codemirror/lsp-client/dist/index.js:547`（默认 timeout 3000）、`dist/index.d.ts`（`Transport` / `Workspace` / `findReferences`） |

## 附录 B — 术语对照

| 术语 | 含义 | 本文档位置 |
|---|---|---|
| 索引 / index | 语言服务器进程内的 program / 类型缓存（**非**磁盘产物） | §0.2 #1 |
| program | 语言服务器为工作区构建的类型信息集合 | §0.2 #1 |
| 保守版 | 仅 L0 内置补全 + 文本版查找引用，无语言服务器 | §2.3、§7.1 |
| 降级 / degraded | 语义能力不可用时的稳定状态（≠ 崩溃） | §2.7、§4.3 |
| 语义版 | LSP 提供的查找引用（`textDocument/references`） | §5.2 |
| 文本版 | `fs.search` 全文匹配的结果（标注「文本匹配」） | §5.3 |
| bundle | 语言服务器作为 npm `dependencies`（进 npm 安装路径，不进离线 tarball） | §6.3 |
| probe | 语言服务器通过 PATH 探测（不进包） | §1.4 |
| `didOpen` / `didChange` / `didClose` | LSP 文档生命周期通知 | §3.4 |
| `withMapping` | 把请求发出时的位置映射到当前文档 | §3.5 |
| `displayFile` | LSP 请求打开另一个文件的宿主回调 | §3.4、§5.1 |

## 附录 C — 后续版本候选（本轮明确不做）

| 候选 | 说明 |
|---|---|
| LSP 重命名 / 格式化 | 需先解决与 `F2`（重命名文件）、`Shift+F6`（引用更新）的键位冲突 |
| AI 内联补全（FIM） | DSH 是 AI harness，可做；需模型接入与 token 预算，是独立产品 |
| Java / Go / Rust / C++ 零配置打包 | 受限于 JDK / Go / LLVM 体积，可考虑"首次使用时按需下载" |
| 多语言服务器并发预算 | 本轮只保证同一时刻一个工作区根的语言服务器；多语言并发未测 |
| 跨工作区符号搜索 | 需要工作区级符号表，超出 LSP 单根模型 |

## 附录 D — 锚点漂移表（`v0.4.1` tag → 基线 commit）

> 本文档所有 `file:line` 锚点**均以基线 commit `dd6dc17` 为准**。下表列出同一锚点在 `v0.4.1` tag（`7895712`）上的位置，供**误用 tag 时自查**。
> 未列出的文件在两版之间**逐字节相同**（`src/index.js`、`src/host/*`、`src/client/store.js`、`src/client/CodeEditor.jsx`、`src/client/i18n.js`、`src/client/SearchView.jsx`、`scripts/build.mjs`）。

| 文件 | 锚点内容 | 基线 commit（本文档） | `v0.4.1` tag | 漂移 |
|---|---|---|---|---|
| `src/client/Workbench.jsx` | `function ProjectPicker` | **345** | 346 | +1 |
| `src/client/Workbench.jsx` | `const choice = project` | **351** | 352 | +1 |
| `src/client/Workbench.jsx` | `iwb-project-repo-badge` | **368** | 369 | +1 |
| `src/client/Workbench.jsx` | `iwb-project-current-badge` | **371** | 372 | +1 |
| `src/client/Workbench.jsx` | `iwb-statusbar` | **269** | 270 | +1 |
| `src/client/styles.js` | `.iwb-project-repo-badge` | **799** | 773 | **−26** ⚠️ |
| `src/client/styles.js` | `.iwb-project-current-badge` | **800** | 774 | **−26** ⚠️ |
| `package.json` | `"dependencies": {` | **73** | 72 | −1 |
| `package.json` | `"scripts": {` | **36** | 35 | −1 |
| `package.json` | `"files": [` | **23** | 23 | 0 |
| `package.json` | `"bundleDependencies"` | **102** | **不存在** | ⚠️ 机制缺失 |
| `.github/workflows/publish.yml` | `Pack the offline bundle` | **40** | **不存在** | ⚠️ 机制缺失 |

**在 `v0.4.1` tag 上会直接失效的 PRD 条款**：

| PRD 条款 | 在 tag 上的问题 |
|---|---|
| §6.3「语言服务器不进 `bundleDependencies`」 | tag 上没有 `bundleDependencies`，离线包机制整体不存在；该条需要**重写**（改为"本轮不改发布流程"） |
| §6.3「离线用户拿不到打包的语言服务器」 | tag 上没有离线 tarball，该风险陈述不成立 |
| §2.1 / §7 的徽标样式锚点 | 差 26 行 |
| 附录 A 的锚点速查 | `Workbench.jsx` / `styles.js` / `package.json` / `publish.yml` 四行需按上表回退 |

**结论**：本 PRD **只对基线 commit `dd6dc17` 有效**。若实现时发现工作区 HEAD 已领先该 SHA 且动过 `Workbench.jsx` / `styles.js` / `package.json` / `publish.yml`，请以**工作区实际内容**为准重新定位这四类锚点，其余锚点不受影响。

---
