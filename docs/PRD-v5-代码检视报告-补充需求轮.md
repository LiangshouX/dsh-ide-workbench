# PRD-v5 代码检视报告（补充需求轮）

> **范围**：`354fa58` → `31dfbc7`（2 个提交，补充需求实现轮）。
> **基线**：`354fa5894035aaf4c02969980df971da085ba478`。**对照物**：`docs/PRD-v5-补充需求.md`（本轮规格，19 个条目）、`docs/PRD-v5-代码检视报告.md`（前五轮检视，D1–D17 / N1–N13 / M1–M3）。
> **方法**：读代码 + **实跑验证**。本次检视跑通 `npm test`（**640 项 / 640 通过 / 0 失败**），并自建 4 个探针脚本直接 import 生产代码复现关键路径。检视分三条线并行推进（内存阈值 / 超时 / 其余条目），主线程**逐条复核**每条结论的关键锚点，并对可量化的部分（WCAG 对比度）**自行复算**，不直接采信二手结论。
> **本次检视未修改任何源码**。探针脚本写在仓库外的临时目录（`%LOCALAPPDATA%\Temp\iwb-probe\`），不污染工作区。
> **检视日期**：2026-10-31。**重点关注**（用户指定）：① 内存阈值的逻辑与默认值；② `Request timed out` 频发；③ 配置与话术。

---

## 0. 结论

### 0.1 三个重点问题的直接回答

| 用户反馈 | 结论 | 依据 |
|---|---|---|
| 「现在看起来还是有点像是要 2048（设置配置写的）」 | **新代码的运行时门槛不是 2048，实测是 384 MB。** 用户看到的 2048 来自**旧 DSH 实例 + schema-3 设置文件**，不是本轮代码。但本轮代码本身仍有一个真实缺陷：设置页那个 2048 的「内存上限」**是死控件**（R3），调它没有任何效果 | §1.1 + 探针 `probe-ceiling.mjs` |
| 「Request timed out 依旧比较频发」 | **已定位根因**：宿主看门狗把客户端的**通知**（`textDocument/didChange`）也当成「未应答的请求」来计时，**约 90 秒持续编辑就会把语言服务器打死**（R1，高危）。叠加客户端 30 s 逐请求超时与握手失败后的粘性损坏（R2，高危） | §1.2 + 探针 `probe-watchdog.mjs` |
| 配置与话术一并写进意见 | 崩溃原因被硬编码归因为「内存不足」，与 R1 的真实原因相反（R7）；低内存提示指向 R3 的无效控件（R8）；设置页两个「保守下限」语义冲突（R9）；「重置」漏掉整段语义分析设置（R10） | §6 |

### 0.2 本轮新发现汇总（R1–R20）

| 编号 | 严重度 | 一句话 | 位置 |
|---|---|---|---|
| **R1** | **高** | 看门狗把**通知**当未应答请求 → 约 90 秒编辑即杀服务器，进入「构建→被杀→重建」死循环 | `src/host/lsp.js:1007` + `:1923-1939` |
| **R2** | **高** | 客户端 30 s 逐请求超时 + 握手失败只 `disconnect()` 复位 → 损坏粘性持续到刷新页面 | `src/client/lsp-session.js:536-540`、`:581-584` |
| **R3** | 中 | 全局 `settings.lsp.memoryLimitMB` 是**死控件**，到不了 worker ceiling；且「调小反而更容易启动」方向反直觉 | `src/host/lsp.js:1265-1267` |
| **R4** | 中 | 客户端与宿主对同一份内存快照给出**相反结论**（窗口 `[needMB, 2×needMB)`）；低内存 toast 用错字段 | `src/client/store.js:1133-1146` |
| **R5** | 中 | `memoryWarnedRoots` 只记「已提醒」不记用户选择 → 用户选「基础模式」后二次切换不再询问内存 | `src/client/store.js:1133`、`:1156-1179` |
| **R6** | 中 | `settings.update()` 不跑迁移，写入路径与加载路径的迁移语义不一致 | `src/host/settings-store.js:316-331` |
| **R7** | 中 | 崩溃 toast 把原因硬编码为「内存不足」——与 R1 的真实原因相反，且建议指向 R3 的无效控件 | `src/host/lsp.js:1981`、`src/client/i18n.js:1182` |
| **R8** | 中 | 低内存提示「在设置里调低内存上限」指向无效控件 | `src/client/i18n.js:1181` |
| **R9** | 低 | 设置页两个都叫「保守下限」：512 的「保守兜底下限」 vs 256 的「保守下限 {floor}」 | `src/client/i18n.js:652/660` vs `:666` |
| **R10** | 低 | 「重置」不重置整段语义分析设置（`lsp` 段缺失） | `src/client/SettingsPanel.jsx:626-641` |
| **R11** | 说明 | 用户看到的 2048 与「超时频发」**都来自旧构建**；新代码从未加载过用户当前的设置文件 | §5 |
| **R12** | 中 | 新语法色板只在**浅底**调校，深色底下对比度 2.58–3.98:1（**比旧色板更差**）；而注释与测试都只按白底断言 | `src/client/styles.js:43-54`、`tests/styles-theme.test.mjs:79-93` |
| **R13** | 中 | 查找弹窗的键盘处理只挂在输入框上 → **单击文件行后 Esc / ↑↓ / F8 全部失效** | `src/client/SearchPopup.jsx:113-124`、`:153` |
| **R14** | 中 | 「全项目查找」继承「查找用法（文本）」的查询词与 wholeWord，并**自动触发一次全项目重搜** | `src/client/store.js:2190-2196`、`:2242-2260` |
| **R15** | 低 | 查找跳转**只定位到行、丢掉列号**——而 host 其实已经把列号传过来了 | `src/client/SearchPopup.jsx:108-111`、`src/client/store.js:2173-2179` |
| **R16** | 中 | 无上游分支时推送按钮**永久禁用**，规格要求的「友好提示 + 可复制命令」在 UI 上不可达 | `src/client/CommitPanel.jsx:152-155`、`:318-324` |
| **R17** | 中 | `-uall` 叠加 2 秒轮询，**没有任何规模保护或降级**；规格 §11 风险 #1 要求的实测记录缺失 | `src/host/git.js:276`、`src/client/store.js:1597` |
| **R18** | 低 | 切换项目时旧语言服务器**只断连接、不停进程**，旧进程继续占内存直到 idle 超时 | `src/client/lsp-session.js:689-698` |
| **R19** | 中 | 新增测试的保真度有系统性缺口：层级测试全是源码正则、查找测试缺关闭路径断言、主题测试只验白底 | `tests/modal-layer.test.mjs`、`tests/search-popup.test.mjs`、`tests/styles-theme.test.mjs` |
| **R20** | 说明 | USAGE-01 `requestFile` 的四项要求**全部满足**；仅一个低风险边界（超大文本文件无大小上限） | `src/client/lsp-workspace.js:347-369` |

**统计：高 2 / 中 12 / 低 4 / 说明 2（共 20 项）。**

> **已验证无缺陷的条目**：LAYER-01 弹窗层级（z-index 50 / 55 关系正确，确认框确实在上）、USAGE-01 `requestFile` 的四项要求、GIT-01 的未跟踪文件着色逻辑本身、`SET-01` 关闭开关即退进程的主路径（先 `shutdown` 后 `stop` 的顺序正确）。详见 §7。

### 0.3 总体判断

本轮实现的**功能面完成度高**（19 个条目基本都落地，测试从 523 增到 640 且全绿），THEME-04 的话术（`i18n.js:1154-1165`「为 {name} 启用语义分析 / 取消切换 / 不启用」）已完全符合规格。

但**运行时的两个核心判据有方向性错误**：

1. **看门狗把「通知」当「请求」**（R1）——这不是调参问题，是计数语义错了。它同时解释了「超时频发」和「IDE 开一会儿就悄无声息降级成保守版」两个现象，而且在大项目上会形成**自触发循环**（越慢越容易被杀，越被杀越慢）。
2. **客户端与宿主不同源**（R4）——同一份内存快照，两边结论相反；用户看到的提示与实际行为对不上。

这两条都**不会**被现有 640 个用例发现，因为：
- R1 的回归测试只覆盖「真的发请求且服务器不回」，**没有覆盖「只发通知」**；
- R4 的客户端与宿主判定从未被放在同一个断言里比较；
- R3 的测试断言的是「设置值被读到了」，**没有断言「它影响到了 worker ceiling」**。

**其余条目的结论（§7）**：功能面完成度确实高——LAYER-01 层级、USAGE-01 `requestFile`、GIT-01 着色逻辑、SET-01 主路径**均未发现缺陷**，THEME-04 话术完全符合规格。但也有几处**「实现了、却在真实使用路径上退化」**的情况：

- **R13 / R14**（查找弹窗）：单击文件行后键盘全失效；「全项目查找」继承「查找用法」的查询词并自动重搜——后者**直接违背规格 §6.2 的明文意图**；
- **R16**（推送）：无上游分支时按钮**永久 disabled**，规格 §7.2.3 要求的「友好提示 + 可复制命令」在 UI 上**不可达**；
- **R15**（列号）：host **已经把列号传过来了**（`search.js:294` 用了 `--column`，`:178` 放进返回结构），客户端**把它丢了**——纯前端丢数据，改起来最划算；
- **R12**（主题）：新语法色板**只按浅底调校**，深色底下对比度 2.58–3.98:1，**比旧色板更差**，而注释声称两底都成立、测试也只验白底；
- **R19**（测试保真度）：新增测试里**层级测试全是源码正则**、查找测试**缺三条关闭路径断言**、「单击不误关」用例**名不副实**（根本没模拟点击）——这些缺口恰好放行了 R13 和 R12。

> **一个反复出现的模式**：本轮多数缺陷不是「没写」，而是「**写了但断言打在了错误的层**」——与上一轮 N1 的「断言在 `worker.posted` 而非 `stdinChunks`」是同一类问题。**建议这轮的修复同时补行为级断言**，否则下一轮还会漏。

---

## 1. 两个现象的直接结论

### 1.1 内存阈值：三个数，一个是死控件

「内存」在本项目里其实有**三个不同的数**，界面上却只有两个标签，且其中一个根本不生效：

| 名称 | 默认值 | 真正含义 | 实际生效吗 |
|---|---|---|---|
| **内存上限** `memoryLimitMB` | 2048 | 允许语言服务器占用的**上限**（worker ceiling） | ❌ **全局值不生效**（R3）；只有 `servers[lang].memoryLimitMB` 覆盖才生效，而设置页没有这个输入框 |
| **可用内存门槛**（运行时算出来的） | TypeScript **384 MB** | 低于它就不启动语言服务器 | ✅ 生效 |
| **保守兜底下限** `freeMemoryThresholdMB` | 512 | 仅在**无法估算**时用作门槛 | ✅ 生效，但只在估算不可用时 |

**探针实测**（`probe-ceiling.mjs` / 直接调生产 `#resourcesSnapshot`）：

