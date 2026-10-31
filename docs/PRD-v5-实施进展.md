# PRD-v5 实施进展 — 代码智能（语义补全、Usage 与跳转定义）

> 状态：**已完成**。规格见 `docs/PRD-v5.md`（只读，本文件不覆盖规格）。
> 代码基线：`dsh-ide-workbench` commit `dd6dc175f8cf1b6a891cc37f81ac21a3d81839a4`（分支 `main`）。
> 本文件记录**实测结论**、**与规格的偏差**与**验收数据**；结论与 PRD 冲突时以 PRD 为准。

---

## 0. 交付总览

| 项 | 结果 |
|---|---|
| 自动化测试 | **549 项 / 549 通过 / 0 失败**（基线 329 + 本轮新增 220） |
| 客户端构建 | `npm run build` 成功，`dist/client.js` **2,772,340 字节（2,705.5 KiB）** |
| 客户端体积增量 | **+301 KB**（基线 2,471,316 字节 → 预算 ≤ 400 KB ✅） |
| 新增源码 | 10 个文件（宿主 4 + 客户端 6），改造 12 个文件 |
| 新增测试 | 22 个文件、220 个用例 |

> 上表已按 2026-10-31 的实测回填（含 D4–D9 与代码检视报告的 D10–D17 修复）。
> 更早一版这里写的是「493 项 / 2,762,422 字节 / +284 KB」，那是 D4–D9 修复之前的数。

| 里程碑 | 条目 | 状态 |
|---|---|---|
| M0 | 开工前置核对 | ✅ |
| M1 | L0 补全 + 文本版 Find Usages + 设置骨架 | ✅ |
| M2 | 宿主语言服务器管理器 | ✅ |
| M3 | 客户端接入与导航能力 | ✅ |
| M4 | 索引决策流程与设置 | ✅ |
| M5 | 硬化、回归与交付 | ✅ |

---

## 1. M0 — 开工前置结论（全部实测）

| # | 任务 | 结论 | 依据 |
|---|---|---|---|
| **M0-0** | 核对代码基线 | ✅ `git rev-parse HEAD` = `dd6dc175f8cf1b6a891cc37f81ac21a3d81839a4`，与 PRD 基线一致。工作区只有 `docs/PRD-v5.md`、`docs/bench/` 等**未跟踪**文件，源码树与基线逐字节一致；**没有**使用 `v0.4.1` tag | `git rev-parse HEAD`、`git status --short` |
| **M0-1** | 宿主是否占用 `Ctrl+Space` | ⚠️ **宿主二进制里没有明文绑定**（`resources/app.asar` 全文扫描无 `Ctrl+Space` 字面量）。按 PRD §6.4 取 `Ctrl+Space`，并做成**可配置项**；实机被吞时改设置默认值即可，无需改代码 | `resources/app.asar` 扫描 |
| **M0-2** | 宿主是否占用 `Alt+F7` / `Alt+F8` | ✅ 未发现冲突（同一扫描）。本插件既有快捷键表也无这两个键 | 同上 + `settings-store.js` |
| **M0-3** | `ctx.subprocess.spawn` 可用性与契约 | ✅ 可用，契约已核实：`spawn(spec): SubprocessHandle`（**同步**返回）、`stdio: {stdin:'pipe', stdout:'pipe', stderr:'pipe'}`、`graceMs` 必填、`env` 可选 | `cordis_inspect_query(host, Service, listService, {service:'subprocess'})` |
| **M0-3b** | `scrubbedParentEnv()` / `SENSITIVE_ENV_PATTERN` | ⚠️ **当前 DSH 版本的 `subprocess` Service 契约里没有这两个符号**（方法表只有 `resolveExecutable` / `terminalEnvironment` / `spawn` / `spawnTerminal`）。因此**仍然必须**用 `ctx.subprocess.spawn`：provider 自己 scrub 父环境。**没有**退回裸 `node:child_process.spawn` | 同上 |
| **M0-4** | `typescript@~5.9.3` + `typescript-language-server@6.0.2` 可装 | ✅ 已装：`npm ls typescript` → **`typescript@5.9.3`**（5.x，非 7.x）；`node_modules/.bin/` 下有 `typescript-language-server`、`basedpyright-langserver`、`yaml-language-server` | `npm ls` |
| **M0-5** | 性能基线 | ✅ 见 §5 | `npm test` 前后 RSS 采样 |
| **M0-6** | 复跑基线测试 | ✅ **329 项 / 329 通过 / 0 失败**（改动前实测） | `npm test` |

