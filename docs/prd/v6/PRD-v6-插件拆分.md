# PRD-v6 插件拆分规格 —— core（IDE 工作台）与 codeintel（代码智能）分离

> **状态**：**待评审**（本文件是规格，不含实施记录；评审通过后才开始改代码）。
> **触发**：2026-11-02 用户拍板的需求——当前插件因内置智能代码而**变重**且**使用上不稳定**；要求按提交边界把「智能代码」拆成独立插件，core 回到干净基线。
> **代码基线**：`dsh-ide-workbench` commit **`b2317fa`**（分支 `main`，版本 `0.5.1`）。
> **拆分基线**：**`dd6dc17`**（core 顶点）／**`4b2b7dc`**（代码智能线的第一个提交）。
> **运行时基线**：本机安装的 `@deepseek-ai/dsh@0.2.0-rc.2`（全局 `npm root -g`）。
> **配套**：本文档即本轮唯一规格；配套记录（实施进展、代码检视报告）在评审通过后另建 `PRD-v6-实施进展.md` 与 `PRD-v6-代码检视报告*.md`。
> **前序规格**（只读，不被本文覆盖）：`docs/prd/v5/PRD-v5.md`、`docs/prd/v5/PRD-v5-改造需求.md`、`docs/prd/v5.1/PRD-v5.1.md`、`docs/prd/v5.1/PRD-v5.1-实施契约.md`、`docs/M0-api-findings.md`。

---

## 0. 一页速览

### 0.1 结论

本轮**不改功能**，只改**归属与装载方式**。目标态：

| 安装态 | 用户看到 | 硬约束 |
|---|---|---|
| **只装 core** | 干净的 `v0.4.1 ~ dd6dc17` 体验：项目树 / 提交 / 终端 / Git 四窗 + 内置编辑器 + 文件定位 + 仓库选择器。**没有任何补全**（但**保留自动闭合括号**，D9） | core 不得携带任何语言服务器、任何**补全**扩展、任何内存预算逻辑 |
| **只装 codeintel** | 有编辑器可挂、但没有工作台。codeintel 给出**明确引导**（toast + 设置页说明），不报错、不空转 | codeintel 不得因为缺 core 而抛未捕获异常 |
| **双装** | 等价于当前 `HEAD` 的功能面；**自动闭合括号由 codeintel 生效、core 让位**（D9） | 代码智能的故障**完全隔离**在 codeintel 内；崩溃 / 内存问题**不拖垮** core 与 DSH 宿主 |

组织形态：**同一仓库 monorepo**（`packages/workbench` + `packages/codeintel`），两个包可分别安装 / 更新 / 发版。

### 0.2 基线认定（事实核实，先读，否则会拆错）

用户表述为「core 只保留 `4b2b7dc`（= `dd6dc17`）的功能」。**实测认定**：

```
4b2b7dc  feat(code): add semantic completion, go to definition and find usages   ← 代码智能线的第一个提交
  └─ dd6dc17  perf(tree): keep the status aggregate's identity ...              ← 4b2b7dc 的直接父提交
```

| 事实 | 依据 |
|---|---|
| `dd6dc17` 是 `4b2b7dc` 的**直接父提交** | `git rev-parse 4b2b7dc^` → `dd6dc17` |
| `dd6dc17` 处**没有任何**代码智能文件 | `git ls-tree -r dd6dc17 -- src` 中**无** `lsp*` / `java-runtime` / `semantic-methods` / `SearchPopup` |
| `dd6dc17` 处**没有** `@codemirror/autocomplete` 依赖 | `git show dd6dc17:package.json` 的 devDependencies 里没有它 |
| `v0.4.1` 是 `dd6dc17` 的祖先 | `git merge-base --is-ancestor v0.4.1 dd6dc17` → exit 0 |
| `v0.4.1 → dd6dc17` 之间 7 个提交，全部与代码智能无关 | `git log --oneline v0.4.1..dd6dc17` |
| `dd6dc17 → HEAD` 共 **45** 个提交 | `git log --oneline dd6dc17..HEAD` |
| `src/` 文件数 48 → 62 | `git ls-tree` 计数 |

⇒ **core 的功能基线 = `dd6dc17` 的功能面**（无任何补全）；`4b2b7dc` 是**分界线**，它本身属于代码智能。

> ⚠️ **不是字面的 `dd6dc17` 代码**。`dd6dc17` 之后有 **12 处**纯 core 的修复（§1.4），必须回移到 core，否则 core 会比 `v0.4.1` 还旧。**core = `dd6dc17` 的功能面 + 这 12 处纯 core 修复。**

### 0.3 决策回填表

| # | 决策项 | 结论 | 依据 / 说明 |
|---|---|---|---|
| D1 | **组织方式** | ✅ 同一仓库 monorepo：`packages/workbench`（core）+ `packages/codeintel`（代码智能），可分别安装 / 更新 / 发版 | 用户拍板 |
| D2 | **功能归属** | ✅ 严格按边界：本地补全、语义补全、跳转定义、查找用法（语义 + 文本 Alt+F8）、悬浮 / 签名、内存预算、Java/JDTLS、搜索弹层，**全部归 codeintel**；core 编辑器 = `dd6dc17` 基线（无任何补全） | 用户拍板 |
| D3 | **实施节奏** | ✅ 先出需求设计文档（契约签名 / 迁移方案 / 验收清单），**评审通过前不改任何代码** | 用户拍板 |
| D4 | **core 的包名** | ✅ 保持 `dsh-ide-workbench` 不变 | 包名即插件 ID（`docs/M0-api-findings.md:11`）。保持不变 ⇒ 已装用户原地升级，不产生第二个「工作台」 |
| D5 | **codeintel 的包名** | ✅ `dsh-ide-codeintel` | 与 core 同一命名族；DSH 侧是**两个独立 bundle、两条 patch 层、两个 Loader 条目**（`@deepseek-ai/dsh-app-boot` profile 合成） |
| D6 | **契约的传输层** | ✅ 宿主侧 = **Cordis 服务总线**；客户端 UI 侧 = **槽位（slot）**；编辑器与 CodeMirror 运行时 = **契约对象交付** | 见 §3；依据 = DSH 运行时真实能力（§1.5） |
| D7 | **内存预算的归属** | ✅ 归 codeintel，**连同设置一起**（独立的 `settings.json`） | 用户明确要求「内存预算等能力由智能插件自行维护」 |
| D8 | **core 是否可以知道 codeintel 的存在** | ❌ **不可以**。core 不得 `import`、不得探测、不得依赖 codeintel | 「只装 core ⇔ 干净体验」的前提 |
| **D9** | **自动闭合括号（`closeBrackets`）** | ✅ **core 保留一份**（它是一般编辑能力，不是代码智能）；**codeintel 也带一份**；**双装时 core 自动为 codeintel 让位** | 评审拍板（O1）。让位由 **CTR-06 扩展槽位**机制实现，不做特判。详见 §3.4.1 |
| **D10** | **O2–O7** | ✅ 全部采纳本文档的建议（见 §6） | 评审拍板 |

### 0.4 条目一览

| ID | 条目 | 类型 | 优先级 | 一句话验收 |
|---|---|---|---|---|
| **ORG-01** | 仓库改为 monorepo，两包独立构建与发版 | 架构 | P0 | `packages/workbench` 与 `packages/codeintel` 各自产出可安装的插件包 |
| **ORG-02** | 契约包 `packages/contract` 独立 | 架构 | P0 | 两包都依赖它，且它不依赖任何一包 |
| **CUT-01** | 13 个新增文件整体迁移到 codeintel（12 个零改动 + `settings-defaults.js`） | 迁移 | P0 | 12 428 行搬运 |
| **CUT-02** | `src/host/guard.js` 留在 core（终端socket 在用） | 迁移 | P0 | codeintel 自带一份副本 |
| **CUT-03** | `src/host/settings-defaults.js` 随 `lsp` 设置段整体迁移 | 迁移 | P0 | core 的设置文档不再含 `lsp` 段 |
| **CUT-04** | `src/index.js` 切分：11 条 `lsp.*` 路由 + LSP WS + LSP 错误分支 | 迁移 | P0 | core 的 `src/index.js` 不再 import 任何 lsp 模块 |
| **CUT-05** | `src/client/store.js` 切分：`lsp` 切片 + ~40 个方法 | 迁移 | P0 | core store 不再含 `state.lsp` |
| **CUT-06** | `src/client/CodeEditor.jsx` 切分：`autocompletion` / 导航 / Ctrl+hover 归 codeintel；**`closeBrackets` 留 core** | 迁移 | P0 | core 编辑器无 `autocompletion`、无 `LSPPlugin`，但**有**自动闭合括号 |
| **CUT-07** | `src/client/Workbench.jsx` 切分：状态栏条目 + 三个弹窗 | 迁移 | P0 | 状态栏的语义分析格由 codeintel 贡献 |
| **CUT-08** | `src/client/SettingsPanel.jsx` 切分：整个 `lsp` 分组 | 迁移 | P0 | 设置页无 `lsp` 分组 |
| **CUT-09** | `src/client/styles.js` 切分 + **新建 CSS 接缝** | 迁移 + 架构 | P0 | 两个插件各自注入自己的 `<style>` |
| **CUT-10** | `src/client/i18n.js` 按键前缀切分 | 迁移 | P0 | codeintel 用 `ctx.locale.register` 注册自己的命名空间 |
| **CUT-11** | `src/host/settings-store.js` 切分：`lsp` 段 / 迁移函数 / 4 个快捷键 | 迁移 | P0 | core 的 `SETTINGS_VERSION` 重新定版并记录「移除 lsp 段」 |
| **CUT-12** | `src/client/EditorArea.jsx` 切分（`navLabels` / `revealColumn` / 搜索弹层） | 迁移 | P1 | 见 §4.3 |
| **BACK-01** | 12 处纯 core 修复回移 | 迁移 | P0 | 见 §1.4 清单，逐条有测试 |
| **CTR-01** | 宿主侧契约：Cordis 服务 `dsh-ide-workbench.contract` | 契约 | P0 | 见 §3.2 |
| **CTR-02** | 客户端契约：4 个槽位 + 渲染点属性 | 契约 | P0 | 见 §3.3 |
| **CTR-03** | 编辑器接缝：`registerExtensions` / `registerKeymap` / `registerCommands` | 契约 | P0 | 见 §3.4 |
| **CTR-04** | **CodeMirror 单实例交付** | 契约 | **P0** | 见 §3.5（**本轮最大技术风险**） |
| **CTR-05** | 契约版本协商与降级矩阵 | 契约 | P0 | 见 §3.6 |
| **CTR-06** | **扩展槽位与让位机制**（同 key 取高优先级；core 的 `closeBrackets` 在双装时让位） | 契约 | P0 | 见 §3.4.1；验收：双装时括号**只闭合一次**，且**生效方确定**（不随加载顺序漂移） |
| **ISO-01** | 故障归属改为「注册表」而非「栈前缀匹配单插件目录」 | 隔离 | P0 | codeintel 的未捕获异常**不**杀死 DSH 宿主 |
| **ISO-02** | 进程级只装一个 `uncaughtException` 处理器 | 隔离 | P0 | 两个插件都装边界时**不重复再分发** |
| **ISO-03** | codeintel 的内存预算与语言服务器进程**只**归 codeintel 拥有 | 隔离 | P0 | core 进程树里没有任何语言服务器 |
| **DEG-01** | 只装 codeintel 时的引导（toast + 设置页说明） | 体验 | P0 | 明确告知「缺少 IDE 工作台」并给出安装指引 |
| **DEG-02** | 只装 codeintel 时的独立降级（用 session cwd / 工作区列表当项目根） | 体验 | P1 | 不报错，能对当前目录起语言服务器 |
| **MIG-01** | 旧 `lsp` 设置段的一次性导入到 codeintel 自己的设置文件 | 迁移 | P1 | 升级后记忆预算 / 空闲策略不丢 |
| **REL-01** | 两个包独立版本线与发版流程 | 发版 | P1 | core 与 codeintel 可分别升版 |

