# PRD-v6 实施进展 —— 插件拆分（core ⇄ codeintel）

> **状态**：实施完成（M0–M6 主体 + M7 实机验收已完成，2026-11-03）。
> **规格**：`PRD-v6-插件拆分.md`（归属与装载方式）｜**接口**：`PRD-v6-实施契约.md`（两包之间写死的东西）。
> **V6 增量**：`PRD-v6-增强需求.md`（core 白屏修复 + 四项体验增强，2026-11-03 已实施并实机验收）。
> **代码基线**：`dsh-ide-workbench` `b2317fa`（0.5.1）⇒ 仓库改为 monorepo。

---

## 0. 一页速览

| 项 | 结果 |
|---|---|
| 仓库 | **monorepo**：`packages/{contract,workbench,codeintel}`，npm workspaces |
| core | `dsh-ide-workbench` **0.6.0**（插件 ID 不变 ⇒ 原地升级） |
| codeintel | `dsh-ide-codeintel` **0.1.0-alpha**（独立版本线，预发布版） |
| core 的测试 | **483 / 483 通过** |
| codeintel 的测试 | **818 / 818 通过** |
| 契约测试（根级） | **26 / 26 通过** |
| 机械验收（`npm run verify:split`） | **25 / 25 通过** |
| core 的客户端产物 | 2781 KiB（拆分前 3.0 MB —— 少了 LSP 客户端与补全） |
| codeintel 的客户端产物 | **430 KiB** —— **不含任何 CodeMirror 副本**（机械验收里有这一条） |
| core 的语言服务器依赖 | **零**（`typescript` / `basedpyright` / `yaml-language-server` 全部移出） |
| M2 spike S1 | ✅ **通过**（但**规格 §3.5.3 的 CJS Proxy 写法被实测证伪**，见 §3） |

---

## 1. 阶段落点（M0–M7）

| 阶段 | 产出 | 状态 |
|---|---|---|
| **M0** | 契约包 + monorepo 骨架 + workspace 根 | ✅ |
| **M1** | core 独立成包 + 12 处纯 core 修复回移 | ✅（回移项随 `b2317fa` 的文件整体搬入，修复未被回退） |
| **M2** | 四个 spike | ✅（S1 实测、S2/S3/S4 源码核实，见 §3） |
| **M3** | 整体迁移（13 个文件 → codeintel）+ codeintel 宿主半边 | ✅ |
| **M4** | 客户端接缝：四个槽位 + `EditorSeam` + 扩展槽位 | ✅ |
| **M5** | 切分污染文件（store / Workbench / CodeEditor / SettingsPanel / styles / i18n / settings-store / EditorArea） | ✅ |
| **M6** | 设置迁移 + 构建发版 | ✅（发版流程按包分线） |
| **M7** | 三态验收（只装 core / 只装 codeintel / 双装）+ 隔离性 | ✅ **已实机验收**（2026-11-03；见 §9 与 `PRD-v6-增强需求.md`§6）。验收中发现并修复了两个只有 core-only 才暴露的缺陷（打包缺 `src/contract`；编辑器扩展槽位把键绑定当 Extension），以及一个跨 profile 写设置的缺陷 |

---

## 2. 仓库与构建（OR G-01 / REL-01）

```
dsh-ide-workbench/
├── package.json              ← npm workspaces 根（private，只做编排）
├── packages/
│   ├── contract/             ← 契约包（private，不发版）
│   │   ├── src/index.js      ← CONTRACT_VERSION / HOST_SERVICE / SLOT_KEYS / mergeExtensionSlots
│   │   ├── src/fault-registry.js
│   │   ├── src/host-api.d.ts
│   │   └── src/client-api.d.ts
│   ├── workbench/            ← core（插件 ID 仍是 dsh-ide-workbench）
│   └── codeintel/            ← codeintel（插件 ID dsh-ide-codeintel）
├── scripts/
│   ├── sync-contract.mjs     ← 把契约内联进两个插件（生成物，提交入库）
│   ├── build-client.mjs      ← 共享的客户端构建
│   ├── gen-cm-shims.mjs      ← 生成 codeintel 的 CodeMirror 惰性代理 shim
│   └── verify-split.mjs      ← 机械验收（R5–R8 / ISO-03）
└── tests/                    ← 跨包契约测试
```

**契约包的落地方式（规格 §2.1 的「源码级依赖」）**：契约包**不进任何插件的 `dependencies`**，两包各自把 `packages/contract/src/*.js` **内联**进 `src/contract/`（`npm run sync:contract` 生成并提交）。两份副本靠 `Symbol.for` + `globalThis` 共享运行时状态（故障注册表、CodeMirror 运行时）。`npm run verify:split` 有一项检查「两份副本与源同步」。

