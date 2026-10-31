# PRD-v5 代码检视报告

> **范围**：`4b2b7dc077939654365d58aaeef166cdd8b41e2b` → `162bf6d0db5adfcc9a9c0eabd639ecf610a9df95`（11 个提交，含 D1–D9 的修复）。
> **基线**：`dd6dc175f8cf1b6a891cc37f81ac21a3d81839a4`。**对照物**：`docs/PRD-v5.md`（规格）、`docs/PRD-v5-实施进展.md`（落地与偏差）、`docs/PRD-v5-缺陷跟踪.md`（实机缺陷）。
> **方法**：读代码 + 实跑验证（`npm test`、`npm run build`、开发方自带的 `docs/bench/*.mjs`、以及本次自建的探针）。**本次检视未修改任何源码**。
> **检视日期**：2026-10-31。**第二轮交叉复核**：同日，另一位复核者独立回查「缺陷跟踪文档 ↔ 代码 ↔ 实机日志」，结论与第一轮**一致**，新增 **N10–N13**（均为文档级问题，见 §3.3）；两轮均未修改任何源码文件。
> **第三轮（复核 + 修复）**：同日，**本文档的结论被逐条独立复现并全部修复**，见 **§6**。§1–§5 保留检视当时的原文（行号以当时为准），§6 记录复核结论、订正与修复状态。
> **第四轮（修复后的独立复核）**：同日，复核 §6 的修复，13/13 成立，新增 **M1 / M2**，见 **§7**。
> **第五轮（M1 / M2 的复核与修复）**：同日，M1 / M2 全部成立并修复，修复过程中另发现 **M3**（取消时残留进程），见 **§8**。

---

## 0. 结论

| 维度 | 结论 |
|---|---|
| D1–D9 的修复质量 | **高**。9 项全部有实质修复，其中 D1/D2/D5 是结构性修复，不是打补丁 |
| 缺陷跟踪文档的准确性 | **基本准确**，但 1 处对实现的描述与代码不符（§2.3「只转发第一次 initialize」）、1 处验证脚本无法失败（`repro-order.mjs`） |
| 修复引入的新问题 | **1 项高**（握手重放时序）、**1 项中**（重复 initialize 仍被转发） |
| 上轮遗留、本轮未修 | **2 项高/中**（超时计数语义、宿主定时器泄漏）——缺陷跟踪文档未收录 |
| 测试有效性 | 523/523 全绿，但**握手交付路径的断言在错误的层**，该路径失守不会被发现 |
| **第二轮交叉复核** | **独立复跑 `npm test` = 523/523/0**；D1–D9 的根因描述逐条回查**与代码一致**，第一轮结论全部成立；**新增 4 项文档级问题（N10–N13）**，其中 2 项会让接手者做错事（验证指针指错、交接清单漏项） |
| **第三轮（复核 + 修复）** | **N1–N13 全部复现成立**，并已全部修复；复核中订正了 3 处细节（N1 的实际影响面比报告写的更大、N2 的实测次数是 4 不是 3、N5 是彻底复现 D2）；新增 **20 个回归用例**（`tests/lsp-review-fixes.test.mjs` 16 例 + `tests/lsp-recovery.test.mjs` 4 例），并**逐条验证过保真度**：把修复回退，用例必须失败 |

**总体判断**：这一轮修复的工程质量明显高于首版实现，值得肯定。**剩余 13 项问题中，没有一项是致命或阻断性的**；最需要优先处理的是 N1（测试保真度 + 时序脆弱）和 N2（会在大型项目上常态化误杀语言服务器）。N10–N13 是文档级问题，改起来只要几分钟，但**建议先改 N10/N11 再交班**——否则接手者会带着错误的验证指针和漏项的清单上手。

> ✅ **2026-10-31 更新**：上述 N1–N13 **已全部修复**（含 N10–N13 的文档修正），修复记录与验证见 **§6**。

---

## 1. 已修复且经本次实测确认有效

| 缺陷 | 修复位置 | 本次验证方式 | 结论 |
|---|---|---|---|
| **D5** 插件不激活（`Invalid effect`） | `src/index.js:660-666` | 读码：effect 回调现在返回 `() => relay.close()`；`tests/plugin-mount.test.mjs` 4 例守着 | ✅ 有效 |
| **D8** 状态栏永远显示「正在更新索引…」 | `src/client/store.js:1458-1465`（非 building 时清空 `progress`/`startedAt`/`cancellable`）+ `src/client/Workbench.jsx:326-331`（`ready` 分支不再看 `progress`） | 读码 + `tests/lsp-status-progress.test.mjs`；两处都改了，单改任一处用例都会失败，设计正确 | ✅ 有效 |
| **D1** 宿主进程崩溃 | `src/host/lsp.js:1380-1394`（新增 `#safely`）、`:143`（`TRANSITIONS.starting` 补 `crashed`）、`:1097-1105`（代次守卫）、`:1647-1650`（重启后复核状态）、`src/host/lsp-ws.js:66-127`（upgrade 回调整体 try/catch） | **实跑 `node docs/bench/crash-recovery.mjs`**：`unhandled rejections: 0`、宿主存活、自动重启成功（servers started: 2） | ✅ 有效 |
| **D2** 握手被丢弃 | `src/host/lsp.js:818`（`entry.pending` 缓冲）、`:1125-1129`（重放）、`:1250`（`entry.handshake` 留存） | **自建探针**（真 worker + 真管理器）：暂存的握手确实到达服务器 stdin，顺序为 `initialize` → `didOpen` | ✅ 生产路径有效（但见 **N1**） |
| **D7** 重启后静默死亡 | `src/host/lsp.js:1155`（`session.exited = false`）+ 代次守卫 | 读码 + `tests/lsp-handshake.test.mjs:126`（崩溃后新进程重新拿到握手） | ✅ 有效 |
| **D4** 错误浮层盖住内容 | `src/client/lsp-session.js:286` + `redirectErrorsToToast()` | 读码：改 `LSPPlugin.prototype.reportError` → 走工作台 toast（9 秒自动消失） | ✅ 有效 |
| **D6** `perf-cold-workspace` 抖动 | `tests/perf-cold-workspace.test.mjs` 清 `store.restoredTimer` | **实跑 `npm test` → 523/523 全绿**，未复现 | ✅ 有效 |
| **D9** 悬停/补全看不清、Ctrl+悬浮无提示 | `src/client/styles.js` 改用库真实类名 `.cm-lsp-hover-tooltip`；`src/client/CodeEditor.jsx` 把补全配色移出 THEME（单一样式表）；新增 `ctrlHoverField` 装饰 | 读码 + `tests/ctrl-hover.test.mjs` 7 例（含「样式表必须用真实类名」这条防回归断言，设计到位） | ✅ 有效 |

> **D9 的排查质量值得肯定**：根因是「样式写的是 `.cm-lsp-hover`，库渲染的是 `.cm-lsp-hover-tooltip`」——这类只有真机渲染才能发现的问题，靠读 PRD 是看不出来的。

---

## 2. 本轮新发现的问题

### N1 ［高］握手重放的时序错误，且回归测试断言在错误的层

**位置**：`src/host/lsp.js:1112-1153`

`#spawn()` 的顺序是：

```
1112  worker = this.#createWorker(...)
1125  worker.postMessage(entry.handshake)      ← 握手
1129  this.#replayPending(entry, session)       ← 暂存的载荷
      ...                                      ← 此处才 spawn 进程
1153  session.handle = handle                   ← 句柄到这里才存在
```

重放发生在**进程被创建之前**、`session.handle` 被赋值之前。worker 回送 `{type:'stdin'}` 时，`#writeToServer()` 读到的 `session.handle` 仍是 `null`，帧被丢弃（`lsp.js:1187-1193` 的 `if (stdin === undefined || stdin === null) return`）。

**本次实测（只换 worker 实现，其他完全相同）**：

```
[假 worker（同步回送，测试用）]
   暂存的握手最终到达服务器 stdin : 否 ✗
   服务器已就绪后的普通载荷     : 是 ✓
[真 worker（异步回送，生产用）]
   暂存的握手最终到达服务器 stdin : 是 ✓
   服务器已就绪后的普通载荷     : 是 ✓
```

**生产当前是对的**，因为两个偶然性质同时成立：真 worker 的回送是异步的，且 `ctx.subprocess.spawn` 是同步的（`src/host/lsp.js:1148-1152` 的三元表达式没有 `await`）。任何一条变化都会让握手被静默丢弃，症状恰好是 D2（永远卡在「索引中」）。

**更值得注意的是测试保真度**：`tests/lsp-handshake.test.mjs` 全部断言在 `worker.posted`（*交给 worker 的东西*）这一层，**从不检查 `handle().stdinChunks`**（*真正写进服务器的东西*）。所以这条路径即使整条断掉，用例照样全绿 —— 而用 fixture 跑时它**确实是断的**。

