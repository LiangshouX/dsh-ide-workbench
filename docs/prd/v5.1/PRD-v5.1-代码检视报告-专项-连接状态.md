# PRD-v5.1 代码检视报告（专项：「语义分析：正在连接……」这条线）

> **范围**：本轮**不按提交区间逐条复核**，而是专查用户点名的那一条 —— 状态栏**极长时间**停在「语义分析：正在连接……」，**甚至彻底卡住**在这个状态。起点 `ed38e4e`（第三轮开始），复核到当前 HEAD **`55ce1bf`**。
> **基线**：`ed38e4e`。**对照物**：第一轮～第五轮检视报告、`PRD-v5.1.md`（规格，只读）、`PRD-v5.1-实施契约.md`、`PRD-v5.1-实施进展.md`。
> **方法**：读代码 + **实跑验证**。`npm test` 实跑 **1078 项 / 1078 通过 / 0 失败**（基线 `3b16214` 时实测）；HEAD `55ce1bf` 又加了 4 条用例 ⇒ 1082。⚠️ 另有一个**并行的检视会话正在同时改动** `src/client/store.js`、`src/client/i18n.js`、`src/host/lsp.js` 与文档（在它改到一半时复跑是 1087 项 / **2 条失败**，两条都在 `tests/lsp-status-freshness.test.mjs`：它给降级原因加了新的一类 `lsp.crashedBudget`，而旧用例还期待 `lsp.crashedGeneric` —— **与本轮无关**，本轮只加了一个 `.md` 与 README 的两行）。本轮自建**五个场景**的探针（`%LOCALAPPDATA%\Temp%\iwb-probe-connecting.mjs`，**不在仓库内**），**只读导入生产源码** `src/client/lsp-session.js` 与 `src/client/Workbench.jsx`（后者用 esbuild 打包 —— Node 不能直接 import `.jsx`）。
> **本次检视未修改任何源码**，本文件与 `docs/prd/README.md` 的一行索引是本轮唯一产物。
> **检视日期**：2026-11-02。
> **与其它轮次的关系**：第五轮（`3b16214`）与第六轮（`55ce1bf`）查的是**内存那条线**（压力阀的口径与文案）；本报告查的是**连接状态那条线**，两条线不重叠 —— 事实上，**会话状态机（`src/client/lsp-session.js`）与传输层（`src/client/lsp-transport.js`）自 `4bbfd4c` 以来一个提交都没有**，而状态栏的翻译（`Workbench.jsx` 的 `lspStatusView` / `HOST_CONNECTING_STATES` / `showReconnectButton` / `showRebuildButton`）在这几轮里也**一行没动**（动的是诊断面板多出来的那行「压力余量」与设置写盘）。
> **重点关注**：① 第一轮挖出的「正在连接 126 秒」的**因**修好了没有；② 「极长」的**上限**变了没有；③ 「彻底卡住」还在不在；④ 这段等待里用户有没有出路。

---

## 0. 结论

### 0.1 一句话

**第一轮 B1 的「因」真修好了（握手不再被丢），但这条线的「症状上限」和「永久卡住」两件事**都**原封不动**：握手一次不应答，状态栏仍然是 **126 秒**的「语义分析：正在连接……」（探针 B 实测 t+126s 才判死），而**会话已经结束、根本没有任何东西在连接**的时候，状态栏**永远**写「正在连接……」，且这一格**一个按钮都没有**（探针 A 实测）。根因是客户端会话状态机**只有三个值**（`starting` / `ready` / `failed`），**没有「没有会话」这个状态** —— 于是「没有会话」被表示成了「正在连接」。**

**本轮新发现：2 条中危 + 1 条低危（文档）**，另附 1 条「查过但没问题」的排除项（§2.4）。

### 0.2 「正在连接」这条线的修复情况总表

