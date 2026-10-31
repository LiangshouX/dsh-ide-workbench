# PRD-v5 代码检视报告（第二轮）修复记录

> **对应报告**：`docs/PRD-v5-代码检视报告-第二轮.md`（基线 `31dfbc7` → `bf4927e`）。
> **本文件**记录对报告 S1–S9 的**逐条复核**、**落地方式**与**实测数据**。
> 报告本身未改动；结论与报告冲突时，本文件说明分歧在哪里、为什么。

---

## 0. 总览

| 编号 | 严重度 | 报告结论 | 复核结论 | 处理 |
|---|---|---|---|---|
| **S1** | 高（致命） | `stdin` 没有 `'error'` 监听器 → EPIPE → uncaught exception → 整个 DSH 宿主死亡 | ✅ **成立**，机制与报告一致 | 已修（不止一行：见 §1） |
| **S2** | 中 | `#spawn` 从不停旧 worker → 线程泄漏 + 旧代帧写进新服务器 | ✅ 成立 | 已修 |
| **S3** | 中 | worker 的 `'message'` 回调没有 generation fence | ✅ 成立 | 已修 |
| **S4** | 中 | `#onCrash` 不清 `session.handle` | ✅ 成立 | 已修 |
| **S5** | 中 | `building` 阶段仍统计真请求超时 → 构建→被杀→重建循环 | ⚠️ **成立，但报告给的修法不解决问题** | 已修（判据换掉了，见 §3） |
| **S6** | 中 | 客户端 30 s 超时与大项目固有冲突 | ✅ 成立 | 已修（判据同上） |
| **S7** | 中 | R3 的新语义没写进提示文案 →「看着还是像 2048」复发 | ✅ 成立 | 已修（话术 + 按语言上限输入框） |
| **S8** | 低 | `didOpen` 对工作区外的文件不设防 → 假错误 toast | ✅ 成立 | 已修 |
| **S9** | 低 | 宿主没有任何 `uncaughtException` 兜底 | ✅ 成立，**但报告给的修法在 DSH 上不生效** | 已修（换了一种做法，见 §4） |

**结论**：9 条全部处理，其中 3 条（S5、S6、S9）**没有照搬报告的方案**——照搬会留下同样的症状或不产生效果。分歧逐条写在下面。

---

## 1. S1：一次 EPIPE 打死整个 DSH 宿主（致命）

### 1.1 复核：成立

`src/host/lsp.js` 给 `handle.stdout`（`:1538`）和 `handle.stderr`（`:1548`）都挂了 `'error'`，
**唯独 `handle.stdin` 没有**。而 `#writeToServer` 的 `try/catch` 包的是 `stdin.write(data)`：
`EPIPE` 是**异步**经由流的 `'error'` 事件抛出的（`write()` 早已返回），`catch` 抓不到。
流上没有监听器 → EventEmitter 抛出 → uncaught exception → 宿主进程死亡。

崩溃日志的三帧（`lsp.js:1661:13` / `:1624:26` / `:1459:64`）与 HEAD 的源码逐帧吻合，
触发路径（切换 Project / 选择构建 → `#writeDidClose` 交帧给 worker 的同时 `terminate()` 进程）
与报告描述一致。

### 1.2 修法：不只一行

报告给的是「挂一个空的 `'error'` 监听器」。那一行能止住崩溃，但**留下产生它的竞态**：
帧在飞、管道已断。真正要修的是**让在途帧永远写不进死管道**。四条一起做：

| 改动 | 位置 | 作用 |
|---|---|---|
| `handle.stdin` 挂 `'error'` 监听器 | `#spawn` | 断管变成一条日志，不再是进程死亡 |
| worker 的 `'message'` 回调加 **generation fence** | `#spawn` | 旧代的帧不再进新会话 |
| `#spawn` 先停旧 worker 再杀旧进程 | `#spawn` | 旧 worker 不再往新服务器的 stdin 写帧 |
| `terminate()` **之前**置空 `session.handle`；`#onCrash` 也置空 | `#terminateAndWait` / `#onCrash` | 在途帧变成 no-op，而不是写进断管 |

### 1.3 测试替身本身是盲区