```
TypeScript: needMB = 384   threshold = 384MB   soft = 768MB   hardFloor = 256MB
→ 运行时门槛是 384 MB，不是 2048
```

**那 2048 是从哪来的？** 三重叠加：

1. **界面**：设置页「语言服务器内存上限 (MB)」显示 `上限 ?? 2048`（`SettingsPanel.jsx:473`）。你的设置文件还是 schema 3，没被迁移过，所以显示 2048。
2. **控件本身无效**：即使你去设置页把 2048 改成 4096，worker 的 ceiling 仍恒为 2048；改成 512、128 也是 2048（探针实测四种取值全部相同）。真正生效的是 `override.memoryLimitMB ?? registryEntry.memoryLimitMB`（`lsp.js:1265-1267`），**不含全局值**。
3. **旧实例**：你机器上 DSH 有 16:15:47 启动的旧实例（早于这两个提交），它是 21:52:29 写设置文件的那个。**新代码从未加载过这个文件**（详见 §5）。

> ⚠️ **方向反直觉**：调小全局 `memoryLimitMB` 会让 `needMB = Math.min(baselineMB, limit) * headroom` 变小（`lsp.js:1192`），于是**门槛降低、语言服务器更容易启动**。一个叫「内存上限」的框，调小反而更容易跑起来 —— 这本身就是必须修的话术/行为问题（§6 R8）。

### 1.2 `Request timed out` 频发：看门狗在数通知

**探针实测**（`probe-watchdog.mjs`，只发 `textDocument/didChange` 通知，服务器 31 s 静默）：

```
只发 didChange + 31s 静默  → timeouts = 1
3 轮后                      → terminated = true, spawned = 2（已重启）, 状态 = degraded
                              detail: "4 request timeouts"
```

**机制**（`src/host/lsp.js`）：

```
relayToServer()        :1007   session.lastClientActivityAt = now()   ← 通知也刷新
#checkTimeouts()       :1928   if (lastServerActivityAt >= lastClientActivityAt) return
                                if (now - lastClientActivityAt < timeout) return
                                → 服务器只要在 timeout 内没回话就记一次超时
#noteTimeout()         :1955   timeouts++ ; >= 3 → #onCrash() 杀进程
```

关键在 `:1007`——`relayToServer` 对**每一条**客户端载荷都刷新 `lastClientActivityAt`，**不区分请求与通知**。而 CodeMirror 的 `LSPPlugin` 在每次文档变化后 **500 ms** 发一条 `didChange` 通知（`node_modules/@codemirror/lsp-client/dist/index.js:1799-1809` → `:783-793`）。

于是：**只要你在持续打字，客户端每隔 500 ms 刷新一次时间戳；服务器在 30 s 内没发出任何消息（比如正在做首次 program 构建，PRD-v5 §0.2 #3 实测可超 10 分钟），看门狗就会在 30 s 后判定「超时」，每换一个 stall 记一次，3 次后杀进程。**

> 30 s timeout + 连续编辑 ⇒ **约 90 秒编辑即足以杀掉语言服务器**。

**这造成的连锁反应**正好对应你的两个观感：

1. 大项目首次 program 构建期间语言服务器被反复杀掉 → 用户看到崩溃 toast → 看到 **`Request timed out`**（客户端 30 s 逐请求超时的文案，`node_modules/@codemirror/lsp-client/dist/index.js:794-800` 是该字面量的**唯一**出处）。
2. 杀掉后宿主重启服务器 → 又进入构建 → 又超时 → **自触发循环**，表现为「IDE 过一会儿就悄无声息地降级成保守版（本地补全 + 文本查找）」。

**和内存无关。** 但崩溃 toast 恰恰写着「最常见的原因是内存不足」（`lsp.js:1981`、`i18n.js:1182`）——用户会被引导去调一个**无效的内存控件**（R3）。见 §6。

---

## 2. 高危

### R1 ［高］看门狗把「通知」当成「未应答的请求」

**位置**：`src/host/lsp.js:1007`（`relayToServer`）、`:1923-1939`（`#checkTimeouts`）、`:1952-1957`（`#noteTimeout`）、`:641`（`this.#timeoutLimit = 3`）

**代码锚点**

```js
// :996 relayToServer
session.worker.postMessage({ type: 'send', text, origin: 'client' })
session.lastClientActivityAt = this.#now()   // ← 通知也走这里
```

```js
// :1923 #checkTimeouts
if (session.lastServerActivityAt >= session.lastClientActivityAt) return
if (this.#now() - session.lastClientActivityAt < timeout) return
if (session.timeoutStallAt === session.lastClientActivityAt) return
this.#noteTimeout(entry, session, 'the language server stopped responding')
```

**问题**：判定条件是「服务器静默时长」，但「客户端活动」包含了**通知**。LSP 里通知是单向的（`textDocument/didChange`、`$/progress` 之类），**服务器不回是正常的**。真正需要计时的只有**请求**。