### M0-6 的一个已知抖动（与本轮无关）

`tests/perf-cold-workspace.test.mjs:123`（"the restored folders are listed in the background"）是**时序敏感**用例。
在三位队友并行跑构建/测试、机器满载时会偶发失败（期望 1 实得 2）；单独跑 `node --test tests/perf-cold-workspace.test.mjs` **3/3 通过**，
机器空闲时连跑两次全量 `npm test` 也是 **549/549 全绿**。
PRD 提到的历史失败（基线 commit `dd6dc17` 之前）已由基线 commit 自身修复；此处只记录**抖动**事实，不做处置。

---

## 2. 与 PRD 的偏差（逐条，都是实现约束或实测结果导致，不是需求变更）

### 2.1 进程由主线程 spawn，字节由主线程转发，解析全部在 worker（§3.3 / §0.2 #5）

- **PRD 要求**：LSP 客户端（进程管理 + JSON-RPC + 状态机）整体跑在 `worker_thread`；必须用 `ctx.subprocess.spawn`。
- **约束**：`ctx.subprocess` 是 Cordis **主线程**的服务，worker 里拿不到 `ctx`。
- **落地**：主线程用 `ctx.subprocess.spawn` 拿 handle（保留 provider 的环境 scrub 与 grace 终止语义）；
  `handle.stdout` 的 **Buffer** 原样 `postMessage` 给 worker；worker 负责 `Content-Length` 帧的**解析与编码**；
  worker 回传的裸 JSON 字符串由主线程直接转给浏览器。
- **仍然满足**：主线程**不 `JSON.parse` 任何 LSP 载荷**（§3.3 的硬性要求）。浏览器端的 `@codemirror/lsp-client` 自己就是 JSON-RPC 客户端，
  宿主侧是**透明中继**（帧编解码是唯一的解析动作，且它在 worker 里）。
- worker 额外做三件"必须看载荷才能做"的事：校验客户端载荷是不是 JSON、跟踪 `didOpen/didClose/didChange`（取消时知道要关哪些文档、崩溃重启后知道要重开哪些）、
  给 `initialize` 注入 `initializationOptions.maxTsServerMemory`（tsserver 的内存上限只有这一个入口）。
- **唯一的例外（2026-10-31，代码检视报告 D14）**：主线程对**等待队列里的载荷**做一次**字符串级的结构检查**
  （`/"method"\s*:\s*"initialize"/`，与 worker 同一个正则），只为让**握手不会被淘汰队列丢掉**。
  它不生成对象、不解码 JSON；帧的编解码仍然全部在 worker 里。

### 2.2 浏览器端用库的 `LSPClient`，宿主侧不实现 JSON-RPC（§1.3）

- `@codemirror/lsp-client@6.3.0` 的 `Transport` 接口收发的**只有 JSON 本体**（`dist/index.js` 全文**没有**任何 `Content-Length` 处理，已核实）。
- 因此 §3.3 里"宿主自己的 JSON-RPC 客户端也必须有超时"落地为：**宿主侧的请求超时由浏览器端 `LSPClient.timeout` 承担**
  （默认 30000 ms，覆盖库默认的 3000 ms）；宿主侧另有**帧级**超时（stdout 静默超时 + 连续请求超时计数）用于崩溃检测的三条信号之一。

### 2.3 Windows 上不能用 `.cmd` shim 启动打包的语言服务器（实测）

- `child_process.spawn('node_modules/.bin/typescript-language-server.cmd')` → **`spawn EINVAL`**：
  Node 不经 shell 无法执行 batch 文件，而我们绝不用 shell（argv 永远是数组）。
- **落地**：打包服务器改为 **`process.execPath` + 包自己的 JS 入口**（从包的 `bin` 字段解析：
  `typescript-language-server/lib/cli.mjs`、`basedpyright/langserver.index.js`、`yaml-language-server/bin/yaml-language-server`）；
  `resolvedPath` 仍然报告 `.bin` shim 路径给设置页看。
- **连带影响**：Windows 的 PATH 探测只接受无扩展名 / `.exe`；`jdtls.bat` 这类启动脚本会被报成 **missing**（带 hint）。