| 轮次 | 现象 | 当时的修法 | **今天的状态** |
|---|---|---|---|
| **第一轮 B1** | 握手在**起服窗口**被丢 ⇒ 客户端反复重试 ⇒ 状态栏「正在连接」**126 秒** | 宿主**按住**客户端的载荷，直到**进程**真的存在（`relayToServer` 的守卫 `session.handle === null`） | ✅ **真修好**。仓库用例 `tests/lsp-handshake.test.mjs` 的 B1 用例在守；本轮探针 D（服务器 5 秒后应答）实测 **t+5s ⇒ ready** |
| **第一轮 B2** | 切换项目时新服务器与旧服务器同时存在（700–1100 MB） | 切换链 + `shutdownHostLspAwaited`（等旧服务器真死） | ✅ 仍有效（`tests/lsp-workspace-switch.test.mjs`） |
| **第一轮 B3** | 「正在连接」其实只是「握手未回」，与宿主是否健康混在一起 | 状态栏把**客户端会话**的失败与**宿主**的失败分成两支 | ✅ 结构仍在（`lspStatusView` 的 `sessionConnecting` / `sessionFailed` 两支） |
| —— | **「极长」的上限** | —— | ⚠️ **没变**：一次握手失败仍然是 **4 × 30 s + 3 × 2 s = 126 秒**（探针 B） |
| —— | **「彻底卡住」** | —— | ❌ **还在**：会话结束 + 宿主仍留着服务器 ⇒ 状态栏永远写「正在连接……」（探针 A） |
| —— | **这 126 秒里的出路** | —— | ❌ **一个都没有**（§2.2） |

### 0.3 本轮新发现

| 编号 | 严重度 | 缺陷 | 位置 | 归因 |
|---|---|---|---|---|
| **F1** | **中** | **「没有会话」被表示成「正在连接」** ⇒ 状态栏在一个**根本没有会话**的状态上说「正在连接……」，而且**没有任何按钮**（重建 / 重连都不给）；只要宿主那边还留着服务器，它就一直这么说（默认空闲超时 10 分钟；**正在建 program 的服务器根本不装空闲定时器** ⇒ 可能一直） | `src/client/lsp-session.js:1737`（`stopLsp()` 报 `'starting'`）、`:259-270`（状态机只有三个值）；`src/client/Workbench.jsx:637`（`sessionConnecting`）、`:379-383`、`:410-412` | **既有**（客户端会话状态机从第一轮起就没动过） |
| **F2** | **中** | **126 秒的放弃路径**：等待期间**没有进度、没有按钮**，而且**客户端的判定完全不看宿主的状态** —— 宿主明明在说「服务器正在起来 / 正在建索引」，客户端照样一次一次地按「握手失败」计预算，第 126 秒宣布「会话已死」（而宿主那边可能好得很） | `src/client/lsp-session.js:99`（`HANDSHAKE_TIMEOUT_MS`）、`:1458`（`MAX_HANDSHAKE_RETRIES`）、`:1508-1529`（`scheduleHandshakeRetry`） | **既有**（同上） |
| **F3** | 低 | 文档：`PRD-v5.1-实施进展.md` 的头部仍写「**检视**：三轮」并只列前三份报告，而文档里已经有 §7.6（第四轮）与 §7.7（第五轮）、仓库里已经有六份报告 | `docs/prd/v5.1/PRD-v5.1-实施进展.md:8` | **文档层** |

### 0.4 总体判断

**这条线的根因只有一个，而且它不是「超时太短」或「重试太少」，是「客户端会话状态机少了一个状态」。**

`reportClientState()` 只有三个取值：`starting` / `ready` / `failed`（`src/client/lsp-session.js:259-270`）。于是：

- 会话**正在建立** ⇒ `starting` ⇒ 状态栏「正在连接……」✓（对的）；
- 会话**结束**（项目转入基础模式 / store 被回收 / 功能被关掉）⇒ **也**是 `starting`（`stopLsp()`，`:1737`）⇒ 状态栏「正在连接……」✗（**没有人在连接**）；
- 会话**死了** ⇒ `failed` ⇒ 状态栏「会话已死」+ 重连按钮 ✓（对的）。

**「结束」与「正在建立」被同一个值表示，而状态栏按「正在建立」翻译它。** 这一条同时解释了 F1（说谎）与 F2 的一半（等待期没有出路）：状态栏**分不出**「还在连」和「已经没戏了」，所以它既不显示进度，也不给按钮。

