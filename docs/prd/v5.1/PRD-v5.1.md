# PRD-v5.1 —— 语义分析的内存闸门重算、工作区生命周期与并发索引策略

> **状态**：**已实施**（2026-11-01）。实施记录见 `PRD-v5.1-实施进展.md`，跨模块的接口约定见
> `PRD-v5.1-实施契约.md`，第一轮代码检视见 `PRD-v5.1-代码检视报告-第一轮.md`。
> 本文件是**规格**，不含实施记录 —— 规格与实现不一致的地方**以实施记录为准**（那里逐条写明了偏差与理由）。
> **触发**：2026-11-01 用户提问 —— 「机器剩余内存 2648 MB，一个仓库的索引实际需要 621 MB，为什么算法判定资源不足、不启用语义分析？」该提问经代码走查与实机复现，暴露出**三条独立的问题**：闸门算式的双重计数、工作区切换时旧语言服务器无人回收、以及「预留额＝上限」这个取舍并未兑现它所承诺的保证。
> **配套**：`docs/prd/v5/PRD-v5.md`（V5 主规格，只读）、`docs/prd/v5/PRD-v5-改造需求.md`（上一轮改造规格，本轮在其之上修订 MEM-02）、`docs/prd/v5/PRD-v5-改造需求-实施进展.md`（上一轮实施记录）、`docs/prd/v5/代码索引内存配置.md`。
> **实测基线**：`artifacts/perf-probe-2026-11-01/DSH-ide-workbench-性能实测报告.md`（613 行，本机实测）与本轮新增的 `artifacts/perf-probe-2026-11-01/p7-reservation-accounting.mjs`（走生产 `LspManager`，未修改仓库任何文件）。下文所有数字均出自这两份材料或本轮代码走查，逐条标注来源。
> **代码基线**：`dsh-ide-workbench` commit **`238668e`**（分支 `main`，package version 0.5.0）；`dsh-ide-workbench-web` 停在 **`605ad1d`** —— 两包已分叉，web 变体缺 `8e0ed73`、`1dbc238`、`238668e` **三次**提交（见 §1.7）。
>
> ⚠️ **本文件于 2026-11-01 20:32 / 20:50 两次依据新代码复核**：§1 全部行号、§3 全部现状表、附录 A 的探针输出均已重跑更新；**§1.2 的实测数字三次复核逐位未变**（探针在 `4b8af00` / `1dbc238` / `238668e` 三个基线上输出完全一致），因为这三次提交**没有触碰内存闸门的算式**。**变化集中在客户端的决策与会话生命周期**，见 §0.5 与 §1.7。
>
> ⚠️ **与上一轮的关系**：本轮**不是**推翻 `PRD-v5-改造需求.md`，而是**修订其中 MEM-02 的一条实现选择**（预留额取「上限」而非「实测占用」，见 §0.2），并**新增**工作区生命周期（WS）与并发索引策略（CONC）两个方向。上一轮已验收通过的条目（VIS / STALE / IDLE / SCOPE / CRASH / PERF）**一律不动**。

---

## 0. 一页速览

### 0.1 用户报告的现象，与它们的真实根因

| # | 用户报告的现象 | 真实原因 | 本轮是否解决 |
|---|---|---|---|
| **U1** | 机器剩余 2648 MB，仓库索引实测需要 621 MB，算法判定「资源不足」，不启用语义分析 | 闸门算式把**运行中服务器的真实占用算了两遍**（`freemem()` 已扣过一遍，再按上限扣一遍）；且那 2048 MB 的预留**极可能属于上一个工作区遗留的僵尸服务器** —— 切工作区时没有任何一条路径会通知宿主关闭它 | ✅ MEM-05 / MEM-06 / WS-01 / WS-02 |
| **U2** | 弹窗写着「当前可用 2648 MB」，却问「要不要继续」 | 弹窗与宿主 detail 用的是 `freeBytes`，闸门判定用的是 `availableBytes`（= 600 MB）。**同一个问题，两个屏幕给出相反的结论**；且**宿主自己的三条文案路径口径都不一致**（见 §3.5） | ✅ MEM-09 |
| **U3** | 「预留 2048 MB，但这个资源实际又不用，不是实际占用」 | 用户的直觉指向了一个**更深的问题**：预留额取的是**上限**（许可），而闸门拿它当**占用**（事实）来记账。规格 MEM-02 写的是「实际 RSS 之和」，实现选了「预留额账本」这条路，**额度却取了上限** | ✅ MEM-05 / MEM-11 |

> 三个现象是**同一个根因族**的不同切面：**「闸门在拿一个虚构的数做决策」** —— 虚构的数既出现在算式里（上限当占用），也出现在界面里（free 当 available），还出现在生命周期里（一个已经不该存在的服务器，仍然在替新服务器"占着"账）。

### 0.2 纠正上一轮的一条结论：MEM-02 的实现偏离了它自己的规格

`docs/prd/v5/PRD-v5-改造需求.md:485`（MEM-02 规格原文）：

> 除了"整机可用内存"，还要减去**本进程已启动的语言服务器的实际 RSS 之和**（可从 `session.handle` 的进程信息取，**或**维护一个已启动服务器的预留额账本）。

实现选了「账本」这条路（`src/host/lsp.js:1786` `#reservedBytes()`、`src/host/lsp.js:2316` 赋值），**但账本的额度取的是 `memoryLimitMB`（TS 默认 2048 MB），不是实际 RSS**。上一轮的实施记录（`PRD-v5-改造需求-实施进展.md:204-219` §3.6）把这一选择写成了「有意为之」，并写明：

> tsserver 被明确告知上限（`maxTsServerMemory`），上限**真的会到达服务器**；机器要能扛住它跑的每一个服务器的**最坏情况**。

**这一理由本身成立，但它导出的算式是错的**，而且**没有兑现它自己承诺的保证**：

| 检验 | 结论 |
|---|---|
| **双重计数** | `os.freemem()` 是**已经扣掉**运行中服务器真实占用之后的可用内存。再减一次上限 = 同一个服务器被记了两次账（一次作为已消耗，一次作为上限）。正确应减的是 `上限 − 已实测占用`（它**还可能再吃**多少）。 |
| **最坏情况保证** | 算式对**已运行**的服务器按上限收费，对**新**服务器只按估算收费（TS 651 MB）。⇒ 最坏情况那一头**根本没封住**：`free 2648 − (2048−606) − 新服务器上限 2048 = −842 MB`，机器照样进 swap。 |

⇒ **代价付了，保证没买到。** 本轮 MEM-05 重算算式，MEM-11 让上限本身可信，MEM-12 补上真正能拦住 swap 的压力阀。

### 0.3 本轮条目一览

| ID | 条目 | 类型 | 优先级 | 核心锚点 | 一句话验收 |
|---|---|---|---|---|---|
| **WS-01** | 切换工作区必须关闭旧工作区的语言服务器 | 缺陷 | **P0** | `src/client/lsp-session.js:1485-1514` | 切工作区后，宿主侧旧 root 的进程在 2 秒内消失，预留额归零 |
| **WS-02** | 关闭必须**先于**新开（顺序化） | 缺陷 | **P0** | `src/client/lsp-session.js:1464`、`:641-646` | 新服务器的闸门判定发生在旧服务器**退出并归还预留额之后** |
| **WS-03** | 非活动工作区的语义会话不得残留 | 缺陷 | P1 | `src/client/index.jsx:296-331` | `StoreCache` 里被换下的 store 不再持有 LSP 连接与宿主会话 |
| **WS-04** | 工作区级的语义分析默认态（新工作区默认基础模式） | 新增 | P1 | `src/client/store.js:545` `lspIndexDecisions` | 切进一个没开过语义分析的工作区 ⇒ 默认走基础模式；用户手动开启后记住 |
| **MEM-05** | 预留额 = `上限 − 已实测占用`（不再是上限） | 缺陷 | **P0** | `src/host/lsp.js:1786`、`:2316` | `free 2648 / 占用 606` 的场景，available 从 600 MB 变成 1206 MB |
| **MEM-06** | 「已实测占用」的取数口径：`freemem()` 差值法 | 新增 | **P0** | `src/host/lsp.js:2310-2318` | 服务器启动前后各读一次 `freemem()`，差值即占用；测不出时退回 `memoryBaselineMB` |
| **MEM-07** | 新服务器的判定分「典型档」与「最坏档」，两档分别报 | 新增 | P1 | `src/host/lsp.js:1870` | 诊断面板同时给出「典型 1206 MB」与「若吃到上限则剩 −842 MB」两个数 |
| **MEM-08** | 机器级总预算：`Σ上限 ≤ min(总内存×25%, 4 GB)` | 新增 | P1 | `src/host/lsp.js:1786` | 无论开多少个索引，Σ预留额不超过机器预算 |
| **MEM-09** | 界面数字口径统一为 `availableBytes` | 缺陷 | **P0** | `src/client/store.js:1518`、`:1381`、`src/host/lsp.js:2174`、`:2178` | 弹窗显示「可用 600 MB」，与闸门同源；不再出现「2648 MB 可用却问要不要继续」 |
| **MEM-10** | `force` 的**记忆**不得永久传染（硬地板豁免已落地，见 §0.5） | 缺陷 | P1 | `src/client/store.js:1365`、`:1374`、`:1668` | 用户点过一次「仍然启动」，不代表该项目此后每次 tight 都强启 |
| **MEM-11** | 上限（ceiling）本身要可信：按项目规模分档 | 新增 | P1 | `src/host/lsp.js:63-124` | 小项目默认上限 1024 MB；大项目可仍用 2048 MB；上限与「最坏档」提示同源 |
| **MEM-12** | 内存压力释放阀**默认开启** | 缺陷 | **P0** | `src/host/lsp.js:2861-2865` | 默认 `idlePolicy` 下也装压力定时器；机器低于硬地板时最不活跃的服务器被释放 |
| **CONC-01** | 多仓并发的**前置判定**：它们是不是独立语言项目 | 新增 | **P0** | `src/host/lsp.js:756` `scopeRootOf` | pnpm workspace / tsconfig references 的多包**合并成一个 program**，而不是起两个服务器 |
| **CONC-02** | 客户端多 LSP 客户端架构 | 新增 | **P3**（下轮） | `src/client/lsp-session.js:143-166` | per-root 的 client/transport/document 路由表；**本轮不做** |
| **CONC-03** | LRU 退让规则：排除构建中、焦点所在、有在途请求的 root | 新增 | P1 | `src/host/lsp.js:2853-2874` | 退让顺序可预测；正在构建的大项目**永不**被退让 |
| **CONC-04** | 退让是 `suspended`，不是 `degraded` | 体验 | P1 | `src/host/lsp.js:2949-2957` | 被让位退出的仓库显示灰色「已让出内存」，不是黄色故障态 |
| **CONC-05** | 「已索引」徽章双态 | 体验 | P2 | `src/host/settings-defaults.js:112-113` | 「已索引·在运行」与「已索引·已回收」可区分 |

