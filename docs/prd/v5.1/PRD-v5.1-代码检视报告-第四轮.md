# PRD-v5.1 代码检视报告（第四轮：`7cc7227` 修复复核）

> **范围**：`ed38e4e` → `7cc7227`（1 个提交：`7cc7227`「let the pressure valve count the footprint it can confirm」）。改动 19 个文件，+2569 / −80（源码 6 个文件 +300 / −59；测试 3 个文件 +783 / −0；探针 4 个 +940 / −0；文档 5 个 +501 / −9；`dist/client.js` +45 / −9）。
> **基线**：`ed38e4e`。**对照物**：`docs/prd/v5.1/PRD-v5.1-代码检视报告-第三轮.md`（第三轮结论，本轮的输入）、`docs/prd/v5.1/PRD-v5.1.md`（规格，只读）、`docs/prd/v5.1/PRD-v5.1-实施契约.md`（跨模块接口约定）、`docs/prd/v5.1/PRD-v5.1-实施进展.md`（实施记录）。
> **方法**：读代码 + **实跑验证**。`npm test` 实跑 **1073 项 / 1073 通过 / 0 失败**（第三轮 1051，+22）；仓库内四个探针 `scripts/probes/p7…p10` **全部实跑**（退出码 0）；本轮另写五个探针（写在 `%LOCALAPPDATA%\Temp\`，**不在仓库内**，只读导入生产源码 `src/host/lsp.js`、`src/host/settings-store.js`、`tests/lsp-fixtures.mjs`）复验第三轮的 3 条发现 + 文档 3 项，并针对新口径另做四个定向场景（**起服窗口** / **不变式的六种状态** / **拆除窗口** / **没有受害者**）。
> **本次检视未修改任何源码**，本文件与 `docs/prd/README.md` 的索引行是本轮唯一产物。
> **检视日期**：2026-11-02。
> **重点关注**：① R1 的「确认口径」是不是把差值法的洞**真的**堵上了；② 新口径带来的不变式在**所有**状态下是否成立；③ 新口径有没有带来**新的误伤**（阀门提前释放）；④ R3 的回滚在真正需要它的那一类失败上会不会真的触发；⑤ 文档与源码是否还有自相矛盾。

---

## 0. 结论

### 0.1 一句话

**第三轮的 3 条新发现 + 3 条文档项：R2、R3、D1、D2、D3 全部真修好；R1 修好了它自己复现的那一类（每分钟复测窗口的漏记），但**又留了一个同族的口子 —— 起服窗口**：确认口径的「确认」本身仍然是一次差值测量，别的程序在起服窗口里吃掉的内存照样整笔记到服务器头上，于是**确认口径 ≡ 账目口径**，压力阀在那台机器上仍然不释放（实测：机器已超卖 548 MB，阀门一次没触发）。另外新查出 3 条：**拆除窗口**让阀门释放一台**并不需要**释放的服务器（新口径的误伤 —— 拆除的窗口最长 2.5 秒，而压力检查每秒一次）；**日志在说「已释放」的时候其实什么也没释放**；以及**用户看到的理由写着「机器内存不足」，而机器当时还有 1.4 GB 空闲**。**

**本轮新发现：4 条**（2 条中危 + 2 条低危），**文档项无**。

### 0.2 第三轮 6 项的复核结论

| 编号 | 第三轮的结论 | 本轮的修法 | 复核 |
|---|---|---|---|
| **R1** | 差值落在额度内时，别人的内存整笔记到服务器头上 ⇒ `available` 是真实值的上界 ⇒ 压力阀被架空 | 压力阀改看**确认口径**的余量 `safeAvailableBytes = free − Σ max(0, ceiling_i − confirmed_i)`；`confirmed_i` 只在**起服窗口**实测，每分钟复测的归因**不计入** | ⚠️ **修好了它自己复现的那一类**（每分钟复测窗口），**起服窗口的同一个洞还在**（第三轮的场景 D）—— 见 §2 的 **N1** |
| **R2** | 三处注释 + L7 承诺「压力阀同时盯裸 `freeBytes`」而代码明确拒绝实现；`#measuredBytes()` 把方向说反 | 四处改成事实：阀门看的是确认口径；裸 `freeBytes` 只作为不变量存在；`measured` 是真实占用的**上界** ⇒ 预留额是余量的**下界** ⇒ 账目偏乐观 | ✅ **真修好**（四处都核对过；`src/host/lsp.js:2604`、`:2667`、`:3760-3768`、`:4337-4347` + `实施进展.md` 的 L7），且配了词法守卫用例 |
| **R3** | 宿主把设置写盘错误吞掉 ⇒ N5 的回滚永不触发 ⇒ 用户的决定静默丢失 | 宿主 `update()` **reject**、内存不留没有落盘的值、写队列不被一次失败打断、宿主记日志；客户端回滚**只回滚本次 patch 的两个 map** | ✅ **真修好**（宿主 5 项 + 客户端 3 项都实跑复验，见 §1.3） |
| **D1** | L7 与 §7.4.2 互相打架 | L7 改成与 §7.5 一致的话 | ✅ **真修好**（`实施进展.md:699`） |
| **D2** | §7.4.3 引用的探针文件不存在，证据无法复现 | 四个探针**入库**（`scripts/probes/p7…p10`），PRD 头部的「实测基线」也改成指向它们 | ✅ **真修好**（四个探针本轮**全部实跑**，退出码 0） |
| **D3** | web 镜像的文档差距比记录的更大 | L3 如实记下（web 包 `docs/prd/v5.1/` 下只剩一份 `PRD-v5.1.md`，实施契约 / 实施进展 / 三份检视报告都没有），并写明「本轮不修」的理由 | ✅ **真修好**（记录准确；本轮按约定不修） |

