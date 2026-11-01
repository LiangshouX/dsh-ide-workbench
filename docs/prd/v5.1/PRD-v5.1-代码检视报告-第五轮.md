# PRD-v5.1 代码检视报告（第五轮：`3b16214` 修复复核）

> **范围**：`7cc7227` → `3b16214`（1 个提交：`3b16214`「bound what the pressure valve believes」）。改动 9 个文件，+931 / −31（宿主源码 1 个文件 +78 / −25；测试夹具与用例 3 个文件 +212 / −2；探针 1 个 +137 / −0；文档 4 个 +504 / −4）。**客户端一行未动** ⇒ `dist/client.js` 不需要重建（上一轮已重建）。
> **基线**：`7cc7227`。**对照物**：`docs/prd/v5.1/PRD-v5.1-代码检视报告-第四轮.md`（第四轮结论，本轮的输入）、`docs/prd/v5.1/PRD-v5.1.md`（规格，只读）、`docs/prd/v5.1/PRD-v5.1-实施契约.md`（跨模块接口约定）、`docs/prd/v5.1/PRD-v5.1-实施进展.md`（实施记录）。
> **方法**：读代码 + **实跑验证**。`npm test` 实跑 **1078 项 / 1078 通过 / 0 失败**（第四轮 1073，+5）；仓库内五个探针 `scripts/probes/p7…p11` **全部实跑**（退出码 0）；本轮另写**六个**探针（写在 `%LOCALAPPDATA%\Temp\`，**不在仓库内**，只读导入生产源码 `src/host/lsp.js`、`tests/lsp-fixtures.mjs`）复验第四轮的 4 条发现，并针对新口径另做定向场景（**灌水的起服窗口** / **干净窗口** / **不变式的三种状态** / **封顶的代价** / **拆除窗口** / **预留额归零的会话** / **没人能释放** / **文案的真假**）。
> **本次检视未修改任何源码**，本文件与 `docs/prd/README.md` 的索引行是本轮唯一产物。
> **检视日期**：2026-11-02。
> **重点关注**：① N1 的封顶是不是把「确认口径」的错误**有界**了，而账目**逐位未变**；② N2 的跳过规则有没有把**账目**的乐观重新引进了确认口径；③ N3 的日志是不是既如实又只说一次；④ N4 的新文案是不是**真的**为真。

---

## 0. 结论

### 0.1 一句话

**第四轮的 4 条：N1 真修好了（确认口径的误差有界了，账目逐位未变，不变式仍恒成立），N3 真修好了（没人能释放时如实说、且一轮只说一次），N2 修好了它要修的那件事（拆除窗口里健康的服务器保住了），但**它用错了判据** —— 用**账目**的数（`reservedBytes`）去决定**确认口径**能不能数这个会话，于是「别的程序吃的内存刚好把服务器的额度吃满」时，那台服务器**整个不再计账** ⇒ 确认口径退化成裸空闲内存 ⇒ **压力阀在已越过硬地板的机器上仍然不释放**（第三轮 R1 的那一类洞从另一扇门回来了）；N4 **没有真修好**：旧的假话被换成了另一句假话 —— 触发条件是「余量（空闲内存减去服务器还能再吃的）低于 256 MB 硬地板」，而新文案说的是「空闲内存低于服务器还能再吃的那部分」，在**余量落在 (0, 256) 这个正常区间里时这句话是假的**（实测：机器还有 1800 MB 空闲，文案说它低于 1614 MB）。**

**本轮新发现：2 条**（1 条中危 + 1 条低危），另附 1 条**未能复现的假设**。

### 0.2 第四轮 4 条的复核结论

| 编号 | 第四轮的结论 | 本轮的修法 | 复核 |
|---|---|---|---|
| **N1** | 确认口径的「确认」本身仍是一次差值测量 ⇒ 起服窗口被灌水时确认口径 ≡ 账目口径 ⇒ 阀门在已超卖的机器上仍不释放 | `confirmed_i = min(起服窗口的下降量, baseline_i)`（TS 434 MB）⇒ 确认口径的误差**有界** | ✅ **真修好**（见 §1.1：灌水时阀门**真的**释放；干净窗口时确认口径**不大于**真实占用；不变式仍恒成立；账目**逐位未变**）—— 但封顶的**代价**（每台服务器最多早放 166 MB）需要有人知道 |
| **N2** | 拆除窗口里正在死去的服务器被按满额上限计账 ⇒ 释放了一台并不需要释放的服务器 | `#safeReservedBytes()` 只数**还持有预留额**的会话 | ⚠️ **修好了它要修的那件事**（拆除窗口里健康的服务器保住了，探针与仓库用例都成立），**但判据用错了** ⇒ 开了一扇新门 —— 见 §2.1 |
| **N3** | 警告写在挑受害者之前 ⇒ 没有受害者时日志却说「已释放」，而且每秒重复一次 | 警告移进释放路径；没人能释放时如实说；一轮压力只说一次（manager 级标志，恢复时清零） | ✅ **真修好**（见 §1.3：文本如实、只说一次、标志会复位） |
| **N4** | 用户看到的理由写着「机器内存不足」，而机器当时还有 1.4 GB 空闲 | 文案改成「用完的是余量（空闲内存减去运行中的服务器还能再吃的那部分）」 | ⚠️ **没有真修好** —— 换成了**另一句同样为假**的话（见 §2.2） |

