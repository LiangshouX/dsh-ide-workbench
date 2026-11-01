# PRD-v5.1 代码检视报告（第一轮：`b3e62c5` + `666065b` 实施复核）

> **范围**：`238668e` → `666065b`（2 个提交：`b3e62c5`「count what a language server may still grow into」+ `666065b`「keep the memory numbers and make "basic mode" mean it」）。改动 32 个文件，+8010 / −459。
> **基线**：`238668e`。**对照物**：`docs/prd/v5.1/PRD-v5.1.md`（规格，只读）、`docs/prd/v5.1/PRD-v5.1-实施契约.md`（跨模块接口约定）、`docs/prd/v5.1/PRD-v5.1-实施进展.md`（实施记录）。
> **方法**：读代码 + **实跑验证**。`npm test` 实跑 **1010 项 / 1010 通过 / 0 失败**；六个自建探针（写在 `%LOCALAPPDATA%\Temp\`，**不在仓库内**）分别复验：多会话下的差值法记账、`decision` 与 `tight` 的一致性、快照刷新条件、宿主与客户端的「基础模式」判定、握手丢失与重试、分段耗时。
> **本次检视未修改任何源码**，本文件是本轮唯一产物。
> **检视日期**：2026-11-01。
> **重点关注**：① `reservedBytes` 语义破坏性变更之后，**所有读它的地方**是否都按新语义理解；② 差值法（MEM-06）在多会话下是否可信；③ 判定档位与预算在启动 / 重启两条路径上是否一致；④ WS-02 的新顺序是否引入了新的等待或竞态；⑤ 用户新报的现象「语义分析：正在连接」耗时极长的根因。

---

## 0. 结论

### 0.1 一句话

**单会话场景成立、用户原症状已消除（`free 2648 / 实测 606 ⇒ available 1206` 复现通过），但本轮引入了 4 条可动作缺陷：其中 2 条高危（多会话下差值法把同一段内存增长重复计数，闸门虚高约 1.9 GB；`decision` 与 `tight` 对同一快照给出相反答案），1 条让本轮新增的「实测占用 / 最坏档」在诊断面板上永久冻结，1 条让用户点过【重新建立索引】之后语义功能再也醒不过来。另挖出「语义分析：正在连接」耗时极长的根因——握手在起服窗口内被永久丢弃且客户端重试无法自救，状态栏最长卡 126 秒；该缺陷早于本轮，但本轮的 WS-02 顺序改动把它的暴露面放大了。**

**本轮新发现：6 条**（4 条缺陷 + 2 条低危），**另附 3 条文档不同步**。

### 0.2 本轮新发现

| 编号 | 严重度 | 缺陷 | 位置 | 状态 |
|---|---|---|---|---|
| **A1** | **高** | 多会话并发时，差值法把同一段机器内存下降**按会话各算一次** ⇒ `measuredBytes` 虚高 2.2 倍、`reservedBytes` 虚低、`availableBytes` 虚高约 1.9 GB | `src/host/lsp.js:3542-3560` | 本轮引入 |
| **A2** | **高** | `decision` 与 `tight` 对**同一快照**给出相反答案 ⇒ 客户端弹「内存紧张」要用户决定，宿主自己却会直接启动；用户选「基础模式」还会被**永久持久化** | `src/host/lsp.js:2697-2699` / `:2722`，`src/client/store.js:1461-1463`，`src/client/SettingsPanel.jsx:778` | 本轮引入 |
| **A3** | 中 | 客户端快照的刷新条件漏掉本轮新增字段 ⇒ 诊断面板的「已预留 / 最坏情况」在索引构建期间**冻结** | `src/client/store.js:2630-2638` | 本轮引入 |
| **A4** | 中 | 宿主与客户端对「基础模式」用**两个标记且优先级相反** ⇒ 点过【重新建立索引】后服务器**再也醒不过来** | `src/host/lsp.js:2267-2274` ↔ `src/client/store.js:1621-1628` / `:1999-2023` | 本轮引入 |
| **A5** | 低 | 设置页允许把「内存占比」填 0，宿主当非法值回退成 0.25，且无任何提示 | `src/client/SettingsPanel.jsx:648-650` ↔ `src/host/lsp.js:2581-2583` | 本轮引入 |
| **A6** | 低 | 三处注释与实现相反（其中一处仍写着旧语义的 `reservedBytes`） | `src/client/Workbench.jsx:442-445` 等 3 处 | 本轮引入 |

**另挖出（非本轮引入，但与本轮 WS-02 叠加）**：

| 编号 | 严重度 | 现象 | 位置 |
|---|---|---|---|
| **B1** | **高** | 握手在「起服窗口」内被**永久丢弃**，客户端重试也救不回来 ⇒ 状态栏最长 **126 秒**「正在连接」 | `src/host/lsp.js:3245-3310` + `:3710-3716`，`src/host/lsp-worker.js:440-461` |
| **B2** | 中 | 切换路径新增的同步等待把「正在连接」整体后移（宿主 `lsp.shutdown` 要等进程真死：实测 56 / 351 / 1207 ms） | `src/client/lsp-session.js:1684-1697`，`src/client/store.js:1267-1270` |
| **B3** | 说明 | 「正在连接」= **握手未回**，不是「服务器在构建索引」 | `src/client/Workbench.jsx:613` |

### 0.3 总体判断

**这一轮把「算式」改对了，但「算式在多会话下是否成立」与「改掉语义之后所有读它的地方是否都改过来了」这两件事没有一起做完。**

三条值得肯定的地方：

1. **MEM-05 的方向完全正确**：把「预留额 = 上限」改成「预留额 = 上限 − 实测占用」，用户原症状（2648 MB 空闲、一个索引实测 621 MB、闸门说资源不足）确实消失了，P8 探针输出与规格一致。
2. **断言语义没有被为了让测试变绿而放宽**：`tests/lsp-memory-gate.test.mjs` 按新语义逐条重写（契约 §6 的硬要求），新增 10 个测试文件覆盖 MEM-05/06/08/11/12、WS-01/02/04、CONC-01/03/05。`npm test` 1010/1010 全绿。
3. **MEM-10 的语义改对了**：`memoryWarnedRoots` 不再被写成 `'accepted'`，旧的 `'accepted'` 按 `'conservative'` 退化处理，`force` 的作用域被限定在当次启动。

**但三条高危的共同点是同一个**：`reservedBytes` 从「上限」变成「余量」之后，**记账的输入变了、记账的口径也变了，而读这份账的三个地方（宿主闸门、客户端弹窗、设置页）没有全部改到同一套口径上**。A1 是记账本身在多会话下不成立，A2 是宿主内部两个字段自相矛盾，A3 是客户端的刷新条件没跟着换。

---

## 1. 本轮引入的缺陷

### A1【高】多会话并发时差值法把同一段内存增长重复计数，闸门虚高约 1.9 GB

**触发条件**：同时运行 ≥ 2 台语言服务器，且服务器在构建索引期间增长内存（本轮最核心的场景：多仓工作区 / pnpm workspace）。

**机制**：`#remeasure` 让**每个会话各自维护一份 `lastFreeBytes`**，并把**全局**空闲内存的差值加到**自己**头上：

