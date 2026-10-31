# PRD-v5 代码检视报告（第二轮：修复复核 + 崩溃根因）

> **范围**：`31dfbc7` → `bf4927e`（1 个提交，`fix(code): count unanswered requests, not silence, and settle the review round`）。
> **基线**：`31dfbc7b24ba7e5a62c8549a092cea6bc951d7aa`。**对照物**：`docs/PRD-v5-代码检视报告-补充需求轮.md`（上一轮，R1–R20）、`docs/PRD-v5-补充需求.md`（规格）。
> **方法**：读代码 + **实跑验证**。`npm test` 实跑 **669 项 / 669 通过 / 0 失败**（上一轮为 640）；自建 **6 个探针脚本**直接 import 生产代码复现关键路径；崩溃日志与探针栈**逐帧比对**。
> **本次检视未修改任何源码**。探针脚本写在仓库外的临时目录（`%LOCALAPPDATA%\Temp\iwb-probe\`）。
> **检视日期**：2026-10-31。
> **重点关注**（用户指定）：①「不稳定、连接超时」；② 切换 Project / 选择构建时 DSH 崩溃（致命）；③ 上轮检视意见的修复状态复核。

---

## 0. 结论

### 0.1 致命崩溃：已定位根因并端到端复现

**根因**：宿主把 JSON-RPC 帧写进语言服务器的 stdin 时，**没有给 stdin 流挂 `'error'` 监听器**。
`src/host/lsp.js:1538` 给 `stdout` 挂了、`:1548` 给 `stderr` 挂了，**唯独 stdin 没有**。

而管道断裂产生的 `EPIPE` 是**异步**通过流的 `'error'` 事件抛出的（不是同步 throw），所以 `:1660-1662` 包在 `stdin.write(data)` 外面的 `try/catch` **永远抓不到**。事件无人接收 → **uncaught exception → 整个 DSH 宿主进程死亡** → Electron 弹出「应用无法启动或已意外停止」。

**这不是旧构建的问题**：提交 `bf4927e` 的时间是 **23:08:35**，崩溃日志的时间是 **23:12:19**——**崩溃就发生在新提交这份代码上**，且日志里的三个行号（`lsp.js:1661:13` / `:1624:26` / `:1459:64`）与 HEAD 的源码**逐帧吻合**。

**触发路径正是「切换 Project / 选择构建」**：`#shutdownEntry` 先把 `didClose` 帧交给 worker（跨线程，异步），**紧接着就 terminate 进程**——帧还在路上，管道已经断了。

**已实证**：用生产 `LspManager` 端到端复现，得到的栈与用户崩溃日志**完全一致**（见 §1.4）。

> 一句话：**一个语言服务器的管道写入错误，就能把整个 DSH 带走。**

### 0.2 上轮 R1–R20 的复核结论：**20/20 全部修复，且我逐条实证或复核过**

上轮报告里的 20 条发现，本轮**全部修复**。其中 R1（看门狗把通知当请求）、R3（内存上限死控件）、R12（深色主题对比度）、R16（推送按钮不可达）、R19（测试保真度）都是**实质性修复**，不是打补丁。详见 §3。

**用户的「看着还是像 2048」有一个新解释**：R3 修好后，全局上限的语义变成了「**所有语言的上限**」——用户把 2048 改成 4096，TypeScript 仍然是 2048（受它自己的内置值约束），**视觉症状原样复发**。提示文案没有跟着改（§4 S7）。

### 0.3 「不稳定、连接超时」：R1 的核心缺陷已修，但**大项目上的残留循环还在**

探针实证：**通知不再被计入超时**（R1 的原始病灶已消除）——发 6 条 `didChange` 通知，服务器 40 秒不回应，`timeouts` 恒为 **0**，服务器**不会被杀**；对照组发 3 条真请求不回应，`timeouts` 累计到 3，服务器**被杀并重启**（进程启动次数 1→2）。

**但**：真请求超时仍然计数，而 **`building`（构建 program）阶段也在计数**。PRD 自己的 §0.2 #3 记录了「大型项目首个语义请求可超 10 分钟」——30 秒超时 × 3 次 = 90 秒，**「构建 → 被杀 → 重建」的自触发循环在大项目上依然成立**。详见 §2.2。

### 0.4 本轮新发现汇总（S1–S9）

| 编号 | 严重度 | 一句话 | 位置 |
|---|---|---|---|
| **S1** | **高（致命）** | **stdin 没有 `'error'` 监听器 → EPIPE 变成 uncaught exception → 整个 DSH 宿主死亡** | `src/host/lsp.js:1657-1663`（对比 `:1538`、`:1548`） |
| **S2** | 中 | `#spawn` **从不停止旧 worker** → worker 线程泄漏，且旧代帧会写进**新**服务器的 stdin | `src/host/lsp.js:1449-1459` |
| **S3** | 中 | worker 的 `'message'` 回调**没有 generation fence**（stdout 有、worker 没有） | `src/host/lsp.js:1459` vs `:1528` |
| **S4** | 中 | `#onCrash` 不清 `session.handle` → 重启退避窗口内仍在往死进程写 | `src/host/lsp.js:2015` |
| **S5** | 中 | `building` 阶段仍统计真请求超时 → 大项目「构建→被杀→重建」循环残留 | `src/host/lsp.js:1958` |
| **S6** | 中 | 客户端 30 s 请求超时与「大项目首个语义请求可超 10 分钟」**固有冲突**，默认值必然在大项目上报超时 | `src/client/lsp-session.js:540-544` |
| **S7** | 中 | R3 的新语义（全局=所有语言的上限）**没写进提示文案** → 用户把 2048 改成 4096 仍见 2048，「看着像 2048」复发 | `src/client/i18n.js:654-655` |
| **S8** | 低 | `didOpen` 对**工作区外**的文件不设防 → tsserver 刷 `Unexpected resource` + 误报错误 toast | `src/client/lsp-workspace.js:302-323` |
| **S9** | 低 | 插件**没有任何 `uncaughtException` / `unhandledRejection` 兜底** → 任何插件异常都能带走 DSH | `src/` 全仓无此监听 |