### 0.5 非目标

- **不做** AI 内联补全（FIM）、**不做** LSP 重命名 / 格式化（沿用 `docs/prd/v5/PRD-v5.md` §0.2 #6）。
- **不做**代码图（codegraph）引入（沿用 `docs/prd/v5/PRD-v5.md` §0.1 的决策）。
- **不改变**任何代码智能的**行为语义**：内存闸门算式、状态机、请求预算口径、索引决策优先级**一律不动**。本轮只搬家，不改逻辑。
- **不重构** core 的工作台内部结构（Project / Commit / Terminal / Git 四窗的代码组织）。
- **不改** DSH 宿主（本轮**不需要** DSH 侧任何改动；§1.5 已核实所需的协作机制宿主已具备）。
- **不承诺**「双装后与当前 HEAD 逐像素一致」——只承诺**功能面等价**（§5.3 逐条列出等价项）。
- **不把** `docs/prd/v5.1/` 的规格搬进本文档——本文只管归属与装载。

---

## 1. 事实核实（拆分现状）

### 1.1 规模总览

`dd6dc17 → HEAD` 共 45 个提交，`src/` 从 48 个文件长到 62 个（**31 个文件有改动，+19 351 / −269 行**），`tests/` 从 46 个文件长到 120 个。提交主题分布：

| 主题 | 数量 | 代表提交 |
|---|---|---|
| 代码智能功能 | 6 | `4b2b7dc`（奠基）、`354fa58`（搜索弹层 + 分级内存预算）、`51f6aba`（Java/JDTLS） |
| 代码智能缺陷修复 | 22 | `59ef905`（一个语言服务器不能拖垮整个 IDE）、`ed38e4e`、`7cc7227`、`3b16214`、`55ce1bf` |
| 文档 | 11 | `cb37295`（PRD 归档） |
| 测试 | 2 | `d223d4f`、`b2317fa` |
| CI / 发版 | 2 | `68f971f`、`1124f52` |
| **纯 core 的改动（混在代码智能提交里）** | **12 处 hunk** | 见 §1.4 |

⇒ **没有任何一个提交是纯 core 的。** 所有 core 改动都混在代码智能提交里 ⇒ 拆分**不能按提交切**，只能**按 hunk 切**。

### 1.2 整体迁移（零改动搬运）

`git diff --diff-filter=A dd6dc17..HEAD -- src/` 的结果——**14 个文件**在基线之后全新出现。其中 **13 个**整体搬进 codeintel（12 个零改动 + `settings-defaults.js`，它带一个例外见下），**1 个**（`guard.js`）留在 core：

| 文件 | 行数 | 归属 | 备注 |
|---|---|---|---|
| `src/host/lsp.js` | 5 891 | codeintel | 语言服务器管理器（进程 / 状态机 / 内存闸门 / 注册表） |
| `src/host/java-runtime.js` | 1 400 | codeintel | JDTLS / JDK 发现与 JVM argv |
| `src/host/lsp-worker.js` | 481 | codeintel | `node:worker_threads` 里的帧 worker（**必须随包落盘**） |
| `src/host/lsp-frame.js` | 170 | codeintel | `Content-Length` 帧编解码（纯函数） |
| `src/host/lsp-ws.js` | 170 | codeintel | 浏览器 ⇄ 语言服务器的 WS 中继 |
| `src/host/semantic-methods.js` | 32 | codeintel | 「语义请求」的唯一事实来源（刻意零 import） |
| `src/host/settings-defaults.js` | 247 | codeintel | `lsp` 设置段的默认值与常量 |
| `src/client/lsp-session.js` | 2 446 | codeintel | 浏览器侧语义会话总入口 |
| `src/client/lsp-workspace.js` | 652 | codeintel | `Workspace` 实现（工作台 ⇄ LSP 文档映射） |
| `src/client/lsp-transport.js` | 293 | codeintel | `Transport` 实现（排队 / 退避重连 / 控制事件） |
| `src/client/lsp-uri.js` | 182 | codeintel | 路径 ⇄ `file:` URI / 扩展名 ⇄ `languageId` |
| `src/client/lsp-sanitize.js` | 135 | codeintel | hover HTML 消毒 |
| `src/client/SearchPopup.jsx` | 329 | codeintel | 搜索弹层（D2 已拍板归 codeintel） |
| **合计** | **≈ 12 430** | | |

**两个例外**（不能直接搬）：

| 文件 | 为什么例外 | 处置 |
|---|---|---|
| `src/host/guard.js`（27 行） | 它的 `guardEmitter` 同时保护 **core 的终端 socket**（`src/index.js:855`、`:866`）和 codeintel 的 LSP 中继（`src/host/lsp-ws.js:62`） | **留在 core**；codeintel 自带一份 27 行副本（重复优于跨插件依赖） |
| `src/host/settings-defaults.js`（247 行） | 纯 LSP 内容，但 `src/host/settings-store.js` import 它来构造 `DEFAULT_SETTINGS.lsp` | **随 `lsp` 设置段整体迁移**（CUT-03）；core 的设置文档不再有 `lsp` 段 |

### 1.3 被污染文件（必须按 hunk 切）

| 文件 | Δ 行 | codeintel 占比 | 切分难度 | 主要难点 |
|---|---|---|---|---|
| `src/client/store.js` | +2 376 | **≈ 80 %**（~1 900 行） | **最难** | `lsp` 切片与 ~40 个方法**直接长在 `WorkbenchStore` 上**，不是接口而是实现 |
| `src/client/Workbench.jsx` | +1 089 | ≈ 78 %（~855 行） | 中 | 状态栏条目 + 三个弹窗内联 |
| `src/client/CodeEditor.jsx` | +664 | ≈ 88 %（~580 行） | 难 | 17 个模块级 import（15 个是 codeintel）；`lspCompartment` 是唯一的好接缝 |
| `src/client/SettingsPanel.jsx` | +596 | ≈ 85 %（~500 行） | 难 | `lsp` 分组是 338 行内联 `createElement`，无注册表 |
| `src/client/i18n.js` | +505 | ≈ 81 % | **易** | 键名已按前缀命名空间化（`lsp.` / `index.` / `nav.` / `settings.lsp*`） |
| `src/client/styles.js` | +431 | ≈ 80 % | **难** | **整份 CSS 是一个模板字符串**，**没有任何接缝**（必须新建） |
| `src/index.js` | +425 | ≈ 28 %（~280 行） | 中 | 通用错误边界与 LSP 专属分支**缠在一起** |
| `src/host/settings-store.js` | +202 | ≈ 74 % | 中 | `lsp` 段 + 迁移函数 + 4 个快捷键 + 与 core 共用的 `SETTINGS_VERSION` |
| `src/client/EditorArea.jsx` | +33 | ≈ 85 %（~28 行） | **易** | 纯 prop 传递 |
| `src/host/search.js` | +220 | **0 %** | **易** | 引擎属 core；新增的是上下文行 / 载荷预算 / 确定性排序（见 §1.4） |

**代码智能体积合计 ≈ 16 700 – 17 100 行**（新增文件 12 428 + 污染文件里的切分部分 4 300–4 600）。

### 1.4 必须回移到 core 的纯 core 修复（12 处）

这些改进了 core 的体验，但混在代码智能提交里。**不回移 ⇒ core 会比 `v0.4.1` 还旧。**

| # | 来源提交 | 内容 | 锚点 |
|---|---|---|---|
| B1 | `354fa58` | **Push 按钮**：提交窗口的独立推送按钮 + 顶栏 ahead/behind 徽标可点 | `src/client/CommitPanel.jsx:168-181,343-353`；`src/client/Workbench.jsx:67-70,90-112,154-166` |
| B2 | `354fa58` | **GIT-01/02**：`git status --untracked-files=all`（未跟踪文件逐个着色）+ 目录条目的本地化报错 | `src/host/git.js:60-63`；`src/client/git-colors.js:77-91,119-128` |
| B3 | `354fa58` | **LAYER-01**：未保存确认框升到独立 z-index 层（在项目选择器之上） | `src/client/ui.jsx:156-166`；`src/client/styles.js:895` |
| B4 | `354fa58` | **PERF-04**：样式表在模块作用域构建一次，不再每帧重解析 | `src/client/index.jsx:29-46` |
| B5 | `bf4927e` | **Git 状态上限**：`MAX_STATUS_ENTRIES = 20_000` + 流式解析 + `truncated` / `entryLimit` 字段 | `src/host/git.js:139-151,155-190,200-266,324-378` |
| B6 | `bf4927e` | **无上游时的 push**：toast 里给出可复制的命令 | `src/client/store.js:4980-4985`；`src/client/ui.jsx:187-211` |
| B7 | `7cc7227` | **设置写盘原子性**：写时合并（不是先合并再写）、失败即拒、队列在失败后存活、写失败被记录 | `src/host/settings-store.js:292-300,352-378,407-429` |
| B8 | `fdad597` | **PERF-02**：文件索引按码元序排序，不用 `localeCompare` | `src/host/search.js:78-99,110-116` |
| B9 | `fdad597` | **PERF-01**：`sameGitStatus` 在状态未变时保持对象身份 | `src/client/store.js:111-161,3258-3272` |
| B10 | `3a42238` | **路径比较**：Windows 下分隔符与大小写一并归一 | `src/host/workspace.js:71-96`（`samePath` / `windowsKey`） |

**另有两处来自 `4b2b7dc` 本身、但属于 core 的改动**：

| # | 内容 | 锚点 |
|---|---|---|
| B11 | **PERF-03 语法按需加载** + `ensureSyntaxTree`（cursor 处）：十三个语言包占客户端包约 1/4，改成按需取 | `src/client/CodeEditor.jsx:101-133,168-186,774-790` |
| B12 | **三态切项目**（保存 / 丢弃 / 取消），原为两态 | `src/client/store.js:1363-1412` |

> ⚠️ **`samePath`（`src/host/workspace.js:71`）在 `dd6dc17` 处不存在**——它是 `4b2b7dc` 为 LSP 管理器引入的。它是通用路径工具 ⇒ **归 core**，回移时必须带上。

### 1.5 DSH 运行时能力核实（契约的可行域）

核实对象：本机全局安装的 `@deepseek-ai/dsh@0.2.0-rc.2`（`npm root -g`）。

