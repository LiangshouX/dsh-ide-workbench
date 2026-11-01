# PRD-v5 改造需求 实施进展 —— 语义分析的状态可见性、空闲策略与索引性能

> **状态**：**已实施**（M0–M10 全部落地；三条**架构上不可达**的验收条款以实测数字记入 §3，**没有**改写验收口径来掩盖）。
> **规格**：`docs/prd/v5/PRD-v5-改造需求.md`（只读，本文件不重复展开条目定义）。
> **基线**：`dsh-ide-workbench` commit **`d223d4f`**（分支 `main`）；实施分支未提交（工作树）。
> **记录规则**：规格里的每一条都有编号（`VIS-` / `STALE-` / `IDLE-` / `SCOPE-` / `MEM-` / `CRASH-` / `PERF-`）。本文件**只**维护这些编号的**状态**、**实测值**与**偏差决策**；任何与规格不一致的决定，一律**先写在这里、再改代码**。

---

## 0. 开工前置

| 项 | 值 | 状态 |
|---|---|---|
| 规格 | `docs/prd/v5/PRD-v5-改造需求.md` | ✅ 已写 |
| 代码基线 | `d223d4f` | ✅ 已记录 |
| **依赖安装** | `npm install`（78 个包，27 s） | ✅ **已装** |
| 测试基线（依赖未装） | 436 项 / 344 通过 / 92 失败（`ERR_MODULE_NOT_FOUND`） | ⚠️ 规格里记录的旧数字，**不是绿基线** |
| 测试基线（依赖装好后） | **717 项 / 717 通过 / 0 失败** | ✅ **绿基线已回填** |
| 测试基线（改造完成） | **911 项 / 911 通过 / 0 失败**（**+194**） | ✅ |
| 构建基线 | `npm run build` → `dist/client.js` 2,934.2 KiB，退出码 0 | ✅ |

> ✅ 规格 §9.3 的要求已满足：**开工前先装了依赖**，得到真实的绿基线（717/717），因此本轮每个数字都能区分"新引入的回归"与"既有状态"。
> ⚠️ 规格记录的 92 项失败**全部**源于 `node_modules` 为空；装依赖后它们**全部消失**，说明基线本身是健康的。

---

## 1. 里程碑状态

| 里程碑 | 条目 | 状态 | 实测 / 备注 |
|---|---|---|---|
| **M0** | SCOPE-02（仓库 `tsconfig.json`） | ✅ 完成 | 配置项目 **194 个文件**（自身 61 个源文件 + 类型声明），取代推断项目的 2,335 文件 / 84 MB |
| **M1** | VIS-01 / VIS-02 / VIS-03 | ✅ 完成 | 新状态 `suspended`；四态四文案四色调；`idle` / `suspended` 下直接有【重新建立索引】 |
| **M2** | STALE-01 / STALE-02 / STALE-03 | ✅ 完成 | 失活后不再冻结；轮询失败显示「状态未知（正在重试…）」（**隐藏窗口不再误报**，复核第 5 条）；`starting` 起 60 s 出现【取消索引】并显示已等待时长 |
| **M3** | VIS-04 / CRASH-02 | ✅ 完成 | 降级弹**一次** toast（**正文已本地化**，复核第 7 条）；降级 detail 自带原因，并在诊断面板新增「原因」一行 |
| **M4** | IDLE-02 / IDLE-03 | ✅ 完成 | 休眠后首个语义载荷**自动**唤醒；文档表跨休眠保留并在新进程上重开（每份文档恰好一次 `didOpen`）；**内存原因的唤醒失败会带退避重试**（复核第 6 条） |
| **M5** | IDLE-01 / IDLE-04 / IDLE-05 / MEM-04 | ✅ 完成 | 空闲策略三选一；构建期不装空闲定时器；空闲定时器不再丢失；`cancelAfterMs` 进入设置页 |
| **M6** | MEM-01 / MEM-02 / MEM-03 | ⚠️ **两条完成、一条按规格未达成** | MEM-01 ✅ 434 MB；MEM-02 ✅ 累计核算；MEM-03 ❌ **规格前提不成立**，不按字面实现（实测：standby 是可用内存，扣除它会让闸门误拒）——见 §3.1 |
| **M7** | CRASH-01 | ✅ 完成 | `stdout.end()` + `exit(134)` 同时发生 ⇒ `spawned.length === 2`，最终状态**不是** `degraded` |
| **M8** | SCOPE-01 | ✅ 完成（两轮复核后补齐） | 作用域**真的**收敛了：客户端按作用域根发 `rootUri`（`cwd` 不决定 program 范围），围栏分成「通报」与「显示」两个，宿主在**每一条路径上**保留最新的握手——见 §3.4 |
| **M9** | PERF-01 | ✅ 完成 | 仓库未变时 `status` 对象**身份不变** ⇒ ProjectPanel / CommitPanel 不再每 2 s 重渲染 |
| **M10** | PERF-02 / PERF-03 / PERF-04 | ⚠️ **两项达标、一项改口径** | PERF-02 ✅ 比值达标（**6–8×**，绝对值未达标，见 §3.2）；PERF-04 ✅；PERF-03 **验收不可达**，实测见 §3.3 |

---

## 2. 条目状态明细

| ID | 状态 | 实现位置 | 验收结论 | 备注 |
|---|---|---|---|---|
| VIS-01 | ✅ | `src/host/lsp.js`（`TRANSITIONS` / `PROGRESS` / `#exitIdle`）、`src/client/Workbench.jsx` | `ready → suspended` 合法；`suspended → ready` **抛错**；`suspended → starting` 合法 | 空闲退出现在结束在 `suspended`，detail 明说「不是故障」 |
| VIS-02 | ✅ | `src/client/Workbench.jsx`（`lspStatusView`）、`src/client/i18n.js` | `degraded`(warn) / `failed`(error) / `idle`(idle) / `suspended`(idle) 四态可区分 | `lsp.status.degraded` 的**原文案未动**（THEME-04 的统一话术保留） |
| VIS-03 | ✅ | `src/client/Workbench.jsx`（`showRebuildButton`） | `idle` / `suspended` 下 `showRebuild` 为真 | `lsp.rebuilding !== true` 的互斥保留 |
| VIS-04 | ✅ | `src/host/lsp.js`（`#transition` 发 `{type:'degraded'}`）、`src/client/lsp-transport.js`（`isControlEvent` / `onControl`）、`src/client/store.js`（`lspControl`） | 降级弹**一次** toast；控制事件**不进入** JSON-RPC 库；**休眠不弹** | 崩溃→重启→降级是**一个故障区间**，只弹一次（见 §3.5） |
| STALE-01 | ✅ | `src/client/store.js`（`deactivate`） | 失活后轮询仍在，结果照常写回 store | 两个轮询定时器都 `unref()` 了，否则 Node 测试进程会被挂住 |
| STALE-02 | ✅ | `src/client/store.js`（`state.lspStatusStale`） | 轮询失败 ⇒ 「状态未知（正在重试…）」，不再停在旧值 | 陈旧标志**优先于**一切状态分支（`Workbench.jsx`）。**窗口隐藏不再置标志**（跳过轮询不是失败的轮询），回到前台由 `visibilitychange` 立即刷新 |
| STALE-03 | ✅ | `src/host/lsp.js`（`startedAt` 前置、`#indexSnapshot`）、`src/client/store.js`（`lsp.index` 覆盖三态）、`src/client/Workbench.jsx`（`showCancelButton`） | 启动 60 s 后出现【取消索引】；显示「已等待 2 分 14 秒」 | `startedAt` 移到 `starting` **之前**，取消窗口从一开始就计时 |
| IDLE-01 | ✅ | `src/host/settings-defaults.js`、`src/host/settings-store.js`（版本 4→5 + 迁移）、`src/host/lsp.js`、`src/client/SettingsPanel.jsx` | 设置页可选「永不退出」 | 「永不」选项带 1.8–2.2 GB 常驻警告；`autoExit: false` 的旧文档仍被宿主尊重 |
| IDLE-02 | ✅ | `src/host/lsp.js`（`relayToServer` / `#requestWake` / `#wakeSession` / `degradeCause`） | 休眠后首个载荷自动拉起，载荷被重放 | 每个 root 一个 `wakePromise` 栅栏 ⇒ 一批并发载荷只起一个进程；`memoryWarnedRoots[root] === 'conservative'` 的项目**不唤醒**；**内存原因的降级会带 60 s 退避重试**，其它原因的降级不重试 |
| IDLE-03 | ✅ | `src/host/lsp.js`（`#exitIdle` 不再 `#forgetDocuments`） | 宿主文档表跨休眠保留，唤醒后重开 | 每份文档**恰好一次** `didOpen`（重放载荷不会重复打开） |
| IDLE-04 | ✅ | `src/host/lsp.js`（`#armIdleTimer` 判 `isBuildingProgram`） | 构建 program 期间不装空闲定时器 | 语义请求挂起时清定时器、服务器应答后重装 |
| IDLE-05 | ✅ | `src/host/lsp.js`（`#rearmAfterEarlyExit`） | `#exitIdle` 提前返回后定时器被补装 | 剩余时间不足时按剩余时间补装，避免忙循环 |
| SCOPE-01 | ✅ | `src/host/lsp.js`（`scopeRootOf` / `lsp.indexScope`）、`src/index.js`（`lsp.scope` API）、`src/client/lsp-session.js`（握手用作用域根）、`src/client/lsp-workspace.js`（两个围栏） | 作用域真的收敛：`rootUri` 决定 program 范围 | 复核发现 `cwd` 不管用才补的客户端半边，见 §3.4；**宿主侧的收敛第一轮只修了一半**（服务器在跑时新握手不写回缓存），第五轮补齐；运行中的服务器保留原 program 到下次启动（**下次启动用最新的握手**） |
| SCOPE-02 | ✅ | `dsh-ide-workbench/tsconfig.json`（新增） | tsserver 不再需要构建推断项目 | `tsc` 不参与构建（esbuild），`npm run build` / `npm test` 均不受影响 |
| MEM-01 | ✅ | `src/host/lsp.js`（`LSP_REGISTRY` 的 `memoryBaselineMB`） | 256 → **434** MB（实测中位数） | 代码与测试注释都写明：**256 MB 测的是空载包装进程，不是索引成本** |
| MEM-02 | ✅ | `src/host/lsp.js`（`session.reservedBytes` / `#reservedBytes` / `#releaseReservation`） | 放行第 3 个索引前会先算上已有两个 | 预留额取**上限**（`memoryLimitMB`），取舍见 §3.6 |
| MEM-03 | ❌ **按规格未达成，且不应达成** | `src/host/lsp.js`（探针契约 + 算式） | 算式与可注入契约已落地并有测试 | **规格前提不成立**：standby 是内核优先回收的可用内存，扣除它会让闸门拒绝机器给得起的启动。实测证据与「为什么不按 `GetPerformanceInfo` 修」见 §3.1 |
| MEM-04 | ✅ | `src/client/SettingsPanel.jsx`、`src/client/i18n.js` | 用户可调取消按钮出现的等待时间（秒） | 宿主默认值 60000 未改 |
| CRASH-01 | ✅ | `src/host/lsp.js`（`session.crashedGeneration`） | `stdout.end()` + `exit(134)` ⇒ `spawned.length === 2`，状态**不是** `degraded` | 同一 generation 的第二个死亡信号被**忽略**而不是降级 |
| CRASH-02 | ✅ | `src/host/lsp.js`（`#degradationDetail`） | 降级 detail 写明「<原因>；自动重启预算已用尽（1 次），语义分析已暂停」 | `#noteTimeout` 把 reason 带进了 `#onCrash` |
| PERF-01 | ✅ | `src/client/store.js`（`sameGitStatus`） | 空仓库下 CommitPanel / ProjectPanel 不再每 2 s 重渲染 | `statusAt` 仍每次刷新（快照年龄要真实），但它不在面板的 slice 里 |
| PERF-02 | ⚠️ | `src/host/search.js`（`comparePaths`） | 比值达标（**6–8×**），绝对值未达标 | 实测 330 ms → 50 ms（5 万条路径），见 §3.2 |
| PERF-03 | ⚠️ | `src/client/CodeEditor.jsx`（`LANGUAGE_PACKAGES` / `languageCompartment`） | **验收的减包不可达**；实测收益改为「延后求值」 | 文件**增大** 117,951 B（+4.07 %），见 §3.3；测试已改用**生产构建配置**（复核第 2 条） |
| PERF-04 | ✅ | `src/client/index.jsx`（`WORKBENCH_CSS` 模块级常量） | 120 KB CSS 字符串每帧拼接 → 只拼一次 | `Styles` 一并提到模块级 |