**统计：高 1 / 中 6 / 低 2。**

### 0.5 总体判断

**修复质量高**：上轮 20 条全部落地，且都是**结构性修复**（新增 `settings-defaults.js` 让宿主与客户端共用一份默认值；新增 `requestIdOf`/`answeredIdOf` 把「请求」与「通知」在协议层分清；决策收敛到宿主一处下发）。

**但本轮暴露了一个更根本的问题**：**这个插件的宿主代码里，任何一条未捕获的异常都会直接杀死整个 DSH 应用**。S1 不是孤例——它暴露的是「宿主侧缺少错误边界」这个结构性问题。S2/S3/S4 都是同一类：**跨线程 / 跨进程边界的时序假设没有被代码表达出来**。

**建议**：修 S1 只是止血；真正要做的是给宿主加一层**错误边界**（S9），让任何单个语言服务器的 I/O 故障最多让语义分析降级，而不会让整个 IDE 崩掉。

---

## 1. 致命崩溃：一次 EPIPE 打死整个 DSH 宿主

### 1.1 证据链

**① stdin 没有 `'error'` 监听器（stdout、stderr 都有）**

```js
// src/host/lsp.js:1529-1549
if (handle.stdout) {
  handle.stdout.on('data', ...)
  handle.stdout.on('end', ...)
  handle.stdout.on('error', () => {})        // :1538  ✅
}
if (handle.stderr) {
  handle.stderr.on('data', ...)
  handle.stderr.on('error', () => {})        // :1548  ✅
}
// ❌ handle.stdin 全程没有任何 'error' 监听器
```

全仓 grep 确认：`src/` 下只有这两处 `.on('error')` 属于语言服务器句柄。

**② 写 stdin 的地方有 `try/catch`，但抓不到**

```js
// src/host/lsp.js:1657-1663
#writeToServer(session, data) {
  const stdin = session.handle?.stdin
  if (stdin === undefined || stdin === null) return
  try {
    stdin.write(data)                       // :1661
  } catch { /* the pipe is already gone */ }   // ← 抓不到异步的 'error' 事件
}
```

**③ `worker.on('error')` 挡不住它**（`src/host/lsp.js:1460`）——那是 **worker 线程**的 error，与**子进程 stdin 流**的 error 是两码事。

**④ `#safely` 也挡不住**（`src/host/lsp.js:1775-1779`）——它只包裹 **Promise**；`#onWorkerMessage` 与 `#writeToServer` 都是**同步**路径，完全不在其覆盖范围内。

**⑤ 全仓无 `uncaughtException` 兜底** —— `grep 'uncaughtException|unhandledRejection' src/` 无匹配。

### 1.2 机制：EPIPE 是**异步**的，`try/catch` 抓不到

**实测**（`probe-epipe4.mjs`，本机 Node v22.22.2；崩溃环境为 Node 24.21.0，仅版本差异）：

```
sock.write() 正常返回, 返回值 = false （说明没有同步抛错）
结论：错误在 write() 返回之后才到达（异步），try/catch 抓不到
```

**崩溃日志的栈自己证明了这一点**：抛错的栈顶是

```
at afterWriteDispatched (node:internal/stream_base_commons:159:15)
```

`afterWriteDispatched` 是 Node 的**写完成回调**——它在 `Writable.write()` **已经返回之后**才被调用。异常从那里抛出时，`try` 语句块早已退出，`catch` 不可能捕获。

**完整链路**：

```
stdin.write(data)            → 立即返回，不抛错
  → Node 内部的 afterWriteDispatched 在稍后被调用
    → 构造 Error('write EPIPE')
      → errorOrDestroy(stream, err)
        → emit('error', err)
          → 流上没有 'error' 监听器
            → EventEmitter 抛出
              → process.nextTick(...) → uncaught exception
                → 宿主进程死亡 → Electron 崩溃对话框
```

### 1.3 崩溃时序（为什么是「切换 Project / 选择构建」）

**主链 —— 切换 Project**：

| 步骤 | 位置 | 动作 |
|---|---|---|
| 1 | `src/client/lsp-session.js:770` | 项目变了 → `shutdownHostLsp(previousRoot)` → `call('lsp.shutdown', {root})` |
| 2 | `src/host/lsp.js:850-857` | `shutdown()` → `#shutdownEntry`（`:2191`） |
| 3 | `src/host/lsp.js:2197` | `#writeDidClose` → `#sendToServer`（`:1647-1650`）→ `worker.postMessage({type:'send'})` —— **跨线程，异步** |
| 4 | `src/host/lsp.js:2199` | `#terminateAndWait` → `:2100` `handle.terminate()` → **进程死亡，stdin 管道写端断裂** |
| 5 | `src/host/lsp.js:2105-2108` | `await Promise.race([waitForExit(), delay(graceMs+500)])` —— **最长 2.5 秒的 await 窗口**，其间 `session.handle` **仍指向那个死 handle**（`session.handle = null` 在 `:2208`，在 await 之后） |
| 6 | `src/host/lsp-worker.js:405` | worker 完成 framing → `parentPort.postMessage({type:'stdin', data})` |
| 7 | `src/host/lsp.js:1459` → `:1624` | `#onWorkerMessage` → `type === 'stdin'` → `#writeToServer` |
| 8 | `src/host/lsp.js:1661` | `stdin.write(data)` → 写已断的管道 → **EPIPE** |
| 9 | —— | 无 `'error'` 监听器 → **uncaught exception → 宿主死亡** |