### 0.3 本轮新发现

| 编号 | 严重度 | 缺陷 | 位置 | 归因 |
|---|---|---|---|---|
| **M1** | **中** | **N2 的跳过规则用错了判据**：它用**账目**的数（`reservedBytes`）决定**确认口径**能不能数这个会话 ⇒ 当别的程序吃的内存**刚好把服务器的额度吃满**时（`measured == ceiling`），那台服务器**整个不再计账** ⇒ 确认口径退化成**裸空闲内存** ⇒ **机器已越过硬地板而压力阀不释放**（实测：真实余量 204 MB < 256 MB 地板，阀门沉默） | `src/host/lsp.js:2669`（`if (session.reservedBytes <= 0) continue`）、`:2842` | **本轮引入**（N2 的修法） |
| **M2** | 低 | **N4 的新文案描述的是另一个条件**：触发条件是「余量 = 空闲内存 − 服务器还能再吃的 **< 硬地板 256 MB**」，而文案说的是「空闲内存**低于**服务器还能再吃的那部分」⇒ 在余量落在 **(0, 256)** 这个**正常区间**里时，文案是假的（实测：空闲 1800 MB > 额度 1614 MB，文案却说相反） | `src/host/lsp.js:237`、`:337` | **本轮引入**（N4 的修法） |

> **本轮新发现只有 2 条** —— 这是五轮里最少的一轮：第四轮的 4 条里 2 条真修好、1 条修法有洞、1 条换汤不换药。

### 0.4 总体判断

**这一轮的两个修法都踩在同一个地方：把「差值法分不清谁长的」这件事从一个口径挪到了另一个口径，而不是消掉它。**

- N1 的封顶是**对的方向**：它承认「起服窗口的下降量是真实占用的**上界**」，于是只信其中不超过一个 baseline 的那部分 ⇒ 确认口径的误差**有界**。这一条我认为是五轮里最扎实的一次修改：它把一个**没有上界**的乐观换成了**有上界**的乐观（≤ 一个 baseline），而且**账目一个字没动**（MEM-05 的验收逐位不变）。
- N2 的跳过规则则是**用错了工具**：要判断「这台服务器是不是正在死去」，正确的判据是**状态**（它是不是在退出），而实现用了**账目**（它是不是还持有预留额）—— 而账目恰恰是 R1 那一系列反复声明「不可信」的那个数（`measured` 是真实占用的上界，别的程序吃的内存会被记到它头上）。⇒ **同一个乐观，从后门又进来了。**

⇒ **下一轮要问的问题应当是**：**能不能不用任何一个「数出来的」量去判断一个会话的状态？**（状态就是状态：`releasing` / `dying` / `exited`。）

---

## 1. 修复复核（逐条，实跑）

### 1.1 N1【已修好】确认口径按典型占用封顶，误差有界

**实现**（`src/host/lsp.js:3704-3730`）：