---

## 3. 偏差与决策记录

> 规格与实现不一致时，**先记在这里，再改代码**。每条写明：日期、决策、理由、受影响的规格条款。

### 3.1 MEM-03 —— standby cache 在纯 Node 里**读不到**（实测证据）

**日期**：2026-11-01　**影响条款**：MEM-03、§5.4

规格 §5.4 把「`os.freemem()` 把 standby cache 当成可用内存」列为可证伪的问题 #2，并要求「读 Windows 的 `FreePhysicalMemory`（已含 standby 的语义差异）而非 `os.freemem()`，**或显式扣除 standby cache**」。

**本机实测**（`GlobalMemoryStatusEx` / `GetPerformanceInfo` 经 P/Invoke，同一瞬间取样 3 次）：

| 量 | 实测值 | 说明 |
|---|---|---|
| `GlobalMemoryStatusEx().ullAvailPhys` | 2,889 / 3,010 / 2,970 MB | Windows 的「可用物理内存」 |
| `os.freemem()`（Node 22） | 2,915 / 2,982 / 3,044 MB | 与 `ullAvailPhys` **在采样噪声内相等** |
| `GetPerformanceInfo().SystemCache` | 2,403 / 2,408 / 2,405 MB | **文件缓存 + standby 合计**，不是 standby 本身 |
| `Win32_PerfRawData_PerfOS_Memory.StandbyCache*`（正常/核心/保留） | 1,698 / 67 / 661 MB | **standby 列表本身**，三个优先级合计 ≈ 1.8–2.0 GB |
| `FreeAndZeroPageListBytes` | 161 MB | 真正「空闲」的那部分 |
| `AvailableBytes`（性能计数器） | 2,587 MB | **包含** standby —— 与 `ullAvailPhys` 同一个口径 |

**决定性实验**：在这台机器上让一个 Node 进程**申请 1.5 GB**，同时观察计数器：

| | standby | available |
|---|---|---|
| 申请前 | 2,046 MB | 2,483 MB |
| 申请中（1.5 GB 已分配） | **830 MB**（↓ 1,216 MB） | 904 MB |
| 申请释放后 | 844 MB | 2,614 MB |

⇒ 那 1.5 GB **正是从 standby 里拿到的**，没有换页、没有失败。

**结论（与规格的前提相反）**：

1. `os.freemem()` 把 standby 算作可用 —— **这是对的**。standby 是**干净的、文件后备的、随时可丢弃**的页；内核在压力下**第一件丢的就是它**，先于换页。Windows 自己的 `Available Bytes` 计数器也把它算作可用。**「standby 不该算可用」是一个错误的前提。**
2. 按规格扣除 standby 会让闸门**拒绝机器其实给得起的启动**：本机 available 2,483 MB、standby 1.2 GB，扣掉之后只剩约 1.3 GB，落在软阈值（651 × 2 = 1,302 MB）附近 —— 本来能起的索引会变成「紧张」，需要用户点【重新建立索引】。
3. 复核意见建议的替代口径（`GetPerformanceInfo().SystemCache`）**更糟**：它把 standby 与文件缓存工作集混在一起（本机 2,403 MB vs standby 1,798 MB，**多算约 600 MB**），而且纯 Node 根本调不到这个 API（需要 FFI）。
4. `FreePhysicalMemory`（WMI）就是 `ullAvailPhys`，换过去**一个字节都不差**。

**决策**：

- ❌ **不实现扣除 standby**，并且把这一点写进代码注释而不是藏起来。规格 §5.4 的验收（「不再把 652 MB standby 当可用」）**未达成，且不应达成** —— 达成它会让插件拒绝机器给得起的启动。
- ✅ 保留**算式与契约**（探针 `{ totalBytes, freeBytes, standbyBytes? }`、`availableBytes = free − standby − reserved`、快照上报 `standbyBytes` / `reservedBytes` / `availableBytes`）：默认探针报 `standbyBytes: 0`，而 **0 在 Windows 上就是正确的值**（standby 该算可用）。留给需要更严口径的部署注入探针。
- ✅ **真正挡住「把机器推进 swap」的是 MEM-02 的预留额账本**，那一条是完整落地的：每台运行中的服务器按**被授予的上限**记账，进程一消失就归还。
- **对复核意见的回应**：事实部分（「验收未达成、默认探针是空操作」）**接受**；「原缺陷未消除」**不接受** —— 因为它不是缺陷；「用 `GetPerformanceInfo` 真实实现」**不接受** —— 实测证明它会多扣约 600 MB 的可回收文件缓存。

> 规格 §5.4 引用的「652 MB standby」是 `StandbyCacheReserveBytes`（661 MB）这一个优先级，不是 standby 列表的全量（1.8–2.0 GB）。本条与规格 §0.3 是同一类问题：**一条已过期的归因**，按实测更正，不按字面实现。


### 3.2 PERF-02 —— 相对收益达标，绝对指标未达标

**日期**：2026-11-01　**影响条款**：PERF-02、§7.3

规格验收是「50,000 路径排序 **< 25 ms**（实测基线 157 ms）」。本机（i5-10300H @ 2.5 GHz，Node 22）实测三轮取优：

| | 5 万条路径排序 |
|---|---|
| 改前（`localeCompare`） | **≈ 330 ms**（250–400 ms，随负载波动） |
| 改后（普通 `<` / `>`） | **≈ 50 ms** |

- ✅ **比值达标**：6–8×，规格的 7.9× 在本机复现。
- ⚠️ **绝对指标未达标**：普通比较本身在本机就要 ~50 ms，25 ms 达不到。
- **决策**：测试断言写成 `plain < 100 ms` **且** `plain × 3 < collated`——相对断言不随机器负载波动，才是真正的回归防线；绝对值按实测定为 100 ms。
- **附带变化**：排序顺序变成**码位顺序**（`B.ts, a.ts, c.ts`），不再是 ICU 排序（`a.ts, B.ts, c.ts`）。排序只承诺过"稳定、可预期"，代码注释里写明了这一点。

### 3.3 PERF-03 —— 「减包 573 KB」在**单文件客户端装载器**下不可达

**日期**：2026-11-01　**影响条款**：PERF-03、§7.4

规格验收是「bundle 减少 ≈ 573 KB（21 %）」。**架构上不可达**：DSH 的客户端装载器每个包只取**一个脚本**（`scripts/build.mjs`：`esbuild` + `format: 'cjs'` + 单个 `outfile` + **无 `splitting`**），所以 `import()` 的模块会被**内联进同一个文件**，拆不出独立 chunk。