**次链（同型，更易命中）**：

- `#cancelSession`（`:751-765`）：`:754` didClose → `:755` terminate —— **同样的写-杀竞态**；
- `#exitIdle`（`:1907-1921`）：`:1911` didClose → `:1912` terminate —— 同上，且**从不置空 handle**；
- `#onCrash`（`:2000-2050`）：`:2015` `#teardownSession` **不清 `session.handle`** → 崩溃后 `restartBackoffMs`（默认 2 s）内 `session.handle` 仍指向死进程。

**为什么是间歇性的**：第 3 步的 worker 往返（跨线程，约 1 ms）与第 4 步的进程死亡（数十 ms）之间是**竞态**——帧有时赶在进程死前写进去（没事），有时赶不上（EPIPE）。这与用户「切换 Project、选择构建时崩溃」的表现一致。

### 1.4 复现（端到端，走生产代码）

**探针**：`%LOCALAPPDATA%\Temp\iwb-probe\probe-e2e.mjs` —— 只读 import 仓库的 `tests/lsp-fixtures.mjs` → **真实 `LspManager`** → 把 fake handle 的 stdin 换成真实子进程 stdin 并杀掉 → 让 worker 发 `{type:'stdin'}`。

**实测输出（我独立复跑确认）**：

```
worker emits {type:"stdin"} -> #onWorkerMessage -> #writeToServer
UNCAUGHT_EXCEPTION code=EPIPE msg=write EPIPE
Error: write EPIPE
    at afterWriteDispatched (node:internal/stream_base_commons:159:15)
    at writeGeneric (node:internal/stream_base_commons:150:3)
    at Socket._writeGeneric (node:net:966:11)
    at Socket._write (node:net:978:8)
    at writeOrBuffer (node:internal/streams/writable:572:12)
    at _write (node:internal/streams/writable:501:10)
    at Writable.write (node:internal/streams/writable:510:10)
    at #writeToServer (file:///D:/.../src/host/lsp.js:1661:13)
    at #onWorkerMessage (file:///D:/.../src/host/lsp.js:1624:26)
    at file:///D:/.../src/host/lsp.js:1459:64
RESULT {"uncaught":true,"mode":"undefined"}
```

**与用户崩溃日志逐帧对照**：

| 帧 | 用户日志（Node 24.21.0） | 我的复现（Node 22.22.2） | 结论 |
|---|---|---|---|
| `stream_base_commons` | `:159:15` / `:150:3` | `:159:15` / `:150:3` | **完全一致** |
| `net` | `:1262:11` / `:1274:8` | `:966:11` / `:978:8` | 恒定偏移 +296（版本差异） |
| `writable` | `:574:12` / `:503:10` / `:512:10` | `:572:12` / `:501:10` / `:510:10` | 恒定偏移 +2（版本差异） |
| **`#writeToServer`** | **`lsp.js:1661:13`** | **`lsp.js:1661:13`** | **完全一致** |
| **`#onWorkerMessage`** | **`lsp.js:1624:26`** | **`lsp.js:1624:26`** | **完全一致** |
| **Worker 回调** | **`lsp.js:1459:64`** | **`lsp.js:1459:64`** | **完全一致** |

**同一段 Node 代码，仅版本差异。** 同一探针加上 `stdin.on('error')` 后 → `{"uncaught":false}`，错误被收到并处理 ⇒ **修复方案已实证有效**。

### 1.5 修复方案

**最小止血（必须做，一行）**：

```js
// src/host/lsp.js:1529 之前，与 stdout/stderr 对称
if (handle.stdin) {
  handle.stdin.on('error', () => { /* the server is gone; the crash handler deals with it */ })
}
```

> ⚠️ **不要**只用 `stdin.write(data, cb)` 的 callback：实测 callback 收到的是 `ERR_STREAM_DESTROYED`，**EPIPE 走 `'error'` 事件而非 callback**，单用它无效。

**根治（按优先级）**：

1. **generation fence**（`src/host/lsp.js:1459`）——照抄 stdout 路径已有的 `current()` 模式（`:1528`）：
   ```js
   worker.on?.('message', (message) => {
     if (session.generation !== generation) return   // 旧代的帧不进新会话
     this.#onWorkerMessage(entry, session, message)
   })
   ```
   这同时解决 S2/S3：**旧 worker 的帧不会再写进新服务器**。
2. **先停 worker，再杀进程**（`:1449-1453`）：`previous.terminate()` 之前先 `this.#stopWorker(session)`，并把 `session.handle = null` 提到 `terminate()` **之前**。
3. **terminate 前置空 handle**（`:2100` / `:2199` / `:1912`）：让在途帧变成 no-op，而不是写进死管道。
4. **`#onCrash` 清 handle**（`:2015` 之后）：`session.handle = null`。
5. **宿主级错误边界**（S9）：在插件入口加 `process.on('uncaughtException')`，把「单个语言服务器的写入错误」降级为 `logger.warn` + 走 `#onCrash`。**绝不能让一个 LSP 的 I/O 错误带走整个宿主进程**——这才是本次致命的根本原因。

### 1.6 为什么 669 个测试没有抓到

**测试替身结构上不可能产生 EPIPE**：

```js
// tests/lsp-fixtures.mjs:57-66
export function makeFakeHandle(options = {}) {
  const stdin = new Writable({
    write(chunk, encoding, callback) {
      stdinChunks.push(Buffer.from(chunk))
      callback()          // ← 永远不会失败
    }
  })
```

这是一个**纯内存 `Writable`**，永远不会断、永远不会报错。整条 `#writeToServer` 路径在测试里被完整走了一遍——**只是永远不会出事**。

