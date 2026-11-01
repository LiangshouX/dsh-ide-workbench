# PRD-v5.1 代码检视报告（第二轮：`4bbfd4c` 修复复核）

> **范围**：`666065b` → `4bbfd4c`（1 个提交：`4bbfd4c`「one number for the memory, one marker for the basic mode」）。改动 19 个文件，+2016 / −154（源码 6 个文件 +496 / −110；测试 6 个文件 +945 / −7；其余为 `dist/client.js` 与文档）。
> **基线**：`666065b`。**对照物**：`docs/prd/v5.1/PRD-v5.1-代码检视报告-第一轮.md`（第一轮结论）、`docs/prd/v5.1/PRD-v5.1.md`（规格，只读）、`docs/prd/v5.1/PRD-v5.1-实施契约.md`（跨模块接口约定）、`docs/prd/v5.1/PRD-v5.1-实施进展.md`（实施记录）。
> **方法**：读代码 + **实跑验证**。`npm test` 实跑 **1042 项 / 1042 通过 / 0 失败**；九个自建探针（写在 `%LOCALAPPDATA%\Temp\`，**不在仓库内**，只读导入生产源码）逐条复验 A1–A6 / B1 / B2，并对修复后新出现的记账口径另做定向探针（差值法钳位截断、压力阀触发）。
> **本次检视未修改任何源码**，本文件与 `docs/prd/README.md` 的索引行是本轮唯一产物。
> **检视日期**：2026-11-01。
> **重点关注**：① 第一轮的 8 条是**真修好了**还是只换了写法；② manager 级基线 + 分摊这套新口径有没有自相矛盾；③ 差值法固有的「分不清是谁长的」在修复之后还剩多少；④ 新增用例的断言是**真实行为断言**还是走样。

---

## 0. 结论

### 0.1 一句话

**第一轮的 8 条（A1–A6 / B1 / B2）本轮全部真修好了——修法与第一轮的建议一致，新增用例是「恰好一次」「只算一次」「不替换」这类真实行为断言而不是走样，1042/1042 全绿。但修复本身留下了 4 条新的可动作问题：1 条中危——差值法把「别的程序」吃掉的内存记到服务器头上，把 MEM-12 的压力阀架空（实测：机器真实可用已为 0，阀门仍不释放）；3 条低危——起服路径与复测路径对 `measured` 的钳位口径不一致、代码注释与实施进展把「总和精确」写成了不成立的结论、A6 的注释清理没做全且改写时把一句对的话换成了另一句错的话。另有 2 条被本轮修复「挂靠」上去的既有问题：设置写盘失败被静默吞掉（A4 的前提），以及第一轮 A4 的「实测」证据无效（结论有效、证据要更正）。**

**本轮新发现：7 条**（1 条中危 + 4 条低危 + 2 条低危/观察），**另附 2 条文档不同步**。

### 0.2 第一轮 8 条的复核结论

| 编号 | 第一轮的缺陷 | 本轮的修法 | 复核 |
|---|---|---|---|
| **A1** | 多会话下差值法重复计数，闸门虚高约 1.9 GB | 基线提升到 **manager 级**（`#lastGlobalFreeBytes` / `#lastMeasureAt`，`src/host/lsp.js:1566` / `:1574`），差值**只算一次**并**在 growers 之间分摊**（`:3619-3657`） | ✅ **真修好**。真实场景探针：`measuredMB 1500`（真实 1500）、`reserved 2596`、`available 3904`——与第一轮的虚高数字（3368 / 728 / 5772）完全对调 |
| **A2** | `decision` 与 `tight` 自相矛盾 | `decision` 去掉最坏档分支，`tight: decision === 'tight'`（`:2782` / `:2808`）；客户端统一走新导出的 `memoryDecisionOf()`（`src/client/store.js:516`），设置页复用同一函数 | ✅ **真修好**。探针：available=2000 ⇒ `decision='ok'`、`tight=false`，两侧同源 |
| **A3** | 面板快照冻结 | 刷新条件补上 `reservedBytes` / `measuredBytes` / `worstCaseBytes` / `budgetUsedBytes`，字节字段按 **MB** 比较（`src/client/store.js:2723-2733`） | ✅ **真修好**。服务器增长时 `available` 不变、`reserved` 变——新条件正好盯住后者 |
| **A4** | 基础模式两标记冲突 | 宿主 `#isConservative` 改成**四级顺序** `enabled → workspaceDefaults → indexOnOpen → memoryWarnedRoots`（`src/host/lsp.js:2332-2352`）；客户端 `#rememberWorkspaceDecision` 用**同一个 patch** 写两个 map，并在 `'build'` 时把 `memoryWarnedRoots` 条目**覆盖为 `null`**（`src/client/store.js:1642-1658`） | ✅ **真修好**（宿主侧 + 客户端侧）。探针（真实空闲退出 → `suspended`）：`build` 唤醒 ✓ / `conservative` 不唤醒 ✓ / 无标记唤醒 ✓。**但它的前提有一个静默失败的口子，见 N5** |
| **A5** | `budgetRatio` 可填 0 | `clampBudgetRatio()` 钳位 `[0.05, 1]`，输入框 `min=0.05`，注释与提示写明最小 5%（`src/client/SettingsPanel.jsx:48-66` / `:700-711`） | ✅ **真修好** |
| **A6** | 三处注释与实现相反 | `memoryFacts` 注释、`releaseLspForStore` 注释、`idlePolicyOf` 返回类型均已对齐 | ⚠️ **三处已改对，但同一文件里还有第 4 处同类失真，而且正是本轮改写时引入的 —— 见 N4** |
| **B1** | 握手在起服窗口被永久丢失（126 秒） | `relayToServer` 的守卫从「看 worker」改成「**看进程**」：`session.handle === null` ⇒ 走 `#holdFor`（`:2166-2167`），握手有**独立槽位**（`:2362-2389`），进程就绪后 `#replayPending`（`:2404-2410`） | ✅ **真修好**。探针：起服窗口内的握手**恰好一次**到达服务器 stdin（修复前是 0 次） |
| **B2** | 切换路径新增的同步等待 | `shutdownHostLspAwaited` 用 `pendingShutdowns` Map 按**规范化 root** 去重（`src/client/lsp-session.js:778-818`），两侧拼写比较统一到 `sameRoot()`（`:1204`） | ✅ **真修好**（去重成立）。⚠️ 同步等待**本身**没有取消——它是 WS-02 的既定代价，实施进展 §5 风险 5 已认 |