同树 A/B 实测（只换 `CodeEditor.jsx`）：

| | 字节 | 语言包 | 语法包 |
|---|---|---|---|
| 改前（静态 import） | 2,882,407 | 148,693 | 551,524 |
| 改后（动态 import） | **3,001,157（+118,750 / +4.1 %）** | 172,163 | 572,506 |

**决策**：照规格做动态 import（13 个包改成 `import()`，语法放进新的 `languageCompartment`，包到了再 `reconfigure`），**并如实记录文件是变大的**（esbuild 在动态图里不做 tree-shaking，还要给 36 个模块套惰性初始化器）。**没有**为了凑数字去改构建脚本。

**实际拿到的收益**（在出厂的 `dist/client.bundle.cjs` 上核对）：13 个语言包与 13 个语法包被 `__esm` 包裹，初始化只在动态 import 的 promise 里发生 ⇒ **页面加载时不再求值**；实测省下 **291 ms CPU 与 8.3 MB 堆**（本机 Node，单文件）。编辑器内核（`@codemirror/state|view|language`、`@lezer/*`）仍然急加载，编辑器在启动时照常可用。

**若要真正减包**：需要 `format: 'esm'` + `splitting: true` 的分块构建，入口 chunk 里 `@codemirror/lang-*` 与语法包归零——**但当前装载器吃不了兄弟 chunk**（而且 esbuild 直接拒绝 `format: 'cjs'` + `splitting: true`），这一项不在本轮范围。

**复核追加（2026-11-01 检视后）**：本条原先的**测试**有一个更要命的问题——它用 `splitting: true` + `outdir` + `format: 'esm'` 打包后断言元数据，也就是**验证了一套产品根本不用的构建配置**。它证明的是「源码里写了动态 import」，不是「发布的产物变小了」；配置不同的测试最容易骗过评审。

测试已重写：

- 构建选项**从 `scripts/build.mjs` 本身抽取**（扫描 `await build({…})` 字面量，在 `vm` 里以 `dev:false` 求值），测试**无法再与生产构建漂移**；
- 断言的是**产物的事实**：13 个语言包与 12 个语法包仍是**内联在同一个文件里**（≈ 879 KB），文件**变大了**——测试断言的是这个事实，不是「包离开了产物」；
- 真正的收益有**运行时证据**：给每个语言包与语法包注入一个标记行，`require()` 产物后标记列表必须**为空**（加载时 0 个语言模块被求值；打开对应语言的文件时才求值）。只有编辑器内核（`@lezer/common`、`@lezer/highlight`）在加载时求值；
- **回归检查**：把 `CodeEditor.jsx` 换回静态 import 重建，三条断言同时变红（0 个 promise 站点、0 个 `__esm` 包裹、**加载时 26 个语言模块被求值**）——测试不是空转的。

A/B 数字（隔离的两棵树，只换 `CodeEditor.jsx`，都用生产配置）：**2,896,517 B → 3,014,468 B（+117,951 B / +4.07 %）**，与本文件先前记的 +118,750 B 一致（绝对值差 14 KB 是因为树在动）。

### 3.4 SCOPE-01 —— `cwd` 不决定 program 范围，真正决定的是 `rootUri`

**日期**：2026-11-01　**影响条款**：SCOPE-01、§4.2

**复核发现（成立）**：宿主侧原来只把作用域根用作语言服务器的 `cwd`，而 **`cwd` 不决定 TypeScript 的 program 范围**。已装的 `typescript-language-server@6.0.2` 里写得很清楚：

- `lib/cli.mjs:25294` — `this.workspaceRoot = this.initializeParams.rootUri ? parse(this.initializeParams.rootUri).fsPath : …`
- `lib/cli.mjs:19266` — `getProjectRootPath(resource)` → `this.client.getWorkspaceRootForResource(resource)`
- `lib/cli.mjs:19185` — 每个 `open` 命令带 `projectRootPath: this.getProjectRootPath(document.uri)`
- `lib/cli.mjs:25367` — `this.tsClient.start(this.workspaceRoot, {…})`

客户端仍以**工作区根**发 `rootUri`（`src/client/lsp-session.js` 的 `fileUriOf(root)`），所以 tsserver 建的仍然是覆盖整棵树的 program；宿主新增的 `scopeRoot` 字段被上报，却**没有人使用**。本仓库之所以变小，靠的是 SCOPE-02 的 `tsconfig.json`（把插件包变成 configured project），**不是**作用域规则。

**已修复**（客户端侧）：

- **宿主 API** `POST /ide-workbench/api/lsp.scope` → `{ scopeRoot, languageId }`。它读 `settings.lsp.indexScope`，而语言与作用域的判定由 `LspManager.scope()` 统一负责（钉死语言 → 运行中的会话 → 显式请求 → 最近一次会话 → 入口 → 持久化的 `indexedRoots` → 源码投票），与 `lsp.start`、`lsp.resources` 同一条规则；**不需要**已有会话。PRD-v5.1 JS-04 之后它接受可选的 `languageId`，并返回宿主真正要启动的语言。
- **客户端**在握手**发出之前**用作用域根当 `rootUri`（`fileUriOf(scopeRoot)`）。顺序很重要：宿主只把**第一次** `initialize` 转发给语言服务器（frame worker 的 `Handshake.noteForwarded`），所以只有第一次握手能决定 program。客户端对象照旧立刻创建、**握手等作用域**——晚一点创建对象会破坏五个既有测试文件里约 30 个同步取 `lspClient()` 的用例。
- **围栏分成两个**：`insideScope()`（作用域根）只管**向服务器通报文档**；`insideRoot()`（工作区根）继续管查找引用的读文件与 `displayFile()`。作用域外的文件**不再通报给服务器**（这是作用域收敛的既定代价，规格 §4.2 点名了「跨项目跳转不再解析」），但工作台**仍然打不开**它——把 `displayFile()` 也收窄会让「跳转到服务器提到的文件」失效。
- **宿主侧的补丁（两轮复核才补齐）**：宿主原来永远保留**第一次**握手，于是作用域策略改动后，下一次重启会把 program 悄悄退回旧的作用域。第一轮复核把 `#holdFor` 改成**最新的握手胜出**，但那只覆盖了「服务器**不在**」的那条路：服务器**在跑**时，新握手被 frame worker 吸收应答（缓存命中直接返回、`noteForwarded` 对第二次握手返回 false），**从不写回宿主缓存** ⇒ 下次重启仍然用**旧**握手，作用域**静默退回**。第五轮复核（P1-1）指出这一点并已补齐：宿主在 `relayToServer` 把载荷交给 worker **之前**就记下握手（`if (isInitializeRequest(text)) entry.handshake = text`），而 worker 的 `{type:'handshake'}` 消息只在 `entry.handshake` **还是空**的时候填——那条消息是异步的，迟到的旧消息不能覆盖新握手。回归测试：`tests/lsp-review-fixes.test.mjs` 的「the newest handshake is the one a server that starts later is initialized with」，**加**新增的 `tests/lsp-handshake-scope.test.mjs`「a handshake that arrives while the server runs is the one a restarted server is initialized with」与「a late handshake message of the worker does not overwrite the newer handshake」（去掉修复即变红，已验证）。

**仍未达成的一点**：**运行中的**服务器保留它原来的 program，直到它下一次启动。作用域策略是高级设置，这个「下次启动生效」的语义与插件的其它设置一致，记录在此。**（补齐之后，这条「下次启动生效」是保证：下一次启动用的是最新的握手。）**

### 3.5 VIS-04 —— 降级的 toast 另有标题（不谎报"服务器已退出"）

**日期**：2026-11-01　**影响条款**：VIS-04、§1.5

宿主侧新增 `{type:'degraded'}` 控制事件、传输层把控制事件与 JSON-RPC 分开、store 的 `lspControl()` 弹一次 toast——都按规格做。但**标题**没有直接复用 `lsp.crashedToast`（《语言服务器已退出。》），而是新增了 `lsp.degradedToast`（《语义分析已暂停。》）。

**理由**：宿主侧的 `degraded` 有四条产生路径，其中三条**根本没有退出**——语言在设置里被关掉、服务器没装、内存不够。此时说"服务器已退出"是**假话**，而这正是本轮要消灭的那类"状态栏骗人"。

**顺带修掉的两处**：
- `crashed → restarting → degraded` 在同一毫秒窗口内走完，2 s 轮询采不到 `crashed` ⇒ 旧的崩溃 toast 也会被跳过。现在用**故障区间**标志（`lspFaultNotified`）：`crashed` / `degraded` 算一次故障，只弹一次；`restarting` / `cancelling` **不**清标志（否则会弹两次），`starting` / `building` / `ready` / `idle` / `suspended` 才清。
- 轮询路径与控制事件路径走同一个 `#announceLspFault`，两条路径**幂等**。

### 3.6 MEM-02 —— 预留额取**上限**而不是实测占用

**日期**：2026-11-01　**影响条款**：MEM-02、§5.3

规格 §5.3 写的是「减去本进程已启动的语言服务器的**实际 RSS 之和**（……**或**维护一个已启动服务器的预留额账本）」。实现选了**账本**这条路，账本的额度取 `memoryLimitMB`（TypeScript 默认 2048 MB），**不是**实测的 434–449 MB。

**理由**：tsserver 被明确告知上限（`maxTsServerMemory`），上限**真的会到达服务器**；机器要能扛住它跑的每一个服务器的**最坏情况**。

**用户可见的代价（必须写明）**：

