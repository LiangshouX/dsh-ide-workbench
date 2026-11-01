# PRD-v5.1 代码检视报告（第三轮：`ed38e4e` 修复复核）

> **范围**：`4bbfd4c` → `ed38e4e`（1 个提交：`ed38e4e`「do not book another program's memory on the servers」）。改动 11 个文件，+1128 / −54（源码 3 个文件 +200 / −39；测试 3 个文件 +362 / −0；文档 4 个文件 +522 / −6；`dist/client.js` +44 / −9）。
> **基线**：`4bbfd4c`。**对照物**：`docs/prd/v5.1/PRD-v5.1-代码检视报告-第二轮.md`（第二轮结论）、`docs/prd/v5.1/PRD-v5.1.md`（规格，只读）、`docs/prd/v5.1/PRD-v5.1-实施契约.md`（跨模块接口约定）、`docs/prd/v5.1/PRD-v5.1-实施进展.md`（实施记录）。
> **方法**：读代码 + **实跑验证**。`npm test` 实跑 **1051 项 / 1051 通过 / 0 失败**；四个自建探针（写在 `%LOCALAPPDATA%\Temp\`，**不在仓库内**，只读导入生产源码）复验第二轮的 7 条，并针对新归因算法另做三个定向场景（差值落在额度内 / 起服窗口 / **持续渗漏**）。
> **本次检视未修改任何源码**，本文件与 `docs/prd/README.md` 的索引行是本轮唯一产物。
> **检视日期**：2026-11-02。
> **重点关注**：① 第二轮的 7 条是**真修好了**还是**只修好了被复现的那一个场景**；② 新的「按剩余额度封顶」在数学上能不能闭合差值法的固有缺陷；③ 新增/改写的注释与实施记录说的是不是代码真正在做的事。

---

## 0. 结论

### 0.1 一句话

**第二轮的 7 条里，4 条真修好了（N2 / N4 / N6 / 另一条 N5 的客户端侧），N1 只修好了被复现的那一个场景 —— 差值一旦落在「剩余额度」之内，别人的内存照样整笔记到服务器头上，账目的可用内存因此是真实值的上界（乐观方向），压力阀与闸门仍然被架空；实测里最有说服力的是「持续渗漏」场景：别的程序每分钟吃掉 100 MB，账目的可用内存**恒定在 1552 MB**，而真实可用从 1452 MB 一路掉到 152 MB（低于 256 MB 的硬地板）、再到 −48 MB（已经超卖），**压力阀一次都没触发**。此外新查出 2 条低危：**三处注释与实施记录 L7 都承诺「压力阀同时盯裸 `freeBytes`」—— 而这一轮恰恰明确拒绝实现它**（并且 `#measuredBytes()` 把预留额的方向说反了）；**N5 的回滚在真正需要它的那一类失败上不会触发，因为宿主把写盘错误吞掉了**（探针实测：`update()` 在文件没写成的情况下照样 resolve）。**

**本轮新发现：3 条**（1 条中危 + 2 条低危），**另附 3 条文档不同步**。

### 0.2 第二轮 7 条的复核结论