#### ✅ 可用来做契约的机制

| # | 能力 | 锚点 | 对本设计的意义 |
|---|---|---|---|
| V1 | **Cordis 服务总线**：A `ctx.provide(name, impl)`，B `ctx.get(name)` / `inject: [name]` | `@deepseek-ai/cordis/lib/types/reflect.d.ts:14-43` | **宿主侧契约的主干** |
| V2 | **Cordis 事件总线**：`ctx.emit` / `ctx.on`，事件全局声明 | `@deepseek-ai/cordis/lib/types/context.d.ts:24-25` | 状态变化的推送通道 |
| V3 | **槽位声明 + `ctx.slots.inject(key, cb)`** | `@deepseek-ai/dsh-client-ui-slots/lib/index.js:165,191-236`；`@deepseek-ai/dsh-client-ui-renderer/lib/types/client/registry.d.ts:97-111` | **客户端 UI 契约的主干**。`inject` 的语义是「声明已存在则同步执行，否则在声明提交的瞬间执行」⇒ **加载顺序自动解决** |
| V4 | **槽位崩溃隔离**：`reportEntryError` / `onEntryError`；影子类槽位（single/keyed/list）在占用方崩溃时**一次性退役该占用方** | `dsh-client-ui-slots/lib/index.js:439-483` | **codeintel 的 UI 崩溃不会掀翻 core** |
| V5 | **工作区根宿主可发现**：`ctx.workspaceRegistry.list()`（宿主侧）、`ctx.sessions.list.getSnapshot().byId[id].cwd`（客户端侧） | `@deepseek-ai/dsh-workspace/lib/types/index.d.ts:171` | codeintel **可以独立工作**（DEG-02） |
| V6 | **设置按插件分文件**：`join(profileBase(), '<dir>', 'settings.json')` | `src/host/settings-store.js:151-162` | codeintel 的内存预算设置**完全独立**（D7） |
| V7 | **两个插件可干净共存**：两个 bundle、两条 `cordis.patch.yml` patch 层、两个 Loader 条目 | `@deepseek-ai/dsh-app-boot/lib/types/profile.d.ts:3-14` | monorepo 双发版可行（ORG-01） |
| V8 | **客户端包由宿主统一提供**：`/plugins/<pkg>/client.js`，插件侧零工作 | `@deepseek-ai/dsh-client-modules/lib/index.js:201,546-550` | 第二插件的客户端产物无需额外接线 |
| V9 | **客户端侧也是 Cordis 应用**：`Context` 来自 `@deepseek-ai/cordis` | `@deepseek-ai/dsh-client-ui-renderer/lib/types/client/registry.d.ts:13` | 客户端侧也能用服务总线 |
| V10 | **`ctx.registry`**：可枚举其它活跃插件运行时 | `@deepseek-ai/cordis/lib/types/registry.d.ts:129-198` | 诊断用（谁在跑） |

#### ❌ **不存在**的能力（负面结论，决定设计不能依赖它们）

| # | 缺失 | 证据 |
|---|---|---|
| N1 | **没有 DSH 的插件间 API / 插件总线 / 服务定位器** | 全量枚举 `DSH/*` 无此包；`dsh-plugin-manager` 是**管理面**，`dsh-cordis-host-runner` 是**Agent 动态插件**子系统 |
| N2 | **路由没有命名空间，也没有路由注册表** | `@deepseek-ai/dsh-host-webserver/lib/types/index.d.ts:85-97`：`register` 收绝对路径，`kind` 只有 `exact`/`prefix`。`/ide-workbench/…` 是**本插件自选的约定**，不是宿主提供的命名空间 |
| N3 | **没有按插件的鉴权域**：所有插件路由共用一道 fence | `src/index.js:351`；`@deepseek-ai/dsh-client-connection/lib/types/rpc-host.d.ts:32` |
| N4 | **`__DSH_TRANSPORT__` 不是总线**，只有 `streamBaseUrl` 与连接配置 | `@deepseek-ai/dsh-api-gateway/lib/client.js:730` |
| N5 | **没有「当前工作区」指针**：`IWorkspaces` 只有有序 `list` | `@deepseek-ai/dsh-api-workspace-controller/lib/types/client/service.d.ts:38-105` |
| N6 | **DSH 0.2.0-rc.2 没有 `workingDirectory` 服务** ⇒ `workspace.list.defaultDirectory` 恒为 `undefined` | 全量 grep 无匹配；`src/index.js:409` |
| N7 | **没有插件 KV 服务** | `src/host/settings-store.js:1-7`（插件自己的注释就这么说） |
| N8 | **`dsh.plugin.json` 不被运行时读取**（0.2.0-rc.2 全树 grep `plugin.json` 无匹配） | 它只是展示元数据，**不得**承载契约 |
| N9 | **本工作台当前声明了 0 个槽位** ⇒ 现在**没有**任何往它编辑器 / 工具窗里注入 UI 的途径 | `src/client/index.jsx` 里 6 处 `ctx.slots.inject` 全部指向 DSH 宿主槽位；无 `children:`、无 `renderSlot` |
| N10 | **宿主没有「文件已变」事件** | `docs/M0-api-findings.md:14,26`（实测「不成立」）⇒ 仍靠 2 s 轮询 |

#### 关于 DSH 版本差异（必须知道）

插件声明 `engines.dsh: ">=0.1.7"`（`package.json:43`），但本机装的是 `0.2.0-rc.2`。`docs/M0-api-findings.md:3-5` 记录 2026-10-21 实测的客户端服务集是 `layout/locale/sessions/slots/theme/timer/uiWorkspace/workspaces`，**当时还没有 `sidebarRight`**。⇒ **上面的负面结论（N4/N5/N6/N8）是 0.2.0-rc.2 特定的**；若目标 DSH 版本不同，须重新核实。

### 1.6 测试资产

`tests/` 在边界后从 **46** 个文件长到 **120** 个（83 个文件有改动，**+25 007 / −39** 行）：

- **51 个 `lsp-*.test.mjs`** + 9 个 codeintel 命名的（`completion` / `ctrl-hover` / `definition` / `find-usages` / `idx-decision` / `client-lsp-language` / `client-status-render` / `settings-lsp` / `store-lsp-decision`）+ `search-popup`（925 行）+ `search-context`
- **5 个跨切面**：`perf-hot-path`（753）、`plugin-mount`（267）、`modal-layer`（65）、`settings-rows`（92）、`styles-theme`（383）
- **9 个被修改的既有测试**，其中 core 相关：`git.test.mjs`（+28）、`perf-slice-git.test.mjs`（+8）、`perf-cold-workspace.test.mjs`（+2）、`render.test.mjs`（+29，混合）

⇒ **测试的 95 % 跟着 codeintel 走**；core 只保留约 200 行。`plugin-mount.test.mjs` 尤其重要——它是**挂载点**的既有测试基线。

---

## 2. 目标架构

### 2.1 仓库结构

```
dsh-ide-workbench/                 ← 仓库名不变（monorepo 根）
├── package.json                    ← workspace 根，只做编排；不再有 main / files / dsh 字段
├── packages/
│   ├── contract/                   ← 契约包（私有，不发版为插件）
│   │   ├── package.json            name: "@dsh-ide/contract"
│   │   └── src/
│   │       ├── index.js            CONTRACT_VERSION / HOST_SERVICE / SLOT_KEYS
│   │       ├── host-api.d.ts       宿主侧契约的签名
│   │       ├── client-api.d.ts     客户端契约的签名
│   │       └── fault-registry.js   故障归属注册表（§3.7）
│   ├── workbench/                  ← core（IDE 工作台）
│   │   ├── package.json            name: "dsh-ide-workbench"   ← 插件 ID 不变（D4）
│   │   ├── cordis.patch.yml        insert: id: ide-workbench
│   │   ├── dsh.plugin.json
│   │   ├── src/{index.js,host,client}
│   │   └── dist/client.js
│   └── codeintel/                  ← 代码智能
│       ├── package.json            name: "dsh-ide-codeintel"
│       ├── cordis.patch.yml        insert: id: ide-codeintel
│       ├── dsh.plugin.json
│       ├── src/{index.js,host,client}
│       └── dist/client.js
├── docs/prd/v6/…
└── tests/                          ← 根级共享测试（跨包的契约测试放这里）
```

**目录名 ≠ 包名**是刻意的：npm workspace 以 `package.json.name` 为准，DSH 也以包名为插件 ID（D4）。这样 `packages/workbench` 在磁盘上是「core」，在 DSH 里仍是「工作台」。

**契约包不进任何插件的 `dependencies`**——它是**源码级**依赖：两包各自把需要的部分**内联**进自己的产物（契约包本身零运行时依赖）。原因见 §3.7（故障注册表必须跨「两份副本」共享 ⇒ 用 `Symbol.for` + `globalThis`）。

### 2.2 职责边界表

| 能力 | core | codeintel | 说明 |
|---|---|---|---|
| Project / Commit / Terminal / Git 四窗 | ✅ | | 基线能力 |
| 内置 CodeMirror 编辑器 | ✅ | | 基线能力，**无补全** |
| 语法高亮（按需加载） | ✅ | | B11，属 core 性能优化 |
| 文件定位 / 仓库选择器 / 会话切换 | ✅ | | 基线能力 |
| 查找替换（编辑器内） | ✅ | | `@codemirror/search`，基线就有 |
| 在文件中查找（`SearchView` 标签页） | ✅ | | 基线就有 |
| **搜索弹层（浮层）** | ❌ | ✅ | D2 已拍板 |
| **本地补全（`autocompletion`）** | ❌ | ✅ | D2。core **只**依赖 `@codemirror/autocomplete` 这个包，但**不安装** `autocompletion()` ⇒ core 仍然没有任何补全 |
| **自动闭合括号（`closeBrackets`）** | ✅ **保留一份** | ✅ 也带一份 | **D9**：一般编辑能力，非代码智能。**双装时 core 让位**（CTR-06，§3.4.1） |
| **语义补全 / 跳转定义 / 悬浮 / 签名** | ❌ | ✅ | D2 |
| **查找用法（语义 Alt+F7）** | ❌ | ✅ | D2 |
| **查找用法（文本 Alt+F8）** | ❌ | ✅ | D2 |
| **Ctrl+click 跳转 / Ctrl-hover 高亮** | ❌ | ✅ | 与语义能力同源 |
| **内存预算 / 内存闸门 / 压力释放** | ❌ | ✅ | D7，**含设置** |
| **语言服务器进程 / 空闲退出 / 崩溃恢复** | ❌ | ✅ | ISO-03 |
| **Java / JDTLS / JDK 发现** | ❌ | ✅ | D2 |
| **状态栏「语义分析」格** | ❌ | ✅ | 由 core 的槽位承载 |
| **设置页「语言服务器」分组** | ❌ | ✅ | 由 core 的槽位承载 |
| **快捷键** `goToDefinition` / `findUsages` / `findUsagesText` / `complete` | ❌ | ✅ | 归 codeintel 的设置文档 |
| 快捷键（保存 / 查找 / 跳文件 / 全屏…） | ✅ | | 基线能力 |
| **错误边界（通用）** | ✅ | | 通用部分留 core；codeintel 注册自己的归属（§3.7） |
| **`guardEmitter`** | ✅ | 副本 | CUT-02 |
| **文本搜索引擎**（`host/search.js` + `fs.search`） | ✅ | 通过契约调用 | 引擎是 core 的通用能力 |