### 0.3 本轮新发现

| 编号 | 严重度 | 缺陷 | 位置 | 归因 |
|---|---|---|---|---|
| **N1** | **中** | **R1 的同族残余**：确认口径的「确认」本身是**一次差值测量** —— 别的程序在**起服窗口**里吃掉的内存照样整笔记到服务器头上 ⇒ 确认口径 ≡ 账目口径 ⇒ 压力阀在**已经超卖**的机器上仍然不释放（实测：超卖 548 MB，阀门一次没触发） | `src/host/lsp.js:3683-3691`（`confirmedBytes = delta`）、`:3667-3669`（那句「可以信任」的注释） | **R1 的残余**（与第三轮的场景 D 同一个机制） |
| **N2** | **中** | **新口径的误伤**：拆除一台服务器时 `#releaseReservation` 把 `confirmedBytes` 清零，而 `ceilingBytes` 要等进程真的死掉才清零 ⇒ 确认口径在**最长 2.5 秒**的窗口里把一台**正在死去**的服务器按**满额上限**计账 ⇒ 余量凭空少掉它的确认占用 ⇒ 阀门释放了一台**并不需要**释放的服务器 | `src/host/lsp.js:2726-2733`、`:2643-2651`、`:4863-4884`、`:4915-4923` | **本轮引入**（新口径） |
| **N3** | 低 | 阀门的那条警告写在**挑受害者之前** ⇒ 没有受害者时（所有会话都在构建 program，CONC-03 规定构建期**永不**让位）日志说「最不活跃的语言服务器被释放」，而**什么也没释放**，机器仍然超卖 | `src/host/lsp.js:4382-4387` | **本轮引入** |
| **N4** | 低 | 用户看到的释放理由仍写着「机器内存不足」，而新口径下阀门可以在机器还有 **1.4 GB 空闲**时释放（服务器真长了内存那一档，L10 记了代价，但**没改这句话**） | `src/host/lsp.js:230`、`:329`、`:4433`；`src/client/Workbench.jsx:1317-1322` | **本轮引入**（触发条件改了，文案没跟上） |

### 0.4 总体判断

**这一轮的方向是对的，而且比上一轮更诚实**：它没有再去修差值法（那条路在框架内不可闭合），而是**让不确定的那部分不许影响安全阀** —— 把「测量」与「确认」分成两个口径，一个给闸门和面板（问的是「下一个服务器能不能起」），一个只给阀门（问的是「机器还撑得住吗」）。这个分工是本轮最好的工程判断，**不变式 `safeAvailableBytes ≤ availableBytes` 在我实测的六种状态下全部成立**（单会话 / 双会话 / 复测轮之后 / 全新起服 / 崩溃之后 / 重启之后），「触发只会更早不会更晚」这句话是站得住的。

**但它犯了一个和上一轮同型的错误**：把「我修的那个场景」当成了「这一类」。R1 的机制是「差值法分不清谁长的」；确认口径**仍然是差值法的一次测量** —— 只是把窗口从**一分钟**缩到**几秒**。于是**起服窗口保留了同一个洞**，而代码里恰恰写着「起服窗口是可以信任的最后一次测量」（`src/host/lsp.js:3667-3669`）：**它把一个假设写成了事实**。

**另一件值得记下的事**：新口径带来了一类**上一轮不存在的误伤**（N2）。上一轮阀门看的是账目，而账目在拆除窗口里只会**变大**（预留额已经还回去了）⇒ 不会误触发；这一轮阀门看的是确认口径，而确认口径在拆除窗口里会**变小** ⇒ 会误触发。**换口径不是换一个数，是换一整套时序** —— 这条经验值得写进实施记录。

---

## 1. 修复复核（逐条，实跑）

### 1.1 R1【修好了复测窗口，起服窗口的洞还在】压力阀改看「确认口径」

**实现**（`src/host/lsp.js`）：

```js
// :2643-2651  —— 确认口径的预留额
#safeReservedBytes() {
  let total = 0
  for (const session of this.#sessions) {
    const room = Math.max(0, session.ceilingBytes - session.confirmedBytes)
    total += room
  }
  return total
}

// :2818  —— 快照里的第二个数
const safeAvailableBytes = Math.max(0, freeBytes - this.#safeReservedBytes())

// :4378  —— 阀门改看它
if (resources.safeAvailableBytes >= hardFloorBytes) return
```

**核对过的五件事**（第三轮与 lead 点名的）：