**建议**：给 `makeFakeHandle` 加一个 `failStdin` 选项，让 `stdin` 在写失败时**异步**在该流上 `'error'`（这正是崩溃所需的形态），然后在 `tests/lsp-recovery.test.mjs`（该文件已有 `watchHost()` 辅助）加一条用例：

> 「writing to a dead server's stdin does not kill the host」

---

## 2. 「不稳定、连接超时」这条线

### 2.1 R1 的核心缺陷：已修复（探针实证）

**修复方式**（结构性）：不再在宿主里猜「什么算请求」，而是**由唯一有资格解析载荷的 worker 线程**来判定并上报 id。

- `src/host/lsp-worker.js:135-143` `requestIdOf(text)` —— 只有**同时有 method 和 id** 的载荷才是请求；通知（只有 method）返回 `null`。
- `src/host/lsp-worker.js:154-160` `answeredIdOf(text)` —— 只有**只有 id、没有 method** 的载荷才是「回答」；服务器发起的请求（server→client）**不会**被误判为回答（它有 method）。
- `src/host/lsp-worker.js:387` / `:351` —— worker 上报 `{type:'request', id}` / `{type:'answered', id}`。
- `src/host/lsp.js:1604-1611` / `:1613-1622` —— 宿主维护 `session.pendingRequests`（id → 发出时刻）。
- `src/host/lsp.js:1955-1969` —— 看门狗**只遍历 `pendingRequests`**，没有任何未应答请求就直接返回。

**探针实证**（`probe-r1b.mjs`，`requestTimeoutMs=400`，每个场景独立 root）：

| 场景 | 载荷 | `timeouts` | 进程启动次数 | 判读 |
|---|---|---|---|---|
| **A** | 3 个**真请求**，从不应答 | **3** | **2**（被杀并重启） | 超时计数生效，符合设计 |
| **B** | 6 个**通知**（`didChange`），从不应答 | **0** | **1**（没被杀） | ✅ **R1 修复生效** |

> 上一轮我在同样位置测到的是「只发通知 + 31 s 静默 → `timeouts=1` → 3 轮后杀进程」。现在通知**完全不再计入**。

**附带确认**：`pendingRequests` **不会泄漏**——每个条目要么在计数时被删（`:1968`），要么在收到回答时被删（`:1618`）。

### 2.2 残留 S5 ［中］：`building` 阶段仍然会杀掉服务器

**看门狗的判定条件**（`src/host/lsp.js:1958`）：

```js
if (session.state !== 'ready' && session.state !== 'building') return
```

——**`building`（正在构建 program）阶段照常计数**。而 PRD 自己的 §0.2 #3 记录了：**「大型项目首个语义请求可超 10 分钟」**。

于是：**30 s 超时 × 3 次 = 90 秒**，大项目上任何三个超时的真请求就会把正在构建的服务器杀掉 → 宿主重启它 → 又进入构建 → **「构建 → 被杀 → 重建」的自触发循环原样保留**。

场景 A 的探针正是在 `building` 状态下被杀的（初始态=building → `timeouts=3` → 进程启动次数 1→2）。

**修复方向**：

1. `building` 阶段**不计入**超时（或把阈值放大一个数量级）——构建期的沉默是正常的；
2. 或者：把「3 次超时就杀」的策略改为「N 次超时**且**服务器没有在推进（没有 `$/progress`）才杀」；
3. 至少：在设置页说明「单次请求的上限」在构建期同样生效。

### 2.3 S6 ［中］客户端 30 s 超时与大项目的固有冲突

**上轮 R2 已经修好了 UI 侧**：现在输入框 `min: 30000`，`onChange` 直接夹到 30 s（`src/client/SettingsPanel.jsx:545-549`），并且 `requestTimeoutOf` 也明确写成了「小于 30000 就按 30000 算」（`src/client/lsp-session.js:540-544`）——**不再有「界面接受、运行时被静默改写」的错位**。握手失败也有重试了（`watchHandshake` / `scheduleHandshakeRetry` / `reinitializeLsp`，`lsp-session.js:641-689`），**不再需要刷新页面**。

**但默认的 30 秒仍然与规格记录的负载冲突**：

- `src/host/settings-defaults.js:34` `requestTimeoutMs: 30000`；
- PRD §0.2 #3：大型项目首个语义请求**可超 10 分钟**；
- 客户端在 30 s 时放弃 → 用户看到 `Request timed out`（该字面量的唯一出处是 `node_modules/@codemirror/lsp-client/dist/index.js:797`）；
- 宿主在 30 s 时把它记为一次未应答 → 3 次后杀服务器。

**也就是说：在大项目上，用户「Request timed out 依旧比较频发」是必然的，不是偶发。** 设置页允许调到 10 分钟（`max: 600000`），但**默认值注定触发**。

**建议**：

1. **区分「首次语义请求」与「增量请求」**：首次（或构建刚结束后的第一次）应给一个远大于 30 s 的预算——PRD 已经记录了 10 分钟量级；
2. 或把默认改成 120 s / 300 s，并在设置页写明「大型项目建议 5–10 分钟」；
3. 客户端超时与宿主超时应当**解耦**：客户端放弃 ≠ 服务器没在干活，不应直接计入「杀服务器」的计数（与 §2.2 同源）。

### 2.4 renderer 侧噪声（崩溃日志里刷屏的内容）

崩溃日志的 `renderer console` 段里有两类重复刷屏，都值得单独说明：

**① `[lsp] Unexpected resource file:///d:/.../src/host/fileops.js`**