**修复方向**（二选一，建议都做）：
1. 把 `worker.postMessage(entry.handshake)` 与 `#replayPending()` 移到 `session.handle = handle` **之后**，让顺序不再依赖 worker 的同步性；
2. `tests/lsp-handshake.test.mjs` 补一条 stdin 级断言（解码 `handle().stdinChunks`，断言其中有 `initialize`）。

> 顺带一提：缺陷跟踪文档 §10.5 已经警告过「`ctx.subprocess.spawn()` 是同步的，写假件时别写成 `async`」——同一类陷阱，这里踩的是另一个变体。

---

### N2 ［高］单个挂起请求即可击穿崩溃阈值，且报错文案与事实不符

**位置**：`src/host/lsp.js:1545`（看门狗间隔）、`:1557-1570`（`#checkTimeouts`）、`:1579`（计数自增）、`:1015`（计数初始化）

```js
1545  const interval = Math.min(1000, Math.max(25, Math.floor(timeout / 4)))
1546  const timer = setInterval(() => { this.#checkTimeouts(entry, session, timeout) }, interval)
...
1579  session.timeouts += 1
1580  if (session.timeouts < this.#timeoutLimit) return
1581  this.#safely(this.#onCrash(...), 'the crash handler')
```

两个独立缺陷叠在一起：

1. **按 tick 计数，不是按请求计数**。`#checkTimeouts` 在条件成立时每 tick（默认 1 秒）记一次超时，而超时后 `lastClientActivityAt` **不前进**，所以条件持续成立 → 一个挂起的请求在 ~2 秒内就凑满 3 次。
2. **计数器从不在成功响应后复位**。`session.timeouts` 只在 `lsp.js:1015` 初始化、`:1579` 自增，全仓库没有任何复位点 → 它是**累计值**，不是文档与注释所说的「连续（consecutive）」。

**本次实测**（`requestTimeoutMs: 40`，只发**一个**永不响应的请求）：

```
状态: degraded
detail: The language server exited unexpectedly (3 consecutive request timeouts)...
```

**为什么重要**：PRD §11.2 自己记录了「大型项目语义请求可超 10 分钟」。默认超时 30 秒 + 每秒一记 → **任何一次超过 30 秒的语义请求（大型项目上的 `textDocument/definition` / `references`）都会在约 32 秒后把语言服务器打死**，并向用户谎称「连续 3 次超时」。

**修复方向**：超时只在**收到新请求**时计一次（用请求 id 或时间戳去重），成功响应后把 `session.timeouts` 复位为 0；文案改为「N 次请求超时」而非「连续 N 次」。

---

### N3 ［中］取消 / 崩溃 / 空闲退出都泄漏宿主定时器

**位置**：`src/host/lsp.js:588`（`cancelIndex`）、`:1521`（`#exitIdle`）、`:1590`（`#onCrash`）

`#clearIdleTimer` / `#clearWatchdog` 的调用点只有两处：`#armIdleTimer`（`:1486`）、`#armWatchdog`（`:1541`）和 `#shutdownEntry`（`:1741-1742`）。**`cancelIndex`、`#exitIdle`、`#onCrash` 三条路径都不清**。

**本次实测**（插桩 `setInterval`/`setTimeout`，只统计管理器自己创建的）：

```
基线                      live = 0
start 之后               live = 2
cancelIndex 之后         live = 3      ← cancelIndex 没有清 idle/watchdog
再 3 轮 start/cancel 之后 live = 12     ← 每轮净增 3 个孤儿定时器
shutdown 之后            live = 12     ← shutdown 也救不回已被替换的会话
```

每泄漏一轮就多一个**永久空转的 1 秒看门狗 `setInterval`** 和一个 10 分钟空闲定时器。取消 10 次 → 宿主里常驻 10 个每秒醒一次的 interval。

**修复方向**：在这三条路径的收尾处补 `#clearIdleTimer(session)` + `#clearWatchdog(session)`；`#startSession` 新建会话时也应清理上一代会话的定时器。

---

### N4 ［中］重复 `initialize` 仍会被转发给服务器（协议违规），且文档与测试的描述与实现不符

**位置**：`src/host/lsp-worker.js:324-330`

```js
324  if (message.origin !== 'host' && handshake.noteForwarded(payload)) {
328    parentPort.postMessage({ type: 'handshake', text: payload })
329  }
330  parentPort.postMessage({ type: 'stdin', data: encodeFrame(payload) })   // ← 无条件
```

`noteForwarded()` 对重复握手返回 `false`，但那只是**记账**——第 330 行仍然把帧写进了服务器的 stdin。

**触发窗口**：服务器还没回答第一个 `initialize` 时，客户端又发来一个。浏览器断线重连会走 `disconnect() + connect()`（`src/client/lsp-session.js:323-331`），而首次构建期间（大型项目可达数分钟）服务器迟迟不回答，窗口是敞开的。

**本次实测（worker 层）**：

```
场景 1：服务器尚未回答时来了第二个 initialize
  写入服务器 stdin 的帧数 : 2      ← 重复握手被转发
场景 2：服务器已经回答过之后再来的 initialize
  服务器回答后新增的 stdin 帧数 : 0   ← 被缓存吸收 ✓
```

**实测影响（用真的 `typescript-language-server`）**：

```
id=1  result: capabilities(23)
id=2  result: capabilities(23)
收到 4 条响应，其中错误 0 条
服务器是否还活着: 是
```

即：**打包的 TS 服务器容忍重复握手**，两次都正常返回能力值，进程存活。所以对当前内置服务器**无实际损害**。但 LSP 规定一个进程只允许初始化一次，而 `java/go/rust/cpp` 走 PATH 探测（`jdt.ls`、`gopls`、`rust-analyzer` 对重复 `initialize` 的反应未知）。

**两处描述与实现不符**：
- 缺陷跟踪 §2.3：「`Handshake` 只转发**第一次** `initialize`」——在服务器尚未回答的窗口内不成立。
- `tests/lsp-handshake.test.mjs:187` 用例名「the worker forwards only the first initialize request」——它只断言了 `handshake.noteForwarded(second) === false` 这个**记账方法的返回值**，没有验证 worker 是否真的没转发。这条测试名与它实际断言的东西不匹配。

**修复方向**：`noteForwarded` 返回 `false` 时应 `return`，不再写 stdin；或把 worker 的转发决策从 `noteForwarded` 的返回值改为显式的「是否转发」判定。

---

### N5 ［中］`entry.pending` 的淘汰策略会丢掉握手，D2 可复现

**位置**：`src/host/lsp.js:818`

```js
818  if (entry.pending.length >= MAX_PENDING_PAYLOADS) entry.pending.shift()
```

超限时丢的是**最旧**的一条，而握手是最先到达的 → **握手最先被丢**。丢掉后 `entry.handshake` 仍为空（它只在 worker 回报后才被填上，`lsp.js:1250`），服务器永远收不到 `initialize` → **D2 原样复现**。

`tests/lsp-handshake.test.mjs:165` 明确断言了这个淘汰行为（「the oldest payloads are dropped」），也就是说该行为是被测试**锁定**的，而非疏漏。

**触发条件**：语言服务器启动前到达 64 条以上客户端载荷。窗口存在（浏览器先连 socket、后启动服务器），但需要用户在选项目前产生 64 条载荷。**可能性低，后果严重**。

**修复方向**：淘汰时保留握手（例如把 initialize 单独存进 `entry.handshake` 槽位，不放进 `pending` 队列；或淘汰时跳过 initialize）。

---

### N6 ［低］Windows 下 `liveStates()` 永不命中

**位置**：`src/host/workspace.js:77`（`samePath`）、`src/index.js:65`（`liveStateOf`）

```js
// workspace.js:77
export function samePath(left, right) {
  if (process.platform === 'win32') return left.toLowerCase() === right.toLowerCase()
```