### 2.3 三种安装态的行为

| | 只装 core | 只装 codeintel | 双装 |
|---|---|---|---|
| 工作台四窗 | ✅ 完整 | ❌ 无（没有工作台可挂） | ✅ 完整 |
| 编辑器 | ✅ 无补全 | ❌（没有编辑器） | ✅ 无补全 + codeintel 补全 |
| 状态栏语义分析格 | ❌ 不出现 | ❌ 不出现 | ✅ 出现 |
| 设置页语言服务器分组 | ❌ 不出现 | ✅ 出现，但标注「需安装 IDE 工作台」 | ✅ 出现 |
| 引导 | — | ✅ toast + 设置页说明（DEG-01） | — |
| 语言服务器进程 | ❌ **零个** | ✅ 可独立运行（用 session cwd） | ✅ |
| codeintel 崩溃时 | — | codeintel 停摆，宿主存活 | **core 与宿主存活**（ISO-01/02/03） |

---

## 3. 契约

> **契约包的纪律**（沿用 `docs/prd/v5.1/PRD-v5.1-实施契约.md:3` 的规矩）：**本节写死的东西，任何一方不得自行改名或改语义；本节没写的东西由各自模块自行决定。**

### 3.0 契约包导出的常量

```js
// packages/contract/src/index.js

/** 契约主版本。不兼容变更 +1。 */
export const CONTRACT_VERSION = 1

/** 宿主侧 Cordis 服务名。core 提供，codeintel 消费。（命名待 O5 拍板） */
export const HOST_SERVICE = 'dsh-ide-workbench.contract'

/** 客户端槽位键。core 声明，codeintel 注册。 */
export const SLOT_KEYS = Object.freeze({
  /** 契约桥：codeintel 放一个组件进来，core 在渲染点把契约作为 prop 交给它。 */
  editorBridge: 'ide-workbench.editor.bridge',
  /** 状态栏条目。 */
  statusItem: 'ide-workbench.status.item',
  /** 设置页分组。 */
  settingsSection: 'ide-workbench.settings.section',
  /** 编辑器命令项（右键菜单 / 命令面板）。 */
  commandItem: 'ide-workbench.command.item',
})
```

### 3.1 契约的形状与版本协商

契约是一个**普通对象**（不是类、不是 Proxy），带 `version` 字段。两端在握手时比对：

| 情况 | core 的行为 | codeintel 的行为 |
|---|---|---|
| `contract.version === CONTRACT_VERSION` | 正常提供全部能力 | 正常使用 |
| `contract.version > CONTRACT_VERSION`（core 更新） | — | **只使用 major 相同的能力**，其余按「不可用」处理并在诊断里说明 |
| `contract.version < CONTRACT_VERSION`（codeintel 更新） | — | **拒绝启用**，设置页与 toast 明确提示「请升级 IDE 工作台插件」 |
| **core 缺席**（`ctx.get(HOST_SERVICE)` 返回 `undefined`，或桥槽位永远没有占用方） | — | 进入**降级模式**（DEG-01/DEG-02） |

> 契约**只做 major 兼容**。minor 变更（新增一个可选能力）不改 `version`，只在契约包里加字段。

### 3.2 宿主侧契约（`HOST_SERVICE`）

**提供方**：core 的 `src/index.js` 的 `apply(ctx)`。

```js
/**
 * @typedef {Object} WorkbenchHostApi
 * @property {number} version                 契约主版本（= CONTRACT_VERSION）
 * @property {() => string} getProjectRoot    当前 IDE 项目根（绝对路径）。没有项目时返回 ''
 * @property {() => string} getScopeRoot      当前作用域根（索引范围）。没有时返回 ''
 * @property {() => Promise<string>} readFile 读一个绝对路径的文件内容（越界抛错）
 * @property {(opts: object) => Promise<object>} searchFiles 文本搜索（见下）
 * @property {(cb: (root: string) => void) => () => void} onProjectChanged 项目根变化时回调
 * @property {() => {ok: boolean, reason?: string}} health core 自身健康状态
 */

/** @type {WorkbenchHostApi} */
const api = {
  version: CONTRACT_VERSION,
  getProjectRoot: () => store?.state?.root ?? '',
  getScopeRoot: () => store?.state?.scopeRoot ?? '',
  readFile: (absolutePath) => call('fs.read', { root: getProjectRoot(), path: absolutePath }),
  searchFiles: (opts) => call('fs.search', { root: getProjectRoot(), ...opts }),
  onProjectChanged: (cb) => { /* 订阅 store 的 root 变化 */ },
  health: () => ({ ok: true }),
}
ctx.provide(HOST_SERVICE, api)
```

**`searchFiles` 的载荷**（沿用 core 既有 `fs.search` 的形状，**不新增语义**）：

```js
{ query: string, caseSensitive?: boolean, wholeWord?: boolean, regexp?: boolean, limit?: number }
// → { files: [{ path, hits: [{ line, column, text, before?: string[], after?: string[], binary?: boolean }] }], truncated?: boolean }
```

**消费方**：codeintel 的 `apply(ctx)`。

```js
const core = ctx.get(HOST_SERVICE)     // 非 strict：缺席时返回 undefined
if (core === undefined) {
  // 降级模式：不注册任何 LSP 路由，客户端显示引导（DEG-01）
} else {
  // 正常模式：用 core.getProjectRoot() 作为索引根，用 core.searchFiles() 做文本查找用法
}
```

> ⚠️ **为什么不硬 `inject: [HOST_SERVICE]`？** 硬注入会让 codeintel 在 core 缺席时**永不 `apply`** ⇒ 客户端也就没有机会显示引导。**必须软取 + 降级。**

> ⚠️ **为什么不给 codeintel 一条「自己调 core 的 HTTP 路由」的路？** DSH 的路由没有命名空间也没有注册表（N2），`/ide-workbench/api/...` 只是约定；跨插件 HTTP 调用「技术上可行、契约上无依据」。**走 Cordis 服务总线是宿主侧唯一有依据的通道**（V1）。

### 3.3 客户端契约（四个槽位）

**core 声明**（在既有槽位注册上加 `children`）：

```js
ctx.slots.register({
  name: 'sidebar.right.pane.tab',
  key: 'dsh-ide-workbench',
  children: {
    [SLOT_KEYS.editorBridge]:    { kind: 'single', scope: 'session' },
    [SLOT_KEYS.statusItem]:      { kind: 'list',   scope: 'session' },
    [SLOT_KEYS.settingsSection]: { kind: 'list',   scope: 'session' },
    [SLOT_KEYS.commandItem]:     { kind: 'list',   scope: 'session' },
  },
}, Workbench)
```

**core 渲染**（在 `Workbench` 的 React 树里）：

| 渲染点 | 槽位 | 传给占用方的 prop |
|---|---|---|
| 编辑器区（与 `CodeEditor` 同层） | `editorBridge` | `{ contract }` —— **契约对象的唯一投递点** |
| 状态栏右侧 | `statusItem` | `{ contract }` |
| 设置页 modal / `settings.section` 页 | `settingsSection` | `{ contract }` |
| 编辑器右键菜单 | `commandItem` | `{ contract }` |

**codeintel 注册**（顺序无关）：

```js
ctx.effect(() => ctx.slots.inject(SLOT_KEYS.editorBridge, () =>
  ctx.slots.register({ name: SLOT_KEYS.editorBridge, id: 'dsh-ide-codeintel' }, CodeIntelBridge)),
  'dsh-ide-codeintel: editor bridge')
```

`ctx.slots.inject` 的语义（V3）：**声明已存在则同步执行，否则在声明提交的那一刻执行** ⇒ **core / codeintel 的加载顺序无关**。这是选槽位而非全局变量的首要理由。

**为什么契约走「槽位 + prop」而不是「客户端服务总线」？**
1. 工作台是**按 Session 多实例**的（`stores.stores` Map）；客户端的 Cordis 服务是**单例**，与 Session 无关。槽位的 `scope: 'session'` 天然对齐。
2. 槽位渲染器自带**崩溃隔离**（V4）：占用方崩溃时框架会退役该占用方并上报，**core 的 React 树不受影响**。
3. 契约作为 prop 投递 ⇒ **无全局变量、无命名空间污染、可被类型检查**。

### 3.4 编辑器接缝

`editorBridge` 的占用方拿到的 `contract` 上，编辑器相关的部分：

```js
/**
 * @typedef {Object} EditorSeam
 * @property {(provider: () => ExtensionSlot[]) => { refresh: () => void, dispose: () => void }} registerExtensions
 * @property {(entries: KeyBinding[]) => () => void} registerKeymap
 * @property {(items: CommandItem[]) => () => void} registerCommands
 * @property {(cb: (doc: DocumentInfo) => void) => () => void} onDocument
 * @property {(absolutePath: string, line: number, column?: number) => void} reveal
 * @property {CmRuntime} codemirror
 */

/**
 * 一个「扩展槽位」。
 *
 * 同 key 的多个槽位只保留**优先级最高**的那个 —— 这就是让位机制（§3.4.1）。
 * @typedef {Object} ExtensionSlot
 * @property {string} key          槽位标识（如 'closeBrackets' / 'autocomplete'）
 * @property {number} priority     数值越大越优先
 * @property {unknown[]} extensions 该槽位携带的 CodeMirror 扩展
 */

/**
 * @typedef {Object} DocumentInfo
 * @property {string} uri            file: URI
 * @property {string} absolutePath
 * @property {string} languageId
 * @property {string} content        当前内容（含未保存草稿）
 * @property {boolean} dirty
 */
```

**core 侧的实现要点**：

| 能力 | core 内部实现 | 现有锚点 |
|---|---|---|
| `registerExtensions` | core 持有**一个中性命名**的 `Compartment`（今天叫 `lspCompartment`，拆分后改名 `extensionCompartment`），provider 返回的**槽位**经合并后装进它；`refresh()` 触发 `compartment.reconfigure` | `src/client/CodeEditor.jsx:90,653,815` |
| `registerKeymap` | core 把条目并入 `editorKeymapRest()` | `src/client/CodeEditor.jsx:311-328` |
| `registerCommands` | core 把条目并入右键菜单 | `src/client/CodeEditor.jsx:909-942` |
| `onDocument` | core 在 tab 变化 / 文档变更时广播 | `src/client/store.js` 的 tab 模型 |
| `reveal` | core 现有的 `revealPosition` + `revealColumn` | `src/client/CodeEditor.jsx:533`、`src/client/EditorArea.jsx:159` |
| `codemirror` | core 独占的 CodeMirror 运行时（§3.5） | — |

> **关键约束**：`registerExtensions` 返回的扩展**必须用 core 的 CodeMirror 实例构造**（§3.5）。core 因此**不需要**知道 codeintel 存在。

#### 3.4.1 扩展槽位与让位机制（CTR-06）