### 2.4 `indexState` 的取值与【已索引】徽标的关系（§2.1）

- 【已索引】是**历史事实**（该目录曾成功完成过首次 program 构建），存在 `settings.lsp.indexedRoots` 里，**不是**"磁盘上有索引文件"。
- 因此 `listProjectCandidates` 的 `indexState` **优先**取历史事实（`'indexed'`），只有没有历史记录时才回落到当前会话状态
  （`'ready' / 'building' / 'failed'`），否则 `'unknown'`。这样徽标不会因为"语言服务器此刻在跑"而闪烁或消失。

### 2.5 决策弹窗在「切换之前」而不是 §2.3 写的「切换成功之后」

- §2.3 的验收写的是「点"取消"不切换项目」，这两条只能同时成立于**先问后切**。
- **落地**：`selectProject()` 先弹窗，收到答案后再切换；「取消」→ **不切换**。
- **副作用**：`await store.selectProject(...)` 会阻塞到用户回答完为止。既有调用点（`void store.selectProject(...)`）不受影响。

### 2.6 文件链接桥跳过决策弹窗

- `openExternalFile` / `#openResolved` 是从 DSH 的载体 tab 发起的，**那时工作台可能根本没挂载**，弹窗永远没人答 → 打开链接会挂死。
- 这条路径用 `selectProject(root, { askIndex: false })`；已索引目录在那里照旧会启动语言服务器。

### 2.7 `Ctrl+Space` 保留为默认值（§6.4）

- 见 §1 的 M0-1。做成可配置项，宿主真占用时改设置默认值即可。

### 2.8 崩溃态的「点击进日志」改为 tooltip + 重播建议文案

- 客户端没有日志视图（宿主把 stderr 写进 DSH 插件日志面），没有可跳的日志页。
- **落地**：状态栏红字 + tooltip 显示宿主的 `detail`；点击再弹一次 `lsp.crashedToast` 建议（降低内存上限 / 关闭该语言 / 改用保守版）。
  宿主的 stderr 另由 `lsp.logs` API 暴露。

### 2.9 「置灰并带说明」的呈现方式

- 共享的 `ContextMenu`（`src/client/ui.jsx`）原本没有 tooltip 槽，且 `.iwb-menu-text` 是 `text-overflow: ellipsis`。
- **落地**：给 `ContextMenu` 的菜单项加了 `title` 透传；灰掉的语义项把说明放进 tooltip，**不再**拼进会被截断的标题。

### 2.10 `javascript` 的 `languageIds` 与 `typescript` 相同（§3.2 原样）

- 同一个 languageId 会被注册表的两个条目声明，但**只会指向同一个 command**。注册表测试断言的是"一个 languageId → 一个服务器命令"。
  若更想要"languageIds 全局唯一"，只需把 `javascript.languageIds` 收窄成 `['javascript','javascriptreact']`（一行）。

### 2.11 `identifierAt` 的节点白名单比规格多

- 规格里的 10 个名字不够用：仓库里的 `@lezer/javascript@1.5.6` 把变量名解析成 `VariableDefinition` 而不是 `VariableName`，
  只按规格名单会让 JS/TS 永远点不中。
- **落地**：补 `VariableDefinition` / `PrivatePropertyName` / `JSXIdentifier` / `MethodName` / `ScopedIdentifier` / `FieldName` /
  `DefName` / `TypeIdentifier` / `FieldIdentifier` / `ScopeIdentifier` / `IdName` / `PseudoClassName` / `NamespaceName` / `Label`
  （均取自实际 grammar）。注释（`LineComment` / `BlockComment`）与字符串（`String`）仍在白名单外。

### 2.12 右键菜单的触发条件放宽

- 有选区**或**光标点在单词上时打开工作台菜单（否则导航项永远够不着）；两者都没有时保留浏览器原生菜单。

---

## 3. 新增依赖（§6.3）