### 0.4 本轮非目标

- **不做**多 LSP 客户端并发（CONC-02）：客户端 `currentClient` / `currentTransport` / `sessionRoot` 是模块级单例，多客户端是一次架构重构，**本轮只把宿主侧的预算与退让能力做出来**，下轮再做客户端。
- **不做**「保留进程、只丢 program」的 tsserver 私有参数注入（沿用 `PRD-v5-改造需求.md` §0.5 的立场）。
- **不做**代码图（codegraph）引入（沿用 `PRD-v5.md` §0.1 的决策）。
- **不承诺**「大项目首次语义请求 < 10 分钟」：受 tsserver 的 program 构建支配，插件侧只能收敛**范围**（SCOPE-01/02 已落地）。
- **不改** MEM-03 的立场：**不扣除 standby cache**。上一轮已用实测证明该前提不成立（`PRD-v5-改造需求-实施进展.md` §3.1），本轮沿用，不再翻案。
- **不重做**已修好的东西：`#safely` 包裹、`stdin.on('error')`、`restarting` 守卫、`requestOf()` 的通知过滤 —— 这些**不要再动**。
- **不改**上一轮的 VIS / STALE / IDLE / SCOPE / CRASH / PERF 条目。

### 0.5 本轮基线上**已落地**的相关变更（避免重复劳动）

2026-11-01 19:35–20:43 的**三次**提交（`8e0ed73`、`1dbc238`、`238668e`）改的是**客户端的决策与会话生命周期**，**没有触碰内存闸门的算式**。但它们与本轮多条目直接相关，实施时必须知道：

| # | 已落地的变更 | 位置 | 对本轮的影响 | 对应的检视编号 |
|---|---|---|---|---|
| **L1** | **`force` 的语义收窄（P2-3）**：`force` 现在**只跳过 tight 档**，**硬地板永不跳过** —— 启动、崩溃重启、`#restart` 三条路径一致 | `src/host/lsp.js:2165-2180`、`:3217-3228`、`:3248-3259` | **MEM-10 缩小**：硬地板豁免已解决，剩下的是「`accepted` 记忆 ⇒ 每次都强启」；PRD 里「预算用完时连 force 也不放行」这一条**降级为 MEM-08 的副产品** | 第六轮 §1.3 |
| **L2** | **索引决策显式化**：`store.lspIndexDecisions`（Map，per-store）+ `store.lspIndexDecision(root)` → `'build' \| 'conservative' \| 'unknown'`；`sessionWanted()` 读它 | `src/client/store.js:545`、`:1428`；`src/client/lsp-session.js:126`、`:1061` | 用户的方案 2 后半段（「新工作区默认不开启，可手动开启」）**有了落点** ⇒ 升级为 **WS-04**；同时**保守版项目现在完全没有会话** ⇒ WS-03 的范围变小 | 第六轮 §1.2（P1-2） |
| **L3** | **客户端会话的故障与宿主的故障分离**：`LSP_HOST_HEALTHY_STATES = ['starting','building','ready','restarting']` | `src/client/lsp-session.js:115` | 与本轮正交，但**状态机语义**已变；CONC-02 若做多客户端，这套状态要按 root 复制（§4.3 要求 4） | 第六轮 §2.5（R6-5） |
| **L4** | **握手归宿主所有（P1-1）**：`entry.handshake` 由宿主记录，worker 只在宿主尚不知道时补位 ⇒ 修复「索引作用域悄悄回退」 | `src/host/lsp.js`（`relayToServer` / `#onWorkerMessage`） | **SCOPE-01 的隐患被堵上**；CONC-01 的 program 归属判定可以复用这条链路的时序保证 | 第六轮 §1.1（P1-1） |
| **L5** | **`servers()` API 去掉 `disabled` 列表**：`enabled` 随每个条目走（被关掉的语言仍被探测并上报） | `src/host/lsp.js`（`servers()`） | 与本轮正交；**MEM-11 的上限分档**要按按语言给出，条目结构不变 | 第六轮 §2.2 / §2.3（R6-2 / R6-3） |
| **L6** | **新增回归基线**：`tests/lsp-memory-gate.test.mjs`（15 条，锁定当前闸门行为）、`tests/store-lsp-decision.test.mjs`（14 条）、`tests/lsp-session-decision.test.mjs`（6 条）、`tests/lsp-handshake-scope.test.mjs`（3 条） | `tests/` | **MEM-05/06/08/12 实施时的验收脚手架已经存在**，`lsp-memory-gate.test.mjs` 是改算式后必须逐条重跑的那一组 | 第六轮 / 第七轮 / 第八轮 |
| **L7** | **恢复路径**：`#startLspForRestored(root)` —— DSH 启动恢复项目（`src/client/store.js:805`）与**切换工作区**（`:1234`）都走它：**不弹窗**，但 `indexOnOpen: 'always'` 或被记住的 `'accepted'` 会照常起服务器 | `src/client/store.js:1654-1669` | **WS-04 的结论被改写**（见 §2.4）；**MEM-10 多了一条 `force` 传染路径**（`:1668`） | 第七轮 §2（R7-1）→ 第八轮 §1.1 |

> ⚠️ **两包已分叉**：`dsh-ide-workbench` = `238668e`（含 L1–L7），`dsh-ide-workbench-web` = `605ad1d`（**不含** `8e0ed73`、`1dbc238`、`238668e`）。本轮实施前必须先决定两包的同步策略，否则**同一个缺陷在 web 变体里仍然存在**。

> ✅ **第八轮 §4 提出的「文档同步」已满足**：该轮指出「PRD-v5.1 §0.5 的基线要改成 `238668e`、表要补一行」，本文件已完成（基线已改、L7 已补）。

**三条对本轮有实质影响的检视结论**（不在 L1–L7 里，但会改变实施方式）：

| # | 结论 | 出处 | 对本轮的影响 |
|---|---|---|---|
| **X1** | **「决策」与「起服」是两条独立的路径**：客户端的 `call('lsp.start')` 只有三个调用点（项目切换 ×2、【重新建立索引】 ×1），而宿主的 `#requestWake` 要求**已有会话** ⇒ **客户端不发起，宿主永远不会自己起服** | 第七轮 §2「机理」 | ⇒ **WS-01 的根因要说准**：旧工作区的服务器不是「客户端忘了关」，而是「客户端根本没有告诉宿主要关」。⇒ 修法必须落在**客户端的关闭调用**上，宿主侧无法自行察觉 |
| **X2** | **宿主释放服务器时，客户端会话不会被拆**：`sessionWanted` 只看**决策与设置**，不看 `store.state.lsp.state`；`refreshLsp` 在 `key === sessionKey` 处直接返回 ⇒ 释放只是「进程没了」，会话还在，下一个语义请求会唤醒它（IDLE-02） | 第六轮 §2.4（R6-4） | ⇒ **MEM-12 与 CONC-03 的退让会被立刻撤销**（除非客户端不再请求）—— 这是 LRU 设计的前提，见 §4.4 的补充 |
| **X3** | **`'always'` 的语义现在有两套**：`#decideIndex`（项目切换）会跑，`#startLspForRestored`（恢复 / 切工作区）也会跑，但**两者的决策来源不同** ⇒ 同一份设置在两条路径上的表现必须一致 | 第七轮 §2 / 第八轮 §1.1 | ⇒ **WS-04 要求 4**（决策要区分「用户决定的」与「策略推导的」）不是洁癖 —— 不区分就会出现「自动起了却记成用户决定的，用户再也关不掉」 |

---

## 1. 事实核实（先读，否则会重复造轮子）

### 1.1 闸门算式的三个数

**宿主算式**（`src/host/lsp.js:1834-1893` `#resourcesSnapshot`）：