> **键空间核对**：宿主 `rootKey()` 与客户端 `normalizeScopePath()` 在 Windows 下**都小写、都去尾分隔符** ⇒ 一致，A4 的两个 map 能对上。
> **多 manager 风险排除**：`src/index.js:311` 只有**一处** `new LspManager(...)` ⇒ manager 级基线不会跨 manager 重复计数。

### 0.3 本轮新发现

| 编号 | 严重度 | 缺陷 | 位置 | 归因 |
|---|---|---|---|---|
| **N1** | **中** | 差值法把**别的程序**吃掉的内存记到服务器头上 ⇒ `reserved` 虚低、`available` 虚高 ⇒ **MEM-12 的压力阀被架空**（实测：机器真实可用已为 0，阀门仍不触发） | `src/host/lsp.js:2757-2763` / `:3575-3591` / `:3619-3657` | 差值法固有（第一轮 L5/L7 已列），**本轮未收口**，且本轮把它写成了「结论可靠」（见 N3） |
| **N2** | 低 | 起服路径与复测路径对 `measured` 的**钳位口径不一致** ⇒ 被误记的会话踢出 growers，差值**转嫁给别的会话** | `src/host/lsp.js:3581-3583` ↔ `:3655` | **本轮引入** |
| **N3** | 低 | 「总和精确 / 结论可靠」**不成立**（实测少记 452 MB，且这部分**永久丢失**） | `src/host/lsp.js:3601-3613`，`PRD-v5.1-实施进展.md:477` / `:550` | **本轮引入**（表述与承诺） |
| **N4** | 低 | 面板注释声称有一行 `"measured"`，**面板没有这一行**；而且这句是本轮改写时**新加**的 | `src/client/Workbench.jsx:447` | **本轮引入** |
| **N5** | 低 | 设置写盘失败被 `.catch(() => {})` **静默吞掉** ⇒ A4 的「一个 patch」前提会悄悄失效，两侧又分叉 | `src/client/store.js:1656-1657` | 既有写法，**本轮把 A4 挂靠在它上面** |
| **N6** | 低 | 第一轮 A4 的「实测」证据**无效**：旧探针用 `manager.shutdown()`，会话停在 `idle`，而 `#isWakeable` 只唤醒 `suspended`，**根本没走到**被指认的分支 | 第一轮报告 A4 节 | **证据更正**（结论本身有效） |
| **N7** | 低/观察 | 两包文档镜像仍断；工作区还多出一份**未提交**的 Java 方案文档 | 两包 `docs/prd/v5.1/` | 未修 / 范围外 |

### 0.4 总体判断

**这一轮修得很干净，而且修的是根因而不是症状。** 三件事值得肯定：