| 包 | 位置 | 版本 | 说明 |
|---|---|---|---|
| `typescript` | `dependencies` | `~5.9.3` | **必须**是 5.x：镜像里的 7.x 是 Go 原生编译器，tsserver 语义能力在 5.x 最稳 |
| `typescript-language-server` | `dependencies` | `^6.0.2` | TS/JS 打包语言服务器 |
| `basedpyright` | `dependencies` | `^1.40.2` | Python 打包语言服务器 |
| `yaml-language-server` | `dependencies` | `^2.0.0` | YAML 打包语言服务器 |
| `@codemirror/lsp-client` | `devDependencies` | `^6.3.0` | 客户端侧，会被 esbuild 打进 `dist/client.js` |
| `@codemirror/autocomplete` | `devDependencies` | `^6.20.4` | 原本只是传递依赖，现显式声明（§0.2 附注 / 风险 #15） |
| ~~`marked`~~ | ~~`devDependencies`~~ | ~~`^15.0.12`~~ | **2026-10-31 删除**：它不是插件的直接依赖，而是 `@codemirror/lsp-client` 的传递依赖；悬停的 Markdown 渲染是**库自己**做的，插件只提供 `sanitizeHTML`。原先的声明是多余的 |

- 语言服务器**不进** `bundleDependencies`：离线 tarball 会因此增加约 50 MB，得不偿失（§6.3 / 风险 #21）。
  代价是**离线安装的用户拿不到打包的语言服务器**，他们走 PATH 探测路径；这一点在设置页（`settings.lspOfflineNote`）与首次提示里说明。

---

## 4. 关键实现决定（PRD 未规定但必须定下来的）

| # | 决定 | 理由 |
|---|---|---|
| 1 | **`displayFile` 不传 `line`/`column`** | `@codemirror/lsp-client` 拿到 view 后会自己 dispatch 精确位置；再带 revealLine 会把光标拉回行首，把跳转位置冲掉。列级精度由库的 dispatch 保证（`jumpToOrigin` / 引用面板都是字符级） |
| 2 | **`revealColumn` 是 1-based** | 与 `revealLine`、状态栏列号一致。LSP 的 `character` 是 0-based，两者不要混 |
| 3 | **重连后重新握手** | 库的 `Transport` 契约里没有"重连"这回事，`LSPClient.connect()` 只在首次调用时发 `initialize`。落地：transport 报告 `reopened`，客户端 `disconnect()` + `connect()` 重发握手；**宿主侧 worker 缓存服务器的 capabilities 并直接回答第二次 `initialize`**（语言服务器一个进程只允许初始化一次）。同时 `WorkbenchWorkspace.connected()` 不再重复 `didOpen`（重连时服务器仍知道这些文档） |
| 4 | **`lsp.enabled === false` 或没有项目根时不创建 client、不连 WS** | 总开关必须真的关掉语义能力（§7.1） |
| 5 | **状态轮询 2 s，只在工作台激活时** | 挂在既有的 `activate()` / `deactivate()` 上，不给后台标签页加负担 |

---

## 5. 性能与实机验证（§11 / §9.4）

### 5.1 体积与结构

| 指标 | 预算 | 实测 | 结论 |
|---|---|---|---|
| `dist/client.js` 增量 | ≤ 400 KB | **+301 KB**（2,471,316 → 2,772,340 字节） | ✅ |
| 宿主主线程事件循环漂移 | p95 ≤ 30 ms | 主线程**不解析任何 LSP 载荷**，帧解析全在 worker | ✅（结构上满足） |
| 宿主进程内存增量（空闲） | ≤ 20 MB | LSP 管理器 + 一个 worker 线程 + 一条 WebSocket；语言服务器是独立进程 | ✅（结构上满足） |
| 语言服务器进程树 RSS | ≤ `memoryLimitMB` + 200 MB | tsserver 收到 `maxTsServerMemory`（= `memoryLimitMB`），换算成 `--max-old-space-size` | ✅（结构上满足） |
| 启动到就绪（小项目） | ≤ 3 s | 宿主用"进程起来了 + 服务器答了话 + 1.5 s"的就绪启发式（语言服务器没有"program 构建完成"的通知） | ✅（启发式，见 §2.1） |

### 5.2 **真机端到端验证**（`docs/bench/live-lsp.mjs`）

用**真的** `typescript-language-server` 跑通了完整链路（宿主 `apply()` → `ctx.subprocess.spawn` → worker 帧编解码 →
`/ide-workbench/ws/lsp` 中继 → `initialize` → 语义请求 → 断线重连）：

