# PRD-v5 代码检视报告（第三轮）修复记录

> **对应报告**：`docs/PRD-v5-代码检视报告-第三轮.md`（基线 `bf4927e` → `59ef905`）。
> **本文件**记录对报告 T1–T7 的**逐条复核**、**落地方式**与**实测数据**。
> 报告本身未改动。

---

## 0. 总览

第三轮的报告先复核了上一轮：**S1–S9 全部修复**，并且用**变异测试**证明了那条致命
崩溃的回归用例在修复前是红的（把 `stdin` 的 `'error'` 监听器摘掉 → 生产代码立刻
`uncaught = 1 (EPIPE)`）。报告也复核了开发方**推翻它自己两条建议**的两处处理，结论是
「他们是对的」。

本轮的新发现 7 条，全部处理：

| 编号 | 严重度 | 一句话 | 处理 |
|---|---|---|---|
| **T1** | **中** | 崩溃重启后**宿主回到 10 分钟预算、客户端仍是 30/45 秒** —— 用户能看见的那一侧恰好是错的那一侧 | 已修（宿主发布进程代号，客户端据此复位） |
| **T2** | 低 | `session.timeouts` 跨重启不清零 | 已修 |
| **T3** | 低 | 宿主把**任何**非握手请求的回答都算作「真实回答」，客户端只算 8 个语义方法 | 已修（两侧共用**一份**定义） |
| **T4** | 低 | 错误边界把**所有** session 都降级，与故障来源无关 | 已修（按来源分流） |
| **T5** | 低 | 接管式边界没有把 Node 的第二个参数 `origin` 传给宿主 | 已修 |
| **T6** | 低 | 接管式边界依赖「宿主先装 handler」的顺序假设 | 已修（假设被写明、被检查、迟到的 handler 被接管） |
| **T7** | 说明 | 10 分钟预算的代价：**第一次补全可能挂 10 分钟** | 已修（**不缩短等待，而是让等待可见**） |

---

## 1. T1：崩溃重启后两侧的预算不一致（本轮唯一的中危）

### 1.1 复核：成立，而且方向很糟

| | 复位点 | 崩溃重启后 |
|---|---|---|
| **宿主** `session.realAnswers` | `#spawn`（**每个新进程**都复位） | 回到 10 分钟 ✅ |
| **客户端** `semanticAnswers` | `resetLspHealth()`（只在 socket 重开 / 客户端重建 / 切项目时复位） | **仍是 30/45 秒** ❌ |

**为什么 socket 不会重开**：`lsp-ws.js` 的中继 WebSocket 是**浏览器 ↔ 宿主**之间的通道，
宿主进程没死，只是背后的语言服务器进程被换了一个。服务器崩溃**不会**关这个 socket，
所以客户端的 `resetLspHealth()` 根本不会被调用。

**后果**正是这一轮要消灭的那个噪声：大项目上服务器崩溃并自动重启 → 新进程要**从头重建
program**（那正是需要几分钟的那次请求）→ **客户端 30 秒就放弃** → 弹「Request timed out」
→ 状态栏显示「不稳定」；而**宿主仍在耐心等 10 分钟**，不会杀服务器。用户既没等到结果，
也没看到任何进展说明。

### 1.2 修法：让客户端看见「服务器被换过」

宿主在状态快照里发布一个**进程代号** `processId`（每个新进程 +1），客户端在既有的
2 秒轮询里发现代号变了，就复位自己的预算——**复用 `reinitializeLsp()` 里已有的那条
路径**（那里本来就写着「新的语言服务器要重建 program，所以它的第一次语义请求也需要
长预算」）。

为什么选这条而不是「宿主推一条通知」：宿主确实有 `notify` 机制，但**客户端根本没有
接收控制事件的通道**——中继把控制事件当普通 JSON 发到 socket 上，客户端把它交给库，
库不认就丢弃。要接通知就得在客户端解析 socket 上的每一个负载，那与本仓库「主线程不
解析 LSP 载荷」的约定冲突。轮询是既有的、已经在跑的通道。

> **代价（诚实地说）**：轮询是 2 秒，所以复位最多晚 2 秒。这 2 秒里发出的请求仍然会
> 用短预算。但崩溃本身的状态（`crashed`）也在同一个轮询里，状态栏会先变成「已崩溃」，
> 用户在那个窗口里点定义的可能性很低；而且服务器重启本身要 2 秒退避（`restartBackoffMs`），
> **复位几乎总是发生在新进程就绪之前**。

---

## 2. T2：超时计数跨重启继承