```js
const needMB = Math.min(baselineMB, limit) * headroom      // :1847  TS: min(434,2048)×1.5 = 651
const thresholdBytes   = Math.max(hardFloorMB, floorMB) * MB // :1852  floor = 256
const softThresholdBytes = needMB * MEMORY_SOFT_FACTOR * MB  // :1867  651×2 = 1302
const freeBytes   = max(0, memory.freeBytes - standbyBytes) // :1875  standby 默认 0（见 §1.5）
const reservedBytes = this.#reservedBytes()                 // :1878  Σ 各会话的 reservedBytes
const availableBytes = max(0, freeBytes - reservedBytes)    // :1879
const decision = availableBytes < hardFloorBytes
  ? 'low'
  : (availableBytes < softThresholdBytes ? 'tight' : 'ok')   // :1884
```

**预留额的产生与归还**：

| 位置 | 动作 |
|---|---|
| `src/host/lsp.js:2334-2336` | 进程起来后 `session.reservedBytes = memoryLimitMB * 1024 * 1024`（**TS = 2048 MB**） |
| `src/host/lsp.js:1816-1819` | `#releaseReservation(session)` 置 0 |
| `src/host/lsp.js:3338-3343` | `#teardownSession` → 归还预留额 + 从 `#sessions` 移除 |
| `src/host/lsp.js:3407-3426` | `#shutdownEntry` → `#terminateAndWait` + `#teardownSession` |
| `src/host/lsp.js:3466` | `shutdownAll()` → 插件卸载时全清 |

**关键常量**：`MEMORY_HEADROOM = 1.5`（`:138`）、`MEMORY_SOFT_FACTOR = 2.0`（`:146`）、`MEMORY_HARD_FLOOR_MB = 256`（`:154`）、TS `memoryBaselineMB = 434` / `memoryLimitMB = 2048`（`:68-69`）。

### 1.2 实测复现：用户的 2648 / 600 场景

**方法**：`artifacts/perf-probe-2026-11-01/p7-reservation-accounting.mjs`，走生产 `LspManager`（注入内存探针与 spawn 夹具），仓库文件零修改。

```
=== P7b: 一个索引在跑，机器剩 2648 MB，第二个仓库要 621 MB ===
  first index started : true
  free                 : 2648 MB
  reserved on the books: 2048 MB
  available (A current): 600 MB   need=651MB soft=1302MB floor=256MB
  decision             : tight  -> state=degraded
  detail               : the free memory is tight for the typescript language server
                         (2648 MB available, 651 MB expected, 1302 MB recommended).
```

**三种记账模型在同一台机器上的对照**：

| 模型 | 算式 | 可用 | 是否放行（≥651 MB） |
|---|---|---|---|
| **A 现状** | `free − Σ上限` | **600 MB** | ❌ 拒绝 |
| **B 增长** | `free − Σ(上限−实测)` | **1206 MB** | ✅ 放行 |
| **C 实测** | `free − Σ实测` | **2042 MB** | ✅ 放行 |

**模型 B 就是用户的直觉**：`freemem()` 已经替我们扣掉了 606 MB 的真实占用，闸门要扣的只是那台服务器**还可能再吃**的 1442 MB。A 与 B 的差额 **恰好等于运行中服务器的真实占用** —— 这就是双重计数的量级。

> **补充实测**：16 GB / 空闲 3852 MB 的机器上，第二个索引 `available = 1198 MB` → `tight`；8 GB / 空闲 2048 MB 的机器上 `available = 0` → `low`（硬拒）。

### 1.3 切工作区：旧语言服务器为什么没人关

**客户端的生命周期**（`src/client/lsp-session.js`）：

```js
// :1590  绑定到新的 store（= 新的工作区作用域）
export function configureLsp(store) {
  sessionStore = store ?? null
  ...
  sessionKey = null
  sessionRoot = ''          // :1597  ← 旧 root 在这里被抹掉
  sessionScopeRoot = ''
  ...
  refreshLsp()             // :1613 附近
}

// :1506  refreshLsp：切项目时关旧服务器
const previousRoot = sessionRoot   // :1541
...
if (hadClient) {
  if (previousRoot !== '' && previousRoot !== root) shutdownHostLsp(previousRoot)  // :1560
  stopLsp()                                                                          // :1561
}
```

**缺陷**：`configureLsp` 把 `sessionRoot` 重置为 `''`，于是 `refreshLsp` 里 `previousRoot !== ''` **恒为假** ⇒ `shutdownHostLsp(previousRoot)` **永远不会被调用**。

> ⚠️ **复核后仍成立**（`1dbc238`）：`configureLsp` 仍然在 `:1597` 把 `sessionRoot` 清空，`refreshLsp` 的切项目分支仍然带 `previousRoot !== ''` 的前置条件。**新增的 `sessionWanted` 机制没有覆盖这个路径** —— 切工作区时新工作区的项目决策是 `'unknown'`（新 store 的 `lspIndexDecisions` 是空的）⇒ `wanted === true` ⇒ 走的是上面那个分支 ⇒ 旧服务器仍然不关。

而 `stopLsp()`（`:1465-1503`）只做客户端侧的事：`currentClient.disconnect()` + `currentTransport.close()` —— **它不通知宿主**。

**全仓 `lsp.shutdown` 的三个调用点**（无一覆盖"切工作区"）：

| 调用点 | 触发场景 |
|---|---|
| `src/client/lsp-session.js:1560` | **切项目**（同一工作区内换 root） |
| `src/client/lsp-session.js:1578` | 切到**不需要**会话时（保守版 / 功能关闭 / 项目关闭）—— 复核后这一条**不再带** `previousRoot !== ''` 的前置条件 |
| `src/client/store.js`（`restartLsp` / `degradeLsp`） | 用户点【重新建立索引】/【降级为保守版】 |

⇒ **切工作区时，上一个工作区的 tsserver 在宿主侧继续运行、继续背着 2048 MB 预留额，直到 10 分钟空闲超时（`idleTimeoutMs: 600000`）才被回收。**

**实测对照**（P7f）：

```
=== P7f: 切工作区 ===
  today (no shutdown of the old workspace): reserved=2048MB available=600MB decision=tight -> degraded
  with the shutdown:                      reserved=0MB    available=2648MB decision=ok    -> building
```

**这就是 U1 最可能的触发路径**：用户的工作区 A 开着语义分析 → 切到工作区 B → B 里的仓库第一次建索引，就撞上 A 留下的 2048 MB 幽灵预留。

### 1.4 客户端同一时刻只有一个语义会话（这是**现状**，不是待做项）

| 事实 | 位置 |
|---|---|
| `currentClient` / `currentTransport` / `sessionRoot` 是**模块级单例** | `src/client/lsp-session.js:143-207` |
| 切项目时旧服务器被关闭、新服务器立即启动 | `src/client/lsp-session.js:1552-1563` |
| `stopLsp()` 只关 socket，不杀宿主进程 | `src/client/lsp-session.js:1465-1503` |
| `StoreCache` 最多驻留 **3** 个 store | `src/client/index.jsx:296` |
| `getStore()` 命中已有 store 时**不会**再次 `configureLsp` | `src/client/index.jsx:312-321` |
| **决策显式化**：项目要不要会话由 store 的 `lspIndexDecision(root)` 决定 | `src/client/store.js:1428`、`src/client/lsp-session.js:126`、`:1061` |

⇒ **用户的方案 1（全局只一个工作区开语义分析）在客户端层面已经成立**；宿主侧仍可存在多个 root 的会话（`ROOTS` 是模块级 Map），但客户端只跟一个说话。

⇒ **但"只有一个工作区开着"现在只保证"客户端只连一个"，不保证"宿主只跑一个"** —— 这正是 WS-01 要补的缺口。

### 1.5 standby 的立场（沿用上一轮，不翻案）

`src/host/lsp.js:804-842` 已用实测证明：Windows 的 standby list 是内核优先回收的可用内存，扣除它会让闸门拒绝机器给得起的启动。默认探针报 `standbyBytes: 0`，这是**正确**的值。本轮沿用，只保留可注入的口子。

### 1.6 压力释放阀默认是**关**的

`src/host/lsp.js:2877-2892` `#armIdleTimer`：

```js
if (policy === 'never') { this.#clearPressureTimer(session); return }
if (policy === 'onMemoryPressure') { this.#armPressureTimer(entry, session); return }
this.#clearPressureTimer(session)     // ← 默认走这里
```

`idlePolicy` 默认是 **`'after'`**（`src/host/settings-defaults.js:82`）⇒ **默认配置下压力定时器不装** ⇒ 机器内存真的紧张时，宿主**不会主动释放**任何语言服务器，只有 10 分钟空闲定时器会兜底。

⇒ 「绝不把机器推进 swap」这个承诺，**在默认配置下连兜底阀都没有**。MEM-12 补这一条。

### 1.7 复核结论：三次新提交**没有**触及本轮的算式

| 本轮依赖的事实 | `238668e` 下是否仍成立 | 证据 |
|---|---|---|
| 预留额 = 上限 | ✅ 仍成立 | `src/host/lsp.js:2334-2336` |
| `available = free − Σ预留` | ✅ 仍成立 | `src/host/lsp.js:1878-1879` |
| 三档判定（ok / tight / low） | ✅ 仍成立 | `src/host/lsp.js:1884` |
| 切工作区不关旧服务器 | ✅ 仍成立 | `src/client/lsp-session.js:1597` + `:1560` |
| 弹窗用 `freeBytes` | ✅ 仍成立 | `src/client/store.js:1518` |
| 压力阀默认不装 | ✅ 仍成立 | `src/host/lsp.js:2885-2891` + `settings-defaults.js:82` |
| **P7 探针的全部数字** | ✅ **第三次逐位一致** | 探针在 `4b8af00` / `1dbc238` / `238668e` 三个基线上输出完全相同 |