| 编号 | 第二轮的缺陷 | 本轮的修法 | 复核 |
|---|---|---|---|
| **N1** | 差值法把别的程序吃掉的内存记到服务器头上 ⇒ MEM-12 压力阀被架空 | 归因**按剩余额度封顶**：`room_i = max(0, ceiling_i − measured_i)`；差值超过所有 growers 的 room 之和 ⇒ **整轮作废**；否则按 room 比例分摊 | ⚠️ **只修好了被复现的那一个场景**。被复现的场景（别的程序吃 7 GB > room 1.4 GB）现在确实作废、阀门确实释放（探针 A ✓）；但**差值落在额度内时原样记账**（探针 C/D/E ✗）—— 见 §2.1 |
| **N2** | 起服路径不钳 `measured`、复测路径钳 ⇒ 两个算法；被误记的会话踢出 growers、账转嫁给无辜会话 | 两条路径统一：**去掉钳位**，由「额度封顶 + 按比例分摊」保证 `attributed_i ≤ room_i`；growers 判据改成 `room_i > 0` | ✅ **真修好**。两条路径现在都是「一条规则」，钳位彻底消失，不会再有会话越过自己的上限 |
| **N3** | 「总和精确 / 结论可靠」不成立（钳位截断的部分永久丢失） | 注释与文档改成事实：归因被额度封顶、`measured` 是真实增长的**上界**、`reserved` 是余量的**下界**、`available` 是**上界** | ⚠️ **主体修好了，但新引入一处不成立的承诺**：「总和精确 / 结论可靠」确实删掉了 ✓，可同一批注释与 L7 改成了「压力阀**同时**盯 `availableBytes` 与**裸 `freeBytes`**」——**代码里没有这个东西**（见 §2.2） |
| **N4** | 面板注释声称有一行 `"measured"`，面板没有这一行 | 注释改成事实：已用掉的内存**没有单独一行**（已被机器的空闲内存扣掉），「已预留」既不是用量也不是上限 | ✅ **真修好**（`src/client/Workbench.jsx:449-452`），并配了一条词法守卫用例 |
| **N5** | 设置写盘失败被 `.catch(() => {})` 静默吞掉 | 两组 map 的写入统一到一个 helper：乐观更新 → 写失败时**回滚内存态** + `console.warn` 记日志 | ⚠️ **客户端侧修好了，宿主侧没修**。宿主**拒绝**调用时回滚与日志都成立（用例覆盖的正是这一种）；但**文件写失败**时宿主把错误吞掉、照常回 `ok:true` ⇒ 客户端的 `.catch` **根本不会触发** ⇒ 无回滚、无告警、决定静默丢失（探针实测，见 §2.3） |
| **N6** | 第一轮 A4 的「实测」证据无效 | 在第一轮报告的 A4 节加更正块：结论由代码走查成立，第二轮补上正确实测 | ✅ **真修好**（更正块已落盘） |
| **N7** | 两包文档镜像仍断；工作区多一份未提交的 Java 方案文档 | 记录在案（§9 的 L3），未修 | ⚠️ **未修**，且**差距比记录的更大**：web 包的 `docs/prd/v5.1/` 下只剩一份 `PRD-v5.1.md`，实施契约 / 实施进展 / 两份检视报告**一份都没有**（见 §3.3） |

### 0.3 本轮新发现

| 编号 | 严重度 | 缺陷 | 位置 | 归因 |
|---|---|---|---|---|
| **R1** | **中** | **N1 的残余**：差值落在额度内时，别人的内存**整笔记到服务器头上** ⇒ `available` 是真实值的**上界** ⇒ 压力阀与闸门仍然被架空（实测：持续渗漏下账目恒为 1552 MB，真实可用掉到 −48 MB，阀门一次没触发） | `src/host/lsp.js:3602-3635`（起服）、`:3686-3762`（复测）、`:2805-2812`（账目） | **第二轮未闭合的残余**（机制是差值法固有的） |
| **R2** | 低 | 三处注释 + 实施进展 L7 承诺「压力阀同时盯裸 `freeBytes`」——**代码明确拒绝实现它**；且 `#measuredBytes()` 把预留额的方向**说反了** | `src/host/lsp.js:2627-2633`、`:3680-3681`、`:4234-4254`；`PRD-v5.1-实施进展.md:609` | **本轮引入** |
| **R3** | 低 | 宿主把设置文件的**写盘错误吞掉** ⇒ N5 的回滚在真正需要它的那类失败上不会触发 ⇒ 用户的决定静默丢失 | `src/host/settings-store.js:341`；客户端 `src/client/store.js:1644-1657` | 既有（宿主侧），本轮把 N5 挂在它上面 |

### 0.4 总体判断

**这一轮的工程判断力比上一轮强：它没有硬凑一个"看起来更安全"的公式，而是把归因的上界明确写进了模型（额度封顶），并诚实地承认"死条件比没有条件更坏"、把不变量写进注释。这三件事都是对的。**

**但它犯了一个典型的错误：把"我复现的那一个场景修好了"当成了"这一类缺陷修好了"。**

第二轮 N1 的原文是「**差值法把别的程序吃掉的内存记到服务器头上**」—— 一个**类别**，不是一个场景。本轮的修法对**类别**做了一个精确的刻画：

> 差值 > 所有服务器的剩余额度之和 ⇒ 那部分一定不是服务器的 ⇒ 整轮作废。

而这个判据只覆盖了 **F > Σroom** 的情形。**F ≤ Σroom** 时（别的程序吃掉的那部分塞得进额度），差值**照样整笔记到服务器头上**。这不是边角情况，它正是「别的程序稳定地吃掉一点内存」时的常态——而 §7.4.3 的 P9 探针恰恰自己演示了这一点（`P9c: 差值落在额度内，仍然照记: measured 600 → 1100`），**记录里承认了这个行为，却没有意识到它就是残余缺陷本身**。

更要紧的是，这个残余**在差值法的框架内不可闭合**，而且可以写成一行不变量：

```
Σreserved_account = Σceiling − Σmeasured_account = Σceiling − (G + F) ≤ Σceiling − G = Σreserved_true
⇒ available_account = free − Σreserved_account ≥ free − Σreserved_true = available_true
```

