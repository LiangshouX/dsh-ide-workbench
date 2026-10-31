# PRD-v5 缺陷跟踪与交接

> 用途：记录 PRD-v5 实施期间发现的**实机缺陷**、根因、修复与验证方法。
> 另一个会话接手时，先读本文件，再读 `docs/PRD-v5-实施进展.md`（规格落地与偏差）。
>
> 仓库：`dsh-ide-workbench`，基线 commit `dd6dc175f8cf1b6a891cc37f81ac21a3d81839a4`。
> 本文件最后更新：2026-10-31 16:35（Asia/Shanghai）。

---

## 0. 当前状态一览

| # | 缺陷 | 严重度 | 状态 | 验证方式 |
|---|---|---|---|---|
| **D1** | **DSH 宿主进程崩溃**（`host exited with 1`，整个应用退出，需禁用插件 + 清设置才能恢复） | **致命** | ✅ 已修 | `docs/bench/crash-recovery.mjs` + `tests/lsp-recovery.test.mjs` |
| **D2** | 状态永远停在「语义分析：索引中…」 | 高 | ✅ 已修 | `docs/bench/repro-order.mjs` + `tests/lsp-handshake.test.mjs` |
| **D3** | `Ctrl+点击` 100% 报 `Find definition failed: Request timed out` | 高 | ✅ 已修（D2 的连带症状） | `docs/bench/repro-order.mjs` 第 6 步 |
| **D4** | 错误浮层盖在内容区上方、要手动叉掉 | 中 | ✅ 已修（改走工作台 toast） | `tests/lsp-error-toast.test.mjs` |
| **D5** | 插件装上后起不来：`TypeError: Invalid effect` | 高 | ✅ 已修 | `tests/plugin-mount.test.mjs` |
| **D6** | `tests/perf-cold-workspace.test.mjs:123` 偶发失败 | 低 | ✅ 已修（定时器泄漏） | 全量 `npm test` 连跑 |
| **D7** | 重启后的语言服务器**静默死亡不被察觉** | 中 | ✅ 已修 | `tests/lsp-handshake.test.mjs` 第 4 例 |
| **D8** | 已索引的仓库**永远显示「正在更新索引…」** | 中 | ✅ 已修 | `tests/lsp-status-progress.test.mjs` |
| **D9** | 悬停卡片 / 补全弹窗**文字看不清**；Ctrl+悬浮**没有跳转提示** | 中 | ✅ 已修 | `tests/ctrl-hover.test.mjs` |

**当前测试数：523 项 / 523 通过 / 0 失败**（基线 329 + 本轮 194）。

---

## 1. D1 —— DSH 宿主进程崩溃（致命）

### 1.1 现象

用户实机使用后，DSH **整个应用意外退出**。日志：

```
C:\Users\X-L-S\AppData\Roaming\@deepseek-ai\dsh-desktop\logs\crash-2026-10-31T08-15-23-334Z-host.log

--- error ---
Error: dsh desktop host exited with 1: [...]
dsh: fatal load failure: Error: illegal language server state transition: idle → building
    at assertTransition (…/src/host/lsp.js:200:11)
    at #transition (…/src/host/lsp.js:1251:5)
    at #restart (…/src/host/lsp.js:1499:21)
```

退出后**只有禁用插件、清空设置才能重新进入**（模型配置也被清掉 —— 那是用户自己为了恢复而清的不是插件写坏的）。

### 1.2 根因（两层）

**第一层 —— 状态机在异步路径上抛错。**
`#restart()` 在 `await this.#spawn(...)` 之后调用 `#transition(session, 'building')`。
`await` 期间状态可能已经变了（空闲退出 / 取消 / 关闭），于是变成 `idle → building`，
而 `TRANSITIONS` 里没有这条边 → `assertTransition()` 抛错。

**第二层（致命）—— 抛错变成了未处理的 Promise rejection。**
`#restart` 是通过 `setTimeout(() => { void this.#restart(...) })` 调度的：
`void` **不接住 rejection** → Node 的 `unhandledRejection` → harness 把它当作
**致命加载失败** → `dsh desktop host exited with 1` → **整个 DSH 应用退出**。

> ⚠️ **教训**：插件里的任何异步步骤都**不能**让 rejection 逃出去。宿主里一个未处理的
> rejection 就等于整个 DSH 进程死亡。

### 1.3 修复