1. **A1 的修法是对的**——把基线提升到 manager 级、差值只算一次、在 growers 之间分摊，这正是第一轮建议的方向，而且实现上**没有为了跑通测试而走样**：新增的 `tests/lsp-review-round1.test.mjs`（13 条）与 `tests/lsp-decision-and-basic-mode.test.mjs`（9 条）断言的是「**恰好一次**」「**只算一次**」「**不替换**」这类可观察的行为，而不是「某行代码被执行过」。
2. **A2 的修法是对的方向**——不再让宿主自己发布两个可以互相矛盾的答案，而是**抽出一个唯一的读法**（`memoryDecisionOf()`）并让设置页复用它。第一轮 A2 的根因是「同一个快照被读两次」，这一轮从结构上消除了第二次读。
3. **A4 的修法跨了两侧**——宿主改了判定顺序，客户端改了写入方式（一个 patch + `null` 覆盖），两边**都动了**。这正是第一轮指出的「两侧各判各的」的正确治法。

**但这一轮留下了一个共同的问题：注释和文档跑到了实现前面。**

- 实现上，差值法**仍然分不清是谁长的**（N1）——这是差值法的固有限制，第一轮就写进了 L5/L7；
- 而这一轮把同一个量又写成了「**总和精确**」「**结论可靠**」（N3），并且在两处路径上用了**两种钳位口径**（N2）；
- 面板注释更直接声称存在一行并不存在的 `"measured"`（N4）。

⇒ **A1 修好了「重复计数」，但没有修「归因」；而文档把前者当成了后者。** 差值法在多会话下不再重复计数（好），但别的进程吃掉的内存仍会被算到某台服务器头上（差）——这两件事在本轮的注释和实施进展里被合并成了一句「总和精确」。

---

## 1. 修复复核（逐条）

### 1.1 A1【已修好】manager 级基线 + 差值只算一次 + 分摊

**改法**：基线与轮次时间从「每会话一份」提到「每 manager 一份」：

```js
// src/host/lsp.js:1566 / :1574 —— manager 级
#lastGlobalFreeBytes = null
#lastMeasureAt = null
```

```js
// src/host/lsp.js:3628-3657 —— 一轮只做一次
const free = this.#freeBytes()
const previous = this.#lastGlobalFreeBytes
this.#lastGlobalFreeBytes = free
…
const share = delta / growers.length
for (const grower of growers) {
  grower.measuredBytes = Math.min(grower.ceilingBytes, grower.measuredBytes + share)
  grower.reservedBytes = Math.max(0, grower.ceilingBytes - grower.measuredBytes)
}
```

**起服路径也一起搬到了 manager 级**：`#measureFootprint` 在测量完本会话之后，把基线移到起服后的读数上（`src/host/lsp.js:3580`）⇒ 下一轮**不会**把这次起服的内存下降再算一遍。注释把这个不变量写清楚了（`:3565-3569`），值得肯定。

**探针实测**（真实场景：内存下降落在起服窗口内）：

| | 真实 | 第一轮（坏） | 本轮（好） |
|---|---|---|---|
| `measuredMB` | 1500 | 3368 | **1500** ✅ |
| `reservedBytes` | 2596 MB | 728 MB | **2596** ✅ |
| `availableBytes` | 3904 MB | 5772 MB | **3904** ✅ |

**结论**：第一轮 A1 完全成立、已彻底修好。

---

### 1.2 A2【已修好】`decision` 与 `tight` 归一

```js
// src/host/lsp.js:2782-2784
const decision = availableBytes < hardFloorBytes
  ? 'low'
  : (availableBytes < softThresholdBytes ? 'tight' : 'ok')
…
// src/host/lsp.js:2808
tight: decision === 'tight',
```

最坏档（`worstCase`）被**降级为信息**，不再进入判定（`:2764`、`:2816-2818`），这与 PRD-v5.1 §3.3「最坏档不是拒绝理由」的修订方向一致。

客户端新增了**唯一的读法**并导出给设置页复用：

```js
// src/client/store.js:516
export function memoryDecisionOf(resources) { … }
```

`restartLsp` 的 `force` 也改读同一个字段（第一轮指出的第二个分歧点）。

**探针实测**：available = 2000 MB ⇒ `decision='ok'`、`tight=false`；客户端与设置页拿到的都是 `'ok'`。

**结论**：A2 完全成立。

---

### 1.3 A3【已修好】面板快照不再冻结

```js
// src/client/store.js:2726-2730
|| megabytesOf(known.reservedBytes) !== megabytesOf(resources.reservedBytes)
|| megabytesOf(known.measuredBytes) !== megabytesOf(resources.measuredBytes)
|| megabytesOf(known.worstCaseBytes) !== megabytesOf(resources.worstCaseBytes)
|| megabytesOf(known.budgetUsedBytes) !== megabytesOf(resources.budgetUsedBytes)
```

**关键点**：比较的是**面板真正显示的那几个字段**，且按 MB 比较（`megabytesOf()`，`store.js:539-541`）⇒ 机器空闲内存的几 KB 抖动不会每次轮询都替换快照、唤醒整个工作台。

**结论**：A3 完全成立，且修法（比较显示口径，而不是比较源字段）是对的。

---

### 1.4 A4【已修好，但有一个前提的静默失败口子】基础模式两标记归一

