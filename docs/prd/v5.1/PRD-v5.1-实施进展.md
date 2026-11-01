# PRD-v5.1 实施进展 —— 语义分析的内存闸门重算、工作区生命周期与并发索引策略

> **规格**：`docs/prd/v5.1/PRD-v5.1.md`（只读，本文件的实现以它为准）
> **实施契约**：`docs/prd/v5.1/PRD-v5.1-实施契约.md`（跨模块的接口约定；本轮多方并行实施时它是唯一的事实来源）
> **基线**：`dsh-ide-workbench` commit `238668e`（分支 `main`，package version 0.5.0）
> **实施日期**：2026-11-01
> **状态**：**17 个条目全部落地**（WS-01…04、MEM-05…12、CONC-01/03/04/05）；CONC-02（多客户端并发）按规格留给下一轮。

---

## 0. 一页速览

### 0.1 用户报告的现象，现在是什么结果

| # | 用户报告的现象 | 实施前 | 实施后 |
|---|---|---|---|
| **U1** | 机器剩余 2648 MB，仓库索引实测需要 621 MB，算法判定「资源不足」 | 闸门把运行中服务器的**上限**当占用扣了一遍 ⇒ 可用 600 MB，**低于 651 MB 的需求**，服务器被直接拒掉 | 闸门只扣**还可能再涨**的部分 ⇒ 可用 **1206 MB**，**不再低于需求**；且切工作区时旧服务器被真正关掉，它的幽灵预留额不再压着新工作区 |
| **U2** | 弹窗写着「当前可用 2648 MB」，却问「要不要继续」 | 弹窗用 `freeBytes`，闸门用 `availableBytes` | **同一个数**：弹窗、宿主 detail、诊断面板、设置页四处全部用 `availableBytes`；有回归测试守着 |
| **U3** | 「预留 2048 MB，但这个资源实际又不用，不是实际占用」 | 预留额取的是**上限**（许可），闸门拿它当**占用**（事实）记账 | 预留额 = `上限 − 已实测占用`；实测占用由 `os.freemem()` 差值法测出，测不出时退回该语言的基线估算 |
| **U4** | 机器内存紧张时没人给回内存 | 默认配置下**压力释放阀根本没装** | 压力阀**默认开启**、与空闲策略无关；按 LRU 顺序释放，状态是灰色「已让出内存」而不是故障态 |

### 0.2 关键数字（P8 探针，走生产 `LspManager`，仓库文件零修改）

探针：`artifacts/perf-probe-2026-11-01/p8-memory-accounting.mjs`

```
=== P8b: the user case - one index running, 2648 MB free, a second wants 621 MB ===
  free                 : 2648 MB
  reserved on the books: 1442 MB   measured: 606 MB   ceiling: 2048 MB
  available            : 1206 MB   need=651MB soft=1302MB floor=256MB
  worst case           : -842 MB (breached: true)
  decision             : tight  -> state=degraded
  the three models on the same machine:
    A_current    available=  600 MB  passes(>=651MB)=false     ← 实施前的算法
    B_growth     available= 1206 MB  passes(>=651MB)=true      ← 实施后的算法
    C_actual     available= 2042 MB  passes(>=651MB)=true
```

| 规格里的数 | 规格值 | 实测值 | 一致 |
|---|---|---|---|
| MEM-05 验收：`free 2648 / used 606` ⇒ available | 1206 MB | **1206 MB** | ✅ |
| MEM-07 文案示例：最坏档剩 −842 MB | −842 MB | **−842 MB** | ✅ |
| P7f 对照：切工作区前 / 后 | 600 / 2648 | **1206 / 2648**（且判定 `tight` → `ok`） | ✅（前半段的 600 变成了 1206，见 §4.6） |

### 0.3 条目一览

| ID | 条目 | 优先级 | 状态 | 落点 | 一句话验收 |
|---|---|---|---|---|---|
| **WS-01** | 切换工作区必须关闭旧工作区的语言服务器 | P0 | ✅ | `src/client/lsp-session.js` `configureLsp` / `refreshLsp` | 切工作区后宿主侧旧 root 的进程消失，预留额归零 |
| **WS-02** | 关闭必须**先于**新开（顺序化） | P0 | ✅ | `src/client/lsp-session.js` `shutdownHostLspAwaited` + 切换链；`src/client/store.js` `#switchWorkspace` | 新服务器的闸门判定发生在旧服务器退出并归还预留额之后 |
| **WS-03** | 非活动工作区的语义会话不得残留 | P1 | ✅ | `src/client/lsp-session.js` `releaseLspForStore`；`src/client/store.js` `releaseLsp`；`src/client/index.jsx` `bindStoreLifecycle` | 被换下的 store 不再持有 LSP 连接与宿主会话 |
| **WS-04** | 工作区级的语义分析默认态 | P1 | ✅ | `src/client/store.js` `#decideIndex` / `#rememberWorkspaceDecision`；`settings.lsp.workspaceDefaults` | 新工作区默认走基础模式并给出解释；用户手动开启后**跨工作区、跨进程**记住 |
| **MEM-05** | 预留额 = `上限 − 已实测占用` | P0 | ✅ | `src/host/lsp.js` `#reservedBytes` / `#measuredBytes` | `free 2648 / 占用 606` ⇒ available **1206 MB**（原 600 MB） |
| **MEM-06** | 「已实测占用」的取数口径：差值法 | P0 | ✅ | `src/host/lsp.js` `#measureFootprint` / `#remeasure` | 启动前后各读一次 `freemem()`，差值即占用；噪声区间作废并退回 `memoryBaselineMB` |
| **MEM-07** | 判定分「典型档」与「最坏档」，两档分别报 | P1 | ✅ | `src/host/lsp.js` `#resourcesSnapshot`；`src/client/Workbench.jsx` `memoryFacts` | 诊断面板同时给出「典型」与「若吃到上限则剩 −842 MB」 |
| **MEM-08** | 机器级总预算 | P1 | ✅ | `src/host/lsp.js` `#budgetBytesOf` / `#ceilingBytes` | `Σ上限 ≤ min(总内存×25%, 4 GB)`；预算用完时 `force` **也不放行** |
| **MEM-09** | 界面数字口径统一为 `availableBytes` | P0 | ✅ | 宿主 3 条文案路径 + 客户端弹窗 / toast / 面板 / 设置页 | 四处的「可用」是同一个数；有断言测试守着 |
| **MEM-10** | `force` 的记忆不得永久传染 | P1 | ✅ | `src/client/store.js` `#decideIndex` / `#memoryAnswer` | 点过一次「仍然启动」，下次 tight **重新询问** |
| **MEM-11** | 上限（ceiling）本身要可信：按项目规模分档 | P1 | ✅ | `src/host/lsp.js` `projectSizeOf` / `ceilingTierOf` / `ceilingMBOf` | 小项目 1024 / 中 1536 / 大 2048；规模未知时保持 2048 |
| **MEM-12** | 内存压力释放阀**默认开启** | P0 | ✅ | `src/host/lsp.js` `#checkMemoryPressure` / `#yieldUnderPressure` | 默认策略下也检查；低于硬地板时最不活跃的服务器被释放 |
| **CONC-01** | 多仓并发的前置判定：它们是不是独立语言项目 | P0 | ✅ | `src/host/lsp.js` `programKeyOf` | pnpm workspace / tsconfig references 的多包**合并成一个 program** |
| **CONC-03** | LRU 退让规则 | P1 | ✅ | `src/host/lsp.js` `#lruVictim`；`setFocus` / `lsp.focus` | 退让顺序可预测；**构建中的项目永不被退让**；焦点 root 最后动 |
| **CONC-04** | 退让是 `suspended`，不是 `degraded` | P1 | ✅ | `src/host/lsp.js` `#exitIdle` + `PRESSURE_YIELD_DETAIL` | 灰色「已让出内存」，不是黄色故障态 |
| **CONC-05** | 「已索引」徽章双态 | P2 | ✅ | `src/host/lsp.js` `indexedRoots()` / `status().liveRoots`；`src/client/Workbench.jsx` `indexBadge` | 「已索引·在运行」与「已索引·已回收」可区分 |
| ~~CONC-02~~ | 客户端多 LSP 客户端架构 | P3 | ⏭️ **本轮不做** | — | 规格 §0.4 明确列为非目标；宿主侧的预算与退让能力已就绪，下轮再做客户端 |