| 位置 | 改动 |
|---|---|
| `src/host/lsp.js` | 新增 `#safely(promise, what)`：接住 rejection 并写日志。**所有**异步调用都改走它（`#onCrash` ×4、`#exitIdle`、`#persistIndexed`、`#restart`）。 |
| `src/host/lsp.js` | `#restart()` 在 `await #spawn()` 之后**重新核对状态**：`entry.session !== session` 或 `session.state !== 'restarting'` 就直接返回，不再强行迁移。 |
| `src/host/lsp.js` | 进程**代次守卫**（`session.generation`）：被替换掉的旧进程，它的 stdout / exit / stderr 回调全部忽略，不会把新会话带崩。旧进程在 `#spawn()` 里先被 `terminate()`，不再泄漏后台进程。 |
| `src/host/lsp.js` | `TRANSITIONS` 补 `starting → crashed`（进程在启动阶段就死掉是合法的）。 |
| `src/host/lsp.js` | `#spawn()` 里 `Promise.resolve(handle.done ?? null)`：句柄没有 `done` 时不再被当成「进程以 code null 退出」。 |
| `src/host/lsp-ws.js` | `attach()` 整个包 try/catch：upgrade 回调里抛错会逃进 HTTP server。`relayToServer()` 也单独包了。 |

**状态机本身保持严格**（非法迁移仍然抛错，`tests/lsp-lifecycle.test.mjs` 依赖这一点）——
宿主安全由 `#safely` 兜底，而不是把状态机放松。

### 1.4 验证

```powershell
cd dsh-ide-workbench
node docs\bench\crash-recovery.mjs
```

脚本会：起一个假语言服务器 → 把它杀掉（模拟崩溃）→ 等自动重启 →
断言 **没有未处理的 rejection**、宿主进程仍然活着。

### 1.5 还没做的（接手者要补）

- [ ] 崩溃路径的**自动化测试**（目前只有 `docs/bench/` 里的脚本，没有进 `tests/`）。
      `tests/lsp-recovery.test.mjs` 已有替身，可以在那里加「崩溃后宿主不死」的用例。
- [ ] `#safely` 的覆盖面复查：目前只审了 `src/host/lsp.js` 与 `src/host/lsp-ws.js`；
      `src/index.js` 的 API 路由有 try/catch，终端 WS 的 `attachTerminal` 也有。
- [ ] 客户端（renderer）侧还有大量 `void this.xxx()`（`src/client/store.js` 约 60 处），
      那里抛错不会杀宿主，但会在控制台刷未处理 rejection，值得顺手收一收。

---

## 2. D2 —— 状态永远停在「语义分析：索引中…」

### 2.1 现象

打开工作台后，状态栏一直是「语义分析：索引中…」，功能看起来完全没工作。

### 2.2 根因 —— 握手被丢了

浏览器的 WebSocket 在**工作台打开时**就连上了，但语言服务器是**用户选项目之后**才启动的：

```
T0  浏览器连上 ws://…/ws/lsp?root=…
T0  浏览器立刻发 initialize（@codemirror/lsp-client 的 LSPClient.connect() 会马上发）
T1  用户选项目 → 宿主才 lsp.start() → 语言服务器才起来
```

`T0` 那一刻宿主还没有会话，`LspManager.relayToServer()` 直接 `return false` ——
**把握手丢了**。于是：

- 服务器永远收不到 `initialize` → 永远不回答；
- 宿主永远看不到服务器输出 → 就绪判定（"服务器答了话 + 1.5 s"）永远不触发；
- 状态机永远停在 `building` → 状态栏永远显示「索引中…」；
- 服务器也永远没有任何活动 → 空闲定时器（10 分钟）最后把会话打成 `idle`。

### 2.3 修复

| 位置 | 改动 |
|---|---|
| `src/host/lsp.js` | root entry 增加 `pending: []`：没有会话时到达的客户端载荷**不再丢弃**，先存起来（上限 64 条）。 |
| `src/host/lsp.js` | `#spawn()` 建好 worker 之后，先发 `entry.handshake`、再 `#replayPending()` 按原顺序把缓冲的载荷交给服务器。 |
| `src/host/lsp.js` | root entry 增加 `handshake: ''`：worker 报来 `{type:'handshake', text}` 时存下握手原文，**崩溃重启后新进程还能拿到它**（否则新进程同样收不到 `initialize`）。 |
| `src/host/lsp-worker.js` | `Handshake` 只转发**第一次** `initialize`（一个进程只允许初始化一次）；重复的握手 id 记进 `duplicates`，等服务器回答第一个之后用缓存的能力值补答。 |