`samePath` 只折叠大小写，**不归一分隔符**。而 `liveStates()` 的 key 来自 `rootKey()`（`src/host/lsp.js:213-217`），它把 `\` 换成 `/` 并转小写。两者在 Windows 上永远不相等。

**本次实测**：

```
rootKey(raw) = "d:/code/node/dsh-ide-toolwindows-root/dsh-ide-workbench"
raw          = "D:\\Code\\Node\\DSH-IDE-TOOLWINDOWS-ROOT\\dsh-ide-workbench"
samePath(key, raw) = false
```

**当前影响有限**：客户端只渲染 `indexState === 'indexed'` 的徽标（`src/client/Workbench.jsx:519`），那条路径走的是持久化的 `indexedRoots` 映射（两边都是反斜杠路径，比得上）。所以实时状态（`ready`/`building`/`failed`）目前**在任何平台都没有被渲染**——这条链路是死的，只是还没被用户看见。

**修复方向**：宿主侧统一复用客户端的归一化规则（`src/client/workspace-scope.js` 的 `normalizeScopePath` 已经做对了：分隔符 + 大小写一起处理），或让 `liveStates()` 直接返回 `rootKey` 归一后的路径、由调用方用同一套规则比较。

---

### N7 ［低］`settings.lsp.servers[lang].enabled` 有文档无实现

**位置**：`src/host/settings-store.js` 的 `lsp.servers` 注释声明 `{ enabled, command, args }`，但 `src/host/lsp.js:618-632`（`servers()`）与 `:987-994`（`#startSession()`）都只读 `command` / `args` / `memoryLimitMB`，**从不读 `enabled`**。

用户若手改设置文件把某个语言关掉，服务器照常启动。目前没有 UI 暴露这个键，所以影响限于手改配置。

**修复方向**：要么实现它，要么从注释里删掉。

---

### N8 ［低］`marked` 是冗余的 devDependency

**位置**：`package.json` 的 `devDependencies` 声明了 `marked@^15.0.12`，但全仓库**没有任何直接 import**（`src/client/**` 零命中）。它实际是 `@codemirror/lsp-client` 的传递依赖。

`docs/PRD-v5-实施进展.md:142` 把它写成「悬停 Markdown 渲染」——但渲染是库自己做的，插件只提供了 `sanitizeHTML`。

**修复方向**：删掉这个直接声明（npm 会自行提升传递依赖），或改成 `overrides` 固定版本。

---

### N9 ［低］两份文档的数字已过期 / 自相矛盾

| 位置 | 写的 | 实测 |
|---|---|---|
| `实施进展.md:13` | 493 项 / 493 通过 | **523 项 / 523 通过** |
| `实施进展.md:14,167` | `dist/client.js` 2,762,422 字节，+284 KB | **2,771,122 字节，+299,806 字节（+293 KB）**（仍 ≤ 400 KB 预算 ✅） |
| `缺陷跟踪.md:25` | 523 项 | ✅ 一致 |
| `缺陷跟踪.md:350` | 「跑全量：`npm test`（512 项）」 | 与同文件 §0 的 523 自相矛盾 |

`实施进展.md` 在 D4–D9 修复后没有回填。`dist/client.js` 的增长是 D9 的样式与 Ctrl+悬浮装饰带来的。

---

### N10 ［中］缺陷跟踪 §0 的「验证方式」列指错了地方（D1、D7 两处）

> 本条起至 N13 来自**第二轮交叉复核**（见 §3.3）。

**位置**：`docs/PRD-v5-缺陷跟踪.md:15`、`:21`（§0 表格的「验证方式」列）

第一轮已指出 D1 的崩溃路径缺自动化用例（见 §3.2），但没有注意到**缺陷跟踪 §0 的表格把 `tests/lsp-recovery.test.mjs` 列为 D1 的验证手段**——与同一文件 §1.5「目前只有 `docs/bench/` 里的脚本，没有进 `tests/`」直接矛盾。

| 缺陷 | §0 表格写的 | 实际 |
|---|---|---|
| D1 | `docs/bench/crash-recovery.mjs` + `tests/lsp-recovery.test.mjs` | 该文件 7 个用例全是「重启 / degraded 状态迁移」，**没有一条断言「宿主不死 / 无未处理 rejection」**；能验证 D1 的仍只有 bench 脚本 |
| D7 | `tests/lsp-handshake.test.mjs` 第 4 例 | 第 4 例实为 *a payload of a running language server is not buffered*，与 D7 无关；D7 的实际修复是 `session.exited = false`（`src/host/lsp.js:1158`），而**全 `tests/` 目录搜 `exited` 零命中 → 没有任何用例守护它** |

**为什么重要**：D7 是「服务器重启后**悄悄**死掉、宿主还以为它在跑」——一个不崩溃、只是失效的路径，比 D1 难发现得多。它没有回归测试，文档又给它指向了一个不相干的用例，接手者会以为它已被守住。

> 本报告 §1 表格中 D7 行引用了 `tests/lsp-handshake.test.mjs:126`（崩溃后新进程重新拿到握手）——那条用例守的是 **D2 的握手留存**，不是 D7 的 `session.exited` 复位。

**修复方向**：§0 的 D1 行改为「`docs/bench/crash-recovery.mjs`（**自动化用例待补**，见 §1.5）」；D7 行改为「**无自动化用例**（需在 `tests/lsp-recovery.test.mjs` 补一条：重启后进程 stdout 结束应被当作崩溃）」。

---

### N11 ［中］缺陷跟踪 §10 的交接清单与 §0 不同步（漏列 D8/D9、回归测试表漏 3 个文件、步骤顺序会让人白跑）

**位置**：`docs/PRD-v5-缺陷跟踪.md:328-336`（§10.1）、`:360-366`（§10.4）、`:340-350`（§10.2）、`:7`（头部时间戳）

| # | 问题 | 实测 |
|---|---|---|
| a | **§10.1「已完成」清单停在 D7**，而 §0 里 D8/D9 都是 ✅ 已修 | 接手者按 §10.1 走会以为 D8/D9 还开着；对应提交为 `0b20f16` / `70623e1` |
| b | **§10.4「新增的回归测试」表只列了 3 个文件**，本轮实际新增 **21 个**测试文件 | 尤其 `tests/lsp-status-progress.test.mjs`（4 例）与 `tests/ctrl-hover.test.mjs`（7 例）已在 §8.4/§9.4 被引用为 D8/D9 的验证，却不在表里；`tests/lsp-recovery.test.mjs`（7 例，本轮新增文件）又被 §0 引用 |
| c | **头部「最后更新 2026-10-31 16:35」早于最后两个提交** | `70623e1`（记录 D9 修复）与 `162bf6d`（修 §10 编号）都在其后，D9 章节与编号修订未反映在时间戳里 |
| d | **§10.2 的步骤顺序会让人白跑一遍人工走查** | 人工走查（item 2）排在 `npm run build`（item 3）之前，但浏览器加载的是构建产物 `dist/client.js`（`scripts/build.mjs` 从 `src/client/index.jsx` 打包），不是源码 —— 照顺序做，走查用的仍是旧 bundle。item 1 写了「浏览器要刷新才能拿到新的 `dist/client.js`」，却没写「先重新 build」 |

**修复方向**：§10.1 补 D8/D9 两行；§10.4 补上表提到的 3 个文件（或改为「本轮共新增 21 个测试文件，见 `git diff --name-status dd6dc17..HEAD -- tests/`」）；头部时间戳更新；§10.2 把 `npm run build` 提到 item 1，紧挨着「刷新浏览器」。

---

### N12 ［低］`实施进展.md` §8 的缺陷清单停留在 D1–D4，与缺陷跟踪的 D1–D9 不一致

**位置**：`docs/PRD-v5-实施进展.md:299-308`

| 位置 | 写的 | 实际 |
|---|---|---|
| `:299` | 「**三个**实机缺陷的完整分析在 `docs/PRD-v5-缺陷跟踪.md`」 | 表里是 D1–D4 **四行** |
| 表内容 | 只到 D4 | D5–D9（插件不激活、测试抖动、静默死亡、索引进度残留、悬停/补全）全缺 |

缺陷跟踪开头要求「另一个会话接手时，**先读本文件，再读 `实施进展.md`**」——接手者会看到一份**缺 5 项、且自称「三个」**的清单。

**修复方向**：§8 的表补到 D9（或改成「D1–D9 的完整分析见缺陷跟踪；此处只留 D1–D4 的结论」），并把「三个」改成「九个」。

---

### N13 ［低］三个 bench 脚本的运行前提没写进交接清单

**位置**：`docs/PRD-v5-缺陷跟踪.md:352-358`（§10.3）、`docs/bench/README.md`

§10.3 只列了脚本和作用，没写**各自的前提**：

| 脚本 | 前提 | 前提不满足时 |
|---|---|---|
| `crash-recovery.mjs` | 无（纯假件，`docs/bench/crash-recovery.mjs:23-40` 的 `fakeHandle()`） | — |
| `repro-order.mjs` | 需要仓库 `node_modules` 里有 `typescript-language-server`（实测 6.0.2）——它经假的 `ctx.subprocess.spawn` **起真的 TS 服务器** | 服务器起不来 → D2 场景根本走不到 |
| `live-lsp.mjs` | 同上，且需要跑完整链路 | 同上 |

另外 §2.4 把 `repro-order.mjs` 的**期望输出**贴成了固定文本，其中「23 capabilities」来自服务器返回的能力数，换一台机器或换一个 `typescript-language-server` 版本就不一定是 23。