**三个叠加的放大因素**：

1. **首次 program 构建期静默极长** —— PRD-v5 §0.2 #3 实测可超 10 分钟，远超 30 s。
2. **`:1580-1592` `#onWorkerMessage` 会全局清零 `timeouts = 0`** —— 服务器只要发回**任何**消息（包括 `$/progress` 之类）计数就归零，然后再次静默又重新累计。所以计数在「静默 ↔ 有进度」之间反复横跳，**用户看到的崩溃是随机的**，也难以复现规律。
3. **杀掉后自动重启并重放构建** —— 形成闭环。

**证据**：探针实测（见 §1.2）；`timeoutStallAt` 的去重逻辑（`:1932`）说明作者已经意识到「不能按 tick 计数」，但**去重的基线选错了对象**——它按「客户端活动时刻」去重，而客户端活动时刻被通知不断刷新。

**修复方向**：

1. **区分请求与通知**：在 `relayToServer` 解析 JSON-RPC 的 `id` 字段，只有带 `id` 的消息才刷新 `lastRequestAt`；通知走另一条时间戳（或完全不参与）。
2. 看门狗改为比较「**未应答的请求**」而非「服务器静默时长」。宿主手上其实有原始文本，可以在转发时记下未决请求 id，收到响应再消账。
3. **加一条「构建期豁免」**：服务器处于 `building` 且收到过 `$/progress` 时不计入超时计数——PRD §11.2 已经承认大项目构建会很久。

**修复方向之外，还有一处要一起改**：`:1956` 的文案 `` `${session.timeouts} request timeouts` `` 是**对用户可见的事实性描述**，在 R1 未修之前它是**错的**（数的是 stall，不是 request）。

---

### R2 ［高］客户端 30 s 逐请求超时 + 握手失败只做软复位，损坏粘性持续到刷新页面

**位置**：`src/client/lsp-session.js:536-540`（`requestTimeoutOf`）、`:581-584`（`new LSPClient({ timeout })`）

```js
// :536
function requestTimeoutOf(settings) {
  const configured = Number(settings?.lsp?.requestTimeoutMs)
  return Number.isFinite(configured) && configured > 0 ? Math.max(30000, configured) : 30000
}
```

**问题 1：下限 30 s 不可调**。`Math.max(30000, configured)` 把用户配的 `requestTimeoutMs` 强行抬到至少 30 s。设置页有「单次请求的上限」这一项，但**填任何小于 30000 的值都不生效**——UI 接受、存储成功、运行时被静默改写。

**问题 2：握手失败后只做软复位**（`node_modules/@codemirror/lsp-client/dist/index.js`）：

```
:546   const initializing = ...        // 握手 Promise
:585-592 握手失败 → init.reject
:603   disconnect() 复位
:707   request() 依赖 initializing
:732   notification() 被静默丢弃
```

握手一旦 reject，`initializing` 处于 rejected 状态，`request()` 永远 reject。而**语言服务器崩溃并不会关闭浏览器侧的 WebSocket**（`src/host/lsp-ws.js:87` `attachSink` 里崩溃路径不 `close()`），所以：

- 客户端侧会话仍「连着」，但再也不会重建；
- 宿主重启了服务器，客户端却不知道；
- **所有语义功能（跳转定义、查找用法）静默失效，用户只能刷新页面才能恢复。**

这解释了「超时频发」之后的**后续症状**：不刷新页面就一直是坏的。

**修复方向**：

1. 去掉 `Math.max(30000, …)` 的硬下限（或把下限降到 5 s 并在设置页注明）；
2. 握手失败时**强制重建** LSP 客户端实例（而不是复用 rejected 的 `initializing`）；
3. 宿主崩溃时**主动关闭该 root 的 ws**，让客户端进入可重建状态（这一条需要协议配合：客户端在收到 `type:'crash'` 时应重建连接）。

**测试缺口**：`tests/lsp-health-status.test.mjs`（355 行）、`tests/lsp-usage-references.test.mjs`（269 行）都覆盖了超时与恢复，但**没有一条覆盖「只发通知不应计入超时」**（R1）和「握手 reject 后能否恢复」（R2）。

---

## 3. 中危

### R3 ［中］全局 `settings.lsp.memoryLimitMB` 是死控件

**位置**：`src/host/lsp.js:1265-1267`（真正生效的取值）、`:1443-1446`（注入 worker）、`:858`（唯一的实际用途）

```js
// :1265
const limit = override.memoryLimitMB ?? registryEntry.memoryLimitMB   // ← 没有全局值
```

**探针实测**（`probe-ceiling.mjs`）：全局设为 **2048 / 4096 / 512 / 128** 四种值，worker ceiling **恒为 2048**（来自 `LSP_REGISTRY` 的语言默认值）。

**它唯一的实际作用**：`src/host/lsp.js:858`，`resources()` 在「**没有 root 且没有 session**」时用它裁剪估算值。

**后果**：

- 用户在设置页看到的「语言服务器内存上限 (MB)」——**最显眼的那个数字**——调大调小都无效；
- 它的 hint 写着「这是语言服务器的内存上限，不是启动门槛」（`i18n.js:651`），暗示**支持的服务器会遵守它**，与事实不符；
- 更糟的是**方向反直觉**（见 §1.1）：调小它会**降低** `needMB`（`:1192` `Math.min(baselineMB, limit)`），反而让 IDE **更容易**启动语言服务器。

**按语言覆盖是有效的**：`servers[lang].memoryLimitMB` 会生效，但设置页**没有这个输入框**（`SettingsPanel.jsx:577-599` 只有开关和状态）。

**修复方向**（三选一，建议第 1 个）：

1. 让全局值真正进入生效链：`override ?? registryEntry ?? globalLimit`——但语义要定清楚（全局是「所有语言的上限」还是「兜底值」）；
2. 若不打算让它生效，就**把它从设置页移除**，并在 `docs/` 写明「内存上限按语言在 `servers[lang]` 配置」；
3. 至少在设置页标注「当前全局值对 X 语言不生效」，避免误导。

> 另外，`LSP_REGISTRY`（`lsp.js:49-102`）里 8 个语言都**各自**有 `memoryBaselineMB`，这才是真正驱动门槛的数（TypeScript 256 × 1.5 = 384 MB）。

---

### R4 ［中］客户端与宿主对同一份内存快照给出相反结论

**位置**：`src/host/lsp.js:1353-1367`（宿主判定）、`src/client/store.js:1108-1154`（客户端判定）、`src/client/store.js:1142`（toast 文案）

**宿主**（`#resourcesSnapshot` 提供数据，`:1359-1366` 消费）：

```js
belowHardFloor = freeBytes < hardFloorBytes                 // 硬下限以下
tight          = freeBytes >= hardFloorBytes && freeBytes < softThresholdBytes
// hardFloor = 256 MB, soft = 2 × needMB = 768 MB
```

**客户端**（`store.js:1133-1146`）：

```js
if (resources.tight)        → 询问用户（内存紧张弹窗）
else if (!resources.canIndex) → ...
```

**冲突窗口**：可用内存落在 **`[needMB, 2×needMB)`**（TypeScript 即 **[384, 768) MB**）时——
- 宿主：`tight = true` → **拒绝启动**，除非 `force`（`:1353-1367`）；
- 客户端：`tight` 为真 → 弹「内存紧张」窗，用户选「使用基础模式」→ **不启动**；
- 但客户端若走 `canIndex` 分支判断则会得到「可以启动」的相反结论。

两个判定读的是同一份 `resources` 快照，**却用了不同的判据组合**，且**判定边界不一致**。

**附带缺陷（同一处）**：`store.js:1142` 的低内存 toast 用 **`needMB`** 而不是 **`thresholdBytes`**：

```
[实测] YAML@200 MB 可用：
  消息 = "系统可用内存不足（需要 96 MB，可用 200 MB）"   ← 需要 96，可用 200？
```