⇒ **账目的可用内存永远是真实值的上界**（只会偏乐观，不会偏保守），误差恰好等于被归错的那部分 F。作废规则只是把 **F > Σroom** 时的那部分误差清零；**F ≤ Σroom** 时，误差原封不动。

---

## 1. 修复复核（逐条）

### 1.1 N2【已修好】两条路径终于是一条规则

钳位在两条路径上都消失了：

```js
// src/host/lsp.js:3640 —— 新增的判据
#capacityOf(session) {
  return Math.max(0, session.ceilingBytes - session.measuredBytes)
}
```

```js
// src/host/lsp.js:3736-3740 —— 复测路径：按额度比例分摊，天然不越界
for (const grower of growers) {
  const attributed = Math.floor(delta * grower.room / capacity)
  grower.session.measuredBytes += attributed
  grower.session.reservedBytes = Math.max(0, grower.session.ceilingBytes - grower.session.measuredBytes)
}
```

因为 `Σattributed ≤ delta ≤ Σroom`，**每个会话都不可能越过自己的上限**，钳位不再需要；growers 的判据也从「`measured < ceiling`」改成「`room > 0`」（`:3711-3718`）——这才是 growers 这个概念真正要表达的东西。

**两条路径的一致性也核对过**：

| | 起服窗口（`#measureFootprint`） | 复测一轮（`#remeasure`） |
|---|---|---|
| 判据 | `delta ≤ capacity`（**本会话自己**的额度） | `delta ≤ capacity`（**所有 growers**的额度之和） |
| 记账 | `measured = delta` | `measured += attributed` |
| 不越界 | `delta ≤ ceiling − measured_old`，而起服时 `measured_old = 0`（`#releaseReservation` 在每次结束时清零，`src/host/lsp.js:2690-2695`）⇒ `measured ≤ ceiling` | `attributed ≤ room` ⇒ `measured ≤ ceiling` |

⇒ **两个口径确实是同一条规则**（差值必须塞得进被归因者的额度），只是「塞得进谁的额度」在两条路上不同（起服是单台，复测是全体），这是对的。

---

### 1.2 N3【主体修好，但新引入一处不成立的承诺】

**对的部分**：「总和精确」「结论可靠」这两句确实删掉了，实施进展 A1 行与 L7 都改成了事实描述：

> 「差值**只算一次**、按剩余额度分摊；第二轮再加一条：**差值超出这些会话的剩余额度时整轮作废**」

而 `#remeasure` 的新注释写得相当准确（`src/host/lsp.js:3676-3681`）：

> 「the measured value is then an UPPER bound of the real growth of the servers, the reservation an LOWER bound of their room, and the available memory an UPPER bound - too optimistic by the part that belonged to somebody else.」

**这句是对的** —— 它精确地说出了残余缺陷是什么。**问题在于同一段下面三行**（`:3680-3681`）：

> 「That is why the pressure valve (MEM-12) watches the raw free memory of the machine as well: the account cannot be fooled that way.」

**代码里没有这个东西。** 详见 §2.2。

另外，`Math.floor` 带来的舍入（最多 `growers − 1` 字节）不再永久丢失 —— 钳位被去掉了，所以第二轮 N3 说的「截断的部分永久丢失」这个机制已经消失 ✓。

---

### 1.3 N4【已修好】面板注释不再声称有一行不存在的行

```js
// src/client/Workbench.jsx:449-452
 * The memory the running servers have taken already has NO row of its own:
 * it is already subtracted from the free memory of the machine, which is why
 * the panel shows the AVAILABLE memory and not "free minus used". "Reserved"
 * is neither their usage nor their ceiling - it is the room they may still
 * take.
```

并且配了词法守卫用例（`tests/lsp-review-round2.test.mjs`）：断言源码里不再出现 `is reported as "measured"`，且必须出现 `has NO row of its own` 与 `neither their usage nor their ceiling`。

---

### 1.4 N5【客户端侧修好，宿主侧没修】

客户端侧做对了两件事：

1. **两个 map 的写入统一到一个 helper**（`src/client/store.js:1644-1657`），A4 的「一个 patch」因此真的只有一个出口；
2. **写失败时回滚内存态 + 记日志**（`:1648-1656`），`set` 会唤醒订阅者 ⇒ 会话重新读到宿主文档真正的值。

新增用例（`tests/lsp-review-round2.test.mjs`）覆盖了三种情形：写失败回滚（两组 map 各一条）、成功路径不动、注释词法守卫。**断言的是行为不是实现** ✓。