**宿主侧**（`src/host/lsp.js:2332-2352`）改成**有优先级的四级顺序**：

1. `enabled === false` ⇒ 基础模式
2. `workspaceDefaults[root]` ⇒ `'conservative'` ⇒ 基础模式 / `'build'` ⇒ 一定建
3. `indexOnOpen === 'never'` ⇒ 基础模式
4. `memoryWarnedRoots[root] === 'conservative'` ⇒ 基础模式（其余值一律跳过）

客户端的 `workspaceDefaults` 排在 `memoryWarnedRoots` **之前** ⇒ 两边读的是**同一个 map**、**同一个顺序** ⇒ 不可能再出现「客户端说建索引、宿主说基础模式」。

**客户端侧**（`src/client/store.js:1642-1658`）用**一个 patch** 写两个 map，并且 `'build'` 时把 `memoryWarnedRoots` 的对应条目**覆盖为 `null`**：

```js
const key = Object.keys(warned).find(entry => sameScopePath(entry, root))
if (key !== undefined) warned[key] = null
```

`null` 可行的前提是宿主设置文档**没有值级 schema**——`deepMerge` 按键合并、`migrateLspSettings` 只校验「是 plain object」，`null` 因此能穿过并被两边同时读成「没问过」。这条判断经核对成立。

**探针实测**（真实空闲退出 → `suspended`，不是第一轮那个走错分支的探针）：

| 场景 | 期望 | 实测 |
|---|---|---|
| `workspaceDefaults = 'build'` | 唤醒 | ✅ 唤醒 |
| `workspaceDefaults = 'conservative'` | 不唤醒 | ✅ 不唤醒 |
| 无任何标记 | 唤醒 | ✅ 唤醒 |

**结论**：A4 成立。但「一个 patch」这个前提依赖一次**会被静默吞掉**的写盘（`store.js:1657`）——见 N5。

---

### 1.5 A5 / A6 / B1 / B2【已修好】

- **A5**：`clampBudgetRatio()` 钳位 `[0.05, 1]`（`src/client/SettingsPanel.jsx:60-66`），输入框 `min: 0.05`（`:708`），注释解释了「宿主会把 0 静默换成 0.25」（`:702-707`）。空值与非法值回落到默认值。
- **A6**：三处注释已对齐（`memoryFacts` 注释、`releaseLspForStore` 注释、`idlePolicyOf` 返回类型）。⚠️ **但同类的第 4 处没清干净，而且是本轮改写时新加错的 —— 见 N4**。
- **B1**：`relayToServer` 的守卫改成「看进程不看 worker」（`src/host/lsp.js:2166`），握手在队列里有**独立槽位**（`:2383-2389`），进程就绪后 `#replayPending`（`:2404-2410`）**恰好一次**交付。探针实测：起服窗口内的握手**恰好一次**到达服务器 stdin。
- **B2**：`shutdownHostLspAwaited` 用 `pendingShutdowns` Map 按规范化 root 去重（`src/client/lsp-session.js:778-818`），拼写比较统一到 `sameRoot()`（`:1204`），`refreshLsp` 的三处比较也一并改用它（`:1823` / `:1840` / `:1860` / `:2024`）。

---

## 2. 本轮新发现

### N1【中】差值法把别的程序吃掉的内存记到服务器头上 ⇒ MEM-12 的压力阀被架空

**触发条件**：起服窗口或复测窗口内有**别的进程**抢内存。Windows 上这几乎必然发生：IDE 自己的索引、浏览器、Docker、杀毒软件的实时扫描。

**机制**：`measuredBytes` 记的是「**机器空闲内存的下降**」，不是「这台服务器占了多少」。别的进程抢走的 7000 MB 被记成了语言服务器的增长：

```js
// src/host/lsp.js:3581-3583 —— 起服窗口
if (delta > MEASURE_NOISE_MAX_MB * 1024 * 1024) {
  session.measuredBytes = delta      // ← 整个机器的下降都记在这一台上
  return
}
```

于是 `measured` 虚高 ⇒ `reserved = ceiling − measured` 虚低 ⇒ **`available = free − Σreserved` 虚高** ⇒ 宿主闸门（`canIndex` / `decision`）和 MEM-12 的压力阀（`:4174`，`availableBytes >= hardFloorBytes` 就放行）**都基于这个虚高的数**。

**探针实测**（`iwb-probe-valve-2.mjs`；生产 `LspManager` + 测试替身；服务器真实占用 600 MB、上限 2048 MB ⇒ 真实余量 1448 MB；压力阀阈值 256 MB）：

| | 无其它程序 | **其它程序吃掉 7000 MB** |
|---|---|---|
| 机器空闲内存 | 7400 MB | 400 MB |
| `measuredMB`（真实 600） | 600 MB | **2048 MB** ❌ |
| `reservedBytes`（真实 1448） | 1448 MB | **0 MB** ❌ |
| `availableBytes`（真实 0） | 5952 MB | **400 MB** ❌ |
| 压力阀（阈值 256 MB） | 不触发 | **不触发** ❌（真实可用已为 0，应当触发） |