**用户看到「需要 96 MB，可用 200 MB」会直接认为这个提示是错的**（并且它确实错：门槛是 `max(hardFloor=256, floor)` = 256 MB，不是 96 MB）。

**修复方向**：

1. **判定收敛到一处**：宿主算出一个权威的 `decision`（`ok` / `tight` / `low`）随快照一起下发，客户端只渲染，不再自己重算；
2. toast 改用 `thresholdBytes`（换算成 MB），与设置页「当前可用内存 …（状态）」同一口径；
3. 补一条**跨层一致性测试**：同一份 `resources`，宿主判定与客户端判定必须相同——这类不一致最怕「两边各测各的」。

---

### R5 ［中］`memoryWarnedRoots` 只记「已提醒」，不记用户的选择

**位置**：`src/client/store.js:1133`（读取）、`:1156-1179`（`#memoryWarned` / `#rememberMemoryWarning`）

```js
// :1133
if (resources.tight && !this.#memoryWarned.has(root)) {
    this.#memoryWarned.add(root)      // ← 只记「问过了」
    … 弹窗：仍然启动 / 使用基础模式
}
```

**问题**：用户点「使用基础模式」之后，`root` 已被记入 `memoryWarnedRoots`。下次同一 root 再次触发 `tight` 时，**不再询问内存**，流程直接落到索引决策弹窗 → 用户点「启用」→ 宿主因 `tight` 拒绝 → 结果是 **`degraded`**（保守版），而不是用户明确选择的「保守模式」路径。

**两个额外问题**：

1. 这个标记被**写进用户的 `settings.json`**（持久化），跨会话生效——用户几个月后回来，记忆还在；
2. 设置页的「重置」（`SettingsPanel.jsx:626-641`）**不包含 `lsp` 段**，所以**没法清除**这个标记。

**修复方向**：记录用户**选择**（`accepted` / `conservative`），而不是只记「问过了」；只有 `accepted` 才抑制再次询问；`conservative` 应直接走保守路径；并把 `lsp` 段纳入「重置」。

---

### R6 ［中］`settings.update()` 不跑迁移，加载与写入的迁移语义不一致

**位置**：`src/host/settings-store.js:293-313`（`#load()`）、`:316-331`（`update()`）、`:254-275`（`migrateLspSettings`）、`:333-339`（`#write()`）

```js
// :303（只在 #load 里）
this.#settings = migrateLspSettings(raw.lsp)
// :316 update() 里 —— 没有 migrate
this.#settings.lsp[patch.lsp] = …
```

**问题**：`migrateLspSettings` 只在加载时跑一次，且**只改精确等于 2048 的值**（`:264-266`，把 2048 当作「旧默认值」）。这带来两个问题：

1. 任何在加载**之后**写入 `lsp` 段的路径（含 `update()`）都跳过了迁移；
2. 「只改 2048」的启发式**无法区分**「用户真的想要 2048」和「这是旧默认值遗留」——用户手动设成 2048 的话，下次启动会被无端改掉。

**探针实测**：新代码加载 schema-3 文件后得到 `version 4` / `freeMemoryThresholdMB = 512` / `memoryHeadroom = 1.5` / `memoryHardFloorMB = 256`，**迁移本身是有效的**。问题在于**只有一条路径跑它**。

**修复方向**：把迁移收敛到「每次写入前」或「每次加载后」，二选一即可；并把「精确等于 2048」改成「带版本号的迁移」（`SETTINGS_VERSION` 已经是 4，`:14`——**有版本号却不用版本号做迁移判据，是可惜的**）。

---

### R7 ［中］崩溃原因被硬编码为「内存不足」，与真实原因相反

**位置**：`src/host/lsp.js:1981`、`src/client/i18n.js:1182`

```js
// lsp.js:1981
const message = `${reason}. A common cause is not enough memory.`
```

```js
// i18n.js:1182
'lsp.crashedToast': '语言服务器已退出。最常见的原因是内存不足——请降低内存上限、关闭该语言，或改用保守版。',
```

**问题**：

1. **R1 的崩溃原因是请求超时，与内存毫无关系**——这句话直接误导；
2. 它建议的「降低内存上限」指向 **R3 的无效控件**，用户照做后没有任何变化，反而更困惑；
3. 英文版 `i18n.js:591-593` 同样问题。

**修复方向**：让崩溃原因**从 `reason` 里生成**，把「内存不足」降级为「若确实因内存被拒启动时才提示」；把建议改成**按实际原因给**（超时 → 「该请求耗时过长，可调高单次请求上限」；内存 → 「关闭其它程序或改用保守版」）。

---

### R8 ［中］低内存提示指向无效控件

**位置**：`src/client/i18n.js:1181`

```js
'lsp.lowMemoryHint': '请关闭其它程序，或在设置里调低内存上限。',
```

同 R7 的第二个问题：建议的「调低内存上限」是 R3 的**死控件**。

**修复方向**：改为「请关闭其它程序，或对该语言改用保守版」；若保留内存上限入口，则必须先修 R3。

---

## 4. 低危

### R9 ［低］设置页两个都叫「保守下限」

**位置**：`src/client/i18n.js:652/660` vs `:666`，`src/client/SettingsPanel.jsx:558`

| 位置 | 文案 | 实际值 |
|---|---|---|
| 设置项（`i18n.js:652`） | 「保守兜底下限 (MB)」 / 短标签「无法估算时的兜底下限」 | `freeMemoryThresholdMB` = **512** |
| 动态行（`i18n.js:666`） | 「…保守下限 {floor} MB」 | `hardFloorMB` = **256** |

两个不同的数都叫「保守下限」，且都出现在**同一行/同一屏**（动态行就在内存分组里）。

**修复方向**：把动态行的 `{floor}` 改称「硬下限」（与设置项「内存硬下限」一致），动态行读 `hardFloorMB` 时就与 `i18n.js:656` 的命名统一了。

### R10 ［低］「重置」不重置语义分析设置

**位置**：`src/client/SettingsPanel.jsx:626-641`

重置的 patch 不含 `lsp` 段，因此以下都不被重置：`memoryLimitMB`、`freeMemoryThresholdMB`、`memoryHeadroom`、`memoryHardFloorMB`、`requestTimeoutMs`、各语言开关，以及 R5 里的 `memoryWarnedRoots`。

**修复方向**：把 `lsp` 段并入重置 patch。

---

## 5. 说明项

### R11 ［说明］用户看到的 2048 与「超时频发」都来自**旧构建**

这一条不是新代码的缺陷，但它是解释用户现象的关键。

**证据**：

1. 真实设置文件 `C:\Users\X-L-S\.dsh\ide-workbench\settings.json` 当前为：
   ```json
   { "version": 3, "lsp": { "freeMemoryThresholdMB": 2048, … } }
   ```
   **没有** `memoryHeadroom` / `memoryHardFloorMB` / `memoryWarnedRoots`。
2. 新代码写入时**恒写 `version: 4`**（`settings-store.js:333-339`），且版本不符时会生成 `settings.json.v3.bak.json`（`:297-300`）。实际目录里只有 `v2.bak.json` → **新代码从未加载过这个文件**。
3. 迁移探针实测：新代码加载该文件后得到 `version 4` / `512` / `1.5` / `256`——**新代码的门槛是 384 MB，不是 2048**。
4. 机器上有一个 **16:15:47 启动的旧 DSH 实例**（早于两个提交），它是 **21:52:29** 写设置文件的那个。**用户界面里的 2048 与超时 toast 都来自这个旧实例。**

**因此**：

- 用户报的「还是像要 2048」**不是**本轮代码的运行行为；
- 用户报的「`Request timed out` 依旧频发」**很可能**部分来自旧实例——但 R1/R2 是**真实存在于新代码中**的缺陷，且 R1 足以独立解释该现象，所以不能以「你跑的是旧版」结案；
- **发布前必须让用户重启到新构建**，否则新代码的改善（384 MB 门槛、话术、THEME 配色）他一个都看不到。

