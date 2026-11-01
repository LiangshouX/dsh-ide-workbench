# PRD-v5.1 代码检视报告（第六轮：`55ce1bf` 修复复核）

> **范围**：`3b16214` → `55ce1bf`（1 个提交：`55ce1bf`「judge the running servers by what was measured, not by the account」）。改动 8 个文件，+651 / −21（宿主源码 1 个文件 +49 / −15；测试 3 个文件 +174 / −3；文档 4 个 +428 / −3）。**客户端一行未动** ⇒ `dist/client.js` 不需要重建。
> **基线**：`3b16214`。**对照物**：`docs/prd/v5.1/PRD-v5.1-代码检视报告-第五轮.md`（第五轮结论，本轮的输入）、`docs/prd/v5.1/PRD-v5.1.md`（规格，只读）、`docs/prd/v5.1/PRD-v5.1-实施契约.md`（跨模块接口约定）、`docs/prd/v5.1/PRD-v5.1-实施进展.md`（实施记录）。
> **方法**：读代码 + **实跑验证**。`npm test` 实跑 **1082 项 / 1082 通过 / 0 失败**（第五轮 1078，+4）；仓库内五个探针 `scripts/probes/p7…p11` **全部实跑**（退出码 0）；本轮另写四个探针（写在 `%LOCALAPPDATA%\Temp\`，**不在仓库内**，只读导入生产源码 `src/host/lsp.js`、`src/client/store.js`、`src/client/i18n.js`、`tests/lsp-fixtures.mjs`）复验第五轮的 M1 / M2 / H1，并另做三个定向场景（**实测值为 0 的运行中会话** / **文案在每个区间** / **释放失败时日志** / **客户端的建议文案**）。
> **本次检视未修改任何源码**，本文件与 `docs/prd/README.md` 的索引行是本轮唯一产物。
> **检视日期**：2026-11-02。
> **重点关注**：① M1 的新判据（`measuredBytes === 0`）是不是既关上了第五轮的门、又没有开新门；② M2 的文案是不是在**每个区间**都为真（记录说「按构造为真」）；③ H1 的日志是不是**不再说谎**，以及「不释放」这件事有没有留下痕迹。

---

## 0. 结论

### 0.1 一句话

**第五轮的 3 条：M1 真修好了（判据换成实测值 ⇒ 那台「账目撑满上限但跑得好好的」服务器**照常计账**，第五轮的场景现在**阀门真的释放**；拆除窗口的修复没被改坏；不变式仍恒成立），M2 的修法**方向对但不是「按构造为真」** —— 触发条件判在**字节**上、文案印的是**四舍五入后的 MB**，于是余量落在 **[255.5, 256) MB** 这条 0.5 MB 的带子里时，文案会写「had 256 MB … below the 256 MB floor」（**相等，不是低于**）；H1 真修好了（我把「空闲定时器与压力阀同时触发」这条路径**构造出来了**：日志不再说谎）—— 但它把「阀门想释放却没能释放」这件事**变成了静默**：机器仍然紧张，而日志里**一个字也没有**。另查出 3 条低危：一条 0.5 MB 的**舍入带**、一条**释放失败无声**、一条**客户端把「预算用完」说成「机器内存不足」**（而预算是一个上限，关闭别的程序腾不出预算）；外加实施进展里一个**乱码字符**。**

**本轮新发现：3 条**（全部低危）+ **1 条文档备注**。

### 0.2 第五轮 3 条的复核结论

| 编号 | 第五轮的结论 | 本轮的修法 | 复核 |
|---|---|---|---|
| **M1** | 跳过规则用**账目**的数（`reservedBytes`）判断会话是不是还在跑 ⇒ 别的程序吃的内存刚好把额度吃满时，那台**运行中**的服务器整个不再计账 ⇒ 确认口径退化成裸空闲内存 ⇒ 阀门在真实余量 204 MB（已越过硬地板）时沉默 | 判据换成**实测值**：`measuredBytes === 0` ⇒ 被释放过（或还没测过）⇒ 跳过；「账目撑满上限」的会话 `measured == ceiling > 0` ⇒ **照常计账** | ✅ **真修好**（见 §1.1：第五轮的场景现在**阀门真的释放**；拆除窗口的修复**没被改坏**；不变式仍恒成立）—— 但**开了一扇小门**：实测值为 0 的**运行中**会话仍会被跳过（见 §2.1） |
| **M2** | 文案描述的是另一个条件（触发条件是「余量低于硬地板」，旧文案说的是「空闲内存低于服务器还能再吃的那部分」） | **把数字写进文案**：`pressureDetailOf(template, resources)` 填入快照的余量与地板；用例从**纯词法**改成**语义断言** | ⚠️ **方向对，但「按构造为真」不成立** —— 触发判在字节上、文案印的是舍入后的 MB ⇒ **0.5 MB 的带子**里为假（见 §2.2） |
| **H1** | `#exitIdle` 的三个提前返回不释放任何东西，日志却会说 "was released" | 只有状态真的到了 `suspended` 才写那行 | ✅ **真修好**（我**构造出了**提前返回的路径，日志不再说谎）—— 但**释放失败变成了静默**（见 §2.3） |