669 个测试没抓到这条，不是因为没测这条路径，而是因为**替身不可能出错**：
`makeFakeHandle` 的 `stdin` 是一个内存 `Writable`，`write()` 的回调**永远成功**。
整条 `#writeToServer` 路径在测试里被完整走了一遍——只是永远不会出事。

新增 `failStdin` 选项：写入**异步**在该流上 `'error'`（这正是崩溃所需的形态；
同步抛错会被现有的 `try/catch` 吃掉，证明不了任何事）。

---

## 2. S2 / S3 / S4：跨代与跨进程的时序假设

这三条是同一类缺陷：**代码假设了时序，却没有把假设表达出来**。

- **S2**：`#spawn` 只 `terminate()` 了旧**进程**，没停旧 **worker 线程**。旧 worker 继续
  `postMessage({type:'stdin'})`，而 `#onWorkerMessage` 的闭包捕获的是 `session` 而不是
  generation → 旧代帧写进**新**服务器的 stdin（协议违规：新服务器收到 version 过期的 `didChange`）。
- **S3**：同一个文件里两套标准——stdout 路径有 `current()` fence（`session.generation === generation`），
  worker 路径没有。`session.generation` 本来就是为这个场景设计的，注释也写着，只是没覆盖 worker。
- **S4**：`#onCrash` 走 `#teardownSession`（清定时器、停 worker），**不动 `session.handle`**。
  重启退避窗口（默认 2 s）内 `session.handle` 仍指向死进程 → 在途帧写进死管道。

---

## 3. S5 / S6：判据从「会话状态」换成「第一个真实应答」

### 3.1 报告的修法不解决问题

报告建议：「`building` 阶段不计入超时」。**这条按字面实现是无效的**：

`#scheduleReady`（PRD §3.1 的就绪启发式）在服务器**第一次输出**后约 10 ms 就把会话
从 `building` 切到 `ready`。而**真正漫长的 program 构建发生在第一个语义请求上**，
此时会话早就是 `ready` 了。于是：

```
服务器启动 → initialize 回答 → 10 ms 后 ready
用户 Ctrl+点击 → 第一个语义请求 → tsserver 建 program（> 10 分钟）
                                      ↑ 这时状态是 ready，30 s 预算照旧生效
```

按状态判断的预算**永远碰不到那个真正花十分钟的请求**。

### 3.2 真正的判据

> 一个请求在**服务器还没回答过任何一个非握手请求**之前，只有超过
> `BUILD_REQUEST_TIMEOUT_MS`（10 分钟）才算超时；一旦服务器回答过一个真实请求，
> 就回到配置的 `lsp.requestTimeoutMs`。

为什么排除握手：`initialize` 是毫秒级回答的，第一个语义请求才是等待 program 构建的那个。
客户端除握手外只发语义请求（库的 `initialize` 走 `requestInner`，其余走 `request`，
全是 `textDocument/*`），所以「第一个被回答的语义请求」与「第一个被回答的非握手请求」
是**同一个时刻**——客户端与宿主两侧因此一致。

### 3.3 两端各改了什么

| 侧 | 改动 |
|---|---|
| 宿主 | worker 上报请求时多带一个 `handshake` 标记（worker 是唯一有资格解析载荷的线程）；宿主据此统计「真实应答数」；看门狗的预算随之切换 |
| 客户端 | 客户端记录「已被回答的语义请求数」；`client.timeout`（库在**创建请求时**读取它）随之在 10 分钟与配置值之间切换 |

新增的共享常量在 `src/host/settings-defaults.js`：`BUILD_REQUEST_TIMEOUT_MS = 600000`。
它是**事实**（语言服务器要建整个项目的 program），不是用户偏好，所以不是设置项。

### 3.4 被推翻的一条既有测试

`tests/lsp-review-fixes.test.mjs` 的「three unanswered requests kill the language server」
原本在会话**从未回答过任何请求**的状态下就期待超时被计数——那正是新判据下不该计数的情形。
测试的**意图**（「一台已经就绪、随后不答话的服务器会被杀掉」）是对的，
所以改成：先让服务器回答一个真实请求，再让它沉默。**断言一字未动**。

---

## 4. S9：报告给的修法在 DSH 上不生效