⇒ **本轮 17 个条目一个都不因这三次提交而失效**，但有 4 处需要改写（MEM-09 的证据、MEM-10 的范围、WS-04 的结论、新增 §0.5 的 L7），已在本文件各处标注。

---

## 2. WS —— 工作区与项目生命周期

### 2.1 WS-01（P0）切工作区必须关闭旧工作区的语言服务器

**改哪里**：`src/client/lsp-session.js:1590-1613` `configureLsp()`。

**要求**：`configureLsp` 在替换绑定前，**必须**把被替换的 root 交给宿主关闭：

```js
export function configureLsp(store) {
  const previousRoot = sessionRoot          // 替换前先取
  const hadClient = currentClient !== null
  if (hadClient && previousRoot !== '') {
    shutdownHostLsp(previousRoot)            // 切工作区 = 离开那个工作区
  }
  ...
}
```

**或者**（更小改动）：**不要**在 `configureLsp` 里把 `sessionRoot` 重置为 `''`，让 `refreshLsp` 已有的 `previousRoot !== ''` 分支自然触发关闭。**推荐后者** —— 它不新增分支，只是不要提前抹掉信息。

> **根因要说准（X1，第七轮 §2「机理」）**：客户端的 `call('lsp.start')` 只有三个调用点（项目切换 ×2、【重新建立索引】 ×1），而宿主的 `#requestWake` 要求**已有会话** ⇒ **客户端不发起，宿主永远不会自己起任何服务器**。
> ⇒ 旧工作区的服务器**不是「客户端忘了关」，而是「客户端根本没有告诉宿主要关」**。⇒ 修法必须落在**客户端的关闭调用**上；宿主侧无法自行察觉"这个 root 的客户端已经不在了"。

**验收**：切工作区后 2 秒内，宿主侧旧 root 的进程从进程表消失；`lsp.resources` 的 `reservedBytes` 归零。

**风险**：低。`shutdownHostLsp` 已经是 fire-and-forget 且失败只记日志（`:684-689`）。

### 2.2 WS-02（P0）关闭必须先于新开

**问题**：`shutdownHostLsp` 不 await（`src/client/lsp-session.js:686` `void call(...)`）。切项目时旧服务器**异步**关闭、新服务器**立即**启动 ⇒ 重叠窗口内两个索引并存（实测 ≈ 700–1100 MB，上一轮报告 §5.4），而新服务器的闸门判定读的是**关闭前**的内存快照。

**要求**：新服务器的**闸门判定**必须发生在旧服务器退出、预留额归还之后。

**改哪里**：`src/client/lsp-session.js:1552-1563` 的 `refreshLsp()` 分支。

**要求（可执行的两选一）**：

- **(a) 顺序化**：切 root 时先 `await call('lsp.shutdown', { root: previousRoot })`，再 `startLsp(store)`；
- **(b) 宿主侧串行化**：宿主在 `lsp.start` 里发现"同一 root 的旧会话正在退出"时，**先等它退出**再判定。

**推荐 (a)**：(b) 会把等待塞进每次启动的关键路径，且宿主不知道客户端的切换意图。

**风险**：中。切项目会多花一次 RTT（`lsp.shutdown` 的往返），但换来的是**闸门看到的内存快照是真的**。

### 2.3 WS-03（P1）非活动工作区的语义会话不得残留

`StoreCache` 最多驻留 3 个 store（`src/client/index.jsx:296`）。被换下的 store 仍会跑它的 `lsp.status` 轮询（`src/client/store.js` 的 `lspPollTimer`），而 `configureLsp` 只绑定一个 store ⇒ **旧 store 的状态栏可能仍显示「语义分析：就绪」**，而那个会话其实已经没有客户端了。

> **复核后缩小**：L2 落地后，**保守版项目根本没有会话**（`sessionWanted` 为 false ⇒ `refreshLsp` 的 `else if (hadClient)` 分支会 `shutdownHostLsp(previousRoot)`）⇒ 「决策变了但服务器还活着」这一类残留**已经被 L2 覆盖**。WS-03 剩下的范围只有：store 被 evict 时仍挂着的**轮询定时器**与**旧 root 的服务器**（工作区切换路径 ⇒ 与 WS-01 合并处理）。

**要求**：store 被 evict / 被换下时，其 LSP 订阅与宿主会话一并释放。

**风险**：低。

### 2.4 WS-04（P1）工作区级的语义分析默认态

**这是用户方案 2 的后半段**：「若此前已经有一个工作区开启了语义分析，则新切入的工作区默认不开启语义分析，可以由用户手动开启」。

> ⚠️ **L7 落地后，本条的结论要改写**：`238668e` 新增的 `#startLspForRestored`（`src/client/store.js:1654-1669`）在**切换工作区**时被调用（`src/client/store.js:1234`）⇒
>
> | `indexOnOpen` | 切到新工作区后 | 用户看到的 |
> |---|---|---|
> | `'ask'`（默认） | **不启动、不弹窗** | 基础模式，**但没有任何解释** |
> | `'always'` | **自动启动**（无弹窗） | 直接建索引 |
> | `'never'` / 主开关关 | 不启动 | 基础模式 |
>
> ⇒ **「新工作区默认不开启语义分析」在默认策略下已经成立**（L7）。WS-04 剩下的不是"默认值"，而是下面这四件事。

**落点已经存在**：L2 引入的 `store.lspIndexDecisions`（Map，per-store）与 `store.lspIndexDecision(root)`（`src/client/store.js:545`、`:1428`）就是"这个项目要不要语义分析"的权威来源，`sessionWanted()`（`src/client/lsp-session.js:1061`）读它。

**仍缺四样**：

| # | 缺什么 | 现状 | 后果 |
|---|---|---|---|
| 1 | **记忆不持久** | `lspIndexDecisions` 是 **per-store 的内存 Map**（`src/client/store.js:545`），store 被 evict（`StoreCache` 最多驻留 3 个）就没了 ⇒ 用户的「手动开启」**不会跨工作区切换存活** | 切走再切回来 ⇒ 回到基础模式，用户得重新开一次 |
| 2 | **不跨进程** | 决策没进 settings ⇒ 重启 DSH 全部遗忘 | 每次启动都要重新开 |
| 3 | **`'always'` 的层级没说清** | `indexOnOpen` 是**全局**策略，`#startLspForRestored` 里它**压过**工作区级默认态 | 用户设了 `'always'` ⇒ 切到任何工作区都自动建索引 ⇒ 这与"同一时刻只开一个工作区"的意图（WS-01）冲突 |
| 4 | **静默无解释** | 恢复路径**不弹窗** ⇒ 用户看到基础模式，但不知道为什么 | 用户会以为功能坏了 |

**要求**：

1. 决策按 **workspace scope** 持久化到 `settings.lsp`（与 `indexedRoots` / `memoryWarnedRoots` 同一层），键是 scope 路径；
2. **层级明确**：`indexOnOpen` 是全局策略；**工作区级默认态**（新条目 `lsp.workspaceDefaults`）优先级**高于**它 —— 也就是说 `'always'` 不得让一个"用户明确选择过基础模式"的工作区自动建索引；
3. **切工作区时给一句解释**：状态栏或 toast 说明「本工作区未开启语义分析（可在项目上开启）」；
4. `#startLspForRestored` 里 `#rememberIndexDecision(root, 'build')`（`src/client/store.js:1667`）是**副作用写入** ⇒ 恢复路径不该把"自动启动"记成"用户决定要索引"，否则用户无法再把它关掉。⇒ 决策要区分**用户决定的**与**策略推导的**。

**验收**：

- 工作区 A 开着语义分析 → 切到工作区 B ⇒ B 的项目**直接是基础模式**（不弹窗、不建索引、状态栏显示「基础模式」并给出「本工作区未开启语义分析」的说明）；
- 在 B 里手动开启 ⇒ 记住 ⇒ 切走再切回来仍然记得；
- 重启 DSH 后仍然记得；
- 把 `indexOnOpen` 设成 `'always'` ⇒ 已经选择过基础模式的工作区**仍然不自动建索引**。

**风险**：中。第 2 条**改变了 `indexOnOpen` 的既有语义**（从"总是索引"变成"除非该工作区拒绝过"）—— 需要在设置页与文档里写清，否则是行为倒退。

---

## 3. MEM —— 内存闸门重算

### 3.1 MEM-05（P0）预留额 = `上限 − 已实测占用`

**改哪里**：`src/host/lsp.js:1800-1806` `#reservedBytes()`、`src/host/lsp.js:2328-2336`（赋值点）。

**新算式**：

```
每个运行中的会话 i：
  ceiling_i  = 该服务器被授予的上限（memoryLimitMB，TS 默认 2048）
  used_i     = 实测占用（见 MEM-06）
  headroom_i = max(0, ceiling_i − used_i)     ← 它"还可能再吃"多少

available = freeBytes − Σ headroom_i
```

**为什么这是对的**：`freeBytes` 是**已经扣掉**所有运行中服务器真实占用之后的整机可用内存。一个服务器对"下一个服务器"的威胁，只等于它**还能再涨**的部分 —— 也就是 `ceiling_i − used_i`。