`#spawn` 复位了 `realAnswers` 和 `pendingRequests`，**没有复位 `timeouts`**。崩溃前累计
了 2 次超时的话，重启后**第一次**超时就达到 `timeoutLimit = 3` → 服务器被更早地杀掉。

已修：三个计数器一起清零，并写明「这个计数器属于那个死掉的进程」。

---

## 3. T3：两侧对「一次回答」的认定不同

- **宿主**：`pending.handshake !== true` → 算一次真实回答（**除了 `initialize`，什么都算**）。
- **客户端**：只有 8 个 `SEMANTIC_METHODS` 算。

今天不可达（插件不发别的请求），但这是**靠「我们不发」维持着**的不变量：哪天有人接入
了格式化或重命名，宿主侧就会提前收紧预算，而客户端还在等 —— 又是「Request timed out」
+ 服务器被杀。

**修法**：两侧共用**一份**定义。新增 `src/host/semantic-methods.js`（无任何 import 的
共享模块，和 `settings-defaults.js` 一个路子），里面是那 8 个方法：

- **frame worker** 上报请求时**连方法名一起报**（worker 是唯一有资格解析载荷的线程）；
- **宿主**把「是不是语义方法」记在待决请求上，只有**语义**的回答才计入 `realAnswers`；
- **客户端**删掉本地那份拷贝，改成 import 共享模块。

于是「一次回答」在两侧是**同一个定义**，不可能再漂移。

---

## 4. T4 / T5 / T6：错误边界的三处

### 4.1 T4：边界把所有 session 都降级

`isPluginFault` 判定的是「**这个插件的**任何错误」——所以一个与语言服务器**毫无关系**的
插件 bug（终端、文件操作）也会把所有语言服务器降级成 `degraded`，状态栏变成「语义分析：
不可用」，而真实原因只在日志里。

修法：新增 `isLspFault(error)`（栈里出现 `src/host/lsp` 才算语言服务器的故障），
**只有它**才允许降级会话；其余的只记日志。

### 4.2 T5：`origin` 丢了

Node 的处理器签名是 `(error, origin)`，`origin` 是 `'uncaughtException'` 或
`'unhandledRejection'`。接管式边界只把 error 交还给了宿主，`origin` 变成 `undefined`。
如果宿主的 fail-loud 处理器按 `origin` 分流，它的行为就会变。

修法：接管时把事件名一起交还（`'uncaughtException'` / `'unhandledRejection'`——与 Node
的取值一致）。

### 4.3 T6：「宿主先装 handler」的顺序假设

接管式边界捕获的是**接管那一刻**已存在的监听器。如果宿主在插件加载**之后**才装自己的
fail-loud 处理器，emit 时会有两个监听器：边界 + 宿主的。宿主的处理器**照样会被调用**
（Node 复制数组）→ 对插件错误，宿主仍然 `process.exit(1)`。

修法（三层，都很便宜）：

1. **假设被写明**：代码注释里明确写出「宿主在启动时装它的处理器，插件在之后接管」。
2. **假设被检查**：接管时若**没有**可继承的处理器，就写一条警告——而不是假装自己在掌控。
3. **迟到的处理器被接管**：每次 emit 时检查有没有**新出现**的处理器；有就把它收进
   `inherited` 并从 `process` 里摘掉，从此由边界调用它。

> 有一条**救不回来**的边界情况要写清楚：**迟到之后的第一次** fault 仍然会致命——它已经
> 在 Node 复制的那份数组里了。这一条在注释里也写了。
> 实际上不会发生：宿主在启动时安装处理器，插件在之后才加载。

---

## 5. T7：第一次补全可能挂 10 分钟

`textDocument/completion` 在语义方法之列，所以会话建立后的**第一次自动补全**会拿到
10 分钟的预算。而会话状态在服务器回答 `initialize` 之后 10 ms 就变成了 `ready`
——**状态栏说「就绪」，编辑器却挂着**，用户完全不知道它在等什么。

**修法：不缩短等待，而是让等待可见。**

判据不变（排除补全会把「Request timed out」的噪声请回来，那正是用户一直在报的）。
改为：**宿主说清楚「program 还在建」**——状态快照里多一个 `buildingProgram`：

> `buildingProgram` 为真 ⟺ 服务器**还没回答过任何语义请求**（program 还没建成）
> **且**有一个**语义请求正在等待**。

第二个条件很关键：没有它，一个从不问语义问题的工程会让状态栏永远说「正在构建索引」。
有了它，这句话只在**真的在等**的时候出现。