报告建议在插件入口加：

```js
process.on('uncaughtException', (error) => { ctx.logger?.error?.(...) })
```

**在 DSH 上这只日志不救场。** 宿主自己装了一个 fail-loud 处理器
（`installFailLoud`）：uncaught exception → 写诊断 → `process.exit(1)`。
Node 的 `emit` 会**先复制**监听器数组再逐个调用，所以「在监听器里把别人的监听器摘掉」
**拦不住**同一次 `emit` 里宿主处理器的执行——宿主照样 `exit(1)`。

而且即使把 `process.exit` 临时改成空函数，宿主的 `report()` 里那个 `exiting` 闩锁
已经被置位，宿主此后的**真正致命错误**也只会写日志、不再退出——
等于把宿主的安全网整个拆了。

### 4.1 实际做法：插件**接管**这个事件

```js
// 接管时记住宿主原有的处理器；不属于插件的错误，原样交还给它们
const inherited = process.listeners('uncaughtException')
process.removeAllListeners('uncaughtException')
process.on('uncaughtException', (error) => {
  if (isPluginFault(error)) { /* 报告、降级、放过 */ return }
  for (const listener of inherited) listener(error)   // 宿主的 fail-loud 语义完全不变
})
```

- **归属判据是精确的**：错误的栈（连同 `cause` 链）里出现插件自己的源码目录才算插件的错。
  宿主的失败仍然是宿主的失败，`exiting` 闩锁也**不会被插件消耗**。
- 插件卸载时把原样的监听器还回去。

### 4.2 更靠底的一层：消灭「没有监听器的事件」

进程级的兜底是最后一道防线。真正该修的是**插件自己制造的那些没有监听器的事件**——
它们才是致命的来源。已补：

| 位置 | 缺口 |
|---|---|
| `src/host/lsp.js` | `handle.stdin` 的 `'error'`（S1）、worker 的 `'messageerror'` |
| `src/index.js` | `WebSocketServer` 与终端 `ws` **完全没有** `'error'` 监听器 |

后两个是实打实的「一个插件事件带走整个 IDE」：终端 socket 出错 → uncaught exception → 宿主死亡。
现在由 `guardEmitter()` 统一兜住。

---

## 5. S7：「看着还是像 2048」的真正解释

R3 修好后，全局 `lsp.memoryLimitMB` 的语义变成了「**所有**语言服务器的上限」，
而按语言的 `lsp.servers[lang].memoryLimitMB` 会**替换**它。实测：

| 设置 | 实际会话上限 |
|---|---|
| 全局 2048 | 2048 MB |
| 全局 4096 | **2048 MB** ← TypeScript 自身的内置值就是 2048，调高全局对它无效 |
| 全局 512 / 128 | 512 / 128 MB（调低有效） |
| 全局 2048 + `servers.typescript.memoryLimitMB = 4096` | 4096 MB |

设置页**只有全局那一个输入框**，用户既调不高某个语言，也看不到这层关系。
两处都补了：提示文案说明「这是所有语言的上限，调高它不能突破某个语言自身的上限」，
并给每个语言补一个**上限输入框**（后端早就支持这个键）。

---

## 6. S8：工作区外的文件不再产生假错误

`openFile()` 对编辑器打开的**任何**文件都发 `didOpen`，服务器不认识这个文档就
`console.error('Unexpected resource …')`，插件的 `reportError` 重定向又把它变成**错误 toast**。
现在 `openFile` 对工作区外的 URI 不发 `didOpen`（文件本身仍在本地跟踪，编辑器不受影响），
并且服务器关于「文档不在工程里」这类抱怨只记日志、不弹 toast。

---

## 7. 验收数据

| 项 | 结果 |
|---|---|
| 自动化测试 | **698 项 / 698 通过 / 0 失败**（基线 669 + 本轮新增 29），**连续 3 轮全绿** |
| 客户端构建 | `npm run build` 成功，`dist/client.js` **2,868,958 字节（2,799.7 KiB）** |
| 客户端体积增量 | **+6,862 字节（+6.7 KB）**（预算 ≤ 150 KB ✅） |
| i18n | `en` 与 `zh-CN` 各 **573 个 key**，无缺失、无空值 |
| 新增源码 | `src/host/guard.js`（错误边界的共享助手） |
| 新增测试 | 5 个文件、29 个用例 |