| # | 检验 | 结果 |
|---|---|---|
| ① | 差值落在额度内时阀门**真的**释放 | ✅ 仓库探针 `p10-pressure-margin.mjs` 的 P10a/P10b：持续渗漏下阀门**在第 6 轮释放**（真实值第 6 轮越过 256 MB 地板）—— **与真实同一轮**；修复前是 8 轮一次没触发 |
| ② | 健康的机器**不**被误释放 | ✅ P10c：8000 MB 空闲的机器吃掉 1400 MB 后，账目 5952 MB、确认口径 4552 MB，服务器**原样不动** |
| ③ | 不变式 `safeAvailableBytes ≤ availableBytes` 恒成立 | ✅ **我实测的六种状态全部成立**：单会话（6952 ≤ 6952）、双会话（4904 ≤ 4904）、复测轮把差值记到服务器之后（3904 ≤ 4904）、全新起服、**崩溃之后**、**重启之后**（`confirmedBytes` 在新的起服窗口里重新实测） |
| ④ | 账目口径**没有被这次改动影响** | ✅ `p8-memory-accounting.mjs` 实跑：MEM-05 的验收逐位不变 —— `free 2648 / 已实测占用 606` ⇒ **`available = 1206 MB`**；`worstCase = −842 MB`；`reserved 1442 MB`。闸门、面板、弹窗、宿主文案仍读账目 |
| ⑤ | 有没有**新的**误伤 | ⚠️ **有** —— 见 §2 的 **N2**：拆除窗口里的**假释放**。多台服务器时 `Σ(ceiling − confirmed)` 本身不会额外压低余量（确认口径与账目在正常情况下**相等**），所以「`Σceiling` 很大」不是新的问题源 |

**不变式的证明**（我核过，写在这里供下一轮引用）：

```
confirmed_i ≤ measured_i                    （confirmed 只在起服窗口定下，之后只增不减）
⇒ ceiling_i − confirmed_i ≥ ceiling_i − measured_i
⇒ Σ safeReserved ≥ Σ reserved
⇒ max(0, free − safeReserved) ≤ max(0, free − reserved)
```

⇒ 确认口径 ≤ 账目口径，恒成立 ✓。**唯一可能破坏它的地方是 `confirmed_i > measured_i`**，而代码里唯一的赋值点（`:3690`、`:3697`）都保证 `confirmed = measured`（起服时）或 `confirmed ≤ measured`（之后只增 `measured`）⇒ 不变式在代码层面也成立。

### 1.2 R2【已修好】注释与记录不再承诺不存在的保护

四处都改成了事实：

| 位置 | 现在的说法 |
|---|---|
| `src/host/lsp.js:2600-2606`（`#reservedBytes`） | 「the pressure valve does NOT use this number - it uses the confirmed one (`#safeReservedBytes`), which a difference that may belong to another program cannot inflate」 |
| `src/host/lsp.js:2663-2670`（`#measuredBytes`） | 「the measured value is too big, the reservation is too small, and the account is too generous」—— **方向说对了** |
| `src/host/lsp.js:3760-3768`（`#remeasure`） | 「the pressure valve (MEM-12) does NOT watch the account - it watches the CONFIRMED margin of the machine」 |
| `src/host/lsp.js:4320-4347`（`#checkMemoryPressure`） | 整段重写：触发条件是确认口径；「One number, one trigger, and the pessimistic one」 |
| `docs/prd/v5.1/PRD-v5.1-实施进展.md:699`（L7） | 「第三轮 R1：**压力阀不再看账目**，它看**确认口径**的余量（`safeAvailableBytes`）… 闸门与面板仍然看账目」 |

**残留扫描**：全仓 `grep` 「raw free」「watches the raw」「free memory as well」「reservation stays big」⇒ 只剩 `:3752` 的一处「the reservation stays big」，而那一处说的是**作废**的情形（差值塞不进额度 ⇒ 整轮作废 ⇒ 预留额保持不变 ⇒ 闸门更严）—— **那句话是对的**，不是第三轮指出的那个方向错误。词法守卫用例（`tests/lsp-review-round3.test.mjs:176-196`）锁住了源码与实施记录两处 ✓。

### 1.3 R3【已修好】写盘失败会冒泡，客户端的回滚真的跑得起来

**宿主侧**（`src/host/settings-store.js:359-388`）：

```js
const written = this.pending.then(async () => {
  const next = deepMerge(this.value, patch)      // 合并在轮到它时才做
  await this.#write(structuredClone(next))
  this.value = next                             // 落盘之后内存才跟上
})
this.pending = written.catch(() => {})           // 队列不被一次失败打断
try { await written } catch (error) { this.#reportWriteFailure(error); throw error }
```

**我实跑的五个场景**（探针 `iwb-probe-r4-settings.mjs`，生产 `SettingsStore`，临时 profile 目录）：