```js
// src/host/lsp.js:3549-3558
const free = this.#freeBytes()
const previous = session.lastFreeBytes      // ← 每个会话各存一份
session.lastFreeBytes = free
const delta = previous - free                // ← 全局差值
if (delta <= MEASURE_NOISE_MAX_MB * 1024 * 1024) { …保持上次有效值…; return }
session.measuredBytes += delta              // ← 加到自己头上
```

两台会话的测量窗口重叠时，**同一段机器内存下降被各算一次**。而 `reservedBytes = Σ(ceiling_i − measured_i)`，所以 `Σmeasured` 虚高 ⇒ 预留额虚低 ⇒ `availableBytes` 虚高。

**探针实测**（生产 `LspManager` + 测试替身；机器 8000 MB → 6500 MB，真实占用 1500 MB）：

| | 真实 | 闸门实际用的 |
|---|---|---|
| `measuredMB` | 1500 | **3368** |
| `reservedBytes` | 2596 MB | **728 MB** |
| `availableBytes` | 3904 MB | **5772 MB** |

（`measuredMB` 3368 = 两个会话各以 434 MB 基线起步，再各自把重叠窗口的差值加了一遍。）

**后果**：

- MEM-05 的预留额被严重低估 ⇒ **`availableBytes` 虚高近 1.9 GB**；
- **MEM-08 的整机预算与 MEM-12 的压力阀在多索引场景下同时失效**——而这两条需求存在的理由恰恰就是「多台服务器同时长到各自上限」；
- `measuredMB` 本身是错的，而诊断面板直接显示它。