- 这条**不是插件打的**——它来自 `node_modules/typescript-language-server/lib/cli.mjs:21322` 的 `toOpenDocument()`：服务器收到一个它不认识的文档 URI 时 `console.error` 出来的；
- 插件把它当成了错误：`src/client/lsp-session.js:127-140` 把 `LSPPlugin.prototype.reportError` 重定向到 toast，于是**每次打开工作区外的文件都会弹一个错误 toast**；
- 根因（S8）：`src/client/lsp-workspace.js:302-323` 的 `openFile()` **对任何被编辑器打开的文件都发 `didOpen`**，**没有工作区根目录的检查**——而 `requestFile()`（`:354`）是有的；
- 顺带说明：**这正是用户为什么会打开插件自己的 `src/host/fileops.js`**（在插件仓库里开发插件），所以这条噪声在开发期会特别频繁。

**② `Uncaught (in promise) Error: Request timed out`**

- 插件的 `watchSemanticRequests`（`lsp-session.js:277-296`）在失败时**重新抛出**（`:292`），让错误继续传给库；
- 库内部有些调用路径没有 `.catch` → **未处理的 Promise rejection**；
- 这类条目在日志里跨了**十几个不同的构建哈希**（`rev=bb18a4484680` … `rev=1e1cc02141ce`），说明是**长时间累积**的，不能全部归到最新这次构建。

> 两类都**不致命**，但它们把真正的崩溃原因淹没在几百行噪声里——而这次的真凶（EPIPE）恰恰是**唯一一条出现在 host 段**的。**建议：崩溃报告里把 plugin 的 renderer 噪声折叠，只保留 host 段与最近 N 条。**

---

## 3. 上轮 R1–R20 逐条复核

| 编号 | 严重度 | 上轮的结论 | 本轮复核 | 证据 |
|---|---|---|---|---|
| **R1** | 高 | 看门狗把通知当未应答请求 | ✅ **已修复（实证）** | `lsp-worker.js:135-160` 新增 id 判定；`lsp.js:1604-1622` 维护 `pendingRequests`；`:1955-1969` 只遍历它。探针：通知 → `timeouts=0`、不被杀；真请求 → `timeouts=3`、被杀重启 |
| **R2** | 高 | 客户端 30 s 硬下限 + 握手失败粘性损坏 | ✅ **已修复** | `SettingsPanel.jsx:545-549` 输入即夹到 30 s；`lsp-session.js:540-544` 显式判定；`:641-689` 新增握手重试（最多 3 次，`disconnect`+`connect`），不再要求刷新页面 |
| **R3** | 中 | 全局 `memoryLimitMB` 是死控件 | ✅ **已修复** | `lsp.js:1266-1274`：全局值作为**所有语言的上限**（`Math.min(languageLimitMB, globalLimitMB)`），按语言覆盖优先。探针：全局 2048/512/128 → 会话上限 2048/512/128 ✅ |
| **R4** | 中 | 客户端与宿主判定不同源 | ✅ **已修复** | `store.js:1154` `resources.decision ?? (旧宿主兜底)` —— **宿主下发的判定为准**；`i18n.js:670` 动态行补上了「低于 {threshold} MB 不启动」 |
| **R5** | 中 | 只记「已提醒」不记用户选择 | ✅ **已修复** | `store.js:1203` `#memoryAnswer(root)` 读答案；`:1220-1223` `#rememberMemoryAnswer(root, answer)` 写入 `'accepted'`/`'conservative'`；`store.js:1172-1173` 按答案分流 |
| **R6** | 中 | `settings.update()` 不跑迁移 | ✅ **已修复（换了个方式）** | `settings-store.js:247` 加载只做一次，但 `:283` `update()` 先 `await this.get()` → 触发 `#load()` → `:261` 跑迁移 → 迁移在每次写入前都已生效 |
| **R7** | 中 | 崩溃原因被硬编码为「内存不足」 | ✅ **已修复** | `lsp.js:2016-2020` 详情只陈述事实（「The language server exited unexpectedly (reason)」），**不再硬编码内存**；`i18n.js:1188-1190` 按原因分派 `crashedTimeout` / `crashedMemory` / `crashedGeneric` |
| **R8** | 中 | 低内存提示指向无效控件 | ✅ **已修复** | `i18n.js:1186` 改为「请关闭其它程序，或对该语言改用保守版」——**不再提「调低内存上限」** |
| **R9** | 低 | 两个都叫「保守下限」 | ✅ **已修复** | `i18n.js:670` 动态行改为「…低于 {threshold} MB 不启动 · 硬下限 {floor} MB」；`i18n.js:660` 设置项叫「内存硬下限」，与「保守兜底下限」不再冲突 |
| **R10** | 低 | 「重置」不重置语义分析设置 | ✅ **已修复** | `SettingsPanel.jsx` 新增 `resetPatch()`，包含 `lsp` 段；三个 map 用 **`null`** 下发（注释 `:90-93` 说明：空对象会被 merge 而不是替换，`null` 才能整体替换） |
| **R12** | 中 | 深色主题语法对比度回退 | ✅ **已修复** | `tests/styles-theme.test.mjs` 改用**通用**对比度公式（`max/min`，`:117-122`），并同时验 **浅色编辑器 / 深色编辑器 / 深色代码层**（`:145-157`）三个底 |
| **R13** | 中 | 单击文件行后 Esc/↑↓ 失效 | ✅ **已修复** | `SearchPopup.jsx:211-212` 容器上 `tabIndex: -1` + `onKeyDown: onContainerKeyDown`；`:230` 输入框另有 `onInputKeyDown` |
| **R14** | 中 | 两入口共享 query/开关 | ✅ **已修复** | `SearchPopup.jsx:78/119/139` 引入 `seeded` 与 `live` 快照，状态**从当前生效值重新播种**，不再继承上一次入口的词与开关 |
| **R15** | 低 | 跳转丢掉列号 | ✅ **已修复** | `SearchPopup.jsx:153-155` `openHit(path, line, column)` → `store.openSearchResult(path, line, column)`；`:174/272/296` 命中列号一路带上（host 本来就传了：`search.js:178`） |
| **R16** | 中 | 无上游时推送按钮永久禁用 | ✅ **已修复** | `CommitPanel.jsx:181` `canPush = commit.pushing !== true && slice.isRepo !== false`（**不再依赖 `ahead > 0`**）；`ui.jsx:198-212` 新增**一键复制**按钮（toast 的 `action.copy`） |
| **R17** | 中 | `-uall` + 2 s 轮询无规模保护 | ✅ **已修复** | `src/host/git.js:152` `MAX_STATUS_ENTRIES = 20_000`；`:160/170/185-189` 扫描到上限即停并置 `truncated` |
| **R18** | 低 | 切换项目时旧语言服务器不停 | ✅ **已修复** | `lsp-session.js:770` 切项目时 `shutdownHostLsp(previousRoot)`；`:779` 关闭功能时同样 |
| **R19** | 中 | 新增测试保真度缺口 | ✅ **已修复** | `tests/search-popup.test.mjs` **+608 行**、`tests/render.test.mjs` **新增 29 行**（真实渲染断言）、`tests/styles-theme.test.mjs` **+283 行**（三底对比度）——从源码正则升级为行为级 |
| **R20** | 说明 | `requestFile` 超大文本无上限 | ✅ **已修复** | `src/host/workspace.js:28` 新增 `MAX_TEXT_BYTES = 2 << 20`（2 MB） |