> **给发布者的行动项**：这轮改动需要**重启 DSH 进程**才生效；旧的 schema-3 设置文件会在首次启动时被自动迁移并备份为 `settings.json.v3.bak.json`。请在更新说明里明确写出这两点。

---

## 6. 配置与话术专项（用户明确要求）

### 6.1 逐条文案核对表

| 位置 | 现有文案 | 问题 | 建议 |
|---|---|---|---|
| `i18n.js:1182` | 「语言服务器已退出。**最常见的原因是内存不足**——请**降低内存上限**、关闭该语言，或改用保守版。」 | 归因错误（R7）+ 指向无效控件（R3） | 按 `reason` 分派：超时 → 「该请求耗时过长，可在设置里调高『单次请求的上限』」；内存 → 「请关闭其它程序，或改用保守版」 |
| `i18n.js:1181` | 「请关闭其它程序，或在设置里**调低内存上限**。」 | 指向无效控件（R8） | 删掉后半句，或先修 R3 再保留 |
| `lsp.js:1981` | `` `${reason}. A common cause is not enough memory.` `` | 同上，且**写死在宿主**（无法按语言/按原因变化） | 改为把结构化 `reason` 传给客户端，由客户端查表生成文案 |
| `i18n.js:651` | 「这是语言服务器的内存上限，不是启动门槛。**不支持上限的服务器会在状态栏注明**」 | 暗示支持的服务器会遵守它 —— 但全局值根本不生效（R3） | 修 R3 后此句才成立；否则改为「按语言配置，见下方列表」 |
| `i18n.js:652` / `:660` vs `:666` | 「保守兜底下限」 vs 「保守下限 {floor}」 | 同屏两个「保守下限」，值不同（512 / 256）（R9） | 动态行改称「硬下限」 |
| `i18n.js:666` | 「当前可用内存 {free} MB · {language} 预计需要 {need} MB（{state}）· 保守下限 {floor} MB」 | 「预计需要 {need}」是 `needMB`（估算需求），而**门槛**是 `thresholdBytes`（= max(硬下限, need)）。用户会把 need 当门槛 | 改为「…预计需要 {need} MB，低于 {threshold} MB 不启动 · 硬下限 {floor} MB」 |
| `i18n.js:1148` | 「当前可用 {free} MB，{language} 预计需要 {need} MB。」 | 弹窗标题「内存紧张」，但没说**门槛是多少**、说清「低于 X 就不启动」 | 补上门槛值 |
| `i18n.js:1151-1152` | 「使用基础模式」/「不启动语言服务器（本地补全 + 文本查找）」 | **措辞正确、与规格一致**，值得肯定 | — |
| `i18n.js:1154-1165` | 「为 {name} 启用语义分析」/「取消切换」/「不启用」 | **完全符合 THEME-04 规格** | — |
| `SettingsPanel.jsx:473` | 「上限 ?? 2048」 | 兜底值 2048 与 `LSP_REGISTRY` 的实际值脱节；显示的是死控件（R3） | 修 R3；并把「全局默认」与「按语言」区分显示 |
| `SettingsPanel.jsx:626-641` | 重置 patch | 缺 `lsp` 段（R10） | 补上 |
| `i18n.js:665` | 「单次请求的上限」 | UI 接受任何值，但运行时被 `Math.max(30000, …)` 静默改写（R2） | 去掉下限，或在 UI 注明「最小 30 秒」 |

### 6.2 配置层面的三处一致性问题

1. **`SETTINGS_VERSION = 4` 已经存在（`settings-store.js:14`），但迁移用的是「值等于 2048」的启发式（`:264-266`）** —— 有版本号却不用，是迁移逻辑不可靠的根源（R6）。
2. **「设置项 → 生效点」的链路有三条，且只有两条通**：
   - `memoryHeadroom` → ✅ `lsp.js:1182`
   - `memoryHardFloorMB` → ✅ `lsp.js:1185`
   - `freeMemoryThresholdMB` → ⚠️ 仅估算不可用时（`lsp.js:1193-1196`）
   - `memoryLimitMB`（全局）→ ❌ **不通**（R3）
3. **同名不同义**：`保守兜底下限`(512) / `保守下限`(256) / `内存硬下限`(256) 三个标签指向两个值（R9）。

---

## 7. 其余已实现条目的检视结果

本节覆盖补充需求里**不属于内存阈值 / 超时**的其余条目。方法：读码 + 复核关键断言 + 对可量化的部分（对比度）自行复算。

### 7.1 THEME 配色 —— R12 ［中］深色主题下对比度回退，测试因只验白底而放行

**规格内已达标的部分**（确认无缺陷）：

- 智能代码四个控件（悬停卡 / 签名帮助 / 补全弹窗 / 引用面板）的硬编码色值已彻底清除，改为 `--iwb-*` 令牌（`styles.js:33-54`）；
- 代码块底色随主题：`styles.js:1284-1291` 用 `var(--iwb-code-bg)`，其值是 `var(--dsw-alias-bg-layer-2, #232830)`；
- 补全 / 引用面板选中行用 `var(--iwb-accent)` + `var(--iwb-on-accent)`，后者 fallback 是深色 `#0d1117`（符合规格 §1.2「回退到深色」）；
- 语法高亮（`CodeEditor.jsx:134-148`）、选区 / 括号 / 搜索命中（`:169-178`）全部走令牌，且**没有**残留 `prefers-color-scheme`；
- `tests/styles-theme.test.mjs:23-34` 确实断言了那四个旧色值（`#1b1e24`/`#d8dce3`/`#7fb8ff`/`rgba(255,255,255`）在样式表中消失。

**缺陷**：新语法色板的 **fallback 值是按浅底调校的**，深色底下读不清。

`styles.js:43-44` 的注释自己写着：

> *"mid tones that read on a light **and** on a dark code layer - never the old fixed dark palette."*

但值并没有做到。**本次实测复算**（WCAG 相对亮度公式，脚本见附录）：

| 令牌 | 白底 `#ffffff` | 编辑器深底 `#15171c` | 代码块 fallback `#232830` |
|---|---|---|---|
| `--iwb-syn-comment` `#6b7482` | 4.72 | 3.80 | 3.14 |
| `--iwb-syn-string` `#2a8359` | 4.68 | 3.83 | 3.17 |
| `--iwb-syn-keyword` `#9455b5` | 4.97 | 3.61 | 2.98 |
| `--iwb-syn-type` `#12838d` | 4.51 | 3.98 | **3.28** |
| `--iwb-syn-number` `#a1651c` | 4.78 | 3.75 | 3.10 |
| `--iwb-syn-function` `#2a6cbd` | 5.28 | 3.40 | 2.81 |
| `--iwb-syn-property` `#4a63b8` | 5.57 | 3.22 | **2.66** |
| `--iwb-syn-tag` `#bb404f` | 5.30 | 3.38 | 2.79 |
| `--iwb-syn-heading` `#1e70e2` | 4.70 | 3.82 | 3.15 |
| `--iwb-syn-invalid` `#bb352c` | 5.74 | 3.12 | **2.58** |

- **白底**：4.51–5.74 ✅ 达标；
- **代码块 fallback 底 `#232830`**：**2.58–3.28** ❌ 全部低于 4.5:1；
- **编辑器深底 `#15171c`**：3.12–3.98 ❌ 全部低于 4.5:1。

旧色板在深底上是 **4.08–4.94:1**（达标）。**也就是说：为了让语法高亮「跟主题走」，深色主题下的可读性反而退化了**——而这正是 `styles.js:43-44` 注释声称不要发生的事。

**为什么测试没抓到**：`tests/styles-theme.test.mjs:79-93` 的用例名就叫 *"the syntax fallbacks are readable on a **light** background"*，断言写死了 `ratio = 1.05 / (L + 0.05)`——这个公式只对白底成立（深底要用 `max/min`）。规格 §11 风险 #11 也只要求「逐类在**浅色底**上验证」。