**后果**：

1. **MEM-12 的压力阀最多晚「被误记的那部分」触发**——机器真的没内存了，阀门不释放，而这正是 MEM-12 存在的理由。
2. **诊断面板的「可用」虚高**；而且「已预留」那一行在 `reservedMB > 0` 时才渲染（`src/client/Workbench.jsx:482`）⇒ 误记会让这一行**整行消失**，用户看到的是一台「内存充足、没有预留」的机器。
3. 宿主闸门用同一个 `available`，会放行一台本不该起的服务器。

**归因**：**机制是差值法固有的**——第一轮的 L5/L7 已经承认「差值法分不清是谁长的」，本轮**没有收口**这个洞。**不是本轮提交引入的新代码缺陷**，但本轮提交把它**写成了不成立的结论**（见 N3），所以本轮把它列为需要处理的一条。

**最小修复方向**（三选一，从小到大）：

- **最小**：在 `#remeasure` 里，如果 `delta` 超过所有 growers 的剩余额度总和（意味着**一定**有别人的份额），把超出部分记到 manager 级的一个 `uncertainBytes`，并从 `availableBytes` 里扣掉：
  ```js
  // src/host/lsp.js:2760
  const availableBytes = Math.max(0, freeBytes - reservedBytes - this.#uncertainBytes())
  ```
- **中间**：在 `#measureFootprint` 里对 `delta` 加上界——「这一台最多只能占它自己上限那么多」，超出上限的部分本来也用不上（`reserved` 已经被 `Math.max(0, …)` 钳到 0），因此**多记的部分对账没有任何用处，只会污染闸门**。
- **彻底**：需要进程级 RSS（Windows 上没有便宜的 Node API，实施进展已论证不用），或改用「按会话的请求量/索引规模」做间接估计。成本高，本轮不建议。

---

### N2【低】起服路径与复测路径对 `measured` 的钳位口径不一致（本轮引入）

```js
// src/host/lsp.js:3581-3583 —— 起服路径：不钳上限
session.measuredBytes = delta

// src/host/lsp.js:3655 —— 复测路径：钳上限
grower.measuredBytes = Math.min(grower.ceilingBytes, grower.measuredBytes + share)
```

**修复前（`666065b`）两条路径都不钳位**（`session.measuredBytes += delta`）⇒ 口径是自洽的。**是这一轮在复测路径上加了钳位、却没同步起服路径**，于是同一个量有了两个算法。

**后果**：

1. 起服窗口里别的进程抢了 7000 MB ⇒ 该会话的 `measured = 7600 MB`，而它的 `ceiling` 只有 2048 MB ⇒ `reserved` 归零，而**没有任何地方记录这个数已经不可信**。
2. 这个会话随即被 growers 的过滤条件踢出：
   ```js
   // src/host/lsp.js:3644
   if (candidate.measuredBytes >= candidate.ceilingBytes) continue
   ```
   ⇒ **后续的差值全部分给别的会话**——一个被误记的会话，把不属于它的账**转嫁**给了无辜的会话。这正是第一轮 A1 想根治的那类「重复计数 / 错误归因」，只是换了个方向。
3. 两条路径的算法不一致 ⇒ 同一个量在两个地方有两个含义，后续维护者会按其中一处去推理整个模型。

**最小修复方向**：**统一口径**。推荐**两处都不钳 `measured`**，只在算预留额时钳（`reserved = Math.max(0, ceiling − measured)` 本来就是这个语义）；同时把 growers 的过滤条件从「`measured < ceiling`」改成「**这一台还活着、且它自己的额度还没用满**」——后者才是 growers 这个概念真正要表达的东西。若坚持要钳 `measured`，则起服路径必须同步钳，并把「因钳位被丢弃的差额」显式记下来（否则就掉进 N3 说的「永久丢失」）。

---

### N3【低】「总和精确 / 结论可靠」是不成立的结论（本轮引入）

三处都写了同一句不成立的话：

- `src/host/lsp.js:3601-3613`：`The split is an APPROXIMATION … but the SUM is exact: the difference is counted once, and the gate and the diagnostics panel work with the sum.`
- `docs/prd/v5.1/PRD-v5.1-实施进展.md:477`（A1 行）：「…… ⇒ **总和精确**（每会话的分摊是近似，闸门与面板用的都是总和）」
- `docs/prd/v5.1/PRD-v5.1-实施进展.md:550`（L7）：「…… **总和精确**，**每会话的分摊是近似**。闸门与面板用的都是总和 ⇒ **结论可靠**」

**「总和精确」在两个意义上都不成立**：