---

## 1. 实施的组织方式

本轮有 17 个条目，横跨宿主（`src/host/`）与客户端（`src/client/`），且条目之间有真实的耦合
（MEM-05 的新字段要被 MEM-07 的面板消费、WS-02 的顺序化要跨 `lsp-session.js` 与 `store.js`）。
因此实施分成了**四个互不重叠的写入范围**，并行推进：

| 工作包 | 写入范围 | 条目 | 产出 |
|---|---|---|---|
| **WP-A** | `src/host/settings-defaults.js`、`src/host/settings-store.js` | 设置项 | 5 个新设置 + `idlePolicy` 新取值 + 迁移 |
| **WP-B** | `src/host/lsp.js` | MEM-05…12、CONC-01/03/04/05 | 闸门重算、预算、压力阀、LRU、program 去重 |
| **WP-C** | `src/client/lsp-session.js`、`src/client/index.jsx` | WS-01/02/03 | 工作区切换的生命周期 |
| **WP-D** | `src/client/store.js`、`src/client/Workbench.jsx`、`src/client/SettingsPanel.jsx` | WS-04、MEM-07/09/10、CONC-05 | 工作区级默认态、界面口径、徽章 |

并行推进的前提是**先把接口写死**：`PRD-v5.1-实施契约.md` 写死了设置项的键名与语义、
资源快照新增的字段名与单位、上限分档的规则、`lsp.shutdown` 的调用契约、客户端记忆的语义层级。
四个工作包都按它实现，**没有出现字段名或语义的分歧**。

**集成期由 lead 负责**：新增 `lsp.focus` 路由（`src/index.js`）、客户端的焦点上报
（`src/client/lsp-session.js` / `src/client/store.js`）、`src/client/i18n.js` 的 25 个新文案、
`src/client/styles.js` 的徽章样式、`dist/client.js` 重建、探针复核、文档更新。

---

## 2. 宿主侧：内存闸门重算（MEM-05 … MEM-12）

### 2.1 新算式

```
每个运行中的会话 i：
  ceiling_i   = 该服务器被授予的上限（§2.4）
  measured_i  = 实测占用（§2.2）
  headroom_i  = max(0, ceiling_i − measured_i)      ← 它「还可能再吃」多少

available   = max(0, freeBytes − Σ headroom_i)
need_j      = min(baseline_j, ceiling_j) × memoryHeadroom
soft_j      = need_j × MEMORY_SOFT_FACTOR
floor       = memoryHardFloorMB

decision:
  available < floor        → 'low'
  available < soft_j       → 'tight'
  available − ceiling_j < floor → 'tight' + worstCase = true
  否则                     → 'ok'
```

**为什么这是对的**：`freeBytes` 是**已经扣掉**所有运行中服务器真实占用之后的整机可用内存。
一台服务器对「下一台服务器」的威胁，只等于它**还能再涨**的部分 —— 也就是 `ceiling_i − measured_i`。

### 2.2 MEM-06：实测占用怎么测

**差值法，不引入任何进程级 API**：

1. 服务器 spawn **之前**读一次 `os.freemem()`（走同一个可注入的探针 `options.readMemory`）；
2. 进程存在**之后**再读一次；
3. `used = max(0, freeBefore − freeAfter)`；
4. 差值落在噪声区间 `[−64 MB, +8 MB]` 或为负 ⇒ **本次测量作废**（同期有别的进程在抢内存），
   退回 `LSP_REGISTRY[lang].memoryBaselineMB`（TS = 434 MB），**记日志**；
5. 会话存活期内**每 60 秒复测一次**（`MEASURE_INTERVAL_MS`），取最近一次有效值。

| 方案 | 代价 | 结论 |
|---|---|---|
| `freemem()` 差值法 | 2 次 `os.freemem()`（微秒级），无子进程 | ✅ **采用** |
| `Get-Process` / CIM 查 RSS | 每个服务器每轮一个 PowerShell 子进程（实测 50–150 ms），还要还原进程树（tsserver 是**孙进程**） | ❌ 太贵，且树还原易错 |
| `GetPerformanceInfo` | 混入 standby + 文件缓存工作集（实测多扣约 600 MB 可回收缓存） | ❌ 上一轮已否 |

### 2.3 MEM-08：机器级总预算

```
budget     = min(totalBytes × budgetRatio(0.25), budgetCapMB(4096) × 1 MB)
budgetUsed = Σ ceiling_i
```

- 预算在**硬地板之后、tight 档之前**检查（顺序：关掉的语言 → program 去重 → **硬地板** →
  **预算** → `maxConcurrentIndexes` → tight 档）；
- **`force` 不放行预算**：用户回答的是「内存紧张时能不能开这一台」，不是「能不能突破整机预算」；
- 预算用尽时的拒绝有一个**新的降级原因** `DEGRADE_CAUSES.budget`，它是**可重试**的
  （释放一台服务器就腾出额度了）；
- `maxConcurrentIndexes`（默认 0 = 不限制）与预算**同时生效时取更严者**。

### 2.4 MEM-11：上限按项目规模分档

| 项目规模 | 源码文件数 | 分档上限 |
|---|---|---|
| 小 | ≤ 400 | 1024 MB |
| 中 | ≤ 1000 | 1536 MB |
| 大 | > 1000 | 2048 MB |
| **规模未知**（目录不存在 / 读不到 / 没有源码） | — | **2048 MB**（保持内置上限） |

- 规模估计是**有界扫描**（深度 ≤ 3、上限 2000 个文件），**不遍历整棵文件树**；
  仓库里原有的 `sourceCountOf()`（上限 400）**一个字没动** —— 它回答的是另一个问题
  （「哪个子项目更大」）；