> ⚠️ **不确定性**：本仓没有 `@deepseek-ai/*` 依赖，**无法核实宿主实际提供哪些 `--dsw-alias-code-*`**。若宿主提供了为暗色调校的别名，真实运行时的色值会不同，本条的严重度需要实机走查后再定。**但 fallback 值本身写在仓库里、且被测试断言，属于本仓可确定的问题。**

**修复方向**：

1. 把测试从「只验白底」改成「**浅底 + 深底双验**」（对比度公式改成通用的 `max/min` 版本），先把回退暴露出来；
2. 若宿主不提供 `--dsw-alias-code-*`，则 fallback 必须自己选一套**两底都可读**的中间色调（现在的 `#bb352c`、`#4a63b8` 在深底上明显不够）；
3. 或者：让 `--iwb-code-bg` 的 fallback 与语法色板成对定义（浅底一套、暗底一套），而不是共用一套。

---

### 7.2 FIND 查找弹窗 —— R13 ［中］、R14 ［中］、R15 ［低］

**规格内已达标的部分**（确认无缺陷）：

- **代码标签页不再被占用**：全仓已无 `kind: 'search'` 的 tab；`store.js:2229-2231` 的 `openSearchTab()` 直接转调 `openSearchPopup()`；`index.jsx:532`、`EditorArea.jsx:608`/`:772` 全部走弹窗；
- **遮罩关闭与单击不冲突**：`SearchPopup.jsx:136` `onMouseDown: event => { if (event.target === event.currentTarget) store.closeSearchPopup() }` —— 点 item 时 `target !== currentTarget`，**不会误关**；
- **单击只预览、双击才跳转**：`SearchPopup.jsx:191`（单击只 `store.set({searchPopup:{...}})`）/ `:193-196`（双击 → `openSearchResult()`，先 `closeSearchPopup()` 再 `openFile`）；
- **上下文行**：`src/host/search.js:31-38`（`CONTEXT_LINES=5`、2 MB 预算）、`:249-281`、`:209-238`。

#### R13 ［中］单击文件行后，键盘全部失效

`SearchPopup.jsx:113-124` 的 `onKeyDown`（Esc / ↑↓ / Enter / F8）**只挂在输入框上**（`:153`）。文件行是 `<button>`（`:186-197`）——单击后焦点离开输入框，而**全仓没有全局 Escape 处理**（`index.jsx` 无 `Escape` 分支，F8 走全局 `:551-557`）。

**结果**：单击任一文件行后，**Esc 不再关闭弹窗、↑↓ 不再移动选择**。用户只能去点输入框才能继续用键盘——这是规格「顶部浮出式」改造带来的键盘可达性回退。

**修复方向**：把 `onKeyDown` 提升到弹窗容器（`SearchPopup.jsx:134` 的 root div，`tabIndex={-1}`），或把文件行做成不夺取焦点的元素（`onMouseDown` + `preventDefault`）。

#### R14 ［中］「全项目查找」继承「查找用法（文本）」的查询词，并自动重搜

两处代码共同造成：

```js
// store.js:2242 findUsagesText —— 写进同一切片
this.patch('search', { query, wholeWord: true, caseSensitive: false, regexp: false, textMatch: true, ... })

// store.js:2190 openSearchPopup —— 只重置了一个字段
this.set({ searchPopup: { open: true, ... } })
this.patch('search', { textMatch: false })   // ← query 与 wholeWord 没重置
```

而 `Workbench.jsx:1101-1102` 给弹窗加了 `key: search-popup-${generation}`，**每次打开都重新挂载**（注释写明是为了「starts with the query of the store and not with the one of the last session」）——于是 `SearchPopup.jsx:69/71` 的 `useState(search.query ?? '')` / `useState(search.wholeWord === true)` 会**重新读到 store 里的旧值**。

**用户看到的现象**：先用「查找用法（文本）」搜了 `spawn`，再按 `Ctrl+Shift+R` 开「全项目查找」→ **输入框里还是 `spawn`、W 开关还是打开的**，并且 `SearchPopup.jsx:93-104` 的 effect **立刻触发一次全项目重搜**。

这与规格 §6.2「消除两个入口互相覆盖查询」的意图**相悖**——`textMatch` 被重置了，`query` / `wholeWord` 却没有。

**修复方向**：`openSearchPopup()` 里一并重置 `query` 与 `wholeWord`（或区分两个入口的状态切片）。

#### R15 ［低］跳转丢掉列号——host 已经把列号传过来了

**数据其实到了客户端**：

- `src/host/search.js:294` `git grep --no-color -n -I --column --untracked` —— 明确带 `--column`；
- `src/host/search.js:178` `const match = { line, column, preview, before: [], after: [] }` —— 列号在返回结构里；
- `src/client/store.js:2690-2693` `openFile` **支持** `options.column` → `revealColumn`。

**但查找弹窗这侧把它丢了**：

```js
// SearchPopup.jsx:108-111
const openHit = (path, line) => { ... store.openSearchResult(path, line) }   // ← 没有 column
// store.js:2173-2179
openSearchResult(rel, line) { ... this.openFile(absolute, { rel, preview: false, line: ... }) }  // ← 没有 column
```

**结果**：`revealColumn` 恒为 `null`，光标落在**行首**而不是命中列。规格 §6.2 的验收要求是「定位到行**与列**」。

**修复方向**：把 `selected.matches[0].column` 一路传下去（`openHit` → `openSearchResult` → `openFile`）。这是**纯客户端的丢数据**，host 侧不用改。

---

### 7.3 GIT 未跟踪文件着色 —— R17 ［中］功能正确，但没有规模保护

**已达标的部分**（确认无缺陷）：

- `src/host/git.js:276` `['status','--porcelain=v2','--branch','-z','--untracked-files=all']`；
- `src/host/git.js:55-63` 全局注入 `-c status.showUntrackedFiles=all`，**覆盖**用户自己的 `normal` 配置（注释已说明原因）；
- `src/client/git-colors.js:122-127` 尾斜杠目录条目正确分流到 `dirs`、**不进 `files` 表**；文件条目走 `:128-129`；
- `src/client/ProjectPanel.jsx:874-877` 树端确实按文件查表，目录色由 `ancestorsOf` 聚合。

**缺陷**：`-uall` 会把**每个**未跟踪文件都列出来，叠加 `src/client/store.js:1597` 的 **2 秒无条件轮询**（`setInterval(() => { void this.pollStatus() }, 2000)`），而 `store.js:1846` 的 `call('git.status', { root, numstat })` **没有规模阈值或降级**，`src/host/git.js:147-219` 的 `parseStatusV2` 也**没有条目上限**。

规格 §11 风险 #1 写的是「**先实测**；必要时退回按需展开（二期）」——**未做限流属于规格允许范围，但「先实测」这一步没有留下任何记录**（`docs/` 里找不到 2 万文件仓库 < 300 ms 的实测数据）。

**修复方向**：给 `parseStatusV2` 加条目上限并在超限时截断 + 提示；`pollStatus` 在超大仓库下降频；补一份规格 §11 风险 #1 要求的实测记录。

---

### 7.4 PUSH 独立推送 —— R16 ［中］无上游时按钮永久禁用

**已达标的部分**（确认无缺陷）：

- 推送按钮**独立于**提交按钮（`CommitPanel.jsx:149-154` 的注释与实现一致：没有待提交内容时也允许推送）；
- `ahead` 取自 `state.status.ahead`（`src/host/git.js:176-183` 解析 `# branch.ab +N -M`）；
- 进行中 / 失败都有 toast（`store.js:3523-3542`），本地提交不受影响；
- 顶栏 `↑N` 可点并出菜单（`Workbench.jsx:91-101`、`:153-164`）。

**缺陷**：**没有上游分支时，git 的 porcelain v2 不输出 `# branch.ab`** → `ahead === undefined` → `CommitPanel.jsx:152` 取 `0` → `canPush = false` → **按钮永远禁用**。