**要解决的问题（D9）**：自动闭合括号 `closeBrackets` 是**一般编辑能力**，core 需要它；但它今天和 `autocompletion` 挤在同一个函数里（`src/client/CodeEditor.jsx:281` 的 `completionExtensions()` 返回 `[autocompletion(...), closeBrackets()]`）。按 D9：**core 保留一份、codeintel 也带一份，双装时 core 让位。**

**为什么要有「让位」——先说事实，避免夸大成本**：

`closeBrackets()` 返回 `[inputHandler, bracketState]`（`@codemirror/autocomplete/dist/index.js:1830`）。其中 `inputHandler` 是 `EditorView.inputHandler` **facet** 的一段，而该 facet 的处理是**短路**的：

```js
// node_modules/@codemirror/view/dist/index.js
4401:  if (!view.state.facet(inputHandler).some(h => h(view, change.from, change.to, text, defaultInsert)))
```

`some()` 在第一个 handler 返回 `true` 时即停（CodeMirror 自己的文档也这么写：`view/dist/index.js:8868-8870`「When one returns true, no further input handlers are called」）。keymap 同理（`runHandlers` 命中即返回）。

⇒ **两份 `closeBrackets` 装在一起，当前实现下不会出现「括号闭合两次」**——先执行的那份处理完并返回 `true`，另一份根本不会跑。

**那让位到底解决什么？——三件事，都不是「修一个可见的 bug」**：

| # | 让位带来的价值 | 不让位会怎样 |
|---|---|---|
| V-1 | **确定性**：同 key 的能力**生效方确定**，不随加载 / 注册顺序漂移 | 两份实现若日后分叉（比如 codeintel 改了闭合策略），**实际生效的是数组里靠前的那一份** ⇒ 行为随插件加载顺序变化，且极难复现 |
| V-2 | **不重复状态**：`bracketState` 是 `StateField`，两份就是两份独立状态 | 多余的状态与内存（量小，但无谓） |
| V-3 | **可推广**：任何「两边都合理拥有」的能力都能让位，不必每加一项就改 core | 每来一个新能力就要在 core 里加一条特判 ⇒ core 慢慢长出对 codeintel 的隐性认知，违反 D8 |

**合并规则（写死，双方不得自行改语义）**：

```
1. core 与 codeintel 各自提供 ExtensionSlot[]；
2. 按 key 分组；
3. 同 key 取 priority 最大者；priority 相同则**后注册者胜**（codeintel 在 core 之后注册）；
4. 被挤掉的槽位**不装进 Compartment**（而不是「装了再禁用」）——少一份 StateField、少一条 inputHandler；
5. 合并结果在每次 `refresh()` 时重算。
```

**两边的声明**：

```js
// core（packages/workbench/src/client/CodeEditor.jsx）
const CORE_EXTENSION_SLOTS = () => [
  { key: 'closeBrackets', priority: 0, extensions: [closeBrackets(), closeBracketsKeymap] },
]

// codeintel（packages/codeintel/src/client/...）
const CODEINTEL_EXTENSION_SLOTS = () => [
  { key: 'closeBrackets', priority: 100, extensions: [closeBrackets(), closeBracketsKeymap] },
  { key: 'autocomplete',  priority: 100, extensions: [autocompletion({ activateOnTyping: true, icons: false })] },
  { key: 'lsp',           priority: 100, extensions: lspExtensions() },
]
```

⇒ **只装 core**：`closeBrackets`（priority 0）生效，无补全。
⇒ **双装**：`closeBrackets` 由 codeintel（priority 100）生效，**core 让位**；行为**确定**，与加载顺序无关。
⇒ **只装 codeintel**：没有编辑器，无所谓；但 codeintel 的槽位声明仍然合法（priority 100 独占该 key）。

> **core 仍然「无任何补全」**：`autocompletion()` 的槽位只在 codeintel 侧声明，core 侧没有 ⇒ core 的编辑器的补全 facet 里没有 `autocompletion` ⇒ **不出现补全弹窗**。
>
> **代价（如实记录）**：core 的 `dist/client.js` 会多带 `@codemirror/autocomplete` 这个包（`closeBrackets` 与 `closeBracketsKeymap` 在里面），约数十 KB 量级。**换来的**是 core 单独装时仍有自动闭合括号。**这是 D9 的已知代价，写进 CHANGELOG。**

### 3.5 CodeMirror 单实例（**本轮最大技术风险**）

#### 3.5.1 问题（已实测确认，非推测）

CodeMirror 6 的扩展系统用 `instanceof` 做类型判定：

```js
// node_modules/@codemirror/state/dist/index.js
1927:  if (ext instanceof StateField)
2016:  throw new Error(`Unrecognized extension value in extension set (${ext}).
2016:    This sometimes happens because multiple instances of @codemirror/state are loaded, breaking instanceof checks.`);
```

且 `StateField` 的 id 来自**模块级计数器**（`:1561` `this.id = nextID++`）——两个副本的 id 会**碰撞**。

⇒ **两个插件各自把 `@codemirror/*` 打进自己的 `dist/client.js`，双装时页面里会有两份 `@codemirror/state`，codeintel 的扩展装进 core 的 `EditorView` 必然抛错。**

当前 `scripts/build.mjs:34` 的 external 只有 `react` 与 `@deepseek-ai/dsh-client-ui-primitives`；`@codemirror/state|view|language|commands|search|autocomplete|lsp-client` **全部被打进 `dist/client.js`**（现状 `dist/client.js` ≈ 3.0 MB）。

#### 3.5.2 三条候选路

| 方案 | 做法 | 优点 | 致命问题 |
|---|---|---|---|
| **A. DSH 模块表共享** | core 把 `@codemirror/state` 等注册成独立模块工厂；codeintel 把它标为 external，`require('@codemirror/state')` 命中模块表 | 改动小，代码不用重写 | ① **重复注册即抛错**（`client-modules/lib/client.js:573-576`：同 id 第二次 `load()` 直接抛）⇒ 两个插件不能都注册；② codeintel 单独安装时 `require` 在**物化期**就抛 ⇒ 客户端模块根本加载不出来 ⇒ **引导也显示不了**；③ 需要 core 的注册先于 codeintel 的物化，而两个 bundle 的脚本是**并行加载**的（`loadShared(url)`）⇒ 顺序无保证 |
| **B. core 独占 + 契约交付运行时** | core 独占 CodeMirror，把运行时对象放进 `contract.codemirror`；codeintel 把 `@codemirror/*` **别名**到一个本地 **Proxy shim**，运行期从契约取值 | ① **无需 DSH 侧任何改动**；② codeintel 单独安装时 shim 访问才抛错 ⇒ **引导能显示**；③ 顺序由槽位 `inject` 自动解决 | codeintel 的**模块作用域**里不能有 CodeMirror 类引用（`StateField.define` 等），必须延后到绑定之后 |
| **C. CodeMirror 提升为独立 DSH 插件 / 平台种子模块** | 让 DSH 把 CodeMirror 加进 `PLATFORM_MODULES` 种子表 | 最干净 | **超出本仓库范围**（要改 DSH），且违背 §0.5「不改 DSH 宿主」 |

#### 3.5.3 选定：**方案 B**

```js
// packages/codeintel/src/client/vendor/cm-shim.js   —— 由 esbuild alias 接管 @codemirror/state 等
const KEY = Symbol.for('dsh.ide-workbench.codemirror')

/** 运行时绑定。由契约桥组件在拿到 contract 后调用。 */
export function bindCodemirror(runtime) {
  globalThis[KEY] = runtime
  for (const cb of listeners) cb(runtime)
}
export function onCodemirror(cb) { /* … */ }

/** 未绑定时访问即抛——这是**故意**的：它把「没装工作台」变成一个可捕获的错误。 */
export function codemirror() {
  const rt = globalThis[KEY]
  if (rt === undefined) throw new Error('CodeMirror runtime is not bound (is the IDE workbench plugin installed?)')
  return rt
}
```

**为什么 shim 必须是 Proxy 而不是普通导出**：ESM 的 `export const X = ...` 在**模块求值时**求值；codeintel 的模块体在**物化时**执行，那时 core 可能还没绑上 ⇒ 直接拿到 `undefined`。用 **CJS + `Proxy`** 则把解析推迟到**属性访问时**：

```js
// packages/codeintel/src/client/vendor/cm-state.js
module.exports = new Proxy({}, {
  get(_t, key) {
    const rt = globalThis[Symbol.for('dsh.ide-workbench.codemirror')]
    if (rt === undefined) throw new Error('CodeMirror runtime is not bound')
    return rt.state[key]
  },
})
```

esbuild 把 `import { StateField } from '@codemirror/state'` 编译成 `import_state.StateField`（**属性访问**，不是提前解构）⇒ 解析被推迟到使用点。✅

**契约桥组件（codeintel 侧）的装配顺序**：

```
core 物化 → core 绑定 CodeMirror 运行时 → core 渲染工作台
  → core 渲染 editorBridge 槽位 → codeintel 的 CodeIntelBridge 挂载
    → 拿到 contract → contract.codemirror 已在 → codeintel 初始化 LSP 会话
```

**由此产生的强制重构项（必须写进迁移方案）**：

| # | 位置 | 问题 | 处置 |
|---|---|---|---|
| R1 | codeintel 客户端各模块 | **模块作用域**里出现 CodeMirror 类引用（`StateField.define` / `StateEffect.define` / `Compartment`） | 全部改成**惰性初始化**（放进函数里，在 `bindCodemirror` 之后调用） |
| R2 | `@codemirror/lsp-client` | 它内部在**模块作用域** `StateField.define` | 它是 ESM ⇒ esbuild 的 `__esm` 包装**惰性初始化** ⇒ 第一次**属性访问**才执行 ⇒ shim 的 Proxy 在那时才取运行时 ⇒ ✅ 无需改造库本身 |
| R3 | `@codemirror/autocomplete` | 同上 | 同 R2 |
| R4 | codeintel 的构建 | 需要把 `@codemirror/*` 指向 shim | esbuild `alias`：`{'@codemirror/state': './src/client/vendor/cm-state.js', …}`。**`alias` 对整个依赖图生效** ⇒ `@codemirror/lsp-client` 内部的 `@codemirror/state` 也会被指向 shim ✅ |

> ⚠️ **R1 必须逐个清点**：拆分后 codeintel 客户端的所有 `import { X } from '@codemirror/state'` 若在**模块求值期**使用 `X`，就会在未绑定时抛错。这条必须在 M2 的 spike 里用「未装 core 时加载 codeintel 客户端」的用例守住。

#### 3.5.4 备选（若评审否决方案 B）

若评审认为「codeintel 客户端要重写所有 CodeMirror 导入」代价过高，退路是 **方案 A 的受限变体**：把 CodeMirror 做成 **core 客户端包内的一个独立模块注册**（core 的 `dist/client.js` 里 `window.__ModuleLoader__.load({id:'@codemirror/state', factory})` **额外**注册一次），codeintel 标 external 并在**桥组件挂载后**再 `require`。代价：仍需处理「codeintel 单独安装时 materialization 失败」⇒ 必须把 codeintel 对 CodeMirror 的引用全部改成 `require.async` / 动态 `import()`（chunk 化），复杂度反而更高。

### 3.6 降级矩阵

