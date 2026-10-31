# PRD-v5 代码检视报告（第三轮：修复复核）

> **范围**：`bf4927e` → `59ef905`（1 个提交，`fix(code): stop one language server from killing the whole IDE`）。
> **基线**：`bf4927e`。**对照物**：`docs/PRD-v5-代码检视报告-第二轮.md`（上一轮，S1–S9）、`docs/PRD-v5-代码检视报告-第二轮-修复记录.md`（开发方的修复记录）。
> **方法**：读代码 + **实跑验证**。`npm test` 实跑 **698 项 / 698 通过 / 0 失败**（上一轮 669）；自建 **3 个新探针**（变异测试、接管机制验证、预算一致性测量）直接 import 生产代码。
> **本次检视未修改任何源码**。探针脚本写在仓库外的临时目录（`%LOCALAPPDATA%\Temp\iwb-probe\`）。
> **检视日期**：2026-11-01。
> **重点关注**：① 上轮 S1–S9 的修复是否真的成立；② 开发方**没有照搬**我上轮建议的两处方案是否成立；③ 新判据（10 分钟预算）有没有引入新的不一致。

---

## 0. 结论

### 0.1 一句话

**上轮 9 条发现全部修复，且其中两处「没有照搬我的方案」的处理比我的建议更正确。** 致命崩溃已实证封堵（我做了变异测试，确认回归用例在修复前是红的）。本轮只剩 **1 条中危**：**语言服务器崩溃重启后，宿主与客户端的请求预算不一致**，而**用户能看见的那一侧恰好是错的那一侧**。

### 0.2 上轮 S1–S9 的复核：**9/9 全部修复**

| 编号 | 严重度 | 上轮的结论 | 本轮复核 | 关键证据 |
|---|---|---|---|---|
| **S1** | 高 | stdin 没有 `'error'` 监听 → EPIPE 打死宿主 | ✅ **已修复（变异测试实证）** | `lsp.js:1541-1549`；变异测试：摘掉监听器 → `uncaught=1 (EPIPE)`，保留 → `uncaught=0` |
| **S2** | 中 | `#spawn` 从不停旧 worker → 线程泄漏 + 跨代帧污染 | ✅ 已修复 | `lsp.js:1468`/`:1519`/`:1523` 先 `#stopWorker`；回归用例断言 `workers[0].terminated === true` |
| **S3** | 中 | worker 消息回调没有 generation fence | ✅ 已修复 | `lsp.js:1486`/`:1492` 两处 `session.generation !== generation` |
| **S4** | 中 | `#onCrash` 不清 `session.handle` | ✅ 已修复 | `lsp.js:1563`/`:2099`/`:2192`/`:2302`/`:2373` 五处置空 |
| **S5** | 中 | `building` 阶段仍统计真请求超时 | ✅ **已修复，且判据比我的建议更准**（见 §1.2） | `lsp.js:2039` `budget = realAnswers > 0 ? timeout : BUILD_REQUEST_TIMEOUT_MS` |
| **S6** | 中 | 客户端 30 s 与大项目固有冲突 | ✅ 已修复 | `settings-defaults.js:30` `BUILD_REQUEST_TIMEOUT_MS = 600000`；`lsp-session.js:679` `requestBudgetOf` |
| **S7** | 中 | R3 新语义没写进话术；无按语言上限 | ✅ 已修复 | `i18n.js` 话术改写；`SettingsPanel.jsx:624`/`:671`/`:673` 按语言上限输入框（留空即用全局） |
| **S8** | 低 | 工作区外文件仍被 `didOpen` → 假错误 toast | ✅ 已修复 | `lsp-workspace.js` 新增 `announced` 标志：工作区外的文件**不宣布**给服务器，其 `didChange`/`didClose` 也跳过 |
| **S9** | 低 | 宿主无 `uncaughtException` 兜底 | ✅ **已修复，且实现方式比我的建议更对**（见 §1.3） | `index.js:138-184` 接管式错误边界 + `host/guard.js` 的 `guardEmitter()` |

### 0.3 本轮新发现（T1–T7）