| 机器 | 允许的并发索引 | 预留 | 实测占用 |
|---|---|---|---|
| 16 GB，空闲 4 GB | 第 1、2 个允许，**第 3 个被拒** | 2 GB / 台 | ≈ 449 MB / 台 |
| 8 GB，空闲 8 GB | 4 个 | 8 GB | ≈ 1.8 GB |

⇒ 在 16 GB / 空闲 4 GB 的机器上开第三个项目，会看到「保守版」。这是闸门**有意**的保守，不是实现事故。规格 §5.3 的验收场景（「16 GB / 4 GB 空闲 ⇒ 第 3 个被拒」）由此**精确满足**。

### 3.7 IDLE-02 —— 规格没写、但不做就落空的两处

**日期**：2026-11-01　**影响条款**：IDLE-02、§3.3

规格 §3.3 的用户承诺是「空闲后**第一次**按 F12 / 触发补全 / 打开文件 ⇒ 服务器自动起来」。只做规格字面写的宿主侧，**这条承诺落空**，因为客户端把路堵死了：

| 位置 | 问题 | 决策 |
|---|---|---|
| `src/client/lsp-session.js` `capabilityAvailable()` | 要求 `state === 'ready'` ⇒ `suspended` 时右键菜单的「跳转定义 / 查找引用」**置灰**，用户无法从菜单唤醒 | 新增 `semanticStateAllowed()`：`ready` 与 `suspended` 放行；`idle`（从未启动过，宿主不会唤醒）/ `degraded` / `failed` 仍然置灰 |
| `src/client/store.js` `semanticNavigation()` | 同上，导航菜单的「语义查找引用」置灰 | `suspended` 视为可用 |
| `src/client/lsp-session.js` `requestBudgetOf()` | `semanticAnswers > 0` 时用短预算（30 s），而唤醒出来的服务器要**从头构建 program**（宿主侧 `session.realAnswers` 归零 ⇒ 宿主用长预算 600 s）⇒ **客户端 30 s 放弃、宿主还在等** | `suspended` 时用长预算（`max(configured, BUILD_REQUEST_TIMEOUT_MS)`），**在请求创建时**决定（客户端要等 2 s 轮询才知道进程换了，来不及） |

> 最后一条是**两端预算一致**的硬要求（`tests/lsp-budget-agreement.test.mjs` 的立意）。F12 键位本来就直接调 `jumpToDefinition`，所以键盘路径原本就能唤醒；被堵住的是菜单路径。

### 3.8 IDLE-01 —— 设置页的下拉与 `autoExit` 开关一起写

**日期**：2026-11-01　**影响条款**：IDLE-01、§3.2

宿主以 `lsp.autoExit === false` **优先于** `lsp.idlePolicy`（旧文档不能失去原意）。若设置页只写 `idlePolicy`，一份写着 `autoExit: false` 的文档在下拉里会显示「空闲后退出」，而宿主**永不退出**——页面在承诺宿主不做的事。

**决策**：下拉读：`autoExit === false ? 'never' : idlePolicy`；下拉写：`idlePolicy` **与** `autoExit`（`autoExit = policy !== 'never'`）一起。两边从此不会互相矛盾。

### 3.9 STALE-01 —— 轮询存活 ⇒ 需要一个新的 `dispose()`

**日期**：2026-11-01　**影响条款**：STALE-01

`deactivate()` 不再停 LSP 轮询（那正是 U1 的根因），于是**每个访问过的工作区**都会留下一条 2 s 的轮询。store 被 `StoreCache` 逐出时需要一个真正的收尾：**新增 `store.dispose()`**（停两个定时器），`StoreCache.evict()` / `clear()` 优先调它，没有则回退 `deactivate()`（保住既有假 store 的测试）。两个定时器都 `unref()` 了，否则 Node 测试进程会被挂住。

### 3.10 诊断面板的「内存」行 —— 显示闸门真正用的那个数

**日期**：2026-11-01　**影响条款**：MEM-02（连带）

MEM-02 让闸门开始累计核算已启动的服务器，于是快照里多了 `reservedBytes` 与 `availableBytes`。但**界面没有跟上**：诊断面板的「内存」行和设置页的内存提示都还在显示 `freeBytes`（整机可用），于是

> 面板：「内存 2732 MB / 651 MB」 ⇒ 看起来内存充足
> 闸门：`availableBytes = 2732 − 2048 = 684 MB` < 软阈值 1302 MB ⇒ 判 **tight** ⇒ 拒绝启动

**两个屏幕回答同一个问题，却给出相反的结论** —— 这正是本轮要消灭的那类缺陷。MEM-02 自己的验收（「放行第 3 个索引前会先算上已有两个」）没有界面部分，但缺陷是同一处。

**决策**：两处都改成显示 `availableBytes`（闸门的数），并把预留额**明码标价**：

| 界面 | 改前 | 改后 |
|---|---|---|
| 诊断面板「内存」行 | `2732 MB / 651 MB` | `可用 684 MB · 需要 651 MB · 已预留 2048 MB`（无预留时不显示第三个数） |
| 设置页内存提示 | `当前可用内存 2732 MB · …` | `当前可用 684 MB · …`，另起一行说明预留额 |

**「已预留」而不是「已占用」**：预留额是**按上限记账**，不是实际占用（实测一台 TypeScript 索引实际占 434–449 MB）。用词必须准确，否则这一行自己就成了新的谎言。诊断面板的悬浮提示把三个数逐个讲清楚。

**新增**：`memoryFacts(store, resources)`（`src/client/Workbench.jsx`，可测）、i18n key `lsp.diagnostics.memory{Available,Need,Reserved,Hint}`、`settings.lspMemoryReserved`。

### 3.11 状态栏说「就绪」而语义功能全死（用户报告的缺陷）

**日期**：2026-11-01　**影响条款**：VIS-01 / VIS-02 / VIS-03（连带）

**现象**：底部显示「语义分析：就绪」，但悬浮没有定义提示、右键的「查找用法（语义）/跳转定义」是**灰色**的。宿主那边毫不知情。

**根因：两个互不校验的真相源**：

| 界面 | 读的是 | 含义 |
|---|---|---|
| 状态栏「就绪」 | 宿主的 `lsp.status` → `state` | **语言服务器进程**活着 |
| 右键菜单灰色 | 客户端的 `currentClient.serverCapabilities` | **浏览器↔服务器**这条链路通着 |

- `@codemirror/lsp-client`（`dist/index.js:539,587,602`）：`serverCapabilities` 在 `initialize` 的**应答**到达之前是 `null`，`disconnect()` 又把它清空 ⇒ `capabilityAvailable()` 返回 false ⇒ 菜单项置灰。
- 宿主的 `#scheduleReady`（`src/host/lsp.js`）由**任意一条**服务器消息触发 ⇒ 宿主的 `ready` 只是「进程起来了、说过话了」，**不是**「语义链路是通的」。

**为什么客户端自己出不来**：宿主的前端 worker **只转发第一次 `initialize`**（`src/host/lsp-worker.js`：`noteForwarded()` 对之后的握手返回 false，载荷被**丢弃**），之后的握手只能从**缓存**（服务器答过第一次才有）里应答。服务器若从没答过第一次，**每一次后续握手都被静默丢弃** ⇒ 客户端永远拿不到能力。客户端重试 3 次后只留一句 `console.warn` ⇒ **界面上零提示、零按钮**，宿主还在说「就绪」。

**为什么拖了十分钟**：库用 `client.timeout` 创建**每一个**请求（`dist/index.js:716`），而那正是**首个语义请求**的预算（最长 600 s，用于 program 构建）。握手本该毫秒级应答，却拿到 600 s ⇒ 一次坏掉的握手要**十分钟**才暴露。

**修复**：

1. **客户端会话有自己的状态**：`'starting' | 'ready' | 'failed'`，由 `reportClientState()` 报告给 store（可选调用、绝不抛错）。
2. **状态栏不再相信宿主一个人的话**：`clientState === 'failed'` ⇒ 「语义分析：会话未就绪」（**红**，`error`），**压过宿主的每一个状态**（功能坏了就是坏了）；`clientState === 'starting'` 且宿主说 `ready` ⇒ 「语义分析：正在连接…」（灰）。
3. **握手失败要快**：握手用**短预算**（`HANDSHAKE_TIMEOUT_MS = 30000`），握手结束后立刻把会话预算（最长 600 s）写回去。库在**创建请求**的那一刻读 `client.timeout`，而语义请求只在 `initializing` 兑现之后才被创建 ⇒ 短窗口碰不到语义请求（`tests/lsp-budget-agreement.test.mjs` 与 `tests/lsp-client-budget.test.mjs` 仍然成立）。
4. **有出口**：状态栏出现【重新连接】——客户端重做握手（宿主保留**最新**握手，下一个进程会用它初始化），**再**重启宿主的服务器（新进程 = 新的 worker = 空的握手缓存 ⇒ `initialize` 真的能到达服务器）。两个按钮**互斥**：【重新建立索引】管宿主的状态，【重新连接】管死掉的会话（重建一个健康的服务器的索引并不能修好浏览器与它之间的链路）。
5. **灰掉的菜单说明原因**：会话没就绪时用「语义分析会话尚未就绪，可在状态栏重新连接」，而不是那句在会话死掉时**撒谎**的「该语言服务器不支持查找引用」。
6. **宿主侧不再静默**：frame worker 丢弃一个「服务器还没答第一次」的握手时会报出来，宿主把它写进日志 —— 这正是状态栏开始撒谎的那一刻。

**连带**：两个既有测试（`tests/idx-decision.test.mjs`、`tests/lsp-status-progress.test.mjs`）用的是真实 store 的默认切片，`clientState` 的初值让它们看见了新的状态；两处各加**一行前置条件**（`clientState: 'ready'`）并写明原因，**断言本身没有削弱**。