**最小修复方向**：把测量基线提升到 **manager 级**——全局只保留一次基线读数与一次当前读数，差值只算一次；或：仅当「本窗口内没有其他会话发生变化」时才把 delta 归给某个会话（需要在 manager 上维护一个全局的 `lastGlobalFree`）。

**位置**：`src/host/lsp.js:3542-3560`（`#remeasure`）、`:3505-3520`（`#measureFootprint`）

> **注**：现有 6 条用例（`tests/lsp-memory-measure.test.mjs`）全部是**单会话**场景，所以这条缺陷没有被守住——不是断言被放宽，是覆盖面本来就没有多会话。

---

### A2【高】`decision` 与 `tight` 对同一快照给出相反答案

**触发条件**：`available ≥ soft_j` 但 `available − ceiling_j < hardFloor`。
（TS 大项目：need 651 / soft 1302 / floor 256 / ceiling 2048 ⇒ **available 落在 [1302, 2304) 这个区间**，并不罕见。）

**机制**：本轮给 `decision` 加了最坏档分支，但 `tight` 没跟着改：

```js
// src/host/lsp.js:2697-2699 —— 宿主发布的「权威答案」
const decision = availableBytes < hardFloorBytes
  ? 'low'
  : (availableBytes < softThresholdBytes ? 'tight' : (worstCase ? 'tight' : 'ok'))

// src/host/lsp.js:2722 —— 宿主自己的闸门读的是这个
tight: availableBytes >= hardFloorBytes && availableBytes < softThresholdBytes,
```

**探针实测**（available = 2000 MB）：

```
availableMB = 2000   needMB = 651   softMB = 1302   hardFloorMB = 256
ceilingMB   = 2048   worstCase = true   worstCaseMB = -48
decision    = tight     ← 客户端据此弹窗
tight       = false    ← 宿主据此直接启动
```

**后果**：

- 客户端 `src/client/store.js:1461-1463` 读 `decision` ⇒ 弹「内存紧张」；而宿主 `src/host/lsp.js:3146` 读 `tight` ⇒ **本来会直接启动**。这正是本轮注释里写明「绝不能发生」的那件事：*「两个对同一快照判断不同的两侧，会给用户两个不同的答案」*。
- 弹窗文案自相矛盾：「可用 2000 MB、需要 651 MB、推荐 1302 MB」——数字明明够用，却问用户要不要继续。
- 用户若选「使用基础模式」，`#decideIndex` 返回 `{ choice: 'conservative', remember: 'both' }`（`store.js:1495`）⇒ **被持久化**成 `workspaceDefaults[path] = 'conservative'` ⇒ 该项目从此长期停在基础模式，而它本来根本不需要问。
- 第三处不一致：设置页 `src/client/SettingsPanel.jsx:778` 读的是 `tight` ⇒ **同一个快照，设置页显示「可启动」，弹窗说「内存紧张」**。

**最小修复方向**：契约 §2 写明「最坏档**不硬拒**，只如实报出」，这条必须落在**一处**。二选一：

- **方案 A**：让 `tight` 也纳入最坏档（即 `tight` 与 `decision` 恒等），并同步决定宿主闸门是否拒绝——但这会与「最坏档不硬拒」冲突；
- **方案 B（推荐）**：`decision` 保持纯报告（`ok` / `tight` 只由典型档决定），最坏档单独由 `worstCase` 字段承载，客户端据此**加一行提示**而不是弹窗。这样宿主闸门与客户端读的是同一套口径。

**位置**：`src/host/lsp.js:2697-2699` 与 `:2722`；`src/client/store.js:1461-1463`；`src/client/SettingsPanel.jsx:778`

---

### A3【中】客户端快照的刷新条件漏掉了本轮新增字段 ⇒ 诊断面板的「已预留 / 最坏情况」在索引构建期间冻结

**触发条件**：服务器增长。而这**必然发生**：本轮新增的 MEM-06 就是为了让「服务器长大后余量变小」被看见。

**机制**：`free` 降 Δ、`reserved`（= 上限 − 实测）也降 Δ ⇒ **`availableBytes` 恰好恒定**。而 `memoryChanged` 只比较四个字段：