| 编号 | 严重度 | 一句话 | 位置 |
|---|---|---|---|
| **T1** | **中** | **崩溃重启后宿主回到 10 分钟预算，客户端仍是 30/45 秒** —— 用户可见的那一侧是错的那一侧 | `src/host/lsp.js:1531` vs `src/client/lsp-session.js:233-235` |
| **T2** | 低 | `session.timeouts` 跨重启**不清零** → 崩溃前的累计值被继承 | `src/host/lsp.js:1531-1532` |
| **T3** | 低 | 宿主把**任何**非握手请求的回答都算作「真实回答」，客户端只算 8 个语义方法 —— 目前不可达，但是隐患 | `src/host/lsp.js:1687` vs `src/client/lsp-session.js:64-73` |
| **T4** | 低 | 错误边界把**所有** session 都降级，与故障来源无关 | `src/index.js:825-836` |
| **T5** | 低 | 接管式边界以 `listener(error)` 调用宿主的 handler，**没有传 Node 的第二个参数 `origin`** | `src/index.js:163-165` |
| **T6** | 低 | 接管式边界依赖「宿主先装 handler」的顺序假设 —— 宿主若后装，两个监听器并存，边界对插件错误也失效 | `src/index.js:145`/`:167-168` |
| **T7** | 说明 | 10 分钟预算的代价：**第一次补全可能挂 10 分钟**（开发方自己已提出并给了替代方案） | `src/client/lsp-session.js:679-683` |

**统计：中 1 / 低 5 / 说明 1。**

### 0.4 总体判断

**这一轮的修复质量高于上一轮。** 三点尤其值得肯定：

1. **不是打补丁，是改结构**。上轮我指出「给流挂 `'error'` 监听要成组处理」，这轮他们把这件事提炼成了 `guardEmitter()`（`src/host/guard.js`），并把**仓库里每一个 emitter 都过了一遍**——我复核过：`lsp-ws.js:62`、`:116`、`index.js:700`、`:711`、`:744`、`fileops.js:223`、`git.js:99`、`workspace.js:529`、`lsp.js:1542`/`:1600`/`:1610`、以及 frame worker 两侧的 `'messageerror'`（`lsp.js:1497`、`lsp-worker.js:346`）。**覆盖完整，没有遗漏。**
2. **他们指出我的两条建议是错的，而且是对的**（§1.2、§1.3）。我没有坚持自己的方案，而是逐条复核了他们的理由——**两条都成立**。
3. **回归用例是真红过的**。我做了变异测试：把 `stdin` 的 `'error'` 监听器摘掉（即回到修复前），生产代码立刻 `uncaught = 1 (EPIPE)`；保留监听器则 `uncaught = 0`。**这不是「写完就绿」的假用例。**

**唯一遗留的中危（T1）是新判据带来的副作用**，不是上一轮的漏网之鱼——它只在「服务器崩溃并自动重启」这一条路径上出现，而这条路径恰恰是**大项目上最容易发生**的。

---

## 1. 三处关键复核

### 1.1 S1：致命崩溃已封堵（变异测试实证）

**修复代码**（`src/host/lsp.js:1541-1549`）：

```js
if (handle.stdin) {
  handle.stdin.on('error', (error) => {
    // The handler must never throw: it runs inside the error path of the
    // stream, and a throw here is an uncaught exception as well.
    try {
      this.#ctx?.logger?.warn?.('lsp: the language server closed its stdin: %s', messageOf(error))
    } catch { /* a broken logger may not take the host down */ }
  })
}
```

**注释与实现都到位**：handler 本身不抛（它跑在流的错误路径上），日志器坏了也不至于反手打死宿主。

**变异测试**（`probe-mutation-epipe.mjs`，我自建）：把 `stdin` 的 `'error'` 监听器**在运行时摘掉**——这与「修复前」等价：

```
修复后(保留监听器): stdin 'error' 监听器 1 -> 1 | uncaught = 0
修复前(摘掉监听器): stdin 'error' 监听器 1 -> 0 | uncaught = 1 (EPIPE)
```

⇒ **开发方「该回归用例在修复前是红的」这句话成立。** 而且他们指出测试替身的关键缺陷也说对了：替身必须**异步**断管——同步抛错会被 `#writeToServer` 的 `try/catch` 吃掉，**证明不了任何事**。新 fixture 用 `setImmediate` 发 `'error'`（`tests/lsp-fixtures.mjs:67-79`），形状正确。