### 0.3 本轮新发现

| 编号 | 严重度 | 缺陷 | 位置 | 归因 |
|---|---|---|---|---|
| **N1** | 低 | **文案的舍入带**：触发条件判在**字节**上（`safeAvailableBytes < hardFloorBytes`），文案印的是**四舍五入后**的 MB ⇒ 余量落在 **[255.5, 256) MB** 时，文案写「had 256 MB … below the 256 MB floor」—— **相等，不是低于**。实施记录 §7.7.3 说的「句子**按构造**为真」不成立 | `src/host/lsp.js:254`（`Math.round`） | **本轮引入**（M2 的修法） |
| **N2** | 低 | **释放失败静默**：H1 的修法让日志只在真的释放时写 ⇒ 但「阀门想释放、却因为 `releasing` 而没释放」这条路径**一个字也不留** ⇒ 机器仍然紧张，而操作员**看不到任何东西** | `src/host/lsp.js:4512`（`if (victim.state !== 'suspended') return`） | **本轮引入**（H1 的修法） |
| **N3** | 低 | **客户端把「预算用完」说成「机器内存不足」**：MEM-08 的预算拒绝是一个**配置**问题（Σ 上限的额度用完），但它的 detail 里含 "memory" ⇒ `crashAdviceFor` 把它归到内存那一档 ⇒ toast 写「机器可用内存不足，请关闭其它程序」—— 而**关闭别的程序腾不出预算**（预算是上限，不是空闲内存的函数）⇒ 用户被送到一个**帮不上忙**的地方，而且这次**没有**「详情见诊断面板」 | `src/client/store.js:459`、`src/client/i18n.js:698`/`:1364` | **既有**（MEM-08 与 `crashAdviceFor` 都是更早的改动），**前五轮未报** |
| **N4** | 备注 | 实施进展 §7.7.2 里有一个**乱码字符**：「⇒ **跳��那个会话**」（应为「跳过那个会话」） | `docs/prd/v5.1/PRD-v5.1-实施进展.md:755` | **本轮引入** |

### 0.4 总体判断

**这一轮把两件对的事做对了，而且是这一轮最值得肯定的地方：**

1. **M1 的判据换对了。** 第五轮的结论是「状态是事实、账目是估计」，本轮真的照着做了：**判据换成了实测值**（`measuredBytes === 0`）—— 这是一个**语义上正确**的判据（「没有实测值 ⇒ 它不占内存」），而第五轮那个 `reservedBytes <= 0` 是一个**语义上错误**的判据（「账目说它不占内存」）。**一行改动，把第五轮的门关上了。**
2. **M2 从「词法守卫」升级成了「语义断言」。** 第四轮那条用例只查「旧句没了、新句在」；本轮那条**从文案里取出数字、断言它确实低于地板** ⇒ 用例第一次能守住「这句话是不是真的」。

**但 M2 的实现只做到了一半**：断言是**语义**的，实现却仍然**用四舍五入**把字节变成 MB ⇒ 断言能过的那个场景（余量差得远）与句子会骗人的那个场景（余量贴着地板）之间，还留着一条 **0.5 MB 的带子**。**断言的形状对了，断言的边界没封住** —— 下一轮只要把 `Math.round` 换成 `Math.floor`，那条带子就没有了。