**但它覆盖的是「宿主拒绝调用」**（`hostStub({ failSettings: true })` 返回 HTTP 500）。**真正让 A4 失效的那一类失败 —— 宿主收下了调用、文件却没写成功 —— 走不到客户端的 `.catch`**，因为宿主把错误吞了（§2.3）。

---

### 1.5 N6【已修好】证据更正已落盘

第一轮报告 A4 节加了更正块（`docs/prd/v5.1/PRD-v5.1-代码检视报告-第一轮.md:197-209`），写明了旧探针停在 `idle` 而 `#isWakeable` 只唤醒 `suspended`、结论由代码走查成立、第二轮补上正确实测。**更正得准确、克制** ✓。

---

## 2. 本轮新发现

### R1【中】N1 的残余：差值落在额度内时，别人的内存照样记到服务器头上

**触发条件**：别的程序吃掉的那部分内存 **小于**运行中的服务器们的剩余额度之和（`Σroom`）。这是常态而不是边角：额度是 `ceiling − measured`，一台 2048 MB 上限、实测 600 MB 的服务器有 **1448 MB** 的额度；一次浏览器标签页、Docker 拉镜像、杀毒扫描就足以吃掉几百 MB，而 256 MB 的硬地板比它小得多。

**机制**：差值 `Δ` 塞得进额度 ⇒ 被归因给服务器 ⇒

```
measured_account   = measured_true + F        （F = 别的程序吃掉的量）
reserved_account   = room_true − F
available_account  = free − reserved_account  = available_true + F   ← 偏乐观 F
```

⇒ **误差恰好是 F**，而作废规则只在 `F > Σroom` 时才把它清零。

**探针实测**（`iwb-probe-valve-3.mjs`，生产 `LspManager` + 测试替身；服务器真实占用 600 MB、上限 2048 MB ⇒ 真实额度 1448 MB；硬地板 256 MB）：

| 场景 | 别的程序吃掉 | 复测一轮 | `measured` | `reserved` | `available` | 真实 `available` | 压力阀 |
|---|---|---|---|---|---|---|---|
| **A** | 7000 MB | 跑 | 600（作废前） | 1448 | 0 | −48 | ✅ **释放** |
| **B** | 1400 MB | **不跑** | 600 | 1448 | 152 | 152 | ✅ **释放** |
| **C** | 1400 MB | **跑** | **2000** | **48** | **1552** | **152** | ❌ **不释放** |
| **D** | 1400 MB（**起服窗口内**） | — | **2000** | **48** | **1552** | **152** | ❌ 闸门放行新服务器 |

**B 与 C 是同一台机器、同一份别的程序消耗（1400 MB），唯一的差别是测量轮跑没跑**：

- **B（轮没跑）**：账目还诚实 ⇒ `available = 152 < 256` ⇒ 阀门释放 ✓
- **C（轮跑了）**：差值 1400 ≤ 额度 1448 ⇒ 被归因 ⇒ `measured` 撑到 2000、`reserved` 塌到 48、`available` 虚高到 **1552** ⇒ 阀门**不释放** ✗
  ⇒ **是归因这一步把阀门废掉的，不是机器变好了。**

**D 说明起服窗口有同一个洞**：别的程序在起服窗口吃掉 1400 MB ⇒ 窗口看到的下降是 2000 MB（600 的服务器 + 1400 的别人）⇒ 塞得进 2048 的上限 ⇒ 整笔记在服务器头上 ⇒ `measured = 2000`（真实 600）、`available = 1552`（真实 152）⇒ **闸门（`canIndex`，阈值 651 MB）放行了一台机器根本吃不下的服务器**。

**E —— 最有说服力的一个：持续渗漏。** 别的程序每分钟稳定吃掉 100 MB（每个差值 100 MB，都塞得进额度，于是每一轮都被归因）：

```
round  1: free 2900 MB  measured  700 MB  reserved 1348 MB  available 1552 MB  (the truth 1452 MB)
round  2: free 2800 MB  measured  800 MB  reserved 1248 MB  available 1552 MB  (the truth 1352 MB)
...
round 13: free 1700 MB  measured 1900 MB  reserved  148 MB  available 1552 MB  (the truth  252 MB)   ← 真实值越过地板
round 14: free 1600 MB  measured 2000 MB  reserved   48 MB  available 1552 MB  (the truth  152 MB)
round 15: free 1500 MB  measured 2000 MB  reserved   48 MB  available 1452 MB  (the truth   52 MB)   ← 额度耗尽，开始作废
round 16: free 1400 MB  measured 2000 MB  reserved   48 MB  available 1352 MB  (the truth  -48 MB)   ← 已经超卖
```