1. **分摊会被上限截断**：`Math.min(grower.ceilingBytes, …)` 会把超出各会话上限的部分**直接丢掉**。
2. **丢掉的部分不会结转**：下一轮的 `delta` 是相对**新基线**算的，所以被丢掉的那部分**永久丢失**，再也不会被记到任何会话头上。

**探针实测**（`iwb-probe-clamp.mjs`）：机器真实掉了 **2000 MB**（A 会话真实长 1500 MB、B 长 500 MB）；一轮复测后：

```
before the round:  measured 2000 MB   (A took 1500, B took 500)
after the round:   measured 3548 MB
the machine really lost 2000 MB in this round
the sum grew by 1548 MB          ← 少记 452 MB
```

**方向是安全的**（预留多收、闸门更严），但**结论是错的**：「总和精确」应为「总和是机器真实下降的**下界**」；「结论可靠」应为「结论偏保守」。

**最小修复方向**（二选一）：

- **结转**：manager 级加一个 `pendingDeltaBytes`，把被钳位丢弃的差额存起来，下一轮**先**补上。这样「总和精确」才真的成立。
- **改口径**：把注释和实施进展里的「总和精确 / 结论可靠」改成「总和 ≤ 机器真实下降（保守方向）」，并说明被截断的部分作废。

---

### N4【低】A6 的注释清理没做全，而且改写时把一句对的话换成了另一句错的话（本轮引入）

`src/client/Workbench.jsx:447` 这一句是**本轮加的**（diff 显示旧版写的是「the running servers have claimed - their ceiling, not the memory they actually use」，A6 把它改写成了新语义）：

```
 * take). What the running servers use is reported as "measured", and what
 * they may still take is the reservation. The reservation is only shown when
```

**但面板没有 "measured" 这一行。** 面板实际渲染的四行是「可用 / 需要 / 已预留 / 最坏情况」：

```js
// src/client/Workbench.jsx:478-491
const availableMB = Math.round((resources.availableBytes ?? resources.freeBytes ?? 0) / mib)
const needMB = Math.round(resources.needMB ?? 0)
const reservedMB = Math.round((resources.reservedBytes ?? 0) / mib)
const text = `${t('lsp.diagnostics.memoryAvailable')} ${availableMB} MB · ${t('lsp.diagnostics.memoryNeed')} ${needMB} MB`
  + (reservedMB > 0 ? ` · ${t('lsp.diagnostics.memoryReserved')} ${reservedMB} MB` : '')
…
const worstMB = worstBytes === null ? null : Math.round(worstBytes / mib)
```

`measuredBytes` 在**整个客户端没有任何渲染点**（`grep measured` 在 `src/client/` 下只命中 `store.js` 的比较逻辑、`Workbench.jsx` 的注释与 i18n 文案）。i18n 里也只有 `memoryAvailable` / `memoryNeed` / `memoryReserved` 三个键（`src/client/i18n.js:620-623`）。

**后果**：纯注释问题，严重度低。但它有两个不该有的性质：

1. **它是 A6 这一轮的同类问题**——A6 的立项就是「三处注释与实现相反」，说明这一轮的清理是「改了报告里点名的三处」而不是「清干净了」；
2. **改写时把一句对的话换成了另一句错的话**：旧版那句「their ceiling, not the memory they actually use」虽然语义过期，但**至少说的是面板上真实存在的东西**；新版引入了面板上并不存在的行名。

**最小修复方向**：把 `Workbench.jsx:447` 改成「服务器**已经用掉**的内存没有单独一行——它已经被机器的空闲内存扣掉了；『已预留』只是它们**还能再涨**的部分」。若产品上确实想显示实测占用，则要**真的加一行**（并同步 i18n 与 `memoryFacts` 的返回结构）——那是功能变更，不属于本轮检视。

---

### N5【低】A4 的「一个 patch」前提，是一个会被静默吞掉的写盘失败

```js
// src/client/store.js:1656-1657
this.set({ settings: { ...this.state.settings, lsp: { ...lsp, workspaceDefaults: defaults, memoryWarnedRoots: warned } } })
void call('settings.update', { patch: { lsp: { workspaceDefaults: defaults, memoryWarnedRoots: warned } } }).catch(() => {})
```

**顺序是「先改内存态，后写宿主」**，而写失败被 `.catch(() => {})` **吞掉**：没有日志、没有回滚、没有提示。

**归因**：`.catch(() => {})` 是**既有写法**（`666065b` 里已经是同一行），**不是本轮引入**。但这一轮把 A4 的正确性**建立在了它上面**——A4 的全部要点就是「两个 map 用一个 patch 写、'build' 把 `memoryWarnedRoots` 覆盖为 `null`」，而这个 patch **可能根本没落到宿主的设置文档里**。