---

## 1. 修复复核（逐条，实跑）

### 1.1 M1【已修好】判据换成实测值

**实现**（`src/host/lsp.js:2681-2700`）：

```js
#safeReservedBytes() {
  let total = 0
  for (const session of this.#sessions) {
    // The criterion is the MEASUREMENT and not the reservation: the
    // reservation is the number of the account, and the account can say
    // "this server has taken its whole ceiling" while the server is
    // running perfectly well and may still take 1448 MB more. ...
    if (session.measuredBytes === 0) continue
    const room = Math.max(0, session.ceilingBytes - session.confirmedBytes)
    total += room
  }
  return total
}
```

**lead 点名的四项，逐条实跑**（探针 `iwb-probe-r6-m1.mjs`，生产 `LspManager`；16 GB 机器、TypeScript、上限 2048 MB、baseline 434 MB、硬地板 256 MB）：

| # | 检验 | 结果 |
|---|---|---|
| ① | 那台运行中的服务器现在**被计账**了吗 | ✅ **第五轮的场景现在正是这样**：两台服务器被别的程序一次吃掉 2896 MB（塞得进额度 ⇒ 记到它们头上 ⇒ `measured` 撑到 2048 = 上限、`reserved = 0`）⇒ **余量 = 1676 MB**（不是裸空闲内存 4904 MB）⇒ **它们照常计账** ✓；随后机器被挤到 3100 MB ⇒ 真实余量 **204 MB**（已越过地板）⇒ **阀门释放** ✓（第五轮这里是沉默的） |
| ② | 拆除窗口里正在死去的服务器**仍然被跳过**（第四轮 N2 没被改坏） | ✅ `#releaseReservation` 把 `measuredBytes` 一起清零 ⇒ 被跳过 ✓；实测：拆除窗口里余量从 **300 MB 升到 1914 MB**，落在窗口里的压力检查**没有**释放健康的服务器 ✓ |
| ③ | 有没有新的漏算（`measured === 0` 但会话其实还在跑） | ⚠️ **有，但很窄**：见 §2.1（实测值为 0 的**运行中**会话会被跳过 ⇒ 它的房间不计账 ⇒ 余量偏大 ⇒ 阀门偏晚触发） |
| ④ | 不变式 `safeAvailableBytes ≤ availableBytes` 是否仍恒成立 | ✅ 三种状态实测：单会话（5786 ≤ 5952）、双会话（3572 ≤ 3904）、复测轮把差值记到服务器之后（2572 ≤ 3904）。**证明也成立**：被跳过的会话对两个口径都贡献 0；被计数的会话 `confirmed ≤ measured` ⇒ `room ≥ reserved` ⇒ `safeReserved ≥ reserved` ⇒ `safe ≤ available` ✓ |

**⑤（③的延伸）新门在哪里**：新判据把「被跳过」与「**没有实测值**」绑在一起 ⇒ 一个**运行中**、但实测值恰好是 0 的会话会被跳过。实测值是 0 只有两条路：
- **被释放过**（`#releaseReservation` 把 `measured` 与 `confirmed` 一起清零）⇒ **正是要跳过的那一类** ✓；
- **起服窗口的测量作废、而该语言的 baseline 是 0** ⇒ `measured = baseline = 0` ⇒ **运行中的会话被跳过** ✗（§2.1）。

⇒ **判据本身是对的**（「没有实测值 ⇒ 它不占内存」），只是「实测值为 0」这一个值同时表示了「被释放过」与「baseline 是 0」两件事。

### 1.2 M2【方向对，但「按构造为真」不成立】数字写进了文案

**实现**（`src/host/lsp.js:237`、`:253-256`、`:357`）：