⇒ **账目的可用内存在前 14 轮里恒定在 1552 MB**（因为机器的空闲内存和预留额**同步**减少：别的程序吃掉 100，额度也少 100），而真实可用一路从 1452 掉到 −48 MB。**真实值在第 13 轮就越过了 256 MB 的硬地板，阀门一次都没有触发**；第 16 轮时机器已经超卖 48 MB，账目仍然说「有 1352 MB 可用」。

**附带一条可诊断性问题**：额度内的归因**在宿主日志里一个字都没有**（只有作废时才有日志）。C / D / E 三个场景的日志都只有一句无关的 `the re-measurement ... was not conclusive`。⇒ **账目被撑大这件事没有任何痕迹**，只有面板上的「可用」在骗人。

**为什么这一轮选的「第二个条件」救不了它**：实现拒绝加「同时盯裸 `freeBytes`」的理由（`available ≤ free` ⇒ `free < floor ⇒ available < floor` ⇒ 第二个条件恒真）**逻辑上是对的**，但它只覆盖了「机器物理上没内存」那一个方向。本例里机器的空闲内存是 1600 MB（**远高于** 256 MB 的地板），没内存的是「**扣掉服务器还能涨的那部分之后**」—— 裸 `freeBytes` 看这个洞**一样看不见**（§2.2 详述）。

**最小修复方向**（三选一，`available` 与 `measured` 的语义不要再动）：

1. **让压力阀盯「承诺」而不是「账目」（推荐，一行判断，与测量法完全解耦）**
   判据改成「机器的空闲内存已经低于**已经发出去的额度之和**」：`free_now < Σceiling_i` ⇒ 已经超卖 ⇒ 收回一台。
   - 在 A / C / D / E 四个场景里都会触发（E 的第 13 轮起触发）；
   - 在用户的原始场景里**不会**误触发（free 2648 > ceiling 2048）；
   - 在健康机器上不会误触发（free 5952 > ceiling 2048）。
   - **代价**：它不再减去「已经实测占用」那一部分 ⇒ 比现在**更早**触发；多台服务器时 `Σceiling` 很大（3 台 × 2048 = 6144 MB），释放会比预期频繁。这与 MEM-12「宁可早释放」的意图一致，但**需要和规格对齐一次**。

2. **把「可能归错的部分」显式记下来，给阀门用**
   manager 维护一个 `uncertainBytes`（= 上次作废以来被归因的差值总量，也就是账目可能偏乐观的上界），**阀门**用 `available − uncertainBytes`，**闸门**仍用 `available`（否则用户的原症状会回来）。
   - 在 E 场景里：`uncertain = 1400` ⇒ 阀门看到的可用是 152 ⇒ 触发 ✓；
   - 在用户的原始场景里：起服归因了 606 ⇒ 阀门看到的可用是 1206 − 606 = 600 > 256 ⇒ 不触发 ✓（不误伤）。
   - **代价**：同一个快照出现两个口径 —— 这正是第一轮 A2 的教训，**必须写进实施契约**并有单一读取函数，否则两侧会再次各说各话。

3. **换测量方法**（进程级 RSS）：Windows 上 Node 没有便宜的进程级 API，实施进展已论证「每台每轮一个 PowerShell 子进程、50–150 ms」⇒ 现实上不可行，除非只在**起服窗口**用一次（那时只有一台服务器，归因的歧义最小）。

> **建议**：方向 1 与方向 2 可以叠加（方向 1 是与测量法无关的物理下界，方向 2 是把不确定性变成一个可见的量），但**先做方向 1** —— 它一行就能落地，且不引入第二个口径。

---

### R2【低】三处注释与实施记录承诺了一个并不存在的保护

**同一个说法出现在四处，而代码里一处都没有**：

| 位置 | 原文 |
|---|---|
| `src/host/lsp.js:2632-2633`（`#measuredBytes`） | 「…the bound is conservative in the direction that matters for the gate (**the reservation stays big**), and **the pressure valve watches the raw free memory as well** (MEM-12).」 |
| `src/host/lsp.js:3680-3681`（`#remeasure`） | 「That is why the pressure valve (MEM-12) **watches the raw free memory of the machine as well**: the account cannot be fooled that way.」 |
| `src/host/lsp.js:4234-4236`（`#checkMemoryPressure`） | 「- the RAW FREE memory is the PHYSICAL TRUTH: it cannot be fooled by an account that is too optimistic.」 |
| `docs/prd/v5.1/PRD-v5.1-实施进展.md:609`（L7） | 「…这正是压力阀**同时**盯 `availableBytes` 与**裸 `freeBytes`** 的原因（第二轮 N1）」 |

**而 `#checkMemoryPressure` 自己的下半段说的恰恰相反**（`:4244-4254`）：