**其余三条根治项也到位**：S2（旧 worker 先停）、S3（generation fence）、S4（`session.handle` 五处置空）。回归用例 `tests/lsp-recovery.test.mjs` 的三条断言（「不打死宿主」「停服后到达的帧不写进死管道」「上一代 worker 的帧不进新服务器」）与实现一一对应。

### 1.2 S5：他们推翻了我的建议，而他们是对的

**我上轮建议**：在 `building` 阶段不计数（`lsp.js:1958` 那个状态判定）。

**他们的反驳**（`src/client/lsp-session.js:668-672` 原文）：

> *"The mirrored state of the session is deliberately not used: the host marks a session `ready` about ten milliseconds after the server answered `initialize`, while the long program build happens minutes later — on the first semantic request. A budget that followed the state would therefore never apply to the request that actually takes ten minutes."*

**我复核了这条理由，成立**：`#scheduleReady`（`lsp.js:1654-1666`）在服务器**任何**一条输出之后（约 10 ms）就把会话从 `building` 切到 `ready`。而 PRD §0.2 #3 记录的那个「可超 10 分钟」的构建，发生在**第一个语义请求**上——那时状态早就是 `ready`。**按状态判断的预算永远碰不到那个真正要十分钟的请求。我的 S5 建议是错的。**

**他们的新判据**（`src/host/lsp.js:2039`）：

```js
const budget = session.realAnswers > 0 ? timeout : BUILD_REQUEST_TIMEOUT_MS
```

`realAnswers` 只在**非握手**请求被回答时递增（`:1687`），握手本身不算——因为握手是毫秒级 answered 的，说���了服务器的速度。而「服务器用错误回答也算回答」（客户端 `isClientDeadline` 只认 `Error` 且消息恰好是 `Request timed out` 的那一种，`lsp-session.js:327-330`）——这个区分很精确，连「服务器的错误消息里恰好提到 timeout」都不会被误判。

**这个判据同时解决了两个方向的问题**：

- 服务器**构建中**（还没回答过任何语义请求）→ 10 分钟预算 → 不再被杀；
- 服务器**已经工作过**（回答过一次语义请求）→ 配置预算 → 卡住的请求照样能被清理。

**新的测试是有保真度的**（`tests/lsp-client-budget.test.mjs`，6 条用例，走真实的 `configureLsp` + `lspClient()`）：起始长预算 / 第一次语义请求长预算 / 回答后回配置值 / **非语义请求不改计数** / **服务器的错误回答算回答** / **客户端自己的超时不算回答**。最后一条尤其关键——它把「客户端超时」和「服务器没答」区分开了，这正是两侧能对齐的前提。

### 1.3 S9：他们说我的建议在 DSH 上不生效，而他们是对的

**我上轮建议**：加 `process.on('uncaughtException')`。

**他们的反驳**（`src/index.js:128-132` 原文）：

> *"Taking the event over (instead of adding a listener) is deliberate: Node copies the handler array before it calls the handlers, so a listener that removes the other handlers while it runs cannot stop them from being called in the same turn — the host's handler would end the process before the boundary could do anything about it."*

**我实测验证了这条 Node 语义**（`probe-takeover.mjs`）：

```
场景1（两个监听器，A 在自己回调里 removeAllListeners）: 调用顺序 = A,B -> B 仍被调用 ✅（emit 复制了数组）
场景2（非插件错误）: 调用 = host:host-error -> ✅ 宿主 fail-loud 仍然生效
场景3（插件错误）  : 调用 = contained     -> ✅ 被隔离，宿主未被拖死
```

**结论：他们完全正确。** 宿主装了 fail-loud 处理器（uncaught → 写诊断 → `process.exit(1)`），插件如果只是「再挂一个监听器」，宿主的处理器**在同一次 emit 里照样会被调用**（因为 Node 在调用前复制了监听器数组），插件根本来不及拦。**我的建议在 DSH 上确实无效。**

**他们的实现**（`src/index.js:144-170`）：

```js
const inherited = process.listeners(event)          // 记住宿主原有的
const handler = function boundary(error) {
  if (isPluginFault(error)) { /* 隔离 + 记录 + onFault */ return }
  for (const listener of inherited) {               // 不是插件的 -> 原样交还宿主
    try { listener(error) } catch { }
  }
}
process.removeAllListeners(event)                   // 接管，而不是叠加
process.on(event, handler)
```