```js
const { baselineMB } = memoryEstimateOf(session.languageId, session.lsp ?? DEFAULT_LSP_SETTINGS)
const baselineBytes = Math.max(0, baselineMB) * 1024 * 1024
if (delta > MEASURE_NOISE_MAX_MB * 1024 * 1024 && delta <= capacity) {
  session.measuredBytes = delta
  session.confirmedBytes = Math.min(delta, baselineBytes)   // ← 封顶
  return
}
```

**lead 点名的五件事，逐条实跑**（探针 `iwb-probe-r5-n1.mjs`，生产 `LspManager`；服务器上限 2048 MB、TS baseline 434 MB、硬地板 256 MB）：

| # | 检验 | 结果 |
|---|---|---|
| ① | 窗口被灌水时阀门**真的**释放 | ✅ 起服窗口掉了 2000 MB（服务器 600 + 别的程序 1400）⇒ **确认口径 = 0 MB**（账目仍是 852 MB）⇒ 阀门**释放**（仓库探针 `p11` 的 P11a/P11b 同结论） |
| ② | 窗口干净时确认口径**不大于**真实占用（偏保守） | ✅ 窗口掉 600 MB（真实占用 600 MB）⇒ `confirmed = min(600, 434) = 434 MB` ⇒ **确认口径比真实值小 166 MB** ⇒ 余量**偏保守** 166 MB ✓ |
| ③ | 不变式 `safeAvailableBytes ≤ availableBytes` 仍恒成立 | ✅ 三种状态实测：单会话（5786 ≤ 5952）、双会话（3572 ≤ 3904）、复测轮把差值记到服务器之后（2572 ≤ 3904） |
| ④ | 封顶有没有把**账目**也一起改了 | ✅ **没有**：仓库探针 `p8` 逐位不变 —— `free 2648 / 已实测占用 606` ⇒ **`available = 1206 MB`**、`reserved 1442 MB`、`worstCase −842 MB`、`decision tight`；`p8c` 的三个数（3852 / 1804 / 0）与上一轮逐位一致。**账目与规格 MEM-05 的验收都没动** ✓ |
| ⑤ | 有没有新的误伤（起服窗口里服务器真实占用**大于**典型占用时） | ⚠️ **有，但可量化、且方向是保守的**：封顶让确认口径**系统性地**小于真实占用 ⇒ **余量**系统性偏小 ⇒ 阀门**提前**释放。实测的提前量：**每台服务器 166 MB**（真实 600 MB、baseline 434 MB）；**两台服务器 328 MB**（实测阀门在 free = 3480 MB 触发，真实值要到 free = 3152 MB 才触发） |

**⑤ 的量化的细节**（探针 `iwb-probe-r5-threshold.mjs`，16 GB 机器、TypeScript）：

```
  1 台服务器（真实占用 600 MB）:
     the valve fires at free = 1860 MB
     the truth (free - SUM(ceiling - real)) < 256  =>  free < 1704 MB
     >> the valve fires 166 MB earlier than the truth
  2 台服务器（真实占用 600 MB）:
     the valve fires at free = 3480 MB
     the truth  =>  free < 3152 MB
     >> the valve fires 328 MB earlier than the truth
```

⇒ **代价 = Σ(真实占用 − baseline)，每台 TypeScript 约 166 MB**，而 16 GB 机器的整机预算（4 GB）最多容得下**两台** TypeScript ⇒ **整机最多提前约 330 MB**。这个量级可以接受（宁可早释放），但**实施记录里没有这个数字**（L10 只写了「最多高估一个典型占用」）。

> ⚠️ **注意一个容易被忽略的量**：封顶让确认口径**最多**比真实占用**小** `真实占用 − baseline`，而真实占用是**无上界**的（一个大项目真的长到 2 GB ⇒ 确认口径仍记 434 MB ⇒ 余量偏小 1566 MB）。实施记录 L10 写的是「确认口径会低估『服务器真的长了多少』」—— 方向对，但「低估多少」没有上界。**这一档（服务器真长到接近上限）才是提前释放的最大来源。**

### 1.2 N2【修好了它要修的那件事，但判据用错了】拆除窗口里的健康服务器保住了

**实现**（`src/host/lsp.js:2661-2674`）：