```js
// src/client/store.js:2630-2637
const memoryChanged = resources === null
  ? false
  : (known === null
    || Math.round((known.availableBytes ?? …) / MB) !== Math.round((resources.availableBytes ?? …) / MB)
    || known.needMB !== resources.needMB
    || known.canIndex !== resources.canIndex
    || known.tight !== resources.tight)
```

**探针实测**（机器 8000 → 7400 MB，服务器涨了 600 MB）：

```
availableBytes : 6386 MB   ← 前后完全相同（free 降 600，reserved 降 600）
needMB / canIndex / tight : 均未变化
measuredMB     : 434 → 1034 MB
reservedBytes  : 1614 → 1014 MB
worstCaseBytes : 4338 → 3738 MB
```

**后果**：快照不被替换 ⇒ **面板上的「已预留」和「最坏情况」永久停在初始值**（显示 1614 MB，真实 1014 MB）。MEM-06 的复测在界面上完全看不到——本轮新增的三个字段中，恰好是这三个不更新。

**最小修复方向**：比较条件补上 `measuredBytes`（或直接比较 `reservedBytes`）与 `worstCaseBytes` / `budgetUsedBytes`；或改成「任一展示字段变化就替换」。

**位置**：`src/client/store.js:2630-2638`

> **注**：基线比较的是 `freeBytes`（服务器增长时会变）⇒ **这是本轮换成 `availableBytes` 时引入的回归**。

---

### A4【中】宿主与客户端对「基础模式」用两个标记、且优先级相反 ⇒ 点过【重新建立索引】后服务器再也醒不过来

**触发序列**：

1. 用户在内存紧张弹窗里选「使用基础模式」⇒ `#decideIndex` 返回 `remember: 'both'` ⇒ **同时**写 `workspaceDefaults[path] = 'conservative'`（`store.js:1353-1355`）**和** `memoryWarnedRoots[path] = 'conservative'`（`store.js:1356-1358`）；
2. 之后点【重新建立索引】⇒ `restartLsp()`（`store.js:1999-2023`）**只**写 `workspaceDefaults[path] = 'build'`，**不清** `memoryWarnedRoots`。

**机制**：两侧读的是两个不同的标记，且优先级相反——

| 侧 | 读取顺序 | 结果 |
|---|---|---|
| 客户端 `lspIndexDecision`（`store.js:1621-1628`） | `workspaceDefaults` **优先**于 `memoryWarnedRoots` | 「要索引」 |
| 宿主 `#isConservative`（`lsp.js:2267-2274`） | **只**认 `memoryWarnedRoots` | 「基础模式」 |

**探针实测**（两个标记冲突的设置）：

```
lsp.start  →  正常起服（1 个进程，状态 building）
服务器被释放后发一个 payload  →  进程数仍是 1，状态停在 idle   ← 没有被唤醒
```

**后果**：宿主 `#wakeSession` 在 `#isConservative` 处直接 return ⇒ **空闲退出（10 分钟）/ 压力释放之后，语义功能永久失效**，而界面上项目是「已开启索引」的状态。用户只能再点一次【重新建立索引】。

**最小修复方向**：宿主改读本轮新增的权威标记 `lsp.workspaceDefaults`（`conservative` 即基础模式）；**或** `restartLsp()` 同步清除 `memoryWarnedRoots` 的对应条目。二选一即可，但不能两侧各读各的。

**位置**：`src/host/lsp.js:2267-2274` ↔ `src/client/store.js:1621-1628`、`store.js:1999-2023`、`store.js:2124-2139`

---

### A5【低】设置页允许把「内存占比」填 0，宿主当非法值回退成 0.25，且无任何提示

- **UI**：`min: 0`，空值与 0 都会写进文档（`src/client/SettingsPanel.jsx:648-650`）；
- **宿主**：`budgetRatio > 0` 才采纳，否则用默认 0.25（`src/host/lsp.js:2581-2583`）。

用户看到设置是 0，实际按 25% 生效，且没有任何提示。**最小修复方向**：UI 不允许 0（`min` 改 0.05 并在输入时钳位），或宿主把 0 明确定义为「不设预算」并在设置页回显真实生效值。

---

### A6【低】三处注释与实现相反

