# PRD-v5 代码检视报告（第五轮：`7b1df38` + `4b8af00` 复核）

> **范围**：`fdad597` → `4b8af00`（2 个提交：`7b1df38` 复核轮「让作用域收敛并处理上一轮的发现」/ `4b8af00`「别让状态栏在会话已死时说就绪」）。
> **基线**：`fdad597`。**对照物**：`docs/prd/v5/PRD-v5-改造需求.md`（25 条目规格）、`docs/prd/v5/PRD-v5-改造需求-实施进展.md`（§3.1–§3.7）、`docs/prd/v5/PRD-v5-代码检视报告-第四轮.md`（上一轮 T1–T7 + U1–U3）。
> **方法**：读代码 + **实跑验证**。`npm test` 实跑 **864 项 / 864 通过 / 0 失败**（上一轮 717，基线 `fdad597` 为 717）；两个自建探针（写在 `%LOCALAPPDATA%\Temp\`，**不在仓库内**）分别复现 P1-1 与 P1-2；本轮全部行号在 `4b8af00`（工作树干净）上逐条复核过。
> **本次检视未修改任何源码**，本文件是本轮唯一产物。
> **检视日期**：2026-11-01。
> **重点关注**：① 开发方在总结里点名的三处（短握手预算 / 最新握手胜出 / clientState 优先级）；② 上一轮 7 条发现的处置；③ 新引入的会话状态机制有没有把「谎报」换成了「误报」。

---

## 0. 结论

### 0.1 一句话

**上一轮 5 条成立的发现全部修复，修法也都对；但开发方点名复查的三处里，「最新握手胜出」只在服务器不在时成立——作用域会在下次重启时静默退回旧值**，而这个不成立的断言已经写进了实施记录 §3.4 与 M8 / SCOPE-01 两行，**需要一并更正**。

本轮新发现 **5 条**：**2 条中危（P1）**、**1 条低危（P2）**、**2 条说明项（P3）**。无高危。

### 0.2 开发方点名的三处：2/3 成立，1/3 只成立一半

| # | 点名复查的位置 | 结论 | 关键证据 |
|---|---|---|---|
| 1 | `src/client/lsp-session.js` 的短握手预算与 `client.timeout` 的写入时机 | ✅ **成立** | 库 `node_modules/@codemirror/lsp-client/src/client.ts:410` 在**创建请求时**捕获 `this.timeout`；语义请求经 `client.ts:396` 的 `this.initializing.then(...)` 才创建 ⇒ 30 s 窗口内只可能有 `initialize` 一个请求。`watchHandshake` 的成功回调早于排队的语义请求（Promise 回调按注册顺序）⇒ 时序无洞 |
| 2 | `src/host/lsp.js` 的**最新握手胜出**（`#holdFor`） | ❌ **只在一半场景成立** | `#holdFor`（服务器**不在**）会更新 `entry.handshake`；服务器**在跑**时走 `relayToServer`（`lsp.js:1429`），**不碰** `entry.handshake`；worker 的 `{type:'handshake'}` 只在**首次转发**路径 post（`lsp-worker.js:465`）⇒ 作用域在下次重启时**静默退回旧值**。实测见 §1.1 |
| 3 | `src/client/store.js` 的 `clientState` 与宿主 `state` 的优先级 | ✅ **成立**，但**误报面**偏大 | `clientState==='failed'` 压过宿主一切状态（`Workbench.jsx:517`）实现正确；问题在于 `failed` 会在**宿主永远不会有服务器**的项目上确定性出现 ⇒ 约 2 分钟后红，且出口按钮会启动用户明确拒绝的服务器。实测见 §1.2 |

### 0.3 上一轮 7 条发现的处置

| 编号 | 上一轮结论 | 本轮复核 | 说明 |
|---|---|---|---|
| 1（PERF-03 不减包） | 成立 | ✅ 处置正确 | 验收口径改为「包仍内联但延迟求值」，测试改用生产构建配置（§3.1） |
| 2（PERF-03 测试用了产品不用的构建配置） | 成立 | ✅ 已修 | 从 `scripts/build.mjs` 抽取字面量，断言产物事实与运行时行为（§3.1） |
| 3（MEM-03 生产为空操作） | 成立，但**建议被实测否决** | ✅ 维持拒绝，理由充分 | standby 是内核优先回收的**可用内存**，按规格扣除会让闸门误拒（§3.2） |
| 4（SCOPE-01「rootUri 未收敛」） | 成立 | ⚠️ **只修好了一半** | 客户端半边对了，宿主半边有条件（§1.1） |
| 5（隐藏窗口误报「状态未知」） | 成立 | ✅ 已修 | `visibilitychange` 监听；跳过轮询不算失败轮询 |
| 6（唤醒失败一次后自动唤醒永久关闭） | 成立 | ✅ 已修 | `degradeCause` 分类 + 60 s 退避（`WAKE_BACKOFF_MS`） |
| 7（降级 toast 正文是英文原文） | 成立 | ✅ 已修 | 正文已本地化 |