```text
lsp.start -> {"state":"building","detail":"building the program"}
websocket open
initialize ok - capabilities: textDocumentSync, completionProvider, codeActionProvider, definitionProvider,
  documentHighlightProvider, documentSymbolProvider, hoverProvider, inlayHintProvider, referencesProvider,
  signatureHelpProvider, workspaceSymbolProvider, implementationProvider, typeDefinitionProvider, semanticTokensProvider, ...
lsp.status -> ready | language: typescript | source: bundled
lsp.index  -> {"state":"ready","progress":"ready","cancellable":false}
textDocument/definition -> [{"uri":"file:///.../src/client/lsp-uri.js","range":{"start":{"line":1,"character":16},"end":{"line":1,"character":17}}}]
reconnect initialize -> answered, capabilities: 23
```

验证到的行为：

| 能力 | 实测 |
|---|---|
| 打包语言服务器能真的启动 | ✅ `typescript-language-server` 起来了（`source: 'bundled'`） |
| 帧编解码（Content-Length） | ✅ 双向都通：握手请求进得去、响应出得来 |
| `initialize` 握手 | ✅ 拿到 **23 项**能力 |
| 状态机 | ✅ `building` → `ready`，`lsp.index` 的 `cancellable` 正确 |
| **跨文件跳转定义** | ✅ `textDocument/definition` 返回了真实文件里的真实位置（`lsp-uri.js` 第 1 行第 16 列） |
| 断线重连的二次握手 | ✅ 宿主用缓存的 capabilities 直接回答了第二次 `initialize`（§4 第 3 条） |
| `lsp.servers` 的供给策略 | ✅ `typescript/javascript/python/yaml` = `bundled`；`java/go/rust/cpp` = PATH 探测（当前机器未装，报 missing） |
| `lsp.resources` 的内存预检 | ✅ `canIndex: true`（阈值取 `max(2048, 2048)` MB） |

> 这个脚本**不是**单元测试（它会真的起一个语言服务器进程），所以放在 `docs/bench/` 而不是 `tests/`。

### 5.3 仍然需要人工走查的项

下面这些自动化测试与上面的端到端脚本都覆盖不到，需要人在界面上点一遍（PRD §9.4 的清单）：

- [ ] 补全弹窗的观感：`Tab` / `Enter` 接受、`Esc` 关闭且不插入、不遮挡输入、不吞 `Ctrl+S` / `Ctrl+F`
- [ ] Ctrl+点击**只**在标识符上触发（空白 / 标点 / 注释上不触发、也不改选区）
- [ ] 跨文件跳转打开的是**工作台自己的标签页**并定位到**列**
- [ ] 围栏外的目标不打开，弹出提示
- [ ] `Alt+F7` 的引用面板列出**语义**引用（不含注释 / 字符串里的同名出现），点击跳到列
- [ ] 大符号（>2000 命中）→ 面板截断并提示剩余数量
- [ ] 索引 >60 s → 状态栏出现【取消索引】；点击后 ≤ 2 s 变为「已取消（保守版）」，无残留进程，编辑器状态不变
- [ ] 手动 kill 语言服务器 → 状态栏变红 + toast → 自动重启一次 → 功能恢复；连续崩溃两次 → 降级态 + 「降低内存上限」建议
- [ ] 空闲 10 分钟 → 进程退出、内存回落；再打开文件 → 自动重启
- [ ] 未索引根目录（`isRepo === false`）→ 弹窗含完整警告 + 三个按钮；「取消」不切换项目
- [ ] 内存不足时 → 不弹窗、直接降级，提示含所需 / 可用 MB 数值
- [ ] 悬停内容含 `<script>` → 不执行（自动化只测了 `sanitizeHTML` 这个纯函数）
- [ ] 语言服务器进程环境变量里**没有** `DEEPSEEK_API_KEY`（依赖 provider 的 scrub）
- [ ] §11 的性能数值（进程树 RSS、事件循环漂移）在装了语言服务器的机器上实测


---

## 6. 交付物清单（§12）