F2 的另一半（**不看宿主的状态**）是另一个独立问题：宿主的状态（`starting` / `building` / `ready` / `idle` / `suspended`）**就在客户端手里**（store 的 `lsp` 段，每两秒轮询一次），客户端却**一次也没有**在握手失败时读过它 —— grep 全量确认：客户端只在两处读宿主的状态（请求预算 `requestBudgetOf` `:1052`、能力可用性 `capabilityAvailable` `:1096-1099`）。

---

## 1. 「正在连接」这条线的历史与现状

### 1.1 第一轮 B1 的「因」：真修好了

第一轮 B1 的机制（`src/host/lsp.js:2159-2172` 的注释写得很清楚）：帧通道的 worker **先于**进程创建，那个窗口里到达的载荷被交给 worker → worker 写进一个还不存在的 stdin → **载荷被静默丢掉**，握手里就包括它；worker 还已经把它标成「已转发」，于是宿主事后补发的 `initialize` 被当成**第二个**握手吸收掉，**服务器从来没听见握手**。客户端于是重试，重试也被吸收 —— 状态栏说了 **4 × 30 s + 3 × 2 s = 126 秒**的「正在连接」。

今天的实现（`src/host/lsp.js:2183-2184`）：

```js
// The process has to be there: the worker alone is not enough (B1).
if (session === null || session.worker === null || session.handle === null) {
  this.#holdFor(entry, text)
```

⇒ **没有进程就不转发**，载荷排队，进程出现时回放。

**实测**（探针 D，生产 `src/client/lsp-session.js` + 假 socket，服务器 5 秒后应答握手）：

```
=== D: the server answers the handshake after 5 s (the normal case) ===
  t+  1s : starting
  t+  5s : ready
```

仓库用例 `tests/lsp-handshake.test.mjs` 的两条 B1 用例（「a handshake that arrives while the process starts reaches the server」/「a payload that arrives while the process starts is not delivered twice」）也仍然在守这条线。

### 1.2 从 `4bbfd4c` 到现在，会话状态机与状态栏的翻译一行都没有改

```
git log --oneline 4bbfd4c..55ce1bf -- src/client/lsp-session.js src/client/lsp-transport.js
```
⇒ **空**（这两个文件自第二轮的修复之后**一个提交都没有**）。

```
git diff 4bbfd4c..55ce1bf --stat -- src/client/
```
⇒ `Workbench.jsx` +45 / −7、`store.js` +84 / −7、`i18n.js` +7 —— 逐处核对后确认：**动的是诊断面板多出来的那一行「压力余量」、设置写盘的回滚、两条文案**；**状态栏的翻译没有动**：

```
git diff 4bbfd4c..55ce1bf -- src/client/Workbench.jsx | grep -E '^@@|lspStatusView|HOST_CONNECTING_STATES|sessionConnecting|showReconnectButton|showRebuildButton'
⇒ @@ -441,+462,+489,+1318 四处，全在 memoryFacts 与 LspDiagnosticsModal 里；四个状态栏相关的符号一个都没出现
```

⇒ **第一轮 B1/B2/B3 之后，这条线就没人再看过了。** 这不是谁的疏忽：第三～六轮查的是**内存那条线**（账目 / 确认口径 / 压力阀），而「正在连接」的状态在用户眼里和内存无关。

### 1.3 「极长」的上限：126 秒，实测

**探针 B**（生产客户端会话模块 + 假 socket：握手一次也没有被应答）：

```
=== B: the host never answers the handshake ===
  t+  1s : starting
  [lsp] the handshake failed: Request timed out          （t+30s）
  [lsp] the handshake failed: Request timed out          （t+60s）
  [lsp] the handshake failed: Request timed out          （t+90s）
  [lsp] the handshake keeps failing; the session is dead - reconnect it from the status bar
  t+126s : failed
  the client gave up after                : 126 s
```

126 秒 = 4 次 × 30 秒（`HANDSHAKE_TIMEOUT_MS = 30000`，`src/client/lsp-session.js:99`）+ 3 次 × 2 秒（重试间隔，`:1523-1527`）。这条上限**与第一轮完全一样**（第一轮 B1 的注释里也是这个 126）。