### 0.4 本轮新发现

| 编号 | 严重度 | 一句话 | 位置 |
|---|---|---|---|
| **P1-1** | **中** | **作用域只在「服务器不在」时收敛**：服务器在跑时的新握手不更新宿主缓存 ⇒ 下次崩溃重启 / 空闲唤醒 /【重新建立索引】用**旧 `rootUri`** 初始化 | `src/host/lsp.js:1429`、`src/host/lsp-worker.js:415` `465` |
| **P1-2** | **中** | **「从不索引」的项目约 2 分钟后状态栏变红**；且【重新连接】会启动用户明确拒绝的服务器 | `src/client/lsp-session.js:1431`、`src/client/store.js:1317` |
| **P2-3** | 低 | **【重新建立索引】跳过整道内存闸门（含硬下限）**——客户端承诺「force 只限 tight 档」，宿主实现是「force 跳过全部」 | `src/host/lsp.js:2145` vs `src/client/store.js:1554-1557` |
| **P3-4** | 说明 | 宿主说 `building` 时客户端的「正在连接…」不可见（该分支只在宿主说 `ready` 时才进入） | `src/client/Workbench.jsx:528` |
| **P3-5** | 说明 | `semanticNote` 的英文兜底是**死代码**（`translate` 永不返回空串） | `src/client/CodeEditor.jsx:880` |

**统计：中 2 / 低 1 / 说明 2。**

### 0.5 总体判断

**这一轮的工程质量高于上一轮**，有三条理由：

1. **新增的会话状态机制方向是对的**。上一轮的核心缺陷是「两个互不校验的真相源」——状态栏读宿主的 `lsp.status`，菜单读客户端的 `serverCapabilities`。本轮引入客户端会话状态并让它**压过**宿主状态，是在正确的方向上收敛：死会话时状态栏必须说不可用。**问题不在机制，在触发面**（P1-2）。
2. **上一轮 5 条成立的发现全部修复，且没有为了过测试而削弱断言**（§3.1）。PERF-03 的测试改用生产配置这件事尤其值得肯定——上一轮那套「用产品根本不用��构建配置去断言」的测试，是比缺陷本身更危险的东西。
3. **降级分类 + 退避重试**（`DEGRADE_CAUSES` / `RETRYABLE_DEGRADE_CAUSES` / `WAKE_BACKOFF_MS = 60000`）把「唤醒只生效一次」这类模糊行为变成了可枚举的规则，代码可读性明显提升。

**剩下的两条中危都不是设计问题，是覆盖面问题**：

- P1-1 是**条件分支漏了一半**——`#holdFor` 补了，服务器在跑的路径没补；而那条声称「已验证」的回归测试恰好只测了补过的那一半。
- P1-2 是**新机制与旧决策没有对齐**——客户端新增了「会话」这个概念，但它不知道 store 已经决定「这个项目不索引」。

两条都可以用很小的改动修掉（§1.1 §1.2 各给了最小修复方向）。

---

## 1. 新发现（逐条）

### 1.1 P1-1（中）作用域只在「服务器不在」时收敛——下次重启会静默退回旧 `rootUri`

**一句话**：宿主把「最新的握手」记下来这件事，只在**没有语言服务器在跑**时成立；服务器在跑时，客户端发来的新握手被 worker 吸收应答、**从不写回宿主的握手缓存**，于是作用域改动在**下一次进程重启**时静默退回旧值。

#### 触发路径

```
用户改作用域策略（settings.lsp.indexScope）
  → 客户端算出新 scopeRoot，握手 key 变化（lsp-session.js:1440 sessionKeyOf）
  → startLsp → 新建 client → connectClient 用新 rootUri 发 initialize
  → 宿主 relayToServer（lsp.js:1416）
       ├─ 服务器【不在】 → #holdFor（lsp.js:1598-1604）→ entry.handshake = 新握手  ✅
       └─ 服务器【在跑】 → worker.postMessage({type:'send'})（lsp.js:1429）→ 不碰 entry.handshake  ❌
            → worker：answerFor 命中缓存 → 立刻 return（lsp-worker.js:415）
              ⇒ 永远到不了 :465 的 postMessage({type:'handshake'})
  → 此后任何一次进程重启（崩溃重启 / 空闲唤醒 /【重新建立索引】）
  → #spawn 重放 entry.handshake（lsp.js:2381-2383）＝【旧握手】
  → 新服务器用旧 rootUri 初始化 ⇒ 作用域静默退回
```