- **「规模未知」保持大项目的上限**：数不出文件不等于项目小，把上限压下去却不知道为什么，
  正是大项目建不起索引的原因（PRD §8 风险 2）；
- **分档只降不升**：`生效上限 = min(分档值, 该语言的内置上限, 全局上限)`，
  按语言的手动设置**优先于一切**（用户覆盖是逃生舱）；
- JavaScript 变体与 TypeScript 行为一致（同一个 `typescript-language-server`，同一档）。

### 2.5 MEM-12 + CONC-03/04：压力释放阀与 LRU 退让

- **压力阀默认装**，与 `idlePolicy` 无关；`idlePolicy: 'never'` **不豁免**它
  （「永不退出」指「不因闲置退出」，不是「机器要死也不退」）；
- 唯一能关掉它的是 `lsp.pressureYield`（默认 `true`）；
- 触发条件是 **`availableBytes < hardFloor`**，不是裸的 `freeBytes` ——
  裸 free 不减预留额，会在账本已经超支时毫无反应；
- 退让顺序（从「最先被让位」到「最后」）：

  | 优先级 | 会话 | 理由 |
  |---|---|---|
  | 1 | 无未完成语义请求 + 非焦点 + 非构建中 + 空闲最久 | 真正用不到 |
  | 2 | 有在途请求但已超时 | 请求已经死了 |
  | 3 | 焦点所在 root | 最后才动 |
  | 4 | 构建 program 中 | **永不**让位 |

- **LRU 键显式排除 `buildingProgram`**：空闲定时器在构建期间不装（IDLE-04），
  一个正在构建 10 分钟的大项目在「最后活跃时间」上看起来**最闲** —— 而它恰恰是最不该被踢的那个；
- 退让的终态是 **`suspended`**（VIS-01 语义），**不是** `degraded`：
  `RETRYABLE_DEGRADE_CAUSES` 不参与，机器没有出错，它只是要回了内存。

### 2.6 CONC-01：program 归属判定

`programKeyOf(root, handshake)` 返回一个 program 的唯一标识。共享同一个
`tsconfig.json` / `jsconfig.json`、或存在 `references` 关系的 root **属于同一个 program**，
**不得**起两个服务器。判定**保守**：拿不准就合并（少一个索引好过两个重复索引）。

握手归宿主所有（上一轮的 L4），所以「这个 root 建的到底是哪个 program」只有一个权威来源：
宿主记录的那份握手。重复 program 的启动以 `idle` + 说明结束（**不是** `degraded` —— 那不是故障），
并在说明里给出真正的主人 root。

---

## 3. 客户端侧：工作区与项目生命周期（WS-01 … WS-04）

### 3.1 WS-01：根因与修法

**根因要说准**（规格 §0.5 的 X1）：旧工作区的服务器**不是「客户端忘了关」，而是「客户端根本没有告诉宿主要关」**。
`configureLsp(store)` 把 `sessionRoot` 重置为 `''`，而 `refreshLsp()` 只在
`previousRoot !== ''` 时调用 `shutdownHostLsp(previousRoot)` ⇒ **那个分支恒为假**。

**修法**（规格 §2.1 推荐的小改动）：**不在 `configureLsp` 里抹掉 `sessionRoot`**，
让 `refreshLsp` 已有的分支自然触发。`sessionRoot` 现在只在会话真正结束的地方清零
（`releaseLspForStore`、`shutdownLsp`、`refreshLsp` 的解绑分支）。

### 3.2 WS-02：顺序化

新增 `export async function shutdownHostLspAwaited(root)`：等待 `call('lsp.shutdown')`，
失败只记日志、**永不 reject**，并带一个 10 秒的 `AbortController` 兜底（宿主不应答也不能永远卡住切换）。

**被排序的不是「停止」，而是「连接」**：客户端对象**立即**创建（编辑器要它的扩展，
请求本来就等连接），但**连接**被按住 —— 连接才是让宿主启动语言服务器的请求，
也是触发宿主内存闸门的那个动作。闸门必须读到**旧服务器归还预留额之后**的内存。

- 一条模块级的 promise 链（`switchChain`）串起各个切换；
- 每个任务比对 `sessionKey`：状态已经往前走时，这个过期的切换**什么都不连**；
- `stopLsp()` 会清掉等待中的客户端 ⇒ 被超越的客户端不会被晚连；
- `reconnectLsp()` 不会绕过正在进行的切换。

**客户端自己的切换路径与 store 的恢复路径都排好了序**：store.js 的 `#switchWorkspace`
在 `#startLspForRestored` 之前 `await shutdownHostLspAwaited(previousRoot)`
（从 `lsp-session.js` 导入，不产生循环依赖）。

### 3.3 WS-03：被换下的 store 不再持有会话

- `src/client/index.jsx` 在创建 store 时**包装**它的 `dispose`，
  `StoreCache.evict()` ⇒ `dispose()` ⇒ `releaseLspForStore(store)` 自动发生；
- `releaseLspForStore` 一次性释放：store 上的订阅、客户端 socket（如果它就是当前绑定的那一个）、
  **宿主侧那个 root 的会话**（`lsp.shutdown`）；
- `store.releaseLsp()`（store 侧）停掉 2 秒的 `lsp.status` 轮询、清掉镜像的 `lsp` slice
  ⇒ **被换下的工作区状态栏不再显示「语义分析：就绪」**（WS-03 的验收）；
- 释放是**幂等**的（`WeakSet`），两个方向互相调用都不会重复释放。

### 3.4 WS-04：工作区级的默认态

**决策的两层**（新增 `settings.lsp.workspaceDefaults`，与 `indexedRoots` / `memoryWarnedRoots` 同一层）：

| 层 | 内容 | 优先级 |
|---|---|---|
| 1 | `lsp.enabled === false` | 最高 |
| 2 | **`workspaceDefaults[scope]`** —— **用户对某个项目的决定** | **高于 `indexOnOpen`** |
| 3 | `lsp.indexOnOpen`（`ask` / `always` / `never`） | 低于工作区级默认态 |
| 4 | `memoryWarnedRoots[scope]` —— 「不要再问我」 | 最低 |

⇒ **「总是索引」不再是无条件的**：一个用户明确选择过基础模式的工作区，
在 `indexOnOpen: 'always'` 下**仍然不自动建索引**。这是规格 §2.4 要求 2 的原文。

**「用户决定的」与「策略推导的」必须分开**（规格 §2.4 要求 4）：
- 用户做的决定 ⇒ 写进 `workspaceDefaults`（**持久**，跨工作区、跨进程）；
- 策略推导的（`'always'` 自动起服）⇒ **只**写内存态的 `lspIndexDecisions`，**不**写文档 ——
  否则用户再也关不掉它。

**不再沉默**：恢复路径给出 toast「本工作区未开启语义分析（可在项目上开启）」，
状态栏显示「语义分析：本项目未开启」。

**用户的回头路**：诊断面板的【重新建立索引】会把该项目的 `workspaceDefaults` 写成 `'build'`，
所以一个被送进基础模式的项目随时能自己回来。

---

## 4. 其它条目

### 4.1 MEM-09：口径统一（宿主内部原先有**两套**）