```js
#safeReservedBytes() {
  let total = 0
  for (const session of this.#sessions) {
    // A session that holds no reservation holds no memory either: it is
    // on its way out, and the machine has it back (or gets it back in a
    // moment). Its ceiling must not be charged here ...
    if (session.reservedBytes <= 0) continue
    const room = Math.max(0, session.ceilingBytes - session.confirmedBytes)
    total += room
  }
  return total
}
```

**它要修的那件事确实修好了**（仓库探针 `p11` 的 P11c + 仓库用例 `tests/lsp-review-round4.test.mjs:115-155` + 我自己的复现 `iwb-probe-r5-teardown.mjs`）：

```
=== P11c: a server that is on its way out ===
  before the shutdown    : confirmed margin=300 MB (the floor is 256 MB)
  while the other one dies: confirmed margin=1914 MB, state=building
  >> the healthy server was not released: true
```

```
=== 我自己的复现（iwb-probe-r5-teardown.mjs）===
  before the shutdown       : margin=300 MB account=300 MB free=3528 MB state=ready
  during the teardown        : margin=1914 MB account=1914 MB state=ready
  >> the margin did not collapse: true
  after a check in the window: margin=1914 MB state=ready
  >> the healthy server survived: true
```

⇒ 拆除窗口里余量**不塌**（300 → 1914 MB），一次压力检查落在窗口里也**没有**释放健康的服务器 ✓。

**但判据用错了** ⇒ 见 §2.1。

### 1.3 N3【已修好】日志如实、只说一次、标志会复位

**实现**（`src/host/lsp.js:4458-4490`）：

```js
const victim = this.#lruVictim()
if (victim === null) {
  if (!this.#pressureReported) {
    this.#pressureReported = true
    this.#ctx?.logger?.warn?.('lsp: the machine is below the hard floor, but no language server may be released: every session builds its program')
  }
  return
}
...
await this.#exitIdle(entry, victim, detail)
this.#pressureReported = true
this.#ctx?.logger?.warn?.('lsp: the machine is below the hard floor: the confirmed margin is %d MB, the account says %d MB - the least used language server was released', ...)
```

**lead 点名的三件事，逐条实跑**（探针 `iwb-probe-r5-n2.mjs` 的 N3 段与 `iwb-probe-r5-n3flag.mjs`）：

| # | 检验 | 结果 |
|---|---|---|
| ① | 没有受害者时的日志**文本**与**次数** | ✅ 文本是新的、**如实的**那一句（「no language server may be released: every session builds its program」）；**只出现一次**（连跑三次压力检查 ⇒ 1 行）。旧的「was released」在这种情况下**不再出现** ✓ |
| ② | 标志会不会一直不复位 | ✅ **会复位**：标志由「一次发现机器健康的压力检查」清零（`:4413-4417`），而**新会话的第一次检查必然发生**（新会话的 `lastPressureAt` 是空的）⇒ 只要机器在两次事件之间健康过一次，下一轮就会重新报。实测：第一次事件 1 行 → 关掉项目 → 机器恢复 → 新项目 → 机器再紧张 ⇒ **第 2 行出现** ✓ |
| ③ | 释放成功时的日志是不是在**释放之后**写的 | ✅ 是：`await this.#exitIdle(...)` **之后**才写（`:4482-4484`）—— 顺序对了 |

> **一条没复现的假设**（见 §4）：`#exitIdle` 有三个提前返回（会话被换掉 / 状态不对 / `session.releasing === true`），它们**不释放任何东西**却正常返回 ⇒ 日志仍会说「was released」。这是一个**竞态**（空闲定时器与压力阀同时触发），我没能稳定复现 ⇒ 按检视纪律记在假设一节。

### 1.4 N4【没有真修好】换汤不换药 —— 新文案说的是另一个条件

见 §2.2。

---

## 2. 本轮新发现

### M1【中】N2 的跳过规则用**账目**判「会话是不是还在跑」⇒ 确认口径被整台整台地漏掉

**机制**（`src/host/lsp.js:2661-2674`）：

```js
if (session.reservedBytes <= 0) continue
```

而 `reservedBytes` 是**账目**的数：

```js
// :3861（复测路径）
grower.session.reservedBytes = Math.max(0, grower.session.ceilingBytes - grower.session.measuredBytes)
```