**三个设计点都对**：

1. **判定窄**：`isPluginFault`（`:92-95`）用**栈里是否含插件自己的目录**（`PLUGIN_DIR`，`:58`）来归属——「只有栈指向本插件源码的错误才是本插件的事」。宿主的错误原样交还，fail-loud 策略**一点没变**。
2. **生命周期正确**：边界装在 **Cordis effect** 里（`:821`），插件卸载时随 effect 一起走，**不在宿主里留监听器**；卸载器还会把宿主原有的 handler 放回原位（`:173-183`）。
3. **兜底面补全**：除了 `uncaughtException`/`unhandledRejection`，还把 `guardEmitter()` 铺到了**每一个 emitter**（含他们额外发现的：终端的 `WebSocketServer`、终端 socket、语言服务器中继的 `WebSocketServer`，以及 frame worker 两侧的 `'messageerror'`）。

**这三条「我没找到的缺口」是真的**——我上轮只扫了 `src/host/lsp.js` 一处的流，没做全仓 emitter 审计。他们补上了。

---

## 2. 本轮新发现

### T1 ［中］崩溃重启后，宿主与客户端的请求预算不一致

**这是本轮唯一的中危，也是上轮 S6 修复带来的副作用。**

**两侧的复位时机不同**：

| | 复位点 | 崩溃重启后 |
|---|---|---|
| **宿主** `session.realAnswers` | `lsp.js:1531`（`#spawn` 里，**每个新进程都复位**） | **回到 10 分钟** ✅ |
| **客户端** `semanticAnswers` | `lsp-session.js:235`（`resetLspHealth`），只在**socket 重开**（`:852`）、**客户端重建**（`:891`）、**切项目**（`:926`）时复位 | **仍是配置值（默认 30 秒）** ❌ |

**为什么 socket 不会重开**：`src/host/lsp-ws.js` 的中继 WebSocket 是**浏览器 ↔ 宿主**之间的通道，宿主进程没死，只是背后的语言服务器进程被换了一个。`lsp-ws.js:104-120` 只在 socket 自身关闭时 `detach()`；**服务器崩溃不会关这个 socket**。因此客户端的 `reinitializeLsp()` 不会被触发，`resetLspHealth()` 也就不会被调用。

**而且客户端没有任何别的路径能复位它**：`refreshLspSession()`（`lsp-session.js:979-982`）是唯一能触发 `stopLsp()` → `resetLspHealth()` 的公开入口，但**全仓没有任何调用者**（`grep` 结果：只有 `configureLsp`（`index.jsx:20`）和 `CodeEditor.jsx` 的几个辅助函数被 import）。状态轮询走的是 `lsp.status`，**不复位预算**。

**实测（`probe-budget-host.mjs` + `probe-budget-mismatch.mjs`）**：

```
=== 宿主：realAnswers 在崩溃重启后是否复位（预算 400ms vs 600000ms） ===
  阶段1 (realAnswers=1): timeouts 0 -> 1   ✅ 用 400ms 配置预算，会被计数
  崩溃重启后: 进程启动次数=2 状态=building
  阶段2 (重启后): timeouts 1 -> 1   ✅ 未再被计数 -> 宿主用回了 600000ms 预算

=== 客户端：服务器崩溃重启（socket 不重开）后，预算复位吗？ ===
  一次语义请求被回答后：client.timeout = 45000 ms
  服务器崩溃重启后：client.timeout = 45000 ms  ❌ 没复位 -> 客户端仍用 45 秒
```

⇒ **宿主 600000 ms / 客户端 45000 ms —— 两侧不一致。**

**用户可见的后果**（这正是他们想消灭的那个噪声）：

大项目上语言服务器崩溃并自动重启 → 新进程要**从头重建 program**（这正是需要几分钟的那次请求）→

- **客户端 30 秒就放弃** → 弹「Request timed out」→ 状态栏显示「语义分析：不稳定（连续超时 N 次）」；
- **宿主仍在耐心等 10 分钟**，**不会**杀服务器 → 用户既没等到结果，也没看到「正在构建」的进展说明。