| 位置 | 注释说 | 代码实际 |
|---|---|---|
| `src/client/Workbench.jsx:442-445` | 「Reserved 是运行中服务器被授予的**上限**，不是它实际占用的内存」 | 本轮后是**余量**（上限 − 实测），注释停留在旧语义 |
| `src/client/lsp-session.js`（`releaseLspForStore` 上方） | 「**不触碰**运行会话的 root」 | 代码先 `sessionRoot = ''` 再比较 ⇒ 等于总会通知宿主停服（`tests/lsp-workspace-switch.test.mjs` 的断言也确认这是**期望行为**） |
| `src/host/lsp.js:566` | `idlePolicyOf` 返回类型 `'never' \| 'after' \| 'onMemoryPressure'` | 本轮新增了 `'always'` |

其中第一条尤其值得改：`reservedBytes` 的语义本轮已经**破坏性变更**，而这段注释是它最显眼的一处说明。

---

## 2. 「语义分析：正在连接」耗时极长 —— 挖因与数据

### 2.1 这个标签到底在表示什么

`src/client/Workbench.jsx:613`：

```js
if (clientState === 'starting' && HOST_CONNECTING_STATES.includes(current)) {
  // HOST_CONNECTING_STATES = ['ready', 'building']
```

也就是说：**它不是「服务器在构建索引」，而是「客户端的 `initialize` 握手还没被回答」**。而宿主进入 `building` 是在**进程刚起完**时（`lsp.js:3185`），远早于索引构建完成。

### 2.2 根因（B1）：握手在「起服窗口」内被永久丢弃，且重试救不回来

**竞态窗口**：`#spawn` 里 **worker 先建、handle 后到**——

```
src/host/lsp.js:3245-3249   session.worker = worker          ← worker 就位
src/host/lsp.js:3299-3301   handle = await this.#spawnServer(spec)   ← 进程在这里诞生（窗口）
src/host/lsp.js:3310        session.handle = handle            ← handle 才就位
src/host/lsp.js:3399-3401   worker.postMessage(entry.handshake) ← 之后才补发握手
```

窗口内客户端的 `initialize` 到达时：

1. `relayToServer` 看到 `session.worker !== null` 就把 payload 交给 worker（`lsp.js:2136`）——它只检查 worker，**不检查 handle**；
2. worker 把它转成 `{ type: 'stdin', data }` 发回主线程；
3. 主线程 `#writeToServer` 发现 `session.handle` 还是 null ⇒ **静默丢弃**（`lsp.js:3710-3716`）；
4. 宿主在 `#spawn` 末尾补发 `entry.handshake`，但 worker 的 `Handshake` 已经 `noteForwarded` 过 ⇒ **第二个 initialize 被吸收、不转发**（`src/host/lsp-worker.js:440-461`）；
5. 客户端 30 秒后重试 ⇒ 同样被吸收 ⇒ **服务器永远收不到 `initialize`**。

**探针实测**（生产 `LspManager` + 测试替身）：

```
--- handshake-during-spawn (起服 400 ms, 握手 80 ms) ---
  服务器收到 initialize : false
  客户端重试之后        : false      ← 重试也救不回来
  交给 worker 的 payload: 3 个（没有一个落到 stdin）

--- handshake-after-spawn (起服 0 ms, 握手 200 ms) ---  ← 对照组
  服务器收到 initialize : true
```

**后果**：`HANDSHAKE_TIMEOUT_MS = 30000`（`lsp-session.js:98`）、`MAX_HANDSHAKE_RETRIES = 3`（`:1361`）、重试间隔 2000 ms（`:1430`）⇒ **状态栏最长显示「正在连接…」 4×30 + 3×2 = 126 秒**，之后才翻成「失败」。

**最小修复方向**：

1. 把「handle 已就绪」也当成 `relayToServer` 的就绪条件——窗口内的 payload 应走宿主已有的 `#holdFor` / `#replayPending` 队列，而不是丢给 worker；
2. `#writeToServer` 在 `handle` 为空时不应**静默**丢弃（至少要记日志并让调用方重试）；
3. worker 对「已吸收但服务器尚未应答」的第二个 initialize，应能重新转发给已就绪的服务器。

**位置**：`src/host/lsp.js:3245-3310`、`:3710-3716`、`:2136`；`src/host/lsp-worker.js:440-461`