---

### 3.12 第五轮复核（2026-11-01）：三条成立、两条说明项；一处**复核没点名、却更常见**的误报

**日期**：2026-11-01　**影响条款**：SCOPE-01 / VIS-01 / VIS-02 / MEM-02（连带）　**检视报告**：`docs/prd/v5/PRD-v5-代码检视报告-第五轮.md`

第五轮检视提出 **5 条**（2 中 / 1 低 / 2 说明），无高危。逐条核实后 **5 条全部成立**，全部已修；另**更正了 7 处与代码不符的表述**（§6.2）。复核点名的三处复查（短握手预算 / 最新握手胜出 / clientState 优先级）里，**两处成立、一处只成立一半**——那「一半」正是 P1-1。

#### P1-1（成立，已修）作用域只在「服务器不在」时收敛

第一轮复核把「最新握手胜出」做进了 `#holdFor`——**服务器不在**的那条路。服务器**在跑**时，客户端的新握手被 frame worker 吸收应答（缓存命中直接返回；`noteForwarded` 对第二次握手返回 false），**从不写回宿主缓存** ⇒ 下一次进程重启（崩溃重启 / 空闲唤醒 / 【重新建立索引】）仍然用**旧** `rootUri` ⇒ **作用域静默退回**，比「不生效」更糟：它与用户刚做的设置相反。

**修法**（宿主侧，1 行 + 1 个条件）：

- `relayToServer` 在把载荷交给 worker **之前**记下握手（`if (isInitializeRequest(text)) entry.handshake = text`）。宿主是唯一知道「这个 root 现在用哪个握手」的权威。
- worker 的 `{type:'handshake'}` 消息**只在 `entry.handshake` 还是空的时候**才填——那条消息是**异步**的，迟到的旧消息不能覆盖新握手。

**回归测试**（新增 `tests/lsp-handshake-scope.test.mjs`，3 例）：服务器在跑时到达的握手才是重启后那个进程用的握手；迟到的 worker 消息不覆盖新握手；稍后启动的服务器用的是客户端的握手。去掉修复即变红（已验证）。

#### P1-2（成立，已修）状态栏把「没有服务器」报成「会话死了」

客户端会话机制（上一轮）**只读全局开关**，不看 store 已经决定的「这个项目不索引」。于是客户端对着一个**宿主永远不会起服务器**的项目建立了会话：握手被永久扣在 `entry.pending`，30 s 超时 × 4 轮后确定性变成 `failed` ⇒ 状态栏**变红** + 弹一次 toast，而这一切发生在**用户主动选择了基础模式**之后。【重新连接】还会**真的启动一个用户明确拒绝的服务器**。

**复核没点名、却更常见的一类**：**启动时恢复的项目**（没有任何决策）同样会这样——约两分钟后变红。这说明缺陷不在某一条策略上，而在「客户端会话没有问过 store」。

**修法**（三层）：

1. **store 拥有决策**：新增 `lspIndexDecision(root)` → `'build' | 'conservative' | 'unknown'`。它把「全局开关」「`indexOnOpen: 'never'`」「记住的内存答复 `conservative`」「本次会话的决策」四件事合成一个答案。决策记录在**切项目之前**写入（切项目会唤醒订阅者，客户端会话立刻就会来问）。
2. **会话跟着决策走**：`src/client/lsp-session.js` 在建会话前问这个决定 ⇒ 基础模式的项目**根本没有会话**（没有客户端、没有 socket、没有握手）。决策是 `'unknown'`（本次会话没决定）时**照旧建会话**——客户端本来就**先于**宿主起服务器提问（握手被扣着，等服务器出现），用宿主的此刻状态当前提会误伤正常路径。
   **这条的代价（第六轮复核补记）**：`'unknown'` 的那一类里，**启动时恢复的项目**仍然会建会话并重试 4 轮 × 30 s，而宿主**永远不会**为它起服务器——`lsp.start` 只在切换项目时被调用，启动恢复路径直接 `set({ root })`，从不走索引决策。⇒ 语义功能整个会话不可用，状态栏说的是「未启用（无语言服务器）」。这**不是本轮引入的**（`cb37295` 即如此），但它是这一类误报**更常见**的原因。
3. **故障由显示层收敛**：客户端的「会话死了」只压过**声称自己没事的**宿主（`starting` / `building` / `ready` / `restarting`）。`idle` / `disabled` 意味着**根本没有服务器**，没有人可以失败；`degraded` / `crashed` / `suspended` 则是**宿主自己知道原因**，它的话更有用。toast 同理。
   **这七种状态下【重新连接】按钮也不再出现**（它挂在状态栏的 key 上），而灰色菜单的提示仍然写着「可在状态栏重新连接」——指向一个不存在的按钮。第六轮复核的 R6-1 已修：出口按钮改为跟着**问题**（客户端会话已死）走，而不是跟着「谁赢了显示层」走；提示文案也分成三档，见 §3.13。

**为什么第 2 条不解决全部**：误报的**来源**是「宿主没有服务器，而客户端说有会话死了」。堵住来源（不建会话）解决的是「用户选了基础模式」这一类；**显示层**的收敛解决的是其余一切（宿主还没起服务器、内存闸门降级、启动时恢复的项目……）。两层都要。

**【重新连接】**：store 的 `reconnectLsp()` 在决策为 `'conservative'` 时**不再调用 `lsp.start`**——那个按钮不许背着用户起一个服务器。

#### P2-3（成立，已修）`force` 跳过整道内存闸门（含硬下限）

客户端的注释写的是「force 只限 tight 档」，宿主的实现却是「跳过**整道**闸门」，**硬下限也在内**。硬下限的意思是「这台机器根本跑不动这个服务器」，它不该被一个**不弹窗**的按钮绕过——【重新建立索引】正是这样用的（它读上一次轮询的快照，快照最多 2 s 旧，而且它刚做完 `lsp.shutdown`，快照里的可用内存比实际更乐观）。

**修法**：三处（`#startSession` / `#onCrash` 的重启闸门 / `#restart`）统一为：**快照永远取**，**硬下限永远拒绝**，**tight 档只在没有 force 时拒绝**。`force` 的含义回到它自己的文档：「用户答过『内存紧张也照样起』」。

**两条既有测试记录的是旧行为**（`a forced start ignores the hard floor as well` 与 `a crashed server of a forced session is restarted even without memory`）⇒ **改写**成新的事实（不是删掉，断言也没有削弱），并补了两条 tight 档的用例。

#### P3-4 / P3-5（成立，已修）

- **P3-4**：宿主说 `building` 时客户端的「正在连接…」不可见——那恰恰是最容易误报的时刻。现在 `ready` 与 `building` 都显示「正在连接…」，**宿主自己的文案进提示框**（「正在构建索引…」）。`starting` / `restarting` **不动**：规格 §2.4（STALE-03）要求它们的**文案**带「已等待 2 分 14 秒」，不能被客户端的文案吞掉。顺带修了一个连带问题：【取消索引】的判断改用**宿主的状态**而不是状态栏的 key——状态栏的 key 现在可能是「正在连接…」，而它等的那个构建仍然可以取消。
- **P3-5**：`semanticNote` 的英文兜底是**死代码**（`translate` 永不返回空串）⇒ 删掉，并在 `labels` 的合并处写明 `semanticUnavailable` **故意不被 prop 覆盖**（prop 的通用文案在会话已死时是**假话**）。

### 3.13 第六轮复核（2026-11-01）：两条低危（出口与覆盖面）+ 四条说明项

**日期**：2026-11-01　**影响条款**：VIS-02 / VIS-04 / SET-02（连带）　**检视报告**：`docs/prd/v5/PRD-v5-代码检视报告-第六轮.md`

第六轮检视提出 **6 条**：2 低 / 4 说明，**无中危、无高危**。逐条核实后 **6 条全部成立**，全部已修；另更正 5 处表述（§6.3）。上一轮 5 条的修复被**端到端实证**（探针复跑：新进程收到的 `initialize` 的 `rootUri` 现在是 `file:///NEW-SCOPE`；`indexOnOpen: 'never'` ⇒ 无会话无 socket；状态栏七态逐个核对）。

#### R6-1（低）——【重新连接】按钮跟着显示层一起让掉了，而菜单提示仍指向它

上一轮把「会话死了」让位给宿主（宿主知道原因时它的话更有用）是对的，但**让位时把出口按钮一起让掉了**：按钮挂在 `view.key === 'sessionFailed'` 上，而那个 key 只在宿主**声称没事**时才出现 ⇒ `idle` / `disabled` / `degraded` / `crashed` / `suspended` / `cancelled` / `failed` 七种状态下**没有**【重新连接】——而灰色菜单项的提示仍然写着「可在状态栏重新连接」。

**修法：出口跟着*问题*走，不跟着「谁赢了显示层」走。**

- `showReconnectButton(viewKey, clientState)` ⇒ `viewKey === 'sessionFailed' || clientState === 'failed'`。按钮本来就是为了「会话死了」准备的，不该跟着显示层的输赢一起消失。
- 两个按钮**仍然互斥**：【重新建立索引】在客户端会话已死时让位——【重新连接】做的**就是**【重新建立索引】做的（宿主 shutdown + 宿主 start）**再加上**重做客户端握手，给用户两个按钮解决同一个问题是噪音，而且先给出弱的那个。
- 宿主是 `idle` 时，【重新连接】恰恰是**对**的按钮：那个项目本来就没有服务器，而【重新连接】一步就做了「重做握手 + 起服务器」。
- **提示文案分三档**：会话 `ready` ⇒ 「该语言服务器不支持查找引用」；会话 `failed` ⇒ 「会话未就绪，可在状态栏重新连接」（按钮**确实在**）；会话 `starting` ⇒ 「会话正在连接…」——**不再承诺一个还不存在的按钮**（新增 `nav.semanticSessionConnecting`）。