**复核方式**：R1/R3 用探针实测；R2/R5/R6/R7/R8/R9/R10/R13/R14/R15/R16/R17/R18/R20 逐条读码核对锚点；R12/R19 核对测试内容。**20/20 全部落地。**

### 3.1 值得肯定的一处架构改进

新增的 `src/host/settings-defaults.js` 把 `lsp` 段的默认值抽成了**单一事实来源**：

```js
// src/host/settings-defaults.js:1-12
/** ... The module is deliberately free of any import: the host reads it, and the
 * client reads it too. ... a copy of the numbers in the client would drift away
 * from the document the host writes.
 * `src/host/settings-store.js` builds its `DEFAULT_SETTINGS.lsp` from this
 * object, so the two can never disagree. */
export const DEFAULT_LSP_SETTINGS = { … }
```

客户端的「重置」按钮现在直接 import 它（`SettingsPanel.jsx:9`）——**这从结构上消灭了「客户端和宿主各写一份默认值」这类漂移**，也顺带解决了 R10。

---

## 4. 本轮新发现

### S1 ［高］stdin 没有 `'error'` 监听器 → EPIPE 打死整个 DSH 宿主

**详见 §1。** 这是本轮的**头号问题**，且是用户报的那个致命崩溃的**确切根因**。

**修复方向**（最小止血一行）：

```js
// src/host/lsp.js:1529 之前
if (handle.stdin) handle.stdin.on('error', () => {})
```

**根治**见 §1.5 的 5 条。

---

### S2 ［中］`#spawn` 从不停止旧 worker —— 线程泄漏 + 跨代帧污染

```js
// src/host/lsp.js:1443-1459
async #spawn(entry, session, resolution) {
  const previous = session.handle
  session.generation += 1
  const generation = session.generation
  if (previous !== null && previous !== undefined) {
    session.intentionalExit = true
    try { previous.terminate() } catch { }
    session.handle = null
  }
  const worker = this.#createWorker({ … })     // ← 新 worker
  session.worker = worker                       // ← 旧 worker 的引用被覆盖，**从未 terminate**
  worker.on?.('message', (message) => { this.#onWorkerMessage(entry, session, message) })
```

**两个问题**：

1. **旧 worker 线程泄漏**：全仓 `#stopWorker(session)` 只出现在 `:1479`、`:1483`、`:1562`、`:2150`——**`#spawn` 的成功路径里一次都没有**。旧 worker 仍然活着，仍然持有 `parentPort`。
2. **跨代帧污染**：旧 worker 后续 postMessage 的 `{type:'stdin'}` 帧会被同一个 `#onWorkerMessage` 处理器接收（因为 handler 闭包捕获的是 `session` 对象，而不是 generation）→ **写进新进程的 stdin**。新服务器会收到上一个进程时代的 `didChange`（version 还是旧的）→ 协议违规。

**修复方向**：`previous.terminate()` 之前先 `this.#stopWorker(session)`；并配合 S3 的 generation fence 双保险。

---

### S3 ［中］worker 消息回调没有 generation fence（stdout 有、worker 没有）

**同一个文件里两套标准**：

```js
// :1528  stdout 路径 —— 有 fence
const current = () => session.generation === generation
if (handle.stdout) {
  handle.stdout.on('data', (chunk) => { if (!current()) return; … })
  handle.stdout.on('end',   () => { if (!current() || session.exited) return; … })
}
Promise.resolve(handle.done ?? null).then((outcome) => { if (!current()) return; … })
```

```js
// :1459  worker 路径 —— 没有 fence
worker.on?.('message', (message) => { this.#onWorkerMessage(entry, session, message) })
```

`session.generation` 这个机制**本来就是为这个场景设计的**（注释 `:1525-1527` 写得很清楚：「a process that was replaced must not feed the new worker and must not report its death into the new session」），只是**没有覆盖 worker 这一条路径**。

**修复方向**：`worker.on('message')` 里加 `if (session.generation !== generation) return`。
**这一条同时是 S1 的根治项之一**——旧代帧不会再去写任何管道。

---

### S4 ［中］`#onCrash` 不清 `session.handle`