| # | 场景 | 结果 |
|---|---|---|
| 1 | 写盘失败 | ✅ **reject** 给调用方（`EISDIR: illegal operation on a directory …`）；**内存没有**留下没落盘的值（`workspaceDefaults` 仍是 `{}`）；磁盘上**没有**这个文件；宿主**记了日志**（`dsh-ide-workbench: the settings document could not be written: …`） |
| 2 | 失败之后队列还活着吗 | ✅ 第二次写照样失败（而不是挂死）；路通了之后第三次写**落盘成功**；失败的那个 patch **磁盘上没有、内存里也没有** |
| 3 | 三个写同时发 | ✅ 三个 patch **全在磁盘上**（`lastRoot` / `git.path` / `workspaceDefaults` 一个没丢）—— 合并在轮到它时才做，所以第二个写看得见第一个的结果 |
| 4 | 两次好写中间夹一次坏写 | ✅ 后一次好写落盘为 `D:\Code\after`，**内存与磁盘一致** |
| 5 | 路由会不会把失败说成成功 | ✅ `writeError`（`src/host/wire.js:86-87`）把普通 Error 变成 `{"ok":false,"error":{"code":"internal",…}}` ⇒ 客户端的 `call()` **抛** ⇒ `.catch` **跑** ⇒ 回滚**真的**发生 |

**客户端侧**（`src/client/store.js:1650-1671`）：回滚**只回滚本次 patch 动过的那两个 map**，别的字段不动；map 之前不存在时**删掉**（不是留一个空壳）。仓库用例 `tests/lsp-review-round3-client-settings.test.mjs` 覆盖了三种情形（别的字段的改动不被抹掉 / 之前不存在的 map 被删掉 / 成功路径不动），本轮**实跑全绿**。

⇒ **R3 真修好了**：三重静默（宿主吞 → 路由回成功 → 客户端不回滚）变成了「宿主 reject + 路由回错误 + 客户端回滚 + 宿主记日志」。

### 1.4 D1 / D2 / D3【已修好】文档层的三处

| 项 | 核对结果 |
|---|---|
| **D1** | L7（`实施进展.md:699`）现在说的是「压力阀不再看账目，它看确认口径的余量」；§7.4.2（`:551-557`）说的是「第二个条件恒真 ⇒ 删掉，只把不变量写进注释」。**两句不再打架** ✓；§7.5.3 还把「与规格的一处偏差」**写明了**（规格 MEM-12 §3.8 的字面写法是 `availableBytes < hardFloor`，本轮按 R1 收紧成确认口径）—— 这种「规格怎么写、我们为什么这么写」的写法值得保持 |
| **D2** | `scripts/probes/p7…p10` **四个探针都在仓库里**，本轮**全部实跑，退出码 0**；PRD 头部的「实测基线」已改成指向 `scripts/probes/`（`PRD-v5.1.md:8`）✓ |
| **D3** | L3（`实施进展.md:695`）现在如实写着：web 包的 `docs/prd/v5.1/` 下**只剩一份** `PRD-v5.1.md`（625 行，主包 823 行），实施契约 / 实施进展 / 三份检视报告**一份都没有**，并写明「本轮不修」的理由（只补文档会让 web 包描述一套它没有的实现）✓ |

---

## 2. 本轮新发现

### N1【中】确认口径的「确认」本身也是一次差值测量 —— 起服窗口的洞还在

**触发条件**：别的程序在**起服窗口**（服务器 spawn 前读一次 `freemem()`、进程存在后再读一次）里吃掉了内存。

**机制**（`src/host/lsp.js:3675-3691`）：

```js
#measureFootprint(session, freeBefore, freeAfter) {
  const delta = freeBefore - freeAfter
  ...
  const capacity = this.#capacityOf(session)
  if (delta > MEASURE_NOISE_MAX_MB * 1024 * 1024 && delta <= capacity) {
    session.measuredBytes = delta
    // The spawn window is the ONE measurement the pressure valve may
    // trust: the server itself is the main cause of the change, and the
    // window lasts seconds instead of a minute (review R1).
    session.confirmedBytes = delta
    return
  }
```

⇒ **`delta` 仍然是「机器下降了多少」，不是「服务器长了多少」。** 别的程序在这个窗口里吃掉的 1400 MB 被**原样记进 `confirmedBytes`** ⇒ 确认口径与账目口径**完全一样** ⇒ 阀门看到的还是那个乐观的数。

**代码里那句注释就是问题的所在**（`:3665-3669`）：

> 「The bound is not enough on its own, and the reason is worth writing down: a difference that FITS the room of the server may still belong to another program. **The spawn window is the last measurement that can be trusted (the server is the main cause of the change in it)**」

**「服务器自己是那个窗口里的主因」是一个假设，不是事实** —— 而第三轮的场景 D 就是这个假设的反例。

**探针实测**（`iwb-probe-r4-safe.mjs` 的场景 A，生产 `LspManager`；服务器真实占用 600 MB、上限 2048 MB、硬地板 256 MB；起服窗口里机器另外掉了 1400 MB）：

```
=== A: the foreign program eats its memory INSIDE the spawn window ===
  free=900 MB  ceiling=2048 MB
  measured (account) = 2000 MB   reserved = 48 MB
  account  available = 852 MB
  confirmed margin    = 852 MB          ← 与账目一模一样
  the TRUTH (the server really takes 600 MB) = -548 MB
  the machine is oversold by 548 MB
  >> the valve fired? false  (it must fire: the truth is below the 256 MB floor)
```

⇒ **机器已经超卖 548 MB，确认口径仍然是 852 MB，阀门一次都没触发。** 这正是第三轮的场景 D —— 本轮的实现把它**原封不动地留在了起服窗口里**。

**与已修好的那一类的对比**（这是本条最要紧的地方）：