**讽刺的是**：他们把崩溃重启后的长预算**只给了宿主侧**（那个用户看不见的、只会杀进程的），却把短预算**留在了客户端**（那个会弹 toast、会改状态栏的）。

**修复方向**（三选一，第 1 个最直接）：

1. **宿主在重启后通知客户端**：宿主已经有 `notify` 机制（`lsp.js:2109` 的 `{type:'crash'}`），在 `#restart`/`#spawn` 之后补一条 `{type:'restarted', root}`；客户端的 sink 收到它就 `resetLspHealth()` + `applyRequestBudget()`。
   —— 顺带说明：**客户端目前完全没有处理 `type:'crash'`**（`grep "'crash'" src/client` 只有状态栏的文案），所以宿主早就在通知、客户端一直没接。
2. **宿主的 `status()` 暴露一个会话代号**（每次新进程 +1），客户端在 2 秒轮询里发现代号变了就复位。好处：不依赖通知的可靠性。
3. **客户端监听状态迁移**：`crashed`/`restarting` → `building` 时复位。缺点：依赖轮询的时序，反应慢一拍。

> 顺带一提：**客户端侧其实已经有现成的机制**——`reinitializeLsp()`（`lsp-session.js:842-861`）里就写着「新的语言服务器要重建 program，所以它的第一次语义请求也需要长预算」，并且已经调用了 `resetLspHealth()` + `applyRequestBudget()`。**只是它只在 socket 重开时触发**。所以修复 1 或 2 的改动量很小：把「服务器重启」也接到同一条路径上即可。

---

### T2 ［低］`session.timeouts` 跨重启不清零

`lsp.js:1531-1532` 在新进程起来时复位了 `realAnswers` 和 `pendingRequests`，**但没有复位 `timeouts`**。

**实测**（上面探针的输出）：崩溃重启后 `timeouts` 仍是 **1**（崩溃前的累计值）。

**后果**：崩溃前已经累计了 2 次超时的话，重启后**第一次**超时就会达到 `timeoutLimit = 3` → 服务器被更早地杀掉。量级不大，但与 T1 同源，建议一起清。

**修复方向**：`#spawn` 里加一行 `session.timeouts = 0`。

---

### T3 ［低］宿主与客户端对「一次回答」的认定不同（目前不可达，但是隐患）

**宿主的判据**（`lsp.js:1687`）：`pending.handshake !== true` → `realAnswers += 1`。
**只有 `initialize` 被排除**（worker 用 `handshake.isInitialize(text)` 标记），**其余任何带 id 的载荷**都算。

**客户端的判据**（`lsp-session.js:64-73`）：只有 8 个 `SEMANTIC_METHODS` 算。

**⇒ 一个「非语义、非握手」的请求会让宿主的预算提前切回 30 秒，而客户端仍在用 10 分钟** —— 正是他们队友提醒过的「宿主提前杀掉客户端还在等的服务器」。

**目前不可达**：插件**不注册**库的 `renameKeymap`/`formatKeymap`（`lsp-session.js:12-17` 明确说明，`lspExtensions()` 手工装配扩展），所以 `textDocument/formatting` / `textDocument/rename` **不会被发出**；仓库里也搜不到 `workspace/executeCommand` / `workspace/symbol` 的调用。新测试甚至专门断言了「非语义请求不改计数」（`lsp-client-budget.test.mjs:161`）。

**但这是一个「靠「我们不发」维持着」的不变量**：哪天有人接入了格式化或重命名，宿主侧就会提前收紧预算，而客户端还在等 ⇒ 又一次「Request timed out」+ 服务器被杀。

**修复方向**：两侧用**同一个**定义。最省事的是让宿主也只把「客户端认为算数的那些方法」算作真实回答——worker 本来就在解析方法名，让它一并上报方法名即可（`{type:'request', id, handshake, semantic}`）。

---

### T4 ［低］错误边界把所有 session 都降级，与故障来源无关

`index.js:825-836` 的 `onFault`：

```js
const states = lsp.liveStates()
for (const root of roots) {
  lsp.transition(root, 'degraded', 'the language server reported a broken pipe')
}
```