**发版**：两个包各有独立版本线，tag 决定发哪个包：

```
git tag v0.6.0 && git push --tags   # → dsh-ide-workbench（core 沿用历史 tag 形式）
git tag codeintel-v0.1.0-alpha && git push --tags   # → dsh-ide-codeintel
```

CI（`.github/workflows/publish.yml`）据此选包、核对 `package.json` 与 `dsh.plugin.json` 的版本一致、跑全部测试与构建、再发布。core 的 tag 也接受 `workbench-v<版本>` 这个旧写法，两个都触发同一条流水线。

---

## 3. Spike 结论（M2）

### S1 —— CodeMirror 单实例 ✅ **通过，但规格的写法被证伪**

规格 §3.5.3 给出的 shim 草稿是 **CJS**（`module.exports = new Proxy(...)`）。**实测不可行**：

> esbuild 把 CJS 模块转成 ESM 命名空间时用 `__copyProps`，它**只复制 `ownKeys` 能列出的键**。一个只有 `get` 陷阱、没有 `ownKeys` 陷阱的 Proxy **一个键都列不出来** ⇒ `import { StateField } from '@codemirror/state'` 编译出的 `import_state.StateField` 是 **`undefined`**。

**落地形态改为 ESM 的「具名惰性 Proxy」**：每个导出名一个 `lazyProxy(namespace, name)`，在**属性访问时**才解析运行时。

| 结论 | 证据 |
|---|---|
| codeintel 单独安装时**物化期不抛错** | `tests/contract-codemirror.test.mjs`：「the codeintel loads while the runtime is not bound」 |
| 未绑定时抛**可读**错误（可捕获） | 同上：「an unbound capability throws a readable error」 |
| core 发布运行时，codeintel 随后可用 | 同上：「the core publishes the runtime」 |
| **core 接受 codeintel 造的扩展**（`instanceof` 不失效） | 同上：「the core accepts the extension of the codeintel」 |
| `instanceof` 跨边界成立 | 同上：「instanceof works across the boundary」 |

**代码镜像是由 `scripts/gen-cm-shims.mjs` 从包本身生成的**（导出名取自各包的 `dist/index.js`），CodeMirror 升级后重跑即可，shim 不会落后于库。

### S2 —— 槽位跨插件注册 ✅

`ctx.slots.inject(key, callback)`（`dsh-client-ui-renderer/lib/client.js:1342`）的语义是「**声明已存在则同步执行，否则在声明提交的那一刻执行**」⇒ **加载顺序无关**。

另外核实了三件事（写进了实施契约）：子槽位由 `register()` 的 **`children` 表**声明；渲染子槽位用组件 props 上的 **`renderSlot(key, owner)`**（key 必须在该 entry 的 `children` 里，否则抛 `SlotOwnershipError`）；`list` 槽位必须给 `options.id`，`single` 槽位在同一优先级不得有两个占用方。

### S3 —— 宿主侧服务总线 ✅

`ctx.provide(name, impl)` / 非 strict 的 `ctx.get(name)` 可用。**必须软取**：硬 `inject: [HOST_SERVICE]` 会让 codeintel 在 core 缺席时**永不 apply**，用户连引导都看不到。

### S4 —— 第二插件的宿主能力 ✅

`ctx.webServer.register` / `registerUpgrade` / `ctx.subprocess.spawn` / `ctx.connection.requestRejection` 对第二个插件同样可用 ⇒ **codeintel 完全自治**（自己的路由前缀、自己的 WS、自己的进程、自己的设置文件、自己的故障边界）。

---

## 4. 关键实现决策（规格之外的取舍）