```js
export const PRESSURE_YIELD_DETAIL = 'the machine had {margin} MB of memory left for the running language servers - below the {floor} MB floor - so the least used one was released to reclaim it (this is not a failure)'

export function pressureDetailOf(template, resources) {
  const margin = Math.round((resources?.safeAvailableBytes ?? 0) / (1024 * 1024))
  const floor = Math.round(Number(resources?.hardFloorMB ?? 0))
  return template.replace('{margin}', String(margin)).replace('{floor}', String(floor))
}
```

**lead 点名的三项，逐条实跑**（探针 `iwb-probe-r6-m2h1.mjs`）：

| # | 检验 | 结果 |
|---|---|---|
| ① | 文案里的数字**就是**快照里的那一个 | ✅ 触发那一刻的快照：`safeAvailableBytes` 与 `hardFloorMB` 原样进文案（实测文案里的地板 = 256 = 快照的地板 ✓）。**注意**：文案里的余量是**决策那一刻**的数，而面板「压力余量」那一行是**当前**的数 ⇒ 释放之后两者会不同（这是对的：文案讲的是那次决策） |
| ② | 这句话在**每个区间**都为真 | ⚠️ **五个区间为真、一个区间为假**：余量 100 MB ✓ / 0 MB ✓ / −600 MB ✓ / 158 MB（机器还有几个 G 空闲）✓ / **255.6 MB ✗**（⇒ 见 §2.2） |
| ③ | 客户端有没有别处还在显示旧的理由 | ✅ 客户端的 i18n 里**没有**旧的理由（旧的「机器内存不足」只存在于 `lsp.crashedMemory`，那是**崩溃/降级**的本地化建议，不是压力释放的理由；压力释放的状态是 `suspended`，不出 toast ⇒ 用户只在诊断面板的「原因」一行看到宿主那句话 ✓）。**但**同一套本地化建议里有一处**说错了话**（见 §2.4） |

### 1.3 H1【已修好】日志不再说谎

**实现**（`src/host/lsp.js:4508-4514`）：

```js
await this.#exitIdle(entry, victim, detail)
// The release may NOT have happened: the idle exit returns early when
// the session was replaced in the meantime or when it is already being
// released. The log may only say that a server was released when it
// really was (review R5, H1).
if (victim.state !== 'suspended') return
```

**我把那条路径构造出来了**（探针 `iwb-probe-r6-m2h1.mjs` 的 H1 段）：一台服务器、`idleTimeoutMs: 100`（空闲定时器很快就会触发）、进程要 3 秒才死 ⇒ 空闲定时器**先**开始释放（`releasing = true`），机器在这 2.5 秒里变紧 ⇒ 压力检查落在窗口里 ⇒ LRU 把**同一台**会话选成受害者 ⇒ `#exitIdle` 因 `releasing` **提前返回**、什么也没释放：

```
  the state before the idle timer: building
  the state after the window: building          ← 没有变成 suspended ⇒ 确实没释放
  the warnings of the host: [... 没有一条提到压力 …]
  >> a line that claims a release: false        ← 日志不再说谎 ✓
  >> any line at all about the pressure: 0       ← …而且一个字也没有（见 §2.3）
```

⇒ **H1 真修好了** ✓（第五轮那条「未能复现」的假设，本轮**构造出来了**，日志不再说谎）。

⇒ **但它把「没释放」变成了静默** ⇒ §2.3。

---

## 2. 本轮新发现

### N1【低】文案的舍入带：余量落在 [255.5, 256) MB 时，文案说「256 MB 低于 256 MB 的地板」

**机制**（`src/host/lsp.js:254`）：

```js
const margin = Math.round((resources?.safeAvailableBytes ?? 0) / (1024 * 1024))
```

**触发条件**判在**字节**上（`:4440` 的 `if (resources.safeAvailableBytes >= hardFloorBytes) return`），而文案印的是**四舍五入后**的 MB ⇒ 余量在 **[255.5, 256) MB** 时，印出来的是 **256** ⇒ 句子变成

> 「the machine had **256** MB of memory left for the running language servers - below the **256** MB floor - …」

⇒ **256 不低于 256** —— 句子在这一段里是**假的**，而这正是 M2 要消灭的那一类句子。

**探针实测**（`iwb-probe-r6-m2h1.mjs` 的 M2 段）：