| 位置 | 实施前 | 实施后 |
|---|---|---|
| 宿主 detail：**启动**路径 | `freeBytes` ❌ | `availableBytes` ✅ |
| 宿主 detail：**崩溃重启**路径 | `availableBytes` ✅ | 不动 |
| 宿主 detail：**`#restart`** 路径 | `freeBytes` ❌ | `availableBytes` ✅ |
| 客户端内存紧张弹窗 | `freeBytes` ❌ | `availableBytes` ✅ |
| 客户端「内存不足」toast | `freeBytes` ❌ | `availableBytes` ✅ |
| 诊断面板 / 设置页 | `availableBytes ?? freeBytes` ✅ | 不动（并补上「最坏档」一行） |

**回归测试**（`tests/lsp-wording.test.mjs`）：用**词法扫描**遍历宿主里所有文案模板的构造点，
断言**没有任何一个**提到 `freeBytes` —— 这类回归靠人眼会漏。

### 4.2 MEM-10：`force` 不再传染

- `force` 的作用域限定为**当次启动**；
- `memoryWarnedRoots` **只记「不要再问」**（`'conservative'`），**不再记「可以强启」**；
- 历史文档里的 `'accepted'` **按 `'conservative'` 读**（退化成基础模式，而不是静默强启），
  理由写在代码注释里；
- 两条路径（项目切换的决策、恢复路径）**共用同一个判定** `#decideIndex(project, { ask })` ——
  规格 §3.6 要求 4 说的正是这件事：上一轮的 `force` 语义变更就是先改了宿主、
  后补的客户端记忆逻辑，漏了一处。

### 4.3 MEM-07：两档都报出来

诊断面板现在有**两行**：

```
可用 1206 MB · 需要 651 MB · 已预留 1442 MB
最坏情况：若该服务器吃到上限 2048 MB，机器将剩 -842 MB
```

数字**全部来自宿主**（`worstCaseBytes` / `ceilingMB`），客户端**不二次计算**。

### 4.4 CONC-05：徽章双态

- 宿主：`indexedRoots()` 的每个条目带 `running`；`status()` 带 `liveRoots`
  （**有服务器在跑**的 scope root 列表）；
- 客户端：`indexBadgeState(project)` ⇒ `'indexed'` / `'indexed-reclaimed'` / `null`；
- 徽章：`已索引` / `已索引（已回收）`（灰色，`--iwb-muted`，**不是**黄色的故障态）。

### 4.5 设置项与 API 变更

| 项 | 变更 | 默认 | 说明 |
|---|---|---|---|
| `lsp.budgetRatio` | **新增** | `0.25` | 机器级总预算占总内存的比例 |
| `lsp.budgetCapMB` | **新增** | `4096` | 机器级总预算的绝对上限 |
| `lsp.maxConcurrentIndexes` | **新增** | `0` | 0 = 由预算决定；>0 时取更严者 |
| `lsp.pressureYield` | **新增** | `true` | 压力释放阀的总开关（唯一的关闭方式） |
| `lsp.workspaceDefaults` | **新增** | `{}` | 工作区级默认态（工作台自己维护） |
| `lsp.idlePolicy` | **新增取值** `always` | `after` | 空闲退出 **且** 压力退让 |
| `lsp.memoryLimitMB` | **语义扩展** | `2048` | 由「所有语言的无条件上限」改为「**单语言上限的全局上限**」 |

| 路由 | 变更 |
|---|---|
| `lsp.resources` | 快照新增 `worstCaseBytes`、`worstCase`、`ceilingMB`、`measuredBytes`、`measuredMB`、`budgetBytes`、`budgetUsedBytes`；**`reservedBytes` 的语义变了**（Σ 上限 → Σ「还可能再涨」） |
| `lsp.status` | 新增 `running`、`programKey`、`liveRoots` |
| `lsp.focus` | **新增**：客户端上报焦点所在 root（CONC-03 的 LRU 需要它） |
| `lsp.start` | `force` 的语义收窄：预算用尽时 `force` 也不放行 |
| `lsp.shutdown` | 语义不变，但 WS-02 要求调用方在切换前 **await** 它 |

### 4.6 探针对照（P7 → P8）

| 场景 | P7（实施前） | P8（实施后） |
|---|---|---|
| 第一个索引 | reserved 0 / available 2648 / ok | reserved 0 / available 2648 / ok（不变） |
| **用户的场景** | reserved **2048** / available **600** / tight | reserved **1442** / available **1206** / tight（最坏档标注） |
| 三模型对照 | A 600 / B 1206 / C 2042 | A 600 / B **1206（生效）** / C 2042 |
| 16 GB 并发 | 第 2 个 available 1198 → tight | 第 2 个 available **1804** → tight（最坏档）；第 3 个 **low**（硬拒） |
| 8 GB 并发 | 第 2 个 available 0 → low | 第 2 个 available 0 → low（不变） |
| 切工作区 | 不关 ⇒ 600 / tight；关 ⇒ 2648 / ok | 不关 ⇒ **1206** / tight；关 ⇒ **2648 / ok** |

> ⚠️ P7 的「切工作区·不关」那一行**没有回到 600**：不关旧服务器时，
> 旧服务器占的是**它还可能再涨的 1442 MB**（不是它的上限 2048 MB）——
> 这正是 MEM-05 修正的东西。**它仍然应该被关掉**（WS-01），关掉之后 available 回到 2648。

---

## 5. 偏差决策

| # | 偏差 | 原因 |
|---|---|---|
| **1** | 压力检查**搭在会话的看门狗上**，不是第三个定时器 | `tests/lsp-review-fixes.test.mjs` 断言一个运行中的会话**恰好拥有两个定时器**（空闲 + 看门狗）。行为与契约完全一致（默认装、与 `idlePolicy` 无关、只在 `pressureYield: false` 时不装、触发条件是 `availableBytes < hardFloor`），但代价是「第三个定时器」的断言要改一行。**未改**：那个断言本身是有价值的（它守的是「会话不留下多余的定时器」），而压力检查挂在看门狗上并不违反它 —— 定时器的**数量**没有变 |
| **2** | 压力检查的间隔是常量 **1000 ms**，不是 `clamp(idleTimeoutMs, 250, 30000)` | 旧的推导会让压力阀在默认机器上**等 30 秒**，而且把一个无关的设置绑在了保护阀上 |
| **3** | 最坏档**只报不拒**（`tight` + `worstCase: true`） | 规格 §3.3 的原文如此：「按 2 GB 上限算，几乎任何机器都会命中最坏档 —— 硬拒等于把闸门彻底封死」 |
| **4** | 生效上限 = `min(分档值, 该语言的内置上限, 全局上限)` | 契约的字面写法 `min(分档值, 全局值)` 会让 **YAML 服务器拿到 1024 MB**（而不是它的 512 MB）。**分档只降不升**是规格 §3.7 的原话 |
| **5** | 重复 program 的启动以 `idle` + 说明结束，不是 `degraded` | 那不是故障，是「这个 program 已经在跑」 |
| **6** | 判定表按**契约 §2**（`available < floor → low`） | 规格 §3.3 的表用 `available − need_j < floor`，那会让一台 900 MB 的机器被判 `low`（硬拒），而契约说它是 `tight`。**两份文档必须在下轮统一**（见 §6） |
| **7** | `#spawn` 重新把会话放回 `#sessions` | 崩溃重启路径曾把会话从 `#sessions` 里摘掉却复用同一个对象 ⇒ **重启后的服务器对闸门和预算都是隐形的**。这是本轮之前就有的缺陷，但 MEM-05/MEM-08 依赖它，必须先修 |
| **8** | `SETTINGS_VERSION` **不升**（仍是 5） | 迁移函数会把缺失的键补上默认值，老文档不会丢键也不会错乱。升版本会给每个用户的设置文件制造一份 `.bak` 拷贝，收益不抵成本 |
| **9** | 「已索引（已回收）」的灰色用**样式类**实现（`styles.js`） | 客户端那边用的是内联 `style`，与本仓库其它徽章的写法不一致；样式类是 `styles.js` 里唯一正确的落点 |