`measured` 是**差值法累计**的占用 —— **别的程序吃的内存会被记到服务器头上**（这正是第三轮 R1、第四轮 N1 反复处理的那件事）。于是：

> **`reservedBytes == 0` 有两种完全不同的含义**：
> ① 这台服务器**正在死去**（预留额已还，`#releaseReservation`）—— **要跳过**；
> ② 这台服务器**还在跑**，但**账目**认为它已经吃满了自己的上限（`measured == ceiling`）—— **不该跳过**：它真实占用可能只有 600 MB，它**还能再吃 1448 MB**。

⇒ 规则把 ② 也跳过了 ⇒ **那台服务器的额度一个字节都不计账** ⇒ 确认口径退化成**裸空闲内存**。

**为什么 ② 会发生**：`measured` 只能通过两条路涨到 `ceiling`：
- 起服窗口：`measured = delta`，而 `delta ≤ capacity = ceiling` ⇒ `measured == ceiling` 需要 `delta == ceiling`（2048 MB **整**）；
- 复测轮：`measured += floor(delta × room / capacity)` ⇒ 需要几轮的差值**刚好**加到上限。

⇒ 两者都需要差值**刚好**加到上限，而**差值的大小不由宿主决定**（别的程序吃多少就是多少）⇒ 这个巧合**不由宿主掌控**：一轮差值恰好等于总额度（两台服务器 = 2 × 1448 = 2896 MB）就**一轮**落到了；而一笔**稳定的**小漏记（如每分钟 2 MB）会在 1448 轮之后**必然**落到（每轮各记 1 MB，正好把 1448 MB 的额度吃满）。**这条我把它写成「罕见但不由宿主决定」，而不是「一定会发生」** —— 诚实的说法是：它是一个**概率事件**，而后果是**安全阀彻底失明**，这个交换很不划算。

**探针实测**（`iwb-probe-r5-n2b.mjs`，生产 `LspManager`；16 GB 机器、两台 TypeScript 服务器、真实占用各 600 MB、上限各 2048 MB）：

```
=== N2: the booked difference lands exactly on the ceiling of the servers ===
  after the two spawns: measured=1200 reserved=2896 margin=4572 MB free=7800 MB
  after the loss of 2896: measured=4096 reserved=0 margin=4904 MB free=4904 MB state=building
  >> the reservation of the servers is 0 => they are SKIPPED by #safeReservedBytes
  >> the margin now reads 4904 MB = the free memory (nothing is charged)
  the machine is squeezed to 3100 MB free:
     the confirmed margin = 3100 MB  (the servers are not charged any more)
     the TRUTH            = 204 MB  (3100 - 2 x 1448)  <- below the 256 MB floor
  >> the valve fired? false  (it must: the truth is 204 MB)
```

⇒ **机器的真实余量是 204 MB（已经越过 256 MB 的硬地板），而确认口径读的是 3100 MB ⇒ 压力阀不释放。**

**这正是第三轮 R1 那一类洞**：账目被别的程序的内存撑大 ⇒ 阀门看不见。区别只在于这次撑大的是**账目的 `measured`**，而**确认口径被跳过的那台会话**正好是账目撑得最厉害的那台 ⇒ **两个口径一起失明**。

**为什么这一条比第四轮的 N2 更值得修**：

| | 第四轮的 N2 | 本轮的 M1 |
|---|---|---|
| 触发条件 | **每一次**释放（拆除窗口）都在发生 | 需要差值**刚好**落到上限（罕见，但**不由宿主决定**） |
| 后果 | 多释放一台**健康**的服务器（用户多等一次重建） | **安全阀彻底失明**（机器超卖而无人回收） |
| 方向 | 保守（早释放） | **危险**（不释放） |

⇒ **一次「多释放一次」换来了「该释放时不释放」** —— 这是这一轮里唯一一处**把安全阀换成误伤**的修改。

**最小修复方向（三选一，都不动 `availableBytes` 的语义）**：