| 别的程序吃内存的时机 | `measured` | `confirmed` | 确认口径 | 真实值 | 阀门 |
|---|---|---|---|---|---|
| **每分钟复测窗口里**（第三轮的 C / E） | 被记高 | **不记** | **真实** | 真实 | ✅ **释放**（P10b：第 6 轮，与真实同一轮） |
| **起服窗口里**（第三轮的 D） | 被记高 | **一样被记高** | **虚高** | −548 MB | ❌ **不释放** |

⇒ **同一个机制，只因为窗口不同而结果不同** —— 这正是第三轮批评第二轮「只修好了被复现的那一个场景」的那句话，本轮在起服窗口上又发生了一次。

**为什么它比复测窗口轻一些（也为什么不能当作「可以先放着」）**：起服窗口只有几秒，别的程序在里面吃掉 1400 MB 的概率比在一分钟里低得多。但**它不是零**，而且它的后果与复测窗口**完全一样**：机器超卖而阀门不释放。

**它还会连累闸门**：账目在起服窗口里同样被记高（上例 `available = 852 MB`），而闸门的阈值是 651 MB ⇒ **闸门放行了一台机器根本吃不下的服务器** —— 这正是第三轮的场景 D 已经指出的那一半，本轮同样留着。起服窗口的洞也**不会自愈**：下一轮复测时 `confirmed` 不再更新，而 `measured` 会继续被记高 ⇒ 确认口径与账目**一起**虚高下去。

**测试的洞**：`tests/lsp-review-round3.test.mjs` 的四条 R1 用例**全部**把漏记安排在**复测轮**里（`fixture.machine.freeMB -= 1400` 之后 `tick(61000)`）；**没有一条**把漏记安排在**起服窗口**里 ⇒ 这条缺陷**没有任何用例守着**。

**最小修复方向（三选一，都不动 `availableBytes` 的语义）**：

1. **给起服窗口的差值一个上界**（推荐，最小改动）：`confirmedBytes` 不再取整个 `delta`，而是取 **`min(delta, 该语言的基线估算 + 噪声余量)`**（TypeScript 的基线估算 434 MB ⇒ 确认口径最多记这么多）⇒ 别的程序在起服窗口里吃掉的那部分**进不了**确认口径；而**真正长起来的**服务器仍然被记（只是记少了 ⇒ 余量偏保守 ⇒ 阀门早一点释放，方向与 L10 一致）。**代价**：一台真的长到 1 GB 的服务器，确认口径只会记 434 MB ⇒ 余量偏保守 566 MB ⇒ 阀门更早触发。
2. **起服窗口之后立刻做一次确认**（例如进程起来 30 秒后再读一次 `freemem()`，把两次读数之差**只**归给服务器 —— 窗口更短，别人的份额更小）。这只是把同一个赌注押在一个更短的窗口上，**不是闭合**。
3. **接受它，但把假设写进代码与记录**（最低成本）：把 `:3667-3669` 那句「可以信任」改成「**假设**服务器是那个窗口里的主因 —— 这个假设在别的程序恰好也在起服时分配内存时不成立（第三轮的场景 D）；后果是确认口径在那种情况下 ≡ 账目口径，阀门不释放」，并在 L10 里补一条「起服窗口的漏记」。

> **建议**：方向 1 或 3。方向 1 与这一轮的整体思路（**让不确定的部分不许影响安全阀**）是一致的 —— 起服窗口的差值**同样是不确定的**，却恰恰被当成了最可信的。

### N2【中】拆除窗口：确认口径把一台正在死去的服务器按满额上限计账 ⇒ 假释放

**机制**（`src/host/lsp.js`）：

```js
// :2726-2733  —— 预留额、实测占用、确认占用一起归零
#releaseReservation(session) {
  ...
  session.reservedBytes = 0
  session.measuredBytes = 0
  session.confirmedBytes = 0      // ← 确认占用被清零
}
```

但**上限**要等到拆除才清零（`:4915-4923`）：

```js
#teardownSession(session) {
  this.#sessions.delete(session)
  this.#releaseReservation(session)
  session.ceilingBytes = 0        // ← 上限到这里才归零
  ...
}
```

而 `#releaseReservation` 是在**进程还在死**的时候就被调用的（`:4863-4869`，`#terminateAndWait` 的第一件事）：

```js
async #terminateAndWait(session) {
  ...
  // The memory of the session is given back as soon as the process is on
  // its way out: the gate must not refuse the next server because of a
  // server that is already gone (MEM-02).
  this.#releaseReservation(session)      // ← 这里就归零了
  ...
  await Promise.race([
    Promise.resolve(typeof handle.waitForExit === 'function' ? handle.waitForExit() : true).catch(() => false),
    this.#delay(this.#graceMs + 500),   // ← graceMs 默认 2000 ⇒ 最长 2.5 秒
  ])
}
```

⇒ 在这**最长 2.5 秒**里，那台正在死去的服务器：
- 还在 `#sessions` 里（`#teardownSession` 还没跑）；
- `ceilingBytes = 2048 MB`（满额上限）；
- `confirmedBytes = 0`（被清零了）。

而 `#safeReservedBytes()` 是**现算**的（`:2646`）：