```
  -- the margin is just below the floor (safeAvailableBytes = 255.6 MB)
     the machine had 256 MB of memory left for the running language servers - below the 256 MB floor - so the least used one was released to reclaim it (this is not a failure)
     the numbers in the text: margin=256 floor=256
     >> is the sentence true? "margin < floor" : false
```

⇒ **命中的概率**：余量是慢慢掉的，第一次触发时它在 [0, 256) MB 里**均匀分布** ⇒ 落进这条 0.5 MB 带子的概率约 **0.2% / 每轮压力**。**严重度低**，但它与 M2 是同一类句子，而且实施记录 §7.7.3 写的是「句子**按构造**为真」—— **这句话本身不成立**，下一轮会照着它相信「不会再有假的句子」。

**最小修复方向（一处）**：余量改用**向下取整** ⇒

```js
const margin = Math.floor((resources?.safeAvailableBytes ?? 0) / (1024 * 1024))
```

⇒ 印出来的余量**永远 ≤ 真实余量** ⇒ 触发条件保证「真实余量 < 地板」⇒ 印出来的余量也 < 地板 ⇒ **句子在每个区间都为真** ✓（`floor` 是单调的，地板那个数是整数，取整不会跨界）。

### N2【低】释放失败静默：机器仍然紧张，而日志一个字也没有

**机制**（`src/host/lsp.js:4512`）：

```js
await this.#exitIdle(entry, victim, detail)
if (victim.state !== 'suspended') return      // ← 提前返回：没有日志，也没有「没有释放」这回事
```

⇒ H1 的修法把「谎报释放」改成了「**什么都不说**」。

**探针实测**（同 §1.3 的 H1 场景）：阀门**确实触发了**（机器在硬地板以下）、LRU **确实找到了受害者**、只是 `#exitIdle` 因 `releasing` 提前返回 ⇒

```
  >> a line that claims a release: false
  >> any line at all about the pressure: 0
```

⇒ **机器还紧着，用户什么也不知道，操作员在日志里什么也看不到。** 而这一类「压力阀触发了却没能释放」的情形**正是最需要留痕的**（它是 MEM-12 失效的第一个征兆）。

**最小修复方向**：把「没释放」也说出来 —— 例如让 `#exitIdle` 返回一个结果（`released: boolean` + 原因），然后：

```js
const outcome = await this.#exitIdle(entry, victim, detail)
if (!outcome.released) {
  this.#ctx?.logger?.warn?.('lsp: the machine is below the hard floor, but %s could not be released (%s)', victim.entry.root, outcome.reason)
  return
}
this.#ctx?.logger?.warn?.('lsp: … the least used language server was released', …)
```

⇒ **「阀门没释放成」与「阀门释放了」同样重要** —— 前者是故障，后者是正常的退让。

### N3【低】客户端把 MEM-08 的「预算用完」说成「机器内存不足」

**机制**（`src/client/store.js:456-461`）：

```js
export function crashAdviceFor(detail, t) {
  const text = typeof detail === 'string' ? detail.toLowerCase() : ''
  if (text.includes('timeout')) return t('lsp.crashedTimeout')
  if (text.includes('memory') || text.includes('out of memory')) return t('lsp.crashedMemory')
  return t('lsp.crashedGeneric')
}
```

⇒ **按关键词分类**。而 MEM-08 的预算拒绝（`src/host/lsp.js:2961` 的 `#budgetRefusal`）说的是：

> 「the memory budget of the language servers is used up (4096 MB of 4096 MB are held by the running servers, and this one would need 2048 MB). **Release a language server, or raise the budget in the settings.**」

⇒ 里面有 "memory" ⇒ 被归到内存那一档 ⇒ toast 变成

> 「语义分析已暂停。**机器可用内存不足。请关闭其它程序，或对该语言改用保守版。**」

**探针实测**（`iwb-probe-r6-advice.mjs`，直接调用生产导出的 `crashAdviceFor`）：

```
 1. the budget of the machine is used up (MEM-08):
    The machine ran out of memory. Close other programs, or use the basic mode for this language.
    机器可用内存不足。请关闭其它程序，或对该语言改用保守版。

 2. the machine is below the hard floor:
    The machine ran out of memory. Close other programs, or use the basic mode for this language.   ← 这一条是对的

 4. the language is switched off:
    The details are in the diagnostics panel.        ← 不含 memory ⇒ 走通用模板
```