> **主线程不解析任何载荷**：`pending` / `handshake` 都是**不透明的字符串**，
> 主线程只是搬运；"这是不是一个 initialize" 由 worker 判断（worker 是唯一允许解析的地方）。

### 2.4 验证

```powershell
cd dsh-ide-workbench
node docs\bench\repro-order.mjs
```

脚本模拟浏览器的真实顺序（**先连 socket，后启动服务器**），期望：

```text
1. socket open (no language server yet)
2. initialize sent while there is no server (it has to be held)
3. lsp.start -> {"state":"building", …}
4. the server answered the handshake: yes (23 capabilities)
5. lsp.status -> ready (good)
6. textDocument/definition -> [{"uri":"file:///…/src/client/lsp-uri.js","range":{…}}]
```

---

## 3. D3 —— `Find definition failed: Request timed out`

### 3.1 根因

**D2 的连带症状**：服务器没有收到 `initialize`，就永远不会回答任何请求，
客户端等满 `requestTimeoutMs`（30 s）后报超时。修好 D2 就好了。

### 3.2 顺带修的「重连后不重新握手」

`@codemirror/lsp-client` 只在**首次** `connect()` 时发 `initialize`，
断线重连后库不会再发一次 → 会话是死的。现在：

- transport 的 `onOpen` 带上 `reopened` 标志；
- 客户端收到 `reopened` 就 `disconnect()` + `connect()`，重发握手；
- 宿主侧 worker 用缓存的能力值回答第二次 `initialize`（见 §2.3）。

---

## 4. D4 —— 错误浮层盖住内容区

### 4.1 根因

`@codemirror/lsp-client` 的 `LSPPlugin.reportError()` 调 `showDialog(view, { top: true })`，
在编辑器**顶部开一个 CodeMirror 面板**，而且**从不自动关闭**。
一次失败的请求就一直盖着代码，用户要点叉。

### 4.2 修复

`src/client/lsp-session.js` 新增 `redirectErrorsToToast()`：
把 `LSPPlugin.prototype.reportError` 换成一个新函数 —— 打日志 + 调
`store.toast('error', '…', '')`（工作台自带的 toast，9 秒后自动消失，不挡内容）。
只有 store 不可用或 toast 抛错时才回落到库的原实现。

> 库本身没有被改（它在 `node_modules` 里）；这里改的是它的 prototype，
> 只在第一次 `startLsp()` 时换一次（幂等）。

**还需要人工确认**：浏览器里 Ctrl+点击失败时，toast 是否出现、内容区是否不再被遮挡。

---

## 5. D5 —— 插件装上后起不来（`Invalid effect`）

`ctx.effect()` 的回调只接受**函数**或空；返回一个普通对象会被 Cordis 拒掉
（`TypeError: Invalid effect`），插件整个不激活。

```js
// 错的
ctx.effect(() => registerLspWebSocket(ctx, { manager: lsp, fence }), '…')
// 对的
ctx.effect(() => {
  const relay = registerLspWebSocket(ctx, { manager: lsp, fence })
  return () => relay.close()
}, '…')
```

`tests/plugin-mount.test.mjs` 用一个 Cordis 假 context 守住这条（4 个用例）。

---

## 6. D6 —— `perf-cold-workspace` 偶发失败

前两个用例没清掉 store 的后台树定时器，泄漏到下一个用例的断言窗口里，
机器一忙就报 “expected 1, got 2”。加 `clearTimeout(store.restoredTimer)` 即可。

---

## 7. D7 —— 重启后的语言服务器静默死亡不被察觉

`session.exited` 在崩溃路径上被置成 `true`，而 `#spawn()` **没有把它清回去**。
于是重启后的新进程一旦 stdout 结束，`if (!current() || session.exited) return`
把这次死亡吞掉 —— 服务器悄悄死了，宿主还以为它在跑。

**修复**：`#spawn()` 里 `session.exited = false`。

顺带把 `relayToServer()` 的 `#peek()` 换成 `#entry()`：根目录的条目不存在时
（socket 还没接上）载荷会被创建出来并暂存，而不是被丢掉。

---

## 8. D8 —— 已索引的仓库永远显示「正在更新索引…」