客户端据此把状态栏从「就绪」换成「正在构建索引…（首次语义请求可能需要数分钟）」。

---

## 6. 验收数据

| 项 | 结果 |
|---|---|
| 自动化测试 | **716 项 / 716 通过 / 0 失败**（基线 698 + 本轮新增 18），**连续 6 轮全绿** |
| 客户端构建 | `npm run build` 成功，`dist/client.js` **2,871,618 字节（2,802.3 KiB）** |
| 客户端体积增量 | **+2,660 字节（+2.6 KB）**（预算 ≤ 150 KB ✅） |
| i18n | `en` 与 `zh-CN` 各 **574 个 key**，无缺失、无空值 |
| 新增源码 | `src/host/semantic-methods.js`（两侧共用的语义方法清单） |
| 新增测试 | 5 个文件、18 个用例 |

### 6.1 本轮新增的回归用例

| 用例 | 守住的性质 |
|---|---|
| `the budget is reset when the host reports a new language server process` | **T1**：宿主换了进程 → 客户端复位预算 |
| `the first process the client sees is not a restart` | **T1**：第一个进程代号是基线，不是重启 |
| `a server that was replaced before the first poll resets the budget` | **T1**：客户端已经答过话、却还没见过进程代号时，那个代号属于**新**进程 |
| `the status bar says that the index is built while the program is built` | **T7**：等待可见；「不稳定」优先于「构建中」 |
| `the store mirrors the identity of the server process and the build of the program` | **T1/T7**：状态字段进了 store |
| `the answer to a request that is not semantic does not shorten the budget` | **T3**：非语义的回答不收紧预算 |
| `the status says that the program is being built while a semantic request is outstanding` | **T7**：`buildingProgram` 的两个条件 |
| `a request that is not semantic does not build the program` / `a notification does not build the program` | **T7**：只有语义请求才建 program |
| `the timeout counter of a crashed server does not survive the restart` | **T2**：超时计数不跨重启继承 |
| `the process identity changes when the language server is restarted` 等 3 条 | **T1**：进程代号的语义 |
| `the host and the client are patient in the same way` | **T1/T3**：**跨层**——两侧对同一串请求给出同一个预算 |
| `an answer that is not semantic changes neither side` | **T3**：跨层的非语义回答 |
| `only a fault of the language servers may take the semantic features away` | **T4**：按来源分流 |
| `the host handler receives the origin of the failure` | **T5**：`origin` 交还给宿主 |
| `a handler installed after the takeover is taken over` | **T6**：迟到的处理器被接管 |

### 6.2 跨层用例为什么值得单独写一个文件

「两侧一致」这件事**没有任何一个单侧的用例能证明**：宿主的测试只看宿主，客户端的测试只看
客户端。报告建议的那个跨层用例就是补这个洞的。

它把**同一串请求**同时喂给两侧（一个请求、一个回答），然后用**用户能感知的方式**读
两边的状态：

- 宿主：那个没被回答的请求**有没有被记成超时**（没记 = 还在耐心等）；
- 客户端：**下一个请求**会拿到多少预算。

并用**变异测试**验证了这个用例真的抓得住分歧：把宿主的 `pending.semantic === true` 改成
「任何回答都算」，跨层用例立刻变红（`an answer that is not semantic changes neither side`
失败），改回来又绿。

---

## 7. 与报告的出入

| 报告的说法 | 复核的结论 |
|---|---|
| T1 修法 1：「宿主补一条 `{type:'restarted'}` 通知，客户端接到就复位」 | 客户端**没有**接收控制事件的通道——中继把控制事件当普通 JSON 发到 socket 上，客户端交给库，库不认就丢弃。要接通知就得在客户端解析每一个 socket 负载，与本仓库「主线程不解析 LSP 载荷」的约定冲突。改用报告的**修法 2**（状态里暴露一个代号，轮询里发现代号变了就复位）——它用的是既有的、已经在跑的通道。 |
| T3 修法：「让宿主也只把「客户端认为算数的那些方法」算作真实回答——worker 本来就在解析方法名，让它一并上报方法名即可」 | **完全一致**，按此实现（并把方法名所在的集合抽成共享模块，两侧共用一份）。 |
| T6 修法：「二选一——运行时检查 / 写进注释并加断言」 | **两个都做了**：注释写明 + 接管时检查并告警 + 迟到的处理器被接管 + 回归用例。 |
| T7 建议：「不用等到实机反馈才决定」 | 采纳报告的**第二个**建议（状态栏说明）。排除补全会把用户正在抱怨的噪声请回来；让等待可见既诚实又不动判据。 |