**验收**（P7b 场景）：`free 2648 / used 606` ⇒ `available = 2648 − (2048 − 606) = 1206 MB` ⇒ 放行。

**风险**：中。必须与 MEM-06 同时落地 —— `used_i` 测不准就会算错。

### 3.2 MEM-06（P0）「已实测占用」的取数口径

**不引入进程级 API。** Windows 上 Node 没有读别的进程 RSS 的现成接口（`Get-Process` 要起子进程，几十毫秒到几百毫秒）；但**整机可用内存的口径变化**就是占用。

**要求（差值法）**：

1. 服务器 spawn **之前**读一次 `os.freemem()`，记为 `freeBefore`；
2. 服务器起来**之后**（`:2328` 附近，已经确认进程存在）再读一次，记为 `freeAfter`；
3. `used_i = max(0, freeBefore − freeAfter)`；
4. **测不出时的退路**：`freeAfter` 的差值落在 `[−64 MB, 8 MB]`（噪声区间）或为负 ⇒ 说明同期有别的进程在分配/释放，**本次测量作废**，退回 `LSP_REGISTRY[lang].memoryBaselineMB`（TS = 434 MB）作为 `used_i`，并在会话存活期内定期复测（建议 60 s 一次，取最近一次有效值）。

**为什么用差值法而不是进程级 API**：

| 方案 | 代价 | 结论 |
|---|---|---|
| `freemem()` 差值法 | 2 次 `os.freemem()`（微秒级），无子进程 | ✅ **推荐** |
| `Get-Process` / CIM 查 RSS | 每个服务器每轮一个 PowerShell 子进程（实测 50–150 ms），还要还原进程树（tsserver 是**孙进程**） | ❌ 太贵，且树还原易错 |
| `GetPerformanceInfo` | 混入 standby + 文件缓存工作集（实测多扣约 600 MB 可回收缓存） | ❌ 上一轮已否（§1.5） |

**风险**：中。差值法有噪声 → 必须有退路，且退路要保守。

### 3.3 MEM-07（P1）判定分「典型档」与「最坏档」

**现状**：只有一档阈值（`needMB` vs `softThresholdBytes`），而闸门对**已运行**的服务器按上限收费、对**新**服务器按估算收费 —— 两头口径不一致。

**新判定**（`src/host/lsp.js:1870`）：

```
available  = free − Σ headroom_i
need_j     = min(baseline_j, ceiling_j) × memoryHeadroom      （TS: 651 MB）
soft_j     = need_j × MEMORY_SOFT_FACTOR                        （TS: 1302 MB）
floor      = memoryHardFloorMB                                 （默认 256 MB）

典型档：available − need_j ≥ floor
最坏档：available − ceiling_j ≥ floor      （新服务器若吃到它自己的上限）

decision:
  available − need_j < floor                  → 'low'     （机器给不起）
  available − need_j < soft_j                 → 'tight'   （问用户）
  available − ceiling_j < floor               → 'tight' + worstCase=true（额外标注）
  否则                                         → 'ok'
```

> ⚠️ **2026-11-01 22:50 修订（第一轮代码检视 A2）**：上面的**表格**与紧随其后的**正文**互相打架 ——
> 表格说最坏档也把 `decision` 压成 `'tight'`，正文说「不因为最坏档而硬拒」「正确做法是**如实报出来**」。
> 实施时两条都做，就是**同一个快照两个答案**：客户端弹窗问用户、宿主自己却直接启动
> （实测 `available = 2000 MB`：`decision = 'tight'` 而 `tight = false`）。
>
> ⇒ **判定只由典型档决定**（`available < floor → low`、`available < soft_j → tight`、否则 `ok`），
> **最坏档只报不拦**（`worstCase` / `worstCaseBytes`），理由就是上面那段正文：
> 按 2 GB 上限算几乎任何机器都会命中最坏档，把它变成「问用户」等于让闸门名存实亡；
> 真正拦住 swap 的是 **MEM-08** 与 **MEM-12**，不是这个提示。
> 详见 `PRD-v5.1-实施契约.md` §2 与 `PRD-v5.1-实施进展.md` §6 S2 / §7.3。

**`worstCase` 的处置**：**不因为最坏档而硬拒**。按 2 GB 上限算，几乎任何机器都会命中最坏档 —— 硬拒等于把闸门彻底封死，那才是荒谬的。正确做法是**如实报出来**：

> 诊断面板：「典型：可用 1206 MB · 需要 651 MB」 + 「最坏：若该服务器吃到上限 2048 MB，机器将剩 −842 MB」

真正拦住 swap 的是 MEM-08（机器级预算）与 MEM-12（压力阀），不是这个提示。

**风险**：低。新增一个字段，不改既有三档语义。

### 3.4 MEM-08（P1）机器级总预算

**要求**：`Σ 所有运行中会话的 ceiling ≤ min(totalBytes × 25%, 4096 MB)`。

**为什么需要**：逐台闸门管的是「下一个服务器能不能起」，管不了「三个服务器同时涨到上限」。总预算是最后一道闸。

**改哪里**：`src/host/lsp.js:1786` `#reservedBytes()` 旁边加一个 `#ceilingBytes()`；判定时先看总预算是否还有余额。

**验收**：一台 16 GB 机器上，Σ 上限永远不超过 4 GB；想开第 3 个 TS 索引（Σ = 6 GB）时，在**第二个**之后就被总预算拦下，而不是等到第三个才拦。

**风险**：中。会与 MEM-11（上限分档）联动 —— 小项目上限降到 1024 后，预算能容纳的并发数反而变多。

### 3.5 MEM-09（P0）界面数字口径统一

**现状**（复核后共 **七处**，且**宿主内部自己就不一致**）：

| 界面 / 文案 | 用的数 | 位置 | 判定 |
|---|---|---|---|
| 诊断面板「内存」行 | `availableBytes ?? freeBytes` | `src/client/Workbench.jsx:460` | ✅ |
| 设置页内存提示 | `availableBytes ?? freeBytes` | `src/client/SettingsPanel.jsx:706`、`:716` | ✅ |
| **内存紧张弹窗** | **`freeBytes`** | `src/client/store.js:1518` | ❌ |
| 宿主 detail：**启动**路径（tight / low） | **`freeBytes`** | `src/host/lsp.js:2174`、`:2178` | ❌ |
| 宿主 detail：**崩溃重启**路径（tight / low） | `availableBytes` | `src/host/lsp.js:3222`、`:3226` | ✅ |
| 宿主 detail：**`#restart`** 路径（tight / low） | **`freeBytes`** | `src/host/lsp.js:3253`、`:3257` | ❌ |
| 客户端「内存不足」toast | **`freeBytes`** | `src/client/store.js:1381` | ❌ |

> ⚠️ **复核新发现**：宿主自己的三条文案路径（启动 / 崩溃重启 / `#restart`）**用的是三个不同的数** —— 崩溃重启路径已经用 `availableBytes` 了，另外两条还在用 `freeBytes`。⇒ **同一个故障，用户在「第一次启动」和「崩溃后重启」看到的可用内存数字不同**。这比上一轮记录的「弹窗漏改」更严重：**不是漏了一处，是同一份代码里有两套口径。**

上一轮的实施记录（`PRD-v5-改造需求-实施进展.md:254-265`）只改了诊断面板与设置页两处，**其余全部漏了** —— 而漏掉的恰恰都是**用户做决定的那一刻**看到的。

**要求**：

1. 宿主侧**只留一个口径**：所有 `detail` 文案一律用 `availableBytes`（它是闸门真正判定的数）；
2. 客户端弹窗与 toast 一并改用 `availableBytes`；
3. 按 MEM-07 追加最坏档提示；
4. **加一条断言测试**：遍历所有 detail 文案的构造点，确保没有一个用 `freeBytes` —— 这类回归靠人眼会漏。

**验收**：弹窗文案为「当前可用 600 MB，TypeScript 预计需要 651 MB」，与诊断面板、与闸门判定**同源同数**；启动与重启两条路径的文案数字相同。

**风险**：低。

### 3.6 MEM-10（P1）`force` 的**记忆**不得永久传染

> **复核后的范围**：**硬地板豁免已经修好了**（L1 / P2-3，见 §0.5）—— `force` 现在只跳过 tight 档，硬地板在启动、崩溃重启、`#restart` 三条路径上**永不跳过**。本条剩下的只有**记忆的传染性**，而 L7 又给它**加了一条路径**。

**现状（两条传染路径）**：

| # | 路径 | 位置 | 行为 |
|---|---|---|---|
| 1 | 项目切换时的决策 | `src/client/store.js:1365` → `:1374` | 用户点一次「仍然启动」⇒ 写 `memoryWarnedRoots[root] = 'accepted'` ⇒ **此后每次 tight 都直接 `build-forced`**，不再询问 |
| 2 | **恢复路径**（L7 新增） | `src/client/store.js:1659` → `:1668` | `#startLspForRestored` 读 `#memoryAnswer(root) === 'accepted'` ⇒ **切工作区 / 重启 DSH 时直接 `force: true` 起服务器** |

⇒ 用户点过一次「仍然启动」，该项目此后**每次内存紧张都强启**，**不再询问**；而且**跨工作区、跨进程**都强启。若同时有 N 个项目都点过一次，**N × 2 GB 的最坏情况无人挡**。

**要求**：