> **归因**：这段代码在基线 `238668e` 上**完全同形**（`session.worker = worker` → `await spawnServer` → `session.handle = handle` → 补发 `entry.handshake`），⇒ **B1 是既有缺陷，不是本轮引入**。但本轮的 WS-02 把客户端的 connect **推后**了（见 2.3），两者叠加后，用户更容易撞上「握手迟迟不回」的观感。

### 2.3 本轮引入的增量（B2）：切换路径新增的同步等待把「正在连接」整体后移

WS-02 要求「先停旧服务器、确认后再连新的」，实现方式是 `enqueueSwitch` 等 `shutdownHostLspAwaited`（`src/client/lsp-session.js:1684-1697`）。而宿主的 `lsp.shutdown` **要等进程真的死掉才回话**（`#terminateAndWait` 等 `waitForExit`）。

**探针实测**：

```
服务器  50 ms 死 → lsp.shutdown  56 ms 后回话
服务器 300 ms 死 → lsp.shutdown 351 ms 后回话
服务器1200 ms 死 → lsp.shutdown1207 ms 后回话
```

浏览器里还要再叠一次 `lsp.scope` 往返（`SCOPE_TIMEOUT_MS` = 3000 ms 上限）。另外 `store.js:1267-1270` 与 `lsp-session.js:1687` **各发了一次 `lsp.shutdown`**（第二次命中已停的服务器、几乎零成本，但属重复调用）。

⇒ 这是 WS-02 的既定代价（实施进展 §5 风险 5 已认），但**代价量级此前没有量化**，且界面上没有任何提示。

### 2.4 结论

「正在连接」耗时长 = **握手丢失（B1，126 s）** + **切换时的同步等待（B2，0.2–1.2 s）** 叠加。主因是既有的握手丢失缺陷。

---

## 3. 规格 / 文档层面的不同步（不是代码缺陷，但会误导下一轮）

| 编号 | 问题 | 位置 |
|---|---|---|
| **D1** | **PRD §3.3 与实施契约 §2 的判定表互相打架**：PRD 写 `available − need_j < floor → low`、`available − need_j < soft_j → tight`；契约与实现用 `available`。两者差 651 MB（TS），tight 带宽与 low 门槛都不同。实施进展偏差 #6 已声明「按契约实现」，但 **PRD 本体未改**，两份规格仍不一致 | `docs/prd/v5.1/PRD-v5.1.md:417-424` ↔ `docs/prd/v5.1/PRD-v5.1-实施契约.md:67-71` |
| **D2** | **测试数有一处过期**：`docs/prd/README.md:126` 写「1003 / 1003」，`docs/prd/v5.1/PRD-v5.1-实施进展.md:378` 写「1010 / 1010（+99）」，**实跑是 1010 / 1010** ⇒ **实施进展的数字是对的，README 的停在 §7.2 修缺陷之前**（该轮补的 `tests/lsp-diagnostics-memory.test.mjs` 7 条用例还没算进去：1003 + 7 = 1010） | `docs/prd/README.md:126` |
| **D3** | **两包文档镜像已经断了**：`dsh-ide-workbench-web` 的 `docs/prd/v5.1/PRD-v5.1.md` 是 **625 行**的旧修订，主包是 **810 行**（SHA256 不同）⇒ web 变体上的规格本身就不是这一份。web 变体还停在 `605ad1d`，缺 `8e0ed73` / `1dbc238` / `238668e` 与本轮全部实施 ⇒ **MEM-10 / WS-04 在 web 变体上无法验收**（实施进展 L3 已记录，此处只是复核确认） | 两包 `docs/prd/v5.1/` |

---

## 4. 这一轮做得好、值得保留的地方