```js
// CommitPanel.jsx:318-324
disabled: !canPush,          // ← 无上游时恒 true
title: pushHint,            // ← 无上游的提示语只能靠 title
onClick: () => { void store.push() },
```

**规格 §7.2.3 要求的是「点击 → 中文提示 + 可复制命令」**，而：
- 无上游的提示语确实写了（`store.js:3529-3538` → `commit.pushNoUpstream`），命令由 `store.js:3551-3555` `#pushUpstreamHint()` 拼出 `git push --set-upstream origin <branch>`；
- 但它**只作为 toast 的 detail 文本**（`src/client/ui.jsx:189-197` **没有复制按钮**），且**按钮是 disabled 的**——HTML 的 `disabled` 按钮不派发鼠标事件，**`title` 提示在多数浏览器里根本不会显示**。

⇒ 规格 §7.2.3 的验收路径**从 UI 上不可达**，只有 `Ctrl+Shift+K` 快捷键能触发。

**修复方向**：无上游时**不要 disabled**，改为可点击 → 弹出「设置上游」的提示 + **带一键复制的命令**（`ui.jsx` 的 toast detail 加复制按钮）。

---

### 7.5 LAYER 弹窗层级 —— **未发现缺陷**

逐项复核通过：

- `src/client/styles.js:841-843` `.iwb-modal-backdrop { … z-index: 50 }`；
- `src/client/styles.js:849` `.iwb-modal-backdrop.iwb-confirm-backdrop { z-index: 55; background: rgba(0,0,0,.6) }` → **55 > 50** ✅，且遮罩更深（规格 §8.2「附加改进」）✅；
- `src/client/ui.jsx:163-166`：`scope === 'editor'` 用 `iwb-editor-scoped-backdrop`（`styles.js:968-969`，z-index 30），其余用 `iwb-modal-backdrop iwb-confirm-backdrop` ✅；
- `src/client/Workbench.jsx:617-620` 项目选择框用 `iwb-modal-backdrop`（50），ConfirmModal 渲染在 `:1095`、ProjectPicker 在 `:1108` → **层更高，确认框可见可点** ✅；
- **三选项**：`src/client/store.js:1047-1074` `askChoice(..., [{cancel}, {discard, danger}, {save, primary}])`，文案含 `{target}` / `{count}`（`store.js:1054` + `i18n.js:1048-1049` 中英双表齐备）✅。

> 备注（不构成缺陷）：确认框的 55 高于索引决策 / 内存提醒弹窗的 50，但两者**不会同时出现**——确认框在 `#switchProjectWithIndex` 之前就已 `onClose()`。

---

### 7.6 SET-01 关闭开关即退进程 —— 主路径正确，残留 R18 ［低］

**主路径完全正确**（确认无缺陷）：

- `src/client/lsp-session.js:699-706`：`else if (hadClient) { shutdownHostLsp(previousRoot); stopLsp() }` → **先 shutdown 后 stop**，顺序符合规格 §4.2.2「顺序很重要」；
- `src/client/lsp-session.js:380-385` `shutdownHostLsp()` → `call('lsp.shutdown', { root })`，失败只 `console.warn`（规格 §11 风险 #7）✅；
- 宿主路由完整：`src/index.js:515-517` → `lsp.js:867-875` → `#shutdownEntry`（`lsp.js:2152-2173`，`intentionalExit=true` → `#terminateAndWait` → `#teardownSession` → 状态转 `idle`）→ **进程立即退出** ✅；
- 触发条件正确（`lsp-session.js:678-682`：`enabled = sessionEnabled && lspSettings?.enabled !== false`，`key` 变化才动作，`hadClient` 才 shutdown）✅；
- 行为测试齐备：`tests/lsp-health-status.test.mjs:289-302`（断言 `lsp.shutdown` 被调用 + `lspClient()===null`）、`:304-319`（宿主不可达也不卡住）✅。

**R18 ［低］残留：切换项目时旧语言服务器不停**

```js
// lsp-session.js:689-698
if (previousRoot !== root) { resetLspHealth() }
if (wanted) {
  if (hadClient) stopLsp()      // ← 只断客户端连接，不通知宿主停进程
  startLsp(store)
}
```

`src/host/lsp-ws.js` 的 WS 关闭只 `detach()`、**不停进程**（规格 §2.1(e) 自述）→ 旧项目的语言服务器会**留在宿主里直到 10 分钟 idle 超时**。此时新项目的服务器已经启动，**内存并没有归零**——这与 SET-01「关掉后内存归零」的目的一致。

> 这条**不在本轮规格内**，但与 SET-01 同类；`store.js` 里 `lsp.shutdown` 只出现在 `restartLsp`（`:1330`）与 `degradeLsp`（`:1352`）。

---

### 7.7 USAGE-01 `requestFile` —— **四项要求全部满足**（R20 说明项）

逐条复核通过：

| 要求 | 实现 | 位置 |
|---|---|---|
| 已覆写 | `async requestFile(uri)` 先查 `getFile` → 再查 `requestCache` → 再读盘 | `lsp-workspace.js:347-369` |
| 未打开的文件也能读 | 走宿主 `fs.read`（`src/index.js:195-198` → `host/workspace.js:286-294` `resolveInside(root, path)`，**宿主围栏二次生效**） | `lsp-workspace.js:381-395` |
| 项目外返回 `null` 且**不弹 toast** | `if (!this.insideRoot(absolute)) return null` —— **不调用** `notifyOutside`（该方法只被 `displayFile` 用，`:500-503`） | `lsp-workspace.js:354` |
| 按 uri 缓存、有上限、每次查找前清空 | `REQUEST_CACHE_LIMIT = 64`（`:51`）、`rememberRequest` 淘汰最旧（`:402-409`）、`clearRequestCache()`（`:417-419`）由 `lsp-session.js:277` 在 `textDocument/references` 前调用 | `lsp-workspace.js:51`/`:402-419`、`lsp-session.js:277` |
| **不开标签页** | 返回的对象 `getView() { return null }` | `lsp-workspace.js:362-365` |

**行为测试齐备**：`tests/lsp-usage-references.test.mjs:90-106`（未打开文件读到）、`:140-153`（项目外 → `null`、**无 toast**）、`:186-199`（同文件只读一次）、`:201-214`（可清空）、`:216-238`（上限 64）、`:240-253`（不开 tab）。

**唯一的低风险边界**：`readFileContent` 对文本文件**没有大小上限**（`host/workspace.js` 只对图片设了 `MAX_IMAGE_BYTES`）——一次引用面板命中一个超大文本文件会**整份读入内存**（有缓存去重，只读一次）。

---

### 7.8 新增 11 个测试文件的保真度 —— R19 ［中］

**分类**：

- **行为级（好）**：`tests/git-untracked-files.test.mjs`（真 `git init` + 真实 `status()`，验证 `-uall` 覆盖用户 `status.showUntrackedFiles=normal`）、`tests/search-context.test.mjs`（真 fs / git 快速路径 / 二进制 / 2 MB 裁剪）、`tests/lsp-usage-references.test.mjs`、`tests/find-usages.test.mjs`、`tests/lsp-health-status.test.mjs:289-319`、`tests/lsp-restart.test.mjs:74-132`（shutdown 先于 start）；
- **纯源码扫描**：`tests/modal-layer.test.mjs`（5 个用例**全部**是对源码做正则：z-index 数字、背景正则、类名字符串、DOM 顺序、i18n 字符串）、`tests/search-popup.test.mjs:345-361`（z-index 正则 + `assert.match(source, /onDoubleClick/)`）、`tests/settings-rows.test.mjs:32-44`（全量源码扫描）。

**三个「测试全绿但行为是错的」**：