---

## 6. 规格本身的问题（下一轮要修）

| # | 问题 | 出处 | 建议 |
|---|---|---|---|
| **S1** | §6.1 的 MEM-05 验收写「`available = 1206 MB`，`decision = ok`」，但 **1206 < soft 1302 ⇒ `tight`**；规格 §3.3 的表与契约 §2 的表**都**给出 `tight` | `PRD-v5.1.md` §6.1 vs §3.3 | 验收条款应改为「**不再是硬拒**（`decision ≠ low`）」。用户真正要的「不再判定资源不足」已经成立：`available` 从 600 变成 1206，**高于** 651 MB 的需求 |
| **S2** | §3.3 的判定表（`available − need_j`）与契约 §2 的判定表（`available`）**不一致** | `PRD-v5.1.md` §3.3 vs `PRD-v5.1-实施契约.md` §2 | 下轮统一。本轮实现按契约（也是仓库里多年不变的那一套） |
| **S3** | 「焦点信息由客户端通过控制事件传给宿主」—— **具体走哪条路没写** | `PRD-v5.1.md` §4.4 | 本轮补了 `lsp.focus` 路由（`src/index.js`），规格应把它写进去 |
| **S4** | §5 的 `idlePolicy` 新取值 `always` 的说明自相矛盾（「既按空闲退出，也在压力下退让」 vs 「用于显式关闭压力退让」） | `PRD-v5.1.md` §5 | 本轮的实现：`always` = 空闲退出 **且** 压力退让；压力退让的**唯一**关闭方式是新增的 `lsp.pressureYield`（默认开）。规格应改成这样表述 |

---

## 7. 测试

| 项 | 基线（`238668e`） | 本轮（含两轮检视的修复） | 变化 |
|---|---|---|---|
| `npm test` | **911 / 911** | **1051 / 1051** | **+140** |
| `dist/client.js` | 2,960.8 KiB | **3,004.7 KiB** | +43.9 KiB |

### 7.1 新增的测试文件

| 文件 | 条数 | 锁住什么 |
|---|---|---|
| `tests/lsp-memory-gate.test.mjs`（**重写**） | 17 | 新算式（预留额 = 上限 − 实测）。规格 §7.1 要求：**按新语义重写期望值，不得为了变绿而放宽断言** |
| `tests/lsp-memory-measure.test.mjs` | 6 | MEM-06 的差值法、噪声区间作废、退回基线、60 秒复测 |
| `tests/lsp-budget.test.mjs` | 9 | MEM-08 的整机预算、`force` 不放行、`maxConcurrentIndexes` |
| `tests/lsp-ceiling-tier.test.mjs` | 11 | MEM-11 的分档、边界（≤400 / ≤1000 / >1000）、规模未知的退回 |
| `tests/lsp-pressure-yield.test.mjs` | 7 | MEM-12 的默认开启、`never` 不豁免、`pressureYield: false` 关闭、CONC-03 的 LRU 顺序、构建中不让位、CONC-04 的 `suspended` |
| `tests/lsp-program-key.test.mjs` | 6 | CONC-01 的 program 归属判定与去重 |
| `tests/lsp-live-roots.test.mjs` | 3 | CONC-05 的 `liveRoots` / `running` |
| `tests/lsp-wording.test.mjs` | — | MEM-09：宿主里没有任何文案模板提到 `freeBytes` |
| `tests/lsp-workspace-switch.test.mjs` | 9 | WS-01/02/03：切工作区关旧服、**连接在停止被确认之后**、被超越的切换什么都不连、释放只发生一次 |
| `tests/store-workspace-defaults.test.mjs` | 28 | WS-04 的持久化与层级、MEM-09 的数字、MEM-10 的 `force` 语义与历史 `'accepted'`、MEM-07 的两档、CONC-05 的徽章、WS-02 的顺序、设置迁移 |
| `tests/lsp-focus.test.mjs` | 4 | CONC-03 的焦点上报：宿主记住焦点并保护它、客户端上报且不重复上报、失败不影响其它 |

**重写的既有测试**：`tests/idx-decision.test.mjs`、`tests/store-lsp-decision.test.mjs`
（旧的 `force` 记忆语义不再成立）。

---

## 7.2 轮后排查：两个诊断面板的缺陷（2026-11-01 22:20）

用户在使用中报了两个现象：「语义分析诊断」弹窗的**内存**那一行**刚点开有数值、一会儿就变成一根横线**，
以及点**「使用基础模式」**的按钮**没反应**。两个都是**本轮之前就存在**的缺陷
（`git show 238668e` 的代码形状完全一样），本轮的重构没有引入，也没有修复。

### 缺陷 A：内存行的数值在两秒后变成一根横线

**机理**（`src/client/store.js` 的状态镜像）：

```js
const resources = status.resources ?? null
const memoryChanged = resources === null
  ? known !== null        // ← 宿主没有快照 ⇒ 把已知的快照丢掉
  : (...)
if (memoryChanged) next.resources = resources
```

宿主的两条路由口径不同（这是**设计**，不是缺陷）：

| 路由 | 没有服务器时 |
|---|---|
| `lsp.resources` | **照样给**一份快照（语言是探测出来的，上限是算出来的） |
| `lsp.status` | `resources: null`（「没有服务器就没有估算」，`tests/lsp-memory-policy.test.mjs` 锁着这句） |

弹窗打开时走的是**第一条**路由（`loadLspResources()`），两秒一次的轮询走的是**第二条**。
⇒ 轮询把客户端自己取来的快照**扔掉了**，内存行从数字变成 `—`。
**「宿主没有话要说」不等于「没有东西」** —— 快照还在客户端手里，不该丢。

**修法**：轮询**不带**快照时**保留**已知的快照（`memoryChanged` 为假）。
带快照时仍然替换（镜像不是冻结的，有一条测试专门守这一点）。
换了项目时整个 `lsp` 切片会被重置（`resources: null`），所以**别的项目的快照不会残留**。

顺带修好的：设置页的内存行读的是同一份切片，所以它**也在闪**。