`isPluginFault` 判定的是「**这个插件的**任何错误」——所以一个与语言服务器**毫无关系**的插件 bug（比如终端、文件操作）也会把所有语言服务器降级成 `degraded`，状态栏变成「语义分析：不可用」，而真实原因在日志里。

**修复方向**：`onFault` 接收错误后按来源分流——只有栈里指向 `src/host/lsp*` 的才降级会话；其余的只记日志。

---

### T5 ［低］接管式边界没有把 Node 的第二个参数 `origin` 传给宿主的 handler

`index.js:163-165`：

```js
for (const listener of inherited) {
  try { listener(error) } catch { }
}
```

Node 的 `uncaughtException` 处理器签名是 **`(error, origin)`**，其中 `origin` 是 `'uncaughtException'` 或 `'unhandledRejection'`（Node 17+）。插件把 `unhandledRejection` 的错误交给宿主时，**`origin` 丢了**（变成 `undefined`）。

如果 DSH 的 fail-loud 处理器按 `origin` 分流（比如对 `unhandledRejection` 和 `uncaughtException` 写不同的诊断），它的行为就会变。

**修复方向**：把 `origin` 一起传下去。接管函数需要记住事件名：

```js
for (const listener of inherited) {
  try { listener(error, event === 'uncaughtException' ? 'uncaughtException' : 'unhandledRejection') } catch { }
}
```

---

### T6 ［低］接管式边界依赖「宿主先装 handler」的顺序假设

`index.js:145` 的 `inherited = process.listeners(event)` 捕获的是**接管那一刻**已存在的监听器；`:167-168` 随即 `removeAllListeners` + `process.on`。

**如果宿主在插件加载之后才安装自己的 fail-loud 处理器**，那么 emit 时会有两个监听器：边界 + 宿主的。宿主的处理器**照样会被调用**（Node 复制数组）⇒ **对插件错误，宿主仍然会 `process.exit(1)`**，边界形同虚设。

这是一个**顺序假设**，不是当前的实际故障（宿主几乎肯定在插件加载前就装好了），但它没有写在代码里，也没有被断言守住。

**修复方向**：二选一——

1. 边界在运行时**检查**宿主的处理器是否还在（例如每次 emit 时重新 `process.listeners('uncaughtException')`，发现宿主又装了新的就把自己摘掉并把控制权交还）；
2. 或者在代码注释里把「宿主先装、插件后接管」这个前提写清楚，并加一条断言/测试。

---

### T7 ［说明］10 分钟预算的代价：第一次补全可能挂 10 分钟

`serverCompletion` **是**注册了的扩展（`lsp-session.js:38` 的 import，`lspExtensions()` 手工装配），而 `textDocument/completion` **在** `SEMANTIC_METHODS` 里 ⇒ **第一次补全会拿到 10 分钟预算**。

也就是说：大项目上会话建立后的**第一次自动补全**，编辑器会等最长 10 分钟才有结果。

开发方**自己已经提出**了这一点（「第一次补全可能要等十分钟」「如果实机上这个等待不可接受，告诉我，我把补全单独摘出来用短预算」），并给出了替代方案——**这一点做得好**。

**我的建议**：不用等到实机反馈才决定。补全和「跳转定义」的性质不同：

- **跳转定义 / 查找引用 / 悬停** 是用户**主动**发起的、愿意等的操作 → 长预算合理；
- **补全** 是编辑器**每次输入**都会自动发起的 → 长预算会让编辑器在会话开始后**长时间挂起**，而且用户没有任何办法知道它在等什么。

具体建议：把 `textDocument/completion` 排除在长预算之外（用配置值），其余七个方法保留长预算；或者保留长预算，但让状态栏在等待期间显示「正在构建索引（首次语义请求可能需要数分钟）」——**后者更诚实，也不需要改判据**。

---

## 3. 修复建议与顺序

| 优先级 | 条目 | 理由 |
|---|---|---|
| **P1** | **T1**（崩溃重启后客户端复位预算） | 用户可见的那一侧是错的那一侧；改动量小——宿主补一条 `{type:'restarted'}` 通知，客户端接到就复用现成的 `reinitializeLsp()` 里的复位逻辑 |
| **P2** | T2（`timeouts` 跨重启清零） | 一行，与 T1 同源 |
| **P2** | T7（补全的长预算） | 在实机反馈前决定；建议给状态栏一句「正在构建索引」的说明 |
| **P2** | T3（两侧「回答」定义统一） | 目前不可达，但靠「我们不发」维持的不变量很脆 |
| **P3** | T4（`onFault` 按来源分流）、T5（补 `origin`）、T6（顺序假设写进注释/加断言） | 都是小修 |