**为什么 worker 那条路走不通**（`src/host/lsp-worker.js`）：

| 行号 | 事实 |
|---|---|
| `:408-416` | `handshake.answerFor(text)` 命中缓存 ⇒ `postMessage({type:'message', text: answer})` ⇒ **提前 `return`（:415）** |
| `:441-461` | 即便缓存未命中，`noteForwarded(payload)` 对第二次握手返回 `false` ⇒ 同样 **`return`（:460）** |
| `:465` | `parentPort.postMessage({ type: 'handshake', text: payload })` —— **只有首次转发才到达** |
| `:2537-2544`（宿主侧） | 宿主只在收到 `{type:'handshake'}` 时才 `entry.handshake = message.text` |

⇒ **`entry.handshake` 全仓只有两个写入点**：`#holdFor`（`lsp.js:1600` / `:1603`）与 worker 的 `{type:'handshake'}`（`lsp.js:2542`）。两条路都只覆盖「首次」或「服务器不在」。

#### 实测（探针 `%LOCALAPPDATA%\Temp\probe_handshake.mjs`，用仓库自带 `tests/lsp-fixtures.mjs` 驱动真实 `LspManager`）

场景：旧作用域握手 → 服务器答了第一次 → 服务器在跑时用新作用域再握手 → 崩溃重启。

```
spawned processes: 2
新进程收到的 initialize: {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"rootUri":"file:///OLD-SCOPE","capabilities":{},"initializationOptions":{"maxTsServerMemory":2048}}}
contains NEW-SCOPE: false
contains OLD-SCOPE: true
宿主状态: building | scopeRoot: C:\Users\X-L-S\AppData\Local\Temp\iwb-probe-handshake
```

**新进程用的是 `OLD-SCOPE`。**

#### 为什么那条回归测试没抓到

`tests/lsp-review-fixes.test.mjs:140-160`「the newest handshake is the one a server that starts later is initialized with」：

```js
manager.relayToServer(root, initializeText())
manager.relayToServer(root, initializeText(2, 'file:///workspace/sub-project'))
await manager.start({ root })          // ← 两次握手都在服务器【不存在】时发
```

两次握手都发生在 `manager.start()` **之前**，走的正是 `#holdFor` ⇒ 它证明的是「服务器不在时最新握手胜出」，**没有覆盖服务器在跑的那条路**。这不是测试写得不好，是**测试和生产路径错位**。

#### 影响

| 场景 | 后果 |
|---|---|
| 用户改了 `indexScope`，服务器在跑 | 作用域改动**要等到下次进程重启**才生效，且**方向是退回旧的**——比「不生效」更糟，因为它与用户刚刚做的设置相反 |
| 用户点【重新连接】（`store.js:1632-1644`） | 该方法的注释写的是「宿主保留**最新**握手，下一个进程用它初始化」（`store.js:1621-1623`），但实际重放的是**旧**握手 ⇒ **重连会把作用域改回去** |
| 宿主 `scopeRoot` 与服务器真实 program 范围 | 不一致 ⇒ 围栏（`insideScope`）按新作用域判断，服务器却按旧作用域建 program ⇒ 跨作用域的引用解析静默失准 |

> 注：服务器**在跑**时保留旧 program 这件事，文档已经承认并接受（实施进展 §3.4 末段「运行中的服务器保留它原来的 program，直到它下一次启动」）。**本条说的是连这条也做不到**——下次启动用的还是旧的握手，所以连「下次启动生效」都保证不了。

#### 最小修复方向

**方案 A（推荐，宿主 1 行）**——在 `relayToServer` 把载荷交给 worker **之前**记下握手：

```js
// src/host/lsp.js:1429 附近
if (isInitializeRequest(text)) entry.handshake = text
session.worker.postMessage({ type: 'send', text, origin: 'client' })
```