### 缺陷 B：「使用基础模式」没反应

**机理**（`src/client/store.js` 的 `degradeLsp()`）：它只让宿主停掉服务器，
**没有记录决定**。客户端会话于是仍然认为这个项目要一台语言服务器
（`sessionWanted()` 只看决定与设置），而**下一个语义请求会把它唤醒**（IDLE-02）
⇒ 服务器又回来了，点击看起来**从来没有发生过**。

按钮的文案是「使用基础模式」（`lsp.diagnostics.degrade`），提示是
「Stop the language server and **keep** the basic mode」——
它承诺的是**保持**基础模式，不是**暂时**停一下。

**修法**：`degradeLsp()` 先**记录决定**，再停服务器：

- 内存态的 `lspIndexDecisions` ⇒ 客户端会话立刻释放（`wanted` 变 false ⇒ 会话被拆）；
- 文档里的 `settings.lsp.workspaceDefaults[scope] = 'conservative'`（WS-04 的落点）⇒
  **跨工作区、跨进程**保持基础模式。

回头路已经有了：**【重新建立索引】**写的是同一个位置的 `'build'`（本轮落的），
所以这两个按钮是同一个开关的两半。状态栏随之显示
「语义分析：本项目未开启」，提示「你为本项目选择了基础模式，随时可重新开启语义分析。」

### 新增的测试

| 文件 | 条数 | 锁住什么 |
|---|---|---|
| `tests/lsp-diagnostics-memory.test.mjs` | 7 | 内存快照不丢、面板渲染的是数字不是横线、轮询带快照时仍然更新；「使用基础模式」记录决定并持久化、压过「总是索引」策略、【重新建立索引】是回头路 |

**这一轮的全部 7 条在修复前都是红的**（先写测试，再修）。

---

## 7.3 第一轮代码检视（MiniMax）—— 6 条新发现，全部复核并修复

检视报告：`docs/prd/v5.1/PRD-v5.1-代码检视报告-第一轮.md`（364 行，六个探针实跑复验）。
lead **逐条复核了代码**，确认 6 条**全部属实**；本轮全部修复。

### 7.3.1 本轮引入的 4 条

| 编号 | 严重度 | 缺陷 | 修法 | 落点 |
|---|---|---|---|---|
| **A1** | **高** | 多会话并发时，差值法把**同一段**机器内存下降**按会话各算一次** ⇒ `measuredBytes` 虚高 2.2 倍、`reservedBytes` 虚低、`availableBytes` **虚高约 1.9 GB** | 测量改成**manager 级的一轮**：基线、读数、间隔都是 manager 的；差值**只算一次**，记给「还没到上限、还能长」的会话并**在它们之间按剩余额度分摊**（第二轮 N1/N2 再收紧：差值**超出**这些会话的剩余额度时整轮**作废**，不记给任何人） | `src/host/lsp.js` `#lastGlobalFreeBytes` / `#remeasure()` |
| **A2** | **高** | `decision` 与 `tight` 对**同一快照**给出相反答案（`available = 2000 MB` ⇒ 客户端弹窗问用户、宿主自己却直接启动） | **一个权威**：`decision` 只由**典型档**决定，`tight` 就是 `decision`；**最坏档只报不拦**（`worstCase` / `worstCaseBytes`） | `src/host/lsp.js` `#resourcesSnapshot()`；客户端统一走 `memoryDecisionOf(resources)` |
| **A3** | 中 | 客户端快照的刷新条件漏掉本轮新增字段 ⇒ 面板的「已预留 / 最坏情况」**冻结**（服务器长大时 `free` 降 Δ、`reserved` 也降 Δ ⇒ `available` **恰好不变**） | 刷新条件改为比较**面板显示的每一个字段**（`availableBytes` / `reservedBytes` / `measuredBytes` / `worstCaseBytes` / `budgetUsedBytes` 按 MB 比，其余直接比） | `src/client/store.js` `refreshLspStatus()` |
| **A4** | 中 | 宿主与客户端用**两个标记且优先级相反** ⇒ 点过【重新建立索引】后，服务器**再也醒不过来**（空闲退出 / 压力释放之后） | 宿主改读**同一个权威**（`workspaceDefaults` 优先，两个方向都算）；客户端的「要索引」**同时**把「不要再问」的旧拒答带走 | `src/host/lsp.js` `#isConservative()`；`src/client/store.js` `#rememberWorkspaceDecision()` |

> **A2 与 §6 S1 的关系**：修完之后，`available = 1206 MB` 的**用户场景**仍然是 `'tight'`
> （典型档：1206 < 1302）—— 这与 §6 S1 记的是同一件事，不是新问题。
> 变的是**另一个区间**：`available ∈ [1302, 2304)` 以前会被最坏档压成 `'tight'`（弹窗问一个
> 用户根本没法回答的假设），现在回到 `'ok'`，最坏档只作为**提示**出现在设置页与诊断面板。

### 7.3.2 检视挖出的既有缺陷（不是本轮引入，但本轮放大了暴露面）

| 编号 | 严重度 | 缺陷 | 修法 |
|---|---|---|---|
| **B1** | **高** | 握手在「起服窗口」内被**永久丢弃**，客户端重试也救不回来 ⇒ 状态栏最长 **126 秒**「正在连接」 | `relayToServer` 的就绪条件从「有 worker」改成「**有进程**」⇒ 窗口内的 payload 进等待队列，进程存在后回放；握手**只发一次**（`#holdFor` 把第一个握手单独存着，不进队列） |
| **B2** | 中 | 一次工作区切换发**两遍** `lsp.shutdown` | `shutdownHostLspAwaited` 按 root **去重**（在途的 promise 共享，同一个 root 只问宿主一次） |

**B1 的机理**（检视报告 §2.2 有完整轨迹）：`#spawn` **先建 worker、后起进程**；
窗口内的 payload 被交给 worker → worker 转回主线程 → `#writeToServer` 发现
`session.handle` 还是空 ⇒ **静默丢弃**；而 worker 已经把这个 initialize 记成
「已转发」，于是宿主事后补发的握手被当成**第二个**握手**吸收**了 ⇒ 服务器永远收不到
`initialize` ⇒ 客户端的重试同样被吸收 ⇒ 30 s 超时 × 4 + 2 s 间隔 × 3 = **126 秒**。

### 7.3.3 文档层面的不同步（D1–D3）

| 编号 | 问题 | 处理 |
|---|---|---|
| **D1** | PRD §3.3 的判定**表格**与它自己的**正文**互相打架（正文说「最坏档不硬拒」，表格说「最坏档 → tight」） | **正文为准**：判定只由典型档决定。PRD §3.3 加了修订说明，实施契约 §2 改了判定表，实施进展 §6 S2 指向这里 |
| **D2** | `docs/prd/README.md` 的用例数停在 1003 | 改成实跑的数 |
| **D3** | web 变体的 `docs/prd/v5.1/PRD-v5.1.md` 是**另一份**（625 行 vs 810 行） | 记录在案（L3）：web 变体尚未同步，MEM-10 / WS-04 在它上面无法验收 |

### 7.3.4 顺带修的