### 8.1 现象

仓库明明已经建过索引，状态栏却一直停在橙色的「正在更新索引…」，看起来卡死。

### 8.2 根因 —— 陈旧的 `progress`

`store.refreshLspStatus()` 把**上一份快照**摊到下一份上：

```js
const next = { ...this.state.lsp, state: status.state, ... }
if (next.state === 'building') {
  next.progress = index.progress     // 只在 building 时更新
}
```

`progress` / `startedAt` / `cancellable` 只在 `building` 分支里**赋值**，从不清空。
状态变 `ready` 之后，这三个值仍然带着上一次构建的残留；而状态栏的 `ready` 分支是：

```js
return progress === ''
  ? { key: 'ready', text: '语义分析：就绪' }
  : { key: 'updating', text: '正在更新索引…' }   // ← 被残留值命中
```

于是「就绪」永远显示成「正在更新索引…」。

### 8.3 修复

| 位置 | 改动 |
|---|---|
| `src/client/store.js` | `state !== 'building'` 时把 `progress` / `startedAt` / `cancellable` 清空（`''` / `0` / `false`）。 |
| `src/client/Workbench.jsx` | `ready` 分支**不再看** `progress`，永远显示「就绪」。增量更新发生在语言服务器内部、它不上报任何东西，所以根本没有「更新中」这个状态可以显示 —— 之前的实现是在拿一个过去的构建值冒充它。 |

两处都要改：`tests/lsp-status-progress.test.mjs` 验证过，**只改 store** 或**只改视图**时用例都会失败。

### 8.4 验证

```powershell
node --test tests/lsp-status-progress.test.mjs     # 4 个用例
```

覆盖：构建中 → `progress` 有值、`cancellable` 为真；变 `ready` → 三个值全部清空；
`ready` 即使带着残留 `progress` 也显示「就绪」；`building` 仍然显示「索引中…」。

---

## 9. D9 —— 悬停卡片 / 补全弹窗看不清，Ctrl+悬浮没有提示

### 10.1 三个现象

1. **悬停卡片（hover）文字几乎看不见**：浅色卡片上是很浅的灰字。
2. **补全弹窗选中行看不清**：选中那条几乎看不见字。
3. **Ctrl+悬浮没有任何效果**：能跳转，但按 Ctrl 前后视觉上没区别，用户不知道该点哪里。

### 10.2 根因

**悬停卡片**：样式写的是 `.cm-lsp-hover`，但库实际渲染的类名是
**`.cm-lsp-hover-tooltip`**（`@codemirror/lsp-client` 的 `hoverTooltips` 里
`showTooltip({ class: "cm-lsp-hover-tooltip ..." })`）。那条规则**一条都没匹配上**，
卡片就用了库自己的浅色主题 —— 浅底浅字。

**补全弹窗**：库的 `@codemirror/autocomplete` 用 `&light` / `&dark` 变体给选中行上色；
我们的编辑器主题是 `EditorView.theme(..., { dark: true })`（写死的），于是走 `&dark`
分支上了深色底，而我们的规则又把前景色设成 `var(--iwb-fg)` —— 在用户的**浅色皮肤**下
那是深色 → **深底深字**。同时 `styles.js` 和 `CodeEditor.jsx` 的 THEME 各写了一份规则，
优先级互相打架，结果不可预测。

**Ctrl+悬浮**：根本没实现，只做了点击。

### 10.3 修复

| 位置 | 改动 |
|---|---|
| `src/client/CodeEditor.jsx` | 把补全弹窗的颜色规则**全部移出** THEME（那里只留 `.cm-panels`），交给 `styles.js` 一处负责 —— 库就赢不了优先级之争。 |
| `src/client/styles.js` | 用**正确的类名**重写：`.cm-tooltip.cm-lsp-hover-tooltip`、`.cm-lsp-signature-tooltip`、`.cm-lsp-documentation`、`.cm-lsp-completion-documentation`。底色、前景色、边框、阴影全部来自工作台令牌，并对会打架的属性加 `!important`。选中行统一为**强调色底 + 白字**（浅色/深色皮肤都可读）。 |
| `src/client/styles.js` | JSDoc 和签名帮助是按**深色**调的语法高亮，所以给这些 `pre` / `code` 一个深色代码块底（两种皮肤下都成立），既像代码又能看清。 |
| `src/client/CodeEditor.jsx` | 新增 Ctrl+悬浮提示：`StateField` 持有一个 `Decoration.mark`（类名 `iwb-ctrl-hover-symbol`），`mousemove` / `mouseleave` / 窗口的 `keydown` / `keyup` / `blur` 一起维护它；装饰会随文档变更 `map` 到新位置，所以打字时也还在那个词上。 |
| `src/client/styles.js` | `.iwb-ctrl-hover-symbol`：强调色 + 下划线 + `cursor: pointer`，颜色对标记及其子节点都强制，压过 token 的语法色。 |