> 「The two are not checked side by side, because the account is DERIVED from the physical truth… A second condition on the raw free memory **would be dead code today** (the second round of the review asked for it; …). The INVARIANT is what has to hold…」

**代码也只有一条条件**（`:4282`）：

```js
if (resources.availableBytes >= hardFloorBytes) return
```

⇒ **同一份文件里，一处说「压力阀同时盯裸 freeBytes」，另一处说「那个条件今天是死代码，所以不实现」。** 实施进展 §7.4.2 也明确记录了「实现后发现它恒真 ⇒ 删掉那个条件」，**与 L7 直接冲突**。

**另外 `#measuredBytes()` 把方向说反了**：`measured` 是真实占用的**上界** ⇒ `reserved = ceiling − measured` 是余量的**下界** ⇒ 预留额**变小**而不是「stays big」。同一份文件里 `#remeasure` 的注释（`:3676-3678`）写的却是正确的（「the reservation an LOWER bound of their room, and the available memory an UPPER bound」）。

**后果**：纯注释与文档，但它正是第二轮 N4（注释声称有一行不存在的行）的**同类问题**、而且是**这一轮新写的**。更实际的后果是：下一轮维护者会照着注释以为「阀门还有一道裸 freeBytes 的兜底」，从而**低估残余缺陷**（R1）的严重性。

**最小修复方向**：

- `#measuredBytes()` 改成与 `#remeasure()` 一致的表述：「`measured` 是真实占用的**上界** ⇒ `reserved` 是余量的**下界** ⇒ `available` 是**上界**；差值塞得进额度时，那部分可能属于别的程序 ⇒ 账目**偏乐观**」；
- 三处「压力阀同时盯裸 `freeBytes`」改成事实：「压力阀盯的是**账目**（`availableBytes`）；裸 `freeBytes` 只作为**不变量**存在（`available ≤ free` 恒成立），一旦这个派生关系被改掉，必须在这里长出第二个条件」；
- L7 改成同一句话，并与 §7.4.2 的「已拒绝第二个条件」对齐。

---

### R3【低】宿主把写盘错误吞掉了 ⇒ N5 的回滚在真正需要它的那类失败上不会触发

**客户端侧**（`src/client/store.js:1644-1657`）：

```js
void call('settings.update', { patch: { lsp: patch } })
  .catch(error => {
    console.warn('[lsp] the settings of the semantic analysis could not be written:', …)
    this.set({ settings: { ...this.state.settings, lsp: previous ?? {} } })
  })
```

**宿主侧**（`src/host/settings-store.js:339-343`）：

```js
this.value = deepMerge(this.value, patch)
const snapshot = structuredClone(this.value)
this.pending = this.pending.then(() => this.#write(snapshot)).catch(() => {})   // ← 写盘错误在这里被吞掉
await this.pending
return this.value
```

⇒ **文件写失败时，`update()` 照样 resolve**，路由照常回 `{ value }` ⇒ 客户端的 `fetch` 拿到 `ok: true` ⇒ **`.catch` 不会触发 ⇒ 没有回滚、没有告警**。

**探针实测**（`iwb-probe-settings-write.mjs`，直接用生产 `SettingsStore`；把 profile 目录下的 `ide-workbench` 做成一个**文件**，于是写盘必然失败）：

```
the settings file     : …\iwb-probe-settings-EiAYDk\ide-workbench\settings.json
the caller saw a failure : NO - the failure was swallowed by the host
the result               : it resolved: the value carries {"C:\\work\\demo":"build"}
the document on disk     : (the file cannot be read: ENOENT)
```

⇒ **内存里有新值，磁盘上什么都没有**，而且**没有任何一层报告过这件事**。

**后果**：

1. 用户的决定（「这个项目要建索引」/「这个项目用基础模式」）**静默丢失**——本次会话里宿主的内存值是对的（`this.value` 已经合并了），所以**当场看不出问题**；**DSH 下次启动时文件被重新读入，旧值回来**，用户的决定凭空消失。
2. **A4 的不变量（A4 = 两个 map 用一个 patch 写）依然可能分叉**：写盘失败时磁盘上是旧的 `workspaceDefaults`（`'conservative'`）与旧的 `memoryWarnedRoots`，而客户端内存里是新的 ⇒ **重启后两侧又分叉**，正是 A4 要消灭的那个局面。
3. 实施进展 L9 写的是「配置写入失败会回滚」——**只在宿主拒绝调用时成立**（用例模拟的正是这一种）。

**最小修复方向**：