| # | 决策 | 理由 |
|---|---|---|
| **1** | **契约的落地是「内联副本」而非 workspace 依赖** | DSH 的插件格式把宿主半边当**普通源码**发布，插件只能 import 自己目录里的文件 |
| **2** | **shim 是 ESM 具名惰性 Proxy，不是 CJS Proxy** | 见 §3 S1：CJS 写法实测丢失全部命名导出 |
| **3** | **core 先贡献扩展槽位** | 合并规则「同 key 取高优先级，priority 相同则后注册者胜」；core 的优先级是 0、codeintel 的是 100 ⇒ **让位与加载顺序无关**（C17） |
| **4** | **`closeBrackets` 两边都有，codeintel 胜** | D9；core 的 `dist/client.js` 因此多带 `@codemirror/autocomplete`（数十 KB），但 core **不装** `autocompletion()` ⇒ **仍然没有任何补全**（R8） |
| **5** | **core 的 `getScopeRoot()` = 项目根** | core 不知道更窄的作用域；要更窄范围的一方自己留着 |
| **6** | **core 把 `lsp` 段与四个语义快捷键「读出来丢掉、写回文件」** | PRD §4.4 要求「不再读写」但「不删旧文件里的该段」⇒ 读时丢弃（core 的逻辑永远看不到它们），写时写回（降级旧版仍可用） |
| **7** | **故障边界只有一份，卸载器住在注册表里** | 进程只有一个 `uncaughtException` 处理器，而卸载器属于**先挂载**的那个插件；先挂载的先被卸载就会把边界带走，让还挂着的插件的异常打到宿主的 fail-loud 上 ⇒ **规则落在契约里**（`installPluginFaultBoundary`），两边各自调用 |
| **8** | **codeintel 缺席 core 时不挂任何路由，并每秒复查一次** | 加载顺序无保证 ⇒ 先软取，取不到就降级；core 出现后自动挂上 |
| **9** | **jdtls 的工作区缓存仍在 `<profile>/ide-workbench/lsp-workspace`** | 这是**数据目录**而非代码依赖；留在原处，老用户的 jdtls 索引不丢 |
| **10** | **搜索弹层归 codeintel，core 的 `Ctrl+Shift+R` 改为打开「在文件中查找」标签页** | 决策 O2 ①：基线有这个能力，删掉会让 core 比 `v0.4.1` 更旧 |
| **11** | **`settingsSection` 槽位渲染在工作台自己的设置弹窗里**，不是宿主的 `settings.section` 页 | 只有**声明了子槽位**的那个 entry 才能渲染它；宿主的页面注册在宿主的槽位里，我们不能给它加 children |
| **12** | **core 保留共享设计令牌（`--iwb-code-*`、`--iwb-shadow`）** | 只有 codeintel 的**选择器**搬走；令牌是共用的，搬走会让 codeintel 的部件没有颜色 |
| **13** | **`@codemirror/lsp-client` 用动态 `import()` 加载** | 静态 import 会在**包物化期**执行库的模块体，而那段代码碰到 `@codemirror/state`（已被别名到 shim）⇒ shim 在未绑定时抛错 ⇒ **单独安装 codeintel 将完全装不上**（B1 破）。改成动态加载后，库在**契约到达之后**才初始化 |
| **14** | **降级模式等 1.5 秒再判定，并注册自己的设置页** | 契约的 `settingsSection` 槽位只有 core 在场时才存在 ⇒ 单独安装的 codeintel 需要**自己的**一个页面（注册进宿主的 `settings.section` 槽位）。core 在场时不注册，多一个页面反而碍事 |
| **15** | **索引决策归 codeintel，切项目归 core** | 决策与记忆是代码智能的事；切项目是工作台的事 |
| **16** | **重连用 `lsp.shutdown` + `lsp.start`** | 宿主那个 `lsp.restart` 不带语言、也不带 force ⇒ 重连会丢掉「用哪种语言」与「用户已经答应过强制启动」这两件事 |
| **17** | **Ctrl+click / Ctrl+hover 挂在 `lsp` 扩展槽里** | 接缝没有「注册鼠标处理器」的能力，而槽位的 key 列表被写死为三个 |

---

## 5. 机械验收（`npm run verify:split`）

| # | 验收项 | 机械证据 |
|---|---|---|
| R5 | 无跨包越界 import | 解析两边的 **import 说明符**（不是全文匹配 —— 契约里的服务名 `dsh-ide-workbench.contract` 不是 import） |
| R6 | core 无代码智能残留 | core 的 `src/` 里（去掉注释后）无 `autocompletion(` / `@codemirror/lsp-client` / `LSPPlugin` / `lsp.` |
| R7 | core 无语言服务器依赖 | `packages/workbench/package.json` 无 `typescript` / `basedpyright` / `yaml-language-server` / `typescript-language-server` |
| R8 | core 无补全能力 | core 的 `src/` 里没有 `autocompletion(` 的调用 |
| ISO-03 | core 进程树无语言服务器 | core 的 `src/` 里不出现任何语言服务器名 |
| — | 两包版本一致 | `package.json` 与 `dsh.plugin.json` 的 `version` 相同 |
| — | 契约副本同步 | 两份 `src/contract/index.js` 与 `packages/contract/src/index.js` 逐字节相同 |
| — | codeintel 的 worker 入包 | `files` 含 `src/host`，且 `src/host/lsp-worker.js` 存在 |
| **单实例（强形式）** | **产物级** | core 的 `dist/client.js` **含** `@codemirror/state` 的源码标记；codeintel 的 `dist/client.js` **不含** —— 页面上因此只有一份 `@codemirror/state` |
| **B1** | **codeintel 单独装得起来** | 把 codeintel 的 `dist/client.js` 塞进一个**没有 CodeMirror 运行时、没有 DOM** 的沙箱里加载：**不抛错**，并且导出了 `apply` |