⇒ **同一个 toast 里，宿主说的是「抬高预算」，客户端说的是「关闭别的程序」** —— 两句话互相矛盾，而且**关闭别的程序腾不出预算**（预算是 Σ 上限的额度，不是空闲内存的函数）⇒ 用户照着做**没有用**。

**为什么这一条值得报**：它正是 `crashAdviceFor` 自己的注释所警告的那件事（「a toast that blames the memory sends the user to a setting that cannot help」）—— 只是这一次被冤枉的不是「超时」，而是**预算**。而且这次**没有**「详情见诊断面板」这条出路（预算这一档被归到内存档了）。

**最小修复方向**：给 MEM-08 的拒绝一个**专属的关键词**（例如 detail 里带 "budget"），在 `crashAdviceFor` 里加一条 `if (text.includes('budget')) return t('lsp.crashedBudget')`，并在 i18n 里写「语言服务器的内存预算用完了。请释放一台语言服务器，或在设置里抬高预算。」；顺带把「内存不足」这一档的措辞改成**不越权**的（「机器的可用内存不多了」而不是「机器内存不足」）。

### N4【备注】实施进展里一个乱码字符

`docs/prd/v5.1/PRD-v5.1-实施进展.md:755`：

> 第四轮修 N2 时用的判据是 `reservedBytes <= 0` ⇒ **跳��那个会话**。

⇒ 「跳**过**那个会话」的「过」字坏了。纯排版，一分钟的事，顺手记下。

---

## 3. 这一轮做得好、值得保留的地方

1. **M1 的判据换得准**：从「账目说它不占内存」（`reservedBytes`）换成「**它没有被测到**」（`measuredBytes`）—— 前者是**估计**，后者是**事实**（要么被释放过、要么还没测出来）。**一行改动，关上了第五轮的门**，而且**没有**把第四轮的 N2 改坏（拆除窗口实测仍然跳过那台正在死去的服务器）。
2. **M2 把用例从「词法」升级成「语义」**：第四轮那条只查「旧句没了、新句在」；本轮那条**从文案里取出数字、断言它确实低于地板** ⇒ 用例第一次能守住「这句话是不是真的」。**方向的改变比修法本身更值钱**。
3. **M2 的文案把数字写进了句子**：一句关于「条件」的句子（"less … than …"）只能在某个区间为真；一句**带数字**的句子可以在**每个区间**为真 ⇒ 这是根治第五轮 M2 的正确思路（剩下的只是舍入那一处）。
4. **H1 按纪律修了**：第五轮那条「未能复现」的假设，实现没有因为「复现不了」就放着，而是按**机理**（释放之后才说释放了）改了判据 ⇒ **判据是对的**，而且本轮我把那条路径**构造出来了**，日志确实不再说谎。
5. **实施记录把检视的量化补进去了**：§7.7.1 把「每台服务器阀门早 166 MB」这个数字写进了 L10 ⇒ 检视的结论**变成了限制条目**而不是一次性的抱怨。
6. **探针链没有断**：五个探针本轮全部实跑、退出码 0；新增的 `tests/lsp-review-round5.test.mjs` 四条里，M1 那两条断言的是**数字**（`measuredMB = 2048`、`reservedBytes = 0`、`safeAvailableMB = 186`），M2 那条断言的是**从文案里取出来的数字** ⇒ 都是行为，不是拼写。

---

## 4. 未能复现的假设

| 假设 | 机理 | 状态 |
|---|---|---|
| — | 本轮没有留下未复现的假设：第五轮的 H1 **被构造出来了**（§1.3），M1 / M2 都有可复现的场景 | — |

---

## 5. 复现方法与探针说明