**修复方向**：§10.3 增加「前提」一列；§2.4 的输出块标注「能力数随服务器版本变化」。

---

## 3. 关于验证手段本身的三点意见

### 3.1 `docs/bench/repro-order.mjs` 永远不会失败

脚本结尾是**无条件** `process.exit(0)`（`docs/bench/repro-order.mjs:99`），中间只 `console.log` 结果。本次实跑：

```
3. lsp.start -> {"state":"degraded","detail":"not enough free memory to start the language server (needs 2048 MB, 1988 MB available)…"}
4. the server answered the handshake: NO
5. lsp.status -> degraded (STUCK)
exit=0
```

当前机器可用内存 1988 MB < 阈值 2048 MB → **语言服务器根本没启动，脚本连 D2 的场景都没走到**，却仍然退出 0。缺陷跟踪 §2.4 把它列为 D2 的「验证」。

**建议**：脚本在断言失败时以非 0 退出；并提供一个可注入的 `freeMemoryThresholdMB`（或 `--no-memory-check` 开关），让它在任何机器上都能真正跑到握手场景。

### 3.2 D1 的崩溃路径仍无自动化测试

缺陷跟踪 §1.5 已自认这一点（「目前只有 `docs/bench/` 里的脚本，没有进 `tests/`」）。本次实跑 `crash-recovery.mjs` 通过（0 未处理拒绝、宿主存活），但它是一次性脚本、不在 CI 里。

**建议**：把 `crash-recovery.mjs` 的断言移植进 `tests/lsp-recovery.test.mjs`（该文件已有替身），补一条「崩溃后宿主不死」的用例。

### 3.3 第二轮交叉复核记录

第一轮检视之后，又有一位复核者独立走了一遍「缺陷跟踪文档 ↔ 代码 ↔ 实机日志」的对照，**未修改任何源码**。结论与第一轮**完全一致**，并补充了下列证据。

#### 3.3.1 独立复跑（全部与第一轮吻合）

| 核对项 | 实测 | 与第一轮的关系 |
|---|---|---|
| `npm test`（真实隔离） | **523 项 / 523 通过 / 0 失败** | 确认 §0 与 N9 |
| 本轮用例增量 | 基线 `dd6dc17` = 41 个测试文件 / ~328 例 → 今天 63 个文件 / 523 例，**增量正好 194** | 补齐 N9 未展开的推导（493 + 164 → 523 + 194） |
| D1 的**事故记录** | 真实日志 `%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-2026-10-31T08-15-23-334Z-host.log`（66 KB）存在，正文与缺陷跟踪 §1.1 的引用**逐字相符**，含 `illegal language server state transition: idle → building` 与 `assertTransition (…/src/host/lsp.js:200:11)` | 补强「D1 是实机事故、不是推测」 |
| D1 状态机 | `TRANSITIONS.idle = ['starting','idle']`，**确实没有** `idle → building` 边；修复后 `starting` 已含 `crashed` | 独立确认 D1 根因 |
| D2/D7 的缓冲与守卫 | `MAX_PENDING_PAYLOADS=64`、`entry.pending`、`entry.handshake`、`session.exited=false`（`lsp.js:1158`）、`relayToServer` 用 `#entry()` 而非 `#peek()`；`ctx.subprocess.spawn(spec)` **没有 await**（`lsp.js:1144`，确为同步） | 独立确认 N1 的前提「spawn 是同步的」成立 |
| D4 toast | `store.toast(kind, text, detail)` 三参签名正确；error 类 **9000 ms** 自动消失 | 确认「9 秒」精确无误 |
| D9 类名根因 | 修复前 CSS 确实写的是 `.cm-lsp-hover` / `.cm-lsp-signature`（`git show 0b20f16^`），库渲染的是 `.cm-lsp-hover-tooltip` | 确认「只有真机渲染才能发现」 |
| §10.2 的 `link:` 安装 | profile `%USERPROFILE%\.dsh\profiles\desktop\package.json` 确有 `"dsh-ide-workbench": "link:D:/Code/Node/DSH-IDE-TOOLWINDOWS-ROOT/dsh-ide-workbench"`，且在 `dsh.profile.bundles` 中 | 确认交接步骤 1 可执行 |
| 构建产物新鲜度 | `dist/client.js`(17:18) 晚于最新的 `src` 文件(17:06) | 确认 §10.2 的 build 步骤不会漏 |
| 用例数 | handshake 9 / error-toast 6 / plugin-mount 4 / status-progress 4 / ctrl-hover 7 —— 与文档标注**逐个吻合** | 确认 §10.4 的数字 |

#### 3.3.2 对第一轮的两处补强

1. **D7 没有任何自动化用例**（详见 **N10**）：第一轮把 D7 判为「✅ 有效」并引用 `tests/lsp-handshake.test.mjs:126`，那条用例守的是 D2 的握手留存；`session.exited = false` 这一行**没有任何用例覆盖**。
2. **D1 的「已修」在文档层面被夸大**（**N10**）：§0 表格把 `tests/lsp-recovery.test.mjs` 列为 D1 的验证手段，与 §1.5 自述矛盾。

#### 3.3.3 建议直接落地的文档补丁

```diff
 # docs/PRD-v5-缺陷跟踪.md
-| **D1** | … | ✅ 已修 | `docs/bench/crash-recovery.mjs` + `tests/lsp-recovery.test.mjs` |
+| **D1** | … | ✅ 已修 | `docs/bench/crash-recovery.mjs`（**自动化用例待补**，见 §1.5） |
-| **D7** | … | ✅ 已修 | `tests/lsp-handshake.test.mjs` 第 4 例 |
+| **D7** | … | ✅ 已修 | **无自动化用例**（`session.exited = false` 需在 `tests/lsp-recovery.test.mjs` 补） |
-3. **跑全量**：`npm test`（512 项）+ `npm run build`。
+3. **跑全量**：`npm test`（523 项）+ `npm run build`。
```

> 完整补丁见 **N11** / **N12**。

#### 3.3.4 引用行号的几处小订正

接手者会按行号跳转，以下几处与本报告正文引用的行号有 1–4 行偏差（代码本身正确）：

| 位置 | 本报告引用 | 实际 |
|---|---|---|
| `session.exited = false` | `:1155` | **`:1158`**（1155 是注释行） |
| 看门狗 interval / `setInterval` | `:1545` / `:1546` | **`:1541` / `:1542`** |
| `#safely` 定义 | `:1380-1394` | `:1389`（定义行，注释从 1380 起） |

---

## 4. 实现质量中值得肯定的部分

- **`#safely` 的覆盖面**：D1 修复不是给 `#onCrash` 打补丁，而是引入统一的兜底（`lsp.js:1380-1394`）并让**所有**异步出口都走它，包括定时器回调（定时器里的 throw 是未捕获异常，同样会杀死宿主）。状态机保持严格、不放松 —— 这个取舍是对的。
- **代次守卫**（`lsp.js:1097-1105`、`:1160`）：用 `session.generation` 让被替换的旧进程不再污染新会话，且旧进程先被 terminate —— 比「只加个 exited 标志」扎实得多。
- **主线程零解析**：`Content-Length` 帧编解码全部在 worker（`src/host/lsp-frame.js`），主线程只搬 `Buffer`。这正是 PRD §3.3 的硬性要求，也是本项目相对同类方案的核心优势。
- **`computeChanges` 的 LCS 差分**（`src/client/lsp-workspace.js:74-175`）：按行做 LCS、区域内再收敛到公共前后缀，使服务器收到小范围增量更新，同时保住库的位置映射精度。比整段重写好得多。
- **草稿优先于磁盘**（`lsp-workspace.js:242-252`）：先用编辑器实时内容，其次草稿，最后磁盘 —— PRD 风险 #7 处理到位。
- **围栏**：客户端用 `normalizeScopePath`（分隔符 + 大小写一起归一）判断路径是否在项目内，跨平台正确（`src/client/workspace-scope.js:43-48`）。

---

## 5. 建议的处理顺序