放在宿主而不是 worker，是因为：① 宿主是唯一知道「这个 root 现在用哪个握手」的权威；② 免得依赖 worker 的缓存状态（缓存命中与否走的是两条不同的 early-return）；③ 与 `#holdFor` 的现有写法保持一致（`isInitializeRequest` 已经在那儿用着）。

**方案 B**——worker 在缓存应答路径（`lsp-worker.js:410` 附近）也 post 一条 `{type:'handshake', text}`。可行，但把「当前握手」的状态继续散在 worker 里，与宿主已有的一份重复。

**建议同时补一条回归测试**（当前那条只测了一半路径）：

```js
test('a handshake that arrives while the server runs is the one a restarted server is initialized with', async () => {
  const { manager, handle, spawned } = makeManager()
  const root = rootOf('n1-newest-running')
  manager.attachSink(root, makeSink())
  await manager.start({ root })
  await answerOnce(manager, root, workers)                 // 服务器答了第一次握手
  manager.relayToServer(root, initializeText(2, 'file:///workspace/sub-project'))
  handle().exit(134)                                       // 崩溃 → 宿主重启
  await sleep(400)
  const frames = decodeChunks(spawned[1].handle.stdinChunks)
  assert.match(frames[0], /workspace\/sub-project/, 'the newest handshake reached the new process')
})
```

#### 连带需要更正的两处文档表述

实施记录里的这两句话**与代码不符**，必须一起改，否则下一轮评审会照着它继续误判：

| 位置 | 现文 | 建议改为 |
|---|---|---|
| `PRD-v5-改造需求-实施进展.md:188`（§3.4） | 「宿主原来永远保留**第一次**握手……现在**最新的握手胜出**（`#holdFor`），新起的服务器进程用客户端**当下**在用的作用域初始化。回归测试：`tests/lsp-review-fixes.test.mjs` 的「the newest handshake is the one a server that starts later is initialized with」（已验证：去掉修复即变红）」 | 「最新的握手胜出」**目前只在服务器不在时成立**（`#holdFor`）。服务器在跑时新握手被 worker 吸收应答、不写回宿主缓存 ⇒ 下次重启仍用旧握手。回归测试只覆盖了前者 |
| 同文件 `:39`（M8 行）与 `:61`（SCOPE-01 行） | 「宿主改为**最新握手胜出**」／「作用域**真的**收敛了」 | 降级为「客户端侧已收敛；宿主侧的收敛**仅限服务器不在时**，其余见 §3.4」 |

**M8 / SCOPE-01 的状态应从 ✅ 改为 ⚠️（部分达成）**，直到方案 A 落地。

---

### 1.2 P1-2（中）——「从不索引」的项目约 2 分钟后状态栏变红；出口按钮还会启动用户拒绝的服务器

**一句话**：客户端新增的会话机制**只读全局开关**，不看 store 已经决定的「这个项目不索引」；于是客户端对着一个**宿主永远不会起服务器**的项目建立了会话，握手永远等不到应答，30 s 超时 × 4 轮后确定性变成 `failed`，状态栏变红并弹出【重新连接】——而这个按钮**会真的去启动一个用户明确拒绝的服务器**。

#### 触发路径

```
store 的索引决策：indexOnOpen === 'never'  →  'conservative'（store.js:1317）
   （'conservative' 还来自 lsp.enabled === false（:1316）、用户答「使用基础模式」、内存不足（:1355-1362）…）
        ↓
但客户端会话只问全局开关：
  lsp-session.js:1429  const enabled = sessionEnabled && lspSettings?.enabled !== false
  lsp-session.js:1431  const wanted = enabled && root !== ''      ← 不看每项目的索引决策
        ↓
startLsp → connectClient → 发 initialize
        ↓
宿主 relayToServer（lsp.js:1422-1427）→ 没有 session → #holdFor
   ⇒ 握手被永久扣在 entry.pending，**宿主一个字节都不回**
   （实测：已启动进程数 = 0 | 回应给客户端的消息数 = 0）
        ↓
客户端 30 s 超时（lsp-session.js:98 HANDSHAKE_TIMEOUT_MS = 30000）
   → 2 s 后重试（:1213-1217）→ 共 MAX_HANDSHAKE_RETRIES = 3（:1152）
   ⇒ 30 + (2+30)×3 = 122 s ≈ 2 分钟后
        ↓
scheduleHandshakeRetry（:1204-1210）→ reportClientState('failed')
        ↓
lspStatusView（Workbench.jsx:517-527）：clientState === 'failed'
   ⇒ 压过宿主的一切状态（disabled / missing 除外）⇒ 红色「语义分析：会话未就绪」
        ↓
showReconnectButton（Workbench.jsx:390-392）：viewKey === 'sessionFailed' ⇒ 显示【重新连接】
        ↓
用户点【重新连接】→ store.reconnectLsp()（store.js:1632-1644）
   → restartLsp() → call('lsp.start', { root, force })
   → 宿主**不知道** indexOnOpen（src/index.js / src/host/lsp.js 全仓无此字段）
     ⇒ 宿主照常通过 turnedOff 检查（lsp.js:1967 只看 override.enabled）并**真的起一个服务器**
```