1. `force` 的作用域限定为**当次启动**，不跨启动继承；
2. `memoryWarnedRoots` 只记住「**不要**再问」（conservative），不记住「**可以**强启」；
3. 确需保留"强启"记忆的，必须受 MEM-08 的总预算约束 —— 预算用完时连 force 也不放行；
4. **两条路径要共用同一条判定**（否则改了一处漏一处 —— 这次的 `force` 语义变更（P2-3）就是先改了宿主、客户端的记忆逻辑后补的）。

**风险**：低。会让同一项目**反复**弹窗 —— 需要配合 `memoryWarnedRoots` 的 `conservative` 记忆来避免打扰。

### 3.7 MEM-11（P1）让上限本身可信

**问题**：TS 默认上限 2048 MB 是**许可**（`maxTsServerMemory`），不是**预期**（实测 363/434/606 MB）。它同时是 MEM-05 的记账单位、是最坏档的基数、也是最坏情况的暴露面 —— 一个不可信的数当三个角色用。

**要求**：按项目规模分档给上限。

| 场景 | 上限 | 说明 |
|---|---|---|
| 小项目（实测 ≤ 434 MB） | **1024 MB** | 仍是 `maxTsServerMemory` 的 2.3 倍余量 |
| 中项目（实测 ≤ 606 MB） | **1536 MB** | |
| 大项目 / 用户显式设置 | **2048 MB** | 保持现状不变 |

**分档依据**：`src/host/lsp.js` 已有的 `detectLanguage` / `scopeRootOf` 旁边增加一次轻量规模估计（目录内文件数 / `tsconfig` 的 `include` 规模），**不得**为了分档去全量扫描文件树。

**取舍**：上限降低 ⇒ 大项目可能触发 tsserver OOM（exit 134）⇒ 走已有的降级链（CRASH-01/02）。**必须给 TS 保留 2048 MB 的手动覆盖入口**（`lsp.servers.typescript.memoryLimitMB` 已存在）。

**风险**：中高。分档错误的代价是一个大项目建不起索引。

### 3.8 MEM-12（P0）内存压力释放阀默认开启

**问题**（§1.6）：默认 `idlePolicy: 'after'` ⇒ 压力定时器不装 ⇒ 机器真的紧张时，宿主**不主动释放**任何服务器。

**要求**：

1. **压力定时器独立于 `idlePolicy`**，默认就装（间隔取 `PRESSURE_CHECK_MIN_MS…MAX_MS` = 250–30000 ms，现成的常量，`src/host/lsp.js:258-263`）；
2. 压力检查的触发条件改为 **`availableBytes < hardFloor`**（**不是**当前的裸 `freeBytes < hardFloor`）—— 裸 free 不减预留额，会在账本已经超支时毫无反应；
3. 触发时按 **CONC-03 的 LRU 顺序**释放（不是任意一个），并把状态置为 `suspended`（CONC-04），**不是** `degraded`；
4. 保留 `idlePolicy: 'never'` 对**空闲释放**的语义，但**不**豁免压力释放 —— 「永不退出」指的是「不因为闲置退出」，不是「机器要死也不退」。

> ⚠️ **X2 的约束同样适用于压力释放**（§4.4）：宿主释放服务器时**客户端会话不拆** ⇒ 只要客户端还在那个 root 上请求，服务器会被 IDLE-02 立刻唤醒 ⇒ **压力释放必须释放「客户端当前不用的」root**，否则等于没释放。当前架构下客户端只连一个 root ⇒ 这个条件天然成立，但**多客户端落地后必须重新设计**。

**风险**：中。释放一个服务器会让用户的下一个语义请求变成一次重建（IDLE-02 会自动唤醒，代价是构建时间）⇒ 必须先做 CONC-03 的 LRU 顺序，否则会踢错对象。

---

## 4. CONC —— 并发索引策略（用户方案 3）

### 4.1 用户的原始提案与本轮的裁剪

| 用户提案 | 本轮结论 |
|---|---|
| ① 整个 Workbench 只在一个工作区里启用语义分析 | **已是现状**（§1.4），本轮只做 WS-01/02/03/04 的生命周期修正 |
| ② 切工作区时新工作区默认不开启，可手动开启；开启后旧工作区自动关闭 | **方向正确，当前是 broken**（§1.3）⇒ **拆成两条**：WS-01（旧的自动关闭）+ **WS-04**（新的默认不开启，可手动开启并记住）—— 后者因为 L2 的落地已经有落点了（§2.4） |
| ③ 同一工作区内允许多个代码仓同时开启索引，内存逼近阈值时最近不活跃的自动让步退出 | **方向合理，但有前提** ⇒ 本轮落地**宿主侧的预算与退让能力**（CONC-03/04 + MEM-08/12），**多客户端并发本身**留给下轮（CONC-02） |

### 4.2 CONC-01（P0）前置判定：这些"仓库"是不是独立语言项目

**这是 ③ 的生死线。** pnpm workspace / turbo / tsconfig `references` 的多包，在 tsserver 看来**本来就是同一个 program**（或可以合并成一个）。起两个服务器 = **同一批文件被索引两遍**：

- 内存翻倍（两个 tsserver 各持一份 symbol table）；
- 两个 program 的推断结果可能不一致（一个按 configured project、一个按 inferred project）；
- 用户在 A 里跳转到 B 的符号，B 那边可能没有这个符号。

**要求**：在同一工作区内准备并发索引时，宿主先做一次**归属判定**：

1. 两个 root 若共享同一个 `tsconfig.json` / `jsconfig.json`，或存在 `references` 关系 ⇒ **合并成一个 program**（`indexScope: 'root'`），**不得**起两个服务器；
2. 只有**语言与配置都独立**的 root，才允许并发。

**改哪里**：`src/host/lsp.js:756` `scopeRootOf` 旁边增加一个 `programKeyOf(root)`（返回 program 的唯一标识），并发判定按 `programKey` 去重。

> **复核后的一条好消息**：L4 把握手归宿主所有（`entry.handshake`）之后，**"这个 root 到底建的是哪个 program"只有一个权威来源**（宿主记录的那份握手）⇒ `programKeyOf` 可以直接从握手里的 `rootUri` 推导，不必再去猜。

**验收**：一个含 3 个 package 的 pnpm workspace，只产生 **1** 个 tsserver 进程树。

**风险**：中。判定错误的代价是"少索引了一个包"（用户会看到跳转失败）。

### 4.3 CONC-02（P3，下一轮）客户端多 LSP 客户端架构

**现状**：`currentClient` / `currentTransport` / `sessionRoot` / `editorViews` 全是模块级单例（`src/client/lsp-session.js:143-207`）。一个 `@codemirror/lsp-client` 绑定一个 CodeMirror 状态 + 一条 WebSocket。

**下轮要做的事**：

| # | 要求 |
|---|---|
| 1 | per-root 的 client / transport / 文档路由表（当前是单例） |
| 2 | 文件 → root 的归属判定，按 `scopeRoot`（**不是** workspace root） |
| 3 | 一个 tab 跨 root 时的归属（monorepo 里同一文件被两个 root 覆盖） |
| 4 | 每个 root 独立的健康度 / 重启预算 / 状态机视图 —— **L3 已经把"宿主健康"抽成了 `LSP_HOST_HEALTHY_STATES`（`src/client/lsp-session.js:115`），多客户端时按 root 复制它** |
| 5 | 状态栏从"一个语义状态"改成"当前 root 的语义状态 + 工作区级摘要" |
| 6 | **⚠️ 前置条件（X2，§4.4）**：多客户端下，每个客户端都会随时唤醒自己的 root ⇒ **LRU 退让失效**。必须同时引入「本次会话不再自动唤醒」或「退让时同时放弃客户端会话」的显式状态，否则 CONC-03 的退让机制在多客户端下是假的 |

**为什么放下一轮**：这不是加开关，是客户端会话模型的替换；与 MEM-05~12 的宿主侧改造正交，先把宿主侧的预算与退让做扎实（它们对单客户端同样有效），再上多客户端。

### 4.4 CONC-03（P1）LRU 退让规则

**退让顺序**（从"最先被让位"到"最后"）：

| 优先级 | 会话 | 理由 |
|---|---|---|
| 1（最先让位） | 无未完成语义请求 + 非焦点 root + 非构建中 + 空闲最久 | 真正用不到 |
| 2 | 有在途请求但已超时 | 请求已经死了 |
| 3 | 焦点所在 root | **最后才动**，动它会打断用户 |
| 4 | 构建 program 中（`buildingProgram`） | **永不**让位 |

**关键坑**：空闲定时器在构建 program 期间**不装**（IDLE-04，`src/host/lsp.js:2892`）⇒ 一个正在构建 10 分钟的大项目在"最后活跃时间"上看起来**最闲** ⇒ **它恰恰是最不该被踢的那个**。⇒ **LRU 键必须显式排除 `buildingProgram` 状态**。

**"焦点所在"怎么定义**：客户端的编辑器焦点（当前打开的 tab 所属的 root）。宿主拿不到焦点 ⇒ 焦点信息必须由客户端通过控制事件传给宿主（`src/host/lsp.js` 的 `attachSink` / control 通道已有这条链路）。

**"有在途请求"怎么定义**：宿主已有的 `session.pendingRequests`（`src/host/lsp.js:2067`）。

**改哪里**：`src/host/lsp.js:2877-2892`（空闲/压力定时器）与 `#checkMemoryPressure`（`:2931`）。