| 优先级 | 项 | 理由 | 状态（2026-10-31 第三轮） |
|---|---|---|---|
| P0 | **N1**（时序 + 测试层） | 生产目前正确，但回归测试守不住；改动小、收益大 | ✅ 已修 |
| P0 | **N2**（超时语义） | 大型项目上会常态化误杀语言服务器，且报错文案误导用户 | ✅ 已修 |
| P1 | **N4**（重复 initialize） | 协议违规；内置服务器无害，PATH 探测的服务器未知 | ✅ 已修 |
| P1 | **N3**（定时器泄漏） | 长时间使用后宿主常驻空转定时器 | ✅ 已修 |
| P2 | **N10**（缺陷跟踪 §0 验证指针指错） | 两行指针指向不相干的用例；D7 的修复实际无人守护，改文字即可 | ✅ 已修（并**补上了 D7 的用例**） |
| P2 | **N11**（§10 交接清单漏项 / 顺序） | 接手者会漏掉 D8/D9、误以为回归测试已齐、并白跑一遍人工走查 | ✅ 已修 |
| P2 | **N5**（pending 淘汰丢握手） | 触发条件苛刻，后果严重 | ✅ 已修 |
| P3 | N12 / N13 / N6 / N7 / N8 / N9 | 潜伏问题与文档一致性 | ✅ 已修 |

---

## 附录：本次检视的复现命令

```powershell
cd dsh-ide-workbench

# 全量测试（523 项）
node --test tests/*.test.mjs

# 客户端构建与体积
npm run build
(Get-Item dist/client.js).Length      # 2771122

# 开发方自带的验证脚本
node docs/bench/crash-recovery.mjs     # 通过：0 未处理拒绝、宿主存活
node docs/bench/repro-order.mjs        # 当前机器上未真正跑到 D2 场景（内存不足），且恒 exit 0

# 缺陷跟踪文档引用的复现脚本
# node docs/bench/live-lsp.mjs         # 真的起 typescript-language-server 跑完整链路
```

第二轮交叉复核追加：

```powershell
# 崩溃事故的原始日志（缺陷跟踪 §1.1 引文的出处）
Get-Content "$env:APPDATA\@deepseek-ai\dsh-desktop\logs\crash-2026-10-31T08-15-23-334Z-host.log" |
  Select-String "host exited with 1|fatal load failure|illegal language server state transition"

# 基线与当前的用例数（得出「本轮 +194」）
git ls-tree -r --name-only dd6dc17 -- tests/        # 41 个测试文件
git diff --name-status dd6dc17..HEAD -- tests/      # 本轮 A 21 个 / M 1 个

# 插件确实是 link: 安装，且在 bundles 里
Get-Content "$env:USERPROFILE\.dsh\profiles\desktop\package.json"

# 构建产物比源码新（不必重跑 build）
Get-Item dist\client.js | Select-Object LastWriteTime
```

> 两轮检视**均未修改任何源码文件**；新建的探针脚本均在 `%TEMP%` 下，已清理。

---

## 6. 第三轮：独立复核与修复（2026-10-31）

> 这一轮的任务：**复核**上面这份报告，并**把它指出的问题修掉**。
> 结论：**N1–N13 全部成立**（没有一条是误报），已全部修复。
> §6.2 记录复核中订正的 3 处细节 —— 它们不改变结论，但会影响读者对严重度的判断。

### 6.1 复核方法

不采信第一轮的结论，**逐条重新复现**：

| 手段 | 说明 |
|---|---|
| 读码 | 逐条核对报告引用的位置与逻辑 |
| 探针（`%TEMP%` 下的临时脚本，已清理） | 在**宿主管理器**层面复现 N1 / N2 / N3 / N5；用**真 worker 线程**复现 N4 |
| 回归 | 修复后逐条把修复**回退**，验证新用例**确实会失败**（见 §6.4） |

复核结果：

| 项 | 报告的结论 | 复核结论 |
|---|---|---|
| **N1** 握手重放的时序错误 | 高 | ✅ **成立**（影响面比报告写的更大，见 §6.2 第 1 条） |
| **N2** 超时按 tick 计数 | 高 | ✅ **成立**（实测次数是 4 不是 3，见 §6.2 第 2 条） |
| **N3** 定时器泄漏 | 中 | ✅ **成立**（实测：取消一轮泄漏 2 个；3 轮后净增 6 个） |
| **N4** 重复 `initialize` 被转发 | 中 | ✅ **成立**（真 worker 实测：服务器 stdin 收到 2 个 initialize） |
| **N5** `pending` 淘汰丢握手 | 中 | ✅ **成立**（是**彻底**复现 D2，见 §6.2 第 3 条） |
| **N6** Windows 下 `liveStates()` 永不命中 | 低 | ✅ **成立**（`samePath` 只折叠大小写，不归一分隔符） |
| **N7** `enabled` 有文档无实现 | 低 | ✅ **成立**（`servers()` 与 `#startSession()` 都不读它） |
| **N8** `marked` 是冗余依赖 | 低 | ✅ **成立**（全仓库零 import；它是 `@codemirror/lsp-client` 的传递依赖） |
| **N9** 文档数字过期 | 低 | ✅ **成立**（`实施进展.md` 停在 493 项 / 2,762,422 字节；`缺陷跟踪.md` 里「512 项」与同文件 §0 的 523 自相矛盾） |
| **N10** 缺陷跟踪 §0 的验证指针指错 | 中 | ✅ **成立**（D1 指向的 `tests/lsp-recovery.test.mjs` 当时没有一条断言「宿主不死」；D7 的 `session.exited` 全仓库零用例） |
| **N11** 交接清单不同步 | 中 | ✅ **成立**（§10.1 停在 D7；§10.4 只列 3 个文件；§10.2 的走查排在 build 之前） |
| **N12** `实施进展.md` §8 停在 D1–D4 | 低 | ✅ **成立**（表里 4 行却写「三个」） |
| **N13** bench 脚本的前提没写 | 低 | ✅ **成立**（三个脚本都**恒 exit 0**，连失败都看不出来） |
| **§3.1** `repro-order.mjs` 永不失败 | — | ✅ **成立**（脚本结尾是无条件 `process.exit(0)`；本机实测确实停在 `degraded` 却 exit 0） |
| **§3.2** D1 崩溃路径无自动化测试 | — | ✅ **成立**（当时只有 `docs/bench/` 里的脚本） |

### 6.2 复核中订正的 3 处细节

1. **N1 的影响面比报告写的更大。** 报告说「生产当前是对的」，这没错，但它低估了后果：
   实测在**假 worker（同步回送）**下，**整条重放链全部丢失** —— 不只是握手，
   暂存的载荷**一个都没进 stdin**（`stdin frames: 0`）。
   生产之所以没事，只因为两个偶然性质同时成立：真 worker 的回送是异步的、
   且 `ctx.subprocess.spawn` 是同步的。**任何一条变了，症状就是 D2。**
   → 修复时把「交给 worker 的时机」从「靠时序碰巧对」改成「显式在 `session.handle` 赋值之后」。
2. **N2 的实测次数是 4，不是 3。** 报告贴的是「3 consecutive request timeouts」，
   实测（`requestTimeoutMs: 40`、一个永不响应的请求）是 **4** ——
   看门狗每个 tick 记一次，落在第几个 tick 取决于相位。结论不变（一个挂起请求就足以打死服务器），
   但量级说明它比报告写的还要快一点。
3. **N5 是彻底复现 D2，不是「握手收不到」。** 握手被淘汰之后 `entry.handshake` **仍然是空的**
   （它只在 worker 回报之后才有值），所以没有任何补救路径：服务器永远收不到 `initialize`，
   会话永远停在 `building`。→ 修复给第一次握手一个**独立槽位**，不排队。

### 6.3 修复清单

#### 代码