#### 实测（探针 `%LOCALAPPDATA%\Temp\probe_session_failed.mjs`）

```
A) 宿主无服务器时：已启动进程数 = 0 | 回应给客户端的消息数 = 0
   → 握手被永久扣住，客户端会一直等到 30 s 超时
B) indexOnOpen=never（用户选择从不索引）时：
   客户端会话对象存在 = true | 已发出的 initialize 数 = 1
   会话状态 = {"state":"starting","detail":""}
   → 客户端连上了，但宿主永远不会启动服务器 ⇒ 30 s 后必为 failed
```

**B 里 `indexOnOpen: 'never'` 的设置，客户端照样建立了会话并发出了握手。**

这条不是探针的构造问题：`refreshLsp()` 在**每次 store 变化时**都会被调用（`lsp-session.js:1508-1513`，store 的状态轮询 2 s 一次），所以真实产品里也是同样的行为。

#### 影响

| 场景 | 后果 |
|---|---|
| `indexOnOpen: 'never'` 的项目 | 打开项目后约 2 分钟，状态栏**由中性变红**「语义分析：会话未就绪」，并弹一次 toast（`store.js:1615` `lsp.sessionFailedToast`）——而用户**主动选择了不索引**，红色代表故障，是**误报** |
| 用户对某项目选了「使用基础模式」（`memoryWarnedRoots` = conservative） | 同上 |
| 内存不足被降级到 conservative（`store.js:1355-1362`） | 同上 |
| 用户点【重新连接】 | 宿主**真的启动**一个语言服务器，占用数百 MB 内存——**与用户「从不索引」的明确决定相反**，而且是**误报驱动的误动作** |

对照宿主的状态：此时宿主的正确表述是「未启用（无语言服务器）」，是被 `clientState === 'failed'` 压掉的那一个（`Workbench.jsx:512-527` 的注释写明「死会话压过宿主的一切状态」，这个不变式本身是对的——**问题在于这个 `failed` 根本不该发生**）。

#### 最小修复方向

**方案 A（推荐，客户端）——根本不该建立这个会话**：store 已经知道决策，`refreshLsp()` 应当问它。`store.js` 已经在 `#decideIndex` 里把决策写成了 `memoryWarnedRoots` / `indexOnOpen`，可以在 `lsp-session.js` 里把「本项目不索引」纳入 `wanted`：

```js
// src/client/lsp-session.js:1431 附近
const decision = store.state?.settings?.lsp?.memoryWarnedRoots?.[root]
const wanted = enabled && root !== '' && decision !== 'conservative'
```

（更彻底的做法是让 store 暴露一个 `lspIndexDecision(root)`，让会话模块不必自己读设置。）

**方案 B（宿主侧兜底）**——`failed` 只在宿主处于运行态时成立：宿主没有会话（`state === 'idle'` / `'disabled'`）时，客户端的 `failed` 不应该被当成故障，因为**没有人可以失败**。

**方案 C（出口收敛）**——【重新连接】在宿主没有服务器时不该去 `lsp.start`。`reconnectLsp()`（`store.js:1632-1644`）目前无条件 `restartLsp()`；应先看宿主状态，宿主都没有会话就不启动。

> 我建议 **A + C 一起做**：A 消除误报源头，C 保证出口按钮不会在「用户明确不索引」的项目上启动服务器。

---

### 1.3 P2-3（低）——【重新建立索引】跳过整道内存闸门（含硬下限）

**一句话**：客户端把 `force` 理解为「只跳过 tight 档」（代码注释就是这么写的），宿主的实现却是「跳过**整道**闸门」，包括**硬下限**。

#### 事实

**客户端**（`src/client/store.js`）：

```js
// :1550-1557 的注释
 * A degradation caused by a missing server or by a crash must not bypass the
 * memory gate, so the force is limited to the tight band.

// :1572
const force = this.state.lsp.resources?.tight === true
// :1574
await call('lsp.start', { root, force })
```