**这 126 秒里，用户看到的是：**

- 标签：`语义分析：正在连接…`（`lsp.status.sessionConnecting`）；
- tooltip：宿主记的「已等待」时间（`lsp.startedAt`，**宿主**的会话起点，不是客户端的等待起点）；
- 按钮：**没有**（§2.2）；
- 倒计时：**没有**。

### 1.4 「彻底卡住」：复现了，而且它比 126 秒更糟

**探针 A**（生产客户端会话模块 + 假 store + 假宿主：宿主**停服失败**，于是它继续留着服务器）：

```
=== A: the session is over, but the host still has the language server ===
  the session state after the handshake : ready
  a client exists                        : true
  [lsp] the language server could not be stopped: the host is gone
  the host was asked to stop the server  : ["C:\\work\\connecting"]
  the session state now                  : starting          ← 会话已经没了，状态却是 starting
  a client exists now                    : false            ← 客户端对象为 null
  the host says                          : ready            ← 宿主还留着服务器
  the label of the status bar            : sessionConnecting | 语义分析：正在连接…
  a reconnect button is offered          : false
  a rebuild button is offered            : false
  the label after 4 more seconds         : sessionConnecting | 语义分析：正在连接…
  the client state after 4 more seconds  : starting
```

**这段等待会持续多久？** 宿主要等到它的服务器被释放：

| 宿主的策略 | 持续时间 | 位置 |
|---|---|---|
| 默认（`idlePolicy: 'after'`，`idleTimeoutMs: 600000`） | **最多 10 分钟** | `src/host/settings-defaults.js:108,126` |
| `idlePolicy: 'never'` | **一直** | 同上 |
| 服务器**正在建 program** | **空闲定时器根本不装** ⇒ 建完 program 之前一直 | `src/host/lsp.js:4368`（`if (isBuildingProgram(session)) return`） |
| 宿主自己也出问题了（进程不在了） | 宿主说 `idle` ⇒ 状态栏换成宿主自己的话 ⇒ 结束 | —— |

---

## 2. 本轮新发现

### F1【中】「没有会话」被表示成「正在连接」—— 状态栏说谎，而且没有出路

**触发条件**：客户端会话结束（① 用户把项目放进**基础模式**；② store 被回收（工作区超过三个）；③ 语义分析被关掉），**同时**宿主那边还留着语言服务器（`lsp.shutdown` 失败 / 宿主仍在 `building` / 空闲策略是 `never`）。

**机制**（`src/client/lsp-session.js`）：

```js
// :259-270  —— 状态机只有三个值
 * @param {'starting' | 'ready' | 'failed'} state the state of the session
function reportClientState(state, detail = '') { ... }

// :1737  —— 会话结束时
  // The session is over: there is no link any more, so the status bar must
  // not keep saying that the session is ready. The next session reports
  // "starting" again when it is built.
  reportClientState('starting')
```

`stopLsp()` 面对的是**「没有会话了」**，它能表达的最接近的值是 `starting` —— 而 `starting` 在状态栏里就是「正在连接」（`src/client/Workbench.jsx:637-662`）：

```js
if (clientState === 'starting' && HOST_CONNECTING_STATES.includes(current)) {
  return { ...base, key: 'sessionConnecting', text: t('lsp.status.sessionConnecting'), ... }
}
```

**后果**（探针 A 全部实测）：

1. **状态栏在撒谎**：客户端对象已经是 `null`，没有任何东西在连接，标签却写「语义分析：正在连接……」；
2. **没有出路**：
   - `showRebuildButton`（`src/client/Workbench.jsx:379-383`）只认 `degraded / failed / cancelled / idle / suspended` ⇒ **`sessionConnecting` 不在其中**；
   - `showReconnectButton`（`:410-412`）只认 `sessionFailed` / `failed` ⇒ **也不在其中**；
   - `lspStatusView` 给这一格返回的 `action` 是 `null` ⇒ **点状态项也没反应**；