### 建议补的回归测试

| 缺失覆盖 | 建议测试 |
|---|---|
| **崩溃重启后客户端拿到长预算** | 在 `tests/lsp-client-budget.test.mjs` 加：回答一次语义请求 → 模拟服务器崩溃重启（socket 不重开）→ 断言 `client.timeout === BUILD_REQUEST_TIMEOUT_MS` |
| **崩溃重启后 `timeouts` 归零** | `tests/lsp-health-status.test.mjs`：累计 2 次超时 → 崩溃 → 重启 → 断言 `timeouts === 0` |
| **两侧判据一致** | 一个断言「宿主与客户端对同一个请求序列给出一致的预算」��跨层用例 |

---

## 附录：本次检视的复现命令

```powershell
# 1. 全量测试（实测 698/698 通过，0 失败，约 29.1s）
cd D:\Code\Node\DSH-IDE-TOOLWINDOWS-ROOT\dsh-ide-workbench
npm test

# 2. 本轮新增的三个探针（仓库外，只读）
cd $env:LOCALAPPDATA\Temp\iwb-probe

node probe-mutation-epipe.mjs     # 变异测试：摘掉 stdin 'error' 监听器 -> uncaught=1 (EPIPE)
                                   #   证明「writing to a dead server's stdin does not kill the host」在修复前是红的
node probe-takeover.mjs            # Node emit 复制监听器数组；接管方案下宿主 fail-loud 仍生效、插件错误被隔离
node probe-budget-host.mjs         # 宿主：崩溃重启后 realAnswers 复位 -> 预算回到 600000ms
node probe-budget-mismatch.mjs     # 客户端：崩溃重启后预算不复位 -> 仍 45000ms（两侧不一致）

# 3. 上一轮的探针（仍然可用）
node probe-e2e.mjs      # 崩溃端到端复现（修复前）
node probe-r1b.mjs      # 通知不计入超时
node probe-r3.mjs       # 全局内存上限生效
```

**探针说明**：均直接 import 生产代码（`src/host/lsp.js`、`src/client/lsp-session.js`、`src/host/settings-defaults.js`），复用 `tests/lsp-fixtures.mjs` 的 `makeManager`，不修改仓库任何文件。

> ⚠️ `src/host/lsp.js` 的 `ROOTS` 是**进程全局**的 → 每个探针必须用**独立 root**。

### 崩溃日志与宿主重载

- 上轮的崩溃日志：`C:\Users\X-L-S\AppData\Roaming\@deepseek-ai\dsh-desktop\logs\crash-2026-10-31T15-12-19-723Z-host.log`
- **开发方提醒得对**：本轮的修复全在**宿主侧**（`src/host/*`）+ 客户端侧（`src/client/*`）。**宿主侧不会热更新**——必须重启 DSH 或重载插件，否则跑的还是旧宿主，**崩溃仍会发生**。客户端刷新页面即可。

---

## 附录二：与前几轮检视的关系

| 前几轮 | 本轮关系 | 说明 |
|---|---|---|
| **S1–S9**（上一轮） | ✅ 全部修复 | 见 §0.2。其中 S5、S9 两处**开发方推翻了我的建议**，复核后**他们是对的**（§1.2、§1.3） |
| **R1–R20**（上上轮） | ✅ 保持修复 | 本轮未触及相关代码路径；`BUILD_REQUEST_TIMEOUT_MS` 是新增的共享常量（`settings-defaults.js:30`），延续了「单一事实来源」的做法 |
| **N2 / M1–M3 / D1–D9** | 不重复 | 与本轮条目无关 |

**一句话总结**：这一轮把「一个语言服务器不能杀死整个 IDE」这件事做对了，而且做得比我建议的更细——**从「补一个监听器」上升到了「给插件的每个 emitter 加错误边界」**。剩下的 T1 是一个新判据带来的副作用，修起来不大，但它正好落在用户最在意的路径上（崩溃之后的大项目），值得优先收尾。