- **宿主侧**：`#write` 的失败必须**冒泡**给调用方。最省事的写法是把 `this.pending` 改成「记录最后一个错误、更新时抛出」：
  ```js
  this.pending = this.pending.then(() => this.#write(snapshot))
  try { await this.pending } catch (error) { this.lastWriteError = error; throw error }
  ```
  （同时保留链不被打断的优点：给链尾补一个 `.catch(() => {})`，但把错误单独记下来。）
- **客户端侧**：宿主拒绝 ⇒ 回滚（现有逻辑 ✓）；宿主接受但**写盘失败** ⇒ 宿主必须以错误码回（`ok: false`），否则客户端无从知晓。
- **兜底**：无论哪一侧，都建议在**宿主**也记一条日志（现在宿主连日志都没有），否则这是三重静默（宿主吞 → 路由回成功 → 客户端不回滚）。

> **附带的次要问题**：客户端的回滚是「把整个 `lsp` 段换回 `previous`」。若在写失败的那一个往返里还有别的代码改了 `lsp` 的别的字段（例如设置页改了 `budgetRatio`），回滚会把那次改动一起抹掉。窗口只有一个 HTTP 往返，严重度低，但回滚更精确的做法是「只回滚本次 patch 动过的那两个 map」。

---

## 3. 文档层面的不同步（不是代码缺陷，但会误导下一轮）

| 编号 | 问题 | 位置 |
|---|---|---|
| **D1** | **L7 与 §7.4.2 互相打架**：L7 说「压力阀**同时**盯 `availableBytes` 与**裸 `freeBytes`**」，§7.4.2 说「实现后发现它恒真 ⇒ **删掉**那个条件、只把不变量写进注释」。代码站在 §7.4.2 一边 ⇒ **L7 描述的是一个不存在的机制**（同 §2.2） | `docs/prd/v5.1/PRD-v5.1-实施进展.md:609` ↔ `:550-556` |
| **D2** | **§7.4.3 引用的探针文件不存在**：记录把 `artifacts/perf-probe-2026-11-01/p9-attribution-and-valve.mjs` 当作 N1 的实测证据（提交信息里也点名了它），但**仓库里没有 `artifacts/` 目录**（`git ls-files artifacts` 为空，`.gitignore` 也没有它），工作区里也搜不到任何 `p9-*` 文件 ⇒ **这段证据无法复现**。同时 P9c 那三行（`measured 600 → 1100`，「差值落在额度内，仍然照记」）**恰好就是 R1 的行为**，记录把它当成正常结果收下了 | `docs/prd/v5.1/PRD-v5.1-实施进展.md:558-575` |
| **D3** | **web 镜像的差距比记录的更大**：§9 的 L3 与 §7.4.2 的 N7 都说「web 变体尚未同步」，但实际情况是 web 包的 `docs/prd/v5.1/` 下**只剩一份** `PRD-v5.1.md`（625 行，SHA256 `F782D034…`），而主包是 823 行（SHA256 `F0EF9E24…`）⇒ **实施契约、实施进展、两份检视报告在 web 包里一份都没有**。本轮新增的第二轮报告与 §7.4 也没有同步 | 两包 `docs/prd/v5.1/` |

> **条数核对**：README 与 §7.4 的标题都写「1 条中危 + 4 条低危」，而第二轮报告列的是 **7 条**（1 中危 + 4 低危 + 2 低危/观察）。§7.4.2 的表格里 7 条都在 ✓，只是标题的数字没算 N6 / N7；而标题里的「**全部复核并修复**」与 N7 那一行的「见 §9 的 L3（**未修**，范围外）」自相矛盾。

---

## 4. 这一轮做得好、值得保留的地方