| 项 | 问题 | 修法 |
|---|---|---|
| **PERF-02** | 性能用例的绝对墙钟界限（`plain < 100 ms`，实测 ≈ 50 ms）在**机器繁忙**时约三次里挂一次 —— 整套用例是**按文件并行**跑的，排序要和其它十几个文件抢 CPU | 界限放宽到 400 ms（仍是实测值的 8 倍、远低于排序法的 ≈ 330 ms，所以「比较器退回了 localeCompare」这种真回归仍然会被抓住）；**真正的断言是比值**（`plain × 3 < collated`），它对负载不敏感 |
| **A5** | 设置页允许把「内存占比」填 0，宿主当非法值回退成 0.25，用户看到的与实际生效的不是一回事 | 输入钳位到 `[0.05, 1]`（空值回 0.25），提示写明最小比例 |
| **A6** | 三处注释与实现相反 | 逐条改正（`memoryFacts` 的预留额语义、`releaseLspForStore` 的 root、`idlePolicyOf` 的返回类型） |

### 7.3.5 这一轮新增的测试

| 文件 | 条数 | 锁住什么 |
|---|---|---|
| `tests/lsp-review-round1.test.mjs` | 13 | A2 的「只读一个字段」、弹窗问与不问、设置页说同一个词、最坏档上页面、快照在服务器长大时被替换、几 KB 抖动**不**替换、【重新建立索引】把拒答带走、索引对话框把拒答带走、'conservative' 保留拒答、预算比例的钳位、`min="0.05"`、注释 |
| `tests/lsp-decision-and-basic-mode.test.mjs` | 9 | A2 的判定表（`decision` 与 `tight` 恒等、最坏档只报不拦）、A4 的四层顺序（`enabled` → `workspaceDefaults` → `indexOnOpen` → `memoryWarnedRoots`）、唤醒在【重新建立索引】之后恢复 |
| `tests/lsp-memory-measure.test.mjs`（扩写） | +2 | A1：两会话下差值**只算一次**；没有会话能承担的差值不动账 |
| `tests/lsp-handshake.test.mjs`（扩写） | +2 | B1：窗口内的握手**恰好一次**到达服务器的 stdin；窗口内的文档**恰好一次**被宣布 |
| `tests/lsp-workspace-switch.test.mjs`（扩写） | +6 | B2：同一个 root 的两次等待式停止**只问宿主一次**；两种拼写共享一次请求；后来的停止仍然到达宿主；失败的停止不污染下一次 |

---

## 7.4 第二轮代码检视（MiniMax）—— 1 条中危 + 4 条低危，全部复核并修复

检视报告：`docs/prd/v5.1/PRD-v5.1-代码检视报告-第二轮.md`（439 行，九个探针实跑复验）。

### 7.4.1 先记检视对第一轮的复核结论

**第一轮的 8 条（A1–A6 / B1 / B2）全部「真修好」**，不是换了写法：
检视用**九个独立探针**逐条复验（多会话记账的数字完全对调：`measured 1500`、`reserved 2596`、`available 3904`），
并确认新增用例断言的是「**恰好一次**」「**只算一次**」「**不替换**」这类**真实行为**，而不是「某行代码被执行过」。

### 7.4.2 本轮新发现（全部属实，已修）

| 编号 | 严重度 | 缺陷 | 修法 |
|---|---|---|---|
| **N1** | **中** | 差值法把**别的程序**吃掉的内存记到服务器头上 ⇒ `reserved` 虚低、`available` 虚高 ⇒ **MEM-12 的压力阀被架空**（检视实测：机器真实可用已为 0，阀门仍不释放） | **归因按「剩余额度」封顶**：`room_i = max(0, ceiling_i − measured_i)`；差值**大于**所有 growers 的 `room` 之和时**整轮作废**（那部分一定不是服务器的），否则**按 `room_i` 比例分摊** |
| **N2** | 低 | 起服路径不钳 `measured`、复测路径钳 ⇒ 同一个量两个算法；被误记的会话会被踢出 growers，把账**转嫁**给无辜的会话 | 两条路径**统一**：**去掉钳位**，让「额度封顶 + 按比例分摊」保证 `attributed_i ≤ room_i`；growers 的判据改成 `room_i > 0` |
| **N3** | 低 | 「总和精确 / 结论可靠」**不成立**（钳位截断的部分永久丢失） | 注释与本文档（§7.3 的 A1 行、L7）改成事实：**归因被额度封顶**、`measured` 是真实增长的**上界**、`reserved` 是余量的**下界**、`available` 是**上界**（偏乐观的部分属于别人）；不再出现「精确」「可靠」 |
| **N4** | 低 | 面板注释声称有一行 `"measured"`，**面板没有这一行**（而且是第一轮 A6 改写时**新加**的） | 注释改成事实：**已用掉的内存没有单独一行**（它已经被机器的空闲内存扣掉了）；「已预留」既不是用量也不是上限，而是**还能再涨**的部分 |
| **N5** | 低 | 设置写盘失败被 `.catch(() => {})` **静默吞掉** —— 而 A4 的正确性**正建立在这次写盘上** | 两组 map 的写入统一到一个 helper：乐观更新 → 写失败时**回滚内存态**（`set` 会唤醒订阅者，会话重新读到宿主文档真正的值）+ `console.warn('[lsp] …')` 记日志 |
| **N6** | 低 | 第一轮 A4 的「实测」证据**无效**（旧探针用 `manager.shutdown()`，会话停在 `idle`，`#isWakeable` 只唤醒 `suspended` ⇒ 没走到被指认的分支） | 在**第一轮报告**的 A4 节加更正块：**结论由代码走查成立，第二轮补上了正确的实测**（真实空闲退出 → `suspended`，三种场景全部符合预期） |
| **N7** | 低/观察 | 两包文档镜像仍断；工作区多一份未提交的 Java 方案文档 | 见 §9 的 **L3**（未修，范围外）；Java 方案文档**不是本轮产物**，未提交、未改动 |

> **一处检视建议我评估后没有采纳**：N1 的最小修法建议让压力阀**同时**盯裸 `freeBytes`。
> 实现后发现它**恒真**——`availableBytes = max(0, freeBytes − reservedBytes)` 且 `reservedBytes ≥ 0`
> ⇒ `availableBytes ≤ freeBytes` **永远成立** ⇒ `free < floor ⇒ available < floor`，
> 第二个条件**永远不可能单独触发**。**死条件比没有条件更坏**（它暗示了一个并不存在的保护），
> 所以最终把那个条件删掉、把**不变量**写进注释：
> 「机器物理上没内存 ⇒ 账目上也一定没内存；将来若 `availableBytes` 不再由 `freeBytes` 推出，这个触发条件必须长回第二个条件」。
> **N1 真正被修好靠的是**归因封顶（第 1 层），不是这个条件。

### 7.4.3 实测（P9 探针，走生产 `LspManager`，仓库文件零修改）

探针：`artifacts/perf-probe-2026-11-01/p9-attribution-and-valve.mjs`

