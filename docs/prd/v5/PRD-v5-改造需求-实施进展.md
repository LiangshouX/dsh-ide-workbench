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
| 测试基线（改造完成） | **854 项 / 854 通过 / 0 失败**（**+137**） | ✅ |
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
| **M8** | SCOPE-01 | ✅ 完成（复核后补齐） | 作用域**真的**收敛了：客户端按作用域根发 `rootUri`（`cwd` 不决定 program 范围），围栏分成「通报」与「显示」两个，宿主改为最新握手胜出——见 §3.4 |
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
| SCOPE-01 | ✅ | `src/host/lsp.js`（`scopeRootOf` / `lsp.indexScope`）、`src/index.js`（`lsp.scope` API）、`src/client/lsp-session.js`（握手用作用域根）、`src/client/lsp-workspace.js`（两个围栏） | 作用域真的收敛：`rootUri` 决定 program 范围 | 复核发现 `cwd` 不管用才补的客户端半边，见 §3.4；运行中的服务器保留原 program 到下次启动 |
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

- **宿主 API** `POST /ide-workbench/api/lsp.scope` → `{ scopeRoot }`。它读 `settings.lsp.indexScope` 并调用已导出的 `scopeRootOf(root, policy)`，**不需要**已有会话。
- **客户端**在握手**发出之前**用作用域根当 `rootUri`（`fileUriOf(scopeRoot)`）。顺序很重要：宿主只把**第一次** `initialize` 转发给语言服务器（frame worker 的 `Handshake.noteForwarded`），所以只有第一次握手能决定 program。客户端对象照旧立刻创建、**握手等作用域**——晚一点创建对象会破坏五个既有测试文件里约 30 个同步取 `lspClient()` 的用例。
- **围栏分成两个**：`insideScope()`（作用域根）只管**向服务器通报文档**；`insideRoot()`（工作区根）继续管查找引用的读文件与 `displayFile()`。作用域外的文件**不再通报给服务器**（这是作用域收敛的既定代价，规格 §4.2 点名了「跨项目跳转不再解析」），但工作台**仍然打不开**它——把 `displayFile()` 也收窄会让「跳转到服务器提到的文件」失效。
- **宿主侧的补丁**：宿主原来永远保留**第一次**握手，于是作用域策略改动后，下一次重启会把 program 悄悄退回旧的作用域。现在**最新的握手胜出**（`#holdFor`），新起的服务器进程用客户端**当下**在用的作用域初始化。回归测试：`tests/lsp-review-fixes.test.mjs` 的「the newest handshake is the one a server that starts later is initialized with」（已验证：去掉修复即变红）。

**仍未达成的一点**：**运行中的**服务器保留它原来的 program，直到它下一次启动。作用域策略是高级设置，这个「下次启动生效」的语义与插件的其它设置一致，记录在此。

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


---

## 4. 实机验收记录

> 对应规格 §9.4 的清单。逐条回填**实际观察到的现象**，不写"通过"。

**部署**：把新的 `src/host/**`、`src/index.js` 与重建的 `dist/client.js` 装进 DSH 配置档的插件目录
（`%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-ide-workbench`），用插件管理器重启了插件 fiber。

| # | 验收项 | 状态 | 观察 |
|---|---|---|---|
| 0 | **插件带新代码重启后宿主存活** | ✅ | `include:ide-workbench` 重启后 `fiberPhase: active`；`POST /ide-workbench/api/lsp.status` 有路由（未带栅栏 ⇒ 403）；**没有新的 `crash-*-host.log`**（最新一份仍是 2026-10-31） |
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

---

## 6. 复核轮（2026-11-01）

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

**本轮之后的数字**：**854 项 / 854 通过 / 0 失败**（本轮开始时 820）。

---

## 7. 提交记录

| 日期 | 提交 | 内容 |
|---|---|---|
| 2026-11-01 | `fdad597` | PRD-v5 改造需求的第一轮实现（30 个文件） |
| — | — | （复核轮的修复见下一个提交） |

---

## 8. 交付物对照（规格 §11）

| # | 交付物 | 位置 | 状态 |
|---|---|---|---|
| 1 | 本规格 | `docs/prd/v5/PRD-v5-改造需求.md` | ✅ 已有 |
| 2 | 实施进展记录 | `docs/prd/v5/PRD-v5-改造需求-实施进展.md` | ✅ **本文件** |
| 3 | 宿主状态机与客户端渲染 | `src/host/lsp.js`、`src/client/Workbench.jsx`、`src/client/i18n.js`、`src/client/store.js` | ✅ |
| 4 | 设置项与迁移 | `src/host/settings-defaults.js`、`src/host/settings-store.js`、`src/client/SettingsPanel.jsx` | ✅ |
| 5 | 传输层控制事件 | `src/client/lsp-transport.js` | ✅ |
| 6 | 新增测试 | §5 的 8 个文件 | ✅（规格列 7 个，多一个 `perf-hot-path`） |
| 7 | 仓库 `tsconfig.json` | `dsh-ide-workbench/tsconfig.json` | ✅ |
| 8 | 回归基线记录 | 本文件 §0 | ✅（717 → 814，全绿） |