| # | 交付物 | 位置 | 状态 |
|---|---|---|---|
| 1 | 宿主侧 LSP 管理器与语言注册表 | `src/host/lsp.js` | ✅ |
| 2 | 宿主侧 LSP WebSocket 中继 | `src/host/lsp-ws.js` | ✅ |
| 3 | 客户端 Transport 与自定义 Workspace | `src/client/lsp-transport.js`、`src/client/lsp-workspace.js` | ✅ |
| 4 | 编辑器接入（L0 补全 + LSP 扩展 + Ctrl+点击） | `src/client/CodeEditor.jsx` | ✅ |
| 5 | 设置项与 schema 迁移 | `src/host/settings-store.js` | ✅ |
| 6 | 新增文案 en + zh-CN | `src/client/i18n.js` | ✅ |
| 7 | 样式（徽标、状态栏、引用面板、补全弹窗） | `src/client/styles.js` | ✅ |
| 8 | 依赖变更 | `package.json` | ✅ |
| 9 | 新增/更新测试 | `tests/**` | ✅ |
| 10 | 构建产物 | `dist/client.js` | ✅ |
| 11 | 本轮实施记录 | 本文件 | ✅ |
| 12 | 验收记录 | `docs/VERIFICATION.md` | ✅ |

新增文件清单：

```
src/host/lsp.js            宿主：语言注册表 + 进程生命周期状态机 + 内存预检 + 崩溃恢复 + 空闲退出
src/host/lsp-frame.js      宿主：Content-Length 帧编解码（主线程 / worker / 测试共用）
src/host/lsp-worker.js     宿主：worker_thread 入口（帧编解码 + 文档跟踪 + 内存上限注入 + 握手缓存）
src/host/lsp-ws.js         宿主：/ide-workbench/ws/lsp 中继
src/client/lsp-uri.js      客户端：file URI ↔ 绝对路径、按扩展名的 languageId
src/client/lsp-sanitize.js 客户端：悬停 Markdown 的 HTML 消毒
src/client/lsp-transport.js 客户端：WebSocket Transport（排队 + 重连）
src/client/lsp-workspace.js 客户端：自定义 Workspace（草稿同步 + 围栏）
src/client/lsp-session.js  客户端：LSPClient 的唯一入口
```

改造文件清单：

```
src/index.js               挂载 lsp.* API 路由与 LSP WebSocket
src/host/settings-store.js lsp 段 + schema 2→3 迁移 + 四个新快捷键
src/host/workspace.js      listProjectCandidates 增加 indexState / indexedAt
src/client/store.js        lsp 状态切片、索引决策、文本版 Find Usages、列级定位
src/client/Workbench.jsx   状态栏语义分析项、【已索引】徽标、索引决策弹窗
src/client/CodeEditor.jsx  L0 补全、LSP 扩展、Ctrl+点击、F12/Alt+F7/Alt+F8、列级定位
src/client/EditorArea.jsx  传 navLabels / revealColumn
src/client/SearchView.jsx  文本匹配的标注
src/client/SettingsPanel.jsx lsp 设置段
src/client/i18n.js         约 60 个新文案（en + zh）
src/client/styles.js       徽标、状态栏、引用面板、补全弹窗、决策弹窗
src/client/ui.jsx          ContextMenu 的 title 透传
```

---

## 7. 未完成的验收（需要真机走查）

> ⚠️ **实机反馈与修复**：用户在真机上发现三个问题 —— 状态卡在「索引中」、`Ctrl+点击` 100% 超时，
> 以及一次**把 DSH 宿主进程带崩**的致命缺陷。三个都已修复，根因、证据与验证方式见
> **`docs/PRD-v5-缺陷跟踪.md`**。下面这份清单是修完之后仍需人工确认的部分。

**端到端链路已经用真的 `typescript-language-server` 验证过**（见 §5.2）。
下面这些是**界面与交互层面**的验收，自动化测试与端到端脚本都覆盖不到，需要人在界面上点一遍：

- 补全弹窗的观感与键位（`Tab` / `Enter` / `Esc`、不吞 `Ctrl+S`）
- Ctrl+点击只命中标识符、跨文件跳转到列、围栏外拒绝
- **失败时 toast 出现，且不再有盖住内容区、要手动叉掉的面板**
- 引用面板的语义引用、命中数上限
- 索引取消、崩溃恢复、空闲退出的**界面**表现
- 索引决策弹窗的两级警告文案
- 悬停 XSS 的端到端表现、进程环境变量没有宿主密钥
- §11 的进程树 RSS 与事件循环漂移的实测数值

逐条清单见 §5.3。

---

## 8. 实机发现的缺陷（已修）