> **注意**：这些检查读的是**代码**（去掉注释）—— 一条解释「为什么 core 没有它」的注释不算违规。

---

## 6. 未完成 / 已知缺口（诚实记录）

| # | 缺口 | 说明 |
|---|---|---|
| **1** | ~~M7 实机验收未做~~ **已完成（2026-11-03）** | 三态在真实 DSH 里跑过，README 化的夹具在 `.e2e/`（`make-profile` / `start-profile` / `smoke` / `upgrade-0.5-to-0.6` / `repro-missing-contract` / `lead-verify`）。实机验收直接暴露了两个只有 core-only 才出现的缺陷，见 §9 |
| **2** | **codeintel 的客户端用例是重写的，不是搬过去的** | 旧的客户端测试驱动的是 `WorkbenchStore`；新的客户端有自己的 `CodeIntelStore`。逐条取舍记录在 §8 |
| **3** | **core 的索引徽标被移除了** | 「已索引 / 已被回收」的项目徽标是 codeintel 的功能，core 不知道 codeintel ⇒ core 的项目选择器不再显示它。规格 §2.2 的职责表没有给这一项归属 |
| **4** | **Java 的设置仍无 UI** | 决策 O4 ②：本轮只搬家，不加功能。`javaHome` / `jdtlsHome` / `javaSearchRoots` / `javaArgs` 仍只能手改设置文件 |
| **5** | **codeintel 的「独立运行」（DEG-02）是开关而非默认** | 决策 O3 ②：默认只给引导，不起任何服务 |

---

## 7. 与规格的偏差（逐条）

| 规格 | 偏差 | 理由 |
|---|---|---|
| §3.5.3 的 CJS Proxy shim | **改为 ESM 具名惰性 Proxy** | 实测 CJS 写法丢失全部命名导出（§3 S1） |
| §3.7.2 的「各插件各自声明归属」 | **归属判定与边界安装合并成一个契约 API**（`installPluginFaultBoundary`） | 边界只有一份而卸载器属于先挂载者 ⇒ 规则必须跨插件可见（决策 7） |
| §3.5.3 的「runtime 放进 `contract.codemirror`」 | **同时**发布到 `globalThis[Symbol.for('dsh.ide-workbench.codemirror')]` | shim 要在**属性访问时**才解析运行时 ⇒ 必须有一个进程级的取用点 |
| §4.4 「core 不再读写 `lsp` 段」 | **读时丢弃、写时写回** | 「不删旧文件里的该段」与「不再读写」在整文档覆盖写的模型下无法同时满足；写回是唯一能保住降级路径的做法 |
| §2.1 的目录树（`packages/workbench/src/{index.js,host,client}`） | **一致**；另加 `src/contract/`（契约的内联副本） | 见决策 1 |
| §5.3 的 C1–C15「功能面等价」 | **待实机核对** | 见缺口 1 |

---

## 8. 测试用例的取舍（逐条）

拆分的测试资产不是「整体搬走」：**95 % 跟着 codeintel 走，但客户端那一半不是搬，是重写** —— 旧的客户端测试驱动的是 `WorkbenchStore` 的旧 API，新的客户端有自己的 `CodeIntelStore`。逐条记录：

| 旧用例 | 处置 | 理由 |
|---|---|---|
| `lsp-status-freshness` 的 git 状态身份用例 | **留在 core** | 那是 core 的事（`sameGitStatus`，B9） |
| `idx-decision` 的切项目用例 | **重写为 `decideIndex`** | 切项目是 core 的，索引决策是 codeintel 的 |
| 弹层测试里的「插件开了标签页」断言 | **改为「插件请求 core 把位置显示出来」** | 插件没有标签页，它有 `contract.editor.reveal` |
| `store-workspace-defaults.test.mjs`（core） | **拆成两半** | 宿主侧五个用例 → codeintel 的 `lsp-settings-migration.test.mjs`；客户端侧 → codeintel 的 `store-lsp-workspace-defaults.test.mjs`（17 例） |
| `search-context.test.mjs` | **留在 core** | 搜索引擎是 core 的通用能力 |
| 其余 60 余个 `lsp-*.test.mjs` | **整体搬进 codeintel** | 零改动或只改 import 路径 |