1. **用状态判，不用账目判**（推荐）：给会话一个**明确的**「正在退出」标记（`#exitIdle` / `#shutdownEntry` 一进去就置上），`#safeReservedBytes()` **跳过被标记的会话**，其余**一律计账**（哪怕它的 `reservedBytes` 是 0）。这与本轮的整体思路一致：**状态是事实，账目是估计**。
2. **判据换成 `measuredBytes === 0`**：预留额被还回去时 `measured` 也被清零（`#releaseReservation` 两个都清）⇒ `measured == 0` 与「正在退出」同义，而「账目撑满上限」时 `measured == ceiling > 0` ⇒ 不会被跳过。**一行改动**，但它把「还没起服的会话」也排除掉了（那是对的：它还没有内存）。
3. **把「确认口径」与「账目」彻底分开**：确认口径只数**还在跑的**会话（按状态），额度用 `ceiling − confirmed`；不再看任何账目的数。

> **我建议 2**：改动最小，语义也对（「`measured == 0` ⇒ 这台服务器不占内存」）。方向 1 更干净，但要多一个标记与几处置位/清位。

### M2【低】N4 的新文案描述的是**另一个**条件 ⇒ 在正常区间里它是假的

**文案**（`src/host/lsp.js:237`、`:337`）：

```js
export const PRESSURE_YIELD_DETAIL = 'the machine had less memory left than the language servers may still take, so the least used one was released to reclaim it (this is not a failure)'
const PRESSURE_EXIT_DETAIL = 'the machine had less memory left than the language servers may still take, so this one was released to reclaim it (this is not a failure)'
```

**触发条件**（`:4413`）：

```js
if (resources.safeAvailableBytes >= hardFloorBytes) { ... return }
```

其中 `safeAvailableBytes = max(0, freeBytes − Σ(ceiling_i − confirmed_i))`。

⇒ 真正发生的事是：**余量**（空闲内存减去运行中的服务器还能再吃的那部分）**低于硬地板 256 MB**。

⇒ 而文案说的是：**空闲内存**低于**服务器还能再吃的那部分**（`free < Σ(ceiling − confirmed)`）。

**这两个条件不是一回事**：触发区间是 `free ∈ [room, room + 256)` ⇒ 文案为假；只有 `free < room`（余量已经**为负**，机器已经超卖）时文案才为真。

⇒ **而余量落在 (0, 256) 恰恰是阀门第一次触发的常态**（余量是慢慢掉的，掉到 256 以下就触发）。

**探针实测**（`iwb-probe-r5-n2.mjs` 的 N4 段；一台 TypeScript 服务器，额度 = 2048 − 434 = 1614 MB，机器空闲 1800 MB）：

```
  the state: suspended
  the margin was: 1800 MB   the free memory: 1800 MB
  the detail the user reads:
       the machine had less memory left than the language servers may still take, so this one was released to reclaim it (this is not a failure)
  the room of the running server: 2048 - 434 = 1614 MB
  >> the wording claims "less memory left than the servers may still take":
     free (1800 MB) < room (1614 MB) ? false
  >> the trigger is really "free - room < 256 MB"
```

⇒ **机器有 1800 MB 空闲，额度 1614 MB，文案说「空闲内存低于 1614 MB」—— 假的。**

**测试的洞**：`tests/lsp-review-round4.test.mjs:191-201` 是**纯词法**的：

```js
assert.ok(!source.includes('the machine ran out of memory'), 'the message does not claim more than the truth')
assert.ok(source.includes('less memory left than the language servers may still take'), 'it says what actually happened')
```

⇒ 它只断言**旧句子没了、新句子在**，**从来没有检查新句子是不是真的** ⇒ 换一句同样为假的话，测试照样绿。

**最小修复方向**：把文案改成**触发条件本身**，并把**硬地板**写进去（否则读者无法判断「多少算太少」）：

> 「the margin of the machine — its free memory minus what the running language servers may still take — fell below the hard floor of 256 MB, so the least used one was released to reclaim it (this is not a failure)」

（中文侧：`lsp.diagnostics` 那一行已经有「压力余量」这个数，可以直接复用它：「余量（空闲内存 − 运行中的服务器还能再吃的）跌破了 256 MB 的硬地板，最不活跃的一台被释放以把内存还给机器」）

⇒ 另外，**测试应当断言行为而不是拼写**：断言「文案的句子在触发的那台机器上为真」—— 例如断言文案里出现的是**硬地板**（`hard floor`）与**余量**（`margin`）这两个词，且**不**出现「less memory left than …」这种把两个数直接比较的说法。