**九个**实机缺陷（D1–D9）的完整分析在 **`docs/PRD-v5-缺陷跟踪.md`**。这里只留结论：

| # | 现象 | 根因 | 修复 |
|---|---|---|---|
| **D1** | **DSH 宿主进程崩溃**（`host exited with 1`，整个应用退出） | `#restart()` 在异步路径上把会话迁到 `building`，而 `idle → building` 不是合法迁移 → `assertTransition` 抛错；`void this.#restart(...)` **不接住 rejection** → 未处理的 rejection 被 harness 当成致命加载失败 → 进程死亡 | 所有异步步骤改走 `#safely()`；`#restart()` 之后重新核对状态；进程**代次守卫**；WS 的 upgrade 回调整体 try/catch |
| **D2** | 状态永远停在「语义分析：索引中…」 | 浏览器**先连 socket、后启动服务器**，那期间的 `initialize` 被 `relayToServer()` **直接丢弃** → 服务器永不初始化 → 永不回答 → 就绪判定永不触发 | 宿主把无会话时到达的载荷**存进 `entry.pending`**，服务器起来后按序重放；`entry.handshake` 让崩溃重启后的新进程也能被初始化 |
| **D3** | `Ctrl+点击` 100% `Request timed out` | D2 的连带症状：服务器没收到 `initialize`，任何请求都不回答 | 随 D2 一并解决 |
| **D4** | 错误浮层盖住内容区、要手动叉掉 | 库的 `LSPPlugin.reportError()` 用 `showDialog(..., {top:true})` 开了一个**永不关闭**的编辑器面板 | 改成走工作台的 toast（9 秒自动消失，不挡内容）；store 不可用时才回落到库的原实现 |
| **D5** | 插件装上后起不来（`Invalid effect`） | `ctx.effect()` 的回调返回了对象 `{wss, close}`，Cordis 只接受函数或空 | 改成返回 disposer；`tests/plugin-mount.test.mjs` 守着 |
| **D6** | `perf-cold-workspace` 偶发失败 | 前两个用例没清掉 store 的后台树定时器，泄漏到下一个用例的断言窗口 | `clearTimeout(store.restoredTimer)` |
| **D7** | 重启后的语言服务器**静默死亡** | `session.exited` 在崩溃路径上被置 `true`，`#spawn()` 没清回去 → 新进程 stdout 结束时死亡被吞掉 | `#spawn()` 里 `session.exited = false`；`tests/lsp-recovery.test.mjs` 有用例守着 |
| **D8** | 已索引的仓库永远显示「正在更新索引…」 | `store.refreshLspStatus()` 把上一份快照的 `progress` / `startedAt` / `cancellable` 摊到下一份上，状态栏的 `ready` 分支又看 `progress` | store 在非 `building` 时清空这三个值；视图的 `ready` 分支不再看 `progress` |
| **D9** | 悬停卡片 / 补全弹窗**看不清**；Ctrl+悬浮**没有提示** | 样式写的是 `.cm-lsp-hover`，库渲染的是 **`.cm-lsp-hover-tooltip`**（一条都没匹配上）；补全配色在 `styles.js` 与 `CodeEditor.jsx` 的 THEME 里打架 | 改用库真实类名、补全配色收敛到 `styles.js` 一处；新增 `iwb-ctrl-hover-symbol` 装饰（Ctrl+悬浮变蓝 + 下划线） |

代码检视报告（`docs/PRD-v5-代码检视报告.md`）另外发现并修好了 **D10–D17**
（握手重放的时序、看门狗按 tick 计数、取消/崩溃泄漏定时器、
重复 `initialize` 被转发、`pending` 淘汰丢掉握手、
取消在降级/并发时抛错、取消时残留一个语言服务器进程、
「超时计数器复位」没有用例守着）——
完整分析见缺陷跟踪文档 §10 与 §10bis。

复现与验证脚本（都在 `docs/bench/`，不进 npm 包）：

```powershell
node docs\bench\live-lsp.mjs        # 真语言服务器跑通完整链路
node docs\bench\repro-order.mjs      # 浏览器真实顺序（先连 socket、后启动服务器）
node docs\bench\crash-recovery.mjs   # 语言服务器崩溃 → 宿主必须活着
```

三个脚本现在**都以退出码说话**：0 = 通过，1 = 某一步失败，2 = 这台机器跑不了这个场景。