3. **持续到宿主释放服务器为止**（最长 10 分钟；见 §1.4 的表）。

**最小修复方向**（任选其一，从小到大）：

- **最小**：给客户端会话加第四个状态 `'idle'`（＝「没有会话」），`stopLsp()` 报它；`lspStatusView` 在 `clientState === 'idle'` 时**让宿主自己的话赢**（像 `idle` / `degraded` / `suspended` 那样），并且**给出「重新建立索引」按钮** —— 宿主还留着服务器时，那个按钮正是出路（它会 `lsp.shutdown` + `lsp.start`）。
- **次小**：`stopLsp()` 报 `'failed'`。**不推荐**：那会让状态栏在「用户主动关了它」的时候说「会话已死」，并弹一个红色 toast —— 而这是用户**自己**的决定（PRD-v5.1 §2.3 的基础模式），不是故障。
- **顺带**：`releaseLspForStore()`（`:2014`）与 `refreshLsp()` 的 `!wanted` 分支（`:1889-1890`）都走 `stopLsp()`，所以这一改**一处覆盖三条路径**。

**验证方式**：探针 A（把 `stopLsp()` 之后的状态喂进 `lspStatusView`，断言标签不再是 `sessionConnecting`，且 `showRebuildButton` 为真）。

### F2【中】126 秒的放弃路径：没有进度、没有按钮，而且**完全不看宿主的状态**

**触发条件**：握手一次也没有被应答（宿主不可达 / socket 被中间设备挡住 / 服务器真的不应答）。

**机制**（`src/client/lsp-session.js`）：

```js
// :99    握手的预算
const HANDSHAKE_TIMEOUT_MS = 30000
// :1458  重试的次数
const MAX_HANDSHAKE_RETRIES = 3
// :1508-1529  重试的判据：只有自己的计数器
function scheduleHandshakeRetry() {
  if (handshakeTimer !== null) return
  if (handshakeRetries >= MAX_HANDSHAKE_RETRIES) { ...; reportClientState('failed', lastHandshakeError); return }
  handshakeRetries += 1
  handshakeTimer = setTimeout(() => { handshakeTimer = null; if (currentClient === null) return; reinitializeLsp() }, 2000)
}
```

**后果**：

1. **126 秒里没有进度、没有按钮**（F1 的第 2 条同样适用于这里：这一格是 `sessionConnecting`，两个按钮都不给）。连「还要等多久」都没有 —— tooltip 里的时间来自**宿主**的 `startedAt`，不是客户端的等待起点。
2. **客户端的判定不看宿主的状态**。全量 grep 确认：客户端读宿主状态的地方只有两处 —— 请求预算（`:1052`）与能力可用性（`:1096-1099`）—— **`scheduleHandshakeRetry()` 一次也没有读过 `store.state.lsp.state`**。于是：
   - 宿主说 `starting`（服务器正在起来）⇒ 客户端照样计一次重试；
   - 宿主说 `building`（正在建索引）⇒ 同上；
   - 宿主说 `ready`（服务器好了）⇒ **同上** —— 服务器明明活着，客户端却在第 126 秒宣布「会话已死」。
3. **探针 E 实测**（宿主每轮都说 `building`，握手一直不应答）：

```
=== E: the host says "building" (the server is up and building the index) ===
  t+  0s : the host says "building", the client says "starting" -> the label: 语义分析：正在连接…
  t+  8s : the host says "building", the client says "starting" -> the label: 语义分析：正在连接…
  t+ 16s : the host says "building", the client says "starting" -> the label: 语义分析：正在连接…
  t+ 24s : the host says "building", the client says "starting" -> the label: 语义分析：正在连接…
  [lsp] the handshake failed: Request timed out
  t+ 32s : the host says "building", the client says "starting" -> the label: 语义分析：正在连接…
```

⇒ **30 秒里，客户端一次也没有抬头看过宿主的状态。**

**最小修复方向**：