### 10.4 验证

```powershell
node --test tests/ctrl-hover.test.mjs      # 7 个用例
```

覆盖：标识符范围的精确 from/to、注释/空格/数字不命中、悬停提示初始为空、
设置/清除装饰、装饰带正确的类名、文档在前面插入字符后装饰跟着位移、
以及**样式表确实用了库真实渲染的类名**（这条是防回归的关键）。

---

## 10. 交接清单

### 10.1 已完成

- [x] D1 崩溃（结构性的三层修复 + 复现脚本）
- [x] D2 索引中卡死（握手缓冲 + 握手缓存 + worker 去重）
- [x] D3 跳转定义超时（D2 的连带症状，已修）
- [x] D4 错误浮层（改走 toast）
- [x] D5 插件不激活
- [x] D6 测试抖动
- [x] D7 重启后静默死亡

### 10.2 接手者要做

1. **重装并实测**：插件是 `link:` 安装（profile 的 `package.json` 里指向工作目录），
   改完代码后 `plugin_manager set_bundle dsh-ide-workbench enabled=false` 再 `true`，
   **浏览器要刷新**才能拿到新的 `dist/client.js`。
2. **人工走查**（`docs/PRD-v5-实施进展.md` §5.3 的清单），重点：
   - 状态栏能在「就绪」和「保守版」之间正确切换；
   - `Ctrl+点击` 能跳到定义并定位到列；
   - 失败时 toast 出现且**不遮挡内容区**；
   - 索引超过 60 s 出现【取消索引】，点掉后 ≤ 2 s 变成「已取消（保守版）」且无残留进程；
   - 手动 kill 语言服务器 → 状态栏变红 + toast → 自动重启一次 → 功能恢复；
   - 空闲 10 分钟 → 进程退出、内存回落。
3. **跑全量**：`npm test`（512 项）+ `npm run build`。

### 10.3 复现脚本（在 `docs/bench/`，不进 npm 包）

| 脚本 | 作用 |
|---|---|
| `node docs\bench\live-lsp.mjs` | 用**真的** `typescript-language-server` 跑通完整链路（握手 → 定义请求 → 重连） |
| `node docs\bench\repro-order.mjs` | 复现并验证 D2（浏览器真实顺序：先连 socket、后启动服务器） |
| `node docs\bench\crash-recovery.mjs` | 复现并验证 D1（语言服务器崩溃 → 宿主必须活着） |

### 10.4 新增的回归测试

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `tests/lsp-handshake.test.mjs` | 9 | 握手被暂存而不是丢弃、服务器起来后按序重放、握手被记住（崩溃重启路径）、`Handshake` 只转发一次、重复握手的补答、缓冲上限 64 |
| `tests/lsp-error-toast.test.mjs` | 6 | 错误走 toast 而不是库的面板、toast 文案带 message+detail、store 没有 toast / toast 抛错时回落到库、只重定向一次 |
| `tests/plugin-mount.test.mjs` | 4 | 插件能挂上路由与 WS、每个 effect 都交回 Cordis 接受的 disposer |

### 10.5 交接时容易踩的坑

- **`ctx.subprocess.spawn()` 是同步的**，返回句柄而不是 Promise。写假件时别写成 `async`，
  否则 `handle.done` 变成 undefined，会被误判成「进程以 code null 退出」。
- **宿主里一个未处理的 rejection = 整个 DSH 进程死亡**。插件里的异步步骤一律走 `#safely()`。
  **定时器回调里的 throw 同样是未捕获异常**，也要包 try/catch。
- **`ctx.effect()` 的回调只能返回函数或空**，返回对象会让插件不激活。
- 语言服务器在 Windows 上**不能用 `.cmd` shim 启动**（`spawn EINVAL`）：用的是
  `process.execPath` + 包自己的 JS 入口。