1. **`tests/styles-theme.test.mjs:79-93` 只验白底对比度** → 恰好放行 R12 的深色主题回退；
2. **`tests/search-popup.test.mjs:240-253`** 名为 *"a single click only selects the file, nothing is opened"*，实际只调了 `store.moveSearchSelection(1)`，**没有模拟一次 DOM 点击**；`:357-361` 的源码正则只能证明「存在一个 onClick 且其体是 `store.set({searchPopup…`」，无法证明真实点击路径（更无法证明遮罩不会误关）——**正好放过 R13**；
3. **`tests/modal-layer.test.mjs`** 没有规格 §10.1 要求的「**两者都存在时确认框可点**」的行为断言（没有真的渲染两个对话框再验证可见 / 可点）。

**规格 §10.1 明列但缺失的用例**：`tests/search-popup.test.mjs` 全文 361 行**没有**「Esc 关闭 / 遮罩关闭 / ✕ 关闭」任一断言——而这正是 R13 的藏身处。

> 归位备注（非缺陷）：规格 §10.1 把「`lsp.enabled=false` → 宿主会话 idle」放在 `tests/lsp-restart.test.mjs`，实际落在 `tests/lsp-health-status.test.mjs:289-302`——覆盖存在，只是文件归位不同。

---

## 8. 修复建议与顺序

| 优先级 | 条目 | 理由 |
|---|---|---|
| **P0** | **R1**（看门狗按请求计数） | 唯一能解释「超时频发」+「莫名降级」的根因，且在大项目上自触发循环；修复面小（集中在 `relayToServer` + `#checkTimeouts`） |
| **P0** | **R7 / R8**（话术归因） | 成本极低（改字符串），但直接决定用户是否会被误导去调无效控件 |
| **P0（发布动作）** | **R11**（重启 + 迁移提示） | 不做的话，用户看到的仍是旧版行为，本轮所有改进都无法验证 |
| **P1** | **R3**（死控件） | 让「内存上限」要么生效要么消失；顺带解决 §1.1 的「看着像 2048」 |
| **P1** | **R2**（握手失败可恢复） | 决定「超时之后不刷新页面能不能恢复」 |
| **P1** | **R4**（判定收敛到一处 + toast 用对字段） | 消除客户端/宿主结论矛盾 |
| **P1** | **R13 / R14**（查找弹窗键盘 + 两入口串味） | 用户可直接感知的路径；R14 还违背规格 §6.2 的明确意图 |
| **P1** | **R16**（无上游时推送按钮可点 + 一键复制） | 规格 §7.2.3 的验收路径当前不可达 |
| **P2** | **R12**（语法色板深底对比度） | 需先实机确认宿主是否提供 `--dsw-alias-code-*`；测试改双底断言是第一步 |
| **P2** | **R15**（列号丢失）、R17（`-uall` 规模保护）、R19（测试保真度） | 各自独立；R19 建议与 P0/P1 的修复同批做，否则同类缺陷还会再来 |
| **P2** | R5（记录用户选择）、R6（迁移收敛）、R9（命名）、R10（重置补 `lsp`）、R18（切项目停旧进程） | 独立、低风险、可打包一次 |

### 需要补的回归测试

| 缺失覆盖 | 建议测试 |
|---|---|
| 只发通知不得计入超时 | 在 `tests/lsp-health-status.test.mjs` 加：发 `didChange` 通知后静默 > timeout，`timeouts` 仍为 0、`terminated === false` |
| 全局 `memoryLimitMB` 影响 worker ceiling | 在 `tests/lsp-memory-policy.test.mjs` 加：设置全局值后断言**注入 worker 的 ceiling**（不是「设置值被读到」） |
| 宿主与客户端判定一致 | 同一份 `resources` fixture，宿主 `status()` 的判定与客户端 `store` 的判定必须相同 |
| 握手 reject 后可恢复 | 模拟握手失败 → 断言下一次 `request()` 能重新握手成功，而非永远 reject |
| toast 字段正确 | 断言 toast 里的「需要 X MB」等于 `thresholdBytes`（MB），不是 `needMB` |
| 查找弹窗的三条关闭路径 | 在 `tests/search-popup.test.mjs` 加真实交互断言：Esc / 遮罩 / ✕ 都能关闭（规格 §10.1 已明列，当前 361 行里**一条都没有**） |
| 单击行后键盘仍可用 | 单击文件行 → 断言焦点仍在弹窗内，Esc / ↑↓ 仍生效（R13） |
| 遮罩关闭与单击不冲突 | **模拟一次真实 DOM 点击**（当前 `:240-253` 只调了 `moveSearchSelection`），断言弹窗未关闭且未打开文件 |
| 语法色板双底对比度 | 把 `tests/styles-theme.test.mjs:79-93` 改成「白底 **且** 深底」双验，对比度公式改通用版（R12） |
| 层级是行为而非源码 | `tests/modal-layer.test.mjs` 增加「确认框与项目选择框同屏时确认框可点」的**渲染后**断言，而不是源码正则（R19） |

---

## 附录：本次检视的复现命令

```powershell
# 1. 全量测试（实测 640/640 通过，0 失败，约 25.7s）
cd D:\Code\Node\DSH-IDE-TOOLWINDOWS-ROOT\dsh-ide-workbench
npm test

# 2. 三个探针（仓库外，只读；注意 ROOTS 是进程全局的，每个探针须用独立 root）
cd $env:LOCALAPPDATA\Temp\iwb-probe
node probe-migration.mjs    # 设置迁移：schema3 文件 -> version4 / 512 / 1.5 / 256
node probe-watchdog.mjs     # 看门狗：只发 didChange 通知 3 轮 -> 杀进程 + 重启（复现 R1）
node probe-ceiling.mjs      # 全局 memoryLimitMB 到不了 worker ceiling（恒 2048，复现 R3）

# 3. 语法色板对比度复算（复现 R12）
node $env:LOCALAPPDATA\Temp\iwb-probe\contrast.mjs
#   → 白底 4.51-5.74 达标；深底 #15171c 3.12-3.98；代码块 #232830 2.58-3.28（均 < 4.5:1）
```

**探针说明**：均以 `file:///D:/Code/Node/DSH-IDE-TOOLWINDOWS-ROOT/dsh-ide-workbench/src/host/lsp.js` 直接 import **生产代码**，并复用 `tests/lsp-fixtures.mjs` 的 `makeManager`（含 `makeFakeHandle` / `makeFakeWorker` / `waitFor`），不修改仓库任何文件。

> ⚠️ `src/host/lsp.js:276` 的 `ROOTS` 是**进程全局**的（注释原文：*"The map is process-global on purpose"*），多个 `LspManager` 实例共享同一批 root 条目 → **每个探针必须使用独立的 root**，否则会读到上一个 manager 的 session。

---

## 附录二：与前几轮检视的关系

| 前几轮 | 本轮是否重复 | 说明 |
|---|---|---|
| **N2**（单个挂起请求击穿崩溃阈值） | **已修复**，但**修得不彻底** | N2 的三处修复（按请求去重、响应后复位、文案改「N 次请求超时」）都做到了；但**计数基线选错了**——它把「客户端活动时刻」当基线，而该时刻被通知不断刷新（R1）。N2 的回归测试因此仍在「真发请求」的场景里通过 |
| **M2**（超时计数器复位无测试覆盖） | **仍无覆盖** | 见 §8「需要补的回归测试」 |
| **N7**（`servers[lang].enabled` 有文档无实现） | **本轮部分落地** | `lsp-session.js:678` 已实现 `enabled` 读取；按语言的 `memoryLimitMB` 仍然**没有 UI 入口**（R3），设置页 `SettingsPanel.jsx:577-599` 只有开关和状态 |
| **N1 / D1–D9 / M1 / M3** | 不重复 | 均为握手重放、崩溃恢复、取消幂等等，与本轮条目无关 |
| **D5 / D7 / D8** | 无冲突 | 本轮未触及 |

**结论**：R1 是 **N2 修复引入的残留缺陷**，而非全新问题——这解释了为什么「`Request timed out` 依旧比较频发」在上一轮修复后**没有改善**。