1. **让重试看宿主的状态**（`scheduleHandshakeRetry()` 里读 `sessionStore?.state?.lsp?.state`）：
   - 宿主说 `starting` / `building` / `restarting`（**进程还活着**）⇒ **不消耗重试预算**（把 `handshakeRetries` 复位，或把这一次的握手预算换成会话的长预算 `BUILD_REQUEST_TIMEOUT_MS`）；
   - 宿主说 `idle` / `suspended`（**根本没有服务器**）⇒ **立刻失败**（现在是白等 126 秒），并把失败的理由说清楚；
2. **这一格给出「重新连接」按钮**（`showReconnectButton` 把 `sessionConnecting` 也放进去）—— 重连不贵：它就是 `disconnect()` + `connect()`，而宿主那个「按住载荷」的机制**本来就会**在服务器存在时把握手补上；
3. **标签带上客户端自己的等待时间**（客户端知道它等了多久；宿主只知道它自己的会话多久了）。

### F3【低】文档：实施进展的头部仍写「三轮」

**位置**：`docs/prd/v5.1/PRD-v5.1-实施进展.md:8`

```
> **检视**：三轮（`PRD-v5.1-代码检视报告-第一轮.md` / `-第二轮.md` / `-第三轮.md`）；每一条发现都由 Lead 复核属实后才修，修法与取舍记在 §7.3 / §7.4 / §7.5。
```

而同一份文档里已经有 **§7.6（第四轮）** 与 **§7.7（第五轮）**，仓库里已经有六份检视报告。头部是全文第一眼看到的「本轮检视到哪了」，它是**唯一**一处没跟上的地方。

**最小修复方向**：头部改成「检视：N 轮（…‑第N轮.md）」并把 §7.3…§7.7 一并列出；或者干脆写成「检视：见 `docs/prd/README.md` 的索引（每轮一份报告 + 一节 §7.x）」—— 后者不会再漏。

### 2.4 排除项：慢启动的服务器**不是**问题（查过了，别再查一遍）

第一轮 B1 的 126 秒很容易被归咎成「握手预算 30 秒太短，而服务器起得慢」。**探针 C 实测不是这样**：真实宿主把**第一个**握手转发给服务器、**后面**的握手**用缓存立刻回答**（`src/host/lsp-worker.js` 的 `Handshake`），所以慢启动的服务器在客户端第一次超时后就被救回来了：

```
=== C: the server is slow to start (the host answers the FIRST handshake after 35 s) ===
  t+  1s : starting
  [lsp] the handshake failed: Request timed out
  t+ 32s : ready
```

⇒ **服务器 35 秒才起来，客户端 32 秒就 ready 了**（重试的那一次握手被缓存秒答）。**握手预算 30 秒与宿主「按住载荷等服务器起来」的策略并不冲突**，F2 的修法也不需要动这个预算。

（这条也是我一开始**写错了**的地方：第一版探针把假 socket 写成「每个请求都延迟 35 秒」，于是得出了「慢启动会被判死」的假结论；按真实宿主的语义重写之后结论相反。记在这里，免得下一轮再踩一次。）

---

## 3. 文档层面的不同步

| 编号 | 问题 | 位置 |
|---|---|---|
| **D1** | 实施进展的头部仍写「**检视**：三轮」并只列前三份报告，而文档里已有 §7.6 / §7.7、仓库里已有六份报告 | `docs/prd/v5.1/PRD-v5.1-实施进展.md:8` |

> 除此之外，第四～六轮在 `docs/prd/README.md` 的索引与结论行、以及 `PRD-v5.1-实施进展.md` 的 §7.6 / §7.7 上都跟得很紧（逐条列了修法与取舍），本轮只发现上面这一处。

---

## 4. 这一轮值得保留的地方