| # | 改了什么 | 在哪 | 状态 |
|---|---|---|---|
| **N1** | 握手与缓冲载荷在 **`session.handle = handle` 之后**才交给 worker（不再依赖 worker 的同步性与 `spawn` 的同步性） | `src/host/lsp.js` `#spawn()` | ✅ |
| **N1** | 假 worker 改为**同步回送**（真 worker 是异步），宿主侧因此不能依赖时序 | `tests/lsp-fixtures.mjs` | ✅ |
| **N2** | 超时**每个请求只记一次**（`session.timeoutStallAt`）；服务器一回答就**复位计数器**；文案改为「N request timeouts」 | `src/host/lsp.js` `#checkTimeouts()` / `#noteTimeout()` / `#onWorkerMessage()` | ✅ |
| **N3** | 新增 `#teardownSession()`（清空闲定时器、看门狗、就绪定时器、重启定时器 + 停 worker），在 `cancelIndex`、`#exitIdle`、`#onCrash`、`#shutdownEntry`、`#startSession`、`shutdownAll()` 统一调用 | `src/host/lsp.js` | ✅ |
| **N4** | 新增 `Handshake.isInitialize()`；**重复的 `initialize` 不再写进服务器 stdin**，由 `duplicates` 记账、服务器回答后用缓存能力值补答 | `src/host/lsp-worker.js` | ✅ |
| **N5** | 第一次握手进**独立槽位** `entry.handshake`（不排队）；队列淘汰时**跳过握手**（第二次及以后的握手留在队列里，由 worker 吸收并补答） | `src/host/lsp.js` `#holdFor()` | ✅ |
| **N6** | `samePath()` 在 Windows 上**同时归一分隔符与大小写**，与 `rootKey()` 一致 | `src/host/workspace.js` | ✅ |
| **N7** | `settings.lsp.servers[lang].enabled === false` → **不启动**该语言的服务器（`degraded` + 说明）；`lsp.servers` 增加 `disabled` 列表，设置页显示 | `src/host/lsp.js`、`src/client/store.js`、`src/client/SettingsPanel.jsx`、`src/client/i18n.js` | ✅ |
| **N8** | 删除 `marked` 的**直接** devDependency 声明（它是 `@codemirror/lsp-client` 的传递依赖） | `package.json` | ✅ |
| **§3.1** | `repro-order.mjs`：**失败以非 0 退出**（0 通过 / 1 某步失败 / 2 这台机器跑不了），并用一次性 profile 把内存门槛调低，任何机器都能真正跑到 D2 的场景 | `docs/bench/repro-order.mjs` | ✅ |
| **§3.1** | 同上处理 `crash-recovery.mjs` 与 `live-lsp.mjs`（这两个脚本原来也是恒 exit 0） | `docs/bench/crash-recovery.mjs`、`docs/bench/live-lsp.mjs` | ✅ |
| **§3.2** | 崩溃路径进 `tests/`：**「宿主不死」三例**（崩溃不泄漏 rejection / 重启竞态中取消 / 非法迁移），监听 `unhandledRejection` 与 `uncaughtException` | `tests/lsp-recovery.test.mjs` | ✅ |
| **N10** | D7 补上真正的用例（「重启后死亡不被吞掉」）—— 原来 `session.exited = false` **一行都没有用例守着** | `tests/lsp-recovery.test.mjs` | ✅ |

#### 文档

| # | 改了什么 | 在哪 | 状态 |
|---|---|---|---|
| **N9** | `实施进展.md` 的数字回填：**544 项 / 2,772,340 字节 / +301 KB**；`缺陷跟踪.md` 的「512 项」订正为 544 | `docs/PRD-v5-实施进展.md`、`docs/PRD-v5-缺陷跟踪.md` | ✅ |
| **N10** | 缺陷跟踪 §0 的「验证方式」列：D1 指向真正存在的「宿主不死」用例，D7 指向新补的用例 | `docs/PRD-v5-缺陷跟踪.md` §0 | ✅ |
| **N11** | 交接清单：补 D8–D14；回归测试表补全（新增 `tests/lsp-review-fixes.test.mjs`）；`npm run build` **提到人工走查之前**并注明「走查必须先 build」；头部时间戳更新 | `docs/PRD-v5-缺陷跟踪.md` §11 | ✅ |
| **N12** | `实施进展.md` §8 补到 **D9**，「三个缺陷」改成「九个缺陷」，并补上代码检视报告的 D10–D14 | `docs/PRD-v5-实施进展.md` §8 | ✅ |
| **N13** | 三个 bench 脚本的**前提**写进交接清单与 `docs/bench/README.md`；§2.4 的期望输出标注「能力数随服务器版本变化，不要当断言」 | `docs/PRD-v5-缺陷跟踪.md` §11.3、`docs/bench/README.md` | ✅ |
| — | 缺陷跟踪文档新增 **§10（D10–D14）**，交接清单顺延为 §11 | `docs/PRD-v5-缺陷跟踪.md` | ✅ |

### 6.4 修复后的验证

```
npm test          → 544 / 544 通过 / 0 失败（基线 329 + 本轮 215）
npm run build     →  dist/client.js 2,772,340 字节（2,705.5 KiB，增量 +301 KB ≤ 400 KB ✅）
```

**实机（真的 `typescript-language-server`）**：

```text
node docs\bench\repro-order.mjs
  3. lsp.start -> {"state":"building","detail":"building the program"}
  4. the server answered the handshake: yes (23 capabilities)
  5. lsp.status -> ready (good)
  6. textDocument/definition -> [{"uri":"file:///…/src/client/lsp-uri.js","range":{…}}]
  the scenario worked: the handshake was held, replayed and answered.   exit=0

node docs\bench\crash-recovery.mjs
  5. state after the restart: building | servers started: 2
  6. unhandled rejections: 0 (none)
  the scenario worked: the host survived the crash and the server came back.   exit=0
```

**回归用例的保真度**（把每一处修复单独回退，新用例必须失败）：

| 回退的修复 | 失败的用例 |
|---|---|
| N1：握手交回 worker 的时机 | 「the held handshake reaches the stdin…」「the payloads that waited…」「the handshake survives a queue…」 |
| N2：看门狗的「每请求只记一次」 | 「one slow request does not kill the language server」 |
| N3：取消时的定时器清理 | 「a cancelled index leaves no timer behind」「a session that is replaced leaves no timer behind」 |
| N4：worker 里的重复握手放行 | 「the worker writes only one initialize to the server」「the worker answers a second initialize…」 |
| N5：握手的独立槽位 + 淘汰规则 | 「the handshake survives a queue of waiting payloads」 |
| N6：`samePath` 的分隔符归一 | 「a live state is found for the same folder in another spelling」 |
| N7：`enabled` 的实现 | 「a language that is turned off in the settings is not started」 |
| §3.2：D1 的状态复核守卫 | 「a cancel while the language server restarts does not kill the host」 |
| N10：D7 的 `session.exited` 复位 | 「a language server that dies after a restart is not swallowed」 |

> 这张表是这次修复里**最值钱的部分**：报告指出上一轮的用例「断言在错误的层」，
> 所以每一个新用例都单独验证过 —— **把修复拆掉，用例必须失败**。

**一处如实记录的抖动**：满载时全量 `npm test` 观察到
`tests/definition.test.mjs` 的「an identifier is recognized」**偶发失败一次**
（该用例要把客户端打包后动态 import，机器忙时更容易出问题）。
单独跑连 5 次全绿，之后连续三次全量 `npm test` 也是 544/544 全绿。
这不是本轮改动引入的（走的是 esbuild 打包 + 动态 import 的老路径），
记在缺陷跟踪文档的 D6 里，避免被误判成新缺陷。

### 6.5 对本报告的订正

- **行号已经变了**：§1–§3 引用的行号以**修复前**的代码为准（`src/host/lsp.js` 从 1817 行变成 1965 行）。
  报告 §3.3.4 那几处行号订正（`:1158` / `:1541` / `:1389`）现在**也已经过期**。
- **章节号变了**：缺陷跟踪文档新增了 §10（D10–D14），原来的「§10 交接清单」顺延为 **§11**。
  本报告 §3.3.3 的文档补丁因此被 §6.3 的实际改动取代。
- **N1 的定性**：报告说「生产当前是对的」——**准确**，但要补一句：
  触发条件不是「假 worker」，而是**任何让 worker 的回送早于 `session.handle` 赋值的情况**
  （真 worker + 异步 `spawn` 就是这种）。修复后这条依赖彻底消失。
- **N2 的次数**：报告贴的是「3 consecutive request timeouts」，实测是 **4**（见 §6.2 第 2 条）。
- **§3.1 的建议**：报告建议给 `repro-order.mjs` 一个「可注入的 `freeMemoryThresholdMB`」。
  实现上用的是**一次性 profile**（`DSH_PROFILE_DIR`）而不是加参数 ——
  脚本里唯一能改的是插件的设置文档，这样改**不用动生产代码**。

---

## 7. 第四轮：修复后的独立复核（2026-10-31）

> 这一轮的任务：**独立复核 §6 的修复**，不采信 §6 的结论。
> 结论：**§6 声称的 N1–N13 修复全部成立**（13/13 用自建探针或变异测试独立确认）。
> 但复核又找出 **2 项新问题**（M1、M2），其中 M1 违反 PRD §2.4 的幂等要求。

### 7.1 复核方法

| 手段 | 说明 |
|---|---|
| 读码 | 逐条核对 §6.3 的修复清单与 `3a42238` 的实际改动 |
| 自建探针 | 在宿主管理器层面独立复现每一项修复（不依赖开发方的新用例） |
| **变异测试** | 把每一处修复**单独回退**，验证新用例**确实会失败**（§6.4 的表只覆盖了部分修复） |
| 实跑 | `npm test`、`npm run build`、`docs/bench/repro-order.mjs`、`docs/bench/crash-recovery.mjs` |

### 7.2 逐条复核结论：13/13 成立