#### R6-2（低）——被关掉**且未安装**的语言仍然开不回来

`605ad1d` 把宿主 `available` 桶里被关掉的语言并进了开关列表（它带着 `enabled: false`），但**没有并 `missing` 桶**：被关掉**且未安装**的语言落在 `missing` 里（宿主也带着 `enabled`）⇒ 开关列表里**没有这一行** ⇒ 用户只能去改设置文件手工改回来（这正是那个缺陷要治的病）。

**修法**：`mergeServerToggles` 把 `missing` 也并进来（用它自带的 `enabled`）⇒ **注册表里的每一种语言都有开关**。

#### R6-3（说明）——设置页把被关掉的语言说成「未找到」

状态栏按 `enabled !== false` 过滤了「没装」的语言（被关掉 ≠ 没装），**设置页那一行没有过滤** ⇒ 同一个词在两个界面上含义不同，而 CHANGELOG 里那句话在这条上自相矛盾。

**修法**：设置页同样过滤 ⇒「未找到」那一行列出的是**想要、但这台机器上没有**的语言；被用户关掉的语言留在开关列表里（空盒子）。

#### R6-4（说明）——上一轮加的条件是不可达分支

上一轮给「结束会话」加的条件（`previousRoot !== root || !enabled || decision === 'conservative'`）**恒为真**：`wanted === false` 只可能是四种情形（功能被关 / 设置里的总开关被关 / 项目被关掉 / 决策是 `conservative`），四种都让条件成立 ⇒ 它是**死代码**，而注释描述的「宿主释放了服务器 ⇒ 会话被放弃」那一情形**结构上不可能发生**（会话的生命周期根本不看宿主的状态；宿主释放服务器时客户端会话压根不会被拆）。

**修法**：条件简化回**无条件** `shutdownHostLsp(previousRoot)`，注释改成实话（并写明「宿主自己释放服务器」不在其中）。

#### R6-5（说明）——同一份清单写了两遍

`Workbench.jsx` 的 `HOST_HEALTHY_STATES` 与 `store.js` 的 `LSP_HOST_FINE_STATES` 是同一份清单、两个名字、两个文件。只要有一份漏改，toast 与状态栏就会互相打架——而它们正是上一轮 P1-2 的两根支柱。

**修法**：一份清单，`LSP_HOST_HEALTHY_STATES`，由 `src/client/lsp-session.js` 导出，状态栏与 toast 闸门都从它取。

#### R6-6（说明）——记录里的测试总数差 1

§0 与 §6.2 写的 899 是**上一轮**的数字；本轮实测是 900。已回填。

#### R6-7（复核建议，未列为条目）——「启动时恢复的项目」这个**根因**仍在

复核 §0.3 指出：误报没了，但**根因**没变——`lsp.start` 只在切换项目时被调用，而启动恢复路径直接 `set({ root })`，**从不走索引决策、也从不调 `lsp.start`** ⇒ 宿主**永远不会**为恢复出来的项目起服务器（`cb37295` 即如此，**不是本轮引入**）。这一条**不在**本轮的 6 条发现里，检视只要求「单独记一笔」，已记在 §3.12 的第 2 条里。

**本轮把它从「不可用」变成了「一步可用」**：R6-1 修好之后，【重新连接】在宿主 `idle` 时也在（它一步就做了「重做握手 + 起服务器」）⇒ 恢复出来的项目不再需要「先【重新建立索引】、等客户端下一次重试、再【重新连接】」这三步。

**没有做**（超出本轮范围，且需要产品决定）：让启动恢复路径**也走一次索引决策**（那意味着 DSH 一启动就可能弹索引决策框）。

### 3.14 第七轮复核（2026-11-01）：一条低危（`'always'` 在恢复路径上被忽略）+ 两条说明项

**日期**：2026-11-01　**影响条款**：§2.3（索引决策）、SET-02（连带）　**检视报告**：`docs/prd/v5/PRD-v5-代码检视报告-第七轮.md`

第七轮检视提出 **3 条**：1 低 / 2 说明，**无中危、无高危**。上一轮的 6 条被**十一态实测**（宿主 11 种状态 × 客户端 3 种状态）逐个复核通过。本轮 **1 条低危成立并已修**，两条说明项：**O-2 已修**（那条测试守不住它想守的东西），**O-1 记下备查**（按钮的身份会翻转，属打磨不属缺陷）。

#### R7-1（低，已修）`indexOnOpen: 'always'` 在「启动恢复」与「切工作区」两条路径上被忽略

**决策与起服是两条独立的路径，而只有「项目切换」这一条同时跑了它们**：

| 路径 | 决策 | 起服 |
|---|---|---|
| **项目切换**（`#switchProjectWithIndex`） | ✅ `#decideIndex` ⇒ `'always'` 直接给 `'build'` | ✅ `call('lsp.start')` |
| **启动恢复**（`#runInit` ⇒ `set({ root })`） | ❌ 从不调用 `#decideIndex` ⇒ 决策恒为 `'unknown'` | ❌ 从不调用 `#startLsp` |
| **切工作区**（`#switchWorkspace` ⇒ `set({ root })`） | ❌ 同上 | ❌ 同上 |

`call('lsp.start')` 在整个客户端**只有三个调用点**（项目切换 ×2、【重新建立索引】按钮 ×1）；宿主侧 `#requestWake` 要求**已有会话** ⇒ **无会话时宿主自己不会起任何服务器**。

⇒ 用户把 `indexOnOpen` 设成 `'always'`（「总是索引」），在**切换项目**时立刻生效，在**启动工作台**时**不生效**——同一份设置，两种行为。而 `'always'` 与 `'ask'` 的决策结果**完全一样**（都是 `'unknown'`）⇒ 这条设置在这条路径上**不起任何作用**。

**修法**（检视的方案 A，**不弹框**）：在两条恢复路径上，只为**用户已经表达过意见**的项目补一次起服——

- `indexOnOpen: 'always'` ⇒ 普通起服。宿主的内存闸门照常：机器扛不住就不起（硬下限永远拒绝），tight 档则由用户自己去点【重新建立索引】。
- **记住的内存答复是 `'accepted'`**（「内存紧张也照样起」）⇒ 强制起服——那个答复问的就是这个项目，答复的含义就是「照样起」。
- 其余（`'ask'`）⇒ **维持现状：不弹框、不起**。

**store 的决策有最后发言权**：基础模式的项目（记住的 `'conservative'`、`indexOnOpen: 'never'`、总开关关掉）**仍然什么也不起**——用户拒绝过的事情，恢复路径不许替他做主。起服成功后决策记为 `'build'`，客户端会话与 store 于是说同一件事。

**没有做**（需要产品决定）：让恢复路径**也走一次索引决策** ⇒ DSH 一启动就可能弹框。检视说得对：**这条推迟的理由只对 `'ask'` 成立**，而 `'always'` 本来就不需要弹框——本轮修的正是这一部分。`'ask'` 的那部分仍然是一个**已知的不一致**（切换项目会问、启动不会问）。

#### O-1（说明，记下备查，未改）状态栏按钮的身份会随客户端会话的状态翻转

同一个局面（宿主 `idle`、没有服务器）：打开项目后的前 ~2 分钟是【重新建立索引】，约 2 分钟后（客户端重试耗尽）变成【重新连接】。两个按钮**都能起服务器**（【重新连接】多做一次握手），动词的切换也说得通（会话死了 ⇒「重连」比「重建」准）。**但**切换的触发点是「客户端重试耗尽」这个**内部计时**，用户无从预期。

**没有改**，两条理由：① 让【重新连接】从会话一开始就在 ⇒ 那时「重连」还不是准确的说法，而且它会把【重新建立索引】在**每一次正常的项目打开**里都藏掉（客户端会话在服务器起来之前一直是 `'starting'`）；② 在按钮上加一句说明 ⇒ 一个按钮的标题解释不了「为什么刚才那个按钮不见了」。

#### O-2（说明，已修）R6-5 的那条测试守不住它想守的东西

上一轮那条回归测试是**源码文本断言**（grep）：把 import 换个写法就变红（**假红**），而把清单复制回第二个文件、只要常量名不叫 `HOST_HEALTHY_STATES` 就照样通过（**假绿**）。

**改成行为断言**：对宿主**全部 11 种状态**各跑一次——toast 闸门与状态栏必须给出**同一个答案**（toast 弹 ⟺ 状态栏显示红色「会话未就绪」）。**验证过**：把 store 的闸门换成另一份清单 ⇒ 该用例变红；把常量改名 ⇒ 不变红（它守的是行为，不是拼写）。

---

## 4. 实机验收记录

> 对应规格 §9.4 的清单。逐条回填**实际观察到的现象**，不写"通过"。

**部署**：把新的 `src/host/**`、`src/index.js` 与重建的 `dist/client.js` 装进 DSH 配置档的插件目录
（`%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-ide-workbench`），用插件管理器重启了插件 fiber。
第五轮复核之后**又部署了一次**（同一目录，`src/index.js` + `src/host/*.js` + `dist/client.js`）；
第六轮复核之后**再部署一次**、第七轮复核之后**再一次**（这两次只动了客户端与 `dist/client.js`，宿主文件未改）。