**新增的用例**（规格里没有、但拆分必须有的）：

| 文件 | 钉住什么 |
|---|---|
| `tests/contract-codemirror.test.mjs` | 单实例的五条：单独装得起来 / 未绑定时抛可读错 / core 发布运行时 / core 接受 codeintel 的扩展 / `instanceof` 跨边界成立 |
| `tests/contract-fault-registry.test.mjs` | 归属判定、**全进程只装一个**处理器、异常只转交一次（I3） |
| `tests/contract-extension-slots.test.mjs` | 同 key 取高优先级、落败者**不安装**、平局后注册者胜、**与顺序无关**（C16/C17） |
| `tests/contract-version.test.mjs` | 常量与冻结 |
| `packages/workbench/tests/client-contract.test.mjs` | 四个槽位的声明、`{ contract }` 的投递、扩展槽位的合并、core 声明 closeBrackets 且**不声明任何补全**（R8） |
| `packages/codeintel/tests/client-extension-slots.test.mjs` | codeintel 的三个槽位与优先级 100、**两种顺序下 core 都让位** |
| `packages/codeintel/tests/client-degraded-mode.test.mjs` | 没有契约时的降级：引导、**不启动任何语言服务器**、不抛异常 |
| `packages/codeintel/tests/lsp-plugin-host.test.mjs` | 路由前缀、自己的设置文件、一次性导入、core 缺席时不抛错、插件的故障不打到宿主 |
| `packages/workbench/tests/host-contract.test.mjs`、`settings-migration.test.mjs` | 宿主契约的形状；设置迁移丢 `lsp` 段与四个快捷键、其余不丢 |

---

## 9. V6 增量（2026-11-03，详见 `PRD-v6-增强需求.md`）

用户报告「只装 workbench 后工作台打开白屏」，并要求三项体验增强。实施 + 实机验收的结果：

| 条目 | 结论 |
|---|---|
| **白屏（三个叠加根因）** | ① `files` 白名单漏 `src/contract` ⇒ 宿主 import 失败、插件不挂载；② 「原始键绑定数组当 Extension」共三处：core 的 `editor-seam.js`（**只装 core** 崩）、codeintel 的 `extensions.js`（**双装时该槽位胜出**，也崩）、core 的 `keymapCompartment.of(seam.keymap)`（**双装时 codeintel 注册了快捷键**才崩）⇒ `EditorState.create` 抛错、React 卸载工作台 ⇒ 白屏 |
| **入口左右可配置** | `settings.layout.entrySide`（默认 `right`），镜像布局只影响 `.iwb-side-right`；左模式零新增选择器 |
| **diff 增强** | 并排 `white-space:pre` 保留空白；`git.wordLevel` 默认开；统一模式 `diffInnerWidth` 单一横向滚动面，并排模式改为**两栏各一半、各自滚动并联动**（`diffPaneWidths` 每栏按本栏最宽行测量，`echoRef` 挡住夹取回声） |
| **Git Blame** | 行号右键 → **行号左侧的内联注解列**（每行 `日期 作者`，未提交行留空）→ 点击跳转 Git 提交；宿主 `git.blame` porcelain 解析 |
| **窄面板工具栏** | 控件不换行不收缩（旧版「编/辑」「utf-/8」折行的根因）；实测 `data-compact` 标记在控件自然宽度 + 140px 路径预算放不下时切「只留图标 + tooltip + 编码首字母」 |
| **全局搜索弹窗 + 选中带入** | 拆分后 core 退回的“查找结果标签页”改回**弹窗**（`SearchPopup.jsx` 回到 core，上半文件列表 / 下半命中与上下文，不开标签）；`Ctrl+F` / `Ctrl+Shift+R` 把**选中文本**带进搜索框（编辑器选区优先、多行取首行）；顺带修掉「切标签后 `Ctrl+F` 静默不弹」的 API 清空缺陷 |
| **跨 profile 写设置** | `profileBase()` 改为优先 `ctx.get('profileContext').dir`，环境变量只作 fallback |
| **新增防回归** | `verify:split` 增加「entry 的 import 图必须全部在 `files` 里」+ 4 个必需产物检查（负向验证过）；`profile-dir` / `git-blame` / `blame-gutter` / `diff-view` / `toolwindow-side` / `toolbar-compact` / `search-popup` / `search-seed` 八个测试文件 + codeintel 的「合法扩展集」用例 |
| **最终数字** | core **483** / codeintel **818** / 契约 **26**；`verify:split` **25/25**；实机：lead-verify **62/62**、升级 **19/19**、双装 **13/13**，0 console/pageerror |