1. **没有硬凑一个"看起来更安全"的公式**：把归因的上界写成了**额度**（`room_i = max(0, ceiling_i − measured_i)`），这是差值法能给出的最诚实的界。数学上站得住（一个服务器不可能占用超过它剩下的额度）。
2. **钳位被彻底拿掉，两条路径统一成一条规则**：由「额度封顶 + 按比例分摊」保证不越界，而不是靠事后钳位 —— 这消除了第二轮 N2 指出的「同一个量两个算法」，也让 growers 的判据回到它本来的意思（`room > 0`）。
3. **「死条件比没有条件更坏」这个判断是对的**：实现明确拒绝加一个恒真的条件，而是把不变量写进注释，并说明「将来若 `availableBytes` 不再由 `freeBytes` 推出，这个触发条件必须长回第二个条件」。**这是本轮最好的一段工程判断**（虽然 §2.2 指出同一个决定在别处被写成了相反的话）。
4. **作废时基线照样前移**：差值作废后 `free` 仍写进基线，否则每一轮都会作废、永不回血。这个细节是对的，且有注释说明。
5. **N5 的客户端修法是对的**：两个 map 统一到一个 helper、乐观更新 + 失败回滚 + 记日志、`set` 唤醒订阅者让会话重新读到宿主真正的值 —— 结构上把「两处各写各的」变成了「一个出口」。**只是它依赖的那个前提（写盘失败会冒泡）没有成立**（§2.3）。
6. **N4 的注释改得准确**，而且配了**词法守卫用例**（断言源码里不再出现那句话），防回归的做法很干净。
7. **N6 的更正克制而准确**：写明了旧探针走错了分支、结论由代码走查成立、第二轮补上正确实测——**没有把第一轮的报告改得面目全非，也没有含糊过去**。
8. **新增用例是真实行为断言**：`tests/lsp-review-round2.test.mjs`（4 条）、`tests/lsp-memory-measure.test.mjs`（+5）、`tests/lsp-pressure-yield.test.mjs`（+1）。压力阀那条断言的是「**服务器真的被释放**」（`state === 'suspended'`）而不是断言某个 mock 被调用过；「差值落在额度内」那条断言的是**具体数字**。**没有为了让测试变绿而走样**。
9. **提交信息把「一条建议没有采纳」也写进去了**，并给了理由 —— 这种把取舍留在记录里的做法值得保持。

---

## 5. 复现方法与探针说明

本轮四个探针**写在仓库外的临时目录**（`%LOCALAPPDATA%\Temp\`），**没有进仓库**，全部**只读导入生产源码**（`src/host/lsp.js`、`src/host/settings-store.js`、`tests/lsp-fixtures.mjs`），未改动仓库任何文件：

| 探针 | 验证的条目 | 输出要点 |
|---|---|---|
| `iwb-probe-valve-3.mjs` | **R1**（四个场景 + 一个渗漏序列） | A：差值 7000 > 额度 1448 ⇒ 作废、阀门释放 ✓；B：差值 1400 且无复测轮 ⇒ 阀门释放 ✓；**C：差值 1400 + 复测轮 ⇒ `measured 2000` / `reserved 48` / `available 1552`（真实 152）⇒ 阀门不释放 ✗**；**D：起服窗口同样中招 ✗**；**E：每分钟 100 MB 的渗漏 ⇒ 账目恒为 1552 MB，真实可用 1452 → 152 → −48 MB，阀门一次没触发 ✗** |
| `iwb-probe-settings-write.mjs` | **R3** | profile 目录不可写时 `SettingsStore.update()` **resolve**，内存有值、磁盘无文件、零日志 |
| `iwb-probe-valve-2.mjs` | 第二轮 N1 的复现（对照用） | 修复前：`measured 2048` / `reserved 0` / `available 400`（真实 0），阀门不触发 |
| `iwb-probe-clamp.mjs` | 第二轮 N3（对照用） | 钳位截断 452 MB 永久丢失 —— 本轮钳位已去掉，该机制消失 ✓ |

> ⚠️ **探针注意**：宿主模块里的 `ROOTS` 是**模块级**的 ⇒ **不同场景必须用不同的 root 路径**；且宿主 `LspManager` 的 `now` 可注入 ⇒ 用它控制「测量轮 / 压力检查」的先后顺序，才能稳定复现「轮先跑、阀门后看」的竞态。

```sh
# 仓库与提交
git -C dsh-ide-workbench log --oneline -3
git -C dsh-ide-workbench status --short
git -C dsh-ide-workbench diff 4bbfd4c..ed38e4e --stat

# 测试（1051 / 1051）
npm --prefix dsh-ide-workbench test

# 探针（脚本在 %TEMP%，不在仓库）
node "$env:TEMP\iwb-probe-valve-3.mjs"
node "$env:TEMP\iwb-probe-settings-write.mjs"
```

---

## 6. 一句话总结

**第二轮的 7 条里 4 条真修好了（N2 两条路径归一、N4 注释、N6 证据更正、N5 的客户端侧），但 N1 只修好了被复现的那一个场景 —— 差值一旦落在「剩余额度」之内，别人的内存照样整笔记到服务器头上，账目的可用内存因此恒为真实值的上界：实测「持续渗漏」下账目恒为 1552 MB 而真实可用掉到 −48 MB，压力阀一次都没触发（探针 C/D/E）；另查出 2 条低危：三处注释与实施进展 L7 都承诺「压力阀同时盯裸 freeBytes」而代码明确拒绝实现它、且 `#measuredBytes()` 把预留额的方向说反了；宿主把设置写盘错误吞掉使 N5 的回滚在真正需要它的那类失败上不会触发、用户的决定静默丢失。**