**宿主**（`src/host/lsp.js`）：

```js
// :2145
if (!session.force) {
  const resources = this.#resourcesSnapshot(...)
  if (resources.belowHardFloor) { ...degrade...; return session }   // :2154  硬下限
  if (resources.tight)         { ...degrade...; return session }   // :2158  tight
}
```

⇒ `force` 一次跳过**两档**，硬下限也在内。

#### 这正是 PRD 点名的可证伪问题③

`docs/prd/v5/PRD-v5-改造需求.md:469`：

> | ③ | **`force` 可以跳过整个检查** | `src/index.js:708` 的 `lsp.start` 接受 `force: true`（`src/host/lsp.js:1477` 据此跳过预检）⇒ 一次误点就能突破所有保护 |

**本轮提交没有改这一条。**

#### 为什么【重新建立索引】上尤其危险

正常流程里 `force` 只有一条来路——用户**答过**内存弹窗：`store.js:1346`（当场答「仍然启动」）或 `:1353`（记住的答案是 accepted）⇒ `build-forced` ⇒ `#startLsp(path, { force: true })`（`:1293`）。这条路上用户的同意是针对 **tight 档**的。

但【重新建立索引】走的是另一条路：`restartLsp()` 直接读**上一次轮询的快照** `this.state.lsp.resources?.tight === true`，**不弹任何窗**。快照最多 2 s 旧（状态轮询 2 s），而且 `restartLsp()` 在此之前刚做完 `lsp.shutdown`（`:1565`）——**释放了旧的预留额**，所以快照里的可用内存比实际更乐观。

⇒ 用户点一下【重新建立索引】，就可能在**比快照更紧**的机器状态上，用 force 跳过包括硬下限在内的全部检查。

#### 最小修复方向

**方案 A（推荐，宿主，语义对齐客户端注释）**——force 只跳过 tight 档，保留硬下限：

```js
// src/host/lsp.js:2145
const resources = this.#resourcesSnapshot(memoryLimitMB, language, lsp)
session.resources = resources
if (resources.belowHardFloor) { ...degrade...; return session }   // 硬下限：任何时候都不跳过
if (resources.tight && !session.force) { ...degrade...; return session }
```

这与客户端 `store.js:1554-1557` 的注释、也与 PRD §5.1 ③ 的意图一致：**force 是「用户说内存紧也照样起」的许可，不是「内存不够也照样起」的许可**。

**方案 B（客户端）**——force 之前重新读一次内存，而不是用 2 s 前的快照。

> 建议 A 为主、B 为辅。硬下限是「机器扛不住」的最后一道闸，不应该被一个**不弹窗**的按钮绕过。

---

### 1.4 P3-4（说明）——宿主说 `building` 时，客户端的「正在连接…」不可见

`src/client/Workbench.jsx:528`：

```js
if (clientState === 'starting' && current === 'ready') {
  return { ...base, key: 'sessionConnecting', text: t('lsp.status.sessionConnecting'), tone: 'idle' }
}
```

`current === 'ready'` 是宿主 `lsp.status.state` 的值。**宿主说 `building`（正在构建 program）时不进入这个分支**，于是状态栏落到下面的 `switch (current)` ⇒ 显示「语义分析：正在构建索引…」，**完全看不出客户端会话还没就绪**。

而这恰恰是**最容易误报**的时刻：宿主进程活着、正在建 program，语义功能**确实**还不能用，客户端却把「正在构建索引」这话说得像是一切正常。

**与上一轮 T7 的关系**：上一轮 T7（第一次补全挂 10 分钟、状态栏却说「就绪」）被判定为「按我建议的方向处理（不缩短等待、改为可见）」——`buildingProgram` 标志 + 「正在构建索引…」。那一条让用户**知道要等**；本条说的是**等的时候状态栏不该同时说"就绪"**。两件事不冲突，但今天的状态栏在 `building` 期间**只说前者、不说后者**。

**最小修复方向**：把条件放宽到「客户端 `starting` 且宿主处于任何**看起来正常**的状态」：

```js
if (clientState === 'starting' && (current === 'ready' || current === 'building')) { … }
```

（若担心文案冲突，也可以保留 `building` 文案，但在其下补一行「会话尚未就绪」。）

---

### 1.5 P3-5（说明）——`semanticNote` 的英文兜底是死代码

`src/client/CodeEditor.jsx:880-882`：

```js
const semanticNote = sessionLabels.semanticUnavailable !== ''
  ? sessionLabels.semanticUnavailable
  : (labels.semanticUnavailable ?? 'The language server does not support finding usages.')
```