```js
const room = Math.max(0, session.ceilingBytes - session.confirmedBytes)   // = 2048 - 0 = 2048
```

⇒ **一台正在死去的服务器，在确认口径里被按满额上限计账** ⇒ 确认余量凭空少了它的**确认占用**（一台 TypeScript 索引约 600 MB，一台大项目可达 2048 MB）。

**为什么这一轮之前没有这个问题**：上一轮阀门看的是**账目** `availableBytes = free − Σ reserved`，而拆除窗口里 `reservedBytes` 已经归零 ⇒ 账目的可用内存**变大** ⇒ 阀门**不会**误触发。**换口径不是换一个数，是换一整套时序** —— 这一轮把「账目偏乐观」换成了「确认口径偏保守」，而拆除窗口正好落在两者相反的方向上。

**探针实测**（`iwb-probe-r4-teardown.mjs`，生产 `LspManager` + `tests/lsp-fixtures.mjs`；两台 TypeScript 服务器，上限 2048 MB，机器空闲 **3528 MB**）：

```
--- the machine before the release ---
  free = 3528 MB
  A: margin=300 MB account=300 MB state=ready
  B: margin=300 MB account=300 MB state=ready
  after a pressure check: A=ready B=ready          ← 余量 300 MB > 256 MB 地板，阀门正确地没动

--- during the teardown of A (its process is still dying) ---
  A: margin=0 MB account=1914 MB state=ready       ← 余量从 300 掉到 0
  B: margin=0 MB account=1914 MB state=ready
  >> the margin of the machine dropped by 300 MB, the account went UP by 1614 MB

--- after a pressure check inside the teardown window ---
  A: state=idle
  B: state=suspended                                ← 另一台健康的服务器被释放了
  >> the valve released B? true
  >> the machine has 3528 MB free - it did NOT run out of memory
  >> the truth: free 3528 - 2 x 1448 = 632 MB (the floor is 256 MB)
```

⇒ **机器有 3528 MB 空闲、真实余量 632 MB（远高于 256 MB 的地板），一台健康的服务器却被释放了** —— 唯一的原因是另一台服务器**正在死**，而它死的过程里被按满额上限计了账。

**命中的概率不低**：压力检查的间隔是 **1000 ms**（`PRESSURE_CHECK_INTERVAL_MS`），拆除窗口最长 **2500 ms**（`graceMs` 默认 2000 + 500）⇒ **每一次释放（每 10 分钟的空闲退出、每一次工作区切换、每一次用户关服务器）都有一个 1000/2500 的窗口，窗口里落一次压力检查**。

**最小修复方向（不动 `availableBytes` 的语义）**：

- **让 `#safeReservedBytes()` 与拆除窗口对齐**：会话一旦进入「正在退出」，就不再计入确认口径的预留（或者把 `confirmedBytes` 保留、只把 `reservedBytes` 归零 —— 现在的顺序恰好相反）；
- 或者：**先 `#teardownSession`（把上限归零、从 `#sessions` 里摘掉）再 `#terminateAndWait`**（把进程死的等待放到会话已经不在账上之后）—— 这一改动更彻底，但会影响 `#exitIdle` 的顺序，**要重跑既有的回收用例**；
- 或者：**给正在退出的会话一个标记**，让 `#safeReservedBytes()` 跳过它。

> **我建议第一条**：它是最小的、且与「确认口径只数还在跑的服务器」这句话一致。

### N3【低】阀门的警告写在挑受害者之前 ⇒ 日志说「已释放」，而什么也没释放

**位置**（`src/host/lsp.js:4379-4387`）：

```js
this.#ctx?.logger?.warn?.(
  'lsp: the machine is below the hard floor: the confirmed margin is %d MB, the account says %d MB - the least used language server is released',
  Math.round(resources.safeAvailableBytes / (1024 * 1024)),
  Math.round(resources.availableBytes / (1024 * 1024)),
)
this.#safely(this.#yieldUnderPressure(session), 'the memory pressure release')
```

⇒ 警告写在**挑受害者之前**，而且用的是**完成时**（is released）。

**受害者可能不存在**：`#lruVictim()`（`:4441-4458`）会跳过**正在构建 program** 的会话（CONC-03 的第 4 条：「构建 program 中的会话**永不**让位」）⇒ 当机器上**只有**一台服务器而它正在构建 program 时，候选集为空 ⇒ `#yieldUnderPressure` 直接返回 ⇒ **什么也没释放**，而日志已经说了「最不活跃的语言服务器被释放」。

**探针实测**（`iwb-probe-r4-novictim.mjs`，生产 `LspManager` + fixtures；一台服务器，一个未答复的 `textDocument/definition` 让它处于构建 program 的状态，机器只剩 100 MB）：

```
  the state of the session : ready (buildingProgram=true)
  the machine has 100 MB free

  the state after the check : ready
  >> the valve released the server? false
  >> the warnings of the host:
       lsp: the machine is below the hard floor: the confirmed margin is %d MB, the account says %d MB - the least used language server is released 0 0
```

⇒ **日志说释放了，实际没释放，机器仍然超卖，而日志里没有任何东西说明「阀门没能释放任何东西」。**