**后果**：写失败时，客户端内存态说「这个项目要建索引」，宿主文档里 `workspaceDefaults` 仍是 `'conservative'` ⇒ **两侧又分叉**。而且这一次的形态比 A4 更难察觉：宿主按基础模式**不建索引**，用户点了【重新建立索引】却毫无反应，日志里也一个字都没有。

**最小修复方向**：写失败时至少 `logger.warn` 一次，并把内存态回滚（或改成「写成功才生效」的乐观更新 + 失败回退）。回滚比 warn 更重要——**静默的不一致比明确的失败更坏**。

---

### N6【低/证据更正】第一轮 A4 的「实测」证据无效

第一轮报告 A4 节的探针结论是「两标记冲突 ⇒ `lsp.start` 能起服，但 payload 之后**没有唤醒**（进程数仍为 1）」。

**该探针走错了分支**：它用 `manager.shutdown()` 收尾，会话停在 **`idle`**；而 `#isWakeable` 只唤醒 **`suspended`**：

```js
// src/host/lsp.js:2238
if (session.state === 'suspended') return true
```

⇒ `idle` 的会话**根本不会进入** `#isConservative` 分支 ⇒ 那次探针**没有验证被指认的代码路径**。

**A4 的结论本身仍然成立**——由代码走查成立：旧 `#isConservative` 的顺序确实是 `enabled → indexOnOpen → workspaceDefaults → memoryWarnedRoots`（客户端读 `workspaceDefaults` 优先、宿主读 `memoryWarnedRoots` 优先，两侧优先级相反）。第二轮用**真实空闲退出 → `suspended`** 的路径重新实测，三种场景全部符合预期（见 §1.4）。

**⇒ 更正的是「证据」不是「结论」**：第一轮把这条标成「已实测」是不准确的，应改为「由代码走查成立，第二轮补上正确的实测」。

---

### N7【低/观察】文档镜像与范围外的未提交文档

1. **两包文档镜像仍断**（第一轮 D3 **未修**）：`dsh-ide-workbench-web` 仍停在 `605ad1d`，其 `docs/prd/v5.1/PRD-v5.1.md` 是 **625 行**的旧修订，主包是 **810 行**（SHA256 不同）。本轮新增的文档改动（实施进展 §7.3、L7/L8 的改写、实施契约 §2 的 `tight = (decision === 'tight')`）**也都没有同步**。文档约定要求两包字节一致。
2. **工作区多出一份未跟踪文档**：`docs/prd/v5.1/PRD-v5.1-Java语言服务器修复方案.md`（基于 `666065b`，状态「方案已定，未实施」，条目 JS-01 ~ JS-05）。它**不在本次检视范围**（`666065b..4bbfd4c`），但它是面向落地的方案文档，落地时会踩到本轮修复后的记账口径（尤其是 MEM-05/MEM-06 的语义）⇒ **建议提交前对照本报告复核**。

---

## 3. 文档层面的不同步（不是代码缺陷，但会误导下一轮）

| 编号 | 问题 | 位置 |
|---|---|---|
| **D1** | 「总和精确」「结论可靠」与实现不符（见 N3）。**这是本轮新增的不一致**——第一轮的 L7 还只是承认「分摊是近似」 | `src/host/lsp.js:3601-3613`，`docs/prd/v5.1/PRD-v5.1-实施进展.md:477` / `:550` |
| **D2** | 两包文档镜像仍然不一致，且本轮的文档改动未同步（见 N7-1） | 两包 `docs/prd/v5.1/` |
| **D3** | 工作区的 Java 方案文档基于 `666065b`，其对内存记账口径的描述需要按本报告复核（见 N7-2） | `docs/prd/v5.1/PRD-v5.1-Java语言服务器修复方案.md`（未跟踪） |

> **测试数核对**：`docs/prd/README.md:127` 写 **1042 / 1042**、`PRD-v5.1-实施进展.md:378` 写 **1042 / 1042**，与本轮 `npm test` 实跑一致 ✅（第一轮的 D2 已修好）。

---

## 4. 这一轮做得好、值得保留的地方