### 7.1 本轮新增的回归用例

| 用例 | 守住的性质 |
|---|---|
| `writing to a dead server's stdin does not kill the host` | **S1**：写进死管道不会产生未捕获异常 |
| `a frame that arrives after the server was stopped is not written into the dead pipe` | **S4**：在途帧不写进断管 |
| `the frames of the worker of the previous generation do not reach the new server` | **S2/S3**：旧代帧不进新会话，旧 worker 被停掉 |
| `the first request of a session is patient, the next ones are not` | **S5**：没建完 program 的服务器不会被杀，回答过一次之后恢复严格 |
| `the request the server answered with an error counts as an answer` | **S5/S6**：客户端与宿主的判据一致 |
| `the deadline of the client does not count as an answer` | **S5/S6**：客户端自己的超时**不算**回答（否则宿主会杀掉它还在等的服务器） |
| `the settings page renders a memory ceiling for every language` 等 6 条 | **S7**：按语言上限的渲染、回填、写入、清空 |
| `a file outside the project is NOT announced` 等 4 条 | **S8**：工作区外的文件不进服务器 |
| `a complaint about a document outside the project produces no toast` 等 3 条 | **S8**：假错误不再弹 toast |
| `a fault of the plugin does not take the host down` 等 4 条 | **S9**：插件的错被拦下，别人的错仍然交给宿主 |

### 7.2 为什么 669 个测试没有抓到那条致命崩溃

**测试替身结构上不可能产生 EPIPE**：

```js
// 改之前：tests/lsp-fixtures.mjs
const stdin = new Writable({
  write(chunk, encoding, callback) {
    stdinChunks.push(Buffer.from(chunk))
    callback()          // ← 永远不会失败
  }
})
```

这是一个纯内存 `Writable`：不会断、不会报错。整条 `#writeToServer` 路径在测试里
被完整走了一遍——**只是永远不会出事**。

现在 `makeFakeHandle({ failStdin: true })` 的 stdin 是一根**断管**：`write()` 正常
返回，流在**稍后的一个事件循环轮次**里发出 `'error'`（EPIPE）。这正是崩溃所需的
形态——同步抛错会被现有的 `try/catch` 吃掉，证明不了任何事。

### 7.3 端到端复现的独立验证

报告用生产代码复现了崩溃（栈与用户日志逐帧吻合）。本轮用**同样的生产代码**
（`LspManager`，断管的 stdin）再走一遍，并且**同时跑一遍「拆掉修复」的对照组**
——否则「没崩」也可能是探针本身看不见这个缺陷：

```
AS THE PLUGIN IS  {"stdinErrorListeners":1,"uncaught":0,"firstUncaught":null,"warned":1}
WITHOUT THE FIX  {"stdinErrorListeners":1,"uncaught":1,"firstUncaught":"EPIPE write EPIPE","warned":1}
```

| | 未捕获异常 | stdin 的 `'error'` 监听器 |
|---|---|---|
| **修复后** | **0** | 1（错误被记成一条警告） |
| 拆掉修复（对照组） | **1 —— `EPIPE write EPIPE`** | 0 |

对照组的异常正是用户崩溃日志里的那一条。

---

## 8. 与报告不一致的三处

| 报告的说法 | 复核的结论 |
|---|---|
| S5：「`building` 阶段不计入超时」 | 判据不对。`building` 只持续到服务器第一次输出，真正的 program 构建发生在 `ready` 之后。按状态判断的预算碰不到那个请求。 |
| S6：「区分首次语义请求与增量请求」 | 方向正确，但报告给的两个选项（改默认值 / 单独一档预算）都只是**调大同一个数**，没有区分**首次**与**增量**。判据应是「服务器还没回答过任何非握手请求」。 |
| S9：「在插件入口加 `process.on('uncaughtException')`」 | 在 DSH 上不生效：宿主的 fail-loud 处理器会先一步 `process.exit(1)`，而 Node 的 `emit` 复制监听器数组，插件摘不掉它。必须**接管**事件并把非插件的错误**交还**给宿主。 |