#### ⚠️ 一个会让整个 LRU 失效的前提（X2，第六轮 R6-4）

**宿主释放服务器时，客户端会话不会被拆。**

| 事实 | 依据 |
|---|---|
| `sessionWanted()` 只看**决策与设置**，不看 `store.state.lsp.state` | `src/client/lsp-session.js:1061` |
| `refreshLsp()` 在 `key === sessionKey` 处**直接返回**，宿主状态变化不触发它 | `src/client/lsp-session.js:1537` |
| 宿主释放后，客户端的下一个语义请求会**唤醒**服务器（IDLE-02） | `src/host/lsp.js` `#requestWake`（`:1467`） |

⇒ **"让位退出"释放的是进程，不是会话**。而**只要客户端还对那个 root 发过语义请求，它就会被立刻唤醒** ⇒ **退让形同虚设**：LRU 把 A 踢了，用户下一次在 A 里按 F12，A 又起来了（还要重建 program，代价 10 分钟），内存照样涨回去。

⇒ **LRU 退让只有在「客户端不再请求那个 root」时才是真的退让**。当前架构里这天然成立 —— **客户端同一时刻只连一个 root**（§1.4），其余 root 本来就没有客户端在说话 ⇒ 它们不会自己醒。

⇒ **因此：LRU 退让的有效性依赖「客户端单会话」这个前提。一旦 CONC-02（多客户端）落地，每个客户端都会随时唤醒自己的 root，退让将失效，必须重新设计**（例如：退让时**同时**让客户端放弃该 root 的会话，或引入「本次会话不再自动唤醒」的显式状态）。

**这条必须写进 CONC-02 的前置条件**（§4.3 要求 5）。

**风险**：中。退让顺序错了会打断用户 ⇒ 必须先有 CONC-01 的 program 去重，否则 LRU 会在"同一个 program 的多个 root"之间乱踢。

### 4.5 CONC-04（P1）退让是 `suspended`，不是 `degraded`

**现状**：空闲释放走 `#exitIdle`（`src/host/lsp.js:2949-2957`），状态是 `suspended` —— 上一轮 VIS-01 已经把"主动回收"与"故障"分开了。

**要求**：MEM-12 的压力退让与 CONC-03 的 LRU 退让**也必须**走 `suspended`，不得复用 `degraded`（`degraded` 的语义是"出故障了"，且 `RETRYABLE_DEGRADE_CAUSES` 会影响自动唤醒行为）。

**文案**：「语义分析：已让出内存（机器内存紧张）」，灰色调，与 VIS-01 的「已休眠（省内存）」区分开。

### 4.6 CONC-05（P2）「已索引」徽章双态

**现状**：`indexedRoots` 记的是**历史事实** —— 「这个 root 完成过一次首建」（`src/host/settings-defaults.js:112-113`）。进程被回收后徽章仍为「已索引」，但实际没有服务器；用户点【重新建立索引】要走一次完整构建。

**要求**：区分两种状态：

| 状态 | 含义 | 徽章 |
|---|---|---|
| `indexed` | 完成过首建，**且**当前有服务器在跑 | 已索引 |
| `indexed·suspended` | 完成过首建，服务器已回收 | 已索引（已回收） |

**改哪里**：`src/host/lsp.js:1305-1320` `indexedRoots()` + `src/client` 的徽章渲染。

---

## 5. 设置项与 API 变更

| 项 | 变更 | 默认 | 说明 |
|---|---|---|---|
| `lsp.memoryLimitMB` | **语义扩展** | `2048` | 由「所有语言的无条件上限」改为「单语言上限的全局上限」；配合 MEM-11 的分档，实际值取 `min(分档值, 全局值)` |
| `lsp.memoryHeadroom` | 不变 | `1.5` | 需求侧的系数 |
| `lsp.memoryHardFloorMB` | 不变 | `256` | 硬地板 |
| `lsp.idlePolicy` | **新增取值** `always` | `after` | `always` = 既按空闲退出，也在压力下退让（MEM-12 落地后压力退让其实**默认开**，此值用于显式关闭压力退让） |
| `lsp.budgetRatio` | **新增** | `0.25` | 机器级总预算占总内存的比例（MEM-08） |
| `lsp.budgetCapMB` | **新增** | `4096` | 机器级总预算的绝对上限（MEM-08） |
| `lsp.maxConcurrentIndexes` | **新增** | `0`（不限制） | 0 = 由机器级预算决定；>0 时取更严者（CONC） |

**API 变更**（宿主 `src/index.js` 的 LSP 路由）：

| 路由 | 变更 |
|---|---|
| `lsp.resources` | 快照新增 `worstCaseBytes`、`budgetBytes`、`budgetUsedBytes`、`measuredBytes` 四个字段 |
| `lsp.shutdown` | **不变**，但 WS-02 要求调用方在切换前 **await** 它 |
| `lsp.start` | `force` 的语义收窄（MEM-10）：预算用尽时 `force` 也不放行 |

---

## 6. 验收

### 6.1 逐条验收（可执行）

| 条目 | 验收步骤 | 通过标准 |
|---|---|---|
| WS-01 | A 工作区开启语义分析 → 切到 B 工作区 | 2 秒内宿主进程表里 A 的 tsserver 消失；`lsp.resources.reservedBytes` = 0 |
| WS-02 | 切项目（A/repo1 → A/repo2），同时盯着 `lsp.resources` | 新服务器的判定发生在旧服务器退出**之后**；不存在两个进程同时在跑的窗口 |
| WS-03 | 打开 4 个工作区，来回切 | 被换下的工作区状态栏不再显示「语义分析：就绪」 |
| MEM-05 | 复现 P7b：free 2648 / used 606 | `available = 1206 MB`，decision = `ok` |
| MEM-06 | 起一个真实 TS 索引，观察 `used` | `used` 落在 363–606 MB 区间；噪声场景下退回 434 MB 且有日志 |
| MEM-07 | 诊断面板 | 同时显示「典型」与「最坏」两个数 |
| MEM-08 | 16 GB 机器连续开索引 | `Σ ceiling ≤ 4096 MB`，超了就停 |
| MEM-09 | 触发一次内存紧张 | 弹窗、宿主 detail、诊断面板、设置页**四处的「可用」是同一个数** |
| MEM-10 | 对某项目点一次「仍然启动」，等内存再次紧张 | 再次**询问**，不静默强启 |
| MEM-11 | 小项目 / 大项目 | 上限分别是 1024 / 2048；大项目仍可手动指定 2048 |
| MEM-12 | 压到硬地板以下 | 最不活跃的服务器被释放，状态是 `suspended`，机器内存回升 |
| CONC-01 | 一个含 3 package 的 pnpm workspace | 只产生 **1** 棵 tsserver 进程树 |
| CONC-03 | 制造内存压力 | 退让顺序符合 §4.4；构建中的项目**不被**让位 |
| CONC-04 | 退让发生 | 状态栏灰色「已让出内存」，不是黄色故障态 |
| CONC-05 | 手动回收一个索引 | 徽章变成「已索引（已回收）」 |

### 6.2 回归红线

以下**不得**因本轮改动而回退：

| 项 | 红线 |
|---|---|
| 宿主存活 | 语言服务器被 SIGKILL 后宿主**不崩**（上一轮 §2.3 实测） |
| 降级链 | 崩溃 → 自动重启 1 次 → 再崩 → `degraded`（上一轮 §2.3） |
| 启动取消 | 取消后**无残留**语言服务器进程 |
| 协议 | 宿主主线程**不解析**任何 LSP 载荷（全部在 worker 里） |
| 客户端单会话 | 本轮**不引入**多客户端（CONC-02 留下一轮） |

---

## 7. 里程碑与工作量

| 里程碑 | 条目 | 依赖 | 产出 | 预估 |
|---|---|---|---|---|
| **M0** | MEM-09 | 无 | **七处**界面与文案数字同源（宿主内部两套口径合并） | 0.4 人天 |
| **M1** | WS-01 / WS-02 | M0 | 切工作区不再留僵尸服务器；切换顺序化 | 0.5 人天 |
| **M2** | WS-04 | M1 | 工作区级默认态持久化；新工作区默认基础模式 | 0.5 人天 |
| **M3** | MEM-06 / MEM-05 | M1 | 预留额改为「上限 − 实测」；差值法测量 + 退路 | 1 人天 |
| **M4** | MEM-12 / CONC-03 / CONC-04 | M3 | 压力阀默认开 + LRU 退让 + `suspended` 语义 | 1 人天 |
| **M5** | MEM-08 / MEM-07 | M4 | 机器级预算 + 两档判定与两档显示 | 0.8 人天 |
| **M6** | MEM-10 / MEM-11 | M5 | force 记忆收窄 + 上限分档 | 0.8 人天 |
| **M7** | CONC-01 / CONC-05 | M6 | program 去重 + 徽章双态 | 0.8 人天 |
| **M8** | WS-03 | M7 | 非活动 store 不持有会话 | 0.3 人天 |