`sessionLabels` 来自 `navLabels()`（`lsp-session.js:1659-1669`），其 `semanticUnavailable` 恒为 `translate('nav.semanticUnavailable')` 或 `translate('nav.semanticSessionUnavailable')` 之一。而 `translate`（`lsp-session.js:709-719`）的兜底是 **`return key`**，**永不返回空串**：

```js
function translate(key) {
  if (typeof sessionStore?.t === 'function') {
    try {
      const value = sessionStore.t(key)
      if (typeof value === 'string' && value !== '') return value
    } catch { /* a broken translator must not break the menu */ }
  }
  return key
}
```

两个 key 在 en / zh-CN 两张表里都存在（`i18n.js:635` `638` / `1271` `1273`）⇒ **`sessionLabels.semanticUnavailable !== ''` 恒真** ⇒ 三元的**整个 else 分支是死代码**。

**顺带**：`labels = { ...sessionLabels, ...(navLabelsProp ?? {}) }`（`:877`）让 prop 能覆盖 `semanticUnavailable`，但 `semanticNote` 用的是 `sessionLabels`（不覆盖）——**这是有意为之**（`:870-875` 的注释解释了原因：prop 里的通用文案在会话已死时是**假话**）。既然如此，`:882` 那行读 `labels.semanticUnavailable` 的死分支更容易误导后来人。

**最小修复方向**：删掉死分支，写成

```js
const semanticNote = sessionLabels.semanticUnavailable
```

（并在 `:877` 的合并处加一行注释，说明 `semanticUnavailable` 故意不被 prop 覆盖。）

---

## 2. 对实施记录与 PRD 表述的更正建议（汇总）

| # | 文件:行 | 现文 | 问题 | 建议 |
|---|---|---|---|---|
| 1 | `PRD-v5-改造需求-实施进展.md:188`（§3.4） | 「现在**最新的握手胜出**（`#holdFor`），新起的服务器进程用客户端**当下**在用的作用域初始化。……（已验证：去掉修复即变红）」 | 只在服务器不在时成立；那条测试只测了 `#holdFor` 路径 | 写明条件与覆盖范围，并附 P1-1 的实测输出 |
| 2 | `PRD-v5-改造需求-实施进展.md:39`（M8 行） | 「✅ 完成（复核后补齐）……宿主改为**最新握手胜出**」 | 同上 | 改为 ⚠️「部分达成」，注明宿主侧有条件 |
| 3 | `PRD-v5-改造需求-实施进展.md:61`（SCOPE-01 行） | 「✅」「作用域**真的**收敛了」 | 同上 | 同上 |
| 4 | `PRD-v5-改造需求-实施进展.md:190`（§3.4 末段） | 「**仍未达成的一点**：**运行中的**服务器保留它原来的 program，直到它下一次启动」 | 这句本身是对的，但它让人以为「下一次启动会用新作用域」——实际上**连这个都做不到**（P1-1） | 补一句：当前「下一次启动」用的仍是旧握手，修复见 §1.1 |
| 5 | `PRD-v5-改造需求-实施进展.md` §3.11（新增的根因章节） | 声称【重新连接】的出口成立 | `store.js:1621-1623` 的注释「宿主保留**最新**握手」与代码不符；【重新连接】会把作用域改回去 | 同 1；并在 `store.js:1621-1623` 的注释里写明条件 |
| 6 | `src/client/store.js:1554-1557`（注释） | 「the force is limited to the tight band」 | 注释描述的是**意图**，实现是「跳过整道闸门」 | 二选一：要么按注释收窄宿主实现（推荐），要么把注释改成实际行为 |
| 7 | `PRD-v5-改造需求.md:469`（问题③） | 「`force` 可以跳过整个检查……一次误点就能突破所有保护」 | **本轮未改**，仍然成立 | 随 P2-3 一并处理 |

---

## 3. 这一轮做得好、值得保留的地方

### 3.1 PERF-03 的测试改用生产构建配置（上一轮第 2 条）

`tests/perf-hot-path.test.mjs` 现在**从 `scripts/build.mjs` 本身抽取**构建选项（扫描 `await build({…})` 字面量，在 `vm` 里以 `dev:false` 求值），断言的是**产物的事实**（13 个语言包与 12 个语法包仍内联在同一文件里）与**运行时行为**（`require()` 产物后标记列表为空 ⇒ 加载时 0 个语言模块被求值）。回归检查也做了：把 `CodeEditor.jsx` 换回静态 import 重建，三条断言同时变红。