```js
// src/host/lsp.js:2011-2015
this.#transition(session, 'crashed', reason)
this.#teardownSession(session)     // ← 清定时器、停 worker，但**不动 handle**
```

`#teardownSession`（`:2138-2151`）只清定时器和停 worker。**`session.handle` 仍指向那个刚死的进程**，直到 `:2047` 的重启定时器（默认 `restartBackoffMs` = 2 s）触发、`#restart` → `#spawn` 才把它换掉。

**这 2 秒窗口内**，任何在途的 stdin 帧 → 写进死管道 → EPIPE → **宿主死亡**（在 S1 修好之前）。

**修复方向**：`#onCrash` 里补 `session.handle = null`；`#terminateAndWait` 里在 `handle.terminate()` **之前**置空。

---

### S5 ［中］`building` 阶段仍统计真请求超时

**详见 §2.2。** 这是用户「Request timed out 依旧比较频发」在大项目上的**剩余成因**。

---

### S6 ［中］客户端 30 s 超时与大项目固有冲突

**详见 §2.3。**

---

### S7 ［中］R3 的新语义没写进提示文案 →「看着还是像 2048」复发

**这是用户原始反馈的一个新解释，值得单独说。**

R3 修好后，全局上限的语义变成了（`src/host/lsp.js:1258-1274` 注释原文）：

> *"The global limit is a **CAP** over every language server - that is what the setting says - and the per-language override replaces it for that language (so one language may be given more than the global limit)."*

**探针实测**：

| 设置 | 实际会话上限 | 说明 |
|---|---|---|
| 全局 2048 | **2048 MB** | ✅ |
| 全局 4096 | **2048 MB** | ⚠️ TypeScript 的内置值是 2048，**全局调高对它无效** |
| 全局 512 | **512 MB** | ✅ 调低有效 |
| 全局 128 | **128 MB** | ✅ 调低有效 |
| 全局 2048 + `servers.typescript.memoryLimitMB = 4096` | **4096 MB** | ✅ 按语言覆盖可突破全局上限 |

**问题**：设置页**只有全局这一个输入框**，**没有按语言的输入框**（`SettingsPanel.jsx:616-630` 每个语言只有一个开关）。所以用户**只能调低、不能调高**某个具体语言。

**而提示文案没跟上**（`src/client/i18n.js:654-655`）：

```
'settings.lspMemoryLimit': '语言服务器内存上限 (MB)',
'settings.lspMemoryLimitHint': '这是语言服务器的内存上限，不是启动门槛。不支持上限的服务器会在状态栏注明',
```

英文版（`:60-61`）同样。**文案完全没提「全局值是所有语言的上限」**。

⇒ **用户把 2048 改成 4096，看到的还是 2048，会认为「根本没修好」**——**这正是上一轮「看着还是像要 2048」的同一个症状，只是换了一个成因**。

**修复方向**（两条都该做）：

1. **话术**：`lspMemoryLimitHint` 改成「这是**所有**语言服务器的上限；调低它会让每个语言都用更小的上限，**调高它不能突破某个语言自身的上限**」；
2. **能力**：在按语言的列表里给每个语言补一个「上限」输入框（`servers[lang].memoryLimitMB` **后端早就支持了**：`lsp.js:1266-1268`），否则用户没有合法途径调高某个语言。

---

### S8 ［低］`didOpen` 对工作区外的文件不设防

**详见 §2.4 ①。**

`src/client/lsp-workspace.js:302-323` 的 `openFile()` 对任何被编辑器打开的文件都 `client.didOpen(file)`，**没有 `insideRoot` 检查**（而同一文件的 `requestFile()` 在 `:354` 是有的）。

⇒ 服务器拒绝 → `console.error('Unexpected resource …')` → 插件的 `reportError` 重定向把它变成**错误 toast**（`lsp-session.js:127-140`）→ 用户每打开一个工作区外的文件就吃一个假错误。

**修复方向**：`openFile()` 里对工作区外的 URI 走「不发给服务器」的路子（`lsp.outsideProject` 的文案已经存在：`i18n.js:1183`），并把服务器的这类 `console.error` 降级为不弹 toast。

---

### S9 ［低］宿主没有任何 `uncaughtException` / `unhandledRejection` 兜底

`grep 'uncaughtException|unhandledRejection' src/` → **无匹配**。

这意味着**插件里任何一条未捕获的异常都会杀死整个 DSH 宿主**。S1 只是最容易被触发的那一条。

**修复方向**：在插件的 host 入口（`src/index.js`）加：

```js
process.on('uncaughtException', (error) => {
  ctx.logger?.error?.('dsh-ide-workbench: uncaught exception: %s', error?.stack ?? String(error))
  // 不要 rethrow：宿主进程必须活着
})
```

并把「语言服务器相关的错误」**定向**到 `#onCrash`（走已有的降级路径：重启一次 → 保守版），而不是让整个 IDE 崩掉。

> 这一条**不是**「掩盖问题」——是把「一个子进程的 I/O 故障」和「整个 IDE 死亡」之间的耦合断开。**对一个插件来说，后者是不可接受的**。

---

## 5. 修复建议与顺序

| 优先级 | 条目 | 理由 |
|---|---|---|
| **P0** | **S1**（stdin 挂 `'error'`） | **一行改动**，直接消灭致命崩溃；已实证有效 |
| **P0** | **S9**（宿主 `uncaughtException` 兜底） | 把「插件异常」与「IDE 死亡」解耦——这是**结构性**的止血，避免下一个同类问题再次致命 |
| **P0** | **S3**（generation fence）+ **S2**（停旧 worker）+ **S4**（清 handle） | 三条一起做，根治 S1 的竞态，并消除跨代帧污染与线程泄漏 |
| **P1** | **S7**（R3 的话术 + 按语言上限输入框） | 直接对应用户原始反馈「看着还是像 2048」——**不修的话，用户会认为上轮的修复没生效** |
| **P1** | **S5**（building 阶段不计数）+ **S6**（首次语义请求的长预算） | 大项目上「Request timed out 频发」与「被杀→重建」循环的剩余成因 |
| **P2** | S8（工作区外文件不报错） | 消除 renderer 噪声与假错误 toast |
| **P2** | 崩溃报告把 plugin 噪声折叠 | 真凶（EPIPE）在 host 段，却被几百行 renderer 噪声淹没 |