**最小修复方向**：把警告**移进** `#yieldUnderPressure`，在**拿到受害者之后**再写，并把措辞改成事实（先写「机器低于硬地板」，释放之后再写「已释放 X」）；没有受害者时写一条**不同的**警告（「机器低于硬地板，但没有服务器可以让位：它们都在构建 program」）。

### N4【低】用户看到的释放理由写着「机器内存不足」，而机器当时还有 1.4 GB 空闲

**位置**：`src/host/lsp.js:230`、`:329`、`:4433`：

```js
export const PRESSURE_YIELD_DETAIL = 'the machine ran out of memory, so the least used language server was released to reclaim it (this is not a failure)'
const PRESSURE_EXIT_DETAIL = 'the machine ran out of free memory, so the language server was released to reclaim it (this is not a failure)'
```

这两句是**用户可见的**：宿主把它写进会话的 `detail`，客户端的 `lsp.status` 把它镜像到 `state.lsp.detail`（`src/client/store.js:2723`），诊断面板的「原因」一行**原样渲染**它（`src/client/Workbench.jsx:1317-1322`）。

**而新口径下，这句话可能是假的**：确认口径**不认**服务器真长的那部分 ⇒ 阀门会在**真实余量还很高**时释放。L10 把这个代价记下来了（「确认口径会低估『服务器真的长了多少』… 阀门可能比真实情况**早一点**释放」），**但没有改这句话**。

**探针实测**（`iwb-probe-r4-safe.mjs` 的场景 D；服务器起服时占 600 MB，构建 program 后真的长到 1500 MB，机器空闲 1400 MB）：

```
=== D: a server that really grew - the valve fires early ===
  free=1400 MB  the server really takes 1500 MB
  account  available = 1400 MB   confirmed margin = 1400 MB
  the TRUTH           = 852 MB  (the floor is 256 MB)
  >> the valve fired? true  (the truth says the machine is fine: 852 MB)
  >> the machine really has 1400 MB free - it did NOT run out of memory
```

⇒ 阀门触发时**机器有 1400 MB 空闲**，真实余量 852 MB（地板的 3 倍多），而用户会读到「**the machine ran out of memory**」。

**最小修复方向**：把这两句改成**描述口径**而不是**断言事实**，例如「机器的可用内存（按语言服务器被授予的上限算）低于硬地板，最不活跃的语言服务器被释放以把内存还给机器」；或者在**确认口径与账目口径相差很大**时补一句「（账面可用 1400 MB；按服务器的上限算，它可能再涨 1448 MB，所以机器提前把内存收了回来）」—— 后者与诊断面板新加的「压力余量」一行是同一件事，文案可以复用那个数。

---

## 3. 这一轮做得好、值得保留的地方

1. **「让不确定的那部分不许影响安全阀」是正确的分工**：测量与确认分成两个口径，一个给「下一个服务器能不能起」（乐观方向可以接受），一个只给「机器还撑得住吗」（必须悲观）。**不变式写成了公式并逐字可验**（`实施进展.md:634`），我按那个公式核了六种状态，全部成立 ✓。
2. **不变式不是口头承诺，是代码层面的**：唯一的两个赋值点（`:3690`、`:3697`）都保证 `confirmed ≤ measured` ⇒ 不变式在**任何**执行路径上都成立，不依赖「谁先谁后」✓。
3. **「死条件比没有条件更坏」的判断被贯彻了**：第二轮那条「同时盯裸 `freeBytes`」被删掉之后，这一轮**没有**又长出一条恒真的条件，而是换成了一个**真的会触发**的口径 ✓。
4. **取舍写得比上一轮更诚实**：§7.5.3 用一张表把三个方案（检视建议的方向 1 / 方向 2 / 本轮实现）逐条比较并写明**为什么不采纳前两个**（方向 1 把服务器已经用掉的内存又扣了一遍；方向 2 数学上退化成方向 1），还**写明了与规格的一处偏差**（「规格 MEM-12 §3.8 要求 2 的字面写法是 `availableBytes < hardFloor`… 本轮按 R1 收紧」）—— **规格与实现不一致的地方被显式记下来，而不是被悄悄改掉**，这是这份记录最值得保持的做法。
5. **R3 的修法把「静默」拆成了三处**：宿主 reject + 路由回 `ok:false` + 客户端回滚 + 宿主记日志 ⇒ 三重静默变成三重可见 ✓。**合并在轮到它时才做**（而不是先把内存改了再写）⇒ 并发写不会丢 patch，我实测三条同时写全在磁盘上 ✓。
6. **客户端的回滚精确到了 map**：第三轮 R3 的「附带的次要问题」（回滚整个 `lsp` 段会把别的往返的改动一起抹掉）被一起修掉了 ⇒ 用例专门守「别的字段不动」✓。
7. **第三轮的「可诊断性问题」被补上了**：额度内的归因以前在日志里一个字都没有，现在每轮都有一条 info（`src/host/lsp.js:3832-3836`）⇒ 「账目被撑大」这件事终于有痕迹 ✓。
8. **探针入库 + 文档改指向**：四个探针进了 `scripts/probes/`，PRD 头部的「实测基线」也改了 ⇒ **证据可复现**这件事从此不再靠工作区里的散落文件（D2 真修好）。
9. **新增用例是真实行为断言**：`tests/lsp-review-round3.test.mjs` 断言的是「**服务器真的被释放**（state === 'suspended'）」而不是「某个 mock 被调用过」；`tests/lsp-review-round3-host-settings.test.mjs` 断言的是「**写盘失败要 reject**」「**内存不留没有落盘的值**」；`tests/lsp-review-round3-client-settings.test.mjs` 断言的是「**别的字段不动**」—— 三条都是行为，不是实现 ✓。