| 项 | 复核手段与实测输出 | 结论 |
|---|---|---|
| **N1** | 自建探针（**同步**假 worker —— 上一轮丢帧的那个场景）：`暂存的握手到达服务器 stdin : 是 ✓` | ✅ 成立 |
| **N2** | 一个挂起请求 → 状态停在 `building`（**不再**降级）；三个不同请求 → `3 request timeouts` → `degraded` | ✅ 成立（语义与文案都对） |
| **N3** | 只统计**常驻 `setInterval`**：`start 后=1 → cancel 后=0 → 3 轮 start/cancel 后=0` | ✅ 成立 |
| **N4** | 真 worker 实测：`写入服务器 stdin 的帧数 : 1`（第二个 initialize 被吸收） | ✅ 成立 |
| **N5** | 握手后灌入 **200 条**载荷再启动：`initialize 是否还在 : 是 ✓` | ✅ 成立 |
| **N6** | `samePath(rootKey(raw), raw) = true` | ✅ 成立 |
| **N7** | `enabled === false` → 不启动、注册表报 `disabled`、设置页有专门的一行 | ✅ 成立 |
| **N8** | `package.json` 已删掉 `marked` 的直接声明 | ✅ 成立 |
| **N9** | `实施进展.md` 现为 544 项 / 2,772,340 字节 / +301 KB —— 与磁盘 `dist/client.js` **逐字节吻合** | ✅ 成立 |
| **§3.1** | `repro-order.mjs` 现在失败退 1、内存门槛降到 64 MB，**本机完整跑通 D2 场景**：握手被暂存 → 重放 → 23 项能力 → `ready` → 跨文件 definition 有真实答案 | ✅ 成立 |
| **§3.2** | `tests/lsp-recovery.test.mjs` 新增 4 例，监听 `unhandledRejection` / `uncaughtException` | ✅ 成立 |
| **N10–N13** | 文档层面的指针、清单、章节号、脚本前提均已同步 | ✅ 成立 |

**变异测试**（把修复单独回退，新用例必须失败）—— 我独立跑了 7 个变异：

```
KILLED   N1  握手重放移回句柄赋值之前      → the held handshake reaches the stdin…
KILLED   N2  去掉 timeoutStallAt 守卫      → one slow request does not kill…
KILLED   N3  cancelIndex 不再 teardown     → a cancelled index leaves no timer behind…
KILLED   N4  重复握手恢复无条件写 stdin    → the worker writes only one initialize…
KILLED   N5  握手专用槽位 + 淘汰规则全回退 → the handshake survives a queue of waiting payloads
KILLED   N6  samePath 恢复只折叠大小写     → a live state is found for the same folder…
SURVIVED N2b 移除「服务器回答后计数器复位」 → (无失败用例)   ← 见 M2
```

### 7.3 新发现的问题

### M1 ［中］`cancelIndex` 在 `degraded` / `cancelling` 状态下抛错 —— 违反 PRD §2.4 的幂等要求

**位置**：`src/host/lsp.js:605-620`（守卫）、`:141-152`（`TRANSITIONS`）

```js
605  async cancelIndex({ root } = {}) {
     ...
610    if (session.state === 'cancelled' || session.state === 'idle') return { state: 'cancelled' }
611    this.#transition(session, 'cancelling', 'cancelling')
```

守卫只覆盖 `'cancelled'` 与 `'idle'` 两个状态，而 `TRANSITIONS` 里：

```
148  cancelling: ['cancelled', 'idle'],
150  failed:     ['starting', 'idle'],
151  degraded:   ['starting', 'idle'],
```

`'degraded'`、`'failed'` **没有** `'cancelling'` 这条边 → `assertTransition` 抛错。

**本次实测（两种触发方式）**：

```
=== 对 degraded 会话调用 cancelIndex ===
  超时后状态: degraded
  >> cancelIndex 抛错: illegal language server state transition: degraded → cancelling

=== 并发两次 cancelIndex（真实进程要 800 ms 才死） ===
  第一次调用进行中，会话状态 = cancelling
  第一次: ok:{"state":"cancelled"}
  第二次: throw:illegal language server state transition: cancelling → cancelling
```

**为什么不幂等**：
- `'degraded'` 之后调 cancel → 抛错；
- 第一次取消**还在进行中**（会话处于 `'cancelling'`，要等进程真的死掉，最多 `graceMs + 500` ms）时再调一次 → 也抛错。

而这段代码**自己的注释**写着：

> `cancelling` → terminate the process → `cancelled` → close the open documents → notify the clients.
> **Repeated calls are answered with the same result and never kill a second time.**

实现与自己的文档矛盾，也与 **PRD §2.4「原子取消」的第 6 条判定（幂等）** 矛盾。

**影响**：API 路由有 try/catch（`src/index.js:541-548` → `writeError`），所以**不会杀死宿主**，但取消会静默失败，客户端拿到一个错误响应。

**可达性**：客户端在**自己的**视图是 `building` 时显示【取消索引】按钮，而宿主每 2 秒才轮询一次状态 → 宿主已经因崩溃/内存降级成 `degraded`、客户端还显示 `building` 的窗口内点这个按钮，就会命中。

> **这一条是既有缺陷，不是本轮引入的**：`4b2b7dc` 与 `162bf6d` 的守卫和 `TRANSITIONS` 完全一样（已逐版本核对）。只是此前没人触发过。

**修复方向**（二选一）：
1. 守卫放宽为「会话不在 `'starting'`/`'building'`/`'ready'` 之一就直接返回 `{ state: 'cancelled' }`」——取消一个已经降级的会话本来就该是空操作；
2. 或给 `TRANSITIONS` 的 `degraded` / `failed` / `cancelling` 补上 `'cancelling'` 这条边。

同时建议补一条用例：`cancelIndex` 对 `degraded` 会话、以及两次并发 `cancelIndex`，都应当返回 `{state:'cancelled'}` 而不抛错。

### M2 ［中］「超时计数器在服务器回答后复位」这件事**没有测试覆盖**

**位置**：`src/host/lsp.js:1312-1320`（复位代码）、`tests/lsp-review-fixes.test.mjs:127`（声称覆盖它的用例）

复位代码在 `#onWorkerMessage` 的 `type === 'message'` 分支里：

```js
if (message.type === 'message') {
  session.lastServerActivityAt = this.#now()
  // The server answers again: ... the counter is the number of unanswered requests
  session.timeouts = 0
  session.timeoutStallAt = 0
```

而那条声称覆盖它的用例叫 **「the timeout counter is reset when the server answers again」** —— 但**假服务器从头到尾没有回过任何输出**：用例里只有三次 `manager.relayToServer(...)`（客户端请求），没有一次服务器应答。于是 `#onWorkerMessage` 的 `'message'` 分支**一次都没被执行**，复位代码**一次都没跑到**。

用例之所以通过，靠的是另一条机制：`timeoutStallAt` 标记让**每个新请求**都能重新计一次 —— 那是「按请求计数」，不是「计数器复位」。

**变异验证**（把复位代码整段删掉）：

```
有复位（当前实现）        : 状态=ready
复位被移除                : 状态=building      ← 行为确实变了：服务器死了
此时回归测试失败用例数     : 0                   ← 但没有任何用例发现
```

即：**这个变异是有意义的（行为改变），却没有任何测试发现它**。

**为什么重要**：复位与「按请求计数」是两件不同的事。

- 只有「按请求计数」：一个会话里累计 3 次慢请求，服务器就被打死 —— 即使这 3 次分散在几小时里、中间服务器一直正常应答。
- 加上「复位」：只有**连续** 3 次无人应答才会打死服务器。

后者才是 PRD §2.7「连续请求超时计数」想要的语义。现在这个语义**正确**，但**没有用例守着** —— 下一次重构把它删掉，测试依然全绿，而长会话会莫名其妙地开始崩服务器。

**修复方向**：把那条用例改成真的让服务器回答 —— fixture 已经支持，往假 worker 灌一条服务器输出即可：

```js
workers[0].emit('message', { type: 'message', text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }) })
```

然后断言计数器归零（例如连续三次「慢请求 + 服务器应答」之后服务器仍然活着）。

> 顺带：§6.4 的变异表里列了 N2 的「每请求只记一次」，但**没有列「计数器复位」**这一项 —— 这正是它漏掉的原因。

### 7.4 一处健壮性备注（不单列为缺陷）

`#holdFor()` 用正则 `/"method"\s*:\s*"initialize"/` 在**未解析**的文本上判断是不是握手（主线程不解析载荷，这是刻意的取舍）。若某个 `didChange` 的**文本内容里**恰好含有 `"method": "initialize"`，且它比真正的握手更早到达（客户端首次连接时 `initialize` 总是第一个发出，所以现实里几乎不可能），它会被误放进 `entry.handshake` 槽位，导致服务器收不到真正的握手。

影响面极小（需要用户先在文件里敲出那段文本、再在服务器启动前发通知），worker 那侧的 `isInitialize()` 用的是真正的 JSON 解析，不受影响。若要彻底消除，可在 `#holdFor` 里对 initialize 候选做一次轻量结构校验。