---

## 3. 这一轮做得好、值得保留的地方

1. **N1 的封顶是五轮里最扎实的一次修改**：它没有再去修差值法，而是**承认**了「起服窗口的下降量是真实占用的上界」这个事实，于是只信其中不超过一个 baseline 的那部分 ⇒ 把一个**没有上界的乐观**换成**有上界的乐观**（≤ 一个 baseline）⇒ 而**账目一个字没动**（MEM-05 的验收逐位不变，我用 `p8` 逐位核过）。
2. **取舍写进了记录**：§7.6.3 用一张表比较了三个方案（直接用下降量 / 用 0 / 按典型占用封顶）并写明**为什么不采纳前两个**（用 0 会把服务器已经用掉的内存又扣一遍）；L10 也把「确认口径会低估服务器真长的那部分」写成了限制条目 ⇒ **限制被记下来了，而不是被藏起来**。
3. **N3 的三件事一次做对**：警告**移进**释放路径（⇒ 释放了才说释放了）、没有受害者时**换一句话**而不是复用那句、并且用 **manager 级标志**把「一轮只说一次」做成了（而不是靠 `lastPressureAt` 那种每会话的节流）⇒ 我实测了三连击只出一行、且标志会复位 ✓。
4. **N3 的标志选在了 manager 级**（而不是会话级）是对的：压力检查是**每会话**跑的，会话级标志会让 N 台服务器说 N 遍。
5. **N2 的方向是对的**（正在死去的服务器不该按满额上限计账），**问题只在判据**：这一条留了明确的可改空间（§2.1 的三个方向里第二个是一行改动）。
6. **探针继续入库**（`scripts/probes/p11-confirmed-margin.mjs`），五个探针本轮**全部实跑、退出码 0** ⇒ 证据链没有断。
7. **新增用例是行为断言**：`tests/lsp-review-round4.test.mjs` 的 N1 那条断言的是「**确认口径的数字**（0 MB）**与**账目的数字（> 256 MB）**同时**成立」，N3 那条断言的是「**日志里恰好一行**且**不含** was released」—— 都是行为，不是实现 ✓。
8. **夹具加了一个好用的钩子**：`tests/lsp-fixtures.mjs` 的 `onSpawn` 让「机器在起服窗口里掉多少」可以由用例决定 ⇒ 第五轮的 N1 用例才写得出来（这是测试替身的一次很好的增强）。

---

## 4. 未能复现的假设

| 假设 | 机理 | 为什么没能复现 | 建议 |
|---|---|---|---|
| **H1**：`#yieldUnderPressure` 在 `#exitIdle` 提前返回时仍会写「was released」 | `#exitIdle`（`:4598`）有三个提前返回：`entry.session !== session`（会话被换掉）、状态不是 `ready`/`building`、`session.releasing === true`（**空闲定时器与压力阀同时触发**，`:4612`）⇒ 三者都**不释放任何东西**却正常返回 ⇒ 随后的日志（`:4484`）仍说「was released」 | 这是一个**竞态**：要用空闲定时器与压力阀在同一瞬间触发才能命中。我试了把压力检查的间隔调成与空闲定时器相同，没有稳定复现 | 把日志挪到 `#exitIdle` **确认释放之后**（例如让 `#exitIdle` 返回一个布尔值），或者让 `#exitIdle` 的三个提前返回各自**说明**为什么没释放 |

---

## 5. 复现方法与探针说明