---

## 4. 复现方法与探针说明

本轮五个探针**写在仓库外的临时目录**（`%LOCALAPPDATA%\Temp\`），**没有进仓库**，全部**只读导入生产源码**（`src/host/lsp.js`、`src/host/settings-store.js`、`tests/lsp-fixtures.mjs`），未改动仓库任何文件：

| 探针 | 验证的条目 | 输出要点 |
|---|---|---|
| `iwb-probe-r4-safe.mjs` | **N1**（起服窗口）、不变式的四种状态、N4（阀门早放） | A：起服窗口里别的程序吃掉 1400 MB ⇒ 确认口径 **852 MB ≡ 账目**，真实 **−548 MB**，**阀门不释放** ✗；B：一会话 / 双会话 / 复测轮之后 / 全新起服 ⇒ 不变式全部成立 ✓（崩溃与重启的两种状态见 restart 探针）；D：服务器真长了 ⇒ 阀门在机器还有 **1400 MB** 空闲时释放 |
| `iwb-probe-r4-teardown.mjs` | **N2** | 余量 300 MB（> 地板 256）时阀门正确地不动；**拆除窗口里余量掉到 0** ⇒ 另一台健康的服务器被释放（`state=suspended`），而机器有 **3528 MB** 空闲 |
| `iwb-probe-r4-novictim.mjs` | **N3** | 机器只剩 100 MB、唯一的会话正在构建 program ⇒ 日志说「the least used language server is released」，而 `state` 仍是 `ready` ⇒ **什么也没释放** |
| `iwb-probe-r4-settings.mjs` | **R3**（宿主侧，5 个场景） | 写盘失败**reject**、内存不留没落盘的值、磁盘原样、宿主记日志；队列不被一次失败打断；三个并发写不丢 patch；路由回 `{"ok":false,…}` ⇒ 客户端的 `.catch` 会跑 |
| `iwb-probe-r4-restart.mjs` | 不变式（崩溃 / 重启之后） | 崩溃之后与自动重启之后，不变式都成立（`confirmedBytes` 在新的起服窗口里重新实测） |

> ⚠️ **探针注意**（沿用第三轮的两条纪律）：
> ① 宿主模块里的 `ROOTS` 是**模块级**的 ⇒ **不同场景必须用不同的 root 路径**；
> ② 宿主 `LspManager` 的 `now` 可注入 ⇒ 用它控制「测量轮 / 压力检查」的先后顺序，才能稳定复现「轮先跑、阀门后看」的竞态。

```sh
# 仓库与提交
git -C dsh-ide-workbench log --oneline -3
git -C dsh-ide-workbench status --short
git -C dsh-ide-workbench diff ed38e4e..7cc7227 --stat

# 测试（1073 / 1073）
npm --prefix dsh-ide-workbench test

# 仓库内的四个探针（本轮全部实跑，退出码 0）
node dsh-ide-workbench/scripts/probes/p7-reservation-accounting.mjs
node dsh-ide-workbench/scripts/probes/p8-memory-accounting.mjs
node dsh-ide-workbench/scripts/probes/p9-attribution-and-valve.mjs
node dsh-ide-workbench/scripts/probes/p10-pressure-margin.mjs

# 本轮的五个探针（脚本在 %TEMP%，不在仓库）
node "$env:TEMP\iwb-probe-r4-safe.mjs"
node "$env:TEMP\iwb-probe-r4-teardown.mjs"
node "$env:TEMP\iwb-probe-r4-novictim.mjs"
node "$env:TEMP\iwb-probe-r4-settings.mjs"
node "$env:TEMP\iwb-probe-r4-restart.mjs"
```

---

## 5. 一句话总结

**第三轮的 R2、R3 与三条文档项全部真修好了；R1 修好了它自己复现的那一类（每分钟复测窗口的漏记，阀门现在与真实同一轮触发，且新口径的不变式在我实测的六种状态下全部成立，账目口径逐位未变），但**起服窗口的同一个洞还在** —— 确认口径的「确认」本身仍是一次差值测量，别的程序在起服窗口里吃掉的内存照样整笔记到服务器头上，于是确认口径 ≡ 账目口径，机器已超卖 548 MB 而阀门一次没触发（第三轮的场景 D，本轮无任何用例守着）。另查出 3 条：**拆除窗口**让确认口径把一台正在死去的服务器按满额上限计账，于是一台并不需要释放的服务器被释放（新口径的误伤，窗口最长 2.5 秒而压力检查每秒一次）；阀门那条警告写在挑受害者之前，日志说「已释放」而实际什么也没释放；以及用户看到的释放理由仍写着「机器内存不足」，而机器当时还有 1.4 GB 空闲。**