1. **A1 修的是根因**：把基线提升到 manager 级而不是给每个会话加互斥锁，差值**只算一次**再分摊——这是第一轮建议的方向，实现也照做。
2. **不变量的注释写得很到位**：`src/host/lsp.js:3565-3569`（起服窗口是每会话的、可归因的，但**基线要跟着搬**）和 `:3601-3613`（一轮是 manager 的，差值是一个）把「为什么不能各算各的」讲清楚了。这类注释是这套代码里最值钱的部分。
3. **A2 从结构上消除了分歧**：不是「把两个字段改成一样」，而是**抽出一个唯一的读法**并让三个调用点共用。
4. **A3 比较的是「显示口径」**：按 MB 比、且盯住面板真正显示的字段，而不是按字节比源字段——这同时解决了「面板冻结」和「每次轮询都唤醒整个工作台」两个问题。
5. **A4 两侧都动了**：宿主改判定顺序、客户端改写入方式，且用「`null` 覆盖」解决「map 按键合并、删不掉条目」的真实约束——这个约束处理得很干净。
6. **新用例是真实行为断言**：`tests/lsp-review-round1.test.mjs`（13 条）与 `tests/lsp-decision-and-basic-mode.test.mjs`（9 条）断言的是「**恰好一次**」「**只算一次**」「**不替换**」，不是「某行被执行过」；`tests/lsp-memory-measure.test.mjs` 扩写的 2 条也守住了 A1 的核心不变量。**没有为了让测试变绿而走样**——这是本轮最值得肯定的一点。
7. **B1 的修法对症**：从「看 worker」改成「看进程」，因为 worker 会在进程之前就准备好，而进程才是能接住 payload 的东西。握手另给一个槽位，避免被有界的队列挤掉。
8. **B2 的 `sameRoot()`** 把两侧的路径比较统一到一个函数上——第一轮指出的「两种拼写」从此不会复发。

---

## 5. 复现方法与探针说明

本轮九个探针**写在仓库外的临时目录**（`%LOCALAPPDATA%\Temp\`），**没有进仓库**，全部**只读导入生产源码**（`src/host/lsp.js`、`src/client/lsp-session.js`、`src/client/store.js`、`tests/lsp-fixtures.mjs`），未改动仓库任何文件：

| 探针 | 验证的条目 | 输出要点 |
|---|---|---|
| `iwb-probe-a1-real.mjs` | **A1**（真实场景） | `measuredMB 1500`（真实 1500）、`reserved 2596`、`available 3904` |
| `iwb-probe-decision.mjs` | **A2** | available=2000 ⇒ `decision='ok'`、`tight=false` |
| `iwb-probe-basic-mode-3.mjs` | **A4**（正确路径：真实空闲退出 → `suspended`） | `build` 唤醒 ✓ / `conservative` 不唤醒 ✓ / 无标记唤醒 ✓ |
| `iwb-probe-connect.mjs` | **B1** | 起服窗口内的握手**恰好一次**到达服务器 stdin |
| `iwb-probe-timing.mjs` | **B2** | `lsp.shutdown` 56 / 351 / 1207 ms（去重后不再叠加） |
| `iwb-probe-clamp.mjs` | **N3** | 机器真掉 2000 MB，总和只涨 **1548 MB**（少 452 MB） |
| `iwb-probe-valve-2.mjs` | **N1** | 其它程序吃掉 7000 MB ⇒ `measured 2048`（真实 600）、`reserved 0`（真实 1448）、`available 400`（真实 0），**压力阀不触发** |
| `iwb-probe-basic-mode.mjs` / `iwb-probe-basic-mode-2.mjs` | 第一轮 A4 探针（**已作废**，见 N6） | 会话停在 `idle`，**没有进入** `#isConservative` 分支 |
| `iwb-probe-measure.mjs` / `iwb-probe-grow.mjs` | 第一轮探针在修复后的**对照** | A1 的多会话虚高消失；A3 的 `reserved` 随增长变化 |

> ⚠️ **探针注意**：宿主模块里的 `ROOTS` 是**模块级**的 ⇒ **不同场景必须用不同的 root 路径**，否则前一个场景的会话会留在表里干扰下一个场景（第二轮的 `iwb-probe-basic-mode-3.mjs` 换掉了 root 之后才拿到正确结果）。

```sh
# 仓库与提交
git -C dsh-ide-workbench log --oneline -3
git -C dsh-ide-workbench status --short
git -C dsh-ide-workbench diff 666065b..4bbfd4c --stat

# 测试（1042 / 1042）
npm --prefix dsh-ide-workbench test

# 探针（脚本在 %TEMP%，不在仓库）
node "$env:TEMP\iwb-probe-a1-real.mjs"
node "$env:TEMP\iwb-probe-decision.mjs"
node "$env:TEMP\iwb-probe-basic-mode-3.mjs"
node "$env:TEMP\iwb-probe-connect.mjs"
node "$env:TEMP\iwb-probe-clamp.mjs"
node "$env:TEMP\iwb-probe-valve-2.mjs"
```

---

## 6. 一句话总结

**第一轮的 8 条全部真修好了，修法与建议一致，新用例是真实行为断言，1042/1042 全绿；但这一轮把「差值法不再重复计数」当成了「账算对了」，于是留下 1 条中危（差值法把别的程序吃掉的内存记到服务器头上，MEM-12 的压力阀被架空——实测机器真实可用为 0 时阀门仍不释放）、3 条本轮引入的低危（起服与复测两条路径的钳位口径不一致、「总和精确 / 结论可靠」不成立、面板注释声称有一行并不存在的 "measured"），另有 2 条既有/观察项（设置写盘失败被静默吞掉使 A4 的前提失效、第一轮 A4 的实测证据需更正）。**