### 需要补的回归测试

| 缺失覆盖 | 建议测试 |
|---|---|
| **写死进程的 stdin 不能打死宿主** | `tests/lsp-fixtures.mjs` 的 `makeFakeHandle` 加 `failStdin` 选项（stdin 异步 `'error'`）；`tests/lsp-recovery.test.mjs` 加「writing to a dead server's stdin does not kill the host」（该文件已有 `watchHost()` 辅助） |
| **旧代帧不进新服务器** | `tests/lsp-recovery.test.mjs`：重启一次后，让旧 worker 发 `{type:'stdin'}` → 断言新 handle 的 stdin **没有**收到这帧 |
| **通知不计入超时**（防止 R1 回归） | `tests/lsp-health-status.test.mjs`：只发 `didChange` 通知后静默 > timeout → `timeouts` 仍为 0、`terminated === false`（上一轮补过，保留） |
| **building 阶段不计超时** | 同文件：把会话置于 `building`，发真请求后静默 > timeout → 断言**不**被杀 |
| **全局内存上限真的进到 worker** | `tests/lsp-memory-policy.test.mjs`：断言**注入 worker 的 ceiling**（不是「设置值被读到」） |
| **崩溃提示按原因分派** | 断言超时崩溃 → `lsp.crashedTimeout`；内存崩溃 → `lsp.crashedMemory`（上轮已补，保留） |

---

## 附录：本次检视的复现命令

```powershell
# 1. 全量测试（实测 669/669 通过，0 失败，约 22.4s）
cd D:\Code\Node\DSH-IDE-TOOLWINDOWS-ROOT\dsh-ide-workbench
npm test

# 2. 探针（全部在仓库外，只读）
cd $env:LOCALAPPDATA\Temp\iwb-probe

node probe-e2e.mjs      # 致命崩溃端到端复现：生产 LspManager -> EPIPE -> uncaught
                         #   栈与用户崩溃日志逐帧一致（lsp.js:1661:13 / 1624:26 / 1459:64）
node probe-epipe4.mjs   # 机制：write() 不抛错，错误异步到达 -> try/catch 抓不到
node probe-r1b.mjs      # R1 修复实证：通知 timeouts=0 不被杀；真请求 timeouts=3 被杀重启
node probe-r3.mjs       # R3 修复实证：全局 2048/512/128 -> 会话上限同步；4096 对 TS 无效（设计如此）
node probe-migration.mjs   # 设置迁移
node probe-ceiling.mjs     # 内存上限管线
node contrast.mjs          # 语法色板对比度
```

**探针说明**：均以 `file:///D:/Code/Node/DSH-IDE-TOOLWINDOWS-ROOT/dsh-ide-workbench/src/host/lsp.js` 直接 import **生产代码**，复用 `tests/lsp-fixtures.mjs` 的 `makeManager`，不修改仓库任何文件。

> ⚠️ `src/host/lsp.js:276` 的 `ROOTS` 是**进程全局**的（注释原文：*"The map is process-global on purpose"*）→ **每个探针必须使用独立的 root**，否则会读到上一个 manager 的 session。

### 崩溃日志的位置

```
C:\Users\X-L-S\AppData\Roaming\@deepseek-ai\dsh-desktop\logs\crash-2026-10-31T15-12-19-723Z-host.log
```

关键段：`--- error ---`（`dsh: fatal uncaught exception: Error: write EPIPE`，栈见 §1.4 对照表）。
`--- renderer console (error level, oldest first) ---` 段是长期累积的 renderer 噪声（见 §2.4）。

---

## 附录二：与前几轮检视的关系

| 前几轮 | 本轮关系 | 说明 |
|---|---|---|
| **R1**（上一轮，高） | ✅ 已修复 | 结构性修复（协议层区分请求与通知）。**残留**：大项目 `building` 阶段仍计数（S5）、30 s 默认值与大项目冲突（S6） |
| **R2**（上一轮，高） | ✅ 已修复 | UI 夹取 + 握手重试，「刷新页面才能恢复」的问题消失 |
| **R3**（上一轮，中） | ✅ 已修复 | 但**新语义未写进话术**（S7），症状复发 |
| **R4–R10**（上一轮，中/低） | ✅ 全部已修复 | 详见 §3 |
| **R12–R20**（上一轮，中/低） | ✅ 全部已修复 | 详见 §3 |
| **N2**（第五轮，高） | 已被 R1 彻底取代 | 计数语义已从「静默」改为「未应答的请求」，本轮实证 |
| **M1 / M2 / M3**（第四、五轮） | 不重复 | 与本轮条目无关 |
| **D1–D9**（首轮） | 不重复 | 与本轮条目无关 |

**结论**：上一轮 20 条全部落地，本轮**新发现的 9 条里，唯一的高危（S1）是一个此前完全没人注意到的空白**——`handle.stdout` 和 `handle.stderr` 都挂了 `'error'` 监听，唯独 `handle.stdin` 没有。

> **这一条的教训值得写进交接文档**：给流挂 `'error'` 监听时要**成组处理**（stdin/stdout/stderr 一起），只挂两个很容易漏掉第三个；而漏掉的那一个恰好是**写入方向**——也就是唯一会产生 `EPIPE` 的那个。