| # | 验收项 | 状态 | 观察 |
|---|---|---|---|
| 0 | **插件带新代码重启后宿主存活** | ✅ | `include:ide-workbench` 重启后 `fiberPhase: active`；`POST /ide-workbench/api/lsp.status` 与 `lsp.scope` 有路由（未带栅栏 ⇒ 403）；**没有新的 `crash-*-host.log`**（最新一份仍是 2026-10-31）。第五轮复核后再次部署 + 重启，同样如此 |
| 1 | 空闲 10 分钟后状态栏是**灰色**「已休眠（省内存）」，不是黄色「保守版」 | ⬜ | 需人工在 GUI 里等待 10 分钟 |
| 2 | 休眠后状态栏上**直接**有【重新建立索引】 | ⬜ | 同上 |
| 3 | 休眠后按 F12，服务器**自动**起来，用户没点任何按钮 | ⬜ | 同上 |
| 4 | 启动时状态栏显示「已等待 N 分 M 秒」，60 s 后出现【取消索引】 | ⬜ | 同上 |
| 5 | 掐断宿主连接后状态栏显示「状态未知（正在重试…）」 | ⬜ | 同上 |
| 6 | 触发一次降级弹**一次** toast 并说明原因 | ⬜ | 同上 |
| 7 | 在 `…\dsh-ide-workbench` 下打开工作台**不弹**索引决策框 | ⬜ | 依赖 SCOPE-01 的客户端半边（§3.4）与 `indexedRoots` 的既有徽标语义 |

> 第 1–7 项**没有**在本次实施中逐条观察：它们需要在 GUI 里等待 10 分钟的真实空闲、或人为掐断宿主连接。**自动化覆盖了对应的状态机与渲染分支**（`tests/lsp-suspended-state.test.mjs`、`tests/lsp-wake-on-demand.test.mjs`、`tests/lsp-status-freshness.test.mjs`、`tests/client-status-render.test.mjs`），但**观察**这一栏留空——不写没有发生的事。

---

## 5. 新增测试

| 文件 | 覆盖 | 条数 |
|---|---|---|
| `tests/lsp-suspended-state.test.mjs` | VIS-01/02/03（宿主侧状态机） | 9 |
| `tests/lsp-wake-on-demand.test.mjs` | IDLE-02/03 | 8 |
| `tests/lsp-idle-policy.test.mjs` | IDLE-01/04/05 | 9 |
| `tests/lsp-memory-gate.test.mjs` | MEM-01/02/03 | 11 |
| `tests/lsp-crash-generation.test.mjs` | CRASH-01 | 5 |
| `tests/lsp-status-freshness.test.mjs` | STALE-01/02/03、VIS-04（store 侧）、PERF-01 | 31 |
| `tests/client-status-render.test.mjs` | VIS-01/02/03/04（客户端侧）、STALE-02/03、IDLE-01、MEM-04、诊断面板的「内存」行与「原因」行 | 28 |
| `tests/perf-hot-path.test.mjs` | PERF-02/03/04（**用生产构建配置**） | 9 |
| `tests/lsp-scope-client.test.mjs` | SCOPE-01 客户端侧（握手的作用域根、宿主不应答时的回退、围栏） | 6 |
| `tests/lsp-handshake-scope.test.mjs` | SCOPE-01 宿主侧（**服务器在跑时**到达的握手、迟到的 worker 消息）——第五轮 P1-1 | 3 |
| `tests/store-lsp-decision.test.mjs` | store 的索引决策、toast 闸门、重连闸门——第五轮 P1-2 | 13 |
| `tests/lsp-session-decision.test.mjs` | 客户端会话跟着决策走（基础模式的项目没有会话）——第五轮 P1-2 | 6 |

**既有测试的回归更新**（规格 §9.2 要求）：

| 既有测试 | 改了什么 |
|---|---|
| `tests/lsp-idle-exit.test.mjs` | 空闲退出后的状态断言 `'idle'` → **`'suspended'`**；「空闲退出不清 `indexedRoots`」那条**保持不变** |
| `tests/lsp-memory-policy.test.mjs` / `lsp-resources` / `lsp-recovery` | 新的估算基数（256 → 434 / 651 / 868）与新的降级措辞，注释里写明**为什么**数字变了 |
| `tests/lsp-lifecycle.test.mjs` | 作用域根、`cwd`、取消窗口、重启取消（+8 例） |
| `tests/settings-lsp.test.mjs` | 设置架构 4 → 5，并**证明迁移**：旧文档补上 `idlePolicy: 'after'`、用户选过的策略不被改、未知策略被修复 |
| `tests/lsp-budget-agreement.test.mjs` / `lsp-client-budget.test.mjs` | **未改**（宿主的预算规则没动；客户端只在 `suspended` 时加长预算，两端仍然一致） |
| `tests/lsp-health-status.test.mjs` / `tests/lsp-error-toast.test.mjs` | **未改**（VIS-02/04 没有破坏它们的断言） |
| `tests/lsp-review-fixes.test.mjs` | **新增 1 例**：最新握手胜出（作用域不会在重启时退回旧的）——去掉修复即变红 |
| `tests/lsp-workspace.test.mjs` | **新增 5 例**：作用域围栏（通报 / 不通报 / 仍可显示 / 无作用域根时的回退 / 连接前打开的文档） |
| `tests/lsp-memory-policy.test.mjs` | **第五轮改写 2 例**：`force` **不再**跳过硬下限（旧行为写成了「ignores the hard floor」）——改成新事实并补了 tight 档的用例；断言没有削弱 |
| `tests/lsp-memory-gate.test.mjs` | **第五轮新增 4 例**：强制启动在硬下限之下被拒、在 tight 档被放行、崩溃重启同样遵守硬下限 |
| `tests/client-status-render.test.mjs` | **第五轮新增/改写**：红色「会话死了」只压过**声称没事的**宿主；`building` 期间也显示「正在连接…」；【取消索引】按**宿主状态**判断 |

---

## 6. 复核轮（2026-11-01）

### 6.1 第四轮

一轮外部检视提出 **7 条**。逐条复核后：**5 条成立并已修复**，**2 条按事实部分接受、结论部分拒绝**（附实测证据）。复核本身没有改动规格，因此这一节记的是**处置**。

| # | 复核结论 | 复核 | 处置 |
|---|---|---|---|
| 1 | PERF-03 不会减小产物，产物反而大了 | ✅ **成立** | 见 §3.3：产物确实**变大**（+117,951 B / +4.07 %），验收「减包 573 KB」**不可达**（装载器每包只取一个脚本）。**没有**去改打包契约（那是 DSH 侧的事）。 |
| 2 | PERF-03 的测试跑的是产品根本不用的一套构建配置 | ✅ **成立且严重** | 测试已重写：构建选项**从 `scripts/build.mjs` 本身抽取**（无法再漂移），断言产物的**事实**（包仍内联、文件变大）与**运行时行为**（加载时 0 个语言模块被求值，打开对应语言的文件时才求值）。回归检查：换回静态 import 后三条断言同时变红。 |
| 3 | MEM-03 在生产环境是空操作 | ⚠️ **事实成立，结论不成立** | 验收确实未达成，**且不应达成**：standby 是内核优先回收的**可用内存**（分配 1.5 GB 实测从 standby 取走 1.2 GB，无换页）。复核建议的 `GetPerformanceInfo.SystemCache` 会**多扣约 600 MB** 的可回收文件缓存，且纯 Node 调不到。**不按字面实现**，见 §3.1。 |
| 4 | SCOPE-01 只改了服务端 `cwd`，program 范围并未收敛 | ✅ **成立** | 已修复：`rootUri` 由客户端按作用域根发出，围栏分成「通报」与「显示」两个，新增宿主 API `lsp.scope`；宿主改为**最新握手胜出**，作用域不会在重启时悄悄退回。见 §3.4。 |
| 5 | 窗口最小化后状态栏误报「状态未知」，最长约 1 分钟不恢复 | ✅ **成立** | 隐藏**不再**置陈旧标志（跳过轮询不是失败的轮询），并新增 `visibilitychange` 监听：回到前台立即刷新 LSP 状态与 git 状态。 |
| 6 | 唤醒失败一次后，该 root 的自动唤醒被永久关闭 | ✅ **成立** | 宿主新增 `degradeCause`（`memory` / `not-installed` / `turned-off` / `crash`）：**只有内存原因**的降级值得重试，带 **60 s 退避**；失败的唤醒不丢载荷，成功后重放；重复降级不再重复发控制事件。客户端侧：【重新建立索引】在内存紧张时**强制**启动（否则用户点一次回到原点）。 |
| 7 | 降级 toast 的正文是英文技术串 | ✅ **成立** | 降级与崩溃**走同一套本地化模板**（`crashAdviceFor`）：超时 → 超时建议，内存 → 内存建议，其余 → 「详情见诊断面板」。宿主的技术原文移到 `state.lsp.detail`，并**在诊断面板新增「原因」一行**——本地化文案说「详情在诊断面板」，面板就得真的有它。 |

**复核之外补上的一处**：`tests/lsp-review-fixes.test.mjs` 新增「最新握手胜出」的回归用例（去掉修复即变红，已验证）。

**本轮之后的数字**：**864 项 / 864 通过 / 0 失败**（复核轮开始时 820）。

### 6.2 第五轮

检视报告：`docs/prd/v5/PRD-v5-代码检视报告-第五轮.md`（范围 `7b1df38` + `4b8af00`）。提出 **5 条**：2 中 / 1 低 / 2 说明，无高危。**5 条全部成立，全部已修**；另更正 **7 处**与代码不符的表述。