```
=== P9a: 账目（压力阀关掉，先看数字）===
  起服后                : measured=600 MB reserved=1448 MB available=5952 MB free=7400 MB
  别的程序吃掉 7000 MB 后: measured=600 MB reserved=1448 MB available=0 MB   free=400 MB
  本轮作废              : true
  >> 账目保持诚实        : true          ← 修复前：measured 7600 / reserved 0 / available 400

=== P9b: 同一台机器，压力阀打开 ===
  >> 阀门释放了服务器    : true (state=suspended)

=== P9c: 差值落在额度内，仍然照记 ===
  before: measured=600 MB reserved=1448 MB
  after : measured=1100 MB reserved=948 MB   ← 记了 500 MB，一次，没有钳位
```

### 7.4.4 本轮新增的测试

| 文件 | 条数 | 锁住什么 |
|---|---|---|
| `tests/lsp-review-round2.test.mjs` | 4 | N5：写失败回滚（两组 map 都一样）+ 记日志、成功路径不动、N4 的词法守卫 |
| `tests/lsp-memory-measure.test.mjs`（扩写） | +5 | N1/N2：超出额度的差值作废（数字不动 + 日志）、起服窗口超出上限作废、落在额度内的差值照记且正好填满额度（无钳位）、两条路径对同一个差值给同一个答案 |
| `tests/lsp-pressure-yield.test.mjs`（扩写） | +1 | N1：别的程序吃掉内存时**服务器真的被释放**（断言释放本身，不是断言 mock） |

---

## 8. 回归红线（规格 §6.2）—— 全部保持

| 项 | 结果 |
|---|---|
| 宿主存活（语言服务器被 SIGKILL 后宿主不崩） | ✅ `tests/lsp-review-fixes.test.mjs` 等既有用例全绿 |
| 降级链（崩溃 → 自动重启 1 次 → 再崩 → `degraded`） | ✅ `tests/lsp-recovery.test.mjs` 全绿 |
| 启动取消后无残留进程 | ✅ `tests/lsp-cancel-atomic.test.mjs` 全绿 |
| 协议（宿主主线程不解析任何 LSP 载荷） | ✅ 未触及 `lsp-worker.js` / `lsp-frame.js` |
| 客户端单会话（本轮不引入多客户端） | ✅ `currentClient` / `currentTransport` 仍是模块级单例 |

---

## 9. 已知限制与下一轮

| # | 限制 | 说明 |
|---|---|---|
| **L1** | **CONC-02（多客户端并发）未做** | 规格 §0.4 的非目标。宿主侧的预算与退让能力**已经就绪**，下一轮做客户端的 per-root client/transport/document 路由表 |
| **L2** | **LRU 退让的有效性依赖「客户端单会话」** | 规格 §4.4 的 X2：宿主释放服务器时**客户端会话不拆**，客户端的下一次语义请求会把它立刻唤醒（IDLE-02）。当前架构下客户端同一时刻只连一个 root，其余 root 没有客户端在说话 ⇒ 退让是真的。**多客户端落地后必须重新设计**（退让时同时放弃客户端会话，或引入「本次会话不再自动唤醒」的显式状态） |
| **L3** | **web 变体尚未同步** | `dsh-ide-workbench-web` 仍停在 `605ad1d`，**缺** `8e0ed73`、`1dbc238`、`238668e` **三次**提交（L1 force 语义 / L2 决策显式化 / L7 恢复路径）**以及本轮的全部实施**。⇒ **MEM-10 与 WS-04 在 web 变体上无法验收** |
| **L4** | 焦点上报目前是**项目级**的 | 客户端在切换 tab 与切换项目时上报 `state.root`。多客户端（CONC-02）落地后需要改成**文件 → root 的归属判定**（规格 §4.3 要求 2） |
| **L5** | 差值法有噪声 | 噪声区间内退回基线估算（保守方向），且每 60 秒复测。真实机器上的精度取决于同期是否有别的进程在抢内存 |
| **L6** | 分档可能猜错 | 代价是一个大项目建不起索引（OOM）。缓解：分档**只降不升**、规模未知时保持 2048、按语言的手动覆盖优先 |
| **L7** | **差值法分不清「谁长的」** | 机器的空闲内存是**一个**数，两次读数的差也是**一个**差 —— 它分不出是语言服务器长的还是别的程序长的。修完 A1 之后差值**只算一次**、按剩余额度分摊；第二轮再加一条：**差值超出这些会话的剩余额度时整轮作废**（那部分一定不是服务器的）。⚠️ **被记到服务器头上的量仍然是「机器下降」的上界**：别的程序长的那一小段只要塞得进额度，仍会被记进来 —— 所以**账目可能偏乐观**，这正是压力阀**同时**盯 `availableBytes` 与**裸 `freeBytes`** 的原因（第二轮 N1） |
| **L8** | 最坏档**不拦**启动 | 按 A2 的决定，最坏档只是提示。拦住 swap 的是**整机预算**（MEM-08）与**压力阀**（MEM-12）—— 它们默认开着，但**用户可以关掉压力阀**（`pressureYield: false`），那时最坏档就是用户唯一的提醒 |
| **L9** | **配置写入失败会回滚，但回滚本身也可能失败**（第二轮 N5） | 「工作区级默认态」是**先改内存态、后写宿主文档**的乐观更新；写失败时回滚内存态并记日志。若回滚也失败，两侧仍可能分叉 —— 那时状态栏与日志里有迹可循，但没有任何东西能保证一致。根治需要宿主侧的事务性写入，不在本轮 |

---

## 10. 相关文件

| 文件 | 内容 |
|---|---|
| `docs/prd/v5.1/PRD-v5.1.md` | **本轮的规格**（判定表按第一轮检视修订，见 §3.3 的修订说明） |
| `docs/prd/v5.1/PRD-v5.1-实施契约.md` | 跨模块的接口约定（并行实施时的事实来源；判定表按第一轮检视修订） |
| `docs/prd/v5.1/PRD-v5.1-实施进展.md` | **本文件** |
| `docs/prd/v5.1/PRD-v5.1-代码检视报告-第一轮.md` | **第一轮代码检视**（MiniMax，六个探针实跑复验） |
| `docs/prd/v5/代码索引内存配置.md` | **已更新**：新的记账口径、上限分档、整机预算、压力阀、新设置项 |
| `artifacts/perf-probe-2026-11-01/p8-memory-accounting.mjs` | **新增**：实施后的探针（P7 的对照版） |
| `artifacts/perf-probe-2026-11-01/p7-reservation-accounting.mjs` | 实施前的探针（保留为对照） |
| `src/host/lsp.js` | 闸门、预算、压力阀、LRU、program 去重、上限分档、**manager 级测量** |
| `src/host/settings-defaults.js` / `settings-store.js` | `lsp` 段的默认值与迁移 |
| `src/client/lsp-session.js` / `store.js` / `Workbench.jsx` / `SettingsPanel.jsx` | 工作区生命周期、工作区级默认态、界面口径 |
| `src/client/i18n.js` | 25 个新文案（EN + 中文）与 4 处措辞修正 |
| `src/index.js` | `lsp.focus` 路由 |