| 情形 | core | codeintel | 用户看到 |
|---|---|---|---|
| 正常双装 | 提供契约 v1 | 消费契约 v1 | 完整功能 |
| codeintel 版本落后（major 不匹配） | 提供契约 v1 | 拒绝启用 | 设置页 + toast：「请升级 IDE 工作台插件」 |
| core 版本落后（major 不匹配） | 提供契约 v0.x | 拒绝启用 | toast：「请升级 IDE 工作台插件」 |
| **只装 codeintel** | — | 降级模式：<br>① 不注册任何语言服务器路由<br>② 客户端显示引导（DEG-01）<br>③ 若用户在设置里开了「独立运行」，用 session cwd 当项目根（DEG-02） | toast + 设置页说明 |
| 只装 core | 提供契约 v1，无人消费 | — | 干净体验 |
| core 崩溃 / 被卸载 | 契约注销 | 感知服务消失 ⇒ 停止轮询、释放会话、卸载 UI | codeintel 静默退场，宿主存活 |
| codeintel 崩溃 | 不受影响 | 自身崩溃被隔离（ISO-01/02） | core 与宿主存活 |

### 3.7 故障隔离

#### 3.7.1 现状（core 内部）

`src/index.js:95-105` 的 `isPluginFault` 用**栈路径前缀**判定归属；`src/index.js:119` 的 `isLspFault` 进一步细分为「语言服务器半边」。`installErrorBoundary`（`:138-237`）接管 `process.on('uncaughtException' | 'unhandledRejection')`，**非本插件的故障原样转交宿主原有的处理器**（`:230-232`）。

> ⚠️ **拆分后会出事的点**：core 的边界看到「栈里没有 core 的目录」的异常 ⇒ **原样转交宿主** ⇒ 宿主 fail-loud ⇒ `proc.exit(1)`。**codeintel 的未捕获异常会杀死 DSH 宿主。** 这直接违反 ISO-01。

#### 3.7.2 选定方案：归属注册表 + 单例边界

```js
// packages/contract/src/fault-registry.js
const KEY = Symbol.for('dsh.ide-workbench.fault-registry')

/** 全进程唯一的归属表。两个插件各带一份契约包，靠 Symbol.for 仍共享同一份。 */
function registry() {
  let reg = globalThis[KEY]
  if (reg === undefined) {
    reg = { owners: new Map(), handler: null, previous: null }
    globalThis[KEY] = reg
  }
  return reg
}

/** 声明「这个目录下的代码归我」。dir 必须是插件自己的源码目录。 */
export function claimFaultOwnership(dir, onFault) { … }

/** 全进程只装一个 uncaughtException 处理器。 */
export function installFaultBoundary(ctx) { … }
```

**归属判定顺序**（**只有一处**实现，两个插件共用）：

```
1. 栈命中某个已声明的 owner 目录 ⇒ 交给该 owner 的 onFault（隔离在插件内）
2. 都不命中 ⇒ 交给宿主原有的处理器（fail-loud，保留 DSH 的正确策略）
```

**为什么用 `Symbol.for` + `globalThis`**：契约包会被**内联进两个插件**（两份副本）。普通模块变量各是各的 ⇒ 两个插件会各装一个 `uncaughtException` 处理器 ⇒ 同一次异常被**转交两次**（core → codeintel → 宿主）。`Symbol.for` 是**跨副本唯一**的 ⇒ 全进程只有一个处理器，转交链不会重复。✅

**每个插件各自声明自己的归属目录**：

| 插件 | 声明 | 后果 |
|---|---|---|
| core | `claimFaultOwnership(<core 的 src 目录>, onCoreFault)` | core 的异常留在 core 内（降级该功能，不杀宿主） |
| codeintel | `claimFaultOwnership(<codeintel 的 src 目录>, onCodeintelFault)` | **codeintel 的异常留在 codeintel 内** ⇒ **不杀宿主、不掀翻 core**（ISO-01） |

**core 的通用部分**（`installErrorBoundary` 里的 `stackOf` / `isPluginFault` / 通用 `guardEmitter` 保护）**留在 core**；LSP 专属分支（今天在 `src/index.js:989` 调 `lsp.transition(root, 'degraded', …)`）**随 codeintel 走**，改成 codeintel 自己注册 `onFault`。

#### 3.7.3 内存隔离

- **core 的进程树里不得有任何语言服务器**：语言服务器只由 codeintel 的 `ctx.subprocess.spawn` 拉起（ISO-03）。
- codeintel 的 `shutdownAll()` 在**自己的** teardown 里跑（今天在 `src/index.js:1005-1006`，属于 core 的 teardown ⇒ 必须移走）。
- core 的 teardown **不得**知道 `knownRootsOfSettings(settings).lsp.indexedRoots`（今天 `src/index.js:296-322` 读 core 自己的设置里的 codeintel 段 ⇒ CUT-11 之后这段设置不再存在）。

---

## 4. 迁移方案

### 4.1 阶段划分

每个阶段结束都能独立验证；**M0–M2 不产出任何用户可见变化**。

| 阶段 | 名称 | 产出 | 出口条件 |
|---|---|---|---|
| **M0** | 契约包 + 仓库骨架 | `packages/contract` + `packages/{workbench,codeintel}` 骨架 + workspace 根 | 两包都能构建；契约包被两包引用；**功能零变化** |
| **M1** | core 独立成包 + 回移 | core 成为独立包，功能面 = `dd6dc17` + §1.4 的 12 处 | core 的测试全绿；功能与 `dd6dc17` 一致（除回移项） |
| **M2** | **契约 spike（先做）** | 4 个技术点的最小可运行验证（§4.2） | 全部通过，否则回到设计 |
| **M3** | 整体迁移 | 13 个新文件进 codeintel（`guard.js` 留在 core）；codeintel 宿主半边能起语言服务器 | codeintel 单独装能起服、能答语义请求 |
| **M4** | 客户端接缝 | core 声明 4 槽位 + 实现 `EditorSeam`；codeintel 贡献 UI | 双装时 UI 与今天一致 |
| **M5** | 切分污染文件 | store / CodeEditor / Workbench / SettingsPanel / styles / i18n / settings-store 切完 | §5.3 的等价清单逐条通过 |
| **M6** | 设置迁移 + 构建发版 | `lsp` 段迁到 codeintel 自己的文件 + 一次性导入；两包独立发版 | 升级后设置不丢；两包可分别发版 |
| **M7** | 三态验收 | §5 的完整验收清单 | 全部通过 |

### 4.2 M2 spike 的四个必验点

**spike 的目的**：在动大手术之前，把四个「错了就要重做」的技术点先证伪或证实。

| # | 待验证 | 方法 | 失败时的退路 |
|---|---|---|---|
| **S1** | **CodeMirror 单实例（§3.5）** | 造两个最小客户端 bundle：A 内联 `@codemirror/state`，B 经 Proxy shim 取 A 的实例；B 向 A 的 `EditorView` 装一个 `StateField` 扩展 | 退路 = §3.5.4 的受限方案 A′ |
| **S2** | **槽位跨插件注册** | core 声明子槽 → codeintel 用 `ctx.slots.inject` 注册；验证①加载顺序颠倒仍能注册 ②占用方崩溃被框架隔离 ③core 卸载时占用方被清理 | 若框架的槽位作用域 / 渲染点属性不满足 ⇒ 退路 = 客户端 Cordis 服务总线（V9）+ 显式 `ctx.get` |
| **S3** | **宿主侧服务总线** | core `ctx.provide('ide-workbench', api)` → codeintel `ctx.get` 取到；core 卸载后 codeintel 能感知 | 若非 strict `get` 拿不到 ⇒ 退路 = `ctx.registry` 枚举 + `ctx.get` 组合 |
| **S4** | **第二插件的宿主能力** | codeintel 独立 `apply(ctx)` 里：`ctx.webServer.register` 注册自己的 `/dsh-codeintel/api/*`；`ctx.webServer.registerUpgrade` 注册 `/dsh-codeintel/ws/lsp`；`ctx.subprocess.spawn` 拉起语言服务器；`ctx.connection.requestRejection` 做 fence | 若 `subprocess` / `webServer` 不能被第二插件独立使用 ⇒ codeintel 必须通过 core 的服务间接拉起进程（契约变复杂，ISO-03 的边界要重画） |

> **S4 尤其重要**：`ctx.subprocess` 与 `ctx.webServer` 是 DSH 宿主服务，**原则上**任何插件都能 `inject`。但「原则上」不是「实测过」。本轮**必须实测**，因为它决定 codeintel 能不能完全自治。

### 4.3 文件级迁移表

| 来源 | 去向 | 处置 |
|---|---|---|
| `src/host/{lsp,lsp-frame,lsp-worker,lsp-ws,java-runtime,semantic-methods}.js` | `packages/codeintel/src/host/` | 整体搬运 |
| `src/host/settings-defaults.js` | `packages/codeintel/src/host/` | 整体搬运（CUT-03） |
| `src/host/guard.js` | **留在 core**；codeintel 复制一份 | CUT-02 |
| `src/client/{lsp-session,lsp-workspace,lsp-transport,lsp-uri,lsp-sanitize}.js` | `packages/codeintel/src/client/` | 整体搬运 |
| `src/client/SearchPopup.jsx` | `packages/codeintel/src/client/` | 整体搬运 |
| `src/index.js` 的 `lsp.*` 路由（11 条） | codeintel 的 `src/index.js` | 改为 `/dsh-codeintel/api/lsp.*`；客户端常量同步改 |
| `src/index.js` 的 LSP WS（`/ide-workbench/ws/lsp`） | codeintel | 改为 `/dsh-codeintel/ws/lsp` |
| `src/index.js` 的 `LSP_SOURCE` / `isLspFault` | codeintel | CUT-04；core 改用归属注册表（§3.7） |
| `src/index.js` 的 `knownRootsOfSettings` | codeintel | 迁走；core 不再读 codeintel 的设置段 |
| `src/index.js` 的 `shutdownAll` 调用 | codeintel 的 teardown | ISO-03 |
| `src/client/store.js` 的 `lsp` 切片（~106 行） | codeintel 自己的状态容器 | CUT-05 |
| `src/client/store.js` 的 ~40 个 LSP 方法 | codeintel | CUT-05 |
| `src/client/store.js` 的 `searchPopup` 切片 + 5 个方法 | codeintel | 与搜索弹层同去 |
| `src/client/store.js` 的 `sameGitStatus` 等 | **留 core** | B9 |
| `src/client/CodeEditor.jsx` 的 `completionExtensions` / `navKeymap` / Ctrl+hover / `lspCompartment` | codeintel | CUT-06；**`completionExtensions()` 必须拆开**：`autocompletion(...)` 归 codeintel，**`closeBrackets()` + `closeBracketsKeymap` 留 core**（D9）；core 保留 `languageCompartment` 与语法按需加载（B11） |
| `src/client/CodeEditor.jsx` 的 `revealPosition` / `revealColumn` | **留 core** | 属于「跳转落点」的通用能力 |
| `src/client/Workbench.jsx` 的 `LspStatus` + 3 个弹窗 | codeintel | CUT-07 |
| `src/client/Workbench.jsx` 的 `interpolate` | **两边各留一份** | core 的 push 菜单在用 |
| `src/client/SettingsPanel.jsx` 的 `lspGroup` + `lspServersGroup` | codeintel | CUT-08 |
| `src/client/styles.js` | **按选择器前缀切分 + 新建接缝** | CUT-09 |
| `src/client/i18n.js` | **按键前缀切分** | CUT-10；codeintel 用 `ctx.locale.register(ns, 'zh'/'en', dict)` |
| `src/host/settings-store.js` 的 `lsp` 段 / `migrateLspSettings` / 4 个快捷键 | codeintel | CUT-11 |
| `src/host/settings-store.js` 的写盘原子性 / `#reportWriteFailure` | **留 core** | B7 |
| `src/client/EditorArea.jsx` 的 `editorNavLabels` / `navLabels` / `revealColumn` 传递 / 搜索弹层接线 | codeintel | CUT-12；`revealColumn` 的**字段**留 core，**接线**归 codeintel |
| `src/host/search.js` | **留 core** | 引擎是 core 的；上下文行 / 载荷预算是弹层需要的 ⇒ 通过 `searchFiles` 契约暴露 |
| `tests/lsp-*.test.mjs`（51 个） | `packages/codeintel/tests/` | 整体迁移 |
| `tests/{completion,ctrl-hover,definition,find-usages,idx-decision,client-lsp-language,client-status-render,settings-lsp,store-lsp-decision,search-popup,search-context}.test.mjs` | `packages/codeintel/tests/` | 整体迁移 |
| `tests/{perf-hot-path,plugin-mount,modal-layer,settings-rows,styles-theme}.test.mjs` | 按内容拆：跨包的进根 `tests/`，其余随包 | — |
| `dist/client.js` | **两个包各自重新构建** | 产物，**绝不手工切** |