| # | 复核结论 | 复核 | 处置 |
|---|---|---|---|
| P1-1 | 作用域只在「服务器不在」时收敛：服务器在跑时的新握手不写回宿主缓存，下次重启用**旧** `rootUri` | ✅ **成立** | 宿主在 `relayToServer` 交给 worker **之前**记下握手；worker 的消息只在空的时候填。3 条新回归测试（去掉修复即变红）。见 §3.12 |
| P1-2 | 「从不索引」的项目约 2 分钟后状态栏变红；【重新连接】还会启动用户拒绝的服务器 | ✅ **成立** | 三层：store 拥有决策（`lspIndexDecision`）→ 会话跟着决策走 → 显示层只在宿主**声称没事**时才让「会话死了」压过去。另发现**复核没点名的一类**：启动时恢复的项目同样会误报。见 §3.12 |
| P2-3 | 【重新建立索引】跳过整道内存闸门（含硬下限） | ✅ **成立** | `force` 只跳 tight 档，硬下限永远拒绝（三处统一）。两条记录旧行为的测试被**改写**成新事实。见 §3.12 |
| P3-4 | 宿主说 `building` 时「正在连接…」不可见 | ✅ **成立** | `ready` 与 `building` 都显示「正在连接…」，宿主文案进提示框；`starting`/`restarting` 保持规格 §2.4 要求的「已等待 N 分 M 秒」 |
| P3-5 | `semanticNote` 的英文兜底是死代码 | ✅ **成立** | 删掉；并在 `labels` 合并处写明 `semanticUnavailable` 故意不被 prop 覆盖 |

**复核点名的三处复查**：短握手预算 ✅ 成立；最新握手胜出 ❌ **只成立一半**（即 P1-1，已补齐）；clientState 优先级 ✅ 成立，但**误报面**偏大（即 P1-2）。

**更正的 7 处表述**：§3.4（最新握手胜出的范围）、M8 行、SCOPE-01 行、§3.4 末段（下次启动用什么握手）、§3.11（【重新连接】的承诺）、`src/client/store.js` 的 `force` 注释、PRD §5.1 问题③（`force` 跳过整个检查）。前六处已改；第七处**按 P2-3 修掉了**（不再是表述问题，是行为问题）。

**本轮之后的数字**：**900 项 / 900 通过 / 0 失败**（本轮开始时 870）。

### 6.3 第六轮

检视报告：`docs/prd/v5/PRD-v5-代码检视报告-第六轮.md`（范围 `605ad1d` + `8e0ed73`）。提出 **6 条**：2 低 / 4 说明，**无中危、无高危**。**6 条全部成立，全部已修**；另更正 5 处表述。上一轮 5 条的修复被端到端实证（探针复跑 + 状态栏七态逐个核对）。

| # | 复核结论 | 复核 | 处置 |
|---|---|---|---|
| R6-1 | 「会话死了」让位给宿主后，【重新连接】按钮跟着消失，而菜单提示仍让用户去点它 | ✅ **成立** | 出口按钮改为跟着**问题**走（`clientState === 'failed'`），【重新建立索引】在会话已死时让位（两个按钮仍互斥）；提示文案分三档，「正在连接」不再承诺一个还不存在的按钮。见 §3.13 |
| R6-2 | `605ad1d` 只覆盖**已安装**的被关语言：被关掉**且未安装**的语言落在 `missing` 桶 ⇒ 仍开不回来 | ✅ **成立** | `mergeServerToggles` 把 `missing` 也并进来 ⇒ 注册表里的每种语言都有开关 |
| R6-3 | 设置页的「未找到」那一行不过滤 `enabled` ⇒ 被关掉的语言仍被报成「未找到」 | ✅ **成立** | 设置页同样过滤（与状态栏一致） |
| R6-4 | `refreshLsp` 里新增的 `shutdownHostLsp` 条件是不可达分支，注释描述的情形结构上不可能发生 | ✅ **成立** | 条件简化回无条件调用，注释改成实话 |
| R6-5 | 同一份「宿主声称没事」的状态清单在两个文件里各写了一份 | ✅ **成立** | 一份清单：`LSP_HOST_HEALTHY_STATES`（`src/client/lsp-session.js` 导出，两边都取它） |
| R6-6 | 实施记录写的测试总数 899，实测 900 | ✅ **成立** | 已回填 |

**复核点名的三处复查**：上一轮 5 条**全部修复**且修法「比我建议的更周全」——特别是补上了我漏掉的**异步竞态**（迟到的 worker 消息不能覆盖新握手）与【取消索引】改用宿主状态的**连带影响**。

**复核指出的、仍然存在的底层事实**（不是本轮引入，记在 §3.12 第 2 条里）：**启动时恢复的项目**仍然会建会话并重试 4 轮 × 30 s，而宿主**永远不会**为它起服务器（`lsp.start` 只在切换项目时被调用）⇒ 语义功能整个会话不可用。误报没了，**底层事实没变**——但 R6-1 之后它**一步可用**了（【重新连接】在宿主 `idle` 时也在）。

**本轮之后的数字**：**905 项 / 905 通过 / 0 失败**（本轮开始时 900）。

### 6.4 第七轮

检视报告：`docs/prd/v5/PRD-v5-代码检视报告-第七轮.md`（范围 `8e0ed73` → `1dbc238`）。提出 **3 条**：1 低 / 2 说明，**无中危、无高危**。上一轮 6 条被**十一态实测**复核通过。**1 条低危成立并已修**，2 条说明项：**1 条已修**、**1 条记下备查**。

| # | 复核结论 | 复核 | 处置 |
|---|---|---|---|
| R7-1 | `indexOnOpen: 'always'` 在「启动恢复」与「切工作区」两条路径上被忽略：客户端建了会话，宿主却不会起服务器 | ✅ **成立** | 两条恢复路径上，只为**用户已经表达过意见**的项目补一次起服：`'always'` ⇒ 普通起服，记住的内存答复 `'accepted'` ⇒ 强制起服；`'ask'` 维持现状（不弹框、不起）。store 的决策有最后发言权（基础模式仍然不起）。见 §3.14 |
| O-1 | 状态栏按钮的身份会在 2 分钟后从【重新建立索引】变成【重新连接】 | ✅ **成立**（打磨，非缺陷） | **记下备查，未改**：让【重新连接】从一开始就在会把【重新建立索引】在每一次正常的项目打开里藏掉；给按钮加说明解释不了「刚才那个按钮怎么不见了」。见 §3.14 |
| O-2 | R6-5 的回归测试是源码文本断言（grep）：守不住「只有一份」，却会被无关的重命名弄红 | ✅ **成立** | 改成**行为断言**：宿主 11 种状态逐个跑，toast 闸门与状态栏必须给出同一个答案。已验证：换一份清单即变红 |

**复核指名的三处复查**：上一轮 6 条全部修复，修法「比我建议的更周全」；【重新连接】确实是【重新建立索引】的**超集**（宿主 shutdown + 宿主 start + 一次客户端握手），因此在任何宿主状态下都不比它差；R6-7 的记述准确、没有夸大（`call('lsp.start')` 确实只有项目切换与按钮两处调用点）。

**本轮之后的数字**：**911 项 / 911 通过 / 0 失败**（本轮开始时 905）。

---

## 7. 提交记录

| 日期 | 提交 | 内容 |
|---|---|---|
| 2026-11-01 | `fdad597` | PRD-v5 改造需求的第一轮实现（30 个文件） |
| 2026-11-01 | `7b1df38` | 第四轮复核的处置：作用域收敛 + 5 条成立的发现修复 + 2 条按实测拒绝 |
| 2026-11-01 | `4b8af00` | 状态栏不再在会话已死时说「就绪」（客户端会话状态 + 短握手预算 + 【重新连接】） |
| 2026-11-01 | `605ad1d` | 被关掉的语言服务器还能再被打开（设置页的开关与宿主的注册表） |
| 2026-11-01 | `8e0ed73` | 第五轮复核的处置：P1-1 握手收敛 / P1-2 决策闸门 / P2-3 硬下限 / P3-4、P3-5 |
| 2026-11-01 | `1dbc238` | 第六轮复核的处置：R6-1 出口按钮 / R6-2、R6-3 开关与「未找到」/ R6-4 死分支 / R6-5 一份清单 |
| — | — | （第七轮复核的修复：R7-1 `'always'` 在恢复路径上 / O-2 行为断言 —— 见下一个提交） |

---

## 8. 交付物对照（规格 §11）

| # | 交付物 | 位置 | 状态 |
|---|---|---|---|
| 1 | 本规格 | `docs/prd/v5/PRD-v5-改造需求.md` | ✅ 已有 |
| 2 | 实施进展记录 | `docs/prd/v5/PRD-v5-改造需求-实施进展.md` | ✅ **本文件** |
| 3 | 宿主状态机与客户端渲染 | `src/host/lsp.js`、`src/client/Workbench.jsx`、`src/client/i18n.js`、`src/client/store.js` | ✅ |
| 4 | 设置项与迁移 | `src/host/settings-defaults.js`、`src/host/settings-store.js`、`src/client/SettingsPanel.jsx` | ✅ |
| 5 | 传输层控制事件 | `src/client/lsp-transport.js` | ✅ |
| 6 | 新增测试 | §5 的 12 个文件 | ✅（规格列 7 个，多 `perf-hot-path`、`lsp-scope-client`、`lsp-handshake-scope`、`store-lsp-decision`、`lsp-session-decision`） |
| 7 | 仓库 `tsconfig.json` | `dsh-ide-workbench/tsconfig.json` | ✅ |
| 8 | 回归基线记录 | 本文件 §0 | ✅（717 → 911，全绿） |