本轮**六个**探针**写在仓库外的临时目录**（`%LOCALAPPDATA%\Temp\`），**没有进仓库**，全部**只读导入生产源码**（`src/host/lsp.js`、`tests/lsp-fixtures.mjs`），未改动仓库任何文件：

| 探针 | 验证的条目 | 输出要点 |
|---|---|---|
| `iwb-probe-r5-n1.mjs` | **N1** 的五项 | A：起服窗口掉 2000 MB ⇒ 确认口径 **0 MB**（账目 852 MB，真实 −548 MB）⇒ 阀门释放 ✓；B：干净窗口 ⇒ 确认口径 434 MB ≤ 真实 600 MB ⇒ 余量偏保守 166 MB ✓；C：不变式三种状态全部成立 ✓；D：封顶的代价（1 台早 166 MB / 2 台早 328 MB） |
| `iwb-probe-r5-threshold.mjs` | **N1 ⑤** 的精确数字 | 1 台服务器：阀门在 free = 1860 MB 触发（真实值 1704 MB）；2 台：free = 3480 MB（真实值 3152 MB）⇒ **每台服务器早 166 MB** |
| `iwb-probe-r5-n2.mjs` | **N2**（拆除窗口）、**N3**（日志文本与次数）、**N4**（文案） | N4：空闲 1800 MB > 额度 1614 MB，文案却声称相反 ⇒ **新文案在正常区间里是假的** |
| `iwb-probe-r5-teardown.mjs` | **N2 ①**（拆除窗口里健康的服务器） | 拆除窗口里余量从 300 **升到** 1914 MB，落在窗口里的压力检查**没有**释放健康的服务器 ✓ |
| `iwb-probe-r5-n2b.mjs` | **M1** | 两台服务器的额度被一次 2896 MB 的漏记吃满 ⇒ `measured = 4096`、`reserved = 0` ⇒ **两台都被跳过** ⇒ 确认口径 = 裸空闲内存 3100 MB（真实余量 **204 MB**）⇒ **阀门不释放** ✗ |
| `iwb-probe-r5-n3flag.mjs` | **N3 ②**（标志复位） | 第一次事件 1 行 → 关项目 → 机器恢复 → 新项目 → 再紧张 ⇒ **第 2 行出现** ⇒ 标志会复位 ✓ |

> ⚠️ **探针注意**（沿用第三轮起的两条纪律）：
> ① 宿主模块里的 `ROOTS` 是**模块级**的 ⇒ **不同场景必须用不同的 root 路径**；
> ② 宿主 `LspManager` 的 `now` 可注入 ⇒ 用它控制「测量轮 / 压力检查」的先后顺序。

```sh
# 仓库与提交
git -C dsh-ide-workbench log --oneline -3
git -C dsh-ide-workbench status --short
git -C dsh-ide-workbench diff 7cc7227..3b16214 --stat

# 测试（1078 / 1078）
npm --prefix dsh-ide-workbench test

# 仓库内的五个探针（本轮全部实跑，退出码 0）
node dsh-ide-workbench/scripts/probes/p7-reservation-accounting.mjs
node dsh-ide-workbench/scripts/probes/p8-memory-accounting.mjs
node dsh-ide-workbench/scripts/probes/p9-attribution-and-valve.mjs
node dsh-ide-workbench/scripts/probes/p10-pressure-margin.mjs
node dsh-ide-workbench/scripts/probes/p11-confirmed-margin.mjs

# 本轮的五个探针（脚本在 %TEMP%，不在仓库）
node "$env:TEMP\iwb-probe-r5-n1.mjs"
node "$env:TEMP\iwb-probe-r5-threshold.mjs"
node "$env:TEMP\iwb-probe-r5-n2.mjs"
node "$env:TEMP\iwb-probe-r5-n2b.mjs"
node "$env:TEMP\iwb-probe-r5-n3flag.mjs"
node "$env:TEMP\iwb-probe-r5-teardown.mjs"
```

---

## 6. 一句话总结

**第四轮的 4 条里 N1、N3 真修好了（N1 把确认口径的错误**有界**了而账目逐位未变、不变式仍恒成立，代价是每台服务器最多早放 166 MB；N3 的日志如实、只说一次、标志会复位），N2 修好了它要修的那件事（拆除窗口里健康的服务器保住了）**但判据用错了** —— 它用**账目**的数去决定**确认口径**能不能数这个会话，于是别的程序吃的内存**刚好把服务器的额度吃满**时那台服务器整个不再计账，确认口径退化成裸空闲内存，**机器已越过硬地板而压力阀不释放**（实测真实余量 204 MB，阀门沉默）；N4 **没有真修好**：旧的假话被换成另一句假话 —— 触发条件是「余量低于 256 MB 硬地板」，新文案说的是「空闲内存低于服务器还能再吃的那部分」，在余量落在 (0, 256) 这个正常区间里它是假的（实测空闲 1800 MB > 额度 1614 MB，文案说相反），而那条用例是纯词法的、从来没有检查新句子是不是真的。**