上一轮我写过一句话，这里再写一次，因为它正好是本轮最好的工程实践：

> **谎称相反的测试比没有测试更糟。**

测试与生产构建漂移这件事，是这类「性能验收」最常见的自欺方式；他们没有辩解「测试本来就是测源码的」，而是把测试改成**测发布物**。

### 3.2 MEM-03 的拒绝有实测支撑

`PRD-v5-改造需求-实施进展.md` §3.1 用实测论证了 standby cache 是**内核优先回收的可用内存**：分配 1.5 GB 时实测从 standby 取走 **1.216 GB 且无换页**；同时指出建议的 `GetPerformanceInfo().SystemCache` 会**多扣约 600 MB** 的可回收文件缓存 ⇒ 按字面实现会让闸门**拒绝机器给得起的启动**。

这是正确的取舍：**规格的前提不成立时，诚实地说出来并给出证据，比照着字面实现一个会误拒的闸门要好**。本轮我复核后维持这个判断。

### 3.3 降级分类 + 退避重试

`DEGRADE_CAUSES` / `RETRYABLE_DEGRADE_CAUSES` / `WAKE_BACKOFF_MS = 60000` / `DEGRADE_EPISODE_END_STATES` 把「降级」从一个笼统状态拆成了**可枚举的因果**：

- 只有**机器状态会变**的原因（内存）才值得退避重试；
- **需要用户动作**的原因（没装服务器、语言被关、崩溃预算用尽）不重试——重试只会重复同一次拒绝；
- 故障区间标志让「崩溃→重启→降级」只弹**一次** toast。

这直接修掉了上一轮第 6 条（「唤醒只生效一次」），而且是**用规则**修的，不是打补丁。

### 3.4 其余上一轮发现的处置

- **隐藏窗口不再误报「状态未知」**：`visibilitychange` 监听 + 「跳过轮询不是失败的轮询」（`STALE-02` 的备注写得很准）。
- **降级 toast 正文已本地化**，且标题**不复用**「语言服务器已退出」——因为宿主侧 `degraded` 有四条产生路径，其中三条**根本没有退出**（§3.5）。拒绝复用旧文案这个判断是对的。
- **worker 丢弃握手时写宿主日志**：`lsp-worker.js:454-459` 的 `{type:'dropped'}` 上报，宿主的日志里能看到「服务器还没答第一次握手就来了第二次」。
- **状态栏不再相信宿主一个人的话**：`clientState` 机制本身是对的（§0.5 第 1 条）。

---

## 4. 复现方法与探针说明

本轮两个探针**写在仓库外的临时目录**（`%LOCALAPPDATA%\Temp\`），**没有进仓库**：

| 探针 | 验证的发现 | 输出要点 |
|---|---|---|
| `probe_handshake.mjs` | P1-1 | 新进程收到的 `initialize` 里 `rootUri` 仍是 `file:///OLD-SCOPE` |
| `probe_session_failed.mjs` | P1-2 | `indexOnOpen=never` 时客户端照样建会话并发握手；宿主无服务器时 0 回应 |

两个探针都用**仓库自带的 `tests/lsp-fixtures.mjs`** 驱动真实 `LspManager`（`makeManager` / `makeFakeWorker` / `makeSink`），夹具的握手规则与真实 worker 一致（`answerFor` 提前 return、`noteForwarded` 仅转发路径 post handshake），所以结论是可复现的、不是模型推演。

```sh
# 仓库与提交
git -C dsh-ide-workbench log --oneline -6
git -C dsh-ide-workbench status --short
git -C dsh-ide-workbench diff fdad597 4b8af00 --stat

# 测试（864 / 864）
npm --prefix dsh-ide-workbench test

# 探针（脚本在 %TEMP%，不在仓库）
node "$env:TEMP\probe_handshake.mjs"
node "$env:TEMP\probe_session_failed.mjs"
```

---

## 5. 一句话总结

**上一轮的 5 条成立发现全部修好，而且修法都对；本轮的新机制（客户端会话状态）方向正确、但覆盖面没对齐 store 已有的决策和宿主的条件分支——于是「不说谎」换成了「误报」。两条中危都是小改动可修的覆盖面问题，不是设计缺陷。**

**§2 的 7 处文档表述需要一并更正**——尤其是 §3.4 与 M8 / SCOPE-01 两行，它们目前把一个「只在一半场景成立」的修复写成了「已完成」。