1. **B1 的修法是对的**：把「进程存在」当守卫（而不是「worker 存在」）—— worker 与进程之间那个窗口是这一整类缺陷的根源，而守卫放在正确的位置上一劳永逸。
2. **握手的重试机制整体是对的**：`disconnect()` + `connect()` 让库重置那个「一旦失败就永远失败」的 promise，重试才有可能；宿主那边的**握手缓存**（第二个握手用第一个的答案回答）让重试几乎免费 —— 这两件事配合起来，**慢启动不会误判**（§2.4）。
3. **`scheduleHandshakeRetry()` 的计数是对的**：每次失败都记一次、3 次后判死、且 `handshakeRetries` 在成功时复位 —— 缺的不是这个计数，而是**它没有去看宿主的状态**（F2）。
4. **状态栏把「客户端会话」与「宿主进程」分成两支是对的**（第一轮 B3 的修法）：宿主的 `idle` / `degraded` / `suspended` 各自有更准的话，不该被客户端的「没连上」盖住。**缺的只是第三支：「没有会话」**（F1）。
5. **本轮的探针写法值得保持**：假 socket 显式复刻真实宿主的两条语义（第一个握手转发、后面的用缓存回答），否则结论会反过来（§2.4）。

---

## 5. 复现方法与探针说明

本轮的探针**写在仓库外的临时目录**（`%LOCALAPPDATA%\Temp\`），**没有进仓库**，全部**只读导入生产源码**：`src/client/lsp-session.js`（生产模块，原样导入）、`src/client/Workbench.jsx`（用 esbuild 现场打包，因为 Node 不能直接 import `.jsx`）、`src/client/i18n.js`（文案表）。

| 场景 | 验证的命题 | 输出要点 |
|---|---|---|
| **A** | 会话结束 + 宿主仍留着服务器 ⇒ 状态栏说什么、有没有按钮 | 客户端对象 `null`、状态 `starting`、标签「语义分析：正在连接…」、**两个按钮都是 false**、4 秒后不变 |
| **B** | 握手一次不应答 ⇒ 「正在连接」多久 | **t+126s ⇒ failed**（4 × 30 s + 3 × 2 s） |
| **C** | 服务器慢启动（第一个握手 35 秒后才答，后面的用缓存秒答）⇒ 会不会误判死 | **t+32s ⇒ ready** ⇒ **不会误判**（§2.4） |
| **D** | 正常起服（5 秒） | **t+5s ⇒ ready** ⇒ 第一轮 B1 的「因」确实修好了 |
| **E** | 宿主一直说 `building`，握手一直不应答 ⇒ 客户端会不会抬头看宿主 | 30 秒里**一次也没看**，标签一直是「正在连接…」 |

> **探针注意**：`src/client/lsp-session.js` 是**模块级单例**（`currentClient` / `sessionKey` / `handshakeRetries` 都是模块变量），所以每个场景必须在**同一个进程里串行**跑、并在场景之间 `configureLsp(null)` + `shutdownLsp()` + 还原 `globalThis.WebSocket` 与 `globalThis.fetch`。宿主用 `globalThis.fetch` 冒充（`call()` 走它），socket 用 `globalThis.WebSocket` 冒充。

```sh
# 仓库与提交
git -C dsh-ide-workbench log --oneline -3
git -C dsh-ide-workbench status --short
git -C dsh-ide-workbench diff ed38e4e..HEAD --stat -- src/client/   # ⇒ 空：客户端一行没动过

# 测试
npm --prefix dsh-ide-workbench test        # 1078 / 1078

# 本轮探针（脚本在 %TEMP%，不在仓库）
node "$env:TEMP\iwb-probe-connecting.mjs" A
node "$env:TEMP\iwb-probe-connecting.mjs" B      # 要跑 2 分多钟
node "$env:TEMP\iwb-probe-connecting.mjs" C
node "$env:TEMP\iwb-probe-connecting.mjs" D
node "$env:TEMP\iwb-probe-connecting.mjs" E
```

---

## 6. 一句话总结

**第一轮 B1 的「因」（握手被丢）真修好了，但这条线的「上限」和「卡死」两件事都没动过：握手一次不应答，状态栏仍然是 126 秒的「正在连接……」，而会话已经结束、根本没有东西在连接的时候，它**永远**写「正在连接……」** —— 根因不是超时也不是重试，而是客户端会话状态机**少了「没有会话」这个状态**，于是「结束」被表示成了「正在建立」；修法有三处小改动：给状态机加一个 `idle`、`scheduleHandshakeRetry()` 里**抬头看一眼前端宿主的状态**、`sessionConnecting` 这一格**给出按钮**。**