### 4.4 设置迁移（M6）

**现状**：core 的设置文档（`<profile>/ide-workbench/settings.json`）里含 `lsp` 段、`shortcuts` 里的 4 个 codeintel 键，`SETTINGS_VERSION` 从 2 升到 5（`src/host/settings-store.js:16`）。

**拆分后**：

| | core | codeintel |
|---|---|---|
| 文件 | `<profile>/ide-workbench/settings.json` | `<profile>/dsh-codeintel/settings.json` |
| 内容 | core 自己的全部设置 | `lsp` 段 + 4 个快捷键 + 索引记忆 + 内存预算 |
| 版本号 | `SETTINGS_VERSION` 重新定版（本仓库内从 5 → 3，并在迁移函数里**显式丢弃** `lsp` 段） | 独立版本号（从 1 起） |

**一次性导入（MIG-01）**：codeintel 首次启动时，读 core 的 `settings.get`（通过宿主契约或直接读同一 profile 目录），把 `lsp` 段与 4 个快捷键**搬到**自己的文件，然后标记「已导入」。core 在新版本里**不再读写** `lsp` 段（但**不删**旧文件里的该段 ⇒ 用户降级旧版仍可用）。

> **注意 `SETTINGS_VERSION` 的语义变化**：core 的版本号从 5 降到 3 看起来「倒退」，实际是「换了文件格式」。必须在迁移函数与 CHANGELOG 里写清楚，并给迁移函数补测试（`docs/prd/v5.1/PRD-v5.1-实施契约.md:33` 的规矩：旧文档必须拿到默认值，且不得丢已有键）。

### 4.5 构建与发版（ORG-01 / REL-01）

**构建**：

| 包 | 客户端产物 | 宿主产物 |
|---|---|---|
| `packages/workbench` | `dist/client.js`（esbuild，`external: [react, @deepseek-ai/dsh-client-ui-primitives]`） | `src/index.js` + `src/host/**`（原样发布） |
| `packages/codeintel` | `dist/client.js`（esbuild，**额外** `alias` 掉 `@codemirror/*` → shim；`external` 同上） | `src/index.js` + `src/host/**`（**必须含 `lsp-worker.js`**，它是 `new Worker(<file>)` 的落盘文件） |

**`files` 清单**：两个包各自列自己的 `src` / `dist` / `locale` / `icon.svg` / `cordis.patch.yml` / `dsh.plugin.json`。

**依赖归属**：

| 依赖 | core | codeintel | 说明 |
|---|---|---|---|
| `ws` | ✅ | ✅ | 终端 socket / LSP 中继，各用各的（`bundleDependencies`） |
| `@codemirror/{state,view,commands,language,search}` | ✅ devDep | **不装**（走 shim） | §3.5 |
| `@codemirror/autocomplete` | ✅ devDep（**只为 `closeBrackets`**，不装 `autocompletion()`） | ✅ devDep | D9：core 保留自动闭合括号；**core 仍然没有任何补全**。core 多带的体积约数十 KB（D9 的已知代价） |
| `@codemirror/lsp-client` | ❌ | ✅ devDep | 纯 codeintel |
| `typescript` / `typescript-language-server` / `basedpyright` / `yaml-language-server` | ❌ | ✅ **dependencies** | 语言服务器，**这是 core 变轻的主因** |

> **注意 `@codemirror/autocomplete` 的归属（D9）**：今天 `completionExtensions()`（`src/client/CodeEditor.jsx:281`）同时返回 `autocompletion(...)` **和** `closeBrackets()`。拆分时**必须把这两者分开**：`autocompletion(...)` 归 codeintel，**`closeBrackets()` + `closeBracketsKeymap` 留 core**。
> ⇒ core 的 `dist/client.js` 会多带 `@codemirror/autocomplete` 这个包（约数十 KB），**但 core 不安装 `autocompletion()` ⇒ core 仍然没有任何补全**（验收项 A2 守住这条）。
> ⇒ 双装时两份 `closeBrackets` 由**扩展槽位**机制去重（CTR-06 / §3.4.1）：codeintel 胜，core 让位。
> ⇒ **CHANGELOG 必须写明**：core 单独安装时**保留**自动闭合括号（与 D2 原提案不同），以及 core 包体积因此略增。

**发版**：两个包独立版本线。core 的 `dsh.plugin.json.version` 与 `package.json.version` 必须一致（宿主读包名，发版页读 `dsh.plugin.json`）。codeintel 独立发版。**契约版本 `CONTRACT_VERSION` 独立于两者**，任一方升级不必然要求另一方升级（只有 major 变更才要求）。

---

## 5. 验收清单

### 5.1 只装 core

| # | 验收项 | 方法 | 期望 |
|---|---|---|---|
| A1 | 工作台四窗可用 | 实机 | Project / Commit / Terminal / Git 全部正常 |
| A2 | 编辑器可用、无补全 | 在 `.ts` 文件里敲 `fo` | **不出现**补全弹窗（D9：`closeBrackets` 留在 core，但 core **不装** `autocompletion()` ⇒ 仍然无补全） |
| **A2b** | **自动闭合括号可用** | 在 `.ts` 里敲 `(` | 得到 `()`；Backspace 在括号中间删一对（D9） |
| A3 | 编辑器无 LSP 客户端 | 打开诊断面板 / 状态栏 | **没有**「语义分析」字样 |
| A4 | 设置页无语言服务器分组 | 打开设置 | **没有**该分组 |
| A5 | core 进程树无语言服务器 | 任务管理器 | **零个** `tsserver` / `pyright-langserver` / `jdtls` / `yaml-language-server` |
| A6 | core 包体积不含语言服务器 | `package.json` | 无 `typescript` / `basedpyright` 等 dependencies |
| A7 | 内存占用 | 实机对比 `dd6dc17` | 与基线同量级（**目标**：不因本拆分而升高） |
| A8 | 纯 core 修复已回移 | 逐条对照 §1.4 | 12 项全部生效（push 按钮 / git 着色 / 确认框层级 / 样式表单次构建 / git 状态上限 / 无上游 push / 设置写盘原子性 / 路径排序 / 状态对象身份 / 路径比较 / 语法按需加载 / 三态切项目） |

### 5.2 只装 codeintel

| # | 验收项 | 方法 | 期望 |
|---|---|---|---|
| B1 | 插件**能加载** | 看 DSH 插件面板 | codeintel 正常加载，**无控制台错误**（这条守住 §3.5 的 shim：未绑定不得在物化期抛） |
| B2 | 有明确引导 | 启动 DSH | 出现**一次** toast：说明「代码智能需要 IDE 工作台插件」，并给出安装入口 |
| B3 | 设置页有说明 | 打开 codeintel 的设置页 | 页面顶部有「未检测到 IDE 工作台」的说明条，不是空白页 |
| B4 | 不空转 | 观察 5 分钟 | **没有**语言服务器进程被拉起（降级模式不启动服务） |
| B5 | 独立运行（可选开关） | 打开「独立运行」并选一个目录 | 用 session cwd 当项目根，能起服、能答语义请求；UI 上标注「未与工作台对齐」 |
| B6 | 崩溃不杀宿主 | 人为抛一个未捕获异常 | DSH 宿主**存活**；codeintel 自身进入降级；core（若有）不受影响 |

### 5.3 双装（等价于当前 HEAD 的功能面）

| # | 能力 | 期望 | 当前实现的锚点 |
|---|---|---|---|
| C1 | 本地补全 | `.ts` 敲 `fo` 出现补全 | `CodeEditor.jsx:281` |
| C2 | 语义补全 | 有语言服务器时出现服务端补全 | `lsp-session.js:2261` |
| C3 | 跳转定义 | F12 / Ctrl+click 跳到定义，**列精确** | `CodeEditor.jsx:888-893` |
| C4 | 查找用法（语义） | Alt+F7 列出语义引用 | `lsp-session.js:1147` |
| C5 | 查找用法（文本） | Alt+F8 文本搜索，标注「文本匹配」 | `store.js:3679` |
| C6 | 悬浮 / 签名 | 悬浮出提示；签名提示可选参数高亮 | `lsp-session.js:2261` |
| C7 | Ctrl-hover | 按住 Ctrl 高亮符号 | `CodeEditor.jsx:415-522` |
| C8 | 状态栏语义分析格 | 就绪 / 休眠 / 保守版 / 启动中……**四种文案可区分** | `Workbench.jsx:623-944` |
| C9 | 内存预算面板 | 设置页与诊断面板的数字与宿主同源 | `Workbench.jsx:1342-1457` |
| C10 | 索引决策弹窗 | 「要建索引吗」/「内存紧张仍要建吗」两条链路 | `Workbench.jsx:1186-1340` |
| C11 | Java / JDTLS | Java 项目能起 jdtls 并答语义请求 | `java-runtime.js:1002` |
| C12 | 搜索弹层 | 查找在文件中弹浮层，含上下文预览 | `SearchPopup.jsx` |
| C13 | 崩溃恢复 | 语言服务器崩溃自动重启一次，再降级 | `lsp.js:2206-2238` |
| C14 | 空闲回收 | 空闲后灰点「已休眠（省内存）」，再次语义操作自动唤醒 | `lsp.js:2107` |
| C15 | **功能面零回退** | 与当前 HEAD 的**功能清单**逐条比对 | 以 `docs/prd/v5/` 与 `v5.1/` 的验收条款为准 |
| **C16** | **自动闭合括号只闭合一次** | 双装时在 `.ts` 里敲 `(` | 只得到 `()`，**不是** `(())`；Backspace 在括号中间**只删一对** | §3.4.1；`@codemirror/autocomplete/dist/index.js:1830` |
| **C17** | **让位是确定的** | 双装后**改变插件加载顺序**（先装 codeintel / 先装 core），重复 C16 | 两种顺序下**结果完全相同**（生效方恒为 codeintel） | §3.4.1 合并规则 3 |