本轮四个探针**写在仓库外的临时目录**（`%LOCALAPPDATA%\Temp\`），**没有进仓库**，全部**只读导入生产源码**（`src/host/lsp.js`、`src/client/store.js`、`src/client/i18n.js`、`tests/lsp-fixtures.mjs`），未改动仓库任何文件：

| 探针 | 验证的条目 | 输出要点 |
|---|---|---|
| `iwb-probe-r6-m1.mjs` | **M1** 的四项 | ① 第五轮的场景：那两台「账目撑满上限」的服务器**照常计账**（余量 1676 MB，不是裸空闲 4904 MB）⇒ 机器挤到 3100 MB 时**阀门释放** ✓；② 拆除窗口里余量 300 → **1914 MB**，健康的服务器**保住** ✓；③ 实测值为 0 的运行中会话（baseline 为 0）⇒ **被跳过** ⇒ 机器挤到 300 MB 时阀门**不释放**（真实余量 −1148 MB）✗；④ 不变式三种状态全部成立 ✓ |
| `iwb-probe-r6-m2h1.mjs` | **M2** 的三项 + **H1** | M2：文案里的数字就是快照里的 ✓；六个区间里**五个为真、255.6 MB 那一个为假** ✗；H1：构造出提前返回 ⇒ **不再说谎** ✓，但**一个字也没留** ✗ |
| `iwb-probe-r6-advice.mjs` | **N3**（客户端的建议文案） | 预算用完 ⇒ 「机器可用内存不足。请关闭其它程序…」✗（与宿主自己的理由「抬高预算」矛盾） |
| `iwb-probe-r6-m2h1.mjs`（M2 段） | **M2 ②** 的六个区间 | 余量 100 / 0 / −600 / 158 MB 都为真；**255.6 MB ⇒ 「256 MB … below the 256 MB floor」** ✗ |

> ⚠️ **探针注意**（沿用第三轮起的两条纪律）：
> ① 宿主模块里的 `ROOTS` 是**模块级**的 ⇒ **不同场景必须用不同的 root 路径**；
> ② 宿主 `LspManager` 的 `now` 可注入 ⇒ 用它控制「测量轮 / 压力检查」的先后顺序。

```sh
# 仓库与提交
git -C dsh-ide-workbench log --oneline -3
git -C dsh-ide-workbench status --short
git -C dsh-ide-workbench diff 3b16214..55ce1bf --stat

# 测试（1082 / 1082）
npm --prefix dsh-ide-workbench test

# 仓库内的五个探针（本轮全部实跑，退出码 0）
node dsh-ide-workbench/scripts/probes/p7-reservation-accounting.mjs
node dsh-ide-workbench/scripts/probes/p8-memory-accounting.mjs
node dsh-ide-workbench/scripts/probes/p9-attribution-and-valve.mjs
node dsh-ide-workbench/scripts/probes/p10-pressure-margin.mjs
node dsh-ide-workbench/scripts/probes/p11-confirmed-margin.mjs

# 本轮的四个探针（脚本在 %TEMP%，不在仓库）
node "$env:TEMP\iwb-probe-r6-m1.mjs"
node "$env:TEMP\iwb-probe-r6-m2h1.mjs"
node "$env:TEMP\iwb-probe-r6-advice.mjs"
```

---

## 6. 一句话总结

**第五轮的 3 条里 M1、H1 真修好了 —— M1 的判据换成了**实测值**（第五轮那个场景现在阀门真的释放，拆除窗口的修复没被改坏，不变式仍恒成立），H1 我把那条「提前返回」的路径**构造出来了**、日志确实不再说谎；M2 的方向对（把数字写进句子、用例从词法升级成语义）但**「按构造为真」不成立**：触发判在字节上、文案印的是舍入后的 MB ⇒ 余量落在 [255.5, 256) MB 这条 0.5 MB 的带子里时，文案会写「had 256 MB … below the 256 MB floor」（相等，不是低于）。另查出 3 条低危：**H1 的修法让「阀门想释放却没能释放」变成了静默**（机器仍然紧张而日志一个字也没有）；**客户端把 MEM-08 的「预算用完」说成「机器内存不足，请关闭其它程序」**（而预算是 Σ 上限的额度，关闭别的程序腾不出它 —— 同一句 toast 里宿主说「抬高预算」、客户端说「关闭程序」）；外加实施进展 §7.7.2 里一个乱码字符。**