1. **MEM-05 的方向完全正确**，且**兑现了规格的验收数字**（P8 探针：用户场景 `reserved 1442 / measured 606 / available 1206 / decision tight`）。闸门不再把同一台服务器算两遍。
2. **断言语义没有被为了让测试变绿而放宽**：`tests/lsp-memory-gate.test.mjs` 按新语义逐条重写（契约 §6 的硬要求），新增 10 个测试文件覆盖 MEM-05/06/08/11/12、WS-01/02/04、CONC-01/03/05。`npm test` 1010/1010 全绿。
3. **MEM-10 的语义改对了**：`memoryWarnedRoots` 不再被写成 `'accepted'`，旧的 `'accepted'` 按 `'conservative'` 退化处理并写明了原因（避免「点一次『仍然启动』就永久传染」），`force` 的作用域被限定在当次启动。
4. **WS-04 的分层是对的**：「用户决定的」写进 `workspaceDefaults`（持久），「策略推导的」只写内存态 `lspIndexDecisions`（`#startLspForRestored` 里没有副作用写入）⇒ 用户随时能把索引关掉。
5. **「basic mode」终于有了明确的意思**：客户端与宿主两侧对「这个项目不要服务器」都有了一个可判定的来源（虽然 A4 指出两侧的来源还没统一）。
6. **文案口径统一到了 `availableBytes`**：宿主 3 条 detail 路径 + 客户端弹窗 / toast / 面板 / 设置页四处，而且有词法扫描测试守着（`tests/lsp-wording.test.mjs`）——MEM-09 兑现。
7. **压力阀挂上看门狗**（偏差 #1）是聪明的取舍：会话只拥有「空闲定时器 + 看门狗」两个定时器，同时拿到了 MEM-12 的保护。

---

## 5. 复现方法与探针说明

本轮六个探针**写在仓库外的临时目录**（`%LOCALAPPDATA%\Temp\`），**没有进仓库**，全部**只读导入生产源码**（`src/host/lsp.js`、`src/client/lsp-session.js`、`tests/lsp-fixtures.mjs`），未改动仓库任何文件：

> ⚠️ **顺带一提**：`npm test` 的脚本是 `node --test tests/*.test.mjs` ⇒ **`tests/` 目录里的任何 `.test.mjs` 都会被算进用例数**。本轮实测时发现仓库里遗留了一个临时探针 `tests/zz-review-r9-tmp.test.mjs`（3 条用例，头注写明「报告前删除」），它把计数从 **1010 抬到了 1013**。本报告的计数以**清掉它之后**的复跑为准。**以后取用例数要先确认工作区干净** —— 这类残留会同时污染实施记录里的数字。


| 探针 | 验证的条目 | 输出要点 |
|---|---|---|
| `iwb-probe-measure.mjs` | **A1** | 两会话并发：`measuredMB 3368`（真实 1500）、`reserved 728`（真实 2596）、`available 5772`（真实 3904） |
| `iwb-probe-decision.mjs` | **A2** | available=2000 ⇒ `decision=tight` 而 `tight=false` |
| `iwb-probe-grow.mjs` | **A3** | 服务器涨 600 MB ⇒ `availableBytes` 前后都是 6386 MB，`measuredMB` 434→1034 |
| `iwb-probe-basic-mode.mjs` | **A4** | 两标记冲突 ⇒ `lsp.start` 能起服，但 payload 之后**没有唤醒**（进程数仍为 1） |
| `iwb-probe-connect.mjs` | **B1** | 起服窗口内的握手**永久丢失**、重试无效；对照组正常收到 |
| `iwb-probe-timing.mjs` | **B2** | `lsp.shutdown` 56 / 351 / 1207 ms；「正在连接」上限 126 s |

```sh
# 仓库与提交
git -C dsh-ide-workbench log --oneline -3
git -C dsh-ide-workbench status --short
git -C dsh-ide-workbench diff 238668e..666065b --stat

# 测试（1010 / 1010）
npm --prefix dsh-ide-workbench test

# 探针（脚本在 %TEMP%，不在仓库）
node "$env:TEMP\iwb-probe-measure.mjs"
node "$env:TEMP\iwb-probe-decision.mjs"
node "$env:TEMP\iwb-probe-grow.mjs"
node "$env:TEMP\iwb-probe-basic-mode.mjs"
node "$env:TEMP\iwb-probe-connect.mjs"
node "$env:TEMP\iwb-probe-timing.mjs"
```

---

## 6. 一句话总结

**单会话场景成立、用户原症状消除；本轮引入 4 条可动作缺陷（A1 多会话重复计数致闸门虚高 1.9 GB、A2 `decision` 与 `tight` 自相矛盾、A3 面板快照冻结、A4 重新建立索引后醒不过来），另有 3 条低危与 3 条文档不同步；用户新报的「正在连接」耗时极长，根因是握手在起服窗口内被永久丢弃且重试无效（既有缺陷，最长 126 秒），本轮的 WS-02 顺序改动把它的暴露面放大了。**