> **CONC-02（多客户端并发）单独立项**，预估 ≥ 3 人天，不在 M0–M8 内。
>
> **与新基线的关系**：M6 的 `force` 硬地板部分已由 L1/P2-3 预先完成（§0.5）；M2 因 L2/L7 的落地而**新增**（原先混在 WS-01/03 里）；MEM-10 因 L7 多了一条传染路径，工作量由 0.5 升到 0.8 人天。总计约 **6.4 人天**。
>
> **两包分叉的处理**：本轮所有实施都必须在 `dsh-ide-workbench`（`238668e`）上做，随后同步到 `dsh-ide-workbench-web`（`605ad1d`）—— **web 变体缺 L1（force 语义）、L2（决策显式化）、L7（恢复路径）三次提交**，若不同步，MEM-10 与 WS-04 在 web 变体上无法验收。

### 7.1 实施时的测试基线

| 项 | 基线值 | 出处 |
|---|---|---|
| `npm test` | **911 / 911 通过 / 0 失败** | 第八轮 §5 实跑 |
| `dist/client.js` | **2,960.8 KiB**（重建后 `git status` 无变化 ⇒ 产物与源码逐字节一致） | 第八轮 §5 |
| 闸门行为的回归用例 | `tests/lsp-memory-gate.test.mjs`（15 条） | L6 |
| 决策与恢复路径的回归用例 | `tests/store-lsp-decision.test.mjs`、`tests/lsp-session-decision.test.mjs` | L6 |

**要求**：本轮改算式（MEM-05/06/08）后，**`tests/lsp-memory-gate.test.mjs` 必须逐条重跑并按新语义改写** —— 它锁的是**旧**算式（预留额＝上限），不改它就会红；**不要为了让测试变绿而放宽断言**，要按新语义重写期望值。

---

## 8. 风险

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| 1 | `used_i` 的差值法有噪声，算错会低估 `headroom_i` ⇒ 真的 swap | **高** | 噪声区间作废并退回基线；M2 必须带真实 tsserver 的回归 |
| 2 | MEM-11 上限分档错误 ⇒ 大项目建不起索引（OOM exit 134） | **高** | 保留 2048 MB 手动覆盖入口；分档只降不升 |
| 3 | MEM-08 总预算过紧 ⇒ 并发数被砍到 1 | 中 | `budgetRatio` / `budgetCapMB` 可配；默认 25% / 4 GB 对 16 GB 机 = 4 GB ≈ 4 个 TS 索引的上限 |
| 4 | CONC-03 的 LRU 踢掉焦点 root，打断用户 | 中 | 焦点信息由客户端上报；焦点 root 排在倒数第二位 |
| 5 | WS-02 的 await 增加切项目延迟 | 中 | 只 await `lsp.shutdown` 一次往返；失败不阻塞 |
| 6 | CONC-01 的 program 判定误判 ⇒ 少索引一个包 | 中 | 判定保守：拿不准就合并（少一个索引好过两个重复索引） |
| 7 | 本轮改的算式让闸门变松 ⇒ 真的把机器推进 swap | 中 | MEM-08 总预算 + MEM-12 压力阀是两道**兜底**，不能因为 MEM-05 变松就省掉它们 |
| 8 | **LRU 退让是假的**（X2）：宿主释放服务器后，客户端会话不拆，下一个语义请求立刻唤醒它 ⇒ 内存刚释放就涨回去 | **高** | 退让只针对**客户端当前不用的** root（单客户端架构下天然成立）；CONC-02 多客户端落地前必须先解决（§4.3 要求 6） |
| 9 | **`'always'` 两套语义**（X3）：决策路径与恢复路径的来源不同 ⇒ 同一份设置在两条路径上表现不一致 | 中 | WS-04 要求 4：决策区分「用户决定的」与「策略推导的」 |

---

## 附录 A —— 复现方法

**探针**：`artifacts/perf-probe-2026-11-01/p7-reservation-accounting.mjs`

```powershell
node artifacts/perf-probe-2026-11-01/p7-reservation-accounting.mjs
```

| 场景 | 探针段落 | 复现的现象 |
|---|---|---|
| 第一个索引 | P7a | `reserved=0 available=2648 decision=ok` |
| **用户的场景** | **P7b** | `reserved=2048 available=600 decision=tight`；三模型对照 A 600 / B 1206 / C 2042 |
| 16 GB 机器并发 | P7c | 第 2 个索引 `available=1198` → `tight` |
| 8 GB 机器并发 | P7d | 第 2 个索引 `available=0` → `low`（硬拒） |
| 同 root 重复请求 | P7e | 幂等，不重复 spawn |
| **切工作区** | **P7f** | 今天：`tight → degraded`；补 shutdown 后：`ok → building` |

**探针纪律**：只从仓库 import，不修改仓库任何文件；`ROOTS` 是模块级 Map，**每个场景必须先 `shutdownAll()` 并使用独立 root 前缀**，否则场景之间会互相污染（第一版探针就踩过这个坑：跨场景复用了同一 root，导致新 manager 拿到旧 manager 的 session，预留额统计为 0）。

> ✅ **探针已在 `1dbc238` 上重跑（2026-11-01 20:32）**：P7a–P7f 的**全部输出与 `4b8af00` 基线逐位一致**（`available` 600 / 1198 / 0，三模型 600 / 1206 / 2042，P7f 的 `tight → degraded` vs `ok → building`）。⇒ **这两次提交没有改变闸门算式的任何可观测行为**，§1.2 的数字继续有效。

---

## 附录 B —— 数字速查

| 量 | 值 | 出处 |
|---|---|---|
| TS 单索引实测占用 | 363 MB（小）/ 434 MB（中）/ 606 MB（大） | 实测报告 §2.1 |
| 3 个并发索引实测 | 1,347 MB（每个 449 MB） | 实测报告 §2.1b |
| TS 估算基数 `memoryBaselineMB` | 434 MB | `src/host/lsp.js:69` |
| TS 上限 `memoryLimitMB` | 2048 MB | `src/host/lsp.js:68` |
| 需求 `needMB` | 651 MB（434 × 1.5） | `src/host/lsp.js:1861` |
| 软阈值 | 1302 MB（651 × 2） | `src/host/lsp.js:1867` |
| 硬地板 | 256 MB | `src/host/lsp.js:154` |
| 空闲超时 | 600000 ms（10 分钟） | `src/host/settings-defaults.js:71` |
| `idlePolicy` 默认 | `'after'` ⇒ **压力阀不装** | `src/host/settings-defaults.js:82` |
| `indexScope` 默认 | `'auto'`（未变） | `src/host/settings-defaults.js:92` |
| `StoreCache` 上限 | 3 个 store | `src/client/index.jsx:296` |
| 压力检查间隔常量 | 250 – 30000 ms | `src/host/lsp.js:258-263` |
| 决策记忆容器 | `lspIndexDecisions`（Map，**per-store，内存态**） | `src/client/store.js:545` |

---

## 附录 C —— 与既有文档的关系

| 文档 | 关系 |
|---|---|
| `PRD-v5-改造需求.md` MEM-02 | **修订**：规格允许「预留额账本」，但额度应取实际 RSS 或（上限 − 实测），不是上限本身 |
| `PRD-v5-改造需求-实施进展.md` §3.1 | **沿用**：standby 不扣除的实测结论不翻案 |
| `PRD-v5-改造需求-实施进展.md` §3.6 | **修订**：预留额取上限的取舍，其「最坏情况」论证不成立（§0.2） |
| `PRD-v5-改造需求.md` VIS-01 | **沿用**：`suspended` 的语义，本轮扩展到压力退让与 LRU 退让（CONC-04） |
| `PRD-v5-改造需求.md` IDLE-02 | **沿用**：释放后首个语义请求自动唤醒，是退让之后体验不塌的关键 |
| `PRD-v5-改造需求.md` IDLE-04 | **沿用并升级**：构建期不装空闲定时器 ⇒ LRU 必须显式排除构建中（CONC-03） |
| `PRD-v5-改造需求.md` CRASH-01 / CRASH-02 | **沿用**：降级链不动 |
| `PRD-v5.md` §2.6 / §2.7 | **沿用**：唤醒自启与降级可见性的验收条款 |
| `代码索引内存配置.md` | **需同步更新**：上限分档（MEM-11）与机器级预算（MEM-08）会改变用户侧的配置说明 |
| **本轮基线的三次提交**（`8e0ed73`、`1dbc238`、`238668e`） | **已被本文件吸收**：L1–L7 见 §0.5。`force` 的硬地板语义、决策显式化、握手归属、恢复路径四件事**已落地**，本文件只做剩余部分，不重做 |
| `PRD-v5-代码检视报告-第六轮.md`（`605ad1d` + `8e0ed73` 复核） | **已吸收**：P1-1 → L4、P1-2 → L2、P2-3 → L1、R6-2/R6-3 → L5、R6-5 → L3；**R6-4 的结论（释放 ≠ 拆会话）→ X2**，它是 CONC-03 的前提 |
| `PRD-v5-代码检视报告-第七轮.md`（`1dbc238` 复核） | **已吸收**：R7-1 → L7；**「决策与起服是两条独立路径」的根因 → X1**（WS-01 的根因） |
| `PRD-v5-代码检视报告-第八轮.md`（`238668e` 复核） | **已吸收**：§0.3 明确声明 WS-01/WS-02、MEM-10、WS-04 **由本规格负责、不在检视报告里重复**；§4 要求的「基线改 `238668e` + §0.5 补一行」**已完成** |
| `PRD-v5-改造需求-实施进展.md`（待建） | **建议本轮单独建一份 `PRD-v5.1-实施进展.md`**：本轮实施量约 6.4 人天、跨 9 个里程碑，需要独立的实施记录（含偏差决策），不要塞进上一轮的实施进展 |