### 7.5 第四轮结论

| 维度 | 结论 |
|---|---|
| §6 的修复 | **13/13 全部成立**，且 N1/N2/N3/N4/N5/N6 六项经**变异测试**确认有真实用例守着 |
| 新发现 | **2 项**（M1 幂等性违反 PRD §2.4、M2 一处未被覆盖的复位语义） |
| 严重度 | 两项均为**中**，无致命项；M1 影响的是「取消」这一条用户可见的路径 |
| 文档一致性 | ✅ 三份文档的数字与磁盘完全吻合（544 项 / 2,772,340 字节 / +301 KB） |
| 验证手段 | ✅ 三个 bench 脚本现在都会失败退出，`repro-order.mjs` 在本机真实跑通 D2 全场景 |

**建议**：M1 与 M2 一起处理 —— M1 改守卫（3 行）+ 补 2 条用例；M2 改 1 条用例的 1 行并补一条断言。总计不到半小时，能把「取消不可靠」和「长会话会误杀服务器」两个尾巴一起收掉。

---

## 8. 第五轮：M1 / M2 的复核与修复（2026-10-31）

> 这一轮的任务：**复核第四轮新发现的 M1 / M2**，并把它们修掉。
> 结论：**M1、M2 全部成立**（没有误报），已修复。
> 修复 M1 的过程中又找出**第三项问题（M3）**，一并修掉；
> §7.4 那条健壮性备注也顺手加固了。

### 8.1 复核方法

| 手段 | 说明 |
|---|---|
| 读码 | 核对 §7.3 引用的位置与 PRD §2.4 的原文 |
| 自建探针 | 在宿主管理器层面独立复现 M1 的两种触发方式、M2 的变异 |
| **变异测试** | 把每一处修复**单独回退**，验证新用例**确实会失败** |
| 实跑 | `npm test`、`npm run build`、`docs/bench/repro-order.mjs` |

复核结果：

| 项 | 第四轮的结论 | 第五轮的复核 |
|---|---|---|
| **M1** 取消在 `degraded` / 并发时抛错 | 中 | ✅ **成立**，两种触发方式都复现（见下） |
| **M2** 复位语义没有测试覆盖 | 中 | ✅ **成立**：删掉复位代码后**行为改变**（服务器被打死并重启），而**没有一个用例发现** |

**M1 的复现（自建探针）**：

```
=== 对 degraded 会话调用 cancelIndex ===
  超时后状态: degraded
  >> cancelIndex 抛错: illegal language server state transition: degraded → cancelling

=== 并发两次 cancelIndex（进程要 900 ms 才死） ===
  第一次调用进行中，会话状态 = cancelling
  第二次: throw: illegal language server state transition: cancelling → cancelling
```

**M2 的变异（删掉复位代码）**：

```
有复位（当前实现）        : 状态=ready，服务器进程数=1
复位被移除                : 状态=ready，服务器进程数=2   ← 服务器被打死并重启了
此时回归测试失败用例数     : 0                            ← 但没有任何用例发现
```

### 8.2 修复过程中发现的第三项问题

### M3 ［中］取消发生在「服务器正在启动」的窗口里 → **残留一个语言服务器进程**

**位置**：`src/host/lsp.js` `#spawn()`（进程起来之后）与 `#startSession()`（`await #spawn()` 之后）

复现（探针，进程启动耗时 120 ms，取消在 40 ms 时到达）：

```text
the session is starting; the cancel arrives now
cancelIndex -> {"state":"cancelled"}
start THREW: illegal language server state transition: cancelled → building
processes started: 1 | terminate calls: 0     ← 进程起来了，没人停它
```

两层问题：

1. **残留进程**：取消发生时进程还不存在，`cancelIndex` 等不到它就返回了；
   进程随后才起来，而**没有人停它** —— 直接违反 PRD §2.4「取消后无残留语言服务器进程」。
2. **状态机抛错**：`#startSession()` 在 `await #spawn()` 之后无条件迁到 `building`，
   而会话已经是 `cancelled` → `cancelled → building` 非法 → `start()` 抛错。

这一条**第四轮没有提到**，是修 M1 时顺着取消路径读出来的。

### 8.3 修复清单

| # | 改了什么 | 在哪 | 状态 |
|---|---|---|---|
| **M1** | 取消的守卫放宽：只有 `starting` / `building` / `ready` / `restarting` 四个状态才真的取消，其余（`idle`、`cancelled`、`cancelling`、`crashed`、`degraded`、`failed`）一律**空操作**并返回同一个 `{ state: 'cancelled' }` —— 状态机保持严格，不给 `degraded` / `failed` 硬造一条 `cancelling` 边 | `src/host/lsp.js` `cancelIndex()` / `CANCELLABLE_STATES` | ✅ |
| **M1** | 并发的第二次取消**等待**第一次结束再回答（`session.cancelPromise`）：既不抛错，也**不在进程还活着时就返回**（PRD §2.4「取消返回时，进程树中不得再有该语言服务器」） | `src/host/lsp.js` `cancelIndex()` | ✅ |
| **M1** | 取消的动作本身拆到 `#cancelSession()`，临界区（标记 `cancelling` → 终止进程 → 标记 `cancelled` → 关闭文档 → 通知客户端）原样保留 | `src/host/lsp.js` | ✅ |
| **M3** | 进程起来之后若会话已经不在 `starting` / `restarting`（取消在这段窗口里到达），**立刻停掉刚起来的进程** | `src/host/lsp.js` `#spawn()` | ✅ |
| **M3** | `#startSession()` 在 `await #spawn()` 之后**先核对状态**再迁到 `building`；失败路径同理 | `src/host/lsp.js` `#startSession()` | ✅ |
| **M2** | 那条声称覆盖复位的用例**改成真的让服务器回答**（通过 worker 灌 stdout），并断言「三次慢请求、每次都有应答 → 服务器不会被打死」；原来那条其实测的是「三次无人应答才打死」，已改名说清 | `tests/lsp-review-fixes.test.mjs` | ✅ |
| **§7.4** | 握手识别改成看**第一个** `"method"`：一个自带 `method` 键的通知（哪怕它载荷里还嵌着一个 `"method":"initialize"` 对象）不会被误当握手。仍然不解析载荷 | `src/host/lsp.js` `isInitializeRequest()` | ✅ |

### 8.4 新增的回归用例与保真度

新增 5 条用例（`tests/lsp-review-fixes.test.mjs`，共 21 条）：

| 用例 | 守住 |
|---|---|
| cancelling a degraded session answers instead of failing | M1 |
| two concurrent cancels kill the process once and both answer | M1（并发 + 「返回时进程已死」） |
| a cancel that arrives while the server starts leaves no process behind | M3 |
| a notification whose text contains a handshake is not a handshake | §7.4 |
| the timeout counter is reset when the server answers again | M2（**这次真的让服务器回答了**） |

**变异测试**（把每一处修复单独回退，新用例必须失败）：

```
KILLED   M1a  取消守卫放宽            → cancelling a degraded session answers instead of failing
KILLED   M1b  并发取消等待第一次      → two concurrent cancels kill the process once and both answer
KILLED   M1c  取消后停掉刚起的进程    → a cancel that arrives while the server starts leaves no process behind
KILLED   M1d  building 之前核对状态   → a cancel that arrives while the server starts leaves no process behind
KILLED   M2   超时计数器复位          → the timeout counter is reset when the server answers again
KILLED   §7.4 握手识别（第一个 method）→ a notification whose text contains a handshake is not a handshake
```

> 六个变异，六个都被杀掉 —— 这一轮的每处修复都有用例守着。

### 8.5 修复后的验证

```
npm test          → 549 / 549 通过 / 0 失败（上一轮 544 + 本轮 5）
npm run build     →  dist/client.js 2,772,340 字节（2,705.5 KiB，增量 +301 KB ≤ 400 KB ✅）
node docs\bench\repro-order.mjs → the scenario worked: the handshake was held, replayed and answered.  exit=0
```

### 8.6 对第四轮的两点订正

- **M2 的实测输出与第四轮贴的略有不同**：第四轮写的是「复位被移除 → 状态=building」，
  实测是「状态=ready，**服务器进程数=2**」。结论不变（服务器确实被打死并重启了），
  但**状态字段会骗人** —— 判定要看进程数，不能只看状态。
- **§7.4 的触发条件比写的窄一点**：JSON 字符串里的引号一定是转义的（`\"method\"`），
  所以「文本内容里含有 `"method": "initialize"`」其实**不会**命中旧正则；
  真正会命中的是**载荷里嵌着一个带 `method` 键的对象**。
  修复按后者做的（看第一个 `"method"`），两种情形都覆盖。