> ⚠️ **C1–C15 是「功能面等价」，不是「实现等价」**：状态机、内存闸门算式、请求预算口径**一律不动**（§0.5）。任何**行为差异**都必须是被显式记录的取舍。

### 5.4 隔离性验收（ISO）

| # | 验收项 | 方法 | 期望 |
|---|---|---|---|
| I1 | codeintel 的未捕获异常 | 在 codeintel 里抛未捕获异常 | 宿主**存活**；core 界面**正常**；codeintel 进入降级 |
| I2 | core 的未捕获异常 | 在 core 里抛未捕获异常 | 宿主**存活**；core 自身降级；codeintel 不受牵连 |
| I3 | 不重复转交 | 观察异常日志 | **只有一条**转交记录（不是两条） |
| I4 | 语言服务器 OOM | 让 tsserver 吃满内存 | 压力阀释放它；**core 内存不受牵连**；宿主存活 |
| I5 | 语言服务器崩溃风暴 | 连续崩溃 | 只重启一次再降级（`CRASH-01` 的口径不变） |
| I6 | core 不持有 codeintel 的资源 | 卸载 codeintel | core 的内存立即回落；无残留进程 |
| I7 | codeintel 卸载后 core 仍完整 | 卸载 codeintel 后 | 工作台四窗、编辑器、设置页全部正常 |
| I8 | core 卸载后 codeintel 不炸 | 卸载 core 后 | codeintel 退场（不抛未捕获异常），宿主存活 |

### 5.5 回归与工程验收

| # | 验收项 | 期望 |
|---|---|---|
| R1 | core 的测试 | 全绿（§1.6 拆完后 core 只剩约 200 行测试 + 12 处回移的新增测试） |
| R2 | codeintel 的测试 | 全绿（约 24 800 行整体迁移 + 契约的新增测试） |
| R3 | 契约测试 | 新增：版本协商、降级矩阵、槽位跨插件注册、故障归属、shim 未绑定时的行为、**扩展槽位的让位与去重**（同 key 取高优先级；双装时 `closeBrackets` 只装一份） |
| R4 | 构建 | 两个包各自 `npm run build` 产出可安装的插件包；`dist/client.js` 由构建生成，**不入库 diff 审查** |
| R5 | 无跨包越界 import | core 的源码**不 import** 任何 codeintel 符号；反之亦然（`packages/contract` 除外） |
| R6 | core 无代码智能残留 | grep `@codemirror/lsp-client` / `lsp` / `autocompletion` 关键字于 core 的 `src/` ⇒ 零命中（**白名单**：`@codemirror/autocomplete` 的 `closeBrackets` / `closeBracketsKeymap` —— D9 明确允许） |
| R7 | core 无语言服务器依赖 | `packages/workbench/package.json` 无 `typescript` / `basedpyright` / `yaml-language-server` / `typescript-language-server` |
| **R8** | **core 无补全能力** | core 的 `src/` 里**没有** `autocompletion(` 的调用（只有 `closeBrackets`）⇒ A2 的机械证据 |

---

## 6. 评审拍板记录（原开放问题）

> **状态**：2026-11-02 已全部拍板。本节保留**问题原文与选项**，作为决策的来由（沿用 `docs/prd/v5.1/PRD-v5.1-实施进展.md`「偏差决策」的记录方式）。

| # | 问题 | 选项 | **结论** | 影响 |
|---|---|---|---|---|
| **O1** | `closeBrackets()`（自动闭合括号）归谁？它今天与 `autocompletion()` 混在 `completionExtensions()` 里 | ① 随 codeintel（严格遵守「core 无补全」，但 core 单独装时**失去**自动闭合括号）<br>② 留在 core（需把 `@codemirror/autocomplete` 留在 core，与「core 无补全」的体积目标略有出入）<br>③ **两边都有，双装时 core 让位** | **✅ ③**（用户拍板）。实现为 **CTR-06 扩展槽位**：同 key 取高优先级，codeintel `priority: 100` 胜、core `priority: 0` 让位。详见 §3.4.1 与 D9 | core 单独装时**保留**自动闭合括号；core 包体积多数十 KB |
| **O2** | 搜索弹层归 codeintel 后，core 的 `SearchView` 标签页**保留还是移除**？ | ① 保留（两个查找入口并存）<br>② 移除（core 完全没有「在文件中查找」） | **✅ ①**：基线有它，移除会让 core 比 `v0.4.1` 更旧 | core 的功能面 |
| **O3** | codeintel 的**独立运行**（无 core 时用 session cwd 起服）是否要做？ | ① 做（DEG-02）<br>② 不做（无 core 时只给引导，不起任何服务） | **✅ ② 为默认、① 作为显式开关** | codeintel 的复杂度与安全面 |
| **O4** | Java 的设置**目前没有 UI**（`javaHome` / `jdtlsHome` / `javaSearchRoots` / `javaArgs` 只能手改设置文件）——本轮补不补？ | ① 补（codeintel 的设置页新增 Java 分组）<br>② 不补（保持现状，列为本轮已知缺口） | **✅ ②**（本轮只搬家，不加功能） | codeintel 的设置页 |
| **O5** | `HOST_SERVICE` 这个 Cordis 服务名会不会与其它插件撞名？ | ① 用 `ide-workbench`（短）<br>② 用 `dsh-ide-workbench.contract`（更 unique） | **✅ ②** | 极小 |
| **O6** | CodeMirror 单实例方案 B 需要 codeintel 客户端**逐个清点模块作用域的 CodeMirror 引用**——若清点后发现改动面过大 | ① 方案 B（契约交付 + Proxy shim）<br>② 方案 A′（模块表 + 动态 import） | **✅ ①**，并**以 M2 spike 的结论为准**（spike 不过则切 A′） | codeintel 客户端的重构量 |
| **O7** | 双插件各自的 `dsh.plugin.json` 的 `tags` / `description` 怎么写？ | — | **✅** codeintel 的描述写明「需与 IDE 工作台配合」 | 分发页的表述 |

---

## 7. 附录

### 7.1 契约签名速查

```js
// ============ packages/contract/src/index.js ============
export const CONTRACT_VERSION = 1
export const HOST_SERVICE = 'dsh-ide-workbench.contract'
export const SLOT_KEYS = Object.freeze({
  editorBridge:    'ide-workbench.editor.bridge',
  statusItem:      'ide-workbench.status.item',
  settingsSection: 'ide-workbench.settings.section',
  commandItem:     'ide-workbench.command.item',
})
```

```ts
// ============ packages/contract/src/host-api.d.ts ============
export interface WorkbenchHostApi {
  readonly version: number
  getProjectRoot(): string
  getScopeRoot(): string
  readFile(absolutePath: string): Promise<string>
  searchFiles(options: {
    query: string
    caseSensitive?: boolean
    wholeWord?: boolean
    regexp?: boolean
    limit?: number
  }): Promise<{
    files: Array<{
      path: string
      hits: Array<{
        line: number
        column: number
        text: string
        before?: string[]
        after?: string[]
        binary?: boolean
      }>
    }>
    truncated?: boolean
  }>
  onProjectChanged(cb: (root: string) => void): () => void
  health(): { ok: boolean; reason?: string }
}
```

```ts
// ============ packages/contract/src/client-api.d.ts ============
export interface WorkbenchClientContract {
  readonly version: number
  readonly editor: EditorSeam
  readonly host: WorkbenchHostApi   // 客户端侧的同构视图（经 codeintel 自己的宿主代理）
}

export interface EditorSeam {
  registerExtensions(provider: () => ExtensionSlot[]): { refresh(): void; dispose(): void }
  registerKeymap(entries: unknown[]): () => void
  registerCommands(items: CommandItem[]): () => void
  onDocument(cb: (doc: DocumentInfo) => void): () => void
  reveal(absolutePath: string, line: number, column?: number): void
  readonly codemirror: CmRuntime   // 单例交付，见 §3.5
}

/**
 * 一个「扩展槽位」。同 key 的多个槽位只保留优先级最高的那个 —— 让位机制。
 * @see §3.4.1
 */
export interface ExtensionSlot {
  /** 槽位标识，如 'closeBrackets' / 'autocomplete' / 'lsp' */
  readonly key: string
  /** 数值越大越优先；core 用 0，codeintel 用 100 */
  readonly priority: number
  /** 该槽位携带的 CodeMirror 扩展 */
  readonly extensions: unknown[]
}

export interface DocumentInfo {
  uri: string
  absolutePath: string
  languageId: string
  content: string
  dirty: boolean
}

export interface CommandItem {
  key: string
  label: string
  shortcut?: string
  run(): void
  enabled?: () => boolean
}
```

### 7.2 本文档的核实方式

| 结论 | 核实方式 |
|---|---|
| `dd6dc17` 是 `4b2b7dc` 的父提交 | `git rev-parse 4b2b7dc^` |
| 基线无任何代码智能文件 | `git ls-tree -r dd6dc17 -- src` |
| **14** 个新增文件（13 个迁走 + `guard.js` 留 core） | `git diff --diff-filter=A dd6dc17..HEAD -- src/` |
| 45 个提交 | `git log --oneline dd6dc17..HEAD` |
| 纯 core 修复的 **12** 处 | `git log --oneline dd6dc17..HEAD -- <file>` 逐提交比对 |
| DSH 的能力与缺失 | 本机 `@deepseek-ai/dsh@0.2.0-rc.2` 的源码阅读 + 全树 grep |
| **CodeMirror 双实例会崩** | `node_modules/@codemirror/state/dist/index.js:1927,2016`（CodeMirror 自带该错误文案） |
| **双装 `closeBrackets` 当前不会重复闭合**（facet 短路） | `node_modules/@codemirror/view/dist/index.js:4401`（`.some()` 短路）+ `:8868-8870`（CodeMirror 自己的说明）；`@codemirror/autocomplete/dist/index.js:1830`（`closeBrackets()` 返回 `[inputHandler, bracketState]`） |
| 槽位语义（`inject` / 崩溃隔离 / 声明独占） | `@deepseek-ai/dsh-client-ui-slots/lib/index.js:165,191-236,439-483`；`dsh-client-ui-renderer/.../registry.d.ts:97-111` |
| 模块表的 `require` 解析顺序与重复注册抛错 | `@deepseek-ai/dsh-client-modules/lib/client.js:698-706,573-576` |
| 设置文件位置 | `src/host/settings-store.js:151-162` |

> **本轮未运行** `npm test` 与 `npm run build`。文档中引用的一切数字均来自**源码与 git 事实**，测试通过数等「作者声明」一律未复算。

---

> **下一步**：本文件评审通过后，按 §4.1 的 M0 → M2 顺序执行；**M2 的四个 spike 结论**回来后再更新本文件，然后才进入 M3。
